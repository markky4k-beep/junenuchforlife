(function (window) {
  'use strict';

  const ADMIN_SELECTED_STORE_KEY = 'adminSelectedStoreId:v1';

  function localGet(key, fallback = '') {
    try {
      return String(window.localStorage.getItem(key) || fallback || '').trim();
    } catch {
      return String(fallback || '').trim();
    }
  }

  function localSet(key, value = '') {
    const next = String(value || '').trim();
    try { window.localStorage.setItem(key, next); } catch {}
    return next;
  }

  function getSelectedStoreId() {
    return localGet(ADMIN_SELECTED_STORE_KEY, 'store_main') || 'store_main';
  }

  function setSelectedStoreId(storeId) {
    return localSet(ADMIN_SELECTED_STORE_KEY, String(storeId || 'store_main').trim() || 'store_main');
  }

  async function request(path, opts = {}, context = {}) {
    const headers = { ...(opts.headers || {}) };
    if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (String(path || '').startsWith('/api/admin/') && !headers['x-store-id']) {
      const selectedStoreId = typeof context.selectedStoreId === 'function' ? context.selectedStoreId() : getSelectedStoreId();
      headers['x-store-id'] = selectedStoreId || 'store_main';
    }
    return window.fetch(path, { credentials: 'same-origin', ...opts, headers });
  }

  window.NFLClientModules = {
    ...(window.NFLClientModules || {}),
    api: { request },
    adminState: {
      key: ADMIN_SELECTED_STORE_KEY,
      getSelectedStoreId,
      setSelectedStoreId,
    },
  };
})(window);
