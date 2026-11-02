/* GPS ESAM : point d'entrée. Lecture du texte, affichage du résultat, liens, événements. */
import { $, esc, f6, copy, state, VERSION, initTiles, openTile } from './util.js';
import { parse, toDMM, toDMS, toUTM } from './parser.js';
import { initMap, updateMap, startGeo } from './map.js';
import { initShare, drawQR, shareText } from './share.js';
import { loadHist, drawHist, scheduleHist, flushHist, cancelHist } from './history.js';
import { initAuto, hideSteps } from './auto.js';
import { initFix, openFix, closeFix } from './fix.js';
import { initPlace, showPlace, placeText } from './place.js';
import { initCompass } from './compass.js';
import { confidence, trusted } from './trust.js';
import { initTrack, addPoint, trackInfo, trackName, indexOf, decodeTrack, importTrack } from './track.js';
import { initBatch, batchChecked } from './batch.js';
import { clearZone, photoTime, photoFile } from './ocr.js';

var src = $('src'),
  out = $('result');
var chosen = 0,
  lastParse = null,
  // texte issu d'une photo (lecture, puis corrections à la main) : le point du suivi garde la date de la photo
  fromPhoto = false,
  sayTimer = null;

// Annonce courte pour les lecteurs d'écran, une fois la saisie posée
function say(t) {
  clearTimeout(sayTimer);
  sayTimer = setTimeout(function () {
    $('announce').textContent = t;
  }, 800);
}
function setHash(h) {
  try {
    history.replaceState(null, '', h ? '#' + h : location.pathname + location.search);
  } catch (e) {}
}

// DJI Pilot 2 (Modifier les repères) : degrés entiers + minutes à 4 décimales (0,2 m)
function pilotDM(v) {
  var s = v < 0 ? '-' : '',
    a = Math.abs(v),
    d = Math.floor(a),
    m = (a - d) * 60;
  if (+m.toFixed(4) >= 60) {
    d += 1;
    m = 0;
  }
  return { d: s + d, m: m.toFixed(4) };
}

function render() {
  var r = lastParse;
  closeFix();
  if (!r || !r.ok) {
    state.current = null;
    cancelHist();
    $('resCard').classList.add('empty');
    out.innerHTML =
      r && r.empty
        ? '<div class="status"><span class="pill none">En attente de coordonnées</span></div>'
        : '<div class="status"><span class="pill check">Aucune coordonnée trouvée</span></div><p class="flush">Corrigez le texte ou recadrez sur les coordonnées.</p>';
    $('resSum').textContent = r && r.empty ? '' : 'aucune coordonnée';
    $('eqCard').hidden = true;
    $('shareCard').hidden = true;
    $('pilotCard').hidden = true;
    if (!(r && r.empty)) say('Aucune coordonnée trouvée');
    setHash('');
    updateMap();
    return;
  }
  var all = [r.best].concat(r.alts),
    c = all[Math.min(chosen, all.length - 1)];
  state.current = c;
  // confiance : calculée par auto.js après une photo, sinon d'après les avertissements du texte saisi
  if (!r.trust || chosen !== 0) r.trust = confidence({ manual: true, notes: c.notes.length, alts: r.alts.length });
  var ok = trusted(r),
    warn = c.notes.length || r.alts.length;
  var la = f6(c.lat),
    lo = f6(c.lon);
  var h =
    '<div class="status"><span class="pill ' +
    (r.verified ? 'ok">Vérifié à la main' : ok ? 'ok">Lecture fiable' : 'check">À vérifier') +
    '</span><span class="pill fmt">' +
    esc(c.fmt) +
    '</span>' +
    (r.trust && (r.ocr || !ok)
      ? '<span class="pill conf ' + (ok ? 'c-ok' : 'c-no') + '">Confiance ' + r.trust.pct + ' %</span>'
      : '') +
    (r.agree && chosen === 0 ? '<span class="pill fmt">' + r.agree.n + '/' + r.agree.total + ' lectures</span>' : '') +
    '<button class="chip fixbtn" type="button" data-fix="1">Corriger</button></div>';
  // coordonnées : un toucher les copie (seulement une fois le point sûr)
  h += ok
    ? '<button class="big1" type="button" data-copy="' +
      la +
      ', ' +
      lo +
      '">' +
      la +
      ', ' +
      lo +
      '<small>Toucher pour copier</small></button>'
    : '<div class="big1 held">' + la + ', ' + lo + '<small>Douteux : à vérifier sur la photo</small></div>';
  h += '<div class="seg1">Lu : ' + esc(c.seg) + '</div>';
  h += '<div class="place" id="place"></div>';
  var notes = c.notes.slice();
  if (r.alts.length) notes.push({ t: 'Plusieurs lectures possibles : comparez avec la photo.' });
  if (!ok && r.trust && r.trust.why.length && r.ocr)
    notes.push({ t: 'Confiance ' + r.trust.pct + ' % : ' + r.trust.why.join(', ') + '.' });
  if (notes.length)
    h +=
      '<ul class="notes">' +
      notes
        .map(function (n) {
          return '<li>' + esc(n.t) + '</li>';
        })
        .join('') +
      '</ul>';
  if (r.alts.length) {
    h += '<div class="alts">';
    all.forEach(function (a, i) {
      if (a !== c)
        h +=
          '<button type="button" data-alt="' +
          i +
          '">' +
          f6(a.lat) +
          ', ' +
          f6(a.lon) +
          ' <small>(' +
          esc(a.seg) +
          ')</small></button>';
    });
    h += '</div>';
  }
  if (!ok)
    h +=
      '<div class="hold"><p class="flush"><b>Coordonnées douteuses : rien n\u2019est transmis.</b> Comparez chiffre par chiffre avec la photo. Corrigez-les avec les molettes, ou confirmez-les si elles sont justes.</p>' +
      '<div class="row2"><button class="btn" type="button" data-fix="1">Corriger</button><button class="btn sec" type="button" data-verify="1">Justes : confirmer</button></div></div>';
  else h += '<div class="trk" id="trk"></div>';
  $('resCard').classList.remove('empty');
  out.innerHTML = h;
  if (ok) trackButton();
  $('resSum').textContent = (ok ? '' : 'à vérifier · ') + f6(c.lat).slice(0, -1) + ', ' + f6(c.lon).slice(0, -1);
  if (!ok) {
    // rien n'est proposé au partage, au drone ni aux autres cartes tant que le point n'est pas sûr
    $('pilotCard').hidden = true;
    $('eqCard').hidden = true;
    $('shareCard').hidden = true;
    showPlace();
    updateMap(true);
    cancelHist();
    say('À vérifier : ' + la + ', ' + lo);
    setHash('');
    return;
  }

  // DJI Pilot 2 : longitude d'abord, puis latitude
  var PL = pilotDM(c.lon),
    PA = pilotDM(c.lat);
  var cell = function (v, u) {
    return '<button class="pv" type="button" data-copy="' + v + '"><b>' + v + '</b><i>' + u + '</i></button>';
  };
  var line = function (n, P) {
    return (
      '<div class="prow"><div class="pl">' +
      n +
      '</div><div class="pr">' +
      cell(P.d, '°') +
      cell(P.m, "'") +
      '</div></div>'
    );
  };
  // 3e ligne : altitude du terrain au point, remplie par place.js dès qu'elle est connue
  $('pilot').innerHTML =
    line('1 · Longitude', PL) +
    line('2 · Latitude', PA) +
    '<div class="prow"><div class="pl">3 · Altitude <span class="asl">ASL</span></div><div class="pr" id="pilotAlt"></div>' +
    '<p class="hint flush">Choisir <b>ASL</b>, pas ALT : repère posé au sol (ALT part du point de décollage).</p></div>';
  $('pilotCard').hidden = false;

  // ouvrir le point dans d'autres cartes
  $('links').innerHTML =
    '<a target="_blank" rel="noopener" data-airops="' +
    la +
    ', ' +
    lo +
    '" href="https://airops-supuav.fr/map/#15/' +
    la +
    '/' +
    lo +
    '">AirOps</a>' +
    '<a target="_blank" rel="noopener" href="https://cartes.gouv.fr/explorer-les-cartes/?c=' +
    lo +
    ',' +
    la +
    '&z=16&permalink=yes">cartes.gouv.fr</a>' +
    '<a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' +
    la +
    ',' +
    lo +
    '">Google Maps</a>';
  $('linkMsg').hidden = true;

  // autres formats : chaque ligne se copie d'un toucher, le tout se partage
  $('eq').innerHTML = eqRows(c)
    .map(function (x) {
      return (
        '<button class="eqr" type="button" data-copy="' +
        esc(x[1].join(' ')) +
        '"><span class="eqk">' +
        x[0] +
        '</span><span class="eqv">' +
        x[1].map(esc).join('<br>') +
        '</span></button>'
      );
    })
    .join('');
  $('eqCard').hidden = false;
  $('shareCard').hidden = false;
  drawQR();
  showPlace();
  updateMap(true);
  // historique : pas pendant la frappe (valeurs partielles), seulement une fois le champ quitté
  if (document.activeElement !== src) scheduleHist(c, src.value);
  else cancelHist();
  say((warn ? 'Vérifié : ' : 'Lecture fiable : ') + la + ', ' + lo);
  setHash(la + ',' + lo);
}
// Bouton d'ajout au suivi, sous le point : gros, avec le nom de l'animal ; « déjà dans le suivi » si le point y est
function trackButton() {
  var c = state.current,
    el = $('trk');
  if (!c || !el) return;
  var i = indexOf(c),
    n = trackName(),
    ti = trackInfo(c);
  el.innerHTML =
    (i >= 0
      ? '<div class="btn ok wide" role="status">Point ' + (i + 1) + ' du suivi' + (n ? ' · ' + esc(n) : '') + '</div>'
      : '<button class="btn wide" type="button" data-track="1">Ajouter au suivi' +
        (n ? ' · ' + esc(n) : ' des points') +
        '</button>') + (ti && i < 0 ? '<p class="flush">' + esc(ti) + '</p>' : '');
}
function eqRows(c) {
  return [
    ['DD', [f6(c.lat) + ', ' + f6(c.lon)]],
    ['Lat', [f6(c.lat)]],
    ['Lon', [f6(c.lon)]],
    ['DMM', [toDMM(c.lat, true), toDMM(c.lon, false)]],
    ['DMS', [toDMS(c.lat, true), toDMS(c.lon, false)]],
    ['UTM', [toUTM(c.lat, c.lon)]]
  ];
}
function eqText(c) {
  var p = placeText(c);
  return (
    'Point ESAM\n' +
    eqRows(c)
      .filter(function (x) {
        return x[0] !== 'Lat' && x[0] !== 'Lon';
      })
      .map(function (x) {
        return x[0] + ' : ' + x[1].join(' ');
      })
      .join('\n') +
    (p ? '\n' + p : '')
  );
}
// verified : texte vérifié à la main (molettes validées) : transmissible même avec un avertissement
function update(verified) {
  chosen = 0;
  lastParse = parse(src.value);
  if (verified && lastParse.ok) lastParse.verified = true;
  render();
}
function show(text, p) {
  src.value = text;
  chosen = 0;
  lastParse = p;
  fromPhoto = !!(p && p.ocr);
  render();
}
function useCurrent() {
  if (state.current) {
    scheduleHist(state.current, src.value);
    flushHist();
  }
}

// ---------- Hors ligne ----------
function setNet() {
  $('net').hidden = navigator.onLine;
}
window.addEventListener('online', setNet);
window.addEventListener('offline', setNet);
setNet();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});

// ---------- Écran allumé pendant la recopie Pilot 2 ----------
// Tuile à l'écran : l'écran ne se met pas en veille, 2 minutes au plus ; toucher une valeur relance les 2 minutes.
var WAKE_MS = 120000,
  wake = { lock: null, asking: false, until: 0, timer: 0 };
function wakeGet() {
  if (wake.lock || wake.asking || document.hidden || Date.now() >= wake.until) return;
  wake.asking = true;
  navigator.wakeLock.request('screen').then(
    function (l) {
      wake.asking = false;
      wake.lock = l;
      l.addEventListener('release', function () {
        if (wake.lock === l) wake.lock = null;
      });
      if (Date.now() >= wake.until) wakeOff();
    },
    function () {
      wake.asking = false;
    }
  );
}
function wakeOn() {
  if (!('wakeLock' in navigator)) return;
  wake.until = Date.now() + WAKE_MS;
  clearTimeout(wake.timer);
  wake.timer = setTimeout(wakeOff, WAKE_MS);
  wakeGet();
}
function wakeOff() {
  clearTimeout(wake.timer);
  wake.until = 0;
  if (wake.lock) wake.lock.release().catch(function () {});
  wake.lock = null;
}
if ('IntersectionObserver' in window)
  new IntersectionObserver(
    function (es) {
      var e = es[es.length - 1];
      if (e.isIntersecting && $('pilotCard').open) wakeOn();
      else wakeOff();
    },
    { threshold: 0.4 }
  ).observe($('pilot'));
$('pilot').addEventListener('click', wakeOn);
// le navigateur rend le verrou quand l'appli passe en arrière-plan : on le reprend au retour s'il reste du temps
document.addEventListener('visibilitychange', function () {
  if (!document.hidden) wakeGet();
});

// ---------- Événements ----------
src.addEventListener('input', function () {
  update();
});
// champ quitté : le point affiché entre dans l'historique
src.addEventListener('change', useCurrent);
document.addEventListener('visibilitychange', function () {
  if (document.hidden) useCurrent();
});
$('clear').addEventListener('click', function () {
  src.value = '';
  fromPhoto = false;
  $('cropBox').hidden = true;
  clearZone();
  hideSteps();
  update();
  src.focus();
});
$('eqCopy').addEventListener('click', function () {
  if (state.current) {
    copy(eqText(state.current), $('eqCopy'));
    useCurrent();
  }
});
$('eqShare').addEventListener('click', function () {
  if (state.current) {
    useCurrent();
    shareText(eqText(state.current), $('eqShare'));
  }
});
document.addEventListener('click', function (e) {
  var a = e.target.closest('a[data-airops]');
  if (a) {
    // secours : coordonnées dans le presse-papier pour la recherche AirOps
    try {
      navigator.clipboard.writeText(a.dataset.airops).catch(function () {});
    } catch (err) {}
    $('linkMsg').hidden = false;
    $('linkMsg').textContent = 'Coordonnées copiées : si AirOps ne se centre pas, collez-les dans sa recherche.';
    useCurrent();
    return;
  }
  var t = e.target.closest('button');
  if (!t) return;
  // ligne d'autres formats : seule la valeur affiche « Copié », la ligne garde sa hauteur
  if (t.dataset.copy) {
    var v = t.querySelector('.eqv');
    if (v) v.style.minHeight = v.offsetHeight + 'px';
    copy(t.dataset.copy, v || t);
    useCurrent();
  } else if (t.dataset.fix) openFix(state.current);
  else if (t.dataset.verify) {
    // l'utilisateur a comparé avec la photo : le point devient transmissible
    if (lastParse && lastParse.ok) lastParse.verified = true;
    render();
    useCurrent();
  } else if (t.dataset.track) {
    // point lu sur une photo datée : daté de la photo
    var n = addPoint(state.current, '', fromPhoto ? photoTime() : null);
    batchChecked(photoFile(), state.current);
    trackButton();
    say('Point ' + n + ' ajouté au suivi');
  } else if (t.dataset.alt) {
    chosen = +t.dataset.alt;
    if (lastParse) lastParse.verified = false;
    render();
  } else if (t.dataset.hist) {
    var x = loadHist()[+t.dataset.hist];
    if (x) {
      src.value = x.src;
      fromPhoto = false;
      clearZone();
      update();
      openTile('resCard');
      $('resCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
});

// ---------- Démarrage ----------
initTiles();
initMap();
initShare(useCurrent);
initAuto(show);
initBatch();
initFix(function (t) {
  src.value = t;
  update(true);
});
initTrack(trackButton);
initPlace();
initCompass();
$('ver').textContent = 'v' + VERSION;
drawHist();
var h0 = decodeURIComponent((location.hash || '').slice(1));
if (/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(h0)) src.value = h0.replace(',', ', ');
// lien de suivi (partagé depuis un autre téléphone) : le suivi s'installe ici
var tr0 = decodeTrack(location.hash);
if (tr0) {
  $('trackMsg').hidden = false;
  $('trackMsg').textContent = importTrack(tr0);
  setHash('');
}
lastParse = parse(src.value);
render();
cancelHist(); // un lien ouvert n'entre pas dans l'historique tant qu'on ne s'en sert pas
startGeo();
