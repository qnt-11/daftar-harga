/**
 * SERVICE WORKER DAFTAR HARGA - BULLETPROOF ENTERPRISE GRADE
 */

const APP_VERSION = '8.8'; 
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
  self.skipWaiting(); 
  event.waitUntil(
    caches.open(CACHE_CORE).then(cache => {
      return Promise.all(
        coreUrls.map(url => {
          return fetch(url).then(res => {
            if (res.ok) return cache.put(url, res);
          }).catch(err => console.warn('[SW] Peringatan: File pondasi belum siap:', url));
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
    }).then(() => self.clients.claim()) 
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET' || url.hostname.includes('script.google') || !url.protocol.startsWith('http')) return;

  // STRATEGI 1: NETWORK FIRST (Proteksi Anti-Racun Cache)
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.includes('index.html')) {
    event.respondWith(
      fetchWithTimeout(req, NETWORK_TIMEOUT)
        .then(res => {
          if (!res.ok) throw new Error('Server Error - Tidak Valid');
          
          const resClone = res.clone();
          event.waitUntil(caches.open(CACHE_CORE).then(cache => cache.put(req, resClone))); 
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_CORE);
          const offlineFile = await cache.match('/offline.html', { ignoreSearch: true });
          
          if (offlineFile) return offlineFile;
          
          return new Response(
            `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>Offline</title><style>body{background:#000;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}h2{color:#ff3b30;}</style></head><body><h2>⚠️ Sedang Offline</h2></body></html>`,
            { headers: { 'Content-Type': 'text/html' } }
          );
        })
    );
    return;
  }

  // STRATEGI 2: CACHE FIRST (CDN)
  if (cdnDomains.some(domain => url.hostname.includes(domain))) {
    event.respondWith(
      caches.match(req).then(cachedRes => {
        if (cachedRes) return cachedRes; 
        return fetch(req).then(res => {
          if (res.ok || res.type === 'opaque') {
            const resClone = res.clone();
            event.waitUntil(
              caches.open(CACHE_CDN).then(async cache => {
                await cache.put(req, resClone); 
                await trimCache(CACHE_CDN, MAX_CDN_ITEMS); 
              })
            );
          }
          return res;
        }).catch(err => new Response('', { status: 503 }));
      })
    );
    return;
  }

  // STRATEGI 3: STALE-WHILE-REVALIDATE (Aset Dinamis)
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cachedRes => {
      const fetchPromise = fetch(req).then(res => {
        if (res.ok) {
          const resClone = res.clone();
          event.waitUntil(
            caches.open(CACHE_DYNAMIC).then(async cache => {
              const cleanUrl = req.url.split('?')[0]; 
              await cache.put(cleanUrl, resClone); 
              await trimCache(CACHE_DYNAMIC, MAX_DYNAMIC_ITEMS); 
            })
          );
        }
        return res;
      }).catch(() => null);

      if (cachedRes) {
        event.waitUntil(fetchPromise); 
        return cachedRes;
      }
      return fetchPromise.then(res => res || new Response('', { status: 503 }));
    })
  );
});

// BACKGROUND SYNC FOUNDATION
self.addEventListener('sync', event => {
  if (event.tag === 'sync-data-antrean') {
    event.waitUntil(
      new Promise((resolve) => {
        console.log('[SW] Background Sync Aktif: Sinyal ditemukan...');
        resolve();
      })
    );
  }
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
