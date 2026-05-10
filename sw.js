/**
 * SERVICE WORKER DAFTAR HARGA - ENTERPRISE GRADE FINAL
 * Strategi: Network-First, Cache-First (CDN Presisi), Stale-While-Revalidate (Background Safe)
 */

// Dokumentasi: Ubah angka ini jika Anda mengubah isi file HTML/JS/CSS agar pengguna mendapatkan versi terbaru
const APP_VERSION = '2.8'; 
const CACHE_CORE = 'core-v' + APP_VERSION; 
const CACHE_DYNAMIC = 'dyn-v' + APP_VERSION;
const CACHE_CDN = 'cdn-v1'; 

const MAX_DYNAMIC_ITEMS = 50; 
const MAX_CDN_ITEMS = 30; 

const coreUrls = ['./', './index.html', './manifest.json'];
const cdnDomains = ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];

// Helper: Trim Cache untuk membersihkan tumpukan memori lama
async function trimCache(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxItems) {
      for (let i = 0; i < keys.length - maxItems; i++) {
        await cache.delete(keys[i]);
      }
    }
  } catch (err) {
    // Abaikan error secara diam-diam jika terjadi kegagalan penghapusan
  }
}

// Helper: Fetch dengan batas waktu dan pemutus koneksi (AbortController)
function fetchWithTimeout(request, timeout = 1200) {
  // Membuat controller untuk membatalkan proses jaringan
  const controller = new AbortController();
  
  // Pasang timer. Jika waktu habis, batalkan koneksi jaringan
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // Jalankan fetch dengan menyematkan sinyal dari controller
  return fetch(request, { signal: controller.signal })
    .then(res => {
      clearTimeout(timeoutId); // Bersihkan timer jika berhasil sebelum batas waktu
      return res;
    })
    .catch(err => {
      // Jika error terjadi karena fungsi abort() dipanggil, kembalikan pesan TIMEOUT
      if (err.name === 'AbortError') {
        throw new Error('TIMEOUT');
      }
      throw err; // Lempar error lain (misal koneksi putus tiba-tiba)
    });
}

// Tahap 1: Menginstal Service Worker dan memasukkan file inti ke dalam cache
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_CORE)
      .then(cache => cache.addAll(coreUrls))
      .then(() => self.skipWaiting())
  );
});

// Tahap 2: Mengaktifkan Service Worker dan menghapus cache versi lama
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(keys.map(key => {
        // Hapus nama cache yang tidak cocok dengan versi aplikasi saat ini
        if (key !== CACHE_CORE && key !== CACHE_DYNAMIC && key !== CACHE_CDN) {
          return caches.delete(key);
        }
      }));
    }).then(() => self.clients.claim())
  );
});

// Tahap 3: Menangkap lalu lintas data (Fetch)
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Abaikan metode POST atau permintaan ke database Google Script agar tidak bentrok
  if (req.method !== 'GET' || url.hostname.includes('script.google') || !url.protocol.startsWith('http')) return;

  // STRATEGI 1: NETWORK-FIRST (Utamakan Internet untuk File Inti/HTML)
  if (req.mode === 'navigate' || url.pathname.match(/\/(index\.html)?$/)) {
    event.respondWith(
      fetchWithTimeout(req, 1200)
        .then(res => {
          const resClone = res.clone();
          caches.open(CACHE_CORE).then(cache => cache.put(req, resClone));
          return res;
        })
        .catch(() => caches.match('./index.html', { ignoreSearch: true }))
    );
    return;
  }

  // STRATEGI 2: CACHE-FIRST (Utamakan Memori HP untuk CDN/Library)
  if (cdnDomains.some(domain => url.hostname.includes(domain))) {
    event.respondWith(
      // PERBAIKAN 2: Menghapus { ignoreSearch: true } agar pembacaan Google Fonts presisi
      caches.match(req).then(cachedRes => cachedRes || fetch(req).then(res => {
        if (res.status === 200) {
          const resClone = res.clone();
          caches.open(CACHE_CDN).then(async cache => {
            await cache.put(req, resClone); // Tunggu proses simpan selesai
            trimCache(CACHE_CDN, MAX_CDN_ITEMS); // Baru lakukan pembersihan memori
          });
        }
        return res;
      }).catch(() => {
        return new Response('', { status: 503, statusText: 'Offline' });
      }))
    );
    return;
  }

  // STRATEGI 3: STALE-WHILE-REVALIDATE (Tampilkan Cache, Update di Latar Belakang)
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cachedRes => {
      
      const fetchPromise = fetch(req).then(res => {
        if (res.status === 200) {
          const resClone = res.clone();
          caches.open(CACHE_DYNAMIC).then(async cache => {
            await cache.put(req, resClone); // Tunggu proses simpan selesai
            trimCache(CACHE_DYNAMIC, MAX_DYNAMIC_ITEMS); // Baru bersihkan memori
          });
        }
        return res;
      }).catch(() => {
        return new Response('', { status: 503, statusText: 'Offline' });
      });

      // PERBAIKAN 1: Lindungi proses fetchPromise agar tidak "dibunuh" browser
      if (cachedRes) {
        event.waitUntil(fetchPromise); // Pesan ke browser untuk tidak mematikan latar belakang
        return cachedRes;
      }
      
      return fetchPromise;
    })
  );
});
