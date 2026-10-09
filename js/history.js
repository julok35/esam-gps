/* Historique des 10 derniers points (stockage local du téléphone). */
import { $, esc, f6 } from './util.js';

var KEY = 'esam-gps-hist', timer = null, pending = null;

export function loadHist() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }

function save(c, text) {
  var h = loadHist(), key = f6(c.lat) + ', ' + f6(c.lon);
  h = h.filter(function (x) { return x.k !== key; });
  h.unshift({ k: key, src: text.slice(0, 400), t: Date.now() });
  try { localStorage.setItem(KEY, JSON.stringify(h.slice(0, 10))); } catch (e) {}
  drawHist();
}

// Enregistrement différé : un point qui reste affiché 1,5 s
export function scheduleHist(c, text) {
  clearTimeout(timer); pending = { c: c, text: text };
  timer = setTimeout(flushHist, 1500);
}
export function flushHist() { clearTimeout(timer); if (pending) save(pending.c, pending.text); pending = null; }
export function cancelHist() { clearTimeout(timer); pending = null; }

export function drawHist() {
  var h = loadHist();
  $('histCard').hidden = !h.length;
  $('hist').innerHTML = h.map(function (x, i) {
    var d = new Date(x.t);
    var when = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return '<li><button type="button" data-hist="' + i + '"><span>' + esc(x.k) + '</span><small>' + esc(when) + '</small></button></li>';
  }).join('');
}
