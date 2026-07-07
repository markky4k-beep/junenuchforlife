import '../env.js';
import crypto from 'crypto';
import { createUser, deleteUser, deleteStoreCascade } from '../db.js';
import { hashPassword } from '../auth.js';

const BASE_URL = String(process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const BASE_ORIGIN = new URL(BASE_URL);
const TEST_PREFIX = `tenant-auth-${Date.now().toString(36)}`;

function assert(condition, message, payload) {
  if (!condition) {
    const error = new Error(message);
    error.payload = payload;
    throw error;
  }
}

function isLocalOrigin(origin) {
  return /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])$/i.test(String(origin?.hostname || '').trim());
}

function requestOriginForHost(host = '') {
  const normalizedHost = String(host || '').trim().toLowerCase();
  if (!normalizedHost || isLocalOrigin(BASE_ORIGIN)) return BASE_ORIGIN;
  const nextOrigin = new URL(BASE_ORIGIN.toString());
  nextOrigin.host = normalizedHost;
  return nextOrigin;
}

class ApiClient {
  constructor() {
    this.cookies = new Map();
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
  }

  csrfToken() {
    return this.cookies.get('__Host-nfl_csrf') || this.cookies.get('nfl_csrf') || '';
  }

  hasSessionCookie() {
    return this.cookies.has('__Host-nfl_session') || this.cookies.has('nfl_session');
  }

  storeSetCookies(res) {
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
      if (value) this.cookies.set(key, value);
      else this.cookies.delete(key);
    }
  }

  async request(path, { method = 'GET', body, headers = {}, host = '', storeId = '' } = {}) {
    const nextHeaders = { ...headers };
    const upperMethod = String(method || 'GET').toUpperCase();
    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(upperMethod);
    const targetOrigin = requestOriginForHost(host);
    if (body !== undefined && !nextHeaders['Content-Type']) nextHeaders['Content-Type'] = 'application/json';
    const cookieHeader = this.cookieHeader();
    if (cookieHeader) nextHeaders.Cookie = cookieHeader;
    if (host && targetOrigin.host === BASE_ORIGIN.host) {
      nextHeaders['x-forwarded-host'] = host;
      if (!nextHeaders['x-forwarded-proto']) nextHeaders['x-forwarded-proto'] = BASE_ORIGIN.protocol.replace(':', '');
    }
    if (storeId) nextHeaders['x-store-id'] = storeId;
    if (isWrite && this.hasSessionCookie() && !nextHeaders['x-csrf-token']) {
      const csrfToken = this.csrfToken();
      if (csrfToken) nextHeaders['x-csrf-token'] = csrfToken;
    }
    const requestUrl = `${targetOrigin.toString().replace(/\/+$/, '')}${path}`;
    const res = await fetch(requestUrl, {
      method: upperMethod,
      headers: nextHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    this.storeSetCookies(res);
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) {
      const error = new Error(data?.error || `${upperMethod} ${path} failed with ${res.status}`);
      error.status = res.status;
      error.payload = data;
      throw error;
    }
    return data;
  }
}

async function main() {
  const cleanup = { userIds: new Set(), storeIds: new Set() };
  const globalAdminEmail = `${TEST_PREFIX}-root@example.com`;
  const globalAdminPassword = 'RootPass123!';
  const { salt, hash } = hashPassword(globalAdminPassword);
  const globalAdmin = await createUser({
    id: `u_${crypto.randomBytes(6).toString('hex')}`,
    email: globalAdminEmail,
    name: 'Tenant Bound Root Admin',
    username: 'Tenant Bound Root Admin',
    salt,
    hash,
    role: 'admin',
    bound_store_id: '',
  });
  cleanup.userIds.add(globalAdmin.id);

  try {
    const rootClient = new ApiClient();
    const login = await rootClient.request('/api/auth/login', {
      method: 'POST',
      body: { email: globalAdminEmail, password: globalAdminPassword },
    });
    assert(login?.user?.role === 'admin', 'seed_global_admin_login_failed', login);

    const firstSubdomain = `${TEST_PREFIX}-a`.slice(0, 32).replace(/-+$/, '');
    const secondSubdomain = `${TEST_PREFIX}-b`.slice(0, 32).replace(/-+$/, '');
    const tenantAdminPassword = 'TenantPass123!';
    const firstAdminEmail = `${firstSubdomain}-admin@example.com`;
    const secondAdminEmail = `${secondSubdomain}-admin@example.com`;

    const firstCreate = await rootClient.request('/api/admin/stores', {
      method: 'POST',
      body: {
        name: `Store ${firstSubdomain}`,
        subdomain: firstSubdomain,
        templateKey: 'blank',
        adminName: 'First Tenant Admin',
        adminEmail: firstAdminEmail,
        adminPassword: tenantAdminPassword,
      },
    });
    assert(firstCreate?.store?.id, 'first_store_create_failed', firstCreate);
    assert(firstCreate?.tenantAdmin?.email === firstAdminEmail, 'first_tenant_admin_missing', firstCreate);
    assert(firstCreate?.tenantAdmin?.boundStoreId === firstCreate.store.id, 'first_tenant_admin_not_bound', firstCreate);
    cleanup.storeIds.add(firstCreate.store.id);
    cleanup.userIds.add(firstCreate.tenantAdmin.id);

    const secondCreate = await rootClient.request('/api/admin/stores', {
      method: 'POST',
      body: {
        name: `Store ${secondSubdomain}`,
        subdomain: secondSubdomain,
        templateKey: 'blank',
        adminName: 'Second Tenant Admin',
        adminEmail: secondAdminEmail,
        adminPassword: tenantAdminPassword,
      },
    });
    assert(secondCreate?.store?.id, 'second_store_create_failed', secondCreate);
    cleanup.storeIds.add(secondCreate.store.id);
    cleanup.userIds.add(secondCreate.tenantAdmin.id);

    const firstStoreHost = new URL(firstCreate.store.publicUrl).host;
    const secondStoreHost = new URL(secondCreate.store.publicUrl).host;

    const tenantAdminClient = new ApiClient();
    const tenantLogin = await tenantAdminClient.request('/api/auth/login', {
      method: 'POST',
      host: firstStoreHost,
      body: { email: firstAdminEmail, password: tenantAdminPassword },
    });
    assert(tenantLogin?.user?.email === firstAdminEmail, 'tenant_admin_login_on_own_host_failed', tenantLogin);
    assert(tenantLogin?.user?.boundStoreId === firstCreate.store.id, 'tenant_admin_login_bound_store_missing', tenantLogin);
    const tenantMe = await tenantAdminClient.request('/api/auth/me', { host: firstStoreHost });
    assert(Array.isArray(tenantMe?.user?.storeRoles) && tenantMe.user.storeRoles.some((role) => role.storeId === firstCreate.store.id && role.role === 'admin'), 'tenant_admin_store_role_missing', tenantMe);

    await new ApiClient().request('/api/auth/login', {
      method: 'POST',
      body: { email: firstAdminEmail, password: tenantAdminPassword },
    }).then((payload) => assert(false, 'tenant_admin_should_not_login_on_main', payload))
      .catch((error) => assert(error.status === 403, 'tenant_admin_main_expected_403', { status: error.status, payload: error.payload }));

    await new ApiClient().request('/api/auth/login', {
      method: 'POST',
      host: secondStoreHost,
      body: { email: firstAdminEmail, password: tenantAdminPassword },
    }).then((payload) => assert(false, 'tenant_admin_should_not_login_on_other_store', payload))
      .catch((error) => assert(error.status === 403, 'tenant_admin_other_store_expected_403', { status: error.status, payload: error.payload }));

    const customerEmail = `${firstSubdomain}-customer@example.com`;
    const customerPassword = 'CustomerPass123!';
    const customerClient = new ApiClient();
    const customerRegister = await customerClient.request('/api/auth/register', {
      method: 'POST',
      host: firstStoreHost,
      body: { email: customerEmail, password: customerPassword, name: 'Tenant Customer' },
    });
    assert(customerRegister?.user?.email === customerEmail, 'tenant_customer_register_failed', customerRegister);
    assert(customerRegister?.user?.boundStoreId === firstCreate.store.id, 'tenant_customer_bound_store_missing', customerRegister);
    cleanup.userIds.add(customerRegister.user.id);

    await new ApiClient().request('/api/auth/login', {
      method: 'POST',
      host: secondStoreHost,
      body: { email: customerEmail, password: customerPassword },
    }).then((payload) => assert(false, 'tenant_customer_should_not_login_on_other_store', payload))
      .catch((error) => assert(error.status === 403, 'tenant_customer_other_store_expected_403', { status: error.status, payload: error.payload }));

    await new ApiClient().request('/api/auth/login', {
      method: 'POST',
      body: { email: customerEmail, password: customerPassword },
    }).then((payload) => assert(false, 'tenant_customer_should_not_login_on_main', payload))
      .catch((error) => assert(error.status === 403, 'tenant_customer_main_expected_403', { status: error.status, payload: error.payload }));

    console.log(JSON.stringify({
      ok: true,
      baseUrl: BASE_URL,
      firstStoreId: firstCreate.store.id,
      secondStoreId: secondCreate.store.id,
      firstStoreHost,
      secondStoreHost,
      tenantAdminEmail: firstAdminEmail,
      customerEmail,
    }, null, 2));
  } finally {
    for (const storeId of cleanup.storeIds) {
      await deleteStoreCascade(storeId).catch(() => {});
    }
    for (const userId of cleanup.userIds) {
      await deleteUser(userId).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    baseUrl: BASE_URL,
    error: error?.message || String(error),
    payload: error?.payload || null,
  }, null, 2));
  process.exit(1);
});
