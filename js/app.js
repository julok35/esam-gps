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
  askResume,
  dropPoint
} from './track.js';
import { initBatch } from './batch.js';
import { clearZone, readZone } from './ocr.js';
import { shotPoint, fixShot, unfixShot, sendShot, flushHeld, shown, setShown, watch, touch, SRC } from './shot.js';

const src = $('src'),
  out = $('result');
// Le point affiché vient d'une photo (sa fiche : shot.shown()) ou d'un texte saisi (aucune fiche)
let chosen = 0,
  lastParse = null,
  keepMap = false, // affichage du point sans recentrer la carte (fin d'un lot : elle montre tous ses points)
  sayTimer = null,
  goTimer = null,
  typing = false, // texte en cours de frappe : pas d'état d'erreur avant une courte pause (TYPE_MS)
  typeTimer = null;
const TYPE_MS = 1200;

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
// Tuile DJI Pilot 2 : dans l'ordre de l'écran « Modifier les repères », longitude puis latitude (degrés, minutes),
// puis altitude ASL (remplie par place.js). Chaque valeur porte un nom complet pour les lecteurs d'écran.
function drawPilot(c) {
  const cell = function (k, unit, v, u, cls) {
    return `<button class="pv" type="button" data-copy="${v}" aria-label="${k}, ${unit} : ${v}"><b>${v}</b><i class="${cls}" aria-hidden="true">${u}</i></button>`;
  };
  const line = function (n, id, k, P) {
    return `<div class="prow" role="group" aria-labelledby="${id}"><div class="pl" id="${id}">${n} · ${k}</div><div class="pr">${cell(
      k,
      'degrés',
      P.d,
      '°',
      'deg'
    )}${cell(k, 'minutes', P.m, "'", 'min')}</div></div>`;
  };
  $('pilot').innerHTML =
    `<p class="pctx flush" id="pilotCtx"></p>${line(1, 'plLon', 'Longitude', pilotDM(c.lon))}${line(
      2,
      'plLat',
      'Latitude',
      pilotDM(c.lat)
    )}` +
    `<div class="prow" role="group" aria-labelledby="plAlt"><div class="pl" id="plAlt">3 · Altitude <span class="asl">ASL</span></div><div class="pr" id="pilotAlt"></div>` +
    `<p class="hint flush">Choisir <b>ASL</b>, pas ALT : repère posé au sol (ALT part du point de décollage).</p></div>`;
  pilotCtx();
}
// Rappel en tête de la tuile Pilot 2 : l'animal et l'heure du point, pour ne pas saisir le repère d'un autre
function pilotCtx() {
  const el = $('pilotCtx');
  if (!el || !state.current) return;
  const n = trackName(),
    sh = shown();
  el.innerHTML = `<b>${n ? esc(n) : 'Animal non nommé'}</b> · ${
    sh ? `photo du ${esc(fmtWhen(sh.t))}` : `point saisi le ${esc(fmtWhen(Date.now()))}`
  }`;
}

// État de la tuile « Point de la victime », lisible sur la tuile elle-même (bordure, en-tête) :
// vide, sûr (lecture fiable), douteux (rien n'est transmis), vérifié (corrigé ou confirmé à la main)
function cardState(s) {
  $('resCard').dataset.state = s;
  $('resCard').classList.toggle('empty', s === 'empty');
}
// Lecture dans le format de la source (celui de l'écran GPS ou du texte reçu), ligne à ligne, pour la comparer
// chiffre par chiffre : [libellé, valeur]
function srcLines(c) {
  const f = c.fmt || '';
  if (/UTM/.test(f)) {
    const u = toUTM(c.lat, c.lon).split(' ');
    return [
      ['Zone', u[0]],
      ['Est', u[1]],
      ['Nord', u[2]]
    ];
  }
  if (/DMS/.test(f))
    return [
      ['Latitude', toDMS(c.lat, true)],
      ['Longitude', toDMS(c.lon, false)]
    ];
  if (/DMM|NMEA/.test(f))
    return [
      ['Latitude', toDMM(c.lat, true)],
      ['Longitude', toDMM(c.lon, false)]
    ];
  // degrés décimaux : sans zéros ajoutés (45.1033 et non 45.103300), comme dans la source
  return [
    ['Latitude', String(+c.lat.toFixed(6))],
    ['Longitude', String(+c.lon.toFixed(6))]
  ];
}
// Ce qui ferme AirOps et Itinéraire même une fois le point vérifié (null : rien ne s'y oppose)
function goStop(chk) {
  if (chk.ok) return null;
  return chk.swap
    ? 'Latitude et longitude semblent inversées : AirOps et Itinéraire restent fermés tant qu’elles ne sont pas remises dans l’ordre.'
    : 'Point hors de France métropolitaine : AirOps et Itinéraire restent fermés, même une fois le point confirmé.';
}

// Ce que la lecture r (point c) a d'inhabituel : avertissements du texte, autres lectures, confiance d'une photo.
// Le point hors de France ou inversé est dit une seule fois, avec ce qu'il ferme (goStop).
function warnings(r, c) {
  const stop = goStop(checkPoint(c.lat, c.lon)),
    l = c.notes.filter((n) => !(stop && /hors de France/.test(n.t))).map((n) => n.t);
  if (stop) l.push(stop);
  if (r.alts.length) l.push(`Plusieurs lectures possibles : comparez avec ${r.ocr ? 'la photo' : 'votre source'}.`);
  if (r.ocr && r.trust && r.trust.why.length && r.trust.level !== 'ok')
    l.push(`Confiance ${r.trust.pct} % : ${r.trust.why.join(', ')}.`);
  return l;
}

function render() {
  const r = lastParse;
  closeFix();
  if (!r || !r.ok) {
    state.current = null;
    cancelHist();
    // texte en cours de frappe : pas d'erreur tant que la saisie n'est pas posée (voir typed)
    const wait = !!r && !r.empty && typing;
    cardState('empty');
    out.innerHTML =
      r && r.empty
        ? r.why
          ? `<div class="status"><span class="pill ${r.wait ? 'none">Lecture en cours' : 'check">Aucun point'}</span></div><p class="flush">${esc(
              r.why
            )}</p>`
          : '<div class="status"><span class="pill none">En attente de coordonnées</span></div>'
        : wait
          ? '<div class="status"><span class="pill none">Saisie en cours</span></div>'
          : '<div class="status"><span class="pill check">Aucune coordonnée trouvée</span></div>' +
            '<p class="flush">Le texte doit contenir une latitude puis une longitude, par exemple <b>45.1033, 5.9139</b> ou <b>N\u00a045°06.199’ E\u00a0005°54.834’</b>.</p>';
    $('resSum').textContent =
      r && r.empty ? (r.why ? (r.wait ? 'lecture en cours' : 'aucun point') : '') : wait ? '' : 'aucune coordonnée';
    $('eqCard').hidden = true;
    $('shareCard').hidden = true;
    $('pilotCard').hidden = true;
    if (!(r && r.empty)) {
      if (!wait) say('Aucune coordonnée trouvée');
    } else if (r.why) say(r.why);
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
    warn = c.notes.length || r.alts.length,
    chk = checkPoint(c.lat, c.lon),
    stop = goStop(chk),
    st = r.verified ? 'verified' : ok ? 'ok' : 'check';
  const la = f6(c.lat),
    lo = f6(c.lon),
    sh = shown(),
    // la source à laquelle comparer : la photo (sa zone lue), ou le texte reçu
    photo = !!r.ocr,
    zone = photo ? readZone() : null;
  const notes = warnings(r, c);
  const alts = r.alts.length
    ? `<div class="alts">${all
        .map((a, i) =>
          a === c
            ? ''
            : `<button type="button" data-alt="${i}">${f6(a.lat)}, ${f6(a.lon)} <small>(${esc(a.seg)})</small></button>`
        )
        .join('')}</div>`
    : '';
  // une ligne d'état ; « Corriger » une seule fois dans la tuile (dans le bloc de retenue quand le point est douteux)
  const meta = [];
  if (st === 'ok' && r.ocr && r.trust) meta.push(`Confiance ${r.trust.pct} %`);
  if (st === 'ok' && r.agree && chosen === 0) meta.push(`${r.agree.n}/${r.agree.total} lectures`);
  let h = `<div class="status"><span class="pill ${
    st === 'verified' ? 'ok">Vérifié à la main' : st === 'ok' ? 'ok">Lecture fiable' : 'check">À vérifier'
  }</span><span class="pill fmt">${esc(c.fmt)}</span>${
    meta.length ? `<span class="pill meta">${meta.join(' · ')}</span>` : ''
  }${ok ? '<button class="chip fixbtn" type="button" data-fix="1">Corriger</button>' : ''}</div>`;
  if (ok) {
    // coordonnées : un toucher les copie
    h +=
      `<button class="big1" type="button" data-copy="${la}, ${lo}" aria-label="Copier ${la}, ${lo}">${la}, ${lo}` +
      `<small aria-hidden="true">Toucher pour copier</small></button><div class="seg1">Lu : ${esc(c.seg)}</div>`;
    if (sh) h += `<div class="seg1">Photo du ${esc(fmtWhen(sh.t))} (${SRC[sh.src]})</div>`;
    if (r.verified) {
      // vérifié à la main : l'alerte d'origine reste rappelée, sans alarme, et la vérification peut être annulée.
      // Photo corrigée aux molettes : l'alerte est celle de sa lecture d'origine.
      const o = sh && sh.fix && r.byHand === 'fix' && sh.r && sh.r.res && sh.r.res.p,
        was = o && o.ok ? warnings(o, o.best) : notes;
      h += `<div class="vfy"><p class="flush"><b>${r.byHand === 'fix' ? 'Corrigé' : 'Confirmé'} à la main.</b>${
        was.length ? ` Signalé à la lecture : ${was.map(esc).join(' ')}` : ''
      }</p>${alts}${
        undoable(r) ? '<button class="vfy-undo" type="button" data-unverify="1">Annuler la vérification</button>' : ''
      }</div>`;
    }
    h += `<div class="place" id="place"></div>${goBlock(c, chk)}<div class="trk" id="trk"></div>`;
  } else {
    // douteux : un seul message, dans l'ordre ce qui cloche, ce qui est bloqué, la preuve à comparer, quoi faire
    h +=
      `<section class="hold" aria-labelledby="holdT"><h3 class="hold-t" id="holdT" tabindex="-1">${photo ? 'Lecture douteuse' : 'Coordonnées douteuses'} : vérifiez avant tout envoi</h3>${
        notes.length ? `<ul class="notes">${notes.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''
      }<p class="flush hold-b" id="holdB">Rien n’est transmis (copie, ${
        stop ? '' : 'AirOps, itinéraire, '
      }drone, partage, suivi) tant que le point n’est pas corrigé ou confirmé.</p>` +
      `<div class="cmp-src">${
        zone
          ? '<span class="lbl flush">Sur la photo (zone lue)</span><canvas class="hold-zone" id="holdZone" role="img" aria-label="Zone lue sur la photo"></canvas>'
          : ''
      }<span class="lbl flush">${photo ? 'Lu par l’appli' : 'Compris par l’appli'}</span><div class="big1 held">${srcLines(
        c
      )
        .map((x) => `<span class="sl"><i>${x[0]}</i>${esc(x[1])}</span>`)
        .join('')}<small>Soit ${la}, ${lo} en degrés décimaux</small></div></div>` +
      `<p class="flush">Comparez chiffre par chiffre avec ${
        photo ? 'la photo' : 'votre source (SMS, message, écran)'
      }. Corrigez avec les molettes, ou confirmez si tout est identique.</p>${alts}` +
      // latitude et longitude inversées : remettre dans l'ordre est l'action principale
      `${
        chk.swap
          ? `<button class="btn wide" type="button" data-swap="1">Inverser : ${ddText(c.lon, c.lat)}</button>`
          : ''
      }<div class="row2"><button class="btn${
        chk.swap ? ' sec' : ''
      }" type="button" data-fix="1">Corriger</button><button class="btn sec" type="button" data-verify="1">Identique : confirmer</button></div></section>`;
    if (sh) h += `<div class="seg1">Photo du ${esc(fmtWhen(sh.t))} (${SRC[sh.src]})</div>`;
    h += `<div class="place" id="place"></div>${goBlock(c, chk, 'holdB')}`;
  }
  cardState(st);
  out.innerHTML = h;
  const zc = $('holdZone');
  if (zc) {
    zc.width = zone.width;
    zc.height = zone.height;
    zc.getContext('2d').drawImage(zone, 0, 0);
  }
  if (ok) trackButton();
  $('resSum').textContent = `${st === 'verified' ? 'vérifié · ' : st === 'check' ? 'à vérifier · ' : ''}${f6(
    c.lat
  ).slice(0, -1)}, ${f6(c.lon).slice(0, -1)}`;
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

  drawPilot(c);
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
// AirOps et Itinéraire, sous le point (rien sans point). c : point affiché, chk : son contrôle (go.checkPoint).
// held : id du texte qui dit pourquoi le point est retenu (douteux) ; les boutons sont alors grisés sans autre phrase,
// la raison n'est dite qu'une fois. Point sûr mais hors de France ou inversé : grisés, avec la raison.
function goBlock(c, chk, held) {
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
  if (held || !chk.ok) {
    const off = `type="button" disabled${held ? ` aria-describedby="${held}"` : ''}`;
    return (
      `<div class="go off"><div class="go-row">` +
      `<button class="btn big" ${off}>AirOps</button>${qm}<button class="btn big sec" ${off}>Itinéraire</button></div>${
        held
          ? ''
          : `<p class="go-why flush">${esc(chk.msg)}</p>${
              chk.swap
                ? `<button class="btn sec wide" type="button" data-swap="1">Inverser : ${ddText(c.lon, c.lat)}</button>`
                : ''
            }`
      }${help}</div>`
    );
  }
  return (
    `<div class="go"><div class="go-row">` +
    `<a class="btn big" target="_blank" rel="noopener" data-airops="${ddText(c.lat, c.lon)}" href="${airopsUrl(
      c.lat,
      c.lon
    )}">AirOps</a>${qm}<a class="btn big sec" target="_blank" rel="noopener" data-go="1" href="${esc(
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
      : `<button class="btn sec wide" type="button" data-track="1">Ajouter au suivi${
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
  if (verified && lastParse.ok) {
    lastParse.verified = true;
    lastParse.byHand = 'fix';
  }
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
// Texte saisi ou repris (frappe, historique, inversion) : le point n'est plus celui d'une photo.
// keyed : frappe au clavier ; « Aucune coordonnée trouvée » n'apparaît qu'après une courte pause (ou le champ quitté)
function typed(keyed) {
  clearTimeout(typeTimer);
  typing = !!keyed;
  if (typing) typeTimer = setTimeout(settle, TYPE_MS);
  setShown(null);
  update();
}
// Saisie posée : un texte sans coordonnées s'affiche alors comme tel
function settle() {
  clearTimeout(typeTimer);
  if (!typing) return;
  typing = false;
  if (lastParse && !lastParse.ok && !lastParse.empty) render();
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
// frappe : courte pause avant un état d'erreur ; texte collé ou déposé : résultat tout de suite
src.addEventListener('input', (e) => {
  typed(!/^insertFrom(Paste|Drop)/.test(e.inputType || ''));
});
// champ quitté : la saisie est posée, le point affiché entre dans l'historique
src.addEventListener('change', () => {
  settle();
  useCurrent();
});
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
  // valeur copiée : « Copié » s'affiche sur le bord du bouton, la valeur reste lisible (voir util.flash)
  if (t.dataset.copy) {
    copy(t.dataset.copy, t);
    useCurrent();
  } else if (t.dataset.fix) openFix(state.current);
  else if (t.dataset.verify) {
    // l'utilisateur a comparé avec sa source : le point devient transmissible, et celui d'une photo va au suivi.
    // Une copie de la lecture est marquée vérifiée : la lecture d'origine reste douteuse, pour pouvoir y revenir.
    const sh = shown();
    let res = null;
    if (lastParse && lastParse.ok) {
      lastParse = { ...lastParse, verified: true, byHand: 'confirm' };
      if (sh) {
        fixShot(sh, src.value, lastParse, chosen, 'confirmée à la main');
        res = sendShot(sh);
      }
    }
    render();
    useCurrent();
    sayTrack(res);
    const b = out.querySelector('.big1[data-copy]');
    if (b) b.focus({ preventScroll: true });
  } else if (t.dataset.unverify) unverify();
  else if (t.dataset.resume) {
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

// Vérification annulée (« Annuler la vérification ») : la lecture d'origine, douteuse, revient, et le point sort du
// suivi s'il y était entré : rien de douteux n'y reste
function unverify() {
  const sh = shown(),
    c = state.current;
  if (!c || !lastParse || !lastParse.verified) return;
  const n = findPoint({ lat: c.lat, lon: c.lon, t: sh ? sh.t : Date.now() }, sh && sh.key);
  if (n) dropPoint(n);
  if (sh && sh.fix) {
    unfixShot(sh);
    sh.msg = 'vérification annulée : à vérifier';
    touch(sh);
    showShot(sh);
  } else {
    lastParse.verified = false;
    delete lastParse.byHand;
    render();
  }
  say(n ? `Vérification annulée : point ${n} retiré du suivi` : 'Vérification annulée : point à vérifier');
  const h = $('holdT');
  if (h) h.focus({ preventScroll: true });
}
// Vérification annulable : seulement quand la lecture d'origine est douteuse (une lecture fiable corrigée à la main
// se corrige à nouveau)
function undoable(r) {
  const sh = shown();
  if (sh && sh.fix) {
    const o = sh.r && sh.r.res && sh.r.res.p;
    return !!o && o.ok && !trusted({ ...o, verified: false });
  }
  return !trusted({ ...r, verified: false });
}

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
    p.byHand = 'fix';
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
// nom de l'animal changé : la tuile Pilot 2 le rappelle
if ($('trackName')) $('trackName').addEventListener('input', pilotCtx);
// suivi modifié par sa tuile, ou question du démarrage répondue : les points lus en attendant y entrent
initTrack(() => {
  const n = flushHeld();
  trackButton();
  pilotCtx();
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
