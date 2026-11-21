/* Correction de la lecture à la main : chaque chiffre devient une molette, comme un cadenas à code. */
import { $, esc, f6 } from './util.js';
import { parse, toDMM, toDMS, toUTM, distM } from './parser.js';
import { readZone } from './ocr.js';

const STEP = 40; // hauteur d'un chiffre sur la molette (px), voir .wh dans app.css
const DIGITS = '0123456789';
const HEMI = { N: 'NS', S: 'NS', E: 'EO', O: 'EO' };
let rows = [],
  sel = null, // molette choisie : − et + agissent sur elle
  from = null,
  onApply = function () {};

function pad(s, w) {
  s = String(s);
  while (s.length < w) s = `0${s}`;
  return s;
}
function hemiDD(v, isLat) {
  return `${isLat ? (v < 0 ? 'S' : 'N') : v < 0 ? 'O' : 'E'} ${pad(Math.abs(v).toFixed(6), isLat ? 9 : 10)}`;
}

// Lignes à corriger, dans le format lu sur la photo (degrés sur 2 / 3 chiffres pour pouvoir tout changer)
function linesFor(c) {
  const f = c.fmt || '';
  if (/UTM/.test(f)) {
    const u = toUTM(c.lat, c.lon).split(' ');
    return [
      ['Zone', u[0]],
      ['Est', pad(u[1], 7)],
      ['Nord', pad(u[2], 7)]
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
  return [
    ['Latitude', hemiDD(c.lat, true)],
    ['Longitude', hemiDD(c.lon, false)]
  ];
}

// Un caractère : molette (chiffre, hémisphère) ou signe fixe
function cell(ch, hemi) {
  const opts = DIGITS.indexOf(ch) >= 0 ? DIGITS : hemi ? HEMI[ch] : null;
  if (!opts) return { ch };
  return { ch, orig: ch, opts, i: opts.indexOf(ch) };
}
function text() {
  return rows.map((r) => r.cells.map((c) => c.ch).join('')).join(' ');
}

function wheelHtml(c, ri, ci) {
  if (!c.opts) return `<span class="wst${c.ch === ' ' ? ' sp' : ''}">${esc(c.ch)}</span>`;
  const digit = c.opts === DIGITS;
  return (
    `<span class="wh${digit ? '' : ' hemi'}" role="spinbutton" tabindex="0" aria-label="${
      digit ? 'Chiffre' : 'Hémisphère'
    }" data-r="${ri}" data-c="${ci}">` + `<span class="wh-strip"><i></i><b></b><i></i></span></span>`
  );
}
function paint(el) {
  const c = rows[+el.dataset.r].cells[+el.dataset.c],
    n = c.opts.length,
    k = c.opts;
  const s = el.firstChild.children;
  s[0].textContent = k.charAt((c.i + n - 1) % n);
  s[1].textContent = c.ch;
  s[2].textContent = k.charAt((c.i + 1) % n);
  el.classList.toggle('chg', c.ch !== c.orig);
  el.setAttribute('aria-valuetext', c.ch);
}
// Choisir une molette : bien visible (bande jaune), et c'est sur elle qu'agissent − et +
function pick(el) {
  if (!el || el === sel) return;
  if (sel) {
    sel.classList.remove('on');
    sel.removeAttribute('aria-current');
  }
  sel = el;
  el.classList.add('on');
  el.setAttribute('aria-current', 'true');
}
function wheels() {
  return Array.from($('fixRows').querySelectorAll('.wh'));
}
function turn(el, by) {
  if (!el) return;
  const c = rows[+el.dataset.r].cells[+el.dataset.c],
    n = c.opts.length;
  c.i = (((c.i + by) % n) + n) % n;
  c.ch = c.opts.charAt(c.i);
  paint(el);
  preview();
}

// Résultat de la correction en direct ; Valider seulement si la valeur se relit
function preview() {
  const r = parse(text()),
    ok = r.ok && !r.alts.length,
    out = $('fixOut');
  $('fixOk').disabled = !ok;
  if (!ok) {
    out.className = 'fix-out bad';
    out.textContent = 'Valeur impossible : vérifiez les chiffres.';
    return;
  }
  const d = distM(from, r.best);
  out.className = 'fix-out';
  out.innerHTML = `<b>${f6(r.best.lat)}, ${f6(r.best.lon)}</b> <small>${
    d < 1
      ? 'inchangé'
      : `déplacé de ${d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1).replace('.', ',')} km`}`
  }</small>`;
}

function build() {
  $('fixRows').innerHTML = rows
    .map(
      (r, ri) =>
        `<div class="fix-row"><span class="fix-k">${esc(r.k)}</span><div class="whs">${r.cells
          .map((c, ci) => wheelHtml(c, ri, ci))
          .join('')}</div></div>`
    )
    .join('');
  $('fixRows').querySelectorAll('.wh').forEach(paint);
  sel = null;
  // au départ : le premier chiffre de la première ligne
  pick($('fixRows').querySelector('.wh:not(.hemi)'));
  preview();
}

export function openFix(c) {
  if (!c) return;
  from = c;
  const utm = /UTM/.test(c.fmt || ''); // en UTM, les lettres sont des bandes de latitude, pas des hémisphères
  rows = linesFor(c).map((l) => ({
    k: l[0],
    cells: l[1].split('').map((ch) => cell(ch, !utm))
  }));
  build();
  // zone lue sur la photo, juste au-dessus des molettes
  const z = readZone(),
    zc = $('fixZone');
  zc.hidden = !z;
  if (z) {
    zc.width = z.width;
    zc.height = z.height;
    zc.getContext('2d').drawImage(z, 0, 0);
  }
  $('fixCard').hidden = false;
  $('fixCard').open = true;
  $('fixCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
export function closeFix() {
  $('fixCard').hidden = true;
}

// Molette : la toucher la choisit ; glisser vers le haut fait monter le chiffre suivant (+1), vers le bas le
// précédent ; toucher le haut ou le bas d'une molette déjà choisie : un cran ; − et + sous les molettes, molette
// de souris et flèches du clavier aussi. Un toucher entre deux molettes choisit la plus proche.
function initWheels() {
  const box = $('fixRows');
  let g = null;
  box.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.wh');
    if (!el || g) return;
    g = { el, id: e.pointerId, y0: e.clientY, done: 0, moved: false, was: el === sel };
    pick(el);
    el.focus({ preventScroll: true });
    try {
      el.setPointerCapture(e.pointerId);
    } catch (err) {}
    el.classList.add('drag');
    e.preventDefault();
  });
  box.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    const dy = e.clientY - g.y0,
      steps = Math.round(-dy / STEP);
    if (Math.abs(dy) > 6) g.moved = true;
    if (steps !== g.done) {
      turn(g.el, steps - g.done);
      g.done = steps;
    }
    g.el.firstChild.style.transform = `translateY(${dy + g.done * STEP}px)`;
  });
  const end = function (e) {
    if (!g || e.pointerId !== g.id) return;
    const el = g.el;
    if (!g.moved && g.was && e.type === 'pointerup') {
      const r = el.getBoundingClientRect(),
        y = (e.clientY - r.top) / r.height;
      if (y < 0.36) turn(el, -1);
      else if (y > 0.64) turn(el, 1);
    }
    el.classList.remove('drag');
    el.firstChild.style.transform = '';
    g = null;
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  box.addEventListener('click', (e) => {
    const row = e.target.closest('.whs');
    if (!row || e.target.closest('.wh')) return;
    let best = null,
      bd = Infinity;
    for (const w of row.querySelectorAll('.wh')) {
      const r = w.getBoundingClientRect(),
        d = Math.abs(e.clientX - (r.left + r.right) / 2);
      if (d < bd) {
        bd = d;
        best = w;
      }
    }
    pick(best);
  });
  box.addEventListener('focusin', (e) => {
    if (e.target.classList.contains('wh')) pick(e.target);
  });
  box.addEventListener(
    'wheel',
    (e) => {
      const el = e.target.closest('.wh');
      if (!el) return;
      e.preventDefault();
      pick(el);
      turn(el, e.deltaY > 0 ? 1 : -1);
    },
    { passive: false }
  );
  box.addEventListener('keydown', (e) => {
    const el = e.target.closest('.wh');
    if (!el) return;
    if (e.key === 'ArrowUp') {
      turn(el, 1);
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      turn(el, -1);
      e.preventDefault();
    } else if (/^\d$/.test(e.key) && rows[+el.dataset.r].cells[+el.dataset.c].opts === DIGITS) {
      const c = rows[+el.dataset.r].cells[+el.dataset.c];
      turn(el, +e.key - c.i);
      const all = Array.from(box.querySelectorAll('.wh')),
        nx = all[all.indexOf(el) + 1];
      if (nx) nx.focus();
      e.preventDefault();
    }
  });
}

// apply(texte) : le texte corrigé remplace la lecture
export function initFix(apply) {
  onApply = apply;
  initWheels();
  $('fixMinus').addEventListener('click', () => turn(sel, -1));
  $('fixPlus').addEventListener('click', () => turn(sel, 1));
  const move = function (by) {
    const all = wheels(),
      i = all.indexOf(sel);
    pick(all[Math.max(0, Math.min(all.length - 1, i + by))]);
  };
  $('fixPrev').addEventListener('click', () => move(-1));
  $('fixNext').addEventListener('click', () => move(1));
  $('fixOk').addEventListener('click', () => {
    const t = text();
    closeFix();
    onApply(t);
  });
  $('fixReset').addEventListener('click', () => {
    openFix(from);
  });
  $('fixCancel').addEventListener('click', closeFix);
}
