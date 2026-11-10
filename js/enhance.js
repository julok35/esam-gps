/* Amélioration de l'image avant lecture (sans DOM, testé sous Node) : niveaux de gris, contraste, netteté, mesures.
   Toutes les fonctions travaillent sur un tableau de gris (un octet par pixel, ligne par ligne). */

// rgba : pixels d'un canevas (4 octets par pixel) -> gris (pondération vidéo classique)
export function toGray(rgba, w, h) {
  const g = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000;
  return g;
}

export function histogram(gray) {
  const h = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) h[gray[i]]++;
  return h;
}

// Bornes d'étirement du contraste : clip (2 % par défaut) des pixels les plus sombres et les plus clairs ignorés
export function stretchBounds(gray, clip) {
  const c = clip === undefined ? 0.02 : clip;
  const hist = histogram(gray);
  const n = gray.length;
  let lo;
  let hi;
  let acc = 0;
  for (lo = 0; lo < 255; lo++) {
    acc += hist[lo];
    if (acc > n * c) break;
  }
  acc = 0;
  for (hi = 255; hi > 0; hi--) {
    acc += hist[hi];
    if (acc > n * c) break;
  }
  return { lo, hi: Math.max(lo + 1, hi) };
}

// Contraste : plage lo..hi ramenée à 0..255, puis gain autour du gris moyen (1 = étirement seul, 1,5 = plus dur)
export function stretch(gray, lo, hi, gain) {
  const k = gain || 1,
    span = Math.max(1, hi - lo),
    lut = new Uint8Array(256),
    out = new Uint8Array(gray.length);
  for (let v = 0; v < 256; v++) {
    let u = ((v - lo) * 255) / span;
    u = 128 + (u - 128) * k;
    lut[v] = Math.max(0, Math.min(255, Math.round(u)));
  }
  for (let i = 0; i < gray.length; i++) out[i] = lut[gray[i]];
  return out;
}

// Flou en boîte de rayon R (deux passes séparables), bords répétés
export function boxBlur(src, w, h, R) {
  const tmp = new Float32Array(w * h),
    out = new Float32Array(w * h);
  const pass = function (from, to, step, len, lines, lstep) {
    for (let l = 0; l < lines; l++) {
      const o = l * lstep;
      let s = 0;
      for (let k = -R; k <= R; k++) s += from[o + Math.min(len - 1, Math.max(0, k)) * step];
      for (let q = 0; q < len; q++) {
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
  const src = Float32Array.from(gray),
    bl = boxBlur(src, w, h, Math.max(1, R | 0)),
    out = new Uint8Array(gray.length);
  for (let i = 0; i < out.length; i++)
    out[i] = Math.max(0, Math.min(255, Math.round(src[i] + amount * (src[i] - bl[i]))));
  return out;
}

// Netteté : force des contours les plus marqués (99e centile du gradient) rapportée à la plage de gris.
// Proche de 1 : contours francs (capture d'écran) ; sous 0,35 : photo floue.
export function sharpness(gray, w, h) {
  const b = stretchBounds(gray, 0.01);
  const span = Math.max(8, b.hi - b.lo);
  const cnt = new Uint32Array(1025);
  let n = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const o = y * w + x,
        gx = gray[o + 1] - gray[o - 1],
        gy = gray[o + w] - gray[o - w],
        m = Math.min(1024, Math.round(Math.hypot(gx, gy)));
      if (m < 4) continue;
      cnt[m]++;
      n++;
    }
  if (n < 20) return 1;
  let T = 1024,
    acc = 0;
  while (T > 0 && acc < n * 0.01) acc += cnt[T--];
  // un contour franc donne une différence centrale de la plage entière : rapport 1
  return Math.min(1, T / span);
}

// Réglages choisis d'eux-mêmes : contraste étiré, netteté renforcée seulement si la photo est floue
export function autoParams(gray, w, h) {
  const b = stretchBounds(gray),
    s = sharpness(gray, w, h);
  const sharp = s >= 0.5 ? 0 : Math.min(1.5, Math.round(((0.5 - s) / 0.3) * 10) / 10);
  return { lo: b.lo, hi: b.hi, contrast: 1, sharp, sharpness: s };
}

// Application : contraste (p.lo, p.hi, p.contrast) puis netteté (p.sharp, rayon R)
export function enhance(gray, w, h, p, R) {
  const g = stretch(gray, p.lo, p.hi, p.contrast);
  return p.sharp ? unsharp(g, w, h, p.sharp, R || Math.max(2, Math.round(w / 300))) : g;
}

/**
 * Fond égalisé : chaque pixel est comparé à la moyenne de son voisinage (rayon R), l'écart est amplifié (gain) autour
 * d'un gris moyen. Efface un éclairage inégal (écran lumineux photographié dans le noir, reflet, ombre d'un doigt) :
 * il ne reste que les traits du texte, clairs ou sombres, que le moteur sépare alors du fond.
 */
export function flatten(gray, w, h, R, gain) {
  const bg = boxBlur(gray, w, h, R),
    out = new Uint8ClampedArray(w * h),
    k = gain || 3;
  for (let i = 0; i < out.length; i++) out[i] = 128 + (gray[i] - bg[i]) * k;
  return out;
}

// Seuil d'Otsu : le niveau de gris qui sépare le mieux les pixels sombres des pixels clairs
export function otsu(gray) {
  const hist = histogram(gray),
    n = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let nb = 0,
    sb = 0,
    best = 0,
    t = 127;
  for (let i = 0; i < 256; i++) {
    nb += hist[i];
    if (!nb) continue;
    if (nb === n) break;
    sb += i * hist[i];
    const d = sb / nb - (sum - sb) / (n - nb),
      v = nb * (n - nb) * d * d;
    if (v > best) {
      best = v;
      t = i;
    }
  }
  return t;
}

/**
 * Écran dans la photo : la plus grande zone claire d'un seul tenant (un écran allumé dans un boîtier sombre).
 * Retour : cadre { x, y, w, h } en fractions de l'image, avec une petite marge, ou null si la zone claire est trop
 * petite pour être un écran ou couvre presque toute l'image (capture d'écran : rien à recadrer).
 */
export function screenBox(gray, w, h) {
  const t = otsu(gray),
    seen = new Uint8Array(w * h),
    stack = new Int32Array(w * h);
  let best = null;
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || gray[s] <= t) continue;
    let top = 0,
      n = 0,
      x0 = w,
      y0 = h,
      x1 = 0,
      y1 = 0;
    stack[top++] = s;
    seen[s] = 1;
    while (top) {
      const p = stack[--top],
        x = p % w,
        y = (p - x) / w;
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1])
        if (q >= 0 && !seen[q] && gray[q] > t) {
          seen[q] = 1;
          stack[top++] = q;
        }
    }
    if (!best || n > best.n) best = { n, x0, y0, x1, y1 };
  }
  if (!best) return null;
  const bw = best.x1 - best.x0 + 1,
    bh = best.y1 - best.y0 + 1,
    cover = (bw * bh) / (w * h);
  // un écran est une zone pleine : la zone claire remplit l'essentiel de son cadre
  if (cover < 0.05 || cover > 0.8 || best.n < 0.6 * bw * bh) return null;
  const m = 0.03,
    x = Math.max(0, best.x0 / w - m * (bw / w)),
    y = Math.max(0, best.y0 / h - m * (bh / h));
  return { x, y, w: Math.min(1 - x, (bw / w) * (1 + 2 * m)), h: Math.min(1 - y, (bh / h) * (1 + 2 * m)) };
}
