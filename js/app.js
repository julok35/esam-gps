/* GPS ESAM : point d'entrée. Lecture du texte, affichage du résultat, liens, événements. */
import { $, esc, f6, fmtWhen, copy, clip, state, VERSION, initTiles, openTile } from './util.js';
import { checkPoint, ddText, airopsUrl, routeUrl, geoUrl } from './go.js';
import { parse, toDMM, toDMS, toUTM } from './parser.js';
import { initMap, updateMap, startGeo } from './map.js';
import { initShare, drawQR, shareText } from './share.js';
import { loadHist, drawHist, scheduleHist, flushHist, cancelHist } from './history.js';
import { initAuto, forget } from './auto.js';
import { initFix, openFix, closeFix } from './fix.js';
import { initPlace, showPlace, placeText } from './place.js';
import { initCompass } from './compass.js';
import { confidence, trusted, carryDoubt } from './trust.js';
import {
  initTrack,
  putPoint,
  findPoint,
  resumePending,
  trackInfo,
  trackName,
  decodeTrack,
  importTrack,
  askResume
} from './track.js';
import { initBatch } from './batch.js';
import { clearZone } from './ocr.js';
import { shotPoint, fixShot, unfixShot, sendShot, flushHeld, shown, setShown, watch, SRC } from './shot.js';

const src = $('src'),
  out = $('result');
// Le point affiché vient d'une photo (sa fiche : shot.shown()) ou d'un texte saisi (aucune fiche)
let chosen = 0,
  lastParse = null,
  keepMap = false, // affichage du point sans recentrer la carte (fin d'un lot : elle montre tous ses points)
  sayTimer = null,
  goTimer = null;

// Annonce courte pour les lecteurs d'écran, une fois la saisie posée
function say(t) {
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => {
    $('announce').textContent = t;
  }, 800);
}
function setHash(h) {
  try {
    history.replaceState(null, '', h ? `#${h}` : location.pathname + location.search);
  } catch (e) {}
}

// DJI Pilot 2 (Modifier les repères) : degrés entiers + minutes à 4 décimales (0,2 m)
function pilotDM(v) {
  const s = v < 0 ? '-' : '';
  const a = Math.abs(v);
  let d = Math.floor(a);
  let m = (a - d) * 60;
  if (+m.toFixed(4) >= 60) {
    d += 1;
    m = 0;
  }
  return { d: s + d, m: m.toFixed(4) };
}

function render() {
  const r = lastParse;
  closeFix();
  if (!r || !r.ok) {
    state.current = null;
    cancelHist();
    $('resCard').classList.add('empty');
    out.innerHTML =
      r && r.empty
        ? r.why
          ? `<div class="status"><span class="pill ${r.wait ? 'none">Lecture en cours' : 'check">Aucun point'}</span></div><p class="flush">${esc(
              r.why
            )}</p>`
          : '<div class="status"><span class="pill none">En attente de coordonnées</span></div>'
        : `<div class="status"><span class="pill check">Aucune coordonnée trouvée</span></div><p class="flush">Corrigez le texte ou recadrez sur les coordonnées.</p>${goBlock(
            null,
            'Pas de coordonnées valides : AirOps et Itinéraire désactivés.'
          )}`;
    $('resSum').textContent =
      r && r.empty ? (r.why ? (r.wait ? 'lecture en cours' : 'aucun point') : '') : 'aucune coordonnée';
    $('eqCard').hidden = true;
    $('shareCard').hidden = true;
    $('pilotCard').hidden = true;
    if (!(r && r.empty)) say('Aucune coordonnée trouvée');
    else if (r.why) say(r.why);
    setHash('');
    updateMap();
    return;
  }
  const all = [r.best].concat(r.alts),
    c = all[Math.min(chosen, all.length - 1)];
  state.current = c;
  // confiance : calculée par auto.js après une photo, sinon d'après les avertissements du texte saisi
  if (!r.trust || chosen !== 0) r.trust = confidence({ manual: true, notes: c.notes.length, alts: r.alts.length });
  const ok = trusted(r),
    warn = c.notes.length || r.alts.length;
  const la = f6(c.lat),
    lo = f6(c.lon);
  let h = `<div class="status"><span class="pill ${
    r.verified ? 'ok">Vérifié à la main' : ok ? 'ok">Lecture fiable' : 'check">À vérifier'
  }</span><span class="pill fmt">${esc(c.fmt)}</span>${
    r.trust && (r.ocr || !ok) ? `<span class="pill conf ${ok ? 'c-ok' : 'c-no'}">Confiance ${r.trust.pct} %</span>` : ''
  }${
    r.agree && chosen === 0 ? `<span class="pill fmt">${r.agree.n}/${r.agree.total} lectures</span>` : ''
  }<button class="chip fixbtn" type="button" data-fix="1">Corriger</button></div>`;
  // coordonnées : un toucher les copie (seulement une fois le point sûr)
  h += ok
    ? `<button class="big1" type="button" data-copy="${la}, ${lo}">${la}, ${
        lo
      }<small>Toucher pour copier</small></button>`
    : `<div class="big1 held">${la}, ${lo}<small>Douteux : à vérifier sur la photo</small></div>`;
  h += `<div class="seg1">Lu : ${esc(c.seg)}</div>`;
  // point d'une photo : la date qu'il prendra au suivi, et d'où elle vient
  const sh = shown();
  if (sh) h += `<div class="seg1">Photo du ${esc(fmtWhen(sh.t))} (${SRC[sh.src]})</div>`;
  h += '<div class="place" id="place"></div>';
  if (ok) h += goBlock(c);
  const notes = c.notes.slice();
  if (r.alts.length) notes.push({ t: 'Plusieurs lectures possibles : comparez avec la photo.' });
  if (!ok && r.trust && r.trust.why.length && r.ocr)
    notes.push({ t: `Confiance ${r.trust.pct} % : ${r.trust.why.join(', ')}.` });
  if (notes.length) h += `<ul class="notes">${notes.map((n) => `<li>${esc(n.t)}</li>`).join('')}</ul>`;
  if (r.alts.length) {
    h += '<div class="alts">';
    all.forEach((a, i) => {
      if (a !== c)
        h += `<button type="button" data-alt="${i}">${f6(a.lat)}, ${f6(a.lon)} <small>(${esc(a.seg)})</small></button>`;
    });
    h += '</div>';
  }
  if (!ok)
    h +=
      `<div class="hold"><p class="flush"><b>Coordonnées douteuses : rien n\u2019est transmis.</b> Comparez chiffre par chiffre avec la photo. Corrigez-les avec les molettes, ou confirmez-les si elles sont justes.</p>` +
      `<div class="row2"><button class="btn" type="button" data-fix="1">Corriger</button><button class="btn sec" type="button" data-verify="1">Justes : confirmer</button></div></div>${goBlock(
        null,
        'Coordonnées à vérifier : AirOps et Itinéraire s\u2019activent une fois le point corrigé ou confirmé.'
      )}`;
  else h += '<div class="trk" id="trk"></div>';
  $('resCard').classList.remove('empty');
  out.innerHTML = h;
  if (ok) trackButton();
  $('resSum').textContent = `${(ok ? '' : 'à vérifier · ') + f6(c.lat).slice(0, -1)}, ${f6(c.lon).slice(0, -1)}`;
  if (!ok) {
    // rien n'est proposé au partage, au drone ni aux autres cartes tant que le point n'est pas sûr
    $('pilotCard').hidden = true;
    $('eqCard').hidden = true;
    $('shareCard').hidden = true;
    showPlace();
    updateMap(!keepMap);
    cancelHist();
    say(`À vérifier : ${la}, ${lo}`);
    setHash('');
    return;
  }

  // DJI Pilot 2 : longitude d'abord, puis latitude
  const PL = pilotDM(c.lon),
    PA = pilotDM(c.lat);
  const cell = function (v, u) {
    return `<button class="pv" type="button" data-copy="${v}"><b>${v}</b><i>${u}</i></button>`;
  };
  const line = function (n, P) {
    return `<div class="prow"><div class="pl">${n}</div><div class="pr">${cell(P.d, '°')}${cell(P.m, "'")}</div></div>`;
  };
  // 3e ligne : altitude du terrain au point, remplie par place.js dès qu'elle est connue
  $('pilot').innerHTML =
    `${
      line('1 · Longitude', PL) + line('2 · Latitude', PA)
    }<div class="prow"><div class="pl">3 · Altitude <span class="asl">ASL</span></div><div class="pr" id="pilotAlt"></div>` +
    `<p class="hint flush">Choisir <b>ASL</b>, pas ALT : repère posé au sol (ALT part du point de décollage).</p></div>`;
  $('pilotCard').hidden = false;

  // ouvrir le point dans d'autres cartes
  $('links').innerHTML =
    `<a target="_blank" rel="noopener" href="https://cartes.gouv.fr/explorer-les-cartes/?c=${lo},${
      la
    }&z=16&permalink=yes">cartes.gouv.fr</a>` +
    `<a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${la},${
      lo
    }">Google Maps</a>`;

  // autres formats : chaque ligne se copie d'un toucher, le tout se partage
  $('eq').innerHTML = eqRows(c)
    .map(
      (x) =>
        `<button class="eqr" type="button" data-copy="${esc(x[1].join(' '))}"><span class="eqk">${
          x[0]
        }</span><span class="eqv">${x[1].map(esc).join('<br>')}</span></button>`
    )
    .join('');
  $('eqCard').hidden = false;
  $('shareCard').hidden = false;
  drawQR();
  showPlace();
  updateMap(!keepMap);
  // historique : pas pendant la frappe (valeurs partielles), seulement une fois le champ quitté
  if (document.activeElement !== src) scheduleHist(c, src.value);
  else cancelHist();
  say(`${(warn ? 'Vérifié : ' : 'Lecture fiable : ') + la}, ${lo}`);
  setHash(`${la},${lo}`);
}
// AirOps et Itinéraire, sous le point. c : point sûr (contrôlé ici), ou null avec why : boutons désactivés
function goBlock(c, why) {
  const chk = c ? checkPoint(c.lat, c.lon) : { ok: false, msg: why };
  const help =
    '<ol class="go-help" id="goHelp" hidden>' +
    '<li>Touchez <b>AirOps</b> : les coordonnées sont copiées et la carte s\u2019ouvre centrée sur le point.</li>' +
    '<li>Dans AirOps, touchez la <b>loupe</b> (Adresse, coordonnées ou zone), <b>collez</b>, puis choisissez le résultat : un repère rouge se pose.</li>' +
    '<li>Touchez le <b>repère rouge</b> : le panneau Informations des zones donne les restrictions, le gestionnaire et son téléphone.</li>' +
    '<li class="go-note">Page d\u2019accueil AirOps à la première visite : touchez Accès à la carte dynamique, puis reprenez à l\u2019étape 2 (la recherche trouve le point même si la carte n\u2019est pas centrée).</li>' +
    '<li class="go-note"><b>Itinéraire</b> : trajet en voiture dans Google Maps depuis votre position. <b>Autre appli GPS</b> : OsmAnd, Waze, Organic Maps...</li>' +
    '</ol>';
  const qm =
    '<button class="go-q" type="button" data-gohelp="1" aria-expanded="false" aria-controls="goHelp" aria-label="Aide AirOps et Itinéraire">?</button>';
  if (!chk.ok)
    return (
      `<div class="go off"><div class="go-row">` +
      `<button class="btn big" type="button" disabled>AirOps</button>${
        qm
      }<button class="btn big" type="button" disabled>Itinéraire</button></div>` +
      `<p class="go-why flush">${esc(chk.msg)}</p>${
        chk.swap
          ? `<button class="btn sec wide" type="button" data-swap="1">Inverser : ${ddText(c.lon, c.lat)}</button>`
          : ''
      }${help}</div>`
    );
  return (
    `<div class="go"><div class="go-row">` +
    `<a class="btn big" target="_blank" rel="noopener" data-airops="${ddText(c.lat, c.lon)}" href="${airopsUrl(
      c.lat,
      c.lon
    )}">AirOps</a>${qm}<a class="btn big" target="_blank" rel="noopener" data-go="1" href="${esc(
      routeUrl(c.lat, c.lon)
    )}">Itinéraire</a></div>` +
    `<a class="go-alt" data-go="1" href="${geoUrl(c.lat, c.lon)}">Autre appli GPS</a>` +
    `<p class="go-msg flush" id="goMsg" role="status" hidden></p>` +
    `<div class="go-manual" id="goManual" hidden></div>${help}</div>`
  );
}
// Message AirOps : reste affiché 15 s une fois l'appli revenue au premier plan (AirOps s'ouvre dans un autre onglet)
function goSay(t) {
  const m = $('goMsg');
  if (!m) return;
  m.textContent = t;
  m.hidden = false;
  goArm();
}
function goArm() {
  clearTimeout(goTimer);
  if (document.hidden) return;
  goTimer = setTimeout(() => {
    const m = $('goMsg');
    if (m) m.hidden = true;
  }, 15000);
}
document.addEventListener('visibilitychange', () => {
  const m = $('goMsg');
  if (m && !m.hidden) goArm();
});
// AirOps : copie « lat, lon » pour sa recherche (le lien s'ouvre de lui-même dans un nouvel onglet)
function airopsGo(a) {
  const t = a.dataset.airops;
  clip(t).then((done) => {
    if (done) {
      $('goManual').hidden = true;
      goSay(
        'Coordonnées copiées. Dans AirOps : touchez la loupe, collez, choisissez le résultat, puis touchez le repère rouge.'
      );
      return;
    }
    // copie refusée : coordonnées en gros, copie à la main
    const g = $('goManual');
    g.innerHTML =
      `<p class="flush">Copie automatique impossible. Copiez ces coordonnées, puis collez-les dans la recherche AirOps :</p>` +
      `<div class="go-big">${esc(t)}</div><button class="btn wide" type="button" data-copy="${esc(t)}">Copier</button>`;
    g.hidden = false;
    $('goMsg').hidden = true;
  });
  useCurrent();
}

// Sous le point : sa place dans le suivi. Le point d'une photo y entre de lui-même dès qu'il est sûr ; le bouton sert
// au texte saisi, et à un point de photo retiré du suivi.
function trackButton() {
  const c = state.current,
    el = $('trk');
  if (!c || !el) return;
  // question du démarrage sans réponse : rien n'entre au suivi, le point attend
  if (resumePending()) {
    el.innerHTML =
      '<button class="btn sec wide" type="button" data-resume="1">Suivi : choisir d\u2019abord</button>' +
      '<p class="flush">Un suivi est déjà sur ce téléphone. Choisissez en haut de le continuer ou de repartir de zéro : le point y entrera ensuite.</p>';
    return;
  }
  const sh = shown(),
    i = findPoint({ lat: c.lat, lon: c.lon, t: sh ? sh.t : Date.now() }, sh && sh.key),
    n = trackName(),
    ti = trackInfo(c);
  el.innerHTML =
    (i
      ? `<div class="btn ok wide" role="status">Point ${i} du suivi${n ? ` · ${esc(n)}` : ''}</div>`
      : `<button class="btn wide" type="button" data-track="1">Ajouter au suivi${
          n ? ` · ${esc(n)}` : ' des points'
        }</button>`) + (ti && !i ? `<p class="flush">${esc(ti)}</p>` : '');
}
// Annonce de ce que le suivi a fait du point (voir track.placePoint)
function sayTrack(res) {
  if (!res) return;
  say(
    res.how === 'held'
      ? 'Point en attente : choisissez d\u2019abord de continuer le suivi en cours ou de repartir de zéro'
      : res.how === 'added'
        ? `Point ${res.n} ajouté au suivi`
        : res.how === 'moved'
          ? `Point ${res.n} du suivi corrigé`
          : `Point ${res.n} déjà au suivi`
  );
}
function eqRows(c) {
  return [
    ['DD', [`${f6(c.lat)}, ${f6(c.lon)}`]],
    ['Lat', [f6(c.lat)]],
    ['Lon', [f6(c.lon)]],
    ['DMM', [toDMM(c.lat, true), toDMM(c.lon, false)]],
    ['DMS', [toDMS(c.lat, true), toDMS(c.lon, false)]],
    ['UTM', [toUTM(c.lat, c.lon)]]
  ];
}
function eqText(c) {
  const p = placeText(c);
  return `Point ESAM\n${eqRows(c)
    .filter((x) => x[0] !== 'Lat' && x[0] !== 'Lon')
    .map((x) => `${x[0]} : ${x[1].join(' ')}`)
    .join('\n')}${p ? `\n${p}` : ''}`;
}
// verified : texte vérifié à la main (molettes validées) : transmissible même avec un avertissement
function update(verified) {
  chosen = 0;
  // texte retouché après une lecture de photo douteuse : il reste à vérifier
  lastParse = carryDoubt(lastParse, parse(src.value));
  if (verified && lastParse.ok) lastParse.verified = true;
  render();
}
/**
 * Point d'une photo dans « Point de la victime » : sa correction à la main, sinon sa lecture. Photo sans rien de lu :
 * le point est effacé (jamais celui d'une autre photo). La même fonction pour une photo seule et une photo d'un lot,
 * appelée par auto.openShot. o.keepMap : la carte ne se recentre pas.
 */
function showShot(shot, o) {
  const x = shotPoint(shot);
  if (!x) {
    // la raison est le texte de l'état de la photo, le même que dans la liste d'un lot
    clearPoint(
      shot.st === 'wait' ? 'Photo pas encore lue.' : `${shot.msg.charAt(0).toUpperCase()}${shot.msg.slice(1)}.`,
      shot
    );
    return;
  }
  src.value = x.text;
  chosen = x.chosen || 0;
  lastParse = x.p;
  setShown(shot);
  keepMap = !!(o && o.keepMap);
  render();
  keepMap = false;
}
// Plus de point affiché : rien à copier, à partager ni à envoyer au drone. why : la raison, affichée ;
// shot : la photo dont c'est la lecture ; wait : lecture en cours
function clearPoint(why, shot, wait) {
  src.value = '';
  chosen = 0;
  lastParse = { ok: false, empty: true, why: why || '', wait: !!wait };
  setShown(shot || null);
  render();
}
// Texte saisi ou repris (frappe, historique, inversion) : le point n'est plus celui d'une photo
function typed() {
  setShown(null);
  update();
}
// Le point affiché entre dans l'historique dès qu'on s'en sert : jamais un point douteux, qui en ressortirait
// comme un texte saisi, sans son doute
function useCurrent() {
  if (state.current && trusted(lastParse)) {
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
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// ---------- Écran allumé pendant la recopie Pilot 2 ----------
// Tuile à l'écran : l'écran ne se met pas en veille, 2 minutes au plus ; toucher une valeur relance les 2 minutes.
const WAKE_MS = 120000,
  wake = { lock: null, asking: false, until: 0, timer: 0 };
function wakeGet() {
  if (wake.lock || wake.asking || document.hidden || Date.now() >= wake.until) return;
  wake.asking = true;
  navigator.wakeLock.request('screen').then(
    (l) => {
      wake.asking = false;
      wake.lock = l;
      l.addEventListener('release', () => {
        if (wake.lock === l) wake.lock = null;
      });
      if (Date.now() >= wake.until) wakeOff();
    },
    () => {
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
  if (wake.lock) wake.lock.release().catch(() => {});
  wake.lock = null;
}
if ('IntersectionObserver' in window)
  new IntersectionObserver(
    (es) => {
      const e = es[es.length - 1];
      if (e.isIntersecting && $('pilotCard').open) wakeOn();
      else wakeOff();
    },
    { threshold: 0.4 }
  ).observe($('pilot'));
$('pilot').addEventListener('click', wakeOn);
// le navigateur rend le verrou quand l'appli passe en arrière-plan : on le reprend au retour s'il reste du temps
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) wakeGet();
});

// ---------- Événements ----------
src.addEventListener('input', typed);
// champ quitté : le point affiché entre dans l'historique
src.addEventListener('change', useCurrent);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) useCurrent();
});
$('clear').addEventListener('click', () => {
  src.value = '';
  forget();
  typed();
  src.focus();
});
$('eqCopy').addEventListener('click', () => {
  if (state.current) {
    copy(eqText(state.current), $('eqCopy'));
    useCurrent();
  }
});
$('eqShare').addEventListener('click', () => {
  if (state.current) {
    useCurrent();
    shareText(eqText(state.current), $('eqShare'));
  }
});
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-airops]');
  if (a) {
    airopsGo(a);
    return;
  }
  if (e.target.closest('a[data-go]')) {
    useCurrent();
    return;
  }
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.gohelp) {
    const hb = $('goHelp');
    hb.hidden = !hb.hidden;
    t.setAttribute('aria-expanded', String(!hb.hidden));
    return;
  }
  if (t.dataset.swap && state.current) {
    // inversion proposée et choisie : la latitude passe en premier
    src.value = ddText(state.current.lon, state.current.lat);
    typed();
    return;
  }
  // ligne d'autres formats : seule la valeur affiche « Copié », la ligne garde sa hauteur
  if (t.dataset.copy) {
    const v = t.querySelector('.eqv');
    if (v) v.style.minHeight = `${v.offsetHeight}px`;
    copy(t.dataset.copy, v || t);
    useCurrent();
  } else if (t.dataset.fix) openFix(state.current);
  else if (t.dataset.verify) {
    // l'utilisateur a comparé avec la photo : le point devient transmissible, et celui d'une photo va au suivi
    const sh = shown();
    let res = null;
    if (lastParse && lastParse.ok) {
      lastParse.verified = true;
      if (sh) {
        fixShot(sh, src.value, lastParse, chosen, 'confirmée à la main');
        res = sendShot(sh);
      }
    }
    render();
    useCurrent();
    sayTrack(res);
  } else if (t.dataset.resume) {
    // la question du suivi en cours est en haut de l'écran
    $('dogCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('resumeGo').focus({ preventScroll: true });
  } else if (t.dataset.track) {
    // point d'une photo : par sa fiche (corrigé sur place s'il y est déjà) ; texte saisi : daté de maintenant
    const sh = shown(),
      c = state.current,
      res = sh ? sendShot(sh, true) : c && putPoint({ lat: c.lat, lon: c.lon, t: Date.now() }, true);
    trackButton();
    sayTrack(res);
  } else if (t.dataset.alt) {
    chosen = +t.dataset.alt;
    if (lastParse) lastParse.verified = false;
    // photo confirmée puis autre lecture choisie : elle redevient à vérifier
    if (shown() && shown().fix) unfixShot(shown());
    render();
  } else if (t.dataset.hist) {
    const x = loadHist()[+t.dataset.hist];
    if (x) {
      src.value = x.src;
      lastParse = null; // point repris de l'historique : sans lien avec la lecture affichée avant
      clearZone();
      typed();
      openTile('resCard');
      $('resCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
});

// ---------- Démarrage ----------
initTiles();
initMap();
initShare(useCurrent);
initAuto(showShot, clearPoint);
initBatch();
// molettes validées : la photo affichée garde ce point, dans le format lu, et il va au suivi ; texte saisi : corrigé
initFix((t) => {
  const sh = shown(),
    p = parse(t);
  if (sh && p.ok) {
    fixShot(sh, t, p, 0, 'corrigée à la main');
    const res = sendShot(sh);
    showShot(sh);
    sayTrack(res);
    return;
  }
  src.value = t;
  update(true);
});
// fiche modifiée (point versé au suivi, autre photo affichée) : l'état sous le point suit
watch(trackButton);
// suivi modifié par sa tuile, ou question du démarrage répondue : les points lus en attendant y entrent
initTrack(() => {
  const n = flushHeld();
  trackButton();
  if (n) say(`${n} point${n > 1 ? 's' : ''} versé${n > 1 ? 's' : ''} au suivi`);
});
initPlace();
initCompass();
$('ver').textContent = `v${VERSION}`;
drawHist();
let h0 = (location.hash || '').slice(1);
try {
  h0 = decodeURIComponent(h0);
} catch (e) {} // lien mal encodé (« %E0 ») : pris tel quel, l'appli démarre quand même
if (/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(h0)) src.value = h0.replace(',', ', ');
// lien de suivi (partagé depuis un autre téléphone) : le suivi s'installe ici
const tr0 = decodeTrack(location.hash);
if (tr0) {
  $('trackMsg').hidden = false;
  $('trackMsg').textContent = importTrack(tr0);
  setHash('');
} else askResume(); // suivi déjà enregistré sur ce téléphone : le continuer ou repartir de zéro
lastParse = parse(src.value);
render();
cancelHist(); // un lien ouvert n'entre pas dans l'historique tant qu'on ne s'en sert pas
startGeo();
