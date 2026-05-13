/**
 * SERVICE WORKER DAFTAR HARGA - ENTERPRISE GRADE FINAL
 * Strategi: Network-First (HTML), Cache-First (CDN), Stale-While-Revalidate (Dynamic)
 * Fitur Tambahan: Dedicated Offline Page (Halaman Offline Khusus)
 */

// 1. PENGATURAN VARIABEL (Bisa kamu sesuaikan)
const APP_VERSION = '5.2'; // Naikkan angka ini jika kamu mengubah tampilan index.html secara besar-besaran
const CACHE_CORE = 'core-v' + APP_VERSION; 
const CACHE_DYNAMIC = 'dyn-v' + APP_VERSION;
const CACHE_CDN = 'cdn-v1'; // Biarkan v1 agar font/library tidak di-download ulang terus-menerus

const MAX_DYNAMIC_ITEMS = 50; // Batas maksimal file dinamis agar memori HP tidak penuh
const MAX_CDN_ITEMS = 20;

// Daftar file pondasi yang WAJIB disimpan ke memori HP saat pertama kali buka
// Kita menambahkan '/offline.html' ke dalam daftar ini
const coreUrls = [
  '/', 
  '/index.html', 
  '/manifest.json',
  '/offline.html'
];

// Daftar domain eksternal yang akan diprioritaskan dari memori (Cache-First)
const cdnDomains = [
  'unpkg.com', 
  'fonts.googleapis.com', 
  'fonts.gstatic.com', 
  'cdn.jsdelivr.net'
];

/**
 * HELPER 1: Pembersih Memori Otomatis
 * Menjaga agar memori HP pengguna tidak bengkak dengan menghapus cache terlama.
 */
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

/**
 * HELPER 2: Pengecek Sinyal (Timeout)
 * Mencegah layar "loading" putih terus-menerus jika internet sangat lemot.
 */
function fetchWithTimeout(request, timeout = 3500) {
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

/**
 * TAHAP 1: INSTALASI
 * Mengunduh file pondasi (coreUrls) secara terpisah agar aman dari gagal download.
 */
self.addEventListener('install', event => {
  self.skipWaiting(); // Langsung aktifkan SW baru tanpa menunggu
  
  event.waitUntil(
    caches.open(CACHE_CORE).then(cache => {
      return Promise.all(
        coreUrls.map(url => {
          return fetch(url).then(res => {
            if (res.ok) return cache.put(url, res);
          }).catch(err => console.warn('[SW] File pondasi gagal dimuat (Aman, diabaikan):', url));
        })
      );
    })
  );
});

/**
 * TAHAP 2: AKTIVASI
 * Menyapu bersih memori (cache) dari versi aplikasi yang lama.
 */
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

/**
 * TAHAP 3: PENCEGAT INTERNET (Fetch Interceptor)
 * Mengatur lalu lintas data antara HP pengguna dan Server.
 */
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // MENGABAIKAN GOOGLE SHEETS & POST:
  // SW tidak boleh mencampuri urusan sinkronisasi database agar data selalu valid.
  if (req.method !== 'GET' || url.hostname.includes('script.google') || !url.protocol.startsWith('http')) return;

  // STRATEGI 1: NETWORK-FIRST (Khusus Navigasi & HTML Utama)
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.includes('index.html')) {
    event.respondWith(
      fetchWithTimeout(req, 3500)
        .then(res => {
          if (res.ok) {
            const resClone = res.clone();
            event.waitUntil(caches.open(CACHE_CORE).then(cache => cache.put(req, resClone))); 
          }
          return res;
        })
        .catch(async () => {
          // INTERNET MATI: Buka brankas memori
          const cache = await caches.open(CACHE_CORE);
          const cachedRes = await cache.match(req, { ignoreSearch: true }) || 
                            await cache.match('/index.html', { ignoreSearch: true }) || 
                            await cache.match('/', { ignoreSearch: true });
          
          // JIKA INDEX.HTML HILANG: Tampilkan Halaman Offline Khusus
          if (cachedRes) {
            return cachedRes;
          } else {
            return await cache.match('/offline.html', { ignoreSearch: true });
          }
        })
    );
    return;
  }

  // STRATEGI 2: CACHE-FIRST (Khusus CDN Eksternal - Fokus Kecepatan)
  if (cdnDomains.some(domain => url.hostname.includes(domain))) {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then(cachedRes => {
        if (cachedRes) return cachedRes; // Langsung tampilkan dari memori
        
        return fetch(req).then(res => {
          if (res.ok) {
            const resClone = res.clone();
            event.waitUntil(
              caches.open(CACHE_CDN).then(async cache => {
                await cache.put(req, resClone); 
                await trimCache(CACHE_CDN, MAX_CDN_ITEMS); 
              })
            );
          }
          return res;
        }).catch(err => {
          return new Response('', { status: 503 }); 
        });
      })
    );
    return;
  }

  // STRATEGI 3: STALE-WHILE-REVALIDATE (Aset dinamis lainnya)
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

/**
 * TAHAP 4: LISTENER UPDATE MANDIRI
 */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
