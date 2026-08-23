const CACHE = 'salty-shell-v46-guide-v8';
const GUIDE_PAGES = Array.from({ length:4 }, (_, index) => `./docs/guide-v8/page-${String(index + 1).padStart(2, '0')}.jpg`);
const SHELL = ['./', './index.html', './styles.css?v=46', './app.js?v=46-guide8', './manifest.webmanifest', './icon.svg', './icon-ink.svg', './icon-amber.svg', './icon-foam.svg', './icon-ocean.svg', './docs/SALTY_Quick_Start_Guide_V8.pdf', ...GUIDE_PAGES];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put('./index.html', copy));
      return response;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match('./index.html'))));
});

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; }
  catch (_error) { payload = { body:event.data?.text() || 'Open Salty for a crew update.' }; }
  event.waitUntil(self.registration.showNotification(payload.title || 'Salty', {
    body: payload.body || 'Open Salty for a crew update.',
    icon: './icon-ink.svg',
    badge: './icon-ink.svg',
    tag: payload.tag || 'salty-update',
    renotify: Boolean(payload.renotify),
    data: { url:payload.url || './' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type:'window', includeUncontrolled:true }).then(async clients => {
    const existing = clients.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.navigate(target);
      return await existing.focus();
    }
    return await self.clients.openWindow(target);
  }));
});
