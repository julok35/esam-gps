// Tests de la date de prise de vue EXIF (js/exif.js) : `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exifDate, parseDate } from '../js/exif.js';

// JPEG minimal : SOI, APP1 Exif (TIFF petit-boutiste, IFD0 avec DateTime et pointeur Exif, sous-IFD avec DateTimeOriginal), SOS
function jpeg(orig, mod, bigEndian) {
  const le = !bigEndian;
  const tiff = [];
  const u16 = (v) => (le ? [v & 255, v >> 8] : [v >> 8, v & 255]);
  const u32 = (v) =>
    le ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24] : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255];
  const str = (s) => Array.from(s + '\0').map((c) => c.charCodeAt(0));
  // en-tête TIFF (8) + IFD0 : 2 entrées (26) + 4 (suivant) = 38 ; chaîne DateTime à 38 (20) ; sous-IFD Exif à 58 ; chaîne orig à 58 + 2 + 12 + 4 = 76
  tiff.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8));
  tiff.push(...u16(2));
  tiff.push(...u16(0x0132), ...u16(2), ...u32(20), ...u32(38));
  tiff.push(...u16(0x8769), ...u16(4), ...u32(1), ...u32(58));
  tiff.push(...u32(0));
  tiff.push(...str(mod));
  tiff.push(...u16(1));
  tiff.push(...u16(0x9003), ...u16(2), ...u32(20), ...u32(76));
  tiff.push(...u32(0));
  tiff.push(...str(orig));
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = app1.length + 2;
  const bytes = [0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...app1, 0xff, 0xda, 0, 2, 0xff, 0xd9];
  return new Uint8Array(bytes).buffer;
}

test('DateTimeOriginal du sous-IFD Exif, petit et gros boutiste', () => {
  const want = new Date(2026, 10, 2, 8, 12, 33).getTime();
  assert.equal(exifDate(jpeg('2026:11:02 08:12:33', '2026:11:03 10:00:00')), want);
  assert.equal(exifDate(jpeg('2026:11:02 08:12:33', '2026:11:03 10:00:00', true)), want);
});

test('sans DateTimeOriginal valable : DateTime de l’IFD0 ; rien : null', () => {
  assert.equal(exifDate(jpeg('0000:00:00 00:00:00', '2026:11:03 10:00:00')), new Date(2026, 10, 3, 10, 0, 0).getTime());
  assert.equal(exifDate(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]).buffer), null);
  assert.equal(exifDate(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer), null);
  assert.equal(exifDate(new Uint8Array(2).buffer), null);
});

test('parseDate : format strict', () => {
  assert.equal(parseDate('2026:13:02 08:12:33'), null);
  assert.equal(parseDate('nope'), null);
  assert.equal(parseDate(null), null);
});
