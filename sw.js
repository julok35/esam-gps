/* Service worker GPS ESAM : appli en cache, moteur de lecture gardé une fois téléchargé, tuiles de carte gardées une fois vues. */
var V = 'esam-gps-v1.24',
  TILES = 'esam-tiles',
  LIBS = 'esam-libs';
var SHELL = [
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
  'js/history.js',
  'js/ocr.js',
  'js/skew.js',
  'js/fix.js',
  'js/place.js',
  'js/compass.js',
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
var TILE_MAX = 3000;
var NET_WAIT = 3000; // au-delà, sur un réseau qui traîne, l'appli est servie depuis le cache
function noop() {}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches
      .open(V)
      .then(function (c) {
        return Promise.all(
          SHELL.map(function (u) {
            return c.add(new Request(u, { cache: 'reload' })).catch(noop);
          })
        );
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

// Bibliothèques que l'appli ne prend plus sur le CDN (désormais dans vendor/) : retirées du cache.
// Le moteur et la langue de Tesseract restent, même en réponse opaque : une lecture peut être en cours, et une réponse
// opaque est de toute façon remplacée dès qu'une requête CORS la demande (voir cacheFirst).
function dropUnused(name) {
  return caches.open(name).then(function (c) {
    return c.keys().then(function (ks) {
      return Promise.all(
        ks
          .filter(function (k) {
            return !/tesseract\.js-core@|@tesseract\.js-data\//.test(k.url);
          })
          .map(function (k) {
            return c.delete(k);
          })
      );
    });
  });
}
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches
      .keys()
      .then(function (ks) {
        return Promise.all(
          ks
            .filter(function (k) {
              return k !== V && k !== TILES && k !== LIBS;
            })
            .map(function (k) {
              return caches.delete(k);
            })
        );
      })
      .then(function () {
        return dropUnused(LIBS).catch(noop);
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

function isTile(u) {
  return /data\.geopf\.fr\/wmts|tile\.opentopomap\.org|tile\.openstreetmap\.org/.test(u);
}
function isLib(u) {
  return /^https:\/\/cdn\.jsdelivr\.net\/npm\//.test(u);
}

function trim(cache) {
  return cache.keys().then(function (ks) {
    var extra = ks.length - TILE_MAX;
    return Promise.all(
      ks.slice(0, Math.max(0, extra)).map(function (k) {
        return cache.delete(k);
      })
    );
  });
}

// Ressource externe en cache d'abord ; à défaut, téléchargée en CORS (réponse lisible, taille réelle dans le quota)
// et gardée ; si le serveur refuse le CORS, requête d'origine servie telle quelle, sans la garder.
function cacheFirst(e, name, onStore) {
  var req = e.request;
  return caches.open(name).then(function (c) {
    return c.match(req, { ignoreVary: true }).then(function (hit) {
      if (hit && !(hit.type === 'opaque' && req.mode === 'cors')) return hit;
      return fetch(req.url, { mode: 'cors', credentials: 'omit' }).then(
        function (r) {
          if (r.ok) e.waitUntil(c.put(req.url, r.clone()).then(onStore).catch(noop));
          return r;
        },
        function (err) {
          if (req.mode === 'cors') throw err;
          return fetch(req);
        }
      );
    });
  });
}

// Fichiers de l'appli : réseau d'abord pour avoir la dernière version, cache si le réseau échoue ou traîne.
// Quand la page vient du cache, ses fichiers suivent aussitôt (pas d'attente en chaîne, versions cohérentes).
var cacheUntil = 0;
function networkFirst(e) {
  var req = e.request,
    nav = req.mode === 'navigate';
  var fromCache = function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) {
      return hit || (nav ? caches.match('index.html') : undefined);
    });
  };
  var net = function () {
    return fetch(req).then(function (r) {
      if (r.ok) {
        var cl = r.clone();
        e.waitUntil(
          caches
            .open(V)
            .then(function (c) {
              return c.put(req, cl);
            })
            .catch(noop)
        );
      }
      return r;
    });
  };
  if (nav) cacheUntil = 0;
  else if (Date.now() < cacheUntil)
    return fromCache().then(function (hit) {
      return hit || net();
    });
  var p = net();
  e.waitUntil(p.catch(noop));
  var slow = new Promise(function (res) {
    setTimeout(res, NET_WAIT);
  })
    .then(fromCache)
    .then(function (hit) {
      if (!hit) return p;
      if (nav) cacheUntil = Date.now() + 30000;
      return hit;
    });
  return Promise.race([p, slow]).catch(function () {
    return fromCache().then(function (hit) {
      if (hit && nav) cacheUntil = Date.now() + 30000;
      return hit || Response.error();
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var u = req.url;
  if (isTile(u)) {
    e.respondWith(
      cacheFirst(e, TILES, function () {
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
