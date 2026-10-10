/* Bandeau boussole discret sous l'en-tête : l'échelle des caps défile quand on tourne, le repère jaune est le point.
   Capteurs d'orientation du téléphone ; écouté seulement quand le point et la position sont connus. */
import { $, state } from './util.js';
import { bearing } from './parser.js';

var R = Math.PI / 180, SPAN = 120; // degrés visibles sur la largeur du bandeau
var LBL = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' };
var on = false, granted = false, refused = false, sx = null, sy = 0, head = null, raf = 0, said = 0;

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

// Déclinaison magnétique approchée sur la France et les Alpes (2026), degrés vers l'est : à 1° près
export function declination(lon) { return 1 + 0.28 * lon; }

// Écart signé (-180..180) entre le cap visé et le cap du téléphone : positif, le point est à droite
export function turn(target, heading) { return ((target - heading) % 360 + 540) % 360 - 180; }

function screenAngle() {
  var o = screen.orientation;
  return o && typeof o.angle === 'number' ? o.angle : typeof window.orientation === 'number' ? (window.orientation + 360) % 360 : 0;
}

function onOri(e) {
  var h = null, me = state.me;
  if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) h = e.webkitCompassHeading + screenAngle(); // iOS
  else if ((e.absolute || e.type === 'deviceorientationabsolute') && e.alpha !== null) h = headingOf(e.alpha, e.beta || 0, e.gamma || 0, screenAngle());
  if (h === null || isNaN(h)) return;
  if (me) h += declination(me.lon); // capteur : nord magnétique ; carte : nord géographique
  // lissage sur le cercle (pas de saut entre 359° et 0°)
  var x = Math.cos(h * R), y = Math.sin(h * R);
  if (sx === null) { sx = x; sy = y; } else { sx += (x - sx) * 0.25; sy += (y - sy) * 0.25; }
  head = (Math.atan2(sy, sx) / R + 360) % 360;
  $('cmp').hidden = false;
  if (!raf) raf = requestAnimationFrame(draw);
}

var EVT = typeof window !== 'undefined' && 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
function needsAsk() { return typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function' && !granted; }

function start() {
  if (on) return;
  if (needsAsk()) { $('cmpAsk').hidden = refused; return; }
  on = true; window.addEventListener(EVT, onOri);
}
function stop() {
  $('cmpAsk').hidden = true;
  if (!on) return;
  on = false; window.removeEventListener(EVT, onOri);
  sx = null; head = null; $('cmp').hidden = true;
}

function draw() {
  raf = 0;
  var c = state.current, me = state.me, cv = $('cmpCv');
  if (!on || head === null || !c || !me) return;
  var dpr = window.devicePixelRatio || 1, w = cv.clientWidth, hh = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
  var g = cv.getContext('2d'), k = w / SPAN, mid = w / 2;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hh);
  g.fillStyle = g.strokeStyle = '#111111'; g.lineWidth = 1;
  g.font = '600 11px "Roboto Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (var d = Math.ceil((head - SPAN / 2) / 15) * 15; d <= head + SPAN / 2; d += 15) {
    var x = mid + (d - head) * k, n = (d % 360 + 360) % 360;
    if (LBL[n]) g.fillText(LBL[n], x, hh / 2 + 1);
    else { g.beginPath(); g.moveTo(x, hh / 2 - 3); g.lineTo(x, hh / 2 + 3); g.stroke(); }
  }
  // repère du point : triangle jaune, ou chevron au bord quand il est hors champ
  var t = turn(bearing(me, c), head), face = Math.abs(t) <= 5;
  var px = Math.abs(t) <= SPAN / 2 ? mid + t * k : t > 0 ? w - 7 : 7;
  g.fillStyle = '#FFD400'; g.lineWidth = 1.5; g.beginPath();
  if (Math.abs(t) <= SPAN / 2) { g.moveTo(px - 6, 1); g.lineTo(px + 6, 1); g.lineTo(px, 10); }
  else { var s = t > 0 ? 1 : -1; g.moveTo(px - 5 * s, hh / 2 - 7); g.lineTo(px + 5 * s, hh / 2); g.lineTo(px - 5 * s, hh / 2 + 7); }
  g.closePath(); g.fill(); g.stroke();
  // axe du téléphone
  g.strokeStyle = face ? '#1F7A3D' : '#E6332A'; g.lineWidth = face ? 3 : 2;
  g.beginPath(); g.moveTo(mid, hh - 8); g.lineTo(mid, hh); g.stroke();
  // texte pour les lecteurs d'écran, au plus toutes les 3 s
  if (Date.now() - said > 3000) {
    said = Date.now();
    $('cmp').setAttribute('aria-label', face ? 'Boussole : face au point' : 'Boussole : point à ' + Math.round(Math.abs(t)) + '° sur votre ' + (t > 0 ? 'droite' : 'gauche'));
  }
}

// Appelé à chaque changement du point ou de la position
export function updateCompass() {
  if (state.current && state.me && !document.hidden) { start(); if (head !== null && !raf) raf = requestAnimationFrame(draw); }
  else stop();
}

export function initCompass() {
  if (typeof DeviceOrientationEvent === 'undefined') return;
  // iOS : le capteur ne s'ouvre qu'après un toucher
  $('cmpAsk').addEventListener('click', function () {
    DeviceOrientationEvent.requestPermission().then(function (r) {
      $('cmpAsk').hidden = true;
      if (r === 'granted') { granted = true; updateCompass(); } else refused = true;
    }, function () { refused = true; $('cmpAsk').hidden = true; });
  });
  document.addEventListener('visibilitychange', updateCompass);
}
