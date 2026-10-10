/* Photo, recadrage au doigt, lecture du texte (Tesseract.js) et vote entre plusieurs lectures. */
import { $, flash, openTile } from './util.js';
import { parse, inRegion, distM } from './parser.js';
import { skewAngle } from './skew.js';

// Bibliothèque et worker hébergés avec l'appli (worker de même origine : contrôlé par le service worker, donc utilisable hors ligne).
// Moteur WebAssembly et langue sur le CDN (versions figées), gardés en cache par le service worker.
var TESS = {
  lib: 'vendor/tesseract/tesseract.min.js',
  worker: 'vendor/tesseract/worker.min.js',
  core: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
  lang: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int'
};
// Lectures successives : [largeur visée, marge blanche, mode de segmentation]. Toutes lisent exactement le cadre
// affiché, avec la photo telle que redressée à l'écran : rien n'est élargi ni tourné en coulisse.
var PASSES = [[900, 0, '6'], [900, 0, '11'], [1800, 0, '11'], [900, 0, '4'], [1200, 0, '6'], [1200, 0, '11'], [1800, 1, '6'], [900, 1, '6']];
var NEED = 3; // lectures concordantes nécessaires
var AUTO_GAIN = 1.5; // Auto : inclinaison appliquée seulement si la mesure est nette
var TOL = 0.00002; // deux lectures à moins de ~2 m sur un axe votent ensemble

// base : photo telle que prise (aux quarts de tour près) ; work : la même redressée de angle degrés, refaite à la demande
// zone : la zone lue, agrandie et contrastée, gardée pour vérifier le résultat d'un coup d'œil
var base = null, angle = 0, work = null, zone = null, gen = 0, sel = { x: .1, y: .3, w: .8, h: .4 }, cv, stage, selEl, drag = null, ocrWorker = null, progCb = function () {};
// Vue de la photo : zoom z (1 = photo entière) et décalage en pixels de l'écran ; doigts posés sur la photo
var view = { z: 1, tx: 0, ty: 0 }, ptrs = new Map();
var ZMAX = 8, MIN_SIDE = 0.02, DEAD = 8; // zoom maximal, plus petit côté du cadre, mouvement ignoré (px) avant de bouger quoi que ce soit

function loadFile(file) {
  if (!file) return;
  var done = function (img) {
    var s = Math.min(1, 2400 / Math.max(img.width, img.height));
    base = document.createElement('canvas'); base.width = Math.round(img.width * s); base.height = Math.round(img.height * s);
    base.getContext('2d').drawImage(img, 0, 0, base.width, base.height);
    angle = 0; work = null; gen++; showAngle(); clearZone();
    sel = { x: .15, y: .35, w: .7, h: .35 };
    $('cropBox').hidden = false; $('prog').hidden = true; showWork();
    $('cropBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  if (window.createImageBitmap) createImageBitmap(file, { imageOrientation: 'from-image' }).then(done, function () { viaImg(file, done); });
  else viaImg(file, done);
}
function viaImg(file, cb) { var u = URL.createObjectURL(file), im = new Image(); im.onload = function () { cb(im); URL.revokeObjectURL(u); }; im.src = u; }
// Photo tournée de deg degrés autour de son centre, dans un canevas agrandi pour n'en rien perdre ; échelle s.
// Les coins laissés vides prennent la teinte moyenne de la photo, pour ne pas fausser le contraste de la lecture.
function rotDims(deg) {
  var a = deg * Math.PI / 180, c = Math.abs(Math.cos(a)), si = Math.abs(Math.sin(a));
  return { w: base.width * c + base.height * si, h: base.width * si + base.height * c };
}
function drawRotated(deg, s) {
  var r = rotDims(deg), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(r.w * s)); c.height = Math.max(1, Math.round(r.h * s));
  var g = c.getContext('2d');
  if (deg) {
    g.drawImage(base, 0, 0, 1, 1); var m = g.getImageData(0, 0, 1, 1).data;
    g.fillStyle = 'rgb(' + m[0] + ',' + m[1] + ',' + m[2] + ')'; g.fillRect(0, 0, c.width, c.height);
  }
  g.imageSmoothingQuality = 'high';
  g.translate(c.width / 2, c.height / 2); g.rotate(deg * Math.PI / 180); g.scale(s, s);
  g.drawImage(base, -base.width / 2, -base.height / 2);
  return c;
}
function getWork() { if (!work) work = angle ? drawRotated(angle, 1) : base; return work; }
function showWork(keep) {
  // affichage assez fin pour rester net une fois zoomé
  var r = rotDims(angle), s = Math.min(1, 2000 / Math.max(r.w, r.h)), c = drawRotated(angle, s);
  cv.width = c.width; cv.height = c.height; cv.getContext('2d').drawImage(c, 0, 0);
  if (!keep) view = { z: 1, tx: 0, ty: 0 };
  applyView();
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
// taille de la photo à l'écran sans zoom (le zoom est une transformation, il ne change pas la mise en page)
function dims() { return { W: cv.offsetWidth || 1, H: cv.offsetHeight || 1 }; }
function applyView() {
  var d = dims();
  view.z = clamp(view.z, 1, ZMAX);
  view.tx = clamp(view.tx, d.W - d.W * view.z, 0); view.ty = clamp(view.ty, d.H - d.H * view.z, 0);
  cv.style.transform = 'translate(' + view.tx + 'px,' + view.ty + 'px) scale(' + view.z + ')';
  $('zOut').disabled = view.z <= 1; $('zIn').disabled = view.z >= ZMAX;
  drawSel();
}
// cadre en coordonnées de la photo (0 à 1), placé à l'écran selon le zoom
function drawSel() {
  var d = dims(), kx = d.W * view.z, ky = d.H * view.z;
  selEl.style.left = view.tx + sel.x * kx + 'px'; selEl.style.top = view.ty + sel.y * ky + 'px';
  selEl.style.width = sel.w * kx + 'px'; selEl.style.height = sel.h * ky + 'px';
}
function local(e) { var r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
// zoom vers z en gardant immobile le point p de l'écran
function zoomAt(z, p) {
  var nz = clamp(z, 1, ZMAX);
  view.tx = p.x - (p.x - view.tx) * nz / view.z; view.ty = p.y - (p.y - view.ty) * nz / view.z; view.z = nz;
  applyView();
}
// centre du cadre à l'écran (ramené dans la photo visible) : les boutons zooment vers lui
function selCenter() {
  var d = dims();
  return { x: clamp(view.tx + (sel.x + sel.w / 2) * d.W * view.z, 0, d.W), y: clamp(view.ty + (sel.y + sel.h / 2) * d.H * view.z, 0, d.H) };
}
// Redressement : la photo tourne de nd degrés ; le cadre reste sur le même endroit de la photo, au même endroit de l'écran
var TILT = 45;
function setAngle(nd) {
  nd = clamp(Math.round(nd * 10) / 10, -TILT, TILT);
  if (!base || nd === angle) { showAngle(); return; }
  var o = rotDims(angle), n = rotDims(nd), d = dims(), a = (nd - angle) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  var mx = sel.x + sel.w / 2, my = sel.y + sel.h / 2, sp = { x: view.tx + mx * d.W * view.z, y: view.ty + my * d.H * view.z };
  var cx = (mx - .5) * o.w, cy = (my - .5) * o.h, w = Math.min(1, sel.w * o.w / n.w), h = Math.min(1, sel.h * o.h / n.h);
  mx = (cx * c - cy * s) / n.w + .5; my = (cx * s + cy * c) / n.h + .5;
  sel = { x: clamp(mx - w / 2, 0, 1 - w), y: clamp(my - h / 2, 0, 1 - h), w: w, h: h };
  angle = nd; work = null; showAngle(); showWork(true);
  d = dims(); view.tx = sp.x - (sel.x + sel.w / 2) * d.W * view.z; view.ty = sp.y - (sel.y + sel.h / 2) * d.H * view.z;
  applyView();
}
function showAngle() {
  $('tilt').value = angle;
  $('tVal').textContent = (angle > 0 ? '+' : angle < 0 ? '−' : '') + String(Math.abs(angle)).replace('.', ',') + '°';
}
// lignes horizontales sur la photo pendant le réglage, pour aligner le texte à l'œil
var guideT;
function guides() { stage.classList.add('leveling'); clearTimeout(guideT); guideT = setTimeout(function () { stage.classList.remove('leveling'); }, 1500); }
function grayOf(c) {
  var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, g = new Uint8Array(c.width * c.height);
  for (var i = 0; i < g.length; i++) g[i] = d[i * 4];
  return { data: g, w: c.width, h: c.height };
}
// Inclinaison du texte dans le cadre de img : { deg, gain }. Mesurée à la taille de la photo ou en dessous,
// jamais agrandie (l'agrandissement floute les contours et fausse la mesure).
function leanIn(img, box, max) {
  var sx = box.x * img.width, sy = box.y * img.height, sw = Math.max(8, box.w * img.width), sh = Math.max(8, box.h * img.height);
  var k = Math.min(1, 800 / Math.max(sw, sh)), c = document.createElement('canvas');
  c.width = Math.round(sw * k); c.height = Math.round(sh * k);
  var g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  var d = g.getImageData(0, 0, c.width, c.height).data, gr = new Uint8Array(c.width * c.height);
  for (var i = 0; i < gr.length; i++) gr[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
  return skewAngle(gr, c.width, c.height, max);
}
function autoLevel() {
  if (!base) return;
  var r = leanIn(getWork(), sel, TILT);
  if (r.gain < AUTO_GAIN) { flash($('tAuto'), 'Pas net'); return; }
  if (Math.abs(r.deg) < 0.3) { flash($('tAuto'), 'Déjà droit'); return; }
  setAngle(angle - r.deg); guides();
}
function two() { var p = Array.from(ptrs.values()); return { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, m: { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 } }; }

// Un doigt : coin = redimensionner, intérieur du cadre = déplacer, ailleurs = faire glisser la photo zoomée.
// Deux doigts : zoom, sans toucher au cadre. Rien ne bouge avant DEAD px (un simple toucher ne déplace rien).
function initCrop() {
  stage.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.zoombar')) return;
    ptrs.set(e.pointerId, local(e));
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
    if (ptrs.size === 2) {
      // second doigt : le geste du premier sur le cadre est annulé, place au zoom
      if (drag && drag.s) { sel = drag.s; drawSel(); }
      var t = two();
      drag = { mode: 'pinch', d0: t.d, m0: t.m, z0: view.z, tx0: view.tx, ty0: view.ty };
      return;
    }
    if (ptrs.size > 2) return;
    var mode = e.target.dataset.h || (e.target === selEl ? 'move' : 'pan');
    drag = { mode: mode, p0: local(e), s: { x: sel.x, y: sel.y, w: sel.w, h: sel.h }, tx0: view.tx, ty0: view.ty, live: false };
  });
  stage.addEventListener('pointermove', function (e) {
    if (!drag || !ptrs.has(e.pointerId)) return;
    var p = local(e); ptrs.set(e.pointerId, p);
    if (drag.mode === 'pinch') {
      if (ptrs.size < 2) return;
      var t = two(), nz = clamp(drag.z0 * t.d / drag.d0, 1, ZMAX);
      // le point de la photo sous les doigts au départ suit le milieu des doigts
      view.tx = t.m.x - (drag.m0.x - drag.tx0) * nz / drag.z0; view.ty = t.m.y - (drag.m0.y - drag.ty0) * nz / drag.z0; view.z = nz;
      applyView(); return;
    }
    if (ptrs.size > 1 || !drag.s) return;
    var dx = p.x - drag.p0.x, dy = p.y - drag.p0.y;
    if (!drag.live) {
      if (Math.hypot(dx, dy) < DEAD) return;
      drag.live = true; drag.p0 = p; return; // départ du geste ici : pas de saut
    }
    if (drag.mode === 'pan') { view.tx = drag.tx0 + dx; view.ty = drag.ty0 + dy; applyView(); return; }
    var d = dims(), s = drag.s, ux = dx / (d.W * view.z), uy = dy / (d.H * view.z);
    if (drag.mode === 'move') { sel.x = clamp(s.x + ux, 0, 1 - s.w); sel.y = clamp(s.y + uy, 0, 1 - s.h); }
    else {
      // coin : seul le coin tenu bouge, le cadre ne se retourne pas et garde une taille minimale
      var x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h;
      if (drag.mode.charAt(1) === 'l') x0 = clamp(s.x + ux, 0, x1 - MIN_SIDE); else x1 = clamp(x1 + ux, x0 + MIN_SIDE, 1);
      if (drag.mode.charAt(0) === 't') y0 = clamp(s.y + uy, 0, y1 - MIN_SIDE); else y1 = clamp(y1 + uy, y0 + MIN_SIDE, 1);
      sel = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    drawSel();
  });
  ['pointerup', 'pointercancel'].forEach(function (ev) {
    stage.addEventListener(ev, function (e) {
      ptrs.delete(e.pointerId);
      // après un zoom à deux doigts, le doigt qui reste ne fait rien jusqu'à ce qu'il soit levé
      if (!ptrs.size) drag = null; else if (drag && drag.mode === 'pinch') drag = { mode: 'none' };
    });
  });
  stage.addEventListener('wheel', function (e) { if (!base) return; e.preventDefault(); zoomAt(view.z * (e.deltaY < 0 ? 1.25 : 0.8), local(e)); }, { passive: false });
  $('zIn').addEventListener('click', function () { zoomAt(view.z * 1.6, selCenter()); });
  $('zOut').addEventListener('click', function () { zoomAt(view.z / 1.6, selCenter()); });
  window.addEventListener('resize', function () { if (base && !$('cropBox').hidden) applyView(); });
  $('rot').addEventListener('click', function () {
    if (!base) return;
    var c = document.createElement('canvas'); c.width = base.height; c.height = base.width;
    var g = c.getContext('2d'); g.translate(c.width, 0); g.rotate(Math.PI / 2); g.drawImage(base, 0, 0); base = c; gen++;
    angle = 0; work = null; showAngle();
    sel = { x: .1, y: .1, w: .8, h: .8 }; showWork();
  });
  // réglette : rendu au plus une fois par image affichée ; boutons : pas d'un demi-degré
  var pend = null;
  $('tilt').addEventListener('input', function (e) {
    guides();
    if (pend === null) requestAnimationFrame(function () { var v = pend; pend = null; setAngle(v); });
    pend = +e.target.value;
  });
  $('tL').addEventListener('click', function () { setAngle(angle - 0.5); guides(); });
  $('tR').addEventListener('click', function () { setAngle(angle + 0.5); guides(); });
  $('tAuto').addEventListener('click', autoLevel);
  $('cropAll').addEventListener('click', function () { sel = { x: 0, y: 0, w: 1, h: 1 }; view = { z: 1, tx: 0, ty: 0 }; applyView(); });
  $('cropClose').addEventListener('click', function () { $('cropBox').hidden = true; });
  $('reCrop').addEventListener('click', function () { $('cropBox').classList.remove('read'); $('zoneView').hidden = true; applyView(); $('cropBox').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  $('zoneClose').addEventListener('click', function () { $('cropBox').hidden = true; });
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

// Zone lue pour l'œil : exactement le cadre lu, plus net (masque flou), contraste en S
function zoneImage(img, box) {
  var c = prepared(img, box, 1400, 0, 0), W = c.width, H = c.height, g = c.getContext('2d'), d = g.getImageData(0, 0, W, H), p = d.data;
  // netteté : la photo moins sa version floue (rayon proportionnel à l'agrandissement), ajoutée à elle-même
  var R = Math.max(2, Math.round(W / 300)), src = new Float32Array(W * H), tmp = new Float32Array(W * H), bl = new Float32Array(W * H), x, y, i, s;
  for (i = 0; i < src.length; i++) src[i] = p[i * 4];
  var box1 = function (from, to, step, len, lines, lstep) {
    for (var l = 0; l < lines; l++) {
      var o = l * lstep; s = 0;
      for (var k = -R; k <= R; k++) s += from[o + Math.min(len - 1, Math.max(0, k)) * step];
      for (var q = 0; q < len; q++) {
        to[o + q * step] = s / (2 * R + 1);
        s += from[o + Math.min(len - 1, q + R + 1) * step] - from[o + Math.max(0, q - R) * step];
      }
    }
  };
  box1(src, tmp, 1, W, H, W); box1(tmp, bl, W, H, W, 1);
  var lut = new Uint8Array(256);
  for (var v = 0; v < 256; v++) lut[v] = Math.round(255 / (1 + Math.exp(-(v - 128) / 30)));
  for (i = 0; i < src.length; i++) { var u = Math.max(0, Math.min(255, Math.round(src[i] + 1.2 * (src[i] - bl[i])))); p[i * 4] = p[i * 4 + 1] = p[i * 4 + 2] = lut[u]; }
  g.putImageData(d, 0, 0);
  return c;
}
export function readZone() { return zone; }
// zone oubliée (nouvelle photo, texte effacé, autre point) ; le cadrage revient
export function clearZone() { zone = null; $('cropBox').classList.remove('read'); $('zoneView').hidden = true; }
function showZone(z) {
  zone = z;
  var c = $('zoneCv'); c.width = z.width; c.height = z.height; c.getContext('2d').drawImage(z, 0, 0);
  $('cropBox').classList.add('read'); $('zoneView').hidden = false;
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
  if (!base) return;
  var btn = $('ocrGo'); btn.disabled = true;
  // photo et cadre figés pour toute la lecture ; une nouvelle photo pendant la lecture l'interrompt
  var img = getWork(), box = { x: sel.x, y: sel.y, w: sel.w, h: sel.h }, myGen = gen;
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
      var ps = PASSES[i++], ik = ps[0] + '_' + ps[1];
      LBL['recognizing text'] = 'Lecture ' + i;
      imgs[ik] = imgs[ik] || prepared(img, box, ps[0], ps[1]);
      return w.setParameters({ tessedit_pageseg_mode: ps[2] }).then(function () { return w.recognize(imgs[ik]); }).then(function (r) {
        var txt = (r.data.text || '').trim();
        runs.push({ txt: txt, p: parse(txt) });
      }).then(step);
    };
    return step();
  }).then(function () {
    if (stale()) { setProg('Lecture interrompue : nouvelle photo, touchez Lire', 0); return; }
    try { showZone(zoneImage(img, box)); } catch (err) { console.error('Zone lue :', err); }
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
    if (!zone) openTile('result');
    $(zone ? 'zoneView' : 'result').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
