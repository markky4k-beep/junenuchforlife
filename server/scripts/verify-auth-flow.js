const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const cookieJar = new Map();

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (cookieJar.size) {
    headers.set('Cookie', [...cookieJar.entries()].map(([key, value]) => `${key}=${value}`).join('; '));
  }
  const res = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
  for (const rawCookie of setCookies) {
    const first = String(rawCookie || '').split(';')[0] || '';
    const index = first.indexOf('=');
    if (index <= 0) continue;
    const key = first.slice(0, index).trim();
    const value = first.slice(index + 1).trim();
    if (!key) continue;
    if (value) cookieJar.set(key, value);
    else cookieJar.delete(key);
  }
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function assert(condition, message, payload) {
  if (!condition) {
    const error = new Error(message);
    error.payload = payload;
    throw error;
  }
}

async function main() {
  const stamp = Date.now();
  const email = `authtest_${stamp}@example.com`;
  const password = 'Pass1234';
  const name = 'Auth Test';

  const register = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  assert(register.status === 200, 'register_failed', register);
  assert(register.data?.user?.email === email, 'register_missing_user', register);

  const meAfterRegister = await request('/api/auth/me');
  assert(meAfterRegister.status === 200, 'me_after_register_failed', meAfterRegister);
  assert(meAfterRegister.data?.user?.email === email, 'me_after_register_wrong_user', meAfterRegister);

  const duplicateRegister = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  assert(duplicateRegister.status === 409, 'duplicate_register_unexpected', duplicateRegister);

  const badLogin = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'wrongpass' }),
  });
  assert(badLogin.status === 401, 'bad_login_unexpected', badLogin);

  const login = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert(login.status === 200, 'login_failed', login);

  const meAfterLogin = await request('/api/auth/me');
  assert(meAfterLogin.status === 200, 'me_after_login_failed', meAfterLogin);
  assert(meAfterLogin.data?.user?.email === email, 'me_after_login_wrong_user', meAfterLogin);

  const logout = await request('/api/auth/logout', { method: 'POST' });
  assert(logout.status === 200, 'logout_failed', logout);
  assert(logout.data?.ok === true, 'logout_missing_ok', logout);

  const meAfterLogout = await request('/api/auth/me');

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    email,
    checks: {
      register: register.status,
      meAfterRegister: meAfterRegister.status,
      duplicateRegister: duplicateRegister.status,
      badLogin: badLogin.status,
      login: login.status,
      meAfterLogin: meAfterLogin.status,
      logout: logout.status,
      meAfterLogout: {
        status: meAfterLogout.status,
        body: meAfterLogout.data,
      },
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    baseUrl,
    error: error?.message || String(error),
    payload: error?.payload || null,
  }, null, 2));
  process.exit(1);
});
