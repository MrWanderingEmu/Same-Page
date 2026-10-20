/* Service worker: lets the app open and run with no internet connection.
   Network first — you always get the latest version when online, and the
   cached copy when offline. If you add a new file, add it to FILES too. */
const CACHE = 'same-page-v7';
const FILES = [
  './', 'index.html', 'css/styles.css', 'manifest.webmanifest', 'icon.svg',
  'js/main.js', 'js/util.js', 'js/config.js', 'js/state.js', 'js/storage.js', 'js/draw.js',
  'js/board.js', 'js/history.js', 'js/pages.js', 'js/input.js', 'js/export.js', 'js/ui.js',
  'js/library.js', 'js/shelf.js', 'js/shapes.js', 'js/select.js', 'js/laser.js', 'js/ruler.js', 'js/cover.js',
  'js/assets.js', 'js/images.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then(res => {          // always check with the server, so an update never mixes old and new files
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true })
      .then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
