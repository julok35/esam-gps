// Tests de la mesure d'inclinaison du texte (js/skew.js) : `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skewAngle } from '../js/skew.js';

// Image d'essai : deux lignes de « caractères » (traits sombres sur fond clair) inclinées de deg degrés, comme un écran
// de GPS photographié de travers. Graine fixe : même image à chaque essai.
// z : taille des caractères (1 : petits, 4 : gros chiffres qui remplissent le cadre), blur : rayon du flou (pixels)
function lines(deg, w = 420, h = 200, dark = false, z = 1, blur = 0) {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const glyphs = [];
  for (let cy = -30 * z; cy <= 30 * z; cy += 60 * (z > 1 ? z / 2 : 1)) for (let x = -w / 2; x < w / 2; x += 14 * z) if (rnd() > 0.15) glyphs.push({ x, cy, kind: Math.floor(rnd() * 3) });
  const a = deg * Math.PI / 180, s = Math.sin(a), c = Math.cos(a), g = new Uint8Array(w * h);
  const inked = (px, py) => {
    // point ramené dans le repère du texte droit
    const X = (px - w / 2) * c + (py - h / 2) * s, Y = -(px - w / 2) * s + (py - h / 2) * c;
    for (const q of glyphs) {
      const dx = X - q.x, dy = Y - q.cy;
      const ex = dx / z, ey = dy / z;
      if (ey < -10 || ey > 10 || ex < 0 || ex > 9) continue;
      // trait gauche, trait droit, barre du haut ou du bas selon le glyphe
      if (ex < 2.5 || (q.kind !== 1 && ex > 6.5) || (q.kind === 2 && ey > 7.5) || (q.kind === 1 && ey < -7.5)) return true;
    }
    return false;
  };
  // 4 x 4 échantillons par pixel : bords adoucis comme sur une vraie photo
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let ink = 0;
    for (let u = 0; u < 4; u++) for (let v = 0; v < 4; v++) if (inked(x + (u + 0.5) / 4, y + (v + 0.5) / 4)) ink++;
    const f = dark ? 1 - ink / 16 : ink / 16;
    g[y * w + x] = Math.round(220 - 190 * f);
  }
  // flou de mise au point : moyenne glissante, deux fois
  for (let pass = 0; pass < (blur ? 2 : 0); pass++) {
    const t = Float32Array.from(g);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let sum = 0, n = 0;
      for (let v = -blur; v <= blur; v++) for (let u = -blur; u <= blur; u++) {
        const X = x + u, Y = y + v; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; sum += t[Y * w + X]; n++;
      }
      g[y * w + x] = Math.round(sum / n);
    }
  }
  return g;
}

for (const deg of [0, 4, -7, 12, -18]) {
  test(`texte incliné de ${deg}° : inclinaison retrouvée`, () => {
    const r = skewAngle(lines(deg), 420, 200);
    assert.ok(Math.abs(r.deg - deg) <= 0.6, `mesuré ${r.deg}°`);
    assert.ok(r.gain > 1.5, `gain ${r.gain}`);
  });
}

// Photo de terrain (v1.13) : gros chiffres flous qui remplissent le cadre ; l'ancienne mesure trouvait près de 40° de trop
for (const deg of [0, -6, 15]) {
  test(`gros chiffres flous et serrés, ${deg}° : pas de fausse inclinaison`, () => {
    const r = skewAngle(lines(deg, 360, 240, false, 4, 3), 360, 240);
    assert.ok(Math.abs(r.deg - deg) <= 1.5, `mesuré ${r.deg}°`);
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

// Vraie photo de terrain : écran d'un Garmin Alpha 100, tenu à la main (niveaux de gris, 560 x 525).
// La v1.13 se trompait ici d'environ 45° une fois sur deux. La photo est tournée de a degrés, comme un téléphone tenu de
// travers, puis un cadre horizontal est pris au centre : la mesure doit suivre a.
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const PW = 560, PH = 525;
const photo = gunzipSync(readFileSync(new URL('./garmin-ecran-560x525.gray.gz', import.meta.url)));
function turned(a, w, h) {
  // cadre w x h au centre de la photo tournée de a degrés (interpolation bilinéaire)
  const r = a * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x - w / 2, dy = y - h / 2, X = dx * c + dy * s + PW / 2, Y = -dx * s + dy * c + PH / 2;
    const x0 = Math.floor(X), y0 = Math.floor(Y), fx = X - x0, fy = Y - y0;
    const at = (u, v) => photo[Math.min(PH - 1, Math.max(0, v)) * PW + Math.min(PW - 1, Math.max(0, u))];
    out[y * w + x] = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
  }
  return out;
}

test('vraie photo de Garmin : inclinaison suivie de -25° à +30°', () => {
  const W = 320, H = 260, ref = skewAngle(turned(0, W, H), W, H);
  assert.ok(Math.abs(ref.deg) < 5 && ref.gain > 2, `photo telle quelle : ${ref.deg}°, gain ${ref.gain}`);
  for (const a of [-25, -12, -5, 5, 12, 30]) {
    const r = skewAngle(turned(a, W, H), W, H);
    assert.ok(Math.abs(r.deg - ref.deg - a) <= 1, `tournée de ${a}° : mesuré ${r.deg}° (photo telle quelle ${ref.deg}°)`);
    assert.ok(r.gain > 2, `tournée de ${a}° : gain ${r.gain}`);
  }
});
