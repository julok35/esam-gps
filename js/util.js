/* Petits outils partagés : DOM, échappement, formats, copie. */
// Version affichée dans le bandeau ; doit suivre le cache V de sw.js (vérifié par les tests)
export const VERSION = '1.33';

export const $ = function (id) {
  return document.getElementById(id);
};

export function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
export function f6(v) {
  return v.toFixed(6);
}
export function fmtDist(d) {
  return Math.round(d) < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(d < 10000 ? 2 : 1).replace('.', ',')} km`;
}
export const CARD = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSO',
  'SO',
  'OSO',
  'O',
  'ONO',
  'NO',
  'NNO'
];

/**
 * État partagé entre les modules. current : point affiché (Candidate de parser.js, null sans résultat), écrit par
 * app.js ; me : position du téléphone (acc : précision en mètres), écrite par map.js à chaque relevé GPS.
 * Après un changement, appeler updateMap() (map.js), qui met à jour distance, dénivelé et boussole.
 * @type {{ current: import('./parser.js').Candidate | null, me: { lat: number, lon: number, acc: number } | null }}
 */
export const state = { current: null, me: null };

// Date et heure courtes : « 02/11 08:12 »
export function fmtWhen(t) {
  const d = new Date(t);
  return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit'
  })}`;
}

// Message bref à la place du contenu d'un bouton (« Copié »), 1,2 s. Un second message pendant le premier le
// remplace : le contenu d'origine, gardé une seule fois, revient après le dernier.
const flashing = new WeakMap();
export function flash(btn, txt) {
  let f = flashing.get(btn);
  if (f) clearTimeout(f.timer);
  else {
    f = { nodes: Array.from(btn.childNodes) };
    flashing.set(btn, f);
  }
  btn.classList.add('done');
  btn.textContent = txt || 'Copié';
  f.timer = setTimeout(() => {
    flashing.delete(btn);
    btn.classList.remove('done');
    btn.replaceChildren(...f.nodes);
  }, 1200);
}
// Copie puis message sur btn : « Copié », ou « Copie impossible » si le navigateur la refuse
export function copy(text, btn) {
  return clip(text).then((done) => {
    flash(btn, done ? 'Copié' : 'Copie impossible');
    return done;
  });
}
// Copie par un champ caché (navigateurs sans presse-papiers asynchrone) ; vrai si le navigateur dit avoir copié
export function execCopy(text) {
  let done = false;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    done = document.execCommand('copy');
  } catch (e) {}
  document.body.removeChild(ta);
  return !!done;
}
// Copie avec résultat : Promise<boolean>, presse-papiers asynchrone d'abord, champ caché ensuite
export function clip(text) {
  return new Promise((res) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          () => {
            res(true);
          },
          () => {
            res(execCopy(text));
          }
        );
        return;
      }
    } catch (e) {}
    res(execCopy(text));
  });
}

// Tuiles repliables : chacune garde son état (ouverte / repliée) sur ce téléphone
const TILES = 'esam-gps-tiles';
function tileState() {
  try {
    return JSON.parse(localStorage.getItem(TILES) || '{}');
  } catch (e) {
    return {};
  }
}
export function initTiles() {
  const st = tileState();
  document.querySelectorAll('details.tile').forEach((d) => {
    if (d.id in st) d.open = st[d.id];
    d.addEventListener('toggle', () => {
      const s = tileState();
      s[d.id] = d.open;
      try {
        localStorage.setItem(TILES, JSON.stringify(s));
      } catch (e) {}
    });
  });
}
// Ouvre la tuile qui contient un élément (avant d'y faire défiler l'écran)
export function openTile(id) {
  let d = $(id);
  d = d && d.closest('details');
  if (d && !d.open) d.open = true;
}
