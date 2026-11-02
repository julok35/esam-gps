/* Suivi de plusieurs points (sans DOM pour la partie calcul, testée sous Node) : un animal perdu signalé le matin,
   puis à nouveau le soir : distance parcourue entre les signalements, direction, vitesse, pour suivre sa progression. */
import { distM, bearing } from './parser.js';
import { fmtDist, CARD, f6, $, esc, copy, openTile } from './util.js';
import { setTrack, fitTrack } from './map.js';
import { shareText } from './share.js';

/**
 * Point du suivi : { lat, lon, t : date en ms, label : étiquette libre (facultative) }.
 * Étape entre deux points consécutifs : { i : index du point d'arrivée, d : distance (m), b : cap (°), dt : durée (ms),
 * v : vitesse en m/h (null si durée nulle ou négative) }.
 */
var MIN_DT = 10 * 60000; // sous 10 minutes entre deux points, la vitesse n'a pas de sens (dates à corriger)
export function legs(points) {
  var out = [];
  for (var i = 1; i < points.length; i++) {
    var a = points[i - 1],
      b = points[i],
      d = distM(a, b),
      dt = b.t - a.t;
    out.push({ i: i, d: d, b: bearing(a, b), dt: dt, v: dt >= MIN_DT ? (d * 3600000) / dt : null });
  }
  return out;
}

// Bilan : distance cumulée, durée totale, vitesse moyenne, distance et cap à vol d'oiseau du premier au dernier point
export function stats(points) {
  var L = legs(points),
    total = 0;
  L.forEach(function (l) {
    total += l.d;
  });
  var first = points[0],
    last = points[points.length - 1],
    dt = points.length > 1 ? last.t - first.t : 0;
  return {
    n: points.length,
    total: total,
    dt: dt,
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
  var m = Math.round(ms / 60000),
    h = Math.floor(m / 60),
    d = Math.floor(h / 24);
  if (d) return d + ' j ' + (h % 24) + ' h';
  if (h) return h + ' h ' + (m % 60 < 10 ? '0' : '') + (m % 60);
  return m + ' min';
}

// Vitesse lisible en m/h ou km/h
export function fmtSpeed(v) {
  if (v === null || !isFinite(v)) return '';
  return v < 1000 ? Math.round(v) + ' m/h' : (v / 1000).toFixed(1).replace('.', ',') + ' km/h';
}

export function fmtWhen(t) {
  var d = new Date(t);
  return (
    d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) +
    ' ' +
    d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  );
}

// Message de partage du suivi : chaque point, puis chaque étape, puis le bilan
export function trackText(points) {
  if (!points.length) return '';
  var L = legs(points),
    s = stats(points),
    out = ['Suivi ESAM : ' + points.length + ' point' + (points.length > 1 ? 's' : '')];
  points.forEach(function (p, i) {
    out.push(i + 1 + '. ' + fmtWhen(p.t) + (p.label ? ' ' + p.label : '') + ' : ' + f6(p.lat) + ', ' + f6(p.lon));
    if (i) {
      var l = L[i - 1];
      out.push(
        '   ' +
          fmtDist(l.d) +
          ' depuis le point ' +
          i +
          ', cap ' +
          Math.round(l.b) +
          '° ' +
          card(l.b) +
          ', en ' +
          fmtDur(l.dt) +
          (l.v !== null ? ' (' + fmtSpeed(l.v) + ')' : '')
      );
    }
  });
  if (points.length > 1)
    out.push(
      'Total : ' +
        fmtDist(s.total) +
        ' en ' +
        fmtDur(s.dt) +
        (s.v !== null ? ' (' + fmtSpeed(s.v) + ')' : '') +
        ', ' +
        fmtDist(s.direct) +
        ' à vol d’oiseau du premier au dernier point, cap ' +
        Math.round(s.bearing) +
        '° ' +
        card(s.bearing)
    );
  return out.join('\n');
}

// ---------- Tuile « Suivi des points » ----------
var KEY = 'esam-gps-track';

export function loadTrack() {
  try {
    var t = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(t) ? t : [];
  } catch (e) {
    return [];
  }
}
function save(pts) {
  try {
    localStorage.setItem(KEY, JSON.stringify(pts));
  } catch (e) {}
}
// Le point affiché entre dans le suivi, daté de maintenant (la date se corrige ensuite dans la liste)
export function addPoint(c, label) {
  if (!c) return;
  var pts = loadTrack();
  pts.push({ lat: c.lat, lon: c.lon, t: Date.now(), label: label || '' });
  save(pts);
  drawTrack();
  openTrack();
}
function openTrack() {
  var d = $('trackCard');
  d.hidden = false;
  d.open = true;
  d.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
// valeur d'un champ datetime-local (heure locale, sans secondes)
function localVal(t) {
  var d = new Date(t),
    p = function (n) {
      return (n < 10 ? '0' : '') + n;
    };
  return (
    d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes())
  );
}
// Pour le point affiché : sa position par rapport au dernier point du suivi (texte court, ou '')
export function trackInfo(c) {
  var pts = loadTrack();
  if (!c || !pts.length) return '';
  var last = pts[pts.length - 1],
    d = distM(last, c);
  if (d < 1) return 'Même position que le point ' + pts.length + ' du suivi.';
  var b = bearing(last, c);
  return (
    'À ' +
    fmtDist(d) +
    ' du point ' +
    pts.length +
    ' du suivi (' +
    fmtWhen(last.t) +
    '), cap ' +
    Math.round(b) +
    '° ' +
    card(b) +
    ', il y a ' +
    fmtDur(Date.now() - last.t) +
    '.'
  );
}
export function drawTrack() {
  var pts = loadTrack(),
    L = legs(pts),
    s = stats(pts);
  $('trackCard').hidden = !pts.length;
  setTrack(pts);
  if (!pts.length) {
    $('trackSum').textContent = '';
    $('trackList').innerHTML = '';
    $('trackStats').innerHTML = '';
    return;
  }
  $('trackSum').textContent = pts.length + ' pt' + (pts.length > 1 ? 's · ' + fmtDist(s.total) : '');
  $('trackList').innerHTML = pts
    .map(function (p, i) {
      var leg = i ? L[i - 1] : null;
      return (
        '<li class="tp"><div class="tp-h"><span class="tp-n">' +
        (i + 1) +
        '</span><button class="tp-c" type="button" data-copy="' +
        f6(p.lat) +
        ', ' +
        f6(p.lon) +
        '">' +
        f6(p.lat) +
        ', ' +
        f6(p.lon) +
        '</button><button class="tp-x" type="button" data-tdel="' +
        i +
        '" aria-label="Retirer le point ' +
        (i + 1) +
        '">✕</button></div>' +
        '<div class="tp-e"><input type="datetime-local" data-tt="' +
        i +
        '" value="' +
        localVal(p.t) +
        '" aria-label="Date et heure du point ' +
        (i + 1) +
        '"><input type="text" data-tl="' +
        i +
        '" value="' +
        esc(p.label || '') +
        '" placeholder="Étiquette (ex. collier 8 h)" aria-label="Étiquette du point ' +
        (i + 1) +
        '"></div>' +
        (leg
          ? '<div class="tp-l">' +
            fmtDist(leg.d) +
            ' depuis le point ' +
            i +
            ' · cap ' +
            Math.round(leg.b) +
            '° ' +
            card(leg.b) +
            ' · ' +
            (leg.v !== null
              ? 'en ' + fmtDur(leg.dt) + ' (' + fmtSpeed(leg.v) + ')'
              : leg.dt > 0
                ? 'en ' + fmtDur(leg.dt) + ' (vérifiez les dates)'
                : 'dates à corriger') +
            '</div>'
          : '') +
        '</li>'
      );
    })
    .join('');
  $('trackStats').innerHTML =
    pts.length > 1
      ? '<div><span>Parcouru</span><b>' +
        fmtDist(s.total) +
        '</b></div><div><span>Durée</span><b>' +
        fmtDur(s.dt) +
        '</b></div><div><span>Vitesse</span><b>' +
        (s.v !== null ? fmtSpeed(s.v) : '-') +
        '</b></div><div><span>Vol d’oiseau</span><b>' +
        fmtDist(s.direct) +
        '</b><small>cap ' +
        Math.round(s.bearing) +
        '° ' +
        card(s.bearing) +
        '</small></div>'
      : '<p class="hint flush">Un point. Ajoutez le prochain signalement pour mesurer la distance parcourue.</p>';
}
export function initTrack() {
  $('trackList').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tdel]');
    if (!b) return;
    var pts = loadTrack();
    pts.splice(+b.dataset.tdel, 1);
    save(pts);
    drawTrack();
  });
  $('trackList').addEventListener('change', function (e) {
    var el = e.target,
      pts = loadTrack();
    if (el.dataset.tt !== undefined) {
      var t = new Date(el.value).getTime();
      if (isFinite(t)) pts[+el.dataset.tt].t = t;
    } else if (el.dataset.tl !== undefined) pts[+el.dataset.tl].label = el.value.slice(0, 40);
    else return;
    save(pts);
    drawTrack();
  });
  $('trackShare').addEventListener('click', function () {
    shareText(trackText(loadTrack()), $('trackShare'));
  });
  $('trackCopy').addEventListener('click', function () {
    copy(trackText(loadTrack()), $('trackCopy'));
  });
  $('trackFit').addEventListener('click', function () {
    openTile('map');
    fitTrack();
    $('mapCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('trackClear').addEventListener('click', function () {
    if (!loadTrack().length || !confirm('Vider le suivi ? Les points et leurs dates seront perdus.')) return;
    save([]);
    drawTrack();
  });
  $('trackCard').addEventListener('toggle', function () {
    if ($('trackCard').open) drawTrack();
  });
  drawTrack();
}
