const APP_VERSION = '9.3'; // Naikkan versi ini jika ada update aplikasi
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

// Fitur 3: Pembersihan Otomatis (Storage Manager)
async function manageStorage() {
  if (navigator.storage && navigator.storage.estimate) {
    const quota = await navigator.storage.estimate();
    // Jika penggunaan lebih dari 80%, potong cache dinamis lebih agresif
    if (quota.usage / quota.quota > 0.8) {
      console.log('[SW] Memori hampir penuh, melakukan pembersihan ekstra...');
      await trimCache(CACHE_DYNAMIC, 20); // Sisakan hanya 20 item terbaru
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
  // Fitur 1: self.skipWaiting() DIHAPUS agar update terjadi diam-diam di background
  event.waitUntil(
    caches.open(CACHE_CORE).then(cache => {
      return cache.addAll(coreUrls).catch(err => {
        console.error('[SW] Gagal caching pondasi awal. Menunggu koneksi stabil...', err);
      });
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
      await manageStorage(); // Jalankan audit memori saat SW baru aktif
      return self.clients.claim();
    }) 
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET' || url.hostname.includes('script.google') || !url.protocol.startsWith('http')) return;

  // Fitur 2: Prioritas Audio Cache (Zero-Delay Beep)
  // Langsung ambil dari Cache, JANGAN cek internet untuk mempercepat proses scan
  if (url.pathname.includes('beep.mp3')) {
    event.respondWith(
      caches.match(req).then(cachedRes => {
        return cachedRes || fetch(req); // Fallback jika cache terhapus paksa
      })
    );
    return;
  }

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
            `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>Offline</title><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>body{background:#121212;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;}h2{color:#ff3b30;}p{color:#aaa;}</style></head><body><h2>⚠️ Koneksi Terputus</h2><p>Silakan periksa jaringan internet Anda.</p></body></html>`,
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
        }).catch(() => new Response('', { status: 503 }));
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
              const cleanRequest = new Request(cleanUrl, {
                method: req.method,
                headers: req.headers,
                mode: req.mode,
                credentials: req.credentials
              });
              await cache.put(cleanRequest, resClone); 
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
