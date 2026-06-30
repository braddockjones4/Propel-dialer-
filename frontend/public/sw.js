// Kill-switch SW — clears all caches, unregisters, forces bare domain
self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', e => e.waitUntil((async () => {
  await self.clients.claim();
  const keys = await caches.keys();
  await Promise.all(keys.map(k => caches.delete(k)));
  const clients = await self.clients.matchAll({ type: 'window' });
  // Force navigation to bare domain so www SW never fires again
  clients.forEach(c => c.navigate('https://propeldialer.com/'));
  await self.registration.unregister();
})()));
// Pass all fetches through — don't cache anything
self.addEventListener('fetch', e => e.respondWith(fetch(e.request)));
