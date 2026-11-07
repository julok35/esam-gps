/* Aller sur place : contrôle du point, liens AirOps, itinéraire Google Maps et autre appli GPS (sans DOM, testé sous Node).
   AirOps (carte MapLibre) ne lit que #zoom/lat/lon dans l'URL : aucun paramètre ne pose de repère. Le repère se pose par
   sa recherche ; l'appli copie donc les coordonnées avant d'ouvrir la carte, l'utilisateur n'a plus qu'à les coller. */

// France métropolitaine (Corse comprise), en degrés décimaux WGS84
export var FR = { la0: 41, la1: 51.5, lo0: -5.5, lo1: 10 };

function inFR(lat, lon) {
  return lat >= FR.la0 && lat <= FR.la1 && lon >= FR.lo0 && lon <= FR.lo1;
}
function n6(v) {
  return v.toFixed(6);
}

/**
 * Contrôle d'un point avant AirOps et l'itinéraire : degrés décimaux WGS84, latitude d'abord, en France métropolitaine.
 * Retour : { ok: true } ou { ok: false, msg, swap } ; swap vaut true quand latitude et longitude semblent inversées
 * (l'inversion est proposée, jamais faite en silence).
 */
export function checkPoint(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number' || !isFinite(lat) || !isFinite(lon))
    return { ok: false, swap: false, msg: 'Coordonnées invalides : AirOps et Itinéraire désactivés.' };
  if (inFR(lat, lon)) return { ok: true };
  if (inFR(lon, lat))
    return {
      ok: false,
      swap: true,
      msg: 'Latitude et longitude semblent inversées (la latitude vient en premier) : AirOps et Itinéraire désactivés.'
    };
  return {
    ok: false,
    swap: false,
    msg: 'Point hors de France métropolitaine (latitude 41 à 51,5, longitude -5,5 à 10) : AirOps et Itinéraire désactivés.'
  };
}

// Texte à coller dans la recherche AirOps : « lat, lon », 6 décimales, point décimal
export function ddText(lat, lon) {
  return n6(lat) + ', ' + n6(lon);
}
// Carte AirOps centrée sur le point (sans repère : AirOps n'en pose pas par lien)
export function airopsUrl(lat, lon) {
  return 'https://airops-supuav.fr/map/#14/' + n6(lat) + '/' + n6(lon);
}
// Itinéraire en voiture, sans départ : Google Maps part de la position actuelle du téléphone
export function routeUrl(lat, lon) {
  return 'https://www.google.com/maps/dir/?api=1&destination=' + n6(lat) + ',' + n6(lon) + '&travelmode=driving';
}
// Lien geo: (Android) : propose OsmAnd, Waze, Organic Maps... avec un repère nommé
export function geoUrl(lat, lon) {
  var p = n6(lat) + ',' + n6(lon);
  return 'geo:' + p + '?q=' + p + '(Intervention%20ESAM)';
}
