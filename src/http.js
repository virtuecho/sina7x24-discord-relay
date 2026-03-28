export class HttpError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function createJsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      ...extraHeaders
    }
  });
}

export function createMethodNotAllowedResponse(allowedMethods) {
  return createJsonResponse(
    {
      ok: false,
      error: 'method_not_allowed',
      message: '请求方法不受支持'
    },
    405,
    {
      allow: allowedMethods.join(', ')
    }
  );
}

export function createNotFoundResponse() {
  return createJsonResponse(
    {
      ok: false,
      error: 'not_found',
      message: '请求路径不存在'
    },
    404
  );
}

export function createErrorResponse(error) {
  if (error instanceof HttpError) {
    return createJsonResponse(
      {
        ok: false,
        error: error.code,
        message: error.message,
        details: error.details
      },
      error.status
    );
  }

  let mappedError = error;

  if (mappedError instanceof Error) {
    if (mappedError.message === 'missing_d1_binding') {
      mappedError = new HttpError(503, 'missing_d1_binding', '未配置 D1 数据库绑定');
    } else if (mappedError.message === 'missing_discord_webhook_url_secret') {
      mappedError = new HttpError(503, 'missing_discord_webhook_url_secret', '未配置 Discord Webhook Secret');
    }
  }

  if (mappedError instanceof HttpError) {
    return createErrorResponse(mappedError);
  }

  console.error('Unhandled worker error:', error);

  return createJsonResponse(
    {
      ok: false,
      error: 'internal_error',
      message: '服务内部错误',
      details: error instanceof Error ? error.message : String(error)
    },
    500
  );
}

export async function fetchWithTimeout(resource, init = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort('request_timeout'), timeoutMs);

  try {
    return await fetch(resource, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export function isAbortError(error) {
  return Boolean(error) && (error.name === 'AbortError' || error === 'request_timeout');
}

function getBearerToken(request) {
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

export function assertAdminAuthorized(request, config) {
  if (config.adminApiToken) {
    const incomingToken = getBearerToken(request);
    if (incomingToken && incomingToken === config.adminApiToken) {
      return;
    }

    throw new HttpError(401, 'unauthorized', '缺少有效的管理员令牌');
  }

  if (config.allowUnauthenticatedAdmin) {
    return;
  }

  throw new HttpError(503, 'admin_api_not_configured', '管理员令牌未配置，且未启用本地免鉴权模式');
}
