/* Service worker GPS ESAM : appli en cache, moteur de lecture gardé une fois téléchargé, tuiles de carte gardées une fois vues. */
const V = 'esam-gps-v1.36';
const TILES = 'esam-tiles';
const LIBS = 'esam-libs';
const SHELL = [
  './',
  'index.html',
  'app.css',
  'manifest.webmanifest',
  'logo.png',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-192.png',
  'icon-maskable-512.png',
  'js/app.js',
  'js/parser.js',
  'js/util.js',
  'js/map.js',
  'js/share.js',
  'js/go.js',
  'js/history.js',
  'js/ocr.js',
  'js/skew.js',
  'js/fix.js',
  'js/place.js',
  'js/compass.js',
  'js/auto.js',
  'js/enhance.js',
  'js/warp.js',
  'js/zone.js',
  'js/trust.js',
  'js/track.js',
  'js/exif.js',
  'js/batch.js',
  'js/profile.js',
  'js/pipeline.js',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/layers.png',
  'vendor/leaflet/images/layers-2x.png',
  'vendor/qrcode/qrcode.js',
  'vendor/tesseract/tesseract.min.js',
  'vendor/tesseract/worker.min.js',
  'vendor/fonts/fonts.css',
  'vendor/fonts/anton-latin.woff2',
  'vendor/fonts/anton-latin-ext.woff2',
  'vendor/fonts/montserrat-latin.woff2',
  'vendor/fonts/montserrat-latin-ext.woff2',
  'vendor/fonts/roboto-condensed-latin.woff2',
  'vendor/fonts/roboto-condensed-latin-ext.woff2'
];
const TILE_MAX = 3000;
const NET_WAIT = 3000; // au-delà, sur un réseau qui traîne, l'appli est servie depuis le cache
function noop() {}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(V)
      .then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(noop))))
      .then(() => self.skipWaiting())
  );
});

// Moteur et langue de Tesseract autrefois pris sur un CDN (désormais dans vendor/) : retirés du cache
function dropUnused(name) {
  return caches
    .open(name)
    .then((c) => c.keys().then((ks) => Promise.all(ks.filter((k) => !isLib(k.url)).map((k) => c.delete(k)))));
}
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== V && k !== TILES && k !== LIBS).map((k) => caches.delete(k))))
      .then(() => dropUnused(LIBS).catch(noop))
      .then(() => self.clients.claim())
  );
});

function isTile(u) {
  return /data\.geopf\.fr\/wmts|tile\.opentopomap\.org|tile\.openstreetmap\.org/.test(u);
}
// Moteur et langue de Tesseract (7 Mo, fichiers qui ne changent pas) : hors du cache de l'appli, pour ne pas être
// téléchargés à nouveau à chaque version
function isLib(u) {
  return (
    u.startsWith(`${self.registration.scope}vendor/tesseract/core-7/`) ||
    u.startsWith(`${self.registration.scope}vendor/tesseract/lang/`)
  );
}

function trim(cache) {
  return cache.keys().then((ks) => {
    const extra = ks.length - TILE_MAX;
    return Promise.all(ks.slice(0, Math.max(0, extra)).map((k) => cache.delete(k)));
  });
}

// Ressource externe en cache d'abord ; à défaut, téléchargée en CORS (réponse lisible, taille réelle dans le quota)
// et gardée ; si le serveur refuse le CORS, requête d'origine servie telle quelle, sans la garder.
function cacheFirst(e, name, onStore) {
  const req = e.request;
  return caches.open(name).then((c) =>
    c.match(req, { ignoreVary: true }).then((hit) => {
      if (hit && !(hit.type === 'opaque' && req.mode === 'cors')) return hit;
      return fetch(req.url, { mode: 'cors', credentials: 'omit' }).then(
        (r) => {
          if (r.ok) e.waitUntil(c.put(req.url, r.clone()).then(onStore).catch(noop));
          return r;
        },
        (err) => {
          if (req.mode === 'cors') throw err;
          return fetch(req);
        }
      );
    })
  );
}

// Fichiers de l'appli : réseau d'abord pour avoir la dernière version, cache si le réseau échoue ou traîne.
// Quand la page vient du cache, ses fichiers suivent aussitôt (pas d'attente en chaîne, versions cohérentes).
let cacheUntil = 0;
function networkFirst(e) {
  const req = e.request,
    nav = req.mode === 'navigate';
  const fromCache = function () {
    return caches
      .match(req, { ignoreSearch: true })
      .then((hit) => hit || (nav ? caches.match('index.html') : undefined));
  };
  const net = function () {
    return fetch(req).then((r) => {
      if (r.ok) {
        const cl = r.clone();
        e.waitUntil(
          caches
            .open(V)
            .then((c) => c.put(req, cl))
            .catch(noop)
        );
      }
      return r;
    });
  };
  if (nav) cacheUntil = 0;
  else if (Date.now() < cacheUntil) return fromCache().then((hit) => hit || net());
  const p = net();
  e.waitUntil(p.catch(noop));
  const slow = new Promise((res) => {
    setTimeout(res, NET_WAIT);
  })
    .then(fromCache)
    .then((hit) => {
      if (!hit) return p;
      if (nav) cacheUntil = Date.now() + 30000;
      return hit;
    });
  return Promise.race([p, slow]).catch(() =>
    fromCache().then((hit) => {
      if (hit && nav) cacheUntil = Date.now() + 30000;
      return hit || Response.error();
    })
  );
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = req.url;
  if (isTile(u)) {
    e.respondWith(
      cacheFirst(e, TILES, () => {
        if (Math.random() < 0.05) return caches.open(TILES).then(trim);
      })
    );
    return;
  }
  if (isLib(u)) {
    e.respondWith(cacheFirst(e, LIBS, noop));
    return;
  } // versions figées
  if (new URL(u).origin === location.origin) e.respondWith(networkFirst(e));
});
