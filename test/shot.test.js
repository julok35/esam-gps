// Tests de la fiche d'une photo (js/shot.js) : date, état, point retenu : les règles communes à une photo seule et à
// un lot de photos. `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shotKey, dateOf, newShot, stateOf, shotPoint, pointOf, SRC } from '../js/shot.js';
import { NO_ZONE, NO_READ } from '../js/pipeline.js';
import { parse } from '../js/parser.js';

// JPEG minimal avec la date EXIF DateTime (IFD0), puis fichier factice : { name, size, lastModified, slice }
function jpeg(date) {
  const u16 = (v) => [v & 255, v >> 8],
    u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24],
    tiff = [0x49, 0x49, ...u16(42), ...u32(8), ...u16(1), ...u16(0x0132), ...u16(2), ...u32(20), ...u32(26), ...u32(0)],
    app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff, ...Array.from(`${date}\0`).map((c) => c.charCodeAt(0))],
    len = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...app1, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
}
function file(bytes, lastModified, name) {
  return {
    name: name || 'photo.jpg',
    size: bytes.length,
    lastModified,
    slice: () => ({ arrayBuffer: () => Promise.resolve(bytes.buffer) })
  };
}
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  T_FILE = new Date(2026, 10, 5, 12, 0, 0).getTime(),
  T_EXIF = new Date(2026, 10, 2, 8, 12, 33).getTime();

test('date : prise de vue (EXIF) d’abord, sinon date du fichier, sinon heure de la lecture', async () => {
  assert.deepEqual(await dateOf(file(jpeg('2026:11:02 08:12:33'), T_FILE)), { t: T_EXIF, src: 'exif' });
  assert.deepEqual(await dateOf(file(PNG, T_FILE)), { t: T_FILE, src: 'file' });
  const d = await dateOf(file(PNG, 0));
  assert.equal(d.src, 'now');
  assert.ok(Math.abs(d.t - Date.now()) < 5000);
  // fichier qui ne se lit pas : sa date quand même
  assert.deepEqual(await dateOf({ lastModified: T_FILE }), { t: T_FILE, src: 'file' });
  for (const k of ['exif', 'file', 'now', 'moved']) assert.ok(SRC[k]);
});

test('fiche neuve : datée, à lire, et la même photo garde la même clé', async () => {
  const f = file(PNG, T_FILE, 'IMG_1.png'),
    a = await newShot(f),
    b = await newShot(f);
  assert.equal(a.st, 'wait');
  assert.equal(a.t, T_FILE);
  assert.equal(a.t0, T_FILE);
  assert.equal(a.src, 'file');
  assert.notEqual(a.id, b.id);
  assert.equal(a.key, b.key);
  assert.equal(a.key, shotKey(f));
  assert.notEqual(shotKey(f), shotKey(file(PNG, T_FILE + 1000, 'IMG_1.png')));
});

// lecture telle que la rend pipeline.readPhoto
const read = (text, level) => ({
    text,
    p: Object.assign(parse(text), { trust: { pct: 86, level, why: [] }, ocr: true })
  }),
  GOOD = "N 45°06.199' E005°54.834'";

test('état d’une lecture : fiable, douteuse, zone non trouvée, rien lu : mêmes textes qu’à l’écran', () => {
  const ok = read(GOOD, 'ok');
  assert.deepEqual(stateOf({ found: true, res: ok, trust: ok.p.trust, quad: null, angle: 0 }), {
    st: 'ok',
    msg: 'fiable 86 %'
  });
  assert.deepEqual(stateOf({ found: true, res: ok, trust: ok.p.trust, quad: [[0, 0]], angle: -1.8 }), {
    st: 'ok',
    msg: 'fiable 86 % (perspective, redressée −1,8°)'
  });
  const doubt = read(GOOD, 'check');
  assert.equal(stateOf({ found: true, res: doubt, trust: doubt.p.trust }).st, 'check');
  assert.match(stateOf({ found: true, res: doubt, trust: doubt.p.trust }).msg, /^douteux 86 %/);
  assert.deepEqual(stateOf({ found: false }), { st: 'none', msg: NO_ZONE });
  assert.deepEqual(stateOf({ found: true, res: { none: true }, trust: null }), { st: 'none', msg: NO_READ });
  // le texte de l'étape affichée fait foi
  assert.equal(stateOf({ found: false }, { zone: { st: 'warn', msg: 'texte de l’étape' } }).msg, 'texte de l’étape');
});

test('point retenu : rien sans lecture, la lecture, puis la correction à la main', () => {
  const shot = { st: 'wait', r: null, fix: null };
  assert.equal(shotPoint(shot), null);
  assert.equal(pointOf(shot), null);
  assert.equal(shotPoint(null), null);
  shot.r = { found: false, res: null };
  assert.equal(shotPoint(shot), null);
  const res = read(GOOD, 'ok');
  shot.r = { found: true, res };
  assert.equal(shotPoint(shot).text, GOOD);
  assert.equal(shotPoint(shot).p, res.p);
  assert.equal(pointOf(shot).lat.toFixed(6), '45.103317');
  // correction aux molettes : elle remplace la lecture, dans le format lu
  const fixed = "N 45°06.190' E 005°54.834'";
  shot.fix = { text: fixed, p: Object.assign(parse(fixed), { verified: true }), chosen: 0 };
  assert.equal(shotPoint(shot).text, fixed);
  assert.equal(pointOf(shot).lat.toFixed(6), '45.103167');
  assert.match(pointOf(shot).fmt, /DMM/);
});

test('point retenu : texte lu sans coordonnées : affiché, mais aucun point', () => {
  const shot = { r: { found: true, res: { none: true, text: 'Batterie 80 %', p: parse('Batterie 80 %') } }, fix: null };
  assert.equal(shotPoint(shot).text, 'Batterie 80 %');
  assert.equal(pointOf(shot), null);
});

test('point retenu : autre lecture choisie parmi les propositions', () => {
  const p = parse(GOOD);
  p.alts = [{ lat: 45.2, lon: 5.9, seg: 'autre lecture', notes: [], fmt: p.best.fmt }];
  const shot = { r: null, fix: { text: GOOD, p, chosen: 1 } };
  assert.equal(pointOf(shot).lat, 45.2);
});
