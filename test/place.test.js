// Lieux proches : tri des éléments OpenStreetMap, distance au bord d'un lac, doublons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearby, kindOf, fmtDelta } from '../js/place.js';

const P = { lat: 45.1, lon: 6.0 };

test('sortes de lieux reconnues', () => {
  assert.equal(kindOf({ natural: 'peak' }), 'sommet');
  assert.equal(kindOf({ natural: 'saddle', mountain_pass: 'yes' }), 'col');
  assert.equal(kindOf({ waterway: 'waterfall' }), 'cascade');
  assert.equal(kindOf({ natural: 'water', water: 'lake' }), 'lac');
  assert.equal(kindOf({ natural: 'water', water: 'river' }), null);
  assert.equal(kindOf({ tourism: 'alpine_hut' }), 'refuge');
  assert.equal(kindOf({ amenity: 'bench' }), null);
});

test('tri par distance, lac mesuré au bord, doublon gardé au plus proche', () => {
  const els = [
    { type: 'node', lat: 45.11, lon: 6.0, tags: { name: 'Pic Loin', natural: 'peak' } },
    { type: 'node', lat: 45.101, lon: 6.0, tags: { name: 'Col du Test', natural: 'saddle' } },
    { type: 'node', lat: 45.1005, lon: 6.0, tags: { name: 'Col du Test', mountain_pass: 'yes' } },
    {
      type: 'way',
      tags: { name: 'Lac Rond', natural: 'water' },
      geometry: [
        { lat: 45.098, lon: 6.0 },
        { lat: 45.09, lon: 6.0 }
      ]
    },
    { type: 'node', lat: 45.1001, lon: 6.0001, tags: { name: 'Banc', amenity: 'bench' } }
  ];
  const r = nearby(els, P, 3);
  assert.deepEqual(
    r.map((x) => x.name),
    ['Col du Test', 'Lac Rond', 'Pic Loin']
  );
  assert.ok(Math.abs(r[0].d - 55.6) < 2, 'col à ~56 m');
  assert.ok(Math.abs(r[1].d - 222) < 3, 'lac mesuré au bord le plus proche');
  assert.ok(Math.abs(r[0].b - 180) < 1, 'le point est au sud du col');
});

test('dénivelé signé', () => {
  assert.equal(fmtDelta(345.4), '+345 m');
  assert.equal(fmtDelta(-12.6), '−13 m');
  assert.equal(fmtDelta(0.2), '±0 m');
});
