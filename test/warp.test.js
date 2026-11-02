// Tests de la perspective (js/warp.js) : `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { homography, invert, apply, warp, findQuad, rectFor, grow, tiltOf, area } from '../js/warp.js';

// « écran » clair sur fond sombre avec des lignes de texte, puis la même scène vue en perspective (photo)
const W = 400,
  H = 300;
function screen() {
  const g = new Uint8Array(W * H).fill(40);
  for (let y = 40; y < 260; y++) for (let x = 60; x < 340; x++) g[y * W + x] = 215;
  for (let l = 0; l < 6; l++)
    for (let x = 80; x < 320; x++)
      for (let y = 70 + l * 30; y < 79 + l * 30; y++) if (((x / 7) | 0) % 3 !== 2) g[y * W + x] = 30;
  return g;
}
const rect = [
  [60, 40],
  [340, 40],
  [340, 260],
  [60, 260]
];
const photo = [
  [80, 55],
  [330, 30],
  [350, 250],
  [50, 270]
];
function seen() {
  const Hm = homography(rect, photo);
  return { img: warp(screen(), W, H, 1, invert(Hm), W, H, [40]), Hm };
}

test('homographie : les 4 points vont où on les envoie, l’inverse revient', () => {
  const Hm = homography(rect, photo),
    Hi = invert(Hm);
  rect.forEach((p, i) => {
    const q = apply(Hm, p[0], p[1]);
    assert.ok(Math.abs(q[0] - photo[i][0]) < 1e-6 && Math.abs(q[1] - photo[i][1]) < 1e-6);
    const r = apply(Hi, q[0], q[1]);
    assert.ok(Math.abs(r[0] - p[0]) < 1e-6 && Math.abs(r[1] - p[1]) < 1e-6);
  });
});

test('rééchantillonnage : identité inchangée, hors image = couleur de fond', () => {
  const g = screen(),
    I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const o = warp(g, W, H, 1, I, W, H, [7]);
  for (let i = 0; i < g.length; i += 97) assert.equal(o[i], g[i]);
  const shifted = warp(g, W, H, 1, [1, 0, -W, 0, 1, 0, 0, 0, 1], W, H, [7]);
  assert.equal(shifted[0], 7);
});

test('cadre de l’écran retrouvé à 2 px près sur une photo en perspective, bords nets', () => {
  const { img } = seen();
  const q = findQuad(img, W, H);
  assert.ok(q, 'aucun cadre');
  q.quad.forEach((p, i) => {
    assert.ok(Math.hypot(p[0] - photo[i][0], p[1] - photo[i][1]) < 2, 'coin ' + i + ' : ' + p);
  });
  assert.ok(q.gain >= 3, 'gain ' + q.gain);
  assert.ok(q.tilt > 3);
  assert.ok(q.cover > 0.4 && q.cover < 0.6);
});

test('redressement : l’écran redevient un rectangle de texte droit', () => {
  const { img } = seen();
  const q = findQuad(img, W, H),
    src = grow(q.quad, 0.03),
    r = rectFor(src, 2400),
    Hm = homography(src, [
      [0, 0],
      [r.w, 0],
      [r.w, r.h],
      [0, r.h]
    ]),
    out = warp(img, W, H, 1, invert(Hm), r.w, r.h, [40]);
  // les bords du rectangle de sortie sont dans l'écran clair (marge de 3 %), les lignes de texte sont horizontales :
  // une rangée de pixels au milieu d'une ligne de texte est sombre d'un bout à l'autre du texte
  const row = (y) => {
    let dark = 0;
    for (let x = Math.round(r.w * 0.15); x < r.w * 0.85; x++) if (out[y * r.w + x] < 100) dark++;
    return dark / (r.w * 0.7);
  };
  let best = 0;
  for (let y = 0; y < r.h; y++) best = Math.max(best, row(y));
  assert.ok(best > 0.55, 'ligne de texte la plus sombre : ' + best);
  assert.ok(Math.abs(r.w / r.h - 280 / 220) < 0.12);
});

test('capture d’écran droite : pas de cadre incliné ; photo Garmin coupée : pas de bord net', () => {
  const g = screen();
  const q = findQuad(g, W, H);
  assert.ok(!q || q.tilt < 0.4);
  const garmin = new Uint8Array(gunzipSync(readFileSync(new URL('./garmin-ecran-560x525.gray.gz', import.meta.url))));
  const q2 = findQuad(garmin, 560, 525);
  assert.ok(!q2 || q2.gain < 3, 'gain ' + (q2 && q2.gain));
});

test('outils : inclinaison et surface d’un quadrilatère', () => {
  assert.equal(tiltOf(rect), 0);
  assert.equal(area(rect), 280 * 220);
  assert.ok(tiltOf(photo) > 5);
});
