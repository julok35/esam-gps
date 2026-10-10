/* Correction de la lecture à la main : chaque chiffre devient une molette, comme un cadenas à code. */
import { $, esc, f6 } from './util.js';
import { parse, toDMM, toDMS, toUTM, distM } from './parser.js';
import { readZone } from './ocr.js';

var STEP = 30; // hauteur d'un chiffre sur la molette (px), voir .wh dans app.css
var DIGITS = '0123456789';
var HEMI = { N: 'NS', S: 'NS', E: 'EO', O: 'EO' };
var rows = [], from = null, onApply = function () {};

function pad(s, w) { s = String(s); while (s.length < w) s = '0' + s; return s; }
function hemiDD(v, isLat) { return (isLat ? (v < 0 ? 'S' : 'N') : (v < 0 ? 'O' : 'E')) + ' ' + pad(Math.abs(v).toFixed(6), isLat ? 9 : 10); }

// Lignes à corriger, dans le format lu sur la photo (degrés sur 2 / 3 chiffres pour pouvoir tout changer)
function linesFor(c) {
  var f = c.fmt || '';
  if (/UTM/.test(f)) { var u = toUTM(c.lat, c.lon).split(' '); return [['Zone', u[0]], ['Est', pad(u[1], 7)], ['Nord', pad(u[2], 7)]]; }
  if (/DMS/.test(f)) return [['Latitude', toDMS(c.lat, true)], ['Longitude', toDMS(c.lon, false)]];
  if (/DMM|NMEA/.test(f)) return [['Latitude', toDMM(c.lat, true)], ['Longitude', toDMM(c.lon, false)]];
  return [['Latitude', hemiDD(c.lat, true)], ['Longitude', hemiDD(c.lon, false)]];
}

// Un caractère : molette (chiffre, hémisphère) ou signe fixe
function cell(ch, hemi) {
  var opts = DIGITS.indexOf(ch) >= 0 ? DIGITS : hemi ? HEMI[ch] : null;
  if (!opts) return { ch: ch };
  return { ch: ch, orig: ch, opts: opts, i: opts.indexOf(ch) };
}
function text() { return rows.map(function (r) { return r.cells.map(function (c) { return c.ch; }).join(''); }).join(' '); }

function wheelHtml(c, ri, ci) {
  if (!c.opts) return '<span class="wst' + (c.ch === ' ' ? ' sp' : '') + '">' + esc(c.ch) + '</span>';
  return '<span class="wh" role="spinbutton" tabindex="0" aria-label="' + (c.opts === DIGITS ? 'Chiffre' : 'Hémisphère') + '" data-r="' + ri + '" data-c="' + ci + '">'
    + '<span class="wh-strip"><i></i><b></b><i></i></span></span>';
}
function paint(el) {
  var c = rows[+el.dataset.r].cells[+el.dataset.c], n = c.opts.length, k = c.opts;
  var s = el.firstChild.children;
  s[0].textContent = k.charAt((c.i + n - 1) % n); s[1].textContent = c.ch; s[2].textContent = k.charAt((c.i + 1) % n);
  el.classList.toggle('chg', c.ch !== c.orig);
  el.setAttribute('aria-valuetext', c.ch);
}
function turn(el, by) {
  var c = rows[+el.dataset.r].cells[+el.dataset.c], n = c.opts.length;
  c.i = ((c.i + by) % n + n) % n; c.ch = c.opts.charAt(c.i);
  paint(el); preview();
}

// Résultat de la correction en direct ; Valider seulement si la valeur se relit
function preview() {
  var r = parse(text()), ok = r.ok && !r.alts.length, out = $('fixOut');
  $('fixOk').disabled = !ok;
  if (!ok) { out.className = 'fix-out bad'; out.textContent = 'Valeur impossible : vérifiez les chiffres.'; return; }
  var d = distM(from, r.best);
  out.className = 'fix-out';
  out.innerHTML = '<b>' + f6(r.best.lat) + ', ' + f6(r.best.lon) + '</b> <small>' + (d < 1 ? 'inchangé' : 'déplacé de ' + (d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1).replace('.', ',') + ' km')) + '</small>';
}

function build() {
  $('fixRows').innerHTML = rows.map(function (r, ri) {
    return '<div class="fix-row"><span class="fix-k">' + esc(r.k) + '</span><div class="whs">' + r.cells.map(function (c, ci) { return wheelHtml(c, ri, ci); }).join('') + '</div></div>';
  }).join('');
  $('fixRows').querySelectorAll('.wh').forEach(paint);
  preview();
}

export function openFix(c) {
  if (!c) return;
  from = c;
  var utm = /UTM/.test(c.fmt || ''); // en UTM, les lettres sont des bandes de latitude, pas des hémisphères
  rows = linesFor(c).map(function (l) { return { k: l[0], cells: l[1].split('').map(function (ch) { return cell(ch, !utm); }) }; });
  build();
  // zone lue sur la photo, juste au-dessus des molettes
  var z = readZone(), zc = $('fixZone');
  zc.hidden = !z;
  if (z) { zc.width = z.width; zc.height = z.height; zc.getContext('2d').drawImage(z, 0, 0); }
  $('fixCard').hidden = false; $('fixCard').open = true;
  $('fixCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
export function closeFix() { $('fixCard').hidden = true; }

// Molette : glisser vers le haut fait monter le chiffre suivant (+1), vers le bas le précédent ;
// toucher le haut ou le bas de la molette : un cran ; molette de souris et flèches du clavier aussi.
function initWheels() {
  var box = $('fixRows'), g = null;
  box.addEventListener('pointerdown', function (e) {
    var el = e.target.closest('.wh'); if (!el || g) return;
    g = { el: el, id: e.pointerId, y0: e.clientY, done: 0, moved: false };
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    el.classList.add('drag'); e.preventDefault();
  });
  box.addEventListener('pointermove', function (e) {
    if (!g || e.pointerId !== g.id) return;
    var dy = e.clientY - g.y0, steps = Math.round(-dy / STEP);
    if (Math.abs(dy) > 6) g.moved = true;
    if (steps !== g.done) { turn(g.el, steps - g.done); g.done = steps; }
    g.el.firstChild.style.transform = 'translateY(' + (dy + g.done * STEP) + 'px)';
  });
  var end = function (e) {
    if (!g || e.pointerId !== g.id) return;
    var el = g.el;
    if (!g.moved && e.type === 'pointerup') {
      var r = el.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
      if (y < 0.36) turn(el, -1); else if (y > 0.64) turn(el, 1);
    }
    el.classList.remove('drag'); el.firstChild.style.transform = '';
    g = null;
  };
  box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
  box.addEventListener('wheel', function (e) { var el = e.target.closest('.wh'); if (!el) return; e.preventDefault(); turn(el, e.deltaY > 0 ? 1 : -1); }, { passive: false });
  box.addEventListener('keydown', function (e) {
    var el = e.target.closest('.wh'); if (!el) return;
    if (e.key === 'ArrowUp') { turn(el, 1); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { turn(el, -1); e.preventDefault(); }
    else if (/^\d$/.test(e.key) && rows[+el.dataset.r].cells[+el.dataset.c].opts === DIGITS) {
      var c = rows[+el.dataset.r].cells[+el.dataset.c]; turn(el, +e.key - c.i);
      var all = Array.from(box.querySelectorAll('.wh')), nx = all[all.indexOf(el) + 1]; if (nx) nx.focus();
      e.preventDefault();
    }
  });
}

// apply(texte) : le texte corrigé remplace la lecture
export function initFix(apply) {
  onApply = apply;
  initWheels();
  $('fixOk').addEventListener('click', function () { var t = text(); closeFix(); onApply(t); });
  $('fixReset').addEventListener('click', function () { openFix(from); });
  $('fixCancel').addEventListener('click', closeFix);
}
