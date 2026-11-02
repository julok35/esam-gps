/* Perspective (sans DOM, testé sous Node) : cadre de l'écran dans la photo, homographie, redressement.
   1. findQuad : contours (Sobel) sur une version réduite, lignes de Hough guidées par l'orientation du gradient,
      deux lignes « horizontales » et deux « verticales » longues et franches qui forment un grand quadrilatère convexe :
      le bord de l'écran photographié. Les lignes de texte, discontinues, pèsent moins qu'un bord continu.
   2. homography : matrice 3 x 3 qui envoie quatre points sur quatre autres (résolution d'un système 8 x 8).
   3. warp : image rééchantillonnée (bilinéaire) par la transformation inverse, pixel de sortie par pixel de sortie. */

var SMALL = 360, // largeur de travail pour la détection (pixels)
  EDGE_FRAC = 0.15, // part des pixels les plus contrastés gardés comme contours
  THETA_TOL = 3, // ouverture (degrés) autour de l'orientation du gradient pour voter
  MIN_LEN = 0.4, // longueur minimale d'une ligne (fraction du petit côté)
  MIN_AREA = 0.3, // surface minimale du quadrilatère (fraction de l'image)
  OUT = 0.08, // un coin peut sortir de l'image de 8 % au plus
  PEAKS = 8; // lignes gardées par famille

// Résolution d'un système linéaire n x n (pivot partiel). A : lignes, b : second membre. Retour : x (ou null).
function solve(A, b) {
  var n = b.length,
    i,
    j,
    k;
  for (i = 0; i < n; i++) {
    var p = i;
    for (j = i + 1; j < n; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j;
    if (Math.abs(A[p][i]) < 1e-12) return null;
    if (p !== i) {
      var t = A[i];
      A[i] = A[p];
      A[p] = t;
      t = b[i];
      b[i] = b[p];
      b[p] = t;
    }
    for (j = i + 1; j < n; j++) {
      var f = A[j][i] / A[i][i];
      for (k = i; k < n; k++) A[j][k] -= f * A[i][k];
      b[j] -= f * b[i];
    }
  }
  var x = new Array(n);
  for (i = n - 1; i >= 0; i--) {
    var s = b[i];
    for (k = i + 1; k < n; k++) s -= A[i][k] * x[k];
    x[i] = s / A[i][i];
  }
  return x;
}

// Homographie H (9 nombres, ligne par ligne, H[8] = 1) telle que apply(H, src[i]) = dst[i] pour les 4 points
export function homography(src, dst) {
  var A = [],
    b = [];
  for (var i = 0; i < 4; i++) {
    var x = src[i][0],
      y = src[i][1],
      X = dst[i][0],
      Y = dst[i][1];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
    b.push(Y);
  }
  var h = solve(A, b);
  return h ? h.concat([1]) : null;
}
export function apply(H, x, y) {
  var d = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / d, (H[3] * x + H[4] * y + H[5]) / d];
}
export function invert(H) {
  var a = H[0],
    b = H[1],
    c = H[2],
    d = H[3],
    e = H[4],
    f = H[5],
    g = H[6],
    h = H[7],
    i = H[8];
  var A = e * i - f * h,
    B = -(d * i - f * g),
    C = d * h - e * g,
    det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  var o = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d];
  for (var k = 0; k < 9; k++) o[k] /= det;
  return o;
}

// src : pixels (ch octets par pixel) de w x h. Hinv envoie un point de la sortie vers la source.
// fill : valeur des pixels hors de la source (tableau de ch octets). Retour : Uint8ClampedArray ow x oh x ch.
export function warp(src, w, h, ch, Hinv, ow, oh, fill) {
  var out = new Uint8ClampedArray(ow * oh * ch),
    X,
    Y,
    c;
  for (Y = 0; Y < oh; Y++)
    for (X = 0; X < ow; X++) {
      var o = (Y * ow + X) * ch,
        d = Hinv[6] * (X + 0.5) + Hinv[7] * (Y + 0.5) + Hinv[8],
        x = (Hinv[0] * (X + 0.5) + Hinv[1] * (Y + 0.5) + Hinv[2]) / d - 0.5,
        y = (Hinv[3] * (X + 0.5) + Hinv[4] * (Y + 0.5) + Hinv[5]) / d - 0.5;
      if (!(x >= 0 && y >= 0 && x <= w - 1 && y <= h - 1)) {
        for (c = 0; c < ch; c++) out[o + c] = fill ? fill[c] : 0;
        continue;
      }
      var x0 = Math.floor(x),
        y0 = Math.floor(y),
        x1 = Math.min(w - 1, x0 + 1),
        y1 = Math.min(h - 1, y0 + 1),
        fx = x - x0,
        fy = y - y0,
        p00 = (y0 * w + x0) * ch,
        p01 = (y0 * w + x1) * ch,
        p10 = (y1 * w + x0) * ch,
        p11 = (y1 * w + x1) * ch;
      for (c = 0; c < ch; c++)
        out[o + c] =
          (src[p00 + c] * (1 - fx) + src[p01 + c] * fx) * (1 - fy) + (src[p10 + c] * (1 - fx) + src[p11 + c] * fx) * fy;
    }
  return out;
}

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
// Rectangle de sortie d'un quadrilatère (TL, TR, BR, BL) : largeur et hauteur moyennes des côtés opposés,
// bornées à max pixels sur le grand côté
export function rectFor(quad, max) {
  var w = (dist(quad[0], quad[1]) + dist(quad[3], quad[2])) / 2,
    h = (dist(quad[0], quad[3]) + dist(quad[1], quad[2])) / 2,
    k = max ? Math.min(1, max / Math.max(w, h)) : 1;
  return { w: Math.max(8, Math.round(w * k)), h: Math.max(8, Math.round(h * k)) };
}
// Quadrilatère élargi d'une fraction m de ses dimensions, à partir de son centre
export function grow(quad, m) {
  var cx = 0,
    cy = 0;
  quad.forEach(function (p) {
    cx += p[0] / 4;
    cy += p[1] / 4;
  });
  return quad.map(function (p) {
    return [cx + (p[0] - cx) * (1 + m), cy + (p[1] - cy) * (1 + m)];
  });
}
// Écart maximal (degrés) des côtés à l'horizontale ou à la verticale : 0 pour un rectangle droit
export function tiltOf(quad) {
  var side = function (a, b, vert) {
    var dx = quad[b][0] - quad[a][0],
      dy = quad[b][1] - quad[a][1];
    return Math.abs((Math.atan2(vert ? dx : dy, vert ? dy : dx) * 180) / Math.PI);
  };
  return Math.max(side(0, 1), side(3, 2), side(0, 3, true), side(1, 2, true));
}
export function area(quad) {
  var s = 0;
  for (var i = 0; i < 4; i++) {
    var a = quad[i],
      b = quad[(i + 1) % 4];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}
function convex(quad) {
  var sign = 0;
  for (var i = 0; i < 4; i++) {
    var a = quad[i],
      b = quad[(i + 1) % 4],
      c = quad[(i + 2) % 4],
      z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (!z) return false;
    if (!sign) sign = z > 0 ? 1 : -1;
    else if ((z > 0 ? 1 : -1) !== sign) return false;
  }
  return true;
}

// Image réduite (moyenne par blocs) : { g, w, h, s } avec s l'échelle appliquée
function shrink(gray, w, h, maxW) {
  var s = Math.min(1, maxW / Math.max(w, h));
  if (s === 1) return { g: gray, w: w, h: h, s: 1 };
  var sw = Math.max(2, Math.round(w * s)),
    sh = Math.max(2, Math.round(h * s)),
    g = new Uint8Array(sw * sh);
  for (var y = 0; y < sh; y++) {
    var y0 = Math.floor((y * h) / sh),
      y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / sh));
    for (var x = 0; x < sw; x++) {
      var x0 = Math.floor((x * w) / sw),
        x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / sw)),
        acc = 0,
        n = 0;
      for (var yy = y0; yy < y1; yy++) for (var xx = x0; xx < x1; xx++, n++) acc += gray[yy * w + xx];
      g[y * sw + x] = acc / n;
    }
  }
  return { g: g, w: sw, h: sh, s: sw / w };
}

// Longueur du segment de la ligne (theta en radians, rho par rapport au centre) à l'intérieur de l'image w x h
function segLen(th, rho, w, h) {
  var c = Math.cos(th),
    s = Math.sin(th),
    pts = [],
    cx = w / 2,
    cy = h / 2;
  // intersections avec x = 0, x = w, y = 0, y = h (coordonnées centrées)
  if (Math.abs(s) > 1e-9)
    [-cx, w - cx].forEach(function (x) {
      var y = (rho - x * c) / s;
      if (y >= -cy - 1e-6 && y <= h - cy + 1e-6) pts.push([x, y]);
    });
  if (Math.abs(c) > 1e-9)
    [-cy, h - cy].forEach(function (y) {
      var x = (rho - y * s) / c;
      if (x >= -cx - 1e-6 && x <= w - cx + 1e-6) pts.push([x, y]);
    });
  if (pts.length < 2) return 0;
  var best = 0;
  for (var i = 0; i < pts.length; i++)
    for (var j = i + 1; j < pts.length; j++) best = Math.max(best, dist(pts[i], pts[j]));
  return best;
}
// Point d'intersection de deux lignes (coordonnées centrées)
function meet(a, b) {
  var det = Math.sin(b.th - a.th);
  if (Math.abs(det) < 1e-6) return null;
  return [
    (a.rho * Math.sin(b.th) - b.rho * Math.sin(a.th)) / det,
    (b.rho * Math.cos(a.th) - a.rho * Math.cos(b.th)) / det
  ];
}

/**
 * Cadre de l'écran dans l'image gray (w x h). Retour : null si rien de net, sinon
 * { quad : [TL, TR, BR, BL] en pixels de l'image, gain : netteté du bord (force du bord le plus faible rapportée au
 * contraste moyen de l'image ; net au-delà de 6), tilt : écart maximal des côtés à l'horizontale ou verticale (°),
 * cover : surface du cadre rapportée à l'image }.
 */
export function findQuad(gray, w, h) {
  var S = shrink(gray, w, h, SMALL),
    g = S.g,
    sw = S.w,
    sh = S.h,
    x,
    y,
    o,
    i;
  // contours
  var mag = new Float32Array(sw * sh),
    ang = new Float32Array(sw * sh),
    cnt = new Uint32Array(1025),
    sum = 0;
  for (y = 1; y < sh - 1; y++)
    for (x = 1; x < sw - 1; x++) {
      o = y * sw + x;
      var gx = g[o - sw + 1] + 2 * g[o + 1] + g[o + sw + 1] - g[o - sw - 1] - 2 * g[o - 1] - g[o + sw - 1],
        gy = g[o + sw - 1] + 2 * g[o + sw] + g[o + sw + 1] - g[o - sw - 1] - 2 * g[o - sw] - g[o - sw + 1],
        m = Math.hypot(gx, gy);
      mag[o] = m;
      ang[o] = Math.atan2(gy, gx);
      cnt[Math.min(1024, m | 0)]++;
      sum += m;
    }
  var meanMag = sum / ((sw - 2) * (sh - 2)) || 1,
    T = 1024,
    acc = 0;
  while (T > 0 && acc < sw * sh * EDGE_FRAC) acc += cnt[T--];
  T = Math.max(16, T);
  // Hough : theta en degrés (0 à 179, direction de la normale), rho par rapport au centre
  var D = Math.ceil(Math.hypot(sw, sh) / 2) + 1,
    NR = 2 * D + 1,
    H = new Float32Array(180 * NR),
    cs = new Float64Array(180),
    sn = new Float64Array(180),
    cx = sw / 2,
    cy = sh / 2;
  for (i = 0; i < 180; i++) {
    cs[i] = Math.cos((i * Math.PI) / 180);
    sn[i] = Math.sin((i * Math.PI) / 180);
  }
  for (y = 1; y < sh - 1; y++)
    for (x = 1; x < sw - 1; x++) {
      o = y * sw + x;
      if (mag[o] < T) continue;
      var a0 = Math.round((ang[o] * 180) / Math.PI);
      for (var dt = -THETA_TOL; dt <= THETA_TOL; dt++) {
        var th = (((a0 + dt) % 180) + 180) % 180,
          rho = Math.round((x - cx) * cs[th] + (y - cy) * sn[th]);
        H[th * NR + rho + D] += mag[o];
      }
    }
  // pics par famille, force rapportée à la longueur de la ligne dans l'image
  var minLen = MIN_LEN * Math.min(sw, sh),
    fam = { h: [], v: [] };
  for (var t = 0; t < 180; t++) {
    var isH = t >= 60 && t <= 120,
      isV = t <= 30 || t >= 150;
    if (!isH && !isV) continue;
    for (var r = 0; r < NR; r++) {
      var v = H[t * NR + r];
      if (!v) continue;
      var top = true;
      for (var dt2 = -3; dt2 <= 3 && top; dt2++) {
        var tt = (((t + dt2) % 180) + 180) % 180;
        for (var dr = -4; dr <= 4; dr++) {
          var rr = r + dr;
          if (rr < 0 || rr >= NR || (!dt2 && !dr)) continue;
          var u = H[tt * NR + rr];
          if (u > v || (u === v && (dt2 < 0 || (!dt2 && dr < 0)))) {
            top = false;
            break;
          }
        }
      }
      if (!top) continue;
      var thr = (t * Math.PI) / 180,
        len = segLen(thr, r - D, sw, sh);
      if (len < minLen) continue;
      (isH ? fam.h : fam.v).push({ th: thr, rho: r - D, s: v / len });
    }
  }
  var byS = function (a, b) {
    return b.s - a.s;
  };
  fam.h.sort(byS);
  fam.v.sort(byS);
  fam.h = fam.h.slice(0, PEAKS);
  fam.v = fam.v.slice(0, PEAKS);
  // quadrilatères : le plus grand parmi ceux dont les quatre bords sont nets
  var best = null,
    inside = function (p) {
      return (
        p[0] >= -OUT * sw - cx && p[0] <= sw * (1 + OUT) - cx && p[1] >= -OUT * sh - cy && p[1] <= sh * (1 + OUT) - cy
      );
    };
  for (var a = 0; a < fam.h.length; a++)
    for (var b = a + 1; b < fam.h.length; b++)
      for (var c = 0; c < fam.v.length; c++)
        for (var d = c + 1; d < fam.v.length; d++) {
          var h1 = fam.h[a],
            h2 = fam.h[b],
            v1 = fam.v[c],
            v2 = fam.v[d];
          // h1 en haut (y plus petit au centre), v1 à gauche
          if (h1.rho / Math.sin(h1.th) > h2.rho / Math.sin(h2.th)) {
            h1 = fam.h[b];
            h2 = fam.h[a];
          }
          if (v1.rho / Math.cos(v1.th) > v2.rho / Math.cos(v2.th)) {
            v1 = fam.v[d];
            v2 = fam.v[c];
          }
          var q = [meet(h1, v1), meet(h1, v2), meet(h2, v2), meet(h2, v1)];
          if (
            q.some(function (p) {
              return !p || !inside(p);
            }) ||
            !convex(q)
          )
            continue;
          var ar = area(q);
          if (ar < MIN_AREA * sw * sh) continue;
          var smin = Math.min(h1.s, h2.s, v1.s, v2.s),
            gain = smin / meanMag;
          if (!best || gain * Math.sqrt(ar) > best.gain * Math.sqrt(best.ar)) best = { q: q, gain: gain, ar: ar };
        }
  if (!best) return null;
  var k = 1 / S.s,
    quad = best.q.map(function (p) {
      return [(p[0] + cx) * k, (p[1] + cy) * k];
    });
  return { quad: quad, gain: best.gain, tilt: tiltOf(quad), cover: best.ar / (sw * sh) };
}
