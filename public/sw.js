// Nuch For Life service worker — network-first พร้อม cache fallback (ออนไลน์ได้ของสด, ออฟไลน์ยังเปิดได้)
const CACHE = 'nuchforlife-v20260625-3';
const SHELL = ['/', '/index.html', '/styles.css?v=20260625-3', '/app.js?v=20260625-3', '/icon.svg', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => {}));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;                          // ปล่อย cross-origin (fonts/CDN/stripe) ให้เบราว์เซอร์จัดการ
  if (/^\/(api|socket\.io|webhook|uploads)/.test(url.pathname)) return; // ไม่แคช API/realtime/ไฟล์อัปโหลด
  e.respondWith(
    fetch(req)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); return res; })
      .catch(() => caches.match(req).then((m) => m || caches.match('/')))
  );
});
