/* Lieu du point : commune, lieux nommés proches (sommet, col, lac, cascade...), altitude du terrain,
   dénivelé avec le téléphone. Réseau nécessaire ; chaque réponse est gardée le temps de la session. */
import { $, esc, fmtDist, CARD, state } from './util.js';
import { distM, bearing } from './parser.js';

const RADIUS = 2000,
  RETRY = 30000;
const memo = {};
const done = {};
const failed = {};
let meAt = null;
let meAlt = null;

function key(p) {
  return `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
}
export function fmtAlt(z) {
  return `${Math.round(z).toLocaleString('fr-FR')} m`;
}
export function fmtDelta(d) {
  d = Math.round(d);
  return `${(d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d).toLocaleString('fr-FR')} m`;
}

function getJSON(url, ms) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = setTimeout(() => {
    if (ctl) ctl.abort();
  }, ms);
  return fetch(url, { signal: ctl ? ctl.signal : undefined, credentials: 'omit' }).then(
    (r) => {
      clearTimeout(t);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    (e) => {
      clearTimeout(t);
      throw e;
    }
  );
}

// Une requête par point et par sorte ; un échec n'est retenté qu'après 30 s (la position du téléphone change chaque seconde)
function once(kind, p, fn) {
  const id = `${kind}:${key(p)}`;
  if (memo[id]) return memo[id];
  if (failed[id] && Date.now() - failed[id] < RETRY) return Promise.reject(new Error('échec récent'));
  memo[id] = fn(p).then(
    (v) => {
      done[id] = v;
      return v;
    },
    (e) => {
      delete memo[id];
      failed[id] = Date.now();
      throw e;
    }
  );
  return memo[id];
}
function known(kind, p) {
  return done[`${kind}:${key(p)}`];
}
function pending(kind, p) {
  const id = `${kind}:${key(p)}`;
  return !!memo[id] && !(id in done);
}

// ---------- Altitude du terrain : RGE ALTI de l'IGN (France), à défaut modèle mondial Copernicus 90 m ----------
function altIgn(p) {
  return getJSON(
    `https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json?lon=${p.lon.toFixed(6)}&lat=${p.lat.toFixed(
      6
    )}&resource=ign_rge_alti_wld&zonly=true`,
    8000
  ).then((j) => {
    let z = j && j.elevations && j.elevations[0];
    if (z && typeof z === 'object') z = z.z;
    if (typeof z !== 'number' || !isFinite(z) || z < -1000) throw new Error('hors modèle IGN'); // -99999 : pas de donnée
    return z;
  });
}
function altCopernicus(p) {
  return getJSON(
    `https://api.open-meteo.com/v1/elevation?latitude=${p.lat.toFixed(6)}&longitude=${p.lon.toFixed(6)}`,
    8000
  ).then((j) => {
    const z = j && j.elevation && j.elevation[0];
    if (typeof z !== 'number' || !isFinite(z)) throw new Error('altitude inconnue');
    return z;
  });
}
// Plusieurs altitudes d'un coup (profil du suivi) : une requête par paquet de 100 points ; null si inconnue
function altsIgn(ps) {
  return getJSON(
    `https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json?lon=${ps
      .map((p) => p.lon.toFixed(6))
      .join('|')}&lat=${ps.map((p) => p.lat.toFixed(6)).join('|')}&resource=ign_rge_alti_wld&zonly=true`,
    12000
  ).then((j) => {
    let zs = (j && j.elevations) || [];
    if (zs.length !== ps.length) throw new Error('réponse IGN incomplète');
    zs = zs.map((z) => {
      if (z && typeof z === 'object') z = z.z;
      return typeof z === 'number' && isFinite(z) && z > -1000 ? z : null;
    });
    if (zs.indexOf(null) >= 0) throw new Error('hors modèle IGN');
    return zs;
  });
}
function altsCopernicus(ps) {
  return getJSON(
    `https://api.open-meteo.com/v1/elevation?latitude=${ps.map((p) => p.lat.toFixed(6)).join(',')}&longitude=${ps
      .map((p) => p.lon.toFixed(6))
      .join(',')}`,
    12000
  ).then((j) => {
    const zs = (j && j.elevation) || [];
    if (zs.length !== ps.length) throw new Error('altitudes inconnues');
    return zs.map((z) => (typeof z === 'number' && isFinite(z) ? z : null));
  });
}
const altsMemo = {};
export function altitudes(ps) {
  const id = ps.map(key).join(';');
  if (altsMemo[id]) return altsMemo[id];
  const packs = [];
  for (let i = 0; i < ps.length; i += 100) packs.push(ps.slice(i, i + 100));
  altsMemo[id] = Promise.all(packs.map((pk) => altsIgn(pk).catch(() => altsCopernicus(pk)))).then(
    (r) => {
      const zs = [].concat.apply([], r);
      // les points du suivi servent aussi à la fiche du point (même cache que l'altitude d'un point seul)
      ps.forEach((p, i) => {
        if (zs[i] !== null) {
          const k = `alt:${key(p)}`;
          if (!(k in done)) {
            done[k] = zs[i];
            memo[k] = Promise.resolve(zs[i]);
          }
        }
      });
      return zs;
    },
    (e) => {
      delete altsMemo[id];
      throw e;
    }
  );
  return altsMemo[id];
}
// Altitude du terrain déjà connue au point (undefined sinon)
export function knownAlt(p) {
  return known('alt', p);
}

export function altitude(p) {
  return once('alt', p, () => altIgn(p).catch(() => altCopernicus(p)));
}

// ---------- Commune : base officielle en France, OpenStreetMap ailleurs (Suisse, Italie...) ----------
function communeFr(p) {
  return getJSON(
    `https://geo.api.gouv.fr/communes?lat=${p.lat.toFixed(6)}&lon=${p.lon.toFixed(
      6
    )}&fields=nom,codeDepartement&format=json`,
    8000
  ).then((a) => {
    if (!a || !a.length) throw new Error('hors France');
    return { nom: a[0].nom, dep: a[0].codeDepartement || '' };
  });
}
function communeOsm(p) {
  return getJSON(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=fr&lat=${p.lat.toFixed(
      6
    )}&lon=${p.lon.toFixed(6)}`,
    8000
  ).then((j) => {
    const a = (j && j.address) || {},
      nom = a.city || a.town || a.village || a.municipality || a.hamlet;
    if (!nom) throw new Error('commune inconnue');
    return { nom, pays: a.country_code && a.country_code !== 'fr' ? a.country || '' : '' };
  });
}
export function commune(p) {
  return once('com', p, () => communeFr(p).catch(() => communeOsm(p)));
}

// ---------- Lieux nommés proches (OpenStreetMap, Overpass) ----------
const KIND = {
  peak: 'sommet',
  saddle: 'col',
  waterfall: 'cascade',
  spring: 'source',
  cave_entrance: 'grotte',
  glacier: 'glacier',
  water: 'lac',
  alpine_hut: 'refuge',
  wilderness_hut: 'cabane',
  hamlet: 'hameau',
  village: 'village',
  locality: 'lieu-dit',
  isolated_dwelling: 'lieu-dit'
};
export function kindOf(t) {
  if (t.mountain_pass === 'yes') return 'col';
  if (t.waterway === 'waterfall') return 'cascade';
  if (t.natural === 'water' && /^(river|canal|stream|ditch|wastewater)$/.test(t.water || '')) return null; // rivière : pas un repère
  return KIND[t.natural] || KIND[t.tourism] || KIND[t.place] || null;
}

// Éléments Overpass -> repères triés par distance au point ; distance au bord pour un lac ou un glacier
export function nearby(els, p, max) {
  const byName = {},
    out = [];
  (els || []).forEach((e) => {
    const t = e.tags || {},
      kind = kindOf(t),
      name = t['name:fr'] || t.name;
    if (!kind || !name) return;
    const pts = e.geometry || (e.lat != null ? [e] : e.center ? [e.center] : []);
    let best = null;
    pts.forEach((q) => {
      if (q && q.lat != null) {
        const d = distM(p, q);
        if (!best || d < best.d) best = { d, q };
      }
    });
    if (!best) return;
    const id = name.toLowerCase(),
      prev = byName[id];
    if (prev && prev.d <= best.d) return; // même nom (col noté deux fois) : le plus proche
    const item = { name, kind, d: best.d, b: bearing(best.q, p) };
    if (prev) out.splice(out.indexOf(prev), 1);
    byName[id] = item;
    out.push(item);
  });
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, max || 3);
}
function overpassQuery(p) {
  const a = `(around:${RADIUS},${p.lat.toFixed(5)},${p.lon.toFixed(5)})`;
  return (
    `[out:json][timeout:10];(` +
    `node${a}[name][natural~"^(peak|saddle|waterfall|spring|cave_entrance)$"];` +
    `node${a}[name][mountain_pass=yes];` +
    `node${a}[name][waterway=waterfall];` +
    `node${a}[name][tourism~"^(alpine_hut|wilderness_hut)$"];` +
    `node${a}[name][place~"^(hamlet|village|locality|isolated_dwelling)$"];` +
    `);out 80;` +
    `way${a}[name][natural~"^(water|glacier)$"];out geom 15;`
  );
}
export function lieux(p) {
  return once('osm', p, () => {
    const q = `/api/interpreter?data=${encodeURIComponent(overpassQuery(p))}`;
    // serveur principal souvent chargé : un second serveur en secours
    return getJSON(`https://overpass-api.de${q}`, 12000)
      .catch(() => getJSON(`https://overpass.kumi.systems${q}`, 15000))
      .then((j) => {
        if (!j || !j.elements) throw new Error('réponse vide');
        return nearby(j.elements, p, 3);
      });
  });
}

function where(n) {
  return n.d < 50 ? 'sur place' : `point à ${fmtDist(n.d)} au ${CARD[Math.round(n.b / 22.5) % 16]}`;
}
function comTxt(c) {
  return c.nom + (c.dep ? ` (${c.dep})` : c.pays ? ` (${c.pays})` : '');
}

// ---------- Affichage dans le résultat ----------
function paint(c) {
  const box = $('place');
  if (!box || !state.current || key(state.current) !== key(c)) return;
  const com = known('com', c),
    alt = known('alt', c),
    near = known('osm', c);
  if (!navigator.onLine && com === undefined && alt === undefined && near === undefined) {
    box.innerHTML = '<span class="hint flush">Commune, lieux proches et altitude : réseau nécessaire.</span>';
    paintPilot(undefined, false);
    return;
  }
  let h = `<div class="pl1">${
    com
      ? `<b>${esc(com.nom)}</b>${com.dep || com.pays ? ` <small>(${esc(com.dep || com.pays)})</small>` : ''}`
      : `<span class="wait">${pending('com', c) ? 'Commune…' : 'Commune inconnue'}</span>`
  }<span class="alt">Alt. ${alt !== undefined ? `<b>${fmtAlt(alt)}</b>` : pending('alt', c) ? '…' : '-'}</span></div>`;
  if (near && near.length)
    h += `<ul class="near">${near
      .map((n) => `<li><b>${esc(n.name)}</b> <small>${n.kind} · ${where(n)}</small></li>`)
      .join('')}</ul>`;
  else if (pending('osm', c)) h += '<div class="wait">Lieux proches…</div>';
  else if (near) h += '<div class="wait">Aucun lieu nommé à moins de 2 km</div>';
  else if (navigator.onLine)
    h += '<div class="wait">Lieux proches : service OpenStreetMap indisponible pour l\'instant</div>';
  box.innerHTML = h;
  paintPilot(alt, pending('alt', c));
}

// Saisie DJI Pilot 2 : altitude ASL du terrain au point, en mètres entiers (champ ASL de « Modifier les repères »)
function paintPilot(alt, wait) {
  const el = $('pilotAlt');
  if (!el) return;
  if (alt === undefined) {
    el.innerHTML = `<span class="pv off">${wait ? '…' : navigator.onLine ? 'inconnue' : 'réseau nécessaire'}</span>`;
    return;
  }
  const v = String(Math.round(alt));
  if (el.dataset.v === v) return; // garde la coche « copié »
  el.dataset.v = v;
  el.innerHTML = `<button class="pv" type="button" data-copy="${v}"><b>${v}</b><i>m</i></button>`;
}

export function showPlace() {
  let c = state.current;
  if (!c) return;
  c = { lat: c.lat, lon: c.lon };
  const again = function () {
    paint(c);
    updateRelief();
  };
  if (navigator.onLine) {
    commune(c).then(again, again);
    altitude(c).then(again, again);
    lieux(c).then(again, again);
  }
  paint(c);
}

// Dénivelé : altitude du terrain au point moins altitude du terrain sous le téléphone
// (l'altitude GPS du téléphone dérive de plusieurs dizaines de mètres)
export function updateRelief() {
  const c = state.current,
    me = state.me,
    el = $('dZ'),
    sub = $('dZme');
  if (!el) return;
  if (me && navigator.onLine && (!meAt || distM(meAt, me) > 25)) {
    const at = (meAt = { lat: me.lat, lon: me.lon });
    altitude(at).then(
      (z) => {
        if (at === meAt) {
          meAlt = z;
          updateRelief();
        }
      },
      () => {
        if (at === meAt) meAt = null;
      }
    ); // nouvel essai au prochain relevé GPS
  }
  sub.textContent = me && meAlt !== null ? `vous ${fmtAlt(meAlt)}` : '';
  const zc = c ? known('alt', c) : undefined;
  if (!c || !me) {
    el.textContent = '-';
    el.title = '';
    return;
  }
  if (zc === undefined || meAlt === null) {
    el.textContent = navigator.onLine ? '…' : '-';
    el.title = '';
    return;
  }
  el.textContent = fmtDelta(zc - meAlt);
  el.title = `Point ${fmtAlt(zc)}, vous ${fmtAlt(meAlt)} (altitude du terrain)`;
}

// Altitudes du terrain connues au point et sous le téléphone (null si pas encore)
export function reliefNow() {
  const zc = state.current ? known('alt', state.current) : undefined;
  return zc === undefined || meAlt === null ? null : { point: zc, me: meAlt };
}

// Lignes ajoutées au message partagé, avec ce qui est déjà connu
export function placeText(c) {
  const com = known('com', c),
    alt = known('alt', c),
    near = known('osm', c),
    l = [];
  if (com) l.push(`Commune : ${comTxt(com)}`);
  if (alt !== undefined) l.push(`Altitude : ${fmtAlt(alt)}`);
  if (near && near.length) l.push(`Près de : ${near[0].name} (${near[0].kind}, ${where(near[0])})`);
  return l.join('\n');
}

export function initPlace() {
  window.addEventListener('online', showPlace);
}
