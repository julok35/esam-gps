// Tests de l'amélioration d'image (js/enhance.js) : `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { toGray, stretchBounds, stretch, unsharp, sharpness, autoParams, enhance } from '../js/enhance.js';

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
