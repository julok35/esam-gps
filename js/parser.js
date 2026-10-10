/* Moteur de détection et de conversion de coordonnées dans un texte bruité (lecture OCR, copier-coller, saisie).
   Sans DOM : testé sous Node (test/parser.test.js).

   Chemin d'un texte dans parse() :
   1. normalize : symboles unifiés (°, ', "), lettres mal lues par l'OCR remplacées par des chiffres (O -> 0, l -> 1...).
   2. tokenize : suite d'éléments (nombre avec son symbole éventuel, lettre d'hémisphère, mot). Un mot inconnu coupe
      la suite ; runs() en tire des « séquences » de nombres et d'hémisphères consécutifs.
   3. Fenêtres : dans chaque séquence, chaque sous-suite de 2 à 10 éléments est essayée (candidatesFromWindow).
      Elle est coupée en un groupe latitude et un groupe longitude, par les lettres d'hémisphère si elles sont là,
      sinon par splitNums (au milieu, ou au second symbole °), dans les deux ordres.
   4. interpretGroup : chaque groupe donne une ou plusieurs lectures (DD, DMM, DMS, NMEA, ou ° lu comme un 0), chacune
      avec une pénalité (PEN) et une explication pour l'utilisateur.
   5. build : chaque couple latitude / longitude devient un candidat noté (SCORE, voir plus bas).
      parseUTM ajoute en parallèle les candidats UTM.
   6. Le meilleur score l'emporte ; les candidats à moins d'un point et à plus de 50 m sont proposés comme
      autres lectures.

   Le barème (SCORE, PEN) est empirique : il a été réglé sur les cas de test/parser.test.js (pièges de lecture
   rencontrés). Toute modification d'un poids doit être suivie de « npm test ».
*/

// ---------- Structures de données (JSDoc, lues par les éditeurs) ----------
/**
 * Élément du texte normalisé. s / e : positions de début et de fin dans le texte ; line : numéro de ligne.
 * num : raw (chiffres, point décimal), neg (signe -), sym (°, ' ou " collé derrière). hemi : v (N, S, E, W ou O).
 * @typedef {{ k: 'num'|'hemi'|'word', s: number, e: number, line: number,
 *             raw?: string, neg?: boolean, sym?: string, v?: string }} Token
 */
/**
 * Lecture d'un groupe de nombres pour un axe : valeur en degrés décimaux, format, pénalité (PEN),
 * explication de la correction supposée, nombre de symboles d'unité présents.
 * @typedef {{ val: number, fmt: string, pen: number, fix?: string, syms: number }} Reading
 */
/**
 * Avertissement affiché sous le résultat.
 * @typedef {{ lvl?: 'warn', t: string }} Note
 */
/**
 * Position candidate. s / e : passage du texte normalisé d'où elle vient ; seg : ce passage, affiché « Lu : ».
 * hemi : lue avec ses lettres d'hémisphère.
 * @typedef {{ lat: number, lon: number, fmt: string, score: number, notes: Note[], s: number, e: number,
 *             hemi: boolean, seg?: string }} Candidate
 */
/**
 * Résultat de parse(). conf : 'check' dès qu'il y a un avertissement ou une autre lecture possible ;
 * norm : texte normalisé ; agree : ajouté par ocr.js (« 5/8 » lectures concordantes) pour une photo.
 * ocr.js modifie aussi best.notes et alts après le vote entre lectures.
 * @typedef {{ ok: false, empty?: true, norm?: string }
 *         | { ok: true, best: Candidate, alts: Candidate[], conf: 'ok'|'check', norm: string, agree?: string }} ParseResult
 */

// Barème des candidats (build, parseUTM, parse). Ordres de grandeur à garder en tête :
// une lecture parfaite dans les Alpes avec hémisphères et symboles vaut environ 3 + 3 + 1 + 4 = 11 ;
// une lecture douteuse (pénalités cumulées de 3 à 5) doit pouvoir perdre face à une lecture propre,
// mais la position géographique (jusqu'à 4) doit rester capable de départager deux lectures également propres.
var SCORE = {
  hemi: 3, // lettres N / S / E / O présentes : l'axe de chaque valeur est certain
  sym: 0.75, // par symbole d'unité (°, ', ") présent : la structure DMM / DMS est confirmée...
  symMax: 4, // ... compté au plus 4 fois (3 points), pour ne pas écraser le reste
  sameFmt: 1, // latitude et longitude dans le même format : cohérent avec un même écran
  alpes: 4, // dans les Alpes : zone d'intervention habituelle
  france: 2, // ailleurs en France métropolitaine : plausible
  swapped: 1.5, // retiré si latitude et longitude sont lues dans l'ordre inverse (sans hémisphère pour le dire)
  unusedNum: 1.2, // retiré par nombre de la séquence laissé de côté : préférer la lecture qui explique tout le texte
  utm: 6, // base d'un candidat UTM : son motif (zone, bande, 6-7 chiffres, 7 chiffres) est très peu ambigu
  altGap: 1, // une autre lecture à moins de 1 point du meilleur est proposée à l'utilisateur...
  altDist: 50 // ... si elle est à plus de 50 m de celui-ci et des autres propositions
};

// Pénalités des lectures d'un groupe (interpretGroup) : plus la correction supposée est hasardeuse, plus elle coûte
var PEN = {
  ddShort: 1.5, // DD à 1 ou 2 décimales : position à 1 km près au mieux
  ddInt: 5, // degrés entiers seuls : presque sûrement une valeur tronquée, à n'utiliser qu'en dernier recours
  nmea: 1, // degrés et minutes collés (4512.345) : format réel de certains GPS, ° simplement absent
  degAsZero: 3, // 45012.345 lu comme 45°12.345 : le 0 est un ° mal lu par l'OCR, correction plus risquée
  dmmFix: 0.5 // DMM : par symbole mal lu ou minutes à moins de 3 décimales
};

// Constantes de l'ellipsoïde WGS84 et de la projection UTM
var WGS84_A = 6378137, // demi-grand axe (m)
  WGS84_F = 1 / 298.257223563, // aplatissement
  UTM_K0 = 0.9996; // facteur d'échelle au méridien central

var ALPES = { la0: 43.0, la1: 48.6, lo0: 4.0, lo1: 17.0 };
var FRANCE = { la0: 41.0, la1: 51.6, lo0: -5.6, lo1: 10.0 };
// Boîtes lat / lon approximatives
function inBox(b, lat, lon) {
  return lat >= b.la0 && lat <= b.la1 && lon >= b.lo0 && lon <= b.lo1;
}
// zone d'intervention : Alpes (France, Suisse, Italie, Autriche) et France métropolitaine
export function inRegion(lat, lon) {
  return inBox(ALPES, lat, lon) || inBox(FRANCE, lat, lon);
}

/**
 * Texte unifié pour l'analyse : guillemets et symboles de degré ramenés à ' " °, erreurs courantes de l'OCR corrigées.
 * @param {string} t
 * @returns {string}
 */
export function normalize(t) {
  t = t.normalize('NFKC');
  t = t.replace(/[′’‘´`ʹʼ]/g, "'");
  t = t.replace(/[″“”ʺ]/g, '"');
  t = t.replace(/''/g, '"');
  t = t.replace(/[º˚ᵒ⁰°]/g, '°');
  t = t.replace(/\bdeg(r[eé]s?)?\b/gi, '°');
  t = t.replace(/(\d)\s*\*/g, '$1°');
  t = t.replace(/(^|[^A-Za-z0-9.,])[oO]{1,2}(?=\d)/g, function (m, p) {
    return p + m.slice(p.length).replace(/[oO]/g, '0');
  });
  // o / O collé entre un nombre de 1 à 3 chiffres et des minutes : symbole degré mal lu
  t = t.replace(/(^|[^\d.,])(\d{1,3})[oO](?=\s?\d{1,2}(?:[.,][\dOo]|\s*'|\s+\d))/g, '$1$2°');
  // O / o / l / I / | collés à des chiffres : chiffres mal lus (plusieurs passes : un remplacement peut en rendre possible un autre juste à côté)
  for (var i = 0; i < 3; i++) {
    t = t.replace(/(\d)[oO](?=[\d.,°'"])/g, '$10').replace(/([\d.,])[oO](?=\d)/g, '$10');
    t = t.replace(/(\d)[lI|](?=[\d.,])/g, '$11').replace(/([\d.,])[lI|](?=\d)/g, '$11');
  }
  return t;
}

// Tokenisation : nombres, symboles d'unité, lettres d'hémisphère, mots (coupent les séquences).
// Mots-clés (lat, lon, gps...) et ponctuation neutre ignorés. Retourne des Token, symboles déjà rattachés aux nombres.
function tokenize(t) {
  // si le texte contient un point décimal, une virgule entre chiffres sépare deux valeurs (45.1,6.2) ;
  // sinon c'est une virgule décimale (45,1 6,2)
  var dotDecimal = /\d\.\d/.test(t);
  var toks = [],
    re = /(-?)(\d+(?:[.,]\d+)?)|([°'"])|([A-Za-zÀ-ÿ]+)|(\S)/g,
    m;
  while ((m = re.exec(t))) {
    var s = m.index,
      e = re.lastIndex;
    if (m[2] !== undefined) {
      var raw = m[2];
      if (raw.indexOf(',') >= 0) {
        if (dotDecimal) {
          // virgule = séparateur : couper
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
      if (/^[NSEWO]$/i.test(w)) toks.push({ k: 'hemi', v: w.toUpperCase(), s: s, e: e });
      else if (/^(nord|north)$/i.test(w)) toks.push({ k: 'hemi', v: 'N', s: s, e: e });
      else if (/^(sud|south)$/i.test(w)) toks.push({ k: 'hemi', v: 'S', s: s, e: e });
      else if (/^(est|east)$/i.test(w)) toks.push({ k: 'hemi', v: 'E', s: s, e: e });
      else if (/^(ouest|west)$/i.test(w)) toks.push({ k: 'hemi', v: 'W', s: s, e: e });
      else if (
        /^(lat|latitude|lon|lng|long|longitude|position|pos|gps|coord|coordonn[ée]es?|wgs|wgs84|point)$/i.test(w)
      )
        continue;
      else toks.push({ k: 'word', s: s, e: e });
    } else {
      var c = m[5];
      if (/[,;/\s:()[\]=@&?#+_|!.~*-]/.test(c)) continue; // séparateurs neutres
      toks.push({ k: 'word', s: s, e: e });
    }
  }
  // numéro de ligne de chaque élément (une valeur sur la ligne suivante ne prolonge pas un groupe)
  var nl = [],
    q = -1;
  while ((q = t.indexOf('\n', q + 1)) >= 0) nl.push(q);
  toks.forEach(function (x) {
    var L = 0;
    while (L < nl.length && nl[L] < x.s) L++;
    x.line = L;
  });
  // rattacher les symboles aux nombres
  for (var i = 0; i < toks.length; i++) {
    if (toks[i].k === 'sym' && i > 0 && toks[i - 1].k === 'num' && !toks[i - 1].sym) {
      toks[i - 1].sym = toks[i].v;
      toks[i - 1].e = toks[i].e;
      toks[i].k = 'drop';
    }
  }
  return toks.filter(function (x) {
    return x.k !== 'drop' && x.k !== 'sym';
  });
}

// Séquences d'éléments consécutifs sans mot inconnu entre eux : seules ces séquences peuvent former une position
function runs(toks) {
  var out = [],
    cur = [];
  toks.forEach(function (t) {
    if (t.k === 'word') {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push(t);
  });
  if (cur.length) out.push(cur);
  return out;
}

function isInt(raw) {
  return raw.indexOf('.') < 0;
}

// Lectures possibles (Reading[]) d'un groupe de 1 à 3 nombres pour un axe (max : 90 pour la latitude, 180 pour la longitude)
function interpretGroup(nums, max) {
  var c = [],
    n = nums.length;
  var v = nums.map(function (x) {
    return parseFloat(x.raw);
  });
  var syms = nums.map(function (x) {
    return x.sym || '';
  });
  if (n === 1) {
    // un seul nombre : DD (45.123456), NMEA (4507.4074) ou DMM dont le ° est lu comme un 0 (45007.4074 pour 45°07.4074)
    var raw = nums[0].raw,
      ip = raw.split('.')[0],
      fr = raw.indexOf('.') >= 0 ? '.' + raw.split('.')[1] : '';
    if (Math.abs(v[0]) <= max && syms[0] !== "'" && syms[0] !== '"') {
      var dec = fr.length - 1;
      if (dec >= 3) c.push({ val: v[0], fmt: 'DD', pen: 0 });
      else if (dec >= 1)
        c.push({
          val: v[0],
          fmt: 'DD',
          pen: PEN.ddShort,
          fix: 'seulement ' + dec + ' décimale(s), position imprécise'
        });
      else
        c.push({
          val: v[0],
          fmt: 'DD',
          pen: PEN.ddInt,
          fix: 'degrés entiers sans minutes, valeur probablement tronquée'
        });
    }
    if (ip.length >= 3 && !syms[0]) {
      var d = parseInt(ip.slice(0, -2), 10),
        mn = parseFloat(ip.slice(-2) + fr);
      if (d <= max && mn < 60)
        c.push({ val: d + mn / 60, fmt: 'NMEA', pen: PEN.nmea, fix: 'degrés et minutes collés (symbole ° absent ?)' });
    }
    if (ip.length >= 4 && ip.charAt(ip.length - 3) === '0') {
      var d2 = parseInt(ip.slice(0, -3), 10),
        mn2 = parseFloat(ip.slice(-2) + fr);
      if (d2 <= max && mn2 < 60)
        c.push({ val: d2 + mn2 / 60, fmt: 'DMM', pen: PEN.degAsZero, fix: 'symbole ° probablement lu comme un 0' });
    }
  } else if (n === 2) {
    // deux nombres : degrés entiers et minutes décimales (DMM)
    if (isInt(nums[0].raw) && v[0] <= max && v[1] < 60) {
      var fixes = [],
        pn = 0,
        md = nums[1].raw.indexOf('.') >= 0 ? nums[1].raw.split('.')[1].length : 0;
      if (syms[0] === "'") {
        fixes.push('symbole ° lu comme une apostrophe');
        pn += PEN.dmmFix;
      }
      // ° suivi de minutes décimales puis " : apostrophe lue comme guillemets, sans ambiguïté
      if (syms[1] === '"' && !(syms[0] === '\u00B0' && md >= 3)) {
        fixes.push('symbole des minutes lu comme des guillemets');
        pn += PEN.dmmFix;
      }
      if (md < 3) {
        fixes.push('minutes à ' + md + ' décimale(s) seulement, chiffre manquant ?');
        pn += PEN.dmmFix;
      }
      c.push({ val: v[0] + v[1] / 60, fmt: 'DMM', pen: pn, fix: fixes.join(', ') || undefined });
    }
  } else if (n === 3) {
    // trois nombres : degrés, minutes entières, secondes (DMS)
    if (isInt(nums[0].raw) && isInt(nums[1].raw) && v[0] <= max && v[1] < 60 && v[2] < 60)
      c.push({ val: v[0] + v[1] / 60 + v[2] / 3600, fmt: 'DMS', pen: 0 });
  }
  c.forEach(function (x) {
    if (nums[0].neg) x.val = -x.val;
    x.syms = syms.join('').length;
  });
  return c;
}

// Suite de nombres sans hémisphère : indices où la couper en deux groupes (au second °, et au milieu si pair)
function splitNums(nums) {
  var res = [],
    degIdx = [];
  nums.forEach(function (x, i) {
    if (x.sym === '°') degIdx.push(i);
  });
  if (degIdx.length === 2 && degIdx[0] === 0) res.push(degIdx[1]);
  if (nums.length % 2 === 0 && nums.length <= 6) res.push(nums.length / 2);
  return res.filter(function (v, i, a) {
    return v > 0 && v < nums.length && a.indexOf(v) === i;
  });
}

// Candidats d'une fenêtre win (sous-suite d'une séquence). prev / next : éléments qui l'encadrent dans la séquence.
// Avec hémisphères : exactement deux, tous deux devant (N 45 E 6) ou tous deux derrière (45 N 6 E) leurs nombres ;
// une fenêtre qui couperait un groupe en deux sur la même ligne est refusée. Sans hémisphère : splitNums, puis
// les deux ordres (lat, lon) et (lon, lat), le second pénalisé.
function candidatesFromWindow(win, prev, next) {
  var hemis = win.filter(function (t) {
    return t.k === 'hemi';
  });
  var nums = win.filter(function (t) {
    return t.k === 'num';
  });
  if (nums.length < 2 || nums.length > 6) return [];
  var pairs = []; // [{a:{nums,hemi}, b:{nums,hemi}}]
  if (hemis.length === 2) {
    var prefix = win[0].k === 'hemi',
      suffix = win[win.length - 1].k === 'hemi';
    var groups = [],
      cur = null;
    if (prefix) {
      if (next && next.k === 'num' && next.line === win[win.length - 1].line) return [];
      win.forEach(function (t) {
        if (t.k === 'hemi') {
          cur = { hemi: t.v, nums: [] };
          groups.push(cur);
        } else cur.nums.push(t);
      });
    } else if (suffix) {
      if (prev && prev.k === 'num' && prev.line === win[0].line) return [];
      cur = { nums: [] };
      win.forEach(function (t) {
        if (t.k === 'hemi') {
          cur.hemi = t.v;
          groups.push(cur);
          cur = { nums: [] };
        } else cur.nums.push(t);
      });
      if (cur.nums.length) return [];
    } else return [];
    if (groups.length === 2 && groups[0].nums.length && groups[1].nums.length)
      pairs.push({ a: groups[0], b: groups[1], hemi: true });
  } else if (hemis.length === 0) {
    splitNums(nums).forEach(function (k) {
      pairs.push({ a: { nums: nums.slice(0, k) }, b: { nums: nums.slice(k) }, hemi: false });
    });
  } else return [];

  var out = [];
  pairs.forEach(function (p) {
    var latG, lonG;
    if (p.hemi) {
      var axA = /[NS]/.test(p.a.hemi) ? 'lat' : 'lon',
        axB = /[NS]/.test(p.b.hemi) ? 'lat' : 'lon';
      if (axA === axB) return;
      latG = axA === 'lat' ? p.a : p.b;
      lonG = axA === 'lat' ? p.b : p.a;
    } else {
      latG = p.a;
      lonG = p.b;
    }
    var tryOrder = function (L, G, sw) {
      interpretGroup(L.nums, 90).forEach(function (la) {
        interpretGroup(G.nums, 180).forEach(function (lo) {
          var lat = la.val,
            lon = lo.val;
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

// Candidate noté à partir des lectures la (latitude) et lo (longitude). Barème : SCORE et PEN, en tête du fichier.
function build(lat, lon, la, lo, hemi, swapped, win) {
  var score = 0,
    notes = [];
  if (hemi) score += SCORE.hemi;
  score += Math.min(SCORE.symMax, la.syms + lo.syms) * SCORE.sym;
  if (la.fmt === lo.fmt) score += SCORE.sameFmt;
  score -= la.pen + lo.pen;
  if (inBox(ALPES, lat, lon)) score += SCORE.alpes;
  else if (inBox(FRANCE, lat, lon)) score += SCORE.france;
  else notes.push({ lvl: 'warn', t: 'Position hors de France métropolitaine : vérifier la lecture.' });
  if (swapped) {
    score -= SCORE.swapped;
    notes.push({ lvl: 'warn', t: "Latitude et longitude saisies dans l'ordre inverse : remises dans l'ordre." });
  }
  if (la.fix) notes.push({ lvl: 'warn', t: 'Latitude : ' + la.fix + ' (vérifier sur la photo).' });
  if (lo.fix) notes.push({ lvl: 'warn', t: 'Longitude : ' + lo.fix + ' (vérifier sur la photo).' });
  if (lon < 0 && hemi)
    notes.push({ lvl: 'warn', t: "Longitude Ouest : inhabituel dans les Alpes. Un « O » lu à la place d'un 0 ?" });
  if (la.fmt !== lo.fmt)
    notes.push({ lvl: 'warn', t: 'Latitude et longitude lues dans deux formats différents : vérifier sur la photo.' });
  var fmt = la.fmt === lo.fmt ? la.fmt : la.fmt + ' / ' + lo.fmt;
  return {
    lat: lat,
    lon: lon,
    fmt: fmt,
    score: score,
    notes: notes,
    s: win[0].s,
    e: win[win.length - 1].e,
    hemi: hemi
  };
}

// ---------- UTM ----------
// UTM -> lat / lon (développement en série classique, Snyder). band : lettre de bande, < N au sud.
function utmToLatLon(zone, band, E, N) {
  var a = WGS84_A,
    f = WGS84_F,
    k0 = UTM_K0,
    e2 = f * (2 - f),
    ep2 = e2 / (1 - e2);
  var x = E - 500000,
    y = band < 'N' ? N - 10000000 : N;
  var M = y / k0,
    mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256));
  var e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  var p1 =
    mu +
    ((3 * e1) / 2 - (27 * Math.pow(e1, 3)) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * Math.pow(e1, 4)) / 32) * Math.sin(4 * mu) +
    ((151 * Math.pow(e1, 3)) / 96) * Math.sin(6 * mu) +
    ((1097 * Math.pow(e1, 4)) / 512) * Math.sin(8 * mu);
  var s = Math.sin(p1),
    c = Math.cos(p1),
    tn = Math.tan(p1);
  var N1 = a / Math.sqrt(1 - e2 * s * s),
    T1 = tn * tn,
    C1 = ep2 * c * c,
    R1 = (a * (1 - e2)) / Math.pow(1 - e2 * s * s, 1.5),
    D = x / (N1 * k0);
  var lat =
    p1 -
    ((N1 * tn) / R1) *
      ((D * D) / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * Math.pow(D, 4)) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * Math.pow(D, 6)) / 720);
  var lon =
    (D -
      ((1 + 2 * T1 + C1) * Math.pow(D, 3)) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * Math.pow(D, 5)) / 120) /
    c;
  return { lat: (lat * 180) / Math.PI, lon: (zone - 1) * 6 - 180 + 3 + (lon * 180) / Math.PI };
}

// Candidats UTM : « 32T 274729 5009234 », avec ou sans E / N / m entre les valeurs
function parseUTM(t) {
  var re =
      /(?:^|[^\dA-Za-z])(\d{1,2})\s?([C-HJ-NP-X])(?![A-Za-z])\s*(?:E\s*:?\s*)?(\d{6,7})(?:[.,]\d+)?\s*(?:m\b\s*)?(?:E\b\s*)?(?:N\s*:?\s*)?(\d{7})(?:[.,]\d+)?/g,
    m,
    out = [];
  while ((m = re.exec(t))) {
    var zone = +m[1];
    if (zone < 1 || zone > 60) continue;
    var ll = utmToLatLon(zone, m[2].toUpperCase(), +m[3], +m[4]);
    if (Math.abs(ll.lat) > 84) continue;
    var notes = [],
      score = SCORE.utm;
    if (inBox(ALPES, ll.lat, ll.lon)) score += SCORE.alpes;
    else if (inBox(FRANCE, ll.lat, ll.lon)) score += SCORE.france;
    else notes.push({ lvl: 'warn', t: 'Position hors de France métropolitaine : vérifier la zone UTM.' });
    var off = m[0].search(/\d/);
    out.push({
      lat: ll.lat,
      lon: ll.lon,
      fmt: 'UTM ' + zone + m[2].toUpperCase(),
      score: score,
      notes: notes,
      s: m.index + off,
      e: m.index + m[0].length,
      hemi: true
    });
  }
  return out;
}

/**
 * Position la plus probable dans un texte, avec les autres lectures plausibles.
 * @param {string} text
 * @returns {ParseResult}
 */
export function parse(text) {
  if (!text || !text.trim()) return { ok: false, empty: true };
  var t = normalize(text);
  var cands = parseUTM(t);
  runs(tokenize(t)).forEach(function (run) {
    for (var i = 0; i < run.length; i++)
      for (var j = i + 1; j < run.length && j < i + 10; j++) {
        var win = run.slice(i, j + 1);
        candidatesFromWindow(win, run[i - 1], run[j + 1]).forEach(function (c) {
          var unused =
            run.filter(function (x) {
              return x.k === 'num';
            }).length -
            win.filter(function (x) {
              return x.k === 'num';
            }).length;
          c.score -= unused * SCORE.unusedNum;
          cands.push(c);
        });
      }
  });
  cands = cands.filter(function (c) {
    return Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180 && !(c.lat === 0 && c.lon === 0);
  });
  if (!cands.length) return { ok: false, norm: t };
  cands.sort(function (a, b) {
    return b.score - a.score;
  });
  var best = cands[0];
  var alts = [];
  cands.slice(1).forEach(function (c) {
    if (
      c.score >= best.score - SCORE.altGap &&
      distM(best, c) > SCORE.altDist &&
      alts.every(function (a) {
        return distM(a, c) > SCORE.altDist;
      })
    )
      alts.push(c);
  });
  best.seg = t.slice(best.s, best.e).replace(/\s+/g, ' ').trim();
  alts.forEach(function (a) {
    a.seg = t.slice(a.s, a.e).replace(/\s+/g, ' ').trim();
  });
  var conf =
    best.notes.some(function (n) {
      return n.lvl === 'warn';
    }) || alts.length
      ? 'check'
      : 'ok';
  return { ok: true, best: best, alts: alts.slice(0, 2), conf: conf, norm: t };
}

/**
 * Distance en mètres sur la sphère (haversine, rayon moyen de la Terre).
 * @param {{lat: number, lon: number}} a
 * @param {{lat: number, lon: number}} b
 * @returns {number}
 */
export function distM(a, b) {
  var R = 6371008.8,
    r = Math.PI / 180,
    dLa = (b.lat - a.lat) * r,
    dLo = (b.lon - a.lon) * r;
  var h =
    Math.sin(dLa / 2) * Math.sin(dLa / 2) +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}
/**
 * Cap initial de a vers b, en degrés depuis le nord géographique (0 à 360).
 * @param {{lat: number, lon: number}} a
 * @param {{lat: number, lon: number}} b
 * @returns {number}
 */
export function bearing(a, b) {
  var r = Math.PI / 180,
    y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
  var x =
    Math.cos(a.lat * r) * Math.sin(b.lat * r) -
    Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
function pad(n, w) {
  var s = String(n);
  while (s.length < w) s = '0' + s;
  return s;
}
// ---------- Sortie dans les autres formats ----------
// v : degrés décimaux ; isLat : latitude (N / S, degrés sur 2 chiffres) ou longitude (E / O, sur 3)
/** « N 45°12.345' » @param {number} v @param {boolean} isLat @returns {string} */
export function toDMM(v, isLat) {
  var h = isLat ? (v < 0 ? 'S' : 'N') : v < 0 ? 'O' : 'E',
    a = Math.abs(v),
    d = Math.floor(a),
    m = (a - d) * 60;
  if (+m.toFixed(3) >= 60) {
    d += 1;
    m = 0;
  }
  return h + ' ' + pad(d, isLat ? 2 : 3) + '°' + pad(m.toFixed(3), 6) + "'";
}
/** « N 45°12'20.7" » @param {number} v @param {boolean} isLat @returns {string} */
export function toDMS(v, isLat) {
  var h = isLat ? (v < 0 ? 'S' : 'N') : v < 0 ? 'O' : 'E',
    a = Math.abs(v),
    d = Math.floor(a),
    mf = (a - d) * 60,
    m = Math.floor(mf),
    s = (mf - m) * 60;
  if (+s.toFixed(1) >= 60) {
    s = 0;
    m += 1;
  }
  if (m >= 60) {
    m = 0;
    d += 1;
  }
  return h + ' ' + pad(d, isLat ? 2 : 3) + '°' + pad(m, 2) + "'" + pad(s.toFixed(1), 4) + '"';
}
/**
 * « 32T 274729 5009234 » : zone et bande, est et nord en mètres (zones standard, sans les exceptions Norvège / Svalbard).
 * @param {number} lat
 * @param {number} lon
 * @returns {string}
 */
export function toUTM(lat, lon) {
  var zone = Math.floor((lon + 180) / 6) + 1,
    a = WGS84_A,
    f = WGS84_F,
    k0 = UTM_K0,
    e2 = f * (2 - f),
    ep2 = e2 / (1 - e2),
    r = Math.PI / 180;
  var p = lat * r,
    l = lon * r,
    l0 = ((zone - 1) * 6 - 180 + 3) * r;
  var N = a / Math.sqrt(1 - e2 * Math.sin(p) * Math.sin(p)),
    T = Math.tan(p) * Math.tan(p),
    C = ep2 * Math.cos(p) * Math.cos(p),
    A = Math.cos(p) * (l - l0);
  var M =
    a *
    ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256) * p -
      ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 * e2 * e2) / 1024) * Math.sin(2 * p) +
      ((15 * e2 * e2) / 256 + (45 * e2 * e2 * e2) / 1024) * Math.sin(4 * p) -
      ((35 * e2 * e2 * e2) / 3072) * Math.sin(6 * p));
  var E =
    k0 *
      N *
      (A + ((1 - T + C) * Math.pow(A, 3)) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * Math.pow(A, 5)) / 120) +
    500000;
  var Nn =
    k0 *
    (M +
      N *
        Math.tan(p) *
        ((A * A) / 2 +
          ((5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4)) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * Math.pow(A, 6)) / 720));
  if (lat < 0) Nn += 10000000;
  var bands = 'CDEFGHJKLMNPQRSTUVWX',
    band = bands.charAt(Math.min(19, Math.max(0, Math.floor((lat + 80) / 8))));
  return zone + band + ' ' + Math.round(E) + ' ' + Math.round(Nn);
}
