import { fetchWithTimeout, HttpError, isAbortError } from './http.js';
import { sortFeedItemsByIdDesc } from './utils.js';

const SINA_FEED_PATH = '/api/zhibo/feed';
const FETCH_TIMEOUT_MS = 10000;

export function buildSinaFeedUrl(config, { page = 1 } = {}) {
  const targetUrl = new URL(SINA_FEED_PATH, config.sinaOrigin);
  targetUrl.searchParams.set('zhibo_id', String(config.zhiboId));
  targetUrl.searchParams.set('id', '');
  targetUrl.searchParams.set('tag_id', String(config.feedTagId));
  targetUrl.searchParams.set('page_size', String(config.pageSize));
  targetUrl.searchParams.set('type', String(config.feedType));
  targetUrl.searchParams.set('page', String(page));
  return targetUrl;
}

function extractFeedItems(payload) {
  const items = payload?.result?.data?.feed?.list;
  return Array.isArray(items) ? items : [];
}

export async function fetchFeedPage(config, { page = 1 } = {}) {
  const url = buildSinaFeedUrl(config, { page });

  let upstreamResponse;
  try {
    upstreamResponse = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: {
          accept: 'application/json, text/plain, */*',
          origin: config.sinaOrigin,
          referer: `${config.sinaOrigin}/`,
          'user-agent': 'sina7x24-discord-relay/1.0'
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

  for (let page = 1; page <= config.maxPagesPerRun; page += 1) {
    const { items } = await fetchFeedPage(config, { page });

    if (items.length === 0) {
      break;
    }

    items.forEach(item => {
      const key = String(item?.id ?? '');
      if (key && !dedupedItems.has(key)) {
        dedupedItems.set(key, item);
      }
    });

    if (items.length < config.pageSize) {
      break;
    }
  }

  return sortFeedItemsByIdDesc([...dedupedItems.values()]);
}
