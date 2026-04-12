const CACHE_NAME = 'wa-price-vForce-Load-v1';
const assets = ['./', './index.html', './manifest.json', 'https://unpkg.com/html5-qrcode'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(assets)));
});

self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then((res) => res || fetch(e.request)));
});
