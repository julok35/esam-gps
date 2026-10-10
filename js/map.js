/* Carte Leaflet (IGN, topo, photo aérienne, OSM), position du téléphone, distance et cap. */
import { $, f6, fmtDist, CARD, state } from './util.js';
import { distM, bearing } from './parser.js';

var map = null, tMark = null, meMark = null, meCirc = null, line = null, firstFix = true, watchId = null;

function wmts(layer, fmt) {
  return 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=' + layer + '&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=' + fmt;
}

export function initMap() {
  if (typeof L === 'undefined') { $('map').innerHTML = '<p class="hint pad">Carte indisponible.</p>'; return; }
  var o = { maxZoom: 19 };
  var ign = L.tileLayer(wmts('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png'), Object.assign({ maxNativeZoom: 19, attribution: 'IGN Géoplateforme' }, o));
  var topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', Object.assign({ subdomains: 'abc', maxNativeZoom: 17, attribution: 'OpenTopoMap, OpenStreetMap' }, o));
  var ortho = L.tileLayer(wmts('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'), Object.assign({ maxNativeZoom: 19, attribution: 'IGN Géoplateforme' }, o));
  var osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', Object.assign({ attribution: 'OpenStreetMap' }, o));
  map = L.map('map', { layers: [ign], zoomControl: true }).setView([45.2, 6.2], 8);
  L.control.layers({ 'Plan IGN': ign, 'Topo (courbes)': topo, 'Photo aérienne': ortho, 'OSM': osm }, null, { position: 'topright' }).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);
  tMark = L.marker([0, 0], { icon: L.divIcon({ className: '', html: '<div class="pin-t"></div>', iconSize: [28, 28], iconAnchor: [3, 31] }) });
  meMark = L.marker([0, 0], { icon: L.divIcon({ className: '', html: '<div class="pin-me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false });
  meCirc = L.circle([0, 0], { radius: 1, color: '#1E6FD9', weight: 1, fillOpacity: .12, interactive: false });
  line = L.polyline([], { color: '#E6332A', weight: 3, dashArray: '8 8', interactive: false });

  $('fitBoth').addEventListener('click', fit);
  $('goTarget').addEventListener('click', function () { if (state.current) map.setView([state.current.lat, state.current.lon], 16); });
  $('goMe').addEventListener('click', function () { if (state.me) map.setView([state.me.lat, state.me.lon], 16); });
}

export function updateMap(recentre) {
  var current = state.current, me = state.me;
  if (map) {
    if (current) {
      tMark.setLatLng([current.lat, current.lon]).addTo(map);
      tMark.bindPopup('<b>' + f6(current.lat) + ', ' + f6(current.lon) + '</b>');
    } else map.removeLayer(tMark);
    if (me) { meMark.setLatLng([me.lat, me.lon]).addTo(map); meCirc.setLatLng([me.lat, me.lon]).setRadius(me.acc).addTo(map); }
    if (me && current) line.setLatLngs([[me.lat, me.lon], [current.lat, current.lon]]).addTo(map); else map.removeLayer(line);
    if (recentre) fit();
  }
  if (me && current) {
    var d = distM(me, current), b = bearing(me, current);
    $('dD').textContent = fmtDist(d); $('dB').textContent = Math.round(b) + '° ' + CARD[Math.round(b / 22.5) % 16];
  } else { $('dD').textContent = '-'; $('dB').textContent = '-'; }
  $('dA').textContent = me ? '± ' + Math.round(me.acc) + ' m' : '-';
}

function fit() {
  var current = state.current, me = state.me;
  if (!map) return;
  if (me && current) map.fitBounds(L.latLngBounds([[me.lat, me.lon], [current.lat, current.lon]]), { padding: [40, 40], maxZoom: 16 });
  else if (current) map.setView([current.lat, current.lon], 15);
  else if (me) map.setView([me.lat, me.lon], 14);
}

function watch() {
  if (watchId !== null) return;
  watchId = navigator.geolocation.watchPosition(function (p) {
    state.me = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy };
    $('geoMsg').hidden = true;
    updateMap(firstFix); firstFix = false;
  }, function (e) {
    $('geoMsg').hidden = false; $('geoMsg').textContent = e.code === 1 ? 'Localisation refusée : autorisez-la dans les réglages du navigateur pour voir votre position.' : 'Position du téléphone indisponible pour l\'instant.';
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
}

export function startGeo() {
  if (!('geolocation' in navigator)) { $('geoMsg').hidden = false; $('geoMsg').textContent = 'Localisation non disponible sur cet appareil.'; return; }
  watch();
  // GPS coupé quand l'appli passe en arrière-plan (batterie), relancé au retour
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; } }
    else watch();
  });
}
