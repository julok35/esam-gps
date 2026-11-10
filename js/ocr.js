/* Photo, recadrage au doigt, redressement (inclinaison, perspective), lecture du texte (Tesseract.js) et vote entre
   plusieurs lectures. L'enchaînement automatique des étapes est dans auto.js ; ce module garde la photo et le cadre. */
import { $, flash } from './util.js';
import { parse, inRegion, distM } from './parser.js';
import { skewAngle } from './skew.js';
import { toGray, stretchBounds, enhance, autoParams } from './enhance.js';
import { findQuad, homography, invert, warp, rectFor, grow } from './warp.js';
import { exifDate } from './exif.js';

// Tout Tesseract est hébergé avec l'appli (vendor/tesseract) : aucun code ni donnée ne vient d'un autre site.
// Bibliothèque et worker sont dans le cache de l'appli ; le moteur WebAssembly et la langue (7 Mo) ne sont téléchargés
// qu'au premier usage ou par « Préparer la lecture de photo sans réseau », puis gardés par le service worker.
const TESS = {
  lib: 'vendor/tesseract/tesseract.min.js',
  worker: 'vendor/tesseract/worker.min.js',
  core: 'vendor/tesseract/core-7', // dossier au numéro de version : un moteur d'une autre version déjà en cache ne sert plus
  lang: 'vendor/tesseract/lang'
};
// Sorties demandées au moteur : le texte et les blocs (lignes, mots, boîtes, confiances), désactivés par défaut depuis
// tesseract.js 6
const OUT = { text: true, blocks: true };
// Adresse complète : le worker résout les chemins relatifs depuis son propre dossier, pas depuis la page
function abs(path) {
  return new URL(path, document.baseURI).href;
}
// Lectures successives : [largeur visée, marge blanche, mode de segmentation]. Toutes lisent exactement le cadre
// affiché, avec la photo telle que redressée à l'écran : rien n'est élargi ni tourné en coulisse.
const PASSES = [
  [900, 0, '6'],
  [900, 0, '11'],
  [1800, 0, '11'],
  [900, 0, '4'],
  [1200, 0, '6'],
  [1200, 0, '11'],
  [1800, 1, '6'],
  [900, 1, '6']
];
const NEED = 3; // lectures concordantes nécessaires
export const AUTO_GAIN = 1.5; // Auto : inclinaison appliquée seulement si la mesure est nette
export const QUAD_GAIN = 3; // perspective : cadre d'écran appliqué seulement si ses bords sont nets
const TOL = 0.00002; // deux lectures à moins de ~2 m sur un axe votent ensemble
const FULL_W = 1200; // largeur de la lecture pleine image (recherche de la zone des coordonnées)

// orig : photo telle que prise (aux quarts de tour près) ; base : la même, redressée en perspective si demandé ;
// work : base tournée de angle degrés, refaite à la demande ; zone : la zone lue, agrandie et contrastée
// gen : numéro de la photo, incrémenté à chaque nouvelle photo, quart de tour ou perspective (une lecture en cours se sait périmée)
// sel : cadre de lecture, en fractions (0 à 1) de la photo affichée ; quad : coins du cadre de perspective (pixels de base)
// enh : réglages de contraste (gain) et de netteté (null : choisie d'elle-même selon le flou de la zone)
let orig = null,
  base = null,
  angle = 0,
  work = null,
  zone = null,
  gen = 0,
  sel = { x: 0.1, y: 0.3, w: 0.8, h: 0.4 },
  quad = null,
  enh = { contrast: 1, sharp: null },
  cv,
  stage,
  selEl,
  drag = null,
  progCb = function () {},
  photoCb = function () {},
  filesCb = function () {};
// Vue de la photo : zoom z (1 = photo entière) et décalage en pixels de l'écran ; doigts posés sur la photo
let view = { z: 1, tx: 0, ty: 0 };
const ptrs = new Map();
const ZMAX = 8, // zoom maximal
  MIN_SIDE = 0.02, // plus petit côté du cadre (fraction de la photo)
  DEAD = 8; // mouvement ignoré (px) avant de bouger quoi que ce soit

// Fichier image -> canevas (orientation EXIF appliquée), grand côté max pixels au plus
export function loadCanvas(file, max) {
  const done = function (img) {
    const s = Math.min(1, (max || 2400) / Math.max(img.width, img.height)),
      c = document.createElement('canvas');
    c.width = Math.round(img.width * s);
    c.height = Math.round(img.height * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    if (img.close) img.close();
    return c;
  };
  return (
    window.createImageBitmap
      ? createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => viaImg(file))
      : viaImg(file)
  ).then(done);
}
// Date de prise de vue (EXIF), sinon date du fichier : { t, exif : vrai si lue dans la photo }
export function photoDate(file) {
  return (file.slice ? file.slice(0, 131072).arrayBuffer() : Promise.reject(new Error('fichier illisible'))).then(
    (b) => {
      const t = exifDate(b);
      return t ? { t, exif: true } : { t: file.lastModified || Date.now(), exif: false };
    },
    () => ({ t: file.lastModified || Date.now(), exif: false })
  );
}
let photoT = null, // date de la photo affichée (ms) ou null
  photoF = null; // fichier de la photo affichée
export function photoTime() {
  return photoT;
}
export function photoFile() {
  return photoF;
}
let loading = 0;
function photoMsg(t) {
  $('photoMsg').textContent = t || '';
  $('photoMsg').hidden = !t;
}
// t : date de la photo déjà connue (lot), sinon lue dans ses métadonnées.
// Retour : promesse, vrai si la photo est affichée (faux : illisible, ou une autre photo choisie entre-temps)
export function loadFile(file, t) {
  if (!file) return Promise.resolve(false);
  const mine = ++loading;
  photoMsg('');
  return loadCanvas(file, 2400).then(
    (c) => {
      if (mine !== loading) return false; // une autre photo a été choisie entre-temps
      photoF = file;
      photoT = t || null;
      if (!t)
        photoDate(file).then((d) => {
          if (photoF === file) photoT = d.exif ? d.t : null;
        });
      showPhoto(c);
      photoCb(file);
      return true;
    },
    (err) => {
      console.error('Photo :', err);
      if (mine === loading)
        photoMsg(
          'Photo illisible sur ce téléphone (format non reconnu ou fichier abîmé) : essayez une capture d’écran, ou tapez le texte.'
        );
      return false;
    }
  );
}
// Photo chargée : affichée, réglages et cadre remis à zéro
function showPhoto(c) {
  orig = c;
  base = orig;
  angle = 0;
  work = null;
  quad = null;
  enh = { contrast: 1, sharp: null };
  gen++;
  showAngle();
  clearZone();
  setMode('frame');
  sel = { x: 0.15, y: 0.35, w: 0.7, h: 0.35 };
  $('cropBox').hidden = false;
  $('prog').hidden = true;
  showWork();
}
function viaImg(file) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(file),
      im = new Image();
    im.onload = function () {
      URL.revokeObjectURL(u);
      res(im);
    };
    im.onerror = function () {
      URL.revokeObjectURL(u);
      rej(new Error('image illisible'));
    };
    im.src = u;
  });
}
// Photo tournée de deg degrés autour de son centre, dans un canevas agrandi pour n'en rien perdre ; échelle s.
// Les coins laissés vides prennent la teinte moyenne de la photo, pour ne pas fausser le contraste de la lecture.
function rotDimsOf(img, deg) {
  const a = (deg * Math.PI) / 180,
    c = Math.abs(Math.cos(a)),
    si = Math.abs(Math.sin(a));
  return { w: img.width * c + img.height * si, h: img.width * si + img.height * c };
}
function rotDims(deg) {
  return rotDimsOf(base, deg);
}
function meanColor(img) {
  const g = document.createElement('canvas').getContext('2d');
  g.canvas.width = g.canvas.height = 1;
  g.drawImage(img, 0, 0, 1, 1);
  return g.getImageData(0, 0, 1, 1).data;
}
export function rotateCanvas(img, deg, s) {
  const r = rotDimsOf(img, deg),
    c = document.createElement('canvas');
  s = s || 1;
  c.width = Math.max(1, Math.round(r.w * s));
  c.height = Math.max(1, Math.round(r.h * s));
  const g = c.getContext('2d');
  if (deg) {
    const m = meanColor(img);
    g.fillStyle = `rgb(${m[0]},${m[1]},${m[2]})`;
    g.fillRect(0, 0, c.width, c.height);
  }
  g.imageSmoothingQuality = 'high';
  g.translate(c.width / 2, c.height / 2);
  g.rotate((deg * Math.PI) / 180);
  g.scale(s, s);
  g.drawImage(img, -img.width / 2, -img.height / 2);
  return c;
}
function drawRotated(deg, s) {
  return rotateCanvas(base, deg, s);
}
export function getWork() {
  if (!work) work = angle ? drawRotated(angle, 1) : base;
  return work;
}
export function hasPhoto() {
  return !!base;
}
export function photoSize() {
  return orig ? { w: orig.width, h: orig.height } : null;
}
export function photoGen() {
  return gen;
}
function showWork(keep) {
  // affichage assez fin pour rester net une fois zoomé
  const r = rotDims(angle),
    s = Math.min(1, 2000 / Math.max(r.w, r.h)),
    c = drawRotated(angle, s);
  cv.width = c.width;
  cv.height = c.height;
  cv.getContext('2d').drawImage(c, 0, 0);
  if (!keep) view = { z: 1, tx: 0, ty: 0 };
  applyView();
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
// taille de la photo à l'écran sans zoom (le zoom est une transformation, il ne change pas la mise en page)
function dims() {
  return { W: cv.offsetWidth || 1, H: cv.offsetHeight || 1 };
}
function applyView() {
  const d = dims();
  view.z = clamp(view.z, 1, ZMAX);
  view.tx = clamp(view.tx, d.W - d.W * view.z, 0);
  view.ty = clamp(view.ty, d.H - d.H * view.z, 0);
  cv.style.transform = `translate(${view.tx}px,${view.ty}px) scale(${view.z})`;
  $('zOut').disabled = view.z <= 1;
  $('zIn').disabled = view.z >= ZMAX;
  drawSel();
  drawQuad();
}
// cadre en coordonnées de la photo (0 à 1), placé à l'écran selon le zoom
function drawSel() {
  const d = dims(),
    kx = d.W * view.z,
    ky = d.H * view.z;
  selEl.style.left = `${view.tx + sel.x * kx}px`;
  selEl.style.top = `${view.ty + sel.y * ky}px`;
  selEl.style.width = `${sel.w * kx}px`;
  selEl.style.height = `${sel.h * ky}px`;
}
function local(e) {
  const r = stage.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
// zoom vers z en gardant immobile le point p de l'écran
function zoomAt(z, p) {
  const nz = clamp(z, 1, ZMAX);
  view.tx = p.x - ((p.x - view.tx) * nz) / view.z;
  view.ty = p.y - ((p.y - view.ty) * nz) / view.z;
  view.z = nz;
  applyView();
}
// centre du cadre à l'écran (ramené dans la photo visible) : les boutons zooment vers lui
function selCenter() {
  const d = dims();
  return {
    x: clamp(view.tx + (sel.x + sel.w / 2) * d.W * view.z, 0, d.W),
    y: clamp(view.ty + (sel.y + sel.h / 2) * d.H * view.z, 0, d.H)
  };
}
// Redressement : la photo tourne de nd degrés ; le cadre reste sur le même endroit de la photo, au même endroit de l'écran
const TILT = 45;
export function setAngle(nd) {
  nd = clamp(Math.round(nd * 10) / 10, -TILT, TILT);
  if (!base || nd === angle) {
    showAngle();
    return;
  }
  const o = rotDims(angle);
  const n = rotDims(nd);
  let d = dims();
  const a = ((nd - angle) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  let mx = sel.x + sel.w / 2;
  let my = sel.y + sel.h / 2;
  const sp = { x: view.tx + mx * d.W * view.z, y: view.ty + my * d.H * view.z };
  const cx = (mx - 0.5) * o.w,
    cy = (my - 0.5) * o.h,
    w = Math.min(1, (sel.w * o.w) / n.w),
    h = Math.min(1, (sel.h * o.h) / n.h);
  mx = (cx * c - cy * s) / n.w + 0.5;
  my = (cx * s + cy * c) / n.h + 0.5;
  sel = { x: clamp(mx - w / 2, 0, 1 - w), y: clamp(my - h / 2, 0, 1 - h), w, h };
  angle = nd;
  work = null;
  showAngle();
  showWork(true);
  d = dims();
  view.tx = sp.x - (sel.x + sel.w / 2) * d.W * view.z;
  view.ty = sp.y - (sel.y + sel.h / 2) * d.H * view.z;
  applyView();
}
export function getAngle() {
  return angle;
}
function showAngle() {
  $('tilt').value = angle;
  $('tVal').textContent = `${(angle > 0 ? '+' : angle < 0 ? '−' : '') + String(Math.abs(angle)).replace('.', ',')}°`;
}
// lignes horizontales sur la photo pendant le réglage, pour aligner le texte à l'œil
let guideT;
function guides() {
  stage.classList.add('leveling');
  clearTimeout(guideT);
  guideT = setTimeout(() => {
    stage.classList.remove('leveling');
  }, 1500);
}
// Niveaux de gris du cadre box (fractions) de img, à la taille de la photo ou en dessous (jamais agrandi : l'agrandissement
// floute les contours et fausse les mesures), maxW pixels de large au plus. Retour : { g, w, h, k : échelle appliquée }
export function grayOf(img, box, maxW) {
  const b = box || { x: 0, y: 0, w: 1, h: 1 },
    sx = b.x * img.width,
    sy = b.y * img.height,
    sw = Math.max(8, b.w * img.width),
    sh = Math.max(8, b.h * img.height);
  const k = Math.min(1, (maxW || 800) / Math.max(sw, sh)),
    c = document.createElement('canvas');
  c.width = Math.round(sw * k);
  c.height = Math.round(sh * k);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return { g: toGray(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height), w: c.width, h: c.height, k };
}
// Inclinaison du texte dans le cadre de img : { deg, gain }
export function leanIn(img, box, max) {
  const G = grayOf(img, box, 800);
  return skewAngle(G.g, G.w, G.h, max);
}
function autoLevel() {
  if (!base) return;
  const r = leanIn(getWork(), sel, TILT);
  if (r.gain < AUTO_GAIN) {
    flash($('tAuto'), 'Pas net');
    return;
  }
  if (Math.abs(r.deg) < 0.3) {
    flash($('tAuto'), 'Déjà droit');
    return;
  }
  setAngle(angle - r.deg);
  guides();
}
function two() {
  const p = Array.from(ptrs.values());
  return {
    d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1,
    m: { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }
  };
}

// ---------- Perspective ----------
// Mode de la scène : 'frame' (cadre de lecture, réglette d'inclinaison) ou 'persp' (quatre coins sur les bords de l'écran)
let mode = 'frame';
export function setMode(m) {
  mode = m;
  $('cropBox').classList.toggle('persp', m === 'persp');
  if (m === 'persp' && !quad) defaultQuad();
  drawQuad();
}
export function getMode() {
  return mode;
}
function defaultQuad() {
  const w = base.width,
    h = base.height;
  quad = [
    [w * 0.1, h * 0.1],
    [w * 0.9, h * 0.1],
    [w * 0.9, h * 0.9],
    [w * 0.1, h * 0.9]
  ];
}
// coins (pixels de base, photo non tournée) placés à l'écran : en mode perspective la réglette est à 0
function drawQuad() {
  const svg = $('quadSvg');
  if (!svg || !base || mode !== 'persp' || !quad) {
    if (svg) svg.setAttribute('hidden', ''); // un élément SVG n'a pas de propriété hidden

    stage.querySelectorAll('.qh').forEach((h) => {
      h.hidden = true;
    });
    return;
  }
  const d = dims(),
    kx = (d.W * view.z) / base.width,
    ky = (d.H * view.z) / base.height,
    pts = quad.map((p) => [view.tx + p[0] * kx, view.ty + p[1] * ky]);
  svg.removeAttribute('hidden');
  svg.setAttribute('viewBox', `0 0 ${d.W} ${d.H}`);
  $('quadPoly').setAttribute('points', pts.map((p) => `${p[0]},${p[1]}`).join(' '));
  stage.querySelectorAll('.qh').forEach((h) => {
    const p = pts[+h.dataset.q];
    h.hidden = false;
    h.style.left = `${p[0]}px`;
    h.style.top = `${p[1]}px`;
  });
}
// Cadre de l'écran trouvé dans la photo : { quad, gain, tilt, cover } ou null
export function detectQuadIn(img) {
  const G = grayOf(img, null, 480),
    q = findQuad(G.g, G.w, G.h);
  if (!q) return null;
  q.quad = q.quad.map((p) => [p[0] / G.k, p[1] / G.k]);
  return q;
}
export function detectQuad() {
  return base ? detectQuadIn(base) : null;
}
export function setQuad(q) {
  quad = q;
  drawQuad();
}
export function getQuad() {
  return quad;
}
// La photo d'origine redressée : le quadrilatère q (pixels de orig) devient un rectangle, avec une marge de 3 %
// autour pour ne rien perdre si un bord est un peu à côté. Les pixels hors photo prennent sa teinte moyenne.
export function warpCanvas(img, q, max) {
  const src = grow(q, 0.03),
    r = rectFor(src, max || 2400),
    H = homography(src, [
      [0, 0],
      [r.w, 0],
      [r.w, r.h],
      [0, r.h]
    ]),
    Hi = H && invert(H);
  if (!Hi) return null;
  const g = img.getContext('2d', { willReadFrequently: true }),
    d = g.getImageData(0, 0, img.width, img.height),
    m = meanColor(img),
    out = warp(d.data, img.width, img.height, 4, Hi, r.w, r.h, [m[0], m[1], m[2], 255]);
  const c = document.createElement('canvas');
  c.width = r.w;
  c.height = r.h;
  c.getContext('2d').putImageData(new ImageData(out, r.w, r.h), 0, 0);
  return c;
}
export function applyQuad(q) {
  if (!orig || !q) return false;
  const c = warpCanvas(orig, q, 2400);
  if (!c) return false;
  base = c;
  quad = q;
  angle = 0;
  work = null;
  gen++;
  showAngle();
  sel = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
  setMode('frame');
  showWork();
  return true;
}
export function hasQuad() {
  return base !== orig;
}
// Retour à la photo d'origine (perspective annulée)
export function resetQuad() {
  if (!orig || base === orig) return;
  base = orig;
  angle = 0;
  work = null;
  gen++;
  showAngle();
  sel = { x: 0.15, y: 0.35, w: 0.7, h: 0.35 };
  showWork();
}

// Un doigt : coin = redimensionner, intérieur du cadre = déplacer, coin de perspective = le déplacer, ailleurs = faire
// glisser la photo zoomée. Deux doigts : zoom, sans toucher au cadre. Rien ne bouge avant DEAD px.
function initCrop() {
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.zoombar')) return;
    ptrs.set(e.pointerId, local(e));
    try {
      stage.setPointerCapture(e.pointerId);
    } catch (err) {}
    e.preventDefault();
    if (ptrs.size === 2) {
      // second doigt : le geste du premier sur le cadre est annulé, place au zoom
      if (drag && drag.s) {
        sel = drag.s;
        drawSel();
      }
      if (drag && drag.q) {
        quad = drag.q;
        drawQuad();
      }
      const t = two();
      drag = { mode: 'pinch', d0: t.d, m0: t.m, z0: view.z, tx0: view.tx, ty0: view.ty };
      return;
    }
    if (ptrs.size > 2) return;
    const qh = e.target.closest('.qh');
    const md = qh ? 'quad' : e.target.dataset.h || (e.target === selEl ? 'move' : 'pan');
    drag = {
      mode: md,
      qi: qh ? +qh.dataset.q : -1,
      p0: local(e),
      s: { x: sel.x, y: sel.y, w: sel.w, h: sel.h },
      q: quad && quad.map((p) => p.slice()),
      tx0: view.tx,
      ty0: view.ty,
      live: false
    };
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || !ptrs.has(e.pointerId)) return;
    const p = local(e);
    ptrs.set(e.pointerId, p);
    if (drag.mode === 'pinch') {
      if (ptrs.size < 2) return;
      const t = two(),
        nz = clamp((drag.z0 * t.d) / drag.d0, 1, ZMAX);
      // le point de la photo sous les doigts au départ suit le milieu des doigts
      view.tx = t.m.x - ((drag.m0.x - drag.tx0) * nz) / drag.z0;
      view.ty = t.m.y - ((drag.m0.y - drag.ty0) * nz) / drag.z0;
      view.z = nz;
      applyView();
      return;
    }
    if (ptrs.size > 1 || !drag.s) return;
    const dx = p.x - drag.p0.x,
      dy = p.y - drag.p0.y;
    if (!drag.live) {
      if (Math.hypot(dx, dy) < DEAD) return;
      drag.live = true;
      drag.p0 = p;
      return; // départ du geste ici : pas de saut
    }
    if (drag.mode === 'pan') {
      view.tx = drag.tx0 + dx;
      view.ty = drag.ty0 + dy;
      applyView();
      return;
    }
    const d = dims();
    if (drag.mode === 'quad') {
      const q0 = drag.q[drag.qi];
      quad[drag.qi] = [
        clamp(q0[0] + (dx * base.width) / (d.W * view.z), -base.width * 0.1, base.width * 1.1),
        clamp(q0[1] + (dy * base.height) / (d.H * view.z), -base.height * 0.1, base.height * 1.1)
      ];
      drawQuad();
      return;
    }
    const s = drag.s,
      ux = dx / (d.W * view.z),
      uy = dy / (d.H * view.z);
    if (drag.mode === 'move') {
      sel.x = clamp(s.x + ux, 0, 1 - s.w);
      sel.y = clamp(s.y + uy, 0, 1 - s.h);
    } else {
      // coin : seul le coin tenu bouge, le cadre ne se retourne pas et garde une taille minimale
      let x0 = s.x,
        y0 = s.y,
        x1 = s.x + s.w,
        y1 = s.y + s.h;
      if (drag.mode.charAt(1) === 'l') x0 = clamp(s.x + ux, 0, x1 - MIN_SIDE);
      else x1 = clamp(x1 + ux, x0 + MIN_SIDE, 1);
      if (drag.mode.charAt(0) === 't') y0 = clamp(s.y + uy, 0, y1 - MIN_SIDE);
      else y1 = clamp(y1 + uy, y0 + MIN_SIDE, 1);
      sel = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    drawSel();
  });
  ['pointerup', 'pointercancel'].forEach((ev) => {
    stage.addEventListener(ev, (e) => {
      ptrs.delete(e.pointerId);
      // après un zoom à deux doigts, le doigt qui reste ne fait rien jusqu'à ce qu'il soit levé
      if (!ptrs.size) drag = null;
      else if (drag && drag.mode === 'pinch') drag = { mode: 'none' };
    });
  });
  stage.addEventListener(
    'wheel',
    (e) => {
      if (!base) return;
      e.preventDefault();
      zoomAt(view.z * (e.deltaY < 0 ? 1.25 : 0.8), local(e));
    },
    { passive: false }
  );
  $('zIn').addEventListener('click', () => {
    zoomAt(view.z * 1.6, selCenter());
  });
  $('zOut').addEventListener('click', () => {
    zoomAt(view.z / 1.6, selCenter());
  });
  window.addEventListener('resize', () => {
    if (base && !$('cropBox').hidden) applyView();
  });
  $('rot').addEventListener('click', () => {
    if (!base) return;
    const c = document.createElement('canvas');
    c.width = orig.height;
    c.height = orig.width;
    const g = c.getContext('2d');
    g.translate(c.width, 0);
    g.rotate(Math.PI / 2);
    g.drawImage(orig, 0, 0);
    orig = base = c;
    gen++;
    angle = 0;
    work = null;
    quad = null;
    showAngle();
    sel = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
    setMode('frame');
    showWork();
  });
  // réglette : rendu au plus une fois par image affichée ; boutons : pas d'un demi-degré
  let pend = null;
  $('tilt').addEventListener('input', (e) => {
    guides();
    if (pend === null)
      requestAnimationFrame(() => {
        const v = pend;
        pend = null;
        setAngle(v);
      });
    pend = +e.target.value;
  });
  $('tL').addEventListener('click', () => {
    setAngle(angle - 0.5);
    guides();
  });
  $('tR').addEventListener('click', () => {
    setAngle(angle + 0.5);
    guides();
  });
  $('tAuto').addEventListener('click', autoLevel);
  $('cropAll').addEventListener('click', () => {
    sel = { x: 0, y: 0, w: 1, h: 1 };
    view = { z: 1, tx: 0, ty: 0 };
    applyView();
  });
  $('cropClose').addEventListener('click', () => {
    $('cropBox').hidden = true;
  });
  $('reCrop').addEventListener('click', () => {
    openStage('frame');
  });
  $('zoneClose').addEventListener('click', () => {
    $('cropBox').hidden = true;
  });
  $('cam').addEventListener('change', (e) => {
    loadFile(e.target.files[0]);
    e.target.value = '';
  });
  $('gal').addEventListener('change', (e) => {
    const fs = Array.from(e.target.files || []);
    e.target.value = '';
    // plusieurs photos (ou un lot déjà ouvert) : le lot les prend ; sinon la photo seule
    if (!filesCb(fs)) loadFile(fs[0]);
  });
}
// Scène visible, dans le mode demandé, cadrage à la place de la zone lue
export function openStage(m) {
  if (!base) return;
  $('cropBox').hidden = false;
  $('cropBox').classList.remove('read');
  $('zoneView').hidden = true;
  if (m === 'persp' && angle) setAngle(0); // les coins se posent sur la photo non tournée
  setMode(m || 'frame');
  applyView();
  $('cropBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
export function getSel() {
  return { x: sel.x, y: sel.y, w: sel.w, h: sel.h };
}
export function setSel(s) {
  sel = {
    x: clamp(s.x, 0, 1),
    y: clamp(s.y, 0, 1),
    w: clamp(s.w, MIN_SIDE, 1 - clamp(s.x, 0, 1)),
    h: clamp(s.h, MIN_SIDE, 1 - clamp(s.y, 0, 1))
  };
  view = { z: 1, tx: 0, ty: 0 };
  applyView();
}
export function getEnh() {
  return { contrast: enh.contrast, sharp: enh.sharp };
}
export function setEnh(e) {
  enh = { contrast: e.contrast || 1, sharp: e.sharp === undefined ? null : e.sharp };
}

// Image préparée pour la lecture : cadre (box) de l'image img, agrandi vers targetW pixels, niveaux de gris étirés,
// contraste et netteté selon enh (netteté choisie d'elle-même si enh.sharp est null : d'après le flou du cadre à sa
// taille réelle), pad : marge blanche autour du texte, shrink : réduction permise (lecture de toute la photo).
// Retour : { c : canevas, p : réglages appliqués }
export function prepared(img, box, targetW, pad, shrink) {
  const sx = Math.round(box.x * img.width),
    sy = Math.round(box.y * img.height),
    sw = Math.max(8, Math.round(box.w * img.width)),
    sh = Math.max(8, Math.round(box.h * img.height));
  const k = Math.max(shrink ? 0.1 : 1, Math.min(8, targetW / sw));
  const c = document.createElement('canvas');
  c.width = Math.round(sw * k);
  c.height = Math.round(sh * k);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height),
    gray = toGray(d.data, c.width, c.height),
    b = stretchBounds(gray),
    p = { lo: b.lo, hi: b.hi, contrast: enh.contrast, sharp: enh.sharp };
  if (p.sharp === null) {
    const G = grayOf(img, box, 800);
    p.sharp = autoParams(G.g, G.w, G.h).sharp;
  }
  const out = enhance(gray, c.width, c.height, p, Math.max(2, Math.round(k * 1.5)));
  for (let i = 0; i < out.length; i++) d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = out[i];
  g.putImageData(d, 0, 0);
  if (!pad) return { c, p };
  const m = Math.round(c.height / 4),
    o = document.createElement('canvas');
  o.width = c.width + 2 * m;
  o.height = c.height + 2 * m;
  const go = o.getContext('2d');
  go.fillStyle = '#fff';
  go.fillRect(0, 0, o.width, o.height);
  go.drawImage(c, m, m);
  return { c: o, p };
}

// Zone lue pour l'œil : exactement le cadre lu, plus net (masque flou), contraste en S
function zoneImage(img, box) {
  const c = prepared(img, box, 1400, 0).c,
    W = c.width,
    H = c.height,
    g = c.getContext('2d'),
    d = g.getImageData(0, 0, W, H),
    p = d.data,
    gray = toGray(p, W, H),
    sharp = enhance(gray, W, H, { lo: 0, hi: 255, contrast: 1, sharp: 1.2 }, Math.max(2, Math.round(W / 300)));
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round(255 / (1 + Math.exp(-(v - 128) / 30)));
  for (let i = 0; i < sharp.length; i++) p[i * 4] = p[i * 4 + 1] = p[i * 4 + 2] = lut[sharp[i]];
  g.putImageData(d, 0, 0);
  return c;
}
export function readZone() {
  return zone;
}
// zone oubliée (nouvelle photo, texte effacé, autre point) ; le cadrage revient
export function clearZone() {
  zone = null;
  $('cropBox').classList.remove('read');
  $('zoneView').hidden = true;
}
export function showZone(z) {
  zone = z;
  const c = $('zoneCv');
  c.width = z.width;
  c.height = z.height;
  c.getContext('2d').drawImage(z, 0, 0);
  $('cropBox').hidden = false;
  $('cropBox').classList.add('read');
  $('zoneView').hidden = false;
}

function loadScript(u) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = u;
    s.onload = res;
    s.onerror = rej;
    document.head.appendChild(s);
  });
}
// Chien de garde : Tesseract ne signale pas toujours un moteur qui ne se charge pas ; sans aucun progrès pendant STALL ms, échec
const STALL = 60000;
// Moteurs de lecture : le premier sert à la photo affichée, les suivants au lot de photos (lectures en parallèle)
const workers = [];
export function workerCount() {
  const n = (navigator.hardwareConcurrency || 2) - 1;
  return Math.max(1, Math.min(3, n));
}
export function getWorker(i) {
  i = i || 0;
  if (workers[i]) return workers[i];
  let timer;
  let settled = false;
  const kick = function (fail) {
    if (settled) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      fail(new Error('bloqué'));
    }, STALL);
  };
  const pr = new Promise((resolve, reject) => {
    kick(reject);
    (window.Tesseract ? Promise.resolve() : loadScript(TESS.lib))
      .then(() =>
        Tesseract.createWorker('eng', 1, {
          workerPath: TESS.worker,
          workerBlobURL: false,
          corePath: abs(TESS.core),
          langPath: abs(TESS.lang),
          logger(m) {
            kick(reject);
            if (!i) progCb(m);
          }
        })
      )
      .then(resolve, reject);
  });
  workers[i] = pr;
  pr.then(
    () => {
      settled = true;
      clearTimeout(timer);
    },
    () => {
      settled = true;
      clearTimeout(timer);
      workers[i] = null;
    }
  );
  return pr;
}
const LBL = {
  'loading tesseract core': 'Chargement du moteur',
  'initializing tesseract': 'Initialisation',
  'loading language traineddata': 'Chargement de la langue',
  'initializing api': 'Initialisation',
  'recognizing text': 'Lecture du texte'
};
// Suivi d'avancement : onProg(texte, fraction 0 à 1)
export function setProgress(onProg, label) {
  progCb = function (m) {
    onProg(
      `${(LBL[m.status] || 'Préparation') + (m.status === 'recognizing text' && label ? ` · ${label}` : '')}...`,
      m.progress
    );
  };
}

// ---------- Vote entre lectures ----------
// Chaque lecture (passe de PASSES) vote séparément pour sa latitude et sa longitude : une lecture qui rate la latitude
// peut encore confirmer la longitude. Groupe de vote : { v : valeur retenue, w : poids cumulé, n : nombre de lectures,
// runs : indices des lectures, vals : poids par valeur exacte }. Les valeurs à moins de TOL degré votent ensemble.
function addVote(list, v, w, idx) {
  let o = null;
  for (let i = 0; i < list.length; i++)
    if (Math.abs(list[i].v - v) < TOL) {
      o = list[i];
      break;
    }
  if (!o) {
    o = { v, w: 0, n: 0, runs: [], vals: {} };
    list.push(o);
  }
  o.w += w;
  o.n++;
  o.runs.push(idx);
  const k = v.toFixed(6);
  o.vals[k] = (o.vals[k] || 0) + w;
  // valeur retenue pour le groupe : la plus lue
  o.v = +Object.keys(o.vals).sort((a, b) => o.vals[b] - o.vals[a])[0];
}
// runs : [{ txt, p : résultat de parse() }]. Une lecture hors zone d'intervention ne vote pas ; une lecture avec
// avertissements vote pour 0,6. Retour : pour chaque axe, le groupe en tête (best) et son suivant (second), par poids.
export function votes(runs) {
  const V = { lat: [], lon: [] };
  runs.forEach((r, idx) => {
    if (!r.p.ok) return;
    const b = r.p.best;
    if (!inRegion(b.lat, b.lon)) return;
    const w = b.notes.length ? 0.6 : 1;
    addVote(V.lat, b.lat, w, idx);
    addVote(V.lon, b.lon, w, idx);
  });
  const win = function (list) {
    const s = list.slice().sort((a, b) => b.w - a.w);
    return { best: s[0] || null, second: s[1] || null };
  };
  return { lat: win(V.lat), lon: win(V.lon) };
}
// Axe confirmé : au moins NEED lectures d'accord, et 2 de plus que la valeur concurrente
export function firm(x) {
  return x.best && x.best.n >= NEED && (!x.second || x.second.n <= x.best.n - 2);
}

// Lecture pleine image (mode texte épars), pour trouver où sont les coordonnées : { lines, text } (lignes avec mots,
// boîtes en pixels de img et confiances). stale() : vrai si la photo a changé entre-temps.
export function recognizeFull(img, stale, wi) {
  const pr = prepared(img, { x: 0, y: 0, w: 1, h: 1 }, FULL_W, 0, true),
    k = pr.c.width / img.width;
  const fix = function (b) {
    return { x0: b.x0 / k, y0: b.y0 / k, x1: b.x1 / k, y1: b.y1 / k };
  };
  return getWorker(wi).then((w) => {
    if (stale()) return null;
    return w
      .setParameters({ tessedit_pageseg_mode: '11' })
      .then(() => w.recognize(pr.c, {}, OUT))
      .then((r) => {
        const lines = [];
        (r.data.blocks || []).forEach((bl) => {
          (bl.paragraphs || []).forEach((pa) => {
            (pa.lines || []).forEach((l) => {
              lines.push({
                text: l.text,
                confidence: l.confidence,
                bbox: fix(l.bbox),
                words: (l.words || []).map((wd) => ({ text: wd.text, confidence: wd.confidence, bbox: fix(wd.bbox) }))
              });
            });
          });
        });
        if (!lines.length && r.data.lines)
          r.data.lines.forEach((l) => {
            lines.push({
              text: l.text,
              confidence: l.confidence,
              bbox: fix(l.bbox),
              words: (l.words || []).map((wd) => ({ text: wd.text, confidence: wd.confidence, bbox: fix(wd.bbox) }))
            });
          });
        return { lines, text: r.data.text || '', p: pr.p };
      });
  });
}

/**
 * Lecture du cadre box de img : passes successives (PASSES) jusqu'à NEED lectures concordantes, vote entre lectures.
 * onPass(i) : passe en cours ; stale() : la photo a changé. Retour (promesse) :
 * { runs, v : votes, text, p : résultat retenu (notes, alts et agree ajustés), sure : les deux axes confirmés,
 *   rival : une valeur concurrente aussi lue, tess : confiance moyenne du moteur sur les mots de la lecture retenue,
 *   none : aucune coordonnée dans aucune lecture, enh : réglages appliqués }
 */
export function readBox(img, box, onPass, stale, wi) {
  const imgs = {};
  const runs = [];
  let p0 = null;
  const done = function () {
    const v = votes(runs);
    return firm(v.lat) && firm(v.lon);
  };
  return getWorker(wi).then((w) => {
    let i = 0;
    const step = function () {
      if (i >= PASSES.length || done() || stale()) return;
      const ps = PASSES[i++],
        ik = `${ps[0]}_${ps[1]}`;
      onPass(i);
      if (!imgs[ik]) {
        const pr = prepared(img, box, ps[0], ps[1]);
        imgs[ik] = pr.c;
        p0 = p0 || pr.p;
      }
      return w
        .setParameters({ tessedit_pageseg_mode: ps[2] })
        .then(() => w.recognize(imgs[ik], {}, OUT))
        .then((r) => {
          const txt = (r.data.text || '').trim();
          let words = [];
          (r.data.blocks || []).forEach((bl) => {
            (bl.paragraphs || []).forEach((pa) => {
              (pa.lines || []).forEach((l) => {
                (l.words || []).forEach((wd) => {
                  words.push({ text: wd.text, confidence: wd.confidence });
                });
              });
            });
          });
          if (!words.length && r.data.words) words = r.data.words;
          runs.push({ txt, p: parse(txt), words });
        })
        .then(step);
    };
    return step().then(() => {
      if (stale()) return null;
      return settle(runs, p0);
    });
  });
}
// Résultat d'une série de lectures (voir readBox)
export function settle(runs, enhUsed) {
  const v = votes(runs),
    total = runs.length,
    out = { runs, v, total, enh: enhUsed, rival: false, tess: null, sure: false, none: false };
  if (!v.lat.best || !v.lon.best) {
    const r0 = runs[0] || { txt: '', p: parse('') };
    out.text = r0.txt;
    out.p = r0.p;
    out.none = true;
    return out;
  }
  const LA = v.lat.best;
  const LO = v.lon.best;
  let text;
  let lastParse;
  let chosen = -1;
  // une lecture qui contient les deux valeurs gagnantes sert de texte de référence (de préférence exactement les valeurs retenues)
  const both = LA.runs.filter((x) => LO.runs.indexOf(x) >= 0);
  const rank = function (x) {
    const b = runs[x].p.best;
    return (
      (b.lat.toFixed(6) === LA.v.toFixed(6) ? 0 : 10) + (b.lon.toFixed(6) === LO.v.toFixed(6) ? 0 : 10) + b.notes.length
    );
  };
  both.sort((a, b) => rank(a) - rank(b));
  if (both.length) {
    chosen = both[0];
    text = runs[chosen].txt;
    lastParse = runs[chosen].p;
  } else {
    text = `${LA.v.toFixed(6)}, ${LO.v.toFixed(6)}`;
    lastParse = parse(text);
    if (lastParse.ok)
      lastParse.best.notes.push({ lvl: 'warn', t: 'Latitude et longitude prises dans deux lectures différentes.' });
  }
  const sure = firm(v.lat) && firm(v.lon);
  const rival = function (x) {
    return x.second && x.second.n >= x.best.n;
  };
  out.rival = !!(rival(v.lat) || rival(v.lon));
  if (lastParse.ok) {
    if (sure) {
      lastParse.best.notes = lastParse.best.notes.filter((x) => !/symbole|deux lectures/.test(x.t));
      lastParse.alts = [];
    } else {
      const alts = [];
      if (v.lat.second || v.lon.second) {
        const a2 = {
          lat: (v.lat.second || LA).v,
          lon: (v.lon.second || LO).v,
          seg: 'autre lecture',
          notes: [],
          fmt: lastParse.best.fmt
        };
        if (distM(a2, lastParse.best) > 5) alts.push(a2);
      }
      lastParse.alts = alts.concat(lastParse.alts).slice(0, 3);
      lastParse.best.notes.push({
        lvl: 'warn',
        t: `Lectures concordantes : latitude ${LA.n}/${total}, longitude ${LO.n}/${total}${
          out.rival ? ', avec des lectures concurrentes' : ''
        }. Comparez avec la photo.`
      });
    }
    lastParse.agree = { n: Math.min(LA.n, LO.n), total };
  }
  // confiance du moteur : mots porteurs de chiffres de la lecture retenue, sinon moyenne des lectures gagnantes
  const confOf = function (idx) {
    let cw = 0,
      cn = 0;
    (runs[idx].words || []).forEach((wd) => {
      if (typeof wd.confidence !== 'number' || !/\d/.test(wd.text || '')) return;
      const wgt = Math.max(1, wd.text.replace(/\s/g, '').length);
      cw += wd.confidence * wgt;
      cn += wgt;
    });
    return cn ? cw / cn : null;
  };
  if (chosen >= 0) out.tess = confOf(chosen);
  else {
    const cs = LA.runs
      .concat(LO.runs)
      .map(confOf)
      .filter((x) => x !== null);
    if (cs.length) out.tess = cs.reduce((a, b) => a + b, 0) / cs.length;
  }
  if (out.tess !== null) out.tess = Math.round(out.tess);
  out.text = text;
  out.p = lastParse;
  out.sure = sure;
  return out;
}
// Zone lue affichée pour vérification (après une lecture du cadre box de img)
export function showZoneOf(img, box) {
  try {
    showZone(zoneImage(img, box));
  } catch (err) {
    console.error('Zone lue :', err);
  }
}

// Préparation hors ligne : moteur et langue téléchargés une fois, gardés par le service worker
function prepareOffline() {
  const b = $('prepOff');
  b.disabled = true;
  $('prepMsg').textContent = 'Téléchargement du moteur de lecture (environ 7 Mo)...';
  // même choix que le worker de Tesseract : moteur le plus rapide que le téléphone sait exécuter
  const can = (bytes) => typeof WebAssembly === 'object' && WebAssembly.validate(new Uint8Array(bytes));
  const relaxed = can([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 15, 1, 13, 0, 65, 1, 253, 15, 65, 2, 253, 15,
    253, 128, 2, 11
  ]);
  const simd = can([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11
  ]);
  const urls = [
    TESS.lib,
    TESS.worker,
    `${TESS.core}/tesseract-core-${relaxed ? 'relaxedsimd-' : simd ? 'simd-' : ''}lstm.wasm.js`,
    `${TESS.lang}/eng.traineddata.gz`
  ];
  Promise.all(
    urls.map((u) =>
      fetch(u).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
    )
  )
    .then(() => getWorker())
    .then(() => {
      $('prepMsg').textContent = 'Prêt : la lecture de photo fonctionne maintenant sans réseau sur ce téléphone.';
      flash(b, 'Prêt');
    })
    .catch(() => {
      $('prepMsg').textContent = 'Échec du téléchargement : réessayez avec du réseau.';
    })
    .then(() => {
      b.disabled = false;
    });
}

// onPhoto(file) : appelé à chaque nouvelle photo chargée (auto.js enchaîne les étapes)
export function initOcr(onPhoto, onFiles) {
  cv = $('cv');
  stage = $('stage');
  selEl = $('sel');
  photoCb = onPhoto || photoCb;
  filesCb = onFiles || filesCb;
  initCrop();
  $('prepOff').addEventListener('click', prepareOffline);
}
