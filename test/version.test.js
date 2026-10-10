// La version affichée dans le bandeau suit le cache du service worker : un oubli de l'un ou de l'autre casse le test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('version du bandeau = version du cache sw.js', () => {
  const util = readFileSync(new URL('../js/util.js', import.meta.url), 'utf8');
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const v = util.match(/export var VERSION = '([^']+)'/)[1];
  assert.match(sw, new RegExp("var V = 'esam-gps-v" + v.replace(/\./g, '\\.') + "'"));
});

test('chaque module de js/ est dans le cache hors ligne', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  for (const f of ['app', 'parser', 'util', 'map', 'share', 'history', 'ocr', 'fix']) assert.ok(sw.includes("'js/" + f + ".js'"), f);
});
