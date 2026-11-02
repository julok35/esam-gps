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
export function trackText(points, name) {
  if (!points.length) return '';
  var L = legs(points),
    s = stats(points),
    out = [
      'Suivi ESAM' + (name ? ' · ' + name : '') + ' : ' + points.length + ' point' + (points.length > 1 ? 's' : '')
    ];
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

// ---------- Reprendre le suivi plus tard ou sur un autre appareil ----------
// Lien : fragment « s= » de l'adresse de l'appli, nom puis points « lat,lon,secondes,étiquette » séparés par ~
// (nom et étiquettes encodés pour l'adresse). Décodage tolérant : un point mal formé est ignoré.
export function encodeTrack(name, points) {
  return (
    's=' +
    encodeURIComponent(name || '') +
    points
      .map(function (p) {
        return (
          '~' + f6(p.lat) + ',' + f6(p.lon) + ',' + Math.round(p.t / 1000) + ',' + encodeURIComponent(p.label || '')
        );
      })
      .join('')
  );
}
export function decodeTrack(hash) {
  var h = (hash || '').replace(/^#/, '');
  if (h.indexOf('s=') !== 0) return null;
  var parts = h.slice(2).split('~'),
    dec = function (x) {
      try {
        return decodeURIComponent(x);
      } catch (e) {
        return x;
      }
    },
    pts = [];
  for (var i = 1; i < parts.length; i++) {
    var f = parts[i].split(','),
      lat = +f[0],
      lon = +f[1],
      t = +f[2] * 1000;
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !isFinite(t)) continue;
    pts.push({ lat: lat, lon: lon, t: t, label: dec(f[3] || '').slice(0, 40) });
  }
  return { name: dec(parts[0]).slice(0, 40), points: pts };
}
// Fichier GPX : chaque point en waypoint (nom « 1 · étiquette », date), et la suite des points en trace, pour les
// autres applis (carte, Garmin). Lu en retour par parseGPX, qui prend aussi un GPX d'une autre source (wpt ou trkpt).
function xml(t) {
  return String(t).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
export function toGPX(name, points) {
  var n = name || 'Suivi ESAM',
    w = points.map(function (p, i) {
      return (
        '  <wpt lat="' +
        f6(p.lat) +
        '" lon="' +
        f6(p.lon) +
        '"><time>' +
        new Date(p.t).toISOString() +
        '</time><name>' +
        xml(i + 1 + (p.label ? ' · ' + p.label : '')) +
        '</name></wpt>'
      );
    }),
    tp = points.map(function (p) {
      return (
        '      <trkpt lat="' +
        f6(p.lat) +
        '" lon="' +
        f6(p.lon) +
        '"><time>' +
        new Date(p.t).toISOString() +
        '</time></trkpt>'
      );
    });
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="GPS ESAM" xmlns="http://www.topografix.com/GPX/1/1">\n' +
    '  <metadata><name>' +
    xml(n) +
    '</name></metadata>\n' +
    w.join('\n') +
    (w.length ? '\n' : '') +
    '  <trk><name>' +
    xml(n) +
    '</name><trkseg>\n' +
    tp.join('\n') +
    '\n    </trkseg></trk>\n</gpx>\n'
  );
}
export function parseGPX(text) {
  var name = (text.match(/<metadata>[\s\S]*?<name>([^<]*)<\/name>/) ||
      text.match(/<trk>\s*<name>([^<]*)<\/name>/) ||
      [])[1],
    re = /<(wpt|trkpt)\s+([^>]*)>([\s\S]*?)<\/\1>/g,
    m,
    kinds = { wpt: [], trkpt: [] },
    unesc = function (x) {
      return String(x || '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
    };
  while ((m = re.exec(text))) {
    var lat = +(m[2].match(/lat="([^"]+)"/) || [])[1],
      lon = +(m[2].match(/lon="([^"]+)"/) || [])[1],
      tm = Date.parse((m[3].match(/<time>([^<]*)<\/time>/) || [])[1] || ''),
      nm = unesc((m[3].match(/<name>([^<]*)<\/name>/) || [])[1]);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    kinds[m[1]].push({
      lat: lat,
      lon: lon,
      t: isFinite(tm) ? tm : 0,
      label: nm
        .replace(/^\d+ · /, '')
        .replace(/^\d+$/, '')
        .slice(0, 40)
    });
  }
  // waypoints de préférence (ils portent les étiquettes), sinon les points de trace
  var pts = kinds.wpt.length ? kinds.wpt : kinds.trkpt;
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
  var out = a.slice();
  b.forEach(function (p) {
    var dup = out.some(function (q) {
      return distM(p, q) < 3 && Math.abs(p.t - q.t) < 60000;
    });
    if (!dup) out.push({ lat: p.lat, lon: p.lon, t: p.t, label: p.label || '' });
  });
  return out.sort(function (x, y) {
    return x.t - y.t;
  });
}

// ---------- Tuile « Suivi des points » ----------
var KEY = 'esam-gps-track',
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
// Index du point du suivi qui est le point c (à moins de 3 m), sinon -1
export function indexOf(c) {
  var pts = loadTrack();
  if (!c) return -1;
  for (var i = 0; i < pts.length; i++) if (distM(pts[i], c) < 3) return i;
  return -1;
}
function appUrl() {
  return location.origin + location.pathname;
}
// Suivi reçu (lien ou fichier) : remplace un suivi vide, complète un suivi du même nom, demande sinon.
// Retour : message pour l'utilisateur.
export function importTrack(tr) {
  if (!tr || !tr.points.length) return 'Aucun point dans ce suivi.';
  var cur = loadTrack(),
    curName = trackName(),
    msg;
  if (!cur.length || (tr.name && curName && tr.name === curName) || !tr.name || !curName) {
    var merged = mergeTracks(cur, tr.points),
      added = merged.length - cur.length;
    save(merged);
    if (tr.name && !curName) setName(tr.name);
    msg = cur.length
      ? added +
        ' point' +
        (added > 1 ? 's' : '') +
        ' ajouté' +
        (added > 1 ? 's' : '') +
        ' au suivi' +
        (curName ? ' « ' + curName + ' »' : '')
      : 'Suivi' +
        (tr.name ? ' « ' + tr.name + ' »' : '') +
        ' repris : ' +
        tr.points.length +
        ' point' +
        (tr.points.length > 1 ? 's' : '');
  } else if (
    confirm(
      'Un suivi « ' +
        curName +
        ' » (' +
        cur.length +
        ' points) est déjà sur ce téléphone. Le remplacer par « ' +
        tr.name +
        ' » (' +
        tr.points.length +
        ' points) ? Annuler le garde tel quel.'
    )
  ) {
    save(mergeTracks([], tr.points));
    setName(tr.name);
    msg = 'Suivi « ' + tr.name + ' » repris : ' + tr.points.length + ' point' + (tr.points.length > 1 ? 's' : '');
  } else return 'Suivi « ' + curName + ' » gardé, rien n\u2019a été importé.';
  drawTrack();
  openTrack();
  return msg;
}

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
  if (!c) return 0;
  var pts = loadTrack();
  pts.push({ lat: c.lat, lon: c.lon, t: Date.now(), label: label || '' });
  save(pts);
  drawTrack();
  openTrack();
  return pts.length;
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
  $('trackName').value = trackName();
  if (!pts.length) {
    $('trackSum').textContent = '';
    $('trackList').innerHTML = '';
    $('trackStats').innerHTML = '';
    return;
  }
  $('trackSum').textContent =
    (trackName() ? trackName() + ' · ' : '') + pts.length + ' pt' + (pts.length > 1 ? 's · ' + fmtDist(s.total) : '');
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
var onName = function () {};
// onChange : appelé quand le nom ou les points changent par la tuile (le bouton d'ajout du point affiché se met à jour)
export function initTrack(onChange) {
  onName = onChange || onName;
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
  $('trackName').addEventListener('change', function () {
    setName($('trackName').value.trim());
    drawTrack();
    onName();
  });
  $('trackShare').addEventListener('click', function () {
    shareText(trackText(loadTrack(), trackName()), $('trackShare'));
  });
  $('trackCopy').addEventListener('click', function () {
    copy(trackText(loadTrack(), trackName()), $('trackCopy'));
  });
  // reprendre ailleurs : lien (ouvert sur un autre téléphone, le suivi s'y installe), fichier GPX, import
  $('trackLink').addEventListener('click', function () {
    var u = appUrl() + '#' + encodeTrack(trackName(), loadTrack());
    shareText(
      'Suivi ESAM' +
        (trackName() ? ' · ' + trackName() : '') +
        ' : ouvrir ce lien dans GPS ESAM pour le poursuivre\n' +
        u,
      $('trackLink')
    );
  });
  $('trackLinkCopy').addEventListener('click', function () {
    copy(appUrl() + '#' + encodeTrack(trackName(), loadTrack()), $('trackLinkCopy'));
  });
  $('trackGpx').addEventListener('click', function () {
    var n = (trackName() || 'suivi').replace(/[^\w\u00C0-\u017F-]+/g, '_'),
      blob = new Blob([toGPX(trackName(), loadTrack())], { type: 'application/gpx+xml' }),
      file;
    try {
      file = new File([blob], 'suivi-' + n + '.gpx', { type: 'application/gpx+xml' });
    } catch (e) {}
    if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] }))
      navigator.share({ title: 'Suivi ESAM', files: [file] }).catch(function () {});
    else {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'suivi-' + n + '.gpx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
      }, 10000);
    }
  });
  $('trackFile').addEventListener('change', function (e) {
    var f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    f.text().then(function (txt) {
      var tr = /^\s*</.test(txt) ? parseGPX(txt) : decodeTrack((txt.match(/#(s=.*)$/m) || [])[1]);
      $('trackMsg').hidden = false;
      $('trackMsg').textContent = tr ? importTrack(tr) : 'Fichier non reconnu : GPX ou lien de suivi attendu.';
      onName();
    });
  });
  $('trackFit').addEventListener('click', function () {
    openTile('map');
    fitTrack();
    $('mapCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('trackClear').addEventListener('click', function () {
    if (
      !loadTrack().length ||
      !confirm(
        'Vider le suivi ? Les points et leurs dates seront perdus (sauf s\u2019il a été partagé en lien ou en GPX).'
      )
    )
      return;
    save([]);
    setName('');
    drawTrack();
    onName();
  });
  $('trackCard').addEventListener('toggle', function () {
    if ($('trackCard').open) drawTrack();
  });
  drawTrack();
}
