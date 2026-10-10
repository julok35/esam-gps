// Tests de la mesure d'inclinaison du texte (js/skew.js) : `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skewAngle } from '../js/skew.js';

// Image d'essai : deux lignes de « caractères » (traits sombres sur fond clair) inclinées de deg degrés, comme un écran
// de GPS photographié de travers. Graine fixe : même image à chaque essai.
function lines(deg, w = 420, h = 200, dark = false) {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const glyphs = [];
  for (const cy of [-30, 30]) for (let x = -170; x < 170; x += 14) if (rnd() > 0.15) glyphs.push({ x, cy, kind: Math.floor(rnd() * 3) });
  const a = deg * Math.PI / 180, s = Math.sin(a), c = Math.cos(a), g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // point ramené dans le repère du texte droit
    const X = (x - w / 2) * c + (y - h / 2) * s, Y = -(x - w / 2) * s + (y - h / 2) * c;
    let ink = false;
    for (const q of glyphs) {
      const dx = X - q.x, dy = Y - q.cy;
      if (dy < -10 || dy > 10 || dx < 0 || dx > 9) continue;
      // trait gauche, trait droit, barre du haut ou du bas selon le glyphe
      if (dx < 2.5 || (q.kind !== 1 && dx > 6.5) || (q.kind === 2 && dy > 7.5) || (q.kind === 1 && dy < -7.5)) { ink = true; break; }
    }
    g[y * w + x] = ink !== dark ? 30 : 220;
  }
  return g;
}

for (const deg of [0, 4, -7, 12, -18]) {
  test(`texte incliné de ${deg}° : inclinaison retrouvée`, () => {
    const r = skewAngle(lines(deg), 420, 200);
    assert.ok(Math.abs(r.deg - deg) <= 0.6, `mesuré ${r.deg}°`);
    if (deg) assert.ok(r.gain > 1.2, `gain ${r.gain}`);
  });
}

test('texte clair sur fond sombre : même mesure', () => {
  const r = skewAngle(lines(9, 420, 200, true), 420, 200);
  assert.ok(Math.abs(r.deg - 9) <= 0.6, `mesuré ${r.deg}°`);
});

test('image unie : aucune inclinaison', () => {
  const r = skewAngle(new Uint8Array(100 * 60).fill(128), 100, 60);
  assert.deepEqual(r, { deg: 0, gain: 1 });
});
