/*
 * Service Worker: Nach dem ersten Besuch startet Gambit sofort und läuft offline
 * (nur der Online-Modus braucht Netz).
 *
 * Die Version kommt aus index.html (sw.js?v=…, dieselbe Cache-Version wie bei den Skripten). Eine neue Version
 * lädt beim Installieren alles in einen frischen Cache und löscht danach den alten.
 * - Seite (index.html): erst aus dem Netz, damit Updates sofort ankommen; ohne Netz aus dem Cache.
 * - Alles andere: aus dem Cache, sonst aus dem Netz (und dann für später gemerkt).
 */
const VERSION = new URL(self.location).searchParams.get('v') || 'dev';
const CACHE = `gambit-${VERSION}`;
const v = (f) => `${f}?v=${VERSION}`;

const SCRIPTS = ['vendor/chess', 'game', 'engine', 'strength', 'board', 'audio', 'net', 'pvp', 'progress', 'achievements',
  'training/puzzles', 'training/campaign', 'training/runner', 'ui/common', 'ui/play', 'ui/pvc', 'ui/lobby', 'ui/training', 'ui/menu', 'ui/debug',
  'vendor/trystero', 'vendor/qrcode', 'vendor/stockfish/stockfish'];
const PIECES = ['tatiana', 'governor', 'celtic', 'cburnett'].flatMap((set) => ['w', 'b'].flatMap((c) => ['K', 'Q', 'R', 'B', 'N', 'P'].map((p) => `art/pieces/${set}/${c}${p}.svg`)));

const FILES = [
  './',
  'manifest.webmanifest',
  v('css/style.css'),
  ...SCRIPTS.map((n) => v(`js/${n}.js`)),
  'js/vendor/stockfish/stockfish.wasm', // lädt der Worker selbst, ohne ?v
  ...['cinzel-latin', 'cinzel-latin-ext', 'alegreya-latin', 'alegreya-latin-ext', 'noto-emoji-subset'].map((n) => `art/fonts/${n}.woff2`),
  ...['arrow', 'hand', 'help', 'zoom', 'zoom-out'].map((n) => `art/cursors/${n}.svg`),
  ...['leather', 'metal', 'paper', 'table', 'wood'].map((n) => `art/textures/${n}.webp`),
  ...['icon-192', 'icon-512', 'maskable-512', 'apple-touch-icon', 'apple-touch-icon-167', 'apple-touch-icon-152', 'favicon-32'].map((n) => `art/icons/${n}.png`),
  'art/icons/icon.svg',
  ...['walnut', 'moon', 'emerald'].flatMap((t) => [`art/boards/${t}-light.webp`, `art/boards/${t}-dark.webp`]),
  ...PIECES,
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('gambit-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

/** Netz mit Zeitlimit: Bei schlechtem Empfang lieber gleich die gespeicherte Seite zeigen. */
function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then((res) => { clearTimeout(timer); resolve(res); }, (err) => { clearTimeout(timer); reject(err); });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // Auch Einladungslinks (#spiel=…) landen hier; offline gibt es dann eben die gespeicherte Startseite
    e.respondWith(fetchWithTimeout(req, 4000)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./', copy)); }
        return res;
      })
      .catch(() => caches.match('./')));
    return;
  }

  e.respondWith(caches.match(req, { ignoreSearch: req.url.includes('stockfish.wasm') }).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
