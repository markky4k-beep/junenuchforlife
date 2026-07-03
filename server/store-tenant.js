import crypto from 'crypto';

export const RESERVED_STORE_SUBDOMAINS = new Set([
  'www',
  'admin',
  'api',
  'app',
  'mail',
  'secure-admin',
  'static',
  'assets',
  'cdn',
  'status',
  'help',
  'support',
  'blog',
  'docs',
]);

export function normalizeHostName(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}

export function extractRequestHost(req = {}) {
  const forwarded = String(req.headers?.['x-forwarded-host'] || '').split(',')[0];
  return normalizeHostName(forwarded || req.get?.('host') || req.headers?.host || '');
}

export function normalizeRequestedSubdomain(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

export function slugifyStoreName(value = '') {
  return normalizeRequestedSubdomain(
    String(value || '')
      .trim()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, ' ')
      .replace(/\s+/g, '-'),
  );
}

export function isReservedStoreSubdomain(value = '') {
  return RESERVED_STORE_SUBDOMAINS.has(normalizeRequestedSubdomain(value));
}

export function isValidStoreSubdomain(value = '') {
  const normalized = normalizeRequestedSubdomain(value);
  return Boolean(normalized) && /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/.test(normalized) && !isReservedStoreSubdomain(normalized);
}

export function buildStoreId(subdomain = '') {
  const seed = normalizeRequestedSubdomain(subdomain) || `store-${crypto.randomBytes(4).toString('hex')}`;
  return `store_${seed}`;
}

export function rootDomainFromPublicUrl(publicUrl = '', fallbackHost = '') {
  const normalizedFallback = normalizeHostName(fallbackHost);
  const rawUrl = String(publicUrl || '').trim();
  if (rawUrl) {
    try {
      const url = new URL(rawUrl);
      const host = normalizeHostName(url.hostname);
      const parts = host.split('.').filter(Boolean);
      if (parts.length >= 2) return parts.slice(-2).join('.');
      if (host) return host;
    } catch {}
  }
  if (normalizedFallback) {
    const parts = normalizedFallback.split('.').filter(Boolean);
    if (parts.length >= 2) return parts.slice(-2).join('.');
    return normalizedFallback;
  }
  return '';
}

export function buildStorePublicUrl({ subdomain = '', rootDomain = '', protocol = 'https', port = '' } = {}) {
  const normalizedSubdomain = normalizeRequestedSubdomain(subdomain);
  const normalizedRoot = normalizeHostName(rootDomain);
  if (!normalizedSubdomain || !normalizedRoot) return '';
  const portPart = port ? `:${port}` : '';
  return `${protocol}://${normalizedSubdomain}.${normalizedRoot}${portPart}`;
}

export function buildStoreBootstrapSettings({ storeName = '', publicUrl = '' } = {}) {
  const name = String(storeName || '').trim();
  return {
    SITE_NAME: name,
    PUBLIC_URL: String(publicUrl || '').trim(),
    SITE_HERO_TITLE: name ? `${name} ออนไลน์` : '',
    SITE_HERO_SUB: name ? `หน้าร้านสำหรับ ${name} พร้อมระบบจัดการสินค้า ออเดอร์ และแชตในดีไซน์เดียวกับระบบหลัก` : '',
  };
}
