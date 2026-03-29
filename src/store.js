const LAST_PROCESSED_ITEM_ID_KEY = 'last_processed_item_id';
const LAST_SEEN_FEED_ITEM_ID_KEY = 'last_seen_feed_item_id';
const LAST_RUN_SUMMARY_KEY = 'last_run_summary';
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
            discord_message_id,
            last_content_hash,
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
          discord_message_id,
          last_content_hash,
          last_relayed_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(item_id) DO UPDATE SET
          discord_message_id = excluded.discord_message_id,
          last_content_hash = excluded.last_content_hash,
          last_relayed_at = excluded.last_relayed_at
      `,
      [
        record.itemId,
        record.discordMessageId,
        record.lastContentHash,
        record.lastRelayedAt
      ]
    );
  }

  async function pruneRelayItemsOlderThan(cutoffIsoString) {
    const result = await execute(
      db,
      'DELETE FROM relay_items WHERE last_relayed_at < ?',
      [cutoffIsoString]
    );

    return Number(result?.meta?.changes || 0);
  }

  async function getStatusSnapshot() {
    const [lastProcessedItemId, lastSeenFeedItemId, lastRun, recentItems] = await Promise.all([
      getLastProcessedItemId(),
      getLastSeenFeedItemId(),
      getLastRunSummary(),
      queryAll(
        db,
        `
          SELECT
            item_id,
            discord_message_id,
            last_content_hash,
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
    getLastRunSummary,
    setLastRunSummary,
    getRelayRecordsByItemIds,
    upsertRelayItem,
    pruneRelayItemsOlderThan,
    getStatusSnapshot
  };
}
