const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const cookieJar = new Map();

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (cookieJar.size) {
    headers.set('Cookie', [...cookieJar.entries()].map(([key, value]) => `${key}=${value}`).join('; '));
  }
  const res = await fetch(`${baseUrl}${path}`, { ...options, headers, redirect: 'manual' });
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
  for (const rawCookie of setCookies) {
    const first = String(rawCookie || '').split(';')[0] || '';
    const index = first.indexOf('=');
    if (index <= 0) continue;
    const key = first.slice(0, index).trim();
    const value = first.slice(index + 1).trim();
    if (value) cookieJar.set(key, value);
    else cookieJar.delete(key);
  }
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch {}
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    data,
  };
}

const email = process.env.DEBUG_ADMIN_EMAIL || 'debug_admin_login@example.com';
const password = process.env.DEBUG_ADMIN_PASSWORD || 'Pass1234!';

const result = {
  login: await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }),
  me: await request('/api/auth/me'),
  secureAdmin: await request('/secure-admin'),
  cookies: Object.fromEntries(cookieJar),
};

console.log(JSON.stringify(result, null, 2));
