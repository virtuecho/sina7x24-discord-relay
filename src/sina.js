import { fetchWithTimeout, HttpError, isAbortError } from './http.js';
import { randomInteger, sleep, sortFeedItemsByIdDesc } from './utils.js';

const SINA_FEED_PATH = '/api/zhibo/feed';
const FETCH_TIMEOUT_MS = 10000;
const BROWSER_USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15'
];

function createCacheBustToken() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function choosePageSize(config) {
  const jitter = Math.max(0, Number(config.pageSizeJitter || 0));
  return Math.max(1, config.pageSize + randomInteger(0, jitter));
}

function chooseBrowserUserAgent() {
  return BROWSER_USER_AGENTS[randomInteger(0, BROWSER_USER_AGENTS.length - 1)];
}

export function buildSinaFeedUrl(config, { page = 1, pageSize = config.pageSize, requestToken = '' } = {}) {
  const targetUrl = new URL(SINA_FEED_PATH, config.sinaOrigin);
  targetUrl.searchParams.set('zhibo_id', String(config.zhiboId));
  targetUrl.searchParams.set('id', '');
  targetUrl.searchParams.set('tag_id', String(config.feedTagId));
  targetUrl.searchParams.set('page_size', String(pageSize));
  targetUrl.searchParams.set('type', String(config.feedType));
  targetUrl.searchParams.set('page', String(page));
  targetUrl.searchParams.set('_t', String(Date.now()));
  targetUrl.searchParams.set('_r', requestToken || createCacheBustToken());
  return targetUrl;
}

function extractFeedItems(payload) {
  const items = payload?.result?.data?.feed?.list;
  return Array.isArray(items) ? items : [];
}

export async function fetchFeedPage(config, { page = 1, pageSize = config.pageSize, userAgent = chooseBrowserUserAgent() } = {}) {
  const url = buildSinaFeedUrl(config, {
    page,
    pageSize,
    requestToken: createCacheBustToken()
  });

  let upstreamResponse;
  try {
    upstreamResponse = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        cache: 'no-store',
        headers: {
          accept: 'application/json, text/plain, */*',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'cache-control': 'no-cache, no-store, max-age=0',
          origin: config.sinaOrigin,
          pragma: 'no-cache',
          referer: `${config.sinaOrigin}/`,
          'user-agent': userAgent
        }
      },
      FETCH_TIMEOUT_MS
    );
  } catch (error) {
    throw new HttpError(
      isAbortError(error) ? 504 : 502,
      isAbortError(error) ? 'sina_proxy_timeout' : 'sina_proxy_error',
      isAbortError(error) ? '请求新浪接口超时' : '请求新浪接口失败',
      error instanceof Error ? error.message : String(error)
    );
  }

  if (!upstreamResponse.ok) {
    throw new HttpError(
      upstreamResponse.status,
      'sina_upstream_http_error',
      `新浪接口返回 HTTP ${upstreamResponse.status}`
    );
  }

  let payload;
  try {
    payload = await upstreamResponse.json();
  } catch (error) {
    throw new HttpError(
      502,
      'sina_invalid_json',
      '新浪接口返回了无法解析的 JSON',
      error instanceof Error ? error.message : String(error)
    );
  }

  const items = sortFeedItemsByIdDesc(extractFeedItems(payload));

  return {
    page,
    items,
    pageInfo: payload?.result?.data?.feed?.page_info || null
  };
}

export async function fetchRecentFeedItems(config) {
  const dedupedItems = new Map();
  const pageSize = choosePageSize(config);
  const userAgent = chooseBrowserUserAgent();

  for (let page = 1; page <= config.maxPagesPerRun; page += 1) {
    const { items } = await fetchFeedPage(config, {
      page,
      pageSize,
      userAgent
    });

    if (items.length === 0) {
      break;
    }

    items.forEach(item => {
      const key = String(item?.id ?? '');
      if (key && !dedupedItems.has(key)) {
        dedupedItems.set(key, item);
      }
    });

    if (items.length < pageSize) {
      break;
    }

    if (page < config.maxPagesPerRun && config.sinaRequestDelayMaxMs > 0) {
      await sleep(randomInteger(150, Math.max(150, config.sinaRequestDelayMaxMs)));
    }
  }

  return sortFeedItemsByIdDesc([...dedupedItems.values()]);
}
