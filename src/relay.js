import { sendDiscordMessage, updateDiscordMessage } from './discord.js';
import { HttpError } from './http.js';
import { fetchRecentFeedItems } from './sina.js';
import { createRelayStore } from './store.js';
import {
  extractHeadlineParts,
  extractTrailingSource,
  formatApiTime,
  getNumericItemId,
  getTagNames,
  isFocusItem,
  sha256Hex,
  truncateText
} from './utils.js';

function nowIsoString() {
  return new Date().toISOString();
}

function formatEmphasisBlock(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return '';
  }

  return text
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      return trimmed ? `**${trimmed}**` : '';
    })
    .filter(Boolean)
    .join('\n');
}

function buildRelayMessage(item) {
  const originalText = typeof item?.rich_text === 'string' ? item.rich_text.trim() : '';
  const headlineParts = extractHeadlineParts(originalText);
  const sourceParts = extractTrailingSource(headlineParts.body || originalText);
  const title = headlineParts.title.trim();
  const body = sourceParts.body.trim();
  const source = sourceParts.source.trim();
  const tagNames = getTagNames(item);
  const docUrl = getDocUrl(item);
  const focus = isFocusItem(item);
  const bodyText = body || (!title && originalText ? originalText : '');
  const lines = ['\u200b', '------------------------------'];

  if (title) {
    lines.push('', focus ? `### **${title}**` : `### ${title}`);
  }

  if (bodyText) {
    lines.push(focus ? formatEmphasisBlock(bodyText) : bodyText);
  }

  const metadataParts = [
    `ID: ${item?.id || '-'}`,
    `时间: ${formatApiTime(item?.create_time || '')}`,
    `标签: ${tagNames.length > 0 ? tagNames.join(' / ') : '无'}`
  ];

  if (source) {
    metadataParts.push(`来源: ${source}`);
  }

  lines.push(`-# ${metadataParts.join(' | ')}`);

  return truncateText(lines.join('\n'), 2000);
}

function createRunSummary({
  runId,
  startedAt,
  finishedAt,
  triggerType,
  outcome,
  fetchedCount,
  createdCount,
  updatedCount,
  skippedCount,
  latestSeenId,
  lastProcessedId,
  seeded = false,
  errorMessage = ''
}) {
  return {
    run_id: runId,
    started_at: startedAt,
    finished_at: finishedAt,
    triggerType,
    trigger_type: triggerType,
    outcome,
    fetchedCount,
    fetched_count: fetchedCount,
    createdCount,
    created_count: createdCount,
    updatedCount,
    updated_count: updatedCount,
    skippedCount,
    skipped_count: skippedCount,
    latestSeenId,
    lastProcessedId,
    seeded,
    errorMessage,
    error_message: errorMessage
  };
}

function normalizeExistingMap(records) {
  const map = new Map();
  records.forEach(record => {
    const key = Number(record?.item_id);
    if (Number.isFinite(key)) {
      map.set(key, record);
    }
  });
  return map;
}

async function relayNewItem(item, existingRecord, config, store) {
  const content = buildRelayMessage(item);
  const contentHash = await sha256Hex(content);
  const sentAt = nowIsoString();
  const result = await sendDiscordMessage({
    webhookUrl: config.discordWebhookUrl,
    content,
    username: config.discordUsername
  });

  await store.upsertRelayItem({
    itemId: Number(item.id),
    discordMessageId: result.messageId,
    lastContentHash: contentHash,
    lastRelayedAt: sentAt
  });
}

async function relayUpdatedItem(item, existingRecord, config, store) {
  const content = buildRelayMessage(item);
  const contentHash = await sha256Hex(content);

  if (!existingRecord?.discord_message_id || existingRecord.last_content_hash === contentHash) {
    return false;
  }

  const sentAt = nowIsoString();
  const result = await updateDiscordMessage({
    webhookUrl: config.discordWebhookUrl,
    messageId: String(existingRecord.discord_message_id),
    content
  });

  await store.upsertRelayItem({
    itemId: Number(item.id),
    discordMessageId: result.messageId || String(existingRecord.discord_message_id),
    lastContentHash: contentHash,
    lastRelayedAt: sentAt
  });

  return true;
}

function createRetentionCutoffIso(days) {
  const cutoffDate = new Date();
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - days);
  return cutoffDate.toISOString();
}

export async function runRelaySync(env, config, { triggerType }) {
  if (!env.DB || typeof env.DB.prepare !== 'function') {
    throw new HttpError(503, 'missing_d1_binding', '未配置 D1 数据库绑定');
  }

  if (!config.discordWebhookUrl) {
    throw new HttpError(503, 'missing_discord_webhook_url_secret', '未配置 Discord Webhook Secret');
  }

  const store = createRelayStore(env.DB);
  const runId = crypto.randomUUID();
  const startedAt = nowIsoString();
  let fetchedCount = 0;
  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let latestSeenId = null;
  let lastProcessedId = null;

  try {
    const feedItems = await fetchRecentFeedItems(config);
    fetchedCount = feedItems.length;
    latestSeenId = feedItems.length > 0 ? getNumericItemId(feedItems[0]) : null;

    if (latestSeenId != null) {
      await store.setLastSeenFeedItemId(latestSeenId);
    }

    lastProcessedId = await store.getLastProcessedItemId();

    if (lastProcessedId == null) {
      if (latestSeenId != null) {
        await store.setLastProcessedItemId(latestSeenId);
      }

      const summary = createRunSummary({
        runId,
        startedAt,
        finishedAt: nowIsoString(),
        triggerType,
        outcome: latestSeenId == null ? 'empty' : 'seeded',
        fetchedCount,
        createdCount,
        updatedCount,
        skippedCount,
        latestSeenId,
        lastProcessedId: latestSeenId,
        seeded: latestSeenId != null
      });

      await store.setLastRunSummary(summary);

      return summary;
    }

    const existingRecords = await store.getRelayRecordsByItemIds(
      feedItems.map(item => getNumericItemId(item)).filter(Number.isFinite)
    );
    const existingMap = normalizeExistingMap(existingRecords);

    const newItems = feedItems
      .filter(item => {
        const itemId = getNumericItemId(item);
        return itemId != null && itemId > lastProcessedId;
      })
      .sort((left, right) => Number(left.id) - Number(right.id));

    let cursorToPersist = lastProcessedId;

    for (const item of newItems) {
      const itemId = Number(item.id);
      await relayNewItem(item, existingMap.get(itemId), config, store);
      createdCount += 1;
      cursorToPersist = itemId;
    }

    const existingItems = feedItems.filter(item => {
      const itemId = getNumericItemId(item);
      return itemId != null && itemId <= lastProcessedId && existingMap.has(itemId);
    });

    for (const item of existingItems) {
      const itemId = Number(item.id);
      const updated = await relayUpdatedItem(item, existingMap.get(itemId), config, store);

      if (updated) {
        updatedCount += 1;
      } else {
        skippedCount += 1;
      }
    }

    if (cursorToPersist !== lastProcessedId) {
      await store.setLastProcessedItemId(cursorToPersist);
      lastProcessedId = cursorToPersist;
    }

    await store.pruneRelayItemsOlderThan(createRetentionCutoffIso(7));

    const outcome = fetchedCount === 0 ? 'empty' : 'ok';
    const summary = createRunSummary({
      runId,
      startedAt,
      finishedAt: nowIsoString(),
      triggerType,
      outcome,
      fetchedCount,
      createdCount,
      updatedCount,
      skippedCount,
      latestSeenId,
      lastProcessedId
    });

    await store.setLastRunSummary(summary);

    return summary;
  } catch (error) {
    const summary = createRunSummary({
      runId,
      startedAt,
      finishedAt: nowIsoString(),
      triggerType,
      outcome: 'error',
      fetchedCount,
      createdCount,
      updatedCount,
      skippedCount,
      latestSeenId,
      lastProcessedId,
      errorMessage: error instanceof Error ? error.message : String(error)
    });

    await store.setLastRunSummary(summary);

    throw error;
  }
}
