// Tests de la confiance et de la règle de transmission (js/trust.js) : `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confidence, trusted } from '../js/trust.js';

test('photo : lectures concordantes et moteur sûr : fiable', () => {
  const t = confidence({ tess: 92, agree: { n: 3, total: 3 }, firm: true, rival: false, notes: 0, alts: 0 });
  assert.equal(t.level, 'ok');
  assert.equal(t.pct, 93);
  assert.ok(t.why.some((w) => /3 lectures sur 3/.test(w)));
});

test('photo Garmin réelle : 3 lectures sur 3 concordantes, moteur à 41 % sur les chiffres : fiable quand même', () => {
  const t = confidence({ tess: 41, agree: { n: 3, total: 3 }, firm: true, rival: false, notes: 0, alts: 0 });
  assert.equal(t.level, 'ok');
  assert.ok(t.pct >= 80, 'pct ' + t.pct);
  assert.ok(t.why.some((w) => /hésitant/.test(w)));
  // plus de lectures d'accord : un peu mieux encore, 95 au plus
  assert.equal(
    confidence({ tess: 90, agree: { n: 6, total: 6 }, firm: true, rival: false, notes: 0, alts: 0 }).pct,
    99
  );
});

test('photo : lectures discordantes, valeur concurrente : douteux, note basse', () => {
  const t = confidence({ tess: 90, agree: { n: 2, total: 8 }, firm: false, rival: true, notes: 1, alts: 1 });
  assert.equal(t.level, 'check');
  assert.ok(t.pct < 30, 'pct ' + t.pct);
  assert.ok(t.why.some((w) => /concurrent|autre valeur/.test(w)));
});

test('photo : concordante, moteur très hésitant ou muet : la concordance l\u2019emporte, avertissement en moins', () => {
  const t = confidence({ tess: 20, agree: { n: 3, total: 4 }, firm: true, rival: false, notes: 0, alts: 0 });
  assert.equal(t.level, 'ok');
  assert.equal(t.pct, 78);
  const t2 = confidence({ tess: null, agree: { n: 3, total: 3 }, firm: true, rival: false, notes: 0, alts: 0 });
  assert.equal(t2.level, 'ok');
  assert.equal(t2.pct, 88);
  const t3 = confidence({ tess: 90, agree: { n: 3, total: 3 }, firm: true, rival: false, notes: 1, alts: 0 });
  assert.equal(t3.level, 'check');
  assert.equal(t3.pct, 79);
});

test('texte saisi : fiable sans avertissement, douteux avec', () => {
  assert.equal(confidence({ manual: true, notes: 0, alts: 0 }).level, 'ok');
  const t = confidence({ manual: true, notes: 1, alts: 0 });
  assert.equal(t.level, 'check');
  assert.equal(t.pct, 80);
});

test('transmissible : fiable ou vérifié à la main', () => {
  assert.ok(trusted({ ok: true, trust: { level: 'ok' } }));
  assert.ok(!trusted({ ok: true, trust: { level: 'check' } }));
  assert.ok(trusted({ ok: true, verified: true, trust: { level: 'check' } }));
  assert.ok(!trusted({ ok: false }));
  assert.ok(!trusted(null));
});
