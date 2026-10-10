# GPS ESAM

Convertisseur de coordonnées GPS de l'Équipe de Secours Animalier en Montagne (ESAM).

- Photo de l'écran (Garmin, téléphone), zoom au pincement pour cadrer, redressement d'une photo de travers (réglette ou automatique), lecture du texte sur le téléphone (Tesseract.js, plusieurs lectures et vote)
- Correction de la lecture chiffre par chiffre, avec des molettes comme un cadenas à code
- Détection automatique du format : DD, DMM, DMS, NMEA, UTM, liens Google Maps
- Sortie en degrés décimaux pour la RC Plus du M30T, saisie DJI Pilot 2
- Carte (Plan IGN, topo, photo aérienne) avec la position du téléphone, distance, cap et dénivelé
- Lieu du point : commune, altitude du terrain, lieux nommés à moins de 2 km (sommet, col, lac, cascade, refuge...), avec du réseau
- Boussole active d'elle-même dans le bandeau du haut : on pointe le téléphone vers la victime, le repère jaune (gauche / droite selon le cap, haut / bas selon la hauteur du point) entre dans le viseur, « Tournez à gauche / droite » quand il est hors champ
- Écran en tuiles repliables (icône, titre, résumé une fois repliée), état gardé sur le téléphone
- Partage natif, WhatsApp, QR code (appli, Google Maps, geo:)
- Installable sur l'écran d'accueil, fonctionne hors ligne une fois préparée

## Organisation

Site statique sans build, servi tel quel (GitHub Pages).

| Fichier | Rôle |
| --- | --- |
| `index.html`, `app.css` | Page et styles |
| `js/app.js` | Point d'entrée : résultat, liens, événements |
| `js/parser.js` | Détection et conversion des coordonnées (sans DOM, testé sous Node) |
| `js/ocr.js` | Photo, zoom, redressement et recadrage, lecture Tesseract et vote entre lectures |
| `js/skew.js` | Mesure de l'inclinaison du texte (sans DOM, testé sous Node) |
| `js/fix.js` | Correction de la lecture par molettes |
| `js/map.js` | Carte, position du téléphone, distance et cap |
| `js/place.js` | Commune (geo.api.gouv.fr, Nominatim hors de France), lieux proches (Overpass, OpenStreetMap), altitude du terrain (IGN RGE ALTI, Copernicus via Open-Meteo hors de France) et dénivelé |
| `js/compass.js` | Bandeau boussole (capteurs d'orientation, déclinaison magnétique approchée) |
| `js/share.js`, `js/history.js`, `js/util.js` | Partage et QR, historique, outils communs |
| `sw.js` | Service worker : appli hors ligne, moteur de lecture et tuiles en cache |
| `test/` | Tests Node (`node --test`), dont une vraie photo d'écran Garmin en niveaux de gris |
| `eslint.config.js`, `.prettierrc.json`, `.editorconfig` | Règles de qualité et de mise en forme |
| `vendor/` | Leaflet 1.9.4, qrcode-generator 1.4.4, tesseract.js 5.1.1 (bibliothèque et worker), polices (licence OFL) |

Le moteur WebAssembly de Tesseract et la langue (environ 7 Mo) restent sur jsDelivr, en versions figées, et sont gardés par le service worker après le premier usage ou le bouton « Préparer la lecture de photo sans réseau ».

## Développer

### Lancer l'appli en local

Les modules ES et le service worker ne fonctionnent pas en ouvrant `index.html` directement (`file://`) : il faut un serveur HTTP, par exemple :

```
python3 -m http.server 8000
```

puis http://localhost:8000. Le service worker garde les fichiers en cache : en cas de doute après une modification, recharger deux fois ou cocher « Bypass for network » (outils de développement › Application › Service workers). La boussole, la géolocalisation et l'appareil photo demandent un téléphone ; ils marchent sur `localhost` ou en HTTPS uniquement.

### Chemin des données

```
Saisie / collage ──────────────┐
                               ▼
Photo ─► ocr.js : cadre, redressement ─► Tesseract, jusqu'à 8 lectures ─► parser.parse() sur chacune
                                                                       ─► vote lat / lon (votes, firm)
                               │
                               ▼
              parser.parse(texte) : normalize ─► tokenize ─► fenêtres ─► lectures notées (SCORE, PEN)
                               │                                        ─► meilleur candidat + autres lectures
                               ▼
              app.js render() ─► state.current ─► map.js (carte, distance), place.js (commune, altitude),
                                                  compass.js (bandeau boussole), share.js, history.js
                               ▲
              fix.js (molettes) : texte corrigé ─► parse() à nouveau
```

- `js/parser.js` est le cœur : son en-tête décrit l'algorithme, le barème des candidats (`SCORE`, `PEN`) et les structures de données (`Candidate`, `ParseResult`).
- `state` (`js/util.js`) est le seul état partagé : point affiché et position du téléphone. Après un changement, `updateMap()` met à jour la carte, le dénivelé et la boussole.
- Les bibliothèques de `vendor/` (Leaflet, qrcode, Tesseract) sont chargées en scripts classiques et utilisées comme variables globales (`L`, `qrcode`, `Tesseract`).

### Qualité du code

```
npm install          # une fois : ESLint et Prettier (outils de développement seulement, Node 20 ou plus)
npm run lint         # règles ESLint
npm run format       # mise en forme Prettier (format:check pour vérifier sans modifier)
```

La CI refuse un push qui ne passe pas le lint ou la mise en forme. Le site lui-même n'a aucune dépendance ni étape de build.

## Tests

```
npm test
```

Node 18 ou plus ; les tests n'ont besoin d'aucune dépendance. Ils tournent aussi à chaque push (GitHub Actions). Tout nouveau piège de lecture rencontré sur le terrain doit devenir un cas dans `test/parser.test.js`. Le barème du parser a été réglé sur ces cas : après toute modification d'un poids, relancer les tests.

## Mise en ligne

Après une modification des fichiers de l'appli, changer la version `V` en tête de `sw.js` (et la liste `SHELL` si un fichier est ajouté) pour que les téléphones récupèrent la nouvelle version, et la même version dans `VERSION` de `js/util.js` (affichée dans le bandeau). Les tests vérifient que les deux concordent.
