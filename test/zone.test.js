// Tests de la zone des coordonnées dans une lecture pleine image (js/zone.js) : `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../js/parser.js';
import { coordZone, wordsConf } from '../js/zone.js';

// lignes à la façon de Tesseract, d'après l'écran Garmin de test (mots avec boîte et confiance)
function line(y, words) {
  let x = 20;
  const ws = words.map((w) => {
    const t = typeof w === 'string' ? w : w[0],
      c = typeof w === 'string' ? 90 : w[1],
      b = { x0: x, y0: y, x1: x + t.length * 12, y1: y + 20 };
    x = b.x1 + 10;
    return { text: t, confidence: c, bbox: b };
  });
  return {
    text: ws.map((w) => w.text).join(' '),
    confidence: 90,
    bbox: { x0: 20, y0: y, x1: x, y1: y + 20 },
    words: ws
  };
}
const garmin = () => [
  line(60, ['Tania']),
  line(150, ['Distance', 'du', 'trajet:', '2.4', 'km']),
  line(180, ['Surface:', '271.04', 'm²']),
  line(210, ['Distance:', '0.3', 'km']),
  line(240, ['Position:', 'N', ['45°16.277’', 84]]),
  line(270, ['E', ['005°56.052’', 88]]),
  line(330, ['Ascension', 'totale:', '0', 'm']),
  line(360, ['Altitude', 'max.:', '0', 'm'])
];

test('écran Garmin : les deux lignes de la position sont trouvées, cadre sur les mots des coordonnées', () => {
  const z = coordZone(garmin(), parse);
  assert.ok(z);
  assert.deepEqual(z.idx, [4, 5]);
  assert.equal(z.p.best.lat.toFixed(5), (45 + 16.277 / 60).toFixed(5));
  // seuls les mots porteurs de coordonnées sont cadrés (pas « Position: »), sur les deux lignes
  assert.deepEqual(
    z.words.map((w) => w.text),
    ['N', '45°16.277\u2019', 'E', '005°56.052\u2019']
  );
  assert.ok(z.box.y0 === 240 && z.box.y1 === 290 && z.box.x0 === 20);
  assert.ok(z.conf >= 84 && z.conf <= 90, 'confiance ' + z.conf);
});

test('lignes dans le désordre : triées par hauteur ; une seule ligne avec les deux axes suffit', () => {
  const L = garmin().reverse();
  const z = coordZone(L, parse);
  assert.deepEqual(z.idx, [4, 5]);
  const one = [line(10, ['Bla']), line(40, ['45.271283,', '5.934200'])];
  const z2 = coordZone(one, parse);
  assert.deepEqual(z2.idx, [1]);
  assert.equal(z2.words.length, 2);
});

test('aucune coordonnée : null ; lignes vides ignorées', () => {
  assert.equal(coordZone([line(10, ['Bonjour']), { text: '', bbox: null }], parse), null);
  assert.equal(coordZone([], parse), null);
});

test('confiance des mots porteurs de chiffres, pondérée par leur longueur', () => {
  assert.equal(
    wordsConf([
      { text: 'Position:', confidence: 10 },
      { text: '45.27', confidence: 80 },
      { text: 'N', confidence: 60 }
    ]),
    77
  );
  assert.equal(wordsConf([{ text: 'rien', confidence: 50 }]), null);
});
