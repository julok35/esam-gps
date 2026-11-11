/* Lot de photos : la liste (ordre des dates de prise de vue, réordonnable au doigt, retrait) et une boucle de lecture.
   Chaque photo a sa fiche (shot.js) et passe par les fonctions d'une photo seule : readShot pour la lire, sendShot
   pour le suivi, auto.openShot pour l'afficher telle que lue. Ni affichage du point ni règle de suivi ici. */
import { $, esc, f6, fmtWhen, openTile } from './util.js';
import * as ocr from './ocr.js';
import { setFilesHandler, runShot, openShot, noPoint } from './auto.js';
import { newShot, readShot, sendShot, pointOf, shown, watch, busyWith, setBusy } from './shot.js';
import { putPoint, findPoint } from './track.js';
import { focusPoints } from './map.js';

const THUMB = 96; // vignette de la liste (pixels)
// origine de la date, en un mot dans la liste
const TAG = { exif: 'photo', file: 'fichier', now: 'lecture', moved: 'date déplacée' };
let photos = [], // fiches du lot, dans l'ordre des dates
  stopped = false; // arrêt demandé pendant la lecture

function thumbOf(file) {
  return ocr.loadCanvas(file, THUMB).then(
    (c) => c.toDataURL('image/jpeg', 0.7),
    () => ''
  );
}
// Photo prise ou photos choisies. Une seule : lue tout de suite, comme une photo seule, et inscrite au lot s'il y
// en a un. Plusieurs : ajoutées au lot, à leur date, en attente de « Lire tout ». Pendant la lecture d'un lot, toute
// photo ajoutée entre dans la file : une seule lecture à la fois.
function take(files) {
  Promise.all(files.map(newShot)).then((shots) => {
    const one = shots.length === 1 && busyWith() !== 'lot';
    if (!one || photos.length) {
      photos = photos.concat(shots).sort((a, b) => a.t - b.t || a.id - b.id);
      paint();
      shots.forEach((sh) => {
        thumbOf(sh.file).then((t) => {
          sh.thumb = t;
          paint();
        });
      });
    }
    if (one) runShot(shots[0]);
    else {
      openTile('batchList');
      $('batchCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}
function paint() {
  const card = $('batchCard'),
    busy = busyWith() === 'lot',
    off = busy ? ' disabled' : '';
  card.hidden = !photos.length;
  if (!photos.length) {
    $('batchList').innerHTML = '';
    $('batchSum').textContent = '';
    return;
  }
  const ok = photos.filter((p) => p.st === 'ok').length;
  $('batchSum').textContent =
    `${photos.length} photo${photos.length > 1 ? 's' : ''}${ok ? ` · ${ok} lue${ok > 1 ? 's' : ''}` : ''}`;
  $('batchList').innerHTML = photos
    .map((p, i) => {
      const st = p.st,
        c = pointOf(p),
        read = st !== 'wait' && st !== 'run',
        line =
          (st === 'ok' || st === 'check') && c
            ? `${f6(c.lat)}, ${f6(c.lon)} · ${p.msg}`
            : st === 'wait'
              ? 'en attente'
              : p.msg || 'lecture…';
      // photo lue : un toucher l'ouvre telle que lue, son point dans « Point de la victime » (copie, Pilot 2, AirOps)
      const on = shown() === p,
        pick = read
          ? ` role="button" tabindex="0" data-show="${i}" aria-label="Ouvrir la photo ${i + 1}"${
              on ? ' aria-current="true"' : ''
            }`
          : '',
        chk = st === 'check' || st === 'none' || st === 'fail' || st === 'bad';
      return (
        `<li class="bp st-${st}${on ? ' on' : ''}" data-i="${i}">` +
        `<span class="bh" data-h="${i}" aria-label="Glisser pour déplacer la photo ${i + 1}">⋮⋮</span>${
          p.thumb ? `<img class="bt" alt="" src="${p.thumb}">` : '<span class="bt"></span>'
        }<div class="bb"${pick}><div class="bn"><b>${i + 1}</b> ${esc(fmtWhen(p.t))} <small>${TAG[p.src]}${
          on ? ' · affiché' : ''
        }</small></div>` +
        `<div class="bm">${esc(line)}</div></div>` +
        `<div class="ba${chk ? ' v' : ''}">${
          chk ? `<button class="chip" type="button" data-chk="${i}"${off}>Vérifier</button>` : ''
        }<button class="bx" type="button" data-up="${i}" aria-label="Monter"${i && !busy ? '' : ' disabled'}>▲</button>` +
        `<button class="bx" type="button" data-dn="${i}" aria-label="Descendre"${
          i < photos.length - 1 && !busy ? '' : ' disabled'
        }>▼</button><button class="bx" type="button" data-del="${i}" aria-label="Retirer"${off}>✕</button></div></li>`
      );
    })
    .join('');
  // pendant la lecture du lot, le bouton l'arrête ; pendant celle d'une photo seule, il attend
  $('batchGo').textContent = busy ? 'Arrêter' : 'Lire tout';
  $('batchGo').disabled = busyWith() === 'one' || (busy && stopped);
  $('batchClear').disabled = busy;
}
// Photo déplacée : si sa date d'origine (t0) convient à sa nouvelle place, elle la reprend ; sinon elle prend une
// date entre ses nouvelles voisines (une minute avant ou après au bord), signalée « date déplacée »
function moveTo(from, to) {
  if (from === to || to < 0 || to >= photos.length) return;
  const p = photos.splice(from, 1)[0];
  photos.splice(to, 0, p);
  const a = photos[to - 1],
    b = photos[to + 1];
  if ((!a || a.t <= p.t0) && (!b || p.t0 <= b.t)) {
    p.t = p.t0;
    p.src = p.src0;
  } else {
    if (a && b) p.t = a.t < b.t ? (a.t + b.t) / 2 : a.t + 60000;
    else if (a) p.t = a.t + 60000;
    else if (b) p.t = b.t - 60000;
    p.src = 'moved';
  }
  // son point déjà au suivi prend la même date : la liste et le suivi disent la même chose
  const c = p.st === 'ok' && pointOf(p);
  if (c && findPoint(null, p.key)) putPoint({ lat: c.lat, lon: c.lon, t: p.t, key: p.key }, false, true);
  paint();
}
function say(t) {
  $('batchMsg').hidden = !t;
  $('batchMsg').textContent = t || '';
}
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
// Photos à lire : en attente, ou lecture impossible la fois d'avant (moteur). Une photo sans coordonnées n'est pas relue
const toRead = (p) => p.st === 'wait' || p.st === 'fail';

// ---------- Lecture : une boucle sur les photos à lire, réparties entre les moteurs ----------
function runAll() {
  if (busyWith()) return;
  const first = photos.filter(toRead).length;
  if (!first) return;
  stopped = false;
  setBusy('lot');
  // réglages de contraste par défaut, comme à l'ouverture d'une photo seule
  ocr.setEnh({ contrast: 1, sharp: null });
  // le point affiché avant n'est celui d'aucune photo en cours de lecture : effacé
  noPoint('Lecture du lot en cours…', true);
  const head = `Lecture de ${plural(first, 'photo', 'photos')}…`;
  say(head);
  // moteur chargé au premier usage : son avancement s'affiche, comme sur les étapes d'une photo seule
  ocr.setProgress((t, f) => {
    if (busyWith() === 'lot' && !stopped && /moteur|langue|Initialisation/.test(t))
      say(`${head} ${t}${f ? ` ${Math.round(f * 100)} %` : ''}`);
  });
  const sent = [],
    seen = new Set(),
    // prochaine photo à lire : la file suit la liste, photos ajoutées pendant la lecture comprises
    runner = function (wi) {
      const shot = stopped ? null : photos.find((p) => toRead(p) && !seen.has(p));
      if (!shot) return Promise.resolve();
      seen.add(shot);
      return readShot(shot, { wi, stale: () => stopped }).then(() => {
        const res = sendShot(shot);
        if (res) sent.push(res);
        return runner(wi);
      });
    },
    runners = [];
  for (let i = 0; i < Math.min(ocr.workerCount(), first); i++) runners.push(runner(i));
  Promise.all(runners).then(() => {
    done(sent);
  });
}
// Arrêt demandé : les lectures en cours s'interrompent à leur prochaine étape, leurs photos restent à lire
function stop() {
  stopped = true;
  say('Arrêt de la lecture…');
  paint();
}
// Fin de lecture : bilan, et le point sûr le plus récent (dernier du lot) ouvert comme une photo seule
function done(sent) {
  setBusy('');
  const sure = photos.filter((p) => p.st === 'ok'),
    todo = photos.filter((p) => p.st === 'check' || p.st === 'none' || p.st === 'bad').length,
    left = photos.filter(toRead).length,
    added = sent.filter((r) => r.how === 'added').length,
    held = sent.filter((r) => r.how === 'held').length,
    last = sure[sure.length - 1];
  say(
    `${
      (stopped
        ? `Lecture arrêtée : ${plural(left, 'photo reste', 'photos restent')} à lire · `
        : left
          ? `${plural(left, 'photo', 'photos')} à relire (lecture impossible : touchez « Lire tout ») · `
          : '') +
      (held
        ? `${plural(held, 'point sûr', 'points sûrs')} en attente : ils entreront au suivi quand vous aurez choisi, en haut, de continuer le suivi en cours ou de repartir de zéro`
        : sent.length
          ? `${plural(added, 'point ajouté', 'points ajoutés')} au suivi${
              added < sent.length ? ` (${sent.length - added} déjà au suivi)` : ''
            }`
          : 'Aucun point sûr dans cette lecture') +
      (todo
        ? ` · ${plural(todo, 'photo', 'photos')} à vérifier (un toucher ouvre la photo, pour la reprendre à la main)`
        : '') +
      (last
        ? ` · Point de la victime : photo ${photos.indexOf(last) + 1}, la plus récente (touchez une autre photo pour l’afficher)`
        : '')
    }.`
  );
  paint();
  if (!last) {
    noPoint('Aucun point sûr dans ce lot : vérifiez les photos.');
    return;
  }
  openShot(last, { scroll: true, keepMap: true }).then(() => {
    // carte centrée sur les points lus (plusieurs), ou sur le point lu et moi (un seul)
    focusPoints(sure.map((p) => pointOf(p)));
  });
}

// ---------- Glisser pour réordonner ----------
function initDrag() {
  const list = $('batchList');
  let g = null;
  list.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.bh');
    if (!h || busyWith()) return;
    const li = h.closest('li');
    g = { li, from: +h.dataset.h, y0: e.clientY, id: e.pointerId, to: +h.dataset.h };
    try {
      li.setPointerCapture(e.pointerId);
    } catch (err) {}
    li.classList.add('drag');
    e.preventDefault();
  });
  list.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    const dy = e.clientY - g.y0;
    g.li.style.transform = `translateY(${dy}px)`;
    // cible : la ligne dont le milieu est dépassé
    const items = Array.from(list.children);
    let to = g.from;
    items.forEach((el, i) => {
      if (el === g.li) return;
      const r = el.getBoundingClientRect(),
        mid = r.top + r.height / 2;
      if (i < g.from && e.clientY < mid) to = Math.min(to, i);
      if (i > g.from && e.clientY > mid) to = Math.max(to, i);
    });
    if (to !== g.to) {
      g.to = to;
      items.forEach((el, i) => {
        el.classList.toggle('over', i === to && to !== g.from);
      });
    }
  });
  const end = function (e) {
    if (!g || e.pointerId !== g.id) return;
    g.li.style.transform = '';
    g.li.classList.remove('drag');
    const to = g.to,
      from = g.from;
    g = null;
    if (to !== from) moveTo(from, to);
    else paint();
  };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
}

export function initBatch() {
  setFilesHandler(take);
  watch(paint);
  // toucher une photo lue, ou son bouton Vérifier : elle s'ouvre comme une photo seule, telle que lue
  const open = function (i) {
    if (busyWith() !== 'lot' && photos[i]) openShot(photos[i], { scroll: true });
  };
  $('batchList').addEventListener('click', (e) => {
    const sh = e.target.closest('[data-show]'),
      b = e.target.closest('button');
    if (sh && !b) {
      open(+sh.dataset.show);
      return;
    }
    if (!b || busyWith() === 'lot') return;
    if (b.dataset.up !== undefined) moveTo(+b.dataset.up, +b.dataset.up - 1);
    else if (b.dataset.dn !== undefined) moveTo(+b.dataset.dn, +b.dataset.dn + 1);
    else if (b.dataset.del !== undefined) {
      photos.splice(+b.dataset.del, 1);
      paint();
    } else if (b.dataset.chk !== undefined) open(+b.dataset.chk);
  });
  $('batchList').addEventListener('keydown', (e) => {
    const sh = e.target.closest('[data-show]');
    if (!sh || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    open(+sh.dataset.show);
  });
  $('batchGo').addEventListener('click', () => {
    if (busyWith() === 'lot') stop();
    else runAll();
  });
  $('batchClear').addEventListener('click', () => {
    if (busyWith() === 'lot') return;
    // les points lus restent au suivi ; seules les photos pas encore sûres seraient perdues
    const left = photos.filter((p) => p.st !== 'ok').length;
    if (left && !confirm(`Vider le lot ? ${plural(left, 'photo reste', 'photos restent')} à lire ou à vérifier.`))
      return;
    photos = [];
    say('');
    paint();
  });
  initDrag();
}
