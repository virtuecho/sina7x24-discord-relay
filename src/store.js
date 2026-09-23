const LAST_PROCESSED_ITEM_ID_KEY = 'last_processed_item_id';
const LAST_SEEN_FEED_ITEM_ID_KEY = 'last_seen_feed_item_id';
const ACTIVE_FEED_SNAPSHOT_KEY = 'active_feed_snapshot';
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

  async function getActiveFeedSnapshot() {
    const snapshot = await getJsonState(ACTIVE_FEED_SNAPSHOT_KEY);
    if (!Array.isArray(snapshot?.itemIds) || typeof snapshot.seenAt !== 'string') {
      return null;
    }

    return {
      itemIds: [...new Set(snapshot.itemIds.map(Number).filter(Number.isFinite))],
      seenAt: snapshot.seenAt,
      latestSeenId: snapshot.latestSeenId != null
        && Number.isFinite(Number(snapshot.latestSeenId))
        ? Number(snapshot.latestSeenId)
        : null,
      seedComplete: snapshot.seedComplete === true
    };
  }

  async function recordFeedPageObservation({ itemIds, seenAt, latestSeenId }) {
    const previousSnapshot = await getActiveFeedSnapshot();
    const currentItemIds = [...new Set(itemIds.map(Number).filter(Number.isFinite))];
    const currentItemIdSet = new Set(currentItemIds);
    const departedItemIds = (previousSnapshot?.itemIds || [])
      .filter(itemId => !currentItemIdSet.has(itemId));
    const effectiveLatestSeenId = latestSeenId
      ?? previousSnapshot?.latestSeenId
      ?? await getLastSeenFeedItemId();
    const snapshot = {
      itemIds: currentItemIds,
      seenAt,
      latestSeenId: effectiveLatestSeenId,
      seedComplete: previousSnapshot?.seedComplete === true
    };
    const statements = [];

    if (departedItemIds.length > 0) {
      statements.push(
        db.prepare(`
          UPDATE relay_items
          SET last_seen_at = ?
          WHERE last_seen_at < ?
            AND item_id IN (
              SELECT CAST(value AS INTEGER) FROM json_each(?)
            )
        `).bind(
          previousSnapshot.seenAt,
          previousSnapshot.seenAt,
          JSON.stringify(departedItemIds)
        )
      );
    }

    statements.push(
      db.prepare(`
        INSERT INTO relay_state (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `).bind(ACTIVE_FEED_SNAPSHOT_KEY, JSON.stringify(snapshot), seenAt)
    );

    await db.batch(statements);
    return { previousSnapshot, snapshot };
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
            create_time,
            update_time,
            normalized_source_fingerprint,
            discord_message_id,
            relay_status,
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
          create_time,
          update_time,
          normalized_source_fingerprint,
          discord_message_id,
          relay_status,
          last_seen_at,
          last_relayed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id) DO UPDATE SET
          create_time = excluded.create_time,
          update_time = excluded.update_time,
          normalized_source_fingerprint = excluded.normalized_source_fingerprint,
          discord_message_id = excluded.discord_message_id,
          relay_status = excluded.relay_status,
          last_seen_at = excluded.last_seen_at,
          last_relayed_at = excluded.last_relayed_at
      `,
      [
        record.itemId,
        record.createTime,
        record.updateTime,
        record.normalizedSourceFingerprint,
        record.discordMessageId,
        record.relayStatus,
        record.lastSeenAt,
        record.lastRelayedAt
      ]
    );
  }

  async function seedRelayItems(records) {
    const activeFeedSnapshot = await getActiveFeedSnapshot();
    const statements = records.map(record => db.prepare(`
      INSERT INTO relay_items (
        item_id,
        create_time,
        update_time,
        normalized_source_fingerprint,
        discord_message_id,
        relay_status,
        last_seen_at,
        last_relayed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(item_id) DO NOTHING
    `).bind(
      record.itemId,
      record.createTime,
      record.updateTime,
      record.normalizedSourceFingerprint,
      record.discordMessageId,
      record.relayStatus,
      record.lastSeenAt,
      record.lastRelayedAt
    ));

    if (activeFeedSnapshot && !activeFeedSnapshot.seedComplete) {
      activeFeedSnapshot.seedComplete = true;
      statements.push(db.prepare(`
        UPDATE relay_state
        SET value = ?, updated_at = ?
        WHERE key = ?
      `).bind(
        JSON.stringify(activeFeedSnapshot),
        activeFeedSnapshot.seenAt,
        ACTIVE_FEED_SNAPSHOT_KEY
      ));
    }

    if (statements.length > 0) {
      await db.batch(statements);
    }
  }

  async function pruneRelayItemsLastSeenBefore(cutoffIsoString, activeItemIds = []) {
    const result = await execute(
      db,
      `
        DELETE FROM relay_items
        WHERE last_seen_at < ?
          AND item_id NOT IN (
            SELECT CAST(value AS INTEGER) FROM json_each(?)
          )
      `,
      [cutoffIsoString, JSON.stringify(activeItemIds)]
    );

    return getAffectedRows(result);
  }

  async function getStatusSnapshot() {
    const [lastProcessedItemId, lastSeenFeedItemId, activeFeedSnapshot, lastRun, activeLock, recentRows] = await Promise.all([
      getLastProcessedItemId(),
      getLastSeenFeedItemId(),
      getActiveFeedSnapshot(),
      getLastRunSummary(),
      getActiveRunLock(),
      queryAll(
        db,
        `
          SELECT
            item_id,
            create_time,
            update_time,
            relay_status,
            discord_message_id,
            normalized_source_fingerprint,
            last_seen_at,
            last_relayed_at
          FROM relay_items
          WHERE relay_status != 'seeded'
          ORDER BY last_seen_at DESC
          LIMIT 20
        `
      )
    ]);
    const activeRecords = activeFeedSnapshot?.itemIds.length
      ? await getRelayRecordsByItemIds(activeFeedSnapshot.itemIds)
      : [];
    const activeItemIds = new Set(activeFeedSnapshot?.itemIds || []);
    const recentItemsById = new Map(
      recentRows.map(record => [Number(record.item_id), record])
    );

    for (const record of activeRecords) {
      if (record.relay_status !== 'seeded') {
        recentItemsById.set(Number(record.item_id), record);
      }
    }

    const recentItems = [...recentItemsById.values()]
      .map(record => activeItemIds.has(Number(record.item_id))
        && activeFeedSnapshot.seenAt > record.last_seen_at
        ? { ...record, last_seen_at: activeFeedSnapshot.seenAt }
        : record)
      .sort((left, right) => right.last_seen_at.localeCompare(left.last_seen_at)
        || Number(right.item_id) - Number(left.item_id))
      .slice(0, 20);

    return {
      cursor: {
        lastProcessedItemId,
        lastSeenFeedItemId: activeFeedSnapshot?.latestSeenId ?? lastSeenFeedItemId
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
    recordFeedPageObservation,
    getActiveRunLock,
    acquireRunLock,
    releaseRunLock,
    getRelayRecordsByItemIds,
    upsertRelayItem,
    seedRelayItems,
    pruneRelayItemsLastSeenBefore,
    getStatusSnapshot
  };
}
