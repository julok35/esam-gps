/* Enchaînement automatique après une photo : redressement (perspective, inclinaison), contraste et netteté, zone des
   coordonnées, lecture, confiance. Chaque étape s'affiche avec son résultat et peut être reprise à la main. */
import { $, esc, openTile } from './util.js';
import { parse } from './parser.js';
import * as ocr from './ocr.js';
import { coordZone } from './zone.js';
import { confidence } from './trust.js';
import { autoParams } from './enhance.js';

// onFiles(fichiers) : plusieurs photos choisies ; vrai si le lot les prend (batch.js)
var onFiles = function () {
  return false;
};
export function setFilesHandler(fn) {
  onFiles = fn;
}
var STEPS = [
  ['photo', 'Photo'],
  ['level', 'Redressement'],
  ['enh', 'Contraste et netteté'],
  ['zone', 'Zone de texte'],
  ['read', 'Lecture'],
  ['trust', 'Confiance']
];
var ICON = { wait: '·', run: '…', ok: '✓', warn: '!', fail: '✕', info: '–' };
var ZONE_PAD = 0.35; // marge autour des mots trouvés (fraction de la hauteur de la zone)
var state = {},
  job = 0,
  showCb = function () {},
  lastRead = null; // dernière lecture { img, box } pour la zone affichée

function set(k, st, msg) {
  state[k] = { st: st, msg: msg || '' };
  paint();
}
function paint() {
  var ol = $('steps');
  ol.hidden = false;
  ol.innerHTML = STEPS.map(function (s) {
    var x = state[s[0]] || { st: 'wait', msg: '' },
      adj = '';
    if (s[0] === 'level') adj = '<button class="chip" type="button" data-adj="level">Ajuster</button>';
    if (s[0] === 'enh') adj = '<button class="chip" type="button" data-adj="enh">Ajuster</button>';
    if (s[0] === 'zone') adj = '<button class="chip" type="button" data-adj="zone">Cadrer</button>';
    if (s[0] === 'read') adj = '<button class="chip" type="button" data-adj="read">Relire</button>';
    if (s[0] === 'trust' && x.st === 'warn')
      adj = '<button class="chip" type="button" data-adj="trust">Vérifier</button>';
    return (
      '<li class="st-' +
      x.st +
      '"><span class="st-ic" aria-hidden="true">' +
      ICON[x.st] +
      '</span><div class="st-t"><b>' +
      s[1] +
      '</b><span class="st-msg">' +
      esc(x.msg) +
      '</span></div>' +
      (ocr.hasPhoto() ? adj : '') +
      '</li>'
    );
  }).join('');
  var running = STEPS.some(function (s) {
    return state[s[0]] && state[s[0]].st === 'run';
  });
  $('stepsStop').hidden = !running;
  ol.querySelectorAll('button').forEach(function (b) {
    b.disabled = running;
  });
}
function reset() {
  state = {};
  STEPS.forEach(function (s) {
    state[s[0]] = { st: 'wait', msg: '' };
  });
}
function deg(v) {
  return (v > 0 ? '+' : v < 0 ? '−' : '') + String(Math.abs(Math.round(v * 10) / 10)).replace('.', ',') + '°';
}

// ---------- Étapes ----------
function stepLevel() {
  var parts = [],
    st = 'ok';
  var q = ocr.detectQuad();
  if (q && q.gain >= ocr.QUAD_GAIN && q.cover < 0.97 && q.tilt >= 0.4) {
    if (ocr.applyQuad(q.quad)) parts.push('perspective corrigée (bords nets, ' + deg(q.tilt) + ')');
  } else if (q && q.gain >= ocr.QUAD_GAIN) parts.push('écran déjà droit');
  else parts.push('pas de bord d’écran net : perspective laissée');
  var r = ocr.leanIn(ocr.getWork(), { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, 45);
  if (r.gain >= ocr.AUTO_GAIN && Math.abs(r.deg) >= 0.3) {
    ocr.setAngle(-r.deg);
    parts.push('inclinaison ' + deg(-r.deg));
  } else if (r.gain >= ocr.AUTO_GAIN) parts.push('texte droit');
  else {
    parts.push('inclinaison non mesurable (texte peu net)');
    st = 'info';
  }
  set('level', st, parts.join(' · '));
}
function stepEnh() {
  var G = ocr.grayOf(ocr.getWork(), null, 800),
    p = autoParams(G.g, G.w, G.h),
    e = ocr.getEnh(),
    msg = 'contraste étiré (' + p.lo + '–' + p.hi + ' → 0–255)';
  if (e.sharp === null) msg += p.sharp ? ', netteté renforcée ×' + String(p.sharp).replace('.', ',') : ', photo nette';
  else msg += ', netteté ×' + String(e.sharp).replace('.', ',') + ' (réglée à la main)';
  if (e.contrast !== 1) msg += ', contraste ×' + String(e.contrast).replace('.', ',');
  set('enh', 'ok', msg);
}
// Zone : lecture pleine image, puis cadre autour des mots des coordonnées, inclinaison affinée dans le cadre
function stepZone(stale) {
  set('zone', 'run', 'lecture de la photo entière…');
  ocr.setProgress(function (t, f) {
    if (state.zone.st === 'run') set('zone', 'run', t + (f ? ' ' + Math.round(f * 100) + ' %' : ''));
  }, 'photo entière');
  var img = ocr.getWork();
  return ocr.recognizeFull(img, stale).then(function (full) {
    if (!full || stale()) return false;
    var z = coordZone(full.lines, parse);
    if (!z) {
      set('zone', 'warn', 'coordonnées non trouvées : cadrez-les à la main');
      return false;
    }
    var pad = (z.box.y1 - z.box.y0) * ZONE_PAD,
      box = {
        x: (z.box.x0 - pad) / img.width,
        y: (z.box.y0 - pad) / img.height,
        w: (z.box.x1 - z.box.x0 + 2 * pad) / img.width,
        h: (z.box.y1 - z.box.y0 + 2 * pad) / img.height
      };
    ocr.setSel(box);
    // inclinaison affinée sur la zone elle-même
    var r = ocr.leanIn(img, ocr.getSel(), 10),
      more = '';
    if (r.gain >= ocr.AUTO_GAIN && Math.abs(r.deg) >= 0.4) {
      ocr.setAngle(ocr.getAngle() - r.deg);
      more = ', inclinaison affinée ' + deg(-r.deg);
    }
    set(
      'zone',
      'ok',
      'trouvée : « ' +
        z.text.replace(/\s+/g, ' ').slice(0, 40) +
        ' »' +
        (z.conf !== null ? ', moteur sûr à ' + z.conf + ' %' : '') +
        more
    );
    return true;
  });
}
function stepRead(stale, manual) {
  set('read', 'run', 'lecture 1…');
  ocr.setProgress(function (t) {
    if (state.read.st === 'run' && /moteur|langue|Initialisation/.test(t)) set('read', 'run', t);
  });
  var img = ocr.getWork(),
    box = ocr.getSel();
  return ocr
    .readBox(
      img,
      box,
      function (i) {
        set('read', 'run', 'lecture ' + i + '…');
      },
      stale
    )
    .then(function (res) {
      if (!res || stale()) return null;
      lastRead = { img: img, box: box };
      ocr.showZoneOf(img, box);
      if (res.none) {
        set('read', 'fail', 'aucune coordonnée lue dans le cadre' + (manual ? '' : ' : recadrez à la main'));
        set('trust', 'fail', 'rien à transmettre');
        return res;
      }
      var a = res.p.agree || { n: 0, total: res.total };
      set(
        'read',
        res.sure ? 'ok' : 'warn',
        a.n +
          ' lecture' +
          (a.n > 1 ? 's' : '') +
          ' sur ' +
          a.total +
          ' concordante' +
          (a.n > 1 ? 's' : '') +
          (res.rival ? ', valeurs concurrentes' : '') +
          (manual ? ' (cadre manuel)' : '')
      );
      return res;
    });
}
function stepTrust(res) {
  var p = res.p;
  if (!p.ok) return;
  var t = confidence({
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
  set(
    'trust',
    t.level === 'ok' ? 'ok' : 'warn',
    t.pct +
      ' % · ' +
      (t.level === 'ok' ? 'fiable' : 'douteux : vérifiez sur la photo avant de transmettre') +
      ' (' +
      t.why.join(', ') +
      ')'
  );
}

// ---------- Enchaînements ----------
function stale(myJob, myGen) {
  return function () {
    return job !== myJob || ocr.photoGen() !== myGen;
  };
}
function fail(err) {
  console.error('Lecture photo :', err);
  STEPS.forEach(function (s) {
    if (state[s[0]].st === 'run')
      set(s[0], 'fail', 'lecture impossible : vérifiez le réseau au premier usage, ou tapez le texte');
  });
}
// Après une photo : tout, de la perspective à la confiance
function runAll() {
  var myJob = ++job,
    g = ocr.photoGen(),
    isStale = stale(myJob, g),
    s = ocr.photoSize();
  reset();
  set('photo', 'ok', s.w + ' × ' + s.h + ' px');
  $('cropBox').hidden = true;
  openTile('steps');
  $('steps').scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    stepLevel();
    stepEnh();
  } catch (err) {
    console.error('Redressement :', err);
    set('level', 'info', 'redressement automatique impossible : réglez à la main');
  }
  var myGen = ocr.photoGen();
  isStale = stale(myJob, myGen);
  $('cropBox').hidden = true;
  stepZone(isStale)
    .then(function (found) {
      if (isStale()) return;
      if (!found) {
        set('read', 'wait', 'en attente du cadre');
        set('trust', 'wait', '');
        ocr.openStage('frame');
        return;
      }
      return readThenTrust(isStale, false);
    })
    .catch(function (err) {
      if (!isStale()) fail(err);
    });
}
function readThenTrust(isStale, manual) {
  return stepRead(isStale, manual).then(function (res) {
    if (!res) return;
    if (res.none) {
      showCb(res.text, res.p);
      if (!manual) ocr.openStage('frame');
      return;
    }
    stepTrust(res);
    showCb(res.text, res.p);
    openTile('result');
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
// Depuis la lecture (cadre et réglages tels qu'à l'écran)
function runRead(manual) {
  if (!ocr.hasPhoto()) return;
  var myJob = ++job,
    isStale = stale(myJob, ocr.photoGen());
  if (state.zone.st === 'wait' || manual) set('zone', 'ok', 'cadre posé à la main');
  set('read', 'wait', '');
  set('trust', 'wait', '');
  $('cropBox').hidden = true;
  readThenTrust(isStale, manual).catch(function (err) {
    if (!isStale()) fail(err);
  });
}
// Depuis la zone (après un changement de géométrie)
function runFromZone() {
  if (!ocr.hasPhoto()) return;
  var myJob = ++job,
    isStale = stale(myJob, ocr.photoGen());
  set('read', 'wait', '');
  set('trust', 'wait', '');
  $('cropBox').hidden = true;
  stepEnh();
  stepZone(isStale)
    .then(function (found) {
      if (isStale()) return;
      if (!found) {
        set('read', 'wait', 'en attente du cadre');
        ocr.openStage('frame');
        return;
      }
      return readThenTrust(isStale, false);
    })
    .catch(function (err) {
      if (!isStale()) fail(err);
    });
}
function stop() {
  job++;
  STEPS.forEach(function (s) {
    if (state[s[0]].st === 'run') set(s[0], 'info', 'arrêtée : reprise à la main');
  });
  ocr.openStage('frame');
}

// ---------- Réglages à la main ----------
function slider(id, v) {
  $(id).value = v;
  $(id + 'V').textContent = '×' + String(v).replace('.', ',');
}
function openEnh() {
  var e = ocr.getEnh();
  var G = ocr.grayOf(ocr.getWork(), null, 800),
    p = autoParams(G.g, G.w, G.h);
  slider('enhC', e.contrast);
  slider('enhS', e.sharp === null ? p.sharp : e.sharp);
  $('enhBox').hidden = false;
  previewEnh();
  $('enhBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function previewEnh() {
  if (!ocr.hasPhoto()) return;
  var box = lastRead ? lastRead.box : ocr.getSel(),
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
    function () {
      runAll();
    },
    function (files) {
      return onFiles(files);
    }
  );
  reset();
  $('steps').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-adj]');
    if (!b) return;
    var k = b.dataset.adj;
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
  $('ocrGo').addEventListener('click', function () {
    runRead(true);
  });
  // perspective à la main : quatre coins sur les bords de l'écran, puis Redresser ; Auto les pose d'après la photo
  $('tPersp').addEventListener('click', function () {
    ocr.openStage(ocr.getMode() === 'persp' ? 'frame' : 'persp');
  });
  $('pAuto').addEventListener('click', function () {
    var q = ocr.detectQuad();
    if (q) ocr.setQuad(q.quad);
    else {
      var b = $('pAuto'),
        t = b.textContent;
      b.textContent = 'Pas de bord net';
      setTimeout(function () {
        b.textContent = t;
      }, 1500);
    }
  });
  $('pApply').addEventListener('click', function () {
    if (ocr.applyQuad(ocr.getQuad())) {
      set('level', 'ok', 'perspective redressée à la main');
      runFromZone();
    }
  });
  $('pOrig').addEventListener('click', function () {
    ocr.resetQuad();
    ocr.setMode('persp');
    set('level', 'info', 'photo d’origine (perspective annulée)');
  });
  $('pBack').addEventListener('click', function () {
    ocr.openStage('frame');
  });
  ['enhC', 'enhS'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      slider(id, +$(id).value);
      readEnh();
    });
  });
  $('enhAuto').addEventListener('click', function () {
    ocr.setEnh({ contrast: 1, sharp: null });
    openEnh();
  });
  $('enhGo').addEventListener('click', function () {
    readEnh();
    $('enhBox').hidden = true;
    stepEnh();
    runRead(state.zone.st !== 'ok' || /main/.test(state.zone.msg));
  });
  $('enhClose').addEventListener('click', function () {
    $('enhBox').hidden = true;
  });
}
// Photo oubliée (texte effacé) : étapes masquées
export function hideSteps() {
  $('steps').hidden = true;
  $('stepsStop').hidden = true;
  $('enhBox').hidden = true;
}
