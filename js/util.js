/* Petits outils partagés : DOM, échappement, formats, copie. */
// Version affichée dans le bandeau ; doit suivre le cache V de sw.js (vérifié par les tests)
export var VERSION = '1.25';

export var $ = function (id) {
  return document.getElementById(id);
};

export function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
export function f6(v) {
  return v.toFixed(6);
}
export function fmtDist(d) {
  return Math.round(d) < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(d < 10000 ? 2 : 1).replace('.', ',') + ' km';
}
export var CARD = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];

/**
 * État partagé entre les modules. current : point affiché (Candidate de parser.js, null sans résultat), écrit par
 * app.js ; me : position du téléphone (acc : précision en mètres), écrite par map.js à chaque relevé GPS.
 * Après un changement, appeler updateMap() (map.js), qui met à jour distance, dénivelé et boussole.
 * @type {{ current: import('./parser.js').Candidate | null, me: { lat: number, lon: number, acc: number } | null }}
 */
export var state = { current: null, me: null };

export function flash(btn, txt) {
  var t = btn.innerHTML;
  btn.classList.add('done');
  btn.textContent = txt || 'Copié';
  setTimeout(function () {
    btn.classList.remove('done');
    btn.innerHTML = t;
  }, 1200);
}
export function copy(text, btn) {
  var ok = function () {
    flash(btn);
  };
  try {
    navigator.clipboard.writeText(text).then(ok, function () {
      fallback(text);
      ok();
    });
  } catch (e) {
    fallback(text);
    ok();
  }
}
function fallback(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } catch (e) {}
  document.body.removeChild(ta);
}

// Tuiles repliables : chacune garde son état (ouverte / repliée) sur ce téléphone
var TILES = 'esam-gps-tiles';
function tileState() {
  try {
    return JSON.parse(localStorage.getItem(TILES) || '{}');
  } catch (e) {
    return {};
  }
}
export function initTiles() {
  var st = tileState();
  document.querySelectorAll('details.tile').forEach(function (d) {
    if (d.id in st) d.open = st[d.id];
    d.addEventListener('toggle', function () {
      var s = tileState();
      s[d.id] = d.open;
      try {
        localStorage.setItem(TILES, JSON.stringify(s));
      } catch (e) {}
    });
  });
}
// Ouvre la tuile qui contient un élément (avant d'y faire défiler l'écran)
export function openTile(id) {
  var d = $(id);
  d = d && d.closest('details');
  if (d && !d.open) d.open = true;
}
