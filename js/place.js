/* Lieu du point : commune, lieux nommés proches (sommet, col, lac, cascade...), altitude du terrain,
   dénivelé avec le téléphone. Réseau nécessaire ; chaque réponse est gardée le temps de la session. */
import { $, esc, fmtDist, CARD, state } from './util.js';
import { distM, bearing } from './parser.js';

var RADIUS = 2000, RETRY = 30000;
var memo = {}, done = {}, failed = {}, meAt = null, meAlt = null;

function key(p) { return p.lat.toFixed(5) + ',' + p.lon.toFixed(5); }
export function fmtAlt(z) { return Math.round(z).toLocaleString('fr-FR') + ' m'; }
export function fmtDelta(d) { d = Math.round(d); return (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d).toLocaleString('fr-FR') + ' m'; }

function getJSON(url, ms) {
  var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var t = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
  return fetch(url, { signal: ctl ? ctl.signal : undefined, credentials: 'omit' }).then(function (r) {
    clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
  }, function (e) { clearTimeout(t); throw e; });
}

// Une requête par point et par sorte ; un échec n'est retenté qu'après 30 s (la position du téléphone change chaque seconde)
function once(kind, p, fn) {
  var id = kind + ':' + key(p);
  if (memo[id]) return memo[id];
  if (failed[id] && Date.now() - failed[id] < RETRY) return Promise.reject(new Error('échec récent'));
  memo[id] = fn(p).then(function (v) { done[id] = v; return v; }, function (e) { delete memo[id]; failed[id] = Date.now(); throw e; });
  return memo[id];
}
function known(kind, p) { return done[kind + ':' + key(p)]; }
function pending(kind, p) { var id = kind + ':' + key(p); return !!memo[id] && !(id in done); }

// ---------- Altitude du terrain : RGE ALTI de l'IGN (France), à défaut modèle mondial Copernicus 90 m ----------
function altIgn(p) {
  return getJSON('https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json?lon=' + p.lon.toFixed(6) + '&lat=' + p.lat.toFixed(6)
    + '&resource=ign_rge_alti_wld&zonly=true', 8000).then(function (j) {
    var z = j && j.elevations && j.elevations[0];
    if (z && typeof z === 'object') z = z.z;
    if (typeof z !== 'number' || !isFinite(z) || z < -1000) throw new Error('hors modèle IGN'); // -99999 : pas de donnée
    return z;
  });
}
function altCopernicus(p) {
  return getJSON('https://api.open-meteo.com/v1/elevation?latitude=' + p.lat.toFixed(6) + '&longitude=' + p.lon.toFixed(6), 8000).then(function (j) {
    var z = j && j.elevation && j.elevation[0];
    if (typeof z !== 'number' || !isFinite(z)) throw new Error('altitude inconnue');
    return z;
  });
}
export function altitude(p) { return once('alt', p, function () { return altIgn(p).catch(function () { return altCopernicus(p); }); }); }

// ---------- Commune : base officielle en France, OpenStreetMap ailleurs (Suisse, Italie...) ----------
function communeFr(p) {
  return getJSON('https://geo.api.gouv.fr/communes?lat=' + p.lat.toFixed(6) + '&lon=' + p.lon.toFixed(6) + '&fields=nom,codeDepartement&format=json', 8000).then(function (a) {
    if (!a || !a.length) throw new Error('hors France');
    return { nom: a[0].nom, dep: a[0].codeDepartement || '' };
  });
}
function communeOsm(p) {
  return getJSON('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=fr&lat=' + p.lat.toFixed(6) + '&lon=' + p.lon.toFixed(6), 8000).then(function (j) {
    var a = (j && j.address) || {}, nom = a.city || a.town || a.village || a.municipality || a.hamlet;
    if (!nom) throw new Error('commune inconnue');
    return { nom: nom, pays: a.country_code && a.country_code !== 'fr' ? a.country || '' : '' };
  });
}
export function commune(p) { return once('com', p, function () { return communeFr(p).catch(function () { return communeOsm(p); }); }); }

// ---------- Lieux nommés proches (OpenStreetMap, Overpass) ----------
var KIND = { peak: 'sommet', saddle: 'col', waterfall: 'cascade', spring: 'source', cave_entrance: 'grotte', glacier: 'glacier', water: 'lac',
  alpine_hut: 'refuge', wilderness_hut: 'cabane', hamlet: 'hameau', village: 'village', locality: 'lieu-dit', isolated_dwelling: 'lieu-dit' };
export function kindOf(t) {
  if (t.mountain_pass === 'yes') return 'col';
  if (t.waterway === 'waterfall') return 'cascade';
  if (t.natural === 'water' && /^(river|canal|stream|ditch|wastewater)$/.test(t.water || '')) return null; // rivière : pas un repère
  return KIND[t.natural] || KIND[t.tourism] || KIND[t.place] || null;
}

// Éléments Overpass -> repères triés par distance au point ; distance au bord pour un lac ou un glacier
export function nearby(els, p, max) {
  var byName = {}, out = [];
  (els || []).forEach(function (e) {
    var t = e.tags || {}, kind = kindOf(t), name = t['name:fr'] || t.name;
    if (!kind || !name) return;
    var pts = e.geometry || (e.lat != null ? [e] : e.center ? [e.center] : []), best = null;
    pts.forEach(function (q) { if (q && q.lat != null) { var d = distM(p, q); if (!best || d < best.d) best = { d: d, q: q }; } });
    if (!best) return;
    var id = name.toLowerCase(), prev = byName[id];
    if (prev && prev.d <= best.d) return; // même nom (col noté deux fois) : le plus proche
    var item = { name: name, kind: kind, d: best.d, b: bearing(best.q, p) };
    if (prev) out.splice(out.indexOf(prev), 1);
    byName[id] = item; out.push(item);
  });
  out.sort(function (a, b) { return a.d - b.d; });
  return out.slice(0, max || 3);
}
function overpassQuery(p) {
  var a = '(around:' + RADIUS + ',' + p.lat.toFixed(5) + ',' + p.lon.toFixed(5) + ')';
  return '[out:json][timeout:10];('
    + 'node' + a + '[name][natural~"^(peak|saddle|waterfall|spring|cave_entrance)$"];'
    + 'node' + a + '[name][mountain_pass=yes];'
    + 'node' + a + '[name][waterway=waterfall];'
    + 'node' + a + '[name][tourism~"^(alpine_hut|wilderness_hut)$"];'
    + 'node' + a + '[name][place~"^(hamlet|village|locality|isolated_dwelling)$"];'
    + ');out 80;'
    + 'way' + a + '[name][natural~"^(water|glacier)$"];out geom 15;';
}
export function lieux(p) {
  return once('osm', p, function () {
    var q = '/api/interpreter?data=' + encodeURIComponent(overpassQuery(p));
    // serveur principal souvent chargé : un second serveur en secours
    return getJSON('https://overpass-api.de' + q, 12000).catch(function () { return getJSON('https://overpass.kumi.systems' + q, 15000); })
      .then(function (j) { if (!j || !j.elements) throw new Error('réponse vide'); return nearby(j.elements, p, 3); });
  });
}

function where(n) { return n.d < 50 ? 'sur place' : 'point à ' + fmtDist(n.d) + ' au ' + CARD[Math.round(n.b / 22.5) % 16]; }
function comTxt(c) { return c.nom + (c.dep ? ' (' + c.dep + ')' : c.pays ? ' (' + c.pays + ')' : ''); }

// ---------- Affichage dans le résultat ----------
function paint(c) {
  var box = $('place');
  if (!box || !state.current || key(state.current) !== key(c)) return;
  var com = known('com', c), alt = known('alt', c), near = known('osm', c);
  if (!navigator.onLine && com === undefined && alt === undefined && near === undefined) {
    box.innerHTML = '<span class="hint flush">Commune, lieux proches et altitude : réseau nécessaire.</span>'; return;
  }
  var h = '<div class="pl1">'
    + (com ? '<b>' + esc(com.nom) + '</b>' + (com.dep || com.pays ? ' <small>(' + esc(com.dep || com.pays) + ')</small>' : '') : '<span class="wait">' + (pending('com', c) ? 'Commune…' : 'Commune inconnue') + '</span>')
    + '<span class="alt">Alt. ' + (alt !== undefined ? '<b>' + fmtAlt(alt) + '</b>' : pending('alt', c) ? '…' : '-') + '</span></div>';
  if (near && near.length) h += '<ul class="near">' + near.map(function (n) { return '<li><b>' + esc(n.name) + '</b> <small>' + n.kind + ' · ' + where(n) + '</small></li>'; }).join('') + '</ul>';
  else if (pending('osm', c)) h += '<div class="wait">Lieux proches…</div>';
  else if (near) h += '<div class="wait">Aucun lieu nommé à moins de 2 km</div>';
  else if (navigator.onLine) h += '<div class="wait">Lieux proches : service OpenStreetMap indisponible pour l\'instant</div>';
  box.innerHTML = h;
}

export function showPlace() {
  var c = state.current;
  if (!c) return;
  c = { lat: c.lat, lon: c.lon };
  var again = function () { paint(c); updateRelief(); };
  if (navigator.onLine) { commune(c).then(again, again); altitude(c).then(again, again); lieux(c).then(again, again); }
  paint(c);
}

// Dénivelé : altitude du terrain au point moins altitude du terrain sous le téléphone
// (l'altitude GPS du téléphone dérive de plusieurs dizaines de mètres)
export function updateRelief() {
  var c = state.current, me = state.me, el = $('dZ'), sub = $('dZme');
  if (!el) return;
  if (me && navigator.onLine && (!meAt || distM(meAt, me) > 25)) {
    var at = meAt = { lat: me.lat, lon: me.lon };
    altitude(at).then(function (z) { if (at === meAt) { meAlt = z; updateRelief(); } }, function () { if (at === meAt) meAt = null; }); // nouvel essai au prochain relevé GPS
  }
  sub.textContent = me && meAlt !== null ? 'vous ' + fmtAlt(meAlt) : '';
  var zc = c ? known('alt', c) : undefined;
  if (!c || !me) { el.textContent = '-'; el.title = ''; return; }
  if (zc === undefined || meAlt === null) { el.textContent = navigator.onLine ? '…' : '-'; el.title = ''; return; }
  el.textContent = fmtDelta(zc - meAlt);
  el.title = 'Point ' + fmtAlt(zc) + ', vous ' + fmtAlt(meAlt) + ' (altitude du terrain)';
}

// Altitudes du terrain connues au point et sous le téléphone (null si pas encore)
export function reliefNow() {
  var zc = state.current ? known('alt', state.current) : undefined;
  return zc === undefined || meAlt === null ? null : { point: zc, me: meAlt };
}

// Lignes ajoutées au message partagé, avec ce qui est déjà connu
export function placeText(c) {
  var com = known('com', c), alt = known('alt', c), near = known('osm', c), l = [];
  if (com) l.push('Commune : ' + comTxt(com));
  if (alt !== undefined) l.push('Altitude : ' + fmtAlt(alt));
  if (near && near.length) l.push('Près de : ' + near[0].name + ' (' + near[0].kind + ', ' + where(near[0]) + ')');
  return l.join('\n');
}

export function initPlace() { window.addEventListener('online', showPlace); }
