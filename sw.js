/**
 * SERVICE WORKER DAFTAR HARGA - ENTERPRISE GRADE FINAL (OPTIMIZED)
 * Strategi: Network-First, Cache-First (CDN Presisi), Stale-While-Revalidate (Background Safe)
 */

const APP_VERSION = '3.2'; // Ganti angka ini setiap kali Anda merilis pembaruan HTML/CSS/JS
const CACHE_CORE = 'core-v' + APP_VERSION; 
const CACHE_DYNAMIC = 'dyn-v' + APP_VERSION;
const CACHE_CDN = 'cdn-v1'; 

const MAX_DYNAMIC_ITEMS = 50; 
const MAX_CDN_ITEMS = 30; 

const coreUrls = ['./', './index.html', './manifest.json'];
const cdnDomains = ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];

// Helper: Trim Cache secara Paralel
async function trimCache(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxItems) {
      const keysToDelete = keys.slice(0, keys.length - maxItems);
      await Promise.all(keysToDelete.map(key => cache.delete(key)));
    }
  } catch (err) {} // Fail-safe senyap
}

// Helper: Fetch dengan Timeout 3 Detik
function fetchWithTimeout(request, timeout = 3000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  return fetch(request, { signal: controller.signal })
    .then(res => {
      clearTimeout(timeoutId); 
      return res;
    })
    .catch(err => {
      if (err.name === 'AbortError') throw new Error('TIMEOUT');
      throw err; 
    });
}

// Tahap 1: Install & Caching Core
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_CORE)
      .then(cache => cache.addAll(coreUrls))
      .then(() => self.skipWaiting())
  );
});

// Tahap 2: Activate, Cleanup Old Cache, & Notify Client
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(keys.map(key => {
        if (key !== CACHE_CORE && key !== CACHE_DYNAMIC && key !== CACHE_CDN) {
          return caches.delete(key);
        }
      }));
    })
    .then(() => self.clients.claim())
    .then(() => {
      // IDE BRILIAN: Kirim sinyal ke index.html bahwa ada versi baru
      return self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'UPDATE_TERSEDIA' });
        });
      });
    })
  );
});

// Tahap 3: Fetch Interceptor
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET' || url.hostname.includes('script.google') || !url.protocol.startsWith('http')) return;

  // STRATEGI 1: NETWORK-FIRST (HTML & Navigasi)
  if (req.mode === 'navigate' || url.pathname.match(/\/(index\.html)?$/)) {
    event.respondWith(
      fetchWithTimeout(req, 3000)
        .then(res => {
          const resClone = res.clone();
          caches.open(CACHE_CORE).then(cache => cache.put(req, resClone));
          return res;
        })
        .catch(() => {
          return caches.match('./index.html', { ignoreSearch: true })
            .then(cachedRes => cachedRes || new Response('Aplikasi Offline. Harap aktifkan internet.', { status: 503 }));
        })
    );
    return;
  }

  // STRATEGI 2: CACHE-FIRST (CDN & Library)
  if (cdnDomains.some(domain => url.hostname.includes(domain))) {
    event.respondWith(
      caches.match(req).then(cachedRes => cachedRes || fetch(req).then(res => {
        if (res.status === 200) {
          const resClone = res.clone();
          caches.open(CACHE_CDN).then(async cache => {
            await cache.put(req, resClone); 
            trimCache(CACHE_CDN, MAX_CDN_ITEMS); 
          });
        }
        return res;
      }).catch(() => new Response('', { status: 503 })))
    );
    return;
  }

  // STRATEGI 3: STALE-WHILE-REVALIDATE (Aset lainnya)
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cachedRes => {
      const fetchPromise = fetch(req).then(res => {
        if (res.status === 200) {
          const resClone = res.clone();
          caches.open(CACHE_DYNAMIC).then(async cache => {
            await cache.put(req, resClone); 
            trimCache(CACHE_DYNAMIC, MAX_DYNAMIC_ITEMS); 
          });
        }
        return res;
      }).catch(() => new Response('', { status: 503 }));

      if (cachedRes) {
        event.waitUntil(fetchPromise); 
        return cachedRes;
      }
      return fetchPromise;
    })
  );
});
