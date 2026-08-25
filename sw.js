const CACHE = 'sodium-shell-v82-stoke-tags';
const GUIDE_PAGES = Array.from({ length:4 }, (_, index) => `./docs/guide-v13/page-${String(index + 1).padStart(2, '0')}.jpg`);
const SHELL = ['./', './index.html', './styles.css?v=82-stoke-tags', './app.js?v=82-stoke-tags', './manifest.webmanifest', './icon.svg', './icon-180.png', './icon-192.png', './icon-512.png', './icon-ink.svg', './icon-amber.svg', './icon-foam.svg', './icon-ocean.svg', './icon-pink.svg', './docs/SODIUM_Quick_Start_Guide_V13.pdf', './docs/SODIUM_Master_Instruction_Manual_V1.pdf', './docs/SODIUM_App_Overview_One_Pager_V9.png', './docs/SODIUM_Setup_One_Pager_V2.png', './docs/SODIUM_Plan_A_Surf_One_Pager_V1.png', './docs/SODIUM_Get_Your_Clips_One_Pager_V1.png', ...GUIDE_PAGES];

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
  catch (_error) { payload = { body:event.data?.text() || 'Open Sodium for a crew update.' }; }
  event.waitUntil(self.registration.showNotification(payload.title || 'Sodium', {
    body: payload.body || 'Open Sodium for a crew update.',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: payload.tag || 'sodium-update',
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
