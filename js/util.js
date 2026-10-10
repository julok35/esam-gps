/* Petits outils partagés : DOM, échappement, formats, copie. */
// Version affichée dans le bandeau ; doit suivre le cache V de sw.js (vérifié par les tests)
export var VERSION = '1.16';

export var $ = function (id) { return document.getElementById(id); };

export function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}
export function f6(v) { return v.toFixed(6); }
export function fmtDist(d) { return Math.round(d) < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(d < 10000 ? 2 : 1).replace('.', ',') + ' km'; }
export var CARD = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];

// État partagé entre les modules : point affiché et position du téléphone
export var state = { current: null, me: null };

export function flash(btn, txt) {
  var t = btn.innerHTML; btn.classList.add('done'); btn.textContent = txt || 'Copié';
  setTimeout(function () { btn.classList.remove('done'); btn.innerHTML = t; }, 1200);
}
export function copy(text, btn) {
  var ok = function () { flash(btn); };
  try { navigator.clipboard.writeText(text).then(ok, function () { fallback(text); ok(); }); } catch (e) { fallback(text); ok(); }
}
function fallback(text) {
  var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta);
}
