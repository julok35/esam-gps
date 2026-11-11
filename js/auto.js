/* Photo affichée : enchaînement automatique après une photo (redressement, contraste et netteté, zone des coordonnées,
   lecture, confiance), étapes affichées avec leur résultat, reprises à la main. Une photo seule et une photo d'un lot
   passent par les mêmes fonctions : runShot (la lire), openShot (l'afficher telle que lue). */
import { $, esc, openTile } from './util.js';
import * as ocr from './ocr.js';
import { autoParams } from './enhance.js';
import { zone, read, trust, enhInfo } from './pipeline.js';
import { newShot, readShot, sendShot, stateOf, pointOf, touch, watch, busyWith, setBusy, BAD, FAIL } from './shot.js';

// onFiles(fichiers) : photo prise ou photos choisies. Sans lot (batch.js) : la première est lue seule
let onFiles = function (files) {
  newShot(files[0]).then(runShot);
};
export function setFilesHandler(fn) {
  onFiles = fn;
}
const STEPS = [
  ['photo', 'Photo'],
  ['level', 'Redressement'],
  ['enh', 'Contraste et netteté'],
  ['zone', 'Zone de texte'],
  ['read', 'Lecture'],
  ['trust', 'Confiance']
];
const ICON = { wait: '·', run: '…', ok: '✓', warn: '!', fail: '✕', info: '-' };
let state = {},
  job = 0,
  cur = null, // fiche de la photo affichée
  // rappels de app.js : showCb(fiche, options) affiche son point, clearCb(texte, fiche, en cours) l'efface
  showCb = function () {},
  clearCb = function () {},
  lastRead = null; // dernière lecture { img, box } de la photo affichée, pour l'aperçu du contraste

function set(k, st, msg) {
  state[k] = { st, msg: msg || '' };
  paint();
}
function paint() {
  const ol = $('steps');
  ol.hidden = false;
  ol.innerHTML = STEPS.map((s) => {
    const x = state[s[0]] || { st: 'wait', msg: '' };
    let adj = '';
    if (s[0] === 'level') adj = '<button class="chip" type="button" data-adj="level">Ajuster</button>';
    if (s[0] === 'enh') adj = '<button class="chip" type="button" data-adj="enh">Ajuster</button>';
    if (s[0] === 'zone') adj = '<button class="chip" type="button" data-adj="zone">Cadrer</button>';
    if (s[0] === 'read') adj = '<button class="chip" type="button" data-adj="read">Relire</button>';
    if (s[0] === 'trust' && x.st === 'warn')
      adj = '<button class="chip" type="button" data-adj="trust">Vérifier</button>';
    return `<li class="st-${x.st}"><span class="st-ic" aria-hidden="true">${ICON[x.st]}</span><div class="st-t"><b>${
      s[1]
    }</b><span class="st-msg">${esc(x.msg)}</span></div>${ocr.hasPhoto() ? adj : ''}</li>`;
  }).join('');
  const running = STEPS.some((s) => state[s[0]] && state[s[0]].st === 'run');
  $('stepsStop').hidden = !running;
  // rien ne se reprend à la main pendant une lecture, celle de cette photo ou celle d'un lot
  ol.querySelectorAll('button').forEach((b) => {
    b.disabled = running || busyWith() === 'lot';
  });
}
function reset() {
  state = {};
  STEPS.forEach((s) => {
    state[s[0]] = { st: 'wait', msg: '' };
  });
}
// ---------- Enchaînements : la chaîne de lecture est dans pipeline.js, la même que pour un lot de photos ----------
function stale(myJob, myGen) {
  return function () {
    return job !== myJob || ocr.photoGen() !== myGen;
  };
}
function fail() {
  STEPS.forEach((s) => {
    if (state[s[0]].st === 'run') set(s[0], 'fail', FAIL);
  });
}
// Chargement du moteur au premier usage : affiché sur l'étape en cours
function engineProgress() {
  ocr.setProgress((t, f) => {
    const run = STEPS.find((s) => state[s[0]].st === 'run');
    if (run && /moteur|langue|Initialisation/.test(t)) set(run[0], 'run', t + (f ? ` ${Math.round(f * 100)} %` : ''));
  });
}
// Début d'une lecture de la photo affichée : une seule lecture à la fois, la précédente s'arrête.
// Retour : isStale(), avec done() à appeler en fin de lecture
function begin() {
  const myJob = ++job;
  setBusy('one');
  $('cropBox').hidden = true;
  engineProgress();
  const isStale = stale(myJob, ocr.photoGen());
  isStale.done = function () {
    if (job === myJob) setBusy('');
  };
  return isStale;
}
function scrollTo(id) {
  openTile(id);
  $(id).scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Lire une photo : elle est affichée, lue par la chaîne commune (étapes à l'écran), son point sûr versé au suivi, puis
 * ouverte telle que lue. Le point affiché avant est effacé dès le début : il n'est plus celui de la photo en cours.
 */
export async function runShot(shot) {
  const myJob = ++job;
  setBusy('one');
  cur = null;
  lastRead = null;
  hideSteps();
  clearCb('Lecture de la photo en cours…', null, true);
  const loaded = await ocr.loadFile(shot.file);
  if (job !== myJob) return; // une autre photo a été choisie entre-temps
  if (!loaded) {
    setBusy('');
    lost(shot);
    return;
  }
  cur = shot;
  const isStale = stale(myJob, ocr.photoGen()),
    s = ocr.photoSize();
  $('cropBox').hidden = true;
  engineProgress();
  reset();
  set('photo', 'ok', `${s.w} × ${s.h} px`);
  scrollTo('steps');
  const out = await readShot(shot, { stale: isStale, wi: 0, onStep: set, orig: ocr.getOrig() });
  if (job !== myJob) return;
  setBusy('');
  if (!out) {
    // lecture impossible (moteur) ; abandonnée (photo pivotée entre-temps) : rien à dire de plus
    if (shot.st === 'fail') {
      fail();
      clearCb('Lecture impossible : aucun point à transmettre.', shot);
    }
    return;
  }
  sendShot(shot);
  await openShot(shot, { fresh: out, scroll: true });
}
// Photo illisible : rien à afficher, le point est effacé
function lost(shot) {
  shot.st = 'bad';
  shot.msg = BAD;
  touch(shot);
  cur = null;
  hideSteps();
  $('cropBox').hidden = true;
  clearCb('Photo illisible : aucun point à transmettre.', shot);
}

/**
 * Afficher une lecture : la photo devient la photo affichée, telle que lue (étapes, redressement, cadre, zone lue),
 * et son point va dans « Point de la victime », ou l'efface si rien n'a été lu. La même fonction en fin de lecture
 * d'une photo seule (o.fresh : résultat tout juste rendu par readShot, avec ses canevas) et pour une photo d'un lot
 * (rechargée et remise dans la géométrie de sa lecture, sans la relire).
 * o.scroll : l'écran va au point ; o.keepMap : la carte ne se recentre pas. Retour : promesse, vrai si affichée.
 */
export async function openShot(shot, o) {
  o = o || {};
  let out = o.fresh;
  const r = shot.r;
  if (!out) {
    const myJob = ++job; // une lecture de photo seule en cours s'arrête
    if (busyWith() === 'one') setBusy('');
    const loaded = await ocr.loadFile(shot.file);
    if (job !== myJob) return false;
    if (!loaded) {
      lost(shot);
      return false;
    }
    if (!r) {
      // photo pas (encore) lue : affichée, à cadrer à la main
      cur = shot;
      lastRead = null;
      reset();
      set('photo', 'ok', `${ocr.photoSize().w} × ${ocr.photoSize().h} px`);
      showCb(shot, o);
      ocr.openStage('frame');
      return true;
    }
    for (let i = 0; i < (r.turns || 0); i++) ocr.quarterTurn();
    if (r.enh) ocr.setEnh(r.enh);
    const orig = ocr.getOrig(),
      base = (r.quad && ocr.warpCanvas(orig, r.quad)) || orig;
    out = {
      base,
      quad: base === orig ? null : r.quad,
      angle: r.angle || 0,
      img: r.angle ? ocr.rotateCanvas(base, r.angle) : base,
      box: r.box
    };
  }
  cur = shot;
  reset();
  Object.assign(state, r.steps);
  state.photo = { st: 'ok', msg: `${ocr.photoSize().w} × ${ocr.photoSize().h} px` };
  if (!r.found) state.read = { st: 'wait', msg: 'en attente du cadre' };
  paint();
  // redressement, inclinaison et cadre repris à l'écran : chaque étape se reprend à la main
  ocr.adopt(out);
  $('cropBox').hidden = true;
  lastRead = r.found && r.res ? { img: out.img, box: r.box } : null;
  if (lastRead) ocr.showZoneOf(out.img, r.box);
  showCb(shot, o);
  if (!pointOf(shot)) ocr.openStage('frame');
  else if (o.scroll) scrollTo('resCard');
  return true;
}

// Lecture reprise à la main sur la photo affichée (cadre, relecture, perspective, contraste) : la fiche la garde, la
// photo se rouvrira telle quelle ; son point sûr va au suivi, comme après une lecture automatique
function keep(rd, tr) {
  const steps = {};
  STEPS.slice(1).forEach((s) => {
    steps[s[0]] = state[s[0]];
  });
  cur.r = {
    turns: ocr.getTurns(),
    quad: ocr.getApplied(),
    angle: ocr.getAngle(),
    box: rd.box,
    enh: ocr.getEnh(),
    found: true,
    res: rd.res,
    steps
  };
  cur.fix = null;
  Object.assign(
    cur,
    stateOf({ found: true, res: rd.res, trust: tr && tr.t, quad: cur.r.quad, angle: cur.r.angle }, steps)
  );
  sendShot(cur);
  touch(cur);
}
// Lecture et confiance, cadre et réglages tels qu'à l'écran. manual : cadre posé à la main
async function readThenTrust(isStale, manual) {
  const img = ocr.getWork();
  set('read', 'run', 'lecture 1…');
  const rd = await read(img, ocr.getSel(), {
    stale: isStale,
    wi: 0,
    manual,
    onPass: (i) => set('read', 'run', `lecture ${i}…`),
    onWiden: () => set('read', 'run', 'pas d’accord net : nouvel essai, cadre élargi aux lignes voisines…')
  });
  if (!rd || isStale()) return;
  set('read', rd.st, rd.msg);
  let tr = null;
  if (rd.res.none) set('trust', 'fail', 'rien à transmettre');
  else {
    tr = trust(rd.res);
    if (tr) set('trust', tr.st, tr.msg);
    ocr.adopt({ img, box: rd.box });
    $('cropBox').hidden = true;
  }
  // zone lue affichée, lecture gardée par la fiche, point transmis à l'appli
  lastRead = { img, box: rd.box };
  ocr.showZoneOf(img, rd.box);
  keep(rd, tr);
  showCb(cur);
  if (rd.res.none) {
    if (!manual) ocr.openStage('frame');
    return;
  }
  scrollTo('resCard');
}
// Reprise à la main possible : une photo affichée, et pas de lot en cours de lecture
function canRun() {
  return ocr.hasPhoto() && cur && busyWith() !== 'lot';
}
// Depuis la lecture (cadre et réglages tels qu'à l'écran)
async function runRead(manual) {
  if (!canRun()) return;
  const isStale = begin();
  clearCb('Lecture de la photo en cours…', cur, true);
  if (state.zone.st === 'wait' || manual) set('zone', 'ok', 'cadre posé à la main');
  set('read', 'wait', '');
  set('trust', 'wait', '');
  try {
    await readThenTrust(isStale, manual);
  } catch (err) {
    console.error('Lecture photo :', err);
    if (!isStale()) fail();
  }
  isStale.done();
}
// Depuis la zone (après un changement de géométrie à la main : perspective)
async function runFromZone() {
  if (!canRun()) return;
  const isStale = begin();
  clearCb('Lecture de la photo en cours…', cur, true);
  set('read', 'wait', '');
  set('trust', 'wait', '');
  try {
    const img = ocr.getWork();
    set('enh', 'ok', enhInfo(img));
    set('zone', 'run', 'lecture de la photo entière…');
    const z = await zone(ocr.getBase(), ocr.getAngle(), img, {
      stale: isStale,
      wi: 0,
      onView: (name, i) => i > 1 && set('zone', 'run', `nouvel essai : ${name}…`)
    });
    if (z !== undefined && !isStale()) {
      set('zone', z.st, z.msg);
      if (!z.found) {
        set('read', 'wait', 'en attente du cadre');
        ocr.openStage('frame');
      } else {
        ocr.adopt({ angle: z.angle, img: z.img, box: z.box });
        $('cropBox').hidden = true;
        await readThenTrust(isStale, false);
      }
    }
  } catch (err) {
    console.error('Lecture photo :', err);
    if (!isStale()) fail();
  }
  isStale.done();
}
function stop() {
  job++;
  setBusy('');
  STEPS.forEach((s) => {
    if (state[s[0]].st === 'run') set(s[0], 'info', 'arrêtée : reprise à la main');
  });
  // la lecture gardée de cette photo, s'il y en a une, revient ; sinon aucun point
  if (cur && cur.r) showCb(cur);
  else clearCb('Lecture arrêtée : cadrez les coordonnées à la main.', cur);
  ocr.openStage('frame');
}

// ---------- Réglages à la main ----------
function slider(id, v) {
  $(id).value = v;
  $(`${id}V`).textContent = `×${String(v).replace('.', ',')}`;
}
function openEnh() {
  const e = ocr.getEnh();
  const G = ocr.grayOf(ocr.getWork(), null, 800),
    p = autoParams(G.g, G.w, G.h);
  slider('enhC', e.contrast);
  slider('enhS', e.sharp === null ? p.sharp : e.sharp);
  $('enhBox').hidden = false;
  previewEnh();
  $('enhBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function previewEnh() {
  if (!ocr.hasPhoto()) return;
  const box = lastRead ? lastRead.box : ocr.getSel(),
    c = ocr.prepared(ocr.getWork(), box, 1000, 0).c,
    out = $('enhCv');
  out.width = c.width;
  out.height = c.height;
  out.getContext('2d').drawImage(c, 0, 0);
}
function readEnh() {
  ocr.setEnh({ contrast: +$('enhC').value, sharp: +$('enhS').value });
  previewEnh();
}

// show(fiche, options) : affiche le point de la photo ; clear(texte, fiche, en cours) : efface le point (app.js)
export function initAuto(show, clear) {
  showCb = show;
  clearCb = clear;
  ocr.initOcr((files) => onFiles(files));
  reset();
  // lot en cours de lecture : les reprises à la main attendent
  let lot = false;
  watch(() => {
    const now = busyWith() === 'lot';
    if (now === lot) return;
    lot = now;
    ['ocrGo', 'enhGo', 'pApply'].forEach((id) => {
      $(id).disabled = lot;
    });
    if (!$('steps').hidden) paint();
  });
  $('steps').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-adj]');
    if (!b) return;
    const k = b.dataset.adj;
    if (k === 'level') ocr.openStage('frame');
    else if (k === 'enh') openEnh();
    else if (k === 'zone') ocr.openStage('frame');
    else if (k === 'read') runRead(true);
    else if (k === 'trust') scrollTo('resCard');
  });
  $('stepsStop').addEventListener('click', stop);
  $('ocrGo').addEventListener('click', () => {
    runRead(true);
  });
  // perspective à la main : quatre coins sur les bords de l'écran, puis Redresser ; Auto les pose d'après la photo
  $('tPersp').addEventListener('click', () => {
    ocr.openStage(ocr.getMode() === 'persp' ? 'frame' : 'persp');
  });
  $('pAuto').addEventListener('click', () => {
    const q = ocr.detectQuad();
    if (q) ocr.setQuad(q.quad);
    else {
      const b = $('pAuto'),
        t = b.textContent;
      b.textContent = 'Pas de bord net';
      setTimeout(() => {
        b.textContent = t;
      }, 1500);
    }
  });
  $('pApply').addEventListener('click', () => {
    if (canRun() && ocr.applyQuad(ocr.getQuad())) {
      set('level', 'ok', 'perspective redressée à la main');
      runFromZone();
    }
  });
  $('pOrig').addEventListener('click', () => {
    ocr.resetQuad();
    ocr.setMode('persp');
    set('level', 'info', 'photo d’origine (perspective annulée)');
  });
  $('pBack').addEventListener('click', () => {
    ocr.openStage('frame');
  });
  ['enhC', 'enhS'].forEach((id) => {
    $(id).addEventListener('input', () => {
      slider(id, +$(id).value);
      readEnh();
    });
  });
  $('enhAuto').addEventListener('click', () => {
    ocr.setEnh({ contrast: 1, sharp: null });
    openEnh();
  });
  $('enhGo').addEventListener('click', () => {
    if (!canRun()) return;
    readEnh();
    $('enhBox').hidden = true;
    set('enh', 'ok', enhInfo(ocr.getWork()));
    runRead(state.zone.st !== 'ok' || /main/.test(state.zone.msg));
  });
  $('enhClose').addEventListener('click', () => {
    $('enhBox').hidden = true;
  });
}
function hideSteps() {
  $('steps').hidden = true;
  $('stepsStop').hidden = true;
  $('enhBox').hidden = true;
}
// Photo oubliée (texte effacé, lot lancé) : sa lecture en cours s'arrête, étapes et cadrage masqués
export function forget() {
  job++;
  if (busyWith() === 'one') setBusy('');
  cur = null;
  lastRead = null;
  hideSteps();
  $('cropBox').hidden = true;
  ocr.clearZone();
}
// Aucun point à afficher (lot en cours de lecture, lot sans point sûr) : la photo affichée est oubliée, le point effacé
export function noPoint(why, wait) {
  forget();
  clearCb(why, null, wait);
}
