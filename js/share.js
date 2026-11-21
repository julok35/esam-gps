/* Partage du point : message, partage natif, WhatsApp, QR code, et ce qui a été transmis. */
import { $, f6, copy, state } from './util.js';
import { toDMM } from './parser.js';
import { placeText } from './place.js';

let qrMode = 'app',
  sentFor = ''; // point (« lat,lon ») dont la transmission est affichée sous les boutons

function appUrl(c) {
  return `${location.origin + location.pathname}#${f6(c.lat)},${f6(c.lon)}`;
}
function mapsUrl(c) {
  return `https://www.google.com/maps/search/?api=1&query=${f6(c.lat)},${f6(c.lon)}`;
}
function message(c) {
  const p = placeText(c);
  return `Point ESAM\n${f6(c.lat)}, ${f6(c.lon)}\nDMM : ${toDMM(c.lat, true)} ${toDMM(c.lon, false)}${
    p ? `\n${p}` : ''
  }\nCarte : ${mapsUrl(c)}\nAppli GPS ESAM : ${appUrl(c)}`;
}

// Transmission faite : dite en clair sous les boutons et dans le résumé de la tuile repliée. Effacée dès qu'un autre
// point est affiché (drawQR, appelé à chaque point sûr affiché).
function hhmm() {
  return new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function keyOf(c) {
  return c ? `${f6(c.lat)},${f6(c.lon)}` : '';
}
function sent(how) {
  const c = state.current;
  if (!c) return;
  const t = hhmm();
  sentFor = keyOf(c);
  $('shareDone').textContent =
    how === 'wa'
      ? `${t} · WhatsApp ouvert avec le message : choisissez la conversation et envoyez.`
      : how === 'copied'
        ? `${t} · Message copié : collez-le dans la conversation.`
        : `${t} · Point partagé.`;
  $('shareDone').hidden = false;
  $('shareSum').textContent = how === 'wa' ? `WhatsApp ${t}` : how === 'copied' ? `copié ${t}` : `partagé ${t}`;
}
function unsent() {
  if (sentFor === keyOf(state.current)) return;
  sentFor = '';
  $('shareDone').hidden = true;
  $('shareDone').textContent = '';
  $('shareSum').textContent = '';
}

export function drawQR() {
  const current = state.current;
  unsent();
  if (!current || $('qrBox').hidden) return;
  const data =
    qrMode === 'app'
      ? appUrl(current)
      : qrMode === 'maps'
        ? mapsUrl(current)
        : `geo:${f6(current.lat)},${f6(current.lon)}`;
  if (typeof qrcode === 'undefined') {
    $('qrImg').innerHTML = '<p class="hint">QR indisponible (bibliothèque non chargée).</p>';
    return;
  }
  const q = qrcode(0, 'M');
  q.addData(data);
  q.make();
  $('qrImg').innerHTML = `<img alt="QR code du point" src="${q.createDataURL(8, 0)}">`;
  $('qrTxt').textContent =
    (qrMode === 'app'
      ? 'Ouvre cette appli sur le point. '
      : qrMode === 'maps'
        ? 'Ouvre Google Maps sur le point. '
        : 'Ouvre le point dans l’appli GPS du téléphone (lien « geo: », surtout Android). ') + data;
}

// Partage natif, sinon copie (btn affiche « Copié »). o.title : titre du partage (« Point ESAM » par défaut) ;
// o.done(how) : appelé une fois le texte parti, how = 'shared' (partage natif mené à son terme) ou 'copied'
export function shareText(text, btn, o) {
  const title = (o && o.title) || 'Point ESAM',
    done = (o && o.done) || function () {},
    copied = function () {
      copy(text, btn).then((ok) => {
        if (ok) done('copied');
      });
    };
  if (navigator.share)
    navigator.share({ title, text }).then(
      () => done('shared'),
      (e) => {
        if (e && e.name !== 'AbortError') copied();
      }
    );
  else copied();
}

// onUse : appelé quand le point est partagé (pour l'historique)
export function initShare(onUse) {
  $('qrBtn').addEventListener('click', () => {
    $('qrBox').hidden = !$('qrBox').hidden;
    $('qrBtn').setAttribute('aria-expanded', String(!$('qrBox').hidden));
    drawQR();
  });
  document.querySelectorAll('[data-qr]').forEach((b) => {
    b.addEventListener('click', () => {
      qrMode = b.dataset.qr;
      document.querySelectorAll('[data-qr]').forEach((x) => {
        x.classList.toggle('on', x === b);
        x.setAttribute('aria-pressed', String(x === b));
      });
      drawQR();
    });
  });
  $('shareBtn').addEventListener('click', () => {
    const current = state.current;
    if (!current) return;
    onUse();
    shareText(message(current), $('shareBtn'), { done: sent });
  });
  // WhatsApp : message prêt à envoyer, l'utilisateur choisit le contact ou le groupe
  $('waBtn').addEventListener('click', () => {
    if (!state.current) return;
    onUse();
    window.open(`https://wa.me/?text=${encodeURIComponent(message(state.current))}`, '_blank', 'noopener');
    sent('wa');
  });
  $('copyMsg').addEventListener('click', () => {
    if (state.current) {
      onUse();
      copy(message(state.current), $('copyMsg')).then((ok) => {
        if (ok) sent('copied');
      });
    }
  });
}
