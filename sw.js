/**
 * SERVICE WORKER DAFTAR HARGA - ENTERPRISE GRADE FINAL (ULTIMATE)
 * Strategi: Network-First (HTML), Cache-First (CDN), Stale-While-Revalidate (Dynamic)
 */

const APP_VERSION = '3.5'; // Naikkan angka ini setiap ada perubahan di index.html
const CACHE_CORE = 'core-v' + APP_VERSION; 
const CACHE_DYNAMIC = 'dyn-v' + APP_VERSION;
const CACHE_CDN = 'cdn-v1'; // Tidak perlu sering ganti versi untuk CDN

const MAX_DYNAMIC_ITEMS = 50; 
const MAX_CDN_ITEMS = 30; 

const coreUrls = ['./', './index.html', './manifest.json'];
const cdnDomains = ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];

// PRE-CACHE: Amankan Library Vital di Latar Belakang
const criticalLibraries = [
  'https://unpkg.com/html5-qrcode',
  'https://unpkg.com/xlsx/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/fuse.js/dist/fuse.min.js',
  'https://fonts.googleapis.com/css2?family=Audiowide&family=Montserrat:wght@400;500;600;700&display=swap'
];

// HELPER: Pembersih Memori Asinkron (Non-Blocking)
async function trimCache(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxItems) {
      const keysToDelete = keys.slice(0, keys.length - maxItems);
      await Promise.all(keysToDelete.map(key => cache.delete(key)));
    }
  } catch (err) {} 
}

// HELPER: Proteksi Sinyal Bapuk (Timeout 3 Detik)
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

// TAHAP 1: INSTALL (Instalasi Inti & Pre-Cache CDN secara senyap)
self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_CORE).then(cache => cache.addAll(coreUrls)),
      caches.open(CACHE_CDN).then(cache => {
        return Promise.all(criticalLibraries.map(url => {
            // FIX: Eksplisit CORS dan proteksi anti-cache poisoning
            return fetch(url, { mode: 'cors' }).then(response => {
                if(response.ok) cache.put(url, response);
            }).catch(()=>{});
        }));
      })
    ]).then(() => self.skipWaiting()) 
  );
});

// TAHAP 2: ACTIVATE (Sapu Bersih Memori Kadaluarsa)
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
  );
});

// TAHAP 3: MESIN PENCEGAT INTERNET (Fetch Interceptor)
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET' || url.hostname.includes('script.google') || !url.protocol.startsWith('http')) return;

  // STRATEGI 1: NETWORK-FIRST (Khusus Navigasi & HTML Utama)
  if (req.mode === 'navigate' || url.pathname.match(/\/(index\.html)?$/)) {
    event.respondWith(
      fetchWithTimeout(req, 3000)
        .then(res => {
          // FIX: Pastikan respon sukses sebelum menimpa HTML di memori
          if(res.ok) {
            const resClone = res.clone();
            caches.open(CACHE_CORE).then(cache => cache.put(req, resClone)); 
          }
          return res;
        })
        .catch(() => {
          return caches.match('./index.html', { ignoreSearch: true })
            .then(cachedRes => cachedRes || new Response('Aplikasi Offline. Harap aktifkan internet.', { status: 503 }));
        })
    );
    return;
  }

  // STRATEGI 2: CACHE-FIRST (Khusus CDN / Library Eksternal - Fokus Kecepatan)
  if (cdnDomains.some(domain => url.hostname.includes(domain))) {
    event.respondWith(
      caches.match(req).then(cachedRes => cachedRes || fetch(req).then(res => {
        // FIX: Hanya simpan jika status HTTP 200-299 (response.ok)
        if (res.ok) {
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

  // STRATEGI 3: STALE-WHILE-REVALIDATE (Aset pendukung lainnya)
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cachedRes => {
      const fetchPromise = fetch(req).then(res => {
        // FIX: Hanya simpan jika sukses (anti-poisoning)
        if (res.ok) {
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
