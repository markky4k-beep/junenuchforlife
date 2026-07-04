// ════════════════════════ State ════════════════════════
let PRODUCTS = [];
let productsCachePromise = null;
let productsCacheLoaded = false;
let ARTICLES = null;            // แคชบทความในหน่วยความจำ (โหลดครั้งเดียว ใช้ซ้ำ)
let _afterRender = null;        // callback ทำงานหลังวาดหน้าเสร็จ (hydrate ข้อมูลแบบไม่บล็อก)
let REVIEW_GALLERY = [];
let reviewGalleryPromise = null;
async function refreshProductsCache() {
  if (productsCachePromise) return productsCachePromise;
  productsCachePromise = (async () => {
  try {
    const response = await fetch('/api/products', { cache: 'no-store' });
    PRODUCTS = sortProductsForDisplay(await response.json());
  } catch {
    PRODUCTS = [];
  } finally {
    productsCacheLoaded = true;
  }
  return PRODUCTS;
  })().finally(() => { productsCachePromise = null; });
  return productsCachePromise;
}
async function ensureProductsCache() {
  if (productsCacheLoaded) return PRODUCTS;
  return refreshProductsCache();
}
async function refreshArticlesCache() {
  try { ARTICLES = await (await fetch('/api/articles')).json(); }
  catch { if (!ARTICLES) ARTICLES = []; }
  return ARTICLES || [];
}
async function refreshReviewGallery(force = false) {
  if (!force && REVIEW_GALLERY.length) return REVIEW_GALLERY;
  if (!force && reviewGalleryPromise) return reviewGalleryPromise;
  const loadReviewGallery = async () => {
    const primary = await fetch('/api/reviews/gallery', { cache: 'no-store' }).catch(() => null);
    if (primary?.ok) return primary.json();
    const fallback = await fetch('/review-gallery.json', { cache: 'no-store' });
    return fallback.ok ? fallback.json() : { items: [] };
  };
  reviewGalleryPromise = loadReviewGallery()
    .then((data) => {
      REVIEW_GALLERY = Array.isArray(data?.items) ? data.items.map((item, index) => ({
        id: String(item.id || `review-${index + 1}`),
        image: String(item.image || '').trim(),
        title: String(item.title || `รีวิวจากลูกค้า ${index + 1}`).trim(),
        note: String(item.note || 'ภาพรีวิวและผลงานจริงจากลูกค้าของคุณจูนนุชฟอร์ไลฟ์').trim(),
        badge: String(item.badge || 'รีวิวจากผู้ใช้จริง').trim(),
        spotlight: item.spotlight === true,
        spotlightRank: Math.max(0, parseInt(item.spotlightRank, 10) || 0),
        hash: String(item.hash || '').trim(),
        sourceName: String(item.sourceName || '').trim(),
        lightboxIndex: index,
      })).filter((item) => item.image) : [];
      return REVIEW_GALLERY;
    })
    .catch(() => {
      REVIEW_GALLERY = [];
      return REVIEW_GALLERY;
    })
    .finally(() => { reviewGalleryPromise = null; });
  return reviewGalleryPromise;
}
const productById = (id) => PRODUCTS.find((p) => p.id === id);
const clientOrders = new Map(); // เก็บออเดอร์ที่เพิ่งสร้าง
let currentSessionId = '';       // ห้องแชตปัจจุบัน (ส่งไปผูกกับออเดอร์)
const ORDER_ACCESS_KEY = 'order_access_tokens_v1';
let orderAccessTokens = {};
try { orderAccessTokens = JSON.parse(localStorage.getItem(ORDER_ACCESS_KEY) || '{}') || {}; } catch { orderAccessTokens = {}; }
function saveOrderAccessTokens() { localStorage.setItem(ORDER_ACCESS_KEY, JSON.stringify(orderAccessTokens)); }
function rememberOrderAccess(id, token) {
  const oid = String(id || '').trim();
  const value = String(token || '').trim();
  if (!oid || !value) return;
  orderAccessTokens[oid] = value;
  saveOrderAccessTokens();
}
function orderAccessToken(id) { return String(orderAccessTokens[String(id || '').trim()] || '').trim(); }
function orderAccessQuery(id) {
  const token = orderAccessToken(id);
  return token ? `?access=${encodeURIComponent(token)}` : '';
}

// ════════════════════════ Auth ════════════════════════
let authToken = '';
let adminAccessKey = '';
let currentUser = null;
let _adminInboxSocket = null;
let _adminInboxSocketReady = false;
let _adminInboxRealtimeChannel = null;
let _adminInboxRealtimeReady = false;
let _adminInboxAudioCtx = null;
let _adminInboxLastNoticeKey = '';
let _adminInboxUnreadTotal = 0;
let _adminInboxSummaryTimer = null;
let _chatSocket = null;
let _chatSocketReady = false;
let _chatSocketJoined = false;
let _chatRealtimeChannel = null;
let _chatRealtimeReady = false;
let _chatRealtimeSessionId = '';
let _chatAudioCtx = null;
let _chatLastNoticeKey = '';
let _chatTranscript = [];
let _chatTranscriptKeys = new Set();
let _chatActiveSessionId = '';
let _chatHistoryLoadedSessionId = '';
let _chatUnreadCount = 0;
let _supabaseBrowser = null;
let _supabaseBrowserKey = '';
let _supabaseBrowserLoader = null;
let _socketClientLoader = null;
let _baseDocumentTitle = typeof document !== 'undefined' ? document.title : '';
const ROLE_ADMIN = 'admin';
const ROLE_CHAT_ADMIN = 'chat_admin';
const ADMIN_INBOX_FULLSCREEN_KEY = 'adminInboxFullscreen_v1';
let _adminInboxFullscreen = false;
let _adminInboxRoomsOpen = false;
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    _adminInboxFullscreen = localStorage.getItem(ADMIN_INBOX_FULLSCREEN_KEY) === '1';
  }
} catch {}
function userRole(user = currentUser) {
  return String(user?.role || '').trim();
}
function isFullAdminClient(user = currentUser) {
  return userRole(user) === ROLE_ADMIN;
}
function isChatAdminClient(user = currentUser) {
  return userRole(user) === ROLE_CHAT_ADMIN;
}
function userStoreRolesClient(user = currentUser) {
  return Array.isArray(user?.storeRoles) ? user.storeRoles : [];
}
function currentStoreRoleClient(user = currentUser) {
  const roles = userStoreRolesClient(user);
  const selected = adminSelectedStoreId();
  return String((roles.find((role) => String(role.storeId || '') === selected) || roles[0] || {}).role || '').trim();
}
function hasStoreConsoleClient(user = currentUser) {
  return userStoreRolesClient(user).length > 0;
}
function canAccessAdminShellClient(user = currentUser) {
  return isFullAdminClient(user) || isChatAdminClient(user) || hasStoreConsoleClient(user);
}
function canAccessAdminInboxClient(user = currentUser) {
  return canAccessAdminShellClient(user);
}
function adminDefaultRoute(user = currentUser) {
  if (!isFullAdminClient(user) && currentStoreRoleClient(user) === 'chat_admin') return '/admin/inbox';
  return isChatAdminClient(user) ? '/admin/inbox' : '/admin';
}
function accountRoleLabel(user = currentUser) {
  if (isFullAdminClient(user)) return 'ADMIN';
  if (isChatAdminClient(user)) return 'ADMIN CHAT';
  if (hasStoreConsoleClient(user)) return 'STORE STAFF';
  return 'MEMBER';
}
function accountRoleDescription(user = currentUser) {
  if (isFullAdminClient(user)) return ' · ผู้ดูแลระบบ';
  if (isChatAdminClient(user)) return ' · ผู้ดูแลแชต';
  if (hasStoreConsoleClient(user)) return ' · ทีมดูแลร้าน';
  return '';
}
function userDisplayName(user = currentUser) {
  return String(user?.username || user?.name || user?.email || 'สมาชิก').trim();
}
function userAvatarUrl(user = currentUser) {
  return String(user?.avatar || '').trim();
}
function avatarHTML({ name = '', avatar = '', cls = 'community-avatar' } = {}) {
  const label = String(name || 'สมาชิก').trim();
  return `<div class="${cls}">${avatar ? `<img src="${esc(avatar)}" alt="${esc(label)}">` : esc(label.slice(0, 1) || 'ส')}</div>`;
}
function setAuth(_token, user, _adminKey = '') {
  authToken = '';
  adminAccessKey = '';
  currentUser = user || null;
  if (_adminInboxSocket) {
    try { _adminInboxSocket.disconnect(); } catch {}
    _adminInboxSocket = null;
    _adminInboxSocketReady = false;
  }
  if (_adminInboxRealtimeChannel && _supabaseBrowser) {
    try { _supabaseBrowser.removeChannel(_adminInboxRealtimeChannel); } catch {}
    _adminInboxRealtimeChannel = null;
    _adminInboxRealtimeReady = false;
  }
  if (_adminInboxSummaryTimer) {
    clearInterval(_adminInboxSummaryTimer);
    _adminInboxSummaryTimer = null;
  }
  _adminInboxUnreadTotal = 0;
  updateAdminInboxNavBadges();
  renderAccountNav();
  renderSecureAdminNav();
  refreshAttentionTitle();
  syncAdminInboxChrome();
}
async function api(path, opts = {}) {
  const moduleApi = window.NFLClientModules?.api;
  if (moduleApi?.request) return moduleApi.request(path, opts, { selectedStoreId: adminSelectedStoreId });
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (String(path || '').startsWith('/api/admin/') && !headers['x-store-id']) {
    headers['x-store-id'] = adminSelectedStoreId();
  }
  return fetch(path, { credentials: 'same-origin', ...opts, headers });
}
const ADMIN_SELECTED_STORE_KEY = 'adminSelectedStoreId:v1';
let _adminStoresContext = null;
let _adminStoresContextAt = 0;
function adminSelectedStoreId() {
  const adminState = window.NFLClientModules?.adminState;
  if (adminState?.getSelectedStoreId) return adminState.getSelectedStoreId();
  try {
    return String(localStorage.getItem(ADMIN_SELECTED_STORE_KEY) || 'store_main').trim() || 'store_main';
  } catch {
    return 'store_main';
  }
}
function setAdminSelectedStoreId(storeId) {
  const adminState = window.NFLClientModules?.adminState;
  if (adminState?.setSelectedStoreId) return adminState.setSelectedStoreId(storeId);
  const next = String(storeId || 'store_main').trim() || 'store_main';
  try { localStorage.setItem(ADMIN_SELECTED_STORE_KEY, next); } catch {}
  return next;
}
async function ensureAdminStoresContext(force = false) {
  const stale = !_adminStoresContext || force || (Date.now() - Number(_adminStoresContextAt || 0)) > 30000;
  if (!stale) return _adminStoresContext;
  const r = await api('/api/admin/stores', { cache: 'no-store' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || 'โหลดรายชื่อร้านไม่สำเร็จ');
  const stores = Array.isArray(data.stores) ? data.stores : [];
  if (stores.length && !stores.some((store) => store.id === adminSelectedStoreId())) {
    setAdminSelectedStoreId(stores.find((store) => store.isDefault)?.id || stores[0].id || 'store_main');
  }
  _adminStoresContext = { ...data, stores };
  _adminStoresContextAt = Date.now();
  return _adminStoresContext;
}
function selectedAdminStore() {
  const stores = Array.isArray(_adminStoresContext?.stores) ? _adminStoresContext.stores : [];
  return stores.find((store) => store.id === adminSelectedStoreId()) || stores[0] || { id: adminSelectedStoreId(), name: adminSelectedStoreId() };
}
function renderAdminStoreSwitcher() {
  if (isChatAdminClient(currentUser)) return '';
  const stores = Array.isArray(_adminStoresContext?.stores) ? _adminStoresContext.stores : [];
  const selected = adminSelectedStoreId();
  if (!stores.length) return '';
  return `<label class="admin-store-switcher">
    <span>ร้านที่จัดการ</span>
    <select id="adminStoreSwitcher">
      ${stores.map((store) => `<option value="${esc(store.id)}" ${store.id === selected ? 'selected' : ''}>${esc(store.name || store.id)}</option>`).join('')}
    </select>
  </label>`;
}
async function loadMe() {
  try {
    const d = await (await api('/api/auth/me', { cache: 'no-store' })).json();
    currentUser = d.user || null;
    if (!currentUser) setAuth('', null);
  }
  catch { currentUser = null; }
}
function hasSocketClient() {
  return typeof window !== 'undefined' && typeof window.io === 'function';
}
async function ensureSocketClientLoaded() {
  const mode = String(realtimeConfig().mode || '').trim();
  if (mode !== 'socket' || typeof document === 'undefined') return hasSocketClient();
  if (hasSocketClient()) return true;
  if (_socketClientLoader) return _socketClientLoader;
  _socketClientLoader = new Promise((resolve) => {
    const existing = document.getElementById('socketIoClientScript');
    if (existing) {
      existing.addEventListener('load', () => resolve(hasSocketClient()), { once: true });
      existing.addEventListener('error', () => resolve(false), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.id = 'socketIoClientScript';
    script.src = '/socket.io/socket.io.js';
    script.async = true;
    script.onload = () => resolve(hasSocketClient());
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  }).finally(() => {
    _socketClientLoader = null;
  });
  return _socketClientLoader;
}
function hasSupabaseClient() {
  return typeof window !== 'undefined' && typeof window.supabase?.createClient === 'function';
}
async function ensureSupabaseClientLoaded() {
  if (hasSupabaseClient()) return true;
  if (typeof document === 'undefined') return false;
  if (_supabaseBrowserLoader) return _supabaseBrowserLoader;
  _supabaseBrowserLoader = new Promise((resolve) => {
    const existing = document.getElementById('supabaseRuntimeScript');
    if (existing) {
      existing.addEventListener('load', () => resolve(hasSupabaseClient()), { once: true });
      existing.addEventListener('error', () => resolve(false), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.id = 'supabaseRuntimeScript';
    script.src = '/assets/runtime/v1.js';
    script.async = true;
    script.onload = () => resolve(hasSupabaseClient());
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  }).finally(() => {
    _supabaseBrowserLoader = null;
  });
  return _supabaseBrowserLoader;
}
function realtimeConfig() {
  return {
    url: String(SITE.SUPABASE_URL || '').trim(),
    key: String(SITE.SUPABASE_PUBLISHABLE_KEY || '').trim(),
    mode: String(SITE.CHAT_REALTIME_MODE || '').trim(),
  };
}
function chatRealtimeEnabled() {
  const config = realtimeConfig();
  return config.mode === 'supabase-broadcast' && Boolean(config.url && config.key);
}
async function getSupabaseBrowser() {
  const config = realtimeConfig();
  if (!chatRealtimeEnabled()) return null;
  const ready = await ensureSupabaseClientLoaded();
  if (!ready) return null;
  const cacheKey = `${config.url}|${config.key}`;
  if (_supabaseBrowser && _supabaseBrowserKey === cacheKey) return _supabaseBrowser;
  _supabaseBrowser = window.supabase.createClient(config.url, config.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  _supabaseBrowserKey = cacheKey;
  return _supabaseBrowser;
}
function browserNotificationSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}
function refreshAttentionTitle() {
  if (typeof document === 'undefined') return;
  const tokens = [];
  if (canAccessAdminInboxClient(currentUser) && _adminInboxUnreadTotal > 0) tokens.push(`Inbox ${_adminInboxUnreadTotal > 99 ? '99+' : _adminInboxUnreadTotal}`);
  if (_chatUnreadCount > 0) tokens.push(`แชต ${_chatUnreadCount > 99 ? '99+' : _chatUnreadCount}`);
  document.title = tokens.length ? `(${tokens.join(' • ')}) ${_baseDocumentTitle}` : _baseDocumentTitle;
}
function requestInboxNotificationPermission() {
  if (!browserNotificationSupported()) return;
  if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
}
function playAdminInboxSound() {
  if (typeof window === 'undefined') return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  _adminInboxAudioCtx ||= new AudioCtx();
  const ctx = _adminInboxAudioCtx;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const start = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(740, start);
  osc.frequency.exponentialRampToValueAtTime(880, start + 0.16);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.035, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + 0.3);
}
function notifyAdminInbox(title, body, key, sessionId = '') {
  if (!key || _adminInboxLastNoticeKey === key) return;
  _adminInboxLastNoticeKey = key;
  playAdminInboxSound();
  showAdminInboxToast({ title, body, key, sessionId });
  if (browserNotificationSupported() && Notification.permission === 'granted' && document.hidden) {
    try { new Notification(title, { body, tag: key, renotify: false }); } catch {}
  }
}
function updateAdminInboxNavBadges() {
  const total = Math.max(0, Number(_adminInboxUnreadTotal || 0));
  document.querySelectorAll('[data-admin-nav="inbox"]').forEach((link) => {
    let badge = link.querySelector('.admin-nav-badge');
    if (!total) {
      badge?.remove();
      link.classList.remove('has-badge');
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'admin-nav-badge';
      link.appendChild(badge);
    }
    badge.textContent = total > 99 ? '99+' : String(total);
    link.classList.add('has-badge');
  });
  refreshAttentionTitle();
}
async function refreshAdminInboxSummary() {
  if (!canAccessAdminInboxClient(currentUser)) {
    _adminInboxUnreadTotal = 0;
    updateAdminInboxNavBadges();
    return;
  }
  try {
    const res = await api('/api/admin/inbox/summary');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'โหลดสรุป inbox ไม่สำเร็จ');
    _adminInboxUnreadTotal = Math.max(0, Number(data?.unreadTotal || 0));
    updateAdminInboxNavBadges();
  } catch {}
}
function adminInboxToastRoot() {
  if (typeof document === 'undefined') return null;
  let root = document.getElementById('adminInboxToastStack');
  if (!root) {
    root = document.createElement('div');
    root.id = 'adminInboxToastStack';
    root.className = 'admin-inbox-toast-stack';
    document.body.appendChild(root);
  }
  return root;
}
function customerChatToastRoot() {
  if (typeof document === 'undefined') return null;
  let root = document.getElementById('customerChatToastStack');
  if (!root) {
    root = document.createElement('div');
    root.id = 'customerChatToastStack';
    root.className = 'customer-chat-toast-stack';
    document.body.appendChild(root);
  }
  return root;
}
function showCustomerChatToast({ title = '', body = '', key = '' } = {}) {
  const root = customerChatToastRoot();
  if (!root || !title || !key) return;
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'customer-chat-toast';
  item.innerHTML = `
    <span class="customer-chat-toast-dot"></span>
    <div class="customer-chat-toast-copy">
      <b>${esc(title)}</b>
      <span>${esc(body || 'มีข้อความใหม่ใน LIVE CHAT')}</span>
    </div>
  `;
  item.addEventListener('click', () => {
    item.classList.remove('show');
    setTimeout(() => item.remove(), 180);
    openChat();
    requestAnimationFrame(() => markChatSeen());
  });
  root.prepend(item);
  requestAnimationFrame(() => item.classList.add('show'));
  clearTimeout(item._t);
  item._t = setTimeout(() => {
    item.classList.remove('show');
    setTimeout(() => item.remove(), 220);
  }, 5200);
  while (root.children.length > 2) root.lastElementChild?.remove();
}
function focusAdminInboxSession(sessionId = '') {
  const normalized = String(sessionId || '').trim().toUpperCase();
  if (!normalized) return;
  setAdminInboxState({ sessionId: normalized });
  setAdminInboxRoomsOpen(false);
  if (currentPath() !== '/admin/inbox') {
    go('/admin/inbox');
    return;
  }
  refreshAdminInboxDom({ stickBottom: true }).catch(() => {});
}
function showAdminInboxToast({ title = '', body = '', key = '', sessionId = '' } = {}) {
  const root = adminInboxToastRoot();
  if (!root || !title) return;
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'admin-inbox-toast';
  item.innerHTML = `
    <span class="admin-inbox-toast-dot"></span>
    <div class="admin-inbox-toast-copy">
      <b>${esc(title)}</b>
      <span>${esc(body || 'มีข้อความใหม่จากลูกค้า')}</span>
    </div>
    <small>${esc(sessionId ? `#${sessionId}` : 'LIVE')}</small>
  `;
  item.addEventListener('click', () => {
    item.classList.remove('show');
    setTimeout(() => item.remove(), 180);
    focusAdminInboxSession(sessionId);
  });
  root.prepend(item);
  requestAnimationFrame(() => item.classList.add('show'));
  clearTimeout(item._t);
  item._t = setTimeout(() => {
    item.classList.remove('show');
    setTimeout(() => item.remove(), 220);
  }, 5200);
  while (root.children.length > 3) root.lastElementChild?.remove();
}
function chatSocketStatusLabel() {
  if (_chatRealtimeReady) return '🟢 ออนไลน์สด';
  return _chatSocketReady ? '🟢 ออนไลน์สด' : '🟡 กำลังเชื่อมต่อ...';
}
function requestChatNotificationPermission() {
  if (!browserNotificationSupported()) return;
  if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
}
function playCustomerChatSound() {
  if (typeof window === 'undefined') return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  _chatAudioCtx ||= new AudioCtx();
  const ctx = _chatAudioCtx;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const start = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(620, start);
  osc.frequency.exponentialRampToValueAtTime(930, start + 0.18);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.028, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + 0.34);
}
const CHAT_HISTORY_CACHE_PREFIX = 'nuch_chat_history_v2:';
const CHAT_LAST_SEEN_KEY = 'nuch_chat_last_seen_v1';
function chatHistoryStorageKey(sessionId = '') {
  const normalized = normalizedChatSessionId(sessionId);
  return normalized ? `${CHAT_HISTORY_CACHE_PREFIX}${normalized}` : '';
}
function loadChatLastSeenMap() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_LAST_SEEN_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function readChatLastSeen(sessionId = '') {
  const normalized = normalizedChatSessionId(sessionId);
  if (!normalized) return 0;
  return Number(loadChatLastSeenMap()[normalized] || 0);
}
function writeChatLastSeen(sessionId = '', at = 0) {
  const normalized = normalizedChatSessionId(sessionId);
  if (!normalized) return;
  const next = loadChatLastSeenMap();
  next[normalized] = Math.max(Number(next[normalized] || 0), Number(at || 0));
  localStorage.setItem(CHAT_LAST_SEEN_KEY, JSON.stringify(next));
}
function loadCachedChatHistory(sessionId = '') {
  const storageKey = chatHistoryStorageKey(sessionId);
  if (!storageKey) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function saveCachedChatHistory(sessionId = '', entries = _chatTranscript) {
  const storageKey = chatHistoryStorageKey(sessionId);
  if (!storageKey) return;
  const payload = Array.isArray(entries) ? entries.slice(-200) : [];
  localStorage.setItem(storageKey, JSON.stringify(payload));
}
function normalizeChatEntry(raw = {}) {
  const from = raw?.from === 'customer' ? 'customer' : raw?.from === 'admin' ? 'admin' : 'system';
  const text = String(raw?.text || '').trim();
  const at = Math.max(0, Number(raw?.at || Date.now()) || Date.now());
  if (!text) return null;
  return { from, text, at };
}
function chatEntryKey(entry = {}) {
  return `${entry.from}|${Number(entry.at || 0)}|${entry.text}`;
}
function syncChatLastAt() {
  _chatLastAt = _chatTranscript.reduce((max, item) => Math.max(max, Number(item?.at || 0)), 0);
}
function renderChatUnreadBadge() {
  if (!chatToggle) return;
  let badge = chatToggle.querySelector('.chat-unread');
  if (!_chatUnreadCount) {
    badge?.remove();
    chatToggle.classList.remove('has-unread');
    refreshAttentionTitle();
    return;
  }
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'chat-unread';
    chatToggle.appendChild(badge);
  }
  badge.textContent = _chatUnreadCount > 99 ? '99+' : String(_chatUnreadCount);
  chatToggle.classList.add('has-unread');
  refreshAttentionTitle();
}
function recomputeChatUnread() {
  const lastSeenAt = readChatLastSeen(currentSessionId);
  _chatUnreadCount = _chatTranscript.filter((entry) => entry?.from === 'admin' && Number(entry?.at || 0) > lastSeenAt).length;
  renderChatUnreadBadge();
}
async function syncVisitorReadState(at = 0) {
  if (!currentSessionId || !at) return;
  try {
    await fetch('/api/chat/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentSessionId, at }),
      keepalive: true,
    });
  } catch {}
}
function markChatSeen({ syncServer = true } = {}) {
  if (!currentSessionId) {
    _chatUnreadCount = 0;
    renderChatUnreadBadge();
    return;
  }
  const lastAdminAt = _chatTranscript.reduce((max, entry) => entry?.from === 'admin' ? Math.max(max, Number(entry?.at || 0)) : max, 0);
  writeChatLastSeen(currentSessionId, lastAdminAt);
  recomputeChatUnread();
  if (syncServer && lastAdminAt) syncVisitorReadState(lastAdminAt);
}
function shouldNotifyForIncomingAdminMessage() {
  const chatOpen = Boolean(chatBox?.classList.contains('open'));
  return !chatOpen || document.hidden;
}
function notifyCustomerChat(entry = {}) {
  const key = `${currentSessionId || 'chat'}:${Number(entry?.at || Date.now())}:${entry?.text || ''}`;
  if (!key || _chatLastNoticeKey === key) return;
  _chatLastNoticeKey = key;
  playCustomerChatSound();
  toast('คุณจูนตอบกลับแล้ว', 'ok');
  showCustomerChatToast({ title: 'คุณจูนตอบกลับแล้ว', body: String(entry?.text || '').trim().slice(0, 120), key });
  if (browserNotificationSupported() && Notification.permission === 'granted' && document.hidden) {
    try { new Notification('คุณจูนตอบกลับแล้ว', { body: String(entry?.text || '').trim().slice(0, 120), tag: key, renotify: false }); } catch {}
  }
}

// ── site branding (ตั้งค่าได้จากหลังบ้าน) ──
let SITE = {
  SITE_NAME: 'นุชฟอร์ไลฟ์', SITE_TAGLINE: 'นวัตกรรมเพื่อเกษตรกรไทย', SITE_ANNOUNCE: 'อาหารเสริมพืช · ฮอร์โมน · สารจับใบ · สมุนไพรสุขภาพ · จัดส่งทั่วไทย',
  SITE_HERO_TITLE: 'เพิ่มผลผลิต', SITE_HERO_ACCENT: 'อย่างแม่นยำ', SITE_HERO_TITLE2: 'ด้วยสูตรที่เหมาะกับพืช',
  SITE_HERO_SUB: 'ช่วยเกษตรกรเลือกสูตรที่ใช่ตามชนิดพืช ปัญหา และช่วงการเติบโต พร้อมจัดส่งไวและมีนักวิชาการให้คำแนะนำผ่าน LINE และ Live Chat',
  SITE_FOOTER: '© จูนนุชฟอร์ไลฟ์ · ผลิตภัณฑ์เพื่อการเกษตรและสุขภาพ · จัดส่งทั่วไทย',
  SITE_PRODUCT_CATEGORIES: '["สินค้าเดี่ยว","ชุดเซต","โปรโมชั่น","สุขภาพ","ความงาม"]',
  SITE_HOME_FEATURED_EYEBROW: 'สินค้าแนะนำ',
  SITE_HOME_FEATURED_TITLE: 'รวมชุดเซตและโปรโมชันพิเศษให้ดูง่ายในจุดเดียว',
  SITE_HOME_CROP_EYEBROW: 'สูตรตามพืช',
  SITE_HOME_CROP_TITLE: 'กดเข้าหน้าเฉพาะพืชได้ทันที',
  SITE_HOME_CONSULT_EYEBROW: 'ขอคำแนะนำเร็ว',
  SITE_HOME_CONSULT_TITLE: 'กรอกสั้น ๆ แล้วให้คุณจูนช่วยเลือกสูตรต่อ',
  SITE_HOME_CONSULT_BODY: 'กรอกเฉพาะข้อมูลหลักก่อนก็พอ หรือถ้าไม่สะดวกกรอกฟอร์ม โทรหรือทัก LINE ได้ทันที คุณจูนช่วยอธิบายให้แบบง่าย ๆ',
  SITE_HOME_CONTACT_TITLE: 'ไม่ต้องกรอกฟอร์มก็ได้',
  SITE_HOME_CONTACT_BODY: 'โทรหรือทัก LINE ได้ทันที เหมาะกับลูกค้าที่ใช้มือถือเป็นหลักและอยากคุยกับคนจริงก่อนตัดสินใจ',
  SITE_HOME_CONTACT_NOTE: 'สั่งซื้อ สอบถาม และดูข้อมูลต่าง ๆ แบบเรียลไทม์ได้ทันที ถ้าไม่แน่ใจว่าจะเริ่มตรงไหน โทรหรือทักไลน์ได้เลย',
  SITE_HOME_CONTACT_CALL_PRIMARY_LABEL: 'โทรหาคุณจูน',
  SITE_HOME_CONTACT_CALL_SECONDARY_LABEL: 'โทรหาเบอร์ร้าน',
  SITE_HOME_CONTACT_PERSONAL_LABEL: 'LINE ส่วนตัว',
  SITE_HOME_CONTACT_OA_LABEL: 'ทัก LINE OA ตอนนี้',
  CONTACT_PRIMARY_LABEL: 'คุณจูน นุชฟอร์ไลฟ์',
  CONTACT_PRIMARY_PHONE: '0924842250',
  CONTACT_SECONDARY_LABEL: 'เบอร์ร้าน / คุณจูน',
  CONTACT_SECONDARY_PHONE: '0851239829',
  CONTACT_LINE_ID: '0924842250',
  CONTACT_LINE_PERSONAL_URL: 'https://line.me/ti/p/~0924842250',
  CONTACT_LINE_OA_ID: '@221fmmrs',
  SITE_DOCK_TITLE: 'ไม่ต้องกรอกฟอร์มก็ได้',
  SITE_DOCK_BODY: 'โทรหาคุณจูนผู้มีประสบการณ์ด้านเกษตรกว่า 10 ปี หรือทัก LINE ได้ทันที',
  SITE_DOCK_LIVECHAT_LABEL: 'LIVECHAT',
  SITE_DOCK_CALL_LABEL: 'โทรเลย',
  SITE_DOCK_PERSONAL_LABEL: 'LINE คุณจูน',
  SITE_DOCK_OA_LABEL: 'LINE OA',
  SITE_TRUST_ITEMS: 'แนะนำสูตรตามพืชและช่วงการปลูกได้ชัดเจน\nมีฉลาก วิธีใช้ อัตราผสม และ FAQ ให้เปิดดูบนหน้าเว็บ\nปรึกษาคุณจูนฟรีก่อนซื้อและตามต่อใน LINE ได้\nสั่งซื้อออนไลน์ ติดตามออเดอร์ และเช็กสถานะได้หลังชำระเงิน',
  SITE_CASE_STUDIES: 'สวนทุเรียนและมะม่วง :: ใช้หน้าเฉพาะพืชเพื่อพาลูกค้าจากโฆษณาไปยังสูตรที่ตรงกับปัญหาจริงของสวน\nทีมขายเกษตร :: เก็บชื่อ เบอร์ พืช จังหวัด และปัญหาของลูกค้าไว้โทรกลับและปิดต่อใน LINE ได้ง่าย\nหน้าสินค้าเกษตร :: ลูกค้าเห็นวิธีใช้ อัตราผสม คำเตือน และ FAQ ก่อนตัดสินใจสั่งซื้อ',
  SITE_CHECKOUT_POINTS: 'รองรับการชำระเงินผ่าน PromptPay และบัตรเครดิต\nลูกค้าทัก LINE หรือกรอกฟอร์มเพื่อขอคำแนะนำก่อนซื้อได้\nหลังสั่งซื้อสามารถติดตามสถานะออเดอร์และเลขพัสดุได้จากเว็บไซต์',
  SITE_CROP_LANDING_DATA: '',
  SITE_CALC_KNOWLEDGE: '',
  LINE_OA_URL: '', GA4_ID: '', META_PIXEL_ID: '', TIKTOK_PIXEL_ID: '',
  SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', CHAT_REALTIME_MODE: '',
};
const SITE_HEAVY_KEYS = ['SITE_CROP_LANDING_DATA', 'SITE_CALC_KNOWLEDGE'];
const SITE_SYNC_KEY = 'site_sync_token';
const siteSyncChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('site_sync') : null;
const S = (k) => SITE[k] || '';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const HERO_RATIO_OPTIONS = ['wide', 'square', 'portrait', 'story'];
const HERO_FOCUS_OPTIONS = ['center', 'top', 'bottom', 'left', 'right'];
function normalizeRoute(path = '/') {
  const raw = String(path || '/').trim();
  if (!raw || raw === '#') return '/';
  const clean = raw.replace(/^#/, '');
  return clean.startsWith('/') ? clean : '/' + clean;
}
function routeHref(path = '/') {
  const normalized = normalizeRoute(path);
  if (normalized.startsWith('/admin')) return adminEntryHref(normalized);
  return normalized.startsWith('/crops/') ? normalized : `/#${normalized}`;
}
function publicNavLinks() {
  return [
    { href: routeHref('/'), label: 'หน้าแรก', group: 'primary' },
    { href: routeHref('/products'), label: 'สินค้า', group: 'primary' },
    { href: routeHref('/community'), label: 'ชุมชน', group: 'primary' },
    { href: routeHref('/reviews'), label: 'รีวิวลูกค้า', group: 'primary' },
    { href: routeHref('/track'), label: 'ติดตาม', group: 'more' },
    { href: routeHref('/calc'), label: 'คำนวณอัตรา', group: 'more' },
    { href: routeHref('/about'), label: 'เกี่ยวกับเรา', group: 'more' },
  ];
}
function adminEntryHref(path = '/admin') {
  const normalized = normalizeRoute(path);
  const adminPath = normalized.startsWith('/admin') ? normalized : '/admin';
  return `/secure-admin#${adminPath}`;
}
function isSecureAdminShell() {
  return (location.pathname.replace(/\/+$/, '') || '/') === '/secure-admin';
}
function routePathFromHref(href = '') {
  if (!href) return '/';
  try {
    const url = new URL(href, location.origin);
    return url.hash ? normalizeRoute(url.hash) : normalizeRoute(url.pathname);
  } catch {
    return normalizeRoute(href);
  }
}
function navLinkHTML(link) {
  return `<a href="${link.href}">${esc(link.label)}</a>`;
}
function renderPublicNavLinks(path = currentPath()) {
  const links = publicNavLinks();
  const primary = links.filter((link) => link.group !== 'more');
  const secondary = links.filter((link) => link.group === 'more');
  const moreActive = secondary.some((link) => {
    const href = routePathFromHref(link.href);
    return href === '/' ? path === '/' : path.startsWith(href);
  });
  return [
    primary.map(navLinkHTML).join(''),
    secondary.length
      ? `<div class="nav-more${moreActive ? ' active' : ''}"><button class="nav-more-toggle" type="button" data-nav-more-toggle aria-expanded="false">เพิ่มเติม</button><div class="nav-more-menu">${secondary.map(navLinkHTML).join('')}</div></div>`
      : '',
  ].join('');
}
function positionNavMoreMenu(group) {
  if (!group) return;
  const toggle = group.querySelector('[data-nav-more-toggle]');
  const menu = group.querySelector('.nav-more-menu');
  if (!toggle || !menu) return;
  const rect = toggle.getBoundingClientRect();
  const width = Math.max(196, menu.offsetWidth || 196);
  const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.right - width));
  const top = Math.min(window.innerHeight - 12, rect.bottom + 10);
  group.style.setProperty('--nav-more-left', `${Math.round(left)}px`);
  group.style.setProperty('--nav-more-top', `${Math.round(top)}px`);
}
function go(path = '/') {
  const normalized = normalizeRoute(path);
  const href = routeHref(normalized);
  const targetIsAdmin = normalized.startsWith('/admin');
  const sameShell = isSecureAdminShell() ? targetIsAdmin : !targetIsAdmin;
  if (!sameShell) {
    location.assign(href);
    return;
  }
  history.pushState({}, '', href);
  render();
}
let _siteHeavyLoaded = false;
let _siteHeavyLoading = null;
function routeNeedsHeavySiteData(path = currentPath()) {
  return path === '/calc' || path.startsWith('/crops/') || path === '/admin/site';
}
async function loadSiteHeavy(force = false) {
  if (_siteHeavyLoaded && !force) return SITE;
  if (!_siteHeavyLoading) {
    _siteHeavyLoading = fetch('/api/site/content', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : {})
      .then((data) => {
        SITE = { ...SITE, ...(data || {}) };
        _siteHeavyLoaded = true;
        return SITE;
      })
      .catch(() => SITE)
      .finally(() => { _siteHeavyLoading = null; });
  }
  return _siteHeavyLoading;
}
async function loadSite(includeHeavy = routeNeedsHeavySiteData()) {
  try {
    const data = await (await fetch('/api/site', { cache: 'no-store' })).json();
    SITE = { ...SITE, ...(data || {}) };
  } catch {}
  await ensureSocketClientLoaded().catch(() => false);
  if (includeHeavy) await loadSiteHeavy();
}
function setMeta(selector, value = '') { const el = document.querySelector(selector); if (el) el.setAttribute('content', value || ''); }
function absoluteMetaUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (typeof window === 'undefined' || !window.location?.origin) return raw;
  return `${window.location.origin}${raw.startsWith('/') ? raw : `/${raw}`}`;
}
function setPageMeta(title, desc, image = '') {
  // ใช้ค่าตั้งได้ต่อร้าน (SITE_SHARE_*) — เว้นว่าง = ประกอบจากชื่อร้าน/คำโปรยของร้านนั้น
  const siteName = S('SITE_NAME');
  const shareTitleDefault = S('SITE_SHARE_TITLE') || [siteName, S('SITE_TAGLINE')].filter(Boolean).join(' | ');
  const fullTitle = title ? `${title} | ${siteName}` : shareTitleDefault;
  const description = desc || S('SITE_SHARE_DESC') || `${siteName} — ${S('SITE_HERO_SUB') || S('SITE_ANNOUNCE') || S('SITE_TAGLINE')}`;
  const socialImage = absoluteMetaUrl(image || S('SITE_SHARE_IMAGE') || '/brand-share.jpg?v=20260628-1');
  const imageAlt = `ภาพแบรนด์${siteName}`;
  _baseDocumentTitle = fullTitle;
  document.title = fullTitle;
  refreshAttentionTitle();
  setMeta('meta[name="description"]', description);
  setMeta('meta[property="og:title"]', fullTitle);
  setMeta('meta[property="og:description"]', description);
  setMeta('meta[property="og:image"]', socialImage);
  setMeta('meta[property="og:image:alt"]', imageAlt);
  setMeta('meta[name="twitter:title"]', fullTitle);
  setMeta('meta[name="twitter:description"]', description);
  setMeta('meta[name="twitter:image"]', socialImage);
  setMeta('meta[name="twitter:image:alt"]', imageAlt);
}
function applySite() {
  marketingReady = false;
  setPageMeta('', '');
  document.querySelectorAll('.brand').forEach((b) => {
    const dot = b.querySelector('.brand-dot') ? '<span class="brand-dot"></span>' : '';
    b.innerHTML = dot + esc(S('SITE_NAME'));
  });
  const f = document.querySelector('.site-footer p'); if (f) f.textContent = S('SITE_FOOTER');
  initMarketing();
}
const SEGMENT_INFO = {
  agri: { label: 'เกษตร', title: 'สินค้าเกษตร', desc: 'อาหารเสริมพืช ฮอร์โมน สารจับใบ และโซลูชันสำหรับการเพาะปลูก' },
  lifestyle: { label: 'สุขภาพ/ความงาม', title: 'สุขภาพและความงาม', desc: 'ผลิตภัณฑ์เพื่อสุขภาพ สมุนไพร และความงามจากแบรนด์เดียวกัน' },
};
const DEFAULT_CROP_LANDING = {
  durian: {
    crop: 'ทุเรียน',
    hero: 'สูตรแนะนำสำหรับทุเรียน ตั้งแต่เร่งใบจนถึงบำรุงผล',
    problem: 'ช่วยวางลำดับการใช้สูตรในช่วงแตกใบ ออกดอก ติดผล และลดความเครียดของต้น',
    tip: 'เหมาะกับการทำแคมเปญยิงแอดและเก็บลีดลูกค้ากลุ่มสวนทุเรียน',
    offer: ['แยกข้อความยิงแอดตามช่วงใบ ดอก และผล', 'เก็บลีดลูกค้ากลุ่มสวนทุเรียนเข้า LINE ได้ทันที', 'มีสินค้าแนะนำพร้อมอัตราผสมและวิธีใช้'],
    painPoints: ['ใบไม่แตกสม่ำเสมอหรือแตกแล้วต้นอ่อนแรง', 'ช่วงดอกและผลอ่อนต้องการสูตรที่ไม่หนักเกินไป', 'อากาศแปรปรวนทำให้ต้นเครียดและผลร่วงง่าย'],
    stages: [
      { title: 'ฟื้นต้นและเร่งใบ', detail: 'เริ่มจากสูตรเดี่ยวหรือแพ็กพื้นฐานเพื่อเร่งใบ ฟื้นต้น และพยุงความสมบูรณ์ของแปลง', ids: ['p1', 'p3'] },
      { title: 'ดูแลช่วงดอกและผลอ่อน', detail: 'ต่อยอดด้วยแพ็กที่ช่วยคุมความสมดุลของต้นในช่วงอากาศไม่นิ่งและผลอ่อนยังบอบบาง', ids: ['p3', 'p4'] },
      { title: 'บำรุงผลและเพิ่มคุณภาพ', detail: 'เลือกชุดที่เน้นคุณภาพผลหรือแพ็กครบสูตรเมื่ออยากดูแลหลายจังหวะในชุดเดียว', ids: ['p2', 'p7'] },
    ],
    proofTitle: 'เหมาะกับการยิงแอดแบบเฉพาะพืช',
    proofBody: 'คุณสามารถใช้หน้านี้ยิงแอดคำว่า ทุเรียน ใบ ดอก ผล หรือปัญหาผลร่วง แล้วดึงลูกค้าไปปิดการขายต่อใน LINE ได้ตรงกลุ่มกว่าเดิม',
    faq: faqPairs(
      ['ถ้าลูกค้ายังไม่แน่ใจว่าต้องใช้ตัวไหนก่อน?', 'ให้ลูกค้ากรอกฟอร์มพร้อมบอกช่วงการปลูกและอาการ แล้วคุณจูนจะช่วยจัดลำดับสูตรให้เหมาะกับต้นและช่วงเวลา'],
      ['หน้านี้ใช้ทำ SEO ได้อย่างไร?', 'สามารถใส่รูปสวนจริง รีวิวจริง และขยายคีย์เวิร์ดตามปัญหาของทุเรียนเพื่อเพิ่มทราฟฟิกจาก Google ได้']
    ),
    related: ['p1', 'p2', 'p3', 'p7'],
  },
  mango: {
    crop: 'มะม่วง',
    hero: 'หน้าโซลูชันมะม่วงสำหรับเร่งดอก บำรุงผล และจัดการความสมบูรณ์ของต้น',
    problem: 'รวมสูตรที่เหมาะกับการแตกใบสะสมอาหาร ช่วงติดผล และเพิ่มคุณภาพผลผลิต',
    tip: 'ใช้เป็น landing page เฉพาะกลุ่มลูกค้ามะม่วงได้ดีทั้ง SEO และ conversion',
    offer: ['โฟกัสข้อความขายเรื่องเร่งดอกและบำรุงผล', 'มี CTA ให้ขอคำแนะนำก่อนซื้อทันที', 'เหมาะกับการทำคอนเทนต์คู่กับรีวิวสวนจริง'],
    painPoints: ['แตกใบไม่พร้อมก่อนเข้าสะสมอาหาร', 'ติดผลแล้วต้องการบำรุงให้ผลสมบูรณ์ สีสวย ผิวดี', 'สภาพอากาศแกว่งทำให้ต้นเครียดและผลคุณภาพไม่สม่ำเสมอ'],
    stages: [
      { title: 'สะสมอาหารและเร่งความพร้อม', detail: 'ใช้สูตรเดี่ยวหรือแพ็กเริ่มต้นเพื่อวางฐานต้นให้พร้อมก่อนเข้าช่วงทำดอก', ids: ['p1', 'p3'] },
      { title: 'เร่งดอกและดูแลใบ', detail: 'ใช้แพ็กที่ช่วยประคองความสมดุลของต้นและดูแลใบในช่วงก่อนและระหว่างออกดอก', ids: ['p3', 'p4'] },
      { title: 'บำรุงผลและเพิ่มคุณภาพผิว', detail: 'ต่อยอดด้วยชุดที่เน้นคุณภาพผลและความคุ้มค่าสำหรับช่วงติดผลต่อเนื่อง', ids: ['p2', 'p6'] },
    ],
    proofTitle: 'ใช้ได้ทั้งสายสวนและตัวแทนจำหน่าย',
    proofBody: 'หน้าเดียวสามารถตอบได้ทั้งคำถามเรื่องเร่งดอก บำรุงผล และการขอคำแนะนำสูตรเฉพาะแปลง ช่วยให้ปิดการขายได้เร็วขึ้น',
    faq: faqPairs(
      ['ถ้าลูกค้าปลูกมะม่วงหลายช่วงอายุ ใช้หน้าเดียวพอไหม?', 'ใช้ได้ โดยฟอร์มจะช่วยให้ทีมขายแยกคำแนะนำตามช่วงอายุและปัญหาของแต่ละสวน'],
      ['ควรมีอะไรเพิ่มเพื่อให้หน้าแปลงขายดี?', 'ควรใส่รูปผลผลิตจริง รีวิวสวนจริง และข้อความเปรียบเทียบช่วงก่อน-หลังการใช้สูตร']
    ),
    related: ['p1', 'p2', 'p3', 'p6'],
  },
  rice: {
    crop: 'ข้าว',
    hero: 'โซลูชันข้าวสำหรับเร่งแตกกอ เสริมความแข็งแรง และลดความเครียดของต้น',
    problem: 'เน้นสูตรช่วยให้ต้นสมบูรณ์ แตกกอดี และฟื้นต้นหลังสภาพอากาศไม่เอื้ออำนวย',
    tip: 'เหมาะกับการยิงแอดตามฤดูกาลเพาะปลูกและคอนเทนต์ให้ความรู้',
    offer: ['ใช้ทำแคมเปญตามฤดูนาปีและนาปรังได้', 'สื่อสารเรื่องแตกกอและฟื้นต้นได้ชัด', 'เหมาะกับคอนเทนต์ให้ความรู้และเก็บลีดเกษตรกร'],
    painPoints: ['ต้นไม่สมบูรณ์ แตกกอน้อย หรือโตช้า', 'หลังฝนหนักหรือแดดจัดต้นเกิดความเครียด', 'ต้องการลดความสิ้นเปลืองจากการฉีดพ่นหลายรอบ'],
    stages: [
      { title: 'เริ่มต้นแตกกอ', detail: 'ใช้ชุดเริ่มต้นเพื่อช่วยให้ต้นตั้งตัวไวและเร่งการเจริญเติบโตในช่วงต้นฤดู', ids: ['p1', 'p3'] },
      { title: 'เสริมความแข็งแรง', detail: 'ต่อยอดด้วยแพ็กที่ช่วยดูแลต้นในช่วงเจอแดดจัด ฝนหนัก หรือสภาพอากาศไม่นิ่ง', ids: ['p3'] },
      { title: 'เพิ่มความครบของโปรแกรม', detail: 'ใช้แพ็กครบสูตรเมื่ออยากดูแลหลายอาการในชุดเดียวและลดการตัดสินใจหลายรอบ', ids: ['p7'] },
    ],
    proofTitle: 'เหมาะกับคอนเทนต์เชิงปัญหาและตามฤดูกาล',
    proofBody: 'หน้าข้าวเหมาะกับการวางคีย์เวิร์ดอย่าง แตกกอ โตช้า ฟื้นต้น หลังฝน และใช้ต่อกับบทความความรู้เพื่อดึงทราฟฟิกได้ดี',
    faq: faqPairs(
      ['ถ้าลูกค้าไม่รู้ว่าควรเริ่มที่สูตรไหน?', 'ให้เลือกปัญหาหลัก เช่น แตกกอน้อยหรือฟื้นต้น แล้วคุณจูนจะช่วยจัดโปรแกรมให้ตามช่วงการปลูก'],
      ['หน้านี้เหมาะกับการยิงแอดแบบไหน?', 'เหมาะกับแคมเปญที่ยิงตามฤดูกาลและข้อความเชิงแก้ปัญหา เช่น เร่งแตกกอหรือฟื้นต้นหลังฝน']
    ),
    related: ['p1', 'p3', 'p7'],
  },
  vegetables: {
    crop: 'พืชผัก',
    hero: 'สูตรพืชผักสำหรับเร่งใบ เพิ่มคุณภาพ และจัดการการฉีดพ่นให้คุ้มค่ามากขึ้น',
    problem: 'เหมาะกับการตลาดเชิงแก้ปัญหา เช่น ใบไม่เขียว โตช้า หรือหน้าฝนฉีดพ่นไม่คุ้ม',
    tip: 'ใช้ต่อยอดทำหน้าเฉพาะพืชผักใบ ผักผล และแปลงปลูกเชิงการค้าได้',
    offer: ['เหมาะกับกลุ่มผักใบ ผักผล และแปลงการค้า', 'ใช้ข้อความแก้ปัญหา โตช้า ใบไม่เขียว ได้ชัด', 'ดึงลูกค้าจากโฆษณาไปเข้า LINE และปิดการขายต่อได้ง่าย'],
    painPoints: ['พืชผักโตช้า ใบไม่เขียว หรือคุณภาพผลผลิตไม่สม่ำเสมอ', 'ต้องการฉีดพ่นให้คุ้มในช่วงฝนหรือสภาพอากาศแปรปรวน', 'ต้องการสูตรที่เข้าใจง่ายและใช้งานไว'],
    stages: [
      { title: 'เร่งใบและโครงสร้างต้น', detail: 'ใช้สูตรเดี่ยวเพื่อเร่งใบ เพิ่มความสมบูรณ์ และทำให้แปลงเดินไวขึ้น', ids: ['p1'] },
      { title: 'เพิ่มคุณภาพและความสม่ำเสมอ', detail: 'ต่อยอดด้วยแพ็กที่ช่วยประคองต้นและเพิ่มคุณภาพผลผลิตในแปลงผักผล', ids: ['p2', 'p4'] },
      { title: 'เลือกชุดครบสูตร', detail: 'ใช้แพ็กครบสูตรเมื่ออยากได้ทางเลือกที่ดูแลได้หลายจุดในรอบเดียว', ids: ['p7'] },
    ],
    proofTitle: 'หน้าเดียวตอบได้ทั้ง SEO และ Conversion',
    proofBody: 'หน้า landing สำหรับพืชผักช่วยรวมคำถามยอดฮิตที่คนค้นหาบ่อย เช่น เร่งใบ ผักโตช้า ใบซีด และพาไปสู่การขอคำแนะนำได้ทันที',
    faq: faqPairs(
      ['ใช้ได้ทั้งผักใบและผักผลไหม?', 'ใช้ได้ โดยคุณจูนจะช่วยจัดสูตรและจังหวะการใช้ให้เหมาะกับชนิดพืชและระยะปลูก'],
      ['ถ้าต้องการยิงแอดหลายข้อความ ควรทำอย่างไร?', 'สามารถแยกครีเอทีฟตามปัญหา เช่น โตช้า ใบไม่เขียว หรือฝนชะล้าง แล้วใช้หน้าพืชผักนี้เป็นหน้าเก็บลีดหลัก']
    ),
    related: ['p1', 'p2', 'p4', 'p7'],
  },
};
function asArray(v) { return Array.isArray(v) ? v.filter(Boolean) : []; }
function splitLines(v) { return String(v || '').split('\n').map((x) => x.trim()).filter(Boolean); }
function splitCsv(v) { return String(v || '').split(',').map((x) => x.trim()).filter(Boolean); }
function splitPairs(v) {
  return splitLines(v).map((line) => {
    const idx = line.indexOf('::');
    if (idx === -1) return null;
    return { title: line.slice(0, idx).trim(), detail: line.slice(idx + 2).trim() };
  }).filter((item) => item && item.title && item.detail);
}
function faqPairs(...items) { return items.map(([q, a]) => ({ q, a })); }
function heroRatioValue(value = '') {
  const ratio = String(value || '').trim().toLowerCase();
  return HERO_RATIO_OPTIONS.includes(ratio) ? ratio : 'wide';
}
function heroFocusValue(value = '') {
  const focus = String(value || '').trim().toLowerCase();
  return HERO_FOCUS_OPTIONS.includes(focus) ? focus : 'center';
}
function heroFocusObjectPosition(value = '') {
  const focus = heroFocusValue(value);
  return ({
    center: '50% 50%',
    top: '50% 18%',
    bottom: '50% 82%',
    left: '24% 50%',
    right: '76% 50%',
  })[focus] || '50% 50%';
}
function normalizeLocalAssetUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw
    .replace(/^https?:\/\/localhost:3005(?=\/)/i, '')
    .replace(/^https?:\/\/127\.0\.0\.1:3005(?=\/)/i, '');
}
let lastCropPreviewSignature = '';
function normalizeCropLandingMediaItem(item = {}) {
  return {
    image: normalizeLocalAssetUrl(item?.image || ''),
    title: String(item?.title || '').trim(),
    note: String(item?.note || '').trim(),
  };
}
function normalizeCropLandingEntry(slug, entry = {}) {
  const rawEnabled = entry?.enabled;
  const sortOrder = parseInt(entry?.sortOrder ?? entry?.sort ?? '0', 10) || 0;
  return {
    slug: String(slug || '').trim(),
    crop: String(entry.crop || '').trim(),
    enabled: !(rawEnabled === false || String(rawEnabled || '').trim() === '0' || String(rawEnabled || '').trim().toLowerCase() === 'false'),
    sortOrder,
    seoTitle: String(entry.seoTitle || '').trim(),
    seoDescription: String(entry.seoDescription || '').trim(),
    seoImage: normalizeLocalAssetUrl(entry.seoImage || ''),
    hero: String(entry.hero || '').trim(),
    heroImage: normalizeLocalAssetUrl(entry.heroImage || entry.image || ''),
    heroRatio: heroRatioValue(entry.heroRatio),
    heroFocus: heroFocusValue(entry.heroFocus),
    problem: String(entry.problem || '').trim(),
    tip: String(entry.tip || '').trim(),
    offer: asArray(entry.offer).map((item) => String(item || '').trim()).filter(Boolean),
    painPoints: asArray(entry.painPoints).map((item) => String(item || '').trim()).filter(Boolean),
    gallery: asArray(entry.gallery).map((item) => normalizeCropLandingMediaItem(item)).filter((item) => item.image || item.title || item.note),
    stages: asArray(entry.stages).map((stage) => ({
      title: String(stage?.title || '').trim(),
      detail: String(stage?.detail || '').trim(),
      ids: asArray(stage?.ids).map((id) => String(id || '').trim()).filter(Boolean),
    })).filter((stage) => stage.title && stage.detail),
    proofTitle: String(entry.proofTitle || '').trim(),
    proofBody: String(entry.proofBody || '').trim(),
    faq: asArray(entry.faq).map((item) => ({
      q: String(item?.q || '').trim(),
      a: String(item?.a || '').trim(),
    })).filter((item) => item.q && item.a),
    related: asArray(entry.related).map((id) => String(id || '').trim()).filter(Boolean),
    reviews: asArray(entry.reviews).map((item) => normalizeCropLandingMediaItem(item)).filter((item) => item.image || item.title || item.note),
  };
}
function cropLandingMap() {
  const raw = String(S('SITE_CROP_LANDING_DATA') || '').trim();
  const map = cropLandingMapFromRaw(raw);
  const previewMode = new URLSearchParams(location.search).get('preview') === '1';
  if (previewMode) {
    try {
      const draft = JSON.parse(localStorage.getItem('cropLandingPreviewDraft') || '{}');
      const preview = normalizeCropLandingEntry(draft.slug || '', draft);
      if (preview.slug && preview.crop) map[preview.slug] = preview;
    } catch {}
  }
  return Object.fromEntries(Object.entries(map)
    .filter(([, entry]) => previewMode || entry.enabled !== false)
    .sort((a, b) => (a[1].sortOrder || 0) - (b[1].sortOrder || 0) || String(a[1].crop || '').localeCompare(String(b[1].crop || ''), 'th')));
}
function cropLandingMapFromRaw(raw = '') {
  const normalizedRaw = String(raw || '').trim();
  if (!normalizedRaw) return Object.fromEntries(Object.entries(DEFAULT_CROP_LANDING).map(([slug, entry]) => [slug, normalizeCropLandingEntry(slug, entry)]));
  try {
    const parsed = JSON.parse(normalizedRaw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    const entries = Object.entries(parsed).map(([slug, entry]) => {
      const normalized = normalizeCropLandingEntry(slug, entry);
      return normalized.slug && normalized.crop ? [normalized.slug, normalized] : null;
    }).filter(Boolean);
    return entries.length ? Object.fromEntries(entries) : Object.fromEntries(Object.entries(DEFAULT_CROP_LANDING).map(([slug, entry]) => [slug, normalizeCropLandingEntry(slug, entry)]));
  } catch {
    return Object.fromEntries(Object.entries(DEFAULT_CROP_LANDING).map(([slug, entry]) => [slug, normalizeCropLandingEntry(slug, entry)]));
  }
}
function cropSlugMap() {
  return Object.fromEntries(Object.entries(cropLandingMap()).map(([slug, cfg]) => [cfg.crop, slug]));
}
function cropGuideMap() {
  const map = {};
  Object.values(cropLandingMap()).forEach((entry) => {
    if (!entry.crop) return;
    map[entry.crop] = { ids: entry.related, tip: entry.tip || entry.problem || '' };
  });
  return map;
}
function serializeCropLandingMap(map) {
  return JSON.stringify(Object.fromEntries(Object.entries(map).map(([slug, entry]) => [slug, normalizeCropLandingEntry(slug, entry)])));
}
function sortCropLandingEntries(entries = []) {
  return [...entries].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || String(a.crop || '').localeCompare(String(b.crop || ''), 'th'));
}
const DEFAULT_TRUST_ITEMS = [
  'เลือกสูตรตามพืชและช่วงการปลูกได้',
  'มีข้อมูลฉลาก วิธีใช้ อัตราผสม และคำเตือน',
  'เก็บลีดจากเว็บไซต์แล้วติดตามต่อใน LINE ได้',
  'จัดส่งทั่วไทยและติดตามออเดอร์ได้หลังซื้อ',
];
const DEFAULT_CASE_STUDIES = [
  { title: 'สวนทุเรียน', detail: 'ทำหน้าเฉพาะพืชเพื่อยิงแอดและเก็บลูกค้ากลุ่มสวนทุเรียนได้ตรงขึ้น' },
  { title: 'ทีมขายเกษตร', detail: 'เก็บชื่อ เบอร์ พืช ปัญหา จังหวัด และพื้นที่ปลูก เพื่อโทรกลับได้ง่ายขึ้น' },
  { title: 'ร้านค้าออนไลน์', detail: 'ลูกค้ากดซื้อผ่านเว็บได้ทันที พร้อมวัดผลจาก Pixel และ Analytics' },
];
const DEFAULT_CHECKOUT_POINTS = [
  'ชำระเงินได้ทั้ง PromptPay และบัตรเครดิต',
  'มีคุณจูนคอยตอบคำถามก่อนและหลังสั่งซื้อ',
  'ติดตามออเดอร์และเลขพัสดุได้จากหน้าเว็บไซต์',
];
function settingLines(key, fallback = []) {
  const items = splitLines(S(key));
  return items.length ? items : fallback;
}
function settingPairs(key, fallback = []) {
  const items = splitPairs(S(key));
  return items.length ? items : fallback;
}
const DEFAULT_PRODUCT_CATEGORIES = ['สินค้าเดี่ยว', 'ชุดเซต', 'โปรโมชั่น', 'พอต', 'สุขภาพ', 'ความงาม'];
const CATEGORY_ALIAS_MAP = {
  เกษตร: 'สินค้าเดี่ยว',
  สินค้าเดี่ยว: 'สินค้าเดี่ยว',
  แพ็กคู่: 'ชุดเซต',
  แพ็กโปร: 'ชุดเซต',
  แพ็กสุดคุ้ม: 'ชุดเซต',
  ชุดแพ็ก: 'ชุดเซต',
  ชุดเซต: 'ชุดเซต',
  โปรแรง: 'โปรโมชั่น',
  โปรโมชัน: 'โปรโมชั่น',
  โปรโมชั่น: 'โปรโมชั่น',
  pod: 'พอต',
  POD: 'พอต',
  พอต: 'พอต',
  บุหรี่ไฟฟ้า: 'พอต',
  สุขภาพ: 'สุขภาพ',
  ความงาม: 'ความงาม',
};
const CATEGORY_DISPLAY_LABELS = {
  สินค้าเดี่ยว: 'สินค้าเดี่ยว',
  ชุดเซต: 'ชุดเซต',
  โปรโมชั่น: 'โปรโมชันพิเศษ',
  พอต: 'พอตพร้อมส่ง',
  สุขภาพ: 'สุขภาพ',
  ความงาม: 'ความงาม',
};
const CATEGORY_DISPLAY_HINTS = {
  ชุดเซต: 'รวมแพ็กคู่ / แพ็กโปร / แพ็กสุดคุ้ม',
  โปรโมชั่น: 'รวมดีลโปรแรงและแคมเปญพิเศษ',
  พอต: 'รวมพอตพร้อมส่ง ดีไซน์เด่น และตัวขายง่าย',
};
const PROMO_TAG_LABELS = new Set(['แพ็กคู่', 'แพ็กโปร', 'แพ็กสุดคุ้ม', 'โปรแรง']);
const STRUCTURAL_TAGS = new Set(['เกษตร', 'สินค้าเดี่ยว', 'ชุดแพ็ก', 'ชุดเซต', 'โปรโมชั่น', 'พอต', 'สุขภาพ', 'ความงาม']);
const PRODUCT_BADGE_PRIORITY = ['โปรแรง', 'แพ็กสุดคุ้ม', 'แพ็กโปร', 'แพ็กคู่', 'พอต', 'สินค้าเดี่ยว', 'ชุดเซต', 'โปรโมชั่น', 'สุขภาพ', 'ความงาม'];
const PRODUCT_TOP_PRIORITY = ['โปรแรง', 'แพ็กสุดคุ้ม', 'แพ็กโปร', 'แพ็กคู่', 'พอต', 'สินค้าเดี่ยว'];
function normalizeProductCategoryLabel(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  return CATEGORY_ALIAS_MAP[text] || text;
}
function displayProductCategoryLabel(value = '') {
  const normalized = normalizeProductCategoryLabel(value);
  return CATEGORY_DISPLAY_LABELS[normalized] || normalized;
}
function productCategoryHint(value = '') {
  const normalized = normalizeProductCategoryLabel(value);
  return CATEGORY_DISPLAY_HINTS[normalized] || '';
}
function normalizeProductTagLabel(value = '') {
  const text = String(value || '').trim();
  if (!text || STRUCTURAL_TAGS.has(text)) return '';
  return text;
}
function configuredProductCategories() {
  return parseProductCategories(S('SITE_PRODUCT_CATEGORIES'));
}
function parseProductCategories(raw = '') {
  if (Array.isArray(raw)) return [...new Set(raw.map((item) => normalizeProductCategoryLabel(item)).filter(Boolean))];
  const text = String(raw || '').trim();
  if (!text) return [...DEFAULT_PRODUCT_CATEGORIES];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parseProductCategories(parsed);
  } catch {}
  return [...new Set(text.split(/\r?\n|,/).map((item) => normalizeProductCategoryLabel(item)).filter(Boolean))];
}
function serializeProductCategories(list = []) {
  return JSON.stringify(parseProductCategories(list));
}
function storedProductCategory(p) {
  const extra = (p && typeof p.extra === 'object' && p.extra) ? p.extra : {};
  return normalizeProductCategoryLabel(extra.category || p?.category || '');
}
function inferredCategoryFromTag(p) {
  const tag = normalizeProductCategoryLabel(p?.tag || '');
  if (tag) return tag;
  if (p?.segment === 'lifestyle') return 'สุขภาพ';
  return 'สินค้าเดี่ยว';
}
function productCategory(p) {
  return storedProductCategory(p) || inferredCategoryFromTag(p);
}
function productPromoTag(p) {
  return normalizeProductTagLabel(p?.tag || '');
}
function productMarketingBadge(p) {
  const extra = productExtra(p);
  return String(extra.marketingBadge || extra.badge || '').trim();
}
function productIsFeatured(p) {
  const extra = productExtra(p);
  return extra.featured === true || extra.featured === 'true' || extra.featured === 1 || extra.featured === '1';
}
function productSeoTitle(p) {
  return String(productExtra(p).seoTitle || p?.seoTitle || p?.name || '').trim();
}
function productSeoDescription(p) {
  return String(productExtra(p).seoDescription || p?.seoDescription || p?.short || p?.desc || '').trim();
}
function productSellingPoints(p) {
  const extra = productExtra(p);
  const points = asArray(extra.sellingPoints).map((item) => String(item || '').trim()).filter(Boolean);
  if (points.length) return points.slice(0, 4);
  if (isAgriProduct(p)) return [
    productCrops(p).length ? `ใช้กับ ${productCrops(p).slice(0, 3).join(' / ')}` : 'เหมาะกับพืชหลายชนิด',
    extra.applicationMethod || p?.specs?.['วิธีใช้'] || 'มีคำแนะนำการใช้งาน',
    extra.dosage || p?.specs?.['อัตรา'] || 'ดูอัตราใช้ก่อนสั่งซื้อ',
  ];
  return [
    extra.highlight || p?.specs?.['จุดเด่น'] || 'เลือกซื้อง่ายจากข้อมูลชัดเจน',
    extra.audienceShort || p?.specs?.['เหมาะกับ'] || 'เหมาะกับลูกค้าที่ต้องการตัดสินใจเร็ว',
    extra.style || p?.specs?.['สไตล์'] || 'พร้อมสั่งซื้อออนไลน์',
  ];
}
function recentlyViewedProductIds(nextId = '') {
  const key = 'recent_products_v1';
  let ids = [];
  try { ids = JSON.parse(localStorage.getItem(key) || '[]'); } catch { ids = []; }
  ids = asArray(ids).map((id) => String(id || '').trim()).filter(Boolean);
  if (nextId) {
    ids = [String(nextId), ...ids.filter((id) => id !== String(nextId))].slice(0, 8);
    try { localStorage.setItem(key, JSON.stringify(ids)); } catch {}
  }
  return ids;
}
function recentlyViewedProducts(excludeId = '') {
  return recentlyViewedProductIds()
    .filter((id) => id !== String(excludeId))
    .map((id) => productById(id))
    .filter(Boolean)
    .slice(0, 4);
}
function productConversionPanel(p, related = []) {
  const bundle = related.filter((item) => item.stock > 0).slice(0, 2);
  const recent = recentlyViewedProducts(p.id);
  return `<section class="detail-panel product-conversion-panel glass reveal">
    <div class="panel-head"><span class="eyebrow">เลือกซื้อให้ง่ายขึ้น</span><h2>สินค้าใกล้เคียงและรายการที่ดูล่าสุด</h2></div>
    <div class="conversion-grid">
      <article class="conversion-card">
        <h3>ซื้อคู่ที่น่าสนใจ</h3>
        ${bundle.length ? `<div class="bundle-list">${bundle.map((item) => `<button type="button" data-add="${esc(item.id)}"><span>${esc(productCardName(item))}</span><b>${baht(effPrice(item))}</b></button>`).join('')}</div>` : '<p class="muted">ยังไม่มีสินค้าแนะนำในกลุ่มเดียวกัน</p>'}
      </article>
      <article class="conversion-card">
        <h3>ดูล่าสุด</h3>
        ${recent.length ? `<div class="recent-list">${recent.map((item) => `<a href="${routeHref('/product/' + item.id)}"><span>${productVisual(item, 'mini-ico')}</span><b>${esc(productCardName(item))}</b></a>`).join('')}</div>` : '<p class="muted">เมื่อเปิดดูสินค้าหลายตัว ระบบจะแสดงรายการที่ดูล่าสุดให้กลับมาเลือกง่ายขึ้น</p>'}
      </article>
    </div>
  </section>`;
}
function productModelUrl(p) {
  const text = String(p?.model || '').trim();
  if (!text) return '';
  return /\.(glb|gltf)(?:[?#].*)?$/i.test(text) ? text : '';
}
function displayProductTag(p) {
  return productPromoTag(p) || displayProductCategoryLabel(productCategory(p));
}
function productSortValue(p) {
  const raw = parseInt(p?.sort ?? p?.sortOrder ?? 0, 10);
  return Number.isFinite(raw) ? raw : 0;
}
function productBadgePriorityValue(value = '') {
  const normalized = normalizeProductCategoryLabel(value) || String(value || '').trim();
  const index = PRODUCT_BADGE_PRIORITY.indexOf(normalized);
  return index > -1 ? index : 999;
}
function productDisplayBucket(p) {
  const promo = productPromoTag(p);
  if (promo && PRODUCT_TOP_PRIORITY.includes(promo)) return promo;
  const category = productCategory(p);
  if (category === 'สินค้าเดี่ยว') return 'สินค้าเดี่ยว';
  return promo || category || '';
}
function productTopPriorityValue(p) {
  const bucket = productDisplayBucket(p);
  const index = PRODUCT_TOP_PRIORITY.indexOf(bucket);
  return index > -1 ? index : 999;
}
function productBadgeMarkup(p, { category = true, promo = true } = {}) {
  const items = [];
  const categoryValue = productCategory(p);
  const promoValue = productPromoTag(p);
  const marketingBadge = productMarketingBadge(p);
  if (marketingBadge) items.push({ value: marketingBadge, html: `<span class="tag tag-featured">${esc(marketingBadge)}</span>` });
  else if (productIsFeatured(p)) items.push({ value: 'featured', html: '<span class="tag tag-featured">แนะนำ</span>' });
  if (category && categoryValue) items.push({ value: categoryValue, html: `<span class="tag tag-category">${esc(displayProductCategoryLabel(categoryValue))}</span>` });
  if (promo && promoValue) items.push({ value: promoValue, html: `<span class="tag tag-promo">${esc(promoValue)}</span>` });
  return items.sort((a, b) => productBadgePriorityValue(a.value) - productBadgePriorityValue(b.value)).map((item) => item.html).join('');
}
function productPricePair(p) {
  const base = Math.max(0, parseInt(p?.price, 10) || 0);
  const candidates = [p?.salePrice, p?.comparePrice, p?.extra?.salePrice, p?.extra?.comparePrice]
    .map((value) => Math.max(0, parseInt(value, 10) || 0))
    .filter(Boolean);
  const rawAlt = candidates.find((value) => value !== base) || candidates[0] || 0;
  if (!base && !rawAlt) return { current: 0, compare: 0 };
  if (!rawAlt || rawAlt === base) return { current: base || rawAlt, compare: 0 };
  return { current: Math.min(base, rawAlt), compare: Math.max(base, rawAlt) };
}
function productCurrentPriceValue(p) {
  return productPricePair(p).current;
}
function productComparePriceValue(p) {
  return productPricePair(p).compare;
}
function productSalePriceValue(p) {
  const pair = productPricePair(p);
  return pair.compare > pair.current ? pair.current : 0;
}
function productDiscountPercent(p) {
  const pair = productPricePair(p);
  if (!pair.compare || !pair.current || pair.current >= pair.compare) return 0;
  return Math.max(1, Math.round(((pair.compare - pair.current) / pair.compare) * 100));
}
function sortProductsForDisplay(list = []) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    const sortDiff = productSortValue(a) - productSortValue(b);
    if (sortDiff !== 0) return sortDiff;
    const topDiff = productTopPriorityValue(a) - productTopPriorityValue(b);
    if (topDiff !== 0) return topDiff;
    const bucketDiff = productBadgePriorityValue(productDisplayBucket(a)) - productBadgePriorityValue(productDisplayBucket(b));
    if (bucketDiff !== 0) return bucketDiff;
    return String(a?.name || '').localeCompare(String(b?.name || ''), 'th');
  });
}
function managedProductCategories(extra = [], sourceProducts = PRODUCTS) {
  const configured = configuredProductCategories();
  const live = (Array.isArray(sourceProducts) ? sourceProducts : []).map((item) => productCategory(item)).filter(Boolean);
  return [...new Set([...configured, ...live, ...asArray(extra).map((item) => String(item || '').trim()).filter(Boolean)])];
}
function visibleProductCategories() {
  const configured = configuredProductCategories();
  const live = new Set((Array.isArray(PRODUCTS) ? PRODUCTS : []).filter((item) => item.active !== false).map((item) => productCategory(item)).filter(Boolean));
  const visible = configured.filter((item) => live.has(item));
  if (visible.length) return visible;
  if (configured.length) return configured;
  return managedProductCategories().filter(Boolean);
}
function orphanProductCategories(products = PRODUCTS) {
  const configured = new Set(configuredProductCategories());
  return [...new Set((Array.isArray(products) ? products : [])
    .map((item) => storedProductCategory(item))
    .filter((item) => item && !configured.has(item)))];
}
function productSegment(p) {
  const category = productCategory(p);
  const tag = String(p?.tag || '').trim();
  if (p?.segment === 'lifestyle') return 'lifestyle';
  if (p?.segment === 'agri') return ['สุขภาพ', 'ความงาม'].includes(category || tag) ? 'lifestyle' : 'agri';
  return (category || tag) === 'เกษตร' ? 'agri' : 'lifestyle';
}
function defaultAgriExtra(p) {
  const method = p?.specs?.['วิธีใช้'] || 'ฉีดพ่นทางใบ';
  const dosage = p?.specs?.['อัตรา'] || '5 ซีซี ต่อน้ำ 20 ลิตร';
  return {
    cropTargets: [],
    registrationNo: 'รออัปเดตเลขทะเบียน',
    labelUrl: '',
    labelNote: 'ควรอ่านฉลากและคำแนะนำก่อนใช้ทุกครั้ง',
    applicationMethod: method,
    dosage,
    usageSteps: ['เขย่าหรือคนผลิตภัณฑ์ก่อนใช้', 'ผสมน้ำสะอาดตามอัตราแนะนำ', 'ฉีดพ่นช่วงเช้าหรือเย็นและสังเกตการตอบสนองของพืช'],
    warnings: ['เก็บให้พ้นมือเด็ก', 'หลีกเลี่ยงการใช้เกินอัตราที่แนะนำ', 'ควรทดสอบในพื้นที่เล็กก่อนใช้จริงทั้งแปลง'],
    faq: faqPairs(
      ['ใช้ร่วมกับสารจับใบได้ไหม?', 'ใช้ได้ โดยควรผสมตามลำดับและอัตราที่เหมาะสมก่อนฉีดพ่นจริง'],
      ['ควรฉีดช่วงเวลาไหน?', 'แนะนำช่วงเช้าหรือเย็น หลีกเลี่ยงแดดจัดและฝนที่อาจชะล้างผลิตภัณฑ์']
    ),
  };
}
function defaultLifestyleExtra() {
  return { labelUrl: '', faq: [] };
}
function productExtra(p) {
  const extra = (p && typeof p.extra === 'object' && p.extra) ? p.extra : {};
  if (productSegment(p) === 'agri') {
    const base = defaultAgriExtra(p);
    return {
      ...base,
      ...extra,
      cropTargets: asArray(extra.cropTargets).length ? asArray(extra.cropTargets) : base.cropTargets,
      usageSteps: asArray(extra.usageSteps).length ? asArray(extra.usageSteps) : base.usageSteps,
      warnings: asArray(extra.warnings).length ? asArray(extra.warnings) : base.warnings,
      faq: Array.isArray(extra.faq) && extra.faq.length ? extra.faq : base.faq,
    };
  }
  return { ...defaultLifestyleExtra(), ...extra };
}
function productDosageText(p) {
  if (productSegment(p) === 'agri') return '5 ซีซี ต่อน้ำ 20 ลิตร';
  const extra = productExtra(p);
  return String(extra.dosage || p?.specs?.['อัตรา'] || p?.specs?.['อัตราการใช้'] || '').trim();
}

const CALC_RESEARCH_LIBRARY = [
  {
    match: /นุชฟอร์ไลฟ์ 1$/i,
    rateRaw: '5 ซีซี ต่อน้ำ 20 ลิตร',
    title: 'บำรุงราก ต้น ใบ และเร่งโครงสร้างพืช',
    interval: 'ทุก 7-10 วันตามความเหมาะสม',
    sourceLabel: 'หน้า “ผลิตภัณฑ์เกษตรนุชฟอร์ไลฟ์” และหน้าสินค้า “นุชฟอร์ไลฟ์ 1”',
    sourceUrl: 'https://nuchforlife.co.th/mainpage/%E0%B8%AA%E0%B8%B4%E0%B8%99%E0%B8%84%E0%B9%89%E0%B8%B2%E0%B8%99%E0%B8%B8%E0%B8%8A%E0%B8%9F%E0%B8%AD%E0%B8%A3%E0%B9%8C%E0%B9%84%E0%B8%A5%E0%B8%9F%E0%B9%8C/',
    points: ['เหมาะช่วงเร่งใบ แตกยอด และฟื้นต้น', 'เริ่มที่อัตราต่ำก่อนถ้าเป็นต้นอ่อนหรือพ่นครั้งแรก'],
  },
  {
    match: /นุชฟอร์ไลฟ์ 2$/i,
    rateRaw: '5 ซีซี ต่อน้ำ 20 ลิตร',
    title: 'บำรุงดอก ผล สี รสชาติ และน้ำหนัก',
    interval: 'ทุก 7-10 วันตามความเหมาะสม',
    sourceLabel: 'หน้า “ผลิตภัณฑ์เกษตรนุชฟอร์ไลฟ์” และหน้าสินค้า “นุชฟอร์ไลฟ์ 2”',
    sourceUrl: 'https://nuchforlife.co.th/mainpage/%E0%B8%AA%E0%B8%B4%E0%B8%99%E0%B8%84%E0%B9%89%E0%B8%B2%E0%B8%99%E0%B8%B8%E0%B8%8A%E0%B8%9F%E0%B8%AD%E0%B8%A3%E0%B9%8C%E0%B9%84%E0%B8%A5%E0%B8%9F%E0%B9%8C/',
    points: ['เหมาะช่วงติดผลถึงก่อนเก็บเกี่ยว', 'เลือกโหมดเข้มขึ้นได้เมื่อแปลงใหญ่และต้องการคุมคุณภาพผล'],
  },
  {
    match: /นุชฟอร์ไลฟ์ 8$/i,
    rateRaw: '5 ซีซี ต่อน้ำ 20 ลิตร',
    title: 'เสริมความแข็งแรง ลดเครียด ลดดอกและผลร่วง',
    interval: 'ใช้ก่อนหรือระหว่างช่วงอากาศแปรปรวน',
    sourceLabel: 'หน้า “ผลิตภัณฑ์เกษตรนุชฟอร์ไลฟ์” และหน้าสินค้า “นุชฟอร์ไลฟ์ 8”',
    sourceUrl: 'https://nuchforlife.co.th/mainpage/%E0%B8%AA%E0%B8%B4%E0%B8%99%E0%B8%84%E0%B9%89%E0%B8%B2%E0%B8%99%E0%B8%B8%E0%B8%8A%E0%B8%9F%E0%B8%AD%E0%B8%A3%E0%B9%8C%E0%B9%84%E0%B8%A5%E0%B8%9F%E0%B9%8C/',
    points: ['เหมาะใช้ช่วงร้อนจัด ฝนสลับแดด หรือฟื้นต้นหลังเครียด', 'ช่วยดูแลใบเหลือง ใบแก้ว และการชะงักการเจริญเติบโต'],
  },
  {
    match: /นุชฟอร์ไลฟ์ 9$/i,
    rateRaw: '5 ซีซี ต่อน้ำ 20 ลิตร',
    title: 'ดูแลอาการใบจุด สนิม และความสมบูรณ์ของดอก',
    interval: 'ทุก 7-10 วัน หรือถี่ขึ้นตามอาการและคำแนะนำหน้างาน',
    sourceLabel: 'หน้า “ผลิตภัณฑ์เกษตรนุชฟอร์ไลฟ์” และหน้าสินค้า “นุชฟอร์ไลฟ์ 9”',
    sourceUrl: 'https://nuchforlife.co.th/mainpage/%E0%B8%AA%E0%B8%B4%E0%B8%99%E0%B8%84%E0%B9%89%E0%B8%B2%E0%B8%99%E0%B8%B8%E0%B8%8A%E0%B8%9F%E0%B8%AD%E0%B8%A3%E0%B9%8C%E0%B9%84%E0%B8%A5%E0%B8%9F%E0%B9%8C/',
    points: ['ใช้ได้กับพืชทุกชนิดและทุกระยะตามข้อมูลเว็บไซต์แบรนด์', 'ถ้ามีอาการรุนแรงควรให้คุณจูนช่วยดูอาการร่วมด้วย'],
  },
  {
    match: /เน็ก-1$/i,
    rateRaw: '5 ซีซี ต่อน้ำ 20 ลิตร',
    title: 'บำรุงยอด ใบอ่อน และโครงสร้างช่วงเร่งต้น',
    interval: 'ทุก 7-10 วันตามความเหมาะสม',
    sourceLabel: 'อ้างอิงเรทกลางจากหน้า “ผลิตภัณฑ์เกษตรนุชฟอร์ไลฟ์” ของแบรนด์',
    sourceUrl: 'https://nuchforlife.co.th/mainpage/%E0%B8%AA%E0%B8%B4%E0%B8%99%E0%B8%84%E0%B9%89%E0%B8%B2%E0%B8%99%E0%B8%B8%E0%B8%8A%E0%B8%9F%E0%B8%AD%E0%B8%A3%E0%B9%8C%E0%B9%84%E0%B8%A5%E0%B8%9F%E0%B9%8C/',
    points: ['เหมาะกับช่วงเร่งยอดและบำรุงใบ', 'ควรเริ่มที่อัตราต่ำก่อนถ้ายังไม่มีฉลากอยู่ในมือ'],
  },
  {
    match: /เน็ก-2$/i,
    rateRaw: '5 ซีซี ต่อน้ำ 20 ลิตร',
    title: 'บำรุงผล ยอด และผิวผล พร้อมดูแลผลแตก',
    interval: 'ทุก 5-7 วันตามข้อมูลหน้า “นุชฟอร์ไลฟ์ เน็ก-2”',
    sourceLabel: 'หน้า “นุชฟอร์ไลฟ์ เน็ก-2” และหน้า “ผลิตภัณฑ์เกษตรนุชฟอร์ไลฟ์”',
    sourceUrl: 'https://nuchforlife.co.th/mainpage/%e0%b8%b7next2/',
    points: ['เหมาะกับช่วงบำรุงผลและดอกสมบูรณ์', 'เว็บไซต์แบรนด์ระบุรอบพ่น 5-7 วันตามชนิดพืช'],
  },
];
function normalizeCalcText(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}
function parseRateText(raw = '') {
  const s = String(raw || '').replace(/,/g, '').trim();
  if (!s) return null;
  const m = s.match(/(\d+(?:\.\d+)?)(?:\s*[–-]\s*(\d+(?:\.\d+)?))?\s*ซีซี[\s\S]*?(\d+(?:\.\d+)?)\s*ลิตร/i);
  if (!m) return null;
  return {
    min: +m[1],
    max: m[2] ? +m[2] : +m[1],
    per: +m[3],
    raw: s,
  };
}
function researchRateProfile(p) {
  const name = normalizeCalcText(p?.name);
  if (!name) return null;
  const matched = CALC_RESEARCH_LIBRARY.find((item) => item.match.test(name));
  if (!matched && !(productSegment(p) === 'agri' && !/จับใบ|108/.test(name))) return null;
  const rule = matched || {
    rateRaw: '5 ซีซี ต่อน้ำ 20 ลิตร',
    title: 'อัตราเริ่มต้นสำหรับผลิตภัณฑ์เกษตรนุชฟอร์ไลฟ์',
    interval: 'ทุก 7-10 วันตามความเหมาะสม',
    sourceLabel: 'หน้า “ผลิตภัณฑ์เกษตรนุชฟอร์ไลฟ์” ของแบรนด์',
    sourceUrl: 'https://nuchforlife.co.th/mainpage/%E0%B8%AA%E0%B8%B4%E0%B8%99%E0%B8%84%E0%B9%89%E0%B8%B2%E0%B8%99%E0%B8%B8%E0%B8%8A%E0%B8%9F%E0%B8%AD%E0%B8%A3%E0%B9%8C%E0%B9%84%E0%B8%A5%E0%B8%9F%E0%B9%8C/',
    points: ['เว็บไซต์แบรนด์ระบุว่าใช้เพียง 5 ซีซี ต่อน้ำ 20 ลิตร และใช้ได้กับพืชทุกชนิด', 'ถ้ามีฉลากขวดจริงอยู่ในมือ ให้ยึดตามฉลากก่อนเสมอ'],
  };
  const rate = parseRateText(rule.rateRaw);
  return rate ? { ...rule, rate } : null;
}
function productRateProfile(p) {
  const raw = productDosageText(p);
  const specRate = parseRateText(raw);
  const research = researchRateProfile(p);
  const selectedRate = research?.rate || specRate;
  if (!selectedRate) return null;
  const stickerProduct = PRODUCTS.find((item) => /จับใบ/.test(String(item?.name || '')));
  const stickerRaw = productDosageText(stickerProduct);
  return {
    raw,
    specRate,
    research,
    selectedRate,
    basis: research?.rate ? 'research' : 'spec',
    stickerProduct,
    stickerRate: stickerProduct ? parseRateText(stickerRaw) : null,
  };
}
function parseRate(p) {
  return productRateProfile(p)?.selectedRate || null;
}
function fmtCalcNumber(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n - Math.round(n)) < 0.05) return String(Math.round(n));
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
function calcDoseValues(rate, liters) {
  const totalLiters = Math.max(0, Number(liters || 0));
  const factor = totalLiters / rate.per;
  return {
    min: factor * rate.min,
    max: factor * rate.max,
  };
}
function doseByStrength(rate, liters, strength = 'mid') {
  const values = calcDoseValues(rate, liters);
  if (strength === 'low') return values.min;
  if (strength === 'high') return values.max;
  return values.min === values.max ? values.min : ((values.min + values.max) / 2);
}
function calcResult(rate, tank, strength = 'mid') {
  const values = calcDoseValues(rate, tank);
  const picked = doseByStrength(rate, tank, strength);
  if (values.min === values.max) return `${fmtCalcNumber(picked)} ซีซี`;
  return `${fmtCalcNumber(values.min)}–${fmtCalcNumber(values.max)} ซีซี`;
}
function parsePackSizes(p) {
  const bag = new Set();
  const text = [p?.name, p?.desc, JSON.stringify(p?.specs || {}), JSON.stringify(productExtra(p) || {})].join(' ');
  String(text).replace(/(\d+(?:\.\d+)?)\s*(?:ซีซี|cc|CC|มล\.|มล)/g, (_, n) => {
    const size = Number(n);
    if (size > 0 && size <= 5000) bag.add(size);
    return _;
  });
  return [...bag].sort((a, b) => a - b);
}
function defaultWaterPerRai(p) {
  const crops = productCrops(p);
  if (crops.includes('ข้าว')) return 30;
  if (crops.includes('พืชผัก')) return 60;
  if (crops.includes('ทุเรียน') || crops.includes('มะม่วง')) return 80;
  return 60;
}
const DEFAULT_CALC_KNOWLEDGE = {
  crops: {
    'ทุเรียน': {
      waterPerRai: 90,
      mixes: [
        { key: 'durian-growth', stage: 'แตกใบ', title: 'เร่งใบ ฟื้นต้น', ids: ['p1', 'p3'], note: 'เหมาะกับช่วงเร่งใบ ฟื้นต้นหลังเครียด หรือหลังเก็บเกี่ยว' },
        { key: 'durian-build', stage: 'สะสมอาหาร', title: 'สะสมอาหาร เตรียมต้น', ids: ['p1', 'p4'], note: 'ช่วยประคองความสมบูรณ์ของต้นและใบในช่วงเตรียมสะสมอาหาร' },
        { key: 'durian-fruit', stage: 'ติดผล', title: 'บำรุงผล ต่อโปรแกรม', ids: ['p2', 'p3'], note: 'เหมาะกับช่วงติดผลและอยากเสริมชุดดูแลต่อเนื่องให้ใช้งานง่ายขึ้น' },
      ],
    },
    'มะม่วง': {
      waterPerRai: 80,
      mixes: [
        { key: 'mango-growth', stage: 'แตกใบ', title: 'บำรุงใบ เร่งยอด', ids: ['p1', 'p3'], note: 'ใช้ช่วงบำรุงทรงพุ่มและเร่งความสมบูรณ์ของต้น' },
        { key: 'mango-build', stage: 'สะสมอาหาร', title: 'สะสมอาหาร เตรียมดอก', ids: ['p1', 'p4'], note: 'ใช้ก่อนเข้าช่วงสร้างตาดอกหรือช่วงเตรียมต้น' },
        { key: 'mango-fruit', stage: 'ติดผล', title: 'บำรุงผล คุณภาพผล', ids: ['p2', 'p6'], note: 'เหมาะกับช่วงติดผลที่ต้องการทั้งคุณภาพและความคุ้มค่าของแพ็กใช้งานจริง' },
      ],
    },
    'ข้าว': {
      waterPerRai: 30,
      mixes: [
        { key: 'rice-growth', stage: 'แตกใบ', title: 'แตกกอ ฟื้นต้น', ids: ['p1', 'p3'], note: 'ใช้ช่วงแตกกอหรือฟื้นต้นจากความเครียด' },
        { key: 'rice-build', stage: 'สะสมอาหาร', title: 'สะสมอาหาร สมดุลต้น', ids: ['p1', 'p4'], note: 'ใช้ช่วงตั้งท้องหรือช่วงที่ต้องการสะสมอาหารและคุมสมดุลของต้น' },
        { key: 'rice-balance', stage: 'ติดผล', title: 'สมดุลต้น ลดเครียด', ids: ['p3', 'p4'], note: 'เหมาะกับช่วงอากาศแปรปรวนและแปลงที่ต้องการชุดดูแลใช้งานง่าย' },
      ],
    },
    'พืชผัก': {
      waterPerRai: 60,
      mixes: [
        { key: 'veg-leaf', stage: 'แตกใบ', title: 'เร่งใบ เขียวไว', ids: ['p1', 'p3'], note: 'เหมาะกับผักใบและแปลงที่ต้องการฟื้นความเขียว' },
        { key: 'veg-build', stage: 'สะสมอาหาร', title: 'สะสมอาหาร เตรียมดอก', ids: ['p1', 'p4'], note: 'ช่วยพยุงต้นให้พร้อมก่อนเข้าระยะให้ผลผลิต' },
        { key: 'veg-fruit', stage: 'ติดผล', title: 'บำรุงดอก ผล และผิว', ids: ['p2', 'p4'], note: 'เหมาะกับผักผลและช่วงติดดอกติดผลที่อยากได้ชุดใช้งานต่อเนื่อง' },
      ],
    },
  },
  products: {
    p1: { label: 'เร่งใบและโครงสร้างต้น', preferredStrength: 'mid' },
    p2: { label: 'บำรุงดอกผล สี รสชาติ น้ำหนัก', preferredStrength: 'mid' },
    p3: { label: 'ลดเครียด เสริมความแข็งแรง', preferredStrength: 'mid' },
    p4: { label: 'ดูแลใบและดอก', preferredStrength: 'mid' },
    p5: { label: 'เร่งยอดและบำรุงใบ', preferredStrength: 'mid' },
    p6: { label: 'บำรุงผลและผิวผล', preferredStrength: 'mid' },
    p7: { label: 'ช่วยการเกาะใบและลดการชะล้าง', preferredStrength: 'low' },
  },
};
const DEFAULT_CALC_PROBLEM_PRESETS = {
  'ทุเรียน': [
    { key: 'durian-leaf-yellow', label: 'ใบเหลือง / แตกใบไม่สม่ำเสมอ', stage: 'แตกใบ', preset: 'durian-growth', note: 'เหมาะเมื่ออยากเริ่มจากสูตรฟื้นต้นและดันใบให้สม่ำเสมอขึ้น' },
    { key: 'durian-slow-build', label: 'ต้นอ่อนแรง / โตช้า', stage: 'สะสมอาหาร', preset: 'durian-build', note: 'เหมาะกับแปลงที่ต้องการพยุงต้นและสะสมอาหารก่อนเข้าระยะสำคัญ' },
    { key: 'durian-fruit-drop', label: 'ผลร่วง / ผลไม่สมบูรณ์', stage: 'ติดผล', preset: 'durian-fruit', note: 'เหมาะกับช่วงประคองผลและดูแลผลร่วงจากสภาพอากาศ' },
  ],
  'มะม่วง': [
    { key: 'mango-leaf-yellow', label: 'ใบซีด / พุ่มไม่สมบูรณ์', stage: 'แตกใบ', preset: 'mango-growth', note: 'เหมาะกับการเริ่มฟื้นทรงพุ่มและเร่งความสมบูรณ์ของใบ' },
    { key: 'mango-slow-build', label: 'สะสมอาหารไม่ดี / เตรียมดอกช้า', stage: 'สะสมอาหาร', preset: 'mango-build', note: 'เหมาะกับช่วงเตรียมต้นก่อนทำดอกหรือก่อนเข้าระยะสำคัญ' },
    { key: 'mango-fruit-drop', label: 'ผลเล็ก / คุณภาพผลไม่สม่ำเสมอ', stage: 'ติดผล', preset: 'mango-fruit', note: 'เหมาะกับการบำรุงผลและยกระดับคุณภาพผิวผล' },
  ],
  'ข้าว': [
    { key: 'rice-yellow', label: 'ใบเหลือง / แตกกอน้อย', stage: 'แตกใบ', preset: 'rice-growth', note: 'เหมาะกับช่วงเริ่มต้นที่ต้องการเร่งการแตกกอและฟื้นต้น' },
    { key: 'rice-slow', label: 'โตช้า / ต้นไม่สมบูรณ์', stage: 'สะสมอาหาร', preset: 'rice-build', note: 'เหมาะกับช่วงต้องการพยุงความสมบูรณ์ของต้นและสะสมอาหาร' },
    { key: 'rice-stress', label: 'เครียดจากอากาศ / ทรงต้นไม่สมดุล', stage: 'ติดผล', preset: 'rice-balance', note: 'เหมาะกับช่วงอากาศแปรปรวนและต้นเริ่มอ่อนแรง' },
  ],
  'พืชผัก': [
    { key: 'veg-yellow', label: 'ใบไม่เขียว / แตกใบช้า', stage: 'แตกใบ', preset: 'veg-leaf', note: 'เหมาะกับผักใบหรือแปลงที่ต้องการฟื้นความเขียวและเร่งทรงพุ่ม' },
    { key: 'veg-slow', label: 'โตช้า / ต้นไม่เดิน', stage: 'สะสมอาหาร', preset: 'veg-build', note: 'เหมาะกับการช่วยให้ต้นสะสมอาหารและเตรียมเข้าระยะให้ผลผลิต' },
    { key: 'veg-fruit-drop', label: 'ดอกผลไม่สวย / ติดผลไม่ดี', stage: 'ติดผล', preset: 'veg-fruit', note: 'เหมาะกับการดูแลดอก ผล และคุณภาพผลผลิต' },
  ],
};
const CALC_BUDGET_OPTIONS = [
  { key: 'economy', label: 'ประหยัด', desc: 'เริ่มต้นคุมงบ เลือกตัวหลักที่จำเป็นก่อน', tone: 'save' },
  { key: 'balanced', label: 'กลาง', desc: 'ได้สมดุลระหว่างงบประมาณกับความครอบคลุม', tone: 'balanced' },
  { key: 'premium', label: 'เน้นผลลัพธ์', desc: 'จัดชุดให้ครบขึ้นและเร่งผลลัพธ์ได้มากกว่า', tone: 'boost' },
];
const CALC_PLAN_DAY_OPTIONS = [7, 14, 21];
const CALC_LEAD_PREFILL_KEY = 'calc_lead_prefill';
function cloneCalcKnowledgeDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_CALC_KNOWLEDGE));
}
function normalizeCalcMixItem(item = {}) {
  return {
    key: String(item?.key || item?.title || '').trim(),
    stage: String(item?.stage || '').trim(),
    title: String(item?.title || '').trim(),
    ids: asArray(item?.ids).map((id) => String(id || '').trim()).filter(Boolean),
    note: String(item?.note || '').trim(),
  };
}
function normalizeCalcKnowledge(raw = '') {
  const base = cloneCalcKnowledgeDefaults();
  const parsed = (() => {
    const s = String(raw || '').trim();
    if (!s) return null;
    try { return JSON.parse(s); } catch { return null; }
  })();
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return base;
  const cropEntries = { ...base.crops };
  Object.entries(parsed.crops || {}).forEach(([crop, cfg]) => {
    const defaultCfg = cropEntries[crop] || {};
    const mixes = asArray(cfg?.mixes).map((item) => normalizeCalcMixItem(item)).filter((item) => item.key && item.title && item.ids.length);
    cropEntries[crop] = {
      waterPerRai: Math.max(1, parseFloat(cfg?.waterPerRai ?? defaultCfg.waterPerRai ?? 60) || 60),
      mixes: mixes.length ? mixes : asArray(defaultCfg.mixes),
    };
  });
  const productEntries = { ...(base.products || {}) };
  Object.entries(parsed.products || {}).forEach(([id, cfg]) => {
    productEntries[id] = {
      ...(productEntries[id] || {}),
      label: String(cfg?.label || productEntries[id]?.label || '').trim(),
      preferredStrength: ['low', 'mid', 'high'].includes(String(cfg?.preferredStrength || '').trim()) ? String(cfg.preferredStrength).trim() : (productEntries[id]?.preferredStrength || 'mid'),
      note: String(cfg?.note || productEntries[id]?.note || '').trim(),
    };
  });
  return { crops: cropEntries, products: productEntries };
}
function calcKnowledge() {
  return normalizeCalcKnowledge(S('SITE_CALC_KNOWLEDGE'));
}
function calcCropConfig(crop = '') {
  return calcKnowledge().crops[String(crop || '').trim()] || null;
}
function calcCropList() {
  return Object.keys(calcKnowledge().crops);
}
function stickerCalcProduct() {
  return PRODUCTS.find((item) => /จับใบ/.test(String(item?.name || '')));
}
function calcRatedProducts({ includeSticker = false } = {}) {
  return PRODUCTS.filter((p) => productRateProfile(p)).filter((p) => includeSticker || p.id !== stickerCalcProduct()?.id);
}
function calcSelectedProductIds() {
  return [...document.querySelectorAll('[data-calc-product]:checked')].map((el) => el.value).filter(Boolean);
}
function setCalcSelectedProducts(ids = []) {
  const picked = new Set(asArray(ids));
  document.querySelectorAll('[data-calc-product]').forEach((input) => { input.checked = picked.has(input.value); });
}
function calcPresetOptions(crop = '') {
  return asArray(calcCropConfig(crop)?.mixes);
}
function calcStageOptions(crop = '') {
  const list = [];
  calcPresetOptions(crop).forEach((item) => {
    const stage = String(item?.stage || '').trim();
    if (stage && !list.includes(stage)) list.push(stage);
  });
  return list;
}
function calcPresetDetails(crop = '', key = '') {
  return calcPresetOptions(crop).find((item) => item.key === key) || null;
}
function calcProblemOptions(crop = '') {
  return asArray(DEFAULT_CALC_PROBLEM_PRESETS[String(crop || '').trim()]).filter((item) => item.key && item.label);
}
function calcProblemDetails(crop = '', key = '') {
  return calcProblemOptions(crop).find((item) => item.key === key) || null;
}
function calcProblemIconName(problem = {}) {
  const text = `${problem?.key || ''} ${problem?.label || ''}`.toLowerCase();
  if (text.includes('ผล') || text.includes('fruit')) return 'drop';
  if (text.includes('โตช้า') || text.includes('อ่อนแรง') || text.includes('slow')) return 'sprout';
  if (text.includes('เครียด') || text.includes('stress')) return 'shieldleaf';
  return 'leaf';
}
function calcProblemSignal(problem = {}) {
  const text = `${problem?.key || ''} ${problem?.label || ''}`.toLowerCase();
  if (text.includes('ผล') || text.includes('fruit')) return { tone: 'warn', label: 'เร่งดูแลผล' };
  if (text.includes('โตช้า') || text.includes('อ่อนแรง') || text.includes('slow')) return { tone: 'cool', label: 'เน้นฟื้นต้น' };
  if (text.includes('เครียด') || text.includes('stress')) return { tone: 'info', label: 'พืชเครียด' };
  return { tone: 'good', label: 'เริ่มฟื้นใบ' };
}
function calcProblemVisual(crop = '', problem = {}) {
  const slug = cropSlugMap()[crop];
  const landing = slug ? cropLandingMap()[slug] : null;
  const image = landing?.heroImage || landing?.seoImage || landing?.gallery?.[0]?.image || landing?.reviews?.[0]?.image || '';
  return { image, signal: calcProblemSignal(problem) };
}
function calcProblemCardsHTML(crop = '', selectedKey = '') {
  const selected = String(selectedKey || '').trim();
  return calcProblemOptions(crop).map((item) => {
    const visual = calcProblemVisual(crop, item);
    return `<button type="button" class="calc-problem-card is-${esc(visual.signal.tone)} ${item.key === selected ? 'is-active' : ''}" data-calc-problem="${esc(item.key)}">
    <span class="calc-problem-media ${visual.image ? 'has-image' : ''}">
      ${visual.image ? `<img src="${esc(visual.image)}" alt="${esc(item.label)}" loading="lazy">` : icon(calcProblemIconName(item), 'mini-ico')}
      <i class="calc-problem-signal">${esc(visual.signal.label)}</i>
    </span>
    <span class="calc-problem-copy">
      <b>${esc(item.label)}</b>
      <small>${esc(item.note || 'กดเพื่อให้ระบบเลือกสูตรตั้งต้นให้')}</small>
    </span>
  </button>`;
  }).join('');
}
function calcBudgetMeta(level = 'balanced') {
  return CALC_BUDGET_OPTIONS.find((item) => item.key === level) || CALC_BUDGET_OPTIONS[1];
}
function calcBudgetPillsHTML(selected = 'balanced') {
  return CALC_BUDGET_OPTIONS.map((item) => `<button type="button" class="chip-btn ${item.key === selected ? 'on' : ''}" data-calcbudget="${item.key}">${esc(item.label)}</button>`).join('');
}
function calcBudgetLevel() {
  return String(document.getElementById('calcBudgetLevel')?.value || 'balanced').trim() || 'balanced';
}
function calcBudgetStrength(level = 'balanced') {
  return ({ economy: 'low', balanced: 'mid', premium: 'high' }[String(level || '').trim()] || 'mid');
}
function calcBudgetProductIds(level = 'balanced', crop = '', presetKey = '') {
  const preset = calcPresetDetails(crop, presetKey);
  const currentIds = calcSelectedProductsForRun().map((item) => item.id);
  const baseIds = [...new Set(asArray(preset?.ids).length ? preset.ids : currentIds)].filter((id) => productById(id));
  const stickerId = baseIds.find((id) => /จับใบ/.test(String(productById(id)?.name || '')));
  const nonSticker = baseIds.filter((id) => id !== stickerId).sort((a, b) => effPrice(productById(a)) - effPrice(productById(b)));
  if (!nonSticker.length) return baseIds;
  if (level === 'economy') return [nonSticker[0]];
  if (level === 'premium') {
    const stickerProduct = PRODUCTS.find((item) => /จับใบ/.test(String(item?.name || '')));
    const ids = [...nonSticker];
    if (stickerProduct && !ids.includes(stickerProduct.id)) ids.push(stickerProduct.id);
    return ids;
  }
  return [...nonSticker];
}
function syncCalcBudgetPills() {
  const level = calcBudgetLevel();
  document.querySelectorAll('[data-calcbudget]').forEach((btn) => btn.classList.toggle('on', btn.dataset.calcbudget === level));
  const summary = document.getElementById('calcBudgetSummary');
  const meta = calcBudgetMeta(level);
  if (summary) summary.textContent = meta?.desc || '';
}
function applyCalcBudgetSelection() {
  const crop = document.getElementById('calcCrop')?.value || '';
  const presetKey = document.getElementById('calcPreset')?.value || '';
  const level = calcBudgetLevel();
  const strengthEl = document.getElementById('calcStrength');
  const stickerEl = document.getElementById('calcIncludeSticker');
  const ids = calcBudgetProductIds(level, crop, presetKey);
  setCalcSelectedProducts(ids);
  if (strengthEl) strengthEl.value = calcBudgetStrength(level);
  if (stickerEl) stickerEl.checked = level === 'premium';
  document.querySelectorAll('[data-calc-product]').forEach((input) => input.closest('[data-calc-card]')?.classList.toggle('is-selected', input.checked));
  syncCalcBudgetPills();
}
function calcFilteredPresetOptions(crop = '', stage = '') {
  const currentStage = String(stage || '').trim();
  return calcPresetOptions(crop).filter((item) => !currentStage || item.stage === currentStage);
}
function syncCalcProblemSelect({ preserveSelection = true } = {}) {
  const crop = document.getElementById('calcCrop')?.value || '';
  const select = document.getElementById('calcProblem');
  if (!select) return;
  const current = preserveSelection ? select.value : '';
  const problems = calcProblemOptions(crop);
  select.innerHTML = `<option value="">เลือกจากอาการที่เจอ</option>${problems.map((item) => `<option value="${esc(item.key)}">${esc(item.label)}</option>`).join('')}`;
  if (problems.some((item) => item.key === current)) select.value = current;
  const cards = document.getElementById('calcProblemCards');
  if (cards) cards.innerHTML = calcProblemCardsHTML(crop, select.value || '');
  const note = document.getElementById('calcProblemNote');
  const selectedInfo = calcProblemDetails(crop, select.value || '');
  if (note) note.textContent = selectedInfo?.note || (crop ? `เลือกอาการที่ใกล้กับปัญหาของ${crop} เพื่อให้ระบบจัดระยะและสูตรตั้งต้นให้เร็วขึ้น` : 'เลือกพืชก่อน แล้วค่อยเลือกอาการที่ต้องการแก้');
}
function syncCalcStageSelect({ preserveSelection = true } = {}) {
  const crop = document.getElementById('calcCrop')?.value || '';
  const select = document.getElementById('calcStage');
  if (!select) return;
  const current = preserveSelection ? select.value : '';
  const stages = calcStageOptions(crop);
  select.innerHTML = `<option value="">ทุกระยะ</option>${stages.map((item) => `<option value="${esc(item)}">${esc(item)}</option>`).join('')}`;
  if (stages.includes(current)) select.value = current;
  else if (!preserveSelection && stages[0]) select.value = stages[0];
}
function syncCalcPresetSelect({ preserveSelection = true } = {}) {
  const crop = document.getElementById('calcCrop')?.value || '';
  const stage = document.getElementById('calcStage')?.value || '';
  const select = document.getElementById('calcPreset');
  if (!select) return;
  const current = preserveSelection ? select.value : '';
  const presets = calcFilteredPresetOptions(crop, stage);
  select.innerHTML = `<option value="">จัดเอง</option>${presets.map((item) => `<option value="${esc(item.key)}">${esc(item.title)}</option>`).join('')}`;
  if (presets.some((item) => item.key === current)) select.value = current;
  const note = document.getElementById('calcPresetNote');
  const chosen = calcPresetDetails(crop, select.value);
  if (note) note.textContent = chosen?.note || (crop ? `น้ำต่อไร่ของ${crop}ถูกตั้งให้อัตโนมัติแล้ว คุณยังปรับเองได้` : 'เลือกพืชหรือสูตรสำเร็จเพื่อให้ระบบช่วยจัดชุดสินค้าให้');
}
function syncCalcCompareSelect({ preserveSelection = true } = {}) {
  const crop = document.getElementById('calcCrop')?.value || '';
  const currentPreset = document.getElementById('calcPreset')?.value || '';
  const select = document.getElementById('calcComparePreset');
  if (!select) return;
  const current = preserveSelection ? select.value : '';
  const options = calcPresetOptions(crop).filter((item) => item.key !== currentPreset);
  select.innerHTML = `<option value="">เลือกสูตรมาเทียบ</option>${options.map((item) => `<option value="${esc(item.key)}">${esc(item.title)}</option>`).join('')}`;
  if (options.some((item) => item.key === current)) select.value = current;
  else if (!preserveSelection && options[0]) select.value = options[0].key;
}
function applyCalcPresetSelection() {
  const crop = document.getElementById('calcCrop')?.value || '';
  const preset = document.getElementById('calcPreset')?.value || '';
  const info = calcPresetDetails(crop, preset);
  if (info) setCalcSelectedProducts(info.ids);
}
function applyCalcProblemSelection() {
  const crop = document.getElementById('calcCrop')?.value || '';
  const problem = document.getElementById('calcProblem')?.value || '';
  const info = calcProblemDetails(crop, problem);
  if (!info) return;
  const stageEl = document.getElementById('calcStage');
  if (stageEl && calcStageOptions(crop).includes(info.stage)) stageEl.value = info.stage;
  syncCalcPresetSelect({ preserveSelection: false });
  const presetEl = document.getElementById('calcPreset');
  if (presetEl && calcPresetDetails(crop, info.preset)) presetEl.value = info.preset;
  applyCalcPresetSelection();
}
function calcPlanDays() {
  return Math.max(7, parseInt(document.getElementById('calcPlanDays')?.value || '14', 10) || 14);
}
function calcPlanCycles(days = 14) {
  return Math.max(1, Math.round(Math.max(7, Number(days || 14)) / 7));
}
function calcSelectedProductsForRun() {
  const selected = calcSelectedProductIds().map((id) => productById(id)).filter(Boolean);
  const includeSticker = !!document.getElementById('calcIncludeSticker')?.checked;
  const sticker = stickerCalcProduct();
  if (includeSticker && sticker && !selected.some((item) => item.id === sticker.id)) selected.push(sticker);
  return selected;
}
function calcPackCount(totalCc = 0, packSize = 100) {
  const total = Math.max(0, Number(totalCc || 0));
  const size = Math.max(1, Number(packSize || 0));
  return Math.ceil(total / size);
}
function calcProductMixRows(products = [], totalWater = 0, strength = 'mid') {
  return products.map((p) => {
    const profile = productRateProfile(p);
    if (!profile) return null;
    const rate = profile.selectedRate;
    const exact = doseByStrength(rate, totalWater, strength);
    const range = calcDoseValues(rate, totalWater);
    return {
      product: p,
      profile,
      exact,
      range,
      isSticker: p.id === stickerCalcProduct()?.id,
    };
  }).filter(Boolean);
}
function buildCalcShareText({ crop = '', stage = '', presetTitle = '', totalWater = 0, rows = [], totalDose = 0 } = {}) {
  const head = ['สรุปสูตรผสมแนะนำจากนุชฟอร์ไลฟ์'];
  if (crop) head.push(`พืช: ${crop}`);
  if (stage) head.push(`ระยะ: ${stage}`);
  if (presetTitle) head.push(`สูตร: ${presetTitle}`);
  head.push(`น้ำรวม: ${fmtCalcNumber(totalWater)} ลิตร`);
  const lines = rows.map((row) => `- ${row.product.name} ${fmtCalcNumber(row.exact)} ซีซี`);
  return `${head.join(' | ')}\n${lines.join('\n')}\nรวมทั้งหมด ${fmtCalcNumber(totalDose)} ซีซี\nหมายเหตุ: หากมีฉลากขวดจริง ให้ยึดตามฉลากก่อนทุกครั้ง`;
}
function buildCalcPitchText({ crop = '', stage = '', presetTitle = '', totalWater = 0, rows = [], totalDose = 0, strength = 'mid' } = {}) {
  const cropText = crop || 'พืชของลูกค้า';
  const stageText = stage ? `ช่วง${stage}` : 'ช่วงที่ต้องการดูแล';
  const titleText = presetTitle || 'สูตรที่คุณจูนแนะนำ';
  const lineUrl = String(S('LINE_OA_URL') || '').trim();
  const rowLines = rows.map((row) => `- ${row.product.name} ${fmtCalcNumber(row.exact)} ซีซี`);
  const highlights = rows
    .filter((row) => !row.isSticker)
    .map((row) => calcKnowledge().products?.[row.product.id]?.label || row.product.short || row.product.name)
    .filter(Boolean)
    .slice(0, 3)
    .map((text) => `- ${text}`);
  return [
    `สวัสดีครับ คุณจูนจาก ${S('SITE_NAME') || 'นุชฟอร์ไลฟ์'} สรุปสูตรแนะนำให้แล้ว`,
    `พืช: ${cropText}`,
    `ระยะ: ${stageText}`,
    `สูตรแนะนำ: ${titleText}`,
    `ระดับการใช้: ${calcStrengthLabel(strength)}`,
    `ผสมน้ำรวม ${fmtCalcNumber(totalWater)} ลิตร`,
    ...rowLines,
    `รวมทั้งหมด ${fmtCalcNumber(totalDose)} ซีซี`,
    highlights.length ? 'จุดเด่นของสูตรนี้' : '',
    ...highlights,
    'หากต้องการให้คุณจูนช่วยปรับสูตรตามอาการจริง ส่งชื่อพืช ปัญหา และพื้นที่ปลูกมาได้เลยครับ',
    'หมายเหตุ: หากมีฉลากขวดจริง ให้ยึดตามฉลากก่อนทุกครั้ง',
    lineUrl ? `คุยกับคุณจูนต่อทาง LINE: ${lineUrl}` : '',
  ].filter(Boolean).join('\n');
}
function calcModeLabel(mode = 'tank') {
  return ({ tank: 'ตามถัง', water: 'ตามน้ำรวม', area: 'ตามพื้นที่' }[String(mode || '').trim()] || 'ตามถัง');
}
function calcModeRecommendation(fields = {}) {
  if (fields.mode === 'area') return `เหมาะเมื่อคุณรู้พื้นที่ปลูกชัดเจน เช่น ${fmtCalcNumber(fields.areaRai)} ไร่ และต้องการให้ระบบคำนวณน้ำรวมจาก ${fmtCalcNumber(fields.waterPerRai)} ลิตรต่อไร่ให้อัตโนมัติ`;
  if (fields.mode === 'water') return `เหมาะเมื่อคุณเตรียมน้ำรวมไว้แล้ว ${fmtCalcNumber(fields.waterTotal)} ลิตร และต้องการคำนวณรวดเดียวสำหรับรอบพ่นนี้`;
  return `เหมาะกับการผสมหน้างานทีละถัง เช่น ถัง ${fmtCalcNumber(fields.tankSize)} ลิตร จำนวน ${fmtCalcNumber(fields.tankCount)} ถัง`;
}
function calcGuideStepsHTML({ crop = '', stage = '', presetTitle = '', fields = {}, rows = [], stickerRow = null } = {}) {
  const step1 = crop ? `เริ่มจากพืช ${crop}${stage ? ` และช่วง${stage}` : ''}${presetTitle ? ` โดยใช้สูตร ${presetTitle}` : ''}` : 'เริ่มจากเลือกพืชและระยะที่ต้องการดูแล';
  const step2 = `${calcModeLabel(fields.mode)}: ${calcModeRecommendation(fields)}`;
  const step3 = rows.length
    ? `ก่อนผสมจริง ให้ผสมตามลำดับ ${rows.filter((row) => !row.isSticker).map((row) => row.product.name).join(' -> ')}${stickerRow ? ` -> ${stickerRow.product.name}` : ''}`
    : 'เลือกสินค้าอย่างน้อย 1 ตัวก่อน เพื่อให้ระบบสรุปลำดับผสมและผลลัพธ์อัตโนมัติ';
  return [step1, step2, step3].map((text, idx) => `<article class="calc-step-card"><span>ขั้น ${idx + 1}</span><b>${esc(text)}</b></article>`).join('');
}
function calcExpectedEffects({ crop = '', stage = '', rows = [], strength = 'mid', stickerRow = null } = {}) {
  const productLabels = rows
    .filter((row) => !row.isSticker)
    .map((row) => calcKnowledge().products?.[row.product.id]?.label || row.product.short || row.product.name)
    .filter(Boolean);
  const effects = [];
  if (stage === 'แตกใบ') effects.push(`คาดว่าจะเห็นการเดินใบและการฟื้นตัวของ${crop || 'พืช'}สม่ำเสมอขึ้น หากต้นไม่เครียดและมีน้ำพอ`);
  if (stage === 'สะสมอาหาร') effects.push(`คาดว่าจะช่วยพยุงความสมบูรณ์ของใบและต้น เพื่อให้${crop || 'พืช'}สะสมอาหารได้ต่อเนื่องขึ้น`);
  if (stage === 'ติดผล') effects.push(`คาดว่าจะเน้นการประคองผลและคุณภาพผลผลิตมากขึ้น โดยเฉพาะถ้าให้ต่อเนื่องตามรอบพ่น`);
  if (!stage) effects.push(`สูตรนี้เหมาะกับการใช้เป็นแนวทางตั้งต้นสำหรับ${crop || 'พืช'} แล้วค่อยปรับตามอาการจริงในแปลง`);
  if (productLabels.length) effects.push(`บทบาทหลักของสูตรนี้คือ ${productLabels.slice(0, 3).join(' + ')}`);
  if (strength === 'low') effects.push('เลือกความเข้มเริ่มต้น จึงเหมาะกับการเริ่มลองหรือแปลงที่อยากคุมความเสี่ยงก่อน');
  if (strength === 'high') effects.push('เลือกความเข้มเข้มขึ้น จึงควรใช้เมื่อมั่นใจในสภาพพืช น้ำ และสภาพอากาศหน้างาน');
  if (stickerRow) effects.push(`มี ${stickerRow.product.name} ในสูตร จึงคาดว่าการเกาะใบและความสม่ำเสมอของการพ่นจะดีขึ้น`);
  return effects.slice(0, 4);
}
function calcCautionNotes({ rows = [], totalWater = 0, strength = 'mid', presetTitle = '' } = {}) {
  const notes = [];
  if (!presetTitle) notes.push('คุณกำลังจัดสูตรเอง ควรเช็กความเข้ากันได้ของสินค้าแต่ละตัวอีกครั้งก่อนผสมจริง');
  if (strength === 'high') notes.push('โหมดเข้มควรเริ่มทดลองในพื้นที่ย่อยก่อน หากยังไม่เคยใช้สูตรนี้กับแปลงจริง');
  if (totalWater > 1000) notes.push(`รอบนี้ใช้น้ำรวม ${fmtCalcNumber(totalWater)} ลิตร ควรแบ่งผสมเป็นชุดย่อยเพื่อให้ตวงง่ายและลดความคลาดเคลื่อน`);
  if (rows.length >= 3) notes.push('สูตรหลายตัวควรคนให้เข้ากันทีละตัวและเติมตัวถัดไปหลังละลายสม่ำเสมอแล้ว');
  notes.push('หากมีฉลากหรือคำแนะนำจากนักวิชาการเฉพาะแปลง ให้ยึดข้อมูลนั้นก่อนผลวิเคราะห์อัตโนมัติ');
  return notes.slice(0, 4);
}
function calcConfidenceLabel({ presetTitle = '', rows = [] } = {}) {
  const researchCount = rows.filter((row) => row.profile?.research?.sourceUrl).length;
  if (presetTitle && researchCount === rows.length && rows.length) return 'สูง';
  if (presetTitle || researchCount > 0) return 'กลาง';
  return 'ตั้งต้น';
}
function calcAiAnalysisHTML({ crop = '', stage = '', presetTitle = '', fields = {}, rows = [], totalWater = 0, totalDose = 0, strength = 'mid', stickerRow = null } = {}) {
  const expected = calcExpectedEffects({ crop, stage, rows, strength, stickerRow });
  const cautions = calcCautionNotes({ rows, totalWater, strength, presetTitle });
  const confidence = calcConfidenceLabel({ presetTitle, rows });
  const title = presetTitle || (crop && stage ? `${crop} ช่วง${stage}` : crop || 'สูตรที่เลือก');
  return `<div class="calc-ai-card">
    <div class="calc-ai-head">
      <div>
        <span class="eyebrow">AI วิเคราะห์ผลลัพธ์ที่คาดว่าจะเกิดขึ้น</span>
        <h3>${esc(title)}</h3>
      </div>
      <span class="calc-ai-confidence">ความมั่นใจ ${esc(confidence)}</span>
    </div>
    <div class="calc-ai-grid">
      <article class="calc-ai-block">
        <b>ภาพรวมรอบพ่นนี้</b>
        <span>ระบบประเมินจาก ${calcModeLabel(fields.mode)} | น้ำรวม ${fmtCalcNumber(totalWater)} ลิตร | ใช้ทั้งหมด ${fmtCalcNumber(totalDose)} ซีซี | ความเข้ม ${calcStrengthLabel(strength)}</span>
      </article>
      <article class="calc-ai-block">
        <b>ผลที่คาดว่าจะเห็น</b>
        <div class="calc-ai-list">${expected.map((item) => `<div>${esc(item)}</div>`).join('')}</div>
      </article>
      <article class="calc-ai-block">
        <b>ข้อควรระวัง</b>
        <div class="calc-ai-list">${cautions.map((item) => `<div>${esc(item)}</div>`).join('')}</div>
      </article>
    </div>
  </div>`;
}
function calcTimelineSteps({ crop = '', stage = '', rows = [], totalWater = 0, days = 14 } = {}) {
  const productNames = rows.filter((row) => !row.isSticker).map((row) => row.product.name.replace(/^นุชฟอร์ไลฟ์\s*/, ''));
  const sameSet = productNames.length ? productNames.join(' + ') : 'สูตรที่เลือก';
  const steps = [
    { day: 0, title: `เริ่มพ่นสูตร ${sameSet}`, detail: `ใช้น้ำรวม ${fmtCalcNumber(totalWater)} ลิตร ตามผลคำนวณรอบนี้ และควรพ่นในช่วงอากาศนิ่ง` },
    { day: 7, title: 'เช็กอาการและตอบสนองของแปลง', detail: stage === 'ติดผล'
      ? 'ติดตามการตอบสนองของผลและความสมบูรณ์ของต้น แล้วพ่นซ้ำหากยังต้องการประคองผลต่อเนื่อง'
      : stage === 'สะสมอาหาร'
        ? 'สังเกตความสมบูรณ์ของใบและทรงต้น ถ้าตอบสนองดีให้พ่นซ้ำชุดเดิมหรือปรับความเข้มตามสภาพแปลง'
        : 'สังเกตการเดินใบและความเขียว ถ้าต้นเริ่มตอบสนองดีให้พ่นต่อรอบกลางเพื่อย้ำผลลัพธ์' },
    { day: 14, title: stage === 'ติดผล' ? 'ประเมินผลผลิตและคุณภาพผล' : 'พิจารณาปรับเข้าสูตรระยะถัดไป', detail: stage ? `หาก${crop || 'พืช'}เริ่มขยับเข้าสู่ระยะถัดไป ให้เปลี่ยนสูตรตามระยะใหม่แทนการพ่นชุดเดิมต่อเนื่องนานเกินไป` : 'เมื่อครบ 14 วัน ควรประเมินสภาพจริงในแปลงก่อนกำหนดรอบถัดไป' },
    { day: 21, title: 'สรุปผลและวางรอบถัดไป', detail: 'เก็บผลตอบรับจากแปลงจริง แล้วปรับสูตรหรือความเข้มให้เหมาะกับรอบถัดไปก่อนสั่งซื้อเพิ่ม' },
  ];
  return steps.filter((item) => item.day <= Math.max(7, days));
}
function calcTimelineHTML({ crop = '', stage = '', presetTitle = '', rows = [], strength = 'mid', totalWater = 0, days = 14 } = {}) {
  const title = presetTitle || (crop && stage ? `${crop} ช่วง${stage}` : 'โปรแกรมพ่นต่อเนื่อง');
  const steps = calcTimelineSteps({ crop, stage, rows, totalWater, days });
  const productNames = rows.filter((row) => !row.isSticker).map((row) => row.product.name.replace(/^นุชฟอร์ไลฟ์\s*/, ''));
  const sameSet = productNames.length ? productNames.join(' + ') : 'สูตรที่เลือก';
  return `<div class="calc-plan-card">
    <div class="calc-plan-head">
      <div>
        <span class="eyebrow">โปรแกรมพ่นต่อเนื่อง ${fmtCalcNumber(days)} วัน</span>
        <h3>${esc(title)}</h3>
      </div>
      <span class="calc-plan-badge">${esc(calcStrengthLabel(strength))}</span>
    </div>
    <div class="calc-plan-meta">สูตรหลักรอบนี้: ${esc(sameSet)}</div>
    <div class="calc-plan-timeline">
      ${steps.map((item) => `<article class="calc-plan-step">
        <span>Day ${fmtCalcNumber(item.day)}</span>
        <b>${esc(item.title)}</b>
        <small>${esc(item.detail)}</small>
      </article>`).join('')}
    </div>
  </div>`;
}
function calcRecommendedBottle(row, days = 14) {
  const cycles = calcPlanCycles(days);
  const totalCc = Math.max(0, row.exact * cycles);
  const packSize = totalCc > 120 ? 500 : 100;
  return {
    ...row,
    days,
    cycles,
    totalCc,
    packSize,
    qty: Math.max(1, Math.ceil(totalCc / packSize)),
  };
}
function calcBundleRecommendations(rows = [], days = 14) {
  return rows.map((row) => calcRecommendedBottle(row, days));
}
function calcBundleSummaryHTML(recommendations = []) {
  if (!recommendations.length) return '<div class="calc-bundle-empty">ยังไม่มีชุดพร้อมสั่ง</div>';
  return `<div class="calc-bundle-list">${recommendations.map((item) => `<article class="calc-bundle-item">
    <b>${esc(item.product.name)}</b>
    <span>ใช้จริงประมาณ ${fmtCalcNumber(item.totalCc)} ซีซี / ${fmtCalcNumber(item.days)} วัน</span>
    <strong>หยิบ ${fmtCalcNumber(item.qty)} ขวด ขนาด ${fmtCalcNumber(item.packSize)} ซีซี</strong>
  </article>`).join('')}</div>`;
}
function calcBudgetLead(level = 'balanced') {
  const meta = calcBudgetMeta(level);
  return meta?.label || 'กลาง';
}
function buildCalcConsultText({ crop = '', problemLabel = '', stage = '', presetTitle = '', totalWater = 0, rows = [], days = 14 } = {}) {
  const bundle = calcBundleRecommendations(rows, days)
    .map((item) => `- ${item.product.name}: แนะนำ ${item.qty} ขวด ขนาด ${item.packSize} ซีซี`)
    .join('\n');
  return [
    `สวัสดีครับคุณจูน รบกวนช่วยดูสูตรนี้ต่อให้หน่อยครับ`,
    crop ? `พืช: ${crop}` : '',
    problemLabel ? `อาการหลัก: ${problemLabel}` : '',
    stage ? `ระยะ: ${stage}` : '',
    presetTitle ? `สูตรที่เลือก: ${presetTitle}` : '',
    `น้ำรวมต่อรอบ: ${fmtCalcNumber(totalWater)} ลิตร`,
    `แผนพ่น: ${fmtCalcNumber(days)} วัน`,
    ...rows.map((row) => `- ${row.product.name} ${fmtCalcNumber(row.exact)} ซีซี/รอบ`),
    bundle ? 'ขวดที่ระบบแนะนำ' : '',
    bundle,
    'ต้องการให้ช่วยดูความเหมาะสมกับอาการจริงของแปลงครับ',
  ].filter(Boolean).join('\n');
}
function buildCalcSalesLineText({ crop = '', problemLabel = '', stage = '', presetTitle = '', totalWater = 0, rows = [], days = 14, budgetLevel = 'balanced' } = {}) {
  const slug = cropSlugMap()[crop];
  const landingUrl = `${location.origin}${slug ? `/crops/${slug}` : routeHref('/products')}`;
  const lineUrl = String(S('LINE_OA_URL') || '').trim();
  const bundle = calcBundleRecommendations(rows, days);
  const totalPrice = bundle.reduce((sum, item) => sum + (effPrice(item.product) * item.qty), 0);
  return [
    `แนะนำสูตรสำหรับ${crop || 'พืช'}${problemLabel ? ` อาการ${problemLabel}` : ''}`,
    stage ? `ช่วงที่เหมาะ: ${stage}` : '',
    presetTitle ? `ชุดแนะนำ: ${presetTitle}` : '',
    `ระดับงบ: ${calcBudgetLead(budgetLevel)}`,
    `ผสมน้ำรวม ${fmtCalcNumber(totalWater)} ลิตร / แผน ${fmtCalcNumber(days)} วัน`,
    ...rows.filter((row) => !row.isSticker).map((row) => `- ${row.product.name} ${fmtCalcNumber(row.exact)} ซีซี/รอบ`),
    bundle.length ? 'ขวดที่ระบบแนะนำ' : '',
    ...bundle.map((item) => `- ${item.product.name}: ${item.qty} ขวด ขนาด ${item.packSize} ซีซี`),
    `งบชุดนี้ประมาณ ${baht(totalPrice)}`,
    `ดูรายละเอียดและสั่งซื้อได้ที่ ${landingUrl}`,
    lineUrl ? `หรือทักคุณจูนทาง LINE OA: ${lineUrl}` : '',
  ].filter(Boolean).join('\n');
}
function setCalcLeadPrefill(data = {}) {
  try { localStorage.setItem(CALC_LEAD_PREFILL_KEY, JSON.stringify(data)); } catch {}
}
function calcLeadStageValue(stage = '', problemLabel = '') {
  const text = `${stage || ''} ${problemLabel || ''}`;
  if (text.includes('ติดผล') || text.includes('ผล')) return 'บำรุงผล';
  if (text.includes('แตกใบ') || text.includes('เร่งใบ') || text.includes('โตช้า') || text.includes('แตกกอ')) return 'เร่งโต/แตกกอ';
  if (text.includes('เครียด') || text.includes('ใบเหลือง')) return 'ใบเหลือง/พืชเครียด';
  if (text.includes('สะสมอาหาร') || text.includes('ดอก')) return 'เร่งดอก';
  return 'ยังไม่แน่ใจ ขอคำแนะนำ';
}
function applyCalcLeadPrefill() {
  const form = document.getElementById('leadForm');
  if (!form) return;
  let data = null;
  try { data = JSON.parse(localStorage.getItem(CALC_LEAD_PREFILL_KEY) || 'null'); } catch {}
  if (!data || typeof data !== 'object') return;
  const applyValues = () => {
    const cropInput = form.querySelector('[name="crop"]');
    const stageInput = form.querySelector('[name="stage"]');
    const problemInput = form.querySelector('[name="problem"]');
    if (cropInput) cropInput.value = data.crop || cropInput.value || '';
    if (stageInput) stageInput.value = data.stage || stageInput.value || '';
    if (problemInput) problemInput.value = data.problem || problemInput.value || '';
  };
  applyValues();
  setTimeout(() => {
    applyValues();
    try { localStorage.removeItem(CALC_LEAD_PREFILL_KEY); } catch {}
  }, 180);
}
function calcCompareHTML({ crop = '', currentPreset = null, comparePreset = null, currentRows = [], totalWater = 0, strength = 'mid' } = {}) {
  if (!comparePreset) return '<div class="calc-compare-empty">เลือกอีก 1 สูตรเพื่อเห็นทางเลือกในจอเดียว</div>';
  const compareProducts = asArray(comparePreset.ids).map((id) => productById(id)).filter(Boolean);
  const compareRows = calcProductMixRows(compareProducts, totalWater, strength).filter((row) => !row.isSticker);
  const currentNames = currentRows.filter((row) => !row.isSticker).map((row) => row.product.name.replace(/^นุชฟอร์ไลฟ์\s*/, ''));
  const compareNames = compareRows.map((row) => row.product.name.replace(/^นุชฟอร์ไลฟ์\s*/, ''));
  const overlap = currentNames.filter((name) => compareNames.includes(name));
  const currentOnly = currentNames.filter((name) => !compareNames.includes(name));
  const compareOnly = compareNames.filter((name) => !currentNames.includes(name));
  return `<div class="calc-compare-card">
    <div class="calc-compare-cols">
      <article class="calc-compare-side is-current">
        <span>สูตรหลัก</span>
        <b>${esc(currentPreset?.title || 'สูตรที่คุณจัดเอง')}</b>
        <small>${esc(currentPreset?.note || 'สูตรที่กำลังใช้คำนวณ')}</small>
      </article>
      <article class="calc-compare-side">
        <span>สูตรเทียบ</span>
        <b>${esc(comparePreset.title)}</b>
        <small>${esc(comparePreset.note || 'อีกทางเลือกสำหรับอาการใกล้เคียง')}</small>
      </article>
    </div>
    <div class="calc-compare-points">
      <div><b>ตัวร่วม</b><span>${esc(overlap.length ? overlap.join(' + ') : 'ไม่มีรายการซ้ำ')}</span></div>
      <div><b>สูตรหลักเด่น</b><span>${esc(currentOnly.length ? currentOnly.join(' + ') : 'โทนสูตรใกล้กัน')}</span></div>
      <div><b>สูตรเทียบเด่น</b><span>${esc(compareOnly.length ? compareOnly.join(' + ') : 'โทนสูตรใกล้กัน')}</span></div>
    </div>
    <div class="calc-compare-summary">ถ้าอาการเอนไปทาง ${esc(comparePreset.stage || 'อีกระยะ')} ให้สลับเป็น ${esc(comparePreset.title)} ได้ทันที</div>
  </div>`;
}
const CALC_STAGE_TEMPLATE_OPTIONS = ['แตกใบ', 'สะสมอาหาร', 'ติดผล'];
function calcStrengthLabel(strength = 'mid') {
  return ({
    low: 'เริ่มต้น',
    mid: 'กลาง',
    high: 'เข้มขึ้น',
  }[String(strength || '').trim()] || 'กลาง');
}
function calcKnowledgeEditorProducts(data) {
  const ids = new Set([
    ...Object.keys(data?.products || {}),
    ...calcRatedProducts({ includeSticker: true }).map((item) => item.id),
  ]);
  return [...ids].map((id) => {
    const product = productById(id);
    const meta = data?.products?.[id] || {};
    return { id, product, meta };
  }).filter((item) => item.product || item.meta.label || item.meta.note);
}
function calcKnowledgeCropSummaryText(card) {
  const crop = String(card?.dataset.cropName || '').trim() || 'พืชนี้';
  const count = card?.querySelectorAll('[data-mix-row]')?.length || 0;
  return `ตั้งค่าน้ำต่อไร่และสูตรตามระยะของ${crop} · ${count} สูตร`;
}
function updateCalcKnowledgeCropSummary(card) {
  const summary = card?.querySelector('[data-calc-crop-summary]');
  if (summary) summary.textContent = calcKnowledgeCropSummaryText(card);
}
function readCalcMixEditorRow(row, { crop = '', index = 0 } = {}) {
  const stage = String(row?.querySelector('[data-mix-field="stage"]')?.value || '').trim() || CALC_STAGE_TEMPLATE_OPTIONS[0];
  const title = String(row?.querySelector('[data-mix-field="title"]')?.value || '').trim();
  const note = String(row?.querySelector('[data-mix-field="note"]')?.value || '').trim();
  const ids = [...row?.querySelectorAll?.('[data-mix-product]:checked') || []].map((input) => input.value).filter(Boolean);
  return {
    key: `${slugifyCrop(crop)}-${slugifyCrop(stage || 'stage')}-${slugifyCrop(title || `mix-${index + 1}`) || `mix-${index + 1}`}`,
    stage,
    title,
    ids,
    note,
  };
}
function calcKnowledgeMixEditorRow(mix = {}) {
  const products = calcRatedProducts({ includeSticker: true });
  const stage = String(mix?.stage || '').trim();
  const title = String(mix?.title || '').trim();
  const note = String(mix?.note || '').trim();
  const selected = new Set(asArray(mix?.ids).map((id) => String(id || '').trim()).filter(Boolean));
  return `<article class="calc-mix-editor-row" data-mix-row draggable="true">
    <div class="calc-mix-editor-head">
      <div class="calc-mix-editor-title">
        <b>สูตรย่อย</b>
        <span>ลากเพื่อจัดลำดับสูตรได้</span>
      </div>
      <div class="calc-mix-editor-tools">
        <span class="calc-mix-drag-handle" aria-hidden="true">ลากเรียง</span>
        <button class="btn-mini" type="button" data-dupmix>ทำซ้ำ</button>
        <button class="btn-mini danger" type="button" data-delmix>ลบสูตร</button>
      </div>
    </div>
    <div class="calc-mix-editor-grid">
      <label class="set-field">
        <span>ระยะพืช</span>
        <select data-mix-field="stage">
          ${CALC_STAGE_TEMPLATE_OPTIONS.map((item) => `<option value="${esc(item)}" ${item === stage ? 'selected' : ''}>${esc(item)}</option>`).join('')}
        </select>
      </label>
      <label class="set-field">
        <span>ชื่อสูตร</span>
        <input data-mix-field="title" value="${esc(title)}" placeholder="เช่น เร่งใบ ฟื้นต้น">
      </label>
      <label class="set-field lead-wide">
        <span>คำอธิบายสำหรับทีมขาย / หน้าเครื่องคำนวณ</span>
        <textarea data-mix-field="note" rows="3" placeholder="เช่น เหมาะกับช่วงเร่งใบ ฟื้นต้นหลังเก็บเกี่ยว">${esc(note)}</textarea>
      </label>
      <div class="set-field lead-wide">
        <span>สินค้าที่อยู่ในสูตรนี้</span>
        <div class="calc-mix-product-checks">
          ${products.map((product) => `<label class="chip-check">
            <input type="checkbox" data-mix-product value="${product.id}" ${selected.has(product.id) ? 'checked' : ''}>
            <span>${esc(product.name)}</span>
          </label>`).join('')}
        </div>
      </div>
    </div>
  </article>`;
}
function calcKnowledgeEditorHTML(raw = '') {
  const data = normalizeCalcKnowledge(raw);
  const cropCards = Object.entries(data.crops || {}).map(([crop, cfg]) => `
    <article class="calc-knowledge-card" data-calc-crop-card data-crop-name="${esc(crop)}">
      <div class="calc-knowledge-card-head">
        <div>
          <b>${esc(crop)}</b>
          <span data-calc-crop-summary>ตั้งค่าน้ำต่อไร่และสูตรตามระยะของพืชนี้ · ${asArray(cfg?.mixes).length} สูตร</span>
        </div>
        <div class="calc-knowledge-card-tools">
          <label class="set-field calc-knowledge-water">
            <span>น้ำต่อไร่ (ลิตร)</span>
            <input type="number" min="1" max="5000" step="1" data-crop-water value="${esc(cfg?.waterPerRai || 60)}">
          </label>
          <button class="btn-mini" type="button" data-togglecalccrop>ย่อ</button>
        </div>
      </div>
      <div class="calc-knowledge-card-body">
        <div class="calc-mix-editor-list" data-mix-list>
          ${asArray(cfg?.mixes).map((mix) => calcKnowledgeMixEditorRow(mix)).join('')}
        </div>
        <div class="calc-knowledge-card-actions">
          <button class="btn btn-glass" type="button" data-addmix>+ เพิ่มสูตรในพืชนี้</button>
        </div>
      </div>
    </article>
  `).join('');
  const productCards = calcKnowledgeEditorProducts(data).map(({ id, product, meta }) => `
    <article class="calc-product-knowledge-card" data-product-knowledge="${esc(id)}">
      <div class="calc-product-knowledge-head">
        <b>${esc(product?.name || id)}</b>
        <span>${esc(product?.short || 'ใช้ข้อความนี้เป็นคำอธิบายสั้นบนหน้าเครื่องคำนวณ')}</span>
      </div>
      <div class="calc-product-knowledge-grid">
        <label class="set-field">
          <span>คำอธิบายสั้น</span>
          <input data-product-field="label" value="${esc(meta?.label || '')}" placeholder="เช่น เร่งใบและโครงสร้างต้น">
        </label>
        <label class="set-field">
          <span>ความเข้มเริ่มต้น</span>
          <select data-product-field="preferredStrength">
            <option value="low" ${meta?.preferredStrength === 'low' ? 'selected' : ''}>เริ่มต้น</option>
            <option value="mid" ${meta?.preferredStrength !== 'low' && meta?.preferredStrength !== 'high' ? 'selected' : ''}>กลาง</option>
            <option value="high" ${meta?.preferredStrength === 'high' ? 'selected' : ''}>เข้มขึ้น</option>
          </select>
        </label>
        <label class="set-field lead-wide">
          <span>โน้ตภายใน / คำแนะนำเพิ่มเติม</span>
          <textarea data-product-field="note" rows="3" placeholder="เช่น เหมาะกับแปลงที่ต้องการฟื้นต้นหลังเครียด">${esc(meta?.note || '')}</textarea>
        </label>
      </div>
    </article>
  `).join('');
  return `<div class="calc-knowledge-editor" id="calcKnowledgeEditor">
    <div class="calc-knowledge-intro">
      <b>ตั้งค่าฐานความรู้เครื่องคำนวณผ่านฟอร์มได้เลย</b>
      <span>ระบบจะบันทึกกลับไปเป็น JSON ให้อัตโนมัติ เพื่อให้หน้าเครื่องคำนวณยังใช้โครงสร้างเดิม แต่หลังบ้านแก้ง่ายขึ้นมาก</span>
    </div>
    <div class="calc-knowledge-section">
      <div class="calc-knowledge-section-head">
        <div>
          <b>สูตรแนะนำตามพืชและระยะ</b>
          <span>แต่ละสูตรจะไปเป็น preset ในหน้าเครื่องคำนวณทันที</span>
        </div>
        <div class="calc-knowledge-toolbar">
          <button class="btn-mini" type="button" data-expandcalccrops>ขยายทั้งหมด</button>
          <button class="btn-mini" type="button" data-collapsecalccrops>ย่อทั้งหมด</button>
        </div>
      </div>
      <div class="calc-knowledge-list">${cropCards}</div>
    </div>
    <div class="calc-knowledge-section">
      <div class="calc-knowledge-section-head">
        <div>
          <b>ข้อความประกอบรายสินค้า</b>
          <span>ไว้ควบคุมคำอธิบายสั้นและความเข้มเริ่มต้นของแต่ละตัว</span>
        </div>
      </div>
      <div class="calc-product-knowledge-list">${productCards}</div>
    </div>
  </div>`;
}
function serializeCalcKnowledgeEditor(root = document) {
  const data = { crops: {}, products: {} };
  root.querySelectorAll('[data-calc-crop-card]').forEach((card) => {
    const crop = String(card.dataset.cropName || '').trim();
    if (!crop) return;
    const waterPerRai = Math.max(1, parseFloat(card.querySelector('[data-crop-water]')?.value || '60') || 60);
    const mixes = [...card.querySelectorAll('[data-mix-row]')].map((row, idx) => {
      const stage = String(row.querySelector('[data-mix-field="stage"]')?.value || '').trim() || CALC_STAGE_TEMPLATE_OPTIONS[0];
      const title = String(row.querySelector('[data-mix-field="title"]')?.value || '').trim();
      const note = String(row.querySelector('[data-mix-field="note"]')?.value || '').trim();
      const ids = [...row.querySelectorAll('[data-mix-product]:checked')].map((input) => input.value).filter(Boolean);
      return {
        key: `${slugifyCrop(crop)}-${slugifyCrop(stage || 'stage')}-${slugifyCrop(title || `mix-${idx + 1}`) || `mix-${idx + 1}`}`,
        stage,
        title,
        ids,
        note,
      };
    }).filter((item) => item.title && item.ids.length);
    data.crops[crop] = { waterPerRai, mixes };
  });
  root.querySelectorAll('[data-product-knowledge]').forEach((card) => {
    const id = String(card.dataset.productKnowledge || '').trim();
    if (!id) return;
    data.products[id] = {
      label: String(card.querySelector('[data-product-field="label"]')?.value || '').trim(),
      preferredStrength: String(card.querySelector('[data-product-field="preferredStrength"]')?.value || 'mid').trim(),
      note: String(card.querySelector('[data-product-field="note"]')?.value || '').trim(),
    };
  });
  return JSON.stringify(data, null, 2);
}
function syncCalcKnowledgeEditor(root = document) {
  const input = root.querySelector('#calcKnowledgeJson');
  if (!input) return '';
  const raw = serializeCalcKnowledgeEditor(root);
  input.value = raw;
  return raw;
}
function setCalcCropEditorCollapsed(card, collapsed = false) {
  if (!card) return;
  card.classList.toggle('is-collapsed', !!collapsed);
  const btn = card.querySelector('[data-togglecalccrop]');
  if (btn) btn.textContent = collapsed ? 'ขยาย' : 'ย่อ';
  updateCalcKnowledgeCropSummary(card);
}
async function copyTextToClipboard(text = '') {
  const value = String(text || '');
  if (!value) return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {}
  }
  const holder = document.createElement('textarea');
  holder.value = value;
  holder.setAttribute('readonly', 'readonly');
  holder.style.position = 'fixed';
  holder.style.opacity = '0';
  holder.style.pointerEvents = 'none';
  document.body.appendChild(holder);
  holder.select();
  holder.setSelectionRange(0, holder.value.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  holder.remove();
  return ok;
}
function calcUsageMode() {
  return window.__calcMode || 'tank';
}
function setCalcUsageMode(mode) {
  window.__calcMode = ['tank', 'water', 'area'].includes(mode) ? mode : 'tank';
}
function calcModeFields() {
  const mode = calcUsageMode();
  const tankSize = parseFloat(document.getElementById('calcPageTank')?.value || '20') || 20;
  const tankCount = parseFloat(document.getElementById('calcTankCount')?.value || '1') || 1;
  const waterTotal = parseFloat(document.getElementById('calcWaterTotal')?.value || '20') || 20;
  const areaRai = parseFloat(document.getElementById('calcAreaRai')?.value || '1') || 1;
  const waterPerRai = parseFloat(document.getElementById('calcWaterPerRai')?.value || '60') || 60;
  const refTank = parseFloat(document.getElementById('calcRefTank')?.value || tankSize || '20') || 20;
  const totalWater = mode === 'tank'
    ? tankSize * tankCount
    : mode === 'water'
      ? waterTotal
      : areaRai * waterPerRai;
  return { mode, tankSize, tankCount, waterTotal, areaRai, waterPerRai, refTank, totalWater };
}
function renderCalcModeState() {
  const mode = calcUsageMode();
  const page = document.querySelector('.calc-page');
  if (page) page.dataset.calcMode = mode;
  document.querySelectorAll('[data-calcmode]').forEach((btn) => btn.classList.toggle('on', btn.dataset.calcmode === mode));
}
function calcHintsHTML(p, profile, totalWater, strength, includeSticker) {
  const hints = [];
  const extra = productExtra(p);
  if (profile.research?.title) hints.push(profile.research.title);
  if (profile.research?.interval) hints.push(`รอบพ่นแนะนำ: ${profile.research.interval}`);
  if (asArray(extra.cropTargets).length) hints.push(`เหมาะกับ ${extra.cropTargets.join(' / ')}`);
  if (totalWater > 0) hints.push(`น้ำรวม ${fmtCalcNumber(totalWater)} ลิตร`);
  if (strength === 'low') hints.push('โหมดเริ่มต้น: เหมาะกับการเริ่มลองหรือพืชอ่อน');
  if (strength === 'high') hints.push('โหมดเข้ม: เหมาะกับแปลงที่ต้องการคุมผลลัพธ์เข้มขึ้น');
  if (includeSticker && profile.stickerProduct) hints.push(`เพิ่ม ${profile.stickerProduct.name} เพื่อช่วยการเกาะใบ`);
  return hints.slice(0, 6).map((item) => `<span>${esc(item)}</span>`).join('');
}
function isAgriProduct(p) { return productSegment(p) === 'agri'; }
function lineCTA(extraClass = '') {
  const url = S('LINE_OA_URL');
  const cls = ['line-add', extraClass].filter(Boolean).join(' ');
  return url ? `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener" data-linecta>เพิ่มเพื่อน LINE</a>` : '';
}
function orgTrustHTML({ compact = false } = {}) {
  const items = [
    ['ส่งทั่วไทย', 'แพ็กและจัดส่งพร้อมเลขติดตามออเดอร์'],
    ['ปรึกษาก่อนซื้อ', 'ให้ทีมช่วยเลือกสินค้าให้ตรงปัญหาและงบประมาณ'],
    ['ชำระปลอดภัย', 'รองรับ PromptPay และบัตรผ่านระบบชำระเงิน'],
    ['ดูแลหลังสั่งซื้อ', 'ลูกค้าติดตามสถานะและทักแชทต่อได้ทันที'],
  ];
  return `<div class="org-trust ${compact ? 'is-compact' : ''}">
    ${items.map(([title, desc]) => `<article><b>${esc(title)}</b><span>${esc(desc)}</span></article>`).join('')}
  </div>`;
}
function buyingStepsHTML() {
  const steps = [
    ['เลือกสินค้า', 'ดูรายละเอียด วิธีใช้ รีวิว และชุดแนะนำ'],
    ['กรอกข้อมูล', 'ระบุผู้รับ เบอร์โทร ที่อยู่ และช่องทางชำระเงิน'],
    ['ชำระเงิน', 'สแกน QR หรือชำระผ่านบัตร แล้วแจ้งสลิปได้ในหน้าออเดอร์'],
    ['ติดตามผล', 'ระบบแสดงสถานะออเดอร์ เลขพัสดุ และแชทกับทีมได้'],
  ];
  return `<div class="buying-steps">
    ${steps.map(([title, desc], index) => `<article><i>${index + 1}</i><b>${esc(title)}</b><span>${esc(desc)}</span></article>`).join('')}
  </div>`;
}
function storeFaqHTML({ product = null } = {}) {
  const productName = product?.name || 'สินค้า';
  const items = [
    ['ต้องเลือกสูตรไหนก่อน?', product ? `ถ้ายังไม่แน่ใจ ให้ทักแชทพร้อมบอกปัญหา ทีมจะช่วยดูว่า ${productName} เหมาะกับเป้าหมายของคุณหรือควรเริ่มจากชุดไหน` : 'เริ่มจากดูหมวดสินค้า รีวิว และทักแชทให้ทีมช่วยจับคู่สินค้าให้ตรงปัญหาได้'],
    ['ชำระเงินแล้วต้องทำอะไรต่อ?', 'หลังสั่งซื้อจะได้หน้าออเดอร์สำหรับสแกนจ่าย อัปโหลดสลิป และติดตามสถานะได้ในลิงก์เดียว'],
    ['ติดตามพัสดุได้ไหม?', 'ได้ เมื่อแอดมินใส่เลขพัสดุ ระบบจะแสดงในหน้าติดตามออเดอร์และเก็บไว้ให้กลับมาดูภายหลัง'],
    ['ขอคำแนะนำหลังซื้อได้ไหม?', 'ได้ ลูกค้าทักแชทต่อจากหน้าเว็บหรือ LINE ได้ ทีมจะเห็นบริบทออเดอร์และช่วยตอบต่อเนื่อง'],
  ];
  return `<div class="faq-grid">
    ${items.map(([q, a]) => `<details class="faq-item"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}
  </div>`;
}
function corporateFooterHTML() {
  const contacts = supportContacts();
  const brand = S('SITE_BRAND') || 'นุชฟอร์ไลฟ์';
  return `<section class="section corporate-footer reveal">
    <div class="corp-footer-grid glass">
      <div class="corp-footer-brand">
        <span class="brand-dot"></span>
        <h2>${esc(brand)}</h2>
        <p>${esc(S('SITE_HERO_SUB') || 'ผลิตภัณฑ์และคำแนะนำจากทีมงาน พร้อมระบบสั่งซื้อและติดตามออเดอร์ออนไลน์')}</p>
      </div>
      <div>
        <h3>เมนูหลัก</h3>
        <a href="${routeHref('/products')}">สินค้า</a>
        <a href="${routeHref('/reviews')}">รีวิวลูกค้า</a>
        <a href="${routeHref('/community')}">ชุมชน</a>
        <a href="${routeHref('/track')}">ติดตามออเดอร์</a>
      </div>
      <div>
        <h3>บริการลูกค้า</h3>
        <a href="${routeHref('/about')}">เกี่ยวกับเรา</a>
        <a href="${routeHref('/checkout')}">วิธีสั่งซื้อ</a>
        <a href="${routeHref('/track')}">ตรวจสอบสถานะ</a>
        ${contacts.line ? `<a href="${esc(contacts.line)}" target="_blank" rel="noopener">LINE Official</a>` : ''}
      </div>
      <div>
        <h3>ติดต่อ</h3>
        <p>${esc(contacts.phone || S('SITE_PHONE') || 'ติดต่อผ่าน Live Chat')}</p>
        <p>${esc(contacts.email || S('SMTP_FROM') || 'พร้อมตอบคำถามลูกค้า')}</p>
        <p>เวลาตอบกลับ: ทุกวันตามคิวแอดมิน</p>
      </div>
    </div>
  </section>`;
}
function normalizeLineContactValue(value = '') {
  return String(value || '').trim().replace(/^@+/, '');
}
function lineUrlFromId(id = '') {
  const clean = normalizeLineContactValue(id);
  return clean ? `https://line.me/ti/p/~${encodeURIComponent(clean)}` : '';
}
function supportContacts() {
  const primaryPhone = String(S('CONTACT_PRIMARY_PHONE') || '0924842250').trim();
  const secondaryPhone = String(S('CONTACT_SECONDARY_PHONE') || '0851239829').trim();
  const lineId = normalizeLineContactValue(S('CONTACT_LINE_ID') || '0924842250');
  const lineOfficialIdRaw = String(S('CONTACT_LINE_OA_ID') || '@221fmmrs').trim();
  const lineOfficialId = lineOfficialIdRaw ? (lineOfficialIdRaw.startsWith('@') ? lineOfficialIdRaw : `@${lineOfficialIdRaw}`) : '';
  return {
    phones: [
      { label: S('CONTACT_PRIMARY_LABEL') || 'คุณจูน นุชฟอร์ไลฟ์', number: primaryPhone },
      { label: S('CONTACT_SECONDARY_LABEL') || 'เบอร์ร้าน / คุณจูน', number: secondaryPhone },
    ],
    lineId,
    linePersonalUrl: String(S('CONTACT_LINE_PERSONAL_URL') || '').trim() || lineUrlFromId(lineId),
    lineOfficialId,
    lineOfficialUrl: S('LINE_OA_URL') || (lineOfficialId ? `https://page.line.me/${normalizeLineContactValue(lineOfficialId)}` : ''),
  };
}
function setFloatingContactDockCollapsed(next) {
  _contactDockCollapsed = Boolean(next);
  try { localStorage.setItem(CONTACT_DOCK_COLLAPSED_KEY, _contactDockCollapsed ? '1' : '0'); } catch {}
  renderFloatingContactDock();
}
function renderFloatingContactDock(path = currentPath()) {
  const isAdmin = path.startsWith('/admin');
  let dock = document.getElementById('floatingContactDock');
  if (isAdmin) {
    dock?.remove();
    return;
  }
  const contacts = supportContacts();
  if (!dock) {
    dock = document.createElement('div');
    dock.id = 'floatingContactDock';
    document.body.appendChild(dock);
  }
  const shouldHide = window.innerWidth <= 960 && Boolean(chatBox?.classList.contains('open'));
  dock.className = `floating-contact-dock${_contactDockCollapsed ? ' is-collapsed' : ''}${shouldHide ? ' is-hidden' : ''}`;
  dock.innerHTML = `
    <div class="floating-contact-card${_contactDockCollapsed ? ' is-collapsed' : ''}">
      <button class="floating-contact-toggle" type="button" data-togglecontactdock aria-expanded="${_contactDockCollapsed ? 'false' : 'true'}">${_contactDockCollapsed ? 'เปิด' : 'ย่อ'}</button>
      <span class="floating-contact-title">${esc(S('SITE_DOCK_TITLE'))}</span>
      <p>${esc(S('SITE_DOCK_BODY'))}</p>
      <div class="floating-contact-actions">
        <button class="floating-contact-btn is-livechat" type="button" data-openchat>
          <span class="livechat-status"><span></span></span>
          <span>${esc(S('SITE_DOCK_LIVECHAT_LABEL'))}</span>
        </button>
        <a class="floating-contact-btn is-call" href="tel:${contacts.phones[0].number}">${esc(S('SITE_DOCK_CALL_LABEL'))}</a>
        <a class="floating-contact-btn is-personal" href="${esc(contacts.linePersonalUrl)}" target="_blank" rel="noopener">${esc(S('SITE_DOCK_PERSONAL_LABEL'))}</a>
        <a class="floating-contact-btn is-line" href="${esc(contacts.lineOfficialUrl)}" target="_blank" rel="noopener">${esc(S('SITE_DOCK_OA_LABEL'))}</a>
      </div>
      <button class="floating-contact-quicklive" type="button" data-openchat aria-label="เปิด LIVECHAT">
        <span class="livechat-status"><span></span></span>
        <span>${esc(S('SITE_DOCK_LIVECHAT_LABEL'))}</span>
      </button>
    </div>`;
}

// ── analytics / pixels ──
const loadedScripts = new Set();
const CONTACT_DOCK_COLLAPSED_KEY = 'floating_contact_dock_collapsed_v1';
let _contactDockCollapsed = (() => {
  try { return localStorage.getItem(CONTACT_DOCK_COLLAPSED_KEY) === '1'; } catch { return false; }
})();
let marketingReady = false;
function loadScriptOnce(src) {
  if (!src || loadedScripts.has(src)) return;
  loadedScripts.add(src);
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}
function initMarketing() {
  if (marketingReady) return;
  marketingReady = true;
  const ga4 = S('GA4_ID').trim();
  if (ga4) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    loadScriptOnce(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4)}`);
    window.gtag('js', new Date());
    window.gtag('config', ga4, { send_page_view: false });
  }
  const meta = S('META_PIXEL_ID').trim();
  if (meta && !window.fbq) {
    window.fbq = function () { (window.fbq.q = window.fbq.q || []).push(arguments); };
    window.fbq.q = window.fbq.q || [];
    window.fbq.loaded = true;
    window.fbq.version = '2.0';
    loadScriptOnce('https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', meta);
  }
  const tiktok = S('TIKTOK_PIXEL_ID').trim();
  if (tiktok && !window.ttq) {
    const ttq = window.ttq = window.ttq || [];
    ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie'];
    ttq.setAndDefer = function (t, e) { t[e] = function () { t.push([e].concat([].slice.call(arguments, 0))); }; };
    for (let i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
    ttq.instance = function (t) { const e = ttq._i[t] || []; for (let n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(e, ttq.methods[n]); return e; };
    ttq._i = ttq._i || {};
    ttq._i[tiktok] = [];
    ttq.load = ttq.load || function () { loadScriptOnce('https://analytics.tiktok.com/i18n/pixel/events.js'); };
    ttq.load(tiktok);
    ttq.page();
  }
}
function trackEvent(name, params = {}) {
  initMarketing();
  const payload = { ...params };
  if (window.gtag && S('GA4_ID')) window.gtag('event', name, payload);
  if (window.fbq && S('META_PIXEL_ID')) {
    const map = { page_view: 'PageView', lead_submit: 'Lead', begin_checkout: 'InitiateCheckout', purchase: 'Purchase', line_click: 'Contact' };
    if (map[name]) window.fbq('track', map[name], payload);
    else window.fbq('trackCustom', name, payload);
  }
  if (window.ttq && S('TIKTOK_PIXEL_ID')) {
    const map = { page_view: 'PageView', lead_submit: 'SubmitForm', begin_checkout: 'InitiateCheckout', purchase: 'CompletePayment', line_click: 'Contact' };
    window.ttq.track(map[name] || name, payload);
  }
}
function trackPageView(path, title = document.title) {
  trackEvent('page_view', { page_path: path, page_title: title });
}
function markTracked(key) {
  if (!key) return false;
  if (sessionStorage.getItem(key)) return true;
  sessionStorage.setItem(key, '1');
  return false;
}

// ── marketing attribution / lead source ──
const ATTR_KEY = 'leadAttribution';
let leadAttribution = {};
function loadAttribution() {
  try { return JSON.parse(localStorage.getItem(ATTR_KEY) || '{}') || {}; }
  catch { return {}; }
}
function saveAttribution() { localStorage.setItem(ATTR_KEY, JSON.stringify(leadAttribution)); }
function detectSourceLabel(hostname) {
  if (!hostname) return 'referral';
  if (hostname.includes('facebook') || hostname.includes('fb.')) return 'facebook';
  if (hostname.includes('instagram')) return 'instagram';
  if (hostname.includes('google')) return 'google';
  if (hostname.includes('line')) return 'line';
  if (hostname.includes('tiktok')) return 'tiktok';
  return hostname.replace(/^www\./, '');
}
function captureAttribution() {
  const url = new URL(location.href);
  const next = { ...loadAttribution() };
  const utmSource = (url.searchParams.get('utm_source') || '').trim();
  const utmMedium = (url.searchParams.get('utm_medium') || '').trim();
  const utmCampaign = (url.searchParams.get('utm_campaign') || '').trim();
  if (utmSource) next.utmSource = utmSource;
  if (utmMedium) next.utmMedium = utmMedium;
  if (utmCampaign) next.utmCampaign = utmCampaign;
  if (!next.source) {
    if (utmSource) next.source = `${utmSource}${utmMedium ? '/' + utmMedium : ''}`;
    else if (document.referrer) {
      try { next.source = detectSourceLabel(new URL(document.referrer).hostname); }
      catch { next.source = 'referral'; }
    } else next.source = 'direct';
  }
  next.landingPage = url.pathname + url.search + url.hash;
  next.capturedAt = next.capturedAt || Date.now();
  leadAttribution = next;
  saveAttribution();
}

function renderAccountNav() {
  const el = document.getElementById('navAccount');
  if (!el) return;
  if (currentUser) {
    const accountLabel = accountRoleLabel(currentUser);
    el.innerHTML =
      (canAccessAdminShellClient(currentUser) ? `<a href="${adminEntryHref(adminDefaultRoute(currentUser))}" class="nav-admin" style="background:linear-gradient(135deg,#7b5cff,#9c63ff);background-color:#7b5cff;color:#fff;-webkit-text-fill-color:#fff;border-color:transparent;box-shadow:0 16px 28px -18px rgba(123,92,255,.75)">${isChatAdminClient(currentUser) ? 'ตอบแชท' : 'หลังบ้าน'}</a>` : '') +
      `<a href="${routeHref('/account')}" class="nav-acc">${accountLabel}</a>`;
  } else {
    el.innerHTML = `<a href="${routeHref('/login')}" class="nav-acc">เข้าสู่ระบบ</a>`;
  }
}
function renderSecureAdminNav(path = currentPath()) {
  const navLinks = document.getElementById('navLinks');
  if (!navLinks) return;
  navLinks.innerHTML = renderPublicNavLinks(path);
  setActiveNav(path);
}

let mobileNavOpen = false;
function isMobileNav() { return window.innerWidth <= 980; }
function syncMobileNav() {
  const nav = document.querySelector('.nav');
  const panel = document.getElementById('navPanel');
  const burger = document.getElementById('navBurger');
  const dim = document.getElementById('navDim');
  if (!nav || !panel || !burger || !dim) return;
  const open = isMobileNav() && mobileNavOpen;
  nav.classList.toggle('menu-open', open);
  panel.classList.toggle('open', open);
  burger.classList.toggle('open', open);
  burger.setAttribute('aria-expanded', open ? 'true' : 'false');
  dim.classList.toggle('show', open);
  document.body.classList.toggle('nav-open', open);
}
function closeMobileNav() {
  if (!mobileNavOpen) return;
  mobileNavOpen = false;
  syncMobileNav();
}
function toggleMobileNav() {
  if (!isMobileNav()) return;
  mobileNavOpen = !mobileNavOpen;
  syncMobileNav();
}

// toast
function toast(msg, type = 'info') {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.className = 'toast show ' + type;
  clearTimeout(t._t); t._t = setTimeout(() => (t.className = 'toast'), 2800);
}
function closeConfirmDialog(answer = false) {
  const dialog = document.getElementById('confirmDialog');
  if (!dialog) return;
  const done = dialog._resolve;
  dialog._resolve = null;
  dialog.classList.remove('show');
  setTimeout(() => dialog.remove(), 180);
  if (typeof done === 'function') done(Boolean(answer));
}
function confirmDialog({
  title = 'ยืนยันการทำรายการ',
  message = 'คุณต้องการดำเนินการต่อหรือไม่',
  confirmText = 'ยืนยัน',
  cancelText = 'ยกเลิก',
  tone = 'danger',
} = {}) {
  return new Promise((resolve) => {
    const prev = document.getElementById('confirmDialog');
    if (prev) prev.remove();
    const dialog = document.createElement('div');
    dialog.id = 'confirmDialog';
    dialog.className = 'confirm-overlay';
    dialog.innerHTML = `<div class="confirm-card glass" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <button class="confirm-close" type="button" aria-label="ปิด" data-confirmcancel>✕</button>
      <span class="confirm-pill ${tone}">${tone === 'danger' ? 'ลบข้อมูล' : 'ยืนยัน'}</span>
      <h3>${esc(title)}</h3>
      <p>${esc(message)}</p>
      <div class="confirm-actions">
        <button class="btn btn-glass" type="button" data-confirmcancel>${esc(cancelText)}</button>
        <button class="btn btn-primary ${tone === 'danger' ? 'btn-danger' : ''}" type="button" data-confirmok>${esc(confirmText)}</button>
      </div>
    </div>`;
    dialog._resolve = resolve;
    document.body.appendChild(dialog);
    requestAnimationFrame(() => dialog.classList.add('show'));
    dialog.querySelector('[data-confirmok]')?.focus();
  });
}

const PRODUCT_CROP_ASPECTS = {
  original: { label: 'เดิม', ratio: null },
  square: { label: '1:1', ratio: 1 },
  portrait: { label: '4:5', ratio: 4 / 5 },
  landscape: { label: '16:9', ratio: 16 / 9 },
};
let imageCropperState = null;
function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function cropAspectRatio(key, image) {
  const preset = PRODUCT_CROP_ASPECTS[key] || PRODUCT_CROP_ASPECTS.original;
  return preset.ratio || Math.max(0.2, (image?.naturalWidth || 1) / Math.max(1, image?.naturalHeight || 1));
}
function cropStageSize(ratio = 1) {
  const maxW = 620;
  const maxH = 430;
  if (ratio >= 1) {
    let width = maxW;
    let height = width / ratio;
    if (height > maxH) { height = maxH; width = height * ratio; }
    return { width: Math.round(width), height: Math.round(height) };
  }
  let height = maxH;
  let width = height * ratio;
  if (width > maxW) { width = maxW; height = width / ratio; }
  return { width: Math.round(width), height: Math.round(height) };
}
function cropImageType(dataUrl = '') {
  const match = /^data:(image\/[a-z0-9.+-]+);/i.exec(String(dataUrl || '').trim());
  return match?.[1]?.toLowerCase() || 'image/jpeg';
}
function productDraftId() {
  return `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function productMediaBadge(cropped = false) {
  return cropped ? '<span class="pf-media-badge">ครอปแล้ว</span>' : '<span class="pf-media-badge muted">ต้นฉบับ</span>';
}
function productMediaCard({ title = '', image = '', note = '', actions = '', cropped = false } = {}) {
  return `<div class="pf-media-card glass">
    <div class="pf-media-thumb ${image ? '' : 'is-empty'}">${image ? `<img src="${esc(image)}">` : '<span>ยังไม่มีรูป</span>'}</div>
    <div class="pf-media-copy">
      <div class="pf-media-head"><b>${esc(title)}</b>${productMediaBadge(cropped)}</div>
      ${note ? `<span class="pf-media-note">${esc(note)}</span>` : ''}
      ${actions ? `<div class="pf-media-actions">${actions}</div>` : ''}
    </div>
  </div>`;
}
function ensureProductFormCropState(form) {
  if (!form) return;
  if (!form._productImageDraft) form._productImageDraft = null;
  if (!Array.isArray(form._productGalleryDrafts)) form._productGalleryDrafts = [];
  if (!form._productExistingGalleryEdits || typeof form._productExistingGalleryEdits !== 'object') form._productExistingGalleryEdits = {};
  renderProductImageDraft(form);
  renderProductGalleryDrafts(form);
}
function resolveProductExistingGalleryImages(form) {
  const hidden = form?.querySelector('[name=existingImages]');
  const images = JSON.parse(hidden?.value || '[]');
  const edits = form?._productExistingGalleryEdits || {};
  return images.map((image, index) => edits[index]?.croppedDataUrl || image);
}
function renderProductImageDraft(form) {
  const wrap = form?.querySelector('[data-product-image-draft]');
  if (!wrap) return;
  const current = String(form.querySelector('[name=existingImage]')?.value || '').trim();
  const draft = form._productImageDraft;
  if (draft?.sourceDataUrl) {
    const displayImage = draft.croppedDataUrl || draft.sourceValue || draft.sourceDataUrl;
    wrap.innerHTML = productMediaCard({
      title: draft.fileName || 'รูปสินค้าใหม่',
      image: displayImage,
      note: draft.croppedDataUrl ? 'ใช้รูปที่ครอปแล้วเป็นรูปหลักของสินค้า' : (draft.sourceValue ? 'เลือกรูปเดิมมาแก้ครอปก่อนบันทึกได้' : 'เลือกรูปใหม่แล้ว สามารถครอปก่อนบันทึกได้'),
      cropped: Boolean(draft.croppedDataUrl),
      actions: `<button class="btn-mini" type="button" data-crop-product-image>ครอปรูปหลัก</button>
        <button class="btn-mini" type="button" data-clear-product-image>ล้างรูปใหม่</button>`,
    });
    return;
  }
  wrap.innerHTML = current
    ? productMediaCard({ title: 'รูปหลักปัจจุบัน', image: current, note: 'กดครอปจากรูปเดิมได้ หรือเลือกรูปใหม่เพื่อแทนที่', cropped: true, actions: '<button class="btn-mini" type="button" data-crop-existing-product-image>ครอปจากรูปเดิม</button>' })
    : productMediaCard({ title: 'รูปหลักสินค้า', image: '', note: 'ยังไม่ได้เลือกรูปใหม่ สามารถอัปโหลดแล้วครอปเองได้' });
}
function renderProductGalleryDrafts(form) {
  const wrap = form?.querySelector('[data-product-gallery-draft]');
  if (!wrap) return;
  const existingImages = JSON.parse(form.querySelector('[name=existingImages]')?.value || '[]');
  const editedExistingImages = resolveProductExistingGalleryImages(form);
  const drafts = Array.isArray(form._productGalleryDrafts) ? form._productGalleryDrafts : [];
  const existing = existingImages.length ? `<div class="pf-media-block">
    <span class="pf-media-label">รูปแกลเลอรีปัจจุบัน</span>
    <div class="pf-media-grid">${editedExistingImages.map((image, index) => productMediaCard({
      title: `รูปเดิม ${index + 1}`,
      image,
      note: image !== existingImages[index] ? 'ครอปใหม่แล้ว พร้อมบันทึก' : 'รูปเดิมในระบบ สามารถครอปใหม่ได้',
      cropped: image !== existingImages[index] || Boolean(image),
      actions: `<button class="btn-mini" type="button" data-crop-existing-gallery-item="${index}">ครอปจากรูปเดิม</button>`,
    })).join('')}</div>
  </div>` : '';
  const draftCards = drafts.length ? `<div class="pf-media-block">
    <span class="pf-media-label">รูปใหม่ที่เลือก</span>
    <div class="pf-media-grid">${drafts.map((item, index) => productMediaCard({
      title: item.fileName || `รูปใหม่ ${index + 1}`,
      image: item.croppedDataUrl || item.sourceDataUrl,
      note: item.croppedDataUrl ? 'ครอปแล้ว พร้อมบันทึก' : 'กดครอปก่อนบันทึกได้',
      cropped: Boolean(item.croppedDataUrl),
      actions: `<button class="btn-mini" type="button" data-crop-gallery-item="${item.id}">ครอปรูปนี้</button>
        <button class="btn-mini" type="button" data-remove-gallery-item="${item.id}">เอาออก</button>`,
    })).join('')}</div>
  </div>` : '<div class="pf-media-empty">ยังไม่มีรูปใหม่ในแกลเลอรี</div>';
  wrap.innerHTML = `${existing}${draftCards}`;
}
function ensureArticleFormCropState(form) {
  if (!form) return;
  if (!form._articleCoverDraft) form._articleCoverDraft = null;
  renderArticleCoverDraft(form);
}
function renderArticleCoverDraft(form) {
  const wrap = form?.querySelector('[data-article-cover-draft]');
  if (!wrap) return;
  const current = String(form.querySelector('[name=existingCover]')?.value || '').trim();
  const draft = form._articleCoverDraft;
  if (draft?.sourceDataUrl) {
    wrap.innerHTML = productMediaCard({
      title: draft.fileName || 'รูปปกบทความใหม่',
      image: draft.croppedDataUrl || draft.sourceDataUrl,
      note: draft.croppedDataUrl ? 'ใช้รูปที่ครอปแล้วเป็นรูปปกบทความ' : 'เลือกรูปใหม่แล้ว สามารถครอปก่อนบันทึกได้',
      cropped: Boolean(draft.croppedDataUrl),
      actions: `<button class="btn-mini" type="button" data-crop-article-cover>ครอปรูปปก</button>
        <button class="btn-mini" type="button" data-clear-article-cover>ล้างรูปใหม่</button>`,
    });
    return;
  }
  wrap.innerHTML = current
    ? productMediaCard({
      title: 'รูปปกปัจจุบัน',
      image: current,
      note: 'กดครอปจากรูปเดิมได้ หรือเลือกรูปใหม่เพื่อแทนที่',
      cropped: true,
      actions: '<button class="btn-mini" type="button" data-crop-existing-article-cover>ครอปจากรูปเดิม</button>',
    })
    : productMediaCard({ title: 'รูปปกบทความ', image: '', note: 'ยังไม่ได้เลือกรูปใหม่ สามารถอัปโหลดแล้วครอปเองได้' });
}
function closeImageCropper(result = null) {
  const overlay = document.getElementById('imageCropper');
  const done = imageCropperState?.resolve;
  if (imageCropperState?.cleanup) imageCropperState.cleanup();
  imageCropperState = null;
  if (overlay) {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 180);
  }
  if (typeof done === 'function') done(result);
}
function renderImageCropper() {
  const state = imageCropperState;
  const overlay = document.getElementById('imageCropper');
  if (!state || !overlay) return;
  const ratio = cropAspectRatio(state.aspect, state.image);
  const { width, height } = cropStageSize(ratio);
  state.stageWidth = width;
  state.stageHeight = height;
  const scale = state.baseScale * state.zoom;
  const minX = Math.min(0, width - (state.image.naturalWidth * scale));
  const minY = Math.min(0, height - (state.image.naturalHeight * scale));
  state.x = clampNumber(state.x, minX, 0);
  state.y = clampNumber(state.y, minY, 0);
  const viewport = overlay.querySelector('[data-cropviewport]');
  const image = overlay.querySelector('[data-cropimage]');
  const zoom = overlay.querySelector('[data-cropzoom]');
  const zoomText = overlay.querySelector('[data-cropzoomtext]');
  overlay.querySelectorAll('[data-cropaspect]').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.cropaspect === state.aspect));
  if (viewport) {
    viewport.style.width = `${width}px`;
    viewport.style.height = `${height}px`;
  }
  if (image) {
    image.style.width = `${state.image.naturalWidth}px`;
    image.style.height = `${state.image.naturalHeight}px`;
    image.style.transform = `translate(${state.x}px, ${state.y}px) scale(${scale})`;
  }
  if (zoom) zoom.value = String(state.zoom);
  if (zoomText) zoomText.textContent = `${Math.round(state.zoom * 100)}%`;
}
function resetImageCropperPosition() {
  const state = imageCropperState;
  if (!state) return;
  state.baseScale = Math.max(state.stageWidth / state.image.naturalWidth, state.stageHeight / state.image.naturalHeight);
  state.zoom = 1;
  state.x = (state.stageWidth - (state.image.naturalWidth * state.baseScale)) / 2;
  state.y = (state.stageHeight - (state.image.naturalHeight * state.baseScale)) / 2;
  renderImageCropper();
}
function applyImageCropperAspect(aspect = 'original') {
  const state = imageCropperState;
  if (!state) return;
  state.aspect = aspect in PRODUCT_CROP_ASPECTS ? aspect : 'original';
  const ratio = cropAspectRatio(state.aspect, state.image);
  const { width, height } = cropStageSize(ratio);
  state.stageWidth = width;
  state.stageHeight = height;
  resetImageCropperPosition();
}
function exportCroppedImage() {
  const state = imageCropperState;
  if (!state) return null;
  const scale = state.baseScale * state.zoom;
  const sourceX = Math.max(0, (0 - state.x) / scale);
  const sourceY = Math.max(0, (0 - state.y) / scale);
  const sourceW = Math.min(state.image.naturalWidth - sourceX, state.stageWidth / scale);
  const sourceH = Math.min(state.image.naturalHeight - sourceY, state.stageHeight / scale);
  const aspect = state.stageWidth / state.stageHeight;
  const targetW = Math.max(1, Math.min(1600, Math.round(sourceW)));
  const targetH = Math.max(1, Math.round(targetW / aspect));
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(state.image, sourceX, sourceY, sourceW, sourceH, 0, 0, targetW, targetH);
  const type = cropImageType(state.sourceDataUrl) === 'image/png' ? 'image/png' : 'image/jpeg';
  return canvas.toDataURL(type, 0.92);
}
async function openImageCropper({ sourceDataUrl = '', title = 'ครอปรูปภาพ', confirmText = 'ใช้รูปนี้', aspect = 'original' } = {}) {
  const src = String(sourceDataUrl || '').trim();
  if (!src) return null;
  return new Promise((resolve) => {
    const prev = document.getElementById('imageCropper');
    if (prev) prev.remove();
    const overlay = document.createElement('div');
    overlay.id = 'imageCropper';
    overlay.className = 'imgcrop-overlay';
    overlay.innerHTML = `<div class="imgcrop-card glass" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <button class="imgcrop-close" type="button" aria-label="ปิด" data-cropcancel>✕</button>
      <div class="imgcrop-head">
        <span class="confirm-pill">ครอปภาพ</span>
        <h3>${esc(title)}</h3>
        <p>ลากรูปเพื่อจัดองค์ประกอบ แล้วกดบันทึกรูปที่ครอป</p>
      </div>
      <div class="imgcrop-toolbar">
        ${Object.entries(PRODUCT_CROP_ASPECTS).map(([key, item]) => `<button class="btn-mini" type="button" data-cropaspect="${key}">${esc(item.label)}</button>`).join('')}
      </div>
      <div class="imgcrop-stage-wrap">
        <div class="imgcrop-stage" data-cropviewport><img data-cropimage alt=""></div>
      </div>
      <div class="imgcrop-controls">
        <label>ซูมภาพ<input type="range" min="1" max="3" step="0.01" value="1" data-cropzoom></label>
        <span class="imgcrop-zoom" data-cropzoomtext>100%</span>
        <button class="btn-mini" type="button" data-cropreset>รีเซ็ต</button>
      </div>
      <div class="imgcrop-actions">
        <button class="btn btn-glass" type="button" data-cropuseoriginal>ใช้ต้นฉบับ</button>
        <button class="btn btn-glass" type="button" data-cropcancel>ยกเลิก</button>
        <button class="btn btn-primary" type="button" data-cropconfirm>${esc(confirmText)}</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const image = new Image();
    image.onload = () => {
      imageCropperState = {
        resolve,
        sourceDataUrl: src,
        image,
        aspect,
        baseScale: 1,
        zoom: 1,
        x: 0,
        y: 0,
      };
      const onMove = (event) => {
        if (!imageCropperState?.dragging) return;
        event.preventDefault();
        imageCropperState.x = imageCropperState.dragging.originX + (event.clientX - imageCropperState.dragging.startX);
        imageCropperState.y = imageCropperState.dragging.originY + (event.clientY - imageCropperState.dragging.startY);
        renderImageCropper();
      };
      const onUp = () => {
        if (imageCropperState) imageCropperState.dragging = null;
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      imageCropperState.cleanup = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      overlay.querySelector('[data-cropimage]').src = src;
      overlay.querySelector('[data-cropviewport]')?.addEventListener('mousedown', (event) => {
        event.preventDefault();
        imageCropperState.dragging = {
          startX: event.clientX,
          startY: event.clientY,
          originX: imageCropperState.x,
          originY: imageCropperState.y,
        };
      });
      overlay.querySelector('[data-cropviewport]')?.addEventListener('wheel', (event) => {
        event.preventDefault();
        imageCropperState.zoom = clampNumber(imageCropperState.zoom + (event.deltaY < 0 ? 0.06 : -0.06), 1, 3);
        renderImageCropper();
      }, { passive: false });
      applyImageCropperAspect(aspect);
      requestAnimationFrame(() => overlay.classList.add('show'));
      overlay.querySelector('[data-cropconfirm]')?.focus();
    };
    image.onerror = () => closeImageCropper(null);
    image.src = src;
  });
}

// ── Wishlist (localStorage) ──
let wishlist = new Set(JSON.parse(localStorage.getItem('wishlist') || '[]'));
function saveWishlist() { localStorage.setItem('wishlist', JSON.stringify([...wishlist])); renderWishCount(); }
function toggleWishlist(id) { wishlist.has(id) ? wishlist.delete(id) : wishlist.add(id); saveWishlist(); }
function renderWishCount() {
  const el = document.getElementById('wishCount'); if (!el) return;
  const link = document.getElementById('wishLink');
  el.textContent = wishlist.size;
  el.style.display = wishlist.size ? 'grid' : 'none';
  if (link) link.classList.toggle('has-items', wishlist.size > 0);
}
function heartBtn(id) {
  return `<button class="wish-btn ${wishlist.has(id) ? 'on' : ''}" data-wish="${id}" aria-label="รายการโปรด">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20.7 10.6 19.4C5.4 14.7 2 11.6 2 7.8 2 4.9 4.2 2.7 7.1 2.7c1.7 0 3.4.8 4.5 2.1 1.1-1.3 2.8-2.1 4.5-2.1 2.9 0 5.1 2.2 5.1 5.1 0 3.8-3.4 6.9-8.6 11.6L12 20.7Z"/>
    </svg>
  </button>`;
}

// ── star rating ──
function stars(rating) {
  const r = Math.round(rating || 0);
  let s = ''; for (let i = 1; i <= 5; i++) s += `<span class="${i <= r ? 'on' : ''}">★</span>`;
  return `<span class="stars">${s}</span>`;
}

// ── model-viewer (3D .glb) loader ──
let _mvLoaded = false;
function ensureModelViewer() {
  if (_mvLoaded) return; _mvLoaded = true;
  const s = document.createElement('script'); s.type = 'module';
  s.src = 'https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js';
  document.head.appendChild(s);
}

// ── flash sale banner + countdown ──
let _saleTimer = null;
function renderSaleBanner() {
  const el = document.getElementById('saleBanner'); if (!el) return;
  if (_saleTimer) { clearInterval(_saleTimer); _saleTimer = null; }
  const active = S('SALE_ACTIVE') === '1' && (parseInt(S('SALE_PERCENT'), 10) || 0) > 0;
  const ends = S('SALE_ENDS') ? Date.parse(S('SALE_ENDS')) : 0;
  const live = active && (!ends || ends > Date.now());
  if (!live) { el.classList.remove('show'); el.innerHTML = ''; document.body.classList.remove('has-sale'); return; }
  el.classList.add('show'); document.body.classList.add('has-sale');
  const tick = () => {
    let cd = '';
    if (ends) {
      const d = ends - Date.now();
      if (d <= 0) return renderSaleBanner();
      const h = Math.floor(d / 3.6e6), m = Math.floor((d % 3.6e6) / 6e4), s = Math.floor((d % 6e4) / 1e3);
      cd = ` · หมดใน ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    el.innerHTML = `<a href="${routeHref('/products')}">⚡ ${esc(S('SALE_TEXT') || 'FLASH SALE')} · ลดทั้งร้าน ${parseInt(S('SALE_PERCENT'), 10)}%${cd} →</a>`;
  };
  tick(); if (ends) _saleTimer = setInterval(tick, 1000);
}

let appliedCoupon = null;        // { code, discount }
// cart: id -> qty (persist ใน localStorage)
const cart = new Map(Object.entries(JSON.parse(localStorage.getItem('cart') || '{}')));
function saveCart() { localStorage.setItem('cart', JSON.stringify(Object.fromEntries(cart))); }
const baht = (n) => '฿' + n.toLocaleString();
const effPrice = (p) => productCurrentPriceValue(p) || 0;
function saleBadgeHTML(p, cls = 'sale-badge') {
  const percent = productDiscountPercent(p);
  return percent ? `<span class="${cls}">ลด ${percent}%</span>` : '';
}
function priceHTML(p, { compact = false } = {}) {
  const pair = productPricePair(p);
  const current = pair.current;
  const compare = pair.compare;
  const onSale = compare > current;
  if (!onSale) return `<span class="price"><span class="price-main">${baht(current)}</span></span>`;
  return `<span class="price ${compact ? 'is-compact' : ''}">
    <span class="price-main">${baht(current)}</span>
    <span class="price-meta">
      <span class="price-old">${baht(compare)}</span>
      ${saleBadgeHTML(p, 'sale-badge sale-badge-inline')}
    </span>
  </span>`;
}

// ════════════════════════ SVG icons ════════════════════════
const ICO = {
  pod: `<rect x="23" y="6" width="18" height="52" rx="7"/><rect x="28" y="15" width="8" height="15" rx="2" fill="url(#ig)" stroke="none" opacity=".9"/><line x1="28" y1="50" x2="36" y2="50"/>`,
  mod: `<rect x="20" y="8" width="24" height="48" rx="8"/><path d="M34 19l-9 15h7l-2 11 10-17h-6z" fill="url(#ig)" stroke="none"/>`,
  cartridge: `<rect x="24" y="9" width="16" height="46" rx="6"/><path d="M32 21c-4 5-6 8-6 11a6 6 0 0 0 12 0c0-3-2-6-6-11z" fill="url(#ig)" stroke="none"/>`,
  coil: `<circle cx="32" cy="32" r="13"/><circle cx="32" cy="32" r="8"/><circle cx="32" cy="32" r="3.4" fill="url(#ig)" stroke="none"/><path d="M19 32h-5"/><path d="M50 32h-5"/>`,
  case: `<rect x="13" y="20" width="38" height="26" rx="6"/><path d="M13 30h38"/><path d="M38 30l5 5"/><circle cx="38" cy="30" r="2.2" fill="url(#ig)" stroke="none"/>`,
  charger: `<path d="M26 11v9"/><path d="M38 11v9"/><rect x="21" y="20" width="22" height="15" rx="4"/><path d="M32 35v7a6 6 0 0 0 6 6h6"/>`,
  cpu: `<rect x="21" y="21" width="22" height="22" rx="4"/><rect x="28" y="28" width="8" height="8" rx="1.5" fill="url(#ig)" stroke="none"/><path d="M27 21v-5M37 21v-5M27 48v-5M37 48v-5M21 27h-5M21 37h-5M48 27h5M48 37h5"/>`,
  battery: `<rect x="12" y="23" width="34" height="18" rx="4"/><path d="M46 29h4v6h-4"/><path d="M29 26l-6 8h6l-2 6 7-8h-5z" fill="url(#ig)" stroke="none"/>`,
  diamond: `<path d="M22 25h20l-10 27z"/><path d="M22 25l4-8h12l4 8"/><path d="M32 52l-5-27M32 52l5-27"/>`,
  chat: `<path d="M14 17h36a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H30l-9 8v-8h-7a3 3 0 0 1-3-3V20a3 3 0 0 1 3-3z"/><circle cx="24" cy="29" r="2.2" fill="url(#ig)" stroke="none"/><circle cx="32" cy="29" r="2.2" fill="url(#ig)" stroke="none"/><circle cx="40" cy="29" r="2.2" fill="url(#ig)" stroke="none"/>`,
  truck: `<rect x="8" y="22" width="27" height="19" rx="2"/><path d="M35 28h8l7 7v6h-15z"/><circle cx="18" cy="45" r="4"/><circle cx="43" cy="45" r="4"/>`,
  shield: `<path d="M32 8l18 7v13c0 12-8 20-18 25-10-5-18-13-18-25V15z"/><path d="M24 31l5 5 10-12"/>`,
  // ── agriculture / health ──
  leaf: `<path d="M48 14C26 14 16 27 16 44c0 0 22 4 32-8 8-10 0-22 0-22z"/><path d="M22 44c8-12 18-18 24-20"/>`,
  sprout: `<path d="M32 56V30"/><path d="M22 56h20"/><path d="M32 32C23 32 17 26 17 17c9 0 15 6 15 15z" fill="url(#ig)" stroke="none"/><path d="M32 28c8 0 14-6 14-14-8 0-14 6-14 14z" fill="url(#ig)" stroke="none"/>`,
  drop: `<path d="M32 10c-8 10-13 16-13 24a13 13 0 0 0 26 0c0-8-5-14-13-24z"/><path d="M27 38a5 6 0 0 0 5 6" stroke-width="2"/>`,
  bottle: `<path d="M25 27h13v25a4 4 0 0 1-4 4h-5a4 4 0 0 1-4-4z"/><path d="M28 27v-6h7v6"/><path d="M35 13h9M44 13v6l-6 4"/>`,
  soap: `<rect x="15" y="27" width="34" height="20" rx="7"/><path d="M21 23c2-2 6-2 8 0M35 21c2-2 5-2 7 0"/>`,
  herb: `<path d="M32 56V22"/><path d="M32 32c-6 0-10-4-10-11 6 0 10 4 10 11zM32 40c6 0 10-4 10-11-6 0-10 4-10 11z" fill="url(#ig)" stroke="none"/>`,
  health: `<path d="M32 50S15 39 15 27a9 9 0 0 1 17-3 9 9 0 0 1 17 3c0 12-17 23-17 23z"/>`,
  shieldleaf: `<path d="M32 8l18 7v12c0 12-8 20-18 25-10-5-18-13-18-25V15z"/><path d="M41 23c-12 0-16 8-16 8s3 1 8-1c-1 4-3 7-3 7s9-2 11-8 0-6 0-6z" fill="url(#ig)" stroke="none"/>`,
};
const PROD_ICON = { p1: 'pod', p2: 'mod', p3: 'cartridge', p4: 'coil', p5: 'case', p6: 'charger' };

function icon(name, cls = 'ico') {
  return `<span class="${cls}"><svg viewBox="0 0 64 64" fill="none"><g stroke="url(#ig)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${ICO[name] || ICO.pod}</g></svg></span>`;
}
function productIcon(id, cls = 'ico') { return icon(PROD_ICON[id] || 'pod', cls); }

function addToCart(id, qty = 1) {
  cart.set(id, (Number(cart.get(id)) || 0) + qty);
  saveCart(); renderCart();
}
function addOrderToCart(order = {}) {
  const items = Array.isArray(order.items) ? order.items : [];
  let added = 0;
  items.forEach((item) => {
    const id = String(item.id || item.productId || '').trim();
    const qty = Math.max(1, parseInt(item.qty, 10) || 1);
    const p = productById(id);
    if (!p || p.stock <= 0) return;
    cart.set(id, (Number(cart.get(id)) || 0) + qty);
    added += qty;
  });
  if (added) { saveCart(); renderCart(); }
  return added;
}
function cartCount() { let c = 0; cart.forEach((q) => (c += Number(q))); return c; }
function cartTotal() { let t = 0; cart.forEach((q, id) => { const p = productById(id); if (p) t += effPrice(p) * Number(q); }); return t; }
function cartRecommendationProducts(limit = 3) {
  const inCart = new Set([...cart.keys()]);
  const cartProducts = [...cart.keys()].map((id) => productById(id)).filter(Boolean);
  const cartCategories = new Set(cartProducts.map((p) => productCategory(p)).filter(Boolean));
  const cartSegments = new Set(cartProducts.map((p) => productSegment(p)).filter(Boolean));
  return sortProductsForDisplay(PRODUCTS)
    .filter((p) => p.active !== false && p.stock !== 0 && !inCart.has(p.id))
    .sort((a, b) => {
      const aScore = (cartCategories.has(productCategory(a)) ? 2 : 0) + (cartSegments.has(productSegment(a)) ? 1 : 0) + (productTopPriorityValue(a) < 999 ? 1 : 0);
      const bScore = (cartCategories.has(productCategory(b)) ? 2 : 0) + (cartSegments.has(productSegment(b)) ? 1 : 0) + (productTopPriorityValue(b) < 999 ? 1 : 0);
      return bScore - aScore;
    })
    .slice(0, limit);
}
function calcBundlePlan(raw = '') {
  let plan = [];
  try { plan = JSON.parse(raw || '[]'); } catch {}
  if (!Array.isArray(plan)) return [];
  return plan
    .map((item) => ({
      id: String(item?.id || '').trim(),
      qty: Math.max(1, parseInt(item?.qty, 10) || 1),
      packSize: Math.max(0, parseFloat(item?.packSize || '0') || 0),
    }))
    .filter((item) => item.id && productById(item.id));
}
function applyCartPlan(plan = [], { replace = false } = {}) {
  const items = asArray(plan).filter((item) => item?.id && productById(item.id));
  if (!items.length) return 0;
  if (replace) cart.clear();
  items.forEach((item) => {
    const qty = Math.max(1, parseInt(item.qty, 10) || 1);
    cart.set(item.id, replace ? qty : ((Number(cart.get(item.id)) || 0) + qty));
  });
  saveCart();
  renderCart();
  return items.reduce((sum, item) => sum + (Math.max(1, parseInt(item.qty, 10) || 1)), 0);
}
function checkoutFromCalcPlan(raw = '') {
  const plan = calcBundlePlan(raw);
  if (!plan.length) {
    toast('ยังไม่มีชุดสูตรให้สั่งซื้อทันที', 'err');
    return;
  }
  const totalQty = applyCartPlan(plan, { replace: true });
  openCart();
  toast(`เตรียมชุดสูตรนี้ไว้ ${totalQty} ขวด แล้วพาไปขั้นตอนสั่งซื้อ`, 'ok');
  setTimeout(() => {
    closeCart();
    go('/checkout');
    requestAnimationFrame(() => scrollTo({ top: 0, behavior: 'smooth' }));
  }, 220);
}
// ── shipping (client-side display; server is authoritative) ──
function shipFee(country, amount) {
  const home = (S('SHIP_HOME') || 'ไทย').trim();
  const freeOver = parseInt(S('SHIP_FREE_OVER'), 10) || 0;
  if (freeOver && amount >= freeOver) return 0;
  const isHome = !country || country.trim() === home;
  return parseInt(isHome ? S('SHIP_FEE') : S('SHIP_INTL_FEE'), 10) || 0;
}

// ════════════════════════ Cart drawer (persistent) ════════════════════════
const cartDrawer = document.getElementById('cartDrawer');
const backdrop = document.getElementById('cartBackdrop');
const cartItemsEl = document.getElementById('cartItems');
const cartCountEl = document.getElementById('cartCount');
const cartTotalEl = document.getElementById('cartTotal');
const cartLinkEl = document.getElementById('cartLink');
const cartCloseEl = document.getElementById('cartClose');
const checkoutBtnEl = document.getElementById('checkoutBtn');

function renderCart() {
  if (cartCountEl) cartCountEl.textContent = cartCount();
  if (cartTotalEl) cartTotalEl.textContent = baht(cartTotal());
  if (!cartItemsEl) return;
  cartItemsEl.innerHTML = '';
  if (cart.size === 0) { cartItemsEl.innerHTML = '<div class="empty">ตะกร้ายังว่างอยู่</div>'; return; }
  cart.forEach((qty, id) => {
    const p = productById(id); if (!p) return;
    const row = document.createElement('div');
    row.className = 'cart-row';
    const media = p.image
      ? `<div class="cart-media"><img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy"></div>`
      : `<div class="cart-media">${productVisual(p, 'mini-ico')}</div>`;
    row.innerHTML = `
      <div class="cart-main">${media}<div class="cart-copy"><div class="nm">${p.name}</div><div class="pr">${baht(effPrice(p))}</div></div></div>
      <div class="qty"><button data-dec="${id}">−</button><span>${qty}</span><button data-inc="${id}">+</button></div>`;
    cartItemsEl.appendChild(row);
  });
  const recs = cartRecommendationProducts(3);
  if (recs.length) {
    const box = document.createElement('div');
    box.className = 'cart-recs';
    box.innerHTML = `<div class="cart-recs-head"><b>แนะนำเพิ่มในออเดอร์นี้</b><span>เลือกตัวที่ช่วยให้ชุดสมบูรณ์ขึ้น</span></div>
      ${recs.map((p) => `<button type="button" class="cart-rec" data-add="${esc(p.id)}">
        ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">` : `<span>${productVisual(p, 'mini-ico')}</span>`}
        <em>${esc(productCardName(p))}</em>
        <strong>${baht(effPrice(p))}</strong>
      </button>`).join('')}`;
    cartItemsEl.appendChild(box);
  }
}
function openCart() {
  if (!cartDrawer || !backdrop) return;
  cartDrawer.classList.add('open');
  backdrop.classList.add('show');
}
function closeCart() {
  if (!cartDrawer || !backdrop) return;
  cartDrawer.classList.remove('open');
  backdrop.classList.remove('show');
}
if (cartLinkEl) cartLinkEl.onclick = openCart;
if (cartCloseEl) cartCloseEl.onclick = closeCart;
if (backdrop) backdrop.onclick = closeCart;
if (checkoutBtnEl) checkoutBtnEl.onclick = () => { closeCart(); go('/checkout'); };

// ════════════════════════ Views ════════════════════════
const PRODUCT_CARD_MEDIA_FOCUS = {
  p1: { zoom: 1.05, x: '50%', y: '50%' },
  p2: { zoom: 1.04, x: '51%', y: '49%' },
  p3: { zoom: 1.03, x: '50%', y: '49%' },
  p4: { zoom: 1.03, x: '50%', y: '48%' },
  p5: { zoom: 1.05, x: '52%', y: '50%' },
  p6: { zoom: 1.05, x: '51%', y: '50%' },
  p7: { zoom: 1.02, x: '50%', y: '50%' },
};
function productCardMediaStyle(p, cls = 'ico') {
  if (!['ico', 'card-vid'].includes(cls)) return '';
  const focus = PRODUCT_CARD_MEDIA_FOCUS[String(p?.id || '').trim()] || {};
  const zoom = Number.isFinite(Number(focus.zoom)) ? Number(focus.zoom) : 1.03;
  const x = String(focus.x || '50%').trim();
  const y = String(focus.y || '50%').trim();
  return ` style="--media-zoom:${zoom};--media-x:${esc(x)};--media-y:${esc(y)}"`;
}
function productVisual(p, cls = 'ico') {
  const mediaStyle = productCardMediaStyle(p, cls);
  return p.image ? `<span class="${cls} pimg"${mediaStyle}><img src="${p.image}" alt="${esc(p.name)}" loading="lazy"></span>` : icon(p.icon || 'pod', cls);
}
// สื่อขนาดใหญ่ (วิดีโอ > รูปซูมได้ > ไอคอน) สำหรับหน้ารายละเอียด/quick view
function productMedia(p) {
  if (p.video) return `<video class="media-el" controls muted loop playsinline ${p.image ? `poster="${p.image}"` : ''} src="${p.video}"></video>`;
  if (p.image) return `<img class="media-el zoomable" src="${p.image}" alt="${esc(p.name)}" data-zoom="${p.image}">`;
  return icon(p.icon || 'pod', 'd-ico');
}
function productCardName(p) {
  const shortName = String(p?.extra?.cardName || '').trim();
  return shortName || String(p?.name || '').trim();
}
function productCard(p, i = 0) {
  const mediaStyle = productCardMediaStyle(p, 'card-vid');
  const media = p.video
    ? `<video class="card-vid"${mediaStyle} muted loop playsinline preload="metadata" ${p.image ? `poster="${p.image}"` : ''} src="${p.video}"></video>`
    : productVisual(p);
  const out = p.stock <= 0;
  const onSale = effPrice(p) < p.price;
  const badges = productBadgeMarkup(p);
  const modelUrl = productModelUrl(p);
  const category = productCategory(p);
  const isPod = category === 'พอต';
  const highlight = String(productExtra(p)?.highlight || '').trim();
  const points = productSellingPoints(p).slice(0, 2);
  const eyebrow = isPod ? 'POD COLLECTION' : '';
  return `<a class="card glass reveal ${out ? 'soldout' : ''} ${isPod ? 'is-pod' : ''}" href="${routeHref('/product/' + p.id)}" style="transition-delay:${(i % 3) * 0.07}s">
    <div class="thumb">${onSale ? saleBadgeHTML(p) : ''}${p.video ? '<span class="vid-badge">▶</span>' : ''}${modelUrl ? '<span class="vid-badge model-badge">3D</span>' : ''}${heartBtn(p.id)}<span class="glow"></span>${media}
      ${out ? '<span class="soldout-tag">สินค้าหมด</span>' : `<button class="qv-btn" data-quick="${p.id}">ดูเร็ว</button>`}</div>
    <div class="body">
      ${eyebrow ? `<div class="card-kicker">${esc(eyebrow)}</div>` : ''}
      ${badges ? `<div class="tag-row">${badges}</div>` : ''}
      <h3>${esc(productCardName(p))}</h3>
      ${p.reviews ? `<div class="card-rate">${stars(p.rating)}<small>(${p.reviews})</small></div>` : ''}
      <p class="desc">${p.short}</p>
      ${highlight ? `<p class="card-note">${esc(highlight)}</p>` : ''}
      ${points.length ? `<div class="card-points">${points.map((item) => `<span>${esc(item)}</span>`).join('')}</div>` : ''}
      <div class="card-stock ${out ? 'out' : p.stock <= 5 ? 'low' : ''}">${out ? 'สินค้าหมด' : p.stock <= 5 ? `เหลือ ${Number(p.stock || 0)} ชิ้น` : 'พร้อมส่ง'}</div>
      <div class="row">
        ${priceHTML(p)}
        ${out ? '<button class="add" disabled>หมด</button>' : `<button class="add" data-add="${p.id}">เพิ่ม +</button>`}
      </div>
    </div></a>`;
}

// ── Quick View modal ──
function openQuickView(id) {
  const p = productById(id); if (!p) return;
  let m = document.getElementById('quickModal');
  if (!m) { m = document.createElement('div'); m.id = 'quickModal'; m.className = 'qv-overlay'; document.body.appendChild(m); }
  const badges = productBadgeMarkup(p);
  m.innerHTML = `<div class="qv-card glass">
    <button class="qv-close" data-qvclose>✕</button>
    <div class="qv-media media3d" data-tilt>${productMedia(p)}</div>
    <div class="qv-info">
      ${badges ? `<div class="tag-row">${badges}</div>` : ''}
      <h2>${esc(p.name)}</h2>
      <div class="d-price">${priceHTML(p)}</div>
      <p class="muted">${esc(p.short || '')}</p>
      <div class="d-actions">
        <button class="btn btn-primary" data-add="${p.id}">เพิ่มลงตะกร้า</button>
        <a class="btn btn-glass" href="${routeHref('/product/' + p.id)}" data-qvclose>ดูรายละเอียดเต็ม →</a>
      </div>
    </div></div>`;
  requestAnimationFrame(() => m.classList.add('show'));
  attachTilt(m);
}
function closeQuickView() { const m = document.getElementById('quickModal'); if (m) m.classList.remove('show'); }

// ── Lightbox / Slider ──
let lightboxState = { items: [], index: 0 };
function lightboxItemsFromTrigger(trigger) {
  if (!trigger) return [];
  const group = String(trigger.dataset.lightboxGroup || '').trim();
  const nodes = group ? [...document.querySelectorAll(`[data-lightbox-group="${group}"]`)] : [trigger];
  return nodes.map((node) => ({
    src: String(node.dataset.zoom || node.getAttribute('href') || '').trim(),
    title: String(node.dataset.lightboxTitle || node.getAttribute('title') || '').trim(),
    note: String(node.dataset.lightboxNote || '').trim(),
  })).filter((item) => item.src);
}
function lightboxIndexFromTrigger(trigger, items) {
  const raw = parseInt(trigger?.dataset.lightboxIndex || '0', 10);
  if (Number.isFinite(raw) && raw >= 0 && raw < items.length) return raw;
  const src = String(trigger?.dataset.zoom || trigger?.getAttribute('href') || '').trim();
  const found = items.findIndex((item) => item.src === src);
  return found > -1 ? found : 0;
}
function renderLightbox() {
  const l = document.getElementById('lightbox');
  const item = lightboxState.items[lightboxState.index];
  if (!l || !item) return;
  const multiple = lightboxState.items.length > 1;
  l.innerHTML = `<div class="lb-dialog" role="dialog" aria-modal="true" aria-label="รูปภาพขยาย">
    <button class="lb-close" type="button" aria-label="ปิด">✕</button>
    ${multiple ? `<button class="lb-nav is-prev" type="button" data-lbnav="-1" aria-label="รูปก่อนหน้า">‹</button>
    <button class="lb-nav is-next" type="button" data-lbnav="1" aria-label="รูปถัดไป">›</button>` : ''}
    <img src="${esc(item.src)}" alt="${esc(item.title || '')}">
    ${(item.title || item.note || multiple) ? `<div class="lb-caption">
      ${multiple ? `<span class="lb-count">${lightboxState.index + 1} / ${lightboxState.items.length}</span>` : ''}
      ${item.title ? `<b>${esc(item.title)}</b>` : ''}
      ${item.note ? `<span>${esc(item.note)}</span>` : ''}
    </div>` : ''}
    ${multiple ? `<div class="lb-thumbs">${lightboxState.items.map((thumb, idx) => `<button class="lb-thumb ${idx === lightboxState.index ? 'is-active' : ''}" type="button" data-lbindex="${idx}" aria-label="ดูรูปที่ ${idx + 1}">
      <img src="${esc(thumb.src)}" alt="${esc(thumb.title || '')}">
    </button>`).join('')}</div>` : ''}
  </div>`;
}
function bindLightboxEvents(overlay) {
  if (!overlay || overlay._boundLightboxEvents) return;
  overlay._boundLightboxEvents = true;
  overlay.addEventListener('click', (event) => {
    const close = event.target.closest('.lb-close');
    if (close) {
      event.preventDefault();
      event.stopPropagation();
      closeLightbox();
      return;
    }
    const nav = event.target.closest('[data-lbnav]');
    if (nav) {
      event.preventDefault();
      event.stopPropagation();
      moveLightbox(parseInt(nav.dataset.lbnav || '1', 10) || 1);
      return;
    }
    const thumb = event.target.closest('[data-lbindex]');
    if (thumb) {
      event.preventDefault();
      event.stopPropagation();
      setLightboxIndex(parseInt(thumb.dataset.lbindex || '0', 10) || 0);
      return;
    }
    if (event.target === overlay) {
      event.preventDefault();
      event.stopPropagation();
      closeLightbox();
      return;
    }
    if (event.target.closest('.lb-dialog')) {
      event.stopPropagation();
    }
  });
}
function openLightbox(triggerOrSrc) {
  let l = document.getElementById('lightbox');
  if (!l) {
    l = document.createElement('div');
    l.id = 'lightbox';
    l.className = 'lb-overlay';
    document.body.appendChild(l);
  }
  bindLightboxEvents(l);
  if (typeof triggerOrSrc === 'string') {
    lightboxState = { items: [{ src: triggerOrSrc, title: '', note: '' }], index: 0 };
  } else {
    const items = lightboxItemsFromTrigger(triggerOrSrc);
    lightboxState = { items: items.length ? items : [{ src: String(triggerOrSrc?.dataset.zoom || '').trim(), title: '', note: '' }], index: lightboxIndexFromTrigger(triggerOrSrc, items.length ? items : [{ src: String(triggerOrSrc?.dataset.zoom || '').trim() }]) };
  }
  renderLightbox();
  requestAnimationFrame(() => l.classList.add('show'));
}
function moveLightbox(step = 1) {
  if (!lightboxState.items.length) return;
  lightboxState.index = (lightboxState.index + step + lightboxState.items.length) % lightboxState.items.length;
  renderLightbox();
}
function setLightboxIndex(index = 0) {
  if (!lightboxState.items.length) return;
  if (!Number.isFinite(index)) return;
  lightboxState.index = Math.max(0, Math.min(lightboxState.items.length - 1, index));
  renderLightbox();
}
function closeLightbox() { const l = document.getElementById('lightbox'); if (l) l.classList.remove('show'); }

// ── 3D tilt (ลื่นด้วย rAF, หยุดเองเมื่อนิ่ง) ──
function attachTilt(root = document) {
  if (!window.matchMedia('(hover: hover)').matches) return;
  root.querySelectorAll('[data-tilt]').forEach((el) => {
    if (el._tilt) return; el._tilt = true;
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0, active = false;
    const loop = () => {
      cx += (tx - cx) * 0.12; cy += (ty - cy) * 0.12;
      el.style.transform = `perspective(900px) rotateX(${cy.toFixed(2)}deg) rotateY(${cx.toFixed(2)}deg)`;
      raf = (active || Math.abs(tx - cx) > 0.05 || Math.abs(ty - cy) > 0.05) ? requestAnimationFrame(loop) : 0;
    };
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width - 0.5) * 16;
      ty = -((e.clientY - r.top) / r.height - 0.5) * 16;
      if (!raf) raf = requestAnimationFrame(loop);
    }, { passive: true });
    el.addEventListener('pointerenter', () => { active = true; if (!raf) raf = requestAnimationFrame(loop); });
    el.addEventListener('pointerleave', () => { active = false; tx = 0; ty = 0; if (!raf) raf = requestAnimationFrame(loop); });
  });
}

async function viewHome() {
  setPageMeta('', '');
  const featured = sortProductsForDisplay(PRODUCTS).filter((p) => ['ชุดเซต', 'โปรโมชั่น'].includes(productCategory(p)) || productTopPriorityValue(p) < 999);
  const lifestyle = PRODUCTS.filter((p) => !isAgriProduct(p)).slice(0, 2);
  const reviewItems = Array.isArray(REVIEW_GALLERY) ? REVIEW_GALLERY : [];
  if (!reviewItems.length) {
    _afterRender = async () => {
      const beforeCount = Array.isArray(REVIEW_GALLERY) ? REVIEW_GALLERY.length : 0;
      await refreshReviewGallery().catch(() => []);
      if (currentPath() === '/' && beforeCount !== REVIEW_GALLERY.length) render();
    };
  }
  const reviewSpotlight = homeReviewSpotlightItems(reviewItems, 3);
  const reviewProofCount = reviewItems.length || reviewSpotlight.length || 0;
  const reviewCountLabel = reviewProofCount ? `${reviewProofCount}+` : '90+';
  const trustItems = settingLines('SITE_TRUST_ITEMS', DEFAULT_TRUST_ITEMS);
  const caseStudies = settingPairs('SITE_CASE_STUDIES', DEFAULT_CASE_STUDIES).slice(0, 2);
  const guideMap = cropGuideMap();
  const leadCropOptions = [...new Set([...Object.keys(guideMap), ...calcCropList()])].filter(Boolean);
  const slugMap = cropSlugMap();
  const contacts = supportContacts();
  const cropCards = Object.entries(guideMap).slice(0, 4).map(([crop, cfg], i) => {
    const slug = slugMap[crop] || '';
    return `<a class="crop-shortcut glass reveal" style="transition-delay:${(i % 3) * 0.07}s" href="${slug ? `/crops/${slug}` : routeHref('/products')}">
      <b>${esc(crop)}</b>
      <span>${esc(cfg.tip)}</span>
    </a>`;
  }).join('');
  const quickStart = [
    { title: 'ดูผลงานลูกค้าจริง', desc: 'เริ่มจากรีวิวจริงก่อนตัดสินใจ', href: routeHref('/reviews') },
    { title: 'ดูสินค้า', desc: 'รวมชุดเซตและโปรโมชันที่จัดไว้แล้ว', href: routeHref('/products') },
    { title: 'ขอคำปรึกษาฟรี', desc: 'กรอกฟอร์มสั้น ๆ แล้วให้คุณจูนติดต่อกลับ', action: 'lead' },
  ];
  return `
  <section class="hero hero-compact">
    <div class="hero-copy">
      <div class="pill reveal"><span class="pulse"></span>${esc(S('SITE_ANNOUNCE'))}</div>
      <h1 class="reveal">${esc(S('SITE_HERO_TITLE'))}<span class="grad">${esc(S('SITE_HERO_ACCENT'))}</span><br />${esc(S('SITE_HERO_TITLE2'))}</h1>
      <p class="reveal">${esc(S('SITE_HERO_SUB'))}</p>
      <div class="hero-cta reveal">
        <a href="${routeHref('/reviews')}" class="btn btn-primary">ดูผลงานลูกค้าจริงก่อน</a>
        <a href="${routeHref('/products')}" class="btn btn-glass">ดูสินค้า</a>
      </div>
      <div class="hero-meta reveal">
        <div><b>${esc(reviewCountLabel)}</b><span>ภาพรีวิวจริง</span></div>
        <div><b>ลูกค้าจริง</b><span>ส่งกลับมาหลังใช้งาน</span></div>
        <div><b>เปิดเต็มจอ</b><span>ดูรายละเอียดได้ทันที</span></div>
      </div>
    </div>
    <div class="hero-visual hero-panel reveal">
      <div class="hero-quick glass">
        <span class="eyebrow">เริ่มจากหลักฐานจริง</span>
        <h3>ดูลูกค้าจริงก่อน แล้วค่อยเลือกสินค้าที่เหมาะ</h3>
        <div class="hero-quick-list">
          ${quickStart.map((item) => item.action === 'lead'
            ? `<button type="button" class="hero-quick-item" data-scrolllead><b>${esc(item.title)}</b><span>${esc(item.desc)}</span></button>`
            : `<a class="hero-quick-item" href="${item.href}"><b>${esc(item.title)}</b><span>${esc(item.desc)}</span></a>`).join('')}
        </div>
        <div class="hero-mini-proof">
          ${trustItems.map((item) => `<span>${esc(item)}</span>`).join('')}
        </div>
      </div>
    </div>
  </section>

  <section class="section section-tight brand-pillars-wrap reveal">
    <div class="brand-pillars glass">
      <div class="brand-pillar">${icon('leaf', 'bp-ico')}<b>สูตรเฉพาะตามพืช</b><span>เลือกให้ตรงชนิดพืชและช่วงการปลูก</span></div>
      <div class="brand-pillar">${icon('health', 'bp-ico')}<b>นักวิชาการดูแล</b><span>ปรึกษาคุณจูนฟรีก่อนตัดสินใจ</span></div>
      <div class="brand-pillar">${icon('shieldleaf', 'bp-ico')}<b>รีวิวจริงจากลูกค้า</b><span>${esc(reviewCountLabel)} ภาพผลงานจริง</span></div>
      <div class="brand-pillar">${icon('truck', 'bp-ico')}<b>จัดส่งทั่วไทย</b><span>ติดตามออเดอร์และเลขพัสดุได้</span></div>
    </div>
  </section>

  <section class="section section-tight reveal">
    ${orgTrustHTML()}
  </section>

  ${homeReviewSpotlightSection(reviewSpotlight, reviewProofCount)}

  <section class="section section-tight reveal">
    <div class="section-head"><span class="eyebrow">Customer Care</span><h2>ระบบบริการที่ออกแบบให้ลูกค้าตัดสินใจง่าย</h2></div>
    ${orgTrustHTML()}
    ${buyingStepsHTML()}
  </section>
  <section class="section section-tight reveal">
    <div class="section-head"><span class="eyebrow">FAQ</span><h2>คำถามที่ลูกค้าถามบ่อย</h2></div>
    ${storeFaqHTML()}
  </section>
  <section class="section">
    ${homeReviewStickyNudge()}
    <div class="section-head reveal"><span class="eyebrow">${esc(S('SITE_HOME_FEATURED_EYEBROW'))}</span><h2>${esc(S('SITE_HOME_FEATURED_TITLE'))}</h2></div>
    <div class="products-scroll-wrap reveal">
      <div class="products products-scroll home-featured-row">${featured.map((p, i) => productCard(p, i)).join('')}</div>
    </div>
    <div class="compact-actions reveal"><a href="${routeHref('/products')}" class="btn btn-glass">ดูสินค้าทั้งหมด →</a></div>
  </section>

  <section class="section section-tight">
    <div class="section-head reveal"><span class="eyebrow">${esc(S('SITE_HOME_CROP_EYEBROW'))}</span><h2>${esc(S('SITE_HOME_CROP_TITLE'))}</h2></div>
    <div class="crop-grid">${cropCards}</div>
  </section>

  <section class="section section-tight">
    <div class="consult-band glass reveal home-consult" id="leadFormBlock">
      <div class="consult-copy">
        <span class="eyebrow">${esc(S('SITE_HOME_CONSULT_EYEBROW'))}</span>
        <h2>${esc(S('SITE_HOME_CONSULT_TITLE'))}</h2>
        <p>${esc(S('SITE_HOME_CONSULT_BODY'))}</p>
        <div class="consult-points">
          <div>${icon('leaf', 'mini-ico')} เก็บชื่อ เบอร์ พืช และปัญหาหลักให้ครบก่อน</div>
          <div>${icon('chat', 'mini-ico')} ส่งต่อให้คุณจูนโทรกลับหรือคุยต่อใน LINE ได้ทันที</div>
          <div>${icon('truck', 'mini-ico')} เชื่อมต่อออเดอร์และการติดตามหลังการขายได้จริง</div>
        </div>
        <div class="inline-proof-grid">
          ${caseStudies.map((item) => `<article class="inline-proof-card"><b>${esc(item.title)}</b><span>${esc(item.detail)}</span></article>`).join('')}
        </div>
        <div class="contact-sheet">
          <div class="contact-sheet-head">
            <b>${esc(S('SITE_HOME_CONTACT_TITLE'))}</b>
            <span>${esc(S('SITE_HOME_CONTACT_BODY'))}</span>
          </div>
          <div class="contact-sheet-grid">
            ${contacts.phones.map((item) => `<a class="contact-pill" href="tel:${item.number}"><span>${esc(item.label)}</span><b>${esc(item.number)}</b></a>`).join('')}
            <div class="contact-pill contact-static"><span>LINE ID</span><b>${esc(contacts.lineId)}</b></div>
            <div class="contact-pill contact-static"><span>LINE OA</span><b>${esc(contacts.lineOfficialId)}</b></div>
          </div>
          <div class="contact-actions">
            <a class="btn btn-primary" href="tel:${contacts.phones[0].number}">${esc(S('SITE_HOME_CONTACT_CALL_PRIMARY_LABEL'))}</a>
            <a class="btn btn-glass" href="tel:${contacts.phones[1].number}">${esc(S('SITE_HOME_CONTACT_CALL_SECONDARY_LABEL'))}</a>
            <a class="btn btn-glass" href="${esc(contacts.linePersonalUrl)}" target="_blank" rel="noopener">${esc(S('SITE_HOME_CONTACT_PERSONAL_LABEL'))}</a>
            <a class="btn btn-glass" href="${esc(contacts.lineOfficialUrl)}" target="_blank" rel="noopener">${esc(S('SITE_HOME_CONTACT_OA_LABEL'))}</a>
          </div>
          <p class="contact-note">${esc(S('SITE_HOME_CONTACT_NOTE'))}</p>
        </div>
        ${lifestyle.length ? `<div class="subtle-link-list">
          <span>หมวดรองของแบรนด์:</span>
          ${lifestyle.map((p) => `<a href="${routeHref('/product/' + p.id)}">${esc(p.name)}</a>`).join('')}
          <a href="${routeHref('/products')}">ดูหมวดสุขภาพ/ความงาม</a>
        </div>` : ''}
        ${lineCTA('line-inline')}
      </div>
      <form id="leadForm" class="lead-form">
        <div class="lead-form-intro lead-wide"><b>ส่งต่อให้คุณจูนได้ทันที</b><span>กรอกเฉพาะข้อมูลสำคัญก่อน แล้วให้คุณจูนโทรกลับหรือคุยต่อใน LINE</span></div>
        <label>ชื่อเกษตรกร / ลูกค้า<input name="name" required autocomplete="name" placeholder="ชื่อ-นามสกุล" /></label>
        <label>เบอร์โทร<input name="phone" required inputmode="tel" autocomplete="tel" placeholder="08x-xxx-xxxx" /></label>
        <label>พืชที่ปลูก<select name="crop" id="leadCrop">
          <option value="">เลือกพืช</option>
          ${leadCropOptions.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
        </select></label>
        <label>ช่วงการปลูก / ปัญหา<select name="stage">
          <option value="">เลือกช่วงหรือปัญหา</option>
          <option>เร่งโต/แตกกอ</option>
          <option>เร่งดอก</option>
          <option>บำรุงผล</option>
          <option>ใบเหลือง/พืชเครียด</option>
          <option>หน้าฝน/ต้องการสารจับใบ</option>
          <option>ยังไม่แน่ใจ ขอคำแนะนำ</option>
        </select></label>
        <label class="lead-wide">รายละเอียดเพิ่มเติม<textarea name="problem" rows="3" placeholder="เช่น ใบไม่เขียว เร่งดอก ผลร่วง โตช้า หรืออยากได้สูตรสำหรับพืชที่ปลูก"></textarea></label>
        <button type="submit" class="btn btn-primary lead-submit">ส่งข้อมูลให้คุณจูนติดต่อกลับ</button>
        <p class="form-note">หลังส่งแล้ว คุณจูนสามารถนำข้อมูลไปติดตามต่อใน LINE, โทร หรือใช้วัดผลแคมเปญโฆษณาได้</p>
      </form>
    </div>
  </section>`;
}

function calcWidget(p) {
  const profile = productRateProfile(p); if (!profile) return '';
  const r = profile.selectedRate;
  const sourceText = profile.research?.sourceLabel || 'อัตราจากข้อมูลสินค้าในระบบ';
  return `<div class="calc-box glass" data-per="${r.per}" data-min="${r.min}" data-max="${r.max}">
    <h3>🧮 คำนวณอัตราผสม</h3>
    <div class="calc-inline-grid">
      <label>ขนาดถังพ่น (ลิตร)<input type="number" class="calc-tank" value="20" min="1" max="2000"></label>
      <label>ความเข้ม<select class="calc-strength"><option value="low">เริ่มต้น</option><option value="mid" selected>กลาง</option><option value="high">เข้มขึ้น</option></select></label>
    </div>
    <div class="calc-out">ใช้ <b>${calcResult(r, 20, 'mid')}</b> ต่อถัง</div>
    <p class="muted" style="font-size:12px">อัตราที่ระบบใช้คำนวณ: ${esc(profile.research?.rateRaw || r.raw)} · ${esc(sourceText)}</p>
  </div>`;
}
function trustStrip(items) {
  return `<div class="trust-strip reveal">${items.map((item) => `<span class="trust-pill">${esc(item)}</span>`).join('')}</div>`;
}
function caseStudyCards(items) {
  return `<div class="proof-grid">${items.map((item) => `<article class="proof-card glass reveal"><span class="eyebrow">Use Case</span><h3>${esc(item.title)}</h3><p>${esc(item.detail)}</p></article>`).join('')}</div>`;
}
function reviewGalleryItems(limit = 0) {
  const items = Array.isArray(REVIEW_GALLERY) ? REVIEW_GALLERY.filter((item) => item?.image) : [];
  return limit > 0 ? items.slice(0, limit) : items;
}
function homeReviewSpotlightItems(items = [], limit = 3) {
  const ranked = [];
  const seen = new Set();
  const remember = (item) => {
    const key = String(item?.image || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    ranked.push({
      ...item,
      lightboxIndex: Number.isFinite(item?.lightboxIndex) ? item.lightboxIndex : items.findIndex((entry) => entry?.image === item?.image),
    });
  };
  items
    .filter((item) => item?.spotlight)
    .sort((a, b) => (a?.spotlightRank || 999) - (b?.spotlightRank || 999))
    .forEach(remember);
  items.forEach(remember);
  return ranked.slice(0, limit);
}
function homeReviewProofStrip(reviewCount = 0) {
  const countLabel = reviewCount ? `${reviewCount}+ ภาพรีวิวจริง` : 'รีวิวจากลูกค้าจริง';
  const items = [countLabel, 'ลูกค้าส่งกลับมาจริง', 'เปิดดูเต็มจอได้'];
  return `<div class="home-proof-strip reveal">${items.map((item) => `<div class="home-proof-pill"><b>${esc(item)}</b></div>`).join('')}</div>`;
}
function homeReviewStickyNudge() {
  return `<div class="home-review-nudge reveal">
    <a href="${routeHref('/reviews')}">
      <span>ยังไม่แน่ใจ?</span>
      <strong>ดูรีวิวลูกค้าจริงก่อน</strong>
      <small>เปิดภาพเต็มจอได้ทันที</small>
    </a>
  </div>`;
}
function homeReviewSpotlightSection(items = [], totalCount = 0) {
  if (!items.length) return '';
  const totalLabel = totalCount ? `${totalCount}+` : '90+';
  return `<section class="section review-home-proof reveal">
    <div class="section-head">
      <span class="eyebrow">รีวิวจากลูกค้าจริง</span>
      <h2>ดูผลงานจริงก่อนตัดสินใจซื้อ</h2>
      <p class="muted">ดันหลักฐานจริงขึ้นมาก่อนสินค้า เพื่อให้ลูกค้าใหม่เห็นผลลัพธ์จริง รู้สึกอุ่นใจ และค่อยเลือกชุดที่เหมาะกับตัวเอง</p>
    </div>
    <div class="review-home-proof-meta">
      <div><b>${esc(totalLabel)}</b><span>ภาพรีวิวจริง</span></div>
      <div><b>ลูกค้าจริง</b><span>ส่งกลับมาหลังใช้งาน</span></div>
      <div><b>เปิดเต็มจอ</b><span>ซูมดูรายละเอียดได้ทันที</span></div>
    </div>
    <div class="review-spotlight-row">${items.map((item) => `<a class="review-spotlight-card glass" href="${esc(item.image)}" data-zoom="${esc(item.image)}" data-lightbox-group="reviews-home-spotlight" data-lightbox-index="${Number.isFinite(item.lightboxIndex) ? item.lightboxIndex : 0}" data-lightbox-title="${esc(item.title || 'รีวิวจากลูกค้าจริง')}" data-lightbox-note="${esc(item.note || '')}">
      <div class="review-spotlight-card-thumb"><img src="${esc(item.image)}" alt="${esc(item.title || 'รีวิวจากลูกค้าจริง')}" loading="lazy"></div>
      <div class="review-spotlight-card-copy">${item.badge ? `<small>${esc(item.badge)}</small>` : ''}<b>${esc(item.title || 'รีวิวจากลูกค้าจริง')}</b><span>${esc(item.note || 'ภาพรีวิวจริงจากลูกค้าของคุณจูนนุชฟอร์ไลฟ์')}</span></div>
    </a>`).join('')}</div>
    <div class="compact-actions"><a href="${routeHref('/reviews')}" class="btn btn-primary">ดูรีวิวทั้งหมด</a></div>
  </section>`;
}
function reviewShowcaseCards(items = [], group = 'reviews-home') {
  return items.map((item, index) => `<a class="review-showcase-card glass" href="${esc(item.image)}" data-zoom="${esc(item.image)}" data-lightbox-group="${esc(group)}" data-lightbox-index="${Number.isFinite(item.lightboxIndex) ? item.lightboxIndex : index}" data-lightbox-title="${esc(item.title || 'รีวิวจากลูกค้า')}" data-lightbox-note="${esc(item.note || '')}">
    <div class="review-showcase-thumb"><img src="${esc(item.image)}" alt="${esc(item.title || 'รีวิวจากลูกค้า')}" loading="lazy"></div>
    <div class="review-showcase-copy">${item.badge ? `<small>${esc(item.badge)}</small>` : ''}<b>${esc(item.title || 'รีวิวจากลูกค้า')}</b><span>${esc(item.note || 'ภาพรีวิวและผลงานจริงจากลูกค้าของคุณจูนนุชฟอร์ไลฟ์')}</span></div>
  </a>`).join('');
}
function reviewShowcaseSection(items = []) {
  if (!items.length) return '';
  return `<section class="section review-showcase reveal">
    <div class="section-head"><span class="eyebrow">รีวิวจากผู้ใช้จริง</span><h2>ผลงานและความประทับใจจากลูกค้าของคุณจูนนุชฟอร์ไลฟ์</h2><p class="muted">เลื่อนดูภาพจริงจากลูกค้าได้ทันที เพื่อช่วยให้ลูกค้าใหม่เห็นความจริงใจและตัดสินใจได้ง่ายขึ้น</p></div>
    <div class="review-showcase-strip products-scroll">${reviewShowcaseCards(items, 'reviews-home')}</div>
    <div class="compact-actions"><a href="${routeHref('/reviews')}" class="btn btn-primary">เปิดหน้ารีวิวทั้งหมด</a></div>
  </section>`;
}
async function viewReviews() {
  const items = await refreshReviewGallery();
  const contacts = supportContacts();
  setPageMeta('รีวิวจากลูกค้า', 'รวมภาพรีวิวและผลงานจริงจากลูกค้าของคุณจูนนุชฟอร์ไลฟ์ เพื่อสร้างความมั่นใจก่อนสั่งซื้อ');
  if (!items.length) {
    return `<section class="section page-top review-page">
      <div class="empty-state glass reveal">
        <div class="es-ico">★</div>
        <h2>ยังไม่มีรูปรีวิวในระบบ</h2>
        <p>เมื่อนำรูปรีวิวเข้าระบบแล้ว หน้ารีวิวนี้จะแสดงอัตโนมัติทันที</p>
        <a class="btn btn-primary" href="${routeHref('/products')}">กลับไปดูสินค้า</a>
      </div>
    </section>`;
  }
  const spotlight = items.filter((item) => item.spotlight).sort((a, b) => (a.spotlightRank || 999) - (b.spotlightRank || 999));
  const hero = spotlight[0] || items[0];
  const spotlightSide = (spotlight.length ? spotlight.slice(1, 4) : items.slice(1, 4)).map((item) => ({
    ...item,
    lightboxIndex: Number.isFinite(item.lightboxIndex) ? item.lightboxIndex : items.findIndex((entry) => entry.image === item.image),
  }));
  const strip = items.slice(0, Math.min(items.length, 10));
  return `<section class="section page-top review-page">
    <div class="review-hero glass reveal">
      <div class="review-hero-copy">
        <span class="eyebrow">รีวิวจากลูกค้าจริง</span>
        <h1>ภาพผลงานที่ช่วยให้ลูกค้าใหม่ตัดสินใจง่ายขึ้น</h1>
        <p>รวมรีวิวและภาพผลงานจริงจากลูกค้าของคุณจูนนุชฟอร์ไลฟ์ เพื่อให้ลูกค้าใหม่เห็นผลลัพธ์จริง รู้สึกอุ่นใจ และมั่นใจก่อนทักเข้ามาปรึกษาคุณจูน</p>
        <div class="review-hero-stats">
          <div><b>${items.length}+</b><span>ภาพรีวิวไม่ซ้ำ</span></div>
          <div><b>ลูกค้าจริง</b><span>ภาพจากงานใช้งานจริง</span></div>
          <div><b>กดดูเต็มจอ</b><span>ขยายดูรายละเอียดได้ทันที</span></div>
        </div>
        <div class="hero-cta">
          <a href="${routeHref('/products')}" class="btn btn-primary">ดูสินค้าที่เกี่ยวข้อง</a>
          <a href="${esc(contacts.lineOfficialUrl)}" target="_blank" rel="noopener" class="btn btn-glass">ทัก LINE OA ตอนนี้</a>
        </div>
      </div>
      <a class="review-hero-media" href="${esc(hero.image)}" data-zoom="${esc(hero.image)}" data-lightbox-group="reviews-page" data-lightbox-index="${Number.isFinite(hero.lightboxIndex) ? hero.lightboxIndex : 0}" data-lightbox-title="${esc(hero.title)}" data-lightbox-note="${esc(hero.note)}">
        <img src="${esc(hero.image)}" alt="${esc(hero.title)}" loading="eager">
        <div class="review-hero-overlay"><span>${esc(hero.badge || 'Spotlight รีวิวเด่น')}</span><b>${esc(hero.title)}</b><small>${esc(hero.note)}</small></div>
      </a>
    </div>
    ${spotlightSide.length ? `<section class="section section-tight reveal">
      <div class="panel-head"><span class="eyebrow">Spotlight</span><h2>รีวิวเด่นที่ช่วยสร้างความมั่นใจก่อนตัดสินใจ</h2></div>
      <div class="review-spotlight-row">${spotlightSide.map((item) => `<a class="review-spotlight-card glass" href="${esc(item.image)}" data-zoom="${esc(item.image)}" data-lightbox-group="reviews-page" data-lightbox-index="${Number.isFinite(item.lightboxIndex) ? item.lightboxIndex : 0}" data-lightbox-title="${esc(item.title)}" data-lightbox-note="${esc(item.note)}">
        <div class="review-spotlight-card-thumb"><img src="${esc(item.image)}" alt="${esc(item.title)}" loading="lazy"></div>
        <div class="review-spotlight-card-copy">${item.badge ? `<small>${esc(item.badge)}</small>` : ''}<b>${esc(item.title)}</b><span>${esc(item.note)}</span></div>
      </a>`).join('')}</div>
    </section>` : ''}
    <section class="section section-tight review-strip-shell reveal">
      <div class="section-head"><span class="eyebrow">เลื่อนดูเร็ว</span><h2>สไลด์รีวิวจากผู้ใช้จริง</h2></div>
      <div class="review-showcase-strip products-scroll">${reviewShowcaseCards(strip, 'reviews-page')}</div>
    </section>
    <section class="section section-tight reveal">
      <div class="panel-head"><span class="eyebrow">แกลเลอรีทั้งหมด</span><h2>เปิดดูรีวิวทั้งหมดได้ในที่เดียว</h2></div>
      <div class="review-gallery-wall">
        ${items.map((item, index) => `<a class="review-gallery-item glass" href="${esc(item.image)}" data-zoom="${esc(item.image)}" data-lightbox-group="reviews-page" data-lightbox-index="${Number.isFinite(item.lightboxIndex) ? item.lightboxIndex : index}" data-lightbox-title="${esc(item.title)}" data-lightbox-note="${esc(item.note)}">
          <div class="review-gallery-item-thumb"><img src="${esc(item.image)}" alt="${esc(item.title)}" loading="lazy"></div>
          <div class="review-gallery-item-copy">${item.badge ? `<small>${esc(item.badge)}</small>` : ''}<b>${esc(item.title)}</b><span>${esc(item.note)}</span></div>
        </a>`).join('')}
      </div>
    </section>
  </section>`;
}
function landingLeadSection(landing) {
  const stages = asArray(landing.stages).map((stage) => stage.title);
  return `<section class="section">
    <div class="consult-band glass reveal landing-consult" id="leadFormBlock">
      <div class="consult-copy">
        <span class="eyebrow">เก็บลีดจากหน้า ${esc(landing.crop)}</span>
        <h2>ให้ลูกค้ากลุ่ม${esc(landing.crop)} ทิ้งข้อมูลไว้ได้ทันที</h2>
        <p>เหมาะกับการยิงแอดและทำ SEO เพราะลูกค้ากรอกเฉพาะข้อมูลหลักก่อน แล้วคุณจูนค่อยติดตามต่อใน LINE หรือโทรกลับเพื่อปิดการขาย</p>
        <div class="consult-points">
          <div>${icon('leaf', 'mini-ico')} ระบุพืช ช่วงการปลูก และปัญหาได้ตรงหน้า</div>
          <div>${icon('chat', 'mini-ico')} ส่งต่อให้ทีมขายติดตามต่อผ่าน LINE และโทรกลับ</div>
          <div>${icon('shieldleaf', 'mini-ico')} ใช้เป็นหน้าเฉพาะแคมเปญเพื่อวัดผลแยกตามพืชได้</div>
        </div>
        ${lineCTA('line-inline')}
      </div>
      <form id="leadForm" class="lead-form lead-form-compact">
        <div class="lead-form-intro lead-wide"><b>ขอคำแนะนำเฉพาะแปลง</b><span>ฟอร์มนี้ส่งตรงให้คุณจูน เพื่อใช้ติดตามลูกค้ากลุ่ม${esc(landing.crop)} ต่อได้ทันที</span></div>
        <input type="hidden" name="crop" value="${esc(landing.crop)}">
        <label>ชื่อเกษตรกร / ลูกค้า<input name="name" required autocomplete="name" placeholder="ชื่อ-นามสกุล" /></label>
        <label>เบอร์โทร<input name="phone" required inputmode="tel" autocomplete="tel" placeholder="08x-xxx-xxxx" /></label>
        <label>จังหวัด<input name="province" autocomplete="address-level1" placeholder="เช่น จันทบุรี" /></label>
        <label>ช่วงการปลูก / เป้าหมาย<select name="stage">
          <option value="">เลือกช่วงหรือเป้าหมาย</option>
          ${stages.map((stage) => `<option value="${esc(stage)}">${esc(stage)}</option>`).join('')}
          <option value="ยังไม่แน่ใจ ขอคำแนะนำ">ยังไม่แน่ใจ ขอคำแนะนำ</option>
        </select></label>
        <label class="lead-wide">ปัญหาหรือเป้าหมายของแปลง<textarea name="problem" rows="3" placeholder="เช่น ใบไม่เขียว ผลร่วง อยากเร่งใบ หรืออยากได้สูตรบำรุงผล"></textarea></label>
        <button type="submit" class="btn btn-primary lead-submit">ส่งข้อมูลเพื่อรับคำแนะนำสำหรับ${esc(landing.crop)}</button>
        <p class="form-note">ข้อมูลจะถูกบันทึกพร้อมแหล่งที่มาของหน้า landing นี้ เพื่อให้ติดตามผลแคมเปญและปิดการขายได้จริง</p>
      </form>
    </div>
  </section>`;
}
function productSupportSection(p, rev) {
  const extra = productExtra(p);
  const crops = productCrops(p);
  const reviewText = rev?.stats?.count ? `${rev.stats.avg} ดาว จาก ${rev.stats.count} รีวิว` : 'ยังไม่มีรีวิว ระบบพร้อมให้ลูกค้ารีวิวหลังซื้อ';
  const points = settingLines('SITE_CHECKOUT_POINTS', DEFAULT_CHECKOUT_POINTS);
  const podPoints = asArray(extra.sellingPoints);
  return `<section class="detail-panel glass reveal">
    <div class="panel-head"><span class="eyebrow">พร้อมขายจริง</span><h2>ช่วยให้ตัดสินใจง่ายก่อนสั่งซื้อ</h2></div>
    <div class="support-grid">
      <article class="support-card">
        <h3>เหมาะกับใคร</h3>
        <p>${isAgriProduct(p)
          ? `เหมาะกับเกษตรกรที่ปลูก${esc(crops.join(' / ') || 'พืชทั่วไป')} และต้องการสูตรที่มีข้อมูลการใช้ชัดเจน`
          : isPodProduct(p)
            ? esc(extra.audience || 'เหมาะกับลูกค้าที่มองหาพอตพร้อมส่ง ลุคเด่น ราคาอ่านง่าย และเลือกซื้อได้ไว')
            : 'เหมาะกับลูกค้าที่มองหาสินค้าเพื่อสุขภาพและความงามจากแบรนด์เดียวกัน'}</p>
      </article>
      <article class="support-card">
        <h3>ความน่าเชื่อถือ</h3>
        <p>${esc(reviewText)}</p>
        <p class="muted">${isPodProduct(p)
          ? esc(extra.sellingNote || 'หน้าสินค้าชุดนี้ถูกจัดข้อมูลไว้ให้ตอบคำถามลูกค้าเรื่องลุค การใช้งาน และจุดเด่นได้ง่ายขึ้น')
          : (extra.labelUrl ? 'มีเอกสารฉลากหรือไฟล์ประกอบให้เปิดดูได้จากหน้านี้' : 'สามารถใส่ฉลากหรือไฟล์ประกอบเพิ่มได้จากหลังบ้านเพื่อช่วยปิดการขายง่ายขึ้น')}</p>
      </article>
      <article class="support-card">
        <h3>${isPodProduct(p) ? 'จุดเด่นที่ใช้ปิดการขาย' : 'ก่อนและหลังสั่งซื้อ'}</h3>
        <ul class="support-list">${(isPodProduct(p) && podPoints.length ? podPoints : points).map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
      </article>
    </div>
    <div class="support-cta">
      ${lineCTA()}
      <a class="btn btn-glass" href="${routeHref('/checkout')}">ไปที่ขั้นตอนสั่งซื้อ</a>
    </div>
  </section>`;
}

let _pf = { q: '', sort: 'default', crop: null, segment: 'all', category: 'all', availability: 'all' };
function productCategoryOptions() {
  return visibleProductCategories();
}
function ensureProductCategoryFilterValid() {
  const options = productCategoryOptions();
  if (_pf.category !== 'all' && !options.includes(_pf.category)) _pf.category = 'all';
}
function productCrops(p) {
  const direct = asArray(productExtra(p).cropTargets);
  if (direct.length) return direct;
  return Object.entries(cropGuideMap()).filter(([, cfg]) => cfg.ids.includes(p.id)).map(([crop]) => crop);
}
function isPodProduct(p) {
  return productCategory(p) === 'พอต';
}
function prioritizePodProducts(list = []) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    const aPod = isPodProduct(a) ? 1 : 0;
    const bPod = isPodProduct(b) ? 1 : 0;
    if (aPod !== bPod) return bPod - aPod;
    return 0;
  });
}
function filteredProducts() {
  let list = sortProductsForDisplay(PRODUCTS);
  if (_pf.sort === 'default' && !_pf.q && !_pf.crop && (_pf.category === 'all' || !_pf.category)) {
    list = prioritizePodProducts(list);
  }
  if (_pf.segment && _pf.segment !== 'all') list = list.filter((p) => productSegment(p) === _pf.segment);
  if (_pf.category && _pf.category !== 'all') list = list.filter((p) => productCategory(p) === _pf.category);
  if (_pf.availability === 'in-stock') list = list.filter((p) => Number(p.stock || 0) > 0);
  else if (_pf.availability === 'sale') list = list.filter((p) => productDiscountPercent(p) > 0 || productPromoTag(p));
  else if (_pf.availability === 'featured') list = list.filter((p) => productIsFeatured(p) || productTopPriorityValue(p) < 999);
  if (_pf.crop && cropGuideMap()[_pf.crop]) { const ids = cropGuideMap()[_pf.crop].ids; list = list.filter((p) => ids.includes(p.id)); }
  if (_pf.q) {
    const q = _pf.q.toLowerCase();
    list = list.filter((p) => (p.name + ' ' + p.short + ' ' + displayProductTag(p) + ' ' + productCategory(p) + ' ' + productCrops(p).join(' ')).toLowerCase().includes(q));
  }
  if (_pf.sort === 'price-asc') list.sort((a, b) => effPrice(a) - effPrice(b));
  else if (_pf.sort === 'price-desc') list.sort((a, b) => effPrice(b) - effPrice(a));
  else if (_pf.sort === 'rating') list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  else if (_pf.sort === 'popular') list.sort((a, b) => ((b.reviews || 0) + (productIsFeatured(b) ? 20 : 0)) - ((a.reviews || 0) + (productIsFeatured(a) ? 20 : 0)));
  return list;
}
function renderProductGrid() {
  const grid = document.getElementById('productGrid'); if (!grid) return;
  const list = filteredProducts();
  const count = document.getElementById('productResultCount');
  if (count) count.textContent = `${list.length} รายการ`;
  grid.innerHTML = list.length ? list.map((p, i) => productCard(p, i)).join('')
    : '<p class="muted" style="grid-column:1/-1;text-align:center;padding:40px">ไม่พบสินค้าที่ค้นหา</p>';
  enhance();
}
function renderPodCollectionHero() {
  const podList = prioritizePodProducts(PRODUCTS.filter((p) => p.active !== false && isPodProduct(p))).slice(0, 5);
  if (!podList.length) return '';
  const lead = podList[0];
  const accents = podList.slice(1, 4);
  return `<section class="pod-collection glass reveal">
    <div class="pod-collection-copy">
      <span class="eyebrow">คอลเลกชันพอต</span>
      <h3>พอตพร้อมส่ง คัดลุคเด่นสำหรับขายหน้าร้านและออนไลน์</h3>
      <p>${esc(lead.short || 'รวมพอตดีไซน์เด่น พร้อมส่ง ราคาอ่านง่าย ดูภาพรวมแล้วเลือกตัวที่เหมาะกับสไตล์ลูกค้าได้ทันที')}</p>
      <div class="pod-collection-points">
        <span>ราคาเปิดง่าย 399 บาท</span>
        <span>คัดดีไซน์ที่ภาพจำชัด</span>
        <span>เหมาะดันเป็นตัวเด่นในหน้าร้าน</span>
      </div>
      <div class="pod-collection-actions">
        <button type="button" class="btn btn-primary" data-category="พอต">ดูเฉพาะพอต</button>
        <a class="btn btn-glass" href="${routeHref('/product/' + lead.id)}">ดูตัวเด่นของคอลเลกชัน</a>
      </div>
    </div>
    <div class="pod-collection-visual">
      <a class="pod-collection-feature" href="${routeHref('/product/' + lead.id)}">
        <div class="pod-collection-media"><img src="${esc(lead.image || '')}" alt="${esc(lead.name)}"></div>
        <div class="pod-collection-meta">
          <b>${esc(lead.name)}</b>
          <span>${esc(productExtra(lead).highlight || lead.short || '')}</span>
        </div>
      </a>
      <div class="pod-collection-list">${accents.map((item) => `<a class="pod-collection-mini" href="${routeHref('/product/' + item.id)}">
        <img src="${esc(item.image || '')}" alt="${esc(item.name)}">
        <div><b>${esc(item.name)}</b><span>${esc(productExtra(item).highlight || '')}</span></div>
      </a>`).join('')}</div>
    </div>
  </section>`;
}
function viewProducts() {
  ensureProductCategoryFilterValid();
  setPageMeta('สินค้าทั้งหมด', 'รวมสินค้าเกษตร สินค้าสุขภาพ และความงาม พร้อมค้นหาและเรียงลำดับได้ง่าย');
  const categoryChips = ['all', ...productCategoryOptions()].map((item) => {
    const label = item === 'all' ? 'ทั้งหมด' : displayProductCategoryLabel(item);
    return `<button type="button" class="chip-btn ${_pf.category === item ? 'on' : ''}" data-category="${esc(item)}">${esc(label)}</button>`;
  }).join('');
  const availabilityChips = [
    ['all', 'ทุกสถานะ'],
    ['in-stock', 'พร้อมส่ง'],
    ['sale', 'โปร/ลดราคา'],
    ['featured', 'แนะนำ'],
  ].map(([value, label]) => `<button type="button" class="chip-btn chip-soft ${_pf.availability === value ? 'on' : ''}" data-availability="${value}">${label}</button>`).join('');
  const initialProducts = filteredProducts();
  return `
  <section class="section page-top products-page">
    <div class="products-hero-shell glass reveal">
      <div class="products-hero-copy">
        <span class="eyebrow">Premium Selection</span>
        <h2>สินค้าของเรา</h2>
        <p>เลือกสินค้าให้เร็วขึ้นจากหมวดหมู่ สถานะพร้อมส่ง และคำแนะนำที่จัดเรียงให้อ่านง่าย</p>
      </div>
      <div class="products-hero-stats">
        <article><b>${PRODUCTS.filter((p) => p.active !== false).length}</b><span>รายการทั้งหมด</span></article>
        <article><b>${PRODUCTS.filter((p) => Number(p.stock || 0) > 0 && p.active !== false).length}</b><span>พร้อมส่ง</span></article>
      </div>
    </div>
    ${renderPodCollectionHero()}
    <div class="products-control-panel glass reveal">
      <div class="products-control-top">
        <div class="search-wrap">
          <svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <input id="searchInput" placeholder="ค้นหาชื่อสินค้า หมวดหมู่ หรือจุดเด่น…" value="${esc(_pf.q)}" autocomplete="off">
        </div>
        <select id="sortSelect" class="sort-sel">
          <option value="default" ${_pf.sort === 'default' ? 'selected' : ''}>แนะนำ</option>
          <option value="popular" ${_pf.sort === 'popular' ? 'selected' : ''}>ขายดี / ถูกพูดถึง</option>
          <option value="price-asc" ${_pf.sort === 'price-asc' ? 'selected' : ''}>ราคาน้อย→มาก</option>
          <option value="price-desc" ${_pf.sort === 'price-desc' ? 'selected' : ''}>ราคามาก→น้อย</option>
          <option value="rating" ${_pf.sort === 'rating' ? 'selected' : ''}>คะแนนสูงสุด</option>
        </select>
      </div>
      <div class="products-filter-strip">
        <div class="products-filter-group">
          <span>หมวดหมู่</span>
          <div class="cat-chips">${categoryChips}</div>
        </div>
        <div class="products-filter-group">
          <span>สถานะ</span>
          <div class="cat-chips product-quick-filters">${availabilityChips}</div>
        </div>
      </div>
    </div>
    <div class="product-result-bar reveal"><b id="productResultCount">${initialProducts.length} รายการ</b><span>เลือกดูรายละเอียด รูป รีวิว และ FAQ ก่อนสั่งซื้อ</span></div>
    <div class="products" id="productGrid">${initialProducts.map((p, i) => productCard(p, i)).join('')}</div>
  </section>`;
}
function viewCropLanding({ slug }) {
  const landing = cropLandingMap()[slug];
  if (!landing) return viewNotFound();
  const products = sortProductsForDisplay(PRODUCTS.filter((p) => landing.related.includes(p.id))).slice(0, 2);
  const reviews = asArray(landing.reviews);
  const gallery = asArray(landing.gallery);
  const visualItems = [];
  if (landing.heroImage) {
    visualItems.push({
      image: landing.heroImage,
      title: landing.hero || `${landing.crop} ใช้อะไรดี`,
      note: landing.tip || landing.problem,
    });
  }
  gallery.forEach((item) => {
    if (!item?.image) return;
    if (visualItems.some((entry) => entry.image === item.image)) return;
    visualItems.push(item);
  });
  if (!visualItems.length && reviews[0]?.image) {
    visualItems.push({
      image: reviews[0].image,
      title: reviews[0].title || `ภาพหน้างาน${landing.crop}`,
      note: reviews[0].note || landing.tip || landing.problem,
    });
  }
  const mainVisual = visualItems[0] || null;
  const mainVisualIsHero = !!(mainVisual && landing.heroImage && mainVisual.image === landing.heroImage);
  const mainVisualRatio = mainVisualIsHero ? landing.heroRatio : 'wide';
  const mainVisualFocus = mainVisualIsHero ? landing.heroFocus : 'center';
  const secondaryVisuals = visualItems.slice(1, 4);
  const reviewLead = reviews[0] || null;
  const reviewRest = reviewLead ? reviews.slice(1) : [];
  const stageCards = asArray(landing.stages).map((stage) => {
    const stageProducts = PRODUCTS.filter((p) => asArray(stage.ids).includes(p.id));
    return `<article class="stage-card">
      <span class="stage-step">${esc(stage.title)}</span>
      <p>${esc(stage.detail)}</p>
      <div class="stage-links">${stageProducts.map((p) => `<a href="${routeHref('/product/' + p.id)}">${esc(p.name)}</a>`).join('')}</div>
    </article>`;
  }).join('');
  setPageMeta(
    landing.seoTitle || `${landing.crop} ใช้อะไรดี`,
    landing.seoDescription || `โซลูชัน${landing.crop}ของ ${S('SITE_NAME')} สำหรับแก้ปัญหาและวางสูตรสินค้าให้ตรงช่วงการปลูก`,
    landing.seoImage || landing.heroImage || (gallery[0]?.image || '') || (reviews[0]?.image || '')
  );
  return `<section class="section page-top crop-landing">
    <div class="landing-hero-shell">
      <div class="landing-hero glass reveal">
        <span class="eyebrow">Landing Page</span>
        <h1>${esc(landing.hero)}</h1>
        <p>${esc(landing.problem)}</p>
        <div class="hero-cta">
          <a href="${routeHref('/products')}" class="btn btn-primary">ดูสินค้าที่เกี่ยวข้อง</a>
          <button class="btn btn-glass" type="button" data-prefillcrop="${esc(landing.crop)}">ขอคำแนะนำสำหรับ${esc(landing.crop)}</button>
          ${lineCTA()}
        </div>
        <div class="landing-pill-row">${asArray(landing.offer).map((item) => `<span class="landing-pill">${esc(item)}</span>`).join('')}</div>
        <div class="landing-inline-points">${asArray(landing.painPoints).slice(0, 3).map((item) => `<div>${esc(item)}</div>`).join('')}</div>
      </div>
      <aside class="landing-visual-panel glass reveal">
        ${mainVisual ? `<a class="landing-visual-main" href="${esc(mainVisual.image)}" data-zoom="${esc(mainVisual.image)}" data-lightbox-group="crop-${esc(slug)}-visual" data-lightbox-index="0" data-lightbox-title="${esc(mainVisual.title || `ภาพประกอบ${landing.crop}`)}" data-lightbox-note="${esc(mainVisual.note || landing.tip || landing.problem)}">
          <div class="landing-visual-media" data-ratio="${esc(mainVisualRatio)}">
            <img src="${esc(mainVisual.image)}" alt="${esc(mainVisual.title || landing.crop)}" style="object-position:${esc(heroFocusObjectPosition(mainVisualFocus))}">
            <div class="landing-visual-overlay">
              <span class="landing-visual-badge">ภาพเด่นของหน้า</span>
              <b>${esc(mainVisual.title || `ภาพประกอบ${landing.crop}`)}</b>
              <span>${esc(mainVisual.note || landing.tip || landing.problem)}</span>
            </div>
          </div>
        </a>` : `<div class="landing-visual-empty">
          <b>ยังไม่มีภาพหน้าแคมเปญ</b>
          <span>เพิ่มภาพปกหรือแกลเลอรีจากหลังบ้านเพื่อให้หน้าเฉพาะพืชดูโดดเด่นขึ้น</span>
        </div>`}
        ${secondaryVisuals.length ? `<div class="landing-visual-side">${secondaryVisuals.map((item, idx) => `<a class="landing-visual-mini" href="${esc(item.image)}" data-zoom="${esc(item.image)}" data-lightbox-group="crop-${esc(slug)}-visual" data-lightbox-index="${idx + 1}" data-lightbox-title="${esc(item.title || `ภาพหน้างาน${landing.crop}`)}" data-lightbox-note="${esc(item.note || '')}">
          <div class="landing-visual-mini-thumb"><img src="${esc(item.image)}" alt="${esc(item.title || landing.crop)}"></div>
          <div class="landing-visual-mini-copy">
            <b>${esc(item.title || `ภาพหน้างาน${landing.crop}`)}</b>
            ${item.note ? `<span>${esc(item.note)}</span>` : ''}
          </div>
        </a>`).join('')}</div>` : ''}
      </aside>
    </div>
    <div class="landing-grid landing-grid-compact">
      <section class="detail-panel glass reveal">
        <div class="panel-head"><span class="eyebrow">ลำดับแนะนำ</span><h2>เริ่มจากช่วงการปลูกที่ลูกค้ากำลังเจอ</h2></div>
        ${stageCards ? `<div class="stage-grid stage-grid-stack">${stageCards}</div>` : '<div class="empty-inline-note">ยังไม่มีลำดับแนะนำสำหรับหน้านี้</div>'}
      </section>
      <section class="detail-panel glass reveal">
        <div class="panel-head"><span class="eyebrow">สูตรแนะนำ</span><h2>เลือกตัวที่เกี่ยวข้องก่อน แล้วค่อยดูรายละเอียดเต็ม</h2></div>
        ${products.length ? `<div class="products products-compact">${products.map((p, i) => productCard(p, i)).join('')}</div>` : '<div class="empty-inline-note">ยังไม่มีสินค้าแนะนำสำหรับหน้านี้</div>'}
        <div class="proof-callout compact-callout">
          <h3>${esc(landing.proofTitle || 'ใช้เป็นหน้าแคมเปญเฉพาะพืชได้')}</h3>
          <p>${esc(landing.proofBody || landing.tip)}</p>
        </div>
      </section>
    </div>
    ${gallery.length ? `<section class="detail-panel glass reveal">
      <div class="panel-head"><span class="eyebrow">ภาพประกอบหน้า</span><h2>ภาพบรรยากาศและภาพประกอบสำหรับลูกค้ากลุ่ม${esc(landing.crop)}</h2></div>
      <div class="landing-gallery-grid">${gallery.map((item, idx) => `<a class="landing-gallery-card ${idx === 0 ? 'is-featured' : ''}" href="${esc(item.image)}" data-zoom="${esc(item.image)}" data-lightbox-group="crop-${esc(slug)}-gallery" data-lightbox-index="${idx}" data-lightbox-title="${esc(item.title || `ภาพประกอบ${landing.crop}`)}" data-lightbox-note="${esc(item.note || '')}">
        <div class="landing-gallery-thumb"><img src="${esc(item.image)}" alt="${esc(item.title || landing.crop)}"></div>
        <div class="landing-gallery-copy">
          <b>${esc(item.title || `ภาพประกอบ${landing.crop}`)}</b>
          ${item.note ? `<span>${esc(item.note)}</span>` : ''}
        </div>
      </a>`).join('')}</div>
    </section>` : ''}
    <section class="detail-panel glass reveal">
      <div class="panel-head"><span class="eyebrow">รีวิวหน้างาน</span><h2>ภาพรีวิวและผลงานของลูกค้ากลุ่ม${esc(landing.crop)}</h2></div>
      ${reviews.length ? `<div class="review-photo-layout">
        ${reviewLead ? `<a class="review-photo-spotlight" href="${esc(reviewLead.image)}" data-zoom="${esc(reviewLead.image)}" data-lightbox-group="crop-${esc(slug)}-reviews" data-lightbox-index="0" data-lightbox-title="${esc(reviewLead.title || 'รีวิวจากลูกค้า')}" data-lightbox-note="${esc(reviewLead.note || `ภาพผลงานจริงของลูกค้ากลุ่ม${landing.crop}`)}">
          <div class="review-photo-spotlight-thumb"><img src="${esc(reviewLead.image)}" alt="${esc(reviewLead.title || landing.crop)}"></div>
          <div class="review-photo-spotlight-copy">${reviewLead.title ? `<b>${esc(reviewLead.title)}</b>` : '<b>รีวิวจากลูกค้า</b>'}${reviewLead.note ? `<span>${esc(reviewLead.note)}</span>` : `<span>ภาพผลงานจริงของลูกค้ากลุ่ม${esc(landing.crop)}</span>`}</div>
        </a>` : ''}
        ${reviewRest.length ? `<div class="review-photo-grid">${reviewRest.map((item, idx) => `<a class="review-photo-card" href="${esc(item.image)}" data-zoom="${esc(item.image)}" data-lightbox-group="crop-${esc(slug)}-reviews" data-lightbox-index="${idx + 1}" data-lightbox-title="${esc(item.title || 'รีวิวจากลูกค้า')}" data-lightbox-note="${esc(item.note || '')}">
          <div class="review-photo-thumb"><img src="${esc(item.image)}" alt="${esc(item.title || landing.crop)}"></div>
          <div class="review-photo-copy">${item.title ? `<b>${esc(item.title)}</b>` : '<b>รีวิวจากลูกค้า</b>'}${item.note ? `<span>${esc(item.note)}</span>` : ''}</div>
        </a>`).join('')}</div>` : ''}
      </div>
      ` : `<div class="empty-inline-note">ยังไม่มีรูปรีวิวสำหรับ${esc(landing.crop)} คุณสามารถเพิ่มรูปผลงานจริงได้จากหลังบ้านในหัวข้อหน้าเฉพาะพืช</div>`}
    </section>
    ${landing.faq?.length ? `<section class="detail-panel glass reveal">
      <div class="panel-head"><span class="eyebrow">FAQ สำหรับทีมขาย</span><h2>คำถามที่ควรตอบให้ลูกค้ากลุ่ม${esc(landing.crop)}</h2></div>
      <div class="faq-list compact-faq">${landing.faq.map((item, idx) => `<details class="faq-item" ${idx === 0 ? 'open' : ''}><summary>${esc(item.q)}</summary><p>${esc(item.a)}</p></details>`).join('')}</div>
    </section>` : ''}
    ${landingLeadSection(landing)}
  </section>`;
}
function viewWishlist() {
  const list = sortProductsForDisplay(PRODUCTS.filter((p) => wishlist.has(p.id)));
  return `<section class="section page-top">
    <div class="section-head reveal"><span class="eyebrow">รายการโปรด</span><h2>สินค้าที่คุณถูกใจ</h2></div>
    ${list.length ? `<div class="products">${list.map((p, i) => productCard(p, i)).join('')}</div>`
      : `<div class="empty-state glass reveal"><div class="es-ico">♥</div><h2>ยังไม่มีรายการโปรด</h2><p>กดหัวใจที่สินค้าเพื่อบันทึกไว้ดูภายหลัง</p><a class="btn btn-primary" href="${routeHref('/products')}">เลือกซื้อสินค้า</a></div>`}
  </section>`;
}

// ── เครื่องคำนวณอัตราผสม (standalone) ──
function viewCalc() {
  const rated = calcRatedProducts();
  if (!rated.length) return `<section class="section page-top"><div class="empty-state glass reveal"><div class="es-ico">🧮</div><h2>ยังไม่มีข้อมูลอัตราการใช้</h2><p>เพิ่มสเปก "อัตรา" ให้สินค้าในหลังบ้าน</p></div></section>`;
  const crops = calcCropList();
  const firstCrop = crops[0] || '';
  const firstCropCfg = calcCropConfig(firstCrop);
  const firstProblems = calcProblemOptions(firstCrop);
  const firstProblem = firstProblems[0] || null;
  const firstStage = firstProblem?.stage || calcStageOptions(firstCrop)[0] || '';
  const firstPreset = calcPresetDetails(firstCrop, firstProblem?.preset || '') || asArray(firstCropCfg?.mixes)[0] || null;
  const productCards = rated.map((p) => {
    const knowledge = calcKnowledge().products?.[p.id] || {};
    const checked = firstPreset?.ids?.includes(p.id) ? 'checked' : '';
    return `<label class="calc-product-card ${checked ? 'is-selected' : ''}" data-calc-card>
      <input type="checkbox" data-calc-product value="${p.id}" ${checked}>
      <div class="calc-product-copy">
        <b>${esc(p.name)}</b>
        <span>${esc(knowledge.label || p.short || '')}</span>
      </div>
    </label>`;
  }).join('');
  return `<section class="section page-top">
    <div class="section-head reveal"><span class="eyebrow">เครื่องมือพร้อมใช้</span><h2>คำนวณสูตรผสมให้พอดีในไม่กี่วินาที</h2></div>
    <div class="calc-page glass reveal">
      <div class="calc-smart-intro">
        <b>เลือกพืช เลือกอาการ แล้วเอาสูตรไปใช้ต่อได้เลย</b>
        <span>ระบบสรุปปริมาณใช้ให้ทันที ทั้งตามถัง น้ำรวม และพื้นที่ปลูก โดยคงเฉพาะข้อมูลที่จำเป็นจริง</span>
      </div>
      <div class="calc-mode-pills">
        <button type="button" class="chip-btn on" data-calcmode="tank">ตามถัง</button>
        <button type="button" class="chip-btn" data-calcmode="water">ตามน้ำรวม</button>
        <button type="button" class="chip-btn" data-calcmode="area">ตามพื้นที่</button>
      </div>
      <div class="calc-page-grid">
        <label>พืช<select id="calcCrop">${crops.map((crop) => `<option value="${esc(crop)}">${esc(crop)}</option>`).join('')}</select></label>
        <label class="calc-hidden-select">อาการ<select id="calcProblem"><option value="">เลือกอาการที่เจอ</option>${firstProblems.map((item) => `<option value="${esc(item.key)}" ${firstProblem?.key === item.key ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</select></label>
        <label>ระยะ<select id="calcStage"><option value="${esc(firstStage)}">${esc(firstStage || 'ทุกระยะ')}</option></select></label>
        <label>สูตร<select id="calcPreset"><option value="${esc(firstPreset?.key || '')}">${esc(firstPreset?.title || 'จัดเอง')}</option></select></label>
        <label>ระดับ<select id="calcStrength"><option value="low">เริ่มต้น</option><option value="mid" selected>กลาง</option><option value="high">เข้มขึ้น</option></select></label>
        <label>ถังอ้างอิง (ลิตร)<input type="number" id="calcRefTank" value="20" min="1" max="2000"></label>
        <div class="lead-wide calc-problem-shell">
          <span class="calc-section-label">เลือกอาการที่ใกล้ที่สุด</span>
          <div class="calc-problem-grid" id="calcProblemCards">${calcProblemCardsHTML(firstCrop, firstProblem?.key || '')}</div>
          <div class="calc-problem-note" id="calcProblemNote">${esc(firstProblem?.note || (firstCrop ? `เลือกอาการของ${firstCrop}ที่ใกล้ที่สุด แล้วระบบจะจัดสูตรตั้งต้นให้ทันที` : 'เลือกพืชก่อน แล้วค่อยเลือกอาการที่ต้องการแก้'))}</div>
        </div>
        <label data-mode-field="tank">ขนาดถังพ่น (ลิตร)<input type="number" id="calcPageTank" value="20" min="1" max="2000"></label>
        <label data-mode-field="tank">จำนวนถัง<input type="number" id="calcTankCount" value="1" min="1" max="500"></label>
        <label data-mode-field="water" hidden>ปริมาณน้ำรวม (ลิตร)<input type="number" id="calcWaterTotal" value="200" min="1" max="200000"></label>
        <label data-mode-field="area" hidden>พื้นที่ (ไร่)<input type="number" id="calcAreaRai" value="1" min="0.1" step="0.1" max="10000"></label>
        <label data-mode-field="area" hidden>ปริมาณน้ำต่อไร่ (ลิตร)<input type="number" id="calcWaterPerRai" value="${esc(firstCropCfg?.waterPerRai || defaultWaterPerRai(rated[0]))}" min="1" max="2000"></label>
        <label class="lead-wide calc-toggle">
          <input type="checkbox" id="calcIncludeSticker">
          <span>เพิ่มสารจับใบ เพื่อช่วยการเกาะใบและลดการชะล้าง</span>
        </label>
        <div class="lead-wide calc-preset-note" id="calcPresetNote">${esc(firstPreset?.note || (firstCrop ? `ระบบตั้งค่าน้ำของ${firstCrop}ให้แล้ว และคุณยังปรับเองได้` : 'เลือกพืชหรือสูตร แล้วระบบจะจัดชุดเริ่มต้นให้'))}</div>
        <div class="lead-wide calc-budget-shell">
          <span class="calc-section-label">เลือกระดับงบที่ต้องการ</span>
          <div class="calc-budget-pills" id="calcBudgetPills">${calcBudgetPillsHTML('balanced')}</div>
          <div class="calc-budget-summary" id="calcBudgetSummary">${esc(calcBudgetMeta('balanced').desc)}</div>
          <input type="hidden" id="calcBudgetLevel" value="balanced">
        </div>
        <div class="lead-wide">
          <span class="calc-section-label">เลือกชุดสูตรที่ต้องการคำนวณ</span>
          <div class="calc-product-list" id="calcProductList">${productCards}</div>
        </div>
      </div>
      <div class="calc-page-out" id="calcPageOut">เลือกสูตรแล้วผลลัพธ์จะขึ้นตรงนี้</div>
      <div class="calc-action-row">
        <button type="button" class="btn btn-primary" id="calcCopyBtn">คัดลอกสูตร</button>
        <button type="button" class="btn btn-glass" id="calcPitchCopyBtn">คัดลอกข้อความพร้อมส่ง</button>
      </div>
      <div class="calc-plan-duration">
        <span class="calc-section-label">แผนพ่น</span>
        <div class="calc-plan-day-pills">
          ${CALC_PLAN_DAY_OPTIONS.map((day) => `<button type="button" class="chip-btn ${day === 14 ? 'on' : ''}" data-calcplandays="${day}">${day} วัน</button>`).join('')}
        </div>
        <input type="hidden" id="calcPlanDays" value="14">
      </div>
      <div class="calc-support-grid">
        <div id="calcTimeline"></div>
        <div class="calc-compare-shell">
          <div class="calc-compare-top">
            <div>
              <span class="eyebrow">เทียบสูตร</span>
            <h3>เห็นทางเลือกในจอเดียว</h3>
            </div>
            <label class="calc-compare-select">สูตรอีกชุด
              <select id="calcComparePreset"><option value="">เลือกสูตรมาเทียบ</option></select>
            </label>
          </div>
          <div id="calcCompareOut"></div>
        </div>
      </div>
      <div class="calc-summary-grid">
        <article class="calc-summary-card"><span>น้ำรวมที่ใช้</span><b id="calcWaterOut">—</b></article>
        <article class="calc-summary-card"><span>สูตรหลัก</span><b id="calcProductOut">—</b></article>
        <article class="calc-summary-card"><span>เทียบเป็นถัง</span><b id="calcTankOut">—</b></article>
        <article class="calc-summary-card"><span>สารจับใบ</span><b id="calcStickerOut">—</b></article>
      </div>
      <div class="calc-mix-plan" id="calcMixPlan"></div>
      <div class="calc-bundle-card" id="calcBundleCard">
        <div class="calc-bundle-copy">
          <span class="eyebrow">พร้อมสั่ง</span>
          <b>หยิบตามสูตรนี้ได้เลย</b>
          <small id="calcBundleHint">ระบบคำนวณจำนวนขวดให้ตามแผนพ่นแล้ว</small>
          <div id="calcBundleItems"></div>
        </div>
        <div class="calc-bundle-actions">
          <button type="button" class="btn btn-primary" id="calcAddBundleBtn">เพิ่มชุดนี้ลงตะกร้า</button>
          <button type="button" class="btn btn-glass" id="calcCheckoutNowBtn">สั่งชุดนี้ทันที</button>
        </div>
      </div>
      <div class="calc-sales-card">
        <div class="calc-sales-copy">
          <span class="eyebrow">LINE OA ของร้าน</span>
          <b>เปิด LINE OA เพื่อคุยต่อหรือสั่งซื้อได้เลย</b>
          <small id="calcSalesHint">ใช้คุยต่อ เช็กสินค้า และสั่งซื้อกับร้านโดยตรง</small>
        </div>
        <div class="calc-action-row">
          <a class="btn btn-primary" id="calcOpenOaBtn" href="#" target="_blank" rel="noopener">เปิด LINE OA</a>
        </div>
      </div>
      <div class="calc-consult-card">
        <div class="calc-consult-copy">
          <span class="eyebrow">ให้คุณจูนช่วยดูต่อ</span>
          <b>เปิด LINE คุณจูนพร้อมสูตรนี้ได้ทันที</b>
          <small id="calcConsultHint">เหมาะเมื่ออยากให้ช่วยดูอาการจริงของแปลงแบบเจาะจง</small>
        </div>
        <div class="calc-action-row">
          <button type="button" class="btn btn-primary" id="calcConsultLeadBtn">ส่งสูตรนี้ให้คุณจูนช่วยดูต่อ</button>
        </div>
      </div>
    </div>
  </section>`;
}
function updateCalcPage() {
  const crop = document.getElementById('calcCrop')?.value || '';
  const stage = document.getElementById('calcStage')?.value || '';
  const out = document.getElementById('calcPageOut');
  const waterOut = document.getElementById('calcWaterOut');
  const productOut = document.getElementById('calcProductOut');
  const stickerOut = document.getElementById('calcStickerOut');
  const tankOut = document.getElementById('calcTankOut');
  const mixPlan = document.getElementById('calcMixPlan');
  const compareOut = document.getElementById('calcCompareOut');
  const timeline = document.getElementById('calcTimeline');
  const bundleBtn = document.getElementById('calcAddBundleBtn');
  const checkoutNowBtn = document.getElementById('calcCheckoutNowBtn');
  const bundleHint = document.getElementById('calcBundleHint');
  const bundleItems = document.getElementById('calcBundleItems');
  const openOaBtn = document.getElementById('calcOpenOaBtn');
  const salesHint = document.getElementById('calcSalesHint');
  const consultLeadBtn = document.getElementById('calcConsultLeadBtn');
  const consultHint = document.getElementById('calcConsultHint');
  const copyBtn = document.getElementById('calcCopyBtn');
  const pitchCopyBtn = document.getElementById('calcPitchCopyBtn');
  const problemInfo = calcProblemDetails(crop, document.getElementById('calcProblem')?.value || '');
  const planDays = calcPlanDays();
  const budgetLevel = calcBudgetLevel();
  const selectedProducts = calcSelectedProductsForRun();
  const contacts = supportContacts();
  if (!selectedProducts.length) {
    out.textContent = 'เลือกสูตรเพื่อดูผลลัพธ์';
    if (mixPlan) mixPlan.innerHTML = '<div class="calc-empty-note">เลือกอย่างน้อย 1 สูตร หรือเลือกสูตรแนะนำตามพืชก่อน</div>';
    if (compareOut) compareOut.innerHTML = '<div class="calc-compare-empty">เลือกสูตรหลักก่อน แล้วค่อยเพิ่มสูตรเทียบ</div>';
    if (timeline) timeline.innerHTML = '<div class="calc-plan-card"><div class="calc-plan-head"><div><span class="eyebrow">โปรแกรมพ่นต่อเนื่อง</span><h3>รอสูตรที่เลือก</h3></div><span class="calc-plan-badge">เริ่มต้น</span></div><div class="calc-plan-timeline"><article class="calc-plan-step"><span>Day 0</span><b>เลือกพืชและสูตรก่อน</b><small>เมื่อมีสูตรแล้ว ระบบจะสร้างลำดับการใช้งาน 7 / 14 / 21 วันให้ทันที</small></article></div></div>';
    if (copyBtn) copyBtn.disabled = true;
    if (pitchCopyBtn) pitchCopyBtn.disabled = true;
    if (bundleBtn) { bundleBtn.disabled = true; bundleBtn.dataset.bundlePlan = ''; }
    if (checkoutNowBtn) { checkoutNowBtn.disabled = true; checkoutNowBtn.dataset.bundlePlan = ''; }
    if (bundleHint) bundleHint.textContent = 'ระบบจะคำนวณจำนวนขวดให้ตามแผนพ่น';
    if (bundleItems) bundleItems.innerHTML = '';
    if (openOaBtn) openOaBtn.href = contacts.lineOfficialUrl || '#';
    if (salesHint) salesHint.textContent = 'ใช้คุยต่อ เช็กสินค้า และสั่งซื้อกับร้านโดยตรง';
    if (consultLeadBtn) {
      consultLeadBtn.disabled = true;
      consultLeadBtn.dataset.lineUrl = contacts.linePersonalUrl || '';
      consultLeadBtn.dataset.copyText = '';
    }
    if (consultHint) consultHint.textContent = 'เลือกสูตรก่อน แล้วค่อยเปิด LINE คุณจูนเพื่อคุยต่อ';
    return;
  }
  const strength = document.getElementById('calcStrength')?.value || 'mid';
  const fields = calcModeFields();
  const cropCfg = calcCropConfig(crop);
  const areaWaterInput = document.getElementById('calcWaterPerRai');
  if (areaWaterInput && (!areaWaterInput.dataset.touched || areaWaterInput.value === '')) areaWaterInput.value = String(cropCfg?.waterPerRai || defaultWaterPerRai(selectedProducts[0]));
  const totalWater = Math.max(0, fields.totalWater);
  const rows = calcProductMixRows(selectedProducts, totalWater, strength);
  const totalDose = rows.reduce((sum, row) => sum + row.exact, 0);
  const stickerRow = rows.find((row) => row.isSticker) || null;
  const preset = calcPresetDetails(crop, document.getElementById('calcPreset')?.value || '');
  const comparePreset = calcPresetDetails(crop, document.getElementById('calcComparePreset')?.value || '');
  const eqTanks = fields.refTank > 0 ? totalWater / fields.refTank : 0;
  const bundleRecommendations = calcBundleRecommendations(rows, planDays);
  const shareText = buildCalcShareText({ crop, stage, presetTitle: preset?.title || '', totalWater, rows, totalDose });
  const pitchText = buildCalcPitchText({ crop, stage, presetTitle: preset?.title || '', totalWater, rows, totalDose, strength });
  const consultText = buildCalcConsultText({
    crop,
    problemLabel: problemInfo?.label || '',
    stage,
    presetTitle: preset?.title || '',
    totalWater,
    rows,
    days: planDays,
  });
  out.innerHTML = `สูตรนี้ใช้ <b>${fmtCalcNumber(totalDose)} ซีซี</b> ต่อน้ำ <b>${fmtCalcNumber(totalWater)} ลิตร</b><br><small>${rows.map((row) => `${row.product.name} ${fmtCalcNumber(row.exact)} ซีซี`).join(' + ')}</small>`;
  if (waterOut) waterOut.textContent = `${fmtCalcNumber(totalWater)} ลิตร`;
  if (productOut) productOut.textContent = rows.filter((row) => !row.isSticker).length
    ? (rows.filter((row) => !row.isSticker).length <= 2 ? rows.filter((row) => !row.isSticker).map((row) => row.product.name.replace(/^นุชฟอร์ไลฟ์\s*/,'')).join(' + ') : `${rows.filter((row) => !row.isSticker).length} รายการ`)
    : '—';
  if (stickerOut) stickerOut.textContent = stickerRow ? `${fmtCalcNumber(stickerRow.exact)} ซีซี` : 'ไม่เพิ่ม';
  if (tankOut) tankOut.textContent = fields.refTank > 0 ? `${fmtCalcNumber(eqTanks)} ถัง` : '—';
  if (timeline) {
    timeline.innerHTML = calcTimelineHTML({
      crop,
      stage,
      presetTitle: preset?.title || '',
      rows,
      strength,
      totalWater,
      days: planDays,
    });
  }
  if (compareOut) {
    compareOut.innerHTML = calcCompareHTML({
      crop,
      currentPreset: preset,
      comparePreset,
      currentRows: rows,
      totalWater,
      strength,
    });
  }
  if (copyBtn) {
    copyBtn.disabled = false;
    copyBtn.dataset.copyText = shareText;
  }
  if (pitchCopyBtn) {
    pitchCopyBtn.disabled = false;
    pitchCopyBtn.dataset.copyText = pitchText;
  }
  if (bundleBtn) {
    bundleBtn.disabled = !selectedProducts.length;
    bundleBtn.dataset.bundlePlan = JSON.stringify(bundleRecommendations.map((item) => ({ id: item.product.id, qty: item.qty, packSize: item.packSize })));
  }
  if (checkoutNowBtn) {
    checkoutNowBtn.disabled = !selectedProducts.length;
    checkoutNowBtn.dataset.bundlePlan = JSON.stringify(bundleRecommendations.map((item) => ({ id: item.product.id, qty: item.qty, packSize: item.packSize })));
  }
  if (bundleHint) {
    const bundlePrice = bundleRecommendations.reduce((sum, item) => sum + (effPrice(item.product) * item.qty), 0);
    bundleHint.textContent = `พร้อมหยิบตามแผน ${fmtCalcNumber(planDays)} วัน มูลค่าประมาณ ${baht(bundlePrice)}`;
  }
  if (bundleItems) {
    bundleItems.innerHTML = calcBundleSummaryHTML(bundleRecommendations);
  }
  if (openOaBtn) {
    openOaBtn.href = contacts.lineOfficialUrl || '#';
  }
  if (salesHint) {
    salesHint.textContent = 'ถ้าพร้อมคุยต่อหรือสั่งซื้อ กดเข้า LINE OA ของร้านได้เลย';
  }
  if (consultLeadBtn) {
    consultLeadBtn.disabled = false;
    consultLeadBtn.dataset.lineUrl = contacts.linePersonalUrl || '';
    consultLeadBtn.dataset.copyText = consultText;
  }
  if (consultHint) {
    consultHint.textContent = `กดแล้วเปิด LINE คุณจูนได้ทันที พร้อมคุยต่อจากสูตรของ${crop || 'แปลงนี้'}`;
  }
  if (mixPlan) {
    mixPlan.innerHTML = rows.map((row) => {
      const knowledge = calcKnowledge().products?.[row.product.id] || {};
      const sourceLink = row.profile.research?.sourceUrl ? `<a href="${esc(row.profile.research.sourceUrl)}" target="_blank" rel="noopener">อ้างอิง</a>` : '';
      return `<article class="calc-mix-row ${row.isSticker ? 'is-sticker' : ''}">
        <div class="calc-mix-copy">
          <b>${esc(row.product.name)}</b>
          <span>${esc(knowledge.label || row.profile.research?.title || row.product.short || '')}</span>
        </div>
        <div class="calc-mix-dose">
          <strong>${fmtCalcNumber(row.exact)} ซีซี</strong>
          <span>${row.range.min === row.range.max ? `คงที่ ${fmtCalcNumber(row.range.min)} ซีซี` : `ช่วง ${fmtCalcNumber(row.range.min)}-${fmtCalcNumber(row.range.max)} ซีซี`}</span>
        </div>
        <div class="calc-mix-meta">
          <span>${esc(row.profile.research?.interval || 'ฉีดพ่นตามรอบที่เหมาะกับพืช')}</span>
          ${sourceLink}
        </div>
      </article>`;
    }).join('');
  }
}

// ── community / learning platform ──
let COMMUNITY_CACHE = { posts: [], stories: [], loadedAt: 0 };
const COMMUNITY_STORY_SEEN_KEY = 'communitySeenStories:v1';
function communitySeenStories() {
  try {
    const items = JSON.parse(localStorage.getItem(COMMUNITY_STORY_SEEN_KEY) || '[]');
    return new Set(asArray(items).map((id) => String(id || '').trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}
function markCommunityStorySeen(id = '') {
  const key = String(id || '').trim();
  if (!key) return;
  const seen = communitySeenStories();
  seen.add(key);
  try { localStorage.setItem(COMMUNITY_STORY_SEEN_KEY, JSON.stringify([...seen].slice(-100))); } catch {}
}
function articleCommunityFallback(articles = []) {
  const rows = asArray(articles).filter((article) => article?.id).slice(0, 12);
  const now = Date.now();
  return {
    posts: rows.map((article, index) => ({
      id: `article_fallback_${article.id}`,
      userId: 'system',
      authorName: index === 0 ? 'june_editor' : 'nuch_team',
      authorRole: 'admin',
      caption: [article.title, article.excerpt || String(article.body || '').split(/\n+/)[0]].filter(Boolean).join('\n\n'),
      media: article.cover ? [{ type: 'image', url: article.cover }] : [],
      hashtags: ['ความรู้', 'รีวิว', 'วิธีใช้'].slice(0, 2 + (index % 2)),
      articleId: article.id,
      status: 'approved',
      pinned: index === 0,
      likes: 18 + index * 7,
      comments: 2 + index,
      reposts: 1 + index,
      saves: 5 + index * 2,
      createdAt: article.createdAt || (now - index * 3600000),
      updatedAt: article.createdAt || now,
      fallback: true,
    })),
    stories: rows.filter((article) => article.cover).slice(0, 8).map((article, index) => ({
      id: `article_story_fallback_${article.id}`,
      postId: `article_fallback_${article.id}`,
      authorName: index === 0 ? 'june_editor' : 'nuch_team',
      title: article.title,
      media: article.cover,
      caption: article.excerpt || article.title,
      status: 'approved',
      createdAt: now - index * 1800000,
      expiresAt: now + 24 * 60 * 60 * 1000,
    })),
  };
}
async function fetchCommunityJson(url, fallback, timeoutMs = 4500) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller?.signal });
    if (!response.ok) return fallback;
    return await response.json().catch(() => fallback);
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function loadCommunity() {
  const [feed, storyData] = await Promise.all([
    fetchCommunityJson('/api/community', { posts: [] }),
    fetchCommunityJson('/api/community/stories', { stories: [] }),
  ]);
  let posts = asArray(feed.posts);
  let stories = asArray(storyData.stories);
  if (!posts.length && !stories.length) {
    const fallbackArticles = await refreshArticlesCache().catch(() => []);
    const fallback = articleCommunityFallback(fallbackArticles);
    posts = fallback.posts;
    stories = fallback.stories;
  }
  COMMUNITY_CACHE = { posts, stories, loadedAt: Date.now() };
  return COMMUNITY_CACHE;
}
function communityMediaHTML(media = [], cls = 'community-media') {
  const items = asArray(media).filter((item) => item?.url).slice(0, 4);
  if (!items.length) return `<div class="${cls} is-text-only"><span>Community Note</span></div>`;
  return `<div class="${cls} ${items.length > 1 ? 'is-grid' : 'is-single'}">${items.map((item, index) => item.type === 'video'
    ? `<video src="${esc(item.url)}" muted loop playsinline controls aria-label="Community video ${index + 1}"></video>`
    : `<img src="${esc(item.url)}" alt="" loading="lazy">`).join('')}</div>`;
}
function communityTimeLabel(value = 0) {
  const ts = Number(value || 0) || Date.now();
  const diff = Math.max(0, Date.now() - ts);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))} นาทีที่แล้ว`;
  if (diff < day) return `${Math.floor(diff / hour)} ชั่วโมงที่แล้ว`;
  return new Date(ts).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}
function communityPostCard(post = {}) {
  const tags = asArray(post.hashtags).slice(0, 5);
  const firstLine = String(post.caption || '').split(/\n+/).find(Boolean) || 'แบ่งปันประสบการณ์จากชุมชน';
  const articleLink = post.articleId ? `<a class="community-readmore" href="${routeHref('/article/' + post.articleId)}">อ่านฉบับเต็ม</a>` : '';
  const readonly = post.fallback ? ' disabled title="เปิดใช้งานหลังเชื่อมฐาน community"' : '';
  return `<article class="community-post reveal" data-community-post="${esc(post.id)}" data-community-fallback="${post.fallback ? '1' : '0'}">
    <header class="community-post-head">
      ${avatarHTML({ name: post.authorName || 'สมาชิก', avatar: post.authorAvatar || '', cls: 'community-avatar' })}
      <div class="community-author">
        <b>${esc(post.authorName || 'สมาชิก')}</b>
        <span>${post.authorRole === 'admin' ? 'Editor Pick' : 'Member Story'} · ${communityTimeLabel(post.createdAt)}</span>
      </div>
      ${post.pinned ? '<em>PINNED</em>' : ''}
    </header>
    ${communityMediaHTML(post.media)}
    <section class="community-post-body">
      <p class="community-caption">${esc(post.caption || firstLine).replace(/\n/g, '<br>')}</p>
      ${tags.length ? `<div class="community-tags">${tags.map((tag) => `<span>#${esc(String(tag).replace(/^#/, ''))}</span>`).join('')}</div>` : ''}
      ${articleLink}
    </section>
    <footer class="community-actions">
      <button type="button" ${post.fallback ? '' : `data-community-like="${esc(post.id)}"`} class="${post.liked ? 'is-on' : ''}" aria-label="ไลก์โพสต์"${readonly}><span>♡</span><b>ไลก์ ${Number(post.likes || 0)}</b></button>
      <button type="button" data-community-comments="${esc(post.id)}" aria-label="เปิดคอมเมนต์"><span>◌</span><b>คอมเมนต์ ${Number(post.comments || 0)}</b></button>
      <button type="button" data-community-repost="${esc(post.id)}" aria-label="รีโพสต์"><span>↻</span><b>รีโพสต์ ${Number(post.reposts || 0)}</b></button>
      <button type="button" ${post.fallback ? '' : `data-community-save="${esc(post.id)}"`} class="${post.saved ? 'is-on' : ''}" aria-label="บันทึกโพสต์"${readonly}><span>⌑</span><b>บันทึก</b></button>
    </footer>
    <div class="community-comments" data-community-comments-wrap="${esc(post.id)}"></div>
  </article>`;
}
function communityStoriesHTML(stories = []) {
  const active = asArray(stories).filter((story) => Number(story.expiresAt || 0) > Date.now());
  if (!active.length) return '<div class="community-story-empty">ยังไม่มีสตอรี่ใน 24 ชั่วโมงล่าสุด</div>';
  const seen = communitySeenStories();
  return `<div class="community-stories" aria-label="Community stories">${active.map((story) => {
    const isSeen = seen.has(String(story.id));
    const storyName = story.authorName || story.username || 'story';
    return `<button type="button" class="community-story ${isSeen ? 'is-seen' : ''}" data-story-open="${esc(story.id)}" aria-label="${isSeen ? 'ดูสตอรี่แล้ว' : 'เปิดสตอรี่'} ${esc(storyName)}">
      <span>${story.media ? `<img src="${esc(story.media)}" alt="">` : `<i>${esc((story.title || story.authorName || 'S').slice(0, 1))}</i>`}</span>
      <b>${esc(storyName)}</b>
      <small>${isSeen ? 'ดูแล้ว' : '24h'}</small>
    </button>`;
  }).join('')}</div>`;
}
function openCommunityStory(id = '') {
  const story = asArray(COMMUNITY_CACHE.stories).find((item) => String(item.id) === String(id));
  if (!story) return;
  markCommunityStorySeen(id);
  let modal = document.getElementById('communityStoryModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'communityStoryModal';
    modal.className = 'community-story-modal';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `<div class="community-story-view">
    <button class="qv-close" type="button" data-story-close>×</button>
    <div class="community-story-progress"><span></span></div>
    <img src="${esc(story.media)}" alt="">
    <div class="community-story-copy"><b>${esc(story.title || story.authorName || 'Story')}</b><p>${esc(story.caption || '')}</p><small>หมดอายุ ${new Date(story.expiresAt).toLocaleString('th-TH')}</small></div>
  </div>`;
  document.querySelector(`[data-story-open="${CSS.escape(String(id))}"]`)?.classList.add('is-seen');
  const small = document.querySelector(`[data-story-open="${CSS.escape(String(id))}"] small`);
  if (small) small.textContent = 'ดูแล้ว';
  requestAnimationFrame(() => modal.classList.add('show'));
}
function closeCommunityStory() {
  document.getElementById('communityStoryModal')?.classList.remove('show');
}
async function refreshCommunityPostCard(postId = '') {
  const { posts } = await loadCommunity();
  const post = posts.find((item) => String(item.id) === String(postId));
  const card = document.querySelector(`[data-community-post="${CSS.escape(postId)}"]`);
  if (post && card) {
    card.outerHTML = communityPostCard(post);
    enhance();
  }
}
async function toggleCommunityComments(postId = '') {
  const wrap = document.querySelector(`[data-community-comments-wrap="${CSS.escape(postId)}"]`);
  if (!wrap) return;
  if (wrap.dataset.open === '1') { wrap.innerHTML = ''; wrap.dataset.open = ''; return; }
  const card = wrap.closest('[data-community-post]');
  const post = asArray(COMMUNITY_CACHE.posts).find((item) => String(item.id) === String(postId));
  if (card?.dataset.communityFallback === '1' || post?.fallback) {
    wrap.dataset.open = '1';
    const name = post?.authorName || 'สมาชิก';
    wrap.innerHTML = `<div class="community-comment-list is-preview">
      <div><b>${esc(name)}</b><span>โพสต์นี้มาจากบทความเดิม ใช้เป็นตัวอย่างฟีดระหว่างรอเชื่อมฐาน community จริง</span></div>
      <div><b>ทีมแอดมิน</b><span>หลังรัน migration แล้ว สมาชิกจะคอมเมนต์ใต้โพสต์นี้ได้แบบเรียลไทม์</span></div>
    </div>`;
    return;
  }
  const data = await fetch(`/api/community/posts/${encodeURIComponent(postId)}/comments`, { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ comments: [] }));
  wrap.dataset.open = '1';
  const comments = asArray(data.comments);
  wrap.innerHTML = `<div class="community-comment-list">${comments.length ? comments.map((comment) => `<div><b>${esc(comment.authorName || 'สมาชิก')}</b><span>${esc(comment.text || '')}</span></div>`).join('') : '<p class="muted">ยังไม่มีคอมเมนต์</p>'}</div>
    ${currentUser ? `<form class="community-comment-form" data-community-comment-form="${esc(postId)}"><input name="text" placeholder="เขียนคอมเมนต์..." required><button class="btn-mini" type="submit">ส่ง</button></form>` : `<a class="btn-mini" href="${routeHref('/login')}">เข้าสู่ระบบเพื่อคอมเมนต์</a>`}`;
}
async function viewCommunity() {
  setPageMeta('ชุมชนและแหล่งเรียนรู้', 'พื้นที่แบ่งปันประสบการณ์ รีวิว วิธีใช้ และความรู้จากสมาชิกจูนนุชฟอร์ไลฟ์');
  const { posts, stories } = await loadCommunity();
  const approved = posts.length;
  const storyCount = asArray(stories).filter((story) => Number(story.expiresAt || 0) > Date.now()).length;
  const composer = currentUser ? `<form id="communityPostForm" class="community-composer reveal">
    <div class="community-post-head">${avatarHTML({ name: userDisplayName(currentUser), avatar: userAvatarUrl(currentUser), cls: 'community-avatar' })}<div class="community-author"><b>สร้างโพสต์ใหม่ในนาม @${esc(userDisplayName(currentUser))}</b><span>เล่าให้สั้น ชัด มีรูปจริง จะช่วยให้ชุมชนน่าเชื่อถือขึ้น</span></div></div>
    <textarea name="caption" rows="3" placeholder="แชร์ประสบการณ์ วิธีใช้ ผลลัพธ์ หรือคำแนะนำให้สมาชิกคนอื่น..."></textarea>
    <div class="community-compose-row">
      <label class="community-upload">เพิ่มรูป/วิดีโอ<input name="media" type="file" accept="image/*,video/mp4,video/webm" multiple></label>
      <input name="hashtags" placeholder="#รีวิว #วิธีใช้ #ประสบการณ์จริง">
      <button class="btn btn-primary" type="submit">เผยแพร่</button>
    </div>
  </form>` : `<div class="community-composer reveal"><div><b>เข้าสู่ระบบเพื่อร่วมแบ่งปัน</b><p class="muted">สมาชิกสามารถสร้างโพสต์ กดไลก์ คอมเมนต์ และบันทึกโพสต์ได้</p></div><a class="btn btn-primary" href="${routeHref('/login')}">เข้าสู่ระบบ</a></div>`;
  return `<section class="section page-top community-page">
    <div class="community-hero reveal">
      <div>
        <span class="eyebrow">Community Platform</span>
        <h1>ชุมชนประสบการณ์จริง</h1>
        <p>ฟีดความรู้ รีวิว วิธีใช้ และ story 24 ชั่วโมงที่ทำให้ลูกค้ากลับมาอ่านซ้ำ ตัดสินใจง่าย และรู้สึกว่าแบรนด์มีชีวิต</p>
      </div>
      <div class="community-hero-stats">
        <article><b>${approved}</b><span>โพสต์</span></article>
        <article><b>${storyCount}</b><span>Story 24h</span></article>
        <article><b>Live</b><span>Learning Feed</span></article>
      </div>
    </div>
    ${communityStoriesHTML(stories)}
    <div class="community-layout">
      <main class="community-feed">
        ${composer}
        ${posts.length ? posts.map(communityPostCard).join('') : '<div class="community-empty reveal"><h2>ยังไม่มีโพสต์ในชุมชน</h2><p>หลังรัน migration/seed แล้ว บทความเดิมจะถูกนำมาเป็นโพสต์และสตอรี่ให้อัตโนมัติ</p></div>'}
      </main>
      <aside class="community-sidebar reveal">
        <div class="community-side-card">
          <span class="eyebrow">Brand Learning</span>
          <h3>ทำให้เว็บเป็นแหล่งเรียนรู้</h3>
          <p>รวมรีวิวจริง คำแนะนำ วิธีใช้ และเรื่องเล่าจากลูกค้าไว้ในที่เดียว เพื่อเพิ่มความเชื่อมั่นก่อนซื้อ</p>
        </div>
        <div class="community-side-card">
          <h3>หัวข้อที่ควรมี</h3>
          <div class="community-topic-list"><span>รีวิวผลลัพธ์</span><span>วิธีใช้สินค้า</span><span>คำถามยอดฮิต</span><span>Before / After</span></div>
        </div>
      </aside>
    </div>
  </section>`;
}

// ── articles (ความรู้เกษตร) ──
async function viewArticles() {
  // ครั้งแรกรอโหลด ครั้งถัด ๆ ไปใช้แคชทันทีแล้วรีเฟรชเงียบ ๆ เบื้องหลัง
  if (!ARTICLES) await refreshArticlesCache(); else refreshArticlesCache();
  const list = ARTICLES || [];
  setPageMeta('บทความความรู้เกษตร', 'รวมบทความ เคล็ดลับ และคำแนะนำที่ช่วยให้ลูกค้าเข้าใจการเลือกสูตรและการใช้งานได้ง่ายขึ้น');
  const featured = list[0];
  const cards = list.length ? list.slice(featured ? 1 : 0).map((a, i) => `<a class="card glass reveal article-card" href="${routeHref('/article/' + a.id)}" style="transition-delay:${(i % 3) * 0.07}s">
    <div class="art-cover">${a.cover ? `<img src="${a.cover}" alt="${esc(a.title)}" loading="lazy">` : icon('leaf', 'd-ico')}</div>
    <div class="body"><h3>${esc(a.title)}</h3><p class="desc">${esc(a.excerpt || '')}</p><span class="art-more">อ่านต่อ →</span></div>
  </a>`).join('') : '<p class="muted" style="text-align:center;grid-column:1/-1">ยังไม่มีบทความ</p>';
  return `<section class="section page-top">
    <div class="section-head reveal"><span class="eyebrow">ความรู้เกษตร</span><h2>บทความ & เคล็ดลับที่อ่านแล้วเข้าใจง่าย</h2><p class="muted">รวมเนื้อหาที่ช่วยลูกค้าเข้าใจปัญหา เลือกสูตร และตัดสินใจทักคุณจูนได้เร็วขึ้น</p></div>
    ${featured ? `<a class="article-feature glass reveal" href="${routeHref('/article/' + featured.id)}">
      <div class="article-feature-media">${featured.cover ? `<img src="${featured.cover}" alt="${esc(featured.title)}" loading="lazy">` : icon('leaf', 'hero-ico')}</div>
      <div class="article-feature-copy"><span class="eyebrow">บทความแนะนำ</span><h3>${esc(featured.title)}</h3><p>${esc(featured.excerpt || '')}</p><div class="article-feature-points"><span>อ่านง่าย</span><span>เข้าใจไว</span><span>ใช้คุยกับลูกค้าได้จริง</span></div><span class="art-more">เปิดอ่านบทความนี้ →</span></div>
    </a>` : ''}
    <div class="products article-grid">${cards}</div></section>`;
}
async function viewArticle({ id }) {
  // ใช้แคชบทความถ้ามี (รวม body) → เปิดไว ไม่ต้อง fetch
  if (!ARTICLES) await refreshArticlesCache(); else refreshArticlesCache();
  let a = (ARTICLES || []).find((item) => String(item.id) === String(id)) || null;
  if (!a || !a.body) {
    try { const r = await fetch('/api/articles/' + encodeURIComponent(id)); if (r.ok) a = await r.json(); } catch {}
  }
  const related = (ARTICLES || []).filter((item) => item.id !== id).slice(0, 3);
  if (!a) return viewNotFound();
  setPageMeta(a.title, a.excerpt || a.body?.slice(0, 150) || '');
  const paragraphs = (a.body || '').split('\n').map((p) => p.trim()).filter(Boolean);
  const paras = paragraphs.map((p) => `<p>${esc(p)}</p>`).join('');
  const highlights = paragraphs.slice(0, 3).map((p) => p.length > 96 ? `${p.slice(0, 96)}...` : p);
  const readMinutes = Math.max(1, Math.ceil((a.body || '').split(/\s+/).filter(Boolean).length / 180));
  return `<section class="section page-top article-read">
    <a class="back" href="${routeHref('/articles')}">← กลับไปบทความ</a>
    <div class="article-hero-block glass reveal">
      <div class="article-hero-copy">
        <span class="eyebrow">บทความความรู้</span>
        <h1>${esc(a.title)}</h1>
        <p class="article-excerpt">${esc(a.excerpt || paragraphs[0] || '')}</p>
        <div class="article-meta-row"><span>อัปเดต ${new Date(a.createdAt).toLocaleDateString('th-TH')}</span><span>อ่านประมาณ ${readMinutes} นาที</span><span>เหมาะสำหรับใช้ตอบคำถามลูกค้า</span></div>
      </div>
      <div class="article-hero-media">${a.cover ? `<img class="art-hero reveal" src="${a.cover}" alt="">` : icon('leaf', 'hero-ico')}</div>
    </div>
    <div class="article-layout">
      <div class="article-main">
        ${highlights.length ? `<div class="article-highlight-grid reveal">${highlights.map((item, idx) => `<article class="article-highlight-card"><b>ประเด็น ${idx + 1}</b><span>${esc(item)}</span></article>`).join('')}</div>` : ''}
        <div class="article-body glass reveal">${paras}</div>
        <div class="cta-band glass reveal article-cta"><h2>อ่านแล้วอยากให้คุณจูนช่วยแนะนำต่อ?</h2><p>กดขอคำแนะนำแล้วส่งข้อมูลให้คุณจูนติดตามต่อได้ทันที หรือทักแชทเพื่อคุยรายละเอียดเพิ่ม</p><div class="hero-cta"><button class="btn btn-primary" type="button" data-scrolllead>ขอคำแนะนำเร็ว</button><button class="btn btn-glass" type="button" data-openchat>ปรึกษาตอนนี้ 💬</button></div></div>
      </div>
      <aside class="article-summary glass reveal">
        <span class="eyebrow">สรุปเร็ว</span>
        <h3>อ่านประเด็นสำคัญก่อน</h3>
        <div class="article-summary-list">${(highlights.length ? highlights : paragraphs.slice(0, 3)).map((item) => `<div>${esc(item)}</div>`).join('')}</div>
        <div class="article-summary-actions">
          <button class="btn btn-primary" type="button" data-scrolllead>ขอคำแนะนำเร็ว</button>
          <button class="btn btn-glass" type="button" data-openchat>คุยกับคุณจูน</button>
        </div>
      </aside>
    </div>
    ${related.length ? `<section class="article-related reveal"><div class="panel-head"><span class="eyebrow">อ่านต่อ</span><h2>บทความที่เกี่ยวข้อง</h2></div><div class="products article-grid">${related.map((item, i) => `<a class="card glass article-card" href="${routeHref('/article/' + item.id)}" style="transition-delay:${(i % 3) * 0.07}s"><div class="art-cover">${item.cover ? `<img src="${item.cover}" alt="${esc(item.title)}" loading="lazy">` : icon('leaf', 'd-ico')}</div><div class="body"><h3>${esc(item.title)}</h3><p class="desc">${esc(item.excerpt || '')}</p><span class="art-more">อ่านต่อ →</span></div></a>`).join('')}</div></section>` : ''}
  </section>`;
}

// ── product media gallery (3D model / video / images) ──
let _detailMedia = [], _detailProduct = null;
function buildMedia(p) {
  const m = [];
  const modelUrl = productModelUrl(p);
  if (modelUrl) m.push({ t: 'model', src: modelUrl });
  if (p.video) m.push({ t: 'video', src: p.video });
  if (p.image) m.push({ t: 'image', src: p.image });
  (p.images || []).forEach((src) => m.push({ t: 'image', src }));
  if (!m.length) m.push({ t: 'icon' });
  return m;
}
function mediaMain(item, p) {
  if (item.t === 'model') { ensureModelViewer(); return `<model-viewer class="mv" src="${item.src}" camera-controls auto-rotate ar shadow-intensity="1" exposure="1.1" loading="eager"></model-viewer>`; }
  if (item.t === 'video') return `<video class="media-el" controls muted loop playsinline ${p.image ? `poster="${p.image}"` : ''} src="${item.src}"></video>`;
  if (item.t === 'image') return `<img class="media-el zoomable" src="${item.src}" data-zoom="${item.src}" alt="${esc(p.name)}">`;
  return icon(p.icon || 'pod', 'd-ico');
}
function mediaThumb(item, i, active) {
  const inner = item.t === 'model' ? '<span class="t3d">3D</span>' : item.t === 'video' ? '<span class="t3d">▶</span>'
    : item.t === 'image' ? `<img src="${item.src}">` : icon(_detailProduct.icon || 'pod', 'g-ico');
  return `<button class="gthumb ${active ? 'on' : ''}" data-mi="${i}">${inner}</button>`;
}
function renderMain(i) {
  const main = document.getElementById('mainMedia'); if (!main) return;
  main.innerHTML = mediaMain(_detailMedia[i], _detailProduct);
  document.querySelectorAll('.gthumb').forEach((b, j) => b.classList.toggle('on', j === i));
  main._tilt = false; attachTilt(main.parentElement);
}
function reviewsHTML(p, data) {
  const { reviews, stats } = data;
  const reviewed = currentUser && reviews.some((r) => r.userId === currentUser.id);
  const form = !currentUser
    ? `<p class="muted"><a href="${routeHref('/login')}" style="color:var(--accent)">เข้าสู่ระบบ</a> เพื่อเขียนรีวิว</p>`
    : reviewed ? `<p class="muted">คุณรีวิวสินค้านี้แล้ว — ขอบคุณครับ 🙏</p>`
    : `<form id="reviewForm" class="review-form glass" data-pid="${p.id}">
        <div class="star-pick" id="starPick">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}">★</button>`).join('')}</div>
        <input type="hidden" name="rating" value="0">
        <textarea name="comment" rows="2" placeholder="เล่าประสบการณ์การใช้งาน…"></textarea>
        <button class="btn btn-primary" type="submit">ส่งรีวิว</button>
      </form>`;
  const list = reviews.length ? reviews.map((r) => `<div class="review-item">
      <div class="rev-head"><b>${esc(r.name || 'ลูกค้า')}</b>${stars(r.rating)}</div>
      ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}<small class="muted">${new Date(r.createdAt).toLocaleDateString('th-TH')}</small>
    </div>`).join('') : '<p class="muted">ยังไม่มีรีวิว — เป็นคนแรกเลย!</p>';
  return `<section class="section reviews-sec">
    <div class="section-head reveal"><span class="eyebrow">รีวิวจากลูกค้า</span><h2>${stats.count ? `${stats.avg} ★ · ${stats.count} รีวิว` : 'ยังไม่มีรีวิว'}</h2></div>
    <div class="reviews-wrap reveal">${form}<div class="review-list">${list}</div></div>
  </section>`;
}
function faqItems(extra) {
  return asArray(extra.faq).map((it) => {
    if (!it) return null;
    if (typeof it === 'string') {
      const idx = it.indexOf('::');
      return idx > -1 ? { q: it.slice(0, idx).trim(), a: it.slice(idx + 2).trim() } : null;
    }
    return { q: it.q || '', a: it.a || '' };
  }).filter((it) => it && it.q && it.a);
}
function standardProductBlocks(p) {
  const extra = productExtra(p);
  const crops = productCrops(p);
  const usageSteps = asArray(extra.usageSteps);
  const warnings = asArray(extra.warnings);
  const faqs = faqItems(extra);
  const isPod = isPodProduct(p);
  const sellingPoints = asArray(extra.sellingPoints);
  return `<section class="detail-panel glass reveal">
    <div class="panel-head"><span class="eyebrow">ข้อมูลสำคัญ</span><h2>ดูข้อมูลจำเป็นก่อน แล้วค่อยเปิดรายละเอียดเพิ่ม</h2></div>
    <div class="detail-summary-grid">
      ${isAgriProduct(p) ? `<div class="summary-box"><span>เลขทะเบียน</span><b>${esc(extra.registrationNo || 'รออัปเดตเลขทะเบียน')}</b></div>` : ''}
      <div class="summary-box"><span>${isPod ? 'สไตล์สินค้า' : 'วิธีใช้หลัก'}</span><b>${esc(isPod ? (extra.style || p.specs['สไตล์'] || '-') : (extra.applicationMethod || p.specs['วิธีใช้'] || '-'))}</b></div>
      <div class="summary-box"><span>${isPod ? 'เหมาะกับใคร' : 'อัตราแนะนำ'}</span><b>${esc(isPod ? (extra.audienceShort || p.specs['เหมาะกับ'] || '-') : (extra.dosage || p.specs['อัตรา'] || '-'))}</b></div>
      <div class="summary-box"><span>${isPod ? 'จุดเด่นหลัก' : 'เหมาะกับพืช'}</span><b>${esc(isPod ? (extra.highlight || p.specs['จุดเด่น'] || '-') : (crops.join(' / ') || 'พืชทั่วไป'))}</b></div>
    </div>
    ${extra.labelUrl ? `<div class="detail-doc-link"><a class="btn btn-glass" href="${esc(extra.labelUrl)}" target="_blank" rel="noopener">เปิดฉลาก / เอกสาร</a>${extra.labelNote ? `<p class="form-note">${esc(extra.labelNote)}</p>` : ''}</div>` : ''}
    <div class="detail-folds">
      <details class="detail-fold" open>
        <summary>${isPod ? 'รายละเอียดการใช้งานและวิธีแนะนำลูกค้า' : 'วิธีใช้และขั้นตอนแนะนำ'}</summary>
        <div class="standard-grid fold-content">
          <div class="std-card">
            <h3>${isPod ? 'ภาพรวมสินค้า' : 'วิธีใช้'}</h3>
            <div class="std-list">
              <div><span>${isPod ? 'สไตล์' : 'รูปแบบการใช้'}</span><b>${esc(isPod ? (extra.style || p.specs['สไตล์'] || '-') : (extra.applicationMethod || p.specs['วิธีใช้'] || '-'))}</b></div>
              <div><span>${isPod ? 'เหมาะกับ' : 'อัตราแนะนำ'}</span><b>${esc(isPod ? (extra.audienceShort || p.specs['เหมาะกับ'] || '-') : (extra.dosage || p.specs['อัตรา'] || '-'))}</b></div>
            </div>
          </div>
          <div class="std-card">
            <h3>${isPod ? 'วิธีแนะนำลูกค้า / จุดขาย' : 'ขั้นตอนแนะนำ'}</h3>
            <ol class="std-steps">${(isPod ? sellingPoints : usageSteps).length ? (isPod ? sellingPoints : usageSteps).map((step) => `<li>${esc(step)}</li>`).join('') : '<li>ศึกษาฉลากก่อนใช้ทุกครั้ง</li>'}</ol>
          </div>
        </div>
      </details>
      ${warnings.length ? `<details class="detail-fold">
        <summary>คำเตือนและข้อควรระวัง</summary>
        <ul class="warning-list fold-content">${warnings.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
      </details>` : ''}
      ${faqs.length ? `<details class="detail-fold">
        <summary>คำถามที่พบบ่อย</summary>
        <div class="faq-list fold-content">${faqs.map((item, idx) => `<details class="faq-item" ${idx === 0 ? 'open' : ''}><summary>${esc(item.q)}</summary><p>${esc(item.a)}</p></details>`).join('')}</div>
      </details>` : ''}
    </div>
    ${isAgriProduct(p) ? `<div class="crop-tags detail-crop-tags">${crops.length ? crops.map((crop) => {
      const slug = cropSlugMap()[crop];
      return slug ? `<a class="crop-tag" href="/crops/${slug}">${esc(crop)}</a>` : `<span class="crop-tag">${esc(crop)}</span>`;
    }).join('') : '<span class="crop-tag">พืชทั่วไป</span>'}</div>` : ''}
  </section>`;
}
async function hydrateProductDetail(id, fallbackP) {
  let p = fallbackP;
  let rev = { reviews: [], stats: { avg: fallbackP?.rating || 0, count: fallbackP?.reviews || 0 } };
  // ยิงรีเฟรชสินค้า + รีวิวพร้อมกัน (ไม่บล็อกการแสดงผลหน้า)
  try {
    const [fp, rv] = await Promise.all([
      fetch('/api/products/' + encodeURIComponent(id)).then((r) => r.json()).catch(() => null),
      fetch('/api/products/' + encodeURIComponent(id) + '/reviews').then((r) => r.json()).catch(() => null),
    ]);
    if (fp && !fp.error) p = fp;
    if (rv && Array.isArray(rv.reviews)) rev = rv;
  } catch {}
  const supportMount = document.getElementById('pdSupportMount');
  const reviewsMount = document.getElementById('pdReviewsMount');
  // กันกรณีผู้ใช้เปลี่ยนหน้าไปแล้ว
  if (!reviewsMount || reviewsMount.dataset.pid !== String(id)) return;
  _detailProduct = p;
  if (supportMount) supportMount.innerHTML = productSupportSection(p, rev);
  reviewsMount.innerHTML = reviewsHTML(p, rev);
  [supportMount, reviewsMount].forEach((m) => m && m.querySelectorAll('.reveal:not(.in)').forEach((el) => revealObserver.observe(el)));
}
async function viewProductDetail({ id }) {
  let p = productById(id);
  // ถ้าไม่มีในแคช (เช่นเปิดลิงก์ตรง) ค่อย fetch — ปกติจะมาจากแคชทันที
  if (!p) {
    try { const fp = await (await fetch('/api/products/' + encodeURIComponent(id))).json(); if (fp && !fp.error) p = fp; } catch {}
  }
  if (!p) return viewNotFound();
  setPageMeta(productSeoTitle(p), productSeoDescription(p));
  recentlyViewedProductIds(p.id);
  _detailProduct = p; _detailMedia = buildMedia(p);
  // เรนเดอร์ทันทีด้วยรีวิวว่าง แล้วค่อยเติมรีวิวจริงหลังหน้าโชว์ (ไม่หน่วง)
  const rev = { reviews: [], stats: { avg: p.rating || 0, count: p.reviews || 0 } };
  _afterRender = () => hydrateProductDetail(id, p);
  const cropSet = new Set(productCrops(p));
  const related = PRODUCTS.filter((x) => x.id !== id && productSegment(x) === productSegment(p))
    .sort((a, b) => {
      const aScore = productCrops(a).filter((crop) => cropSet.has(crop)).length;
      const bScore = productCrops(b).filter((crop) => cropSet.has(crop)).length;
      return bScore - aScore;
    }).slice(0, 3);
  const extra = productExtra(p);
  const quickPoints = isAgriProduct(p)
    ? [`ใช้กับ ${productCrops(p).join(' / ') || 'พืชทั่วไป'}`, extra.applicationMethod || p.specs['วิธีใช้'] || 'ฉีดพ่นทางใบ', extra.dosage || p.specs['อัตรา'] || 'อ่านฉลากก่อนใช้']
    : isPodProduct(p)
      ? [extra.highlight || 'ลุคเด่นพร้อมขาย', extra.audienceShort || 'เหมาะกับลูกค้าที่อยากเลือกไว', extra.style || 'ดีไซน์พร้อมส่ง']
      : ['สินค้าจากแบรนด์เดียวกัน', 'สั่งซื้อออนไลน์ได้ทันที', 'มีคุณจูนตอบคำถามก่อนสั่งซื้อ'];
  return `
  <section class="section page-top detail">
    <a class="back" href="${routeHref('/products')}">← กลับไปหน้าสินค้า</a>
    <div class="detail-grid">
      <div class="detail-visual glass reveal">
        <span class="d-glow"></span>
        <div class="media-main media3d" data-tilt id="mainMedia">${mediaMain(_detailMedia[0], p)}</div>
        ${_detailMedia.length > 1 ? `<div class="gallery-thumbs">${_detailMedia.map((m, i) => mediaThumb(m, i, i === 0)).join('')}</div>` : ''}
      </div>
      <div class="detail-info reveal">
        <div class="di-top">${productBadgeMarkup(p) ? `<div class="tag-row">${productBadgeMarkup(p)}</div>` : ''}${heartBtn(p.id)}</div>
        <h1>${esc(p.name)}</h1>
        ${p.reviews ? `<div class="card-rate">${stars(p.rating)}<small>${p.rating} (${p.reviews} รีวิว)</small></div>` : ''}
        <div class="d-price">${priceHTML(p)}</div>
        <div class="stock-line ${p.stock <= 0 ? 'out' : p.stock <= 5 ? 'low' : ''}">${p.stock <= 0 ? 'สินค้าหมด' : p.stock <= 5 ? `เหลือเพียง ${p.stock} ชิ้น` : 'มีสินค้าพร้อมส่ง'}</div>
        <p class="d-desc">${esc(p.desc || '')}</p>
        <div class="detail-points">${quickPoints.map((item) => `<span>${esc(item)}</span>`).join('')}</div>
        ${isAgriProduct(p) ? `<div class="detail-summary-grid compact-top-grid">
          <div class="summary-box"><span>เลขทะเบียน</span><b>${esc(extra.registrationNo || 'รออัปเดตเลขทะเบียน')}</b></div>
          <div class="summary-box"><span>พืชที่เหมาะ</span><b>${esc(productCrops(p).join(' / ') || 'พืชทั่วไป')}</b></div>
          <div class="summary-box"><span>เอกสาร</span><b>${extra.labelUrl ? 'มีฉลากให้เปิดดู' : 'ยังไม่มีไฟล์ฉลาก'}</b></div>
        </div>` : isPodProduct(p) ? `<div class="detail-summary-grid compact-top-grid">
          <div class="summary-box"><span>คอลเลกชัน</span><b>${esc(displayProductCategoryLabel(productCategory(p)))}</b></div>
          <div class="summary-box"><span>เหมาะกับ</span><b>${esc(extra.audienceShort || p.specs['เหมาะกับ'] || 'ลูกค้าที่อยากเลือกไว')}</b></div>
          <div class="summary-box"><span>จุดเด่น</span><b>${esc(extra.highlight || p.specs['จุดเด่น'] || 'ดีไซน์เด่นพร้อมขาย')}</b></div>
        </div>` : ''}
        <div class="qty-row"><span>จำนวน</span><div class="qtybox"><button data-qd>−</button><span id="detailQty">1</span><button data-qi>+</button></div></div>
        <div class="d-actions">
          ${p.stock <= 0
            ? '<button class="btn btn-primary" disabled>สินค้าหมด</button>'
            : `<button class="btn btn-primary" data-buynow="${p.id}">ซื้อเลย</button>
          <button class="btn btn-glass" data-addqty="${p.id}">เพิ่มลงตะกร้า</button>`}
        </div>
        <div class="detail-assurance">
          <div><b>จัดส่ง</b><span>ติดตามออเดอร์และเลขพัสดุได้</span></div>
          <div><b>ปรึกษาฟรี</b><span>${isPodProduct(p) ? 'ให้ทีมช่วยเลือกทรง ลุค และตัวที่เหมาะกับสไตล์ลูกค้า' : 'ให้คุณจูนช่วยเลือกสูตรหรือวิธีใช้ก่อนซื้อ'}</span></div>
          <div><b>ข้อมูลประกอบ</b><span>${isPodProduct(p) ? 'มีข้อมูลจุดเด่น วิธีแนะนำลูกค้า และ FAQ พร้อมใช้ปิดการขาย' : (extra.labelUrl ? 'มีไฟล์ฉลาก / เอกสารเปิดดูได้' : 'เพิ่มฉลากและ FAQ ได้จากหลังบ้าน')}</span></div>
        </div>
        <ul class="specs">${Object.entries(p.specs).map(([k, v]) => `<li><span>${esc(k)}</span><b>${esc(v)}</b></li>`).join('')}</ul>
        ${calcWidget(p)}
      </div>
    </div>
    ${standardProductBlocks(p)}
    ${productConversionPanel(p, related)}
    <div id="pdSupportMount" data-pid="${esc(id)}">${productSupportSection(p, rev)}</div>
    <section class="detail-panel glass reveal">
      <div class="panel-head"><span class="eyebrow">ก่อนตัดสินใจ</span><h2>คำถามสำคัญเกี่ยวกับสินค้านี้</h2></div>
      ${storeFaqHTML({ product: p })}
      ${orgTrustHTML({ compact: true })}
    </section>
    <div id="pdReviewsMount" data-pid="${esc(id)}">${reviewsHTML(p, rev)}</div>
    <div class="section-head reveal" style="margin-top:30px"><span class="eyebrow">สินค้าที่เกี่ยวข้อง</span><h2>อาจถูกใจคุณ</h2></div>
    <div class="products">${related.map((r, i) => productCard(r, i)).join('')}</div>
    ${p.stock > 0 ? `<div class="mobile-buybar">
      <div class="mobile-buybar-copy"><b>${esc(p.name)}</b><span>${baht(effPrice(p))}</span></div>
      <button class="btn btn-primary" data-buynow="${p.id}">ซื้อเลย</button>
    </div>` : ''}
  </section>`;
}

function viewAbout() {
  setPageMeta('เกี่ยวกับเรา', 'ข้อมูลแบรนด์นุชฟอร์ไลฟ์และแนวทางช่วยเกษตรกรไทยเพิ่มผลผลิต');
  const st = SITE.stats || {};
  const aboutStats = {
    farmers: Math.max(20000, parseInt(st.farmers, 10) || 0),
    products: Math.max(10, parseInt(st.products, 10) || 0),
    rating: Math.max(4.8, Number(st.rating) || 0),
    ontime: Math.max(98, parseInt(st.ontime, 10) || 0),
  };
  return `
  <section class="section page-top">
    <div class="section-head reveal"><span class="eyebrow">เกี่ยวกับเรา</span><h2>นุชฟอร์ไลฟ์ — นวัตกรรมเพื่อเกษตรกรไทย</h2></div>
    <p class="about-lead reveal">เราพัฒนาและจำหน่ายอาหารเสริมพืช ฮอร์โมน และสารจับใบคุณภาพสูง รวมถึงผลิตภัณฑ์สมุนไพรเพื่อสุขภาพ มุ่งช่วยเกษตรกรไทยเพิ่มผลผลิต ลดต้นทุน และทำเกษตรอย่างยั่งยืน พร้อมทีมนักวิชาการให้คำปรึกษาอย่างใกล้ชิด</p>
  </section>
  <section class="section stats reveal">
    <div class="stat"><b data-count="${aboutStats.farmers}">0</b><span>เกษตรกรไว้วางใจ</span></div>
    <div class="stat"><b data-count="${aboutStats.products}">0</b><span>ผลิตภัณฑ์</span></div>
    <div class="stat"><b data-count="${aboutStats.rating}" data-decimals="1">0</b><span>คะแนนเฉลี่ย</span></div>
    <div class="stat"><b data-count="${aboutStats.ontime}" data-suffix="%">0</b><span>ส่งตรงเวลา</span></div>
  </section>
  <section class="section">
    <div class="features">
      <article class="feature glass reveal"><div class="f-ico">${icon('truck')}</div><h3>จัดส่งทั่วไทย</h3><p>ส่งไว พร้อมเลขพัสดุติดตามได้ทุกออเดอร์</p></article>
      <article class="feature glass reveal"><div class="f-ico">${icon('shieldleaf')}</div><h3>คุณภาพมั่นใจ</h3><p>ผลิตภัณฑ์คุณภาพ ใช้ได้จริง เกษตรกรทั่วประเทศไว้วางใจ</p></article>
      <article class="feature glass reveal"><div class="f-ico">${icon('chat')}</div><h3>ปรึกษาฟรี</h3><p>ทีมนักวิชาการตอบผ่าน Live Chat เชื่อม LINE ช่วยทุกขั้นตอน</p></article>
    </div>
  </section>
  <section class="cta-band glass reveal">
    <h2>พร้อมเพิ่มผลผลิตกับนุชฟอร์ไลฟ์แล้วหรือยัง?</h2>
    <p>เลือกชมสินค้าหรือทักแชทปรึกษานักวิชาการได้เลย</p>
    <a href="${routeHref('/products')}" class="btn btn-primary">เลือกซื้อสินค้า</a>
  </section>
  <section class="section section-tight reveal">
    <div class="section-head"><span class="eyebrow">Service Standard</span><h2>มาตรฐานบริการสำหรับลูกค้าทุกออเดอร์</h2></div>
    ${orgTrustHTML()}
    ${buyingStepsHTML()}
  </section>
  <section class="section section-tight reveal">
    <div class="section-head"><span class="eyebrow">FAQ</span><h2>คำถามก่อนสั่งซื้อ</h2></div>
    ${storeFaqHTML()}
  </section>
  ${corporateFooterHTML()}`;
}

function checkoutTotalsHTML() {
  const sub = cartTotal();
  const disc = appliedCoupon?.discount || 0;
  const country = document.getElementById('coCountry')?.value || S('SHIP_HOME') || 'ไทย';
  const ship = shipFee(country, Math.max(0, sub - disc));
  const total = Math.max(0, sub - disc) + ship;
  return `
    <div class="sum-row"><span>ยอดสินค้า</span><b>${baht(sub)}</b></div>
    ${disc ? `<div class="sum-row"><span>ส่วนลด${appliedCoupon ? ' (' + appliedCoupon.code + ')' : ''}</span><b>−${baht(disc)}</b></div>` : ''}
    <div class="sum-row"><span>ค่าจัดส่ง${ship === 0 ? ' · ฟรี' : ''}</span><b>${baht(ship)}</b></div>
    <div class="sum-total"><span>รวมทั้งหมด</span><b>${baht(total)}</b></div>`;
}
function checkoutProgressHTML(active = 1) {
  const steps = [
    ['ข้อมูลผู้รับ', 'ชื่อ เบอร์โทร และที่อยู่จัดส่ง'],
    ['จัดส่ง', 'ตรวจค่าส่งและหมายเหตุ'],
    ['ชำระเงิน', 'PromptPay หรือบัตร'],
    ['ติดตาม', 'ดูสถานะได้ทันที'],
  ];
  return `<div class="checkout-progress">${steps.map((step, index) => `<div class="checkout-progress-step ${index + 1 <= active ? 'is-on' : ''}">
    <span>${index + 1}</span><b>${step[0]}</b><small>${step[1]}</small>
  </div>`).join('')}</div>`;
}
function checkoutSectionTitle(step, title, desc = '') {
  return `<div class="checkout-section-title"><span>${step}</span><div><b>${esc(title)}</b>${desc ? `<small>${esc(desc)}</small>` : ''}</div></div>`;
}
function orderTimelineHTML(status = '') {
  const cancelled = status === 'cancelled';
  if (cancelled) return `<div class="timeline order-timeline is-cancelled"><div class="tl-step done cur"><span class="tl-dot">!</span><span class="tl-label">ยกเลิกออเดอร์</span></div></div>`;
  const stepIndex = Math.max(0, STATUS_STEPS.findIndex((s) => s.key === status));
  return `<div class="timeline order-timeline">${STATUS_STEPS.map((s, i) => `
    <div class="tl-step ${i <= stepIndex ? 'done' : ''} ${i === stepIndex ? 'cur' : ''}">
      <span class="tl-dot">${i < stepIndex ? '✓' : s.icon}</span><span class="tl-label">${s.label}</span></div>`).join('')}</div>`;
}
function orderPriority(o = {}) {
  if (o.status === 'awaiting_payment' && o.payment_claimed && !o.paid) return { key: 'verify', label: 'รอตรวจสลิป', tone: 'warn', action: 'paid' };
  if (o.status === 'paid') return { key: 'prepare', label: 'รอเตรียมสินค้า', tone: 'info', action: 'preparing' };
  if (o.status === 'preparing') return { key: 'ship', label: 'รอจัดส่ง', tone: 'info', action: 'shipped' };
  if (o.status === 'shipped') return { key: 'deliver', label: 'รอปิดงาน', tone: 'ok', action: 'delivered' };
  if (o.status === 'awaiting_payment') return { key: 'pay', label: 'รอลูกค้าชำระ', tone: 'muted', action: '' };
  return { key: 'done', label: o.statusLabel || 'เสร็จสิ้น', tone: 'muted', action: '' };
}
function viewCheckout() {
  setPageMeta('ชำระเงิน', 'กรอกข้อมูลสั่งซื้อและชำระเงินอย่างปลอดภัย');
  if (cart.size === 0) {
    return `<section class="section page-top"><div class="empty-state glass reveal">
      <div class="es-ico">🛒</div><h2>ตะกร้าว่างเปล่า</h2><p>ยังไม่มีสินค้าในตะกร้าของคุณ</p>
      <a class="btn btn-primary" href="${routeHref('/products')}">เลือกซื้อสินค้า</a></div></section>`;
  }
  let rows = '';
  const checkoutPoints = settingLines('SITE_CHECKOUT_POINTS', DEFAULT_CHECKOUT_POINTS);
  cart.forEach((qty, id) => {
    const p = productById(id); if (!p) return;
    rows += `<div class="sum-row"><span>${p.name} <em>×${qty}</em></span><b>${baht(effPrice(p) * qty)}</b></div>`;
  });
  const recs = cartRecommendationProducts(3);
  return `
  <section class="section page-top">
    <div class="section-head reveal"><span class="eyebrow">ขั้นตอนสุดท้าย</span><h2>กรอกข้อมูลสั่งซื้อ</h2></div>
    ${checkoutProgressHTML(1)}
    <div class="checkout-steps reveal">${buyingStepsHTML()}</div>
    <div class="checkout-grid">
      <form id="checkoutForm" class="checkout-form glass reveal">
        <div class="checkout-form-section">
          ${checkoutSectionTitle('01', 'ข้อมูลผู้รับ', 'ใช้สำหรับจัดส่งและแจ้งสถานะออเดอร์')}
          <div class="checkout-field-grid">
            <label>ชื่อผู้รับ <input name="name" required autocomplete="name" placeholder="ชื่อ–นามสกุล" /></label>
            <label>เบอร์โทร <input name="phone" required inputmode="tel" autocomplete="tel" placeholder="08x-xxx-xxxx" /></label>
          </div>
          <label>อีเมล (รับใบยืนยันออเดอร์) <input name="email" type="email" autocomplete="email" placeholder="you@email.com" /></label>
        </div>
        <div class="checkout-form-section">
          ${checkoutSectionTitle('02', 'ข้อมูลจัดส่ง', 'กรอกที่อยู่ให้ครบเพื่อลดการตีกลับ')}
          <label>ที่อยู่จัดส่ง <textarea name="address" required autocomplete="street-address" rows="3" placeholder="บ้านเลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์"></textarea></label>
          <div class="checkout-field-grid">
            <label>ประเทศจัดส่ง <select name="country" id="coCountry">
              <option>ไทย</option><option>สิงคโปร์</option><option>มาเลเซีย</option><option>ลาว</option><option>กัมพูชา</option><option>เวียดนาม</option><option>อื่นๆ (ต่างประเทศ)</option>
            </select></label>
            <label>หมายเหตุ (ถ้ามี) <input name="note" placeholder="เช่น สี/รุ่นที่ต้องการ, เวลาสะดวกรับของ" /></label>
          </div>
        </div>
        <div class="pay-options">
          ${checkoutSectionTitle('03', 'วิธีชำระเงิน', 'เลือกวิธีที่สะดวกที่สุด')}
          <span class="pay-label">วิธีชำระเงิน</span>
          <label class="pay"><input type="radio" name="payment" value="promptpay" checked /><span><b>PromptPay QR</b><small>สแกนจ่ายด้วยแอปธนาคาร</small></span></label>
          <label class="pay"><input type="radio" name="payment" value="card" /><span><b>บัตรเครดิต / เดบิต</b><small>ชำระผ่าน Stripe ปลอดภัย</small></span></label>
        </div>
        <button type="submit" class="btn btn-primary">ดำเนินการชำระเงิน</button>
        <p class="form-note">PromptPay จะแสดง QR ให้สแกนจ่าย · บัตรเครดิตจะพาไปหน้าชำระเงินที่ปลอดภัยของ Stripe</p>
      </form>
      <aside class="summary glass reveal">
        <h3>สรุปคำสั่งซื้อ</h3>
        ${rows}
        <div class="coupon-box">
          ${appliedCoupon
            ? `<div class="coupon-applied"><span>คูปอง <b>${appliedCoupon.code}</b> · −${baht(appliedCoupon.discount)}</span><button type="button" id="couponRemove">ลบ</button></div>`
            : `<div class="coupon-input"><input id="couponInput" placeholder="รหัสคูปอง" autocomplete="off"><button type="button" id="couponApply">ใช้</button></div>`}
        </div>
        <div id="sumTotals">${checkoutTotalsHTML()}</div>
        <div class="checkout-trust">
          <h4>มั่นใจก่อนชำระเงิน</h4>
          <ul class="support-list">${checkoutPoints.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
          ${lineCTA('line-inline')}
        </div>
        ${recs.length ? `<div class="checkout-recs"><h4>เพิ่มสินค้าแนะนำ</h4>${recs.map((p) => `<button type="button" data-add="${esc(p.id)}"><span>${esc(productCardName(p))}</span><b>${baht(effPrice(p))}</b></button>`).join('')}</div>` : ''}
        <a href="${routeHref('/products')}" class="back" style="margin-top:14px;display:inline-block">← เลือกซื้อเพิ่ม</a>
      </aside>
    </div>
    <div class="checkout-mobile-bar">
      <div><span>ยอดชำระ</span><b>${baht(Math.max(0, cartTotal() - (appliedCoupon?.discount || 0)) + shipFee(S('SHIP_HOME') || 'ไทย', Math.max(0, cartTotal() - (appliedCoupon?.discount || 0))))}</b></div>
      <button class="btn btn-primary" type="button" data-submit-checkout>ชำระเงิน</button>
    </div>
  </section>`;
}

const STATUS_STEPS = [
  { key: 'awaiting_payment', label: 'รอชำระเงิน', icon: '💳' },
  { key: 'paid', label: 'ชำระเงินแล้ว', icon: '✅' },
  { key: 'preparing', label: 'เตรียมสินค้า', icon: '📦' },
  { key: 'shipped', label: 'จัดส่งแล้ว', icon: '🚚' },
  { key: 'delivered', label: 'สำเร็จ', icon: '🎉' },
];

async function fetchOrder(id) {
  try {
    const r = await api('/api/orders/' + encodeURIComponent(id) + orderAccessQuery(id));
    if (r.ok) return await r.json();
  } catch {}
  return null;
}

async function viewOrder({ id }) {
  let order = await fetchOrder(id);
  if (!order) return viewNotFound();
  // กลับมาจากหน้า Stripe → ลองยืนยันการชำระเงิน
  if (order.payment_method === 'card' && !order.paid) {
    try { await api('/api/orders/' + id + '/confirm-stripe' + orderAccessQuery(id), { method: 'POST' }); } catch {}
    order = (await fetchOrder(id)) || order;
  }
  setPageMeta(`ออเดอร์ ${id}`, 'ติดตามสถานะคำสั่งซื้อและการชำระเงิน');
  clientOrders.set(order.id, order);
  startOrderPoll(id, order);
  return renderOrderHTML(order);
}

function renderOrderHTML(o) {
  const cancelled = o.status === 'cancelled';
  const expired = o.status === 'expired';
  const timeline = orderTimelineHTML(o.status);
  const nextCopy = o.paid
    ? 'ชำระเงินเรียบร้อยแล้ว ระบบจะอัปเดตการเตรียมสินค้าและเลขพัสดุในหน้านี้'
    : o.payment_claimed
      ? 'แจ้งชำระเงินแล้ว รอแอดมินตรวจสอบหรือระบบตรวจสลิป'
      : 'สแกนจ่ายหรืออัปโหลดสลิป จากนั้นกดแจ้งชำระเงินเพื่อให้ทีมตรวจสอบเร็วขึ้น';

  let pay;
  if (cancelled) {
    pay = `<div class="pay-block cancel glass"><div class="es-ico">✕</div><h3>ออเดอร์ถูกยกเลิก</h3><p>หากมีข้อสงสัยทักแชทแอดมินได้เลย</p></div>`;
  } else if (expired) {
    pay = `<div class="pay-block expired glass"><div class="es-ico">⌛</div><h3>ออเดอร์หมดเวลาชำระ</h3><p>ระบบคืนสต็อกและคูปองให้อัตโนมัติแล้ว หากยังต้องการสินค้า กรุณาสั่งซื้อใหม่อีกครั้ง</p></div>`;
  } else if (o.paid) {
    if (!markTracked('purchase:' + o.id)) trackEvent('purchase', { value: o.total, currency: 'THB', order_id: o.id });
    pay = `<div class="pay-block paid glass"><div class="success-ico">✓</div><h3>ชำระเงินเรียบร้อย</h3><p>ขอบคุณสำหรับการสั่งซื้อ คุณจูนกำลังดูแลออเดอร์ของคุณ</p></div>`;
  } else if (o.payment_method === 'promptpay') {
    const pp = o.promptpay;
    const slip = o.paymentLog;
    pay = pp ? `<div class="pay-block glass">
        <h3>สแกนจ่ายด้วย PromptPay</h3>
        <img class="qr" src="${pp.qr}" alt="PromptPay QR" />
        <div class="pay-amt">${baht(o.total)}</div>
        <div class="pay-id">${pp.name ? pp.name + ' · ' : ''}${pp.promptpayId}</div>
        <div class="pay-copy-actions">
          <button class="btn-mini" type="button" data-copy="${esc(String(o.total || ''))}">คัดลอกยอด</button>
          <button class="btn-mini" type="button" data-copy="${esc(pp.promptpayId || '')}">คัดลอก PromptPay</button>
          <button class="btn-mini" type="button" data-copy="${esc(o.id)}">คัดลอกเลขออเดอร์</button>
        </div>
        ${o.payment_claimed
          ? `<div class="claimed">⏳ แจ้งชำระแล้ว — รอแอดมินยืนยัน</div>`
          : `<button class="btn btn-primary" data-notifypay="${o.id}">แจ้งว่าชำระเงินแล้ว</button>`}
        <form id="slipForm" class="slip-form" data-orderid="${o.id}">
          <input name="slip" type="file" accept="image/png,image/jpeg,image/webp,image/gif" required />
          <button class="btn btn-glass" type="submit">อัปโหลดสลิปเพื่อตรวจอัตโนมัติ</button>
        </form>
        ${slip?.verification_message ? `<p class="form-note">${escapeHtml(slip.verification_message)}</p>` : ''}
        <p class="form-note">สแกน QR ด้วยแอปธนาคาร โอนตามยอด แล้วกด "แจ้งว่าชำระเงินแล้ว" — สถานะจะอัปเดตอัตโนมัติ</p>
      </div>` : `<div class="pay-block glass"><p>ระบบ PromptPay ยังไม่พร้อม กรุณาทักแชทแอดมิน</p></div>`;
  } else {
    pay = `<div class="pay-block glass"><h3>รอการชำระเงิน</h3><p>หากยังไม่ได้ชำระผ่านบัตร กรุณาทักแชทแอดมินเพื่อขอลิงก์ชำระเงินใหม่</p></div>`;
  }

  const items = o.items.map((it) => `<div class="sum-row"><span>${it.name} <em>×${it.qty}</em></span><b>${baht(it.price * it.qty)}</b></div>`).join('');
  const expiresText = o.expiresAt && !o.paid && !cancelled && !expired ? new Date(o.expiresAt).toLocaleString('th-TH') : '';
  return `
  <section class="section page-top">
    <div class="order-page">
      <div class="order-head reveal">
        <span class="status-badge s-${o.status}">${o.statusLabel || ''}</span>
        <h2>ออเดอร์ ${o.id}</h2>
        <p class="muted">${new Date(o.createdAt).toLocaleString('th-TH')}</p>
        ${expiresText ? `<p class="muted">ชำระภายใน ${expiresText}</p>` : ''}
        <div class="order-head-actions"><button class="btn-mini" type="button" data-copy="${esc(o.id)}">คัดลอกเลขออเดอร์</button><button class="btn-mini" type="button" data-copy="${esc(location.origin + routeHref('/order/' + o.id))}">คัดลอกลิงก์ติดตาม</button></div>
      </div>
      ${timeline}
      <div class="order-guidance glass reveal">
        <div><span>สถานะตอนนี้</span><b>${esc(o.statusLabel || o.status)}</b></div>
        <p>${esc(nextCopy)}</p>
      </div>
      <div class="order-cols">
        <div class="reveal">${pay}</div>
        <aside class="summary glass reveal">
          <h3>รายการสั่งซื้อ</h3>
          ${items}
          ${o.discount ? `<div class="sum-row"><span>ส่วนลด${o.coupon ? ' (' + o.coupon + ')' : ''}</span><b>−${baht(o.discount)}</b></div>` : ''}
          ${o.shipping ? `<div class="sum-row"><span>ค่าจัดส่ง</span><b>${baht(o.shipping)}</b></div>` : ''}
          <div class="sum-total"><span>รวมทั้งหมด</span><b>${baht(o.total)}</b></div>
          ${o.tracking ? `<div class="sum-row"><span>เลขพัสดุ</span><b>${o.tracking}</b></div>` : ''}
          <div class="sum-row"><span>ผู้รับ</span><b>${o.customer.name}</b></div>
          <div class="sum-row"><span>โทร</span><b>${o.customer.phone}</b></div>
        </aside>
      </div>
      <div class="d-actions" style="justify-content:center;margin-top:30px">
        <button class="btn btn-glass" id="confirmChat">สอบถามแอดมิน 💬</button>
        <a href="${routeHref('/products')}" class="btn btn-glass">เลือกซื้อต่อ</a>
      </div>
    </div>
      <div class="order-next glass reveal">
        <b>กลับมาง่ายในครั้งถัดไป</b>
        <span>บันทึกลิงก์หน้านี้ไว้เพื่อติดตามออเดอร์ ทักแชทต่อ หรือเลือกซื้อสินค้าที่ใช้คู่กัน</span>
        <div>
          <button class="btn btn-primary" type="button" data-reorder="${esc(o.id)}">สั่งซ้ำจากออเดอร์นี้</button>
          <a class="btn btn-primary" href="${routeHref('/products')}">สั่งซื้อเพิ่ม</a>
          <a class="btn btn-glass" href="${routeHref('/reviews')}">ดูรีวิวลูกค้า</a>
        </div>
      </div>
  </section>`;
}

function viewTrack() {
  const recent = [...clientOrders.values()].slice(-3).reverse();
  return `<section class="section page-top">
    <div class="track-center glass reveal">
      <div class="es-ico">🔎</div>
      <span class="eyebrow">Order Tracking</span>
      <h2>ติดตามคำสั่งซื้อ</h2>
      <p>กรอกหมายเลขออเดอร์เพื่อดูสถานะชำระเงิน การเตรียมสินค้า และเลขพัสดุในหน้าเดียว</p>
      <form id="trackForm" class="track-form track-form-premium">
        <input name="oid" placeholder="VYU-XXXXXXX" autocomplete="off" required />
        <button class="btn btn-primary" type="submit">ติดตาม</button>
      </form>
      ${recent.length ? `<div class="track-recent"><b>ออเดอร์ล่าสุดในเครื่องนี้</b>${recent.map((order) => `<a href="${routeHref('/order/' + order.id)}"><span>${esc(order.id)}</span><small>${esc(order.statusLabel || order.status || '')}</small></a>`).join('')}</div>` : ''}
      <div class="track-help-grid">
        <div><b>หาเลขออเดอร์ไม่เจอ?</b><span>ดูจากหน้าออเดอร์หลังสั่งซื้อ หรือทักแชทพร้อมเบอร์โทรที่ใช้สั่งซื้อ</span></div>
        <div><b>ชำระเงินแล้ว?</b><span>เปิดหน้าออเดอร์เพื่ออัปโหลดสลิปหรือกดแจ้งชำระเงิน</span></div>
      </div>
      <div class="d-actions">
        <button class="btn btn-glass" type="button" id="confirmChat">ถามแอดมิน</button>
        <a class="btn btn-glass" href="${routeHref('/products')}">เลือกซื้อสินค้า</a>
      </div>
    </div>
  </section>`;
}

function viewNotFound() {
  return `<section class="section page-top"><div class="empty-state glass reveal">
    <div class="es-ico">🧭</div><h2>ไม่พบหน้านี้</h2><p>หน้าที่คุณค้นหาอาจถูกย้ายหรือไม่มีอยู่</p>
    <a class="btn btn-primary" href="${routeHref('/')}">กลับหน้าแรก</a></div></section>`;
}

function loadingView() { return `<section class="section page-top"><p class="muted" style="text-align:center">กำลังโหลด…</p></section>`; }
function dashboardHrefFor(user = currentUser) {
  if (!user) return routeHref('/login');
  if (isChatAdminClient(user)) return adminEntryHref('/admin/inbox');
  return isFullAdminClient(user) ? routeHref('/') : routeHref('/account');
}
function redirectToDashboard(user = currentUser, { replace = true } = {}) {
  const href = dashboardHrefFor(user);
  if (!href) return;
  if (replace) {
    location.replace(href);
    return;
  }
  location.assign(href);
}
function redirectAuthenticatedHome() {
  if (!currentUser) return;
  redirectToDashboard(currentUser);
}
async function requestLogoutSilently() {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const ok = navigator.sendBeacon('/api/auth/logout', new Blob(['{}'], { type: 'application/json' }));
      if (ok) return true;
    }
  } catch {}
  try {
    await api('/api/auth/logout', { method: 'POST', keepalive: true });
    return true;
  } catch {
    return false;
  }
}

// ════════════════════════ Auth views ════════════════════════
function viewLogin() {
  if (currentUser) { setTimeout(() => redirectAuthenticatedHome(), 0); return loadingView(); }
  return `<section class="section page-top"><div class="auth-card glass reveal">
    <h2>เข้าสู่ระบบ</h2><p class="muted">ยินดีต้อนรับกลับสู่ ${esc(S('SITE_NAME'))}</p>
    <form id="loginForm" class="auth-form">
      <label>อีเมล<input name="email" type="email" required autocomplete="email" placeholder="you@email.com"></label>
      <label>รหัสผ่าน<input name="password" type="password" required autocomplete="current-password" placeholder="••••••••"></label>
      <button class="btn btn-primary" type="submit">เข้าสู่ระบบ</button>
    </form>
    <p class="auth-alt">ยังไม่มีบัญชี? <a href="${routeHref('/register')}">สมัครสมาชิก</a></p>
  </div></section>`;
}
function viewRegister() {
  if (currentUser) { setTimeout(() => redirectAuthenticatedHome(), 0); return loadingView(); }
  return `<section class="section page-top"><div class="auth-card glass reveal">
    <h2>สมัครสมาชิก</h2><p class="muted">สร้างบัญชีเพื่อสั่งซื้อและติดตามออเดอร์ได้ง่ายขึ้น</p>
    <form id="registerForm" class="auth-form">
      <label>ชื่อ<input name="name" autocomplete="name" placeholder="ชื่อของคุณ"></label>
      <label>อีเมล<input name="email" type="email" required autocomplete="email" placeholder="you@email.com"></label>
      <label>รหัสผ่าน<input name="password" type="password" required minlength="6" autocomplete="new-password" placeholder="อย่างน้อย 6 ตัวอักษร"></label>
      <button class="btn btn-primary" type="submit">สมัครสมาชิก</button>
    </form>
    <p class="auth-alt">มีบัญชีแล้ว? <a href="${routeHref('/login')}">เข้าสู่ระบบ</a></p>
  </div></section>`;
}
async function viewAccount() {
  if (!currentUser) { setTimeout(() => go('/login'), 0); return loadingView(); }
  let orders = [];
  try { orders = await (await api('/api/my/orders')).json(); } catch {}
  orders.forEach((order) => clientOrders.set(order.id, order));
  const displayName = userDisplayName(currentUser);
  const avatar = userAvatarUrl(currentUser);
  const profileUsername = String(currentUser.username || displayName || '').replace(/^@+/, '');
  const bio = String(currentUser.bio || '').trim();
  const lineId = String(currentUser.lineId || currentUser.line_id || '').trim();
  const phone = String(currentUser.phone || '').trim();
  const locationText = String(currentUser.location || '').trim();
  const rows = orders.length
    ? orders.map((o) => `<div class="acc-order"><a href="${routeHref('/order/' + o.id)}"><div><b>${o.id}</b> <span class="muted">· ${new Date(o.createdAt).toLocaleDateString('th-TH')}</span></div><div><span class="status-badge s-${o.status}">${o.statusLabel}</span> <b>${baht(o.total)}</b></div></a><div class="acc-order-actions"><button class="btn-mini" type="button" data-reorder="${esc(o.id)}">สั่งซ้ำ</button><a class="btn-mini" href="${routeHref('/reviews')}">ดู/ส่งรีวิว</a></div></div>`).join('')
    : '<p class="muted" style="padding:18px">ยังไม่มีคำสั่งซื้อ</p>';
  return `<section class="section page-top"><div class="account">
    <div class="account-profile-card reveal">
      <div class="account-profile-cover"></div>
      <form id="accountProfileForm" class="account-profile-form">
        <div class="account-profile-avatar-wrap">
          <div class="account-profile-avatar" data-account-avatar-preview>${avatar ? `<img src="${esc(avatar)}" alt="${esc(displayName)}">` : `<span>${esc(displayName.slice(0, 1) || 'ส')}</span>`}</div>
          <label class="community-upload account-avatar-upload">เปลี่ยนรูป<input name="avatarFile" type="file" accept="image/*" data-account-avatar-file></label>
        </div>
        <div class="account-profile-main">
          <span class="eyebrow">บัญชีของฉัน</span>
          <h2>${esc(displayName)}</h2>
          <p class="muted">${esc(currentUser.email)}${accountRoleDescription(currentUser)}</p>
          <div class="account-profile-summary">
            <span>@${esc(profileUsername || displayName)}</span>
            <span>${esc(locationText || 'ยังไม่ได้ระบุพื้นที่')}</span>
            <span>${orders.length} คำสั่งซื้อ</span>
          </div>
          <div class="account-profile-fields">
            <label>ชื่อที่แสดง<input name="name" value="${esc(currentUser.name || '')}" placeholder="ชื่อของคุณ"></label>
            <label>Username<input name="username" value="${esc(profileUsername)}" placeholder="เช่น june_garden"></label>
            <label class="account-field-wide">Bio / แนะนำตัว<textarea name="bio" maxlength="180" placeholder="เล่าให้คนในชุมชนรู้จักคุณ เช่น สนใจสินค้าแบบไหน หรือชอบแชร์ประสบการณ์เรื่องอะไร">${esc(bio)}</textarea></label>
            <label>LINE ID<input name="lineId" value="${esc(lineId)}" placeholder="เช่น june_garden"></label>
            <label>เบอร์โทร<input name="phone" value="${esc(phone)}" placeholder="ใช้สำหรับติดต่อเรื่องคำสั่งซื้อ"></label>
            <label class="account-field-wide">จังหวัด / พื้นที่<input name="location" value="${esc(locationText)}" placeholder="เช่น กรุงเทพฯ, เชียงใหม่"></label>
          </div>
          <div class="account-profile-actions">
            <input type="hidden" name="avatar" value="${esc(avatar)}">
            <button class="btn btn-primary" type="submit">บันทึกโปรไฟล์</button>
            <button class="btn btn-glass" type="button" id="logoutBtn">ออกจากระบบ</button>
          </div>
          <div class="account-community-preview">
            ${avatarHTML({ name: displayName, avatar, cls: 'community-avatar' })}
            <div><b>@${esc(profileUsername || displayName)}</b><span>${esc(bio || 'ชื่อ รูป และ bio นี้จะแสดงเวลาโพสต์หรือคอมเมนต์ในชุมชน')}</span></div>
          </div>
        </div>
      </form>
    </div>
    <h3 style="margin:30px 0 14px">ประวัติคำสั่งซื้อ</h3>
    <div class="acc-orders glass reveal">${rows}</div>
  </div></section>`;
}

// ════════════════════════ Admin views ════════════════════════
function adminGuard(options = {}) {
  const allowChatAdmin = options?.allowChatAdmin === true;
  if (!currentUser) { toast('กรุณาเข้าสู่ระบบก่อน', 'err'); setTimeout(() => go('/login'), 0); return false; }
  if (isFullAdminClient(currentUser)) return true;
  if (hasStoreConsoleClient(currentUser)) {
    const role = currentStoreRoleClient(currentUser);
    if (role === 'chat_admin' && !allowChatAdmin) {
      toast('บัญชีนี้เข้าได้เฉพาะหน้า Inbox แชต', 'err');
      setTimeout(() => go('/admin/inbox'), 0);
      return false;
    }
    return true;
  }
  if (allowChatAdmin && canAccessAdminShellClient(currentUser)) return true;
  if (isChatAdminClient(currentUser)) { toast('บัญชีนี้เข้าได้เฉพาะหน้า Inbox แชต', 'err'); setTimeout(() => go('/admin/inbox'), 0); return false; }
  toast('เฉพาะผู้ดูแลระบบเท่านั้น', 'err'); setTimeout(() => go('/'), 0); return false;
  return true;
}
function adminLayout(active, content) {
  const storeRole = currentStoreRoleClient(currentUser);
  const storeScopedTabs = [['', 'แดชบอร์ด', '◴'], ['products', 'จัดการสินค้า', '❑'], ['community', 'ชุมชน', '◎'], ['articles', 'บทความเดิม', '✐'], ['inbox', 'Inbox แชต', '✉'], ['leads', 'ลีดลูกค้า', '◎'], ['orders', 'ออเดอร์', '❯'], ['coupons', 'คูปองส่วนลด', '٪'], ['site', 'ข้อมูลร้าน', '✎']];
  const tabs = isChatAdminClient(currentUser) || (!isFullAdminClient(currentUser) && storeRole === 'chat_admin')
    ? [['inbox', 'Inbox แชต', '✉']]
    : (isFullAdminClient(currentUser)
      ? [['', 'แดชบอร์ด', '◴'], ['products', 'จัดการสินค้า', '❑'], ['community', 'ชุมชน', '◎'], ['articles', 'บทความเดิม', '✐'], ['inbox', 'Inbox แชต', '✉'], ['leads', 'ลีดลูกค้า', '◎'], ['orders', 'ออเดอร์', '❯'], ['coupons', 'คูปองส่วนลด', '٪'], ['users', 'ผู้ใช้', '◇'], ['stores', 'หลายเว็บไซต์', '◪'], ['site', 'ข้อมูลร้าน', '✎'], ['diagnostics', 'Diagnostics', '◫'], ['settings', 'ตั้งค่า API', '⚙']]
      : storeScopedTabs);
  const nav = tabs.map(([k, l, ic]) => {
    const isInbox = k === 'inbox';
    const badge = isInbox && _adminInboxUnreadTotal ? `<span class="admin-nav-badge">${_adminInboxUnreadTotal > 99 ? '99+' : _adminInboxUnreadTotal}</span>` : '';
    return `<a href="${routeHref('/admin' + (k ? '/' + k : ''))}" data-admin-nav="${esc(k || 'dashboard')}" class="${active === k ? 'on' : ''}"><span>${ic}</span>${l}${badge}</a>`;
  }).join('');
  const storeSwitcher = renderAdminStoreSwitcher();
  const currentStore = selectedAdminStore();
  return `<section class="section page-top"><div class="admin">
    <aside class="admin-side glass"><div class="admin-brand"><span class="brand-dot"></span>${isChatAdminClient(currentUser) || storeRole === 'chat_admin' ? 'Admin chat' : 'หลังบ้าน'} ${esc(currentStore?.name || S('SITE_NAME'))}</div>${storeSwitcher}${nav}<a href="${routeHref('/')}" class="admin-exit">← กลับหน้าเว็บ</a></aside>
    <div class="admin-main">${content}</div>
  </div></section>`;
}
const ADMIN_PAGE_SIZE_OPTIONS = [20, 50, 100];
const ADMIN_LIST_CONFIG = {
  leads: {
    endpoint: '/api/admin/leads',
    filterKey: 'status',
    searchPlaceholder: 'ค้นหาชื่อ, เบอร์, LINE, จังหวัด, พืช',
    filterLabel: 'สถานะ',
    filters: [
      { value: 'all', label: 'ทั้งหมด' },
      { value: 'new', label: 'ใหม่' },
      { value: 'contacted', label: 'ติดต่อแล้ว' },
      { value: 'qualified', label: 'มีโอกาสซื้อ' },
      { value: 'won', label: 'ปิดการขายได้' },
      { value: 'lost', label: 'ยังไม่สำเร็จ' },
    ],
  },
  orders: {
    endpoint: '/api/admin/orders',
    filterKey: 'status',
    searchPlaceholder: 'ค้นหารหัสออเดอร์, ชื่อลูกค้า, เบอร์, เลขพัสดุ',
    filterLabel: 'สถานะ',
    filters: [
      { value: 'all', label: 'ทั้งหมด' },
      { value: 'awaiting_payment', label: 'รอชำระเงิน' },
      { value: 'paid', label: 'ชำระเงินแล้ว' },
      { value: 'preparing', label: 'กำลังเตรียมสินค้า' },
      { value: 'shipped', label: 'จัดส่งแล้ว' },
      { value: 'delivered', label: 'จัดส่งสำเร็จ' },
      { value: 'cancelled', label: 'ยกเลิก' },
      { value: 'expired', label: 'หมดเวลาชำระ' },
    ],
  },
  users: {
    endpoint: '/api/admin/users',
    filterKey: 'role',
    searchPlaceholder: 'ค้นหาอีเมล, ชื่อ, รหัสผู้ใช้',
    filterLabel: 'สิทธิ์',
    filters: [
      { value: 'all', label: 'ทั้งหมด' },
      { value: 'admin', label: 'แอดมิน' },
      { value: 'user', label: 'สมาชิก' },
    ],
  },
};
const adminListState = {
  leads: { page: 1, limit: 20, q: '', filter: 'all' },
  orders: { page: 1, limit: 20, q: '', filter: 'all' },
  users: { page: 1, limit: 20, q: '', filter: 'all' },
};
const adminInboxState = {
  page: 1,
  limit: 20,
  q: '',
  sessionId: '',
  items: [],
  messages: [],
  detail: null,
};
let _adminInboxPollTimer = null;
function syncAdminInboxChrome(path = currentPath()) {
  if (typeof document === 'undefined') return;
  const active = path === '/admin/inbox' && _adminInboxFullscreen && canAccessAdminInboxClient(currentUser);
  if (!active) _adminInboxRoomsOpen = false;
  document.body.classList.toggle('admin-inbox-fullscreen', active);
  document.body.classList.toggle('admin-inbox-rooms-open', active && _adminInboxRoomsOpen);
}
function isAdminInboxFullscreen() {
  return currentPath() === '/admin/inbox' && _adminInboxFullscreen && canAccessAdminInboxClient(currentUser);
}
function setAdminInboxFullscreen(next = false) {
  _adminInboxFullscreen = Boolean(next);
  if (!_adminInboxFullscreen) _adminInboxRoomsOpen = false;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(ADMIN_INBOX_FULLSCREEN_KEY, _adminInboxFullscreen ? '1' : '0');
    }
  } catch {}
  syncAdminInboxChrome();
}
function setAdminInboxRoomsOpen(next = false) {
  _adminInboxRoomsOpen = Boolean(next);
  syncAdminInboxChrome();
}
function getAdminListState(key) {
  const config = ADMIN_LIST_CONFIG[key] || { filters: [{ value: 'all' }] };
  const allowedFilters = new Set((config.filters || []).map((item) => item.value));
  const current = adminListState[key] || { page: 1, limit: 20, q: '', filter: 'all' };
  const limit = ADMIN_PAGE_SIZE_OPTIONS.includes(Number(current.limit)) ? Number(current.limit) : 20;
  const page = Math.max(1, parseInt(current.page, 10) || 1);
  const q = String(current.q || '').trim().slice(0, 80);
  const filter = allowedFilters.has(String(current.filter || 'all')) ? String(current.filter || 'all') : 'all';
  adminListState[key] = { page, limit, q, filter };
  return adminListState[key];
}
function setAdminListState(key, patch = {}) {
  const current = getAdminListState(key);
  const config = ADMIN_LIST_CONFIG[key] || { filters: [{ value: 'all' }] };
  const allowedFilters = new Set((config.filters || []).map((item) => item.value));
  const nextLimit = patch.limit !== undefined ? Number(patch.limit) : current.limit;
  const nextPage = patch.page !== undefined ? Number(patch.page) : current.page;
  const nextFilter = patch.filter !== undefined ? String(patch.filter || 'all') : current.filter;
  adminListState[key] = {
    limit: ADMIN_PAGE_SIZE_OPTIONS.includes(nextLimit) ? nextLimit : current.limit,
    page: Math.max(1, parseInt(nextPage, 10) || 1),
    q: String(patch.q !== undefined ? patch.q : current.q).trim().slice(0, 80),
    filter: allowedFilters.has(nextFilter) ? nextFilter : 'all',
  };
  return adminListState[key];
}
async function fetchAdminPage(key) {
  const config = ADMIN_LIST_CONFIG[key];
  const state = getAdminListState(key);
  const qs = new URLSearchParams({ page: String(state.page), limit: String(state.limit) });
  if (state.q) qs.set('q', state.q);
  if (config?.filterKey && state.filter && state.filter !== 'all') qs.set(config.filterKey, state.filter);
  const res = await api(`${config?.endpoint || ''}?${qs.toString()}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'โหลดข้อมูลไม่สำเร็จ');
  if (Array.isArray(data)) {
    const items = data;
    return { items, page: state.page, limit: state.limit, total: items.length, totalPages: 1, hasPrev: false, hasMore: false };
  }
  const items = Array.isArray(data?.items) ? data.items : [];
  const total = Math.max(items.length, Number(data?.total || 0));
  const limit = Number(data?.limit || state.limit || 20);
  const totalPages = Math.max(1, Number(data?.totalPages || Math.ceil(total / Math.max(1, limit)) || 1));
  const page = Math.min(Math.max(1, Number(data?.page || state.page || 1)), totalPages);
  if (total > 0 && !items.length && state.page > totalPages) {
    setAdminListState(key, { page: totalPages, limit });
    return fetchAdminPage(key);
  }
  if (page !== state.page || limit !== state.limit) setAdminListState(key, { page, limit });
  return {
    items,
    page,
    limit,
    total,
    totalPages,
    hasPrev: Boolean(data?.hasPrev ?? page > 1),
    hasMore: Boolean(data?.hasMore ?? page < totalPages),
  };
}
function csvCell(value = '') {
  const text = String(value ?? '').replace(/\r?\n/g, ' ').trim();
  return `"${text.replace(/"/g, '""')}"`;
}
function downloadCsv(filename, headers = [], rows = []) {
  const lines = [headers.map(csvCell).join(',')];
  rows.forEach((row) => lines.push(headers.map((key) => csvCell(row[key])).join(',')));
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exportAdminListCsv(key) {
  const config = ADMIN_LIST_CONFIG[key];
  if (!config) return;
  const state = getAdminListState(key);
  const qs = new URLSearchParams({ page: '1', limit: '100' });
  if (state.q) qs.set('q', state.q);
  if (config.filterKey && state.filter && state.filter !== 'all') qs.set(config.filterKey, state.filter);
  const res = await api(`${config.endpoint}?${qs.toString()}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'export failed');
  const items = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
  if (key === 'orders') {
    downloadCsv(`orders-${Date.now()}.csv`, ['id', 'customerName', 'customerPhone', 'status', 'total', 'payment_method', 'tracking', 'itemSummary'], items);
  } else if (key === 'leads') {
    downloadCsv(`leads-${Date.now()}.csv`, ['id', 'name', 'phone', 'lineId', 'crop', 'province', 'stage', 'status', 'source', 'problem', 'note'], items);
  } else if (key === 'users') {
    downloadCsv(`users-${Date.now()}.csv`, ['id', 'email', 'name', 'role'], items);
  }
}
function exportProductsCsv(products = _adminProducts) {
  const rows = (Array.isArray(products) ? products : []).map((p) => ({
    id: p.id,
    name: p.name,
    category: displayProductCategoryLabel(productCategory(p)),
    price: productCurrentPriceValue(p),
    comparePrice: productComparePriceValue(p),
    stock: p.stock,
    active: p.active === false ? 'no' : 'yes',
    sort: productSortValue(p),
  }));
  downloadCsv(`products-${Date.now()}.csv`, ['id', 'name', 'category', 'price', 'comparePrice', 'stock', 'active', 'sort'], rows);
}
function adminFilters(key) {
  const config = ADMIN_LIST_CONFIG[key];
  const state = getAdminListState(key);
  if (!config) return '';
  return `<form class="admin-filter-bar glass" data-admin-search-form="${key}">
    <input class="admin-filter-input" type="search" name="q" value="${esc(state.q || '')}" placeholder="${esc(config.searchPlaceholder || 'ค้นหา')}">
    <label class="admin-filter-select">
      <span>${esc(config.filterLabel || 'ตัวกรอง')}</span>
      <select name="filter">
        ${(config.filters || []).map((item) => `<option value="${esc(item.value)}" ${item.value === state.filter ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}
      </select>
    </label>
    <div class="admin-filter-actions">
      <button class="btn-mini" type="submit">ค้นหา</button>
      <button class="btn-mini" type="button" data-admin-clear="${key}">ล้าง</button>
    </div>
  </form>`;
}
function adminPagination(key, meta = {}) {
  const page = Math.max(1, Number(meta.page || 1));
  const limit = ADMIN_PAGE_SIZE_OPTIONS.includes(Number(meta.limit)) ? Number(meta.limit) : 20;
  const total = Math.max(0, Number(meta.total || 0));
  const totalPages = Math.max(1, Number(meta.totalPages || Math.ceil(total / Math.max(1, limit)) || 1));
  const start = total ? ((page - 1) * limit) + 1 : 0;
  const end = total ? Math.min(total, page * limit) : 0;
  return `<div class="admin-pager glass">
    <div class="admin-pager-info">
      <b>แสดงผล</b>
      <span>${total ? `${start}-${end} จาก ${total}` : '0 รายการ'}</span>
    </div>
    <div class="admin-pager-actions">
      <label class="admin-limit">ต่อหน้า
        <select data-admin-limit="${key}">
          ${ADMIN_PAGE_SIZE_OPTIONS.map((value) => `<option value="${value}" ${value === limit ? 'selected' : ''}>${value}</option>`).join('')}
        </select>
      </label>
      <span class="admin-page-label">หน้า ${page}/${totalPages}</span>
      <button class="btn-mini" type="button" data-admin-page="${key}" data-page-action="prev" ${page <= 1 ? 'disabled' : ''}>ก่อนหน้า</button>
      <button class="btn-mini" type="button" data-admin-page="${key}" data-page-action="next" ${page >= totalPages ? 'disabled' : ''}>ถัดไป</button>
    </div>
  </div>`;
}
function getAdminInboxState() {
  adminInboxState.page = Math.max(1, parseInt(adminInboxState.page, 10) || 1);
  adminInboxState.limit = ADMIN_PAGE_SIZE_OPTIONS.includes(Number(adminInboxState.limit)) ? Number(adminInboxState.limit) : 20;
  adminInboxState.q = String(adminInboxState.q || '').trim().slice(0, 80);
  adminInboxState.sessionId = String(adminInboxState.sessionId || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
  return adminInboxState;
}
function setAdminInboxState(patch = {}) {
  const current = getAdminInboxState();
  adminInboxState.page = patch.page !== undefined ? Math.max(1, parseInt(patch.page, 10) || 1) : current.page;
  adminInboxState.limit = patch.limit !== undefined && ADMIN_PAGE_SIZE_OPTIONS.includes(Number(patch.limit)) ? Number(patch.limit) : current.limit;
  adminInboxState.q = patch.q !== undefined ? String(patch.q || '').trim().slice(0, 80) : current.q;
  adminInboxState.sessionId = patch.sessionId !== undefined ? String(patch.sessionId || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16) : current.sessionId;
  if (patch.items !== undefined) adminInboxState.items = Array.isArray(patch.items) ? patch.items : [];
  if (patch.messages !== undefined) adminInboxState.messages = Array.isArray(patch.messages) ? patch.messages : [];
  if (patch.detail !== undefined) adminInboxState.detail = patch.detail || null;
  return adminInboxState;
}
async function fetchAdminInboxPageData() {
  const state = getAdminInboxState();
  const qs = new URLSearchParams({ page: String(state.page), limit: String(state.limit) });
  if (state.q) qs.set('q', state.q);
  const res = await api(`/api/admin/inbox?${qs.toString()}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fallbackMessage = data?.error === 'ไม่พบรายการที่ร้องขอ'
      ? 'เซิร์ฟเวอร์ preview ยังไม่โหลด route inbox เวอร์ชันล่าสุด กรุณารีเฟรชหรือรีสตาร์ต preview'
      : (data?.error || 'โหลด inbox แชตไม่สำเร็จ');
    throw new Error(fallbackMessage);
  }
  const items = Array.isArray(data?.items) ? data.items : [];
  const total = Math.max(items.length, Number(data?.total || 0));
  const limit = ADMIN_PAGE_SIZE_OPTIONS.includes(Number(data?.limit)) ? Number(data.limit) : state.limit;
  const totalPages = Math.max(1, Number(data?.totalPages || Math.ceil(total / Math.max(1, limit)) || 1));
  const page = Math.min(Math.max(1, Number(data?.page || state.page || 1)), totalPages);
  setAdminInboxState({ page, limit, items });
  return { items, page, limit, total, totalPages, hasPrev: Boolean(data?.hasPrev ?? page > 1), hasMore: Boolean(data?.hasMore ?? page < totalPages) };
}
async function fetchAdminInboxThreadData(sessionId = '') {
  const normalizedSessionId = String(sessionId || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
  if (!normalizedSessionId) return { sessionId: '', messages: [], detail: null };
  const res = await api(`/api/admin/inbox/${encodeURIComponent(normalizedSessionId)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'โหลดบทสนทนาไม่สำเร็จ');
  return {
    sessionId: String(data?.sessionId || normalizedSessionId).trim().toUpperCase(),
    messages: Array.isArray(data?.messages) ? data.messages : [],
    detail: data?.detail || null,
  };
}
function adminInboxTimeLabel(at = 0) {
  const stamp = Number(at || 0);
  if (!stamp) return '-';
  return new Date(stamp).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
}
function adminInboxConnectionLabel() {
  if (_adminInboxRealtimeReady) return 'Realtime สดผ่าน Supabase';
  if (_adminInboxSocketReady) return 'Realtime สดผ่าน Socket.IO (local)';
  return 'โหมดสำรอง: รีเฟรชอัตโนมัติทุก 12 วินาที';
}
function adminInboxReplyModeLabel(item = {}) {
  if (String(item?.channel || '').trim() !== 'line_oa') return 'คุยผ่านเว็บไซต์';
  return String(item?.replyMode || '').trim() === 'web_room' ? 'คุยต่อในห้องแชตเว็บ' : 'ตอบกลับเข้า LINE OA';
}
function adminInboxChannelBadge(item = {}, kind = 'session') {
  const channel = String(item?.channel || '').trim();
  const label = String(item?.channelLabel || (channel === 'line_oa' ? 'LINE OA' : 'LIVE CHAT')).trim();
  if (!label) return '';
  return `<span class="admin-inbox-channel-badge ${channel === 'line_oa' ? 'is-line' : 'is-web'} ${kind === 'head' ? 'is-head' : ''}">${esc(label)}</span>`;
}
function adminInboxSessionItems(items = [], activeSessionId = '') {
  if (!items.length) return '<div class="admin-inbox-empty muted">ยังไม่มีห้องแชตในระบบ</div>';
  return items.map((item) => {
    const sessionId = String(item?.session_id || '').trim().toUpperCase();
    const active = sessionId === activeSessionId;
    const lastSender = item?.last_sender === 'admin' ? 'แอดมิน' : 'ลูกค้า';
    const countLabel = `${Number(item?.customer_count || 0)} ข้อความลูกค้า · ${Number(item?.admin_count || 0)} ข้อความแอดมิน`;
    const unreadCount = Math.max(0, Number(item?.unreadCount || 0));
    const unreadBadge = unreadCount ? `<span class="admin-inbox-badge" title="ข้อความยังไม่อ่าน">${unreadCount > 99 ? '99+' : unreadCount}<small>ใหม่</small></span>` : '';
    const channelBadge = adminInboxChannelBadge(item);
    const lineUserId = String(item?.lineUserId || '').trim();
    const customerLine = [item?.customerName || '', item?.customerPhone || ''].filter(Boolean).join(' · ');
    const channelHint = [lineUserId ? `LINE ID ${lineUserId.slice(0, 8)}...` : '', adminInboxReplyModeLabel(item)].filter(Boolean).join(' · ');
    const orderLine = item?.order?.id ? `${item.order.id} · ${item.order.statusLabel || item.order.status || ''}` : '';
    const productInterest = String(item?.lastProductName || '').trim();
    return `<div class="admin-inbox-session-row ${active ? 'is-active' : ''}">
      <button class="admin-inbox-session ${active ? 'is-active' : ''} ${unreadCount ? 'has-unread' : ''}" type="button" data-inbox-session="${esc(sessionId)}">
        <div class="admin-inbox-session-top">
          <b>#${esc(sessionId)} ${channelBadge} ${unreadBadge}</b>
          <span>${esc(adminInboxTimeLabel(item?.last_at))}</span>
        </div>
        ${customerLine ? `<div class="admin-inbox-session-customer">${esc(customerLine)}</div>` : ''}
        ${channelHint ? `<div class="admin-inbox-session-channel">${esc(channelHint)}</div>` : ''}
        ${productInterest ? `<div class="admin-inbox-session-channel">สนใจสินค้า: ${esc(productInterest)}</div>` : ''}
        <div class="admin-inbox-session-snippet">${esc(item?.last_text || 'ยังไม่มีข้อความ')}</div>
        <div class="admin-inbox-session-meta"><span>${esc(lastSender)}ล่าสุด</span><small>${esc(countLabel)}</small></div>
        ${orderLine ? `<div class="admin-inbox-session-order">${esc(orderLine)}</div>` : ''}
      </button>
      <button class="btn-mini danger admin-inbox-delete-btn" type="button" data-admin-inbox-delete="${esc(sessionId)}" title="ลบห้องแชตนี้">ลบ</button>
    </div>`;
  }).join('');
}
function adminInboxMessagesMarkup(messages = [], detail = null) {
  if (!messages.length) return '<div class="admin-inbox-empty muted">เลือกห้องแชตเพื่อดูข้อความ และตอบกลับลูกค้าได้ทันที</div>';
  const customerLabel = String(detail?.customerName || '').trim() || (String(detail?.channel || '').trim() === 'line_oa' ? 'ลูกค้า LINE' : 'ลูกค้า');
  return messages.map((message) => {
    const isAdmin = message?.sender === 'admin' || message?.from === 'admin';
    const roleLabel = isAdmin ? (String(detail?.channel || '').trim() === 'line_oa' ? 'บอทตอบกลับ' : 'แอดมิน') : customerLabel;
    return `<article class="admin-inbox-message ${isAdmin ? 'is-admin' : 'is-customer'}">
      <div class="admin-inbox-message-meta"><b>${roleLabel}</b><span>${esc(adminInboxTimeLabel(message?.at))}</span></div>
      <p>${esc(message?.text || '')}</p>
    </article>`;
  }).join('');
}
function adminInboxPager(meta = {}) {
  const page = Math.max(1, Number(meta.page || 1));
  const limit = ADMIN_PAGE_SIZE_OPTIONS.includes(Number(meta.limit)) ? Number(meta.limit) : 20;
  const total = Math.max(0, Number(meta.total || 0));
  const totalPages = Math.max(1, Number(meta.totalPages || Math.ceil(total / Math.max(1, limit)) || 1));
  const start = total ? ((page - 1) * limit) + 1 : 0;
  const end = total ? Math.min(total, page * limit) : 0;
  return `<div class="admin-pager glass">
    <div class="admin-pager-info"><b>ห้องแชต</b><span>${total ? `${start}-${end} จาก ${total}` : '0 ห้อง'}</span></div>
    <div class="admin-pager-actions">
      <label class="admin-limit">ต่อหน้า
        <select data-admin-inbox-limit>
          ${ADMIN_PAGE_SIZE_OPTIONS.map((value) => `<option value="${value}" ${value === limit ? 'selected' : ''}>${value}</option>`).join('')}
        </select>
      </label>
      <span class="admin-page-label">หน้า ${page}/${totalPages}</span>
      <button class="btn-mini" type="button" data-admin-inbox-page="prev" ${page <= 1 ? 'disabled' : ''}>ก่อนหน้า</button>
      <button class="btn-mini" type="button" data-admin-inbox-page="next" ${page >= totalPages ? 'disabled' : ''}>ถัดไป</button>
    </div>
  </div>`;
}
function adminInboxHeadMarkup(activeSession = null, activeSessionId = '') {
  const customerLine = [activeSession?.customerName || activeSession?.detail?.customerName || '', activeSession?.customerPhone || activeSession?.detail?.customerPhone || ''].filter(Boolean).join(' · ');
  const order = activeSession?.order || activeSession?.detail?.order || null;
  const orderLine = order?.id ? `${order.id} · ${order.statusLabel || order.status || ''}${order?.total ? ` · ${baht(order.total)}` : ''}` : '';
  const unreadCount = Math.max(0, Number(activeSession?.unreadCount || 0));
  const unreadPill = unreadCount ? `<span class="admin-inbox-head-badge">${unreadCount > 99 ? '99+' : unreadCount} ข้อความใหม่</span>` : '';
  const channelBadge = activeSession ? adminInboxChannelBadge(activeSession, 'head') : '';
  const lineId = String(activeSession?.lineUserId || '').trim();
  const lineStatusMessage = String(activeSession?.lineStatusMessage || '').trim();
  const productInterest = String(activeSession?.lastProductName || '').trim();
  const replyModeLabel = activeSession ? adminInboxReplyModeLabel(activeSession) : '';
  const helper = activeSession
    ? `ล่าสุด ${adminInboxTimeLabel(activeSession.last_at)}${unreadCount ? ` · ยังไม่อ่าน ${unreadCount}` : ''}`
    : adminInboxConnectionLabel();
  const fullscreen = isAdminInboxFullscreen();
  return `<div class="admin-inbox-head-main">
    <b>${activeSessionId ? `ห้อง #${esc(activeSessionId)}` : 'ยังไม่ได้เลือกห้อง'} ${channelBadge} ${unreadPill}</b>
    <span>${esc(activeSession ? `${Number(activeSession.customer_count || 0)} ข้อความลูกค้า · ${Number(activeSession.admin_count || 0)} ข้อความแอดมิน` : 'รอให้ลูกค้าส่งข้อความเข้ามาก่อน')}</span>
    ${customerLine ? `<span>${esc(customerLine)}</span>` : ''}
    ${replyModeLabel ? `<span>${esc(replyModeLabel)}</span>` : ''}
    ${lineId ? `<span>${esc(`LINE userId: ${lineId}`)}</span>` : ''}
    ${lineStatusMessage ? `<span>${esc(lineStatusMessage)}</span>` : ''}
    ${productInterest ? `<span>${esc(`สินค้าที่สนใจ: ${productInterest}`)}</span>` : ''}
    ${orderLine ? `<span>${esc(orderLine)}</span>` : ''}
  </div>
  <div class="admin-inbox-head-actions">
    <small>${esc(helper)}</small>
    <div class="admin-inbox-head-buttons">
      ${fullscreen ? '<button class="btn-mini" type="button" data-admin-inbox-rooms>ห้องแชต</button>' : ''}
      <button class="btn-mini" type="button" data-admin-inbox-refresh>รีเฟรช</button>
      <button class="btn-mini" type="button" data-admin-inbox-scroll ${activeSessionId ? '' : 'disabled'}>ลงล่าง</button>
      <button class="btn-mini" type="button" data-admin-inbox-fullscreen>${fullscreen ? 'ย่อกลับ' : 'เต็มจอ'}</button>
      ${activeSessionId ? `<button class="btn-mini danger" type="button" data-admin-inbox-delete="${esc(activeSessionId)}">ลบห้องนี้</button>` : ''}
    </div>
  </div>`;
}
async function loadAdminInboxViewData() {
  const listData = await fetchAdminInboxPageData();
  const state = getAdminInboxState();
  let sessionId = state.sessionId;
  if (!sessionId || !listData.items.some((item) => String(item?.session_id || '').trim().toUpperCase() === sessionId)) {
    sessionId = String(listData.items[0]?.session_id || '').trim().toUpperCase();
    setAdminInboxState({ sessionId });
  }
  const threadData = sessionId ? await fetchAdminInboxThreadData(sessionId) : { sessionId: '', messages: [], detail: null };
  setAdminInboxState({ messages: threadData.messages, detail: threadData.detail || null });
  return { listData, threadData };
}
function adminInboxShell(listData = {}, threadData = {}) {
  const state = getAdminInboxState();
  const activeSessionId = threadData.sessionId || state.sessionId || '';
  const activeSession = (listData.items || []).find((item) => String(item?.session_id || '').trim().toUpperCase() === activeSessionId) || null;
  const mergedActiveSession = { ...(activeSession || {}), ...(threadData.detail || {}) };
  return adminLayout('inbox', `<div class="adm-head"><h2>Inbox แชต</h2><span class="muted">${isAdminInboxFullscreen() ? 'โหมดเต็มจอ Luxury สำหรับตอบแชตแบบอ่านง่ายสบายตา' : 'ติดตามห้องแชตจากหน้าเว็บและตอบกลับจากหลังบ้านได้ทันที'}</span></div>
    <form class="admin-filter-bar glass" id="adminInboxSearchForm">
      <input class="admin-filter-input" type="search" name="q" value="${esc(state.q || '')}" placeholder="ค้นหารหัสห้อง หรือข้อความล่าสุด">
      <div class="admin-filter-actions">
        <button class="btn-mini" type="submit">ค้นหา</button>
        <button class="btn-mini" type="button" data-admin-inbox-clear>ล้าง</button>
      </div>
    </form>
    <div id="adminInboxPagerWrap">${adminInboxPager(listData)}</div>
    <div class="admin-inbox-layout${isAdminInboxFullscreen() ? ' is-fullscreen' : ''}">
      <button class="admin-inbox-room-dim" type="button" data-admin-inbox-close-rooms aria-label="ปิดรายชื่อห้อง"></button>
      <aside class="admin-inbox-list glass" id="adminInboxListWrap">${adminInboxSessionItems(listData.items || [], activeSessionId)}</aside>
      <section class="admin-inbox-thread glass">
        <div class="admin-inbox-thread-head" id="adminInboxHeadWrap">${adminInboxHeadMarkup(mergedActiveSession, activeSessionId)}</div>
        <div class="admin-inbox-messages" id="adminInboxMessagesWrap">${adminInboxMessagesMarkup(threadData.messages || [], mergedActiveSession)}</div>
        <form class="admin-inbox-reply" id="adminInboxReplyForm" data-session-id="${esc(activeSessionId)}">
          <textarea name="text" rows="3" placeholder="${activeSessionId ? (String(mergedActiveSession?.channel || '').trim() === 'line_oa'
            ? (String(mergedActiveSession?.replyMode || '').trim() === 'web_room'
              ? `พิมพ์ตอบกลับห้องเว็บของลูกค้า LINE ห้อง #${esc(activeSessionId)}`
              : `ส่งข้อความบอทกลับไปยัง LINE ห้อง #${esc(activeSessionId)}`)
            : `ตอบกลับห้อง #${esc(activeSessionId)} ได้ตรงนี้`) : 'เลือกรหัสห้องก่อนตอบกลับ'}" ${activeSessionId ? '' : 'disabled'}></textarea>
          <div class="admin-inbox-reply-actions">
            <small>${String(mergedActiveSession?.channel || '').trim() === 'line_oa'
              ? (String(mergedActiveSession?.replyMode || '').trim() === 'web_room'
                ? 'ลูกค้าจะเห็นข้อความนี้ในห้องแชตบนเว็บไซต์ทันที โดยไม่ยิงข้อความกลับเข้า LINE OA'
                : 'ข้อความนี้จะถูกส่งกลับไปยังลูกค้าผ่าน LINE OA ในชื่อบอทของร้าน')
              : 'พิมพ์ข้อความแล้วกดส่งตอบกลับได้ทันที'}</small>
            <button class="btn btn-primary" type="submit" ${activeSessionId ? '' : 'disabled'}>ส่งตอบกลับ</button>
          </div>
        </form>
      </section>
    </div>`);
}
function clearAdminInboxPoll() {
  if (_adminInboxPollTimer) {
    clearInterval(_adminInboxPollTimer);
    _adminInboxPollTimer = null;
  }
}
function disconnectAdminInboxSocket() {
  if (_adminInboxSocket) {
    try { _adminInboxSocket.disconnect(); } catch {}
    _adminInboxSocket = null;
  }
  _adminInboxSocketReady = false;
}
function disconnectAdminInboxRealtime() {
  if (_adminInboxRealtimeChannel && _supabaseBrowser) {
    try { _supabaseBrowser.removeChannel(_adminInboxRealtimeChannel); } catch {}
  }
  _adminInboxRealtimeChannel = null;
  _adminInboxRealtimeReady = false;
}
function scrollAdminInboxToBottom(behavior = 'auto') {
  const wrap = document.getElementById('adminInboxMessagesWrap');
  if (!wrap) return;
  wrap.scrollTo({ top: wrap.scrollHeight, behavior });
}
async function refreshAdminInboxDom({ stickBottom = false } = {}) {
  if (currentPath() !== '/admin/inbox') {
    clearAdminInboxPoll();
    return;
  }
  const wrap = document.getElementById('adminInboxMessagesWrap');
  const shouldStick = stickBottom || Boolean(wrap && (wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight) < 80);
  const { listData, threadData } = await loadAdminInboxViewData();
  const activeSessionId = threadData.sessionId || getAdminInboxState().sessionId || '';
  const activeSession = (listData.items || []).find((item) => String(item?.session_id || '').trim().toUpperCase() === activeSessionId) || null;
  const mergedActiveSession = { ...(activeSession || {}), ...(threadData.detail || {}) };
  const listWrap = document.getElementById('adminInboxListWrap');
  const pagerWrap = document.getElementById('adminInboxPagerWrap');
  const headWrap = document.getElementById('adminInboxHeadWrap');
  const messagesWrap = document.getElementById('adminInboxMessagesWrap');
  const replyForm = document.getElementById('adminInboxReplyForm');
  if (listWrap) listWrap.innerHTML = adminInboxSessionItems(listData.items || [], activeSessionId);
  if (pagerWrap) pagerWrap.innerHTML = adminInboxPager(listData);
  if (headWrap) headWrap.innerHTML = adminInboxHeadMarkup(mergedActiveSession, activeSessionId);
  if (messagesWrap) messagesWrap.innerHTML = adminInboxMessagesMarkup(threadData.messages || [], mergedActiveSession);
  if (replyForm) {
    replyForm.dataset.sessionId = activeSessionId;
    const input = replyForm.querySelector('textarea[name=text]');
    const button = replyForm.querySelector('button[type=submit]');
    const helper = replyForm.querySelector('small');
    if (input) {
      input.placeholder = activeSessionId
        ? (String(mergedActiveSession?.channel || '').trim() === 'line_oa'
          ? (String(mergedActiveSession?.replyMode || '').trim() === 'web_room'
            ? `พิมพ์ตอบกลับห้องเว็บของลูกค้า LINE ห้อง #${activeSessionId}`
            : `ส่งข้อความบอทกลับไปยัง LINE ห้อง #${activeSessionId}`)
          : `ตอบกลับห้อง #${activeSessionId} ได้ตรงนี้`)
        : 'เลือกรหัสห้องก่อนตอบกลับ';
      input.disabled = !activeSessionId;
    }
    if (button) button.disabled = !activeSessionId;
    if (helper) {
      helper.textContent = String(mergedActiveSession?.channel || '').trim() === 'line_oa'
        ? (String(mergedActiveSession?.replyMode || '').trim() === 'web_room'
          ? 'ลูกค้าจะเห็นข้อความนี้ในห้องแชตบนเว็บไซต์ทันที โดยไม่ยิงข้อความกลับเข้า LINE OA'
          : 'ข้อความนี้จะถูกส่งกลับไปยังลูกค้าผ่าน LINE OA ในชื่อบอทของร้าน')
        : 'พิมพ์ข้อความแล้วกดส่งตอบกลับได้ทันที';
    }
  }
  _adminInboxUnreadTotal = (listData.items || []).reduce((sum, item) => sum + Math.max(0, Number(item?.unreadCount || 0)), 0);
  updateAdminInboxNavBadges();
  if (shouldStick) requestAnimationFrame(() => scrollAdminInboxToBottom('auto'));
  syncAdminInboxChrome();
}
async function deleteAdminInboxSession(sessionId = '') {
  const normalizedSessionId = String(sessionId || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
  if (!normalizedSessionId) return;
  const state = getAdminInboxState();
  const target = (state.items || []).find((item) => String(item?.session_id || '').trim().toUpperCase() === normalizedSessionId) || null;
  const previewLine = String(target?.last_text || '').trim();
  const ok = await confirmDialog({
    title: 'ยืนยันการลบห้องแชต',
    message: `ต้องการลบห้อง #${normalizedSessionId} ใช่ไหม${previewLine ? `\n\nข้อความล่าสุด: ${previewLine.slice(0, 120)}` : ''}\n\nการลบนี้จะลบประวัติแชตของห้องนี้ออกจากหลังบ้านทันที`,
    confirmText: 'ลบห้องแชต',
    tone: 'danger',
  });
  if (!ok) return;
  const currentPage = state.page;
  const fallbackPage = state.items?.length === 1 && currentPage > 1 ? currentPage - 1 : currentPage;
  const r = await api(`/api/admin/inbox/${encodeURIComponent(normalizedSessionId)}`, { method: 'DELETE' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error || 'ลบห้องแชตไม่สำเร็จ');
  setAdminInboxState({
    page: fallbackPage,
    sessionId: state.sessionId === normalizedSessionId ? '' : state.sessionId,
    messages: state.sessionId === normalizedSessionId ? [] : state.messages,
    detail: state.sessionId === normalizedSessionId ? null : state.detail,
  });
  await refreshAdminInboxSummary().catch(() => {});
  await refreshAdminInboxDom();
  toast(`ลบห้อง #${normalizedSessionId} แล้ว`, 'ok');
}
async function ensureAdminInboxRealtime() {
  if (!chatRealtimeEnabled() || !canAccessAdminInboxClient(currentUser)) return null;
  if (_adminInboxRealtimeChannel) return _adminInboxRealtimeChannel;
  const supabase = await getSupabaseBrowser();
  if (!supabase) return null;
  const channel = supabase.channel('realtime:admin:inbox', { config: { broadcast: { self: false } } });
  channel.on('broadcast', { event: 'inbox_update' }, ({ payload } = {}) => {
    const state = getAdminInboxState();
    const activeSessionId = state.sessionId || '';
    const incomingSessionId = String(payload?.sessionId || '').trim().toUpperCase();
    if (payload?.type === 'customer_message') {
      notifyAdminInbox(
        `แชตใหม่ #${incomingSessionId || 'LIVECHAT'}`,
        incomingSessionId ? `มีข้อความใหม่จากลูกค้าในห้อง #${incomingSessionId}` : 'มีข้อความใหม่จากลูกค้า',
        `${incomingSessionId}:${payload?.at || Date.now()}`,
        incomingSessionId
      );
    }
    refreshAdminInboxSummary().catch(() => {});
    if (currentPath() === '/admin/inbox') {
      refreshAdminInboxDom({ stickBottom: incomingSessionId && incomingSessionId === activeSessionId }).catch(() => {});
    }
  });
  channel.subscribe((status) => {
    _adminInboxRealtimeReady = status === 'SUBSCRIBED';
    if (_adminInboxRealtimeReady) {
      requestInboxNotificationPermission();
      refreshAdminInboxSummary().catch(() => {});
      if (currentPath() === '/admin/inbox') refreshAdminInboxDom().catch(() => {});
    }
  });
  _adminInboxRealtimeChannel = channel;
  return channel;
}
function ensureAdminInboxSocket() {
  if (chatRealtimeEnabled()) return null;
  if (!hasSocketClient() || !canAccessAdminInboxClient(currentUser)) return;
  if (_adminInboxSocket) {
    if (_adminInboxSocket.connected && !_adminInboxSocketReady) _adminInboxSocket.emit('chat:admin:watch', {});
    return;
  }
  _adminInboxSocket = window.io('/', { transports: ['websocket', 'polling'] });
  _adminInboxSocket.on('connect', () => {
    _adminInboxSocketReady = false;
    _adminInboxSocket.emit('chat:admin:watch', {});
  });
  _adminInboxSocket.on('chat:admin:ready', () => {
    _adminInboxSocketReady = true;
    requestInboxNotificationPermission();
    if (currentPath() === '/admin/inbox') refreshAdminInboxDom().catch(() => {});
  });
  _adminInboxSocket.on('chat:admin:update', (payload = {}) => {
    const state = getAdminInboxState();
    const activeSessionId = state.sessionId || '';
    const incomingSessionId = String(payload?.sessionId || '').trim().toUpperCase();
    if (payload?.type === 'customer_message') {
      notifyAdminInbox(
        `แชตใหม่ #${incomingSessionId || 'LIVECHAT'}`,
        String(payload?.text || 'มีข้อความใหม่จากลูกค้า').trim().slice(0, 120),
        `${incomingSessionId}:${payload?.at || Date.now()}`,
        incomingSessionId
      );
    }
    refreshAdminInboxSummary().catch(() => {});
    if (currentPath() === '/admin/inbox') refreshAdminInboxDom({ stickBottom: incomingSessionId && incomingSessionId === activeSessionId }).catch(() => {});
  });
  _adminInboxSocket.on('chat:admin:error', () => { _adminInboxSocketReady = false; });
  _adminInboxSocket.on('disconnect', () => { _adminInboxSocketReady = false; });
}
function stopAdminInboxNotifier() {
  clearAdminInboxPoll();
  if (_adminInboxSummaryTimer) {
    clearInterval(_adminInboxSummaryTimer);
    _adminInboxSummaryTimer = null;
  }
  disconnectAdminInboxSocket();
  disconnectAdminInboxRealtime();
  _adminInboxUnreadTotal = 0;
  updateAdminInboxNavBadges();
}
function initAdminInboxLive() {
  clearAdminInboxPoll();
  if (!canAccessAdminInboxClient(currentUser)) {
    stopAdminInboxNotifier();
    return;
  }
  ensureAdminInboxRealtime().catch(() => {});
  ensureAdminInboxSocket();
  refreshAdminInboxSummary().catch(() => {});
  if (!_adminInboxSummaryTimer) {
    _adminInboxSummaryTimer = setInterval(() => {
      refreshAdminInboxSummary().catch(() => {});
    }, 15000);
  }
  if (currentPath() !== '/admin/inbox') return;
  requestAnimationFrame(() => scrollAdminInboxToBottom('auto'));
  _adminInboxPollTimer = setInterval(() => {
    refreshAdminInboxDom().catch(() => {});
  }, 12000);
}
function areaChart(series, key = 'revenue') {
  const w = 600, h = 170, pad = 10;
  const vals = series.map((s) => s[key]);
  const max = Math.max(1, ...vals);
  const n = series.length;
  const pts = series.map((s, i) => [pad + i * (w - 2 * pad) / Math.max(1, n - 1), h - pad - (s[key] / max) * (h - 2 * pad)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = `${line} L ${pts[n - 1][0].toFixed(1)} ${h - pad} L ${pts[0][0].toFixed(1)} ${h - pad} Z`;
  const grid = [0.25, 0.5, 0.75].map((g) => `<line x1="${pad}" y1="${(h - pad) - g * (h - 2 * pad)}" x2="${w - pad}" y2="${(h - pad) - g * (h - 2 * pad)}" class="grid-l"/>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="chart">
    <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    ${grid}<path d="${area}" fill="url(#ag)"/><path d="${line}" fill="none" stroke="var(--accent)" stroke-width="1.6"/>
    ${pts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2" fill="var(--accent)"/>`).join('')}
  </svg>`;
}
function barRows(items, labelKey, valKey, fmt = (v) => v) {
  const max = Math.max(1, ...items.map((x) => x[valKey]));
  return items.map((x) => `<div class="bar-row"><span class="bar-lbl">${x[labelKey]}</span><div class="bar"><i style="width:${(x[valKey] / max * 100).toFixed(0)}%"></i></div><b>${fmt(x[valKey])}</b></div>`).join('');
}
async function viewAdminDash() {
  if (!adminGuard()) return loadingView();
  await ensureAdminStoresContext();
  const a = await (await api('/api/admin/analytics?days=30')).json();
  const s = await (await api('/api/admin/stats')).json();
  const dashProducts = await (await api('/api/admin/products')).json().catch(() => []);
  const dashOrdersData = await (await api('/api/admin/orders?limit=8')).json().catch(() => ({ items: [] }));
  const t = a.totals;
  const tiles = `<div class="stat-cards">
    <div class="stat-card"><span>ยอดขายรวม</span><b>${baht(t.revenue)}</b></div>
    <div class="stat-card"><span>ออเดอร์</span><b>${t.orders}</b></div>
    <div class="stat-card"><span>เฉลี่ย/ออเดอร์</span><b>${baht(t.aov)}</b></div>
    <div class="stat-card"><span>ส่วนลดที่ให้</span><b>${baht(t.discountGiven)}</b></div>
    <div class="stat-card"><span>ลีดจากเว็บ</span><b>${s.leads || 0}</b></div></div>`;
  const payItems = [{ label: 'PromptPay', n: a.payment.promptpay }, { label: 'บัตรเครดิต', n: a.payment.card }];
  const status = Object.entries(a.statusBreakdown).map(([k, v]) => `<span class="chip">${a.statusLabels[k] || k} · ${v}</span>`).join('') || '<span class="muted">—</span>';
  const top = a.topProducts.length ? barRows(a.topProducts, 'name', 'qty', (v) => v + ' ชิ้น') : '<p class="muted">ยังไม่มีข้อมูล</p>';
  const growthItems = [
    t.orders ? 'ติดตามออเดอร์รอชำระและหมดเวลาชำระ เพื่อกู้ยอดขายกลับมา' : 'เพิ่มสินค้าเด่นและทดสอบสั่งซื้อจริง 1 ออเดอร์',
    s.leads ? `มีลีด ${s.leads} รายการ ควร follow-up ผ่าน Inbox/LINE ภายในวันนี้` : 'เพิ่ม CTA ขอคำปรึกษาในหน้าแรกเพื่อเก็บลีดเพิ่ม',
    a.topProducts.length ? `ดันสินค้าขายดี "${a.topProducts[0].name}" เป็นสินค้าแนะนำหน้าแรก` : 'ยังไม่มีสินค้าขายดีชัดเจน ให้จัดชุดโปรโมชันเริ่มต้น',
    t.aov ? `AOV ปัจจุบัน ${baht(t.aov)} ใช้ bundle/recommendation เพื่อเพิ่มมูลค่าต่อออเดอร์` : 'เปิดคูปองหรือชุดเซตเพื่อเริ่มเก็บข้อมูล AOV',
  ];
  const lowStockProducts = (Array.isArray(dashProducts) ? dashProducts : [])
    .filter((p) => p.active !== false && Number(p.stock || 0) <= 5)
    .sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0))
    .slice(0, 6);
  const lowStock = lowStockProducts.length
    ? `<div class="stock-watch-list">${lowStockProducts.map((p) => `<a href="${routeHref('/admin/products')}" class="stock-watch-item"><b>${esc(productCardName(p))}</b><span>${Number(p.stock || 0) <= 0 ? 'หมดสต็อก' : `เหลือ ${Number(p.stock || 0)} ชิ้น`}</span></a>`).join('')}</div>`
    : '<p class="muted">ยังไม่มีสินค้าที่ต้องเตือนสต็อกต่ำ</p>';
  const workOrders = asArray(dashOrdersData.items).filter((order) => ['awaiting_payment', 'paid', 'preparing', 'shipped'].includes(order.status)).slice(0, 5);
  const todayWork = workOrders.length
    ? `<div class="today-work-list">${workOrders.map((order) => {
      const priority = orderPriority(order);
      return `<a href="${routeHref('/admin/order/' + order.id)}"><span class="priority-pill ${priority.tone}">${esc(priority.label)}</span><b>${esc(order.id)}</b><small>${esc(order.customerName || '-')} · ${baht(order.total)}</small></a>`;
    }).join('')}</div>`
    : '<p class="muted">ยังไม่มีออเดอร์ที่ต้องจัดการเร่งด่วน</p>';
  return adminLayout('', `<h2>แดชบอร์ด</h2>${tiles}
    <div class="dash-card"><div class="dash-head"><h3>ยอดขาย 30 วันล่าสุด</h3><span class="muted">รวม ${baht(t.revenue)} · ${t.paidOrders} ออเดอร์ที่ชำระแล้ว</span></div>${areaChart(a.series)}</div>
    <div class="dash-card growth-card"><div class="dash-head"><h3>Growth checklist</h3><span class="muted">สิ่งที่ควรทำต่อเพื่อเพิ่มยอดขาย</span></div><div class="growth-list">${growthItems.map((item) => `<label><input type="checkbox"> <span>${esc(item)}</span></label>`).join('')}</div></div>
    <div class="dash-card today-work"><div class="dash-head"><h3>วันนี้ต้องทำอะไร</h3><span class="muted">คิวงานออเดอร์ที่ควรเคลียร์ก่อน</span></div>${todayWork}</div>
    <div class="dash-grid">
      <div class="dash-card stock-watch"><div class="dash-head"><h3>Low stock watch</h3><span class="muted">สินค้าที่ควรเติมหรือซ่อนก่อนลูกค้าสั่ง</span></div>${lowStock}</div>
      <div class="dash-card admin-quick-actions"><div class="dash-head"><h3>Quick actions</h3><span class="muted">ทางลัดสำหรับทำให้ร้านพร้อมขาย</span></div>
        <a href="${routeHref('/admin/products')}">จัดการสินค้า / เติมสต็อก</a>
        <a href="${routeHref('/admin/site')}">แก้ Hero และข้อมูลร้าน</a>
        <a href="${routeHref('/admin/coupons')}">สร้างคูปองกระตุ้นยอด</a>
        <a href="${routeHref('/admin/inbox')}">ตอบ Inbox ลูกค้า</a>
      </div>
    </div>
    <div class="dash-grid">
      <div class="dash-card"><h3>ช่องทางชำระเงิน</h3>${barRows(payItems, 'label', 'n')}</div>
      <div class="dash-card"><h3>สินค้าขายดี</h3>${top}</div>
    </div>
    <div class="dash-card"><h3>สถานะออเดอร์</h3><div class="chips">${status}</div></div>`);
}

let _adminProducts = [];
let _adminSelectedProductIds = new Set();
function adminProductPriceSummary(p) {
  const current = productCurrentPriceValue(p);
  const compare = productComparePriceValue(p);
  const percent = productDiscountPercent(p);
  if (compare > current) return `${baht(compare)} → ${baht(current)} · ลด ${percent}%`;
  return baht(current);
}
function productForm(p) {
  const e = p || { specs: {}, extra: {}, segment: 'agri' };
  const extra = productExtra(e);
  const specsText = Object.entries(e.specs || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
  const faqText = faqItems(extra).map((item) => `${item.q} :: ${item.a}`).join('\n');
  const dosageText = productDosageText(e);
  const icons = ['sprout', 'leaf', 'drop', 'bottle', 'shieldleaf', 'herb', 'health', 'soap'];
  const categories = managedProductCategories([productCategory(e)], _adminProducts.length ? _adminProducts : PRODUCTS);
  const selectedCategory = productCategory(e) || categories[0] || '';
  const categoryOptions = categories.length
    ? categories.map((item) => `<option value="${esc(item)}" ${item === selectedCategory ? 'selected' : ''}>${esc(displayProductCategoryLabel(item))}</option>`).join('')
    : '<option value="">ยังไม่กำหนดหมวดหมู่</option>';
  return `<form id="productForm" class="prod-form glass">
    <input type="hidden" name="id" value="${e.id || ''}">
    <input type="hidden" name="existingExtra" value="${esc(JSON.stringify(extra || {}))}">
    <div class="pf-grid">
      <label>ชื่อสินค้า<input name="name" required value="${e.name || ''}"></label>
      <label>กลุ่มแบรนด์<select name="segment"><option value="agri" ${productSegment(e) === 'agri' ? 'selected' : ''}>สินค้าเกษตร</option><option value="lifestyle" ${productSegment(e) === 'lifestyle' ? 'selected' : ''}>สุขภาพ/ความงาม</option></select></label>
      <label>หมวดหมู่<select name="category">${categoryOptions}</select></label>
      <label>ป้ายโปรโมชัน (tag)<input name="tag" value="${e.tag || ''}" placeholder="เช่น แพ็กคู่ / แพ็กสุดคุ้ม / โปรแรง"></label>
      <label>ป้ายหน้าเว็บ<input name="marketingBadge" value="${esc(productMarketingBadge(e))}" placeholder="เช่น ขายดี / แนะนำ / พร้อมส่ง"></label>
      <label>ชื่อสั้นบนการ์ด<input name="cardName" value="${esc(extra.cardName || '')}" placeholder="เว้นว่างเพื่อใช้ชื่อสินค้าหลัก"></label>
      <label>ราคาหลัก (บาท)<input name="price" type="number" required value="${e.price || ''}"></label>
      <label>ราคาเทียบอีกฝั่ง (บาท)<input name="salePrice" type="number" min="0" value="${parseInt(e?.salePrice ?? extra.salePrice ?? extra.comparePrice ?? 0, 10) || ''}" placeholder="ใส่อีกราคาเพื่อให้ระบบคำนวณก่อนลด/หลังลดอัตโนมัติ"></label>
      <label>สต็อก<input name="stock" type="number" value="${e.stock ?? 0}"></label>
      <label>ลำดับขึ้นก่อน<input name="sort" type="number" value="${productSortValue(e)}" placeholder="0"></label>
      <label>ไอคอน (ถ้าไม่อัปโหลดรูป)<select name="icon">${icons.map((i) => `<option value="${i}" ${e.icon === i ? 'selected' : ''}>${i}</option>`).join('')}</select></label>
      <label class="pf-check"><input type="checkbox" name="active" ${e.active === false ? '' : 'checked'}> เปิดขาย</label>
      <label class="pf-check"><input type="checkbox" name="featured" ${productIsFeatured(e) ? 'checked' : ''}> สินค้าแนะนำ</label>
    </div>
    <p class="form-note">ใส่ราคา 2 ช่องเมื่อมีการลดราคา ระบบจะจับเองว่าเลขไหนเป็นราคาก่อนลดและเลขไหนเป็นราคาที่ขายจริง จากนั้นคำนวณ % ลดให้อัตโนมัติ พร้อมใช้ลำดับขึ้นก่อนภายในกลุ่มสินค้า</p>
    <label>คำโปรย (สั้น)<input name="short" value="${e.short || ''}"></label>
    <label>รายละเอียด<textarea name="desc" rows="3">${e.desc || ''}</textarea></label>
    <label>จุดขายบนหน้าเว็บ (บรรทัดละ 1 ข้อ)<textarea name="sellingPoints" rows="3" placeholder="เช่น พร้อมส่ง / เหมาะกับลูกค้าใหม่ / ทีมช่วยแนะนำก่อนซื้อ">${esc(asArray(extra.sellingPoints).join('\n'))}</textarea></label>
    <div class="pf-grid">
      <label>SEO Title<input name="seoTitle" value="${esc(extra.seoTitle || '')}" placeholder="เว้นว่างเพื่อใช้ชื่อสินค้า"></label>
      <label>SEO Description<input name="seoDescription" value="${esc(extra.seoDescription || '')}" placeholder="เว้นว่างเพื่อใช้คำโปรยสินค้า"></label>
    </div>
    <label>สเปก (บรรทัดละ "หัวข้อ: ค่า")<textarea name="specs" rows="4" placeholder="กำลังไฟ: 80W">${specsText}</textarea></label>
    <label>รูปสินค้า (อัปโหลดรูปจริงได้)<input name="image" type="file" accept="image/*"></label>
    <input type="hidden" name="existingImage" value="${esc(e.image || '')}">
    <div class="pf-media-stack" data-product-image-draft></div>
    <label>วิดีโอสินค้า (วาง URL .mp4 หรือ /uploads/...)<input name="video" value="${esc(e.video || '')}" placeholder="https://…/clip.mp4"></label>
    <label>รูปเพิ่มเติม — แกลเลอรี (เลือกได้หลายไฟล์)<input name="images" type="file" accept="image/*" multiple></label>
    <input type="hidden" name="existingImages" value="${esc(JSON.stringify(e.images || []))}">
    <div class="pf-media-stack" data-product-gallery-draft></div>
    <label>โมเดล 3D (URL .glb / .gltf) — หมุนดู 360°<input name="model" value="${esc(e.model || '')}" placeholder="https://…/model.glb"></label>
    <h3 class="set-group">ข้อมูลมาตรฐานสินค้าเกษตร / เอกสาร</h3>
    <div class="pf-grid">
      <label>เลขทะเบียน / อ้างอิง<input name="registrationNo" value="${esc(extra.registrationNo || '')}" placeholder="เช่น รออัปเดตเลขทะเบียน"></label>
      <label>พืชที่เหมาะ (คั่นด้วย comma)<input name="cropTargets" value="${esc(asArray(extra.cropTargets).join(', '))}" placeholder="ทุเรียน, มะม่วง, ข้าว"></label>
      <label>รูปแบบการใช้<input name="applicationMethod" value="${esc(extra.applicationMethod || '')}" placeholder="ฉีดพ่นทางใบ"></label>
      <label>อัตราแนะนำ<input name="dosage" value="${esc(dosageText)}" placeholder="5 ซีซี ต่อน้ำ 20 ลิตร"></label>
    </div>
    <label>คำอธิบายฉลาก / หมายเหตุ<input name="labelNote" value="${esc(extra.labelNote || '')}" placeholder="ควรอ่านฉลากก่อนใช้ทุกครั้ง"></label>
    <label>ไฟล์ฉลาก / PDF / รูป<input name="labelFile" type="file" accept="image/*,.pdf,application/pdf"></label>
    ${extra.labelUrl ? `<div class="pf-file"><a href="${esc(extra.labelUrl)}" target="_blank" rel="noopener">เปิดไฟล์ฉลากปัจจุบัน</a></div>` : ''}
    <label>ขั้นตอนวิธีใช้ (บรรทัดละ 1 ขั้นตอน)<textarea name="usageSteps" rows="4">${esc(asArray(extra.usageSteps).join('\n'))}</textarea></label>
    <label>คำเตือน / ข้อควรระวัง (บรรทัดละ 1 ข้อ)<textarea name="warnings" rows="4">${esc(asArray(extra.warnings).join('\n'))}</textarea></label>
    <label>FAQ (บรรทัดละ "คำถาม :: คำตอบ")<textarea name="faq" rows="4" placeholder="ใช้ร่วมกับสารจับใบได้ไหม? :: ใช้ได้">${esc(faqText)}</textarea></label>
    <div class="pf-actions"><button class="btn btn-primary" type="button" data-save-product>${e.id ? 'บันทึกการแก้ไข' : 'เพิ่มสินค้า'}</button><button class="btn btn-glass" type="button" id="cancelProd">ยกเลิก</button></div>
  </form>`;
}
async function viewAdminProducts() {
  if (!adminGuard()) return loadingView();
  await ensureAdminStoresContext();
  _adminProducts = await (await api('/api/admin/products')).json();
  _adminSelectedProductIds = new Set([..._adminSelectedProductIds].filter((id) => _adminProducts.some((item) => item.id === id)));
  const activeCount = _adminProducts.filter((p) => p.active !== false).length;
  const hiddenCount = _adminProducts.length - activeCount;
  const categoryList = configuredProductCategories();
  const orphanList = orphanProductCategories(_adminProducts);
  const bulkCategoryOptions = categoryList.map((item) => `<option value="${esc(item)}">${esc(displayProductCategoryLabel(item))}</option>`).join('');
  const bulkManager = `<div class="category-bulk glass">
    <div class="category-bulk-head">
      <div><b>ย้ายหมวดหมู่หลายรายการ</b><span>เลือกสินค้าหลายตัว แล้วเปลี่ยนหมวดได้ในครั้งเดียว หมวดหลักแนะนำคือ สินค้าเดี่ยว / ชุดเซต / โปรโมชั่น</span></div>
      <span class="category-admin-count" id="adminBulkSelectionCount">เลือกแล้ว ${_adminSelectedProductIds.size} รายการ</span>
    </div>
    <div class="category-bulk-grid">
      <label class="pf-check"><input type="checkbox" id="adminSelectAllProducts" ${_adminProducts.length && _adminSelectedProductIds.size === _adminProducts.length ? 'checked' : ''}> เลือกทั้งหมด</label>
      <label>ย้ายไปหมวดหมู่
        <select id="adminBulkCategorySelect">
          <option value="">เลือกหมวดหมู่ปลายทาง</option>
          ${bulkCategoryOptions}
        </select>
      </label>
      <div class="category-bulk-actions">
        <button class="btn btn-glass" type="button" id="clearProductSelectionBtn">ล้างรายการเลือก</button>
        <button class="btn btn-primary" type="button" id="applyBulkCategoryBtn">ย้ายหมวดหมู่ที่เลือก</button>
      </div>
    </div>
  </div>`;
  const categoryManageOptions = categoryList.map((item) => `<option value="${esc(item)}">${esc(displayProductCategoryLabel(item))}</option>`).join('');
  const categoryManager = `<div class="category-admin glass">
    <textarea id="adminProductCategoriesData" hidden>${esc(serializeProductCategories(categoryList))}</textarea>
    <div class="category-admin-head">
      <div><b>หมวดหมู่สินค้า</b><span>หมวดหมู่หลักใช้สำหรับกรองสินค้าบนหน้าเว็บ ส่วน tag โปรโมชันใช้ไว้ติดป้ายอย่าง แพ็กคู่ / แพ็กสุดคุ้ม / โปรแรง</span></div>
      <span class="category-admin-count" id="adminProductCategoryCount">${categoryList.length} หมวดหมู่</span>
    </div>
    <div class="category-admin-create">
      <input id="adminProductCategoryInput" type="text" placeholder="เพิ่มหมวดหมู่ใหม่ เช่น สินค้าเดี่ยว / ชุดเซต / โปรโมชั่น">
      <button class="btn btn-glass" type="button" id="addProductCategoryBtn">+ เพิ่มหมวดหมู่</button>
    </div>
    <div class="category-merge-box">
      <div class="category-merge-head"><b>รวม / เปลี่ยนชื่อหมวดอัตโนมัติ</b><span>เลือกหมวดต้นทางแล้วรวมเข้าหมวดที่มีอยู่ หรือเปลี่ยนชื่อหมวดทั้งระบบในครั้งเดียว</span></div>
      <div class="category-merge-grid">
        <label>หมวดต้นทาง
          <select id="adminCategorySourceSelect">
            <option value="">เลือกหมวดหมู่ต้นทาง</option>
            ${categoryManageOptions}
          </select>
        </label>
        <label>รวมเข้าหมวด
          <select id="adminCategoryTargetSelect">
            <option value="">เลือกหมวดหมู่ปลายทาง</option>
            ${categoryManageOptions}
          </select>
        </label>
        <label>เปลี่ยนชื่อเป็น
          <input id="adminCategoryRenameInput" type="text" placeholder="เช่น ชุดเซตพิเศษ">
        </label>
        <div class="category-merge-actions">
          <button class="btn btn-glass" type="button" id="mergeProductCategoryBtn">รวมหมวด</button>
          <button class="btn btn-primary" type="button" id="renameProductCategoryBtn">เปลี่ยนชื่อหมวด</button>
        </div>
      </div>
    </div>
    <div class="category-chip-list" id="adminProductCategoryList">${renderProductCategoryManagerItems(categoryList, _adminProducts)}</div>
    ${orphanList.length ? `<div class="category-admin-legacy"><p class="form-note">พบหมวดหมู่ตกค้างในสินค้าเก่า รายการด้านล่างจะไม่โชว์เป็นชิปบนหน้าสินค้าแล้ว แต่ยังต้องเข้าไปแก้ในสินค้าแต่ละตัวหากต้องการล้างข้อมูลให้สะอาด</p><div class="category-chip-list">${renderOrphanProductCategoryItems(orphanList, _adminProducts)}</div></div>` : ''}
    <div class="pf-actions"><button class="btn btn-primary" type="button" id="saveProductCategoriesBtn">บันทึกหมวดหมู่</button></div>
  </div>`;
  const rows = _adminProducts.map((p, index) => `<div class="adm-prod ${_adminSelectedProductIds.has(p.id) ? 'is-selected' : ''}">
    <label class="adm-prod-select"><input type="checkbox" data-selectprod="${p.id}" ${_adminSelectedProductIds.has(p.id) ? 'checked' : ''}><span></span></label>
    <div class="adm-prod-img">${p.image ? `<img src="${p.image}">` : icon(p.icon || 'pod')}</div>
    <div class="adm-prod-info"><b>${p.name}</b><span class="muted">ลำดับ ${productSortValue(p)} · ${SEGMENT_INFO[productSegment(p)]?.label || '-'}${productCategory(p) ? ' · หมวด ' + esc(displayProductCategoryLabel(productCategory(p))) : ''}${productPromoTag(p) ? ' · ป้าย ' + esc(productPromoTag(p)) : ''}${productMarketingBadge(p) ? ' · Badge ' + esc(productMarketingBadge(p)) : ''}${productIsFeatured(p) ? ' · แนะนำ' : ''}${asArray(p.images).length ? ' · Gallery ' + asArray(p.images).length : ''} · ${adminProductPriceSummary(p)} · สต็อก ${p.stock}${p.active ? '' : ' · <span style="color:#ff7ab3">ปิดขาย</span>'}</span></div>
    <div class="adm-prod-act"><button class="btn-mini" type="button" data-moveprod="${p.id}" data-direction="up" ${index === 0 ? 'disabled' : ''}>เลื่อนขึ้น</button><button class="btn-mini" type="button" data-moveprod="${p.id}" data-direction="down" ${index === _adminProducts.length - 1 ? 'disabled' : ''}>เลื่อนลง</button><button class="btn-mini ${p.active === false ? 'is-confirm' : ''}" type="button" data-toggleprodactive="${p.id}">${p.active === false ? 'เปิดขาย' : 'ซ่อน'}</button><button class="btn-mini" type="button" data-editprod="${p.id}">แก้ไข</button><button class="btn-mini danger" type="button" data-delprod="${p.id}">ลบ</button></div>
  </div>`).join('');
  const visibilitySummary = `<div class="stat-cards">
    <div class="stat-card"><span>สินค้าทั้งหมด</span><b>${_adminProducts.length}</b></div>
    <div class="stat-card"><span>แสดงบนหน้าเว็บ</span><b>${activeCount}</b></div>
    <div class="stat-card"><span>ซ่อนอยู่</span><b>${hiddenCount}</b></div>
  </div>
  <div class="form-note" style="margin:-8px 0 18px">หน้าสินค้าในเว็บแสดงเฉพาะรายการที่เปิดขายเท่านั้น ถ้าสินค้าหายจากหน้าสินค้า ให้ตรวจปุ่ม "ซ่อน / เปิดขาย" ในรายการนี้ได้ทันที</div>`;
  return adminLayout('products', `<div class="admin-workspace admin-products-ui"><div class="adm-head admin-lux-head"><div><span class="eyebrow">Product Command</span><h2>จัดการสินค้า</h2><p class="muted">จัดลำดับ เพิ่ม/แก้ไขสินค้า ย้ายหมวด และควบคุมการแสดงผลของร้านที่เลือกไว้</p></div><div class="admin-inline-actions"><button class="btn btn-glass" type="button" data-export-products>Export CSV</button><button class="btn btn-primary" id="addProdBtn">+ เพิ่มสินค้า</button></div></div>
    ${visibilitySummary}
    ${bulkManager}
    ${categoryManager}
    <div id="prodFormWrap"></div>
    <div class="adm-list admin-product-list">${rows}</div></div>`);
}
function currentProductCategories() {
  const hidden = document.getElementById('adminProductCategoriesData');
  return parseProductCategories(hidden?.value || '');
}
function syncAdminProductSelectionUI() {
  const count = document.getElementById('adminBulkSelectionCount');
  if (count) count.textContent = `เลือกแล้ว ${_adminSelectedProductIds.size} รายการ`;
  const selectAll = document.getElementById('adminSelectAllProducts');
  if (selectAll) {
    selectAll.checked = Boolean(_adminProducts.length) && _adminSelectedProductIds.size === _adminProducts.length;
    selectAll.indeterminate = _adminSelectedProductIds.size > 0 && _adminSelectedProductIds.size < _adminProducts.length;
  }
  document.querySelectorAll('[data-selectprod]').forEach((input) => {
    const checked = _adminSelectedProductIds.has(input.dataset.selectprod);
    input.checked = checked;
    input.closest('.adm-prod')?.classList.toggle('is-selected', checked);
  });
}
async function persistAdminProductOrder(products = _adminProducts) {
  const next = [...(Array.isArray(products) ? products : [])].map((item, index) => ({ ...item, sort: (index + 1) * 10 }));
  const changed = next.filter((item, index) => productSortValue(_adminProducts[index]) !== item.sort || _adminProducts[index]?.id !== item.id);
  for (const item of changed) {
    const r = await api('/api/admin/products/' + item.id, { method: 'PUT', body: JSON.stringify({ sort: item.sort }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `อัปเดตลำดับสินค้า ${item.name || item.id} ไม่สำเร็จ`);
  }
  _adminProducts = next;
  return next;
}
async function moveAdminProduct(productId, direction = 'up') {
  const currentIndex = _adminProducts.findIndex((item) => item.id === productId);
  if (currentIndex < 0) return;
  const targetIndex = direction === 'down' ? currentIndex + 1 : currentIndex - 1;
  if (targetIndex < 0 || targetIndex >= _adminProducts.length) return;
  const next = [..._adminProducts];
  const [current] = next.splice(currentIndex, 1);
  next.splice(targetIndex, 0, current);
  await persistAdminProductOrder(next);
}
function productCategoryUsageMap(products = _adminProducts) {
  const usage = {};
  for (const item of Array.isArray(products) ? products : []) {
    const category = storedProductCategory(item) || productCategory(item);
    if (!category) continue;
    usage[category] = (usage[category] || 0) + 1;
  }
  return usage;
}
function renderProductCategoryManagerItems(categories, products = _adminProducts) {
  const usage = productCategoryUsageMap(products);
  const list = parseProductCategories(categories);
  if (!list.length) return '<p class="form-note">ยังไม่มีหมวดหมู่สินค้า</p>';
  return list.map((item) => {
    const count = usage[item] || 0;
    const label = displayProductCategoryLabel(item);
    const hint = productCategoryHint(item);
    return `<div class="category-item ${count ? 'is-used' : ''}">
      <div class="category-item-copy"><b>${esc(label)}</b><span>${count ? `ใช้กับ ${count} สินค้า` : 'ยังไม่ถูกใช้ในสินค้า'}${hint ? ` · ${esc(hint)}` : ''}</span></div>
      <button class="btn-mini" type="button" data-removecategory="${esc(item)}">${count ? 'ลบไม่ได้' : 'ลบ'}</button>
    </div>`;
  }).join('');
}
function renderOrphanProductCategoryItems(categories, products = _adminProducts) {
  const usage = productCategoryUsageMap(products);
  return parseProductCategories(categories).map((item) => `<div class="category-item is-legacy">
    <div class="category-item-copy"><b>${esc(displayProductCategoryLabel(item))}</b><span>ตกค้างใน ${usage[item] || 0} สินค้า · ยังไม่อยู่ในหมวดหมู่หลัก</span></div>
    <span class="category-item-state">ต้องแก้ในสินค้า</span>
  </div>`).join('');
}
function syncProductCategoryManager(list) {
  const categories = parseProductCategories(list);
  const hidden = document.getElementById('adminProductCategoriesData');
  const wrap = document.getElementById('adminProductCategoryList');
  const count = document.getElementById('adminProductCategoryCount');
  if (hidden) hidden.value = serializeProductCategories(categories);
  if (wrap) wrap.innerHTML = renderProductCategoryManagerItems(categories, _adminProducts);
  if (count) count.textContent = `${categories.length} หมวดหมู่`;
  const selectMarkup = `<option value="">เลือกหมวดหมู่</option>${categories.map((item) => `<option value="${esc(item)}">${esc(displayProductCategoryLabel(item))}</option>`).join('')}`;
  ['adminCategorySourceSelect', 'adminCategoryTargetSelect'].forEach((id) => {
    const select = document.getElementById(id);
    if (!select) return;
    const prev = select.value;
    select.innerHTML = selectMarkup;
    if (categories.includes(prev)) select.value = prev;
  });
}
function selectedAdminCategorySource() {
  return normalizeProductCategoryLabel(document.getElementById('adminCategorySourceSelect')?.value || '');
}
function selectedAdminCategoryTarget() {
  return normalizeProductCategoryLabel(document.getElementById('adminCategoryTargetSelect')?.value || '');
}
function typedAdminCategoryRename() {
  return normalizeProductCategoryLabel(document.getElementById('adminCategoryRenameInput')?.value || '');
}
function selectedCategoryUsage(value = '') {
  const category = normalizeProductCategoryLabel(value);
  if (!category) return 0;
  return productCategoryUsageMap(_adminProducts)[category] || 0;
}
async function applyAdminCategoryTransform({ mode = 'merge', triggerButton = null } = {}) {
  const sourceCategory = selectedAdminCategorySource();
  const targetCategory = mode === 'rename' ? typedAdminCategoryRename() : selectedAdminCategoryTarget();
  if (!sourceCategory) { toast('กรุณาเลือกหมวดหมู่ต้นทาง', 'err'); return; }
  if (!targetCategory) {
    toast(mode === 'rename' ? 'กรุณากรอกชื่อหมวดหมู่ใหม่' : 'กรุณาเลือกหมวดหมู่ปลายทาง', 'err');
    return;
  }
  if (sourceCategory === targetCategory) {
    toast(mode === 'rename' ? 'ชื่อหมวดใหม่ต้องไม่ซ้ำกับชื่อเดิม' : 'หมวดต้นทางและปลายทางต้องไม่ซ้ำกัน', 'err');
    return;
  }
  const usage = selectedCategoryUsage(sourceCategory);
  const ok = await confirmDialog({
    title: mode === 'rename' ? 'ยืนยันการเปลี่ยนชื่อหมวด' : 'ยืนยันการรวมหมวด',
    message: mode === 'rename'
      ? `ต้องการเปลี่ยนชื่อหมวด "${displayProductCategoryLabel(sourceCategory)}" เป็น "${displayProductCategoryLabel(targetCategory)}" และอัปเดตสินค้า ${usage} รายการใช่ไหม`
      : `ต้องการรวมหมวด "${displayProductCategoryLabel(sourceCategory)}" เข้ากับ "${displayProductCategoryLabel(targetCategory)}" และย้ายสินค้า ${usage} รายการอัตโนมัติใช่ไหม`,
    confirmText: mode === 'rename' ? 'เปลี่ยนชื่อหมวด' : 'รวมหมวด',
  });
  if (!ok) return;
  if (triggerButton) triggerButton.disabled = true;
  try {
    const r = await api('/api/admin/product-categories/merge', {
      method: 'POST',
      body: JSON.stringify({ sourceCategory, targetCategory, mode }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'จัดการหมวดหมู่ไม่สำเร็จ');
    SITE = { ...SITE, SITE_PRODUCT_CATEGORIES: serializeProductCategories(d.categories || []) };
    localStorage.setItem(SITE_SYNC_KEY, String(Date.now()));
    siteSyncChannel?.postMessage({ type: 'site-updated', at: Date.now() });
    await loadSite(routeNeedsHeavySiteData() || _siteHeavyLoaded);
    applySite();
    toast(mode === 'rename'
      ? `เปลี่ยนชื่อหมวดและอัปเดตสินค้า ${d.updatedProducts || 0} รายการแล้ว`
      : `รวมหมวดและอัปเดตสินค้า ${d.updatedProducts || 0} รายการแล้ว`, 'ok');
    render();
  } catch (err) {
    toast(err.message || 'จัดการหมวดหมู่ไม่สำเร็จ', 'err');
    if (triggerButton) triggerButton.disabled = false;
  }
}
function addProductCategoryValue(raw = '') {
  const input = document.getElementById('adminProductCategoryInput');
  const value = normalizeProductCategoryLabel(raw || input?.value || '');
  if (!value) return;
  const categories = currentProductCategories();
  if (categories.includes(value)) {
    toast('หมวดหมู่นี้มีอยู่แล้ว', 'err');
    input?.focus();
    input?.select?.();
    return;
  }
  syncProductCategoryManager([...categories, value]);
  if (input) {
    input.value = '';
    input.focus();
  }
}
let _adminArticles = [];
function articleForm(a) {
  const e = a || {};
  return `<form id="articleForm" class="prod-form glass">
    <input type="hidden" name="id" value="${e.id || ''}">
    <label>หัวข้อบทความ<input name="title" required value="${esc(e.title || '')}"></label>
    <label>เกริ่นนำสั้นๆ (excerpt)<input name="excerpt" value="${esc(e.excerpt || '')}"></label>
    <label>เนื้อหา (เว้นบรรทัด = ย่อหน้าใหม่)<textarea name="body" rows="8">${esc(e.body || '')}</textarea></label>
    <label>รูปปก (อัปโหลด)<input name="cover" type="file" accept="image/*"></label>
    <input type="hidden" name="existingCover" value="${esc(e.cover || '')}">
    <div class="pf-media-stack" data-article-cover-draft></div>
    <label class="pf-check"><input type="checkbox" name="published" ${e.published === false ? '' : 'checked'}> เผยแพร่</label>
    <div class="pf-actions"><button class="btn btn-primary" type="submit">${e.id ? 'บันทึก' : 'เพิ่มบทความ'}</button><button class="btn btn-glass" type="button" id="cancelArticle">ยกเลิก</button></div>
  </form>`;
}
async function viewAdminArticles() {
  if (!adminGuard()) return loadingView();
  await ensureAdminStoresContext();
  _adminArticles = await (await api('/api/admin/articles')).json();
  const rows = _adminArticles.length ? _adminArticles.map((a) => `<div class="adm-prod">
    <div class="adm-prod-info"><b>${esc(a.title)} ${a.published ? '' : '<span style="color:#c99">· ซ่อน</span>'}</b><span class="muted">${new Date(a.createdAt).toLocaleDateString('th-TH')} · ${esc(a.excerpt || '')}</span></div>
    <div class="adm-prod-act"><button class="btn-mini" type="button" data-editart="${a.id}">แก้ไข</button><button class="btn-mini danger" type="button" data-delart="${a.id}">ลบ</button></div>
  </div>`).join('') : '<p class="muted">ยังไม่มีบทความ</p>';
  return adminLayout('articles', `<div class="adm-head"><h2>บทความ</h2><button class="btn btn-primary" id="addArticleBtn">+ เพิ่มบทความ</button></div>
    <div id="articleFormWrap"></div>
    <div class="adm-list">${rows}</div>`);
}
async function viewAdminCommunity() {
  if (!adminGuard()) return loadingView();
  await ensureAdminStoresContext();
  const data = await (await api('/api/admin/community')).json().catch(() => ({ posts: [], stories: [] }));
  const posts = asArray(data.posts);
  const stories = asArray(data.stories);
  const postRows = posts.length ? posts.map((post) => `<div class="adm-prod community-admin-row ${post.status !== 'approved' ? 'is-pending' : ''}">
    <div class="adm-prod-img">${post.media?.[0]?.url ? `<img src="${esc(post.media[0].url)}">` : '<span>โพสต์</span>'}</div>
    <div class="adm-prod-info"><b>${esc(post.authorName || 'สมาชิก')} · ${post.status}${post.pinned ? ' · ปักหมุด' : ''}</b><span class="muted">${esc(String(post.caption || '').slice(0, 160))}</span><span class="muted">ไลก์ ${post.likes || 0} · คอมเมนต์ ${post.comments || 0}</span></div>
    <div class="adm-prod-act">
      <button class="btn-mini" type="button" data-community-admin-post="${esc(post.id)}" data-status="approved" data-pinned="${post.pinned ? '1' : '0'}">อนุมัติ</button>
      <button class="btn-mini" type="button" data-community-admin-post="${esc(post.id)}" data-status="hidden" data-pinned="${post.pinned ? '1' : '0'}">ซ่อน</button>
      <button class="btn-mini" type="button" data-community-admin-post="${esc(post.id)}" data-status="${esc(post.status)}" data-pinned="${post.pinned ? '0' : '1'}">${post.pinned ? 'เลิกปักหมุด' : 'ปักหมุด'}</button>
      <button class="btn-mini danger" type="button" data-community-delete-post="${esc(post.id)}">ลบ</button>
    </div>
  </div>`).join('') : '<p class="muted">ยังไม่มีโพสต์ชุมชน</p>';
  const storyRows = stories.length ? stories.map((story) => `<div class="adm-prod community-admin-story">
    <div class="adm-prod-img">${story.media ? `<img src="${esc(story.media)}">` : '<span>Story</span>'}</div>
    <div class="adm-prod-info"><b>${esc(story.title || 'Story')}</b><span class="muted">หมดอายุ ${new Date(story.expiresAt).toLocaleString('th-TH')} · ${esc(story.caption || '')}</span></div>
    <div class="adm-prod-act"><button class="btn-mini danger" type="button" data-community-delete-story="${esc(story.id)}">ลบ</button></div>
  </div>`).join('') : '<p class="muted">ยังไม่มี story</p>';
  return adminLayout('community', `<div class="adm-head"><div><h2>ชุมชน / Learning Platform</h2><span class="muted">จัดการโพสต์สมาชิก, seed จากบทความ และ story 24 ชั่วโมง</span></div><button class="btn btn-primary" type="button" data-community-seed>Seed จากบทความเดิม</button></div>
    <div class="dash-grid">
      <div class="stat-card"><span>โพสต์ทั้งหมด</span><b>${posts.length}</b></div>
      <div class="stat-card"><span>รออนุมัติ</span><b>${posts.filter((p) => p.status === 'pending').length}</b></div>
      <div class="stat-card"><span>Story</span><b>${stories.length}</b></div>
    </div>
    <div class="dash-card"><div class="dash-head"><h3>โพสต์ชุมชน</h3><span class="muted">อนุมัติก่อนแสดงหน้าเว็บ</span></div><div class="adm-list">${postRows}</div></div>
    <div class="dash-card"><div class="dash-head"><h3>Story 24 ชั่วโมง</h3><span class="muted">Story จะหายจากหน้าลูกค้าเมื่อครบ 24 ชั่วโมง</span></div><div class="adm-list">${storyRows}</div></div>`);
}
async function viewAdminLeads() {
  if (!adminGuard()) return loadingView();
  await ensureAdminStoresContext();
  const data = await fetchAdminPage('leads');
  const leads = data.items || [];
  const statusLabel = { new: 'ใหม่', contacted: 'ติดต่อแล้ว', qualified: 'มีโอกาสซื้อ', won: 'ปิดการขายได้', lost: 'ยังไม่สำเร็จ' };
  const rows = leads.length ? leads.map((l) => `<div class="lead-card glass">
    <div class="lead-head">
      <div><h3>${esc(l.name)}</h3><p class="muted">${esc(l.phone)}${l.lineId ? ' · LINE ' + esc(l.lineId) : ''}</p></div>
      <span class="status-badge s-${esc(l.status)}">${statusLabel[l.status] || l.status}</span>
    </div>
    <div class="lead-meta">
      <span>พืช: <b>${esc(l.crop || '-')}</b></span>
      <span>จังหวัด: <b>${esc(l.province || '-')}</b></span>
      <span>ช่วง: <b>${esc(l.stage || '-')}</b></span>
      <span>ที่มา: <b>${esc(l.source || 'direct')}</b></span>
      <span>UTM: <b>${esc([l.utmSource, l.utmMedium, l.utmCampaign].filter(Boolean).join(' / ') || '-')}</b></span>
    </div>
    ${l.problem ? `<p class="lead-problem">${esc(l.problem)}</p>` : ''}
    <div class="lead-actions">
      <select data-lstatus="${l.id}">
        <option value="new" ${l.status === 'new' ? 'selected' : ''}>ใหม่</option>
        <option value="contacted" ${l.status === 'contacted' ? 'selected' : ''}>ติดต่อแล้ว</option>
        <option value="qualified" ${l.status === 'qualified' ? 'selected' : ''}>มีโอกาสซื้อ</option>
        <option value="won" ${l.status === 'won' ? 'selected' : ''}>ปิดการขายได้</option>
        <option value="lost" ${l.status === 'lost' ? 'selected' : ''}>ยังไม่สำเร็จ</option>
      </select>
      <input class="track-in" data-lnote="${l.id}" value="${esc(l.note || '')}" placeholder="บันทึกติดตามผล">
      <button class="btn-mini" type="button" data-savelead="${l.id}">บันทึก</button>
    </div>
  </div>`).join('') : '<p class="muted">ไม่พบลีดตามเงื่อนไขนี้</p>';
  return adminLayout('leads', `<div class="adm-head"><div><h2>ลีดลูกค้า</h2><span class="muted">ติดตามลูกค้าที่มาจากเว็บไซต์ แชต และแคมเปญโฆษณา</span></div><button class="btn btn-glass" type="button" data-admin-export="leads">Export CSV</button></div>${adminFilters('leads')}${adminPagination('leads', data)}<div class="adm-list">${rows}</div>`);
}
async function viewAdminOrders() {
  if (!adminGuard()) return loadingView();
  await ensureAdminStoresContext();
  const data = await fetchAdminPage('orders');
  const orders = data.items || [];
  const ops = orders.reduce((acc, order) => {
    const priority = orderPriority(order);
    acc[priority.key] = (acc[priority.key] || 0) + 1;
    return acc;
  }, {});
  const opsSummary = `<div class="order-ops-board glass">
    <div><span>รอตรวจสลิป</span><b>${ops.verify || 0}</b></div>
    <div><span>รอเตรียมสินค้า</span><b>${ops.prepare || 0}</b></div>
    <div><span>รอจัดส่ง</span><b>${ops.ship || 0}</b></div>
    <div><span>รอปิดงาน</span><b>${ops.deliver || 0}</b></div>
  </div>`;
  const rows = orders.length ? orders.map((o) => {
    const priority = orderPriority(o);
    const nextAction = priority.action ? `<button class="btn-mini is-confirm" type="button" data-oaction="${priority.action}" data-oid="${o.id}">Next: ${esc(priority.label)}</button>` : '';
    return `<div class="adm-order glass priority-${priority.tone}">
    <div class="ao-top"><a href="${routeHref('/admin/order/' + o.id)}"><b>${o.id}</b> <span class="ao-view">ดูรายละเอียด →</span></a><span class="status-badge s-${o.status}">${o.statusLabel}</span></div>
    <div class="ao-info muted">${o.customerName || '-'} · ${o.customerPhone || '-'} · ${baht(o.total)} · ${o.payment_method === 'card' ? 'บัตร' : 'PromptPay'}${o.payment_claimed && !o.paid ? ' · ⚠️แจ้งโอนแล้ว' : ''}</div>
    <div class="ao-items muted">${o.itemSummary || 'ไม่มีรายการสินค้า'}${o.itemCount ? ` · รวม ${o.itemCount} ชิ้น` : ''}</div>
    <div class="ao-priority"><span class="priority-pill ${priority.tone}">${esc(priority.label)}</span><button class="btn-mini" type="button" data-copy="${esc(o.id)}">คัดลอกออเดอร์</button>${o.customerPhone ? `<button class="btn-mini" type="button" data-copy="${esc(o.customerPhone)}">คัดลอกเบอร์</button>` : ''}</div>
    <div class="ao-act">
      ${nextAction}
      <button class="btn-mini" type="button" data-oaction="paid" data-oid="${o.id}">ยืนยันจ่าย</button>
      <button class="btn-mini" type="button" data-oaction="preparing" data-oid="${o.id}">เตรียม</button>
      <input class="track-in" data-track="${o.id}" placeholder="เลขพัสดุ" value="${o.tracking || ''}">
      <button class="btn-mini" type="button" data-oaction="shipped" data-oid="${o.id}">จัดส่ง</button>
      <button class="btn-mini" type="button" data-oaction="delivered" data-oid="${o.id}">สำเร็จ</button>
      <button class="btn-mini danger" type="button" data-oaction="cancelled" data-oid="${o.id}">ยกเลิก</button>
    </div>
  </div>`;
  }).join('') : '<p class="muted">ไม่พบออเดอร์ตามเงื่อนไขนี้</p>';
  return adminLayout('orders', `<div class="adm-head"><div><h2>ออเดอร์ทั้งหมด</h2><span class="muted">เปิดดูเป็นหน้า ๆ เพื่อให้หลังบ้านเบาและลื่นขึ้น</span></div><button class="btn btn-glass" type="button" data-admin-export="orders">Export CSV</button></div>${opsSummary}${adminFilters('orders')}${adminPagination('orders', data)}<div class="adm-list">${rows}</div>`);
}
async function viewAdminInbox() {
  if (!adminGuard({ allowChatAdmin: true })) return loadingView();
  await ensureAdminStoresContext();
  try {
    const data = await loadAdminInboxViewData();
    return adminInboxShell(data.listData, data.threadData);
  } catch (err) {
    return adminLayout('inbox', `<div class="adm-head"><h2>Inbox แชต</h2><span class="muted">ระบบแชตแอดมิน</span></div><div class="admin-inbox-empty glass"><div><b>ยังเปิด inbox ไม่สำเร็จ</b><p class="muted">${esc(err?.message || 'โหลด inbox แชตไม่สำเร็จ')}</p></div></div>`);
  }
}
async function viewAdminUsers() {
  if (!adminGuard()) return loadingView();
  await ensureAdminStoresContext();
  const data = await fetchAdminPage('users');
  const users = data.items || [];
  const createForm = `<form id="adminCreateUserForm" class="prod-form admin-user-create glass">
    <div class="adm-head"><h3>สร้างบัญชีแอดมินใหม่</h3><span class="muted">สร้างได้ทั้งแอดมินเต็มและ Admin chat ภายในหลังบ้านนี้เลย</span></div>
    <div class="pf-grid">
      <label>ชื่อที่แสดง<input name="name" placeholder="เช่น ทีมตอบแชตเช้า"></label>
      <label>อีเมล / ไอดีเข้าสู่ระบบ<input name="email" type="email" required placeholder="adminchat@example.com"></label>
      <label>รหัสผ่าน<input name="password" type="text" minlength="6" required placeholder="อย่างน้อย 6 ตัวอักษร"></label>
      <label>สิทธิ์ใช้งาน<select name="role"><option value="chat_admin">Admin chat</option><option value="admin">แอดมินเต็ม</option></select></label>
    </div>
    <div class="pf-actions"><button class="btn btn-primary" type="submit">สร้างบัญชีใหม่</button></div>
    <p class="form-note">เหมาะสำหรับสร้างไอดีให้ทีมตอบแชตโดยตรง แนะนำใช้อีเมลเฉพาะงานและตั้งรหัสผ่านใหม่ทุกครั้งที่เปลี่ยนคนดูแล</p>
  </form>`;
  const roleBadge = (role = '') => {
    if (role === ROLE_ADMIN) return '<span class="role-badge">แอดมิน</span>';
    if (role === ROLE_CHAT_ADMIN) return '<span class="role-badge">Admin chat</span>';
    return '';
  };
  const rows = users.length ? users.map((u) => `<div class="adm-user">
    <div class="au-info"><b>${u.email}</b> ${roleBadge(u.role)}<span class="muted">ID ${u.id} · สมัคร ${new Date(u.created_at).toLocaleDateString('th-TH')}</span></div>
    <div class="au-act">
      <input class="track-in" data-uname="${u.id}" value="${u.name || ''}" placeholder="ชื่อ">
      <select class="track-in" data-urole="${u.id}"><option value="user" ${u.role === 'user' ? 'selected' : ''}>สมาชิก</option><option value="chat_admin" ${u.role === 'chat_admin' ? 'selected' : ''}>Admin chat</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>แอดมิน</option></select>
      <button class="btn-mini" type="button" data-saveuser="${u.id}">บันทึก</button>
      <button class="btn-mini danger" type="button" data-deluser="${u.id}" ${u.id === currentUser.id ? 'disabled' : ''}>ลบ</button>
    </div>
  </div>`).join('') : '<p class="muted">ไม่พบบัญชีตามเงื่อนไขนี้</p>';
  return adminLayout('users', `<div class="adm-head"><h2>ผู้ใช้ทั้งหมด (${data.total || users.length})</h2><span class="muted">จัดการสิทธิ์และบัญชีแบบแบ่งหน้า</span></div><p class="form-note" style="margin-bottom:16px">สมาชิก = ใช้งานเว็บทั่วไป · Admin chat = เข้าตอบแชทได้อย่างเดียว · แอดมิน = เข้าหลังบ้านเต็มรูปแบบ · ต้องมีแอดมินอย่างน้อย 1 คนเสมอ</p>${createForm}${adminFilters('users')}${adminPagination('users', data)}<div class="adm-list">${rows}</div>`);
}

let _coupons = [];
function couponForm(c) {
  const e = c || { type: 'percent', active: true };
  const exp = e.expiresAt ? new Date(e.expiresAt).toISOString().slice(0, 10) : '';
  return `<form id="couponForm" class="prod-form">
    <input type="hidden" name="orig" value="${e.code || ''}">
    <div class="pf-grid">
      <label>รหัสคูปอง<input name="code" required ${e.code ? 'readonly' : ''} value="${e.code || ''}" placeholder="WELCOME10" style="text-transform:uppercase"></label>
      <label>ประเภท<select name="type"><option value="percent" ${e.type === 'percent' ? 'selected' : ''}>เปอร์เซ็นต์ (%)</option><option value="fixed" ${e.type === 'fixed' ? 'selected' : ''}>จำนวนเงิน (฿)</option></select></label>
      <label>มูลค่า<input name="value" type="number" required value="${e.value || ''}"></label>
      <label>ยอดขั้นต่ำ (บาท)<input name="minTotal" type="number" value="${e.minTotal || 0}"></label>
      <label>จำกัดจำนวนครั้ง (0=ไม่จำกัด)<input name="maxUses" type="number" value="${e.maxUses || 0}"></label>
      <label>วันหมดอายุ (เว้นว่าง=ไม่หมด)<input name="expires" type="date" value="${exp}"></label>
      <label class="pf-check"><input type="checkbox" name="active" ${e.active === false ? '' : 'checked'}> เปิดใช้งาน</label>
    </div>
    <div class="pf-actions"><button class="btn btn-primary" type="submit">${e.code ? 'บันทึก' : 'สร้างคูปอง'}</button><button class="btn btn-glass" type="button" id="cancelCoupon">ยกเลิก</button></div>
  </form>`;
}
async function viewAdminCoupons() {
  if (!adminGuard()) return loadingView();
  await ensureAdminStoresContext();
  _coupons = await (await api('/api/admin/coupons')).json();
  const rows = _coupons.length ? _coupons.map((c) => `<div class="adm-prod">
    <div class="adm-prod-info"><b>${c.code} <span class="role-badge">${c.type === 'percent' ? c.value + '%' : baht(c.value)}</span> ${c.active ? '' : '<span style="color:#c99">· ปิด</span>'}</b>
    <span class="muted">ใช้แล้ว ${c.used}${c.maxUses ? '/' + c.maxUses : ''}${c.minTotal ? ' · ขั้นต่ำ ' + baht(c.minTotal) : ''}${c.expiresAt ? ' · ถึง ' + new Date(c.expiresAt).toLocaleDateString('th-TH') : ''}</span></div>
    <div class="adm-prod-act"><button class="btn-mini" type="button" data-editcoupon="${c.code}">แก้ไข</button><button class="btn-mini danger" type="button" data-delcoupon="${c.code}">ลบ</button></div>
  </div>`).join('') : '<p class="muted">ยังไม่มีคูปอง</p>';
  return adminLayout('coupons', `<div class="adm-head"><h2>คูปองส่วนลด</h2><button class="btn btn-primary" id="addCouponBtn">+ สร้างคูปอง</button></div><div id="couponFormWrap"></div><div class="adm-list">${rows}</div>`);
}
async function viewAdminSettings() {
  if (!adminGuard()) return loadingView();
  await ensureAdminStoresContext();
  const [settings, statusData] = await Promise.all([
    (await api('/api/admin/settings')).json(),
    (await api('/api/admin/settings/status')).json(),
  ]);
  const health = statusData.health || {};
  const lastApply = statusData.lastApply || null;
  const history = Array.isArray(statusData.history) ? statusData.history : [];
  const revisions = Array.isArray(statusData.revisions) ? statusData.revisions : [];
  const lineAdmin = statusData.lineAdmin || {};
  const settingMap = Object.fromEntries(settings.map((item) => [item.key, item]));
  const labels = {
    LINE_CHANNEL_ACCESS_TOKEN: 'LINE Channel Access Token', LINE_CHANNEL_SECRET: 'LINE Channel Secret',
    LINE_CHAT_MODE: 'LINE Chat Mode', LINE_WEB_CHAT_PATH: 'LINE Web Chat Path',
    LINEOA_API_BASE_URL: 'LINE OA Bot API Base URL', LINEOA_API_CLIENT_ID: 'LINE OA Bot Client ID', LINEOA_API_SECRET: 'LINE OA Shared Secret',
    LINE_ADMIN_USER_ID: 'LINE Admin userId', STRIPE_SECRET_KEY: 'Stripe Secret Key',
    STRIPE_WEBHOOK_SECRET: 'Stripe Webhook Secret', PROMPTPAY_ID: 'PromptPay ID (เบอร์/บัตรปชช.)',
    PROMPTPAY_NAME: 'ชื่อร้าน PromptPay', SLIPOK_API_URL: 'SlipOK API URL', SLIPOK_API_KEY: 'SlipOK API Key',
    ORDER_RESERVATION_TTL_MINUTES: 'หมดเวลาชำระ (นาที)', PUBLIC_URL: 'Public URL (สำหรับ Stripe redirect)',
    SMTP_HOST: 'อีเมล: SMTP Host', SMTP_PORT: 'อีเมล: Port (587/465)', SMTP_USER: 'อีเมล: Username',
    SMTP_PASS: 'อีเมล: Password', SMTP_FROM: 'อีเมล: ผู้ส่ง (From)',
  };
  const fields = settings.filter((s) => !['LINE_CHAT_MODE', 'LINE_WEB_CHAT_PATH'].includes(String(s.key || ''))).map((s) => `<label class="set-field">
    <span>${labels[s.key] || s.key} ${s.set ? `<em class="ok">✓ ตั้งค่าแล้ว (${s.source})</em>` : '<em class="no">ยังไม่ตั้ง</em>'}</span>
    <input name="${s.key}" ${s.secret ? 'type="password"' : ''} value="${s.secret ? '' : s.display}" placeholder="${s.secret && s.set ? s.display + ' (เว้นว่างไว้ = คงเดิม)' : 'กรอกค่า…'}">
  </label>`).join('');
  const currentMode = String(settingMap.LINE_CHAT_MODE?.display || 'line_reply').trim() || 'line_reply';
  const webChatPath = String(settingMap.LINE_WEB_CHAT_PATH?.display || '/line-room').trim() || '/line-room';
  const badge = (ok) => ok ? '<span class="status-badge s-paid">เชื่อมแล้ว</span>' : '<span class="status-badge s-awaiting_payment">ยังไม่เชื่อม</span>';
  const lineRoomBadge = badge(Boolean(health.lineWebRoomReady));
  const configCenter = renderConfigCenterStatus(lastApply, history, revisions);
  const lineAdminManager = renderLineAdminBindingManager(lineAdmin);
  const cheatSheet = `
    <div class="glass" style="padding:18px;margin-top:16px">
      <h3 style="margin:0 0 10px">LINE OA Cheat Sheet</h3>
      <p class="muted" style="margin:0 0 12px">ใช้ปุ่มเมนูเป็นหลัก ส่วนคำสั่ง text ให้ลงท้ายด้วย <b>DDD</b> เท่านั้นเพื่อลดการชนกับข้อความแชตลูกค้า</p>
      <div class="form-note" style="margin:0 0 10px">Webhook production: <code>https://www.junenuchforlife.com/webhook/line</code></div>
      <div class="form-note" style="margin:0 0 10px">สถานะลิงก์ห้องแชตเว็บ: ${lineRoomBadge}</div>
      <div class="form-note" style="margin:0 0 12px"><b>Flow แนะนำ:</b> ลูกค้าใหม่ให้เริ่มที่ <code>ดูสินค้า</code> หรือ <code>รีวิวลูกค้า</code> จากเมนูหลัก, ถ้าพิมพ์ข้อความธรรมดาระบบจะส่งเข้า Inbox ทีมงานและพาไปห้องแชตเว็บทันที, ถ้ากดถามจากการ์ดสินค้า ระบบจะส่งชื่อสินค้าที่สนใจไปให้แอดมินเห็นใน Inbox ด้วย</div>
      <div class="form-note" style="margin:0 0 12px"><b>Customer commands:</b> <code>menuddd</code>, <code>productsddd</code>, <code>setsddd</code>, <code>packsddd</code>, <code>smallddd</code>, <code>largeddd</code>, <code>promoddd</code>, <code>reviewsddd</code>, <code>trackddd</code>, <code>articlesddd</code>, <code>aboutddd</code>, <code>chatddd</code>, <code>webroomddd</code>, <code>supportddd</code>, <code>accountddd</code>, <code>memberddd</code></div>
      <div class="form-note" style="margin:0 0 12px"><b>Product sync:</b> ปุ่มสินค้าใน LINE OA จะดึงราคา รายละเอียด รูปภาพ และลิงก์จากข้อมูลสินค้า active บนเว็บไซต์โดยตรง แก้ในหลังบ้านแล้ว LINE OA อัปเดตตามทันที</div>
      <div class="form-note" style="margin:0 0 12px"><b>Admin commands:</b> <code>listddd</code>, <code>ordersddd</code>, <code>orderddd ORDER_ID</code>, <code>paidddd ORDER_ID</code>, <code>prepareddd ORDER_ID</code>, <code>shipddd ORDER_ID TRACKING</code>, <code>doneddd ORDER_ID</code>, <code>cancelddd ORDER_ID</code></div>
      <div class="form-note" style="margin:0 0 12px"><b>Bind admin:</b> สร้างรหัสจากหลังบ้าน แล้วให้คนที่จะเป็นแอดมินส่ง <code>bindadminddd CODE</code> ใน LINE OA ภายใน 10 นาที</div>
      <div class="form-note" style="margin:0">การตอบห้องแชตยังใช้รูปแบบเดิม: <code>#SESSION_ID ข้อความ</code></div>
    </div>`;
  return adminLayout('settings', `<h2>ตั้งค่า API / LINE OA</h2>
    <div class="conn-status">LINE OA ${badge(health.lineConfigured)} · Stripe ${badge(health.stripeConfigured)} · PromptPay ${badge(health.promptpayConfigured)} · SlipOK ${badge(health.slipokConfigured)} · อีเมล ${badge(health.mailConfigured)}</div>
    ${configCenter}
    <form id="settingsForm" class="set-form glass">
      <label class="set-field">
        <span>LINE Chat Mode <em class="ok">เลือกได้ 2 โหมด โดย flow เดิมยังอยู่</em></span>
        <select name="LINE_CHAT_MODE">
          <option value="line_reply" ${currentMode === 'line_reply' ? 'selected' : ''}>ตอบกลับใน LINE OA</option>
          <option value="web_room" ${currentMode === 'web_room' ? 'selected' : ''}>คุยต่อในห้องแชตเว็บ</option>
        </select>
      </label>
      <label class="set-field">
        <span>Web Chat Path <em class="ok">ลิงก์ปลายทางสำหรับเปิดห้องแชตเว็บจาก LINE</em></span>
        <input name="LINE_WEB_CHAT_PATH" value="${esc(webChatPath)}" placeholder="/line-room">
      </label>
      ${fields}
      <div class="pf-actions"><button class="btn btn-primary" type="submit">บันทึกและตรวจสอบอัตโนมัติ</button><button class="btn btn-glass" type="button" id="testLineBtn">ทดสอบส่ง LINE</button><button class="btn btn-glass" type="button" id="testLineRoomBtn">ทดสอบลิงก์ห้องแชต</button><button class="btn btn-glass" type="button" id="testMailBtn">ทดสอบส่งอีเมล</button><a class="btn btn-glass" href="${routeHref('/admin/diagnostics')}">เปิด Diagnostics</a></div>
    </form>
    <p class="form-note">ค่า secret จะแสดงแบบปิดบัง เว้นว่างไว้ = ใช้ค่าเดิม · บันทึกแล้วระบบจะเช็ก config, LINE token, line-room และ health ให้อัตโนมัติ พร้อมเก็บ revision สำหรับ rollback และเข้ารหัส secret ก่อนบันทึกลง settings</p>
    ${lineAdminManager}
    ${cheatSheet}`);
}
function normalizeStoreSubdomainDraft(value = '') {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}
function storeStatusBadge(store = {}) {
  if (store?.isDefault) return '<span class="status-badge s-paid">Default</span>';
  const status = String(store?.status || 'active').trim().toLowerCase();
  if (status === 'active') return '<span class="status-badge s-paid">Active</span>';
  if (status === 'draft') return '<span class="status-badge s-awaiting_payment">Draft</span>';
  if (status === 'disabled') return '<span class="status-badge s-cancelled">Disabled</span>';
  return `<span class="status-badge">${esc(status || 'unknown')}</span>`;
}
function renderStoreSubdomainCheck(state = {}) {
  const subdomain = String(state?.subdomain || '').trim();
  if (!subdomain) return '<div class="form-note">พิมพ์ชื่อร้านหรือ subdomain แล้วกดเช็กก่อนสร้าง เพื่อดู URL ปลายทางและลดความผิดพลาด</div>';
  if (state?.loading) return `<div class="form-note">กำลังตรวจ subdomain <code>${esc(subdomain)}</code> ...</div>`;
  if (state?.error) return `<div class="form-note" style="color:#b42318">${esc(state.error)}</div>`;
  if (state?.valid && state?.available) {
    const previewUrl = String(state?.previewUrl || '').trim();
    return `<div class="form-note"><b>พร้อมใช้งาน:</b> <code>${esc(subdomain)}</code> ยังว่างอยู่${previewUrl ? ` · URL: <a href="${esc(previewUrl)}" target="_blank" rel="noopener">${esc(previewUrl)}</a>` : ''}</div>`;
  }
  if (!state?.valid) return `<div class="form-note" style="color:#b42318">Subdomain <code>${esc(subdomain)}</code> ใช้ไม่ได้ ต้องเป็น a-z, 0-9, ขีดกลาง และต้องไม่ชนคำสงวนของระบบ</div>`;
  return `<div class="form-note" style="color:#b42318">Subdomain <code>${esc(subdomain)}</code> ถูกใช้งานแล้ว ลองเปลี่ยนชื่ออีกเล็กน้อย</div>`;
}
function renderSelectedStoreSettingsPanel(data = {}) {
  const store = data.store || selectedAdminStore();
  const settings = Object.fromEntries((Array.isArray(data.settings) ? data.settings : []).map((item) => [item.key, item]));
  const value = (key) => String(settings[key]?.value ?? data.site?.[key] ?? '').trim();
  const field = (key, label, type = 'text', rows = 2) => {
    const secret = settings[key]?.secret === true;
    const inherited = settings[key]?.inherited === true;
    const display = String(settings[key]?.display || '').trim();
    const help = inherited ? '<em class="ok">ใช้ค่า global อยู่</em>' : '<em class="ok">ตั้งค่าแยกร้านแล้ว</em>';
    if (type === 'area') {
      return `<label class="set-field"><span>${esc(label)} ${help}</span><textarea name="${esc(key)}" rows="${rows}">${esc(value(key))}</textarea></label>`;
    }
    return `<label class="set-field"><span>${esc(label)} ${help}</span><input name="${esc(key)}" ${secret ? 'type="password"' : ''} value="${secret ? '' : esc(value(key))}" placeholder="${secret && display ? esc(display + ' (เว้นว่างไว้ = คงเดิม)') : ''}"></label>`;
  };
  return `<section class="glass" style="padding:18px;margin-top:18px">
    <div class="adm-head" style="margin:0 0 10px"><h3>ตั้งค่าร้านที่เลือก: ${esc(store?.name || store?.id || '-')}</h3><span class="muted">ค่าชุดนี้ใช้เฉพาะร้านใน Store Switcher</span></div>
    <form id="adminStoreSettingsForm" class="set-form" style="padding:0;background:transparent;border:0">
      <input type="hidden" name="storeId" value="${esc(store?.id || adminSelectedStoreId())}">
      <div class="pf-grid">
        ${field('SITE_NAME', 'ชื่อเว็บ / ชื่อร้าน')}
        ${field('SITE_HERO_TITLE', 'Hero title')}
        ${field('SITE_HERO_ACCENT', 'Hero accent')}
        ${field('SITE_HERO_SUB', 'Hero subtitle', 'area', 3)}
        ${field('SITE_SHARE_TITLE', 'หัวข้อตอนแชร์ลิงก์')}
        ${field('SITE_SHARE_DESC', 'คำอธิบายตอนแชร์ลิงก์', 'area', 3)}
        ${field('SITE_SHARE_IMAGE', 'รูปการ์ดแชร์ URL')}
        ${field('CONTACT_PRIMARY_LABEL', 'ชื่อ / ป้ายเบอร์หลัก')}
        ${field('CONTACT_PRIMARY_PHONE', 'เบอร์ติดต่อหลัก')}
        ${field('CONTACT_LINE_ID', 'LINE ID ส่วนตัว')}
        ${field('CONTACT_LINE_OA_ID', 'LINE OA ID')}
        ${field('CONTACT_LINE_PERSONAL_URL', 'ลิงก์ LINE ส่วนตัว')}
        ${field('PROMPTPAY_ID', 'PromptPay ID')}
        ${field('PROMPTPAY_NAME', 'ชื่อบัญชี PromptPay')}
        ${field('PUBLIC_URL', 'Public URL ของร้าน')}
        ${field('LINE_CHANNEL_ACCESS_TOKEN', 'LINE Channel Access Token')}
        ${field('LINE_CHANNEL_SECRET', 'LINE Channel Secret')}
        ${field('LINE_ADMIN_USER_ID', 'LINE Admin userId')}
        ${field('SMTP_HOST', 'SMTP Host')}
        ${field('SMTP_PORT', 'SMTP Port')}
        ${field('SMTP_USER', 'SMTP User')}
        ${field('SMTP_PASS', 'SMTP Password')}
        ${field('SMTP_FROM', 'SMTP From')}
      </div>
      <div class="pf-actions"><button class="btn btn-primary" type="submit">บันทึก settings ร้านนี้</button></div>
    </form>
  </section>`;
}
function renderStoreOnboardingPanel(store = {}, settingsData = {}, qa = null) {
  if (qa?.checklist?.items?.length) {
    const checklist = qa.checklist;
    return `<section class="glass store-onboarding" style="padding:18px;margin-top:18px">
      <div class="adm-head" style="margin:0 0 12px">
        <div><h3>Store Launch Checklist: ${esc(store?.name || store?.id || '-')}</h3><span class="muted">ตรวจจากข้อมูลจริงของร้านที่เลือก ทั้งสินค้า ออเดอร์ โดเมน LINE และการ์ดแชร์</span></div>
        <span class="status-badge ${checklist.percent >= 85 ? 's-paid' : 's-awaiting_payment'}">${Math.max(0, Number(checklist.done || 0))}/${Math.max(0, Number(checklist.total || 0))} · ${Math.max(0, Number(checklist.percent || 0))}%</span>
      </div>
      <div class="launch-progress"><span style="width:${Math.max(0, Math.min(100, Number(checklist.percent || 0)))}%"></span></div>
      <div class="store-checklist">
        ${checklist.items.map((item) => `<a class="store-check-item ${item.status === 'ok' ? 'done' : item.status === 'warn' ? 'warn' : ''}" href="${routeHref(item.href || '/admin/stores')}">
          <span>${item.status === 'ok' ? '✓' : item.status === 'warn' ? '!' : '○'}</span>
          <b>${esc(item.label)}</b>
          <small>${esc(item.detail || '')}</small>
        </a>`).join('')}
      </div>
      <div class="pf-actions" style="margin-top:14px">
        <a class="btn btn-primary" href="${esc(qa?.domain?.publicUrl || qa?.sharePreview?.url || '#')}" target="_blank" rel="noopener">เปิดหน้าร้าน</a>
        <a class="btn btn-glass" href="${routeHref('/admin/diagnostics')}">ดู Production QA</a>
      </div>
    </section>`;
  }
  const settings = Object.fromEntries((Array.isArray(settingsData.settings) ? settingsData.settings : []).map((item) => [item.key, item]));
  const hasValue = (key) => String(settings[key]?.value || settingsData.site?.[key] || '').trim().length > 0;
  const items = [
    ['ตั้งชื่อเว็บ', hasValue('SITE_NAME'), 'SITE_NAME'],
    ['ชื่อแบรนด์', hasValue('SITE_NAME'), 'SITE_NAME'],
    ['Hero หน้าแรก', hasValue('SITE_HERO_TITLE') && (hasValue('SITE_HERO_SUB') || hasValue('SITE_HERO_ACCENT')), 'SITE_HERO_TITLE'],
    ['การ์ดแชร์ลิงก์', hasValue('SITE_SHARE_TITLE') || hasValue('SITE_SHARE_DESC') || hasValue('SITE_SHARE_IMAGE'), 'SITE_SHARE_TITLE'],
    ['LINE สำหรับติดต่อ', hasValue('CONTACT_LINE_ID') || hasValue('CONTACT_LINE_OA_ID') || hasValue('CONTACT_LINE_PERSONAL_URL') || hasValue('LINE_CHANNEL_ACCESS_TOKEN'), 'CONTACT_LINE_ID'],
    ['PromptPay', hasValue('PROMPTPAY_ID'), 'PROMPTPAY_ID'],
    ['SMTP อีเมล', hasValue('SMTP_HOST') && hasValue('SMTP_USER'), 'SMTP_HOST'],
    ['เพิ่มสินค้าแรก', false, 'products'],
    ['ทดสอบสั่งซื้อ', false, 'checkout'],
  ];
  const done = items.filter((item) => item[1]).length;
  return `<section class="glass store-onboarding" style="padding:18px;margin-top:18px">
    <div class="adm-head" style="margin:0 0 12px"><h3>Store Onboarding Wizard: ${esc(store?.name || store?.id || '-')}</h3><span class="status-badge ${done >= 6 ? 's-paid' : 's-awaiting_payment'}">${done}/${items.length} พร้อมใช้งาน</span></div>
    <div class="store-checklist">
      ${items.map(([label, ok, key]) => `<div class="store-check-item ${ok ? 'done' : ''}">
        <span>${ok ? '✓' : '○'}</span>
        <b>${esc(label)}</b>
        <small>${ok ? 'เสร็จแล้ว' : key === 'products' ? 'ไปที่จัดการสินค้าแล้วเพิ่มสินค้าแรก' : key === 'checkout' ? 'เปิดหน้าร้านแล้วลองสั่งซื้อทดสอบ' : 'กรอกใน settings ร้านด้านล่าง'}</small>
      </div>`).join('')}
    </div>
  </section>`;
}
function renderDomainHealthPanel(store = {}, health = {}) {
  const dnsReady = health?.dns?.ready === true;
  const sslReady = health?.ssl?.ready === true;
  return `<section class="glass" style="padding:18px;margin-top:18px">
    <div class="adm-head" style="margin:0 0 12px"><h3>Domain Health</h3><span class="muted">${esc(health.host || store.primaryDomain || store.publicUrl || '-')}</span></div>
    <div class="adm-list">
      ${diagnosticsMetricCard('DNS / Vercel', diagnosticsStateBadge(dnsReady ? 'ok' : 'warn'), dnsReady ? 'พร้อมใช้งาน' : 'ยังรอ DNS หรือ verification', health?.dns?.message || health?.wildcardRecommended || '')}
      ${diagnosticsMetricCard('SSL', diagnosticsStateBadge(sslReady ? 'ok' : 'warn'), sslReady ? 'พร้อมใช้งาน' : 'รอ Vercel ออก certificate', health?.ssl?.message || '')}
      ${diagnosticsMetricCard('Automation', diagnosticsStateBadge(health.domainAutomationConfigured ? 'ok' : 'warn'), health.domainAutomationConfigured ? 'ตั้งค่า Vercel API แล้ว' : 'ยังไม่ได้ตั้งค่า Vercel API', health.publicUrl || '')}
    </div>
    <div class="pf-actions" style="margin-top:12px">
      ${store?.id && store?.subdomain ? `<button class="btn btn-glass" type="button" data-provisionstore="${esc(store.id)}">Retry Provision</button>` : ''}
      ${health.publicUrl ? `<a class="btn btn-glass" href="${esc(health.publicUrl)}" target="_blank" rel="noopener">เปิดหน้าร้าน</a>` : ''}
    </div>
  </section>`;
}
function renderStoreBackupPanel(store = {}) {
  return `<section class="glass" style="padding:18px;margin-top:18px">
    <div class="adm-head" style="margin:0 0 12px"><h3>Backup / Export ร้าน</h3><span class="muted">สินค้า ออเดอร์ ลูกค้า settings และ domain เฉพาะร้าน</span></div>
    <div class="pf-actions">
      <a class="btn btn-primary" href="/api/admin/stores/${encodeURIComponent(store?.id || adminSelectedStoreId())}/export" target="_blank" rel="noopener">Export JSON Backup</a>
    </div>
    <form id="adminStoreImportForm" class="set-form" style="padding:0;background:transparent;border:0;margin-top:14px">
      <input type="hidden" name="storeId" value="${esc(store?.id || adminSelectedStoreId())}">
      <label class="set-field"><span>Safe Import / Restore JSON</span><textarea name="backupJson" rows="5" placeholder="วาง JSON backup จาก Export ที่นี่"></textarea></label>
      <div class="pf-actions">
        <button class="btn btn-glass" type="submit" data-import-dryrun="1">Dry-run ก่อนเขียนจริง</button>
        <button class="btn btn-primary" type="submit" data-import-apply="1">Apply Restore</button>
      </div>
    </form>
    <p class="form-note" style="margin-top:10px">Restore จะ upsert เฉพาะ settings, products, articles และ coupons ของร้านที่เลือก ไม่แตะ orders/leads/customers เพื่อกันข้อมูลลูกค้าถูกทับ</p>
  </section>`;
}
function renderStoreRolesPanel(store = {}, rolesData = {}) {
  const roles = Array.isArray(rolesData.roles) ? rolesData.roles : [];
  return `<section class="glass" style="padding:18px;margin-top:18px">
    <div class="adm-head" style="margin:0 0 12px"><h3>Permission รายร้าน</h3><span class="muted">owner / admin / staff / chat_admin</span></div>
    <form id="adminStoreRoleForm" class="set-form" style="padding:0;background:transparent;border:0">
      <input type="hidden" name="storeId" value="${esc(store?.id || adminSelectedStoreId())}">
      <div class="pf-grid">
        <label class="set-field"><span>อีเมลผู้ใช้</span><input name="email" type="email" placeholder="staff@example.com"></label>
        <label class="set-field"><span>Role</span><select name="role"><option value="staff">staff</option><option value="chat_admin">chat_admin</option><option value="admin">admin</option><option value="owner">owner</option></select></label>
      </div>
      <div class="pf-actions"><button class="btn btn-primary" type="submit">เพิ่ม/อัปเดตสิทธิ์ร้าน</button></div>
    </form>
    <div class="adm-list" style="margin-top:12px">${roles.length ? roles.map((role) => `<article class="adm-prod glass"><div class="adm-prod-top"><b>${esc(role.user?.email || role.userId)}</b><span class="status-badge s-paid">${esc(role.role)}</span></div><div class="muted">${esc(role.user?.name || '')}</div></article>`).join('') : '<div class="form-note">ยังไม่มี role รายร้านเพิ่มเติม</div>'}</div>
  </section>`;
}
async function viewAdminStores() {
  if (!adminGuard()) return loadingView();
  await ensureAdminStoresContext(true).catch(() => null);
  const r = await api('/api/admin/stores');
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    return adminLayout('stores', `<div class="adm-head"><h2>หลายเว็บไซต์</h2></div><div class="glass" style="padding:18px">โหลดข้อมูลร้านไม่สำเร็จ: ${esc(data?.error || 'unknown error')}</div>`);
  }
  const rootDomain = String(data?.rootDomain || '').trim();
  const currentHost = String(data?.currentHost || '').trim();
  const domainAutomationConfigured = data?.domainAutomationConfigured === true;
  const stores = (Array.isArray(data?.stores) ? data.stores : [])
    .slice()
    .sort((a, b) => {
      const defaultWeight = Number(Boolean(b?.isDefault)) - Number(Boolean(a?.isDefault));
      if (defaultWeight) return defaultWeight;
      return Number(b?.createdAt || 0) - Number(a?.createdAt || 0);
    });
  const defaultStore = stores.find((item) => item?.isDefault) || null;
  const isLocalRoot = /(^|\.)localhost$|127\.0\.0\.1|:\d+$/.test(rootDomain) || /localhost|127\.0\.0\.1/.test(currentHost);
  const setupCards = `<div class="adm-list">
    ${diagnosticsMetricCard('Root Domain', diagnosticsStateBadge(rootDomain ? 'ok' : 'warn'), rootDomain || 'ยังจับ root domain ไม่ได้', currentHost ? `host ปัจจุบัน ${currentHost}` : '')}
    ${diagnosticsMetricCard('Store Count', diagnosticsStateBadge(stores.length ? 'ok' : 'info'), stores.length ? `มีร้านทั้งหมด ${stores.length} ร้าน` : 'ยังไม่มีร้านที่สร้างเพิ่ม', defaultStore?.name ? `default คือ ${defaultStore.name}` : 'ยังไม่มี default store')}
    ${diagnosticsMetricCard('Store Database', diagnosticsStateBadge('ok'), 'สร้าง database namespace อัตโนมัติต่อเว็บไซต์', 'แยกข้อมูลด้วย store_id ใน Supabase')}
    ${diagnosticsMetricCard('Vercel Domain', diagnosticsStateBadge(domainAutomationConfigured && !isLocalRoot ? 'ok' : 'warn'), domainAutomationConfigured ? 'พร้อมผูก subdomain เข้า Vercel อัตโนมัติ' : 'ยังไม่ได้ตั้ง VERCEL_API_TOKEN สำหรับ automation', isLocalRoot ? 'กำลังดูใน local/preview อยู่' : 'สร้างร้านแล้วจะ clone theme/settings และผูก domain')}
  </div>`;
  const storesHtml = stores.length
    ? `<div class="adm-list">${stores.map((store) => {
      const publicUrl = String(store?.publicUrl || '').trim();
      const domains = Array.isArray(store?.domains) ? store.domains : [];
      const primaryDomain = domains.find((item) => item?.isPrimary) || domains[0] || null;
      const domainVerified = store?.isDefault || primaryDomain?.verified === true;
      const database = store?.database || null;
      const databaseReady = store?.isDefault || String(database?.status || '').toLowerCase() === 'ready';
      const domainLabel = store?.subdomain && rootDomain ? `${store.subdomain}.${rootDomain}` : (store?.primaryDomain || publicUrl || '-');
      return `<article class="adm-prod glass">
        <div class="adm-prod-top"><b>${esc(store?.name || 'ร้านใหม่')}</b><span>${storeStatusBadge(store)} ${databaseReady ? '<span class="status-badge s-paid">Database Ready</span>' : '<span class="status-badge s-awaiting_payment">Database Pending</span>'} ${domainVerified ? '<span class="status-badge s-paid">Domain Ready</span>' : '<span class="status-badge s-awaiting_payment">Domain Pending</span>'}</span></div>
        <div class="muted" style="margin:8px 0">${esc(domainLabel)}</div>
        <div class="meta-row">
          <small>storeId: ${esc(store?.id || '-')}</small>
          ${database?.databaseKey ? `<small>database: ${esc(database.databaseKey)}</small>` : ''}
          ${database?.namespace ? `<small>namespace: ${esc(database.namespace)}</small>` : ''}
          ${store?.subdomain ? `<small>subdomain: ${esc(store.subdomain)}</small>` : '<small>main store</small>'}
          ${primaryDomain?.host ? `<small>domain: ${esc(primaryDomain.host)}${primaryDomain.verified ? ' ready' : ' pending'}</small>` : ''}
          <small>${store?.createdAt ? esc(adminInboxTimeLabel(store.createdAt)) : '-'}</small>
        </div>
        <div class="pf-actions" style="margin-top:12px">
          ${publicUrl ? `<a class="btn btn-glass" href="${esc(publicUrl)}" target="_blank" rel="noopener">เปิดหน้าเว็บร้านนี้</a>` : ''}
          ${publicUrl ? `<button class="btn btn-glass" type="button" data-copystoreurl="${esc(publicUrl)}">คัดลอก URL</button>` : ''}
          ${store?.subdomain && !domainVerified ? `<button class="btn btn-glass" type="button" data-provisionstore="${esc(store.id || '')}">Retry Vercel Domain</button>` : ''}
        </div>
      </article>`;
    }).join('')}</div>`
    : '<div class="glass" style="padding:18px">ยังไม่มีร้านที่สร้างเพิ่มจากหลังบ้าน</div>';
  const selectedStoreId = adminSelectedStoreId();
  const selectedSettingsRes = await api(`/api/admin/stores/${encodeURIComponent(selectedStoreId)}/settings`).catch(() => null);
  const selectedSettingsData = selectedSettingsRes ? await selectedSettingsRes.json().catch(() => ({})) : {};
  const selectedStore = stores.find((store) => store.id === selectedStoreId) || selectedSettingsData.store || selectedAdminStore();
  const [selectedHealthData, selectedRolesData, selectedQaData] = await Promise.all([
    api(`/api/admin/stores/${encodeURIComponent(selectedStoreId)}/domain-health`).then((res) => res.json()).catch(() => ({})),
    api(`/api/admin/stores/${encodeURIComponent(selectedStoreId)}/roles`).then((res) => res.json()).catch(() => ({})),
    api('/api/admin/production-qa').then((res) => res.json()).catch(() => ({})),
  ]);
  const selectedStoreSettingsPanel = selectedSettingsRes?.ok ? renderSelectedStoreSettingsPanel(selectedSettingsData) : `<section class="glass" style="padding:18px;margin-top:18px"><b>ตั้งค่าร้านที่เลือก</b><p class="muted">โหลด settings ร้าน ${esc(selectedStoreId)} ไม่สำเร็จ</p></section>`;
  return adminLayout('stores', `<div class="admin-workspace admin-stores-ui"><div class="adm-head admin-lux-head"><div><span class="eyebrow">Multi-store Center</span><h2>Store Manager</h2><p class="muted">เปิดร้านใหม่ ตรวจโดเมน จัดสิทธิ์ และตั้งค่าร้านที่เลือกจากจุดเดียว</p></div><div class="admin-inline-actions"><button class="btn btn-glass" type="button" id="refreshStoresBtn">รีเฟรชรายการร้าน</button></div></div>
    <p class="form-note" style="margin:0 0 16px">ส่วนนี้ใช้สำหรับเปิดเว็บไซต์ใหม่จาก template เดิม โดย clone theme และ site settings เริ่มต้นจากเว็บหลัก แต่ให้ข้อมูลร้านใหม่เริ่มต้นว่าง พร้อมผูก subdomain ให้ทันทีในระดับ foundation</p>
    ${diagnosticsSection('ภาพรวมการเปิดร้าน', 'เช็กความพร้อมเรื่องโดเมนและจำนวนร้านก่อนกดสร้าง', setupCards)}
    <section class="glass" style="padding:18px;margin-top:18px">
      <div class="adm-head" style="margin:0 0 10px"><h3>สร้างร้านใหม่</h3><span class="muted">สร้างเสร็จจะได้ public URL ทันที</span></div>
      <form id="adminStoreCreateForm" class="set-form" style="padding:0;background:transparent;border:0">
        <label class="set-field">
          <span>ชื่อร้าน</span>
          <input id="storeNameInput" name="name" placeholder="เช่น June Glow Atelier" maxlength="80" required>
        </label>
        <label class="set-field">
          <span>Subdomain <em class="ok">ระบบจะช่วยแปลงจากชื่อร้านให้ แต่คุณแก้เองได้</em></span>
          <input id="storeSubdomainInput" name="subdomain" placeholder="june-glow" maxlength="32" autocomplete="off" required>
        </label>
        <label class="set-field">
          <span>Template / Clone</span>
          <select name="templateKey">
            <option value="blank">ร้านว่าง</option>
            <option value="agri">อาหารเสริมพืช</option>
            <option value="pod">พอต</option>
            <option value="course">คอร์สเรียน / แหล่งเรียนรู้</option>
          </select>
        </label>
        <label class="set-field">
          <span>Clone settings จากร้าน</span>
          <select name="cloneFromStoreId">
            <option value="">ไม่ clone</option>
            ${stores.map((store) => `<option value="${esc(store.id)}">${esc(store.name || store.id)}</option>`).join('')}
          </select>
        </label>
        <div id="storeSubdomainCheckResult">${renderStoreSubdomainCheck()}</div>
        <div class="pf-actions">
          <button class="btn btn-glass" type="button" id="checkStoreSubdomainBtn">เช็ก subdomain</button>
          <button class="btn btn-primary" type="submit">สร้างร้านใหม่</button>
        </div>
      </form>
      <div class="form-note" style="margin-top:12px">หลังสร้างแล้ว ร้านใหม่จะได้ค่าเริ่มต้นเช่นชื่อเว็บ, copy หน้าแรก, public URL และ database namespace ใหม่อัตโนมัติ ส่วนสินค้า/ออเดอร์/แชตของร้านใหม่จะเริ่มแยกว่างตาม <code>store_id</code></div>
    </section>
    ${renderStoreOnboardingPanel(selectedStore, selectedSettingsData, selectedQaData)}
    ${renderDomainHealthPanel(selectedStore, selectedHealthData)}
    ${selectedStoreSettingsPanel}
    ${renderStoreRolesPanel(selectedStore, selectedRolesData)}
    ${renderStoreBackupPanel(selectedStore)}
    ${diagnosticsSection('รายการร้าน', 'ดูร้านหลักและร้านที่สร้างเพิ่ม พร้อมเปิด URL ได้ทันที', storesHtml)}
    <section class="glass" style="padding:18px;margin-top:18px">
      <div class="adm-head" style="margin:0 0 10px"><h3>หมายเหตุ rollout</h3><span class="muted">สถานะของเฟส multi-tenant ตอนนี้</span></div>
      <div class="form-note" style="margin:0 0 10px">พร้อมแล้ว: registry ร้าน, domain mapping, per-store settings, public API ฝั่ง <code>site/products</code> และ API สร้างร้านจากหลังบ้าน</div>
      <div class="form-note" style="margin:0 0 10px">กำลังต่อในเฟสถัดไป: store switcher, scope หลังบ้านสินค้า/ออเดอร์/Inbox ต่อร้าน, และการแยก LINE OA / Payment / SMTP ต่อร้าน</div>
      <div class="form-note" style="margin:0">ถ้าใช้ production จริง ควรเปิด wildcard subdomain บน Vercel และ apply migration <code>003_multi_tenant_foundation.sql</code> ลง Supabase ก่อน</div>
    </section></div>`);
}
function renderConfigCenterStatus(lastApply = null, history = [], revisions = []) {
  const changedKeys = Array.isArray(lastApply?.changedKeys) ? lastApply.changedKeys : [];
  const checks = Array.isArray(lastApply?.checks) ? lastApply.checks : [];
  const actor = lastApply?.actor || {};
  const summary = lastApply
    ? `<div class="adm-head" style="margin:0 0 10px"><h3>Config Center</h3>${diagnosticsStateBadge(lastApply.status || 'info')}</div>
      <div class="muted" style="margin-bottom:12px">
        ${lastApply.checkedAt ? `ตรวจล่าสุด ${esc(adminInboxTimeLabel(lastApply.checkedAt))}` : 'ยังไม่มีผลตรวจล่าสุด'}
        ${actor?.email || actor?.name ? ` · โดย ${esc(actor.email || actor.name)}` : ''}
        ${lastApply.revisionId ? ` · revision ${esc(lastApply.revisionId)}` : ''}
      </div>
      <div class="meta-row" style="margin-bottom:12px">
        <small>Config Guard: ${lastApply?.validation?.ok ? 'ผ่าน' : 'พบจุดเสี่ยง'}</small>
        <small>${Math.max(0, Number(lastApply?.validation?.errorCount || 0))} error</small>
        <small>${Math.max(0, Number(lastApply?.validation?.warningCount || 0))} warning</small>
        ${changedKeys.length ? `<small>เปลี่ยน ${esc(changedKeys.join(', '))}</small>` : '<small>ไม่มี key ที่เปลี่ยน</small>'}
      </div>
      ${checks.length ? `<div class="adm-list">${checks.map((item) => `<article class="adm-prod glass">
        <div class="adm-prod-top"><b>${esc(item.label || item.key || 'check')}</b>${diagnosticsStateBadge(item.status || 'info')}</div>
        <div class="muted" style="margin-top:8px">${esc(item.note || '-')}</div>
      </article>`).join('')}</div>` : '<div class="glass" style="padding:18px">ยังไม่มีผลตรวจหลังการบันทึก</div>'}`
    : `<div class="adm-head" style="margin:0 0 10px"><h3>Config Center</h3>${diagnosticsStateBadge('warn')}</div>
      <div class="glass" style="padding:18px">ยังไม่มีประวัติการบันทึกและตรวจสอบล่าสุดจากหลังบ้าน</div>`;
  const compactHistory = Array.isArray(history) && history.length
    ? `<div class="form-note" style="margin-top:12px"><b>ประวัติล่าสุด:</b> ${history.slice(0, 3).map((item) => `${item?.revisionId || '-'} (${item?.status || 'info'})`).join(' · ')}</div>`
    : '';
  const revisionRows = Array.isArray(revisions) && revisions.length
    ? `<div class="adm-list" style="margin-top:14px">${revisions.slice(0, 6).map((item) => `<article class="adm-prod glass">
      <div class="adm-prod-top"><b>${esc(item.revisionId || '-')}</b>${item.rolledBackAt ? '<span class="status-badge">ย้อนกลับแล้ว</span>' : diagnosticsStateBadge('info')}</div>
      <div class="muted" style="margin:8px 0">${item.changedKeys?.length ? `เปลี่ยน ${esc(item.changedKeys.join(', '))}` : 'ไม่มี key ที่บันทึกไว้'}</div>
      <div class="meta-row"><small>${item.createdAt ? esc(adminInboxTimeLabel(item.createdAt)) : '-'}</small>${item.actor?.email || item.actor?.name ? `<small>${esc(item.actor.email || item.actor.name)}</small>` : ''}${item.reason ? `<small>${esc(item.reason)}</small>` : ''}</div>
      <div class="pf-actions" style="margin-top:12px">
        ${item.rolledBackAt ? `<span class="status-badge">rollback ${esc(adminInboxTimeLabel(item.rolledBackAt))}</span>` : `<button class="btn btn-glass" type="button" data-configrollback="${esc(item.revisionId || '')}">ย้อนกลับ revision นี้</button>`}
      </div>
    </article>`).join('')}</div>`
    : '<div class="glass" style="padding:18px;margin-top:14px">ยังไม่มี revision สำหรับ rollback</div>';
  return `<section class="glass" style="padding:18px;margin:16px 0">${summary}${compactHistory}
    <div class="adm-head" style="margin:18px 0 10px"><h3>Rollback Revision</h3><span class="muted">ย้อนค่าที่เพิ่งเปลี่ยนกลับได้ทันทีจาก revision ล่าสุด</span></div>
    ${revisionRows}
  </section>`;
}
function renderLineAdminBindingManager(lineAdmin = {}) {
  const primaryUserId = String(lineAdmin?.primaryUserId || '').trim();
  const bindings = Array.isArray(lineAdmin?.bindings) ? lineAdmin.bindings : [];
  const pendingCodes = Array.isArray(lineAdmin?.pendingCodes) ? lineAdmin.pendingCodes : [];
  const bindingRows = bindings.length
    ? `<div class="adm-list">${bindings.map((item) => `<article class="adm-prod glass">
      <div class="adm-prod-top"><b>${esc(item.name || `LINE-${String(item.lineUserId || '').slice(-6)}`)}</b>${item.lineUserId === primaryUserId ? '<span class="status-badge s-paid">Primary</span>' : diagnosticsStateBadge('ok')}</div>
      <div class="muted" style="margin:8px 0">${esc(item.lineUserId || '-')}</div>
      <div class="meta-row"><small>ผูกเมื่อ ${esc(adminInboxTimeLabel(item.lastBoundAt || item.grantedAt || 0))}</small>${item.label ? `<small>${esc(item.label)}</small>` : ''}${item.grantedBy ? `<small>โดย ${esc(item.grantedBy)}</small>` : ''}</div>
      <div class="pf-actions" style="margin-top:12px">
        ${item.lineUserId === primaryUserId ? '' : `<button class="btn btn-glass" type="button" data-lineadminprimary="${esc(item.lineUserId)}">ตั้งเป็น Primary</button>`}
        <button class="btn btn-glass" type="button" data-lineadminrevoke="${esc(item.lineUserId)}">ถอดสิทธิ์</button>
      </div>
    </article>`).join('')}</div>`
    : '<div class="glass" style="padding:18px">ยังไม่มีบัญชี LINE ที่ผูกเป็นแอดมิน</div>';
  const codeRows = pendingCodes.length
    ? `<div class="adm-list">${pendingCodes.map((item) => `<article class="adm-prod glass">
      <div class="adm-prod-top"><b>${esc(item.code || '-')}</b><span>${esc(adminInboxTimeLabel(item.expiresAt || 0))}</span></div>
      <div class="muted" style="margin:8px 0">ส่งคำสั่ง <code>bindadminddd ${esc(item.code || '')}</code> ใน LINE OA ภายใน 10 นาที</div>
      <div class="meta-row">${item.label ? `<small>${esc(item.label)}</small>` : ''}${item.createdBy ? `<small>สร้างโดย ${esc(item.createdBy)}</small>` : ''}</div>
      <div class="pf-actions" style="margin-top:12px">
        <button class="btn btn-glass" type="button" data-copybindcommand="${esc(item.code || '')}">คัดลอกคำสั่ง</button>
        <button class="btn btn-glass" type="button" data-revokebindcode="${esc(item.code || '')}">ยกเลิกรหัสนี้</button>
      </div>
    </article>`).join('')}</div>`
    : '<div class="glass" style="padding:18px">ยังไม่มีรหัสผูกแอดมินที่รอใช้งาน</div>';
  return `<section class="glass" style="padding:18px;margin:16px 0">
    <div class="adm-head" style="margin:0 0 10px"><h3>LINE Admin Manager</h3>${bindings.length ? diagnosticsStateBadge('ok') : diagnosticsStateBadge('warn')}</div>
    <p class="form-note" style="margin:0 0 12px">ใช้สำหรับผูกแอดมิน LINE OA แบบปลอดภัย ไม่ต้องแจก token หรือ secret ให้ทีมงาน</p>
    <div class="set-field" style="margin-bottom:12px">
      <span>Label สำหรับรหัสผูกแอดมิน</span>
      <input id="lineAdminBindLabel" placeholder="เช่น แอดมินหลัก / ผู้ช่วยดูระบบ">
    </div>
    <div class="pf-actions" style="margin-bottom:16px">
      <button class="btn btn-primary" type="button" id="generateLineAdminBindCodeBtn">สร้างรหัสผูกแอดมิน</button>
    </div>
    <div class="adm-head" style="margin-top:0"><h3>บัญชีที่ผูกแล้ว</h3><span class="muted">${bindings.length ? `ทั้งหมด ${bindings.length} บัญชี` : 'ยังไม่มีบัญชีที่ผูก'}</span></div>
    ${bindingRows}
    <div class="adm-head" style="margin-top:18px"><h3>รหัสที่รอใช้งาน</h3><span class="muted">${pendingCodes.length ? 'หมดอายุอัตโนมัติภายใน 10 นาที' : 'สร้างได้จากปุ่มด้านบน'}</span></div>
    ${codeRows}
  </section>`;
}
function diagnosticsStateBadge(status = 'info') {
  const key = String(status || 'info').trim().toLowerCase();
  if (key === 'ok') return '<span class="status-badge s-paid">พร้อม</span>';
  if (key === 'error') return '<span class="status-badge s-cancelled">ผิดพลาด</span>';
  if (key === 'warn') return '<span class="status-badge s-awaiting_payment">เตือน</span>';
  return '<span class="status-badge">ข้อมูล</span>';
}
function diagnosticsHealthBadge(ok = false, okLabel = 'พร้อม', badLabel = 'ต้องตรวจ') {
  return ok
    ? `<span class="status-badge s-paid">${okLabel}</span>`
    : `<span class="status-badge s-awaiting_payment">${badLabel}</span>`;
}
function diagnosticsMetricCard(title, badge, desc = '', foot = '') {
  return `<article class="glass" style="padding:18px">
    <div class="adm-prod-top"><b>${esc(title)}</b>${badge}</div>
    <div class="muted" style="margin-top:8px">${esc(desc || '-')}</div>
    ${foot ? `<div class="meta-row" style="margin-top:10px"><small>${esc(foot)}</small></div>` : ''}
  </article>`;
}
function diagnosticsSection(title = '', desc = '', body = '') {
  return `<section style="margin-top:22px">
    <div class="adm-head"><h3>${esc(title)}</h3><span class="muted">${esc(desc || '')}</span></div>
    ${body}
  </section>`;
}
function diagnosticsCompactSection(title = '', desc = '', body = '', options = {}) {
  return `<details class="diagnostics-fold glass" ${options.open ? 'open' : ''}>
    <summary>
      <span><b>${esc(title)}</b><small>${esc(desc || '')}</small></span>
      <em>${options.open ? 'เปิดอยู่' : 'กดดูรายละเอียด'}</em>
    </summary>
    <div class="diagnostics-fold-body">${body}</div>
  </details>`;
}
function diagnosticsEventRows(items = [], emptyText = 'ยังไม่มีข้อมูลล่าสุด') {
  if (!Array.isArray(items) || !items.length) return `<div class="glass" style="padding:18px">${esc(emptyText)}</div>`;
  return `<div class="adm-list">${items.map((item) => `<article class="adm-prod glass">
    <div class="adm-prod-top"><b>${esc(item.source || item.type || 'system')}</b><span>${esc(adminInboxTimeLabel(item.at))}</span></div>
    <div class="muted" style="margin:8px 0">${esc(item.message || '-')}</div>
    <div class="meta-row">${diagnosticsStateBadge(item.level || item.status || 'info')}<small>${esc(item.type || '')}</small></div>
  </article>`).join('')}</div>`;
}
function diagnosticsValidationRows(items = []) {
  if (!Array.isArray(items) || !items.length) return '<div class="glass" style="padding:18px">ยังไม่มีผล validation</div>';
  return `<div class="adm-list">${items.map((item) => `<article class="adm-prod glass">
    <div class="adm-prod-top"><b>${esc(item.label || item.key || 'config')}</b>${diagnosticsStateBadge(item.status || 'info')}</div>
    <div class="muted" style="margin:8px 0">${esc(item.note || 'ไม่มีหมายเหตุ')}</div>
    <div class="meta-row"><small>key: ${esc(item.key || '-')}</small><small>source: ${esc(item.source || '-')}</small>${item.value ? `<small>value: ${esc(item.value)}</small>` : ''}</div>
  </article>`).join('')}</div>`;
}
function diagnosticsAuditRows(items = []) {
  if (!Array.isArray(items) || !items.length) return '<div class="glass" style="padding:18px">ยังไม่มี webhook audit ล่าสุด</div>';
  return `<div class="adm-list">${items.map((item) => `<article class="adm-prod glass">
    <div class="adm-prod-top"><b>${esc(item.eventType || 'event')} · ${esc(item.result || '-')}</b><span>${esc(adminInboxTimeLabel(item.at))}</span></div>
    <div class="muted" style="margin:8px 0">${esc(item.textPreview || item.note || 'ไม่มีข้อความตัวอย่าง')}</div>
    <div class="meta-row"><small>${esc(item.messageType || 'no-message-type')}</small><small>${esc(item.sourceKey || '-')}</small><small>${Math.max(0, Number(item.durationMs || 0))} ms</small>${item.error ? `<small>${esc(item.error)}</small>` : ''}</div>
  </article>`).join('')}</div>`;
}
function productionQaDashboard(qa = {}) {
  if (!qa?.ok) return `<div class="glass" style="padding:18px">โหลด Live Production QA ไม่สำเร็จ${qa?.error ? `: ${esc(qa.error)}` : ''}</div>`;
  const checklist = qa.checklist || {};
  const systems = Array.isArray(qa.systems) ? qa.systems : [];
  const items = Array.isArray(checklist.items) ? checklist.items : [];
  const counts = qa.counts || {};
  const share = qa.sharePreview || {};
  const domain = qa.domain || {};
  const latest = qa.latest || {};
  const score = Math.max(0, Math.min(100, Number(checklist.percent || 0)));
  const statusLabel = checklist.status === 'ready' ? 'พร้อมเปิดจริง' : checklist.status === 'almost' ? 'เกือบพร้อม' : 'ต้องตั้งค่าต่อ';
  const systemCards = systems.map((item) => diagnosticsMetricCard(item.label || item.key, diagnosticsStateBadge(item.status || 'info'), item.detail || '-', item.key || '')).join('');
  const checklistRows = items.map((item) => `<a class="qa-check-row ${item.status === 'ok' ? 'done' : item.status === 'warn' ? 'warn' : 'error'}" href="${routeHref(item.href || '/admin/diagnostics')}">
    <span>${item.status === 'ok' ? '✓' : item.status === 'warn' ? '!' : '×'}</span>
    <b>${esc(item.label || item.key)}</b>
    <small>${esc(item.detail || '')}</small>
  </a>`).join('');
  const shareCard = `<div class="qa-share-card">
    <div class="qa-share-image">${share.image ? `<img src="${esc(share.image)}" alt="share preview">` : '<span>ไม่มีรูปแชร์</span>'}</div>
    <div class="qa-share-body"><b>${esc(share.title || 'ยังไม่มีหัวข้อแชร์')}</b><p>${esc(share.desc || 'ยังไม่มีคำอธิบาย')}</p><small>${esc(share.url || domain.publicUrl || '-')}</small></div>
  </div>`;
  return `<section class="qa-dashboard">
    <div class="qa-hero glass">
      <div>
        <span class="eyebrow">Live Production QA</span>
        <h3>${esc(qa.store?.name || 'ร้านที่เลือก')}</h3>
        <p class="muted">ตรวจสถานะเว็บจริงของร้านที่เลือก: โดเมน SSL LINE webhook ฐานข้อมูล สินค้า ออเดอร์ และการ์ดแชร์</p>
      </div>
      <div class="qa-score">
        <strong>${score}%</strong>
        <span>${esc(statusLabel)}</span>
        <div class="launch-progress"><span style="width:${score}%"></span></div>
      </div>
    </div>
    <div class="qa-counts">
      ${diagnosticsMetricCard('Products', diagnosticsStateBadge(counts.products > 0 ? 'ok' : 'warn'), `${Math.max(0, Number(counts.products || 0))} รายการ`, 'ควรมีสินค้าอย่างน้อย 1 รายการ')}
      ${diagnosticsMetricCard('Orders', diagnosticsStateBadge(counts.orders > 0 ? 'ok' : 'warn'), `${Math.max(0, Number(counts.orders || 0))} รายการล่าสุด`, latest.order?.id ? `ล่าสุด ${latest.order.id}` : 'ยังไม่พบออเดอร์')}
      ${diagnosticsMetricCard('Leads / Inbox', diagnosticsStateBadge(counts.leads > 0 ? 'ok' : 'info'), `${Math.max(0, Number(counts.leads || 0))} leads`, 'ใช้ดูความพร้อมด้านลูกค้าทักเข้ามา')}
      ${diagnosticsMetricCard('Share Link', diagnosticsStateBadge(share.title && share.image ? 'ok' : 'warn'), share.title || 'missing title', share.url || domain.publicUrl || '')}
    </div>
    <div class="qa-two-col">
      <article class="glass" style="padding:18px">
        <div class="adm-head" style="margin:0 0 12px"><h3>Launch Checklist</h3><span class="muted">${Math.max(0, Number(checklist.done || 0))}/${Math.max(0, Number(checklist.total || 0))} ผ่านแล้ว</span></div>
        <div class="qa-check-list">${checklistRows || '<div class="form-note">ยังไม่มี checklist</div>'}</div>
      </article>
      <article class="glass" style="padding:18px">
        <div class="adm-head" style="margin:0 0 12px"><h3>Share Preview</h3><span class="muted">สิ่งที่ LINE/Facebook จะเห็นจาก HTML source</span></div>
        ${shareCard}
        <div class="pf-actions" style="margin-top:14px">
          ${domain.publicUrl ? `<a class="btn btn-primary" href="${esc(domain.publicUrl)}" target="_blank" rel="noopener">เปิดหน้าร้าน</a>` : ''}
          <a class="btn btn-glass" href="${routeHref('/admin/site')}">แก้ข้อมูลร้าน</a>
        </div>
      </article>
    </div>
    <section class="glass" style="padding:18px;margin-top:18px">
      <div class="adm-head" style="margin:0 0 12px"><h3>Smoke Test Command</h3><span class="muted">รันกับ preview/production ก่อนเปิดขายจริง</span></div>
      <code class="qa-command">${esc(qa.smokeCommand || 'npm run verify:multistore')}</code>
    </section>
    ${diagnosticsCompactSection('Live System Status', 'โดเมน ฐานข้อมูล LINE Payment และ share preview', `<div class="adm-list">${systemCards}</div>`)}
  </section>`;
}
async function viewAdminDiagnostics() {
  if (!adminGuard()) return loadingView();
  await ensureAdminStoresContext();
  const [data, richMenu, productionQa] = await Promise.all([
    (await api('/api/admin/diagnostics')).json(),
    api('/api/admin/line/rich-menu/status').then((r) => r.json()).catch(() => ({ ok: false, error: 'load rich menu failed' })),
    api('/api/admin/production-qa').then((r) => r.json()).catch((err) => ({ ok: false, error: err?.message || 'load production qa failed' })),
  ]);
  const health = data.health || {};
  const startup = data.startupValidation || {};
  const current = data.currentValidation || {};
  const runtime = data.runtime || {};
  const counters = runtime.webhook?.counters || {};
  const overviewCards = [
    diagnosticsMetricCard('Config Guard', diagnosticsHealthBadge(Boolean(health.configGuardOk), 'พร้อม', 'พบจุดเสี่ยง'), 'ตรวจ config ตอนบูตและหลังอัปเดต', `${Math.max(0, Number(health.configGuardErrorCount || 0))} error · ${Math.max(0, Number(health.configGuardWarningCount || 0))} warning`),
    diagnosticsMetricCard('LINE OA', diagnosticsHealthBadge(Boolean(health.lineConfigured), 'เชื่อมแล้ว', 'ยังไม่พร้อม'), 'สถานะ token/secret สำหรับ LINE OA', `line-room ${health.lineWebRoomReady ? 'พร้อม' : 'ยังไม่พร้อม'}`),
    diagnosticsMetricCard('Realtime', diagnosticsHealthBadge(String(health.chatRealtimeMode || '') !== 'polling', 'Realtime', 'Polling'), 'โหมดส่งข้อมูล live chat/inbox ปัจจุบัน', String(health.chatRealtimeMode || '-')),
    diagnosticsMetricCard('Webhook Audit', diagnosticsHealthBadge(Math.max(0, Number(counters.failed || 0)) === 0, 'นิ่ง', 'มี fail ล่าสุด'), 'ภาพรวม event ล่าสุดจาก LINE webhook', `recv ${Math.max(0, Number(counters.received || 0))} · dup ${Math.max(0, Number(counters.duplicate || 0))} · ok ${Math.max(0, Number(counters.success || 0))}`),
    diagnosticsMetricCard('Payments', diagnosticsHealthBadge(Boolean(health.promptpayConfigured || health.stripeConfigured), 'มีพร้อมใช้งาน', 'ต้องตรวจเพิ่ม'), 'PromptPay / Stripe / SlipOK', `promptpay ${health.promptpayConfigured ? 'on' : 'off'} · stripe ${health.stripeConfigured ? 'on' : 'off'} · slipok ${health.slipokConfigured ? 'on' : 'off'}`),
    diagnosticsMetricCard('Infrastructure', diagnosticsHealthBadge(Boolean(health.supabaseConfigured), 'พร้อม', 'ต้องตรวจ'), 'ฐานข้อมูลและ runtime ปัจจุบัน', `${health.dbProvider || '-'} · ${health.supabaseConfigured ? 'supabase ready' : 'supabase missing'}`),
  ].join('');
  const validationGrid = `<div class="adm-list">
    <article class="glass" style="padding:18px">
      <div class="adm-head" style="margin:0 0 12px"><h3>Startup Validation</h3><span class="muted">${startup.checkedAt ? `เช็ก ${adminInboxTimeLabel(startup.checkedAt)}` : 'ยังไม่มี snapshot ตอนบูต'}</span></div>
      ${diagnosticsValidationRows(startup.items || [])}
    </article>
    <article class="glass" style="padding:18px">
      <div class="adm-head" style="margin:0 0 12px"><h3>Current Validation</h3><span class="muted">${current.checkedAt ? `อัปเดต ${adminInboxTimeLabel(current.checkedAt)}` : 'ยังไม่มีข้อมูลล่าสุด'}</span></div>
      ${diagnosticsValidationRows(current.items || [])}
    </article>
  </div>`;
  const webhookSummary = `<div class="adm-list">
    ${diagnosticsMetricCard('Received', diagnosticsStateBadge('info'), 'จำนวน event ที่เข้ามาในช่วง audit ล่าสุด', String(Math.max(0, Number(counters.received || 0))))}
    ${diagnosticsMetricCard('Success', diagnosticsStateBadge('ok'), 'จำนวน event ที่ประมวลผลสำเร็จ', String(Math.max(0, Number(counters.success || 0))))}
    ${diagnosticsMetricCard('Duplicate', diagnosticsStateBadge('warn'), 'จำนวน event ซ้ำที่ระบบกันไว้แล้ว', String(Math.max(0, Number(counters.duplicate || 0))))}
    ${diagnosticsMetricCard('Failed', diagnosticsStateBadge(Math.max(0, Number(counters.failed || 0)) > 0 ? 'error' : 'ok'), 'จำนวน event ที่ fail จริง', String(Math.max(0, Number(counters.failed || 0))))}
  </div>`;
  const richAssets = Array.isArray(richMenu.assets) ? richMenu.assets : [];
  const richAliases = Array.isArray(richMenu.aliases) ? richMenu.aliases : [];
  const richMenuBody = `<div class="adm-list">
    ${diagnosticsMetricCard('LINE Token', diagnosticsHealthBadge(Boolean(richMenu.configured), 'Ready', 'Missing'), 'Token for creating and uploading LINE rich menu', richMenu.configured ? 'configured' : 'missing token')}
    ${diagnosticsMetricCard('Assets', diagnosticsHealthBadge(richAssets.every((item) => item.jsonReady && item.imageReady), 'Ready', 'Missing'), 'Home/Catalog JSON and PNG assets', `${richAssets.filter((item) => item.jsonReady && item.imageReady).length}/${richAssets.length || 2} ready`)}
    ${diagnosticsMetricCard('Aliases', diagnosticsHealthBadge(richAliases.length >= 2, 'Ready', 'Pending'), 'line-home / line-catalog aliases', richAliases.map((item) => item.richMenuAliasId).join(', ') || richMenu.error || 'not deployed')}
  </div>
  <div class="pf-actions" style="margin-top:14px"><button class="btn btn-primary" type="button" id="deployLineRichMenuBtn">Deploy LINE Rich Menu</button></div>`;
  const foldedSections = `<div class="diagnostics-fold-grid">
    ${diagnosticsCompactSection('ภาพรวมระบบ', 'สถานะหลักที่ต้องดูทุกวัน', `<div class="adm-list">${overviewCards}</div>`, { open: true })}
    ${diagnosticsCompactSection('การตรวจตั้งค่า', 'ผลตอนบูตและผลตรวจล่าสุด', validationGrid)}
    ${diagnosticsCompactSection('LINE Rich Menu', 'ตรวจ assets และ deploy เมนู LINE', richMenuBody)}
    ${diagnosticsCompactSection('LINE Webhook', 'event, duplicate, failed ล่าสุด', `${webhookSummary}${diagnosticsAuditRows(runtime.webhook?.audits || [])}`)}
    ${diagnosticsCompactSection('Alerts และ Events', 'เหตุเสี่ยงและ trace ระบบย้อนหลัง', `<div class="adm-list">
      <article class="glass" style="padding:18px">
        <div class="adm-head" style="margin:0 0 12px"><h3>Recent Alerts</h3><span class="muted">แจ้งเตือนที่เสี่ยงต่อ production</span></div>
        ${diagnosticsEventRows(runtime.recentAlerts || [], 'ยังไม่มี alert ล่าสุด')}
      </article>
      <article class="glass" style="padding:18px">
        <div class="adm-head" style="margin:0 0 12px"><h3>Recent Events</h3><span class="muted">event ระดับระบบสำหรับ debug</span></div>
        ${diagnosticsEventRows(runtime.recentEvents || [], 'ยังไม่มี event ล่าสุด')}
      </article>
    </div>`)}
  </div>`;
  return adminLayout('diagnostics', `<div class="admin-workspace admin-diagnostics-ui diagnostics-compact"><div class="adm-head admin-lux-head"><div><span class="eyebrow">Health Center</span><h2>System Diagnostics</h2><p class="muted">ตรวจสุขภาพระบบและจุดที่ต้องแก้จากหน้าเดียว โดยรายละเอียดรองถูกพับไว้ให้เปิดดูเฉพาะเวลาต้องใช้</p></div></div>
    <div class="pf-actions diagnostics-actions" style="margin-bottom:16px"><button class="btn btn-primary" type="button" id="runDiagnosticsRecheckBtn">Re-check Config</button><button class="btn btn-glass" type="button" id="refreshDiagnosticsBtn">รีเฟรชหน้านี้</button><a class="btn btn-glass" href="${routeHref('/admin/settings')}">ไปหน้าตั้งค่า</a><a class="btn btn-glass" href="${routeHref('/admin/stores')}">Store Manager</a></div>
    ${diagnosticsSection('Live Production QA', 'หน้าเดียวสำหรับเช็กความพร้อมหลัง deploy และก่อนเปิดร้านใหม่', productionQaDashboard(productionQa))}
    ${foldedSections}
  </div>`);
}
function cropStageLines(stages) {
  return asArray(stages).map((stage) => `${stage.title} :: ${stage.detail} :: ${asArray(stage.ids).join(', ')}`).join('\n');
}
const ADMIN_CROP_DRAFT_KEY = 'adminCropLandingDraft_v1';
const REVIEW_TEMPLATES = [
  { key: 'before-after', label: 'ก่อนและหลังใช้', title: (crop) => `ก่อนและหลังใช้สูตร${crop || 'พืช'}`, note: (crop) => `แสดงผลลัพธ์ก่อนและหลังใช้กับ${crop || 'แปลงจริง'}ให้เห็นชัดเจน` },
  { key: 'orchard-result', label: 'ผลลัพธ์ในสวน', title: (crop) => `ผลลัพธ์จากสวน${crop || 'ลูกค้า'}`, note: (crop) => `สรุปสิ่งที่ดีขึ้นหลังใช้สูตรกับ${crop || 'แปลงลูกค้า'}` },
  { key: 'problem-solved', label: 'แก้ปัญหาหน้างาน', title: (crop) => `รีวิวการแก้ปัญหา${crop || 'หน้างาน'}`, note: () => 'เช่น ใบซีด ฟื้นต้น เร่งใบ บำรุงผล หรือช่วยให้ต้นสมบูรณ์ขึ้น' },
  { key: 'sales-th', label: 'ไทยเชิงขาย', title: (crop) => `${crop || 'พืช'}ตอบโจทย์ขึ้นหลังใช้ต่อเนื่อง`, note: () => 'เหมาะใช้เป็น caption สั้นสำหรับหน้าเว็บหรือยิงแอดแบบเน้นผลลัพธ์' },
  { key: 'eng-short', label: 'English Short', title: (crop) => `${crop || 'Crop'} review from customer plot`, note: () => 'Short proof note for bilingual landing pages or ads.' },
];
function currentCropCardSlugs(excludeCard = null) {
  return new Set([...document.querySelectorAll('[data-crop-card]')]
    .filter((card) => card !== excludeCard)
    .map((card) => slugifyCrop((card.querySelector('[data-field="slug"]')?.value || '').trim() || (card.querySelector('[data-field="crop"]')?.value || '').trim()))
    .filter(Boolean));
}
function uniqueCropSlug(base, excludeCard = null) {
  const used = currentCropCardSlugs(excludeCard);
  const root = slugifyCrop(base) || 'crop';
  if (!used.has(root)) return root;
  let i = 2;
  while (used.has(`${root}-${i}`)) i += 1;
  return `${root}-${i}`;
}
function updateSeoImagePreview(card, image = '') {
  const input = card?.querySelector('[data-field="seoImage"]');
  const hidden = card?.querySelector('[data-seoimage-value]');
  const preview = card?.querySelector('[data-seoimagepreview]');
  const value = String(image || '').trim();
  if (hidden) hidden.value = value;
  if (input && input.value !== value && !isTransientImageValue(value)) input.value = value;
  if (input && isTransientImageValue(value)) input.value = '';
  if (preview) {
    preview.classList.toggle('is-empty', !value);
    preview.innerHTML = value ? `<img src="${esc(value)}" alt="SEO preview">` : '<span>ยังไม่มีภาพ SEO</span>';
  }
}
function openCropPreviewPane(draft) {
  const normalizedDraft = normalizeCropLandingEntry(draft?.slug || '', draft || {});
  const signature = JSON.stringify(normalizedDraft);
  localStorage.setItem('cropLandingPreviewDraft', signature);
  const frame = document.getElementById('cropPreviewFrame');
  const link = document.getElementById('cropPreviewOpenNew');
  const title = document.getElementById('cropPreviewTitle');
  if (!normalizedDraft.slug) {
    if (frame) frame.removeAttribute('src');
    if (link) link.href = '#';
    if (title) title.textContent = 'ดูตัวอย่างหน้าเฉพาะพืช';
    lastCropPreviewSignature = '';
    pendingCropPreviewDraft = null;
    cropPreviewFrameLoading = false;
    return;
  }
  const previewUrl = `/crops/${encodeURIComponent(normalizedDraft.slug)}?preview=1`;
  if (signature === lastCropPreviewSignature) {
    if (link) link.href = previewUrl;
    if (title) title.textContent = normalizedDraft.crop ? `กำลังดูตัวอย่าง: ${normalizedDraft.crop}` : 'ดูตัวอย่างหน้าเฉพาะพืช';
    return;
  }
  if (frame) ensureCropPreviewFrameEvents(frame);
  if (cropPreviewFrameLoading) {
    pendingCropPreviewDraft = normalizedDraft;
    if (link) link.href = previewUrl;
    if (title) title.textContent = normalizedDraft.crop ? `กำลังดูตัวอย่าง: ${normalizedDraft.crop}` : 'ดูตัวอย่างหน้าเฉพาะพืช';
    return;
  }
  lastCropPreviewSignature = signature;
  cropPreviewFrameLoading = true;
  if (frame) frame.src = `${previewUrl}&t=${Date.now()}`;
  if (link) link.href = previewUrl;
  if (title) title.textContent = normalizedDraft.crop ? `กำลังดูตัวอย่าง: ${normalizedDraft.crop}` : 'ดูตัวอย่างหน้าเฉพาะพืช';
}
let cropPreviewTimer = null;
let cropPreviewFrameLoading = false;
let pendingCropPreviewDraft = null;
function flushPendingCropPreview() {
  if (!pendingCropPreviewDraft) return;
  const nextDraft = pendingCropPreviewDraft;
  pendingCropPreviewDraft = null;
  openCropPreviewPane(nextDraft);
}
function ensureCropPreviewFrameEvents(frame) {
  if (!frame || frame.dataset.previewBound === '1') return;
  frame.dataset.previewBound = '1';
  const release = () => {
    cropPreviewFrameLoading = false;
    flushPendingCropPreview();
  };
  frame.addEventListener('load', release);
  frame.addEventListener('error', release);
}
async function scheduleCropPreview(card, wait = 220) {
  if (!card || currentPath() !== '/admin/site') return;
  clearTimeout(cropPreviewTimer);
  cropPreviewTimer = setTimeout(async () => {
    try {
      const draft = await collectCropLandingCardData(card, { uploadFiles: false });
      openCropPreviewPane(draft);
    } catch {}
  }, wait);
}
function focusCropCard(card, { preview = true } = {}) {
  if (!card) return;
  card.classList.add('is-focused');
  setTimeout(() => card.classList.remove('is-focused'), 1800);
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  card.querySelector('[data-field="crop"]')?.focus();
  if (preview) scheduleCropPreview(card, 60);
}
function setCropPreviewDevice(device = 'desktop') {
  const shell = document.querySelector('.crop-preview-shell');
  if (!shell) return;
  shell.dataset.device = device;
  document.querySelectorAll('[data-previewdevice]').forEach((btn) => btn.classList.toggle('on', btn.dataset.previewdevice === device));
}
function jumpToSiteSection(sectionId = '') {
  // โหมดแท็บ (หน้าข้อมูลร้านแบบใหม่) — สลับหมวดแทนการ scroll
  if (document.querySelector('.site-admin-tabs')) {
    activateSiteSection(sectionId);
    const toolbar = document.querySelector('.site-admin-toolbar');
    if (toolbar) {
      const top = window.scrollY + toolbar.getBoundingClientRect().top - 14;
      if (window.scrollY > top) window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
    return;
  }
  const target = document.getElementById(sectionId);
  if (!target) return;
  if (target.matches('.site-panel')) target.open = true;
  const toolbar = document.querySelector('.site-admin-toolbar');
  const toolbarRect = toolbar?.getBoundingClientRect();
  const toolbarHeight = toolbarRect?.height || 0;
  const extraOffset = window.innerWidth <= 760 ? 16 : 22;
  const targetTop = window.scrollY + target.getBoundingClientRect().top - toolbarHeight - extraOffset;
  window.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
  target.classList.add('is-focused');
  setTimeout(() => target.classList.remove('is-focused'), 1600);
}
const SITE_ADMIN_ACTIVE_SECTION_KEY = 'adminSiteActiveSection:v1';
function activateSiteSection(sectionId = '') {
  const panels = [...document.querySelectorAll('.site-admin-tabs .site-tab-panel')];
  if (!panels.length) return;
  let target = String(sectionId || '').replace(/^site-section-/, '');
  if (!panels.some((panel) => panel.dataset.section === target)) target = panels[0].dataset.section;
  panels.forEach((panel) => panel.classList.toggle('is-active', panel.dataset.section === target));
  document.querySelectorAll('[data-sitejump]').forEach((btn) => {
    btn.classList.toggle('on', String(btn.dataset.sitejump || '').replace(/^site-section-/, '') === target);
  });
  try { localStorage.setItem(SITE_ADMIN_ACTIVE_SECTION_KEY, target); } catch {}
}
function sitePreviewLines(raw = '') {
  return String(raw || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
function updateSiteAdminPreviews() {
  const form = document.getElementById('settingsForm');
  if (!form || !document.querySelector('.site-admin-tabs')) return;
  const val = (name) => String(form.querySelector(`[name="${name}"]`)?.value || '').trim();
  document.querySelectorAll('.site-admin-tabs [data-pv]').forEach((el) => {
    el.textContent = val(el.dataset.pv) || el.dataset.pvEmpty || '';
  });
  const shipRows = document.getElementById('pvShipRows');
  if (shipRows) {
    const home = val('SHIP_HOME') || 'ไทย';
    const fee = parseInt(val('SHIP_FEE'), 10) || 0;
    const intl = parseInt(val('SHIP_INTL_FEE'), 10) || 0;
    const freeOver = parseInt(val('SHIP_FREE_OVER'), 10) || 0;
    const sample = 500;
    const sampleFree = freeOver > 0 && sample >= freeOver;
    shipRows.innerHTML = [
      `<div class="mock-li">🚚 ส่งใน${esc(home)}: <b>฿${fee.toLocaleString()}</b></div>`,
      `<div class="mock-li">✈️ ส่งต่างประเทศ: <b>฿${intl.toLocaleString()}</b></div>`,
      freeOver > 0
        ? `<div class="mock-li">🎁 สั่งครบ <b>฿${freeOver.toLocaleString()}</b> ส่งฟรีทันที</div>`
        : '<div class="mock-li muted">ยังไม่เปิดโปรส่งฟรี (ใส่ 0)</div>',
      `<div class="mock-li muted">ตัวอย่าง: ลูกค้าใน${esc(home)} สั่ง ฿${sample.toLocaleString()} → ${sampleFree ? 'ส่งฟรี' : `ค่าส่ง ฿${fee.toLocaleString()}`} รวม ฿${(sample + (sampleFree ? 0 : fee)).toLocaleString()}</div>`,
    ].join('');
  }
  const saleBanner = document.getElementById('pvSaleBanner');
  if (saleBanner) {
    const pct = Math.max(0, Math.min(90, parseInt(val('SALE_PERCENT'), 10) || 0));
    const live = val('SALE_ACTIVE') === '1' && pct > 0;
    saleBanner.classList.toggle('off', !live);
    saleBanner.textContent = live ? `${val('SALE_TEXT') || 'FLASH SALE ⚡'} ลด ${pct}% ทั้งร้าน` : 'ปิดอยู่ — เว็บแสดงราคาปกติ';
    const price = document.getElementById('pvSalePrice');
    if (price) {
      const after = Math.max(1, Math.round(1000 * (1 - pct / 100)));
      price.innerHTML = live
        ? `ตัวอย่างสินค้าราคา ฿1,000 → เหลือ <b>฿${after.toLocaleString()}</b> <s>฿1,000</s>${val('SALE_ENDS') ? `<br><span class="muted">นับถอยหลังถึง ${esc(val('SALE_ENDS').replace('T', ' '))}</span>` : ''}`
        : 'สินค้าทุกชิ้นแสดงราคาเต็มตามปกติ';
    }
  }
  const chips = document.getElementById('pvMarketingChips');
  if (chips) {
    chips.innerHTML = [['GA4_ID', 'Google Analytics'], ['META_PIXEL_ID', 'Meta Pixel'], ['TIKTOK_PIXEL_ID', 'TikTok Pixel']]
      .map(([key, label]) => `<span class="mock-chip ${val(key) ? 'on' : ''}">${val(key) ? '✓' : '·'} ${label} ${val(key) ? 'ติดตั้งแล้ว' : 'ยังไม่ตั้ง'}</span>`)
      .join('');
  }
  const statGrid = document.getElementById('pvStatsGrid');
  if (statGrid) {
    const autoLabel = (raw) => (String(raw).toLowerCase() === 'auto' ? 'อัตโนมัติ' : (esc(raw) || '0'));
    statGrid.innerHTML = [
      [`${(parseInt(val('SITE_STAT_FARMERS'), 10) || 0).toLocaleString()}+`, 'เกษตรกรไว้วางใจ'],
      [autoLabel(val('SITE_STAT_PRODUCTS')), 'ผลิตภัณฑ์'],
      [autoLabel(val('SITE_STAT_RATING')), 'คะแนนรีวิวเฉลี่ย'],
      [`${parseInt(val('SITE_STAT_ONTIME'), 10) || 0}%`, 'ส่งตรงเวลา'],
    ].map(([num, label]) => `<div class="mock-stat"><b>${num}</b><span>${label}</span></div>`).join('');
  }
  const trust = document.getElementById('pvTrustList');
  if (trust) {
    trust.innerHTML = sitePreviewLines(val('SITE_TRUST_ITEMS')).slice(0, 6).map((line) => `<div class="mock-li">✓ ${esc(line)}</div>`).join('')
      || '<div class="mock-li muted">ยังไม่มีข้อมูล</div>';
  }
  const cases = document.getElementById('pvCaseList');
  if (cases) {
    cases.innerHTML = sitePreviewLines(val('SITE_CASE_STUDIES')).slice(0, 4).map((line) => {
      const [title, detail = ''] = line.split('::').map((part) => part.trim());
      return `<div class="mock-li"><b>${esc(title)}</b>${detail ? ` — ${esc(detail)}` : ''}</div>`;
    }).join('') || '<div class="mock-li muted">ยังไม่มีข้อมูล</div>';
  }
  const checkout = document.getElementById('pvCheckoutList');
  if (checkout) {
    checkout.innerHTML = sitePreviewLines(val('SITE_CHECKOUT_POINTS')).slice(0, 5).map((line) => `<div class="mock-li">🛡️ ${esc(line)}</div>`).join('')
      || '<div class="mock-li muted">ยังไม่มีข้อมูล</div>';
  }
  if (typeof updateShareCardPreview === 'function') updateShareCardPreview();
}
let cropDraftTimer = null;
async function scheduleCropDraftSave(wait = 600) {
  if (currentPath() !== '/admin/site') return;
  clearTimeout(cropDraftTimer);
  cropDraftTimer = setTimeout(async () => {
    try {
      const cards = [...document.querySelectorAll('[data-crop-card]')];
      const map = {};
      for (const card of cards) {
        const entry = await collectCropLandingCardData(card, { uploadFiles: false });
        if (!entry.slug || map[entry.slug]) continue;
        map[entry.slug] = entry;
      }
      localStorage.setItem(ADMIN_CROP_DRAFT_KEY, serializeCropLandingMap(map));
      setCropDraftStatus(`บันทึก draft อัตโนมัติแล้ว ${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`);
    } catch {
      setCropDraftStatus('ยังไม่สามารถบันทึก draft อัตโนมัติได้');
    }
  }, wait);
}
function toggleCropCard(card, forceExpand = null) {
  const body = card?.querySelector('[data-cropbody]');
  const btn = card?.querySelector('[data-togglecrop]');
  if (!body || !btn) return;
  const collapsed = forceExpand == null ? !body.classList.contains('is-collapsed') : !forceExpand;
  body.classList.toggle('is-collapsed', collapsed);
  btn.textContent = collapsed ? 'ขยายการ์ด' : 'ย่อการ์ด';
}
function applyReviewTemplate(item, key) {
  const tpl = REVIEW_TEMPLATES.find((entry) => entry.key === key);
  if (!tpl || !item) return;
  const card = item.closest('[data-crop-card]');
  const crop = (card?.querySelector('[data-field="crop"]')?.value || '').trim();
  const titleInput = item.querySelector('[data-review-title]');
  const noteInput = item.querySelector('[data-review-note]');
  if (titleInput) titleInput.value = tpl.title(crop);
  if (noteInput) noteInput.value = tpl.note(crop);
}
function scrollToLeadBlock({ focusInput = false } = {}) {
  const el = document.getElementById('leadFormBlock');
  if (!el) {
    if (currentPath() !== '/') {
      go('/');
      setTimeout(() => scrollToLeadBlock({ focusInput }), 420);
    }
    return;
  }
  const navH = document.querySelector('.nav')?.offsetHeight || 88;
  const rect = el.getBoundingClientRect();
  const absoluteTop = rect.top + window.scrollY;
  const viewportH = window.innerHeight;
  const centerOffset = rect.height < viewportH * 0.9 ? Math.max(42, (viewportH - rect.height) * 0.46) : 28;
  const target = Math.max(0, absoluteTop - navH - centerOffset + 10);
  window.scrollTo({ top: target, behavior: 'smooth' });
  el.classList.add('is-focused');
  setTimeout(() => el.classList.remove('is-focused'), 1800);
  if (focusInput) setTimeout(() => el.querySelector('input, select, textarea')?.focus(), 420);
}
function setCropDraftStatus(text = 'ยังไม่มีการบันทึกอัตโนมัติ') {
  const el = document.getElementById('cropDraftStatus');
  if (el) el.textContent = text;
}
function leadSuccessHTML(body = {}) {
  return `<div class="lead-success-state reveal-now">
    <span class="eyebrow">ส่งข้อมูลสำเร็จ</span>
    <h3>คุณจูนได้รับข้อมูลแล้ว</h3>
    <p>ข้อมูลของ${esc(body.name || 'คุณ')}ถูกส่งเข้าระบบเรียบร้อย คุณจูนจะติดต่อกลับโดยเร็วผ่านเบอร์ที่ให้ไว้ หรือคุยต่อใน LINE ตามความเหมาะสม</p>
    <div class="lead-success-pills">
      ${body.crop ? `<span>${esc(body.crop)}</span>` : ''}
      ${body.stage ? `<span>${esc(body.stage)}</span>` : ''}
      ${body.phone ? `<span>${esc(body.phone)}</span>` : ''}
    </div>
    <div class="hero-cta">
      <button class="btn btn-primary" type="button" data-resetleadform>ส่งข้อมูลอีกครั้ง</button>
      ${lineCTA('line-inline')}
    </div>
  </div>`;
}
function cropGalleryEditor(item = {}) {
  const entry = normalizeCropLandingMediaItem(item);
  return `<div class="crop-gallery-item" data-crop-gallery draggable="true">
    <div class="pf-grid">
      <label>หัวข้อภาพ<input data-gallery-title value="${esc(entry.title)}" placeholder="เช่น ภาพสวนจริง / ภาพสินค้าในแปลง"></label>
      <label>คำอธิบายสั้น<input data-gallery-note value="${esc(entry.note)}" placeholder="เช่น ใช้ประกอบจุดขายหรือบรรยากาศในสวน"></label>
    </div>
    <label>ลิงก์รูปภาพ / path รูป<input data-gallery-image-input value="${esc(entry.image)}" placeholder="/uploads/landing-gallery.jpg หรือ https://..."></label>
    <label>รูปภาพ (อัปโหลดใหม่ได้)<input data-gallery-file type="file" accept="image/*"></label>
    <input type="hidden" data-gallery-image value="${esc(entry.image)}">
    <div class="pf-prev ${entry.image ? '' : 'is-empty'}" data-gallery-preview>${entry.image ? `<img src="${esc(entry.image)}">` : '<span>ยังไม่มีรูปภาพหน้า Landing</span>'}</div>
    <div class="pf-actions"><span class="drag-note">ลากการ์ดนี้เพื่อเรียงลำดับภาพ</span><button class="btn btn-glass" type="button" data-cropgalleryimage>ครอปรูปนี้</button><button class="btn btn-glass" type="button" data-removegallery>ลบรูปนี้</button></div>
  </div>`;
}
function cropReviewEditor(review = {}) {
  return `<div class="crop-review-item" data-crop-review draggable="true">
    <div class="pf-grid">
      <label>หัวข้อรีวิว<input data-review-title value="${esc(review.title || '')}" placeholder="เช่น รีวิวสวนลูกค้า จันทบุรี"></label>
      <label>คำอธิบายสั้น<input data-review-note value="${esc(review.note || '')}" placeholder="เช่น หลังใช้สูตรบำรุงผลต่อเนื่อง"></label>
    </div>
    <label>เทมเพลตรีวิว<select data-reviewtemplate>
      <option value="">เลือกเทมเพลตช่วยกรอก</option>
      ${REVIEW_TEMPLATES.map((tpl) => `<option value="${tpl.key}">${tpl.label}</option>`).join('')}
    </select></label>
    <div class="review-template-buttons">${REVIEW_TEMPLATES.map((tpl) => `<button class="btn-mini" type="button" data-reviewtemplatebtn="${tpl.key}">${tpl.label}</button>`).join('')}</div>
    <label>ลิงก์รูปรีวิว / path รูป<input data-review-image-input value="${esc(review.image || '')}" placeholder="/uploads/review.jpg หรือ https://..."></label>
    <label>รูปรีวิว (อัปโหลดใหม่ได้)<input data-review-file type="file" accept="image/*"></label>
    <input type="hidden" data-review-image value="${esc(review.image || '')}">
    <div class="pf-prev ${review.image ? '' : 'is-empty'}" data-review-preview>${review.image ? `<img src="${esc(review.image)}">` : '<span>ยังไม่มีรูปรีวิว</span>'}</div>
    <div class="pf-actions"><span class="drag-note">ลากการ์ดนี้เพื่อเรียงลำดับรีวิว</span><button class="btn btn-glass" type="button" data-cropreviewimage>ครอปรูปนี้</button><button class="btn btn-glass" type="button" data-removereview>ลบรีวิวนี้</button></div>
  </div>`;
}
function updateHeroImagePreview(card, image = '') {
  const input = card?.querySelector('[data-field="heroImage"]');
  const hidden = card?.querySelector('[data-heroimage-value]');
  const preview = card?.querySelector('[data-heroimagepreview]');
  const value = String(image || '').trim();
  const ratio = heroRatioValue(card?.querySelector('[data-field="heroRatio"]')?.value || 'wide');
  const focus = heroFocusValue(card?.querySelector('[data-field="heroFocus"]')?.value || 'center');
  if (hidden) hidden.value = value;
  if (input && input.value !== value && !isTransientImageValue(value)) input.value = value;
  if (input && isTransientImageValue(value)) input.value = '';
  if (preview) {
    preview.dataset.ratio = ratio;
    preview.dataset.focus = focus;
    preview.classList.toggle('is-empty', !value);
    preview.innerHTML = value ? `<img src="${esc(value)}" alt="Hero image preview" style="object-position:${esc(heroFocusObjectPosition(focus))}">` : '<span>ยังไม่มีภาพปกหน้า</span>';
  }
}
function updateGalleryPreview(wrap, image = '') {
  const hidden = wrap?.querySelector('[data-gallery-image]');
  const input = wrap?.querySelector('[data-gallery-image-input]');
  const preview = wrap?.querySelector('[data-gallery-preview]');
  const value = String(image || '').trim();
  if (hidden) hidden.value = value;
  if (input && input.value !== value && !isTransientImageValue(value)) input.value = value;
  if (input && isTransientImageValue(value)) input.value = '';
  if (preview) {
    preview.classList.toggle('is-empty', !value);
    preview.innerHTML = value ? `<img src="${esc(value)}">` : '<span>ยังไม่มีรูปภาพหน้า Landing</span>';
  }
}
function cropLandingAdminCard(entry = {}, idx = 0) {
  const e = normalizeCropLandingEntry(entry.slug || '', entry);
  const faqText = asArray(e.faq).map((item) => `${item.q} :: ${item.a}`).join('\n');
  const productChecks = PRODUCTS.filter(isAgriProduct).map((p) => `<label class="chip-check"><input type="checkbox" data-related value="${p.id}" ${e.related.includes(p.id) ? 'checked' : ''}> <span>${esc(p.name)}</span></label>`).join('');
  return `<article class="crop-admin-card glass" data-crop-card draggable="true">
    <div class="crop-admin-head">
      <div><b>${esc(e.crop || `หน้าเฉพาะพืช ${idx + 1}`)}</b><span class="muted">slug: /crops/${esc(e.slug || 'new-crop')}</span><span class="crop-admin-state ${e.enabled ? 'is-on' : 'is-off'}">${e.enabled ? 'เปิดหน้า' : 'ปิดหน้า'}</span></div>
      <div class="crop-admin-actions">
        <button class="btn-mini" type="button" data-togglecrop>${idx < 2 ? 'ย่อการ์ด' : 'ขยายการ์ด'}</button>
        <button class="btn-mini" type="button" data-previewcrop>ดูตัวอย่าง</button>
        <button class="btn-mini" type="button" data-duplicatecrop>ทำซ้ำหน้า</button>
        <button class="btn-mini danger" type="button" data-removecrop>ลบหน้านี้</button>
      </div>
    </div>
    <div class="crop-admin-body ${idx < 2 ? '' : 'is-collapsed'}" data-cropbody>
    <div class="pf-grid">
      <label>Slug URL<input data-field="slug" value="${esc(e.slug)}" placeholder="durian"></label>
      <label>ชื่อพืช<input data-field="crop" value="${esc(e.crop)}" placeholder="ทุเรียน"></label>
      <label>ลำดับการแสดงผล<input data-field="sortOrder" type="number" value="${esc(e.sortOrder)}" placeholder="0"></label>
      <label class="lead-wide">หัวข้อใหญ่หน้า Landing<input data-field="hero" value="${esc(e.hero)}" placeholder="สูตรแนะนำสำหรับทุเรียน"></label>
    </div>
    <div class="pf-grid">
      <label class="pf-check"><input data-field="enabled" type="checkbox" ${e.enabled ? 'checked' : ''}> เปิดใช้งานหน้านี้</label>
      <label>SEO Title<input data-field="seoTitle" value="${esc(e.seoTitle)}" placeholder="เช่น สูตรทุเรียน เร่งใบ บำรุงผล | นุชฟอร์ไลฟ์"></label>
      <label>SEO Image<input data-field="seoImage" value="${esc(e.seoImage)}" placeholder="/uploads/seo-durian.jpg หรือ https://..."></label>
    </div>
    <div class="pf-grid">
      <label>อัปโหลดภาพ SEO<input data-seoimagefile type="file" accept="image/*"></label>
      <input type="hidden" data-seoimage-value value="${esc(e.seoImage)}">
      <div class="pf-prev ${e.seoImage ? '' : 'is-empty'}" data-seoimagepreview>${e.seoImage ? `<img src="${esc(e.seoImage)}" alt="SEO image">` : '<span>ยังไม่มีภาพ SEO</span>'}</div>
      <div class="pf-actions"><button class="btn btn-glass" type="button" data-cropseoimage>ครอปภาพ SEO</button></div>
    </div>
    <label>SEO Description<textarea data-field="seoDescription" rows="2">${esc(e.seoDescription)}</textarea></label>
    <label>คำอธิบายปัญหาหลัก<textarea data-field="problem" rows="3">${esc(e.problem)}</textarea></label>
    <label>คำอธิบายสั้น / จุดประสงค์หน้า (ใช้ใน cards และ tip)<textarea data-field="tip" rows="2">${esc(e.tip)}</textarea></label>
    <label>จุดขายบนหน้า (บรรทัดละ 1 ข้อ)<textarea data-field="offer" rows="3">${esc(asArray(e.offer).join('\n'))}</textarea></label>
    <label>Pain Point / ปัญหาลูกค้า (บรรทัดละ 1 ข้อ)<textarea data-field="painPoints" rows="3">${esc(asArray(e.painPoints).join('\n'))}</textarea></label>
    <div class="crop-review-block">
      <div class="crop-review-head">
        <b>ภาพเด่นบนหน้า Landing</b>
        <span class="drag-note">ใส่ภาพปกและภาพประกอบเพื่อให้หน้าเฉพาะพืชดูเด่นขึ้น</span>
      </div>
      <div class="pf-grid">
        <label class="lead-wide">Hero Image / ภาพปกหน้า<input data-field="heroImage" value="${esc(e.heroImage)}" placeholder="/uploads/hero-durian.jpg หรือ https://..."></label>
        <label>อัปโหลดภาพปกหน้า<input data-heroimagefile type="file" accept="image/*"></label>
        <input type="hidden" data-heroimage-value value="${esc(e.heroImage)}">
        <label>สัดส่วนภาพ<select data-field="heroRatio">
          <option value="wide" ${e.heroRatio === 'wide' ? 'selected' : ''}>Wide 16:9</option>
          <option value="square" ${e.heroRatio === 'square' ? 'selected' : ''}>Square 1:1</option>
          <option value="portrait" ${e.heroRatio === 'portrait' ? 'selected' : ''}>Portrait 4:5</option>
          <option value="story" ${e.heroRatio === 'story' ? 'selected' : ''}>Story 3:4</option>
        </select></label>
        <label>จุดโฟกัสภาพ<select data-field="heroFocus">
          <option value="center" ${e.heroFocus === 'center' ? 'selected' : ''}>กึ่งกลาง</option>
          <option value="top" ${e.heroFocus === 'top' ? 'selected' : ''}>ด้านบน</option>
          <option value="bottom" ${e.heroFocus === 'bottom' ? 'selected' : ''}>ด้านล่าง</option>
          <option value="left" ${e.heroFocus === 'left' ? 'selected' : ''}>ด้านซ้าย</option>
          <option value="right" ${e.heroFocus === 'right' ? 'selected' : ''}>ด้านขวา</option>
        </select></label>
        <div class="pf-prev ${e.heroImage ? '' : 'is-empty'}" data-heroimagepreview data-ratio="${esc(e.heroRatio)}" data-focus="${esc(e.heroFocus)}">${e.heroImage ? `<img src="${esc(e.heroImage)}" alt="Hero image" style="object-position:${esc(heroFocusObjectPosition(e.heroFocus))}">` : '<span>ยังไม่มีภาพปกหน้า</span>'}</div>
        <div class="pf-actions"><button class="btn btn-glass" type="button" data-cropheroimage>ครอปภาพปกหน้า</button></div>
      </div>
      <div class="crop-review-head">
        <b>แกลเลอรีภาพประกอบ</b>
        <div class="crop-review-actions">
          <button class="btn btn-glass" type="button" data-addgallery>+ เพิ่มรูปภาพ</button>
          <button class="btn btn-glass" type="button" data-addgallerybatch>อัปโหลดหลายรูป</button>
          <input data-bulkgalleryfiles type="file" accept="image/*" multiple hidden>
        </div>
      </div>
      <div class="crop-gallery-list" data-gallery-list>${asArray(e.gallery).map((item) => cropGalleryEditor(item)).join('')}</div>
    </div>
    <label>ลำดับแนะนำแต่ละช่วง (รูปแบบ: หัวข้อ :: รายละเอียด :: p1,p2)<textarea data-field="stages" rows="5">${esc(cropStageLines(e.stages))}</textarea></label>
    <div class="crop-product-pick">
      <span>สินค้าแนะนำบนหน้า</span>
      <div class="chip-check-grid">${productChecks}</div>
    </div>
    <div class="pf-grid">
      <label>หัวข้อกล่องปิดการขาย<input data-field="proofTitle" value="${esc(e.proofTitle)}" placeholder="เหมาะกับการยิงแอดแบบเฉพาะพืช"></label>
      <label>ข้อความกล่องปิดการขาย<input data-field="proofBody" value="${esc(e.proofBody)}" placeholder="สรุปว่าหน้านี้ช่วยขายอย่างไร"></label>
    </div>
    <label>FAQ (บรรทัดละ "คำถาม :: คำตอบ")<textarea data-field="faq" rows="4">${esc(faqText)}</textarea></label>
    <div class="crop-review-block">
      <div class="crop-review-head">
        <b>รูปรีวิว / รีวิวหน้างาน</b>
        <div class="crop-review-actions">
          <button class="btn btn-glass" type="button" data-addreview>+ เพิ่มรูปรีวิว</button>
          <button class="btn btn-glass" type="button" data-addreviewbatch>อัปโหลดหลายรูป</button>
          <input data-bulkreviewfiles type="file" accept="image/*" multiple hidden>
        </div>
      </div>
      <div class="crop-review-list" data-review-list>${asArray(e.reviews).map((review) => cropReviewEditor(review)).join('')}</div>
    </div>
    </div>
  </article>`;
}
function reviewAdminEditor(items = []) {
  const rows = Array.isArray(items) ? items.map((item, index) => `<article class="review-admin-card glass" data-reviewgalleryitem data-reviewhash="${esc(item.hash || '')}" data-reviewsourcename="${esc(item.sourceName || '')}">
    <div class="review-admin-thumb"><img src="${esc(item.image || '')}" alt="${esc(item.title || `รีวิว ${index + 1}`)}" loading="lazy"></div>
    <div class="review-admin-copy">
      <div class="review-admin-copy-head">
        <b>${esc(item.sourceName || `รีวิว ${index + 1}`)}</b>
        <label class="pf-check"><input type="checkbox" data-reviewgalleryspotlight ${item.spotlight ? 'checked' : ''}> รีวิวเด่น</label>
      </div>
      <label class="set-field"><span>ป้ายสั้นเหนือรีวิว</span><input data-reviewgallerybadge value="${esc(item.badge || '')}" placeholder="เช่น ผลงานจริง"></label>
      <label class="set-field"><span>หัวข้อใต้ภาพ</span><input data-reviewgallerytitle value="${esc(item.title || '')}" placeholder="หัวข้อรีวิว"></label>
      <label class="set-field"><span>คำอธิบายใต้ภาพ</span><textarea data-reviewgallerynote rows="3" placeholder="อธิบายรีวิวแบบพรีเมียมและจริงใจ">${esc(item.note || '')}</textarea></label>
      <p class="form-note">แก้ข้อความได้ทีละรูป แล้วกดบันทึกเฉพาะส่วนรีวิวได้ทันที · รูปใหม่ที่เพิ่มในอนาคตจะไม่ทับ caption ที่คุณแก้ไว้</p>
    </div>
  </article>`).join('') : '';
  return `<div class="review-admin-toolbar-row">
    <input class="review-admin-search" type="search" placeholder="ค้นหาจากชื่อไฟล์หรือข้อความรีวิว" data-reviewgallerysearch>
    <span class="muted" id="reviewGalleryAdminCount">${items.length} รีวิว</span>
    <button class="btn btn-primary" type="button" data-savereviews>บันทึก caption รีวิว</button>
  </div>
  <div class="review-admin-list" id="reviewGalleryAdminList">${rows || '<p class="muted">ยังไม่มีรูปรีวิวในระบบ</p>'}</div>`;
}
function filterAdminReviewGallery(query = '') {
  const keyword = String(query || '').trim().toLowerCase();
  const cards = [...document.querySelectorAll('[data-reviewgalleryitem]')];
  let shown = 0;
  cards.forEach((card) => {
    const text = String(card.textContent || '').toLowerCase();
    const visible = !keyword || text.includes(keyword);
    card.hidden = !visible;
    if (visible) shown += 1;
  });
  const count = document.getElementById('reviewGalleryAdminCount');
  if (count) count.textContent = `${shown} รีวิว`;
}
function collectAdminReviewGalleryItems() {
  return [...document.querySelectorAll('[data-reviewgalleryitem]')].map((card) => ({
    hash: card.getAttribute('data-reviewhash') || '',
    sourceName: card.getAttribute('data-reviewsourcename') || '',
    badge: card.querySelector('[data-reviewgallerybadge]')?.value || '',
    title: card.querySelector('[data-reviewgallerytitle]')?.value || '',
    note: card.querySelector('[data-reviewgallerynote]')?.value || '',
    spotlight: card.querySelector('[data-reviewgalleryspotlight]')?.checked === true,
  }));
}
async function viewAdminSite() {
  if (!adminGuard()) return loadingView();
  await ensureAdminStoresContext();
  const [s, reviewData] = await Promise.all([
    (await api('/api/admin/site')).json(),
    (await api('/api/admin/reviews')).json().catch(() => ({ items: [] })),
  ]);
  const cropData = serializeCropLandingMap(cropLandingMap());
  const calcKnowledgeRaw = String(s.SITE_CALC_KNOWLEDGE || JSON.stringify(DEFAULT_CALC_KNOWLEDGE, null, 2));
  const field = (k, l, t = 'text', note = '') => `<label class="set-field"><span>${l}</span>${
    t === 'area' ? `<textarea name="${k}" rows="2">${esc(s[k] || '')}</textarea>`
    : t === 'area-lg' ? `<textarea name="${k}" rows="5">${esc(s[k] || '')}</textarea>`
    : t === 'datetime' ? `<input name="${k}" type="datetime-local" value="${esc(s[k] || '')}">`
    : `<input name="${k}" value="${esc(s[k] || '')}">`}${note ? `<small>${note}</small>` : ''}</label>`;
  const grid = (items, extraClass = '') => `<div class="site-fields-grid${extraClass ? ` ${extraClass}` : ''}">${items.join('')}</div>`;
  const group = (title, desc, body) => `<section class="site-field-group"><div class="site-field-group-head"><b>${title}</b><span>${desc}</span></div>${body}</section>`;
  const siteSection = (id, title, desc, body) => `<section class="site-panel glass site-tab-panel" id="site-section-${id}" data-section="${id}">
    <div class="site-panel-head site-tab-head">
      <div><b>${title}</b><span>${desc}</span></div>
    </div>
    <div class="site-panel-body">${body}</div>
  </section>`;
  const withPreview = (fieldsHtml, previewHtml, note = 'อัปเดตสดขณะพิมพ์') => `<div class="site-panel-cols">
    <div class="site-panel-fields">${fieldsHtml}</div>
    <aside class="site-panel-preview">
      <div class="share-preview-label"><b>ตัวอย่างบนเว็บ</b><span>${note}</span></div>
      ${previewHtml}
    </aside>
  </div>`;
  const brand = withPreview([
    group('ตัวตนแบรนด์', 'ข้อความที่ใช้ทั้งหน้าเว็บและหลังบ้าน', grid([
      field('SITE_NAME', 'ชื่อร้าน / แบรนด์'),
      field('SITE_TAGLINE', 'คำโปรยใต้ชื่อ'),
      field('SITE_ANNOUNCE', 'แถบประกาศบนสุด'),
      field('SITE_FOOTER', 'ข้อความท้ายเว็บ', 'area'),
    ])),
    group('ฮีโร่หน้าแรก', 'ข้อความที่ผู้ใช้เห็นทันทีเมื่อเปิดเว็บ', grid([
      field('SITE_HERO_TITLE', 'หัวข้อใหญ่ (ส่วนที่ 1)'),
      field('SITE_HERO_ACCENT', 'คำเน้นสี'),
      field('SITE_HERO_TITLE2', 'หัวข้อใหญ่ (ส่วนที่ 2)'),
      field('SITE_HERO_SUB', 'ข้อความรองใต้หัวข้อ', 'area'),
    ])),
  ].join(''), `<div class="mock-site">
      <div class="mock-announce" data-pv="SITE_ANNOUNCE"></div>
      <div class="mock-nav"><span class="mock-dot"></span><b data-pv="SITE_NAME" data-pv-empty="ชื่อร้าน"></b><span class="mock-nav-links">หน้าแรก · สินค้า · รีวิว</span></div>
      <div class="mock-hero">
        <h3><span data-pv="SITE_HERO_TITLE"></span> <em data-pv="SITE_HERO_ACCENT"></em><br><span data-pv="SITE_HERO_TITLE2"></span></h3>
        <p data-pv="SITE_HERO_SUB"></p>
        <div class="mock-btn-row"><span class="mock-btn primary">ดูสินค้า</span><span class="mock-btn">ขอคำแนะนำฟรี</span></div>
      </div>
      <div class="mock-footer" data-pv="SITE_FOOTER"></div>
    </div>`);
  const share = (() => {
    const fallbackShareTitle = [s.SITE_NAME, s.SITE_TAGLINE].map((v) => String(v || '').trim()).filter(Boolean).join(' | ');
    const fallbackShareDesc = String(s.SITE_HERO_SUB || s.SITE_ANNOUNCE || '').trim();
    const shareTitleNow = String(s.SITE_SHARE_TITLE || '').trim() || fallbackShareTitle;
    const shareDescNow = String(s.SITE_SHARE_DESC || '').trim() || fallbackShareDesc;
    const shareImageNow = String(s.SITE_SHARE_IMAGE || '').trim();
    const shareImageSrc = shareImageNow || '/brand-share.jpg?v=20260628-1';
    let shareDomain = location.host;
    try { shareDomain = new URL(selectedAdminStore()?.publicUrl || location.origin).host; } catch {}
    return `<div class="share-editor">
        <div class="share-editor-fields">
          <label class="set-field"><span>1. หัวข้อตอนแชร์</span>
            <input name="SITE_SHARE_TITLE" value="${esc(s.SITE_SHARE_TITLE || '')}" placeholder="${esc(fallbackShareTitle || 'เช่น ร้านของฉัน | สินค้าเกษตรครบวงจร')}" maxlength="120">
            <small>เว้นว่าง = ใช้ "ชื่อร้าน | คำโปรย" ของร้านนี้อัตโนมัติ</small>
          </label>
          <label class="set-field"><span>2. คำอธิบายตอนแชร์</span>
            <textarea name="SITE_SHARE_DESC" rows="3" placeholder="${esc((fallbackShareDesc || 'ข้อความสั้น ๆ ชวนให้กดเข้าเว็บ').slice(0, 140))}" maxlength="300">${esc(s.SITE_SHARE_DESC || '')}</textarea>
            <small>เว้นว่าง = ใช้ข้อความรองของฮีโร่ / แถบประกาศของร้านนี้</small>
          </label>
          <label class="set-field"><span>3. รูปการ์ด (แนะนำ 1200×630 px, ไม่เกิน 5MB)</span>
            <input type="hidden" name="SITE_SHARE_IMAGE" id="shareImageValue" value="${esc(shareImageNow)}">
            <div class="share-upload-row">
              <input type="file" id="shareImageFile" accept="image/*" hidden>
              <button class="btn btn-primary" type="button" id="shareImageUploadBtn">อัปโหลดรูปของร้านนี้</button>
              <button class="btn btn-glass" type="button" id="shareImageClearBtn">กลับไปใช้รูปหลัก</button>
            </div>
            <small id="shareImageStatus">${shareImageNow ? 'ใช้รูปที่อัปโหลดของร้านนี้' : 'ยังไม่ได้ตั้งรูปของร้านนี้ — ตอนนี้ใช้รูปแบรนด์หลักของระบบ'}</small>
          </label>
          <p class="form-note">อัปโหลด/แก้ข้อความแล้วต้องกด <b>"บันทึกทั้งหมด"</b> เพื่อให้มีผลจริง · ถ้าแชร์ใน LINE แล้วยังเห็นการ์ดเก่า เป็นเพราะ LINE แคชไว้ ลองส่งลิงก์ในห้องแชตอื่น</p>
        </div>
        <div class="share-preview-pane">
          <div class="share-preview-label"><b>ตัวอย่างจริงเวลาส่งลิงก์</b><span>อัปเดตสดขณะพิมพ์</span></div>
          <div class="share-chat-bg">
            <div class="share-chat-url">https://${esc(shareDomain)}/#/</div>
            <div class="share-card">
              <img id="sharePrevImg" class="share-card-img" src="${esc(shareImageSrc)}" alt="ตัวอย่างรูปตอนแชร์">
              <div class="share-card-body">
                <div id="sharePrevTitle" class="share-card-title">${esc(shareTitleNow || 'ชื่อร้านของคุณ')}</div>
                <div id="sharePrevDesc" class="share-card-desc">${esc(shareDescNow)}</div>
                <div class="share-card-domain">${esc(shareDomain)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
  })();
  const homepage = withPreview([
    group('หัวข้อแต่ละบล็อกบนหน้าแรก', 'ใช้เปลี่ยนคำหัว section โดยไม่ต้องแก้โค้ด', grid([
      field('SITE_HOME_FEATURED_EYEBROW', 'ป้ายเหนือส่วนสินค้าแนะนำ'),
      field('SITE_HOME_FEATURED_TITLE', 'หัวข้อสินค้าแนะนำ'),
      field('SITE_HOME_CROP_EYEBROW', 'ป้ายเหนือส่วนสูตรตามพืช'),
      field('SITE_HOME_CROP_TITLE', 'หัวข้อส่วนสูตรตามพืช'),
    ])),
    group('บล็อกขอคำแนะนำเร็ว', 'ข้อความฝั่งซ้ายของฟอร์มให้ลูกค้าตัดสินใจง่ายขึ้น', grid([
      field('SITE_HOME_CONSULT_EYEBROW', 'ป้ายเหนือบล็อกขอคำแนะนำเร็ว'),
      field('SITE_HOME_CONSULT_TITLE', 'หัวข้อบล็อกขอคำแนะนำเร็ว', 'area'),
      field('SITE_HOME_CONSULT_BODY', 'ข้อความอธิบายใต้หัวข้อ', 'area-lg'),
      field('SITE_HOME_CONTACT_NOTE', 'ข้อความสรุปท้ายบล็อกติดต่อ', 'area'),
    ])),
  ].join(''), `<div class="mock-site">
      <div class="mock-block"><div class="mock-eyebrow" data-pv="SITE_HOME_FEATURED_EYEBROW"></div><div class="mock-title" data-pv="SITE_HOME_FEATURED_TITLE"></div><div class="mock-thumbs"><span></span><span></span><span></span></div></div>
      <div class="mock-block"><div class="mock-eyebrow" data-pv="SITE_HOME_CROP_EYEBROW"></div><div class="mock-title" data-pv="SITE_HOME_CROP_TITLE"></div></div>
      <div class="mock-block"><div class="mock-eyebrow" data-pv="SITE_HOME_CONSULT_EYEBROW"></div><div class="mock-title" data-pv="SITE_HOME_CONSULT_TITLE"></div><div class="mock-body" data-pv="SITE_HOME_CONSULT_BODY"></div></div>
      <div class="mock-block"><div class="mock-body" data-pv="SITE_HOME_CONTACT_NOTE"></div></div>
    </div>`);
  const contact = withPreview([
    group('ข้อมูลติดต่อหลัก', 'ใช้กับ contact block และส่วนช่วยตัดสินใจบนหน้าแรก', grid([
      field('CONTACT_PRIMARY_LABEL', 'ชื่อ / ป้ายเบอร์หลัก'),
      field('CONTACT_PRIMARY_PHONE', 'เบอร์หลัก'),
      field('CONTACT_SECONDARY_LABEL', 'ชื่อ / ป้ายเบอร์รอง'),
      field('CONTACT_SECONDARY_PHONE', 'เบอร์รอง'),
      field('CONTACT_LINE_ID', 'LINE ID ส่วนตัว', 'text', 'ใส่เฉพาะ ID เช่น 0924842250'),
      field('CONTACT_LINE_PERSONAL_URL', 'ลิงก์ LINE ส่วนตัว', 'text', 'เว้นว่างได้ ระบบจะสร้างจาก LINE ID ให้'),
      field('CONTACT_LINE_OA_ID', 'LINE OA ID', 'text', 'เช่น @221fmmrs'),
      field('LINE_OA_URL', 'ลิงก์ LINE OA'),
    ])),
    group('ข้อความและปุ่มในบล็อกติดต่อ', 'ใช้กับกล่อง ไม่ต้องกรอกฟอร์มก็ได้', grid([
      field('SITE_HOME_CONTACT_TITLE', 'หัวข้อกล่องติดต่อ'),
      field('SITE_HOME_CONTACT_BODY', 'คำอธิบายกล่องติดต่อ', 'area'),
      field('SITE_HOME_CONTACT_CALL_PRIMARY_LABEL', 'ข้อความปุ่มโทรหลัก'),
      field('SITE_HOME_CONTACT_CALL_SECONDARY_LABEL', 'ข้อความปุ่มโทรรอง'),
      field('SITE_HOME_CONTACT_PERSONAL_LABEL', 'ข้อความปุ่ม LINE ส่วนตัว'),
      field('SITE_HOME_CONTACT_OA_LABEL', 'ข้อความปุ่ม LINE OA'),
    ])),
  ].join(''), `<div class="mock-card">
      <div class="mock-title" data-pv="SITE_HOME_CONTACT_TITLE"></div>
      <div class="mock-body" data-pv="SITE_HOME_CONTACT_BODY"></div>
      <div class="mock-btn-row">
        <span class="mock-btn primary">📞 <span data-pv="SITE_HOME_CONTACT_CALL_PRIMARY_LABEL"></span></span>
        <span class="mock-btn">📞 <span data-pv="SITE_HOME_CONTACT_CALL_SECONDARY_LABEL"></span></span>
        <span class="mock-btn">💬 <span data-pv="SITE_HOME_CONTACT_PERSONAL_LABEL"></span></span>
        <span class="mock-btn">🟢 <span data-pv="SITE_HOME_CONTACT_OA_LABEL"></span></span>
      </div>
      <div class="mock-meta" style="margin-top:8px"><span data-pv="CONTACT_PRIMARY_LABEL"></span> · <b data-pv="CONTACT_PRIMARY_PHONE"></b></div>
      <div class="mock-meta"><span data-pv="CONTACT_SECONDARY_LABEL"></span> · <b data-pv="CONTACT_SECONDARY_PHONE"></b></div>
      <div class="mock-meta">LINE: <b data-pv="CONTACT_LINE_ID"></b> · OA: <b data-pv="CONTACT_LINE_OA_ID"></b></div>
    </div>`);
  const dock = withPreview([
    group('ข้อความ dock ลอยมุมจอ', 'ใช้กับแถบลอยสำหรับมือถือ/เดสก์ท็อป', grid([
      field('SITE_DOCK_TITLE', 'หัวข้อ dock'),
      field('SITE_DOCK_BODY', 'คำอธิบาย dock', 'area'),
    ])),
    group('ข้อความบนปุ่ม dock', 'ปรับชื่อปุ่มโดยไม่ต้องไปแก้ HTML', grid([
      field('SITE_DOCK_LIVECHAT_LABEL', 'ข้อความปุ่ม LIVECHAT'),
      field('SITE_DOCK_CALL_LABEL', 'ข้อความปุ่มโทร'),
      field('SITE_DOCK_PERSONAL_LABEL', 'ข้อความปุ่ม LINE ส่วนตัว'),
      field('SITE_DOCK_OA_LABEL', 'ข้อความปุ่ม LINE OA'),
    ])),
  ].join(''), `<div class="mock-card mock-dock-float">
      <div class="mock-title" data-pv="SITE_DOCK_TITLE"></div>
      <div class="mock-body" data-pv="SITE_DOCK_BODY"></div>
      <div class="mock-btn-row">
        <span class="mock-btn primary">💬 <span data-pv="SITE_DOCK_LIVECHAT_LABEL"></span></span>
        <span class="mock-btn">📞 <span data-pv="SITE_DOCK_CALL_LABEL"></span></span>
        <span class="mock-btn">💚 <span data-pv="SITE_DOCK_PERSONAL_LABEL"></span></span>
        <span class="mock-btn">🟢 <span data-pv="SITE_DOCK_OA_LABEL"></span></span>
      </div>
    </div>
    <p class="mock-note">แถบนี้ลอยอยู่มุมจอทุกหน้า ทั้งมือถือและคอมพิวเตอร์</p>`);
  const ship = withPreview(group('การจัดส่ง', 'ค่าส่ง ประเทศหลัก และยอดส่งฟรี', grid([
    field('SHIP_HOME', 'ประเทศของร้าน (= จัดส่งในประเทศ)'),
    field('SHIP_FEE', 'ค่าส่งในประเทศ (บาท)'),
    field('SHIP_INTL_FEE', 'ค่าส่งต่างประเทศ (บาท)'),
    field('SHIP_FREE_OVER', 'ส่งฟรีเมื่อยอดเกิน (บาท · 0=ปิด)'),
  ])), `<div class="mock-card">
      <div class="mock-title">ค่าส่งที่ลูกค้าเห็นตอนสั่งซื้อ</div>
      <div class="mock-list" id="pvShipRows"></div>
    </div>`, 'คำนวณให้ดูอัตโนมัติ');
  const saleSel = `<label class="set-field"><span>สถานะ Flash Sale</span><select name="SALE_ACTIVE"><option value="0" ${s.SALE_ACTIVE !== '1' ? 'selected' : ''}>ปิด</option><option value="1" ${s.SALE_ACTIVE === '1' ? 'selected' : ''}>เปิด</option></select></label>`;
  const sale = withPreview(group('Flash Sale', 'เปิด/ปิดโปรลดราคาทั้งร้านและนับถอยหลัง', grid([
    saleSel,
    field('SALE_PERCENT', 'ลดกี่ % (ทั้งร้าน)'),
    field('SALE_TEXT', 'ข้อความแบนเนอร์'),
    field('SALE_ENDS', 'สิ้นสุดเมื่อ (เว้นว่าง = ไม่จำกัด)', 'datetime'),
  ])), `<div class="mock-card">
      <div class="mock-banner" id="pvSaleBanner"></div>
      <div class="mock-price" id="pvSalePrice"></div>
    </div>`);
  const marketing = withPreview(group('รหัสติดตามโฆษณา', 'ใส่ ID จากแต่ละแพลตฟอร์มเพื่อวัดผลโฆษณาและยอดขาย', grid([
    field('GA4_ID', 'GA4 Measurement ID'),
    field('META_PIXEL_ID', 'Meta Pixel ID'),
    field('TIKTOK_PIXEL_ID', 'TikTok Pixel ID'),
  ])), `<div class="mock-card">
      <div class="mock-title">สถานะการติดตั้ง</div>
      <div class="mock-chips" id="pvMarketingChips"></div>
      <p class="mock-note" style="margin:8px 0 0">ตัวที่ติดตั้งแล้วจะเริ่มเก็บข้อมูลทันทีหลังบันทึก</p>
    </div>`, 'สถานะอัปเดตตามที่กรอก');
  const stats = withPreview(grid([
    ['SITE_STAT_FARMERS', 'เกษตรกรไว้วางใจ baseline เดิม'],
    ['SITE_STAT_PRODUCTS', 'ผลิตภัณฑ์ (ใส่ auto = นับสินค้าจริง หรือใส่ตัวเลขเอง)'],
    ['SITE_STAT_RATING', 'คะแนนเฉลี่ย (ใส่ auto = เฉลี่ยรีวิวจริง หรือใส่ตัวเลขเอง)'],
    ['SITE_STAT_ONTIME', 'ส่งตรงเวลา % fallback (ใช้เมื่อยังไม่มีข้อมูลส่งจริง)'],
    ['SITE_STAT_ONTIME_BASE_TOTAL', 'ส่งตรงเวลา baseline: จำนวนออเดอร์ส่งสำเร็จเดิม'],
    ['SITE_STAT_ONTIME_BASE_ONTIME', 'ส่งตรงเวลา baseline: จำนวนที่ส่งตรงเวลาเดิม'],
    ['SITE_STAT_ONTIME_TARGET_DAYS', 'นับว่าส่งตรงเวลาเมื่อส่งสำเร็จภายในกี่วัน'],
  ].map((a) => field(...a))), `<div class="mock-card">
      <div class="mock-title">การ์ดสถิติหน้า "เกี่ยวกับเรา"</div>
      <div class="mock-stat-grid" id="pvStatsGrid" style="margin-top:8px"></div>
      <p class="mock-note" style="margin:8px 0 0">ค่าที่ใส่ auto จะคำนวณจากข้อมูลจริงตอนแสดงบนเว็บ</p>
    </div>`);
  const conversion = withPreview([
    ['SITE_TRUST_ITEMS', 'จุดแข็ง / Trust Point (บรรทัดละ 1 ข้อ)', 'area-lg'],
    ['SITE_CASE_STUDIES', 'Use Case / หลักฐานการใช้งาน (รูปแบบ: หัวข้อ :: รายละเอียด)', 'area-lg'],
    ['SITE_CHECKOUT_POINTS', 'ข้อความสร้างความมั่นใจก่อนชำระเงิน (บรรทัดละ 1 ข้อ)', 'area-lg'],
  ].map((a) => field(...a)).join(''), `<div class="mock-card">
      <div class="mock-title">จุดแข็งที่โชว์บนเว็บ</div>
      <div class="mock-list" id="pvTrustList"></div>
      <div class="mock-title" style="margin-top:12px">Use Case</div>
      <div class="mock-list" id="pvCaseList"></div>
      <div class="mock-title" style="margin-top:12px">ก่อนชำระเงิน</div>
      <div class="mock-list" id="pvCheckoutList"></div>
    </div>`);
  const reviews = group('แก้ caption รีวิวทีละรูป', 'จัดการข้อความใต้ภาพ ป้ายสั้น และเลือกรีวิวเด่นได้จากหลังบ้านโดยตรง', `${reviewAdminEditor(reviewData.items || [])}<p class="form-note">ข้อความหลักที่ระบบใช้ตอนนี้คือ “ภาพรีวิวและผลงานจริงจากลูกค้าของคุณจูนนุชฟอร์ไลฟ์” และจะถูกใช้เป็น fallback อัตโนมัติเมื่อรูปใดยังไม่ได้แก้เอง</p>`);
  const draftRaw = localStorage.getItem(ADMIN_CROP_DRAFT_KEY) || '';
  const cropMap = cropLandingMapFromRaw(draftRaw || s.SITE_CROP_LANDING_DATA || cropData);
  const cropCards = sortCropLandingEntries(Object.values(cropMap)).map((entry, idx) => cropLandingAdminCard(entry, idx)).join('');
  const sectionNav = [
    ['brand', '🏷️ แบรนด์ & ฮีโร่'],
    ['share', '🔗 ตอนแชร์ลิงก์'],
    ['home', '🏠 หน้าแรก'],
    ['contact', '📞 ติดต่อ'],
    ['dock', '📌 Dock'],
    ['shipping', '🚚 จัดส่ง'],
    ['sale', '⚡ Flash Sale'],
    ['marketing', '📈 Marketing'],
    ['stats', '📊 About'],
    ['conversion', '🤝 Conversion'],
    ['reviews', '⭐ รีวิวลูกค้า'],
    ['calc', '🧮 เครื่องคำนวณ'],
    ['crop', '🌱 หน้าเฉพาะพืช'],
  ].map(([id, label]) => `<button class="btn-mini site-admin-jump" type="button" data-sitejump="site-section-${id}">${label}</button>`).join('');
  _afterRender = () => {
    let savedSection = 'brand';
    try { savedSection = localStorage.getItem(SITE_ADMIN_ACTIVE_SECTION_KEY) || 'brand'; } catch {}
    activateSiteSection(savedSection);
    updateSiteAdminPreviews();
  };
  return adminLayout('site', `<div class="admin-workspace admin-site-ui"><div class="adm-head admin-lux-head"><div><span class="eyebrow">Brand Settings</span><h2>ข้อมูลร้าน / เว็บไซต์</h2><p class="muted">เลือกหมวดจากแท็บด้านล่าง แก้ข้อความฝั่งซ้าย แล้วดูตัวอย่างจริงฝั่งขวาก่อนกดบันทึก</p></div></div>
    <form id="settingsForm" class="set-form glass">
      <div class="site-admin-toolbar glass">
        <div class="site-admin-nav">${sectionNav}</div>
        <div class="site-admin-actions"><button class="btn btn-primary" type="submit">บันทึกทั้งหมด</button></div>
      </div>
      <div class="site-admin-tabs">
      ${siteSection('brand', 'แบรนด์ & ฮีโร่', 'ตัวตนหลักของร้านและข้อความแรกที่ผู้ใช้เห็น', brand)}
      ${siteSection('share', 'ตัวอย่างตอนแชร์ลิงก์ (LINE / Facebook)', 'รูปการ์ดและข้อความที่ขึ้นเวลาส่งลิงก์ร้านนี้ในแชต — ตั้งแยกของแต่ละร้านได้', share)}
      ${siteSection('home', 'ข้อความหน้าแรก', 'หัวข้อ section และ wording ฝั่งหน้าแรกทั้งหมด', homepage)}
      ${siteSection('contact', 'ข้อมูลติดต่อ', 'เบอร์โทร LINE และปุ่มในกล่องติดต่อหน้าแรก', contact)}
      ${siteSection('dock', 'Dock ลอยมุมจอ', 'จัดการข้อความและชื่อปุ่มของ contact dock', dock)}
      ${siteSection('shipping', 'การจัดส่ง', 'ค่าส่ง ประเทศหลัก และยอดส่งฟรี', ship)}
      ${siteSection('sale', 'Flash Sale ⚡', 'เปิด/ปิดโปรลดราคาทั้งร้านและนับถอยหลัง', sale)}
      ${siteSection('marketing', 'Marketing & Pixel', 'รหัสติดตามโฆษณาและการตลาด', marketing)}
      ${siteSection('stats', 'สถิติหน้า "เกี่ยวกับเรา"', 'ตัวเลขความน่าเชื่อถือบนหน้า About — ใส่ auto เพื่อคำนวณจากข้อมูลจริง', `${stats}<p class="form-note">สูตร hybrid ปัจจุบัน: <b>เกษตรกรไว้วางใจ</b> = baseline เดิม + ผู้ติดต่อจริงในระบบแบบไม่ซ้ำ, และ <b>ส่งตรงเวลา</b> = (baseline ที่ส่งตรงเวลา + ออเดอร์ที่ส่งทันจริง) / (baseline ส่งสำเร็จ + ออเดอร์ที่ส่งสำเร็จจริง) หากยังไม่มีข้อมูลส่งจริงจะ fallback ไปใช้ค่า % ที่กรอกไว้</p>`)}
      ${siteSection('conversion', 'Trust / Conversion Content', 'ข้อความเพิ่มความน่าเชื่อถือและช่วยปิดการขาย', conversion)}
      ${siteSection('reviews', 'รีวิวลูกค้า / Spotlight', 'แก้ caption รีวิวทีละรูปและกำหนดรีวิวเด่นด้านบนหน้ารีวิว', reviews)}
      ${siteSection('calc', 'ฐานความรู้เครื่องคำนวณ', 'จัดการสูตรพื้นฐานและคำอธิบายสำหรับเครื่องคำนวณ', `<textarea name="SITE_CALC_KNOWLEDGE" id="calcKnowledgeJson" hidden>${esc(calcKnowledgeRaw)}</textarea>${calcKnowledgeEditorHTML(calcKnowledgeRaw)}<p class="form-note">บันทึกครั้งเดียวแล้วหน้าเครื่องคำนวณจะอัปเดตทั้งสูตรตามระยะพืช คำอธิบายสินค้า และค่าพื้นฐานน้ำต่อไร่ทันที</p>`)}
      ${siteSection('crop', 'หน้าเฉพาะพืช / Landing Page', 'ส่วนที่ยาวที่สุดของหน้า ใช้แยกแก้เฉพาะตอนต้องทำแคมเปญหรือหน้าพืช', `<textarea name="SITE_CROP_LANDING_DATA" id="siteCropLandingData" hidden>${esc(s.SITE_CROP_LANDING_DATA || cropData)}</textarea>
      <div class="crop-admin-wrap">
        <p class="form-note">เพิ่ม แก้ไข ลบ ทำซ้ำ เปิด/ปิดหน้า ตั้งค่า SEO พร้อมจัดการภาพปก แกลเลอรี และรูปรีวิวของหน้าเฉพาะพืชได้จากส่วนนี้ โดยดูตัวอย่างก่อนบันทึกได้ทันที</p>
        <p class="form-note" id="cropDraftStatus">${draftRaw ? 'กู้ draft ล่าสุดกลับมาแล้ว' : 'ยังไม่มีการบันทึกอัตโนมัติ'}</p>
        ${draftRaw ? `<div class="crop-draft-banner glass"><div><b>กู้ draft ล่าสุดกลับมาแล้ว</b><span>กำลังแสดงข้อมูลจาก draft ในเครื่องของคุณจนกว่าจะกดบันทึกขึ้นระบบหรือเลือกล้าง draft</span></div><div class="crop-draft-actions"><button class="btn-mini" type="button" data-cleardraft>ล้าง draft</button></div></div>` : ''}
        <div class="crop-preview-pane glass">
          <div class="crop-preview-head">
            <b id="cropPreviewTitle">ดูตัวอย่างหน้าเฉพาะพืช</b>
            <div class="crop-preview-actions">
              <button class="btn-mini on" type="button" data-previewdevice="desktop">Desktop</button>
              <button class="btn-mini" type="button" data-previewdevice="tablet">Tablet</button>
              <button class="btn-mini" type="button" data-previewdevice="mobile">Mobile</button>
              <a class="btn-mini" id="cropPreviewOpenNew" href="#" target="_blank" rel="noopener">เปิดแท็บใหม่</a>
            </div>
          </div>
          <div class="crop-preview-shell" data-device="desktop">
            <iframe id="cropPreviewFrame" class="crop-preview-frame" title="Crop landing preview"></iframe>
          </div>
        </div>
        <div class="crop-admin-toolbar">
          <button class="btn btn-glass" type="button" data-expandall>ขยายทั้งหมด</button>
          <button class="btn btn-glass" type="button" data-collapseall>ย่อทั้งหมด</button>
        </div>
        <div id="cropLandingAdminList" class="crop-admin-list">${cropCards}</div>
        <button class="btn btn-glass" type="button" id="addCropLandingBtn">+ เพิ่มหน้าเฉพาะพืช</button>
      </div>`)}
      </div>
      <div class="pf-actions"><button class="btn btn-primary" type="submit">บันทึกทั้งหมด</button></div>
    </form>
    <p class="form-note" style="margin-top:12px">บันทึกแล้วมีผลทันทีทุกหน้า · Flash Sale จะลดราคาทุกสินค้า + ขึ้นแบนเนอร์นับถอยหลัง</p></div>`);
}
async function viewAdminOrderDetail({ id }) {
  if (!adminGuard()) return loadingView();
  const o = await (await api('/api/admin/orders/' + encodeURIComponent(id))).json();
  if (!o || o.error) return adminLayout('orders', `<a class="back" href="${routeHref('/admin/orders')}">← กลับ</a><p class="muted">ไม่พบคำสั่งซื้อ</p>`);
  const items = o.items.map((it) => `<div class="sum-row"><span>${it.name} <em>×${it.qty}</em></span><b>${baht(it.price * it.qty)}</b></div>`).join('');
  const acct = o.account ? `${o.account.name || '-'} (${o.account.email})` : 'ลูกค้าทั่วไป (ไม่ได้ล็อกอิน)';
  const trackVal = o.tracking || '';
  return adminLayout('orders', `
    <a class="back" href="${routeHref('/admin/orders')}">← กลับไปรายการออเดอร์</a>
    <div class="adm-head"><h2>ออเดอร์ ${o.id}</h2><span class="status-badge s-${o.status}">${o.statusLabel}</span></div>
    <div class="admin-order-toolbar glass">
      <button class="btn-mini" type="button" data-copy="${esc(o.id)}">คัดลอกเลขออเดอร์</button>
      <button class="btn-mini" type="button" data-copy="${esc(o.customer.phone || '')}">คัดลอกเบอร์ลูกค้า</button>
      <button class="btn-mini" type="button" data-copy="${esc(o.customer.address || '')}">คัดลอกที่อยู่</button>
    </div>
    ${orderTimelineHTML(o.status)}
    <div class="od-grid">
      <div class="dash-card">
        <h3>รายการสินค้า</h3>${items}
        <div class="sum-row" style="margin-top:8px"><span>ยอดสินค้า</span><b>${baht(o.subtotal || o.total)}</b></div>
        ${o.discount ? `<div class="sum-row"><span>ส่วนลด${o.coupon ? ' (' + o.coupon + ')' : ''}</span><b>-${baht(o.discount)}</b></div>` : ''}
        <div class="sum-total"><span>รวมสุทธิ</span><b>${baht(o.total)}</b></div>
      </div>
      <div class="dash-card">
        <h3>ข้อมูลลูกค้า</h3>
        <div class="od-row"><span>ผู้รับ</span><b>${esc(o.customer.name)}</b></div>
        <div class="od-row"><span>โทร</span><b>${esc(o.customer.phone)}</b></div>
        <div class="od-row"><span>ที่อยู่</span><b>${esc(o.customer.address)}</b></div>
        ${o.customer.note ? `<div class="od-row"><span>หมายเหตุ</span><b>${esc(o.customer.note)}</b></div>` : ''}
        <div class="od-row"><span>บัญชี</span><b>${esc(acct)}</b></div>
        <div class="od-row"><span>ชำระเงิน</span><b>${o.payment_method === 'card' ? 'บัตรเครดิต' : 'PromptPay'} ${o.paid ? '✅ จ่ายแล้ว' : (o.payment_claimed ? '⏳ แจ้งโอนแล้ว' : '· รอชำระ')}</b></div>
        <div class="od-row"><span>สั่งเมื่อ</span><b>${new Date(o.createdAt).toLocaleString('th-TH')}</b></div>
      </div>
    </div>
    <div class="dash-card">
      <h3>จัดการสถานะ</h3>
      <div class="ao-act">
        <button class="btn-mini" data-oaction="paid" data-oid="${o.id}">ยืนยันจ่าย</button>
        <button class="btn-mini" data-oaction="preparing" data-oid="${o.id}">เตรียมสินค้า</button>
        <input class="track-in" data-track="${o.id}" placeholder="เลขพัสดุ" value="${esc(trackVal)}">
        <button class="btn-mini" data-oaction="shipped" data-oid="${o.id}">จัดส่งแล้ว</button>
        <button class="btn-mini" data-oaction="delivered" data-oid="${o.id}">สำเร็จ</button>
        <button class="btn-mini danger" data-oaction="cancelled" data-oid="${o.id}">ยกเลิก</button>
      </div>
    </div>`);
}

let _lineRoomEntryState = { token: '', ok: false, error: '', sessionId: '', lineUserId: '', customerName: '' };
async function resolveLineRoomEntry(token = '') {
  const normalized = String(token || '').trim();
  if (!normalized) return { ok: false, error: 'ไม่พบลิงก์ห้องแชต' };
  if (_lineRoomEntryState.ok && _lineRoomEntryState.token === normalized) return _lineRoomEntryState;
  try {
    const response = await fetch(`/api/line/web-room-entry/${encodeURIComponent(normalized)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      _lineRoomEntryState = {
        token: normalized,
        ok: false,
        error: String(data?.error || 'ไม่สามารถเปิดห้องแชตได้'),
        sessionId: '',
        lineUserId: '',
        customerName: '',
      };
      return _lineRoomEntryState;
    }
    _lineRoomEntryState = {
      token: normalized,
      ok: true,
      error: '',
      sessionId: String(data?.sessionId || '').trim(),
      lineUserId: String(data?.lineUserId || '').trim(),
      customerName: String(data?.customerName || '').trim(),
    };
    return _lineRoomEntryState;
  } catch {
    _lineRoomEntryState = {
      token: normalized,
      ok: false,
      error: 'ระบบยังเชื่อมต่อห้องแชตไม่ได้ในขณะนี้',
      sessionId: '',
      lineUserId: '',
      customerName: '',
    };
    return _lineRoomEntryState;
  }
}
async function viewLineRoom({ token } = {}) {
  const entry = await resolveLineRoomEntry(token);
  if (!entry?.ok) {
    setPageMeta('ห้องแชตลูกค้า', 'ลิงก์ห้องแชตนี้ไม่พร้อมใช้งาน');
    _afterRender = () => {
      setChatOpen(false);
      setChatStatusText('🔴 ห้องแชตไม่พร้อมใช้งาน');
    };
    return `<section class="section page-top">
      <div class="auth-card glass reveal">
        <h2>ลิงก์ห้องแชตไม่พร้อมใช้งาน</h2>
        <p class="muted">${esc(entry?.error || 'กรุณากลับไปกดลิงก์จาก LINE OA ใหม่อีกครั้ง')}</p>
        <div class="pf-actions"><a class="btn btn-primary" href="${routeHref('/')}">กลับหน้าเว็บไซต์</a></div>
      </div>
    </section>`;
  }
  const customerName = entry.customerName || 'คุณลูกค้า';
  setPageMeta('ห้องแชตทีมงาน', `ห้องแชตส่วนตัวของ ${customerName} พร้อมคุยกับทีมงานแบบ realtime`);
  _afterRender = () => {
    syncLineRoomChatMount(currentPath());
    adoptCurrentChatSession(entry.sessionId);
    hydrateChatHistory(true).catch(() => {});
    setChatOpen(true);
    setChatStatusText('🟢 พร้อมคุยกับทีมงานแบบเรียลไทม์');
    if (chatInput) {
      chatInput.placeholder = 'พิมพ์ข้อความถึงทีมงานได้เลย';
      setTimeout(() => chatInput.focus(), 90);
    }
  };
  return `<section class="section page-top">
    <div class="auth-card glass reveal line-room-hero">
      <span class="eyebrow">LINE Web Room</span>
      <h2>ห้องแชตส่วนตัวของ ${esc(customerName)}</h2>
      <p class="muted">ทีมงานจะตอบกลับผ่านห้องนี้แบบ realtime โดยไม่เด้งหน้าและไม่ต้องกลับไปเริ่มที่เมนูหลัก ให้พิมพ์คุยต่อได้ทันทีในกล่องแชตด้านล่าง</p>
      <div class="pf-actions">
        <button class="btn btn-primary" type="button" data-open-line-room-chat>เริ่มพิมพ์ข้อความ</button>
        <a class="btn btn-glass" href="${routeHref('/')}">กลับหน้าเว็บไซต์</a>
      </div>
    </div>
    <div id="lineRoomChatMount" class="line-room-chat-shell"></div>
  </section>`;
}

// ════════════════════════ Router ════════════════════════
const routes = [
  { re: /^\/?$/, view: viewHome },
  { re: /^\/crops\/([^/]+)\/?$/, view: viewCropLanding, keys: ['slug'] },
  { re: /^\/line-room\/([^/]+)\/?$/, view: viewLineRoom, keys: ['token'] },
  { re: /^\/products\/?$/, view: viewProducts },
  { re: /^\/reviews\/?$/, view: viewReviews },
  { re: /^\/wishlist\/?$/, view: viewWishlist },
  { re: /^\/community\/?$/, view: viewCommunity },
  { re: /^\/articles\/?$/, view: viewCommunity },
  { re: /^\/article\/([^/]+)$/, view: viewArticle, keys: ['id'] },
  { re: /^\/calc\/?$/, view: viewCalc },
  { re: /^\/product\/([^/]+)$/, view: viewProductDetail, keys: ['id'] },
  { re: /^\/about\/?$/, view: viewAbout },
  { re: /^\/checkout\/?$/, view: viewCheckout },
  { re: /^\/track\/?$/, view: viewTrack },
  { re: /^\/order\/([^/]+)$/, view: viewOrder, keys: ['id'] },
  { re: /^\/login\/?$/, view: viewLogin },
  { re: /^\/register\/?$/, view: viewRegister },
  { re: /^\/account\/?$/, view: viewAccount },
  { re: /^\/admin\/?$/, view: viewAdminDash },
  { re: /^\/admin\/products\/?$/, view: viewAdminProducts },
  { re: /^\/admin\/community\/?$/, view: viewAdminCommunity },
  { re: /^\/admin\/articles\/?$/, view: viewAdminArticles },
  { re: /^\/admin\/inbox\/?$/, view: viewAdminInbox },
  { re: /^\/admin\/leads\/?$/, view: viewAdminLeads },
  { re: /^\/admin\/orders\/?$/, view: viewAdminOrders },
  { re: /^\/admin\/order\/([^/]+)$/, view: viewAdminOrderDetail, keys: ['id'] },
  { re: /^\/admin\/coupons\/?$/, view: viewAdminCoupons },
  { re: /^\/admin\/users\/?$/, view: viewAdminUsers },
  { re: /^\/admin\/stores\/?$/, view: viewAdminStores },
  { re: /^\/admin\/site\/?$/, view: viewAdminSite },
  { re: /^\/admin\/diagnostics\/?$/, view: viewAdminDiagnostics },
  { re: /^\/admin\/settings\/?$/, view: viewAdminSettings },
];

const app = document.getElementById('app');

function currentPath() {
  const hashPath = location.hash.replace(/^#/, '');
  if (hashPath.startsWith('/')) return hashPath;
  const clean = location.pathname.replace(/\/+$/, '') || '/';
  return clean === '/index.html' ? '/' : clean;
}
function isLineRoomPath(path = currentPath()) {
  return /^\/line-room\/[^/]+\/?$/.test(path);
}
function syncLineRoomChrome(path = currentPath()) {
  if (typeof document === 'undefined') return;
  document.body.classList.toggle('line-room-mode', isLineRoomPath(path));
}
function routeNeedsProductsData(path = currentPath()) {
  return path === '/'
    || /^\/products\/?$/.test(path)
    || /^\/product\/[^/]+\/?$/.test(path)
    || /^\/crops\/[^/]+\/?$/.test(path)
    || path === '/wishlist'
    || path === '/checkout'
    || path === '/calc';
}

// polling สถานะออเดอร์
let orderPollTimer = null;
function clearOrderPoll() { if (orderPollTimer) { clearInterval(orderPollTimer); orderPollTimer = null; } }
function startOrderPoll(id, initial) {
  clearOrderPoll();
  let prev = JSON.stringify({ s: initial.status, p: initial.paid, c: initial.payment_claimed, t: initial.tracking });
  orderPollTimer = setInterval(async () => {
    if (currentPath() !== '/order/' + id) { clearOrderPoll(); return; }
    const o = await fetchOrder(id);
    if (!o) return;
    const j = JSON.stringify({ s: o.status, p: o.paid, c: o.payment_claimed, t: o.tracking });
    if (j !== prev) { prev = j; app.innerHTML = renderOrderHTML(o); enhance(); }
  }, 5000);
}

async function render() {
  clearOrderPoll();
  clearAdminInboxPoll();
  const path = currentPath();
  if (!canAccessAdminInboxClient(currentUser)) {
    disconnectAdminInboxSocket();
    disconnectAdminInboxRealtime();
    if (_adminInboxSummaryTimer) {
      clearInterval(_adminInboxSummaryTimer);
      _adminInboxSummaryTimer = null;
    }
    _adminInboxUnreadTotal = 0;
  }
  if (routeNeedsHeavySiteData(path)) await loadSiteHeavy();
  if (routeNeedsProductsData(path)) await ensureProductsCache();
  let match = { view: viewNotFound, params: {} };
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) {
      const params = {};
      (r.keys || []).forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      match = { view: r.view, params };
      break;
    }
  }
  // ดึงข้อมูล/สร้าง HTML ขณะที่หน้าเดิมยังแสดงอยู่ (ไม่ทำให้จอว่างระหว่างรอ)
  let html = '';
  try {
    html = await match.view(match.params);
  } catch (error) {
    console.error('route render failed', path, error);
    html = `<section class="section page-top"><div class="empty-state glass reveal"><h2>โหลดหน้านี้ไม่สำเร็จ</h2><p>ระบบเชื่อมต่อช้าชั่วคราว กรุณารีเฟรชอีกครั้ง หรือกลับไปเลือกเมนูอื่นก่อน</p><button class="btn btn-primary" type="button" onclick="location.reload()">รีเฟรช</button><a class="btn btn-glass" href="${routeHref('/')}">กลับหน้าแรก</a></div></section>`;
  }
  const hadPrepaint = app.dataset.prepaint === '1';
  if (!hadPrepaint) app.classList.remove('view-in'); // รีเซ็ตเพื่อเล่นทรานสิชันใหม่หลังสลับเนื้อหา
  app.innerHTML = html;
  if (hadPrepaint) app.removeAttribute('data-prepaint');
  window.scrollTo({ top: 0 });
  renderSecureAdminNav(path);
  closeMobileNav();
  syncMobileNav();
  syncAdminInboxChrome(path);
  syncLineRoomChrome(path);
  syncLineRoomChatMount(path);
  renderFloatingContactDock(path);
  enhance();
  if (path === '/admin/site') {
    setCropPreviewDevice(document.querySelector('.crop-preview-shell')?.dataset.device || 'desktop');
    if (localStorage.getItem(ADMIN_CROP_DRAFT_KEY) && !sessionStorage.getItem('adminCropDraftToastShown')) {
      sessionStorage.setItem('adminCropDraftToastShown', '1');
      setTimeout(() => toast('กู้ draft ล่าสุดกลับมาแล้ว', 'ok'), 60);
    }
    setTimeout(() => {
      const firstCard = document.querySelector('[data-crop-card]');
      if (firstCard) scheduleCropPreview(firstCard, 30);
    }, 40);
  }
  if (canAccessAdminInboxClient(currentUser)) initAdminInboxLive();
  trackPageView(path, document.title);
  if (path === '/checkout' && !markTracked('checkout:' + cartCount() + ':' + cartTotal())) trackEvent('begin_checkout', { value: cartTotal(), currency: 'THB', items: [...cart.entries()].length });
  requestAnimationFrame(() => app.classList.add('view-in'));
  // hydrate ข้อมูลที่ยังโหลดไม่เสร็จแบบไม่บล็อกการแสดงผล (เช่น รีวิวในหน้าสินค้า)
  if (_afterRender) { const fn = _afterRender; _afterRender = null; Promise.resolve().then(fn).catch(() => {}); }
}

function setActiveNav(path) {
  document.querySelectorAll('#navLinks a').forEach((a) => {
    const href = routePathFromHref(a.getAttribute('href'));
    const on = href === '/' ? path === '/' : path.startsWith(href);
    a.classList.toggle('active', on);
  });
  document.querySelectorAll('#navLinks .nav-more').forEach((group) => {
    group.classList.toggle('active', !!group.querySelector('a.active'));
  });
}

window.addEventListener('hashchange', () => {
  const hashPath = location.hash.replace(/^#/, '');
  if (!hashPath.startsWith('/')) return;
  render();
});
window.addEventListener('popstate', render);
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!isAdminInboxFullscreen()) return;
  if (_adminInboxRoomsOpen) {
    setAdminInboxRoomsOpen(false);
    return;
  }
  setAdminInboxFullscreen(false);
  render();
});
window.addEventListener('resize', () => {
  syncMobileNav();
  document.querySelectorAll('.nav-more.open').forEach(positionNavMoreMenu);
  applyChatLayout();
  renderFloatingContactDock();
});
window.addEventListener('scroll', () => {
  document.querySelectorAll('.nav-more.open').forEach(positionNavMoreMenu);
}, { passive: true });
window.addEventListener('storage', async (e) => {
  if (e.key !== SITE_SYNC_KEY) return;
  await loadSite(routeNeedsHeavySiteData() || _siteHeavyLoaded);
  applySite();
  renderSaleBanner();
  render();
});
siteSyncChannel?.addEventListener('message', async (e) => {
  if (e.data?.type !== 'site-updated') return;
  await loadSite(routeNeedsHeavySiteData() || _siteHeavyLoaded);
  applySite();
  renderSaleBanner();
  render();
});

// ════════════════════════ Delegated interactions ════════════════════════
document.body.addEventListener('click', (e) => {
  const navMoreToggle = e.target.closest('[data-nav-more-toggle]');
  if (navMoreToggle) {
    e.preventDefault();
    e.stopPropagation();
    const group = navMoreToggle.closest('.nav-more');
    const nextOpen = !group?.classList.contains('open');
    document.querySelectorAll('.nav-more.open').forEach((el) => {
      if (el !== group) {
        el.classList.remove('open');
        el.querySelector('[data-nav-more-toggle]')?.setAttribute('aria-expanded', 'false');
      }
    });
    if (group) {
      group.classList.toggle('open', nextOpen);
      navMoreToggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
      if (nextOpen) positionNavMoreMenu(group);
    }
    return;
  }
  if (!e.target.closest('.nav-more')) {
    document.querySelectorAll('.nav-more.open').forEach((el) => {
      el.classList.remove('open');
      el.querySelector('[data-nav-more-toggle]')?.setAttribute('aria-expanded', 'false');
    });
  }
  if (e.target.closest('[data-confirmcancel]')) { e.preventDefault(); e.stopPropagation(); closeConfirmDialog(false); return; }
  if (e.target.closest('[data-confirmok]')) { e.preventDefault(); e.stopPropagation(); closeConfirmDialog(true); return; }
  const copyBtn = e.target.closest('[data-copy]');
  if (copyBtn) {
    e.preventDefault();
    e.stopPropagation();
    const text = String(copyBtn.dataset.copy || '').trim();
    if (text) {
      navigator.clipboard?.writeText(text).then(() => toast('คัดลอกแล้ว', 'ok')).catch(() => toast('คัดลอกไม่สำเร็จ', 'err'));
    }
    return;
  }
  if (e.target.closest('[data-submit-checkout]')) {
    e.preventDefault();
    e.stopPropagation();
    const form = document.getElementById('checkoutForm');
    if (form) form.requestSubmit();
    return;
  }
  if (e.target.closest('[data-open-line-room-chat]')) {
    e.preventDefault();
    e.stopPropagation();
    setChatOpen(true);
    if (chatInput) setTimeout(() => chatInput.focus(), 60);
    return;
  }
  const toggleContactDock = e.target.closest('[data-togglecontactdock]');
  if (toggleContactDock) {
    e.preventDefault();
    e.stopPropagation();
    setFloatingContactDockCollapsed(!_contactDockCollapsed);
    return;
  }
  const siteJump = e.target.closest('[data-sitejump]');
  if (siteJump) {
    e.preventDefault();
    e.stopPropagation();
    jumpToSiteSection(siteJump.dataset.sitejump || '');
    return;
  }
  const saveProductBtn = e.target.closest('[data-save-product]');
  if (saveProductBtn) {
    e.preventDefault();
    e.stopPropagation();
    const form = saveProductBtn.closest('#productForm');
    if (!form?.reportValidity()) return;
    submitProductForm(form);
    return;
  }
  const confirmOverlay = e.target.closest('#confirmDialog');
  if (confirmOverlay && !e.target.closest('.confirm-card')) { closeConfirmDialog(false); return; }
  const burger = e.target.closest('#navBurger');
  if (burger) {
    e.preventDefault();
    toggleMobileNav();
    return;
  }
  if (e.target.id === 'navDim') {
    closeMobileNav();
    return;
  }
  const navLink = e.target.closest('#navPanel a');
  if (navLink && isMobileNav()) closeMobileNav();

  const segBtn = e.target.closest('[data-seg]');
  if (segBtn) {
    _pf.segment = segBtn.dataset.seg || 'all';
    if (_pf.segment !== 'agri') _pf.crop = null;
    render();
    return;
  }
  const cropBtn = e.target.closest('[data-crop]');
  if (cropBtn) {
    _pf.crop = cropBtn.dataset.crop || null;
    if (_pf.crop) _pf.segment = 'agri';
    render();
    return;
  }
  const t = e.target.closest('[data-add],[data-inc],[data-dec],[data-qi],[data-qd],[data-addqty],[data-buynow],[data-notifypay]');
  if (!t) return;
  const d = t.dataset;

  if (d.add !== undefined) {                       // เพิ่มจากการ์ดสินค้า
    e.preventDefault();
    addToCart(d.add, 1); openCart();
    t.textContent = 'เพิ่มแล้ว ✓'; t.classList.add('added');
    setTimeout(() => { t.textContent = 'เพิ่ม +'; t.classList.remove('added'); }, 1000);
  }
  if (d.inc) { addToCart(d.inc, 1); }
  if (d.dec) { const q = (Number(cart.get(d.dec)) || 0) - 1; if (q <= 0) cart.delete(d.dec); else cart.set(d.dec, q); saveCart(); renderCart(); }

  // หน้า detail: ปุ่มจำนวน
  if (d.qi !== undefined || d.qd !== undefined) {
    const el = document.getElementById('detailQty');
    let n = parseInt(el.textContent, 10) || 1;
    n = d.qi !== undefined ? Math.min(99, n + 1) : Math.max(1, n - 1);
    el.textContent = n;
  }
  if (d.addqty) {
    const n = parseInt(document.getElementById('detailQty')?.textContent, 10) || 1;
    addToCart(d.addqty, n); openCart();
  }
  if (d.buynow) {
    const n = parseInt(document.getElementById('detailQty')?.textContent, 10) || 1;
    addToCart(d.buynow, n); go('/checkout');
  }
  if (d.notifypay) {
    t.disabled = true; t.textContent = 'กำลังแจ้ง…';
    (async () => {
      try {
        await api('/api/orders/' + d.notifypay + '/notify-payment' + orderAccessQuery(d.notifypay), { method: 'POST' });
        const o = await fetchOrder(d.notifypay);
        if (o) { app.innerHTML = renderOrderHTML(o); enhance(); startOrderPoll(d.notifypay, o); }
      } catch { t.disabled = false; t.textContent = 'แจ้งว่าชำระเงินแล้ว'; }
    })();
  }
});

// confirm page chat button (delegated)
document.body.addEventListener('click', (e) => {
  if (e.target.id === 'confirmChat' || e.target.closest('[data-openchat]')) openChat();
  if (e.target.closest('[data-linecta]')) trackEvent('line_click', { placement: 'cta' });
});

// checkout submit (delegated)
document.body.addEventListener('submit', async (e) => {
  if (e.target.id === 'accountProfileForm') {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const btn = form.querySelector('button[type=submit]');
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก...'; }
    try {
      const file = form.querySelector('[data-account-avatar-file]')?.files?.[0];
      const avatar = file ? await fileToDataUrl(file) : String(fd.get('avatar') || '').trim();
      const r = await api('/api/account/profile', {
        method: 'PUT',
        body: JSON.stringify({
          name: fd.get('name'),
          username: fd.get('username'),
          avatar,
          bio: fd.get('bio'),
          lineId: fd.get('lineId'),
          phone: fd.get('phone'),
          location: fd.get('location'),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'บันทึกโปรไฟล์ไม่สำเร็จ');
      currentUser = data.user || currentUser;
      toast('บันทึกโปรไฟล์แล้ว', 'ok');
      renderAccountNav();
      render();
    } catch (err) {
      toast(err.message || 'บันทึกโปรไฟล์ไม่สำเร็จ', 'err');
      if (btn) { btn.disabled = false; btn.textContent = 'บันทึกโปรไฟล์'; }
    }
    return;
  }
  if (e.target.id === 'communityPostForm') {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const files = [...(form.querySelector('input[name=media]')?.files || [])].slice(0, 4);
    const btn = form.querySelector('button[type=submit]');
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังโพสต์...'; }
    try {
      const media = [];
      for (const file of files) {
        media.push({ type: file.type.startsWith('video/') ? 'video' : 'image', url: await fileToDataUrl(file) });
      }
      const r = await api('/api/community/posts', {
        method: 'POST',
        body: JSON.stringify({ caption: fd.get('caption'), hashtags: fd.get('hashtags'), media }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'โพสต์ไม่สำเร็จ');
      toast(data.pending ? 'ส่งโพสต์แล้ว รอแอดมินอนุมัติ' : 'โพสต์แล้ว', 'ok');
      await render();
    } catch (err) {
      toast(err.message, 'err');
      if (btn) { btn.disabled = false; btn.textContent = 'โพสต์'; }
    }
    return;
  }
  const communityCommentForm = e.target.closest('[data-community-comment-form]');
  if (communityCommentForm) {
    e.preventDefault();
    const postId = communityCommentForm.dataset.communityCommentForm;
    const text = new FormData(communityCommentForm).get('text');
    const r = await api(`/api/community/posts/${encodeURIComponent(postId)}/comments`, { method: 'POST', body: JSON.stringify({ text }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return toast(data.error || 'ส่งคอมเมนต์ไม่สำเร็จ', 'err');
    toast('ส่งคอมเมนต์แล้ว', 'ok');
    const wrap = document.querySelector(`[data-community-comments-wrap="${CSS.escape(postId)}"]`);
    if (wrap) { wrap.dataset.open = ''; await toggleCommunityComments(postId); }
    await refreshCommunityPostCard(postId);
    return;
  }
  // ติดตามออเดอร์
  if (e.target.id === 'trackForm') {
    e.preventDefault();
    const oid = (new FormData(e.target).get('oid') || '').trim().toUpperCase();
    if (oid) go('/order/' + oid);
    return;
  }
  if (e.target.id === 'slipForm') {
    e.preventDefault();
    const form = e.target;
    const id = form.dataset.orderid;
    const file = form.querySelector('input[name=slip]')?.files?.[0];
    const btn = form.querySelector('button[type=submit]');
    if (!file) return toast('กรุณาเลือกไฟล์สลิป', 'err');
    btn.disabled = true; btn.textContent = 'กำลังตรวจสลิป…';
    try {
      const imageBase64 = await fileToDataUrl(file);
      const r = await api('/api/orders/' + id + '/verify-slip' + orderAccessQuery(id), {
        method: 'POST',
        body: JSON.stringify({ imageBase64 }),
      });
      const data = await r.json();
      if (!r.ok && !data.manualReview) throw new Error(data.error || 'ตรวจสลิปไม่สำเร็จ');
      toast(data.verified ? 'ตรวจสลิปผ่านและยืนยันชำระแล้ว' : (data.manualReview ? 'ส่งสลิปให้แอดมินตรวจสอบแล้ว' : 'อัปโหลดสลิปแล้ว'), data.verified ? 'ok' : 'warn');
      const o = await fetchOrder(id);
      if (o) { app.innerHTML = renderOrderHTML(o); enhance(); startOrderPoll(id, o); }
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false; btn.textContent = 'อัปโหลดสลิปเพื่อตรวจอัตโนมัติ';
    }
    return;
  }
  if (e.target.id !== 'checkoutForm') return;
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const payment = fd.get('payment') || 'promptpay';
  const customer = {
    name: (fd.get('name') || '').trim(),
    phone: (fd.get('phone') || '').trim(),
    address: (fd.get('address') || '').trim(),
    email: (fd.get('email') || '').trim(),
    country: (fd.get('country') || '').trim(),
    note: (fd.get('note') || '').trim(),
  };
  const items = [...cart.entries()].map(([id, qty]) => ({ id, qty: Number(qty) }));
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'กำลังดำเนินการ…';
  try {
    const r = await fetch('/api/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, customer, payment, sessionId: currentSessionId, coupon: appliedCoupon?.code || '' }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
    clientOrders.set(data.order.id, data.order);
    if (data.accessToken) rememberOrderAccess(data.order.id, data.accessToken);
    appliedCoupon = null;
    cart.clear(); saveCart(); renderCart();
    if (data.checkoutUrl) { window.location.href = data.checkoutUrl; return; } // ไป Stripe
    go('/order/' + data.order.id);                                              // PromptPay
  } catch (err) {
    toast(err.message, 'err');
    btn.disabled = false; btn.textContent = 'ดำเนินการชำระเงิน';
  }
});

async function submitProductForm(form) {
  if (!form || form.dataset.submitting === '1') return;
  const fd = new FormData(form);
  const specs = {};
  (fd.get('specs') || '').split('\n').forEach((line) => { const i = line.indexOf(':'); if (i > 0) specs[line.slice(0, i).trim()] = line.slice(i + 1).trim(); });
  const prevExtra = JSON.parse(fd.get('existingExtra') || '{}');
  const body = { name: fd.get('name'), segment: fd.get('segment') || 'agri', tag: fd.get('tag'), price: fd.get('price'), stock: fd.get('stock'), sort: fd.get('sort') || '0', icon: fd.get('icon'), short: fd.get('short'), desc: fd.get('desc'), video: fd.get('video') || '', model: fd.get('model') || '', active: fd.get('active') === 'on', specs };
  const modelValue = String(body.model || '').trim();
  if (modelValue && !/\.(glb|gltf)(?:[?#].*)?$/i.test(modelValue)) {
    toast('โมเดล 3D ต้องเป็น URL หรือพาธไฟล์ .glb / .gltf เท่านั้น', 'err');
    return;
  }
  body.extra = {
    ...prevExtra,
    category: (fd.get('category') || '').trim(),
    marketingBadge: (fd.get('marketingBadge') || '').trim(),
    cardName: (fd.get('cardName') || '').trim(),
    featured: fd.get('featured') === 'on',
    sellingPoints: splitLines(fd.get('sellingPoints')),
    seoTitle: (fd.get('seoTitle') || '').trim(),
    seoDescription: (fd.get('seoDescription') || '').trim(),
    salePrice: parseInt(fd.get('salePrice') || '0', 10) || 0,
    registrationNo: (fd.get('registrationNo') || '').trim(),
    cropTargets: splitCsv(fd.get('cropTargets')),
    applicationMethod: (fd.get('applicationMethod') || '').trim(),
    dosage: (fd.get('dosage') || '').trim(),
    labelNote: (fd.get('labelNote') || '').trim(),
    labelUrl: prevExtra.labelUrl || '',
    usageSteps: splitLines(fd.get('usageSteps')),
    warnings: splitLines(fd.get('warnings')),
    faq: splitLines(fd.get('faq')).map((line) => {
      const idx = line.indexOf('::');
      return idx > -1 ? { q: line.slice(0, idx).trim(), a: line.slice(idx + 2).trim() } : null;
    }).filter(Boolean),
  };
  const id = fd.get('id');
  ensureProductFormCropState(form);
  const labelFile = form.querySelector('input[name=labelFile]')?.files?.[0];
  const existingImages = JSON.parse(form.querySelector('[name=existingImages]')?.value || '[]');
  const resolvedExistingImages = resolveProductExistingGalleryImages(form);
  const existingImage = String(form.querySelector('[name=existingImage]')?.value || '').trim();
  const imageDraft = form._productImageDraft;
  const galleryDrafts = Array.isArray(form._productGalleryDrafts) ? form._productGalleryDrafts : [];
  const existingGalleryChanged = resolvedExistingImages.some((image, index) => String(image || '').trim() !== String(existingImages[index] || '').trim());
  const btn = form.querySelector('[data-save-product]') || form.querySelector('button[type=submit]');
  form.dataset.submitting = '1';
  if (btn) btn.disabled = true;
  try {
    if (imageDraft?.croppedDataUrl) body.image = imageDraft.croppedDataUrl;
    else if (imageDraft?.sourceDataUrl && !imageDraft.fromExisting) body.image = imageDraft.sourceDataUrl;
    else if (isDataUrl(existingImage)) body.image = existingImage;
    if (galleryDrafts.length) body.images = [...resolvedExistingImages, ...galleryDrafts.map((item) => item.croppedDataUrl || item.sourceDataUrl).filter(Boolean)];
    else if (existingGalleryChanged || resolvedExistingImages.some((image) => isDataUrl(image))) body.images = resolvedExistingImages;
    if (labelFile) body.extra.labelUrl = await fileToDataUrl(labelFile);
    const r = await api(id ? '/api/admin/products/' + id : '/api/admin/products', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'ผิดพลาด');
    await refreshProductsCache();
    toast('บันทึกสินค้าแล้ว', 'ok');
    render();
  } catch (err) {
    toast(err.message, 'err');
    if (btn) btn.disabled = false;
  } finally {
    delete form.dataset.submitting;
  }
}
document.body.addEventListener('submit', async (e) => {
  if (e.target.id !== 'productForm') return;
  e.preventDefault();
  e.stopPropagation();
  const form = e.target;
  if (!form.reportValidity()) return;
  await submitProductForm(form);
}, true);

// ───────── auth + admin form submits ─────────
document.body.addEventListener('submit', async (e) => {
  const form = e.target;
  // login / register
  if (form.id === 'loginForm' || form.id === 'registerForm') {
    e.preventDefault();
    const fd = new FormData(form);
    const isReg = form.id === 'registerForm';
    const body = { email: fd.get('email'), password: fd.get('password') };
    const adminKey = String(fd.get('adminKey') || '').trim();
    if (isReg) body.name = fd.get('name');
    if (!isReg && adminKey) body.adminKey = adminKey;
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      const r = await api(isReg ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'ผิดพลาด');
      setAuth('', d.user, '');
      toast(isReg ? 'สมัครสมาชิกสำเร็จ' : 'เข้าสู่ระบบสำเร็จ', 'ok');
      redirectToDashboard(d.user);
      return;
    } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
    return;
  }
  // article create/edit
  if (form.id === 'articleForm') {
    e.preventDefault();
    const fd = new FormData(form);
    const body = { title: fd.get('title'), excerpt: fd.get('excerpt'), body: fd.get('body'), published: fd.get('published') === 'on' };
    const id = fd.get('id');
    const file = form.querySelector('input[name=cover]').files[0];
    const coverDraft = form._articleCoverDraft;
    const existingCover = String(form.querySelector('[name=existingCover]')?.value || '').trim();
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      if (coverDraft?.sourceDataUrl) body.cover = coverDraft.croppedDataUrl || coverDraft.sourceDataUrl;
      else if (file) body.cover = await fileToDataUrl(file);
      else if (isDataUrl(existingCover)) body.cover = existingCover;
      const r = await api(id ? '/api/admin/articles/' + id : '/api/admin/articles', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'ผิดพลาด');
      toast('บันทึกบทความแล้ว', 'ok');
      render();
    } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
    return;
  }
  // coupon create/edit
  if (form.id === 'couponForm') {
    e.preventDefault();
    const fd = new FormData(form);
    const orig = fd.get('orig');
    const body = { code: (fd.get('code') || '').toUpperCase(), type: fd.get('type'), value: fd.get('value'), minTotal: fd.get('minTotal'), maxUses: fd.get('maxUses'), active: fd.get('active') === 'on', expiresAt: fd.get('expires') ? new Date(fd.get('expires')).getTime() : 0 };
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      const r = await api(orig ? '/api/admin/coupons/' + orig : '/api/admin/coupons', { method: orig ? 'PUT' : 'POST', body: JSON.stringify(body) });
      if (!r.ok) throw new Error((await r.json()).error || 'ผิดพลาด');
      toast('บันทึกคูปองแล้ว', 'ok'); render();
    } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
    return;
  }
  // settings
  if (form.id === 'settingsForm') {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      await syncCropLandingSettings(form);
      const fd = new FormData(form);
      const settings = {};
      for (const [k, v] of fd.entries()) if (v !== '') settings[k] = v;
      // ค่าตอนแชร์ลิงก์ต้องส่งแม้ว่าง เพื่อให้ "ล้างรูป/ล้างข้อความ" มีผลจริง
      for (const k of ['SITE_SHARE_TITLE', 'SITE_SHARE_DESC', 'SITE_SHARE_IMAGE']) {
        if (fd.has(k)) settings[k] = String(fd.get(k) ?? '');
      }
      // ฟอร์มข้อมูลร้าน (มี SITE_NAME) ของร้านย่อย → บันทึกเป็น override ของร้านนั้น ไม่ทับค่าร้านหลัก
      const isSiteForm = fd.has('SITE_NAME');
      const selectedStoreId = adminSelectedStoreId();
      const defaultStoreId = String((_adminStoresContext?.stores || []).find((store) => store.isDefault)?.id || 'store_main');
      const saveToStore = isSiteForm && selectedStoreId && selectedStoreId !== defaultStoreId;
      const r = saveToStore
        ? await api('/api/admin/stores/' + encodeURIComponent(selectedStoreId) + '/settings', { method: 'PUT', body: JSON.stringify({ settings }) })
        : await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ settings }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'ผิดพลาด');
      const verifyStatus = String(d?.verification?.status || 'ok').trim();
      if (verifyStatus === 'error') toast('บันทึกแล้ว แต่ระบบยังพบจุดผิดพลาดที่ต้องแก้', 'err');
      else if (verifyStatus === 'warn') toast('บันทึกแล้ว พร้อมคำเตือนที่ควรตรวจต่อ', 'ok');
      else toast('บันทึกและตรวจสอบผ่านแล้ว', 'ok');
      localStorage.removeItem('cropLandingPreviewDraft');
      localStorage.removeItem(ADMIN_CROP_DRAFT_KEY);
      setCropDraftStatus('บันทึกขึ้นระบบแล้ว');
      localStorage.setItem(SITE_SYNC_KEY, String(Date.now()));
      siteSyncChannel?.postMessage({ type: 'site-updated', at: Date.now() });
      await loadSite(); applySite(); renderSaleBanner();
      if (currentPath() !== '/admin/site') render();
    } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
    btn.disabled = false;
    return;
  }
  if (form.id === 'adminStoreCreateForm') {
    e.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    const subdomain = normalizeStoreSubdomainDraft(fd.get('subdomain') || '');
    const templateKey = String(fd.get('templateKey') || 'blank').trim();
    const cloneFromStoreId = String(fd.get('cloneFromStoreId') || '').trim();
    const btn = form.querySelector('button[type=submit]');
    if (btn) btn.disabled = true;
    try {
      const r = await api('/api/admin/stores', {
        method: 'POST',
        body: JSON.stringify({ name, subdomain, templateKey, cloneFromStoreId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || 'สร้างร้านไม่สำเร็จ');
      const publicUrl = String(d?.store?.publicUrl || '').trim();
      if (d?.store?.id) setAdminSelectedStoreId(d.store.id);
      _adminStoresContext = null;
      _adminStoresContextAt = 0;
      form.reset();
      const subdomainInput = document.getElementById('storeSubdomainInput');
      if (subdomainInput) delete subdomainInput.dataset.touched;
      const resultEl = document.getElementById('storeSubdomainCheckResult');
      if (resultEl) resultEl.innerHTML = renderStoreSubdomainCheck();
      if (publicUrl && navigator?.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(publicUrl); } catch {}
      }
      const databaseStatus = String(d?.store?.database?.status || '').trim();
      const provisionStatus = String(d?.store?.domainProvision?.status || '').trim();
      const statusParts = [databaseStatus && databaseStatus !== 'ready' ? `database ${databaseStatus}` : '', provisionStatus && provisionStatus !== 'ready' ? `domain ${provisionStatus}` : ''].filter(Boolean);
      toast(publicUrl ? `สร้างร้านแล้ว: ${publicUrl}${statusParts.length ? ` (${statusParts.join(', ')})` : ''}` : 'สร้างร้านใหม่แล้ว', statusParts.length ? 'err' : 'ok');
      await render();
    } catch (err) {
      toast(err.message || 'สร้างร้านไม่สำเร็จ', 'err');
      if (btn) btn.disabled = false;
    }
    return;
  }
  if (form.id === 'adminStoreRoleForm') {
    e.preventDefault();
    const fd = new FormData(form);
    const storeId = String(fd.get('storeId') || adminSelectedStoreId()).trim();
    const body = {
      email: String(fd.get('email') || '').trim(),
      role: String(fd.get('role') || 'staff').trim(),
    };
    const btn = form.querySelector('button[type=submit]');
    if (btn) btn.disabled = true;
    try {
      const r = await api(`/api/admin/stores/${encodeURIComponent(storeId)}/roles`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || 'บันทึกสิทธิ์ร้านไม่สำเร็จ');
      toast('บันทึก permission รายร้านแล้ว', 'ok');
      render();
    } catch (err) {
      toast(err.message || 'บันทึกสิทธิ์ร้านไม่สำเร็จ', 'err');
      if (btn) btn.disabled = false;
    }
    return;
  }
  if (form.id === 'adminStoreImportForm') {
    e.preventDefault();
    const fd = new FormData(form);
    const storeId = String(fd.get('storeId') || adminSelectedStoreId()).trim();
    const raw = String(fd.get('backupJson') || '').trim();
    const apply = Boolean(e.submitter?.dataset?.importApply);
    if (!raw) { toast('วาง JSON backup ก่อน', 'err'); return; }
    let backup = null;
    try { backup = JSON.parse(raw); }
    catch { toast('JSON backup ไม่ถูกต้อง', 'err'); return; }
    const btn = e.submitter;
    if (btn) btn.disabled = true;
    try {
      const r = await api(`/api/admin/stores/${encodeURIComponent(storeId)}/import`, {
        method: 'POST',
        body: JSON.stringify({ dryRun: !apply, backup }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || 'restore ไม่สำเร็จ');
      const s = d.summary || {};
      toast(`${apply ? 'Restore สำเร็จ' : 'Dry-run ผ่าน'}: products ${s.products || 0}, articles ${s.articles || 0}, coupons ${s.coupons || 0}, settings ${s.settings || 0}`, apply ? 'ok' : 'ok');
      if (apply) {
        _adminStoresContext = null;
        await render();
      }
    } catch (err) {
      toast(err.message || 'restore ไม่สำเร็จ', 'err');
      if (btn) btn.disabled = false;
    }
    return;
  }
  if (form.id === 'adminStoreSettingsForm') {
    e.preventDefault();
    const fd = new FormData(form);
    const storeId = String(fd.get('storeId') || adminSelectedStoreId()).trim();
    const settings = {};
    for (const [key, value] of fd.entries()) {
      if (key === 'storeId') continue;
      settings[key] = String(value || '').trim();
    }
    const btn = form.querySelector('button[type=submit]');
    if (btn) btn.disabled = true;
    try {
      const r = await api(`/api/admin/stores/${encodeURIComponent(storeId)}/settings`, {
        method: 'PUT',
        body: JSON.stringify({ settings }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || 'บันทึก settings ร้านไม่สำเร็จ');
      toast('บันทึก settings ร้านที่เลือกแล้ว', 'ok');
      _adminStoresContextAt = 0;
      localStorage.setItem(SITE_SYNC_KEY, String(Date.now()));
      siteSyncChannel?.postMessage({ type: 'site-updated', at: Date.now(), storeId });
      await loadSite(); applySite(); renderSaleBanner();
      render();
    } catch (err) {
      toast(err.message || 'บันทึก settings ร้านไม่สำเร็จ', 'err');
      if (btn) btn.disabled = false;
    }
    return;
  }
  if (form.id === 'adminCreateUserForm') {
    e.preventDefault();
    const fd = new FormData(form);
    const body = {
      name: String(fd.get('name') || '').trim(),
      email: String(fd.get('email') || '').trim(),
      password: String(fd.get('password') || ''),
      role: String(fd.get('role') || 'chat_admin').trim(),
    };
    const btn = form.querySelector('button[type=submit]');
    if (btn) btn.disabled = true;
    try {
      const r = await api('/api/admin/users', { method: 'POST', body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || 'สร้างบัญชีไม่สำเร็จ');
      toast(`สร้างบัญชี ${d?.user?.email || body.email} แล้ว`, 'ok');
      form.reset();
      render();
    } catch (err) {
      toast(err.message || 'สร้างบัญชีไม่สำเร็จ', 'err');
      if (btn) btn.disabled = false;
    }
    return;
  }
});
document.body.addEventListener('input', (e) => {
  if (e.target?.id === 'storeNameInput') {
    const subdomainInput = document.getElementById('storeSubdomainInput');
    if (!subdomainInput || subdomainInput.dataset.touched === '1') return;
    subdomainInput.value = normalizeStoreSubdomainDraft(e.target.value || '');
    const resultEl = document.getElementById('storeSubdomainCheckResult');
    if (resultEl) resultEl.innerHTML = renderStoreSubdomainCheck({ subdomain: subdomainInput.value });
  }
  if (e.target?.id === 'storeSubdomainInput') {
    const normalized = normalizeStoreSubdomainDraft(e.target.value || '');
    if (e.target.value !== normalized) e.target.value = normalized;
    e.target.dataset.touched = normalized ? '1' : '';
    const resultEl = document.getElementById('storeSubdomainCheckResult');
    if (resultEl) resultEl.innerHTML = renderStoreSubdomainCheck({ subdomain: normalized });
  }
  const search = e.target.closest('[data-reviewgallerysearch]');
  if (search) {
    filterAdminReviewGallery(search.value || '');
  }
});
document.body.addEventListener('click', async (e) => {
  const saveReviews = e.target.closest('[data-savereviews]');
  if (!saveReviews) return;
  e.preventDefault();
  saveReviews.disabled = true;
  try {
    const r = await api('/api/admin/reviews', { method: 'PUT', body: JSON.stringify({ items: collectAdminReviewGalleryItems() }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'บันทึก caption รีวิวไม่สำเร็จ');
    REVIEW_GALLERY = [];
    reviewGalleryPromise = null;
    toast('บันทึก caption รีวิวแล้ว', 'ok');
    render();
  } catch (err) {
    toast(err.message || 'บันทึก caption รีวิวไม่สำเร็จ', 'err');
    saveReviews.disabled = false;
  }
});

function fileToDataUrl(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}
function isDataUrl(value = '') {
  return /^data:/i.test(String(value || '').trim());
}
function isBlobUrl(value = '') {
  return /^blob:/i.test(String(value || '').trim());
}
function isTransientImageValue(value = '') {
  return isDataUrl(value) || isBlobUrl(value);
}
async function imageUrlToDataUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  if (isDataUrl(value)) return value;
  const r = await fetch(value);
  if (!r.ok) throw new Error('โหลดรูปเดิมมาเพื่อครอปไม่สำเร็จ');
  const blob = await r.blob();
  return fileToDataUrl(blob);
}
async function uploadAdminAssetSource(source) {
  let dataUrl = '';
  if (!source) return '';
  if (typeof source === 'string') {
    dataUrl = isDataUrl(source) ? source : await imageUrlToDataUrl(source);
  } else {
    dataUrl = await fileToDataUrl(source);
  }
  const r = await api('/api/admin/upload', { method: 'POST', body: JSON.stringify({ dataUrl }) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'อัปโหลดไฟล์ไม่สำเร็จ');
  return d.url || '';
}
// ── รูปตอนแชร์ลิงก์ (Social Share) ในหน้า /admin/site — พรีวิวการ์ดอัปเดตสด ──
function updateShareCardPreview() {
  const titleEl = document.getElementById('sharePrevTitle');
  const form = document.getElementById('settingsForm');
  if (!titleEl || !form) return;
  const val = (name) => String(form.querySelector(`[name="${name}"]`)?.value || '').trim();
  const shareImage = val('SITE_SHARE_IMAGE');
  const title = val('SITE_SHARE_TITLE') || [val('SITE_NAME'), val('SITE_TAGLINE')].filter(Boolean).join(' | ') || 'ชื่อร้านของคุณ';
  const desc = val('SITE_SHARE_DESC') || val('SITE_HERO_SUB') || val('SITE_ANNOUNCE');
  titleEl.textContent = title;
  const descEl = document.getElementById('sharePrevDesc');
  if (descEl) descEl.textContent = desc;
  const img = document.getElementById('sharePrevImg');
  const nextSrc = shareImage || '/brand-share.jpg?v=20260628-1';
  if (img && img.getAttribute('src') !== nextSrc) img.setAttribute('src', nextSrc);
  const status = document.getElementById('shareImageStatus');
  if (status) status.textContent = shareImage ? 'ใช้รูปที่อัปโหลดของร้านนี้' : 'ยังไม่ได้ตั้งรูปของร้านนี้ — ตอนนี้ใช้รูปแบรนด์หลักของระบบ';
}
function updateShareImagePreview(url = '') {
  const hidden = document.getElementById('shareImageValue');
  if (hidden) hidden.value = String(url || '').trim();
  updateShareCardPreview();
}
document.addEventListener('input', (e) => {
  if (e.target?.closest?.('#settingsForm')) updateSiteAdminPreviews();
});
document.addEventListener('change', (e) => {
  if (e.target?.id !== 'shareImageFile' && e.target?.closest?.('#settingsForm')) updateSiteAdminPreviews();
});
document.addEventListener('click', (e) => {
  if (e.target.closest('#shareImageUploadBtn')) {
    e.preventDefault();
    document.getElementById('shareImageFile')?.click();
  } else if (e.target.closest('#shareImageClearBtn')) {
    e.preventDefault();
    updateShareImagePreview('');
    toast('กลับไปใช้รูปหลักแล้ว กด "บันทึกทั้งหมด" เพื่อยืนยัน', 'ok');
  }
});
document.addEventListener('change', async (e) => {
  if (e.target?.id !== 'shareImageFile') return;
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const btn = document.getElementById('shareImageUploadBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังอัปโหลด...'; }
  try {
    const url = await uploadAdminAssetSource(file);
    updateShareImagePreview(url);
    toast('อัปโหลดรูปแล้ว กด "บันทึกทั้งหมด" เพื่อให้มีผลจริง', 'ok');
  } catch (err) {
    toast(err.message || 'อัปโหลดรูปไม่สำเร็จ', 'err');
  }
  if (btn) { btn.disabled = false; btn.textContent = 'อัปโหลดรูปใหม่'; }
});
function readAdminMediaValue(scope, inputSelector, hiddenSelector) {
  const hidden = scope?.querySelector(hiddenSelector);
  const input = scope?.querySelector(inputSelector);
  return String(hidden?.value || input?.value || '').trim();
}
function updateReviewPreview(wrap, image = '') {
  const hidden = wrap?.querySelector('[data-review-image]');
  const input = wrap?.querySelector('[data-review-image-input]');
  const preview = wrap?.querySelector('[data-review-preview]');
  const value = String(image || '').trim();
  if (hidden) hidden.value = value;
  if (input && input.value !== value && !isTransientImageValue(value)) input.value = value;
  if (input && isTransientImageValue(value)) input.value = '';
  if (preview) {
    preview.classList.toggle('is-empty', !value);
    preview.innerHTML = value ? `<img src="${esc(value)}">` : '<span>ยังไม่มีรูปรีวิว</span>';
  }
}
function updateCropAdminCardSummary(card) {
  const crop = (card?.querySelector('[data-field="crop"]')?.value || '').trim();
  const rawSlug = (card?.querySelector('[data-field="slug"]')?.value || '').trim();
  const enabled = card?.querySelector('[data-field="enabled"]')?.checked !== false;
  const title = card?.querySelector('.crop-admin-head b');
  const slugEl = card?.querySelector('.crop-admin-head .muted');
  const state = card?.querySelector('.crop-admin-state');
  if (title) title.textContent = crop || 'หน้าเฉพาะพืชใหม่';
  if (slugEl) slugEl.textContent = `slug: /crops/${rawSlug || 'new-crop'}`;
  if (state) {
    state.textContent = enabled ? 'เปิดหน้า' : 'ปิดหน้า';
    state.classList.toggle('is-on', enabled);
    state.classList.toggle('is-off', !enabled);
  }
}
function slugifyCrop(value) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
async function uploadAdminAsset(file) {
  return uploadAdminAssetSource(file);
}
async function collectCropLandingCardData(card, { uploadFiles = false } = {}) {
  const crop = (card.querySelector('[data-field="crop"]')?.value || '').trim();
  const rawSlug = (card.querySelector('[data-field="slug"]')?.value || '').trim();
  const slug = slugifyCrop(rawSlug || crop);
  if (!slug) throw new Error('กรุณากรอก slug หรือชื่อพืชก่อนดำเนินการ');
  if (!crop) throw new Error(`กรุณากรอกชื่อพืชในรายการ ${slug}`);
  const faq = splitLines(card.querySelector('[data-field="faq"]')?.value || '').map((line) => {
    const idx = line.indexOf('::');
    return idx > -1 ? { q: line.slice(0, idx).trim(), a: line.slice(idx + 2).trim() } : null;
  }).filter(Boolean);
  const stages = splitLines(card.querySelector('[data-field="stages"]')?.value || '').map((line) => {
    const parts = line.split('::').map((part) => part.trim());
    if (parts.length < 2) return null;
    return { title: parts[0], detail: parts[1], ids: splitCsv(parts.slice(2).join('::')) };
  }).filter(Boolean);
  const reviews = [];
  for (const item of card.querySelectorAll('[data-crop-review]')) {
    let image = readAdminMediaValue(item, '[data-review-image-input]', '[data-review-image]');
    const file = item.querySelector('[data-review-file]')?.files?.[0];
    if (uploadFiles && isDataUrl(image)) {
      image = await uploadAdminAssetSource(image);
      updateReviewPreview(item, image);
      const fileInput = item.querySelector('[data-review-file]');
      if (fileInput) fileInput.value = '';
    } else if (uploadFiles && file) {
      image = await uploadAdminAsset(file);
      updateReviewPreview(item, image);
      const fileInput = item.querySelector('[data-review-file]');
      if (fileInput) fileInput.value = '';
    }
    const title = (item.querySelector('[data-review-title]')?.value || '').trim();
    const note = (item.querySelector('[data-review-note]')?.value || '').trim();
    if (image || title || note) reviews.push({ image, title, note });
  }
  const gallery = [];
  for (const item of card.querySelectorAll('[data-crop-gallery]')) {
    let image = readAdminMediaValue(item, '[data-gallery-image-input]', '[data-gallery-image]');
    const file = item.querySelector('[data-gallery-file]')?.files?.[0];
    if (uploadFiles && isDataUrl(image)) {
      image = await uploadAdminAssetSource(image);
      updateGalleryPreview(item, image);
      const fileInput = item.querySelector('[data-gallery-file]');
      if (fileInput) fileInput.value = '';
    } else if (uploadFiles && file) {
      image = await uploadAdminAsset(file);
      updateGalleryPreview(item, image);
      const fileInput = item.querySelector('[data-gallery-file]');
      if (fileInput) fileInput.value = '';
    }
    const title = (item.querySelector('[data-gallery-title]')?.value || '').trim();
    const note = (item.querySelector('[data-gallery-note]')?.value || '').trim();
    if (image || title || note) gallery.push({ image, title, note });
  }
  let seoImage = readAdminMediaValue(card, '[data-field="seoImage"]', '[data-seoimage-value]');
  const seoImageFile = card.querySelector('[data-seoimagefile]')?.files?.[0];
  if (uploadFiles && isDataUrl(seoImage)) {
    seoImage = await uploadAdminAssetSource(seoImage);
    updateSeoImagePreview(card, seoImage);
    const seoFileInput = card.querySelector('[data-seoimagefile]');
    if (seoFileInput) seoFileInput.value = '';
  } else if (uploadFiles && seoImageFile) {
    seoImage = await uploadAdminAsset(seoImageFile);
    updateSeoImagePreview(card, seoImage);
    const seoFileInput = card.querySelector('[data-seoimagefile]');
    if (seoFileInput) seoFileInput.value = '';
  }
  let heroImage = readAdminMediaValue(card, '[data-field="heroImage"]', '[data-heroimage-value]');
  const heroImageFile = card.querySelector('[data-heroimagefile]')?.files?.[0];
  if (uploadFiles && isDataUrl(heroImage)) {
    heroImage = await uploadAdminAssetSource(heroImage);
    updateHeroImagePreview(card, heroImage);
    const heroFileInput = card.querySelector('[data-heroimagefile]');
    if (heroFileInput) heroFileInput.value = '';
  } else if (uploadFiles && heroImageFile) {
    heroImage = await uploadAdminAsset(heroImageFile);
    updateHeroImagePreview(card, heroImage);
    const heroFileInput = card.querySelector('[data-heroimagefile]');
    if (heroFileInput) heroFileInput.value = '';
  }
  return normalizeCropLandingEntry(slug, {
    slug,
    crop,
    enabled: card.querySelector('[data-field="enabled"]')?.checked !== false,
    sortOrder: parseInt(card.querySelector('[data-field="sortOrder"]')?.value || '0', 10) || 0,
    seoTitle: (card.querySelector('[data-field="seoTitle"]')?.value || '').trim(),
    seoDescription: (card.querySelector('[data-field="seoDescription"]')?.value || '').trim(),
    seoImage,
    hero: (card.querySelector('[data-field="hero"]')?.value || '').trim(),
    heroImage,
    heroRatio: heroRatioValue(card.querySelector('[data-field="heroRatio"]')?.value || 'wide'),
    heroFocus: heroFocusValue(card.querySelector('[data-field="heroFocus"]')?.value || 'center'),
    problem: (card.querySelector('[data-field="problem"]')?.value || '').trim(),
    tip: (card.querySelector('[data-field="tip"]')?.value || '').trim(),
    offer: splitLines(card.querySelector('[data-field="offer"]')?.value || ''),
    painPoints: splitLines(card.querySelector('[data-field="painPoints"]')?.value || ''),
    gallery,
    stages,
    proofTitle: (card.querySelector('[data-field="proofTitle"]')?.value || '').trim(),
    proofBody: (card.querySelector('[data-field="proofBody"]')?.value || '').trim(),
    faq,
    related: [...card.querySelectorAll('[data-related]:checked')].map((el) => el.value),
    reviews,
  });
}
async function syncCropLandingSettings(form) {
  const hidden = form.querySelector('#siteCropLandingData');
  if (!hidden) return;
  const cards = [...form.querySelectorAll('[data-crop-card]')];
  const map = {};
  for (let i = 0; i < cards.length; i++) {
    const entry = await collectCropLandingCardData(cards[i], { uploadFiles: true });
    if (map[entry.slug]) throw new Error(`slug ซ้ำกัน: ${entry.slug}`);
    map[entry.slug] = entry;
  }
  hidden.value = serializeCropLandingMap(map);
}

// ───────── admin/account click actions ─────────
document.body.addEventListener('click', async (e) => {
  const id = e.target.id;
  const storyClose = e.target.closest('[data-story-close]');
  if (storyClose || (e.target.id === 'communityStoryModal')) {
    e.preventDefault();
    closeCommunityStory();
    return;
  }
  const storyOpen = e.target.closest('[data-story-open]');
  if (storyOpen) {
    e.preventDefault();
    openCommunityStory(storyOpen.dataset.storyOpen || '');
    return;
  }
  const communityCommentsBtn = e.target.closest('[data-community-comments]');
  if (communityCommentsBtn) {
    e.preventDefault();
    await toggleCommunityComments(communityCommentsBtn.dataset.communityComments || '');
    return;
  }
  const communityRepostBtn = e.target.closest('[data-community-repost]');
  if (communityRepostBtn) {
    e.preventDefault();
    const postId = communityRepostBtn.dataset.communityRepost || '';
    const post = asArray(COMMUNITY_CACHE.posts).find((item) => String(item.id) === String(postId));
    const url = new URL(location.href);
    url.hash = post?.articleId ? `/article/${post.articleId}` : '/community';
    const title = post?.caption ? String(post.caption).split(/\n+/)[0].slice(0, 80) : 'ชุมชนจูนุชฟอร์ไลฟ์';
    try {
      if (navigator.share) await navigator.share({ title, text: title, url: url.toString() });
      else {
        await navigator.clipboard?.writeText(url.toString());
        toast('คัดลอกลิงก์สำหรับรีโพสต์แล้ว', 'ok');
      }
    } catch {
      toast('ยกเลิกการรีโพสต์', 'info');
    }
    return;
  }
  const communityLikeBtn = e.target.closest('[data-community-like]');
  if (communityLikeBtn) {
    e.preventDefault();
    if (!currentUser) { go('/login'); return; }
    const postId = communityLikeBtn.dataset.communityLike || '';
    communityLikeBtn.disabled = true;
    try {
      const active = !communityLikeBtn.classList.contains('is-on');
      const r = await api(`/api/community/posts/${encodeURIComponent(postId)}/reaction`, { method: 'POST', body: JSON.stringify({ active }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'อัปเดตไลก์ไม่สำเร็จ');
      await refreshCommunityPostCard(postId);
    } catch (err) {
      toast(err.message || 'อัปเดตไลก์ไม่สำเร็จ', 'err');
      communityLikeBtn.disabled = false;
    }
    return;
  }
  const communitySaveBtn = e.target.closest('[data-community-save]');
  if (communitySaveBtn) {
    e.preventDefault();
    if (!currentUser) { go('/login'); return; }
    const postId = communitySaveBtn.dataset.communitySave || '';
    communitySaveBtn.disabled = true;
    try {
      const active = !communitySaveBtn.classList.contains('is-on');
      const r = await api(`/api/community/posts/${encodeURIComponent(postId)}/save`, { method: 'POST', body: JSON.stringify({ active }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'บันทึกโพสต์ไม่สำเร็จ');
      await refreshCommunityPostCard(postId);
    } catch (err) {
      toast(err.message || 'บันทึกโพสต์ไม่สำเร็จ', 'err');
      communitySaveBtn.disabled = false;
    }
    return;
  }
  const communitySeedBtn = e.target.closest('[data-community-seed]');
  if (communitySeedBtn) {
    e.preventDefault();
    communitySeedBtn.disabled = true;
    try {
      const r = await api('/api/admin/community/seed', { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Seed ชุมชนไม่สำเร็จ');
      toast(`สร้างโพสต์ ${d.posts || 0} รายการ และสตอรี่ ${d.stories || 0} รายการ`, 'ok');
      render();
    } catch (err) {
      toast(err.message || 'Seed ชุมชนไม่สำเร็จ', 'err');
      communitySeedBtn.disabled = false;
    }
    return;
  }
  const communityAdminPostBtn = e.target.closest('[data-community-admin-post]');
  if (communityAdminPostBtn) {
    e.preventDefault();
    communityAdminPostBtn.disabled = true;
    try {
      const r = await api(`/api/admin/community/posts/${encodeURIComponent(communityAdminPostBtn.dataset.communityAdminPost || '')}`, {
        method: 'PUT',
        body: JSON.stringify({ status: communityAdminPostBtn.dataset.status || 'approved', pinned: communityAdminPostBtn.dataset.pinned === '1' }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'อัปเดตโพสต์ไม่สำเร็จ');
      toast('อัปเดตโพสต์แล้ว', 'ok');
      render();
    } catch (err) {
      toast(err.message || 'อัปเดตโพสต์ไม่สำเร็จ', 'err');
      communityAdminPostBtn.disabled = false;
    }
    return;
  }
  const communityDeletePostBtn = e.target.closest('[data-community-delete-post]');
  if (communityDeletePostBtn) {
    e.preventDefault();
    if (!confirm('ลบโพสต์นี้ออกจากชุมชน?')) return;
    communityDeletePostBtn.disabled = true;
    try {
      const r = await api(`/api/admin/community/posts/${encodeURIComponent(communityDeletePostBtn.dataset.communityDeletePost || '')}`, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'ลบโพสต์ไม่สำเร็จ');
      toast('ลบโพสต์แล้ว', 'ok');
      render();
    } catch (err) {
      toast(err.message || 'ลบโพสต์ไม่สำเร็จ', 'err');
      communityDeletePostBtn.disabled = false;
    }
    return;
  }
  const communityDeleteStoryBtn = e.target.closest('[data-community-delete-story]');
  if (communityDeleteStoryBtn) {
    e.preventDefault();
    if (!confirm('ลบสตอรี่นี้?')) return;
    communityDeleteStoryBtn.disabled = true;
    try {
      const r = await api(`/api/admin/community/stories/${encodeURIComponent(communityDeleteStoryBtn.dataset.communityDeleteStory || '')}`, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'ลบสตอรี่ไม่สำเร็จ');
      toast('ลบสตอรี่แล้ว', 'ok');
      render();
    } catch (err) {
      toast(err.message || 'ลบสตอรี่ไม่สำเร็จ', 'err');
      communityDeleteStoryBtn.disabled = false;
    }
    return;
  }
  const exportBtn = e.target.closest('[data-admin-export]');
  if (exportBtn) {
    e.preventDefault();
    exportBtn.disabled = true;
    try {
      await exportAdminListCsv(exportBtn.dataset.adminExport || '');
      toast('Export CSV สำเร็จ', 'ok');
    } catch (err) {
      toast(err.message || 'Export CSV ไม่สำเร็จ', 'err');
    } finally {
      exportBtn.disabled = false;
    }
    return;
  }
  if (e.target.closest('[data-export-products]')) {
    e.preventDefault();
    exportProductsCsv(_adminProducts);
    toast('Export สินค้าเป็น CSV แล้ว', 'ok');
    return;
  }
  const reorderBtn = e.target.closest('[data-reorder]');
  if (reorderBtn) {
    e.preventDefault();
    const order = clientOrders.get(reorderBtn.dataset.reorder || '');
    const added = addOrderToCart(order || {});
    if (!added) {
      toast('ยังสั่งซ้ำไม่ได้ เพราะสินค้าเดิมอาจหมดหรือไม่พบในร้าน', 'err');
      return;
    }
    toast('เพิ่มสินค้าจากออเดอร์เดิมลงตะกร้าแล้ว', 'ok');
    go('/checkout');
    return;
  }
  const cropperOverlay = e.target.closest('#imageCropper');
  if (cropperOverlay && !e.target.closest('.imgcrop-card')) { closeImageCropper(null); return; }
  if (e.target.closest('[data-cropcancel]')) { e.preventDefault(); e.stopPropagation(); closeImageCropper(null); return; }
  if (e.target.closest('[data-cropuseoriginal]')) { e.preventDefault(); e.stopPropagation(); closeImageCropper('__original__'); return; }
  if (e.target.closest('[data-cropconfirm]')) { e.preventDefault(); e.stopPropagation(); closeImageCropper(exportCroppedImage()); return; }
  const cropAspectBtn = e.target.closest('[data-cropaspect]');
  if (cropAspectBtn) { e.preventDefault(); e.stopPropagation(); applyImageCropperAspect(cropAspectBtn.dataset.cropaspect || 'original'); return; }
  if (e.target.closest('[data-cropreset]')) { e.preventDefault(); e.stopPropagation(); resetImageCropperPosition(); return; }
  const cropProductImageBtn = e.target.closest('[data-crop-product-image]');
  if (cropProductImageBtn) {
    e.preventDefault();
    e.stopPropagation();
    const form = cropProductImageBtn.closest('#productForm');
    ensureProductFormCropState(form);
    if (!form?._productImageDraft?.sourceDataUrl) return;
    const result = await openImageCropper({ sourceDataUrl: form._productImageDraft.sourceDataUrl, title: 'ครอปรูปหลักสินค้า', confirmText: 'ใช้รูปหลักนี้' });
    if (result && result !== '__original__') form._productImageDraft.croppedDataUrl = result;
    if (result === '__original__') form._productImageDraft.croppedDataUrl = '';
    renderProductImageDraft(form);
    return;
  }
  const cropExistingProductImageBtn = e.target.closest('[data-crop-existing-product-image]');
  if (cropExistingProductImageBtn) {
    e.preventDefault();
    e.stopPropagation();
    const form = cropExistingProductImageBtn.closest('#productForm');
    const currentInput = form?.querySelector('[name=existingImage]');
    const current = String(currentInput?.value || '').trim();
    if (!current) return;
    const sourceDataUrl = await imageUrlToDataUrl(current);
    const result = await openImageCropper({ sourceDataUrl, title: 'ครอปรูปหลักสินค้าเดิม', confirmText: 'ใช้รูปนี้เป็นรูปหลัก' });
    if (form) {
      form._productImageDraft = {
        id: productDraftId(),
        fileName: 'รูปหลักปัจจุบัน',
        sourceDataUrl,
        sourceValue: current,
        fromExisting: true,
        croppedDataUrl: result && result !== '__original__' ? result : '',
      };
    }
    renderProductImageDraft(form);
    return;
  }
  const clearProductImageBtn = e.target.closest('[data-clear-product-image]');
  if (clearProductImageBtn) {
    e.preventDefault();
    e.stopPropagation();
    const form = clearProductImageBtn.closest('#productForm');
    if (!form) return;
    form._productImageDraft = null;
    const input = form.querySelector('input[name=image]');
    if (input) input.value = '';
    renderProductImageDraft(form);
    return;
  }
  const cropGalleryBtn = e.target.closest('[data-crop-gallery-item]');
  if (cropGalleryBtn) {
    e.preventDefault();
    e.stopPropagation();
    const form = cropGalleryBtn.closest('#productForm');
    ensureProductFormCropState(form);
    const item = form?._productGalleryDrafts?.find((entry) => entry.id === cropGalleryBtn.dataset.cropGalleryItem);
    if (!item?.sourceDataUrl) return;
    const result = await openImageCropper({ sourceDataUrl: item.sourceDataUrl, title: `ครอปรูป ${item.fileName || 'แกลเลอรี'}`, confirmText: 'ใช้รูปนี้ในแกลเลอรี' });
    if (result && result !== '__original__') item.croppedDataUrl = result;
    if (result === '__original__') item.croppedDataUrl = '';
    renderProductGalleryDrafts(form);
    return;
  }
  const removeGalleryBtn = e.target.closest('[data-remove-gallery-item]');
  if (removeGalleryBtn) {
    e.preventDefault();
    e.stopPropagation();
    const form = removeGalleryBtn.closest('#productForm');
    if (!form) return;
    form._productGalleryDrafts = (form._productGalleryDrafts || []).filter((entry) => entry.id !== removeGalleryBtn.dataset.removeGalleryItem);
    renderProductGalleryDrafts(form);
    return;
  }
  const cropExistingGalleryBtn = e.target.closest('[data-crop-existing-gallery-item]');
  if (cropExistingGalleryBtn) {
    e.preventDefault();
    e.stopPropagation();
    const form = cropExistingGalleryBtn.closest('#productForm');
    ensureProductFormCropState(form);
    const images = JSON.parse(form?.querySelector('[name=existingImages]')?.value || '[]');
    const index = parseInt(cropExistingGalleryBtn.dataset.cropExistingGalleryItem || '-1', 10);
    const current = String(images[index] || '').trim();
    if (!current) return;
    const sourceDataUrl = await imageUrlToDataUrl(current);
    const result = await openImageCropper({ sourceDataUrl, title: `ครอปรูปเดิม ${index + 1}`, confirmText: 'ใช้รูปนี้ในแกลเลอรี' });
    if (form) {
      if (result && result !== '__original__') {
        form._productExistingGalleryEdits[index] = {
          sourceDataUrl,
          sourceValue: current,
          croppedDataUrl: result,
        };
      } else {
        delete form._productExistingGalleryEdits[index];
      }
    }
    renderProductGalleryDrafts(form);
    return;
  }
  const cropArticleCoverBtn = e.target.closest('[data-crop-article-cover]');
  if (cropArticleCoverBtn) {
    e.preventDefault();
    e.stopPropagation();
    const form = cropArticleCoverBtn.closest('#articleForm');
    ensureArticleFormCropState(form);
    if (!form?._articleCoverDraft?.sourceDataUrl) return;
    const result = await openImageCropper({ sourceDataUrl: form._articleCoverDraft.sourceDataUrl, title: 'ครอปรูปปกบทความ', confirmText: 'ใช้รูปปกนี้' });
    if (result && result !== '__original__') form._articleCoverDraft.croppedDataUrl = result;
    if (result === '__original__') form._articleCoverDraft.croppedDataUrl = '';
    renderArticleCoverDraft(form);
    return;
  }
  const clearArticleCoverBtn = e.target.closest('[data-clear-article-cover]');
  if (clearArticleCoverBtn) {
    e.preventDefault();
    e.stopPropagation();
    const form = clearArticleCoverBtn.closest('#articleForm');
    if (!form) return;
    form._articleCoverDraft = null;
    const input = form.querySelector('input[name=cover]');
    if (input) input.value = '';
    renderArticleCoverDraft(form);
    return;
  }
  const cropExistingArticleCoverBtn = e.target.closest('[data-crop-existing-article-cover]');
  if (cropExistingArticleCoverBtn) {
    e.preventDefault();
    e.stopPropagation();
    const form = cropExistingArticleCoverBtn.closest('#articleForm');
    const currentInput = form?.querySelector('[name=existingCover]');
    const current = String(currentInput?.value || '').trim();
    if (!current) return;
    const sourceDataUrl = await imageUrlToDataUrl(current);
    const result = await openImageCropper({ sourceDataUrl, title: 'ครอปรูปปกบทความเดิม', confirmText: 'ใช้รูปปกนี้' });
    if (result && result !== '__original__' && currentInput) currentInput.value = result;
    renderArticleCoverDraft(form);
    return;
  }
  if (id === 'logoutBtn') { await requestLogoutSilently(); setAuth('', null, ''); toast('ออกจากระบบแล้ว', 'ok'); go('/'); return; }
  if (e.target.closest('[data-resetleadform]')) { render(); return; }
  if (id === 'addProdBtn') { const w = document.getElementById('prodFormWrap'); w.innerHTML = w.innerHTML ? '' : productForm(null); ensureProductFormCropState(w.querySelector('#productForm')); return; }
  if (id === 'cancelProd') { document.getElementById('prodFormWrap').innerHTML = ''; return; }
  if (id === 'clearProductSelectionBtn') {
    _adminSelectedProductIds.clear();
    syncAdminProductSelectionUI();
    toast('ล้างรายการเลือกแล้ว', 'ok');
    return;
  }
  if (id === 'applyBulkCategoryBtn') {
    e.preventDefault();
    e.stopPropagation();
    const ids = [..._adminSelectedProductIds];
    const nextCategory = normalizeProductCategoryLabel(document.getElementById('adminBulkCategorySelect')?.value || '');
    if (!ids.length) { toast('กรุณาเลือกสินค้าอย่างน้อย 1 รายการ', 'err'); return; }
    if (!nextCategory) { toast('กรุณาเลือกหมวดหมู่ปลายทาง', 'err'); return; }
    const btn = e.target.closest('button');
    btn.disabled = true;
    try {
      for (const productId of ids) {
        const product = _adminProducts.find((item) => item.id === productId);
        if (!product) continue;
        await api('/api/admin/products/' + productId, {
          method: 'PUT',
          body: JSON.stringify({
            extra: { ...productExtra(product), category: nextCategory },
            tag: productPromoTag(product),
          }),
        }).then(async (r) => {
          const payload = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(payload.error || `ย้ายหมวดหมู่ ${product.name} ไม่สำเร็จ`);
        });
      }
      toast(`ย้ายหมวดหมู่ ${ids.length} รายการแล้ว`, 'ok');
      _adminSelectedProductIds.clear();
      render();
    } catch (err) {
      toast(err.message || 'ย้ายหมวดหมู่ไม่สำเร็จ', 'err');
      btn.disabled = false;
    }
    return;
  }
  if (id === 'addArticleBtn') { const w = document.getElementById('articleFormWrap'); w.innerHTML = w.innerHTML ? '' : articleForm(null); ensureArticleFormCropState(w.querySelector('#articleForm')); return; }
  if (id === 'cancelArticle') { document.getElementById('articleFormWrap').innerHTML = ''; return; }
  if (id === 'addCropLandingBtn') {
    e.preventDefault();
    e.stopPropagation();
    const list = document.getElementById('cropLandingAdminList');
    if (!list) return;
    list.insertAdjacentHTML('beforeend', cropLandingAdminCard({}, list.children.length));
    updateCropAdminCardSummary(list.lastElementChild);
    focusCropCard(list.lastElementChild);
    scheduleCropDraftSave(120);
    return;
  }
  if (id === 'addProductCategoryBtn') {
    e.preventDefault();
    e.stopPropagation();
    addProductCategoryValue();
    return;
  }
  if (id === 'mergeProductCategoryBtn' || id === 'renameProductCategoryBtn') {
    e.preventDefault();
    e.stopPropagation();
    await applyAdminCategoryTransform({
      mode: id === 'renameProductCategoryBtn' ? 'rename' : 'merge',
      triggerButton: e.target.closest('button'),
    });
    return;
  }
  if (id === 'saveProductCategoriesBtn') {
    e.preventDefault();
    e.stopPropagation();
    const btn = e.target.closest('button');
    btn.disabled = true;
    try {
      const serializedCategories = serializeProductCategories(currentProductCategories());
      const r = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ settings: { SITE_PRODUCT_CATEGORIES: serializedCategories } }) });
      if (!r.ok) throw new Error((await r.json()).error || 'บันทึกหมวดหมู่ไม่สำเร็จ');
      SITE = { ...SITE, SITE_PRODUCT_CATEGORIES: serializedCategories };
      localStorage.setItem(SITE_SYNC_KEY, String(Date.now()));
      siteSyncChannel?.postMessage({ type: 'site-updated', at: Date.now() });
      await loadSite(routeNeedsHeavySiteData() || _siteHeavyLoaded);
      applySite();
      toast('บันทึกหมวดหมู่แล้ว', 'ok');
      render();
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false;
    }
    return;
  }
  const removeCategory = e.target.closest('[data-removecategory]');
  if (removeCategory) {
    e.preventDefault();
    e.stopPropagation();
    const value = String(removeCategory.dataset.removecategory || '').trim();
    const usage = productCategoryUsageMap(_adminProducts)[value] || 0;
    if (usage > 0) {
      toast(`หมวดหมู่ "${displayProductCategoryLabel(value)}" ยังถูกใช้ใน ${usage} สินค้า กรุณาเปลี่ยนหมวดหมู่ของสินค้าเหล่านั้นก่อน`, 'err');
      return;
    }
    syncProductCategoryManager(currentProductCategories().filter((item) => item !== value));
    return;
  }
  const openAllSite = e.target.closest('[data-siteopenall]');
  if (openAllSite) {
    e.preventDefault();
    e.stopPropagation();
    document.querySelectorAll('.site-panel').forEach((panel) => { panel.open = true; });
    return;
  }
  const closeAllSite = e.target.closest('[data-sitecloseall]');
  if (closeAllSite) {
    e.preventDefault();
    e.stopPropagation();
    const keepOpen = new Set(['site-section-brand', 'site-section-home', 'site-section-contact']);
    document.querySelectorAll('.site-panel').forEach((panel) => {
      panel.open = keepOpen.has(panel.id);
    });
    return;
  }
  const clearDraft = e.target.closest('[data-cleardraft]');
  if (clearDraft) {
    e.preventDefault();
    e.stopPropagation();
    localStorage.removeItem(ADMIN_CROP_DRAFT_KEY);
    sessionStorage.removeItem('adminCropDraftToastShown');
    setCropDraftStatus('ล้าง draft แล้ว');
    render();
    return;
  }
  const expandAll = e.target.closest('[data-expandall]');
  if (expandAll) {
    e.preventDefault();
    e.stopPropagation();
    document.querySelectorAll('[data-crop-card]').forEach((card) => toggleCropCard(card, true));
    return;
  }
  const collapseAll = e.target.closest('[data-collapseall]');
  if (collapseAll) {
    e.preventDefault();
    e.stopPropagation();
    document.querySelectorAll('[data-crop-card]').forEach((card) => toggleCropCard(card, false));
    return;
  }
  const toggleCrop = e.target.closest('[data-togglecrop]');
  if (toggleCrop) {
    e.preventDefault();
    e.stopPropagation();
    toggleCropCard(toggleCrop.closest('[data-crop-card]'));
    return;
  }
  const previewCrop = e.target.closest('[data-previewcrop]');
  if (previewCrop) {
    e.preventDefault();
    e.stopPropagation();
    const card = previewCrop.closest('[data-crop-card]');
    if (!card) return;
    let draft = null;
    try { draft = await collectCropLandingCardData(card, { uploadFiles: false }); }
    catch (err) { toast(err.message, 'err'); return; }
    openCropPreviewPane(draft);
    return;
  }
  const duplicateCrop = e.target.closest('[data-duplicatecrop]');
  if (duplicateCrop) {
    e.preventDefault();
    e.stopPropagation();
    const card = duplicateCrop.closest('[data-crop-card]');
    if (!card) return;
    let entry = null;
    try { entry = await collectCropLandingCardData(card, { uploadFiles: false }); }
    catch (err) { toast(err.message, 'err'); return; }
    const clone = {
      ...entry,
      slug: uniqueCropSlug(`${entry.slug || slugifyCrop(entry.crop) || 'crop'}-copy`, card),
      crop: entry.crop ? `${entry.crop} (คัดลอก)` : '',
      enabled: false,
      seoTitle: entry.seoTitle ? `${entry.seoTitle} (คัดลอก)` : '',
      sortOrder: (entry.sortOrder || 0) + 1,
      gallery: asArray(entry.gallery).map((item) => ({ ...item })),
      reviews: asArray(entry.reviews).map((item) => ({ ...item })),
    };
    card.insertAdjacentHTML('afterend', cropLandingAdminCard(clone, document.querySelectorAll('[data-crop-card]').length));
    updateCropAdminCardSummary(card.nextElementSibling);
    focusCropCard(card.nextElementSibling);
    scheduleCropDraftSave(120);
    return;
  }
  const previewDevice = e.target.closest('[data-previewdevice]');
  if (previewDevice) {
    e.preventDefault();
    e.stopPropagation();
    setCropPreviewDevice(previewDevice.dataset.previewdevice || 'desktop');
    return;
  }
  const addReview = e.target.closest('[data-addreview]');
  if (addReview) {
    e.preventDefault();
    e.stopPropagation();
    const list = addReview.closest('[data-crop-card]')?.querySelector('[data-review-list]');
    if (!list) return;
    list.insertAdjacentHTML('beforeend', cropReviewEditor({}));
    scheduleCropPreview(list.closest('[data-crop-card]'), 80);
    scheduleCropDraftSave(180);
    return;
  }
  const addReviewBatch = e.target.closest('[data-addreviewbatch]');
  if (addReviewBatch) {
    e.preventDefault();
    e.stopPropagation();
    addReviewBatch.closest('.crop-review-head')?.querySelector('[data-bulkreviewfiles]')?.click();
    return;
  }
  const addGallery = e.target.closest('[data-addgallery]');
  if (addGallery) {
    e.preventDefault();
    e.stopPropagation();
    const list = addGallery.closest('[data-crop-card]')?.querySelector('[data-gallery-list]');
    if (!list) return;
    list.insertAdjacentHTML('beforeend', cropGalleryEditor({}));
    scheduleCropPreview(list.closest('[data-crop-card]'), 80);
    scheduleCropDraftSave(180);
    return;
  }
  const addGalleryBatch = e.target.closest('[data-addgallerybatch]');
  if (addGalleryBatch) {
    e.preventDefault();
    e.stopPropagation();
    addGalleryBatch.closest('.crop-review-head')?.querySelector('[data-bulkgalleryfiles]')?.click();
    return;
  }
  const removeGallery = e.target.closest('[data-removegallery]');
  if (removeGallery) {
    e.preventDefault();
    e.stopPropagation();
    const item = removeGallery.closest('[data-crop-gallery]');
    const card = item?.closest('[data-crop-card]');
    item?.remove();
    scheduleCropPreview(card, 80);
    scheduleCropDraftSave(180);
    return;
  }
  const removeReview = e.target.closest('[data-removereview]');
  if (removeReview) {
    e.preventDefault();
    e.stopPropagation();
    const item = removeReview.closest('[data-crop-review]');
    const card = item?.closest('[data-crop-card]');
    item?.remove();
    scheduleCropPreview(card, 80);
    scheduleCropDraftSave(180);
    return;
  }
  const templateBtn = e.target.closest('[data-reviewtemplatebtn]');
  if (templateBtn) {
    e.preventDefault();
    e.stopPropagation();
    const item = templateBtn.closest('[data-crop-review]');
    applyReviewTemplate(item, templateBtn.dataset.reviewtemplatebtn || '');
    scheduleCropPreview(item?.closest('[data-crop-card]'), 80);
    scheduleCropDraftSave(120);
    return;
  }
  const removeCrop = e.target.closest('[data-removecrop]');
  if (removeCrop) {
    e.preventDefault();
    e.stopPropagation();
    const card = removeCrop.closest('[data-crop-card]');
    const crop = (card?.querySelector('[data-field="crop"]')?.value || '').trim();
    const rawSlug = (card?.querySelector('[data-field="slug"]')?.value || '').trim();
    const slug = slugifyCrop(rawSlug || crop);
    if (removeCrop.dataset.confirmRemove !== '1') {
      removeCrop.dataset.confirmRemove = '1';
      removeCrop.textContent = 'ยืนยันลบหน้านี้';
      removeCrop.classList.add('is-confirm');
      setTimeout(() => {
        if (removeCrop.isConnected) {
          removeCrop.dataset.confirmRemove = '';
          removeCrop.textContent = 'ลบหน้านี้';
          removeCrop.classList.remove('is-confirm');
        }
      }, 3500);
      return;
    }
    try {
      const draft = JSON.parse(localStorage.getItem('cropLandingPreviewDraft') || '{}');
      if (draft?.slug && draft.slug === slug) localStorage.removeItem('cropLandingPreviewDraft');
    } catch {}
    card?.remove();
    scheduleCropDraftSave(120);
    return;
  }
  if (id === 'testLineBtn') {
    e.target.disabled = true;
    try { const r = await api('/api/admin/test-line', { method: 'POST' }); const d = await r.json(); if (!r.ok) throw new Error(d.error); toast('ส่งข้อความทดสอบไป LINE แล้ว', 'ok'); }
    catch (err) { toast(err.message || 'ส่งไม่สำเร็จ', 'err'); }
    e.target.disabled = false; return;
  }
  if (id === 'testLineRoomBtn') {
    e.target.disabled = true;
    try {
      const r = await api('/api/admin/test-line-room', { method: 'POST', body: JSON.stringify({}) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      toast('ลิงก์ห้องแชตพร้อมใช้งาน', 'ok');
      if (d.entryUrl) window.open(d.entryUrl, '_blank', 'noopener');
    } catch (err) { toast(err.message || 'ทดสอบลิงก์ห้องแชตไม่สำเร็จ', 'err'); }
    e.target.disabled = false; return;
  }
  if (id === 'testMailBtn') {
    e.target.disabled = true;
    try { const r = await api('/api/admin/test-mail', { method: 'POST', body: JSON.stringify({}) }); const d = await r.json(); if (!r.ok) throw new Error(d.error); toast('ส่งอีเมลทดสอบแล้ว', 'ok'); }
    catch (err) { toast(err.message || 'ส่งไม่สำเร็จ', 'err'); }
    e.target.disabled = false; return;
  }
  if (id === 'generateLineAdminBindCodeBtn') {
    e.target.disabled = true;
    try {
      const label = String(document.getElementById('lineAdminBindLabel')?.value || '').trim();
      const r = await api('/api/admin/line/admin-bind-codes', { method: 'POST', body: JSON.stringify({ label }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'สร้างรหัสผูกแอดมินไม่สำเร็จ');
      const command = `bindadminddd ${d?.bindCode?.code || ''}`.trim();
      try { if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(command); } catch {}
      toast(`สร้างรหัสผูกแอดมินแล้ว${d?.bindCode?.code ? `: ${d.bindCode.code}` : ''}`, 'ok');
      await render();
    } catch (err) { toast(err.message || 'สร้างรหัสผูกแอดมินไม่สำเร็จ', 'err'); }
    e.target.disabled = false; return;
  }
  if (id === 'deployLineRichMenuBtn') {
    e.target.disabled = true;
    try {
      const r = await api('/api/admin/line/rich-menu/deploy', { method: 'POST', body: JSON.stringify({}) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Deploy LINE rich menu failed');
      toast('Deploy LINE Rich Menu สำเร็จ', 'ok');
      await render();
    } catch (err) { toast(err.message || 'Deploy LINE rich menu failed', 'err'); }
    e.target.disabled = false; return;
  }
  if (id === 'refreshDiagnosticsBtn') {
    e.target.disabled = true;
    try { await render(); toast('รีเฟรช diagnostics แล้ว', 'ok'); }
    catch (err) { toast(err.message || 'รีเฟรช diagnostics ไม่สำเร็จ', 'err'); }
    e.target.disabled = false; return;
  }
  if (id === 'runDiagnosticsRecheckBtn') {
    e.target.disabled = true;
    try {
      const r = await api('/api/admin/diagnostics/recheck', { method: 'POST', body: JSON.stringify({}) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 're-check ไม่สำเร็จ');
      toast('เช็ก config guard ใหม่แล้ว', 'ok');
      await render();
    } catch (err) { toast(err.message || 're-check ไม่สำเร็จ', 'err'); }
    e.target.disabled = false; return;
  }
  if (id === 'refreshStoresBtn') {
    e.target.disabled = true;
    try { await render(); toast('รีเฟรชรายการร้านแล้ว', 'ok'); }
    catch (err) { toast(err.message || 'รีเฟรชรายการร้านไม่สำเร็จ', 'err'); }
    e.target.disabled = false; return;
  }
  if (id === 'checkStoreSubdomainBtn') {
    e.target.disabled = true;
    const subdomainInput = document.getElementById('storeSubdomainInput');
    const resultEl = document.getElementById('storeSubdomainCheckResult');
    const subdomain = normalizeStoreSubdomainDraft(subdomainInput?.value || '');
    if (subdomainInput && subdomainInput.value !== subdomain) subdomainInput.value = subdomain;
    if (resultEl) resultEl.innerHTML = renderStoreSubdomainCheck({ subdomain, loading: true });
    try {
      const r = await api(`/api/admin/stores/check-subdomain?subdomain=${encodeURIComponent(subdomain)}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || 'เช็ก subdomain ไม่สำเร็จ');
      if (resultEl) resultEl.innerHTML = renderStoreSubdomainCheck(d);
      if (d?.valid && d?.available) toast('subdomain นี้พร้อมใช้งาน', 'ok');
      else if (!d?.valid) toast('subdomain นี้ใช้ไม่ได้', 'err');
      else toast('subdomain นี้ถูกใช้แล้ว', 'err');
    } catch (err) {
      if (resultEl) resultEl.innerHTML = renderStoreSubdomainCheck({ subdomain, error: err.message || 'เช็ก subdomain ไม่สำเร็จ' });
      toast(err.message || 'เช็ก subdomain ไม่สำเร็จ', 'err');
    }
    e.target.disabled = false; return;
  }
  const copyStoreUrlBtn = e.target.closest('[data-copystoreurl]');
  if (copyStoreUrlBtn) {
    e.preventDefault();
    const url = String(copyStoreUrlBtn.dataset.copystoreurl || '').trim();
    try {
      if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(url);
      toast(`คัดลอก ${url} แล้ว`, 'ok');
    } catch {
      toast(url || 'คัดลอก URL ไม่สำเร็จ', 'ok');
    }
    return;
  }
  const provisionStoreBtn = e.target.closest('[data-provisionstore]');
  if (provisionStoreBtn) {
    e.preventDefault();
    const storeId = String(provisionStoreBtn.dataset.provisionstore || '').trim();
    if (!storeId) return;
    provisionStoreBtn.disabled = true;
    try {
      const r = await api(`/api/admin/stores/${encodeURIComponent(storeId)}/provision-domain`, { method: 'POST', body: JSON.stringify({}) });
      const d = await r.json().catch(() => ({}));
      const status = String(d?.store?.domainProvision?.status || '').trim();
      if (!r.ok) throw new Error(d?.store?.domainProvision?.message || d?.error || 'provision domain ไม่สำเร็จ');
      toast(status === 'ready' ? 'Vercel domain พร้อมใช้งานแล้ว' : `Vercel domain ยังรอตรวจสอบ: ${status || 'pending'}`, status === 'ready' ? 'ok' : 'err');
      await render();
    } catch (err) {
      toast(err.message || 'provision domain ไม่สำเร็จ', 'err');
      provisionStoreBtn.disabled = false;
    }
    return;
  }
  const copyBindCommandBtn = e.target.closest('[data-copybindcommand]');
  if (copyBindCommandBtn) {
    e.preventDefault();
    const code = String(copyBindCommandBtn.dataset.copybindcommand || '').trim();
    const command = `bindadminddd ${code}`.trim();
    try {
      if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(command);
      toast(`คัดลอกคำสั่ง ${command} แล้ว`, 'ok');
    } catch {
      toast(command, 'ok');
    }
    return;
  }
  const revokeBindCodeBtn = e.target.closest('[data-revokebindcode]');
  if (revokeBindCodeBtn) {
    e.preventDefault();
    revokeBindCodeBtn.disabled = true;
    try {
      const r = await api(`/api/admin/line/admin-bind-codes/${encodeURIComponent(revokeBindCodeBtn.dataset.revokebindcode || '')}`, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'ยกเลิกรหัสไม่สำเร็จ');
      toast('ยกเลิกรหัสผูกแอดมินแล้ว', 'ok');
      await render();
    } catch (err) {
      toast(err.message || 'ยกเลิกรหัสผูกแอดมินไม่สำเร็จ', 'err');
      revokeBindCodeBtn.disabled = false;
    }
    return;
  }
  const setLineAdminPrimaryBtn = e.target.closest('[data-lineadminprimary]');
  if (setLineAdminPrimaryBtn) {
    e.preventDefault();
    setLineAdminPrimaryBtn.disabled = true;
    try {
      const r = await api('/api/admin/line/admin-bindings/primary', {
        method: 'POST',
        body: JSON.stringify({ userId: String(setLineAdminPrimaryBtn.dataset.lineadminprimary || '').trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'ตั้ง primary ไม่สำเร็จ');
      toast('ตั้ง LINE admin หลักแล้ว', 'ok');
      await render();
    } catch (err) {
      toast(err.message || 'ตั้ง LINE admin หลักไม่สำเร็จ', 'err');
      setLineAdminPrimaryBtn.disabled = false;
    }
    return;
  }
  const revokeLineAdminBtn = e.target.closest('[data-lineadminrevoke]');
  if (revokeLineAdminBtn) {
    e.preventDefault();
    revokeLineAdminBtn.disabled = true;
    try {
      const r = await api(`/api/admin/line/admin-bindings/${encodeURIComponent(revokeLineAdminBtn.dataset.lineadminrevoke || '')}`, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'ถอดสิทธิ์ LINE admin ไม่สำเร็จ');
      toast('ถอดสิทธิ์ LINE admin แล้ว', 'ok');
      await render();
    } catch (err) {
      toast(err.message || 'ถอดสิทธิ์ LINE admin ไม่สำเร็จ', 'err');
      revokeLineAdminBtn.disabled = false;
    }
    return;
  }
  const rollbackConfigBtn = e.target.closest('[data-configrollback]');
  if (rollbackConfigBtn) {
    e.preventDefault();
    rollbackConfigBtn.disabled = true;
    try {
      const revisionId = String(rollbackConfigBtn.dataset.configrollback || '').trim();
      const r = await api(`/api/admin/settings/rollback/${encodeURIComponent(revisionId)}`, { method: 'POST', body: JSON.stringify({}) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'rollback ไม่สำเร็จ');
      const verifyStatus = String(d?.verification?.status || 'ok').trim();
      if (verifyStatus === 'error') toast('rollback แล้ว แต่ระบบยังมีจุดผิดพลาดที่ต้องตรวจต่อ', 'err');
      else if (verifyStatus === 'warn') toast('rollback แล้ว พร้อมคำเตือนที่ควรตรวจต่อ', 'ok');
      else toast('rollback config revision สำเร็จแล้ว', 'ok');
      await render();
    } catch (err) {
      toast(err.message || 'rollback config revision ไม่สำเร็จ', 'err');
      rollbackConfigBtn.disabled = false;
    }
    return;
  }
  const moveProdBtn = e.target.closest('[data-moveprod]');
  if (moveProdBtn) {
    e.preventDefault();
    e.stopPropagation();
    moveProdBtn.disabled = true;
    try {
      await moveAdminProduct(moveProdBtn.dataset.moveprod, moveProdBtn.dataset.direction || 'up');
      await refreshProductsCache();
      toast('อัปเดตลำดับสินค้าแล้ว', 'ok');
      render();
    } catch (err) {
      toast(err.message || 'อัปเดตลำดับสินค้าไม่สำเร็จ', 'err');
      moveProdBtn.disabled = false;
    }
    return;
  }
  const toggleProdActive = e.target.closest('[data-toggleprodactive]');
  if (toggleProdActive) {
    e.preventDefault();
    e.stopPropagation();
    const p = _adminProducts.find((x) => x.id === toggleProdActive.dataset.toggleprodactive);
    if (!p) return;
    toggleProdActive.disabled = true;
    try {
      const r = await api('/api/admin/products/' + p.id, { method: 'PUT', body: JSON.stringify({ active: p.active === false }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'อัปเดตสถานะสินค้าไม่สำเร็จ');
      await refreshProductsCache();
      toast(p.active === false ? `เปิดขาย ${p.name} แล้ว` : `ซ่อน ${p.name} แล้ว`, 'ok');
      render();
    } catch (err) {
      toast(err.message || 'อัปเดตสถานะสินค้าไม่สำเร็จ', 'err');
      toggleProdActive.disabled = false;
    }
    return;
  }
  const ed = e.target.closest('[data-editprod]'); if (ed) { e.preventDefault(); e.stopPropagation(); const p = _adminProducts.find((x) => x.id === ed.dataset.editprod); document.getElementById('prodFormWrap').innerHTML = productForm(p); ensureProductFormCropState(document.querySelector('#prodFormWrap #productForm')); document.getElementById('prodFormWrap').scrollIntoView({ behavior: 'smooth' }); return; }
  const del = e.target.closest('[data-delprod]'); if (del) { e.preventDefault(); e.stopPropagation(); const p = _adminProducts.find((x) => x.id === del.dataset.delprod); const ok = await confirmDialog({ title: 'ยืนยันการลบสินค้า', message: `ต้องการลบสินค้า "${p?.name || del.dataset.delprod}" ออกจากระบบใช่ไหม การลบนี้ไม่สามารถย้อนกลับได้`, confirmText: 'ลบสินค้า', tone: 'danger' }); if (!ok) return; const r = await api('/api/admin/products/' + del.dataset.delprod, { method: 'DELETE' }); const d = await r.json().catch(() => ({})); if (!r.ok) { toast(d.error || 'ลบสินค้าไม่สำเร็จ', 'err'); return; } await refreshProductsCache(); toast(`ลบสินค้า ${p?.name || del.dataset.delprod} แล้ว`, 'ok'); render(); return; }
  const eda = e.target.closest('[data-editart]'); if (eda) { e.preventDefault(); e.stopPropagation(); const a = _adminArticles.find((x) => x.id === eda.dataset.editart); document.getElementById('articleFormWrap').innerHTML = articleForm(a); ensureArticleFormCropState(document.querySelector('#articleFormWrap #articleForm')); document.getElementById('articleFormWrap').scrollIntoView({ behavior: 'smooth' }); return; }
  const cropSeoImageBtn = e.target.closest('[data-cropseoimage]');
  if (cropSeoImageBtn) {
    e.preventDefault();
    e.stopPropagation();
    const card = cropSeoImageBtn.closest('[data-crop-card]');
    const fileInput = card?.querySelector('[data-seoimagefile]');
    const current = readAdminMediaValue(card, '[data-field="seoImage"]', '[data-seoimage-value]');
    const sourceDataUrl = fileInput?.files?.[0] ? await fileToDataUrl(fileInput.files[0]) : await imageUrlToDataUrl(current);
    if (!sourceDataUrl) { toast('เลือกรูป SEO หรือใส่ลิงก์รูปก่อน', 'err'); return; }
    const result = await openImageCropper({ sourceDataUrl, title: 'ครอปภาพ SEO', confirmText: 'ใช้ภาพ SEO นี้' });
    if (!result || result === '__original__') return;
    updateSeoImagePreview(card, result);
    if (fileInput) fileInput.value = '';
    scheduleCropPreview(card, 80);
    scheduleCropDraftSave(180);
    return;
  }
  const cropHeroImageBtn = e.target.closest('[data-cropheroimage]');
  if (cropHeroImageBtn) {
    e.preventDefault();
    e.stopPropagation();
    const card = cropHeroImageBtn.closest('[data-crop-card]');
    const fileInput = card?.querySelector('[data-heroimagefile]');
    const current = readAdminMediaValue(card, '[data-field="heroImage"]', '[data-heroimage-value]');
    const sourceDataUrl = fileInput?.files?.[0] ? await fileToDataUrl(fileInput.files[0]) : await imageUrlToDataUrl(current);
    if (!sourceDataUrl) { toast('เลือกรูปภาพปกหน้าก่อน', 'err'); return; }
    const result = await openImageCropper({ sourceDataUrl, title: 'ครอปภาพปกหน้า Landing', confirmText: 'ใช้ภาพปกนี้' });
    if (!result || result === '__original__') return;
    updateHeroImagePreview(card, result);
    if (fileInput) fileInput.value = '';
    scheduleCropPreview(card, 80);
    scheduleCropDraftSave(180);
    return;
  }
  const cropGalleryImageBtn = e.target.closest('[data-cropgalleryimage]');
  if (cropGalleryImageBtn) {
    e.preventDefault();
    e.stopPropagation();
    const item = cropGalleryImageBtn.closest('[data-crop-gallery]');
    const card = item?.closest('[data-crop-card]');
    const fileInput = item?.querySelector('[data-gallery-file]');
    const current = readAdminMediaValue(item, '[data-gallery-image-input]', '[data-gallery-image]');
    const sourceDataUrl = fileInput?.files?.[0] ? await fileToDataUrl(fileInput.files[0]) : await imageUrlToDataUrl(current);
    if (!sourceDataUrl) { toast('เลือกรูปแกลเลอรีหรือใส่ลิงก์รูปก่อน', 'err'); return; }
    const result = await openImageCropper({ sourceDataUrl, title: 'ครอปรูปหน้า Landing', confirmText: 'ใช้รูปนี้' });
    if (!result || result === '__original__') return;
    updateGalleryPreview(item, result);
    if (fileInput) fileInput.value = '';
    scheduleCropPreview(card, 80);
    scheduleCropDraftSave(180);
    return;
  }
  const cropReviewImageBtn = e.target.closest('[data-cropreviewimage]');
  if (cropReviewImageBtn) {
    e.preventDefault();
    e.stopPropagation();
    const item = cropReviewImageBtn.closest('[data-crop-review]');
    const card = item?.closest('[data-crop-card]');
    const fileInput = item?.querySelector('[data-review-file]');
    const current = readAdminMediaValue(item, '[data-review-image-input]', '[data-review-image]');
    const sourceDataUrl = fileInput?.files?.[0] ? await fileToDataUrl(fileInput.files[0]) : await imageUrlToDataUrl(current);
    if (!sourceDataUrl) { toast('เลือกรูปรีวิวหรือใส่ลิงก์รูปก่อน', 'err'); return; }
    const result = await openImageCropper({ sourceDataUrl, title: 'ครอปรูปรีวิว', confirmText: 'ใช้รูปรีวิวนี้' });
    if (!result || result === '__original__') return;
    updateReviewPreview(item, result);
    if (fileInput) fileInput.value = '';
    scheduleCropPreview(card, 80);
    scheduleCropDraftSave(180);
    return;
  }
  const dela = e.target.closest('[data-delart]'); if (dela) { e.preventDefault(); e.stopPropagation(); const a = _adminArticles.find((x) => x.id === dela.dataset.delart); const ok = await confirmDialog({ title: 'ยืนยันการลบบทความ', message: `ต้องการลบบทความ "${a?.title || dela.dataset.delart}" ใช่ไหม`, confirmText: 'ลบบทความ', tone: 'danger' }); if (!ok) return; const r = await api('/api/admin/articles/' + dela.dataset.delart, { method: 'DELETE' }); const d = await r.json().catch(() => ({})); if (!r.ok) { toast(d.error || 'ลบบทความไม่สำเร็จ', 'err'); return; } toast('ลบบทความแล้ว', 'ok'); render(); return; }
  const oa = e.target.closest('[data-oaction]'); if (oa) {
    const oid = oa.dataset.oid; const action = oa.dataset.oaction;
    const tracking = action === 'shipped' ? (document.querySelector(`[data-track="${oid}"]`)?.value || '') : '';
    oa.disabled = true;
    try { const r = await api('/api/admin/orders/' + oid + '/status', { method: 'POST', body: JSON.stringify({ action, tracking }) }); if (!r.ok) throw new Error((await r.json()).error); toast('อัปเดตสถานะแล้ว', 'ok'); render(); }
    catch (err) { toast(err.message || 'ผิดพลาด', 'err'); oa.disabled = false; }
    return;
  }
  // coupons (admin)
  if (id === 'addCouponBtn') { const w = document.getElementById('couponFormWrap'); w.innerHTML = w.innerHTML ? '' : couponForm(null); return; }
  if (id === 'cancelCoupon') { document.getElementById('couponFormWrap').innerHTML = ''; return; }
  const ec = e.target.closest('[data-editcoupon]'); if (ec) { e.preventDefault(); e.stopPropagation(); const c = _coupons.find((x) => x.code === ec.dataset.editcoupon); document.getElementById('couponFormWrap').innerHTML = couponForm(c); return; }
  const dc = e.target.closest('[data-delcoupon]'); if (dc) { e.preventDefault(); e.stopPropagation(); const ok = await confirmDialog({ title: 'ยืนยันการลบคูปอง', message: `ต้องการลบคูปอง "${dc.dataset.delcoupon}" ใช่ไหม`, confirmText: 'ลบคูปอง', tone: 'danger' }); if (!ok) return; const r = await api('/api/admin/coupons/' + dc.dataset.delcoupon, { method: 'DELETE' }); const d = await r.json().catch(() => ({})); if (!r.ok) { toast(d.error || 'ลบคูปองไม่สำเร็จ', 'err'); return; } toast('ลบคูปองแล้ว', 'ok'); render(); return; }
  // users (admin)
  const su = e.target.closest('[data-saveuser]'); if (su) {
    const uid = su.dataset.saveuser;
    const name = document.querySelector(`[data-uname="${uid}"]`)?.value || '';
    const role = document.querySelector(`[data-urole="${uid}"]`)?.value || 'user';
    su.disabled = true;
    try { const r = await api('/api/admin/users/' + uid, { method: 'PUT', body: JSON.stringify({ name, role }) }); if (!r.ok) throw new Error((await r.json()).error); toast('บันทึกผู้ใช้แล้ว', 'ok'); render(); }
    catch (err) { toast(err.message, 'err'); su.disabled = false; }
    return;
  }
  const du = e.target.closest('[data-deluser]'); if (du) { e.preventDefault(); e.stopPropagation(); const userName = document.querySelector(`[data-uname="${du.dataset.deluser}"]`)?.value || du.dataset.deluser; const ok = await confirmDialog({ title: 'ยืนยันการลบผู้ใช้', message: `ต้องการลบผู้ใช้ "${userName}" ใช่ไหม`, confirmText: 'ลบผู้ใช้', tone: 'danger' }); if (!ok) return; const r = await api('/api/admin/users/' + du.dataset.deluser, { method: 'DELETE' }); if (!r.ok) { toast((await r.json()).error, 'err'); return; } toast('ลบผู้ใช้แล้ว', 'ok'); render(); return; }
  const inboxSessionBtn = e.target.closest('[data-inbox-session]');
  if (inboxSessionBtn) {
    setAdminInboxState({ sessionId: inboxSessionBtn.dataset.inboxSession || '' });
    setAdminInboxRoomsOpen(false);
    render();
    return;
  }
  const inboxDeleteBtn = e.target.closest('[data-admin-inbox-delete]');
  if (inboxDeleteBtn) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await deleteAdminInboxSession(inboxDeleteBtn.dataset.adminInboxDelete || '');
    } catch (err) {
      toast(err.message || 'ลบห้องแชตไม่สำเร็จ', 'err');
    }
    return;
  }
  const inboxRefreshBtn = e.target.closest('[data-admin-inbox-refresh]');
  if (inboxRefreshBtn) {
    refreshAdminInboxDom().catch((err) => toast(err.message || 'รีเฟรช inbox ไม่สำเร็จ', 'err'));
    return;
  }
  const inboxFullscreenBtn = e.target.closest('[data-admin-inbox-fullscreen]');
  if (inboxFullscreenBtn) {
    setAdminInboxFullscreen(!_adminInboxFullscreen);
    render();
    return;
  }
  const inboxRoomsBtn = e.target.closest('[data-admin-inbox-rooms]');
  if (inboxRoomsBtn) {
    setAdminInboxRoomsOpen(!_adminInboxRoomsOpen);
    return;
  }
  const inboxCloseRoomsBtn = e.target.closest('[data-admin-inbox-close-rooms]');
  if (inboxCloseRoomsBtn) {
    setAdminInboxRoomsOpen(false);
    return;
  }
  const inboxScrollBtn = e.target.closest('[data-admin-inbox-scroll]');
  if (inboxScrollBtn) {
    scrollAdminInboxToBottom('smooth');
    return;
  }
  const adminClearBtn = e.target.closest('[data-admin-clear]');
  if (adminClearBtn) {
    const key = adminClearBtn.dataset.adminClear;
    setAdminListState(key, { page: 1, q: '', filter: 'all' });
    render();
    return;
  }
  const adminPageBtn = e.target.closest('[data-admin-page]');
  if (adminPageBtn) {
    const key = adminPageBtn.dataset.adminPage;
    const action = adminPageBtn.dataset.pageAction;
    const state = getAdminListState(key);
    setAdminListState(key, { page: action === 'prev' ? state.page - 1 : state.page + 1 });
    render();
    return;
  }
  const adminInboxClearBtn = e.target.closest('[data-admin-inbox-clear]');
  if (adminInboxClearBtn) {
    setAdminInboxState({ page: 1, q: '', sessionId: '' });
    render();
    return;
  }
  const adminInboxPageBtn = e.target.closest('[data-admin-inbox-page]');
  if (adminInboxPageBtn) {
    const state = getAdminInboxState();
    setAdminInboxState({ page: adminInboxPageBtn.dataset.adminInboxPage === 'prev' ? state.page - 1 : state.page + 1 });
    render();
    return;
  }
  // coupon apply (checkout)
  if (id === 'couponApply') {
    const code = (document.getElementById('couponInput')?.value || '').trim();
    if (!code) return;
    e.target.disabled = true;
    try {
      const r = await api('/api/coupons/validate', { method: 'POST', body: JSON.stringify({ code, subtotal: cartTotal() }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      appliedCoupon = { code: d.coupon, discount: d.discount };
      toast('ใช้คูปองสำเร็จ −' + baht(d.discount), 'ok'); render();
    } catch (err) { toast(err.message || 'คูปองไม่ถูกต้อง', 'err'); e.target.disabled = false; }
    return;
  }
  if (id === 'couponRemove') { appliedCoupon = null; render(); return; }
  const sl = e.target.closest('[data-savelead]');
  if (sl) {
    const id = sl.dataset.savelead;
    const status = document.querySelector(`[data-lstatus="${id}"]`)?.value || 'new';
    const note = document.querySelector(`[data-lnote="${id}"]`)?.value || '';
    sl.disabled = true;
    try {
      const r = await api('/api/admin/leads/' + id, { method: 'PUT', body: JSON.stringify({ status, note }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'บันทึกไม่สำเร็จ');
      toast('บันทึกสถานะลีดแล้ว', 'ok');
      render();
    } catch (err) {
      toast(err.message, 'err');
      sl.disabled = false;
    }
    return;
  }
});

document.body.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target?.id !== 'adminProductCategoryInput') return;
  e.preventDefault();
  addProductCategoryValue(e.target.value);
});

// ════════════════════════ Live chat (REST send + poll — serverless-friendly) ════════════════════════
const chatBox = document.getElementById('chatBox');
const chatMessages = document.getElementById('chatMessages');
const chatStatus = document.getElementById('chatStatus');
const chatToggle = document.getElementById('chatToggle');
const chatCloseBtn = document.getElementById('chatClose');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const chatHead = chatBox?.querySelector('.chat-head');
let _lineRoomChatHomeParent = chatBox?.parentNode || null;
let _lineRoomChatHomeNextSibling = chatBox?.nextSibling || null;
function syncLineRoomChatMount(path = currentPath()) {
  if (!chatBox || typeof document === 'undefined') return;
  const mount = document.getElementById('lineRoomChatMount');
  const shouldEmbed = isLineRoomPath(path) && mount;
  if (shouldEmbed) {
    if (chatBox.parentNode !== mount) mount.appendChild(chatBox);
    chatBox.classList.add('line-room-embedded');
    return;
  }
  if (_lineRoomChatHomeParent && chatBox.parentNode !== _lineRoomChatHomeParent) {
    if (_lineRoomChatHomeNextSibling && _lineRoomChatHomeNextSibling.parentNode === _lineRoomChatHomeParent) {
      _lineRoomChatHomeParent.insertBefore(chatBox, _lineRoomChatHomeNextSibling);
    } else {
      _lineRoomChatHomeParent.appendChild(chatBox);
    }
  }
  chatBox.classList.remove('line-room-embedded');
}
const CHAT_LAYOUT_KEY = 'nuch_chat_layout_v1';
const CHAT_MARGIN = 18;
const CHAT_BOX_GAP = 14;
let _chatDrag = null;
let _chatSuppressToggleClick = false;
let _chatLayout = loadChatLayout();

// session id คงที่ต่อเบราว์เซอร์ (เก็บใน localStorage) เพื่อให้แอดมินตอบกลับห้องเดิมได้
currentSessionId = localStorage.getItem('nuch_chat_sid') || '';
let _chatLastAt = 0;
let _chatPollTimer = null;
let _chatGreeted = false;

function clamp(num, min, max) {
  return Math.min(max, Math.max(min, num));
}
function chatToggleSize() {
  return { width: chatToggle?.offsetWidth || 60, height: chatToggle?.offsetHeight || 60 };
}
function chatBoxSize() {
  const width = Math.min(chatBox?.offsetWidth || 360, Math.max(280, window.innerWidth - CHAT_MARGIN * 2));
  const height = Math.min(chatBox?.offsetHeight || 480, Math.max(320, window.innerHeight - CHAT_MARGIN * 2));
  return { width, height };
}
function defaultChatLayout() {
  const toggle = chatToggleSize();
  const box = chatBoxSize();
  return {
    toggle: {
      x: window.innerWidth - toggle.width - CHAT_MARGIN,
      y: window.innerHeight - toggle.height - CHAT_MARGIN,
    },
    box: {
      x: window.innerWidth - box.width - CHAT_MARGIN,
      y: window.innerHeight - box.height - CHAT_MARGIN,
    },
  };
}
function loadChatLayout() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_LAYOUT_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object') return defaultChatLayout();
    return { ...defaultChatLayout(), ...parsed };
  } catch {
    return defaultChatLayout();
  }
}
function derivedChatBoxPosition(togglePos) {
  const toggle = chatToggleSize();
  const box = chatBoxSize();
  return {
    x: clamp(togglePos.x + toggle.width - box.width, CHAT_MARGIN, window.innerWidth - box.width - CHAT_MARGIN),
    y: clamp(togglePos.y - box.height - CHAT_BOX_GAP, CHAT_MARGIN, window.innerHeight - box.height - CHAT_MARGIN),
  };
}
function normalizedChatLayout(layout = _chatLayout) {
  const toggle = chatToggleSize();
  const box = chatBoxSize();
  const fallback = defaultChatLayout();
  const togglePos = {
    x: clamp(layout?.toggle?.x ?? fallback.toggle.x, CHAT_MARGIN, window.innerWidth - toggle.width - CHAT_MARGIN),
    y: clamp(layout?.toggle?.y ?? fallback.toggle.y, CHAT_MARGIN, window.innerHeight - toggle.height - CHAT_MARGIN),
  };
  const boxSource = layout?.box || derivedChatBoxPosition(togglePos);
  const boxPos = {
    x: clamp(boxSource.x ?? 0, CHAT_MARGIN, window.innerWidth - box.width - CHAT_MARGIN),
    y: clamp(boxSource.y ?? 0, CHAT_MARGIN, window.innerHeight - box.height - CHAT_MARGIN),
  };
  return { toggle: togglePos, box: boxPos };
}
function saveChatLayout() {
  localStorage.setItem(CHAT_LAYOUT_KEY, JSON.stringify(_chatLayout));
}
function applyChatLayout(save = false) {
  _chatLayout = normalizedChatLayout(_chatLayout);
  if (chatToggle) {
    chatToggle.style.left = `${_chatLayout.toggle.x}px`;
    chatToggle.style.top = `${_chatLayout.toggle.y}px`;
    chatToggle.style.right = 'auto';
    chatToggle.style.bottom = 'auto';
  }
  if (chatBox) {
    chatBox.style.left = `${_chatLayout.box.x}px`;
    chatBox.style.top = `${_chatLayout.box.y}px`;
    chatBox.style.right = 'auto';
    chatBox.style.bottom = 'auto';
  }
  if (save) saveChatLayout();
}
function scrollChatToBottom(behavior = 'auto') {
  if (!chatMessages) return;
  try {
    chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior });
  } catch {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}
function setChatStatusText(value = '') {
  if (chatStatus) chatStatus.textContent = value;
}
function setChatOpen(open) {
  if (!chatBox) return;
  chatBox.classList.toggle('open', open);
  renderFloatingContactDock();
  if (open) {
    const fallback = defaultChatLayout();
    _chatLayout = normalizedChatLayout({
      toggle: fallback.toggle,
      box: fallback.box,
    });
    applyChatLayout();
    startChat();
    requestAnimationFrame(() => scrollChatToBottom('smooth'));
  }
}
function syncChatToggleToBox() {
  const toggle = chatToggleSize();
  const box = chatBoxSize();
  _chatLayout = normalizedChatLayout({
    toggle: {
      x: _chatLayout.box.x + box.width - toggle.width,
      y: _chatLayout.box.y + box.height + CHAT_BOX_GAP,
    },
    box: _chatLayout.box,
  });
}
function beginChatDrag(target, event) {
  if (!chatBox || !chatToggle) return;
  if (document.body.classList.contains('line-room-mode')) return;
  if (!event.isPrimary || (typeof event.button === 'number' && event.button !== 0)) return;
  if (target === 'box' && event.target.closest('button, a, input, textarea, form')) return;
  const layout = normalizedChatLayout(_chatLayout);
  _chatDrag = {
    target,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    origin: target === 'toggle' ? layout.toggle : layout.box,
    moved: false,
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
  if (target === 'toggle') chatToggle.classList.add('chat-dragging');
  if (target === 'box') chatBox.classList.add('chat-dragging');
}
function endChatDrag(event = null) {
  if (!_chatDrag) return;
  const moved = _chatDrag.moved;
  if (_chatDrag.target === 'toggle') chatToggle.classList.remove('chat-dragging');
  if (_chatDrag.target === 'box') chatBox.classList.remove('chat-dragging');
  if (event?.currentTarget?.releasePointerCapture && typeof _chatDrag.pointerId === 'number') {
    try { event.currentTarget.releasePointerCapture(_chatDrag.pointerId); } catch {}
  }
  _chatSuppressToggleClick = _chatDrag.target === 'toggle' && moved;
  _chatDrag = null;
  applyChatLayout(true);
}
chatToggle?.addEventListener('pointerdown', (event) => beginChatDrag('toggle', event));
chatHead?.addEventListener('pointerdown', (event) => beginChatDrag('box', event));
window.addEventListener('pointermove', (event) => {
  if (!_chatDrag || _chatDrag.pointerId !== event.pointerId) return;
  const dx = event.clientX - _chatDrag.startX;
  const dy = event.clientY - _chatDrag.startY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) _chatDrag.moved = true;
  if (_chatDrag.target === 'toggle') {
    _chatLayout = normalizedChatLayout({
      toggle: { x: _chatDrag.origin.x + dx, y: _chatDrag.origin.y + dy },
      box: null,
    });
  } else {
    _chatLayout = normalizedChatLayout({
      toggle: _chatLayout.toggle,
      box: { x: _chatDrag.origin.x + dx, y: _chatDrag.origin.y + dy },
    });
    syncChatToggleToBox();
  }
  applyChatLayout();
});
window.addEventListener('pointerup', endChatDrag);
window.addEventListener('pointercancel', endChatDrag);
chatToggle?.addEventListener('click', (event) => {
  if (_chatSuppressToggleClick) {
    event.preventDefault();
    event.stopPropagation();
    _chatSuppressToggleClick = false;
    return;
  }
  setChatOpen(!chatBox.classList.contains('open'));
});
chatCloseBtn?.addEventListener('click', () => {
  if (document.body.classList.contains('line-room-mode')) { go('/'); return; }
  setChatOpen(false);
});
function openChat() { setChatOpen(true); }
applyChatLayout();

function normalizedChatSessionId(value = '') {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
}
function resetChatTranscript(resetGreeting = false) {
  if (chatMessages) chatMessages.innerHTML = '';
  _chatTranscript = [];
  _chatTranscriptKeys = new Set();
  _chatLastAt = 0;
  if (resetGreeting) _chatGreeted = false;
}
function adoptCurrentChatSession(sessionId = '') {
  const normalized = normalizedChatSessionId(sessionId);
  if (!normalized) return;
  const prevSessionId = normalizedChatSessionId(currentSessionId);
  currentSessionId = normalized;
  localStorage.setItem('nuch_chat_sid', normalized);
  if (_chatTranscript.length) {
    saveCachedChatHistory(normalized, _chatTranscript);
    if (prevSessionId && prevSessionId !== normalized) saveCachedChatHistory(prevSessionId, _chatTranscript);
  }
  _chatActiveSessionId = normalized;
}
function appendChatEntry(raw = {}, options = {}) {
  const entry = normalizeChatEntry(raw);
  if (!entry || !chatMessages) return false;
  const key = chatEntryKey(entry);
  if (_chatTranscriptKeys.has(key)) return false;
  const shouldScroll = options.scroll !== false;
  const el = document.createElement('div');
  el.className = 'msg ' + entry.from;
  el.textContent = entry.text;
  chatMessages.appendChild(el);
  _chatTranscript.push(entry);
  _chatTranscriptKeys.add(key);
  syncChatLastAt();
  if (currentSessionId) saveCachedChatHistory(currentSessionId, _chatTranscript);
  if (entry.from === 'admin') {
    if (options.notify && shouldNotifyForIncomingAdminMessage()) {
      recomputeChatUnread();
      notifyCustomerChat(entry);
    } else if (chatBox?.classList.contains('open') && !document.hidden) {
      markChatSeen();
    } else {
      recomputeChatUnread();
    }
  }
  if (shouldScroll) scrollChatToBottom(options.behavior || 'smooth');
  return true;
}
function addMessage(from, text, options = {}) {
  return appendChatEntry({ from, text, at: options.at }, options);
}
function renderChatTranscript(entries = []) {
  resetChatTranscript();
  entries.forEach((entry) => appendChatEntry(entry, { scroll: false, notify: false }));
  recomputeChatUnread();
}
function ensureChatGreeting() {
  if (_chatTranscript.length || _chatGreeted) return;
  _chatGreeted = true;
  addMessage('system', 'สวัสดีค่ะ พิมพ์สอบถามได้เลย คุณจูนจะตอบกลับโดยเร็วค่ะ', { at: Date.now(), notify: false });
}
async function hydrateChatHistory(force = false) {
  const sessionId = normalizedChatSessionId(currentSessionId);
  if (!sessionId) {
    if (_chatActiveSessionId !== '') {
      _chatActiveSessionId = '';
      _chatHistoryLoadedSessionId = '';
      resetChatTranscript();
    }
    ensureChatGreeting();
    return;
  }
  if (!force && _chatActiveSessionId !== sessionId) {
    const cached = loadCachedChatHistory(sessionId);
    renderChatTranscript(cached);
    _chatActiveSessionId = sessionId;
  }
  if (!force && _chatHistoryLoadedSessionId === sessionId) {
    if (!_chatTranscript.length) ensureChatGreeting();
    recomputeChatUnread();
    return;
  }
  try {
    const r = await fetch(`/api/chat/history?session=${encodeURIComponent(sessionId)}&limit=200`);
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      const messages = Array.isArray(d?.messages) ? d.messages : [];
      if (messages.length) renderChatTranscript(messages);
      else ensureChatGreeting();
      _chatHistoryLoadedSessionId = sessionId;
      saveCachedChatHistory(sessionId, _chatTranscript);
      recomputeChatUnread();
      if (chatBox?.classList.contains('open') && !document.hidden) markChatSeen();
      return;
    }
  } catch {}
  if (!_chatTranscript.length) ensureChatGreeting();
  recomputeChatUnread();
}
function stopChatPolling() {
  if (_chatPollTimer) {
    clearInterval(_chatPollTimer);
    _chatPollTimer = null;
  }
}
async function pollChat() {
  if (!currentSessionId) return;
  try {
    const r = await fetch(`/api/chat/poll?session=${encodeURIComponent(currentSessionId)}&after=${_chatLastAt}`);
    const d = await r.json();
    for (const m of (d.messages || [])) {
      addMessage(m.from === 'admin' ? 'admin' : 'system', m.text, { at: m.at, notify: m.from === 'admin' });
    }
    if (!_chatSocketReady && !_chatRealtimeReady) setChatStatusText('🟢 ออนไลน์');
  } catch {
    if (!_chatSocketReady && !_chatRealtimeReady) setChatStatusText('🔴 ออฟไลน์');
  }
}
function disconnectChatRealtime() {
  if (_chatRealtimeChannel && _supabaseBrowser) {
    try { _supabaseBrowser.removeChannel(_chatRealtimeChannel); } catch {}
  }
  _chatRealtimeChannel = null;
  _chatRealtimeReady = false;
  _chatRealtimeSessionId = '';
}
async function ensureChatRealtime() {
  const sessionId = normalizedChatSessionId(currentSessionId);
  if (!chatRealtimeEnabled() || !sessionId) return null;
  if (_chatRealtimeChannel && _chatRealtimeSessionId === sessionId) return _chatRealtimeChannel;
  disconnectChatRealtime();
  const supabase = await getSupabaseBrowser();
  if (!supabase) return null;
  const channel = supabase.channel(`realtime:chat:${sessionId}`, { config: { broadcast: { self: false } } });
  channel.on('broadcast', { event: 'admin_message' }, ({ payload } = {}) => {
    if (payload?.text) addMessage('admin', payload.text, { at: payload.at, notify: true });
    setChatStatusText(chatSocketStatusLabel());
  });
  channel.subscribe((status) => {
    _chatRealtimeReady = status === 'SUBSCRIBED';
    setChatStatusText(chatSocketStatusLabel());
    if (_chatRealtimeReady) stopChatPolling();
  });
  _chatRealtimeChannel = channel;
  _chatRealtimeSessionId = sessionId;
  return channel;
}
function ensureChatSocket() {
  if (chatRealtimeEnabled()) return null;
  if (!hasSocketClient()) return null;
  if (_chatSocket) {
    if (_chatSocket.connected && !_chatSocketJoined) {
      _chatSocket.emit('chat:join', { sessionId: currentSessionId || undefined });
    }
    return _chatSocket;
  }
  _chatSocket = window.io('/', { transports: ['websocket', 'polling'] });
  _chatSocket.on('connect', () => {
    _chatSocketReady = true;
    _chatSocketJoined = false;
    setChatStatusText(chatSocketStatusLabel());
    _chatSocket.emit('chat:join', { sessionId: currentSessionId || undefined });
  });
  _chatSocket.on('chat:ready', (payload = {}) => {
    if (payload?.sessionId) {
      adoptCurrentChatSession(payload.sessionId);
      hydrateChatHistory().catch(() => {});
    }
    _chatSocketReady = true;
    _chatSocketJoined = true;
    setChatStatusText(chatSocketStatusLabel());
    stopChatPolling();
  });
  _chatSocket.on('chat:message', (payload = {}) => {
    const from = payload?.from === 'admin' ? 'admin' : 'system';
    if (payload?.text) addMessage(from, payload.text, { at: payload.at, notify: from === 'admin' });
    setChatStatusText(chatSocketStatusLabel());
  });
  _chatSocket.on('disconnect', () => {
    _chatSocketReady = false;
    _chatSocketJoined = false;
    setChatStatusText('🟡 กำลังเชื่อมต่อ...');
    if (!_chatPollTimer && currentSessionId) _chatPollTimer = setInterval(pollChat, 3000);
  });
  return _chatSocket;
}
function startChat() {
  if (!chatBox || !chatMessages || !chatStatus) return;
  requestChatNotificationPermission();
  hydrateChatHistory().catch(() => {});
  if (currentSessionId) {
    ensureChatRealtime().catch(() => {});
    pollChat().catch(() => {});
  }
  const socket = ensureChatSocket();
  if (!_chatRealtimeReady && !socket && !_chatPollTimer) {
    pollChat().catch(() => {});
    _chatPollTimer = setInterval(pollChat, 3000);
  }
  setChatStatusText((_chatRealtimeReady || _chatSocketReady) ? chatSocketStatusLabel() : '🟡 กำลังเชื่อมต่อ...');
  if (chatBox.classList.contains('open') && !document.hidden) markChatSeen();
  scrollChatToBottom('smooth');
}
async function sendChat(text) {
  if (!text || !text.trim()) return;
  const clean = String(text || '').trim().slice(0, 1000);
  if (!clean) return;
  const clientAt = Date.now();
  addMessage('customer', clean, { at: clientAt, notify: false });
  try {
    const useRealtime = chatRealtimeEnabled();
    const socket = useRealtime ? null : ensureChatSocket();
    if (socket && _chatSocketReady && _chatSocketJoined) {
      socket.emit('chat:message', { sessionId: currentSessionId || undefined, text: clean, at: clientAt });
    } else {
      const r = await fetch('/api/chat/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSessionId || undefined, text: clean, at: clientAt }),
      });
      const d = await r.json();
      if (d.sessionId) {
        adoptCurrentChatSession(d.sessionId);
        ensureChatRealtime().catch(() => {});
      }
    }
    startChat();
  } catch {
    addMessage('system', 'ส่งข้อความไม่สำเร็จ กรุณาลองใหม่', { at: Date.now(), notify: false });
  }
}
chatForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!chatInput) return;
  sendChat(chatInput.value);
  chatInput.value = '';
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && chatBox?.classList.contains('open')) markChatSeen();
});

// ════════════════════════ Motion ════════════════════════
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); revealObserver.unobserve(en.target); } });
}, { threshold: 0.12 });

const counterObserver = new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    if (!en.isIntersecting) return;
    const el = en.target;
    const target = parseFloat(el.dataset.count);
    const dec = parseInt(el.dataset.decimals || '0', 10);
    const suffix = el.dataset.suffix || '';
    const dur = 1400, t0 = performance.now();
    (function tick(now) {
      const p = Math.min((now - t0) / dur, 1);
      const val = target * (1 - Math.pow(1 - p, 3));
      el.textContent = (dec ? val.toFixed(dec) : Math.floor(val).toLocaleString()) + suffix;
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = (dec ? target.toFixed(dec) : target.toLocaleString()) + suffix;
    })(t0);
    counterObserver.unobserve(el);
  });
}, { threshold: 0.5 });

// run after each view render
function enhance() {
  document.querySelectorAll('.reveal:not(.in)').forEach((el) => revealObserver.observe(el));
  document.querySelectorAll('[data-count]').forEach((el) => counterObserver.observe(el));
  if (document.getElementById('calcCrop')) {
    syncCalcProblemSelect({ preserveSelection: true });
    syncCalcStageSelect({ preserveSelection: true });
    syncCalcPresetSelect({ preserveSelection: true });
    syncCalcCompareSelect({ preserveSelection: false });
    applyCalcBudgetSelection();
    renderCalcModeState();
    updateCalcPage();
  }
  if (document.getElementById('leadForm')) applyCalcLeadPrefill();
  if (document.getElementById('calcKnowledgeJson')) syncCalcKnowledgeEditor();
  attachTilt(document);
  // เล่นวิดีโอบนการ์ดตอน hover
  document.querySelectorAll('.card-vid').forEach((v) => {
    const card = v.closest('.card'); if (!card || card._vid) return; card._vid = true;
    card.addEventListener('pointerenter', () => { v.play().catch(() => {}); });
    card.addEventListener('pointerleave', () => { v.pause(); v.currentTime = 0; });
  });
}

// scroll: nav state
const nav = document.querySelector('.nav');
addEventListener('scroll', () => {
  const st = scrollY;
  if (nav) nav.classList.toggle('scrolled', st > 30);
}, { passive: true });

// quick view / lightbox / escape
document.body.addEventListener('click', (e) => {
  const q = e.target.closest('[data-quick]');
  if (q) { e.preventDefault(); e.stopPropagation(); openQuickView(q.dataset.quick); return; }
  if (e.target.closest('[data-qvclose]') || e.target.id === 'quickModal') { closeQuickView(); return; }
  const z = e.target.closest('[data-zoom]');
  if (z) { e.preventDefault(); openLightbox(z); return; }
  const lbClose = e.target.closest('.lb-close');
  if (lbClose) { e.preventDefault(); e.stopPropagation(); closeLightbox(); return; }
  const lbThumb = e.target.closest('[data-lbindex]');
  if (lbThumb) { e.preventDefault(); e.stopPropagation(); setLightboxIndex(parseInt(lbThumb.dataset.lbindex || '0', 10) || 0); return; }
  const lbNav = e.target.closest('[data-lbnav]');
  if (lbNav) { e.preventDefault(); e.stopPropagation(); moveLightbox(parseInt(lbNav.dataset.lbnav || '1', 10) || 1); return; }
  if (e.target.closest('.lb-dialog')) return;
  if (e.target.closest('#lightbox')) { closeLightbox(); return; }
  if (e.target.closest('[data-add]')) closeQuickView();
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeMobileNav(); closeQuickView(); closeLightbox(); closeImageCropper(null); }
  if (e.key === 'ArrowRight' && document.getElementById('lightbox')?.classList.contains('show')) moveLightbox(1);
  if (e.key === 'ArrowLeft' && document.getElementById('lightbox')?.classList.contains('show')) moveLightbox(-1);
});
// wishlist / search / filter / gallery / review-stars
document.body.addEventListener('click', (e) => {
  const calcCopyBtn = e.target.closest('#calcCopyBtn');
  if (calcCopyBtn) {
    e.preventDefault();
    const text = calcCopyBtn.dataset.copyText || '';
    if (!text) { toast('ยังไม่มีสูตรให้คัดลอก', 'err'); return; }
    copyTextToClipboard(text).then((ok) => {
      toast(ok ? 'คัดลอกสูตรผสมแล้ว' : 'คัดลอกไม่สำเร็จ', ok ? 'ok' : 'err');
    });
    return;
  }
  const calcPitchCopyBtn = e.target.closest('#calcPitchCopyBtn');
  if (calcPitchCopyBtn) {
    e.preventDefault();
    const text = calcPitchCopyBtn.dataset.copyText || '';
    if (!text) { toast('ยังไม่มีข้อความให้คัดลอก', 'err'); return; }
    copyTextToClipboard(text).then((ok) => {
      toast(ok ? 'คัดลอกข้อความพร้อมส่งแล้ว' : 'คัดลอกไม่สำเร็จ', ok ? 'ok' : 'err');
    });
    return;
  }
  const calcAddBundleBtn = e.target.closest('#calcAddBundleBtn');
  if (calcAddBundleBtn) {
    e.preventDefault();
    const plan = calcBundlePlan(calcAddBundleBtn.dataset.bundlePlan || '');
    if (!plan.length) { toast('ยังไม่มีชุดสูตรให้เพิ่มลงตะกร้า', 'err'); return; }
    const totalQty = applyCartPlan(plan);
    toast(`เพิ่มทั้งชุดตามขวดแนะนำแล้ว ${totalQty} ขวด`, 'ok');
    openCart();
    return;
  }
  const calcCheckoutNowBtn = e.target.closest('#calcCheckoutNowBtn');
  if (calcCheckoutNowBtn) {
    e.preventDefault();
    checkoutFromCalcPlan(calcCheckoutNowBtn.dataset.bundlePlan || '');
    return;
  }
  const calcBudgetBtn = e.target.closest('[data-calcbudget]');
  if (calcBudgetBtn) {
    e.preventDefault();
    const input = document.getElementById('calcBudgetLevel');
    if (!input) return;
    input.value = calcBudgetBtn.dataset.calcbudget || 'balanced';
    applyCalcBudgetSelection();
    updateCalcPage();
    return;
  }
  const calcProblemBtn = e.target.closest('[data-calc-problem]');
  if (calcProblemBtn) {
    e.preventDefault();
    const select = document.getElementById('calcProblem');
    if (!select) return;
    select.value = calcProblemBtn.dataset.calcProblem || '';
    syncCalcProblemSelect({ preserveSelection: true });
    applyCalcProblemSelection();
    syncCalcCompareSelect({ preserveSelection: false });
    document.querySelectorAll('[data-calc-product]').forEach((input) => input.closest('[data-calc-card]')?.classList.toggle('is-selected', input.checked));
    updateCalcPage();
    return;
  }
  const calcPlanDaysBtn = e.target.closest('[data-calcplandays]');
  if (calcPlanDaysBtn) {
    e.preventDefault();
    const input = document.getElementById('calcPlanDays');
    if (input) input.value = calcPlanDaysBtn.dataset.calcplandays || '14';
    document.querySelectorAll('[data-calcplandays]').forEach((btn) => btn.classList.toggle('on', btn === calcPlanDaysBtn));
    updateCalcPage();
    return;
  }
  const calcConsultLeadBtn = e.target.closest('#calcConsultLeadBtn');
  if (calcConsultLeadBtn) {
    e.preventDefault();
    const lineUrl = String(calcConsultLeadBtn.dataset.lineUrl || '').trim();
    const copyText = String(calcConsultLeadBtn.dataset.copyText || '').trim();
    if (!lineUrl) { toast('ยังไม่ได้ตั้งค่า LINE คุณจูน', 'err'); return; }
    trackEvent('line_click', { placement: 'calc_consult_personal' });
    window.open(lineUrl, '_blank', 'noopener');
    if (copyText) {
      copyTextToClipboard(copyText).then((copied) => {
        toast(copied ? 'คัดลอกข้อความสูตรแล้ว เปิด LINE คุณจูนให้แล้ว' : 'เปิด LINE คุณจูนให้แล้ว', copied ? 'ok' : 'warn');
      });
    } else {
      toast('เปิด LINE คุณจูนให้แล้ว', 'ok');
    }
    return;
  }
  const calcLineLink = e.target.closest('#calcOpenOaBtn');
  if (calcLineLink) {
    const placement = calcLineLink.id === 'calcOpenOaBtn'
      ? 'calc_open_oa'
      : 'calc_line';
    trackEvent('line_click', { placement });
  }
  const addMixBtn = e.target.closest('[data-addmix]');
  if (addMixBtn) {
    e.preventDefault();
    const card = addMixBtn.closest('[data-calc-crop-card]');
    const list = card?.querySelector('[data-mix-list]');
    if (!list || !card) return;
    list.insertAdjacentHTML('beforeend', calcKnowledgeMixEditorRow({
      stage: CALC_STAGE_TEMPLATE_OPTIONS[0],
      title: '',
      note: '',
      ids: [],
    }));
    updateCalcKnowledgeCropSummary(card);
    syncCalcKnowledgeEditor();
    return;
  }
  const toggleCalcCropBtn = e.target.closest('[data-togglecalccrop]');
  if (toggleCalcCropBtn) {
    e.preventDefault();
    const card = toggleCalcCropBtn.closest('[data-calc-crop-card]');
    if (!card) return;
    setCalcCropEditorCollapsed(card, !card.classList.contains('is-collapsed'));
    return;
  }
  const expandCalcCropsBtn = e.target.closest('[data-expandcalccrops]');
  if (expandCalcCropsBtn) {
    e.preventDefault();
    document.querySelectorAll('[data-calc-crop-card]').forEach((card) => setCalcCropEditorCollapsed(card, false));
    return;
  }
  const collapseCalcCropsBtn = e.target.closest('[data-collapsecalccrops]');
  if (collapseCalcCropsBtn) {
    e.preventDefault();
    document.querySelectorAll('[data-calc-crop-card]').forEach((card) => setCalcCropEditorCollapsed(card, true));
    return;
  }
  const dupMixBtn = e.target.closest('[data-dupmix]');
  if (dupMixBtn) {
    e.preventDefault();
    const row = dupMixBtn.closest('[data-mix-row]');
    const card = dupMixBtn.closest('[data-calc-crop-card]');
    const list = row?.parentElement;
    const crop = String(card?.dataset.cropName || '').trim();
    if (!row || !list || !card) return;
    const duplicated = readCalcMixEditorRow(row, { crop, index: list.querySelectorAll('[data-mix-row]').length });
    duplicated.title = duplicated.title ? `${duplicated.title} (คัดลอก)` : 'สูตรคัดลอก';
    row.insertAdjacentHTML('afterend', calcKnowledgeMixEditorRow(duplicated));
    updateCalcKnowledgeCropSummary(card);
    syncCalcKnowledgeEditor();
    toast('ทำซ้ำสูตรแล้ว', 'ok');
    return;
  }
  const delMixBtn = e.target.closest('[data-delmix]');
  if (delMixBtn) {
    e.preventDefault();
    const row = delMixBtn.closest('[data-mix-row]');
    const card = delMixBtn.closest('[data-calc-crop-card]');
    if (!row) return;
    row.remove();
    updateCalcKnowledgeCropSummary(card);
    syncCalcKnowledgeEditor();
    return;
  }
  const scrollLead = e.target.closest('[data-scrolllead]');
  if (scrollLead) {
    e.preventDefault();
    scrollToLeadBlock({ focusInput: true });
    return;
  }
  const prefillCrop = e.target.closest('[data-prefillcrop]');
  if (prefillCrop) {
    e.preventDefault();
    scrollToLeadBlock({ focusInput: true });
    setTimeout(() => {
      const cropEl = document.getElementById('leadCrop');
      if (cropEl) {
        cropEl.value = prefillCrop.dataset.prefillcrop || '';
        cropEl.dataset.pendingCrop = cropEl.value;
      }
    }, 250);
    return;
  }
  const w = e.target.closest('[data-wish]');
  if (w) { e.preventDefault(); e.stopPropagation(); toggleWishlist(w.dataset.wish); w.classList.toggle('on', wishlist.has(w.dataset.wish)); if (currentPath() === '/wishlist') render(); return; }
  const cr = e.target.closest('[data-crop]');
  if (cr) {
    _pf.crop = cr.dataset.crop || null;
    document.querySelectorAll('[data-crop]').forEach((b) => b.classList.toggle('on', b === cr));
    const tip = document.getElementById('cropTip');
    const guideMap = cropGuideMap();
    if (tip) tip.innerHTML = (_pf.crop && guideMap[_pf.crop]) ? `<div class="crop-tip glass">💡 <b>${esc(_pf.crop)}:</b> ${esc(guideMap[_pf.crop].tip)}</div>` : '';
    renderProductGrid(); return;
  }
  const categoryBtn = e.target.closest('[data-category]');
  if (categoryBtn) {
    _pf.category = categoryBtn.dataset.category || 'all';
    document.querySelectorAll('[data-category]').forEach((b) => b.classList.toggle('on', b === categoryBtn));
    renderProductGrid();
    return;
  }
  const availabilityBtn = e.target.closest('[data-availability]');
  if (availabilityBtn) {
    _pf.availability = availabilityBtn.dataset.availability || 'all';
    document.querySelectorAll('[data-availability]').forEach((b) => b.classList.toggle('on', b === availabilityBtn));
    renderProductGrid();
    return;
  }
  const th = e.target.closest('[data-mi]');
  if (th) { renderMain(+th.dataset.mi); return; }
  const calcModeBtn = e.target.closest('[data-calcmode]');
  if (calcModeBtn) {
    setCalcUsageMode(calcModeBtn.dataset.calcmode);
    renderCalcModeState();
    updateCalcPage();
    return;
  }
  const sp = e.target.closest('[data-star]');
  if (sp) { const n = +sp.dataset.star; const pick = sp.closest('#starPick'); pick.querySelectorAll('button').forEach((b, j) => b.classList.toggle('on', j < n)); pick.parentElement.querySelector('[name=rating]').value = n; return; }
  const reviewTemplate = e.target.closest('[data-reviewtemplate]');
  if (reviewTemplate) return;
});
document.body.addEventListener('input', (e) => {
  if (e.target.matches('[data-cropzoom]')) {
    if (!imageCropperState) return;
    imageCropperState.zoom = clampNumber(parseFloat(e.target.value || '1') || 1, 1, 3);
    renderImageCropper();
    return;
  }
  if (e.target.id === 'searchInput') { _pf.q = e.target.value; renderProductGrid(); }
  if (['calcPageTank', 'calcTankCount', 'calcWaterTotal', 'calcAreaRai', 'calcWaterPerRai', 'calcRefTank', 'calcStrength'].includes(e.target.id)) {
    if (e.target.id === 'calcWaterPerRai') e.target.dataset.touched = '1';
    updateCalcPage();
  }
  if (e.target.matches('[data-calc-product]')) {
    e.target.closest('[data-calc-card]')?.classList.toggle('is-selected', e.target.checked);
    const preset = document.getElementById('calcPreset');
    const problem = document.getElementById('calcProblem');
    if (preset) preset.value = '';
    if (problem) problem.value = '';
    syncCalcProblemSelect({ preserveSelection: true });
    syncCalcPresetSelect({ preserveSelection: true });
    syncCalcCompareSelect({ preserveSelection: true });
    updateCalcPage();
  }
  if (e.target.classList.contains('calc-tank')) {
    const box = e.target.closest('.calc-box');
    const r = { per: +box.dataset.per, min: +box.dataset.min, max: +box.dataset.max };
    const strength = box.querySelector('.calc-strength')?.value || 'mid';
    box.querySelector('.calc-out').innerHTML = `ใช้ <b>${calcResult(r, parseInt(e.target.value, 10) || 0, strength)}</b> ต่อถัง`;
  }
  if (e.target.classList.contains('calc-strength')) {
    const box = e.target.closest('.calc-box');
    const tank = parseInt(box?.querySelector('.calc-tank')?.value || '0', 10) || 0;
    const r = { per: +box.dataset.per, min: +box.dataset.min, max: +box.dataset.max };
    box.querySelector('.calc-out').innerHTML = `ใช้ <b>${calcResult(r, tank, e.target.value || 'mid')}</b> ต่อถัง`;
  }
  if (e.target.matches('[data-review-image-input]')) {
    updateReviewPreview(e.target.closest('[data-crop-review]'), e.target.value);
  }
  if (e.target.matches('[data-gallery-image-input]')) {
    updateGalleryPreview(e.target.closest('[data-crop-gallery]'), e.target.value);
  }
  if (e.target.matches('[data-field="seoImage"]')) {
    updateSeoImagePreview(e.target.closest('[data-crop-card]'), e.target.value);
  }
  if (e.target.matches('[data-field="heroImage"]')) {
    updateHeroImagePreview(e.target.closest('[data-crop-card]'), e.target.value);
  }
  if (e.target.matches('[data-field="heroRatio"], [data-field="heroFocus"]')) {
    const card = e.target.closest('[data-crop-card]');
    updateHeroImagePreview(card, card?.querySelector('[data-field="heroImage"]')?.value || '');
  }
  if (e.target.matches('[data-field="crop"], [data-field="slug"], [data-field="enabled"]')) {
    updateCropAdminCardSummary(e.target.closest('[data-crop-card]'));
  }
  if (e.target.closest('#calcKnowledgeEditor')) {
    syncCalcKnowledgeEditor();
  }
  const cropCard = e.target.closest('[data-crop-card]');
  if (cropCard && !e.target.matches('[type="file"]')) {
    scheduleCropPreview(cropCard);
    scheduleCropDraftSave();
  }
});
document.body.addEventListener('change', async (e) => {
  if (e.target.matches('[data-account-avatar-file]')) {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    const preview = document.querySelector('[data-account-avatar-preview]');
    const hidden = e.target.closest('form')?.querySelector('input[name=avatar]');
    if (hidden) hidden.value = '';
    if (preview) preview.innerHTML = `<img src="${esc(dataUrl)}" alt="profile preview">`;
    return;
  }
  if (e.target.id === 'adminStoreSwitcher') {
    setAdminSelectedStoreId(e.target.value || 'store_main');
    _adminSelectedProductIds.clear();
    adminInboxState.sessionId = '';
    _adminInboxUnreadTotal = 0;
    toast('เปลี่ยนร้านที่จัดการแล้ว', 'ok');
    render();
    return;
  }
  if (e.target.matches('[data-admin-limit]')) {
    const key = e.target.dataset.adminLimit;
    setAdminListState(key, { limit: parseInt(e.target.value, 10) || 20, page: 1 });
    render();
    return;
  }
  if (e.target.matches('[data-admin-inbox-limit]')) {
    setAdminInboxState({ limit: parseInt(e.target.value, 10) || 20, page: 1, sessionId: '' });
    render();
    return;
  }
  if (e.target.matches('[data-selectprod]')) {
    const productId = e.target.dataset.selectprod;
    if (e.target.checked) _adminSelectedProductIds.add(productId);
    else _adminSelectedProductIds.delete(productId);
    syncAdminProductSelectionUI();
    return;
  }
  if (e.target.id === 'adminSelectAllProducts') {
    if (e.target.checked) _adminProducts.forEach((item) => _adminSelectedProductIds.add(item.id));
    else _adminSelectedProductIds.clear();
    syncAdminProductSelectionUI();
    return;
  }
  if (e.target.matches('#productForm input[name=image]')) {
    const form = e.target.closest('#productForm');
    ensureProductFormCropState(form);
    const file = e.target.files?.[0];
    if (!file) {
      form._productImageDraft = null;
      renderProductImageDraft(form);
      return;
    }
    const sourceDataUrl = await fileToDataUrl(file);
    form._productImageDraft = { id: productDraftId(), fileName: file.name || 'รูปสินค้าใหม่', sourceDataUrl, croppedDataUrl: '' };
    e.target.value = '';
    renderProductImageDraft(form);
    const result = await openImageCropper({ sourceDataUrl, title: 'ครอปรูปหลักสินค้า', confirmText: 'ใช้รูปหลักนี้' });
    if (result && result !== '__original__') form._productImageDraft.croppedDataUrl = result;
    renderProductImageDraft(form);
    return;
  }
  if (e.target.matches('#productForm input[name=images]')) {
    const form = e.target.closest('#productForm');
    ensureProductFormCropState(form);
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    const drafts = await Promise.all(files.map(async (file) => ({
      id: productDraftId(),
      fileName: file.name || 'รูปแกลเลอรี',
      sourceDataUrl: await fileToDataUrl(file),
      croppedDataUrl: '',
    })));
    form._productGalleryDrafts = [...(form._productGalleryDrafts || []), ...drafts];
    e.target.value = '';
    renderProductGalleryDrafts(form);
    toast(`เพิ่มรูปใหม่ ${drafts.length} รูปแล้ว กดครอปทีละรูปได้`, 'ok');
    return;
  }
  if (e.target.matches('#articleForm input[name=cover]')) {
    const form = e.target.closest('#articleForm');
    ensureArticleFormCropState(form);
    const file = e.target.files?.[0];
    if (!file) {
      form._articleCoverDraft = null;
      renderArticleCoverDraft(form);
      return;
    }
    const sourceDataUrl = await fileToDataUrl(file);
    form._articleCoverDraft = { id: productDraftId(), fileName: file.name || 'รูปปกบทความใหม่', sourceDataUrl, croppedDataUrl: '' };
    e.target.value = '';
    renderArticleCoverDraft(form);
    const result = await openImageCropper({ sourceDataUrl, title: 'ครอปรูปปกบทความ', confirmText: 'ใช้รูปปกนี้' });
    if (result && result !== '__original__') form._articleCoverDraft.croppedDataUrl = result;
    renderArticleCoverDraft(form);
    return;
  }
  if (e.target.id === 'sortSelect') { _pf.sort = e.target.value; renderProductGrid(); }
  if (e.target.id === 'coCountry') { const el = document.getElementById('sumTotals'); if (el) el.innerHTML = checkoutTotalsHTML(); }
  if (['calcCrop', 'calcProblem', 'calcStage', 'calcPreset', 'calcComparePreset', 'calcIncludeSticker', 'calcStrength'].includes(e.target.id)) {
    if (e.target.id === 'calcCrop') {
      syncCalcProblemSelect({ preserveSelection: false });
      syncCalcStageSelect({ preserveSelection: false });
      syncCalcPresetSelect({ preserveSelection: false });
      const cfg = calcCropConfig(e.target.value);
      const areaWaterInput = document.getElementById('calcWaterPerRai');
      if (areaWaterInput) {
        areaWaterInput.value = String(cfg?.waterPerRai || defaultWaterPerRai(calcRatedProducts()[0]));
        delete areaWaterInput.dataset.touched;
      }
      applyCalcPresetSelection();
      applyCalcBudgetSelection();
      syncCalcCompareSelect({ preserveSelection: false });
      document.querySelectorAll('[data-calc-product]').forEach((input) => input.closest('[data-calc-card]')?.classList.toggle('is-selected', input.checked));
    }
    if (e.target.id === 'calcProblem') {
      applyCalcProblemSelection();
      applyCalcBudgetSelection();
      syncCalcCompareSelect({ preserveSelection: false });
      document.querySelectorAll('[data-calc-product]').forEach((input) => input.closest('[data-calc-card]')?.classList.toggle('is-selected', input.checked));
    }
    if (e.target.id === 'calcStage') {
      const problem = document.getElementById('calcProblem');
      if (problem) problem.value = '';
      syncCalcProblemSelect({ preserveSelection: true });
      syncCalcPresetSelect({ preserveSelection: false });
      applyCalcPresetSelection();
      applyCalcBudgetSelection();
      syncCalcCompareSelect({ preserveSelection: false });
      document.querySelectorAll('[data-calc-product]').forEach((input) => input.closest('[data-calc-card]')?.classList.toggle('is-selected', input.checked));
    }
    if (e.target.id === 'calcPreset') {
      const problem = document.getElementById('calcProblem');
      if (problem) problem.value = '';
      syncCalcProblemSelect({ preserveSelection: true });
      applyCalcPresetSelection();
      applyCalcBudgetSelection();
      document.querySelectorAll('[data-calc-product]').forEach((input) => input.closest('[data-calc-card]')?.classList.toggle('is-selected', input.checked));
      syncCalcPresetSelect({ preserveSelection: true });
      syncCalcCompareSelect({ preserveSelection: false });
    }
    updateCalcPage();
  }
  if (e.target.closest('#calcKnowledgeEditor')) {
    syncCalcKnowledgeEditor();
  }
  if (e.target.matches('[data-review-image-input]')) {
    updateReviewPreview(e.target.closest('[data-crop-review]'), e.target.value);
  }
  if (e.target.matches('[data-gallery-image-input]')) {
    updateGalleryPreview(e.target.closest('[data-crop-gallery]'), e.target.value);
  }
  if (e.target.matches('[data-review-file]')) {
    const wrap = e.target.closest('[data-crop-review]');
    const file = e.target.files?.[0];
    const input = wrap?.querySelector('[data-review-image-input]');
    const preview = wrap?.querySelector('[data-review-preview]');
    if (!preview) return;
    if (!file) {
      updateReviewPreview(wrap, input?.value || '');
      return;
    }
    const localUrl = URL.createObjectURL(file);
    if (input) input.value = '';
    preview.classList.remove('is-empty');
    preview.innerHTML = `<img src="${localUrl}">`;
  }
  if (e.target.matches('[data-gallery-file]')) {
    const wrap = e.target.closest('[data-crop-gallery]');
    const file = e.target.files?.[0];
    const input = wrap?.querySelector('[data-gallery-image-input]');
    const preview = wrap?.querySelector('[data-gallery-preview]');
    if (!preview) return;
    if (!file) {
      updateGalleryPreview(wrap, input?.value || '');
      return;
    }
    const localUrl = URL.createObjectURL(file);
    if (input) input.value = '';
    preview.classList.remove('is-empty');
    preview.innerHTML = `<img src="${localUrl}">`;
  }
  if (e.target.matches('[data-seoimagefile]')) {
    const card = e.target.closest('[data-crop-card]');
    const file = e.target.files?.[0];
    if (!card) return;
    if (!file) {
      updateSeoImagePreview(card, card.querySelector('[data-field="seoImage"]')?.value || '');
      return;
    }
    const localUrl = URL.createObjectURL(file);
    updateSeoImagePreview(card, localUrl);
    scheduleCropPreview(card, 80);
  }
  if (e.target.matches('[data-heroimagefile]')) {
    const card = e.target.closest('[data-crop-card]');
    const file = e.target.files?.[0];
    if (!card) return;
    if (!file) {
      updateHeroImagePreview(card, card.querySelector('[data-field="heroImage"]')?.value || '');
      return;
    }
    const localUrl = URL.createObjectURL(file);
    updateHeroImagePreview(card, localUrl);
    scheduleCropPreview(card, 80);
  }
  if (e.target.matches('[data-field="heroRatio"], [data-field="heroFocus"]')) {
    const card = e.target.closest('[data-crop-card]');
    updateHeroImagePreview(card, card?.querySelector('[data-field="heroImage"]')?.value || '');
  }
  if (e.target.matches('[data-bulkreviewfiles]')) {
    const input = e.target;
    const files = [...(input.files || [])];
    const list = input.closest('.crop-review-head')?.parentElement?.querySelector('[data-review-list]');
    if (!files.length || !list) return;
    input.disabled = true;
    (async () => {
      try {
        for (const file of files) {
          const image = await uploadAdminAsset(file);
          list.insertAdjacentHTML('beforeend', cropReviewEditor({ image }));
        }
        scheduleCropPreview(list.closest('[data-crop-card]'), 80);
        scheduleCropDraftSave(180);
        toast(`เพิ่มรูปรีวิว ${files.length} รูปแล้ว`, 'ok');
      } catch (err) {
        toast(err.message || 'อัปโหลดรูปรีวิวไม่สำเร็จ', 'err');
      } finally {
        input.value = '';
        input.disabled = false;
      }
    })();
  }
  if (e.target.matches('[data-bulkgalleryfiles]')) {
    const input = e.target;
    const files = [...(input.files || [])];
    const list = input.closest('.crop-review-head')?.parentElement?.querySelector('[data-gallery-list]');
    if (!files.length || !list) return;
    input.disabled = true;
    (async () => {
      try {
        for (const file of files) {
          const image = await uploadAdminAsset(file);
          list.insertAdjacentHTML('beforeend', cropGalleryEditor({ image }));
        }
        scheduleCropPreview(list.closest('[data-crop-card]'), 80);
        scheduleCropDraftSave(180);
        toast(`เพิ่มรูปภาพหน้า Landing ${files.length} รูปแล้ว`, 'ok');
      } catch (err) {
        toast(err.message || 'อัปโหลดรูปภาพหน้า Landing ไม่สำเร็จ', 'err');
      } finally {
        input.value = '';
        input.disabled = false;
      }
    })();
  }
  if (e.target.matches('[data-field="enabled"]')) {
    updateCropAdminCardSummary(e.target.closest('[data-crop-card]'));
  }
  if (e.target.matches('[data-reviewtemplate]')) {
    const item = e.target.closest('[data-crop-review]');
    applyReviewTemplate(item, e.target.value || '');
    scheduleCropPreview(item?.closest('[data-crop-card]'), 80);
    scheduleCropDraftSave(120);
  }
  const cropCard = e.target.closest('[data-crop-card]');
  if (cropCard) scheduleCropPreview(cropCard, 100);
});
let draggedCropCard = null;
let draggedGalleryItem = null;
let draggedReviewItem = null;
let draggedCalcMixRow = null;
document.body.addEventListener('dragstart', (e) => {
  const mixRow = e.target.closest('[data-mix-row]');
  if (mixRow) {
    draggedCalcMixRow = mixRow;
    mixRow.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    return;
  }
  const gallery = e.target.closest('[data-crop-gallery]');
  if (gallery) {
    draggedGalleryItem = gallery;
    gallery.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    return;
  }
  const review = e.target.closest('[data-crop-review]');
  if (review) {
    draggedReviewItem = review;
    review.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    return;
  }
  const card = e.target.closest('[data-crop-card]');
  if (!card) return;
  draggedCropCard = card;
  card.classList.add('is-dragging');
  e.dataTransfer.effectAllowed = 'move';
});
document.body.addEventListener('dragover', (e) => {
  const mixRow = e.target.closest('[data-mix-row]');
  if (draggedCalcMixRow && mixRow && mixRow !== draggedCalcMixRow) {
    e.preventDefault();
    const rect = mixRow.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    const parent = mixRow.parentElement;
    if (!parent) return;
    parent.insertBefore(draggedCalcMixRow, after ? mixRow.nextSibling : mixRow);
    return;
  }
  if (draggedCalcMixRow) return;
  const gallery = e.target.closest('[data-crop-gallery]');
  if (draggedGalleryItem && gallery && gallery !== draggedGalleryItem) {
    e.preventDefault();
    const rect = gallery.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    const parent = gallery.parentElement;
    if (!parent) return;
    parent.insertBefore(draggedGalleryItem, after ? gallery.nextSibling : gallery);
    return;
  }
  if (draggedGalleryItem) return;
  const review = e.target.closest('[data-crop-review]');
  if (draggedReviewItem && review && review !== draggedReviewItem) {
    e.preventDefault();
    const rect = review.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    const parent = review.parentElement;
    if (!parent) return;
    parent.insertBefore(draggedReviewItem, after ? review.nextSibling : review);
    return;
  }
  if (draggedReviewItem) return;
  const card = e.target.closest('[data-crop-card]');
  if (!draggedCropCard || !card || card === draggedCropCard) return;
  e.preventDefault();
  const rect = card.getBoundingClientRect();
  const after = e.clientY > rect.top + rect.height / 2;
  const parent = card.parentElement;
  if (!parent) return;
  parent.insertBefore(draggedCropCard, after ? card.nextSibling : card);
  [...parent.querySelectorAll('[data-crop-card]')].forEach((item, idx) => {
    const sortInput = item.querySelector('[data-field="sortOrder"]');
    if (sortInput) sortInput.value = String(idx);
  });
});
document.body.addEventListener('dragend', (e) => {
  const mixRow = e.target.closest('[data-mix-row]');
  if (mixRow) {
    mixRow.classList.remove('is-dragging');
    const card = mixRow.closest('[data-calc-crop-card]');
    updateCalcKnowledgeCropSummary(card);
    syncCalcKnowledgeEditor();
  }
  const gallery = e.target.closest('[data-crop-gallery]');
  if (gallery) {
    gallery.classList.remove('is-dragging');
    scheduleCropPreview(gallery.closest('[data-crop-card]'), 80);
    scheduleCropDraftSave(120);
  }
  const review = e.target.closest('[data-crop-review]');
  if (review) {
    review.classList.remove('is-dragging');
    scheduleCropPreview(review.closest('[data-crop-card]'), 80);
    scheduleCropDraftSave(120);
  }
  const card = e.target.closest('[data-crop-card]');
  if (card) {
    card.classList.remove('is-dragging');
    scheduleCropDraftSave(120);
  }
  draggedCropCard = null;
  draggedGalleryItem = null;
  draggedReviewItem = null;
  draggedCalcMixRow = null;
});
document.body.addEventListener('submit', async (e) => {
  if (e.target.matches('[data-admin-search-form]')) {
    e.preventDefault();
    const key = e.target.dataset.adminSearchForm;
    const fd = new FormData(e.target);
    setAdminListState(key, {
      page: 1,
      q: String(fd.get('q') || ''),
      filter: String(fd.get('filter') || 'all'),
    });
    render();
    return;
  }
  if (e.target.id === 'adminInboxSearchForm') {
    e.preventDefault();
    const fd = new FormData(e.target);
    setAdminInboxState({ page: 1, q: String(fd.get('q') || ''), sessionId: '' });
    render();
    return;
  }
  if (e.target.id === 'adminInboxReplyForm') {
    e.preventDefault();
    const form = e.target;
    const sessionId = String(form.dataset.sessionId || '').trim().toUpperCase();
    const input = form.querySelector('textarea[name=text]');
    const text = String(input?.value || '').trim();
    if (!sessionId || !text) return;
    const submitBtn = form.querySelector('button[type=submit]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      const r = await api(`/api/admin/inbox/${encodeURIComponent(sessionId)}/reply`, { method: 'POST', body: JSON.stringify({ text }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || 'ส่งข้อความไม่สำเร็จ');
      if (input) input.value = '';
      await refreshAdminInboxDom({ stickBottom: true });
      toast('ส่งข้อความตอบกลับแล้ว', 'ok');
    } catch (err) {
      toast(err.message || 'ส่งข้อความไม่สำเร็จ', 'err');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
    return;
  }
  if (e.target.id === 'leadForm') {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const body = {
      name: fd.get('name'),
      phone: fd.get('phone'),
      lineId: fd.get('lineId'),
      province: fd.get('province'),
      crop: fd.get('crop'),
      stage: fd.get('stage'),
      areaRai: fd.get('areaRai'),
      problem: fd.get('problem'),
      source: leadAttribution.source || 'website',
      landingPage: leadAttribution.landingPage || (location.pathname + location.hash),
      utmSource: leadAttribution.utmSource || '',
      utmMedium: leadAttribution.utmMedium || '',
      utmCampaign: leadAttribution.utmCampaign || '',
    };
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'กำลังส่งข้อมูล…';
    try {
      const r = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'ส่งข้อมูลไม่สำเร็จ');
      trackEvent('lead_submit', { crop: body.crop || '', source: body.source || 'website' });
      toast('ส่งข้อมูลเรียบร้อย คุณจูนจะติดต่อกลับเร็วที่สุด', 'ok');
      form.classList.add('is-success');
      form.innerHTML = leadSuccessHTML(body);
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false; btn.textContent = 'ส่งข้อมูลให้คุณจูนติดต่อกลับ';
    }
    return;
  }
  if (e.target.id !== 'reviewForm') return;
  e.preventDefault();
  const f = e.target, fd = new FormData(f), rating = +fd.get('rating');
  if (!rating) { toast('เลือกจำนวนดาวก่อนครับ', 'err'); return; }
  const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
  try {
    const r = await api('/api/products/' + f.dataset.pid + '/reviews', { method: 'POST', body: JSON.stringify({ rating, comment: fd.get('comment') }) });
    const d = await r.json(); if (!r.ok) throw new Error(d.error || 'ผิดพลาด');
    toast('ขอบคุณสำหรับรีวิว!', 'ok'); render();
  } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
});

// ════════════════════════ Init ════════════════════════
(async function init() {
  const bootPath = currentPath();
  const requiresAuthBootstrap = bootPath === '/account' || bootPath.startsWith('/admin');
  captureAttribution();
  applySite();
  renderSaleBanner();
  renderAccountNav();
  renderWishCount();
  renderCart();
  if (requiresAuthBootstrap) {
    await Promise.allSettled([
      loadMe(),
      loadSite(routeNeedsHeavySiteData(bootPath)),
    ]);
    applySite();
    renderSaleBanner();
    renderAccountNav();
  }
  render();
  // ยิง bootstrap เบื้องหลังแล้วค่อย rerender เมื่อข้อมูลหลักกลับมา แทนการบล็อก first paint
  Promise.allSettled([
    refreshProductsCache(),
    requiresAuthBootstrap ? Promise.resolve() : loadMe(),
    loadSite(routeNeedsHeavySiteData()),
  ]).then(() => {
    applySite();
    renderSaleBanner();
    renderAccountNav();
    renderWishCount();
    renderCart();
    render();
  }).catch(() => {});
  // อุ่นแคชบทความ + แกลเลอรีรีวิวเบื้องหลัง (ไม่บล็อกหน้าแรก) ให้กดเข้าหน้าพวกนี้แล้วไวทันที
  setTimeout(() => { refreshArticlesCache(); refreshReviewGallery(); }, 1200);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .then(() => (window.caches?.keys ? window.caches.keys().then((keys) => Promise.all(keys.map((key) => window.caches.delete(key)))) : null))
      .catch(() => {});
  }
})();
