// Tests du relief du suivi (js/profile.js) : `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { samplePath, pointAlts, climbs, slope, profileSvg } from '../js/profile.js';

const pts = [
  { lat: 45.1007, lon: 5.902133 },
  { lat: 45.103283, lon: 5.913967 },
  { lat: 45.103317, lon: 5.9139 }
];

test('échantillons : chaque point du suivi présent, distances croissantes, total respecté', () => {
  const s = samplePath(pts, 100);
  assert.ok(s.length >= 98 && s.length <= 102);
  assert.deepEqual(
    s.filter((q) => q.k >= 0).map((q) => q.k),
    [0, 1, 2]
  );
  for (let i = 1; i < s.length; i++) assert.ok(s[i].d >= s[i - 1].d);
  assert.ok(Math.abs(s[s.length - 1].d - 979) < 5);
  // l'étape de 6 m n'a presque pas d'échantillons, celle de 972 m presque tous
  const i1 = s.findIndex((q) => q.k === 1);
  assert.ok(s.length - 1 - i1 <= 2);
});
test('un seul point : un seul échantillon', () => {
  assert.equal(samplePath([pts[0]], 100).length, 1);
});
test('altitudes des points, montées et descentes entre points', () => {
  const s = samplePath(pts, 10),
    zs = s.map((q, i) => 1000 + i);
  const a = pointAlts(s, zs, 3);
  assert.equal(a[0], 1000);
  assert.equal(a[2], 1000 + s.length - 1);
  assert.deepEqual(climbs([1280, 1460, 1440, null, 1500]), { up: 180, down: 20 });
  assert.equal(slope(100, 1000), 10);
  assert.equal(slope(5, 10), null);
});
test('profil SVG : points numérotés, null sans altitudes', () => {
  const s = samplePath(pts, 20),
    zs = s.map((q) => 1280 + q.d * 0.18);
  const p = profileSvg(s, zs, (d) => `${Math.round(d)} m`);
  assert.match(p.svg, /^<svg class="pf"/);
  // points 2 et 3 à 6 m : une seule pastille « 2-3 »
  assert.equal((p.svg.match(/class="pf-p"/g) || []).length, 2);
  assert.match(p.svg, />2-3</);
  assert.ok(p.y(1300) > p.y(1400)); // plus haut = plus haut à l'écran
  assert.equal(
    profileSvg(
      s,
      s.map(() => null),
      String
    ),
    null
  );
});
