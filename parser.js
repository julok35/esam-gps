/* Moteur de detection et de conversion de coordonnees (texte OCR bruite) */
var Geo = (function () {
  var ALPES = { la0: 43.0, la1: 48.6, lo0: 4.0, lo1: 17.0 };
  var FRANCE = { la0: 41.0, la1: 51.6, lo0: -5.6, lo1: 10.0 };
  function inBox(b, lat, lon) { return lat >= b.la0 && lat <= b.la1 && lon >= b.lo0 && lon <= b.lo1; }

  function normalize(t) {
    t = t.normalize('NFKC');
    t = t.replace(/[′’‘´`ʹʼ]/g, "'");
    t = t.replace(/[″“”ʺ]/g, '"');
    t = t.replace(/''/g, '"');
    t = t.replace(/[º˚ᵒ⁰°]/g, '°');
    t = t.replace(/\bdeg(r[eé]s?)?\b/gi, '°');
    t = t.replace(/(\d)\s*\*/g, '$1°');
    t = t.replace(/(^|[^A-Za-z0-9.,])[oO]{1,2}(?=\d)/g, function (m, p) { return p + m.slice(p.length).replace(/[oO]/g, '0'); });
    // o / O colle entre un nombre de 1 a 3 chiffres et des minutes : symbole degre mal lu
    t = t.replace(/(^|[^\d.,])(\d{1,3})[oO](?=\s?\d{1,2}(?:[.,][\dOo]|\s*'|\s+\d))/g, '$1$2°');
    // O / o / l / I / | colles a des chiffres : chiffres mal lus
    for (var i = 0; i < 3; i++) {
      t = t.replace(/(\d)[oO](?=[\d.,°'"])/g, '$10').replace(/([\d.,])[oO](?=\d)/g, '$10');
      t = t.replace(/(\d)[lI|](?=[\d.,])/g, '$11').replace(/([\d.,])[lI|](?=\d)/g, '$11');
    }
    t = t.replace(/(^|[^A-Za-z0-9.,])[oO]{1,2}(?=\d)/g, function (m, p) { return p + m.slice(p.length).replace(/[oO]/g, '0'); });
    return t;
  }

  // Tokenisation : nombres, symboles d'unite, lettres d'hemisphere, mots (coupent les sequences)
  function tokenize(t) {
    var dotDecimal = /\d\.\d/.test(t);
    var toks = [], re = /(-?)(\d+(?:[.,]\d+)?)|([°'"])|([A-Za-zÀ-ÿ]+)|(\S)/g, m;
    while ((m = re.exec(t))) {
      var s = m.index, e = re.lastIndex;
      if (m[2] !== undefined) {
        var raw = m[2];
        if (raw.indexOf(',') >= 0) {
          if (dotDecimal) { // virgule = separateur : couper
            var parts = raw.split(',');
            toks.push({ k: 'num', raw: parts[0], neg: !!m[1], s: s, e: s + m[1].length + parts[0].length });
            re.lastIndex = s + m[1].length + parts[0].length + 1;
            continue;
          }
          raw = raw.replace(',', '.');
        }
        toks.push({ k: 'num', raw: raw, neg: !!m[1], s: s, e: e });
      } else if (m[3]) {
        toks.push({ k: 'sym', v: m[3], s: s, e: e });
      } else if (m[4]) {
        var w = m[4];
        if (/^[NSEWO]$/i.test(w) && (w === w.toUpperCase() || true) && w.length === 1) {
          var L = w.toUpperCase();
          toks.push({ k: 'hemi', v: L, s: s, e: e });
        } else if (/^(nord|north)$/i.test(w)) toks.push({ k: 'hemi', v: 'N', s: s, e: e });
        else if (/^(sud|south)$/i.test(w)) toks.push({ k: 'hemi', v: 'S', s: s, e: e });
        else if (/^(est|east)$/i.test(w)) toks.push({ k: 'hemi', v: 'E', s: s, e: e });
        else if (/^(ouest|west)$/i.test(w)) toks.push({ k: 'hemi', v: 'W', s: s, e: e });
        else if (/^(lat|latitude|lon|lng|long|longitude|position|pos|gps|coord|coordonn[ée]es?|wgs|wgs84|point)$/i.test(w)) continue;
        else toks.push({ k: 'word', s: s, e: e });
      } else {
        var c = m[5];
        if (/[,;\/\s:()\[\]=@&?#+_|!.~*-]/.test(c)) continue; // separateurs neutres
        toks.push({ k: 'word', s: s, e: e });
      }
    }
    // rattacher les symboles aux nombres
    for (var i = 0; i < toks.length; i++) {
      if (toks[i].k === 'sym' && i > 0 && toks[i - 1].k === 'num' && !toks[i - 1].sym) { toks[i - 1].sym = toks[i].v; toks[i - 1].e = toks[i].e; toks[i].k = 'drop'; }
    }
    return toks.filter(function (x) { return x.k !== 'drop' && x.k !== 'sym'; });
  }

  function runs(toks) {
    var out = [], cur = [];
    toks.forEach(function (t) { if (t.k === 'word') { if (cur.length) out.push(cur); cur = []; } else cur.push(t); });
    if (cur.length) out.push(cur);
    return out;
  }

  function isInt(raw) { return raw.indexOf('.') < 0; }

  // Interpretations possibles d'un groupe de nombres pour un axe donne (max 90 ou 180)
  function interpretGroup(nums, max) {
    var c = [], n = nums.length;
    var v = nums.map(function (x) { return parseFloat(x.raw); });
    var syms = nums.map(function (x) { return x.sym || ''; });
    if (n === 1) {
      var raw = nums[0].raw, ip = raw.split('.')[0], fr = raw.indexOf('.') >= 0 ? '.' + raw.split('.')[1] : '';
      if (Math.abs(v[0]) <= max && syms[0] !== "'" && syms[0] !== '"') {
        var dec = fr.length - 1;
        if (dec >= 3) c.push({ val: v[0], fmt: 'DD', pen: 0 });
        else if (dec >= 1) c.push({ val: v[0], fmt: 'DD', pen: 1.5, fix: 'seulement ' + dec + ' décimale(s), position imprécise' });
        else c.push({ val: v[0], fmt: 'DD', pen: 5, fix: 'degrés entiers sans minutes, valeur probablement tronquée' });
      }
      if (ip.length >= 3 && !syms[0]) {
        var d = parseInt(ip.slice(0, -2), 10), mn = parseFloat(ip.slice(-2) + fr);
        if (d <= max && mn < 60) c.push({ val: d + mn / 60, fmt: 'NMEA', pen: 1, fix: 'degrés et minutes collés (symbole ° absent ?)' });
      }
      if (ip.length >= 4 && ip.charAt(ip.length - 3) === '0') {
        var d2 = parseInt(ip.slice(0, -3), 10), mn2 = parseFloat(ip.slice(-2) + fr);
        if (d2 <= max && mn2 < 60) c.push({ val: d2 + mn2 / 60, fmt: 'DMM', pen: 3, fix: 'symbole ° probablement lu comme un 0' });
      }
    } else if (n === 2) {
      if (isInt(nums[0].raw) && v[0] <= max && v[1] < 60) {
        var fixes = [], pn = 0, md = nums[1].raw.indexOf('.') >= 0 ? nums[1].raw.split('.')[1].length : 0;
        if (syms[0] === "'") { fixes.push('symbole ° lu comme une apostrophe'); pn += 0.5; }
        if (syms[1] === '"') { fixes.push('symbole des minutes lu comme des guillemets'); pn += 0.5; }
        if (md < 3) { fixes.push('minutes à ' + md + ' décimale(s) seulement, chiffre manquant ?'); pn += 0.5; }
        c.push({ val: v[0] + v[1] / 60, fmt: 'DMM', pen: pn, fix: fixes.join(', ') || undefined });
      }
    } else if (n === 3) {
      if (isInt(nums[0].raw) && isInt(nums[1].raw) && v[0] <= max && v[1] < 60 && v[2] < 60) c.push({ val: v[0] + v[1] / 60 + v[2] / 3600, fmt: 'DMS', pen: 0 });
    }
    c.forEach(function (x) { if (nums[0].neg) x.val = -x.val; x.syms = syms.join('').length; });
    return c;
  }

  function splitNums(nums) {
    // decoupe une suite de nombres sans hemisphere en deux groupes
    var res = [], degIdx = [];
    nums.forEach(function (x, i) { if (x.sym === '°') degIdx.push(i); });
    if (degIdx.length === 2 && degIdx[0] === 0) res.push(degIdx[1]);
    if (nums.length % 2 === 0 && nums.length <= 6) res.push(nums.length / 2);
    return res.filter(function (v, i, a) { return v > 0 && v < nums.length && a.indexOf(v) === i; });
  }

  function candidatesFromWindow(win, prev, next) {
    var hemis = win.filter(function (t) { return t.k === 'hemi'; });
    var nums = win.filter(function (t) { return t.k === 'num'; });
    if (nums.length < 2 || nums.length > 6) return [];
    var pairs = []; // [{a:{nums,hemi}, b:{nums,hemi}}]
    if (hemis.length === 2) {
      var prefix = win[0].k === 'hemi', suffix = win[win.length - 1].k === 'hemi';
      var groups = [], cur = null;
      if (prefix) {
        if (next && next.k === 'num') return [];
        win.forEach(function (t) { if (t.k === 'hemi') { cur = { hemi: t.v, nums: [] }; groups.push(cur); } else cur.nums.push(t); });
      } else if (suffix) {
        if (prev && prev.k === 'num') return [];
        cur = { nums: [] };
        win.forEach(function (t) { if (t.k === 'hemi') { cur.hemi = t.v; groups.push(cur); cur = { nums: [] }; } else cur.nums.push(t); });
        if (cur.nums.length) return [];
      } else return [];
      if (groups.length === 2 && groups[0].nums.length && groups[1].nums.length) pairs.push({ a: groups[0], b: groups[1], hemi: true });
    } else if (hemis.length === 0) {
      splitNums(nums).forEach(function (k) { pairs.push({ a: { nums: nums.slice(0, k) }, b: { nums: nums.slice(k) }, hemi: false }); });
    } else return [];

    var out = [];
    pairs.forEach(function (p) {
      var latG, lonG, swapped = false;
      if (p.hemi) {
        var axA = /[NS]/.test(p.a.hemi) ? 'lat' : 'lon', axB = /[NS]/.test(p.b.hemi) ? 'lat' : 'lon';
        if (axA === axB) return;
        latG = axA === 'lat' ? p.a : p.b; lonG = axA === 'lat' ? p.b : p.a;
      } else { latG = p.a; lonG = p.b; }
      var tryOrder = function (L, G, sw) {
        interpretGroup(L.nums, 90).forEach(function (la) {
          interpretGroup(G.nums, 180).forEach(function (lo) {
            var lat = la.val, lon = lo.val;
            if (L.hemi === 'S') lat = -Math.abs(lat);
            if (G.hemi === 'W' || G.hemi === 'O') lon = -Math.abs(lon);
            out.push(build(lat, lon, la, lo, p.hemi, sw, win));
          });
        });
      };
      tryOrder(latG, lonG, false);
      if (!p.hemi) tryOrder(lonG, latG, true);
    });
    return out;
  }

  function build(lat, lon, la, lo, hemi, swapped, win) {
    var score = 0, notes = [];
    if (hemi) score += 3;
    score += Math.min(4, la.syms + lo.syms) * 0.75;
    if (la.fmt === lo.fmt) score += 1;
    score -= la.pen + lo.pen;
    if (inBox(ALPES, lat, lon)) score += 4; else if (inBox(FRANCE, lat, lon)) score += 2;
    else notes.push({ lvl: 'warn', t: 'Position hors de France métropolitaine : vérifier la lecture.' });
    if (swapped) { score -= 1.5; notes.push({ lvl: 'warn', t: 'Latitude et longitude saisies dans l\'ordre inverse : remises dans l\'ordre.' }); }
    if (la.fix) notes.push({ lvl: 'warn', t: 'Latitude : ' + la.fix + ' (vérifier sur la photo).' });
    if (lo.fix && lo.fix !== la.fix) notes.push({ lvl: 'warn', t: 'Longitude : ' + lo.fix + ' (vérifier sur la photo).' });
    else if (lo.fix) notes.push({ lvl: 'warn', t: 'Longitude : ' + lo.fix + ' (vérifier sur la photo).' });
    if (lon < 0 && hemi) notes.push({ lvl: 'warn', t: 'Longitude Ouest : inhabituel dans les Alpes. Un « O » lu à la place d\'un 0 ?' });
    if (la.fmt !== lo.fmt) notes.push({ lvl: 'warn', t: 'Latitude et longitude lues dans deux formats différents : vérifier sur la photo.' });
    var fmt = la.fmt === lo.fmt ? la.fmt : la.fmt + ' / ' + lo.fmt;
    return { lat: lat, lon: lon, fmt: fmt, score: score, notes: notes, s: win[0].s, e: win[win.length - 1].e, hemi: hemi };
  }

  // ---------- UTM ----------
  function utmToLatLon(zone, band, E, N) {
    var a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
    var x = E - 500000, y = band < 'N' ? N - 10000000 : N;
    var M = y / k0, mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));
    var e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    var p1 = mu + (3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * Math.pow(e1, 4) / 32) * Math.sin(4 * mu)
      + (151 * Math.pow(e1, 3) / 96) * Math.sin(6 * mu) + (1097 * Math.pow(e1, 4) / 512) * Math.sin(8 * mu);
    var s = Math.sin(p1), c = Math.cos(p1), tn = Math.tan(p1);
    var N1 = a / Math.sqrt(1 - e2 * s * s), T1 = tn * tn, C1 = ep2 * c * c, R1 = a * (1 - e2) / Math.pow(1 - e2 * s * s, 1.5), D = x / (N1 * k0);
    var lat = p1 - (N1 * tn / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * Math.pow(D, 4) / 24
      + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * Math.pow(D, 6) / 720);
    var lon = (D - (1 + 2 * T1 + C1) * Math.pow(D, 3) / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * Math.pow(D, 5) / 120) / c;
    return { lat: lat * 180 / Math.PI, lon: (zone - 1) * 6 - 180 + 3 + lon * 180 / Math.PI };
  }

  function parseUTM(t) {
    var re = /(?:^|[^\dA-Za-z])(\d{1,2})\s?([C-HJ-NP-X])(?![A-Za-z])\s*(?:E\s*:?\s*)?(\d{6,7})(?:[.,]\d+)?\s*(?:m\b\s*)?(?:E\b\s*)?(?:N\s*:?\s*)?(\d{7})(?:[.,]\d+)?/g, m, out = [];
    while ((m = re.exec(t))) {
      var zone = +m[1]; if (zone < 1 || zone > 60) continue;
      var ll = utmToLatLon(zone, m[2].toUpperCase(), +m[3], +m[4]);
      if (Math.abs(ll.lat) > 84) continue;
      var notes = [], score = 6;
      if (inBox(ALPES, ll.lat, ll.lon)) score += 4; else if (inBox(FRANCE, ll.lat, ll.lon)) score += 2;
      else notes.push({ lvl: 'warn', t: 'Position hors de France métropolitaine : vérifier la zone UTM.' });
      var off = m[0].search(/\d/);
      out.push({ lat: ll.lat, lon: ll.lon, fmt: 'UTM ' + zone + m[2].toUpperCase(), score: score, notes: notes, s: m.index + off, e: m.index + m[0].length, hemi: true });
    }
    return out;
  }

  function parse(text) {
    if (!text || !text.trim()) return { ok: false, empty: true };
    var t = normalize(text);
    var cands = parseUTM(t);
    runs(tokenize(t)).forEach(function (run) {
      for (var i = 0; i < run.length; i++) for (var j = i + 1; j < run.length && j < i + 10; j++) {
        var win = run.slice(i, j + 1);
        candidatesFromWindow(win, run[i - 1], run[j + 1]).forEach(function (c) {
          var unused = run.filter(function (x) { return x.k === 'num'; }).length - win.filter(function (x) { return x.k === 'num'; }).length;
          c.score -= unused * 1.2;
          cands.push(c);
        });
      }
    });
    cands = cands.filter(function (c) { return Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180 && !(c.lat === 0 && c.lon === 0); });
    if (!cands.length) return { ok: false, norm: t };
    cands.sort(function (a, b) { return b.score - a.score; });
    var best = cands[0];
    var alts = [];
    cands.slice(1).forEach(function (c) {
      if (c.score >= best.score - 1 && distM(best, c) > 50 && alts.every(function (a) { return distM(a, c) > 50; })) alts.push(c);
    });
    best.seg = t.slice(best.s, best.e).replace(/\s+/g, ' ').trim();
    alts.forEach(function (a) { a.seg = t.slice(a.s, a.e).replace(/\s+/g, ' ').trim(); });
    var conf = best.notes.some(function (n) { return n.lvl === 'warn'; }) || alts.length ? 'check' : 'ok';
    return { ok: true, best: best, alts: alts.slice(0, 2), conf: conf, norm: t };
  }

  function distM(a, b) {
    var R = 6371008.8, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r;
    var h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function bearing(a, b) {
    var r = Math.PI / 180, y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
    var x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }
  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
  function toDMM(v, isLat) {
    var h = isLat ? (v < 0 ? 'S' : 'N') : (v < 0 ? 'O' : 'E'), a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60;
    if (+m.toFixed(3) >= 60) { d += 1; m = 0; }
    return h + ' ' + pad(d, isLat ? 2 : 3) + '°' + pad(m.toFixed(3), 6) + "'";
  }
  function toDMS(v, isLat) {
    var h = isLat ? (v < 0 ? 'S' : 'N') : (v < 0 ? 'O' : 'E'), a = Math.abs(v), d = Math.floor(a), mf = (a - d) * 60, m = Math.floor(mf), s = (mf - m) * 60;
    if (+s.toFixed(1) >= 60) { s = 0; m += 1; } if (m >= 60) { m = 0; d += 1; }
    return h + ' ' + pad(d, isLat ? 2 : 3) + '°' + pad(m, 2) + "'" + pad(s.toFixed(1), 4) + '"';
  }
  function toUTM(lat, lon) {
    var zone = Math.floor((lon + 180) / 6) + 1, a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2), r = Math.PI / 180;
    var p = lat * r, l = lon * r, l0 = ((zone - 1) * 6 - 180 + 3) * r;
    var N = a / Math.sqrt(1 - e2 * Math.sin(p) * Math.sin(p)), T = Math.tan(p) * Math.tan(p), C = ep2 * Math.cos(p) * Math.cos(p), A = Math.cos(p) * (l - l0);
    var M = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * p - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * p)
      + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * p) - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * p));
    var E = k0 * N * (A + (1 - T + C) * Math.pow(A, 3) / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * Math.pow(A, 5) / 120) + 500000;
    var Nn = k0 * (M + N * Math.tan(p) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4) / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * Math.pow(A, 6) / 720));
    if (lat < 0) Nn += 10000000;
    var bands = 'CDEFGHJKLMNPQRSTUVWX', band = bands.charAt(Math.min(19, Math.max(0, Math.floor((lat + 80) / 8))));
    return zone + band + ' ' + Math.round(E) + ' ' + Math.round(Nn);
  }
  return { parse: parse, toDMM: toDMM, toDMS: toDMS, toUTM: toUTM, distM: distM, bearing: bearing, normalize: normalize };
})();
if (typeof module !== 'undefined') module.exports = Geo;
if (typeof self !== 'undefined') self.Geo = Geo;
