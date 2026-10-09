// Tests du vote entre lectures OCR (js/ocr.js) : `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../js/parser.js';
import { votes, firm } from '../js/ocr.js';

const run = (txt) => ({ txt, p: parse(txt) });

test('trois lectures identiques : résultat ferme', () => {
  const runs = [run("N 45°16.277' E 005°56.052'"), run("N 45°16.277' E 005°56.052'"), run("N 45°16.277' E 005°56.052'")];
  const v = votes(runs);
  assert.ok(firm(v.lat) && firm(v.lon));
  assert.equal(v.lat.best.n, 3);
});

test('dernier chiffre des minutes différent (moins de 2 m) : les lectures votent ensemble, la valeur majoritaire gagne', () => {
  const runs = [run("N 45°16.277' E 005°56.052'"), run("N 45°16.277' E 005°56.052'"), run("N 45°16.278' E 005°56.052'")];
  const v = votes(runs);
  assert.equal(v.lat.best.n, 3);
  assert.equal(v.lat.second, null);
  assert.equal(v.lat.best.v.toFixed(6), (45 + 16.277 / 60).toFixed(6));
  assert.ok(firm(v.lat));
});

test('lectures nettement différentes : pas de résultat ferme', () => {
  const runs = [run("N 45°16.277' E 005°56.052'"), run("N 45°16.277' E 005°56.052'"), run("N 45°18.277' E 005°56.052'"), run("N 45°18.277' E 005°56.052'")];
  const v = votes(runs);
  assert.equal(v.lat.best.n, 2);
  assert.equal(v.lat.second.n, 2);
  assert.ok(!firm(v.lat));
  assert.ok(!firm(v.lon) || v.lon.best.n === 4);
});

test('lecture hors zone ignorée, point suisse accepté', () => {
  const v1 = votes([run('40.4, -3.7123'), run('40.4, -3.7123'), run('40.4, -3.7123')]);
  assert.equal(v1.lat.best, null);
  const v2 = votes([run('46.80123, 10.20456'), run('46.80123, 10.20456'), run('46.80123, 10.20456')]);
  assert.ok(firm(v2.lat) && firm(v2.lon));
});

test('lecture sans coordonnée ignorée', () => {
  const v = votes([run('bonjour'), run('')]);
  assert.equal(v.lat.best, null);
});
