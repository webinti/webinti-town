/*
 * Service worker minimal et SÛR pour Webinti Town (PWA installable).
 *
 * Il ne met en cache QUE les assets statiques hashés servis sous /assets/
 * (JS, CSS, sprites…), en cache-first — ces fichiers sont immuables (hash ou
 * cache-buster dans l'URL), donc un nouveau build = nouvelle URL = re-téléchargé.
 *
 * TOUT le reste passe DIRECTEMENT au réseau, sans interception :
 *   - les navigations (index.html reste toujours frais),
 *   - /api, /pb, /maps,
 *   - /socket.io (Socket.IO en polling),
 *   - tout le cross-origin (LiveKit, etc.).
 * Les WebSocket / WebRTC ne sont de toute façon jamais interceptés par un SW.
 * => l'audio/vidéo de proximité et le temps réel ne sont jamais impactés.
 */
const CACHE = 'webinti-assets-v2';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  // On n'intercepte QUE les assets statiques same-origin. Le reste → réseau direct.
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith('/assets/')) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res && res.status === 200) cache.put(req, res.clone());
      return res;
    }),
  );
});
