// ==========================================
// SERVICE WORKER (PWA KASIR ENTERPRISE)
// ==========================================

const APP_VERSION = '1.1'; // Naikkan angka ini jika Anda mengubah isi file index.html
const CACHE_CORE = 'core-v' + APP_VERSION; 
const CACHE_DYNAMIC = 'dyn-v' + APP_VERSION;
const CACHE_CDN = 'cdn-v1'; 

const MAX_DYNAMIC_ITEMS = 50; 
const MAX_CDN_ITEMS = 20;
const NETWORK_TIMEOUT = 8000; // Waktu tunggu internet (8 detik) sebelum beralih ke mode offline

// Daftar file pondasi yang WAJIB diunduh saat instalasi pertama agar aplikasi bisa jalan tanpa internet
const coreUrls = [
  './', 
  './index.html', 
  './manifest.json',
  './offline.html',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://fonts.googleapis.com/css2?family=Audiowide&family=Montserrat:wght@400;500;600;700;800&display=swap'
];

const cdnDomains = [
  'unpkg.com', 
  'fonts.googleapis.com', 
  'fonts.gstatic.com', 
  'cdn.jsdelivr.net'
];

// ==========================================
// MANAJEMEN MEMORI (ANTI-LAG)
// ==========================================

let isTrimming = false;

// Fungsi untuk menghapus file lama satu per satu agar CPU HP tidak macet
async function trimCache(cacheName, maxItems) {
  if (isTrimming) return; 
  isTrimming = true;
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxItems) {
      const keysToDelete = keys.slice(0, keys.length - maxItems);
      for (let key of keysToDelete) {
        await cache.delete(key);
      }
    }
  } catch (err) {
    console.warn('[SW] Gagal membersihkan memori:', err);
  } finally {
    isTrimming = false;
  }
}

// Fungsi mengecek sisa kapasitas penyimpanan HP
async function manageStorage() {
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const quota = await navigator.storage.estimate();
      if (quota.usage / quota.quota > 0.8) {
        console.log('[SW] Memori penuh, melakukan pembersihan ekstra...');
        await trimCache(CACHE_DYNAMIC, 20); 
      }
    } catch(e) {
      console.warn('[SW] Estimasi kuota gagal:', e);
    }
  }
}

// Fungsi untuk memberikan batas waktu koneksi internet
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

// ==========================================
// SIKLUS HIDUP SERVICE WORKER
// ==========================================

self.addEventListener('install', event => {
  self.skipWaiting(); // Langsung aktifkan Service Worker baru
  event.waitUntil(
    caches.open(CACHE_CORE).then(cache => {
      // Menggunakan allSettled agar jika 1 file gagal, yang lain tetap tersimpan
      return Promise.allSettled(
        coreUrls.map(url => {
          return fetch(new Request(url, { cache: 'reload' })).then(res => {
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
        // Membersihkan gudang penyimpanan dari versi aplikasi yang sudah usang
        if (key !== CACHE_CORE && key !== CACHE_DYNAMIC && key !== CACHE_CDN) {
          return caches.delete(key); 
        }
      }));
    }).then(() => {
      // Jalankan pembersihan memori di latar belakang (Fire and Forget)
      manageStorage(); 
      return self.clients.claim();
    }) 
  );
});

// ==========================================
// PENCEGATAN LALU LINTAS JARINGAN
// ==========================================

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // BYPASS: Jangan ikut campur jika itu API Google Sheets atau bukan permintaan GET
  if (req.method !== 'GET' || url.hostname.includes('script.google') || !url.protocol.startsWith('http')) return;

  // STRATEGI 1: Network-First (Utamakan Internet) khusus untuk file HTML
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.includes('index.html')) {
    event.respondWith(
      fetchWithTimeout(req, NETWORK_TIMEOUT)
        .then(res => {
          if (!res.ok) throw new Error('Server Error');
          const resClone = res.clone();
          
          // Bersihkan URL dari parameter tambahan (bloatware) sebelum disimpan
          const cleanUrl = req.url.split('?')[0]; 
          event.waitUntil(caches.open(CACHE_CORE).then(cache => cache.put(cleanUrl, resClone))); 
          
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_CORE);
          const cleanReqUrl = req.url.split('?')[0];
          
          // Buka dari memori HP jika internet mati
          const cachedIndex = await cache.match(cleanReqUrl) || 
                              await cache.match('./index.html') || 
                              await cache.match('./');
          if (cachedIndex) return cachedIndex; 
          
          // Tampilkan halaman darurat jika file utama belum ada di memori
          const offlinePage = await cache.match('./offline.html');
          if (offlinePage) return offlinePage;

          // Halaman darurat tingkat akhir
          return new Response(
            `<!DOCTYPE html><html><body style="background:#000;color:#f00;text-align:center;padding:50px;font-family:sans-serif;"><h2>⚠️ Sedang Offline</h2><p>Aplikasi belum tersimpan di memori HP. Hubungkan ke internet untuk membuka pertama kali.</p></body></html>`,
            { headers: { 'Content-Type': 'text/html' } }
          );
        })
    );
    return;
  }

  // STRATEGI 2: Cache-First (Utamakan Memori Lokal) khusus untuk CDN Eksternal (Font, Library)
  if (cdnDomains.some(domain => url.hostname.includes(domain))) {
    event.respondWith(
      caches.match(req).then(cachedRes => {
        if (cachedRes) return cachedRes; // Jika ada di gudang, langsung pakai
        
        return fetch(req).then(res => {
          const contentType = res.headers.get('content-type') || '';
          // SABUK PENGAMAN: Cegah file Opaque (bocor 7MB) dan cegah injeksi halaman HTML dari Wi-Fi Publik
          if (res.ok && res.type !== 'opaque' && !contentType.includes('text/html')) {
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

  // STRATEGI 3: Stale-While-Revalidate untuk Aset Dinamis (Gambar, CSS)
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cachedRes => {
      const fetchPromise = fetch(req).then(res => {
        const contentType = res.headers.get('content-type') || '';
        
        if (res.ok && res.type !== 'opaque' && !contentType.includes('text/html')) {
          const resClone = res.clone();
          event.waitUntil(caches.open(CACHE_DYNAMIC).then(async cache => {
            const cleanUrl = req.url.split('?')[0];
            try {
              // SABUK PENGAMAN KEDUA: Cegah Crash jika memori HP pengguna benar-benar 0 Bytes
              await cache.put(cleanUrl, resClone); 
              await trimCache(CACHE_DYNAMIC, MAX_DYNAMIC_ITEMS); 
            } catch (err) {
              console.warn('[SW] Disk penuh, membatalkan simpanan aset dinamis.');
            }
          }));
        }
        return res;
      }).catch(() => null);

      if (cachedRes) { 
        event.waitUntil(fetchPromise); // Perbarui memori diam-diam di latar belakang
        return cachedRes; // Langsung tampilkan dari memori
      }
      return fetchPromise.then(res => res || new Response('', { status: 503 }));
    })
  );
});
