const LAST_PROCESSED_ITEM_ID_KEY = 'last_processed_item_id';
const LAST_SEEN_FEED_ITEM_ID_KEY = 'last_seen_feed_item_id';
const LAST_RUN_SUMMARY_KEY = 'last_run_summary';
const ACTIVE_RUN_LOCK_KEY = 'active_run_lock';
const MAX_SQL_VARIABLES_PER_QUERY = 100;

function getQueryResults(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

async function queryAll(db, sql, bindings = []) {
  const result = await db.prepare(sql).bind(...bindings).run();
  return getQueryResults(result);
}

async function queryFirst(db, sql, bindings = []) {
  return db.prepare(sql).bind(...bindings).first();
}

async function execute(db, sql, bindings = []) {
  return db.prepare(sql).bind(...bindings).run();
}

function nowIsoString() {
  return new Date().toISOString();
}

function chunkArray(values, chunkSize) {
  const chunks = [];

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
}

function getAffectedRows(result) {
  return Number(result?.meta?.changes || 0);
}

export function createRelayStore(db) {
  async function getState(key) {
    return queryFirst(
      db,
      'SELECT key, value, updated_at FROM relay_state WHERE key = ? LIMIT 1',
      [key]
    );
  }

  async function setState(key, value) {
    const updatedAt = nowIsoString();

    await execute(
      db,
      `
        INSERT INTO relay_state (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `,
      [key, String(value), updatedAt]
    );
  }

  async function getJsonState(key) {
    const state = await getState(key);
    if (!state?.value) {
      return null;
    }

    try {
      return JSON.parse(state.value);
    } catch (_error) {
      return null;
    }
  }

  async function setJsonState(key, value) {
    await setState(key, JSON.stringify(value));
  }

  async function getLastProcessedItemId() {
    const state = await getState(LAST_PROCESSED_ITEM_ID_KEY);
    const parsed = Number(state?.value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  async function setLastProcessedItemId(itemId) {
    await setState(LAST_PROCESSED_ITEM_ID_KEY, itemId);
  }

  async function getLastSeenFeedItemId() {
    const state = await getState(LAST_SEEN_FEED_ITEM_ID_KEY);
    const parsed = Number(state?.value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  async function setLastSeenFeedItemId(itemId) {
    await setState(LAST_SEEN_FEED_ITEM_ID_KEY, itemId);
  }

  async function getLastRunSummary() {
    return getJsonState(LAST_RUN_SUMMARY_KEY);
  }

  async function setLastRunSummary(summary) {
    await setJsonState(LAST_RUN_SUMMARY_KEY, summary);
  }

  async function getActiveRunLock() {
    const state = await getState(ACTIVE_RUN_LOCK_KEY);
    if (!state?.value) {
      return null;
    }

    return {
      runId: state.value,
      acquiredAt: state.updated_at
    };
  }

  async function acquireRunLock(runId, ttlMs) {
    const acquiredAt = nowIsoString();
    const staleBefore = new Date(Date.now() - ttlMs).toISOString();
    const result = await execute(
      db,
      `
        INSERT INTO relay_state (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
        WHERE relay_state.updated_at < ?
      `,
      [ACTIVE_RUN_LOCK_KEY, runId, acquiredAt, staleBefore]
    );

    return {
      acquired: getAffectedRows(result) > 0,
      acquiredAt
    };
  }

  async function releaseRunLock(runId) {
    const result = await execute(
      db,
      'DELETE FROM relay_state WHERE key = ? AND value = ?',
      [ACTIVE_RUN_LOCK_KEY, runId]
    );

    return getAffectedRows(result) > 0;
  }

  async function getRelayRecordsByItemIds(itemIds) {
    const ids = [...new Set(itemIds.map(value => Number(value)).filter(Number.isFinite))];
    if (ids.length === 0) {
      return [];
    }

    const results = [];
    const idChunks = chunkArray(ids, MAX_SQL_VARIABLES_PER_QUERY);

    for (const chunk of idChunks) {
      const placeholders = chunk.map(() => '?').join(', ');
      const rows = await queryAll(
        db,
        `
          SELECT
            item_id,
            zhibo_id,
            create_time,
            update_time,
            headline,
            source,
            tag_names,
            doc_url,
            normalized_content,
            content_fingerprint AS normalized_source_fingerprint,
            discord_message_id,
            last_content_hash,
            relay_status,
            duplicate_of_item_id,
            first_seen_at,
            last_seen_at,
            last_relayed_at
          FROM relay_items
          WHERE item_id IN (${placeholders})
        `,
        chunk
      );

      results.push(...rows);
    }

    return results;
  }

  async function upsertRelayItem(record) {
    await execute(
      db,
      `
        INSERT INTO relay_items (
          item_id,
          zhibo_id,
          create_time,
          update_time,
          headline,
          source,
          tag_names,
          doc_url,
          normalized_content,
          content_fingerprint,
          discord_message_id,
          last_content_hash,
          relay_status,
          duplicate_of_item_id,
          first_seen_at,
          last_seen_at,
          last_relayed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id) DO UPDATE SET
          zhibo_id = excluded.zhibo_id,
          create_time = excluded.create_time,
          update_time = excluded.update_time,
          headline = excluded.headline,
          source = excluded.source,
          tag_names = excluded.tag_names,
          doc_url = excluded.doc_url,
          normalized_content = excluded.normalized_content,
          content_fingerprint = excluded.content_fingerprint,
          discord_message_id = excluded.discord_message_id,
          last_content_hash = excluded.last_content_hash,
          relay_status = excluded.relay_status,
          duplicate_of_item_id = excluded.duplicate_of_item_id,
          first_seen_at = excluded.first_seen_at,
          last_seen_at = excluded.last_seen_at,
          last_relayed_at = excluded.last_relayed_at
      `,
      [
        record.itemId,
        record.zhiboId,
        record.createTime,
        record.updateTime,
        record.headline,
        record.source,
        record.tagNames,
        record.docUrl,
        record.normalizedContent,
        record.normalizedSourceFingerprint,
        record.discordMessageId,
        record.lastContentHash,
        record.relayStatus,
        record.duplicateOfItemId ?? null,
        record.firstSeenAt,
        record.lastSeenAt,
        record.lastRelayedAt
      ]
    );
  }

  async function pruneRelayItemsLastSeenBefore(cutoffIsoString) {
    const result = await execute(
      db,
      'DELETE FROM relay_items WHERE last_seen_at < ?',
      [cutoffIsoString]
    );

    return getAffectedRows(result);
  }

  async function getStatusSnapshot() {
    const [lastProcessedItemId, lastSeenFeedItemId, lastRun, activeLock, recentItems] = await Promise.all([
      getLastProcessedItemId(),
      getLastSeenFeedItemId(),
      getLastRunSummary(),
      getActiveRunLock(),
      queryAll(
        db,
        `
          SELECT
            item_id,
            create_time,
            update_time,
            headline,
            source,
            relay_status,
            duplicate_of_item_id,
            discord_message_id,
            content_fingerprint AS normalized_source_fingerprint,
            last_seen_at,
            last_relayed_at
          FROM relay_items
          ORDER BY last_seen_at DESC
          LIMIT 20
        `
      )
    ]);

    return {
      cursor: {
        lastProcessedItemId,
        lastSeenFeedItemId
      },
      activeLock,
      lastRun,
      recentItems
    };
  }

  return {
    getLastProcessedItemId,
    setLastProcessedItemId,
    getLastSeenFeedItemId,
    setLastSeenFeedItemId,
    getLastRunSummary,
    setLastRunSummary,
    getActiveRunLock,
    acquireRunLock,
    releaseRunLock,
    getRelayRecordsByItemIds,
    upsertRelayItem,
    pruneRelayItemsLastSeenBefore,
    getStatusSnapshot
  };
}
