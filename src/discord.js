import { fetchWithTimeout, HttpError, isAbortError } from './http.js';

const DISCORD_TIMEOUT_MS = 15000;
const MAX_RATE_LIMIT_RETRIES = 4;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function parseWebhookUrl(rawUrl) {
  let url;

  try {
    url = new URL(rawUrl);
  } catch (_error) {
    throw new HttpError(400, 'invalid_discord_webhook_url', 'Discord Webhook URL 格式无效');
  }

  if (url.protocol !== 'https:') {
    throw new HttpError(400, 'invalid_discord_webhook_protocol', 'Discord Webhook URL 必须使用 HTTPS');
  }

  const isAllowedHost = url.hostname === 'discord.com'
    || url.hostname.endsWith('.discord.com')
    || url.hostname === 'discordapp.com'
    || url.hostname.endsWith('.discordapp.com');

  if (!isAllowedHost) {
    throw new HttpError(403, 'discord_host_not_allowed', 'Discord Webhook 域名不在允许范围内');
  }

  if (!/^\/api\/webhooks\/\d+\/[^/]+\/?$/.test(url.pathname)) {
    throw new HttpError(400, 'invalid_discord_webhook_path', 'Discord Webhook 路径格式无效');
  }

  return url;
}

function createMessageUrl(rawWebhookUrl, messageId = '') {
  const url = parseWebhookUrl(rawWebhookUrl);

  if (!messageId) {
    url.searchParams.set('wait', 'true');
    return url;
  }

  if (!/^\d+$/.test(String(messageId))) {
    throw new HttpError(400, 'invalid_discord_message_id', 'Discord 消息 ID 格式无效');
  }

  const basePathMatch = url.pathname.match(/^(\/api\/webhooks\/\d+\/[^/]+)\/?$/);
  if (!basePathMatch) {
    throw new HttpError(400, 'invalid_discord_webhook_path', 'Discord Webhook 路径格式无效');
  }

  url.pathname = `${basePathMatch[1]}/messages/${messageId}`;
  url.search = '';
  return url;
}

async function readDiscordResponse(upstreamResponse) {
  const rawText = await upstreamResponse.text();

  if (!rawText) {
    return null;
  }

  try {
    return JSON.parse(rawText);
  } catch (_error) {
    return rawText;
  }
}

async function requestDiscord(url, init) {
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    let upstreamResponse;

    try {
      upstreamResponse = await fetchWithTimeout(
        url,
        {
          ...init,
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'user-agent': 'sina7x24-discord-relay/1.0',
            ...(init.headers || {})
          }
        },
        DISCORD_TIMEOUT_MS
      );
    } catch (error) {
      throw new HttpError(
        isAbortError(error) ? 504 : 502,
        isAbortError(error) ? 'discord_webhook_timeout' : 'discord_webhook_proxy_error',
        isAbortError(error) ? 'Discord Webhook 请求超时' : 'Discord Webhook 请求失败',
        error instanceof Error ? error.message : String(error)
      );
    }

    const payload = await readDiscordResponse(upstreamResponse);

    if (!upstreamResponse.ok) {
      if (upstreamResponse.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        const retryAfterSeconds = Number(
          payload?.retry_after
          ?? upstreamResponse.headers.get('retry-after')
          ?? upstreamResponse.headers.get('x-ratelimit-reset-after')
        );
        const retryAfterMs = Number.isFinite(retryAfterSeconds)
          ? Math.max(250, Math.ceil(retryAfterSeconds * 1000))
          : 1500;

        await sleep(retryAfterMs);
        continue;
      }

      throw new HttpError(
        upstreamResponse.status,
        'discord_webhook_upstream_error',
        payload?.message || `Discord Webhook 返回 HTTP ${upstreamResponse.status}`,
        payload
      );
    }

    return payload && typeof payload === 'object' ? payload : {};
  }

  throw new HttpError(429, 'discord_webhook_upstream_error', 'Discord Webhook 达到速率限制');
}

export async function sendDiscordMessage({ webhookUrl, content, username = '' }) {
  if (!content || typeof content !== 'string' || content.trim() === '') {
    throw new HttpError(400, 'missing_discord_content', '缺少要发送的 Discord 消息内容');
  }

  if (content.length > 2000) {
    throw new HttpError(400, 'discord_content_too_long', 'Discord 消息内容不能超过 2000 个字符');
  }

  if (username && username.length > 80) {
    throw new HttpError(400, 'discord_username_too_long', 'Discord 用户名不能超过 80 个字符');
  }

  const targetUrl = createMessageUrl(webhookUrl);
  const payload = {
    content
  };

  if (username) {
    payload.username = username;
  }

  const response = await requestDiscord(targetUrl, {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  return {
    messageId: String(response.id || ''),
    channelId: String(response.channel_id || ''),
    timestamp: String(response.timestamp || '')
  };
}

export async function updateDiscordMessage({ webhookUrl, messageId, content }) {
  if (!content || typeof content !== 'string' || content.trim() === '') {
    throw new HttpError(400, 'missing_discord_content', '缺少要发送的 Discord 消息内容');
  }

  if (content.length > 2000) {
    throw new HttpError(400, 'discord_content_too_long', 'Discord 消息内容不能超过 2000 个字符');
  }

  const targetUrl = createMessageUrl(webhookUrl, messageId);
  const response = await requestDiscord(targetUrl, {
    method: 'PATCH',
    body: JSON.stringify({ content })
  });

  return {
    messageId: String(response.id || messageId || ''),
    channelId: String(response.channel_id || ''),
    timestamp: String(response.timestamp || '')
  };
}
