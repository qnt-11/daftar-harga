/**
 * SERVICE WORKER DAFTAR HARGA - ENTERPRISE GRADE FINAL (v4.0)
 * Strategi: Network-First (HTML), Cache-First (CDN), Stale-While-Revalidate (Dynamic)
 * Fokus: Keamanan Memori, Anti-Lag, dan Instalasi Toleran Kesalahan
 */

const APP_VERSION = '4.0'; // Naikkan angka ini setiap kali kamu merilis fitur/HTML baru
const CACHE_CORE = 'core-v' + APP_VERSION; 
const CACHE_DYNAMIC = 'dyn-v' + APP_VERSION;
const CACHE_CDN = 'cdn-v1'; // Tidak berubah agar aset stabil tidak perlu di-download ulang

const MAX_DYNAMIC_ITEMS = 50; 
const MAX_CDN_ITEMS = 20;

// Gunakan path absolut untuk keamanan pencarian
const coreUrls = ['/', '/index.html', '/manifest.json'];
const cdnDomains = ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];

/**
 * HELPER 1: Pembersih Memori (Non-Blocking & Ringan)
 */
async function trimCache(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxItems) {
      // Hapus item paling awal (paling lama) sampai batas aman tercapai
      const keysToDelete = keys.slice(0, keys.length - maxItems);
      await Promise.all(keysToDelete.map(key => cache.delete(key)));
    }
  } catch (err) {
    console.warn('[SW] Gagal membersihkan memori:', err);
  } 
}

/**
 * HELPER 2: Pengecek Sinyal (Timeout 3.5 Detik)
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
 * TAHAP 1: INSTALL (Instalasi Anti-Gagal / Fault-Tolerant)
 */
self.addEventListener('install', event => {
  self.skipWaiting(); // Memaksa SW baru untuk segera mengambil alih
  
  event.waitUntil(
    caches.open(CACHE_CORE).then(cache => {
      // Menyimpan aset satu per satu. Jika 1 gagal, yang lain tetap tersimpan.
      return Promise.all(
        coreUrls.map(url => {
          return fetch(url).then(res => {
            if (res.ok) return cache.put(url, res);
          }).catch(err => console.warn('[SW] Gagal pre-cache:', url));
        })
      );
    })
  );
});

/**
 * TAHAP 2: ACTIVATE (Sapu Bersih Memori Versi Lama)
 */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(keys.map(key => {
        // Hapus cache yang bukan milik versi saat ini
        if (key !== CACHE_CORE && key !== CACHE_DYNAMIC && key !== CACHE_CDN) {
          return caches.delete(key); 
        }
      }));
    }).then(() => self.clients.claim()) // SW langsung mengontrol semua halaman yang terbuka
  );
});

/**
 * TAHAP 3: MESIN PENCEGAT INTERNET (Fetch Interceptor)
 */
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Abaikan request POST, API Google, ekstensi browser, atau scheme non-HTTP
  if (req.method !== 'GET' || url.hostname.includes('script.google') || !url.protocol.startsWith('http')) return;

  // STRATEGI 1: NETWORK-FIRST (Khusus Navigasi & HTML Utama)
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.includes('index.html')) {
    event.respondWith(
      fetchWithTimeout(req, 3500)
        .then(res => {
          if (res.ok) {
            const resClone = res.clone();
            // Simpan HTML versi terbaru tanpa memblokir antarmuka
            event.waitUntil(caches.open(CACHE_CORE).then(cache => cache.put(req, resClone))); 
          }
          return res;
        })
        .catch(async () => {
          // Fallback cerdas: cari di cache dengan mengabaikan parameter query
          const cache = await caches.open(CACHE_CORE);
          const cachedRes = await cache.match(req, { ignoreSearch: true }) || 
                            await cache.match('/index.html', { ignoreSearch: true }) || 
                            await cache.match('/', { ignoreSearch: true });
          
          return cachedRes || new Response('<h2 style="font-family:sans-serif; text-align:center; margin-top:50px;">Aplikasi Offline. Harap aktifkan internet untuk memuat awal.</h2>', { status: 503, headers: { 'Content-Type': 'text/html' }});
        })
    );
    return;
  }

  // STRATEGI 2: CACHE-FIRST (Khusus CDN Eksternal - Fokus Kecepatan)
  if (cdnDomains.some(domain => url.hostname.includes(domain))) {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then(cachedRes => {
        if (cachedRes) return cachedRes; // Jika ada di cache, langsung kembalikan!
        
        return fetch(req).then(res => {
          // Hanya simpan jika sukses (status 200) untuk menghindari jebakan kuota memori (Opaque)
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
          return new Response('', { status: 503 }); // Gagal senyap agar tidak error merah di console
        });
      })
    );
    return;
  }

  // STRATEGI 3: STALE-WHILE-REVALIDATE (Aset dinamis pendukung lainnya)
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cachedRes => {
      const fetchPromise = fetch(req).then(res => {
        if (res.ok) {
          const resClone = res.clone();
          event.waitUntil(
            caches.open(CACHE_DYNAMIC).then(async cache => {
              // Simpan URL bersih tanpa parameter
              const cleanUrl = req.url.split('?')[0];
              await cache.put(cleanUrl, resClone); 
              await trimCache(CACHE_DYNAMIC, MAX_DYNAMIC_ITEMS); 
            })
          );
        }
        return res;
      }).catch(() => null);

      // Kembalikan versi cache jika ada, sementara fetch jalan di latar belakang
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
 * Menangkap sinyal dari index.html jika ada permintaan update paksa
 */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
