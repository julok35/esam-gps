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
  var why = [],
    pct;
  if (info.manual || !info.agree) {
    pct = 100 - 20 * info.notes - 15 * info.alts;
    if (info.notes) why.push(info.notes + (info.notes > 1 ? ' avertissements' : ' avertissement'));
    if (info.alts) why.push('plusieurs lectures possibles');
  } else {
    var base = typeof info.tess === 'number' ? info.tess : 75,
      f = 1;
    if (info.firm) why.push(info.agree.n + ' lectures sur ' + info.agree.total + ' concordantes');
    else {
      f *= info.agree.total ? (0.8 * info.agree.n) / info.agree.total : 0;
      why.push(
        info.agree.total
          ? 'seulement ' +
              info.agree.n +
              ' lecture' +
              (info.agree.n > 1 ? 's' : '') +
              ' sur ' +
              info.agree.total +
              ' concordante' +
              (info.agree.n > 1 ? 's' : '')
          : 'aucune lecture concordante'
      );
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
    why.push('moteur sûr à ' + Math.round(base) + ' %');
    pct = Math.round(base * f);
  }
  pct = Math.max(0, Math.min(100, pct));
  var ok = !info.notes && !info.alts && (info.manual || !info.agree || (info.firm && !info.rival)) && pct >= 70;
  return { pct: pct, level: ok ? 'ok' : 'check', why: why };
}

// Transmissible : lecture fiable, ou vérifiée à la main (molettes validées, ou bouton « J'ai vérifié »)
export function trusted(r) {
  return !!(r && r.ok && (r.verified || (r.trust && r.trust.level === 'ok')));
}
