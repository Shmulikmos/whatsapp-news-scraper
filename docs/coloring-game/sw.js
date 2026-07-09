const CACHE = 'magic-coloring-v6';
const FILES = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png',
  './refs/lion.jpg', './refs/elephant.jpg', './refs/leopard.jpg', './refs/rhino.jpg', './refs/eagle.jpg', './refs/zebra.jpg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request))
  );
});
