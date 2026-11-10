// La version affichée dans le bandeau suit le cache du service worker : un oubli de l'un ou de l'autre casse le test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sw = readFileSync(new URL('sw.js', root), 'utf8');
// fichiers de l'appli gardés hors ligne : la liste SHELL de sw.js
const shell = [...sw.slice(sw.indexOf('SHELL = ['), sw.indexOf('];')).matchAll(/'([^']+)'/g)].map((m) => m[1]);

test('version du bandeau = version du cache sw.js', () => {
  const util = readFileSync(new URL('js/util.js', root), 'utf8');
  const v = util.match(/export const VERSION = '([^']+)'/)[1];
  assert.match(sw, new RegExp(`const V = 'esam-gps-v${v.replace(/\./g, '\\.')}'`));
});

test('chaque module de js/ est dans le cache hors ligne', () => {
  const modules = readdirSync(new URL('js/', root)).filter((f) => f.endsWith('.js'));
  assert.ok(modules.length > 10);
  for (const f of modules) assert.ok(shell.includes(`js/${f}`), f);
});

test('chaque fichier du cache hors ligne existe', () => {
  assert.ok(shell.length > 20);
  for (const f of shell) if (f !== './') assert.ok(existsSync(new URL(f, root)), f);
});

test('chaque fichier local appelé par index.html est dans le cache hors ligne', () => {
  const html = readFileSync(new URL('index.html', root), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 5);
  for (const f of refs) assert.ok(shell.includes(f), f);
});

test('moteur Tesseract : même dossier dans ocr.js et sw.js, trois variantes présentes, sorties par blocs demandées', () => {
  const ocr = readFileSync(new URL('js/ocr.js', root), 'utf8');
  const dir = ocr.match(/core: '(vendor\/tesseract\/core-\d+)'/)[1];
  assert.ok(sw.includes(`${dir}/`), dir);
  for (const v of ['', 'simd-', 'relaxedsimd-'])
    assert.ok(existsSync(new URL(`${dir}/tesseract-core-${v}lstm.wasm.js`, root)), v);
  // depuis tesseract.js 6, sans cette demande, plus de mots ni de boîtes : la zone des coordonnées ne serait plus trouvée
  assert.equal(ocr.match(/\.recognize\([^)]*, \{\}, OUT\)/g).length, 2);
  assert.match(ocr, /const OUT = \{ text: true, blocks: true \}/);
});
