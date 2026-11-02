/* Amélioration de l'image avant lecture (sans DOM, testé sous Node) : niveaux de gris, contraste, netteté, mesures.
   Toutes les fonctions travaillent sur un tableau de gris (un octet par pixel, ligne par ligne). */

// rgba : pixels d'un canevas (4 octets par pixel) -> gris (pondération vidéo classique)
export function toGray(rgba, w, h) {
  var g = new Uint8Array(w * h);
  for (var i = 0; i < g.length; i++) g[i] = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000;
  return g;
}

export function histogram(gray) {
  var h = new Uint32Array(256);
  for (var i = 0; i < gray.length; i++) h[gray[i]]++;
  return h;
}

// Bornes d'étirement du contraste : clip (2 % par défaut) des pixels les plus sombres et les plus clairs ignorés
export function stretchBounds(gray, clip) {
  var c = clip === undefined ? 0.02 : clip,
    hist = histogram(gray),
    n = gray.length,
    lo,
    hi,
    acc = 0;
  for (lo = 0; lo < 255; lo++) {
    acc += hist[lo];
    if (acc > n * c) break;
  }
  acc = 0;
  for (hi = 255; hi > 0; hi--) {
    acc += hist[hi];
    if (acc > n * c) break;
  }
  return { lo: lo, hi: Math.max(lo + 1, hi) };
}

// Contraste : plage lo..hi ramenée à 0..255, puis gain autour du gris moyen (1 = étirement seul, 1,5 = plus dur)
export function stretch(gray, lo, hi, gain) {
  var k = gain || 1,
    span = Math.max(1, hi - lo),
    lut = new Uint8Array(256),
    out = new Uint8Array(gray.length);
  for (var v = 0; v < 256; v++) {
    var u = ((v - lo) * 255) / span;
    u = 128 + (u - 128) * k;
    lut[v] = Math.max(0, Math.min(255, Math.round(u)));
  }
  for (var i = 0; i < gray.length; i++) out[i] = lut[gray[i]];
  return out;
}

// Flou en boîte de rayon R (deux passes séparables), bords répétés
export function boxBlur(src, w, h, R) {
  var tmp = new Float32Array(w * h),
    out = new Float32Array(w * h);
  var pass = function (from, to, step, len, lines, lstep) {
    for (var l = 0; l < lines; l++) {
      var o = l * lstep,
        s = 0;
      for (var k = -R; k <= R; k++) s += from[o + Math.min(len - 1, Math.max(0, k)) * step];
      for (var q = 0; q < len; q++) {
        to[o + q * step] = s / (2 * R + 1);
        s += from[o + Math.min(len - 1, q + R + 1) * step] - from[o + Math.max(0, q - R) * step];
      }
    }
  };
  pass(src, tmp, 1, w, h, w);
  pass(tmp, out, w, h, w, 1);
  return out;
}

// Masque flou : l'image plus amount fois (image moins sa version floue de rayon R)
export function unsharp(gray, w, h, amount, R) {
  if (!amount) return Uint8Array.from(gray);
  var src = Float32Array.from(gray),
    bl = boxBlur(src, w, h, Math.max(1, R | 0)),
    out = new Uint8Array(gray.length);
  for (var i = 0; i < out.length; i++)
    out[i] = Math.max(0, Math.min(255, Math.round(src[i] + amount * (src[i] - bl[i]))));
  return out;
}

// Netteté : force des contours les plus marqués (99e centile du gradient) rapportée à la plage de gris.
// Proche de 1 : contours francs (capture d'écran) ; sous 0,35 : photo floue.
export function sharpness(gray, w, h) {
  var b = stretchBounds(gray, 0.01),
    span = Math.max(8, b.hi - b.lo),
    cnt = new Uint32Array(1025),
    n = 0;
  for (var y = 1; y < h - 1; y++)
    for (var x = 1; x < w - 1; x++) {
      var o = y * w + x,
        gx = gray[o + 1] - gray[o - 1],
        gy = gray[o + w] - gray[o - w],
        m = Math.min(1024, Math.round(Math.hypot(gx, gy)));
      if (m < 4) continue;
      cnt[m]++;
      n++;
    }
  if (n < 20) return 1;
  var T = 1024,
    acc = 0;
  while (T > 0 && acc < n * 0.01) acc += cnt[T--];
  // un contour franc donne une différence centrale de la plage entière : rapport 1
  return Math.min(1, T / span);
}

// Réglages choisis d'eux-mêmes : contraste étiré, netteté renforcée seulement si la photo est floue
export function autoParams(gray, w, h) {
  var b = stretchBounds(gray),
    s = sharpness(gray, w, h);
  var sharp = s >= 0.5 ? 0 : Math.min(1.5, Math.round(((0.5 - s) / 0.3) * 10) / 10);
  return { lo: b.lo, hi: b.hi, contrast: 1, sharp: sharp, sharpness: s };
}

// Application : contraste (p.lo, p.hi, p.contrast) puis netteté (p.sharp, rayon R)
export function enhance(gray, w, h, p, R) {
  var g = stretch(gray, p.lo, p.hi, p.contrast);
  return p.sharp ? unsharp(g, w, h, p.sharp, R || Math.max(2, Math.round(w / 300))) : g;
}
