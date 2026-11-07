// AirOps et Itinéraire : contrôle du point (France métropolitaine, latitude d'abord) et liens produits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPoint, ddText, airopsUrl, routeUrl, geoUrl } from '../js/go.js';

test('inter 124 Montaud : point valide et liens', () => {
  assert.deepEqual(checkPoint(45.236499, 5.544161), { ok: true });
  assert.equal(ddText(45.236499, 5.544161), '45.236499, 5.544161');
  assert.equal(airopsUrl(45.236499, 5.544161), 'https://airops-supuav.fr/map/#14/45.236499/5.544161');
  assert.equal(
    routeUrl(45.236499, 5.544161),
    'https://www.google.com/maps/dir/?api=1&destination=45.236499,5.544161&travelmode=driving'
  );
  assert.equal(geoUrl(45.236499, 5.544161), 'geo:45.236499,5.544161?q=45.236499,5.544161(Intervention%20ESAM)');
});

test('6 décimales, point décimal, longitude négative', () => {
  assert.equal(ddText(48.1, -4.5), '48.100000, -4.500000');
  assert.deepEqual(checkPoint(48.1, -4.5), { ok: true });
});

test('bornes de la France métropolitaine', () => {
  assert.ok(checkPoint(41, -5.5).ok);
  assert.ok(checkPoint(51.5, 10).ok);
  assert.ok(checkPoint(42.0, 9.2).ok); // Corse
  assert.equal(checkPoint(40.99, 5).ok, false);
  assert.equal(checkPoint(46, 10.01).ok, false);
});

test('latitude et longitude inversées : inversion proposée, pas corrigée', () => {
  const r = checkPoint(5.544161, 45.236499);
  assert.equal(r.ok, false);
  assert.equal(r.swap, true);
  assert.match(r.msg, /inversées/);
});

test('hors de France ou invalide : désactivé avec un message', () => {
  const r = checkPoint(46.5, 11.5); // Dolomites
  assert.equal(r.ok, false);
  assert.equal(r.swap, false);
  assert.match(r.msg, /hors de France/);
  assert.equal(checkPoint(NaN, 5).ok, false);
  assert.equal(checkPoint('45', 5).ok, false);
});
