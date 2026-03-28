const DEFAULT_SERVICE_NAME = 'sina7x24-discord-relay';
const DEFAULT_SINA_ORIGIN = 'https://zhibo.sina.com.cn';
const DEFAULT_ZHIBO_ID = 152;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES_PER_RUN = 3;
const DEFAULT_FEED_TYPE = 0;
const DEFAULT_FEED_TAG_ID = 0;
const DEFAULT_DISCORD_USERNAME = '新浪财经7x24';

function readTrimmedString(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
}

function readInteger(value, fallback, { min = Number.MIN_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }

  return parsed;
}

function readBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

export function readRuntimeConfig(env) {
  return {
    serviceName: DEFAULT_SERVICE_NAME,
    sinaOrigin: readTrimmedString(env.SINA_ORIGIN, DEFAULT_SINA_ORIGIN),
    zhiboId: readInteger(env.SINA_ZHIBO_ID, DEFAULT_ZHIBO_ID, { min: 1 }),
    pageSize: readInteger(env.SINA_PAGE_SIZE, DEFAULT_PAGE_SIZE, { min: 1 }),
    maxPagesPerRun: readInteger(env.MAX_PAGES_PER_RUN, DEFAULT_MAX_PAGES_PER_RUN, { min: 1 }),
    feedType: readInteger(env.SINA_FEED_TYPE, DEFAULT_FEED_TYPE, { min: 0 }),
    feedTagId: readInteger(env.SINA_TAG_ID, DEFAULT_FEED_TAG_ID, { min: 0 }),
    discordUsername: readTrimmedString(env.DISCORD_USERNAME, DEFAULT_DISCORD_USERNAME),
    discordWebhookUrl: readTrimmedString(env.DISCORD_WEBHOOK_URL),
    adminApiToken: readTrimmedString(env.ADMIN_API_TOKEN),
    allowUnauthenticatedAdmin: readBoolean(env.ALLOW_UNAUTHENTICATED_ADMIN, false)
  };
}

export function ensureRelayRuntimeReady(env, config) {
  if (!env.DB || typeof env.DB.prepare !== 'function') {
    throw new Error('missing_d1_binding');
  }

  if (!config.discordWebhookUrl) {
    throw new Error('missing_discord_webhook_url_secret');
  }
}
