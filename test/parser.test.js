// Tests du parseur : `npm test` (Node 18 ou plus, aucune dépendance).
// Chaque piège de lecture rencontré sur le terrain doit finir ici comme cas de non-régression.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, normalize, inRegion, toDMM, toDMS, toUTM, distM, bearing } from '../js/parser.js';

// Point de référence : 45.271283, 5.934200 (N 45°16.277' E 005°56.052')
const REF = { lat: 45.271283, lon: 5.9342 };

function near(r, exp, tolM = 3) {
  assert.ok(r.ok, 'aucune coordonnée trouvée');
  const d = distM(r.best, exp);
  assert.ok(d <= tolM, `écart de ${d.toFixed(1)} m (lu ${r.best.lat}, ${r.best.lon})`);
}

const CASES = [
  // [nom, texte, format attendu, fiable (pas d'alerte) ?]
  ['écran Garmin complet', "Tania\nDistance du trajet: 2.4 km\nSurface: 271.04 m²\nDistance: 0.3 km\nPosition: N 45°16.277'\nE 005°56.052'\nAscension totale: 0 m\nAltitude max.: 0 m", 'DMM', true],
  ['DMS avec hémisphères en suffixe', "45°16'16.6\"N 5°56'03.1\"E", 'DMS', true],
  ['UTM', '31T 0730165 5017276', 'UTM 31T', true],
  ['UTM avec E et N', '31T E 730165 N 5017276', 'UTM 31T', true],
  ['degrés décimaux', '45.271283, 5.934200', 'DD', true],
  ['degrés décimaux à virgule', '45,271283 5,934200', 'DD', true],
  ['lien Google Maps @', 'https://www.google.com/maps/@45.271283,5.9342,15z', 'DD', true],
  ['lien Google Maps ?q=', 'https://maps.google.com/?q=45.271283,5.9342', 'DD', true],
  ['lien geo:', 'geo:45.271283,5.934200', 'DD', true],
  ['DMM sans symboles', 'N45 16.277 E5 56.052', 'DMM', true],
  ['NMEA', '4516.277,N,00556.052,E', 'NMEA', false],
  ['ordre inversé', '5.934200, 45.271283', 'DD', false],
  ['mots autour', 'lat 45.271283 lon 5.9342 alt 1450 m', 'DD', true],
  ['SMS avec heure', 'RDV à 14h30, point 45.271283 5.9342', 'DD', true],
  ['guillemets après minutes décimales', "N 45°16.277\" E 005°56.052\"", 'DMM', true],
  ['OCR : O pour 0 et apostrophe pour °', "sition: N 45'16.277\nE OO5o56.O52 |\nAscension totale: Omg", 'DMM', false],
];

for (const [name, text, fmt, reliable] of CASES) {
  test(name, () => {
    const r = parse(text);
    near(r, REF);
    assert.equal(r.best.fmt, fmt);
    assert.equal(r.conf === 'ok', reliable, 'notes : ' + r.best.notes.map(n => n.t).join(' | '));
  });
}

test('ordre inversé signalé', () => {
  const r = parse('5.934200, 45.271283');
  assert.ok(r.best.notes.some(n => /ordre inverse/.test(n.t)));
});

test('hémisphères Sud et Ouest donnent des valeurs négatives', () => {
  const r = parse("S 33°52.000' W 070°10.000'");
  assert.ok(r.ok);
  assert.ok(r.best.lat < 0 && r.best.lon < 0);
  assert.ok(r.best.notes.some(n => /hors de France/.test(n.t)));
});

test('Ouest en français (O)', () => {
  const r = parse("N 45°16.277' O 001°56.052'");
  assert.ok(r.ok);
  assert.ok(r.best.lon < 0);
  assert.ok(r.best.notes.some(n => /Ouest/.test(n.t)));
});

test('peu de décimales : position signalée imprécise', () => {
  const r = parse('45.27, 5.93');
  assert.ok(r.ok);
  assert.equal(r.conf, 'check');
  assert.ok(r.best.notes.some(n => /décimale/.test(n.t)));
});

test('texte sans coordonnées', () => {
  assert.equal(parse('bonjour, rien à signaler').ok, false);
  assert.deepEqual(parse('   '), { ok: false, empty: true });
  assert.deepEqual(parse(''), { ok: false, empty: true });
});

test('OCR : l pour 1 dans les minutes', () => {
  const r = parse("N 45°16.2l7' E 005°56.052'");
  near(r, { lat: 45 + 16.217 / 60, lon: REF.lon }, 0.5);
});

test.todo('OCR : l pour 1 juste après le symbole degré (°l6) non corrigé', () => {
  near(parse("N 45°l6.277' E 005°56.052'"), REF);
});

test('deux points dans le texte : seconde proposition', () => {
  const r = parse('45.2712 5.9342 45.3001 5.9001');
  assert.ok(r.ok);
  assert.equal(r.conf, 'check');
  assert.equal(r.alts.length, 1);
});

test('point en Suisse (Grisons) accepté sans alerte de zone', () => {
  const r = parse('46.801230, 10.204560');
  assert.ok(r.ok);
  assert.ok(!r.best.notes.some(n => /hors de France/.test(n.t)));
});

test('texte long traité rapidement', () => {
  const big = 'Distance du trajet: 2.4 km Surface 271.04 m² '.repeat(300) + " N 45°16.277' E 005°56.052'";
  const t = Date.now();
  near(parse(big), REF);
  assert.ok(Date.now() - t < 2000);
});

test('normalize : symboles et confusions de lettres', () => {
  assert.equal(normalize('45º16′27″'), '45°16\'27"');
  assert.equal(normalize("E OO5o56.O52"), "E 005°56.052");
  assert.equal(normalize('45 deg 16'), '45 ° 16');
});

test('inRegion', () => {
  assert.ok(inRegion(45.27, 5.93)); // Chartreuse
  assert.ok(inRegion(48.85, 2.35)); // Paris
  assert.ok(inRegion(46.8, 10.2)); // Grisons
  assert.ok(inRegion(47.26, 11.39)); // Innsbruck
  assert.ok(!inRegion(40.4, -3.7)); // Madrid
});

test('conversions DMM, DMS, UTM', () => {
  assert.equal(toDMM(REF.lat, true), "N 45°16.277'");
  assert.equal(toDMM(REF.lon, false), "E 005°56.052'");
  assert.equal(toDMM(-0.5, false), "O 000°30.000'");
  assert.equal(toDMS(REF.lat, true), 'N 45°16\'16.6"');
  assert.equal(toDMM(45.9999999, true), "N 46°00.000'");
  assert.equal(toDMS(45.99999999, true), 'N 46°00\'00.0"');
  assert.equal(toUTM(REF.lat, REF.lon), '31T 730165 5017276');
});

test('aller-retour UTM', () => {
  for (const [la, lo] of [[45.27, 5.93], [44.1, 7.6], [46.5, 6.1], [43.3, -1.5]]) {
    const r = parse(toUTM(la, lo));
    assert.ok(r.ok);
    assert.ok(distM(r.best, { lat: la, lon: lo }) < 2);
  }
});

test('distance et cap', () => {
  const a = { lat: 45, lon: 6 }, b = { lat: 45.01, lon: 6 };
  assert.ok(Math.abs(distM(a, b) - 1112) < 2);
  assert.ok(Math.abs(bearing(a, b)) < 0.01);
  assert.ok(Math.abs(bearing(a, { lat: 45, lon: 6.01 }) - 90) < 0.1);
});
