/* Historique des 10 derniers points (stockage local du téléphone). */
import { $, esc, f6, fmtWhen } from './util.js';

// Stockage local (KEY) : tableau JSON, le plus récent d'abord, au plus 10 entrées
// { k : « lat, lon » à 6 décimales (sert aussi à dédoublonner), src : texte saisi ou lu (400 caractères max), t : date en ms }
const KEY = 'esam-gps-hist';
let timer = null;
let pending = null;

export function loadHist() {
  try {
    const h = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(h) ? h.filter((x) => x && typeof x.k === 'string' && typeof x.src === 'string') : [];
  } catch (e) {
    return [];
  }
}

function save(c, text) {
  let h = loadHist();
  const key = f6(c.lat) + ', ' + f6(c.lon);
  h = h.filter((x) => x.k !== key);
  h.unshift({ k: key, src: text.slice(0, 400), t: Date.now() });
  try {
    localStorage.setItem(KEY, JSON.stringify(h.slice(0, 10)));
  } catch (e) {}
  drawHist();
}

// Enregistrement différé : un point qui reste affiché 1,5 s
export function scheduleHist(c, text) {
  clearTimeout(timer);
  pending = { c, text };
  timer = setTimeout(flushHist, 1500);
}
export function flushHist() {
  clearTimeout(timer);
  if (pending) save(pending.c, pending.text);
  pending = null;
}
export function cancelHist() {
  clearTimeout(timer);
  pending = null;
}

export function drawHist() {
  const h = loadHist();
  $('histCard').hidden = !h.length;
  $('hist').innerHTML = h
    .map(
      (x, i) =>
        '<li><button type="button" data-hist="' +
        i +
        '"><span>' +
        esc(x.k) +
        '</span><small>' +
        esc(fmtWhen(x.t)) +
        '</small></button></li>'
    )
    .join('');
}
