/* Fiche d'une photo : tout ce que l'appli sait d'elle (date, lecture, correction, état), et les étapes communes à une
   photo seule et à un lot de photos : la dater, la lire, retenir son point, le verser au suivi. Les deux parcours
   n'ont que ces fonctions ; rien n'est affiché ici (la photo et ses étapes : auto.js ; le point : app.js). */
import * as ocr from './ocr.js';
import { readPhoto, deg, NO_ZONE, NO_READ } from './pipeline.js';
import { exifDate } from './exif.js';
import { putPoint } from './track.js';

/**
 * Fiche : { id, key : identifiant de la photo dans le suivi, file, name, t : date (ms), src : origine de la date
 * (voir SRC), t0, src0 : date et origine avant tout déplacement dans un lot, thumb : vignette (lot),
 * st : wait (à lire) | run | ok (point sûr) | check (douteux) | none (rien à transmettre) | fail (lecture
 * impossible) | bad (photo illisible), msg : texte de l'état,
 * r : lecture gardée pour rouvrir la photo telle que lue, reprises à la main comprises : { turns : quarts de tour,
 *   quad, angle, box, enh : réglages de contraste, found, res : voir ocr.readBox, steps : { étape : { st, msg } } },
 * fix : point corrigé ou confirmé à la main, dans le format lu : { text, p : lecture vérifiée, chosen } }.
 */
let seq = 0;
export const SRC = {
  exif: 'date de prise de vue',
  file: 'date du fichier',
  now: 'heure de la lecture',
  moved: 'date déplacée dans le lot'
};
export const BAD = 'photo illisible (format non reconnu ou fichier abîmé)';
export const FAIL = 'lecture impossible : vérifiez le réseau au premier usage, ou tapez le texte';

// La même photo garde la même clé d'une lecture à l'autre (seule, en lot, lot vidé puis repris) : son point du suivi
// est corrigé sur place, jamais doublé
export function shotKey(file) {
  return `${file.name || 'photo'}|${file.size || 0}|${file.lastModified || 0}`;
}
// Date d'une photo : prise de vue (EXIF), sinon date du fichier. Retour (promesse) : { t, src }
export function dateOf(file) {
  const other = () => (file.lastModified ? { t: file.lastModified, src: 'file' } : { t: Date.now(), src: 'now' });
  return (file.slice ? file.slice(0, 131072).arrayBuffer() : Promise.reject(new Error('fichier illisible'))).then(
    (b) => {
      const t = exifDate(b);
      return t ? { t, src: 'exif' } : other();
    },
    other
  );
}
// Fiche d'une photo choisie ou prise, datée. Retour : promesse de la fiche
export function newShot(file) {
  const shot = {
    id: ++seq,
    key: shotKey(file),
    file,
    name: file.name || 'photo',
    t: 0,
    t0: 0,
    src: 'file',
    src0: 'file',
    thumb: '',
    st: 'wait',
    msg: '',
    r: null,
    fix: null
  };
  return dateOf(file).then((d) => {
    shot.t = shot.t0 = d.t;
    shot.src = shot.src0 = d.src;
    return shot;
  });
}

/**
 * État d'une photo d'après sa lecture. out : { found, res, trust, quad, angle } (voir pipeline.readPhoto),
 * steps : étapes de la lecture (leurs textes servent tels quels). Retour : { st, msg }.
 */
export function stateOf(out, steps) {
  const s = steps || {};
  if (!out.found) return { st: 'none', msg: (s.zone && s.zone.msg) || NO_ZONE };
  if (!out.res || out.res.none || !out.trust) return { st: 'none', msg: (s.read && s.read.msg) || NO_READ };
  const parts = [],
    ok = out.trust.level === 'ok';
  if (out.quad) parts.push('perspective');
  if (out.angle) parts.push(`redressée ${deg(out.angle)}`);
  return {
    st: ok ? 'ok' : 'check',
    msg: `${ok ? 'fiable' : 'douteux'} ${out.trust.pct} %${parts.length ? ` (${parts.join(', ')})` : ''}`
  };
}
// Ce que la photo donne à afficher dans « Point de la victime » : sa correction à la main, sinon sa lecture.
// Retour : { text, p : résultat (voir parser.parse), chosen : lecture retenue parmi p.best et p.alts }, ou null si
// rien n'a été lu
export function shotPoint(shot) {
  if (!shot) return null;
  if (shot.fix) return shot.fix;
  const r = shot.r;
  return r && r.found && r.res ? { text: r.res.text, p: r.res.p, chosen: 0 } : null;
}
// Coordonnées retenues pour la photo (sûres ou non : voir shot.st), ou null
export function pointOf(shot) {
  const x = shotPoint(shot);
  if (!x || !x.p.ok) return null;
  const all = [x.p.best].concat(x.p.alts);
  return all[Math.min(x.chosen || 0, all.length - 1)];
}

/**
 * Lecture d'une photo par la chaîne commune (pipeline.js). o : { wi : moteur, stale() : lecture abandonnée,
 * onStep(étape, état, texte), orig : photo déjà chargée (celle affichée) ; sans orig, la photo est chargée ici puis
 * ses canevas sont libérés }. La fiche garde la lecture (shot.r) et son état (shot.st, shot.msg).
 * Retour (promesse) : résultat de pipeline.readPhoto (ses canevas seulement avec o.orig), ou null si la photo n'a
 * pas été lue (illisible, lecture impossible, abandon : voir shot.st).
 */
export async function readShot(shot, o) {
  const steps = {},
    own = !o.orig;
  shot.st = 'run';
  shot.msg = 'redressement…';
  shot.r = null;
  shot.fix = null;
  touch(shot);
  let orig, out;
  try {
    orig = o.orig || (await ocr.loadCanvas(shot.file));
  } catch (err) {
    console.error('Photo :', err);
    return end(shot, 'bad', BAD);
  }
  try {
    out = await readPhoto(orig, {
      stale: o.stale,
      wi: o.wi,
      onStep(k, st, msg) {
        steps[k] = { st, msg };
        if (st === 'run') {
          shot.msg = msg;
          touch(shot);
        }
        if (o.onStep) o.onStep(k, st, msg);
      }
    });
  } catch (err) {
    console.error('Lecture photo :', err);
    if (own) free(orig);
    return end(shot, 'fail', FAIL);
  }
  // lecture abandonnée (arrêt, autre photo) : la photo reste à lire
  if (!out) {
    if (own) free(orig);
    return end(shot, 'wait', '');
  }
  shot.r = {
    turns: 0,
    quad: out.quad,
    angle: out.angle,
    box: out.box,
    enh: ocr.getEnh(),
    found: out.found,
    res: out.res,
    steps
  };
  Object.assign(shot, stateOf(out, steps));
  if (own) {
    // rien n'est gardé en mémoire d'une photo de lot : elle sera rechargée si on l'ouvre
    free(orig, out.base, out.img);
    out.base = out.img = null;
  }
  touch(shot);
  return out;
}
function end(shot, st, msg) {
  shot.st = st;
  shot.msg = msg;
  touch(shot);
  return null;
}
// Canevas rendus tout de suite (un téléphone garde sinon leurs pixels jusqu'au prochain ramasse-miettes)
function free(...cs) {
  cs.forEach((c) => {
    if (c) c.width = c.height = 0;
  });
}

// Point de la photo corrigé (molettes) ou confirmé à la main : il devient son point sûr. text : texte dans le format
// lu, p : son résultat, vérifié, chosen : lecture retenue, msg : texte de l'état
export function fixShot(shot, text, p, chosen, msg) {
  p.verified = true;
  shot.fix = { text, p, chosen: chosen || 0 };
  shot.st = 'ok';
  shot.msg = msg;
  touch(shot);
}
// Correction retirée (autre lecture choisie parmi les propositions) : la photo redevient à vérifier
export function unfixShot(shot) {
  shot.fix = null;
  shot.st = 'check';
  shot.msg = 'autre lecture choisie : à confirmer';
  touch(shot);
}

// Le point sûr de la photo entre dans le suivi, ou y corrige le point de cette même photo (voir track.placePoint).
// scroll : l'écran va au suivi. Retour : { n, how }, ou null si la photo n'a pas de point sûr
export function sendShot(shot, scroll) {
  const c = shot && shot.st === 'ok' ? pointOf(shot) : null;
  if (!c) return null;
  const res = putPoint({ lat: c.lat, lon: c.lon, t: shot.t, key: shot.key }, scroll);
  touch(shot);
  return res;
}

// ---------- État partagé par les deux parcours ----------
// Ce qui change sur une fiche est signalé à ceux qui l'affichent (liste du lot, bouton du suivi)
const subs = [];
export function watch(fn) {
  subs.push(fn);
}
export function touch(shot) {
  subs.forEach((fn) => {
    fn(shot);
  });
}
// Fiche dont la lecture est affichée dans « Point de la victime », avec ou sans point (null : aucune, ou texte saisi)
let shownShot = null;
export function shown() {
  return shownShot;
}
export function setShown(shot) {
  if (shot === shownShot) return;
  shownShot = shot || null;
  touch(shownShot);
}
// Une seule lecture à la fois : '' (libre), 'one' (photo seule) ou 'lot'
let busy = '';
export function busyWith() {
  return busy;
}
export function setBusy(b) {
  if (b === busy) return;
  busy = b;
  touch(null);
}
