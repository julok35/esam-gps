/* Partage du point : message, partage natif, WhatsApp, QR code. */
import { $, f6, copy, state } from './util.js';
import { toDMM } from './parser.js';
import { placeText } from './place.js';

var qrMode = 'app';

function appUrl(c) {
  return location.origin + location.pathname + '#' + f6(c.lat) + ',' + f6(c.lon);
}
function mapsUrl(c) {
  return 'https://www.google.com/maps/search/?api=1&query=' + f6(c.lat) + ',' + f6(c.lon);
}
function message(c) {
  var p = placeText(c);
  return (
    'Point ESAM\n' +
    f6(c.lat) +
    ', ' +
    f6(c.lon) +
    '\nDMM : ' +
    toDMM(c.lat, true) +
    ' ' +
    toDMM(c.lon, false) +
    (p ? '\n' + p : '') +
    '\nCarte : ' +
    mapsUrl(c) +
    '\nAppli GPS ESAM : ' +
    appUrl(c)
  );
}

export function drawQR() {
  var current = state.current;
  if (!current || $('qrBox').hidden) return;
  var data =
    qrMode === 'app'
      ? appUrl(current)
      : qrMode === 'maps'
        ? mapsUrl(current)
        : 'geo:' + f6(current.lat) + ',' + f6(current.lon);
  if (typeof qrcode === 'undefined') {
    $('qrImg').innerHTML = '<p class="hint">QR indisponible (bibliothèque non chargée).</p>';
    return;
  }
  var q = qrcode(0, 'M');
  q.addData(data);
  q.make();
  $('qrImg').innerHTML = '<img alt="QR code du point" src="' + q.createDataURL(8, 0) + '">';
  $('qrTxt').textContent =
    (qrMode === 'app'
      ? 'Ouvre cette appli sur le point. '
      : qrMode === 'maps'
        ? 'Ouvre Google Maps sur le point. '
        : "Lien geo: ouvre l'appli de carte sur Android. ") + data;
}

// Partage natif, sinon copie (btn affiche « Copié »)
export function shareText(text, btn) {
  if (navigator.share)
    navigator.share({ title: 'Point ESAM', text: text }).catch(function (e) {
      if (e && e.name !== 'AbortError') copy(text, btn);
    });
  else copy(text, btn);
}

// onUse : appelé quand le point est partagé (pour l'historique)
export function initShare(onUse) {
  $('qrBtn').addEventListener('click', function () {
    $('qrBox').hidden = !$('qrBox').hidden;
    drawQR();
  });
  document.querySelectorAll('[data-qr]').forEach(function (b) {
    b.addEventListener('click', function () {
      qrMode = b.dataset.qr;
      document.querySelectorAll('[data-qr]').forEach(function (x) {
        x.classList.toggle('on', x === b);
      });
      drawQR();
    });
  });
  $('shareBtn').addEventListener('click', function () {
    var current = state.current;
    if (!current) return;
    onUse();
    shareText(message(current), $('shareBtn'));
  });
  // WhatsApp : message prêt à envoyer, l'utilisateur choisit le contact ou le groupe
  $('waBtn').addEventListener('click', function () {
    if (!state.current) return;
    onUse();
    window.open('https://wa.me/?text=' + encodeURIComponent(message(state.current)), '_blank', 'noopener');
  });
  $('copyMsg').addEventListener('click', function () {
    if (state.current) {
      onUse();
      copy(message(state.current), $('copyMsg'));
    }
  });
}
