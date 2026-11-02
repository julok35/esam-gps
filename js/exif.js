/* Date de prise de vue d'une photo JPEG (sans DOM, testé sous Node) : segment APP1 « Exif », IFD0 puis sous-IFD Exif,
   étiquette DateTimeOriginal (0x9003) « AAAA:MM:JJ HH:MM:SS », à défaut DateTime (0x0132) de l'IFD0.
   Retour : date en ms (heure locale du téléphone, l'EXIF n'a pas de fuseau), ou null. */
export function exifDate(buf) {
  var d = new DataView(buf),
    n = d.byteLength;
  if (n < 4 || d.getUint16(0) !== 0xffd8) return null;
  var p = 2;
  while (p + 4 <= n) {
    if (d.getUint8(p) !== 0xff) return null;
    var marker = d.getUint8(p + 1);
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      p += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return null; // début des données d'image : plus d'en-têtes
    var len = d.getUint16(p + 2);
    if (marker === 0xe1 && p + 10 <= n && d.getUint32(p + 4) === 0x45786966) return tiff(d, p + 10, p + 2 + len);
    p += 2 + len;
  }
  return null;
}
function tiff(d, t0, end) {
  if (t0 + 8 > end) return null;
  var le = d.getUint16(t0) === 0x4949,
    u16 = function (o) {
      return d.getUint16(o, le);
    },
    u32 = function (o) {
      return d.getUint32(o, le);
    };
  if (u16(t0 + 2) !== 42) return null;
  var ifd0 = t0 + u32(t0 + 4),
    found = { orig: null, mod: null, exif: null };
  var scan = function (ifd, into) {
    if (ifd < t0 || ifd + 2 > end) return;
    var cnt = u16(ifd);
    for (var i = 0; i < cnt; i++) {
      var e = ifd + 2 + i * 12;
      if (e + 12 > end) return;
      var tag = u16(e),
        type = u16(e + 2),
        num = u32(e + 4),
        val = e + 8;
      if (tag === 0x8769 && type === 4) into.exif = t0 + u32(val);
      if ((tag === 0x9003 || tag === 0x0132) && type === 2 && num >= 19) {
        var o = num > 4 ? t0 + u32(val) : val,
          s = '';
        if (o + 19 > end) continue;
        for (var k = 0; k < 19; k++) s += String.fromCharCode(d.getUint8(o + k));
        if (tag === 0x9003) into.orig = s;
        else into.mod = into.mod || s;
      }
    }
  };
  scan(ifd0, found);
  if (found.exif !== null) scan(found.exif, found);
  return parseDate(found.orig) || parseDate(found.mod);
}
// « 2026:11:02 08:12:33 » -> ms en heure locale ; dates vides (« 0000:00:00 ») ignorées
export function parseDate(s) {
  var m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s || '');
  if (!m || m[1] === '0000') return null;
  var t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  return isFinite(t) && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31 ? t : null;
}
