const CACHE = 'salty-shell-v10';
const SHELL = ['./', './index.html', './styles.css?v=10', './app.js?v=10', './manifest.webmanifest', './manifest-amber.webmanifest', './manifest-foam.webmanifest', './manifest-ocean.webmanifest', './icon.svg', './icon-ink.svg', './icon-amber.svg', './icon-foam.svg', './icon-ocean.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match('./index.html'))));
});
