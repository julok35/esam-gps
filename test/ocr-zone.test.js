// Tests du repérage des coordonnées lues sur la photo (coordBox, js/ocr.js) : `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coordBox } from '../js/ocr.js';

// Ligne de mots : chaque mot occupe 10 px par caractère, les lignes font 20 px de haut
function line(words, y) {
  var x = 0,
    ws = words.map(function (t) {
      var w = { text: t, bbox: { x0: x, y0: y, x1: x + 10 * t.length, y1: y + 20 } };
      x += 10 * t.length + 10;
      return w;
    });
  return { text: words.join(' ') + '\n', bbox: { x0: 0, y0: y, x1: x - 10, y1: y + 20 }, words: ws };
}

test('fiche : libellé et colonne voisine exclus, seuls les deux nombres restent', () => {
  const lines = [
    line(['Commune', ':', 'Theys', 'Temps', 'de', 'marche', ':', '00:10'], 0),
    line(['Coordonnées', ':', '45.299768,', '5.987961', 'Indication', ':', 'Passer', 'devant'], 30),
    line(['Patloc', ':'], 60)
  ];
  const b = coordBox(lines, 45.299768, 5.987961);
  assert.ok(b);
  assert.equal(b.y0, 30);
  assert.equal(b.y1, 50);
  // « Coordonnées » (11) + « : » (1) + 2 espaces = 140 px avant le premier nombre
  assert.equal(b.x0, 140);
  assert.equal(b.x1, 140 + 100 + 10 + 80); // « 45.299768, » (10) + espace + « 5.987961 » (8)
});

test('Garmin : latitude et longitude sur deux lignes, lettres d’hémisphère gardées', () => {
  const lines = [
    line(['Position'], 0),
    line(['N', "45°16.277'"], 30),
    line(['E', "005°56.052'"], 60),
    line(['Altitude', '1234', 'm'], 90)
  ];
  const b = coordBox(lines, 45 + 16.277 / 60, 5 + 56.052 / 60);
  assert.ok(b);
  assert.deepEqual(b, { x0: 0, y0: 30, x1: 20 + 110, y1: 80 });
});

test('ligne sans mots détaillés : la ligne entière sert', () => {
  const l = line(['45.299768,', '5.987961'], 10);
  delete l.words;
  const b = coordBox([line(['Lieu'], 0), l], 45.299768, 5.987961);
  assert.deepEqual(b, l.bbox);
});

test('valeurs retenues absentes de cette lecture : null', () => {
  const lines = [line(['Coordonnées', ':', '45.299768,', '5.987961'], 0)];
  assert.equal(coordBox(lines, 45.3012, 5.9879), null);
  assert.equal(coordBox([], 45.299768, 5.987961), null);
});
