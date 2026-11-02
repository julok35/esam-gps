/* Carte Leaflet (IGN, topo, photo aérienne, OSM), position du téléphone, distance et cap. */
import { $, f6, esc, fmtDist, CARD, state } from './util.js';
import { fmtWhen } from './track.js';
import { distM, bearing } from './parser.js';
import { updateRelief, knownAlt, fmtAlt } from './place.js';
import { updateCompass } from './compass.js';

var map = null,
  tMark = null,
  meMark = null,
  meCirc = null,
  line = null,
  track = null, // couche du suivi : points numérotés reliés dans l'ordre
  trackPts = [],
  trackMarks = [],
  firstFix = true,
  watchId = null;

function wmts(layer, fmt) {
  return (
    'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=' +
    layer +
    '&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=' +
    fmt
  );
}

export function initMap() {
  if (typeof L === 'undefined') {
    $('map').innerHTML = '<p class="hint pad">Carte indisponible.</p>';
    return;
  }
  var o = { maxZoom: 19 };
  var ign = L.tileLayer(
    wmts('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png'),
    Object.assign({ maxNativeZoom: 19, attribution: 'IGN Géoplateforme' }, o)
  );
  var topo = L.tileLayer(
    'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    Object.assign({ subdomains: 'abc', maxNativeZoom: 17, attribution: 'OpenTopoMap, OpenStreetMap' }, o)
  );
  var ortho = L.tileLayer(
    wmts('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'),
    Object.assign({ maxNativeZoom: 19, attribution: 'IGN Géoplateforme' }, o)
  );
  var osm = L.tileLayer(
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    Object.assign({ attribution: 'OpenStreetMap' }, o)
  );
  map = L.map('map', { layers: [ign], zoomControl: true }).setView([45.2, 6.2], 8);
  L.control
    .layers({ 'Plan IGN': ign, 'Topo (courbes)': topo, 'Photo aérienne': ortho, OSM: osm }, null, {
      position: 'topright'
    })
    .addTo(map);
  L.control.scale({ imperial: false }).addTo(map);
  tMark = L.marker([0, 0], {
    icon: L.divIcon({ className: '', html: '<div class="pin-t"></div>', iconSize: [28, 28], iconAnchor: [3, 31] })
  });
  meMark = L.marker([0, 0], {
    icon: L.divIcon({ className: '', html: '<div class="pin-me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
    interactive: false
  });
  meCirc = L.circle([0, 0], { radius: 1, color: '#1E6FD9', weight: 1, fillOpacity: 0.12, interactive: false });
  line = L.polyline([], { color: '#E6332A', weight: 3, dashArray: '8 8', interactive: false });
  track = L.layerGroup().addTo(map);
  map.on('zoomend', drawPins);

  // carte dépliée : Leaflet recalcule sa taille (elle était nulle tant que la tuile était repliée)
  $('mapCard').addEventListener('toggle', function () {
    if ($('mapCard').open) {
      map.invalidateSize();
      fit();
    }
  });
  $('fitBoth').addEventListener('click', fit);
  $('goTarget').addEventListener('click', function () {
    if (state.current) map.setView([state.current.lat, state.current.lon], 16);
  });
  $('goMe').addEventListener('click', function () {
    if (state.me) map.setView([state.me.lat, state.me.lon], 16);
  });
}

export function updateMap(recentre) {
  var current = state.current,
    me = state.me;
  if (map) {
    // le point affiché est déjà un point du suivi : pas de repère jaune par-dessus, sa pastille est mise en évidence
    var onTrack = current && markCurrent(current);
    if (current && !onTrack) {
      tMark.setLatLng([current.lat, current.lon]).addTo(map);
      tMark.bindPopup('<b>' + f6(current.lat) + ', ' + f6(current.lon) + '</b>');
    } else map.removeLayer(tMark);
    if (me) {
      meMark.setLatLng([me.lat, me.lon]).addTo(map);
      meCirc.setLatLng([me.lat, me.lon]).setRadius(me.acc).addTo(map);
    }
    if (me && current)
      line
        .setLatLngs([
          [me.lat, me.lon],
          [current.lat, current.lon]
        ])
        .addTo(map);
    else map.removeLayer(line);
    if (recentre) fit();
  }
  if (me && current) {
    var d = distM(me, current),
      b = bearing(me, current);
    $('dD').textContent = fmtDist(d);
    $('dB').textContent = Math.round(b) + '° ' + CARD[Math.round(b / 22.5) % 16];
    $('mapSum').textContent = fmtDist(d) + ' · ' + CARD[Math.round(b / 22.5) % 16];
  } else {
    $('dD').textContent = '-';
    $('dB').textContent = '-';
    $('mapSum').textContent = '';
  }
  $('dA').textContent = me ? '± ' + Math.round(me.acc) + ' m' : '-';
  updateRelief();
  updateCompass();
}

// Suivi : points numérotés dans l'ordre (chien signalé le matin, puis le soir...), reliés par un trait plein.
// Points trop proches à l'écran pour être distingués : une seule pastille « 2-3 » (ou « 2,5 »), détaillée au toucher ;
// elle se sépare en zoomant.
var GROUP_PX = 26;
export function setTrack(pts) {
  trackPts = pts || [];
  if (!track) return;
  track.clearLayers();
  trackMarks = [];
  if (!trackPts.length) return;
  var ll = trackPts.map(function (p) {
    return [p.lat, p.lon];
  });
  if (ll.length > 1) L.polyline(ll, { color: '#1E6FD9', weight: 4, opacity: 0.8, interactive: false }).addTo(track);
  drawPins();
}
// Regroupe les points dont les pastilles se chevauchent au zoom courant (indices dans l'ordre du suivi)
export function groupPins(px, minPx) {
  var groups = [];
  px.forEach(function (q, i) {
    var g = groups.find(function (g) {
      return Math.hypot(g.x - q.x, g.y - q.y) < minPx;
    });
    if (g) g.ids.push(i);
    else groups.push({ x: q.x, y: q.y, ids: [i] });
  });
  return groups;
}
// « 2-4 » pour des numéros qui se suivent, « 2,5 » sinon
export function pinLabel(ids) {
  var n = ids.map(function (i) {
    return i + 1;
  });
  if (n.length === 1) return String(n[0]);
  var seq = n.every(function (v, k) {
    return !k || v === n[k - 1] + 1;
  });
  return seq ? n[0] + '-' + n[n.length - 1] : n.join(',');
}
var pinLayer = null;
function drawPins() {
  if (!map || !track) return;
  if (pinLayer) track.removeLayer(pinLayer);
  pinLayer = L.layerGroup().addTo(track);
  var px = trackPts.map(function (p) {
    return map.latLngToLayerPoint([p.lat, p.lon]);
  });
  trackMarks = groupPins(px, GROUP_PX).map(function (g) {
    var lab = pinLabel(g.ids),
      p0 = trackPts[g.ids[0]],
      w = Math.max(24, 10 + lab.length * 8),
      pop = g.ids
        .map(function (i) {
          var p = trackPts[i];
          return (
            '<b>Point ' +
            (i + 1) +
            '</b> ' +
            (p.t ? fmtWhen(p.t) : '') +
            '<br>' +
            f6(p.lat) +
            ', ' +
            f6(p.lon) +
            (knownAlt(p) !== undefined ? ' · ' + fmtAlt(knownAlt(p)) : '') +
            (p.label ? '<br>' + esc(p.label) : '') +
            (i > g.ids[0] ? '<br><small>à ' + fmtDist(distM(trackPts[i - 1], p)) + ' du point ' + i + '</small>' : '')
          );
        })
        .join('<hr>');
    var m = L.marker([p0.lat, p0.lon], {
      icon: L.divIcon({
        className: '',
        html: '<div class="pin-n' + (g.ids.length > 1 ? ' multi' : '') + '">' + lab + '</div>',
        iconSize: [w, 24],
        iconAnchor: [w / 2, 12]
      })
    })
      .bindPopup(pop)
      .addTo(pinLayer);
    m.ids = g.ids;
    return m;
  });
  if (state.current) markCurrent(state.current);
}
// Pastille du suivi qui porte le point affiché (à moins de 3 m) mise en évidence ; vrai s'il y en a une
function markCurrent(c) {
  var hit = false;
  trackMarks.forEach(function (m) {
    var is = m.ids.some(function (i) {
        return distM(trackPts[i], c) < 3;
      }),
      el = m.getElement();
    if (el && el.firstChild) el.firstChild.classList.toggle('cur', is);
    m.setZIndexOffset(is ? 1000 : 0);
    if (is) hit = true;
  });
  return hit;
}
// Repère du profil du relief : endroit lu au doigt sur le profil (q : { lat, lon } ou null pour le retirer)
var probeMark = null;
export function probe(q) {
  if (!map) return;
  if (!probeMark)
    probeMark = L.circleMarker([0, 0], {
      radius: 7,
      color: '#111',
      weight: 2,
      fillColor: '#FFD400',
      fillOpacity: 1,
      interactive: false
    });
  if (q) probeMark.setLatLng([q.lat, q.lon]).addTo(map);
  else map.removeLayer(probeMark);
}
export function fitTrack() {
  if (!map || !trackPts.length) return;
  map.invalidateSize();
  var ll = trackPts.map(function (p) {
    return [p.lat, p.lon];
  });
  if (state.current) ll.push([state.current.lat, state.current.lon]);
  if (ll.length === 1) map.setView(ll[0], 15);
  else map.fitBounds(L.latLngBounds(ll), { padding: [40, 40], maxZoom: 16 });
}

function fit() {
  var current = state.current,
    me = state.me;
  if (!map) return;
  if (me && current)
    map.fitBounds(
      L.latLngBounds([
        [me.lat, me.lon],
        [current.lat, current.lon]
      ]),
      { padding: [40, 40], maxZoom: 16 }
    );
  else if (current) map.setView([current.lat, current.lon], 15);
  else if (me) map.setView([me.lat, me.lon], 14);
}

function watch() {
  if (watchId !== null) return;
  watchId = navigator.geolocation.watchPosition(
    function (p) {
      state.me = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy };
      $('geoMsg').hidden = true;
      updateMap(firstFix);
      firstFix = false;
    },
    function (e) {
      $('geoMsg').hidden = false;
      $('geoMsg').textContent =
        e.code === 1
          ? 'Localisation refusée : autorisez-la dans les réglages du navigateur pour voir votre position.'
          : "Position du téléphone indisponible pour l'instant.";
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 }
  );
}

export function startGeo() {
  if (!('geolocation' in navigator)) {
    $('geoMsg').hidden = false;
    $('geoMsg').textContent = 'Localisation non disponible sur cet appareil.';
    return;
  }
  watch();
  // GPS coupé quand l'appli passe en arrière-plan (batterie), relancé au retour
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
    } else watch();
  });
}
