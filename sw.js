/* Service worker GPS ESAM : appli et bibliothèques en cache, tuiles de carte gardées une fois vues. */
var V = 'esam-gps-v3';
var SHELL = ['./', 'index.html', 'app.css', 'app.js', 'parser.js', 'manifest.webmanifest', 'logo.png', 'icon-192.png', 'icon-512.png',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css', 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js'];
var TILE_MAX = 3000;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(V).then(function (c) { return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); })); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== V && k !== 'esam-tiles' && k !== 'esam-libs'; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function isTile(u) { return /data\.geopf\.fr\/wmts|tile\.opentopomap\.org|tile\.openstreetmap\.org/.test(u); }
function isLib(u) { return /cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(u); }

function trim(cache) {
  cache.keys().then(function (ks) { if (ks.length > TILE_MAX) for (var i = 0; i < ks.length - TILE_MAX; i++) cache.delete(ks[i]); });
}

self.addEventListener('fetch', function (e) {
  var req = e.request; if (req.method !== 'GET') return;
  var u = req.url;
  if (isTile(u)) {
    e.respondWith(caches.open('esam-tiles').then(function (c) {
      return c.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (r) { if (r.ok || r.type === 'opaque') { c.put(req, r.clone()); if (Math.random() < 0.05) trim(c); } return r; });
      });
    }));
    return;
  }
  if (isLib(u)) {
    // versions figées : cache d'abord
    e.respondWith(caches.open('esam-libs').then(function (c) {
      return c.match(req, { ignoreVary: true }).then(function (hit) {
        return hit || fetch(req).then(function (r) { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; });
      });
    }).catch(function () { return caches.match(req); }));
    return;
  }
  if (new URL(u).origin === location.origin) {
    // réseau d'abord pour avoir la dernière version, cache si hors ligne
    e.respondWith(fetch(req).then(function (r) {
      if (r.ok) { var cl = r.clone(); caches.open(V).then(function (c) { c.put(req, cl); }); }
      return r;
    }).catch(function () { return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || caches.match('index.html'); }); }));
  }
});
