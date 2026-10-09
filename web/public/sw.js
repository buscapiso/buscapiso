// Solo el armazon de la app (HTML, JS, CSS, iconos), para abrirla sin red.
// Los datos viven en IndexedDB y no pasan por aqui.
//
// La pagina (index.html) va primero a la red: si no, tras publicar una
// version nueva se seguia abriendo la vieja hasta recargar dos veces. Los
// JS y CSS llevan un hash en el nombre, asi que de la cache sirven tal cual.
const CACHE = 'buscapiso-web-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const fresh = () => fetch(e.request).then((r) => { if (r.ok) cache.put(e.request, r.clone()); return r; });
      if (e.request.mode === 'navigate') {
        try {
          return await fresh();
        } catch {
          return (await cache.match(e.request)) ?? Response.error();
        }
      }
      const cached = await cache.match(e.request);
      return cached ?? fresh();
    }),
  );
});
