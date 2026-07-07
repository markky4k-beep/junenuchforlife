import '../env.js';

function assert(condition, message, payload) {
  if (!condition) {
    const error = new Error(message);
    error.payload = payload;
    throw error;
  }
}

const BASE_URL = String(process.env.BASE_URL || process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/+$/, '');
const BASE_ORIGIN = new URL(BASE_URL);
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || process.env.ADMIN_SEED_EMAIL || '').trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || process.env.ADMIN_SEED_PASSWORD || '').trim();
const ADMIN_KEY = String(process.env.ADMIN_KEY || process.env.ADMIN_ACCESS_KEY || '').trim();
const TEST_PREFIX = String(process.env.SMOKE_PREFIX || `smoke-${Date.now().toString(36)}`).toLowerCase();
const LOCAL_HOST_RE = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])$/i;
const DIRECT_HOST_RETRY_STATUSES = new Set([404, 421, 425, 429, 502, 503, 504]);

function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLocalOrigin(origin) {
  return LOCAL_HOST_RE.test(String(origin?.hostname || '').trim());
}

function requestOriginForHost(host = '') {
  const normalizedHost = String(host || '').trim().toLowerCase();
  if (!normalizedHost || isLocalOrigin(BASE_ORIGIN)) return BASE_ORIGIN;
  const nextOrigin = new URL(BASE_ORIGIN.toString());
  nextOrigin.host = normalizedHost;
  return nextOrigin;
}

function requestModeForHost(host = '') {
  return host && !isLocalOrigin(BASE_ORIGIN) ? 'direct-subdomain' : 'forwarded-host';
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
    const requestMode = requestModeForHost(host);
    if (body !== undefined && !nextHeaders['Content-Type']) nextHeaders['Content-Type'] = 'application/json';
    const cookieHeader = this.cookieHeader();
    if (cookieHeader) nextHeaders.Cookie = cookieHeader;
    if (host && targetOrigin.host === BASE_ORIGIN.host) {
      nextHeaders['x-forwarded-host'] = host;
      if (!nextHeaders['x-forwarded-proto']) nextHeaders['x-forwarded-proto'] = BASE_ORIGIN.protocol.replace(':', '');
    }
    if (storeId) nextHeaders['x-store-id'] = storeId;
    if (isWrite && this.hasSessionCookie() && !nextHeaders.Authorization && !nextHeaders['x-csrf-token'] && !nextHeaders['x-xsrf-token']) {
      const csrfToken = this.csrfToken();
      if (csrfToken) nextHeaders['x-csrf-token'] = csrfToken;
    }
    const requestUrl = `${targetOrigin.toString().replace(/\/+$/, '')}${path}`;
    const maxAttempts = requestMode === 'direct-subdomain' ? 5 : 1;
    let res;
    let lastFetchError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        res = await fetch(requestUrl, {
          method: upperMethod,
          headers: nextHeaders,
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: 'manual',
        });
        if (!DIRECT_HOST_RETRY_STATUSES.has(res.status) || attempt >= maxAttempts) break;
      } catch (error) {
        lastFetchError = error;
        if (attempt >= maxAttempts) throw error;
      }
      await sleep(attempt * 1200);
    }
    if (!res) {
      throw lastFetchError || new Error(`request_failed:${upperMethod}:${requestUrl}`);
    }
    this.storeSetCookies(res);
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) {
      const error = new Error(data?.error || `${method} ${path} failed with ${res.status}`);
      error.payload = data;
      error.status = res.status;
      error.requestUrl = requestUrl;
      error.requestMode = requestMode;
      throw error;
    }
    return data;
  }
}

async function main() {
  assert(ADMIN_EMAIL && ADMIN_PASSWORD, 'ADMIN_EMAIL/ADMIN_PASSWORD are required for multistore smoke');
  const api = new ApiClient();

  const meBefore = await api.request('/api/auth/me').catch(() => ({ user: null }));
  if (!meBefore.user) {
    await api.request('/api/auth/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, adminKey: ADMIN_KEY },
    });
  }
  const me = await api.request('/api/auth/me');
  assert(me?.user?.role === 'admin', 'admin_login_failed', me);

  const storeName = `Smoke Store ${TEST_PREFIX}`;
  const subdomain = TEST_PREFIX.replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || `smoke-${Date.now().toString(36)}`;
  const tenantAdminPassword = 'StorePass123!';
  const tenantAdminEmail = `${subdomain}-admin@example.com`;
  const createdStore = await api.request('/api/admin/stores', {
    method: 'POST',
    body: { name: storeName, subdomain, templateKey: 'agri', adminName: `${storeName} Admin`, adminEmail: tenantAdminEmail, adminPassword: tenantAdminPassword },
  });
  const store = createdStore.store || {};
  assert(store.id, 'store_create_failed', createdStore);
  assert(createdStore?.tenantAdmin?.email === tenantAdminEmail, 'tenant_admin_not_created', createdStore);
  assert(createdStore?.tenantAdmin?.boundStoreId === store.id, 'tenant_admin_not_bound_to_store', createdStore);
  const secondSubdomain = `${subdomain}-b`.slice(0, 32).replace(/-+$/, '') || `smoke-b-${Date.now().toString(36)}`;
  const secondTenantAdminEmail = `${secondSubdomain}-admin@example.com`;
  const secondStoreRes = await api.request('/api/admin/stores', {
    method: 'POST',
    body: { name: `${storeName} B`, subdomain: secondSubdomain, templateKey: 'blank', adminName: `${storeName} B Admin`, adminEmail: secondTenantAdminEmail, adminPassword: tenantAdminPassword },
  });
  const secondStore = secondStoreRes.store || {};
  assert(secondStore.id && secondStore.id !== store.id, 'second_store_create_failed', secondStoreRes);

  const storeHost = (() => {
    try { return new URL(store.publicUrl || '').host; } catch { return store.primaryDomain || ''; }
  })();
  const secondStoreHost = (() => {
    try { return new URL(secondStore.publicUrl || '').host; } catch { return secondStore.primaryDomain || ''; }
  })();
  assert(storeHost, 'store_host_missing', store);
  assert(secondStoreHost, 'second_store_host_missing', secondStore);
  const subStoreConsole = await api.request('/api/admin/stores', { host: storeHost });
  assert(subStoreConsole?.multistoreConsoleEnabled === false, 'substore_multistore_console_should_be_disabled', subStoreConsole);
  assert(Array.isArray(subStoreConsole?.stores) && subStoreConsole.stores.length === 1 && subStoreConsole.stores[0]?.id === store.id, 'substore_store_list_should_only_include_current_store', subStoreConsole);
  await api.request('/api/admin/users', { host: storeHost })
    .then((payload) => assert(false, 'substore_users_endpoint_should_404', payload))
    .catch((err) => assert(err.status === 404, 'substore_users_expected_404', { status: err.status, payload: err.payload }));
  await api.request(`/api/admin/stores/check-subdomain?subdomain=${encodeURIComponent(`${subdomain}-check`)}`, { host: storeHost })
    .then((payload) => assert(false, 'substore_check_subdomain_endpoint_should_404', payload))
    .catch((err) => assert(err.status === 404, 'substore_check_subdomain_expected_404', { status: err.status, payload: err.payload }));

  const tenantAdminClient = new ApiClient();
  const tenantAdminLogin = await tenantAdminClient.request('/api/auth/login', {
    method: 'POST',
    host: storeHost,
    body: { email: tenantAdminEmail, password: tenantAdminPassword },
  });
  assert(tenantAdminLogin?.user?.email === tenantAdminEmail, 'tenant_admin_login_failed', tenantAdminLogin);
  assert(tenantAdminLogin?.user?.boundStoreId === store.id, 'tenant_admin_bound_store_missing_in_login', tenantAdminLogin);
  const tenantAdminMe = await tenantAdminClient.request('/api/auth/me', { host: storeHost });
  assert(Array.isArray(tenantAdminMe?.user?.storeRoles) && tenantAdminMe.user.storeRoles.some((role) => role.storeId === store.id && role.role === 'admin'), 'tenant_admin_store_role_missing', tenantAdminMe);

  const tenantWrongMain = new ApiClient();
  await tenantWrongMain.request('/api/auth/login', {
    method: 'POST',
    body: { email: tenantAdminEmail, password: tenantAdminPassword },
  }).then((payload) => assert(false, 'tenant_admin_should_not_login_on_main_host', payload))
    .catch((err) => assert(err.status === 403, 'tenant_admin_main_host_expected_403', { status: err.status, payload: err.payload }));

  const tenantWrongStore = new ApiClient();
  await tenantWrongStore.request('/api/auth/login', {
    method: 'POST',
    host: secondStoreHost,
    body: { email: tenantAdminEmail, password: tenantAdminPassword },
  }).then((payload) => assert(false, 'tenant_admin_should_not_login_on_other_store', payload))
    .catch((err) => assert(err.status === 403, 'tenant_admin_other_store_expected_403', { status: err.status, payload: err.payload }));

  const customerClient = new ApiClient();
  const customerEmail = `${subdomain}-customer@example.com`;
  const customerPassword = 'CustomerPass123!';
  const customerRegister = await customerClient.request('/api/auth/register', {
    method: 'POST',
    host: storeHost,
    body: { email: customerEmail, password: customerPassword, name: 'Smoke Customer Bound' },
  });
  assert(customerRegister?.user?.email === customerEmail, 'tenant_customer_register_failed', customerRegister);
  assert(customerRegister?.user?.boundStoreId === store.id, 'tenant_customer_not_bound_to_store', customerRegister);

  const customerWrongStore = new ApiClient();
  await customerWrongStore.request('/api/auth/login', {
    method: 'POST',
    host: secondStoreHost,
    body: { email: customerEmail, password: customerPassword },
  }).then((payload) => assert(false, 'tenant_customer_should_not_login_on_other_store', payload))
    .catch((err) => assert(err.status === 403, 'tenant_customer_other_store_expected_403', { status: err.status, payload: err.payload }));

  const customerWrongMain = new ApiClient();
  await customerWrongMain.request('/api/auth/login', {
    method: 'POST',
    body: { email: customerEmail, password: customerPassword },
  }).then((payload) => assert(false, 'tenant_customer_should_not_login_on_main_host', payload))
    .catch((err) => assert(err.status === 403, 'tenant_customer_main_host_expected_403', { status: err.status, payload: err.payload }));

  const productId = `p_${TEST_PREFIX.replace(/-/g, '_')}`;
  const product = await api.request('/api/admin/products', {
    method: 'POST',
    storeId: store.id,
    body: {
      id: productId,
      name: `Smoke Product ${TEST_PREFIX}`,
      price: 129,
      stock: 5,
      active: true,
      short: 'Smoke test product',
      desc: 'Created by verify:multistore smoke test',
    },
  });
  assert(product?.product?.id === productId, 'product_create_failed', product);

  const products = await api.request('/api/products', { host: storeHost });
  assert(Array.isArray(products) && products.some((item) => item.id === productId), 'public_product_not_visible_for_store', { storeHost, products });
  const secondProducts = await api.request('/api/admin/products', { storeId: secondStore.id }).catch(() => []);
  assert(Array.isArray(secondProducts) && !secondProducts.some((item) => item.id === productId), 'product_leaked_to_second_store', { secondStoreId: secondStore.id, secondProducts });
  const defaultProducts = await api.request('/api/admin/products', { storeId: 'store_main' });
  assert(Array.isArray(defaultProducts) && !defaultProducts.some((item) => item.id === productId), 'product_leaked_to_default_store', { defaultProducts });

  const checkout = await api.request('/api/orders', {
    method: 'POST',
    host: storeHost,
    body: {
      items: [{ id: productId, qty: 1 }],
      payment: 'promptpay',
      sessionId: `SMOKE${Date.now().toString(36).toUpperCase().slice(-8)}`,
      customer: {
        name: 'Smoke Customer',
        phone: '0800000000',
        address: 'Smoke address',
      },
    },
  });
  assert(checkout?.order?.id && checkout?.accessToken, 'order_create_failed', checkout);

  const tracked = await api.request(`/api/orders/${encodeURIComponent(checkout.order.id)}?access=${encodeURIComponent(checkout.accessToken)}`, { host: storeHost });
  assert(tracked?.id === checkout.order.id, 'track_order_failed', tracked);
  await api.request(`/api/admin/orders/${encodeURIComponent(checkout.order.id)}`, { storeId: secondStore.id })
    .then((payload) => assert(false, 'order_detail_leaked_to_second_store', payload))
    .catch((err) => assert(err.status === 404, 'order_detail_cross_store_expected_404', { status: err.status, payload: err.payload }));

  const sessionId = `CHAT${Date.now().toString(36).toUpperCase().slice(-8)}`;
  const chat = await api.request('/api/chat/send', {
    method: 'POST',
    host: storeHost,
    body: { sessionId, name: 'Smoke Chat', text: `Smoke inbox ${TEST_PREFIX}` },
  });
  assert(chat?.ok === true && chat?.sessionId, 'chat_send_failed', chat);

  const inbox = await api.request(`/api/admin/inbox?q=${encodeURIComponent(sessionId)}`, { storeId: store.id });
  assert(Array.isArray(inbox?.items) && inbox.items.some((item) => item.session_id === chat.sessionId), 'admin_inbox_not_scoped_to_store', inbox);
  const secondInbox = await api.request(`/api/admin/inbox?q=${encodeURIComponent(sessionId)}`, { storeId: secondStore.id });
  assert(Array.isArray(secondInbox?.items) && !secondInbox.items.some((item) => item.session_id === chat.sessionId), 'inbox_leaked_to_second_store', secondInbox);
  const defaultInbox = await api.request(`/api/admin/inbox?q=${encodeURIComponent(sessionId)}`, { storeId: 'store_main' });
  assert(Array.isArray(defaultInbox?.items) && !defaultInbox.items.some((item) => item.session_id === chat.sessionId), 'inbox_leaked_to_default_store', defaultInbox);

  const health = await api.request(`/api/admin/stores/${encodeURIComponent(store.id)}/domain-health`);
  assert(health?.ok === true && health?.store?.id === store.id, 'domain_health_failed', health);
  const backup = await api.request(`/api/admin/stores/${encodeURIComponent(store.id)}/export`);
  assert(backup?.store?.id === store.id && Array.isArray(backup.products) && backup.products.some((item) => item.id === productId), 'store_export_failed', backup);

  console.log(JSON.stringify({
    ok: true,
    baseUrl: BASE_URL,
    publicRequestMode: requestModeForHost(storeHost),
    storeId: store.id,
    secondStoreId: secondStore.id,
    storeHost,
    productId,
    orderId: checkout.order.id,
    chatSessionId: chat.sessionId,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error?.message || String(error),
    status: error?.status || 0,
    payload: error?.payload || null,
  }, null, 2));
  process.exit(1);
});
