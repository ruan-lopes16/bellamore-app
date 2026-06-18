const CACHE = 'bellamore-v1';

const PRECACHE = [
  '/offline',
  '/favicon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const { request } = e;

  // Ignora requests que não são GET ou não são do mesmo origin
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // API e dados Supabase: somente rede, sem cache
  if (url.pathname.startsWith('/api/') || url.hostname.includes('supabase')) return;

  e.respondWith(
    fetch(request)
      .then(response => {
        // Cacheia respostas bem-sucedidas de assets estáticos
        if (response.ok && (
          url.pathname.startsWith('/_next/static/') ||
          url.pathname === '/favicon.svg'
        )) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        // Offline: tenta cache, senão mostra página offline
        caches.match(request).then(cached => cached ?? caches.match('/offline')),
      ),
  );
});
