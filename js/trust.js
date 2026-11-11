/* Confiance dans un point et règle de transmission (sans DOM, testé sous Node).
   Un point n'est transmissible (partage, drone, suivi) que s'il est fiable ou vérifié à la main sur la photo. */

/**
 * Note de confiance (0 à 100) et niveau d'un point.
 * info : { tess : confiance moyenne du moteur sur les chiffres (0 à 100, ou null), agree : { n, total } lectures
 * concordantes (null sans photo), firm : les deux axes confirmés par le vote, rival : une valeur concurrente aussi
 * lue, notes : nombre d'avertissements du parser, alts : nombre d'autres lectures proposées, manual : texte saisi }.
 * Retour : { pct, level : 'ok' (fiable) ou 'check' (douteux), why : explications courtes }.
 */
export function confidence(info) {
  const why = [];
  let pct;
  if (info.manual || !info.agree) {
    pct = 100 - 20 * info.notes - 15 * info.alts;
    if (info.notes) why.push(info.notes + (info.notes > 1 ? ' avertissements' : ' avertissement'));
    if (info.alts) why.push('plusieurs lectures possibles');
  } else {
    // La concordance de lectures faites avec des préparations différentes de l'image est le signal principal :
    // trois lectures d'accord donnent 88, chaque lecture d'accord en plus ajoute 2 (95 au plus, 100 avec un moteur sûr).
    // La confiance du moteur sur les chiffres, souvent basse même quand il lit juste, ne fait que nuancer (−10 à +5).
    const a = info.agree;
    let f = 1;
    if (info.firm) {
      pct = 88 + Math.min(7, 2 * Math.max(0, a.n - 3));
      why.push(`${a.n} lectures sur ${a.total} concordantes`);
    } else {
      pct = a.total ? (75 * a.n) / a.total : 0;
      why.push(
        a.total
          ? `seulement ${a.n} lecture${a.n > 1 ? 's' : ''} sur ${a.total} concordante${a.n > 1 ? 's' : ''}`
          : 'aucune lecture concordante'
      );
    }
    if (typeof info.tess === 'number') {
      pct += Math.max(-10, Math.min(5, (info.tess - 60) / 4));
      if (info.tess < 60) why.push(`moteur hésitant sur les chiffres (${Math.round(info.tess)} %)`);
    }
    if (info.rival) {
      f *= 0.6;
      why.push('une autre valeur a aussi été lue');
    }
    if (info.notes) {
      f *= Math.pow(0.85, Math.min(2, info.notes));
      why.push(info.notes + (info.notes > 1 ? ' avertissements' : ' avertissement'));
    }
    if (info.alts && !info.rival) {
      f *= 0.8;
      why.push('plusieurs lectures possibles');
    }
    pct = Math.round(pct * f);
  }
  pct = Math.max(0, Math.min(100, pct));
  const ok = !info.notes && !info.alts && (info.manual || !info.agree || (info.firm && !info.rival)) && pct >= 70;
  return { pct, level: ok ? 'ok' : 'check', why };
}

// Transmissible : lecture fiable, ou vérifiée à la main (molettes validées, ou bouton « J'ai vérifié »)
export function trusted(r) {
  return !!(r && r.ok && (r.verified || (r.trust && r.trust.level === 'ok')));
}

/**
 * Texte retouché à la main après une lecture de photo douteuse : le doute reste. prev : résultat affiché avant la
 * retouche, next : résultat du texte retouché (voir parser.parse). Sans cela, une simple frappe dans le texte ferait
 * d'une lecture douteuse un point transmissible ; seules la correction aux molettes et la confirmation le lèvent.
 * Retour : next.
 */
export function carryDoubt(prev, next) {
  if (prev && prev.ocr && prev.ok && !trusted(prev) && next && next.ok) {
    next.ocr = true;
    next.trust = {
      pct: prev.trust ? prev.trust.pct : 0,
      level: 'check',
      why: ['texte retouché après une lecture douteuse']
    };
  }
  return next;
}
