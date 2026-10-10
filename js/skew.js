/* Inclinaison du texte dans une image (sans DOM, testé sous Node).
   Les bords verticaux des caractères s'alignent sur les lignes de texte : projetés perpendiculairement à la bonne
   inclinaison, ils s'empilent sur quelques rangées. On garde l'angle où cet empilement est le plus net. */

var MAXPTS = 20000;

// gray : niveaux de gris (un octet par pixel, ligne par ligne), w x h. maxDeg : inclinaison maximale cherchée.
// Retour : deg, angle du texte en degrés (positif : le texte descend vers la droite ; pour redresser, tourner de -deg),
// gain : netteté à cet angle rapportée à celle de l'image telle quelle (1 = aucun mieux).
export function skewAngle(gray, w, h, maxDeg) {
  var M = maxDeg || 30;
  // seuil de bord : une fraction de l'écart de luminosité de l'image
  var lo = 255, hi = 0, i, x, y;
  for (i = 0; i < gray.length; i += 7) { if (gray[i] < lo) lo = gray[i]; if (gray[i] > hi) hi = gray[i]; }
  var T = Math.max(12, (hi - lo) * 0.25), px = [], py = [];
  for (y = 0; y < h; y++) for (x = 1; x < w - 1; x++) {
    var o = y * w + x;
    if (Math.abs(gray[o + 1] - gray[o - 1]) > T) { px.push(x - w / 2); py.push(y - h / 2); }
  }
  var n = px.length;
  if (n < 30) return { deg: 0, gain: 1 };
  var stride = Math.max(1, Math.ceil(n / MAXPTS)), R = Math.ceil(Math.hypot(w, h) / 2) + 2, bins = new Float64Array(2 * R + 1);
  var score = function (deg) {
    var a = deg * Math.PI / 180, s = Math.sin(a), c = Math.cos(a), sum = 0, k;
    bins.fill(0);
    for (k = 0; k < n; k += stride) bins[Math.round(py[k] * c - px[k] * s) + R]++;
    // rangée lissée sur 3 pixels : un texte un peu flou ne disperse pas le pic
    for (k = 1; k < bins.length - 1; k++) { var v = bins[k - 1] + 2 * bins[k] + bins[k + 1]; sum += v * v; }
    return sum;
  };
  var best = 0, bs = -1, d, sc;
  for (d = -M; d <= M; d += 1) { sc = score(d); if (sc > bs) { bs = sc; best = d; } }
  var c0 = best;
  for (d = c0 - 1; d <= c0 + 1.0001; d += 0.1) { sc = score(d); if (sc > bs) { bs = sc; best = d; } }
  best = Math.round(best * 10) / 10;
  return { deg: best === 0 ? 0 : best, gain: bs / (score(0) || 1) };
}
