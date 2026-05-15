const APP_VERSION = '9.4'; 
const CACHE_CORE = 'core-v' + APP_VERSION; 
const CACHE_DYNAMIC = 'dyn-v' + APP_VERSION;
const CACHE_CDN = 'cdn-v1'; 

const MAX_DYNAMIC_ITEMS = 50; 
const MAX_CDN_ITEMS = 20;
const NETWORK_TIMEOUT = 8000; 

const coreUrls = [
  '/', 
  '/index.html', 
  '/manifest.json',
  '/offline.html',
  '/beep.mp3' 
];

const cdnDomains = [
  'unpkg.com', 
  'fonts.googleapis.com', 
  'fonts.gstatic.com', 
  'cdn.jsdelivr.net'
];

async function trimCache(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxItems) {
      const keysToDelete = keys.slice(0, keys.length - maxItems);
      await Promise.all(keysToDelete.map(key => cache.delete(key)));
    }
  } catch (err) {
    console.warn('[SW] Gagal membersihkan memori:', err);
  } 
}

// Fitur Pembersihan Memori HP Otomatis
async function manageStorage() {
  if (navigator.storage && navigator.storage.estimate) {
    const quota = await navigator.storage.estimate();
    if (quota.usage / quota.quota > 0.8) {
      console.log('[SW] Memori penuh, melakukan pembersihan ekstra...');
      await trimCache(CACHE_DYNAMIC, 20); 
    }
  }
}

function fetchWithTimeout(request, timeout = 5000) {
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

self.addEventListener('install', event => {
  self.skipWaiting(); // Wajib agar tombol "Refresh" di index.html berfungsi
  event.waitUntil(
    caches.open(CACHE_CORE).then(cache => {
      // Instalasi kebal error: Jika 1 file hilang (misal beep.mp3), aplikasi tetap bisa diinstal
      return Promise.allSettled(
        coreUrls.map(url => {
          return fetch(url).then(res => {
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            return cache.put(url, res);
          }).catch(err => console.warn(`[SW] File terlewat: ${url}`, err));
        })
      );
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(keys.map(key => {
        if (key !== CACHE_CORE && key !== CACHE_DYNAMIC && key !== CACHE_CDN) {
          return caches.delete(key); 
        }
      }));
    }).then(async () => {
      await manageStorage(); 
      return self.clients.claim();
    }) 
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET' || url.hostname.includes('script.google') || !url.protocol.startsWith('http')) return;

  // Zero-Delay Beep Sound (Membaca audio langsung dari RAM cache)
  if (url.pathname.includes('beep.mp3')) {
    event.respondWith(
      caches.match(req).then(cachedRes => cachedRes || fetch(req))
    );
    return;
  }

  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.includes('index.html')) {
    event.respondWith(
      fetchWithTimeout(req, NETWORK_TIMEOUT)
        .then(res => {
          if (!res.ok) throw new Error('Server Error');
          const resClone = res.clone();
          event.waitUntil(caches.open(CACHE_CORE).then(cache => cache.put(req, resClone))); 
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_CORE);
          const offlineFile = await cache.match('/offline.html', { ignoreSearch: true });
          if (offlineFile) return offlineFile;
          return new Response(
            `<!DOCTYPE html><html><body style="background:#000;color:#f00;text-align:center;padding:50px;"><h2>⚠️ Sedang Offline</h2></body></html>`,
            { headers: { 'Content-Type': 'text/html' } }
          );
        })
    );
    return;
  }

  if (cdnDomains.some(domain => url.hostname.includes(domain))) {
    event.respondWith(
      caches.match(req).then(cachedRes => {
        if (cachedRes) return cachedRes; 
        return fetch(req).then(res => {
          if (res.ok || res.type === 'opaque') {
            const resClone = res.clone();
            event.waitUntil(caches.open(CACHE_CDN).then(async cache => { await cache.put(req, resClone); await trimCache(CACHE_CDN, MAX_CDN_ITEMS); }));
          }
          return res;
        }).catch(() => new Response('', { status: 503 }));
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cachedRes => {
      const fetchPromise = fetch(req).then(res => {
        if (res.ok) {
          const resClone = res.clone();
          event.waitUntil(caches.open(CACHE_DYNAMIC).then(async cache => {
            const cleanUrl = req.url.split('?')[0];
            const cleanRequest = new Request(cleanUrl, { method: req.method, headers: req.headers, mode: req.mode, credentials: req.credentials });
            await cache.put(cleanRequest, resClone); await trimCache(CACHE_DYNAMIC, MAX_DYNAMIC_ITEMS); 
          }));
        }
        return res;
      }).catch(() => null);

      if (cachedRes) { event.waitUntil(fetchPromise); return cachedRes; }
      return fetchPromise.then(res => res || new Response('', { status: 503 }));
    })
  );
});

self.addEventListener('sync', event => {
  if (event.tag === 'sync-data-antrean') {
    event.waitUntil(new Promise((resolve) => resolve()));
  }
});
