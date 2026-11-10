import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupPins, pinLabel, focusView } from '../js/map.js';

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

test('lot lu : plusieurs points → centrage sur eux seuls, sans ma position', () => {
  const me = { lat: 45.2, lon: 5.8 };
  assert.deepEqual(
    focusView(
      [
        { lat: 45.1, lon: 5.9 },
        { lat: 45.11, lon: 5.91 }
      ],
      me
    ),
    [
      [45.1, 5.9],
      [45.11, 5.91]
    ]
  );
});
test('lot lu : un seul point → centrage sur lui et moi', () => {
  assert.deepEqual(focusView([{ lat: 45.1, lon: 5.9 }], { lat: 45.2, lon: 5.8 }), [
    [45.1, 5.9],
    [45.2, 5.8]
  ]);
  assert.deepEqual(focusView([{ lat: 45.1, lon: 5.9 }], null), [[45.1, 5.9]]);
});
