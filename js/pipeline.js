/* Chaîne de lecture d'une photo, la même pour une photo seule (auto.js, étapes affichées) et pour un lot (batch.js) :
   redressement (perspective, inclinaison), contraste et netteté, zone des coordonnées, lecture, confiance.
   Chaque étape prend la photo en entrée et rend son résultat : rien n'est gardé ici, rien n'est affiché ici. */
import * as ocr from './ocr.js';
import { confidence } from './trust.js';
import { autoParams } from './enhance.js';

const ZONE_PAD = 0.35; // marge autour des mots trouvés (fraction de la hauteur de la zone)
const TILT = 45; // inclinaison corrigée au plus (degrés)
const MIDDLE = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
// Textes des deux issues sans point, les mêmes à l'écran d'une photo seule et dans la liste d'un lot
export const NO_ZONE = 'coordonnées non trouvées : cadrez-les à la main';
export const NO_READ = 'aucune coordonnée lue dans le cadre : recadrez à la main';

// « +1,5° », « −0,3° »
export function deg(v) {
  return `${(v > 0 ? '+' : v < 0 ? '−' : '') + String(Math.abs(Math.round(v * 10) / 10)).replace('.', ',')}°`;
}
// angle au dixième de degré, borné : la valeur que montre la réglette
function tilt(a) {
  return Math.max(-TILT, Math.min(TILT, Math.round(a * 10) / 10));
}
function turned(base, angle) {
  return angle ? ocr.rotateCanvas(base, angle) : base;
}
const never = () => false;
const noop = () => {};

/**
 * Redressement. orig : photo telle que prise. Retour : { base : photo redressée en perspective (orig sinon),
 * quad : coins de l'écran appliqués ou null, angle : inclinaison corrigée (degrés), img : base tournée de angle,
 * st, msg : état et texte de l'étape }.
 */
export function level(orig) {
  const parts = [];
  let base = orig,
    quad = null,
    st = 'ok';
  const q = ocr.detectQuadIn(orig);
  if (q && q.gain >= ocr.QUAD_GAIN && q.cover < 0.97 && q.tilt >= 0.4) {
    const w = ocr.warpCanvas(orig, q.quad);
    if (w) {
      base = w;
      quad = q.quad;
      parts.push(`perspective corrigée (bords nets, ${deg(q.tilt)})`);
    }
  } else if (q && q.gain >= ocr.QUAD_GAIN) parts.push('écran déjà droit');
  else parts.push('pas de bord d’écran net : perspective laissée');
  const r = ocr.leanIn(base, MIDDLE, TILT);
  let angle = 0;
  if (r.gain >= ocr.AUTO_GAIN && Math.abs(r.deg) >= 0.3) {
    angle = tilt(-r.deg);
    parts.push(`inclinaison ${deg(angle)}`);
  } else if (r.gain >= ocr.AUTO_GAIN) parts.push('texte droit');
  else {
    parts.push('inclinaison non mesurable (texte peu net)');
    st = 'info';
  }
  return { base, quad, angle, img: turned(base, angle), st, msg: parts.join(' · ') };
}

// Contraste et netteté appliqués à la lecture de img (réglages à la main compris) : texte de l'étape
export function enhInfo(img) {
  const G = ocr.grayOf(img, null, 800),
    p = autoParams(G.g, G.w, G.h),
    e = ocr.getEnh(),
    x = (v) => String(v).replace('.', ',');
  let msg = `contraste étiré (${p.lo}-${p.hi} → 0-255)`;
  if (e.sharp === null) msg += p.sharp ? `, netteté renforcée ×${x(p.sharp)}` : ', photo nette';
  else msg += `, netteté ×${x(e.sharp)} (réglée à la main)`;
  if (e.contrast !== 1) msg += `, contraste ×${x(e.contrast)}`;
  return msg;
}

/**
 * Zone des coordonnées : cherchée dans img (base tournée de angle) par vues successives, puis inclinaison affinée sur
 * la zone elle-même (la photo est tournée à nouveau depuis base, le cadre suit).
 * o : { stale(), wi : moteur, onView(nom, i) }.
 * Retour : undefined si la photo a changé entre-temps ; sinon { found, st, msg } et, zone trouvée,
 * { angle, img, box : cadre de lecture en fractions de img }.
 */
export async function zone(base, angle, img, o) {
  const z = await ocr.findZone(img, o.stale || never, o.wi, o.onView);
  if (z === undefined) return undefined;
  if (!z) return { found: false, st: 'warn', msg: NO_ZONE };
  const pad = (z.box.y1 - z.box.y0) * ZONE_PAD;
  let box = ocr.fitBox({
      x: (z.box.x0 - pad) / img.width,
      y: (z.box.y0 - pad) / img.height,
      w: (z.box.x1 - z.box.x0 + 2 * pad) / img.width,
      h: (z.box.y1 - z.box.y0 + 2 * pad) / img.height
    }),
    more = '';
  // coordonnées mal lues à cette étape : souvent une seule des deux lignes a été cadrée, l'autre est juste à côté
  if (!z.clean) {
    box = ocr.fitBox(ocr.widen(box));
    more = ', cadre élargi aux lignes voisines';
  }
  const r = ocr.leanIn(img, box, 10),
    na = tilt(angle - r.deg);
  if (r.gain >= ocr.AUTO_GAIN && Math.abs(r.deg) >= 0.4 && na !== angle) {
    const img2 = turned(base, na);
    box = ocr.fitBox(ocr.turnBox(box, img, img2, na - angle));
    more += `, inclinaison affinée ${deg(na - angle)}`;
    img = img2;
    angle = na;
  }
  return {
    found: true,
    st: 'ok',
    msg: `trouvée : « ${z.text.replace(/\s+/g, ' ').slice(0, 40)} »${
      z.conf !== null ? `, moteur sûr à ${z.conf} %` : ''
    }${z.view !== 'photo entière' ? ` (${z.view})` : ''}${more}`,
    angle,
    img,
    box
  };
}

/**
 * Lecture du cadre box de img. o : { stale(), wi, onPass(i), onWiden(), manual : cadre posé à la main (lu tel quel,
 * sans second essai sur un cadre élargi) }.
 * Retour : null si la photo a changé ; sinon { res : voir ocr.readBox, box : cadre retenu, st, msg }.
 */
export async function read(img, box, o) {
  const res = o.manual
    ? await ocr.readBox(img, box, o.onPass || noop, o.stale || never, o.wi)
    : await ocr.readFound(img, box, o.onPass || noop, o.stale || never, o.wi, o.onWiden);
  if (!res) return null;
  const used = res.box || box;
  if (res.none)
    return {
      res,
      box: used,
      st: 'fail',
      msg: o.manual ? 'aucune coordonnée lue dans le cadre' : NO_READ
    };
  const a = res.p.agree || { n: 0, total: res.total };
  return {
    res,
    box: used,
    st: res.sure ? 'ok' : 'warn',
    msg: `${a.n} lecture${a.n > 1 ? 's' : ''} sur ${a.total} concordante${a.n > 1 ? 's' : ''}${
      res.rival ? ', valeurs concurrentes' : ''
    }${o.manual ? ' (cadre manuel)' : ''}`
  };
}

// Confiance dans la lecture res : notée sur le résultat (p.trust, p.ocr). Retour : { t, st, msg }, ou null sans point
export function trust(res) {
  const p = res.p;
  if (!p.ok) return null;
  const t = confidence({
    tess: res.tess,
    agree: p.agree,
    firm: res.sure,
    rival: res.rival,
    notes: p.best.notes.length,
    alts: p.alts.length,
    manual: false
  });
  p.trust = t;
  p.ocr = true;
  return {
    t,
    st: t.level === 'ok' ? 'ok' : 'warn',
    msg: `${t.pct} % · ${
      t.level === 'ok' ? 'fiable' : 'douteux : vérifiez sur la photo avant de transmettre'
    } (${t.why.join(', ')})`
  };
}

/**
 * Toute la chaîne sur une photo. o : { stale(), wi : moteur, onStep(étape, état, texte) : avancement, étapes
 * 'level', 'enh', 'zone', 'read', 'trust' ; états 'run', 'ok', 'warn', 'fail', 'info' }.
 * Retour : null si la photo a changé entre-temps ; sinon { base, quad, angle, img, found : zone trouvée,
 * box, res : lecture (voir ocr.readBox), trust : { pct, level, why } ou null }.
 */
export async function readPhoto(orig, o) {
  const step = o.onStep || noop,
    stale = o.stale || never;
  let lv;
  try {
    lv = level(orig);
    step('level', lv.st, lv.msg);
  } catch (err) {
    console.error('Redressement :', err);
    lv = { base: orig, quad: null, angle: 0, img: orig };
    step('level', 'info', 'redressement automatique impossible : réglez à la main');
  }
  const out = {
    base: lv.base,
    quad: lv.quad,
    angle: lv.angle,
    img: lv.img,
    found: false,
    box: null,
    res: null,
    trust: null
  };
  step('enh', 'ok', enhInfo(out.img));
  step('zone', 'run', 'lecture de la photo entière…');
  const z = await zone(out.base, out.angle, out.img, {
    stale,
    wi: o.wi,
    // au-delà de la première vue, l'étape dit ce qu'elle essaie
    onView: (name, i) => i > 1 && step('zone', 'run', `nouvel essai : ${name}…`)
  });
  if (z === undefined || stale()) return null;
  step('zone', z.st, z.msg);
  if (!z.found) return out;
  Object.assign(out, { found: true, angle: z.angle, img: z.img, box: z.box });
  step('read', 'run', 'lecture 1…');
  const rd = await read(out.img, out.box, {
    stale,
    wi: o.wi,
    onPass: (i) => step('read', 'run', `lecture ${i}…`),
    onWiden: () => step('read', 'run', 'pas d’accord net : nouvel essai, cadre élargi aux lignes voisines…')
  });
  if (!rd || stale()) return null;
  out.res = rd.res;
  out.box = rd.box;
  step('read', rd.st, rd.msg);
  if (rd.res.none) {
    step('trust', 'fail', 'rien à transmettre');
    return out;
  }
  const tr = trust(rd.res);
  if (tr) {
    out.trust = tr.t;
    step('trust', tr.st, tr.msg);
  }
  return out;
}
