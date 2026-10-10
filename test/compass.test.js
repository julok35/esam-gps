// Boussole : cap du téléphone à partir des angles du capteur, écart avec le cap du point.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headingOf, turn, declination } from '../js/compass.js';

const near = (a, b, tol = 0.5) => assert.ok(Math.abs(turn(a, b)) <= tol, a + ' ≈ ' + b);

test('téléphone à plat : cap du haut de l\'écran', () => {
  near(headingOf(0, 0, 0, 0), 0);
  near(headingOf(90, 0, 0, 0), 270); // alpha croît dans le sens inverse des aiguilles d'une montre
  near(headingOf(270, 0, 0, 0), 90);
  near(headingOf(30, 0, 0, 0), 330);
});

test('téléphone tenu debout : cap de l\'arrière (appareil photo)', () => {
  near(headingOf(0, 90, 0, 0), 0);
  near(headingOf(90, 90, 0, 0), 270);
  near(headingOf(0, 60, 0, 0), 0);
  near(headingOf(45, 89, 0, 0), 315);
});

test('écran en paysage : cap du haut de l\'écran', () => {
  near(headingOf(90, 0, 0, 90), 0); // tourné d'un quart vers la gauche, le bord droit vise le nord
  near(headingOf(270, 0, 0, 270), 0);
});

test('écart signé vers le point', () => {
  assert.equal(turn(10, 350), 20);
  assert.equal(turn(350, 10), -20);
  assert.equal(turn(90, 90), 0);
});

test('déclinaison plausible sur la zone', () => {
  assert.ok(declination(5.7) > 2 && declination(5.7) < 4); // Grenoble
  assert.ok(Math.abs(declination(-4.5)) < 1); // Brest
});
