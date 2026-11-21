import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tilesFor } from '../js/util.js';

test('tuiles : état gardé par une version précédente, les nouveaux défauts s’appliquent', () => {
  // « Transmettre » replié et suivi ouvert sous l'ancien ordre : oubliés ; les autres choix restent
  assert.deepEqual(tilesFor({ shareCard: false, trackCard: true, mapCard: false, eqCard: true }), {
    _v: 2,
    mapCard: false,
    eqCard: true
  });
  // état déjà à la version courante : gardé tel quel, y compris un « Transmettre » replié depuis
  const cur = { _v: 2, shareCard: false, trackCard: true };
  assert.equal(tilesFor(cur), cur);
  // rien ou n'importe quoi : les défauts de la page
  assert.deepEqual(tilesFor(null), { _v: 2 });
  assert.deepEqual(tilesFor([]), { _v: 2 });
  assert.deepEqual(tilesFor({ mapCard: 'oui' }), { _v: 2 });
});
