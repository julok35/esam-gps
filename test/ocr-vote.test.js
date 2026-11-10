// Tests du vote entre lectures OCR (js/ocr.js) : `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../js/parser.js';
import { votes, firm, widen, turnBox } from '../js/ocr.js';

const run = (txt) => ({ txt, p: parse(txt) });

test('trois lectures identiques : résultat ferme', () => {
  const runs = [
    run("N 45°16.277' E 005°56.052'"),
    run("N 45°16.277' E 005°56.052'"),
    run("N 45°16.277' E 005°56.052'")
  ];
  const v = votes(runs);
  assert.ok(firm(v.lat) && firm(v.lon));
  assert.equal(v.lat.best.n, 3);
});

test('dernier chiffre des minutes différent (moins de 2 m) : les lectures votent ensemble, la valeur majoritaire gagne', () => {
  const runs = [
    run("N 45°16.277' E 005°56.052'"),
    run("N 45°16.277' E 005°56.052'"),
    run("N 45°16.278' E 005°56.052'")
  ];
  const v = votes(runs);
  assert.equal(v.lat.best.n, 3);
  assert.equal(v.lat.second, null);
  assert.equal(v.lat.best.v.toFixed(6), (45 + 16.277 / 60).toFixed(6));
  assert.ok(firm(v.lat));
});

test('lectures nettement différentes : pas de résultat ferme', () => {
  const runs = [
    run("N 45°16.277' E 005°56.052'"),
    run("N 45°16.277' E 005°56.052'"),
    run("N 45°18.277' E 005°56.052'"),
    run("N 45°18.277' E 005°56.052'")
  ];
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

test('cadre élargi : une ligne au-dessus et au-dessous, sans sortir de la photo', () => {
  const b = widen({ x: 0.5, y: 0.4, w: 0.3, h: 0.05 });
  assert.ok(Math.abs(b.y - 0.35) < 1e-9 && Math.abs(b.h - 0.15) < 1e-9, JSON.stringify(b));
  assert.ok(Math.abs(b.x - 0.455) < 1e-9 && Math.abs(b.w - 0.39) < 1e-9, JSON.stringify(b));
  const edge = widen({ x: 0.8, y: 0.01, w: 0.2, h: 0.05 });
  assert.equal(edge.y, 0);
  assert.ok(edge.x + edge.w <= 1 + 1e-9);
});

test('cadre suivi dans la photo tournée : même endroit, même taille en pixels', () => {
  // quart de tour : une image 200 × 100 devient 100 × 200
  const img = { width: 200, height: 100 },
    turned = { width: 100, height: 200 },
    b = turnBox({ x: 0.7, y: 0.4, w: 0.2, h: 0.2 }, img, turned, 90);
  // centre (160, 50) -> à 60 px à droite du centre -> après +90° : 60 px sous le centre
  assert.ok(Math.abs(b.x + b.w / 2 - 0.5) < 1e-9 && Math.abs(b.y + b.h / 2 - 0.8) < 1e-9, JSON.stringify(b));
  const same = turnBox({ x: 0.1, y: 0.2, w: 0.3, h: 0.1 }, img, img, 0);
  assert.ok(Math.abs(same.x - 0.1) < 1e-9 && Math.abs(same.w - 0.3) < 1e-9);
});
