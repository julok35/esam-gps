/* Zone des coordonnées dans une lecture pleine image (sans DOM, testé sous Node).
   Tesseract rend des lignes, chacune avec ses mots, leur boîte et leur confiance (0 à 100). On cherche la fenêtre de
   1 à 3 lignes consécutives dont le texte donne la meilleure position selon le parser, puis on cadre les mots de ces
   lignes qui portent des chiffres ou une lettre d'hémisphère. */

var MAX_LINES = 3;

function hasCoordChars(t) {
  return /\d/.test(t) || /^[NSEWO]$/i.test(t) || /[°'"]/.test(t);
}

/**
 * lines : [{ text, confidence, bbox: {x0, y0, x1, y1}, words: [{ text, confidence, bbox }] }], parse : parser.parse.
 * Retour : null si aucune coordonnée, sinon { box (pixels), text, p (résultat de parse), conf (0 à 100),
 * idx (indices des lignes retenues), words (mots cadrés) }.
 */
export function coordZone(lines, parse) {
  var L = (lines || [])
    .filter(function (l) {
      return l && l.text && l.text.trim() && l.bbox;
    })
    .slice()
    .sort(function (a, b) {
      return a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0;
    });
  var best = null;
  for (var i = 0; i < L.length; i++)
    for (var k = 1; k <= MAX_LINES && i + k <= L.length; k++) {
      var sub = L.slice(i, i + k),
        txt = sub
          .map(function (l) {
            return l.text.trim();
          })
          .join('\n'),
        p = parse(txt);
      if (!p.ok) continue;
      var score = p.best.score - 0.3 * (k - 1) - 0.5 * p.best.notes.length;
      if (!best || score > best.score) best = { score: score, i: i, k: k, p: p, text: txt };
    }
  if (!best) return null;
  var idx = [],
    words = [],
    all = [];
  for (var j = best.i; j < best.i + best.k; j++) {
    idx.push(j);
    (L[j].words || []).forEach(function (wd) {
      if (!wd.bbox || !wd.text) return;
      all.push(wd);
      if (hasCoordChars(wd.text)) words.push(wd);
    });
    if (!L[j].words || !L[j].words.length)
      words.push({ text: L[j].text, confidence: L[j].confidence, bbox: L[j].bbox });
  }
  if (!words.length) words = all;
  var box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
    cw = 0,
    cn = 0;
  words.forEach(function (wd) {
    box.x0 = Math.min(box.x0, wd.bbox.x0);
    box.y0 = Math.min(box.y0, wd.bbox.y0);
    box.x1 = Math.max(box.x1, wd.bbox.x1);
    box.y1 = Math.max(box.y1, wd.bbox.y1);
    var wgt = Math.max(1, (wd.text || '').replace(/\s/g, '').length);
    if (typeof wd.confidence === 'number') {
      cw += wd.confidence * wgt;
      cn += wgt;
    }
  });
  if (!isFinite(box.x0)) return null;
  return { box: box, text: best.text, p: best.p, conf: cn ? Math.round(cw / cn) : null, idx: idx, words: words };
}

// Confiance moyenne (0 à 100) des mots porteurs de coordonnées d'une lecture, pondérée par leur longueur
export function wordsConf(words) {
  var cw = 0,
    cn = 0;
  (words || []).forEach(function (wd) {
    if (!wd || typeof wd.confidence !== 'number' || !hasCoordChars(wd.text || '')) return;
    var wgt = Math.max(1, wd.text.replace(/\s/g, '').length);
    cw += wd.confidence * wgt;
    cn += wgt;
  });
  return cn ? Math.round(cw / cn) : null;
}
