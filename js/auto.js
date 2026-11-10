/* Enchaînement automatique après une photo : redressement (perspective, inclinaison), contraste et netteté, zone des
   coordonnées, lecture, confiance. Chaque étape s'affiche avec son résultat et peut être reprise à la main. */
import { $, esc, openTile } from './util.js';
import * as ocr from './ocr.js';
import { autoParams } from './enhance.js';
import { readPhoto, zone, read, trust, enhInfo } from './pipeline.js';

// onFiles(fichiers) : plusieurs photos choisies ; vrai si le lot les prend (batch.js)
let onFiles = function () {
  return false;
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
  showCb = function () {},
  lastRead = null; // dernière lecture { img, box } pour la zone affichée

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
  ol.querySelectorAll('button').forEach((b) => {
    b.disabled = running;
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
function fail(err) {
  console.error('Lecture photo :', err);
  STEPS.forEach((s) => {
    if (state[s[0]].st === 'run')
      set(s[0], 'fail', 'lecture impossible : vérifiez le réseau au premier usage, ou tapez le texte');
  });
}
// Chargement du moteur au premier usage : affiché sur l'étape en cours
function engineProgress() {
  ocr.setProgress((t, f) => {
    const run = STEPS.find((s) => state[s[0]].st === 'run');
    if (run && /moteur|langue|Initialisation/.test(t)) set(run[0], 'run', t + (f ? ` ${Math.round(f * 100)} %` : ''));
  });
}
function begin() {
  const myJob = ++job;
  $('cropBox').hidden = true;
  engineProgress();
  return stale(myJob, ocr.photoGen());
}
// Lecture terminée : zone lue affichée, résultat transmis à l'appli
function finish(img, box, res, manual) {
  lastRead = { img, box };
  ocr.showZoneOf(img, box);
  showCb(res.text, res.p);
  if (res.none) {
    if (!manual) ocr.openStage('frame');
    return;
  }
  openTile('result');
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function waitFrame() {
  set('read', 'wait', 'en attente du cadre');
  set('trust', 'wait', '');
  ocr.openStage('frame');
}
// Après une photo : tout, de la perspective à la confiance
async function runAll() {
  const isStale = begin(),
    s = ocr.photoSize();
  reset();
  set('photo', 'ok', `${s.w} × ${s.h} px`);
  openTile('steps');
  $('steps').scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const out = await readPhoto(ocr.getOrig(), { stale: isStale, wi: 0, onStep: set });
    if (!out || isStale()) return;
    // redressement, inclinaison et cadre repris à l'écran : chaque étape se reprend à la main
    ocr.adopt(out);
    $('cropBox').hidden = true;
    if (!out.found) waitFrame();
    else finish(out.img, out.box, out.res, false);
  } catch (err) {
    if (!isStale()) fail(err);
  }
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
  if (rd.res.none) set('trust', 'fail', 'rien à transmettre');
  else {
    const tr = trust(rd.res);
    if (tr) set('trust', tr.st, tr.msg);
    ocr.adopt({ img, box: rd.box });
    $('cropBox').hidden = true;
  }
  finish(img, rd.box, rd.res, manual);
}
// Depuis la lecture (cadre et réglages tels qu'à l'écran)
async function runRead(manual) {
  if (!ocr.hasPhoto()) return;
  const isStale = begin();
  if (state.zone.st === 'wait' || manual) set('zone', 'ok', 'cadre posé à la main');
  set('read', 'wait', '');
  set('trust', 'wait', '');
  try {
    await readThenTrust(isStale, manual);
  } catch (err) {
    if (!isStale()) fail(err);
  }
}
// Depuis la zone (après un changement de géométrie à la main : perspective)
async function runFromZone() {
  if (!ocr.hasPhoto()) return;
  const isStale = begin();
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
    if (z === undefined || isStale()) return;
    set('zone', z.st, z.msg);
    if (!z.found) {
      waitFrame();
      return;
    }
    ocr.adopt({ angle: z.angle, img: z.img, box: z.box });
    $('cropBox').hidden = true;
    await readThenTrust(isStale, false);
  } catch (err) {
    if (!isStale()) fail(err);
  }
}
function stop() {
  job++;
  STEPS.forEach((s) => {
    if (state[s[0]].st === 'run') set(s[0], 'info', 'arrêtée : reprise à la main');
  });
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

export function initAuto(show) {
  showCb = show;
  ocr.initOcr(
    () => {
      runAll();
    },
    (files) => onFiles(files)
  );
  reset();
  $('steps').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-adj]');
    if (!b) return;
    const k = b.dataset.adj;
    if (k === 'level') ocr.openStage('frame');
    else if (k === 'enh') openEnh();
    else if (k === 'zone') ocr.openStage('frame');
    else if (k === 'read') runRead(true);
    else if (k === 'trust') {
      openTile('result');
      $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
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
    if (ocr.applyQuad(ocr.getQuad())) {
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
    readEnh();
    $('enhBox').hidden = true;
    set('enh', 'ok', enhInfo(ocr.getWork()));
    runRead(state.zone.st !== 'ok' || /main/.test(state.zone.msg));
  });
  $('enhClose').addEventListener('click', () => {
    $('enhBox').hidden = true;
  });
}
// Photo oubliée (texte effacé) : étapes masquées
export function hideSteps() {
  $('steps').hidden = true;
  $('stepsStop').hidden = true;
  $('enhBox').hidden = true;
}
