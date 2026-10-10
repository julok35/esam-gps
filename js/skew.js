/* Inclinaison du texte dans une image (sans DOM, testé sous Node).
   1. Orientation des contours : les traits droits des caractères, les lignes de texte et le bord de l'écran sont tous
      à l'inclinaison du texte ou à 90° de celle-ci ; l'histogramme des orientations (modulo 90°) a son pic à cet angle.
      Les grosses lettres floues et serrées, qui trompaient la mesure par lignes, n'y changent rien.
   2. Affinage par lignes, à 1,5° au plus du pic : projetés perpendiculairement à la bonne inclinaison, les bords des
      caractères s'empilent sur quelques rangées. */

var MAXPTS = 20000,
  BIN = 0.5,
  NB = 90 / BIN;

// gray : niveaux de gris (un octet par pixel, ligne par ligne), w x h. maxDeg : inclinaison maximale cherchée.
// Retour : deg, angle du texte en degrés (positif : le texte descend vers la droite ; pour redresser, tourner de -deg),
// gain : hauteur du pic d'orientation rapportée à la moyenne (1 = aucune direction privilégiée ; net au-delà de 2).
export function skewAngle(gray, w, h, maxDeg) {
  var M = maxDeg || 45,
    x,
    y,
    o,
    i;
  // léger lissage 3 x 3 : le grain de la photo ne fait pas de faux contours
  var sg = new Float32Array(w * h);
  for (y = 1; y < h - 1; y++)
    for (x = 1; x < w - 1; x++) {
      o = y * w + x;
      sg[o] =
        (gray[o - w - 1] +
          gray[o - w] +
          gray[o - w + 1] +
          gray[o - 1] +
          gray[o] +
          gray[o + 1] +
          gray[o + w - 1] +
          gray[o + w] +
          gray[o + w + 1]) /
        9;
    }
  for (x = 0; x < w; x++) {
    sg[x] = gray[x];
    sg[(h - 1) * w + x] = gray[(h - 1) * w + x];
  }
  for (y = 0; y < h; y++) {
    sg[y * w] = gray[y * w];
    sg[y * w + w - 1] = gray[y * w + w - 1];
  }
  gray = sg;
  // gradients de Sobel ; on garde les contours les plus marqués (les 12 % plus forts), quel que soit le flou
  var GX = new Float32Array(w * h),
    GY = new Float32Array(w * h),
    MG = new Float32Array(w * h),
    cnt = new Uint32Array(1025);
  for (y = 1; y < h - 1; y++)
    for (x = 1; x < w - 1; x++) {
      o = y * w + x;
      var a = gray[o - w - 1],
        b = gray[o - w],
        c = gray[o - w + 1],
        d = gray[o - 1],
        f = gray[o + 1],
        g = gray[o + w - 1],
        k = gray[o + w],
        l = gray[o + w + 1];
      var gx = c + 2 * f + l - a - 2 * d - g,
        gy = g + 2 * k + l - a - 2 * b - c,
        m = Math.hypot(gx, gy);
      GX[o] = gx;
      GY[o] = gy;
      MG[o] = m;
      cnt[Math.min(1024, m | 0)]++;
    }
  var T = 1024,
    acc = 0;
  while (T > 0 && acc < w * h * 0.12) acc += cnt[T--];
  T = Math.max(24, T);
  var hist = new Float64Array(NB),
    px = [],
    py = [];
  for (y = 1; y < h - 1; y++)
    for (x = 1; x < w - 1; x++) {
      o = y * w + x;
      m = MG[o];
      gx = GX[o];
      gy = GY[o];
      if (m < T) continue;
      var t = (Math.atan2(gy, gx) * 180) / Math.PI;
      t = (((t % 90) + 90) % 90) / BIN;
      var j = Math.floor(t),
        r = t - j;
      hist[j % NB] += m * (1 - r);
      hist[(j + 1) % NB] += m * r;
      px.push(x - w / 2);
      py.push(y - h / 2);
    }
  var n = px.length;
  if (n < 30) return { deg: 0, gain: 1 };
  // lissage circulaire sur ±1,5°
  var sm = new Float64Array(NB),
    W = [1, 2, 3, 4, 3, 2, 1],
    sum = 0,
    best = 0;
  for (i = 0; i < NB; i++) {
    for (var q = -3; q <= 3; q++) sm[i] += W[q + 3] * hist[(i + q + NB) % NB];
    sum += sm[i];
    if (sm[i] > sm[best]) best = i;
  }
  var gain = sm[best] / (sum / NB);
  var deg0 = best * BIN;
  if (deg0 >= 45) deg0 -= 90;

  // affinage par lignes autour du pic
  var stride = Math.max(1, Math.ceil(n / MAXPTS)),
    R = Math.ceil(Math.hypot(w, h) / 2) + 2,
    bins = new Float64Array(2 * R + 1);
  var score = function (dg) {
    var an = (dg * Math.PI) / 180,
      s = Math.sin(an),
      co = Math.cos(an),
      tot = 0,
      z;
    bins.fill(0);
    for (z = 0; z < n; z += stride) bins[Math.round(py[z] * co - px[z] * s) + R]++;
    for (z = 1; z < bins.length - 1; z++) {
      var v = bins[z - 1] + 2 * bins[z] + bins[z + 1];
      tot += v * v;
    }
    return tot;
  };
  var dg = deg0,
    bs = score(deg0),
    sc;
  for (var e = deg0 - 1.5; e <= deg0 + 1.5001; e += 0.1) {
    sc = score(e);
    if (sc > bs) {
      bs = sc;
      dg = e;
    }
  }
  dg = Math.round(dg * 10) / 10;
  if (Math.abs(dg) > M) return { deg: 0, gain: 1 };
  return { deg: dg === 0 ? 0 : dg, gain: gain };
}
