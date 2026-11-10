/* Relief du suivi (sans DOM, testé sous Node) : échantillons le long du parcours en ligne droite entre les points,
   dénivelés entre points, profil du terrain dessiné en SVG. */
import { distM } from './parser.js';

/**
 * Échantillons le long du parcours : chaque point du suivi (k = son index), plus des points intermédiaires répartis
 * selon la longueur des étapes (k = -1). d : distance cumulée depuis le point 1 (m).
 */
export function samplePath(points, n) {
  const out = [];
  const lens = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    lens.push(distM(points[i - 1], points[i]));
    total += lens[i - 1];
  }
  const extra = Math.max(0, (n || 100) - points.length);
  let d = 0;
  points.forEach((p, i) => {
    if (i) {
      const a = points[i - 1],
        m = total > 0 ? Math.round((extra * lens[i - 1]) / total) : 0;
      for (let j = 1; j <= m; j++) {
        const f = j / (m + 1);
        out.push({ lat: a.lat + (p.lat - a.lat) * f, lon: a.lon + (p.lon - a.lon) * f, d: d + lens[i - 1] * f, k: -1 });
      }
      d += lens[i - 1];
    }
    out.push({ lat: p.lat, lon: p.lon, d, k: i });
  });
  return out;
}

// Altitudes des points du suivi, prises dans les échantillons (null si inconnue)
export function pointAlts(samples, zs, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(null);
  samples.forEach((s, i) => {
    if (s.k >= 0 && typeof zs[i] === 'number') out[s.k] = zs[i];
  });
  return out;
}

// Montées et descentes cumulées d'un point au suivant (altitudes des points seulement)
export function climbs(alts) {
  let up = 0,
    down = 0;
  for (let i = 1; i < alts.length; i++) {
    if (alts[i] === null || alts[i - 1] === null) continue;
    const dz = alts[i] - alts[i - 1];
    if (dz > 0) up += dz;
    else down -= dz;
  }
  return { up, down };
}

// Pente moyenne d'une étape en % (null si distance trop courte pour avoir un sens)
export function slope(dz, d) {
  return d >= 20 ? (dz * 100) / d : null;
}

// Pas de graduation « rond » (10, 20, 50, 100, 200, 500 m...) pour environ 4 lignes
function step(range) {
  const raw = range / 4,
    p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  return [1, 2, 5, 10].map((k) => k * p).find((s) => s >= raw);
}

export const PW = 600,
  PH = 200,
  PAD = { l: 60, r: 26, t: 22, b: 26 };

/**
 * Profil SVG : terrain (aire), points du suivi numérotés avec leur altitude ; x : distance, y : altitude.
 * Retour : { svg, x(d), y(z) } ou null si pas assez d'altitudes.
 */
export function profileSvg(samples, zs, fmtDist) {
  const ok = samples.filter((s, i) => typeof zs[i] === 'number');
  if (ok.length < 2) return null;
  const zv = zs.filter((z) => typeof z === 'number');
  let zmin = Math.min.apply(null, zv);
  let zmax = Math.max.apply(null, zv);
  if (zmax - zmin < 20) {
    const mid = (zmax + zmin) / 2;
    zmin = mid - 10;
    zmax = mid + 10;
  }
  const st = step(zmax - zmin);
  const y0 = Math.floor(zmin / st) * st;
  const y1 = Math.ceil(zmax / st) * st;
  const dmax = samples[samples.length - 1].d || 1;
  const w = PW - PAD.l - PAD.r;
  const h = PH - PAD.t - PAD.b;
  const x = function (d) {
    return PAD.l + (d / dmax) * w;
  };
  const y = function (z) {
    return PAD.t + (1 - (z - y0) / (y1 - y0)) * h;
  };
  const r1 = function (v) {
    return Math.round(v * 10) / 10;
  };
  let s = '';
  // graduations d'altitude
  for (let z = y0; z <= y1 + 0.1; z += st)
    s += `<line class="pf-g" x1="${PAD.l}" x2="${PW - PAD.r}" y1="${r1(y(z))}" y2="${r1(
      y(z)
    )}"/><text class="pf-t" x="${PAD.l - 6}" y="${r1(y(z) + 4)}" text-anchor="end">${Math.round(z).toLocaleString(
      'fr-FR'
    )}</text>`;
  const line = ok.map((p) => `${r1(x(p.d))},${r1(y(zs[samples.indexOf(p)]))}`).join(' ');
  s += `<polygon class="pf-a" points="${r1(x(ok[0].d))},${PH - PAD.b} ${line} ${r1(x(ok[ok.length - 1].d))},${
    PH - PAD.b
  }"/><polyline class="pf-l" points="${line}"/>`;
  // distances : début et fin
  s += `<text class="pf-t" x="${PAD.l}" y="${PH - 6}">0</text><text class="pf-t" x="${PW - PAD.r}" y="${
    PH - 6
  }" text-anchor="end">${fmtDist(dmax)}</text>`;
  // points du suivi : pastille numérotée ; points trop proches réunis en une pastille « 2-3 » ;
  // altitude écrite au-dessus si elle ne chevauche pas la précédente
  const groups = [];
  samples.forEach((p, i) => {
    if (p.k < 0 || typeof zs[i] !== 'number') return;
    const px = x(p.d),
      g = groups[groups.length - 1];
    if (g && px - g.px < 22) {
      g.ks.push(p.k);
      g.zs.push(zs[i]);
    } else groups.push({ px, py: y(zs[i]), ks: [p.k], zs: [zs[i]] });
  });
  let lastX = -99;
  groups.forEach((g) => {
    const n = g.ks.length,
      lab = n === 1 ? String(g.ks[0] + 1) : `${g.ks[0] + 1}-${g.ks[n - 1] + 1}`,
      w = Math.max(18, 8 + lab.length * 8),
      px = r1(Math.min(Math.max(g.px, PAD.l + w / 2 - 9), PW - PAD.r + 9 - w / 2)),
      py = r1(g.py),
      lo = Math.min.apply(null, g.zs),
      hi = Math.max.apply(null, g.zs),
      zt = Math.round(lo).toLocaleString('fr-FR') + (hi - lo >= 5 ? `-${Math.round(hi).toLocaleString('fr-FR')}` : ''),
      show = px - lastX >= 30 + zt.length * 4;
    s += `<rect class="pf-p" x="${r1(px - w / 2)}" y="${r1(py - 9)}" width="${
      w
    }" height="18" rx="9"/><text class="pf-n" x="${px}" y="${r1(py + 4)}" text-anchor="middle">${lab}</text>${
      show
        ? `<text class="pf-z" x="${px}" y="${r1(py - 14)}" text-anchor="${
            px > PW - PAD.r - 30 ? 'end' : px < PAD.l + 30 ? 'start' : 'middle'
          }">${zt}</text>`
        : ''
    }`;
    if (show) lastX = px;
  });
  s += `<line class="pf-c" id="pfCur" x1="0" x2="0" y1="${PAD.t}" y2="${PH - PAD.b}" visibility="hidden"/>`;
  return {
    svg: `<svg class="pf" viewBox="0 0 ${PW} ${PH}" role="img" aria-label="Profil du terrain le long du suivi">${
      s
    }</svg>`,
    x,
    y,
    dmax
  };
}
