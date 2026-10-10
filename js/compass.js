/* Boussole vers le point, dans le bandeau sous l'en-tête : on pointe le téléphone vers la victime comme pour la photographier.
   Le repère jaune se place à gauche / droite selon le cap, en haut / bas selon la hauteur du point (altitudes du terrain) ;
   il entre dans le viseur central quand le téléphone vise le point.
   Capteurs d'orientation du téléphone ; écoutés seulement quand le point et la position sont connus. */
import { $, state } from './util.js';
import { bearing, distM } from './parser.js';
import { reliefNow } from './place.js';

var R = Math.PI / 180, SPAN = 120, VIEW = 50; // degrés sur la largeur du bandeau ; au-delà de VIEW, le repère sort du champ net
var VR = 12; // écart en hauteur (degrés) qui amène le repère au bord du bandeau
var LBL = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' };
var on = false, granted = false, sx = null, sy = 0, head = null, pitch = null, raf = 0, said = 0;
var asked = false, seen = 0, waitT = 0, tapAsk = false;

// Cap (degrés, depuis le nord du capteur) du haut de l'écran quand le téléphone est à plat,
// de l'arrière du téléphone quand il est tenu debout : les deux se projettent dans la même direction au sol.
// alpha, beta, gamma : angles W3C (repère Z-X'-Y'') ; screen : angle de rotation de l'écran (0, 90, 180, 270).
export function headingOf(alpha, beta, gamma, screen) {
  var ca = Math.cos(alpha * R), sa = Math.sin(alpha * R), cb = Math.cos(beta * R), sb = Math.sin(beta * R), cg = Math.cos(gamma * R), sg = Math.sin(gamma * R);
  // axes du téléphone dans le repère terrestre (x est, y nord)
  var Xx = ca * cg - sa * sb * sg, Xy = sa * cg + ca * sb * sg;
  var Yx = -sa * cb, Yy = ca * cb;
  var Zx = ca * sg + sa * sb * cg, Zy = sa * sg - ca * sb * cg;
  var cs = Math.cos((screen || 0) * R), ss = Math.sin((screen || 0) * R);
  var vx = cs * Yx + ss * Xx - Zx, vy = cs * Yy + ss * Xy - Zy; // haut de l'écran + arrière du téléphone
  return (Math.atan2(vx, vy) / R + 360) % 360;
}

// Inclinaison de l'axe de l'appareil photo (arrière du téléphone) : 0 à l'horizontale, positive vers le haut
export function pitchOf(beta, gamma) { return Math.asin(Math.max(-1, Math.min(1, -Math.cos(beta * R) * Math.cos(gamma * R)))) / R; }

// Angle sous lequel on voit le point (degrés, positif au-dessus de l'horizon) : yeux à 1,5 m du sol,
// rotondité de la Terre et réfraction comprises (sensibles au-delà de quelques kilomètres)
export function sightAngle(d, zPoint, zMe) {
  var dh = zPoint - (zMe + 1.5) - 0.87 * d * d / (2 * 6371000);
  return Math.atan2(dh, d) / R;
}

// Déclinaison magnétique approchée sur la France et les Alpes (2026), degrés vers l'est : à 1° près
export function declination(lon) { return 1 + 0.28 * lon; }

// Écart signé (-180..180) entre le cap visé et le cap du téléphone : positif, le point est à droite
export function turn(target, heading) { return ((target - heading) % 360 + 540) % 360 - 180; }

function screenAngle() {
  var o = screen.orientation;
  return o && typeof o.angle === 'number' ? o.angle : typeof window.orientation === 'number' ? (window.orientation + 360) % 360 : 0;
}

function msg(t) { $('cmpMsg').textContent = t || ''; $('cmpMsg').hidden = !t; }

function onOri(e) {
  var h = null, me = state.me;
  if (e.alpha !== null || typeof e.webkitCompassHeading === 'number') seen++; // Chrome envoie une mesure vide quand il n'y a pas de capteur
  if (e.beta !== null && e.gamma !== null && e.beta !== undefined) {
    var p = pitchOf(e.beta, e.gamma);
    pitch = pitch === null ? p : pitch + (p - pitch) * 0.25;
  }
  if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) h = e.webkitCompassHeading + screenAngle(); // iOS
  else if ((e.absolute || e.type === 'deviceorientationabsolute') && e.alpha !== null) h = headingOf(e.alpha, e.beta || 0, e.gamma || 0, screenAngle());
  if (h === null || isNaN(h)) return;
  if (me) h += declination(me.lon); // capteur : nord magnétique ; carte : nord géographique
  // lissage sur le cercle (pas de saut entre 359° et 0°)
  var x = Math.cos(h * R), y = Math.sin(h * R);
  if (sx === null) { sx = x; sy = y; } else { sx += (x - sx) * 0.25; sy += (y - sy) * 0.25; }
  head = (Math.atan2(sy, sx) / R + 360) % 360;
  // la boussole marche : plus de bouton ni de message d'aide
  if (waitT) { clearTimeout(waitT); waitT = 0; }
  if (!$('cmpMsg').hidden) msg('');
  $('cmpAsk').hidden = true;
  $('cmp').hidden = false;
  if (!raf) raf = requestAnimationFrame(draw);
}

function canAsk() { return typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function'; }
var IOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
var MOBILE = IOS || (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent));
var BRAVE = typeof navigator !== 'undefined' && !!navigator.brave;

// Où redonner l'accès aux capteurs, selon le téléphone et le navigateur
function blockedMsg() {
  if (IOS) return 'Accès aux capteurs refusé. Fermez complètement Safari (ou l\'appli GPS ESAM) puis rouvrez-la, touchez « Activer » et choisissez « Autoriser ». Sinon : Réglages › Safari › Mouvement et orientation.';
  if (BRAVE) return 'Brave bloque les capteurs de mouvement. Menu ⋮ › Paramètres › Paramètres des sites › Capteurs de mouvement › Autoriser, puis rechargez. Si ça ne suffit pas : lion Brave à droite de l\'adresse › Boucliers désactivés pour ce site.';
  return 'Capteurs de mouvement bloqués. Menu ⋮ › Paramètres › Paramètres des sites › Capteurs de mouvement › Autoriser, puis rechargez la page.';
}
function noHeadingMsg() {
  return IOS ? 'Le téléphone ne donne pas de cap boussole. Faites un 8 avec le téléphone pour la calibrer, et vérifiez Réglages › Confidentialité › Service de localisation › Services système › Étalonnage du compas.'
    : 'Le téléphone ne donne pas de cap boussole. Faites un 8 avec le téléphone pour calibrer le compas, puis rechargez la page.';
}

// Demande d'accès aux capteurs (iOS, Brave). Sans toucher, iOS refuse : on redemande alors au premier toucher sur la page.
function ask(fromTap) {
  var p;
  try { p = DeviceOrientationEvent.requestPermission(); } catch (err) { p = Promise.reject(err); }
  return Promise.resolve(p).then(function (r) {
    if (r !== 'granted') throw new Error('refus');
    granted = true;
  }, function (err) {
    // pas de toucher (iOS) : nouvel essai, sans rien afficher, au premier toucher sur la page
    if (!fromTap && !tapAsk) { tapAsk = true; document.addEventListener('click', onTap, true); }
    throw err;
  });
}
function onTap() {
  document.removeEventListener('click', onTap, true); tapAsk = false;
  if (!granted && on) ask(true).catch(function () {});
}

// Boussole active par défaut : écoute directe, accès demandé tout seul ; le bouton n'apparaît que si aucun cap n'arrive
function start() {
  if (on) return;
  on = true; seen = 0;
  // les deux : Android donne le cap dans « absolute », iOS dans l'autre ; onOri ignore les mesures sans nord
  window.addEventListener('deviceorientationabsolute', onOri); window.addEventListener('deviceorientation', onOri);
  if (canAsk() && !granted) ask(false).catch(function () {});
  clearTimeout(waitT);
  if (asked) msg('Boussole activée : bougez le téléphone…');
  waitT = setTimeout(function () {
    waitT = 0;
    if (head !== null || !on) return;
    if (asked) msg(seen ? noHeadingMsg() : blockedMsg());
    else if (MOBILE) $('cmpAsk').hidden = false;
  }, asked ? 4000 : 2500);
}
function stop() {
  $('cmpAsk').hidden = true;
  if (!on) return;
  on = false; window.removeEventListener('deviceorientationabsolute', onOri); window.removeEventListener('deviceorientation', onOri);
  clearTimeout(waitT); waitT = 0; msg('');
  sx = null; head = null; pitch = null; $('cmp').hidden = true;
}

function canvas(cv) {
  var dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  var g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  g.font = '600 11px "Roboto Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  return { g: g, w: w, h: h };
}
function pill(g, x, y, text) {
  var w = g.measureText(text).width + 14;
  g.fillStyle = '#FFD400'; g.strokeStyle = '#111111'; g.lineWidth = 1.5;
  g.beginPath(); if (g.roundRect) g.roundRect(x - w / 2, y - 9, w, 18, 9); else g.rect(x - w / 2, y - 9, w, 18);
  g.fill(); g.stroke();
  g.fillStyle = '#111111'; g.fillText(text, x, y + 1);
}

function draw() {
  raf = 0;
  var c = state.current, me = state.me;
  if (!on || head === null || !c || !me) return;
  var b = canvas($('cmpCv')), g = b.g, w = b.w, hh = b.h, k = w / SPAN, mid = w / 2, vc = hh / 2 - 3;
  // échelle des caps, discrète, en bas du bandeau
  g.globalAlpha = 0.55; g.fillStyle = g.strokeStyle = '#111111'; g.lineWidth = 1; g.font = '600 10px "Roboto Condensed", "Arial Narrow", sans-serif';
  for (var d = Math.ceil((head - SPAN / 2) / 15) * 15; d <= head + SPAN / 2; d += 15) {
    var x = mid + (d - head) * k, n = (d % 360 + 360) % 360;
    if (LBL[n]) g.fillText(LBL[n], x, hh - 6);
    else { g.beginPath(); g.moveTo(x, hh - 9); g.lineTo(x, hh - 3); g.stroke(); }
  }
  g.globalAlpha = 1; g.font = '600 11px "Roboto Condensed", "Arial Narrow", sans-serif';
  // écart en hauteur : seulement téléphone tenu debout (viser comme avec l'appareil photo) et altitudes connues
  var t = turn(bearing(me, c), head), z = reliefNow(), e = null;
  if (z && pitch !== null && Math.abs(pitch) <= 60) e = sightAngle(distM(me, c), z.point, z.me) - pitch;
  var okH = Math.abs(t) <= 5, okV = e === null || Math.abs(e) <= 3, ok = okH && okV;
  // viseur : l'axe du téléphone
  g.strokeStyle = ok ? '#1F7A3D' : '#E6332A'; g.lineWidth = ok ? 3 : 2;
  g.beginPath(); g.moveTo(mid - 9, vc); g.lineTo(mid - 4, vc); g.moveTo(mid + 4, vc); g.lineTo(mid + 9, vc);
  g.moveTo(mid, vc - 9); g.lineTo(mid, vc - 4); g.moveTo(mid, vc + 4); g.lineTo(mid, vc + 9); g.stroke();
  if (Math.abs(t) <= VIEW) {
    // repère du point : à gauche / droite selon le cap, en haut / bas selon la hauteur ; flèche au bord s'il faut lever ou baisser beaucoup
    var px = mid + t * k, lim = vc - 6, py = e === null ? vc : vc - Math.max(-1, Math.min(1, e / VR)) * lim;
    g.fillStyle = '#FFD400'; g.strokeStyle = '#111111'; g.lineWidth = 1.5; g.beginPath();
    if (e !== null && Math.abs(e) > VR) {
      var up = e > 0, ty = up ? 2 : 2 * vc - 2;
      g.moveTo(px - 7, ty + (up ? 9 : -9)); g.lineTo(px + 7, ty + (up ? 9 : -9)); g.lineTo(px, ty);
    } else g.arc(px, py, 6, 0, 2 * Math.PI);
    g.closePath(); g.fill(); g.stroke();
  } else {
    // hors champ : consigne lisible du côté où tourner
    pill(g, t > 0 ? w * 0.7 : w * 0.3, vc, t > 0 ? 'Tournez à droite ▶' : '◀ Tournez à gauche');
  }
  // texte pour les lecteurs d'écran, au plus toutes les 3 s
  if (Date.now() - said > 3000) {
    said = Date.now();
    var s = ok ? 'Boussole : téléphone pointé vers le point' : 'Boussole : ' + (okH ? 'dans la bonne direction' : 'tournez ' + (t > 0 ? 'à droite' : 'à gauche'));
    if (!ok && e !== null && !okV) s += e > 0 ? ', levez le téléphone' : ', baissez le téléphone';
    $('cmp').setAttribute('aria-label', s);
  }
}

// Appelé à chaque changement du point ou de la position
export function updateCompass() {
  if (state.current && state.me && !document.hidden) { start(); if (head !== null && !raf) raf = requestAnimationFrame(draw); }
  else stop();
}

export function initCompass() {
  if (typeof DeviceOrientationEvent === 'undefined') return;
  // bouton de secours : appel direct dans le toucher, sans rien avant (sinon iOS refuse sans rien afficher)
  $('cmpAsk').addEventListener('click', function () {
    asked = true;
    if (!canAsk()) { msg(blockedMsg()); return; } // pas de fenêtre d'autorisation : dire où débloquer
    msg('Demande d\'autorisation…');
    ask(true).then(function () {
      $('cmpAsk').hidden = true;
      if (on) stop();
      updateCompass();
    }, function (err) {
      if (head !== null) { msg(''); return; } // la boussole marche malgré la réponse
      msg(err && err.message !== 'refus' ? 'Boussole indisponible : ' + err.message + '.' : blockedMsg());
    });
  });
  document.addEventListener('visibilitychange', updateCompass);
}
