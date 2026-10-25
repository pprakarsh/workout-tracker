// Offline support.
//
// Network-first for everything on this origin, with the cache as a fallback.
// Cache-first was a trap during development: the previously-installed worker
// kept serving the old JS/CSS for one more load after an update, so a change
// appeared not to have happened until you reloaded twice. Network-first costs a
// round trip when online and still works fully offline.
const CACHE = 'workout-v9';

const ASSETS = [
  '.',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js',
  'js/db.js',
  'js/store.js',
  'js/timer.js',
  'js/ui.js',
  'js/util.js',
  'js/exportimport.js',
  'js/sync.js',
  'js/views/entry.js',
  'js/views/now.js',
  'js/views/session.js',
  'js/views/history.js',
  'js/views/routines.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        if (req.mode === 'navigate') {
          const shell = await caches.match('index.html');
          if (shell) return shell;
        }
        return new Response('Offline and not cached', { status: 504, statusText: 'Offline' });
      }),
  );
});
