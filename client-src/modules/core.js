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

  function readCookie(name) {
    try {
      const pattern = `${String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]+)`;
      const match = String(window.document?.cookie || '').match(new RegExp(`(?:^|;\\s*)${pattern}`));
      return match ? decodeURIComponent(match[1]) : '';
    } catch {
      return '';
    }
  }

  function readCsrfToken() {
    return readCookie('__Host-nfl_csrf') || readCookie('nfl_csrf') || '';
  }

  function withSecurityHeaders(input, init = {}) {
    const nextInit = { ...(init || {}) };
    const inheritedHeaders = (input && typeof input === 'object' && 'headers' in input) ? input.headers : undefined;
    const headers = new window.Headers(nextInit.headers || inheritedHeaders || {});
    const requestUrl = new window.URL(typeof input === 'string' ? input : (input?.url || ''), window.location.origin);
    const method = String(nextInit.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
    if (
      requestUrl.origin === window.location.origin
      && requestUrl.pathname.startsWith('/api/')
      && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
      && !headers.has('Authorization')
      && !headers.has('x-csrf-token')
    ) {
      const token = readCsrfToken();
      if (token) headers.set('x-csrf-token', token);
    }
    nextInit.headers = headers;
    return nextInit;
  }

  const nativeFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  if (nativeFetch && !window.__NFLFetchWrapped) {
    window.fetch = function nflSecureFetch(input, init) {
      return nativeFetch(input, withSecurityHeaders(input, init));
    };
    window.__NFLFetchWrapped = true;
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
