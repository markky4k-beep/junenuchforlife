// Security cleanup worker: ล้าง cache เก่าทั้งหมดและยกเลิก service worker เพื่อลดการค้างของ asset/code ในเบราว์เซอร์
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys().catch(() => []);
    await Promise.all(keys.map((key) => caches.delete(key).catch(() => false)));
    await self.clients.claim();
    await self.registration.unregister().catch(() => false);
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }).catch(() => []);
    await Promise.all(clients.map((client) => client.navigate(client.url).catch(() => false)));
  })());
});
