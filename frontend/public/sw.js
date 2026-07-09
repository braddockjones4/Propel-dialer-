// ── Propel Dialer Service Worker ──────────────────────────────────────────────
// Handles Web Share Target for .vcf contact files.
// When a user shares a .vcf from the iPhone Contacts app to this PWA,
// this SW catches it, stores the file, then redirects the app to load it.

const SHARE_CACHE = 'propel-share-v1';

self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // ── 1. Catch the share target POST ────────────────────────────────────────
  if (url.pathname === '/share-target' && e.request.method === 'POST') {
    e.respondWith((async () => {
      try {
        const formData = await e.request.formData();
        const file = formData.get('vcf');
        if (file && typeof file !== 'string') {
          const text = await file.text();
          const cache = await caches.open(SHARE_CACHE);
          await cache.put(
            '/shared-vcf-file',
            new Response(text, {
              headers: {
                'Content-Type': 'text/vcard',
                'X-Filename': file.name || 'contacts.vcf',
              },
            })
          );
        }
      } catch (err) {
        console.error('[SW] share-target error:', err);
      }
      // Redirect to app — the app checks for this param on load
      return Response.redirect('/?vcf-shared=1', 303);
    })());
    return;
  }

  // ── 2. Serve the stored file to the app (one-time, then delete) ───────────
  if (url.pathname === '/shared-vcf-file' && e.request.method === 'GET') {
    e.respondWith((async () => {
      const cache = await caches.open(SHARE_CACHE);
      const cached = await cache.match('/shared-vcf-file');
      if (cached) {
        await cache.delete('/shared-vcf-file');
        return cached;
      }
      return new Response('', { status: 404 });
    })());
    return;
  }

  // ── 3. Pass all other requests through normally ───────────────────────────
  e.respondWith(fetch(e.request));
});
