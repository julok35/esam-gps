/* Lot de photos : triées par date de prise de vue (EXIF, sinon fichier), réordonnables au doigt, lues chacune par
   l'enchaînement automatique (plusieurs moteurs en parallèle), points sûrs versés au suivi datés de la photo. */
import { $, esc, f6, fmtWhen, openTile } from './util.js';
import { parse } from './parser.js';
import * as ocr from './ocr.js';
import { setFilesHandler } from './auto.js';
import { coordZone } from './zone.js';
import { confidence } from './trust.js';
import { addPoints } from './track.js';

const MAX_SIDE = 1600, // photos du lot réduites (mémoire : plusieurs en cours à la fois)
  ZONE_PAD = 0.35,
  THUMB = 96;
// photos : [{ id, file, name, t, exif, moved, thumb, st : wait | run | ok | check | fail, msg, p, text }]
let photos = [],
  seq = 0,
  running = false;

function thumbOf(file) {
  return ocr.loadCanvas(file, THUMB).then(
    (c) => c.toDataURL('image/jpeg', 0.7),
    () => ''
  );
}
// Photos ajoutées au lot, dans l'ordre des dates
function addFiles(files) {
  const items = files.map((f) => ({
    id: ++seq,
    file: f,
    name: f.name || 'photo',
    t: 0,
    exif: false,
    moved: false,
    thumb: '',
    st: 'wait',
    msg: ''
  }));
  photos = photos.concat(items);
  paint();
  return Promise.all(
    items.map((it) =>
      Promise.all([ocr.photoDate(it.file), thumbOf(it.file)]).then((r) => {
        it.t = it.t0 = r[0].t;
        it.exif = r[0].exif;
        it.thumb = r[1];
      })
    )
  ).then(() => {
    photos.sort((a, b) => a.t - b.t || a.id - b.id);
    paint();
  });
}
function paint() {
  const card = $('batchCard');
  card.hidden = !photos.length;
  if (!photos.length) {
    $('batchList').innerHTML = '';
    $('batchSum').textContent = '';
    return;
  }
  const ok = photos.filter((p) => p.st === 'ok').length;
  $('batchSum').textContent =
    photos.length + ' photo' + (photos.length > 1 ? 's' : '') + (ok ? ' · ' + ok + ' lue' + (ok > 1 ? 's' : '') : '');
  $('batchList').innerHTML = photos
    .map((p, i) => {
      const st = p.st,
        line =
          st === 'ok' || st === 'check'
            ? f6(p.p.best.lat) + ', ' + f6(p.p.best.lon) + ' · ' + p.msg
            : st === 'run'
              ? p.msg || 'lecture…'
              : st === 'fail'
                ? p.msg
                : 'en attente';
      return (
        '<li class="bp st-' +
        st +
        '" data-i="' +
        i +
        '">' +
        '<span class="bh" data-h="' +
        i +
        '" aria-label="Glisser pour déplacer la photo ' +
        (i + 1) +
        '">⋮⋮</span>' +
        (p.thumb ? '<img class="bt" alt="" src="' + p.thumb + '">' : '<span class="bt"></span>') +
        '<div class="bb"><div class="bn"><b>' +
        (i + 1) +
        '</b> ' +
        esc(fmtWhen(p.t)) +
        ' <small>' +
        (p.moved ? 'date déplacée' : p.exif ? 'photo' : 'fichier') +
        '</small></div>' +
        '<div class="bm">' +
        esc(line) +
        '</div></div>' +
        '<div class="ba">' +
        (st === 'check' || st === 'fail'
          ? '<button class="chip" type="button" data-chk="' + i + '">Vérifier</button>'
          : '<button class="bx" type="button" data-up="' +
            i +
            '" aria-label="Monter"' +
            (i ? '' : ' disabled') +
            '>▲</button>' +
            '<button class="bx" type="button" data-dn="' +
            i +
            '" aria-label="Descendre"' +
            (i < photos.length - 1 ? '' : ' disabled') +
            '>▼</button>') +
        '<button class="bx" type="button" data-del="' +
        i +
        '" aria-label="Retirer">✕</button></div></li>'
      );
    })
    .join('');
  $('batchGo').disabled = running;
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
    p.moved = false;
  } else {
    if (a && b) p.t = a.t < b.t ? (a.t + b.t) / 2 : a.t + 60000;
    else if (a) p.t = a.t + 60000;
    else if (b) p.t = b.t - 60000;
    p.moved = true;
  }
  paint();
}

// ---------- Lecture d'une photo, sans écran ----------
const never = function () {
  return false;
};
function readOne(ph, wi) {
  const parts = [];
  ph.st = 'run';
  ph.msg = 'redressement…';
  paint();
  return ocr.loadCanvas(ph.file, MAX_SIDE).then((c) => {
    let img = c;
    const q = ocr.detectQuadIn(img);
    if (q && q.gain >= ocr.QUAD_GAIN && q.cover < 0.97 && q.tilt >= 0.4) {
      const w = ocr.warpCanvas(img, q, MAX_SIDE);
      if (w) {
        img = w;
        parts.push('perspective');
      }
    }
    const r = ocr.leanIn(img, { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, 45);
    if (r.gain >= ocr.AUTO_GAIN && Math.abs(r.deg) >= 0.3) {
      img = ocr.rotateCanvas(img, -r.deg);
      parts.push('redressée ' + String(Math.round(-r.deg * 10) / 10).replace('.', ',') + '°');
    }
    ph.msg = 'recherche des coordonnées…';
    paint();
    return ocr.recognizeFull(img, never, wi).then((full) => {
      const z = full && coordZone(full.lines, parse);
      if (!z) {
        ph.st = 'fail';
        ph.msg = 'coordonnées non trouvées : à cadrer à la main';
        return;
      }
      const pad = (z.box.y1 - z.box.y0) * ZONE_PAD,
        box = {
          x: Math.max(0, (z.box.x0 - pad) / img.width),
          y: Math.max(0, (z.box.y0 - pad) / img.height)
        };
      box.w = Math.min(1 - box.x, (z.box.x1 - z.box.x0 + 2 * pad) / img.width);
      box.h = Math.min(1 - box.y, (z.box.y1 - z.box.y0 + 2 * pad) / img.height);
      ph.msg = 'lecture…';
      paint();
      return ocr
        .readBox(
          img,
          box,
          (i) => {
            ph.msg = 'lecture ' + i + '…';
            paint();
          },
          never,
          wi
        )
        .then((res) => {
          if (!res || res.none) {
            ph.st = 'fail';
            ph.msg = 'aucune coordonnée lue : à cadrer à la main';
            return;
          }
          const p = res.p,
            t = confidence({
              tess: res.tess,
              agree: p.agree,
              firm: res.sure,
              rival: res.rival,
              notes: p.best.notes.length,
              alts: p.alts.length,
              manual: false
            });
          p.trust = t;
          p.ocr = true;
          ph.p = p;
          ph.text = res.text;
          ph.st = t.level === 'ok' ? 'ok' : 'check';
          ph.msg =
            (t.level === 'ok' ? 'fiable ' : 'douteux ') +
            t.pct +
            ' %' +
            (parts.length ? ' (' + parts.join(', ') + ')' : '');
        });
    });
  });
}
// Toutes les photos en attente, réparties entre les moteurs
function runAll() {
  if (running) return;
  const queue = photos.filter((p) => p.st === 'wait' || p.st === 'fail');
  if (!queue.length) return;
  running = true;
  paint();
  $('batchMsg').hidden = false;
  $('batchMsg').textContent = 'Lecture de ' + queue.length + ' photo' + (queue.length > 1 ? 's' : '') + '…';
  const n = Math.min(ocr.workerCount(), queue.length),
    runner = function (wi) {
      const ph = queue.shift();
      if (!ph) return Promise.resolve();
      return readOne(ph, wi)
        .catch((err) => {
          console.error('Lot :', err);
          ph.st = 'fail';
          ph.msg = 'lecture impossible (réseau au premier usage ?)';
        })
        .then(() => {
          paint();
          return runner(wi);
        });
    },
    runners = [];
  for (let i = 0; i < n; i++) runners.push(runner(i));
  Promise.all(runners).then(() => {
    running = false;
    const sure = photos.filter((p) => p.st === 'ok'),
      doubt = photos.filter((p) => p.st === 'check' || p.st === 'fail');
    const added = addPoints(sure.map((p) => ({ lat: p.p.best.lat, lon: p.p.best.lon, t: p.t, label: '' })));
    $('batchMsg').textContent =
      (sure.length
        ? added +
          ' point' +
          (added > 1 ? 's' : '') +
          ' ajouté' +
          (added > 1 ? 's' : '') +
          ' au suivi' +
          (added < sure.length
            ? ' (' + (sure.length - added) + ' déjà présent' + (sure.length - added > 1 ? 's' : '') + ')'
            : '')
        : 'Aucun point sûr') +
      (doubt.length
        ? ' · ' +
          doubt.length +
          ' photo' +
          (doubt.length > 1 ? 's' : '') +
          ' à vérifier (bouton Vérifier : la photo s’ouvre pour la reprendre à la main)'
        : '') +
      '.';
    paint();
  });
}

// ---------- Glisser pour réordonner ----------
function initDrag() {
  const list = $('batchList');
  let g = null;
  list.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.bh');
    if (!h || running) return;
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
    g.li.style.transform = 'translateY(' + dy + 'px)';
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

// Photo du lot reprise à la main (bouton Vérifier) puis ajoutée au suivi : elle passe en lue, avec le point retenu
export function batchChecked(file, c) {
  const ph = file && c && photos.find((p) => p.file === file);
  if (!ph) return;
  ph.st = 'ok';
  ph.p = { best: { lat: c.lat, lon: c.lon } };
  ph.msg = 'vérifiée à la main';
  const left = photos.filter((p) => p.st === 'check' || p.st === 'fail').length;
  $('batchMsg').hidden = false;
  $('batchMsg').textContent = left
    ? 'Encore ' + left + ' photo' + (left > 1 ? 's' : '') + ' à vérifier.'
    : 'Toutes les photos du lot sont au suivi.';
  paint();
}

export function initBatch() {
  setFilesHandler((files) => {
    if (!files.length || (files.length < 2 && !photos.length)) return false;
    addFiles(files).then(() => {
      openTile('batchList');
      $('batchCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return true;
  });
  $('batchList').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || running) return;
    if (b.dataset.up !== undefined) moveTo(+b.dataset.up, +b.dataset.up - 1);
    else if (b.dataset.dn !== undefined) moveTo(+b.dataset.dn, +b.dataset.dn + 1);
    else if (b.dataset.del !== undefined) {
      photos.splice(+b.dataset.del, 1);
      paint();
    } else if (b.dataset.chk !== undefined) {
      // la photo s'ouvre seule, avec ses étapes reprenables à la main ; le point ajouté au suivi sera daté de la photo
      const p = photos[+b.dataset.chk];
      ocr.loadFile(p.file, p.t);
    }
  });
  $('batchGo').addEventListener('click', runAll);
  $('batchClear').addEventListener('click', () => {
    if (running) return;
    photos = [];
    $('batchMsg').hidden = true;
    paint();
  });
  initDrag();
}
