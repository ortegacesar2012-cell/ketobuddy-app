// KetoBuddy SW v99 - cache buster
const CACHE_NAME = 'ketobuddy-v99';

// On install - skip waiting immediately
self.addEventListener('install', e => {
  self.skipWaiting();
});

// On activate - delete ALL old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

// Network first - never serve from cache
self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
