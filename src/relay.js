import { sendDiscordMessage, updateDiscordMessage } from './discord.js';
import { HttpError } from './http.js';
import { fetchRecentFeedItems } from './sina.js';
import { createRelayStore } from './store.js';
import {
  extractHeadlineParts,
  extractTrailingSource,
  formatApiTime,
  getDocUrl,
  getNumericItemId,
  getTagNames,
  isFocusItem,
  normalizeContentText,
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

function buildHeadline(item) {
  const originalText = typeof item?.rich_text === 'string' ? item.rich_text.trim() : '';
  const headlineParts = extractHeadlineParts(originalText);
  const sourceParts = extractTrailingSource(headlineParts.body || originalText);
  const title = headlineParts.title.trim();
  const body = sourceParts.body.trim();

  return title || truncateText(body || originalText || `Item ${item?.id || ''}`, 120);
}

function buildSource(item) {
  const originalText = typeof item?.rich_text === 'string' ? item.rich_text.trim() : '';
  const headlineParts = extractHeadlineParts(originalText);
  const sourceParts = extractTrailingSource(headlineParts.body || originalText);
  return sourceParts.source.trim();
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
  deduplicatedCount,
  prunedCount,
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
    deduplicatedCount,
    deduplicated_count: deduplicatedCount,
    prunedCount,
    pruned_count: prunedCount,
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

function shouldReplaceFingerprintRecord(current, candidate) {
  const currentCanonical = current?.relay_status !== 'deduped';
  const candidateCanonical = candidate?.relay_status !== 'deduped';

  if (currentCanonical !== candidateCanonical) {
    return candidateCanonical;
  }

  const currentSeenAt = String(current?.last_seen_at || current?.first_seen_at || '');
  const candidateSeenAt = String(candidate?.last_seen_at || candidate?.first_seen_at || '');
  return candidateSeenAt > currentSeenAt;
}

function normalizeFingerprintMap(records) {
  const map = new Map();

  records.forEach(record => {
    const key = String(record?.normalized_source_fingerprint || '').trim();
    if (!key) {
      return;
    }

    const current = map.get(key);
    if (!current || shouldReplaceFingerprintRecord(current, record)) {
      map.set(key, record);
    }
  });

  return map;
}

function getCanonicalItemId(record) {
  const duplicateOfItemId = Number(record?.duplicate_of_item_id);
  if (Number.isFinite(duplicateOfItemId)) {
    return duplicateOfItemId;
  }

  const itemId = Number(record?.item_id);
  return Number.isFinite(itemId) ? itemId : null;
}

async function buildPreparedItem(item, config) {
  const normalizedContent = normalizeContentText(typeof item?.rich_text === 'string' ? item.rich_text : '');
  const content = buildRelayMessage(item);
  const normalizedSourceFingerprint = await sha256Hex(normalizedContent || content);

  return {
    itemId: Number(item.id),
    zhiboId: Number(item.zhibo_id || config.zhiboId),
    createTime: String(item.create_time || ''),
    updateTime: String(item.update_time || item.create_time || ''),
    headline: buildHeadline(item),
    source: buildSource(item),
    tagNames: getTagNames(item).join(' / '),
    docUrl: getDocUrl(item),
    normalizedContent,
    content,
    normalizedSourceFingerprint
  };
}

function createRelayItemRecord(prepared, existingRecord, overrides = {}) {
  return {
    itemId: prepared.itemId,
    zhiboId: prepared.zhiboId,
    createTime: prepared.createTime,
    updateTime: prepared.updateTime,
    headline: prepared.headline,
    source: prepared.source,
    tagNames: prepared.tagNames,
    docUrl: prepared.docUrl,
    normalizedContent: prepared.normalizedContent,
    normalizedSourceFingerprint: prepared.normalizedSourceFingerprint,
    discordMessageId: String(
      overrides.discordMessageId ?? existingRecord?.discord_message_id ?? ''
    ),
    lastContentHash: overrides.lastContentHash ?? String(existingRecord?.last_content_hash || prepared.normalizedSourceFingerprint),
    relayStatus: overrides.relayStatus ?? existingRecord?.relay_status ?? 'created',
    duplicateOfItemId: overrides.duplicateOfItemId ?? existingRecord?.duplicate_of_item_id ?? null,
    firstSeenAt: overrides.firstSeenAt ?? String(existingRecord?.first_seen_at || nowIsoString()),
    lastSeenAt: overrides.lastSeenAt ?? nowIsoString(),
    lastRelayedAt: overrides.lastRelayedAt ?? String(existingRecord?.last_relayed_at || nowIsoString())
  };
}

function toStoredRelayRecord(record) {
  return {
    item_id: record.itemId,
    zhibo_id: record.zhiboId,
    create_time: record.createTime,
    update_time: record.updateTime,
    headline: record.headline,
    source: record.source,
    tag_names: record.tagNames,
    doc_url: record.docUrl,
    normalized_content: record.normalizedContent,
    normalized_source_fingerprint: record.normalizedSourceFingerprint,
    discord_message_id: record.discordMessageId,
    last_content_hash: record.lastContentHash,
    relay_status: record.relayStatus,
    duplicate_of_item_id: record.duplicateOfItemId,
    first_seen_at: record.firstSeenAt,
    last_seen_at: record.lastSeenAt,
    last_relayed_at: record.lastRelayedAt
  };
}

function findDuplicateRecord(fingerprintMap, prepared) {
  const record = fingerprintMap.get(prepared.normalizedSourceFingerprint);
  if (!record) {
    return null;
  }

  const itemId = Number(record?.item_id);
  if (!Number.isFinite(itemId) || itemId === prepared.itemId) {
    return null;
  }

  if (!record?.discord_message_id) {
    return null;
  }

  return record;
}

async function relayNewItem(item, prepared, existingRecord, config, store) {
  const sentAt = nowIsoString();
  const result = await sendDiscordMessage({
    webhookUrl: config.discordWebhookUrl,
    content: prepared.content,
    username: config.discordUsername
  });

  const record = createRelayItemRecord(prepared, existingRecord, {
    discordMessageId: result.messageId,
    relayStatus: 'created',
    duplicateOfItemId: null,
    firstSeenAt: existingRecord?.first_seen_at || sentAt,
    lastSeenAt: sentAt,
    lastRelayedAt: sentAt
  });

  await store.upsertRelayItem(record);
  return toStoredRelayRecord(record);
}

async function markItemAsDeduplicated(prepared, existingRecord, duplicateRecord, store) {
  const seenAt = nowIsoString();
  const canonicalItemId = getCanonicalItemId(duplicateRecord);
  const record = createRelayItemRecord(prepared, existingRecord, {
    discordMessageId: String(duplicateRecord.discord_message_id),
    relayStatus: 'deduped',
    duplicateOfItemId: canonicalItemId,
    firstSeenAt: existingRecord?.first_seen_at || seenAt,
    lastSeenAt: seenAt,
    lastRelayedAt: String(
      existingRecord?.last_relayed_at || duplicateRecord.last_relayed_at || seenAt
    )
  });

  await store.upsertRelayItem(record);
  return toStoredRelayRecord(record);
}

async function relayUpdatedItem(item, prepared, existingRecord, fingerprintMap, config, store) {
  const seenAt = nowIsoString();

  if (!existingRecord?.discord_message_id) {
    return {
      action: 'skipped',
      record: existingRecord
    };
  }

  if (existingRecord.normalized_source_fingerprint === prepared.normalizedSourceFingerprint) {
    const record = createRelayItemRecord(prepared, existingRecord, {
      relayStatus: existingRecord.relay_status || 'created',
      duplicateOfItemId: existingRecord.duplicate_of_item_id ?? null,
      firstSeenAt: String(existingRecord.first_seen_at || seenAt),
      lastSeenAt: seenAt,
      lastRelayedAt: String(existingRecord.last_relayed_at || seenAt)
    });

    await store.upsertRelayItem(record);

    return {
      action: 'skipped',
      record: toStoredRelayRecord(record)
    };
  }

  if (existingRecord.relay_status === 'deduped') {
    const duplicateRecord = findDuplicateRecord(fingerprintMap, prepared);

    if (duplicateRecord) {
      const record = await markItemAsDeduplicated(prepared, existingRecord, duplicateRecord, store);
      return {
        action: 'skipped',
        record
      };
    }

    const record = await relayNewItem(item, prepared, existingRecord, config, store);
    return {
      action: 'created',
      record
    };
  }

  const result = await updateDiscordMessage({
    webhookUrl: config.discordWebhookUrl,
    messageId: String(existingRecord.discord_message_id),
    content: prepared.content
  });

  const record = createRelayItemRecord(prepared, existingRecord, {
    discordMessageId: result.messageId || String(existingRecord.discord_message_id),
    relayStatus: 'updated',
    duplicateOfItemId: null,
    firstSeenAt: String(existingRecord.first_seen_at || seenAt),
    lastSeenAt: seenAt,
    lastRelayedAt: seenAt
  });

  await store.upsertRelayItem(record);

  return {
    action: 'updated',
    record: toStoredRelayRecord(record)
  };
}

function createRetentionCutoffIso(days) {
  const cutoffDate = new Date();
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - days);
  return cutoffDate.toISOString();
}

function createLockedSummary({ runId, startedAt, finishedAt, triggerType, lastProcessedId }) {
  return createRunSummary({
    runId,
    startedAt,
    finishedAt,
    triggerType,
    outcome: 'locked',
    fetchedCount: 0,
    createdCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    deduplicatedCount: 0,
    prunedCount: 0,
    latestSeenId: null,
    lastProcessedId
  });
}

async function advanceLastProcessedCursor(store, currentValue, nextValue) {
  if (!Number.isFinite(nextValue)) {
    return currentValue;
  }

  if (Number.isFinite(currentValue) && nextValue <= currentValue) {
    return currentValue;
  }

  await store.setLastProcessedItemId(nextValue);
  return nextValue;
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
  let deduplicatedCount = 0;
  let prunedCount = 0;
  let latestSeenId = null;
  let lastProcessedId = null;
  let lockAcquired = false;

  try {
    const lockResult = await store.acquireRunLock(runId, config.runLockTtlMs);
    lockAcquired = lockResult.acquired;

    if (!lockAcquired) {
      lastProcessedId = await store.getLastProcessedItemId();
      return createLockedSummary({
        runId,
        startedAt,
        finishedAt: nowIsoString(),
        triggerType,
        lastProcessedId
      });
    }

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
        deduplicatedCount,
        prunedCount,
        latestSeenId,
        lastProcessedId: latestSeenId,
        seeded: latestSeenId != null
      });

      await store.setLastRunSummary(summary);

      return summary;
    }

    const preparedEntries = await Promise.all(
      feedItems.map(async item => ({
        item,
        prepared: await buildPreparedItem(item, config)
      }))
    );

    const existingRecords = await store.getRelayRecordsByItemIds(
      preparedEntries.map(entry => entry.prepared.itemId).filter(Number.isFinite)
    );
    const fingerprintRecords = await store.getRelayRecordsByContentFingerprints(
      preparedEntries.map(entry => entry.prepared.normalizedSourceFingerprint)
    );

    const existingMap = normalizeExistingMap(existingRecords);
    const fingerprintMap = normalizeFingerprintMap(fingerprintRecords);

    const newEntries = preparedEntries
      .filter(entry => entry.prepared.itemId > lastProcessedId)
      .sort((left, right) => left.prepared.itemId - right.prepared.itemId);

    for (const entry of newEntries) {
      const { item, prepared } = entry;
      const existingRecord = existingMap.get(prepared.itemId);

      if (existingRecord?.discord_message_id) {
        const result = await relayUpdatedItem(
          item,
          prepared,
          existingRecord,
          fingerprintMap,
          config,
          store
        );

        if (result?.record) {
          existingMap.set(prepared.itemId, result.record);
          if (result.record.relay_status !== 'deduped') {
            fingerprintMap.set(prepared.normalizedSourceFingerprint, result.record);
          }
        }

        if (result?.action === 'created') {
          createdCount += 1;
        } else if (result?.action === 'updated') {
          updatedCount += 1;
        } else {
          skippedCount += 1;
        }

        lastProcessedId = await advanceLastProcessedCursor(store, lastProcessedId, prepared.itemId);
        continue;
      }

      const duplicateRecord = findDuplicateRecord(fingerprintMap, prepared);

      if (duplicateRecord) {
        const record = await markItemAsDeduplicated(prepared, existingRecord, duplicateRecord, store);
        existingMap.set(prepared.itemId, record);
        deduplicatedCount += 1;
        lastProcessedId = await advanceLastProcessedCursor(store, lastProcessedId, prepared.itemId);
        continue;
      }

      const record = await relayNewItem(item, prepared, existingRecord, config, store);
      existingMap.set(prepared.itemId, record);
      fingerprintMap.set(prepared.normalizedSourceFingerprint, record);
      createdCount += 1;
      lastProcessedId = await advanceLastProcessedCursor(store, lastProcessedId, prepared.itemId);
    }

    const existingEntries = preparedEntries.filter(entry => {
      const itemId = entry.prepared.itemId;
      return itemId <= lastProcessedId && existingMap.has(itemId);
    });

    for (const entry of existingEntries) {
      const { item, prepared } = entry;
      const itemId = prepared.itemId;
      const result = await relayUpdatedItem(
        item,
        prepared,
        existingMap.get(itemId),
        fingerprintMap,
        config,
        store
      );

      if (result?.record) {
        existingMap.set(itemId, result.record);
        if (result.record.relay_status !== 'deduped') {
          fingerprintMap.set(prepared.normalizedSourceFingerprint, result.record);
        }
      }

      if (result?.action === 'created') {
        createdCount += 1;
      } else if (result?.action === 'updated') {
        updatedCount += 1;
      } else {
        skippedCount += 1;
      }
    }

    prunedCount = await store.pruneRelayItemsLastSeenBefore(
      createRetentionCutoffIso(config.relayItemRetentionDays)
    );

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
      deduplicatedCount,
      prunedCount,
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
      deduplicatedCount,
      prunedCount,
      latestSeenId,
      lastProcessedId,
      errorMessage: error instanceof Error ? error.message : String(error)
    });

    if (lockAcquired) {
      await store.setLastRunSummary(summary);
    }

    throw error;
  } finally {
    if (lockAcquired) {
      await store.releaseRunLock(runId);
    }
  }
}
