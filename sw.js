const CACHE_NAME = 'ketobuddy-v7';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(err => console.log('Cache partial fail:', err));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Always network for API
  if (url.pathname.includes('/.netlify/functions/') ||
      url.hostname === 'api.anthropic.com' ||
      url.hostname.includes('supabase.co') ||
      url.hostname === 'api.stripe.com') {
    return;
  }

  // Fonts - cache first
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(event.request).then(cached =>
        cached || fetch(event.request).then(res => {
          caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone()));
          return res;
        })
      )
    );
    return;
  }

  // HTML - ALWAYS network first so updates show immediately
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request).then(res => {
        if (res.status === 200) caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone()));
        return res;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Everything else - cache first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (event.request.method === 'GET' && res.status === 200)
          caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone()));
        return res;
      }).catch(() => event.request.mode === 'navigate' ? caches.match('/index.html') : undefined);
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
