export function getNumericItemId(item) {
  const parsed = Number(item?.id);
  return Number.isFinite(parsed) ? parsed : null;
}

export function sortFeedItemsByIdDesc(items) {
  return [...items].sort((left, right) => {
    const leftId = getNumericItemId(left) ?? Number.NEGATIVE_INFINITY;
    const rightId = getNumericItemId(right) ?? Number.NEGATIVE_INFINITY;
    return rightId - leftId;
  });
}

export function parseApiTime(timeString) {
  if (typeof timeString !== 'string' || timeString.trim() === '') {
    return null;
  }

  const match = timeString.trim().match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})$/
  );

  if (!match) {
    const fallback = new Date(timeString);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute, second));
}

export function formatApiTime(timeString) {
  try {
    const date = parseApiTime(timeString);
    if (!date) {
      return timeString;
    }

    return date.toLocaleString('zh-CN', {
      hour12: false,
      timeZone: 'Asia/Shanghai'
    });
  } catch (_error) {
    return timeString;
  }
}

export function extractHeadlineParts(text) {
  if (typeof text !== 'string') {
    return { title: '', body: '' };
  }

  const trimmedText = text.trim();
  const match = trimmedText.match(/^【([^】]+)】\s*[-—–:：]?\s*([\s\S]*)$/u);

  if (!match) {
    return { title: '', body: trimmedText };
  }

  return {
    title: match[1].trim(),
    body: match[2].trim()
  };
}

export function extractTrailingSource(text) {
  if (typeof text !== 'string') {
    return { body: '', source: '' };
  }

  const trimmedText = text.trim();
  if (!trimmedText.endsWith('）') && !trimmedText.endsWith(')')) {
    return { body: trimmedText, source: '' };
  }

  const match = trimmedText.match(/^([\s\S]*?)(?:\s*[（(]([^\n]{1,24})[）)])$/u);
  if (!match) {
    return { body: trimmedText, source: '' };
  }

  const source = match[2].trim();
  if (!source) {
    return { body: trimmedText, source: '' };
  }

  return {
    body: match[1].trim(),
    source
  };
}

export function getDocUrl(item) {
  const rawDocUrl = typeof item?.docurl === 'string' ? item.docurl.trim() : '';
  if (!rawDocUrl) {
    return '';
  }

  return rawDocUrl
    .replace('//finance.sina.cn', '//finance.sina.com.cn')
    .replace('/detail-', '/doc-')
    .replace('.d.html', '.shtml');
}

export function getTagNames(item) {
  if (!Array.isArray(item?.tag)) {
    return [];
  }

  return item.tag
    .map(tag => String(tag?.name || '').trim())
    .filter(Boolean);
}

export function isFocusItem(item) {
  if (!Array.isArray(item?.tag)) {
    return false;
  }

  return item.tag.some(tag => {
    const id = String(tag?.id ?? '').trim();
    const name = String(tag?.name ?? '').trim();
    return id === '9' || name === '焦点';
  });
}

export function truncateText(text, limit = 2000) {
  if (typeof text !== 'string') {
    return '';
  }

  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(typeof text === 'string' ? text : '')
  );

  return [...new Uint8Array(digest)]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('');
}
