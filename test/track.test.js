// Tests du suivi de plusieurs points (js/track.js, partie calcul) : `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  legs,
  stats,
  fmtDur,
  fmtSpeed,
  trackText,
  encodeTrack,
  decodeTrack,
  toGPX,
  parseGPX,
  mergeTracks,
  resumeText,
  isDup,
  placePoint
} from '../js/track.js';

const H = 3600000;
// chien perdu : collier le matin, nouveau signalement le soir 1,5 km plus au nord-est, puis le lendemain
const pts = [
  { lat: 45.2, lon: 6.2, t: 8 * H, label: 'collier' },
  { lat: 45.21, lon: 6.214, t: 17.5 * H, label: '' },
  { lat: 45.215, lon: 6.214, t: 33 * H, label: 'vu près du lac' }
];

test('étapes : distance, cap, durée, vitesse', () => {
  const L = legs(pts);
  assert.equal(L.length, 2);
  assert.ok(Math.abs(L[0].d - 1555) < 30, `distance ${L[0].d}`);
  assert.ok(L[0].b > 40 && L[0].b < 50);
  assert.equal(L[0].dt, 9.5 * H);
  assert.ok(Math.abs(L[0].v - L[0].d / 9.5) < 1);
  assert.ok(L[1].b < 2 || L[1].b > 358);
});

test('bilan : cumul, durée totale, vol d’oiseau', () => {
  const s = stats(pts);
  assert.equal(s.n, 3);
  assert.ok(s.total > s.direct);
  assert.equal(s.dt, 25 * H);
  assert.ok(s.v > 0);
  const one = stats([pts[0]]);
  assert.equal(one.total, 0);
  assert.equal(one.v, null);
  assert.equal(one.bearing, null);
});

test('durée nulle, trop courte (points ajoutés à la suite) ou dates inversées : pas de vitesse', () => {
  const L = legs([pts[0], { lat: 45.21, lon: 6.214, t: 8 * H }]);
  assert.equal(L[0].v, null);
  assert.equal(legs([pts[0], { lat: 45.21, lon: 6.214, t: 8 * H + 5 * 60000 }])[0].v, null);
  assert.equal(legs([pts[1], pts[0]])[0].v, null);
  assert.equal(stats([pts[0], { lat: 45.21, lon: 6.214, t: 8 * H + 60000 }]).v, null);
});

test('formats lisibles', () => {
  assert.equal(fmtDur(25 * 60000), '25 min');
  assert.equal(fmtDur(9.55 * H), '9 h 33');
  assert.equal(fmtDur(28 * H), '1 j 4 h');
  assert.equal(fmtDur(0), '0 min');
  assert.equal(fmtSpeed(190), '190 m/h');
  assert.equal(fmtSpeed(2500), '2,5 km/h');
  assert.equal(fmtSpeed(null), '');
});

test('message de partage : chaque point, chaque étape, le bilan', () => {
  const t = trackText(pts);
  assert.match(t, /^Suivi ESAM : 3 points/);
  assert.match(t, /1\. .*collier : 45\.200000, 6\.200000/);
  assert.match(t, /depuis le point 1, cap 4\d° NE, en 9 h 30/);
  assert.match(t, /Total : /);
  assert.equal(trackText([]), '');
});

test('nom de l’animal dans le message', () => {
  assert.match(trackText(pts, 'Pirate'), /^Suivi ESAM · Pirate : 3 points/);
});

test('lien de suivi : nom et points encodés puis relus, étiquettes avec accents et espaces', () => {
  const h = encodeTrack('Pirate', pts);
  assert.match(h, /^s=Pirate~45\.200000,6\.200000,28800,collier~/);
  const tr = decodeTrack(`#${h}`);
  assert.equal(tr.name, 'Pirate');
  assert.equal(tr.points.length, 3);
  assert.equal(tr.points[2].label, 'vu près du lac');
  assert.equal(tr.points[1].t, 17.5 * H);
  // point mal formé ignoré, autre fragment refusé
  assert.equal(decodeTrack('#s=Rex~abc,def,1~45.2,6.2,100,').points.length, 1);
  assert.equal(decodeTrack('#45.2,6.2'), null);
});

test('GPX : waypoints et trace, relus avec étiquettes et dates ; GPX d’une autre source aussi', () => {
  const g = toGPX('Pirate & co', pts);
  assert.match(g, /<name>Pirate &amp; co<\/name>/);
  assert.match(
    g,
    /<wpt lat="45\.200000" lon="6\.200000"><time>1970-01-01T08:00:00\.000Z<\/time><name>1 · collier<\/name><\/wpt>/
  );
  assert.equal((g.match(/<trkpt /g) || []).length, 3);
  const tr = parseGPX(g);
  assert.equal(tr.name, 'Pirate & co');
  assert.deepEqual(
    tr.points.map((p) => p.label),
    ['collier', '', 'vu près du lac']
  );
  assert.equal(tr.points[1].t, 17.5 * H);
  const other = parseGPX(
    '<gpx><trk><name>Rando</name><trkseg><trkpt lat="45.1" lon="6.1"><time>2026-11-02T08:00:00Z</time></trkpt></trkseg></trk></gpx>'
  );
  assert.equal(other.name, 'Rando');
  assert.equal(other.points.length, 1);
  assert.equal(parseGPX('<gpx></gpx>'), null);
});

test('fusion : doublons ignorés, points triés par date', () => {
  const m = mergeTracks([pts[1], pts[0]], [pts[1], { lat: 45.22, lon: 6.22, t: 40 * H, label: 'x' }]);
  assert.equal(m.length, 3);
  assert.deepEqual(
    m.map((p) => p.t),
    [8 * H, 17.5 * H, 40 * H]
  );
});

test('message de partage avec altitudes du terrain', () => {
  const pts = [
    { lat: 45.1007, lon: 5.902133, t: Date.parse('2026-11-02T20:38:00'), label: '' },
    { lat: 45.103283, lon: 5.913967, t: Date.parse('2026-11-02T21:30:00'), label: '' }
  ];
  const t = trackText(pts, '', [1280, 1462]);
  assert.match(t, /alt\. 1\s280 m/);
  assert.match(t, /dénivelé \+182 m, en 52 min/);
  assert.doesNotMatch(trackText(pts, '', [null, 1462]), /dénivelé/);
});

test('GPX : étiquette décodée une seule fois, points auto-fermants lus, positions hors du globe écartées', () => {
  const tr = parseGPX(
    '<gpx><wpt lat="45.1" lon="6.1"><name>1 · A &amp;lt; B &amp; C</name></wpt>' +
      '<wpt lat="95" lon="6.1"><name>hors globe</name></wpt></gpx>'
  );
  assert.equal(tr.points.length, 1);
  assert.equal(tr.points[0].label, 'A &lt; B & C');
  const seg = parseGPX(
    '<gpx><trk><trkseg><trkpt lat="45.1" lon="6.1"/><trkpt lat="45.2" lon="6.2" /></trkseg></trk></gpx>'
  );
  assert.deepEqual(
    seg.points.map((p) => [p.lat, p.lon]),
    [
      [45.1, 6.1],
      [45.2, 6.2]
    ]
  );
});

test('choix au démarrage : rappelle le nom de l’animal et le nombre de points', () => {
  assert.match(resumeText('Pirate', pts), /^Suivi en cours : « Pirate » · 3 points, dernier le /);
  assert.match(resumeText('', pts.slice(0, 1)), /^Suivi en cours sans nom · 1 point, dernier le /);
});

// ---------- Un point dans le suivi : la même règle pour une photo seule, un lot de photos et un texte saisi ----------
const A = { lat: 45.103317, lon: 5.9139 },
  near = { lat: 45.103322, lon: 5.913905 }, // à moins d'un mètre de A
  B = { lat: 45.141667, lon: 5.968333 };

test('doublon : même position à 3 m près et même minute, pas au-delà', () => {
  assert.ok(isDup({ ...A, t: 8 * H }, { ...near, t: 8 * H + 30000 }));
  assert.ok(!isDup({ ...A, t: 8 * H }, { ...near, t: 8 * H + 5 * 60000 }));
  assert.ok(!isDup({ ...A, t: 8 * H }, { ...B, t: 8 * H }));
});

test('point ajouté, trié par date, avec la clé de sa photo', () => {
  const r = placePoint([{ ...B, t: 9 * H, label: '' }], { ...A, t: 8 * H, key: 'a.jpg|1|2' });
  assert.equal(r.how, 'added');
  assert.deepEqual(
    r.pts.map((p) => p.t),
    [8 * H, 9 * H]
  );
  assert.equal(r.pts.indexOf(r.p), 0);
  assert.equal(r.p.k, 'a.jpg|1|2');
});

test('même signalement : rien n’est ajouté ; même position à une autre heure : ajoutée', () => {
  const cur = [{ ...A, t: 8 * H, label: '' }];
  assert.equal(placePoint(cur, { ...near, t: 8 * H + 20000 }).how, 'dup');
  assert.equal(placePoint(cur, { ...near, t: 8 * H + 20000 }).pts.length, 1);
  const later = placePoint(cur, { ...near, t: 18 * H });
  assert.equal(later.how, 'added');
  assert.equal(later.pts.length, 2);
});

test('photo corrigée : son point du suivi est remplacé sur place, date et étiquette gardées', () => {
  const cur = [{ ...A, t: 8 * H, label: 'collier', k: 'p1' }],
    r = placePoint(cur, { lat: 45.103167, lon: 5.9139, t: 12 * H, key: 'p1' });
  assert.equal(r.how, 'moved');
  assert.equal(r.pts.length, 1);
  assert.deepEqual(r.pts[0], { lat: 45.103167, lon: 5.9139, t: 8 * H, label: 'collier', k: 'p1' });
  assert.equal(cur[0].lat, A.lat); // le suivi d'entrée n'est pas modifié
});

test('deux photos au même endroit : la correction de la seconde ne touche pas le point de la première', () => {
  const cur = [
      { ...A, t: 8 * H, label: '', k: 'p1' },
      { ...A, t: 8 * H + 5 * 60000, label: '', k: 'p2' }
    ],
    r = placePoint(cur, { lat: 45.103167, lon: 5.9139, t: 0, key: 'p2' });
  assert.equal(r.how, 'moved');
  assert.equal(r.pts[0].lat, A.lat);
  assert.equal(r.pts[1].lat, 45.103167);
});

test('photo déjà au suivi relue ou reversée : jamais de second point, même si sa date a été changée', () => {
  const cur = [{ ...A, t: 7.5 * H, label: '', k: 'p1' }], // date corrigée à la main dans le suivi
    r = placePoint(cur, { ...A, t: 8 * H, key: 'p1' });
  assert.equal(r.how, 'same');
  assert.equal(r.pts.length, 1);
  assert.equal(r.pts[0].t, 7.5 * H);
});

test('photo déplacée dans le lot : la date de son point suit si on le demande', () => {
  const r = placePoint([{ ...A, t: 8 * H, label: '', k: 'p1' }], { ...A, t: 10 * H, key: 'p1' }, true);
  assert.equal(r.how, 'moved');
  assert.equal(r.pts[0].t, 10 * H);
});

test('photo dont le signalement est déjà au suivi sans clé : elle l’adopte, puis le corrige sur place', () => {
  const r1 = placePoint([{ ...A, t: 8 * H, label: '' }], { ...near, t: 8 * H, key: 'p1' });
  assert.equal(r1.how, 'dup');
  assert.equal(r1.pts[0].k, 'p1');
  const r2 = placePoint(r1.pts, { ...B, t: 8 * H, key: 'p1' });
  assert.equal(r2.how, 'moved');
  assert.equal(r2.pts.length, 1);
});
