/**
 * SERVICE WORKER DAFTAR HARGA
 * Arsitektur: Network-First (HTML), Cache-First (CDN), Stale-While-Revalidate (Dynamic)
 */

// PENTING: Setiap kali kamu mengubah index.html atau menambah fitur, 
// kamu WAJIB menaikkan angka APP_VERSION ini (misal: '1.2', '1.3', dst).
// Ini adalah satu-satunya cara memberi tahu browser bahwa ada update baru.
const APP_VERSION = '1.9'; // Versi dinaikkan ke 1.8 untuk menerapkan perbaikan CDN

const CACHE_CORE = 'daftar-harga-core-v' + APP_VERSION; 
const CACHE_DYNAMIC = 'daftar-harga-dynamic-v' + APP_VERSION;
const CACHE_CDN = 'daftar-harga-cdn-v1'; 
const MAX_DYNAMIC_ITEMS = 50; 
let isTrimming = false;

// File inti yang wajib di-cache agar bisa dibuka offline
const coreUrls = [
  './',
  './index.html',
  './manifest.json'
];

// Domain eksternal yang di-cache permanen (Scanner, Font, & Pencarian)
const cdnDomains = [
  'unpkg.com',             // Untuk Scanner (html5-qrcode) & Excel (xlsx)
  'fonts.googleapis.com',  // Untuk Font Montserrat & Audiowide
  'fonts.gstatic.com',     // Untuk file woff2 font
  'cdn.jsdelivr.net'       // DITAMBAHKAN: Untuk library Fuse.js (Pencarian Offline)
];

async function trimCache(cacheName, maxItems) {
  if (isTrimming) return;
  isTrimming = true;
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxItems) {
      const itemsToDelete = keys.slice(0, keys.length - maxItems);
      await Promise.all(itemsToDelete.map(key => cache.delete(key)));
    }
  } catch (e) {
    console.error('Trim Cache Error:', e);
  } finally {
    isTrimming = false;
  }
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_CORE).then(cache => {
      return Promise.all(coreUrls.map(async url => {
        try {
          const req = new Request(url, { cache: 'reload' });
          const res = await fetch(req);
          if (res && res.ok) await cache.put(req, res);
        } catch (e) {
          console.warn(`Pre-cache gagal untuk: ${url}`);
        }
      }));
    }).then(() => self.skipWaiting()) // Memaksa versi baru langsung aktif
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(keys.map(key => {
        // Hapus cache versi lama yang sudah tidak terpakai (Auto-Clean)
        if (key.startsWith('daftar-harga-') && key !== CACHE_CORE && key !== CACHE_DYNAMIC && key !== CACHE_CDN) {
          return caches.delete(key);
        }
      }));
    }).then(() => self.clients.claim()) // Langsung mengendalikan halaman web
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Abaikan request selain GET, request Google Script, atau file sw.js itu sendiri
  if (req.method !== 'GET' || url.pathname.endsWith('sw.js') || url.hostname.includes('script.google') || !url.protocol.startsWith('http')) {
    return;
  }

  // 1. STRATEGI NETWORK-FIRST (Untuk HTML & Manifest)
  if (req.mode === 'navigate' || url.pathname.match(/\/(index\.html)?$/) || url.pathname.endsWith('manifest.json')) {
    event.respondWith(
      fetch(req).then(res => {
        if (!res || (res.status !== 200 && res.status !== 0 && res.type !== 'opaqueredirect')) throw new Error('Invalid response');
        const resClone = res.clone();
        caches.open(CACHE_CORE).then(cache => cache.put(req, resClone));
        return res;
      }).catch(async () => {
        const cachedRes = await caches.match(req, { ignoreSearch: true }) || 
                          await caches.match('./', { ignoreSearch: true }) || 
                          await caches.match('./index.html', { ignoreSearch: true });
        if (cachedRes) return cachedRes;
        return new Response('Aplikasi sedang offline.', { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain' } });
      })
    );
    return;
  }

  // 2. STRATEGI CACHE-FIRST (Untuk Library Scanner, Excel, Fuse.js & Google Fonts)
  if (cdnDomains.some(domain => url.hostname.includes(domain))) {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then(cachedRes => {
        if (cachedRes) return cachedRes; 
        return fetch(req).then(res => {
          if (!res || (res.status !== 200 && res.type !== 'opaque')) return res;
          const resClone = res.clone();
          caches.open(CACHE_CDN).then(cache => cache.put(req, resClone));
          return res;
        }).catch(() => new Response('', { status: 503 })); 
      })
    );
    return;
  }

  // 3. STRATEGI STALE-WHILE-REVALIDATE (Untuk file pendukung lainnya)
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cachedRes => {
      const fetchPromise = fetch(req).then(res => {
        if (res && res.status === 200) {
          const resClone = res.clone();
          caches.open(CACHE_DYNAMIC).then(cache => {
            cache.put(req, resClone).then(() => trimCache(CACHE_DYNAMIC, MAX_DYNAMIC_ITEMS));
          });
        }
        return res;
      }).catch(() => new Response('', { status: 503 }));

      if (cachedRes) {
        event.waitUntil(fetchPromise.catch(() => {}));
        return cachedRes;
      }
      return fetchPromise;
    })
  );
});
