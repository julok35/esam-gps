// Tests du suivi de plusieurs points (js/track.js, partie calcul) : `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legs, stats, fmtDur, fmtSpeed, trackText } from '../js/track.js';

const H = 3600000;
// chien perdu : collier le matin, nouveau signalement le soir 1,5 km plus au nord-est, puis le lendemain
const pts = [
  { lat: 45.2, lon: 6.2, t: 8 * H, label: 'collier' },
  { lat: 45.21, lon: 6.214, t: 17.5 * H, label: '' },
  { lat: 45.215, lon: 6.214, t: 33 * H, label: 'vu près du lac' }
];

test('étapes : distance, cap, durée, vitesse', () => {
  const L = legs(pts);
  assert.equal(L.length, 2);
  assert.ok(Math.abs(L[0].d - 1555) < 30, 'distance ' + L[0].d);
  assert.ok(L[0].b > 40 && L[0].b < 50);
  assert.equal(L[0].dt, 9.5 * H);
  assert.ok(Math.abs(L[0].v - L[0].d / 9.5) < 1);
  assert.ok(L[1].b < 2 || L[1].b > 358);
});

test('bilan : cumul, durée totale, vol d’oiseau', () => {
  const s = stats(pts);
  assert.equal(s.n, 3);
  assert.ok(s.total > s.direct);
  assert.equal(s.dt, 25 * H);
  assert.ok(s.v > 0);
  const one = stats([pts[0]]);
  assert.equal(one.total, 0);
  assert.equal(one.v, null);
  assert.equal(one.bearing, null);
});

test('durée nulle, trop courte (points ajoutés à la suite) ou dates inversées : pas de vitesse', () => {
  const L = legs([pts[0], { lat: 45.21, lon: 6.214, t: 8 * H }]);
  assert.equal(L[0].v, null);
  assert.equal(legs([pts[0], { lat: 45.21, lon: 6.214, t: 8 * H + 5 * 60000 }])[0].v, null);
  assert.equal(legs([pts[1], pts[0]])[0].v, null);
  assert.equal(stats([pts[0], { lat: 45.21, lon: 6.214, t: 8 * H + 60000 }]).v, null);
});

test('formats lisibles', () => {
  assert.equal(fmtDur(25 * 60000), '25 min');
  assert.equal(fmtDur(9.55 * H), '9 h 33');
  assert.equal(fmtDur(28 * H), '1 j 4 h');
  assert.equal(fmtDur(0), '0 min');
  assert.equal(fmtSpeed(190), '190 m/h');
  assert.equal(fmtSpeed(2500), '2,5 km/h');
  assert.equal(fmtSpeed(null), '');
});

test('message de partage : chaque point, chaque étape, le bilan', () => {
  const t = trackText(pts);
  assert.match(t, /^Suivi ESAM : 3 points/);
  assert.match(t, /1\. .*collier : 45\.200000, 6\.200000/);
  assert.match(t, /depuis le point 1, cap 4\d° NE, en 9 h 30/);
  assert.match(t, /Total : /);
  assert.equal(trackText([]), '');
});
