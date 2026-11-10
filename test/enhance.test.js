// Tests de l'amélioration d'image (js/enhance.js) : `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import {
  toGray,
  stretchBounds,
  stretch,
  unsharp,
  sharpness,
  autoParams,
  enhance,
  flatten,
  otsu,
  screenBox
} from '../js/enhance.js';

const garmin = () => ({
  g: new Uint8Array(gunzipSync(readFileSync(new URL('./garmin-ecran-560x525.gray.gz', import.meta.url)))),
  w: 560,
  h: 525
});
// image synthétique : fond clair, un trait sombre vertical (bords francs ou flous selon blur)
function bar(blur) {
  const w = 120,
    h = 40,
    g = new Uint8Array(w * h).fill(200);
  for (let y = 0; y < h; y++) for (let x = 50; x < 70; x++) g[y * w + x] = 40;
  if (blur) {
    const t = Uint8Array.from(g);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0,
          n = 0;
        for (let u = -blur; u <= blur; u++) {
          const X = Math.min(w - 1, Math.max(0, x + u));
          s += t[y * w + X];
          n++;
        }
        g[y * w + x] = s / n;
      }
  }
  return { g, w, h };
}

test('gris : pondération vidéo, blanc reste blanc', () => {
  const g = toGray(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]), 3, 1);
  assert.deepEqual(Array.from(g), [255, 0, 76]);
});

test('étirement : la plage utile remplit 0..255, le gain accentue', () => {
  const { g } = garmin();
  const b = stretchBounds(g);
  assert.ok(b.lo > 0 && b.hi < 255 && b.hi > b.lo);
  const s = stretch(g, b.lo, b.hi, 1),
    b2 = stretchBounds(s);
  assert.ok(b2.lo <= 2 && b2.hi >= 253);
  const hard = stretch(g, b.lo, b.hi, 1.6);
  // avec un gain, les extrêmes saturent davantage
  let sat = 0,
    sat1 = 0;
  for (let i = 0; i < g.length; i++) {
    if (hard[i] === 0 || hard[i] === 255) sat++;
    if (s[i] === 0 || s[i] === 255) sat1++;
  }
  assert.ok(sat > sat1);
});

test('netteté : contours francs près de 1, flou nettement en dessous ; la photo Garmin est un peu floue', () => {
  const sharp = bar(0),
    soft = bar(4);
  assert.ok(sharpness(sharp.g, sharp.w, sharp.h) > 0.9);
  assert.ok(sharpness(soft.g, soft.w, soft.h) < 0.4);
  const { g, w, h } = garmin();
  const s = sharpness(g, w, h);
  assert.ok(s > 0.2 && s < 0.5, `Garmin : ${s}`);
});

test('réglages automatiques : renforcement seulement si flou, et le masque flou rend le trait plus franc', () => {
  const sharp = bar(0),
    soft = bar(4);
  assert.equal(autoParams(sharp.g, sharp.w, sharp.h).sharp, 0);
  const p = autoParams(soft.g, soft.w, soft.h);
  assert.ok(p.sharp > 0 && p.sharp <= 1.5);
  const out = enhance(soft.g, soft.w, soft.h, p, 3);
  assert.ok(sharpness(out, soft.w, soft.h) > sharpness(soft.g, soft.w, soft.h));
  assert.equal(unsharp(soft.g, soft.w, soft.h, 0, 3).length, soft.g.length);
});

test('fond égalisé : un texte clair sur un fond en dégradé ressort partout de la même façon', () => {
  // fond de 20 (à gauche) à 200 (à droite), deux traits verticaux plus clairs de 40 que le fond
  const w = 120,
    h = 40,
    g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) g[y * w + x] = 20 + (180 * x) / w + (x === 20 || x === 100 ? 40 : 0);
  const f = flatten(g, w, h, 8, 3),
    at = (x) => f[20 * w + x];
  assert.ok(Math.abs(at(20) - at(100)) <= 6, `traits ${at(20)} et ${at(100)}`);
  assert.ok(at(20) > 200, `trait clair ${at(20)}`);
  assert.ok(Math.abs(at(60) - 128) <= 6, `fond ${at(60)}`);
});

test('seuil d’Otsu entre deux groupes de gris', () => {
  const g = new Uint8Array(1000);
  for (let i = 0; i < 1000; i++) g[i] = i < 700 ? 30 + (i % 10) : 190 + (i % 10);
  const t = otsu(g);
  assert.ok(t >= 39 && t < 190, String(t));
});

test('écran lumineux dans une photo sombre : cadré ; capture d’écran toute claire ou petit reflet : rien', () => {
  const w = 100,
    h = 160,
    dark = () => new Uint8Array(w * h).fill(15);
  const g = dark();
  for (let y = 40; y < 120; y++) for (let x = 20; x < 80; x++) g[y * w + x] = 150 + ((x + y) % 20);
  for (let y = 5; y < 10; y++) for (let x = 5; x < 12; x++) g[y * w + x] = 230; // reflet isolé
  const s = screenBox(g, w, h);
  assert.ok(s, 'écran trouvé');
  assert.ok(s.x <= 0.2 && s.x > 0.15 && s.y <= 0.25 && s.y > 0.2, JSON.stringify(s));
  assert.ok(s.x + s.w >= 0.8 && s.x + s.w < 0.85 && s.y + s.h >= 0.75 && s.y + s.h < 0.8, JSON.stringify(s));
  const all = new Uint8Array(w * h).fill(240);
  for (let i = 0; i < 300; i++) all[i * 37] = 20; // texte sombre épars
  assert.equal(screenBox(all, w, h), null);
  const spot = dark();
  for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) spot[y * w + x] = 230;
  assert.equal(screenBox(spot, w, h), null);
});
