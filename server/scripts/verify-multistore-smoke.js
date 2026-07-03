import '../env.js';

function assert(condition, message, payload) {
  if (!condition) {
    const error = new Error(message);
    error.payload = payload;
    throw error;
  }
}

const BASE_URL = String(process.env.BASE_URL || process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/+$/, '');
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || process.env.ADMIN_SEED_EMAIL || '').trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || process.env.ADMIN_SEED_PASSWORD || '').trim();
const ADMIN_KEY = String(process.env.ADMIN_KEY || process.env.ADMIN_ACCESS_KEY || '').trim();
const TEST_PREFIX = String(process.env.SMOKE_PREFIX || `smoke-${Date.now().toString(36)}`).toLowerCase();

class ApiClient {
  constructor() {
    this.cookie = '';
  }

  async request(path, { method = 'GET', body, headers = {}, host = '', storeId = '' } = {}) {
    const nextHeaders = { ...headers };
    if (body !== undefined && !nextHeaders['Content-Type']) nextHeaders['Content-Type'] = 'application/json';
    if (this.cookie) nextHeaders.Cookie = this.cookie;
    if (host) nextHeaders.Host = host;
    if (storeId) nextHeaders['x-store-id'] = storeId;
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: nextHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const parts = setCookie.split(/,(?=\s*[^;,]+=)/).map((item) => item.split(';')[0].trim()).filter(Boolean);
      const jar = new Map(this.cookie.split(';').map((item) => item.trim()).filter(Boolean).map((item) => {
        const eq = item.indexOf('=');
        return [item.slice(0, eq), item.slice(eq + 1)];
      }));
      for (const part of parts) {
        const eq = part.indexOf('=');
        if (eq > 0) jar.set(part.slice(0, eq), part.slice(eq + 1));
      }
      this.cookie = [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
    }
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) {
      const error = new Error(data?.error || `${method} ${path} failed with ${res.status}`);
      error.payload = data;
      error.status = res.status;
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
  const createdStore = await api.request('/api/admin/stores', {
    method: 'POST',
    body: { name: storeName, subdomain, templateKey: 'agri' },
  });
  const store = createdStore.store || {};
  assert(store.id, 'store_create_failed', createdStore);
  const secondSubdomain = `${subdomain}-b`.slice(0, 32).replace(/-+$/, '') || `smoke-b-${Date.now().toString(36)}`;
  const secondStoreRes = await api.request('/api/admin/stores', {
    method: 'POST',
    body: { name: `${storeName} B`, subdomain: secondSubdomain, templateKey: 'blank' },
  });
  const secondStore = secondStoreRes.store || {};
  assert(secondStore.id && secondStore.id !== store.id, 'second_store_create_failed', secondStoreRes);

  const storeHost = (() => {
    try { return new URL(store.publicUrl || '').host; } catch { return store.primaryDomain || ''; }
  })();
  assert(storeHost, 'store_host_missing', store);

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
