import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupPins, pinLabel } from '../js/map.js';

test('pastilles proches à l’écran regroupées, éloignées séparées', () => {
  const g = groupPins(
    [
      { x: 0, y: 0 },
      { x: 300, y: 50 },
      { x: 305, y: 52 }
    ],
    26
  );
  assert.deepEqual(
    g.map((x) => x.ids),
    [[0], [1, 2]]
  );
});
test('regroupement non consécutif (retour au même endroit)', () => {
  const g = groupPins(
    [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 3, y: 4 }
    ],
    26
  );
  assert.deepEqual(
    g.map((x) => x.ids),
    [[0, 2], [1]]
  );
});
test('étiquette des pastilles regroupées', () => {
  assert.equal(pinLabel([0]), '1');
  assert.equal(pinLabel([1, 2]), '2-3');
  assert.equal(pinLabel([1, 2, 3]), '2-4');
  assert.equal(pinLabel([0, 2]), '1,3');
});
