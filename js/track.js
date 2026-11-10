/* Suivi de plusieurs points (sans DOM pour la partie calcul, testée sous Node) : un animal perdu signalé le matin,
   puis à nouveau le soir : distance parcourue entre les signalements, direction, vitesse, pour suivre sa progression. */
import { distM, bearing } from './parser.js';
import { fmtDist, fmtWhen, CARD, f6, $, esc, copy, openTile } from './util.js';
import { setTrack, fitTrack, probe } from './map.js';
import { shareText } from './share.js';
import { altitudes, fmtAlt, fmtDelta } from './place.js';
import { samplePath, pointAlts, climbs, slope, profileSvg } from './profile.js';

/**
 * Point du suivi : { lat, lon, t : date en ms, label : étiquette libre (facultative) }.
 * Étape entre deux points consécutifs : { i : index du point d'arrivée, d : distance (m), b : cap (°), dt : durée (ms),
 * v : vitesse en m/h (null si durée nulle ou négative) }.
 */
const MIN_DT = 10 * 60000; // sous 10 minutes entre deux points, la vitesse n'a pas de sens (dates à corriger)
export function legs(points) {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      d = distM(a, b),
      dt = b.t - a.t;
    out.push({ i, d, b: bearing(a, b), dt, v: dt >= MIN_DT ? (d * 3600000) / dt : null });
  }
  return out;
}

// Bilan : distance cumulée, durée totale, vitesse moyenne, distance et cap à vol d'oiseau du premier au dernier point
export function stats(points) {
  const L = legs(points);
  let total = 0;
  L.forEach((l) => {
    total += l.d;
  });
  const first = points[0],
    last = points[points.length - 1],
    dt = points.length > 1 ? last.t - first.t : 0;
  return {
    n: points.length,
    total,
    dt,
    v: dt >= MIN_DT ? (total * 3600000) / dt : null,
    direct: points.length > 1 ? distM(first, last) : 0,
    bearing: points.length > 1 ? bearing(first, last) : null,
    last: L.length ? L[L.length - 1] : null
  };
}

export function card(b) {
  return CARD[Math.round(b / 22.5) % 16];
}

// Durée lisible : « 25 min », « 9 h 33 », « 2 j 4 h »
export function fmtDur(ms) {
  if (!(ms > 0)) return '0 min';
  const m = Math.round(ms / 60000),
    h = Math.floor(m / 60),
    d = Math.floor(h / 24);
  if (d) return `${d} j ${h % 24} h`;
  if (h) return `${h} h ${m % 60 < 10 ? '0' : ''}${m % 60}`;
  return `${m} min`;
}

// Vitesse lisible en m/h ou km/h
export function fmtSpeed(v) {
  if (v === null || !isFinite(v)) return '';
  return v < 1000 ? `${Math.round(v)} m/h` : `${(v / 1000).toFixed(1).replace('.', ',')} km/h`;
}

// Message de partage du suivi : chaque point, puis chaque étape, puis le bilan.
// alts : altitudes du terrain aux points (null si inconnue), facultatives
export function trackText(points, name, alts) {
  if (!points.length) return '';
  const A = alts && alts.length === points.length ? alts : null,
    za = function (i) {
      return A && A[i] !== null && A[i] !== undefined;
    },
    L = legs(points),
    s = stats(points),
    out = [`Suivi ESAM${name ? ` · ${name}` : ''} : ${points.length} point${points.length > 1 ? 's' : ''}`];
  points.forEach((p, i) => {
    out.push(
      `${i + 1}. ${fmtWhen(p.t)}${p.label ? ` ${p.label}` : ''} : ${f6(p.lat)}, ${f6(
        p.lon
      )}${za(i) ? `, alt. ${fmtAlt(A[i])}` : ''}`
    );
    if (i) {
      const l = L[i - 1];
      out.push(
        `   ${fmtDist(l.d)} depuis le point ${i}, cap ${Math.round(l.b)}° ${card(l.b)}${
          za(i) && za(i - 1) ? `, dénivelé ${fmtDelta(A[i] - A[i - 1])}` : ''
        }, en ${fmtDur(l.dt)}${l.v !== null ? ` (${fmtSpeed(l.v)})` : ''}`
      );
    }
  });
  if (points.length > 1)
    out.push(
      `Total : ${fmtDist(s.total)} en ${fmtDur(s.dt)}${s.v !== null ? ` (${fmtSpeed(s.v)})` : ''}, ${fmtDist(
        s.direct
      )} à vol d’oiseau du premier au dernier point, cap ${Math.round(s.bearing)}° ${card(
        s.bearing
      )}${za(0) && za(points.length - 1) ? `, dénivelé ${fmtDelta(A[points.length - 1] - A[0])}` : ''}`
    );
  return out.join('\n');
}

// ---------- Reprendre le suivi plus tard ou sur un autre appareil ----------
// Lien : fragment « s= » de l'adresse de l'appli, nom puis points « lat,lon,secondes,étiquette » séparés par ~
// (nom et étiquettes encodés pour l'adresse). Décodage tolérant : un point mal formé est ignoré.
export function encodeTrack(name, points) {
  return `s=${encodeURIComponent(name || '')}${points
    .map((p) => `~${f6(p.lat)},${f6(p.lon)},${Math.round(p.t / 1000)},${encodeURIComponent(p.label || '')}`)
    .join('')}`;
}
function validPos(lat, lon) {
  return isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}
export function decodeTrack(hash) {
  const h = (hash || '').replace(/^#/, '');
  if (h.indexOf('s=') !== 0) return null;
  const parts = h.slice(2).split('~'),
    dec = function (x) {
      try {
        return decodeURIComponent(x);
      } catch (e) {
        return x;
      }
    },
    pts = [];
  for (let i = 1; i < parts.length; i++) {
    const f = parts[i].split(','),
      lat = +f[0],
      lon = +f[1],
      t = +f[2] * 1000;
    if (!validPos(lat, lon) || !isFinite(t)) continue;
    pts.push({ lat, lon, t, label: dec(f[3] || '').slice(0, 40) });
  }
  return { name: dec(parts[0]).slice(0, 40), points: pts };
}
// Fichier GPX : chaque point en waypoint (nom « 1 · étiquette », date), et la suite des points en trace, pour les
// autres applis (carte, Garmin). Lu en retour par parseGPX, qui prend aussi un GPX d'une autre source (wpt ou trkpt).
function xml(t) {
  return String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
export function toGPX(name, points) {
  const n = name || 'Suivi ESAM',
    w = points.map(
      (p, i) =>
        `  <wpt lat="${f6(p.lat)}" lon="${f6(p.lon)}"><time>${new Date(p.t).toISOString()}</time><name>${xml(
          i + 1 + (p.label ? ` · ${p.label}` : '')
        )}</name></wpt>`
    ),
    tp = points.map(
      (p) => `      <trkpt lat="${f6(p.lat)}" lon="${f6(p.lon)}"><time>${new Date(p.t).toISOString()}</time></trkpt>`
    );
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="GPS ESAM" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    `  <metadata><name>${xml(n)}</name></metadata>\n${w.join('\n')}${w.length ? '\n' : ''}  <trk><name>${xml(
      n
    )}</name><trkseg>\n${tp.join('\n')}\n    </trkseg></trk>\n</gpx>\n`
  );
}
export function parseGPX(text) {
  const name = (text.match(/<metadata>[\s\S]*?<name>([^<]*)<\/name>/) ||
    text.match(/<trk>\s*<name>([^<]*)<\/name>/) ||
    [])[1];
  const re = /<(wpt|trkpt)\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
  let m;
  const kinds = { wpt: [], trkpt: [] };
  const unesc = function (x) {
    return String(x || '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  };
  while ((m = re.exec(text))) {
    const body = m[3] || '',
      lat = +(m[2].match(/lat="([^"]+)"/) || [])[1],
      lon = +(m[2].match(/lon="([^"]+)"/) || [])[1],
      tm = Date.parse((body.match(/<time>([^<]*)<\/time>/) || [])[1] || ''),
      nm = unesc((body.match(/<name>([^<]*)<\/name>/) || [])[1]);
    if (!validPos(lat, lon)) continue;
    kinds[m[1]].push({
      lat,
      lon,
      t: isFinite(tm) ? tm : 0,
      label: nm
        .replace(/^\d+ · /, '')
        .replace(/^\d+$/, '')
        .slice(0, 40)
    });
  }
  // waypoints de préférence (ils portent les étiquettes), sinon les points de trace
  const pts = kinds.wpt.length ? kinds.wpt : kinds.trkpt;
  if (!pts.length) return null;
  return {
    name: unesc(name || '')
      .trim()
      .slice(0, 40),
    points: pts
  };
}
// Fusion : points de b ajoutés à a sans doublon (même position à 3 m près et même minute), triés par date
export function mergeTracks(a, b) {
  const out = a.slice();
  b.forEach((p) => {
    const dup = out.some((q) => distM(p, q) < 3 && Math.abs(p.t - q.t) < 60000);
    if (!dup) out.push({ lat: p.lat, lon: p.lon, t: p.t, label: p.label || '' });
  });
  return out.sort((x, y) => x.t - y.t);
}

// ---------- Tuile « Suivi des points » ----------
const KEY = 'esam-gps-track',
  NAME = 'esam-gps-track-name';
export function trackName() {
  try {
    return localStorage.getItem(NAME) || '';
  } catch (e) {
    return '';
  }
}
function setName(n) {
  try {
    localStorage.setItem(NAME, (n || '').slice(0, 40));
  } catch (e) {}
}
// Champ du nom en rouge tant qu'il est vide
function nameMark() {
  $('trackName').classList.toggle('empty', !$('trackName').value.trim());
}
// Texte du choix au démarrage : quel suivi est en cours, combien de points, depuis quand
export function resumeText(name, pts) {
  const n = pts.length,
    last = pts[n - 1];
  return `Suivi en cours${name ? ` : « ${name} »` : ' sans nom'} · ${n} point${n > 1 ? 's' : ''}${
    last ? `, dernier le ${fmtWhen(last.t)}` : ''
  }. Le continuer ou repartir de zéro ?`;
}
// Ouverture de l'appli avec un suivi déjà enregistré : choisir de le continuer ou de repartir de zéro
export function askResume() {
  const pts = loadTrack();
  $('resume').hidden = !pts.length;
  if (pts.length) $('resumeTxt').textContent = resumeText(trackName(), pts);
}
// Index du point du suivi qui est le point c (à moins de 3 m), sinon -1
export function indexOf(c) {
  const pts = loadTrack();
  if (!c) return -1;
  for (let i = 0; i < pts.length; i++) if (distM(pts[i], c) < 3) return i;
  return -1;
}
function appUrl() {
  return location.origin + location.pathname;
}
// Suivi reçu (lien ou fichier) : remplace un suivi vide, complète un suivi du même nom, demande sinon.
// Retour : message pour l'utilisateur.
export function importTrack(tr) {
  if (!tr || !tr.points.length) return 'Aucun point dans ce suivi.';
  const cur = loadTrack();
  const curName = trackName();
  let msg;
  if (!cur.length || (tr.name && curName && tr.name === curName) || !tr.name || !curName) {
    const merged = mergeTracks(cur, tr.points),
      added = merged.length - cur.length;
    save(merged);
    if (tr.name && !curName) setName(tr.name);
    msg = cur.length
      ? `${added} point${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''} au suivi${
          curName ? ` « ${curName} »` : ''
        }`
      : `Suivi${tr.name ? ` « ${tr.name} »` : ''} repris : ${tr.points.length} point${tr.points.length > 1 ? 's' : ''}`;
  } else if (
    confirm(
      `Un suivi « ${curName} » (${cur.length} points) est déjà sur ce téléphone. Le remplacer par « ${tr.name} » (${
        tr.points.length
      } points) ? Annuler le garde tel quel.`
    )
  ) {
    save(mergeTracks([], tr.points));
    setName(tr.name);
    msg = `Suivi « ${tr.name} » repris : ${tr.points.length} point${tr.points.length > 1 ? 's' : ''}`;
  } else return `Suivi « ${curName} » gardé, rien n\u2019a été importé.`;
  $('resume').hidden = true;
  drawTrack();
  openTrack();
  return msg;
}

export function loadTrack() {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(t)
      ? t.filter(
          (p) => p && validPos(p.lat, p.lon) && typeof p.lat === 'number' && typeof p.lon === 'number' && isFinite(p.t)
        )
      : [];
  } catch (e) {
    return [];
  }
}
// Le suivi est toujours dans l'ordre des dates (tri stable : deux points à la même date gardent leur ordre d'entrée)
function save(pts) {
  pts.sort((a, b) => a.t - b.t);
  try {
    localStorage.setItem(KEY, JSON.stringify(pts));
  } catch (e) {}
}
// Le point affiché entre dans le suivi, daté de la photo (t) ou de maintenant (la date se corrige dans la liste).
// Retour : son numéro dans le suivi
export function addPoint(c, label, t) {
  if (!c) return 0;
  const pts = loadTrack(),
    p = { lat: c.lat, lon: c.lon, t: t || Date.now(), label: label || '' };
  pts.push(p);
  save(pts);
  drawTrack();
  openTrack();
  return pts.indexOf(p) + 1;
}
// Plusieurs points d'un coup (lot de photos), sans doublon. Retour : nombre ajouté
export function addPoints(list) {
  const cur = loadTrack(),
    merged = mergeTracks(cur, list);
  save(merged);
  drawTrack();
  if (merged.length) openTrack();
  return merged.length - cur.length;
}
function openTrack() {
  const d = $('trackCard');
  d.hidden = false;
  d.open = true;
  d.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
// valeur d'un champ datetime-local (heure locale, sans secondes)
function localVal(t) {
  const d = new Date(t),
    p = function (n) {
      return (n < 10 ? '0' : '') + n;
    };
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
// Pour le point affiché : sa position par rapport au dernier point du suivi (texte court, ou '')
export function trackInfo(c) {
  const pts = loadTrack();
  if (!c || !pts.length) return '';
  const last = pts[pts.length - 1],
    d = distM(last, c);
  if (d < 1) return `Même position que le point ${pts.length} du suivi.`;
  const b = bearing(last, c);
  return `À ${fmtDist(d)} du point ${pts.length} du suivi (${fmtWhen(last.t)}), cap ${Math.round(b)}° ${card(
    b
  )}, il y a ${fmtDur(Date.now() - last.t)}.`;
}
// ---------- Relief : altitudes du terrain le long du suivi (réseau), gardées tant que les points ne changent pas ----------
let relief = { id: '', samples: [], zs: null, alts: [], wait: false },
  prof = null;
function reliefOf(pts) {
  const samples = samplePath(pts, 100),
    id = samples.map((q) => `${q.lat.toFixed(5)},${q.lon.toFixed(5)}`).join(';');
  if (id !== relief.id) {
    relief = {
      id,
      samples,
      zs: null,
      alts: pts.map(() => null),
      wait: false
    };
    if (pts.length && typeof navigator !== 'undefined' && navigator.onLine) {
      const mine = relief;
      mine.wait = true;
      altitudes(samples).then(
        (zs) => {
          if (relief !== mine) return;
          mine.zs = zs;
          mine.alts = pointAlts(samples, zs, pts.length);
          mine.wait = false;
          drawTrack();
        },
        () => {
          if (relief !== mine) return;
          mine.wait = false;
          relief.id = ''; // nouvel essai au prochain affichage
          drawProfile();
        }
      );
    }
  }
  return relief;
}
function drawProfile() {
  const box = $('trackProfile');
  if (!box) return;
  const R = relief;
  prof = R.zs && relief.samples.length > 1 ? profileSvg(R.samples, R.zs, fmtDist) : null;
  if (prof) {
    box.innerHTML = `<div class="pf-h"><span class="lbl flush">Relief</span><small id="pfRead">Touchez le profil pour lire l’altitude</small></div>${
      prof.svg
    }<p class="hint flush">Terrain en ligne droite d’un point au suivant : le trajet réel de l’animal peut contourner.</p>`;
  } else
    box.innerHTML =
      relief.samples.length > 1
        ? `<p class="hint flush">${
            R.wait ? 'Relief du parcours : chargement…' : 'Relief du parcours : réseau nécessaire.'
          }</p>`
        : '';
}
// Lecture du profil au doigt : altitude et distance sous le doigt, repère sur la carte
function readProfile(e) {
  const svg = e.target.closest && e.target.closest('svg.pf');
  if (!svg || !prof || !relief.zs) return;
  const r = svg.getBoundingClientRect();
  const vx = ((e.clientX - r.left) / r.width) * 600;
  let best = -1;
  let bd = Infinity;
  relief.samples.forEach((q, i) => {
    if (typeof relief.zs[i] !== 'number') return;
    const dd = Math.abs(prof.x(q.d) - vx);
    if (dd < bd) {
      bd = dd;
      best = i;
    }
  });
  if (best < 0) return;
  const q = relief.samples[best],
    cur = $('pfCur');
  cur.setAttribute('x1', prof.x(q.d));
  cur.setAttribute('x2', prof.x(q.d));
  cur.setAttribute('visibility', 'visible');
  $('pfRead').textContent =
    `${fmtAlt(relief.zs[best])} · à ${fmtDist(q.d)} du point 1${q.k >= 0 ? ` (point ${q.k + 1})` : ''}`;
  probe(q);
}

export function drawTrack() {
  const pts = loadTrack(),
    L = legs(pts),
    s = stats(pts),
    R = reliefOf(pts),
    A = R.alts,
    cl = climbs(A);
  $('trackCard').hidden = !pts.length;
  setTrack(pts);
  if (document.activeElement !== $('trackName')) $('trackName').value = trackName();
  nameMark();
  if (!pts.length) {
    $('trackSum').textContent = '';
    $('trackList').innerHTML = '';
    $('trackStats').innerHTML = '';
    drawProfile();
    return;
  }
  $('trackSum').textContent =
    `${(trackName() ? `${trackName()} · ` : '') + pts.length} pt${pts.length > 1 ? `s · ${fmtDist(s.total)}` : ''}`;
  $('trackList').innerHTML = pts
    .map((p, i) => {
      const leg = i ? L[i - 1] : null;
      return (
        `<li class="tp"><div class="tp-h"><span class="tp-n">${
          i + 1
        }</span><button class="tp-c" type="button" data-copy="${f6(p.lat)}, ${f6(p.lon)}">${f6(p.lat)}, ${f6(
          p.lon
        )}</button><button class="tp-x" type="button" data-tdel="${i}" aria-label="Retirer le point ${
          i + 1
        }">✕</button></div>` +
        `<div class="tp-e"><input type="datetime-local" data-tt="${i}" value="${localVal(
          p.t
        )}" aria-label="Date et heure du point ${i + 1}"><input type="text" data-tl="${i}" value="${esc(
          p.label || ''
        )}" placeholder="Étiquette (ex. collier 8 h)" aria-label="Étiquette du point ${i + 1}"></div>${
          A[i] !== null
            ? `<div class="tp-z"><b>${fmtAlt(A[i])}</b>${
                leg && A[i - 1] !== null ? zTag(A[i] - A[i - 1], leg.d) : ''
              }</div>`
            : ''
        }${
          leg
            ? `<div class="tp-l">${fmtDist(leg.d)} depuis le point ${i} · cap ${Math.round(leg.b)}° ${card(leg.b)} · ${
                leg.v !== null
                  ? `en ${fmtDur(leg.dt)} (${fmtSpeed(leg.v)})`
                  : leg.dt > 0
                    ? `en ${fmtDur(leg.dt)} (vérifiez les dates)`
                    : 'dates à corriger'
              }</div>`
            : ''
        }</li>`
      );
    })
    .join('');
  $('trackStats').innerHTML =
    pts.length > 1
      ? `<div><span>Parcouru</span><b>${fmtDist(s.total)}</b></div><div><span>Durée</span><b>${fmtDur(
          s.dt
        )}</b></div><div><span>Vitesse</span><b>${
          s.v !== null ? fmtSpeed(s.v) : '-'
        }</b></div><div><span>Vol d’oiseau</span><b>${fmtDist(s.direct)}</b><small>cap ${Math.round(s.bearing)}° ${card(
          s.bearing
        )}</small></div>${
          A[0] !== null && A[A.length - 1] !== null
            ? `<div><span>Dénivelé</span><b>${fmtDelta(A[A.length - 1] - A[0])}</b><small>${fmtDelta(
                cl.up
              )} / ${fmtDelta(-cl.down)} entre points</small></div>`
            : ''
        }`
      : '<p class="hint flush">Un point. Ajoutez le prochain signalement pour mesurer la distance parcourue.</p>';
  drawProfile();
}
// Montée / descente d'une étape : flèche, dénivelé, pente moyenne
function zTag(dz, d) {
  const sl = slope(dz, d),
    cls = Math.abs(dz) < 5 ? 'flat' : dz > 0 ? 'up' : 'down';
  return ` <span class="zt ${cls}">${cls === 'flat' ? '→' : cls === 'up' ? '↗' : '↘'} ${fmtDelta(dz)}${
    sl !== null && cls !== 'flat' ? ` · pente ${Math.round(Math.abs(sl))} %` : ''
  }</span>`;
}
let onName = function () {};
// onChange : appelé quand le nom ou les points changent par la tuile (le bouton d'ajout du point affiché se met à jour)
export function initTrack(onChange) {
  onName = onChange || onName;
  $('trackProfile').addEventListener('pointerdown', readProfile);
  $('trackProfile').addEventListener('pointermove', (e) => {
    if (e.buttons || e.pointerType === 'mouse') readProfile(e);
  });
  $('trackList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tdel]');
    if (!b) return;
    const pts = loadTrack();
    pts.splice(+b.dataset.tdel, 1);
    save(pts);
    drawTrack();
  });
  $('trackList').addEventListener('change', (e) => {
    const el = e.target,
      pts = loadTrack();
    if (el.dataset.tt !== undefined) {
      const t = new Date(el.value).getTime();
      if (isFinite(t)) pts[+el.dataset.tt].t = t;
    } else if (el.dataset.tl !== undefined) pts[+el.dataset.tl].label = el.value.slice(0, 40);
    else return;
    save(pts);
    drawTrack();
  });
  $('trackName').addEventListener('input', nameMark);
  $('trackName').addEventListener('change', () => {
    setName($('trackName').value.trim());
    drawTrack();
    onName();
  });
  $('trackShare').addEventListener('click', () => {
    shareText(trackText(loadTrack(), trackName(), relief.alts), $('trackShare'));
  });
  $('trackCopy').addEventListener('click', () => {
    copy(trackText(loadTrack(), trackName(), relief.alts), $('trackCopy'));
  });
  // reprendre ailleurs : lien (ouvert sur un autre téléphone, le suivi s'y installe), fichier GPX, import
  $('trackLink').addEventListener('click', () => {
    const u = `${appUrl()}#${encodeTrack(trackName(), loadTrack())}`;
    shareText(
      `Suivi ESAM${trackName() ? ` · ${trackName()}` : ''} : ouvrir ce lien dans GPS ESAM pour le poursuivre\n${u}`,
      $('trackLink')
    );
  });
  $('trackLinkCopy').addEventListener('click', () => {
    copy(`${appUrl()}#${encodeTrack(trackName(), loadTrack())}`, $('trackLinkCopy'));
  });
  $('trackGpx').addEventListener('click', () => {
    const n = (trackName() || 'suivi').replace(/[^\w\u00C0-\u017F-]+/g, '_');
    const blob = new Blob([toGPX(trackName(), loadTrack())], { type: 'application/gpx+xml' });
    let file;
    try {
      file = new File([blob], `suivi-${n}.gpx`, { type: 'application/gpx+xml' });
    } catch (e) {}
    if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] }))
      navigator.share({ title: 'Suivi ESAM', files: [file] }).catch(() => {});
    else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `suivi-${n}.gpx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
      }, 10000);
    }
  });
  $('trackFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    f.text().then((txt) => {
      const tr = /^\s*</.test(txt) ? parseGPX(txt) : decodeTrack((txt.match(/#(s=.*)$/m) || [])[1]);
      $('trackMsg').hidden = false;
      $('trackMsg').textContent = tr ? importTrack(tr) : 'Fichier non reconnu : GPX ou lien de suivi attendu.';
      onName();
    });
  });
  $('trackFit').addEventListener('click', () => {
    openTile('map');
    fitTrack();
    $('mapCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('trackClear').addEventListener('click', () => {
    if (
      !loadTrack().length ||
      !confirm(
        'Vider le suivi ? Les points et leurs dates seront perdus (sauf s\u2019il a été partagé en lien ou en GPX).'
      )
    )
      return;
    save([]);
    setName('');
    $('resume').hidden = true;
    drawTrack();
    onName();
  });
  $('resumeGo').addEventListener('click', () => {
    $('resume').hidden = true;
    openTile('trackCard');
    openTile('map');
    fitTrack();
    if (!trackName()) $('trackName').focus();
  });
  $('resumeNew').addEventListener('click', () => {
    const n = trackName();
    if (!confirm(`Effacer le suivi${n ? ` « ${n} »` : ''} et ses ${loadTrack().length} points pour repartir de zéro ?`))
      return;
    $('resume').hidden = true;
    save([]);
    setName('');
    drawTrack();
    onName();
    $('trackName').focus();
  });
  $('trackCard').addEventListener('toggle', () => {
    if ($('trackCard').open) drawTrack();
  });
  drawTrack();
}
