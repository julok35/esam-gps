/* Photo, recadrage au doigt, lecture du texte (Tesseract.js) et vote entre plusieurs lectures. */
import { $, flash } from './util.js';
import { parse, inRegion, distM } from './parser.js';

// Bibliothèque et worker hébergés avec l'appli (worker de même origine : contrôlé par le service worker, donc utilisable hors ligne).
// Moteur WebAssembly et langue sur le CDN (versions figées), gardés en cache par le service worker.
var TESS = {
  lib: 'vendor/tesseract/tesseract.min.js',
  worker: 'vendor/tesseract/worker.min.js',
  core: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
  lang: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int'
};
// Lectures successives : [largeur visée, marge blanche, mode de segmentation, élargissement du cadre]
var PASSES = [[900, 0, '6', 0], [900, 0, '11', 0], [1800, 0, '11', 0], [900, 0, '4', 0], [1200, 0, '6', 0.25], [1200, 0, '11', 0.25], [1800, 1, '6', 0], [900, 1, '6', 0]];
var NEED = 3; // lectures concordantes nécessaires
var TOL = 0.00002; // deux lectures à moins de ~2 m sur un axe votent ensemble

var work = null, gen = 0, sel = { x: .1, y: .3, w: .8, h: .4 }, cv, stage, selEl, drag = null, ocrWorker = null, progCb = function () {};

function loadFile(file) {
  if (!file) return;
  var done = function (img) {
    var s = Math.min(1, 2400 / Math.max(img.width, img.height));
    work = document.createElement('canvas'); work.width = Math.round(img.width * s); work.height = Math.round(img.height * s);
    work.getContext('2d').drawImage(img, 0, 0, work.width, work.height);
    gen++;
    sel = { x: .15, y: .35, w: .7, h: .35 };
    showWork(); $('cropBox').hidden = false; $('prog').hidden = true;
    $('cropBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  if (window.createImageBitmap) createImageBitmap(file, { imageOrientation: 'from-image' }).then(done, function () { viaImg(file, done); });
  else viaImg(file, done);
}
function viaImg(file, cb) { var u = URL.createObjectURL(file), im = new Image(); im.onload = function () { cb(im); URL.revokeObjectURL(u); }; im.src = u; }
function showWork() {
  var s = Math.min(1, 900 / work.width);
  cv.width = Math.round(work.width * s); cv.height = Math.round(work.height * s);
  cv.getContext('2d').drawImage(work, 0, 0, cv.width, cv.height);
  drawSel();
}
function drawSel() { selEl.style.left = sel.x * 100 + '%'; selEl.style.top = sel.y * 100 + '%'; selEl.style.width = sel.w * 100 + '%'; selEl.style.height = sel.h * 100 + '%'; }

function initCrop() {
  stage.addEventListener('pointerdown', function (e) {
    var r = stage.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    var h = e.target.classList.contains('h') ? e.target.className.replace('h ', '') : null;
    drag = { mode: h || 'new', px: px, py: py, s: { x: sel.x, y: sel.y, w: sel.w, h: sel.h } };
    if (drag.mode === 'new') sel = { x: px, y: py, w: 0.01, h: 0.01 };
    stage.setPointerCapture(e.pointerId); e.preventDefault();
  });
  stage.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var r = stage.getBoundingClientRect(), px = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), py = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    var s = drag.s, dx = px - drag.px, dy = py - drag.py, x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h;
    if (drag.mode === 'move') { sel.x = Math.max(0, Math.min(1 - s.w, s.x + dx)); sel.y = Math.max(0, Math.min(1 - s.h, s.y + dy)); }
    else {
      if (drag.mode === 'new') { x0 = drag.px; y0 = drag.py; x1 = px; y1 = py; }
      else {
        if (drag.mode.charAt(1) === 'l') x0 = px; else x1 = px;
        if (drag.mode.charAt(0) === 't') y0 = py; else y1 = py;
      }
      sel = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.max(.03, Math.abs(x1 - x0)), h: Math.max(.03, Math.abs(y1 - y0)) };
    }
    drawSel();
  });
  ['pointerup', 'pointercancel'].forEach(function (ev) { stage.addEventListener(ev, function () { drag = null; }); });
  $('rot').addEventListener('click', function () {
    if (!work) return;
    var c = document.createElement('canvas'); c.width = work.height; c.height = work.width;
    var g = c.getContext('2d'); g.translate(c.width, 0); g.rotate(Math.PI / 2); g.drawImage(work, 0, 0); work = c; gen++;
    sel = { x: .1, y: .1, w: .8, h: .8 }; showWork();
  });
  $('cropAll').addEventListener('click', function () { sel = { x: 0, y: 0, w: 1, h: 1 }; drawSel(); });
  $('cropClose').addEventListener('click', function () { $('cropBox').hidden = true; });
  $('cam').addEventListener('change', function (e) { loadFile(e.target.files[0]); e.target.value = ''; });
  $('gal').addEventListener('change', function (e) { loadFile(e.target.files[0]); e.target.value = ''; });
}

// Image préparée pour la lecture : cadre (box) de l'image img, agrandi vers targetW pixels, niveaux de gris étirés,
// pad : marge blanche autour du texte, ex : élargissement du cadre
function prepared(img, box, targetW, pad, ex) {
  var e = ex || 0, x0 = Math.max(0, box.x - box.w * e), y0 = Math.max(0, box.y - box.h * e), x1 = Math.min(1, box.x + box.w * (1 + e)), y1 = Math.min(1, box.y + box.h * (1 + e));
  var sx = Math.round(x0 * img.width), sy = Math.round(y0 * img.height), sw = Math.max(8, Math.round((x1 - x0) * img.width)), sh = Math.max(8, Math.round((y1 - y0) * img.height));
  var k = Math.max(1, Math.min(8, targetW / sw));
  var c = document.createElement('canvas'); c.width = Math.round(sw * k); c.height = Math.round(sh * k);
  var g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  var d = g.getImageData(0, 0, c.width, c.height), p = d.data, hist = new Uint32Array(256), n = p.length / 4;
  for (var i = 0; i < p.length; i += 4) { var y = (p[i] * 299 + p[i + 1] * 587 + p[i + 2] * 114) / 1000 | 0; p[i] = y; hist[y]++; }
  var lo = 0, hi = 255, acc = 0;
  for (lo = 0; lo < 255; lo++) { acc += hist[lo]; if (acc > n * 0.02) break; }
  acc = 0; for (hi = 255; hi > 0; hi--) { acc += hist[hi]; if (acc > n * 0.02) break; }
  var span = Math.max(1, hi - lo);
  for (i = 0; i < p.length; i += 4) { var v = Math.max(0, Math.min(255, (p[i] - lo) * 255 / span)); p[i] = p[i + 1] = p[i + 2] = v; }
  g.putImageData(d, 0, 0);
  if (!pad) return c;
  var m = Math.round(c.height / 4), o = document.createElement('canvas'); o.width = c.width + 2 * m; o.height = c.height + 2 * m;
  var go = o.getContext('2d'); go.fillStyle = '#fff'; go.fillRect(0, 0, o.width, o.height); go.drawImage(c, m, m);
  return o;
}

function loadScript(u) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = u; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
// Chien de garde : Tesseract ne signale pas toujours un moteur qui ne se charge pas ; sans aucun progrès pendant STALL ms, échec
var STALL = 60000;
function getWorker() {
  if (ocrWorker) return ocrWorker;
  var timer, settled = false, kick = function (fail) { if (settled) return; clearTimeout(timer); timer = setTimeout(function () { fail(new Error('bloqué')); }, STALL); };
  ocrWorker = new Promise(function (resolve, reject) {
    kick(reject);
    (window.Tesseract ? Promise.resolve() : loadScript(TESS.lib)).then(function () {
      return Tesseract.createWorker('eng', 1, { workerPath: TESS.worker, workerBlobURL: false, corePath: TESS.core, langPath: TESS.lang,
        logger: function (m) { kick(reject); progCb(m); } });
    }).then(resolve, reject);
  });
  ocrWorker.then(function () { settled = true; clearTimeout(timer); }, function () { settled = true; clearTimeout(timer); ocrWorker = null; });
  return ocrWorker;
}
function setProg(t, f) { $('prog').hidden = false; $('progTxt').textContent = t; $('progBar').style.width = Math.round((f || 0) * 100) + '%'; }

// Vote séparé sur la latitude et la longitude ; les valeurs à moins de TOL degré l'une de l'autre votent ensemble
function addVote(list, v, w, idx) {
  var o = null;
  for (var i = 0; i < list.length; i++) if (Math.abs(list[i].v - v) < TOL) { o = list[i]; break; }
  if (!o) { o = { v: v, w: 0, n: 0, runs: [], vals: {} }; list.push(o); }
  o.w += w; o.n++; o.runs.push(idx);
  var k = v.toFixed(6); o.vals[k] = (o.vals[k] || 0) + w;
  // valeur retenue pour le groupe : la plus lue
  o.v = +Object.keys(o.vals).sort(function (a, b) { return o.vals[b] - o.vals[a]; })[0];
}
export function votes(runs) {
  var V = { lat: [], lon: [] };
  runs.forEach(function (r, idx) {
    if (!r.p.ok) return;
    var b = r.p.best;
    if (!inRegion(b.lat, b.lon)) return;
    var w = b.notes.length ? 0.6 : 1;
    addVote(V.lat, b.lat, w, idx); addVote(V.lon, b.lon, w, idx);
  });
  var win = function (list) {
    var s = list.slice().sort(function (a, b) { return b.w - a.w; });
    return { best: s[0] || null, second: s[1] || null };
  };
  return { lat: win(V.lat), lon: win(V.lon) };
}
export function firm(x) { return x.best && x.best.n >= NEED && (!x.second || x.second.n <= x.best.n - 2); }

// show(texte, résultat d'analyse) : affiche le résultat dans l'appli
function read(show) {
  if (!work) return;
  var btn = $('ocrGo'); btn.disabled = true;
  // photo et cadre figés pour toute la lecture ; une nouvelle photo pendant la lecture l'interrompt
  var img = work, box = { x: sel.x, y: sel.y, w: sel.w, h: sel.h }, myGen = gen;
  var stale = function () { return gen !== myGen; };
  var LBL = { 'loading tesseract core': 'Chargement du moteur', 'initializing tesseract': 'Initialisation', 'loading language traineddata': 'Chargement de la langue', 'initializing api': 'Initialisation', 'recognizing text': 'Lecture du texte' };
  progCb = function (m) { setProg((LBL[m.status] || 'Préparation') + '...', m.progress); };
  setProg('Préparation...', 0);
  var imgs = {}, runs = [];
  var done = function () { var v = votes(runs); return firm(v.lat) && firm(v.lon); };
  getWorker().then(function (w) {
    var i = 0;
    var step = function () {
      if (i >= PASSES.length || done() || stale()) return;
      var ps = PASSES[i++], ik = ps[0] + '_' + ps[1] + '_' + ps[3];
      LBL['recognizing text'] = 'Lecture ' + i;
      imgs[ik] = imgs[ik] || prepared(img, box, ps[0], ps[1], ps[3]);
      return w.setParameters({ tessedit_pageseg_mode: ps[2] }).then(function () { return w.recognize(imgs[ik]); }).then(function (r) {
        var txt = (r.data.text || '').trim();
        runs.push({ txt: txt, p: parse(txt) });
      }).then(step);
    };
    return step();
  }).then(function () {
    if (stale()) { setProg('Lecture interrompue : nouvelle photo, touchez Lire', 0); return; }
    var v = votes(runs), total = runs.length, lastParse;
    if (!v.lat.best || !v.lon.best) {
      var r0 = runs[0] || { txt: '', p: parse('') };
      show(r0.txt, r0.p);
      setProg('Aucune coordonnée lue : recadrez sur les coordonnées, avec un peu de marge', 1);
      return;
    }
    var LA = v.lat.best, LO = v.lon.best, text;
    // une lecture qui contient les deux valeurs gagnantes sert de texte de référence (de préférence exactement les valeurs retenues)
    var both = LA.runs.filter(function (x) { return LO.runs.indexOf(x) >= 0; });
    var rank = function (x) { var b = runs[x].p.best; return (b.lat.toFixed(6) === LA.v.toFixed(6) ? 0 : 10) + (b.lon.toFixed(6) === LO.v.toFixed(6) ? 0 : 10) + b.notes.length; };
    both.sort(function (a, b) { return rank(a) - rank(b); });
    if (both.length) { text = runs[both[0]].txt; lastParse = runs[both[0]].p; }
    else {
      text = LA.v.toFixed(6) + ', ' + LO.v.toFixed(6);
      lastParse = parse(text);
      if (lastParse.ok) lastParse.best.notes.push({ lvl: 'warn', t: 'Latitude et longitude prises dans deux lectures différentes.' });
    }
    var sure = firm(v.lat) && firm(v.lon);
    var rival = function (x) { return x.second && x.second.n >= x.best.n; };
    if (lastParse.ok) {
      if (sure) {
        lastParse.best.notes = lastParse.best.notes.filter(function (x) { return !/symbole|deux lectures/.test(x.t); });
        lastParse.alts = [];
        lastParse.agree = Math.min(LA.n, LO.n) + '/' + total;
      } else {
        var alts = [];
        if (v.lat.second || v.lon.second) {
          var a2 = { lat: (v.lat.second || LA).v, lon: (v.lon.second || LO).v, seg: 'autre lecture', notes: [], fmt: lastParse.best.fmt };
          if (distM(a2, lastParse.best) > 5) alts.push(a2);
        }
        lastParse.alts = alts.concat(lastParse.alts).slice(0, 3);
        lastParse.best.notes.push({ lvl: 'warn', t: 'Lectures concordantes : latitude ' + LA.n + '/' + total + ', longitude ' + LO.n + '/' + total + (rival(v.lat) || rival(v.lon) ? ', avec des lectures concurrentes' : '') + '. Comparez avec la photo.' });
      }
    }
    show(text, lastParse);
    setProg(sure ? 'Lu et confirmé' : 'Lecture incertaine : vérifiez avec la photo', 1);
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }).catch(function (err) {
    console.error('Lecture photo :', err);
    setProg('Lecture impossible : vérifiez le réseau au premier usage, ou tapez le texte', 0);
  }).then(function () { btn.disabled = false; });
}

// Préparation hors ligne : moteur et langue téléchargés une fois, gardés par le service worker
function prepareOffline() {
  var b = $('prepOff'); b.disabled = true; $('prepMsg').textContent = 'Téléchargement du moteur de lecture (environ 7 Mo)...';
  var simd = typeof WebAssembly === 'object' && WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  var urls = [TESS.lib, TESS.worker, TESS.core + '/tesseract-core-' + (simd ? 'simd-' : '') + 'lstm.wasm.js', TESS.lang + '/eng.traineddata.gz'];
  Promise.all(urls.map(function (u) { return fetch(u, { mode: 'cors' }).then(function (r) { if (!r.ok) throw 0; return r.blob(); }); }))
    .then(function () { return getWorker(); })
    .then(function () { $('prepMsg').textContent = 'Prêt : la lecture de photo fonctionne maintenant sans réseau sur ce téléphone.'; flash(b, 'Prêt'); })
    .catch(function () { $('prepMsg').textContent = 'Échec du téléchargement : réessayez avec du réseau.'; })
    .then(function () { b.disabled = false; });
}

export function initOcr(show) {
  cv = $('cv'); stage = $('stage'); selEl = $('sel');
  initCrop();
  $('ocrGo').addEventListener('click', function () { read(show); });
  $('prepOff').addEventListener('click', prepareOffline);
}
