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
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.hostname.includes('supabase')) return;

  // Navegação de documento (link aberto, refresh): só aqui faz sentido cair
  // para a página /offline quando a rede falha.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request).catch(() => caches.match('/offline').then(cached => cached ?? Response.error())),
    );
    return;
  }

  // Chunks estáticos do Next: cacheia para reuso, mas em falha de rede sem
  // cache correspondente deixa a requisição falhar normalmente — nunca
  // devolve o HTML da página /offline no lugar de um .js/.css.
  if (url.pathname.startsWith('/_next/static/')) {
    e.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE).then(c => c.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached ?? Response.error())),
    );
    return;
  }

  // Demais requisições (payloads RSC/data do App Router, prefetch, etc.):
  // sem interceptação. Um fetch de RSC que recebesse HTML da /offline no
  // lugar do payload esperado quebra o render no cliente.
});

// ── Push notifications ──────────────────────────────────────────

self.addEventListener('push', e => {
  const data = e.data?.json() ?? {};
  e.waitUntil(
    self.registration.showNotification(data.title ?? 'Bellamore', {
      body:    data.body  ?? '',
      icon:    '/icon',
      badge:   '/icon',
      vibrate: [200, 100, 200],
      data:    { url: data.url ?? '/dashboard' },
    }),
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url ?? '/dashboard';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(url));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    }),
  );
});
