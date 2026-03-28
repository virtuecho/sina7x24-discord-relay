const LAST_PROCESSED_ITEM_ID_KEY = 'last_processed_item_id';
const LAST_SEEN_FEED_ITEM_ID_KEY = 'last_seen_feed_item_id';

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

  async function insertRun({ runId, startedAt, triggerType }) {
    await execute(
      db,
      `
        INSERT INTO relay_runs (
          run_id,
          started_at,
          trigger_type,
          outcome
        ) VALUES (?, ?, ?, ?)
      `,
      [runId, startedAt, triggerType, 'running']
    );
  }

  async function finishRun({
    runId,
    finishedAt,
    outcome,
    fetchedCount,
    createdCount,
    updatedCount,
    skippedCount,
    errorMessage = ''
  }) {
    await execute(
      db,
      `
        UPDATE relay_runs
        SET finished_at = ?,
            outcome = ?,
            fetched_count = ?,
            created_count = ?,
            updated_count = ?,
            skipped_count = ?,
            error_message = ?
        WHERE run_id = ?
      `,
      [
        finishedAt,
        outcome,
        fetchedCount,
        createdCount,
        updatedCount,
        skippedCount,
        errorMessage,
        runId
      ]
    );
  }

  async function getRelayRecordsByItemIds(itemIds) {
    const ids = [...new Set(itemIds.map(value => Number(value)).filter(Number.isFinite))];
    if (ids.length === 0) {
      return [];
    }

    const placeholders = ids.map(() => '?').join(', ');
    return queryAll(
      db,
      `
        SELECT
          item_id,
          discord_message_id,
          discord_channel_id,
          last_content_hash,
          first_seen_at
        FROM relay_items
        WHERE item_id IN (${placeholders})
      `,
      ids
    );
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
          discord_message_id,
          discord_channel_id,
          last_content_hash,
          relay_status,
          first_seen_at,
          last_seen_at,
          last_relayed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id) DO UPDATE SET
          zhibo_id = excluded.zhibo_id,
          create_time = excluded.create_time,
          update_time = excluded.update_time,
          headline = excluded.headline,
          source = excluded.source,
          tag_names = excluded.tag_names,
          doc_url = excluded.doc_url,
          discord_message_id = excluded.discord_message_id,
          discord_channel_id = excluded.discord_channel_id,
          last_content_hash = excluded.last_content_hash,
          relay_status = excluded.relay_status,
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
        record.discordMessageId,
        record.discordChannelId,
        record.lastContentHash,
        record.relayStatus,
        record.firstSeenAt,
        record.lastSeenAt,
        record.lastRelayedAt
      ]
    );
  }

  async function getStatusSnapshot() {
    const [lastProcessedItemId, lastSeenFeedItemId, lastRun, recentItems] = await Promise.all([
      getLastProcessedItemId(),
      getLastSeenFeedItemId(),
      queryFirst(
        db,
        `
          SELECT
            run_id,
            started_at,
            finished_at,
            trigger_type,
            outcome,
            fetched_count,
            created_count,
            updated_count,
            skipped_count,
            error_message
          FROM relay_runs
          ORDER BY started_at DESC
          LIMIT 1
        `
      ),
      queryAll(
        db,
        `
          SELECT
            item_id,
            create_time,
            update_time,
            headline,
            source,
            tag_names,
            doc_url,
            discord_message_id,
            relay_status,
            last_relayed_at
          FROM relay_items
          ORDER BY last_relayed_at DESC
          LIMIT 20
        `
      )
    ]);

    return {
      cursor: {
        lastProcessedItemId,
        lastSeenFeedItemId
      },
      lastRun,
      recentItems
    };
  }

  return {
    getLastProcessedItemId,
    setLastProcessedItemId,
    getLastSeenFeedItemId,
    setLastSeenFeedItemId,
    insertRun,
    finishRun,
    getRelayRecordsByItemIds,
    upsertRelayItem,
    getStatusSnapshot
  };
}
