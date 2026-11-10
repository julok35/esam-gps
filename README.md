# GPS ESAM

Convertisseur de coordonnées GPS de l'Équipe de Secours Animalier en Montagne (ESAM).

**Appli en ligne : https://julok35.github.io/esam-gps/** (à ouvrir sur le téléphone, puis « Ajouter à l'écran d'accueil » pour l'installer).

- Photo de l'écran (Garmin, téléphone) ou capture d'écran : tout s'enchaîne seul, étape par étape, chacune affichée avec son résultat et reprenable à la main : redressement (perspective d'après les bords de l'écran, inclinaison du texte), contraste et netteté, zone des coordonnées trouvée par une première lecture de toute la photo, lecture du texte sur le téléphone (Tesseract.js, plusieurs lectures et vote), note de confiance
- Lot de photos : plusieurs photos choisies d'un coup, triées par date de prise de vue (EXIF, sinon date du fichier), réordonnables au doigt (la date suit), lues en parallèle par plusieurs moteurs ; les points sûrs rejoignent le suivi datés de la photo, les autres s'ouvrent une par une pour être repris à la main
- Un point douteux (lectures discordantes, moteur hésitant, avertissement) n'est jamais transmis : partage, drone, autres formats et suivi restent fermés tant qu'il n'est pas corrigé ou confirmé après comparaison avec la photo
- Correction de la lecture chiffre par chiffre, avec des molettes comme un cadenas à code ; zoom au pincement, cadre et quatre coins de perspective au doigt
- Suivi de plusieurs points : signalements successifs d'un même animal (nommé), distance parcourue, cap, durée et vitesse entre les points, tracé numéroté sur la carte, message de suivi à partager ; le suivi se poursuit plus tard ou sur un autre téléphone par un lien (`#s=...`, qui l'installe à l'ouverture) ou un fichier GPX (export et import, lisible aussi par les applis de carte)
- Détection automatique du format : DD, DMM, DMS, NMEA, UTM, liens Google Maps
- Sortie en degrés décimaux pour la RC Plus du M30T, saisie DJI Pilot 2
- Carte (Plan IGN, topo, photo aérienne) avec la position du téléphone, distance, cap et dénivelé
- Lieu du point : commune, altitude du terrain, lieux nommés à moins de 2 km (sommet, col, lac, cascade, refuge...), avec du réseau
- Boussole active d'elle-même dans le bandeau du haut : on pointe le téléphone vers la victime, le repère jaune (gauche / droite selon le cap, haut / bas selon la hauteur du point) entre dans le viseur, « Tournez à gauche / droite » quand il est hors champ
- Écran en tuiles repliables (icône, titre, résumé une fois repliée), état gardé sur le téléphone
- AirOps sous le point : un toucher copie « lat, lon » et ouvre la carte AirOps centrée ; dans AirOps, loupe, coller, choisir le résultat, puis toucher le repère rouge pour les restrictions de vol (AirOps ne pose pas de repère par lien, d'où la copie). Aide « ? » à côté du bouton ; si la copie est refusée, les coordonnées s'affichent en gros avec un bouton Copier
- Itinéraire : Google Maps en voiture depuis la position du téléphone (l'appli Maps sur Android), ou « Autre appli GPS » par un lien geo: (OsmAnd, Waze...). AirOps et Itinéraire restent désactivés, avec la raison, tant que le point est douteux, hors de France métropolitaine (latitude 41 à 51,5, longitude -5,5 à 10) ou semble inversé (l'inversion est alors proposée)
- Partage natif, WhatsApp, QR code (appli, Google Maps, geo:)
- Installable sur l'écran d'accueil, fonctionne hors ligne une fois préparée

## Organisation

Site statique sans build, servi tel quel (GitHub Pages).

| Fichier | Rôle |
| --- | --- |
| `index.html`, `app.css` | Page et styles |
| `js/app.js` | Point d'entrée : résultat, liens, événements |
| `js/parser.js` | Détection et conversion des coordonnées (sans DOM, testé sous Node) |
| `js/auto.js` | Enchaînement automatique après une photo : étapes affichées, reprise à la main de chacune |
| `js/ocr.js` | Photo, zoom, cadre et coins de perspective, lecture Tesseract (pleine photo puis cadre, plusieurs moteurs) et vote entre lectures |
| `js/batch.js` | Lot de photos : ordre, glisser-déposer, lecture de chaque photo sans écran, points versés au suivi |
| `js/exif.js` | Date de prise de vue dans les métadonnées JPEG (sans DOM, testé sous Node) |
| `js/skew.js` | Mesure de l'inclinaison du texte (sans DOM, testé sous Node) |
| `js/warp.js` | Perspective : bords de l'écran (Hough), homographie, redressement (sans DOM, testé sous Node) |
| `js/enhance.js` | Contraste, netteté et mesure du flou (sans DOM, testé sous Node) |
| `js/zone.js` | Zone des coordonnées parmi les lignes lues sur toute la photo (sans DOM, testé sous Node) |
| `js/trust.js` | Note de confiance et règle « rien de douteux n'est transmis » (sans DOM, testé sous Node) |
| `js/track.js` | Suivi de plusieurs points : étapes, bilan, message (calcul sans DOM, testé sous Node) et tuile |
| `js/fix.js` | Correction de la lecture par molettes |
| `js/map.js` | Carte, position du téléphone, distance et cap |
| `js/place.js` | Commune (geo.api.gouv.fr, Nominatim hors de France), lieux proches (Overpass, OpenStreetMap), altitude du terrain (IGN RGE ALTI, Copernicus via Open-Meteo hors de France) et dénivelé |
| `js/compass.js` | Bandeau boussole (capteurs d'orientation, déclinaison magnétique approchée) |
| `js/go.js` | AirOps et Itinéraire : contrôle du point (France métropolitaine, ordre lat / lon) et liens (sans DOM, testé sous Node) |
| `js/profile.js` | Relief du suivi : échantillons le long du parcours, dénivelés, profil en SVG (sans DOM, testé sous Node) |
| `js/share.js`, `js/history.js`, `js/util.js` | Partage et QR, historique, outils communs |
| `sw.js` | Service worker : appli hors ligne, moteur de lecture et tuiles en cache |
| `test/` | Tests Node (`node --test`), dont une vraie photo d'écran Garmin en niveaux de gris |
| `eslint.config.js`, `.prettierrc.json`, `.editorconfig` | Règles de qualité et de mise en forme |
| `vendor/` | Leaflet 1.9.4, qrcode-generator 1.4.4, tesseract.js 5.1.1 (bibliothèque, worker, moteur WebAssembly et langue), polices (licence OFL) |

Le moteur WebAssembly de Tesseract (`vendor/tesseract/core`, tesseract.js-core 5.1.1) et la langue (`vendor/tesseract/lang`, @tesseract.js-data/eng 1.0.0, modèle `4.0.0_best_int`) sont hébergés avec l'appli : aucun code ni donnée ne vient d'un autre site. Ces 7 Mo ne sont téléchargés qu'au premier usage ou par le bouton « Préparer la lecture de photo sans réseau », puis gardés par le service worker d'une version de l'appli à l'autre.

## Développer

### Lancer l'appli en local

Les modules ES et le service worker ne fonctionnent pas en ouvrant `index.html` directement (`file://`) : il faut un serveur HTTP, par exemple :

```
python3 -m http.server 8000
```

puis http://localhost:8000. Le service worker garde les fichiers en cache : en cas de doute après une modification, recharger deux fois ou cocher « Bypass for network » (outils de développement › Application › Service workers). La boussole, la géolocalisation et l'appareil photo demandent un téléphone ; ils marchent sur `localhost` ou en HTTPS uniquement.

### Chemin des données

```
Saisie / collage ──────────────────────────────────────────────────────┐
                                                                       ▼
Photo ─► auto.js : 1. redressement  warp.findQuad (bords de l'écran) ─► ocr.applyQuad ; skew.skewAngle ─► ocr.setAngle
                   2. contraste     enhance.autoParams (plage de gris, flou)
                   3. zone          ocr.recognizeFull (Tesseract, toute la photo) ─► zone.coordZone ─► ocr.setSel
                   4. lecture       ocr.readBox : jusqu'à 8 lectures du cadre ─► parse() sur chacune ─► vote (votes, firm)
                   5. confiance     trust.confidence (concordance, confiance du moteur, avertissements)
                                                                       │
                                                                       ▼
              parser.parse(texte) : normalize ─► tokenize ─► fenêtres ─► lectures notées (SCORE, PEN)
                               │                                        ─► meilleur candidat + autres lectures
                               ▼
              app.js render() ─► trust.trusted ? ─► state.current ─► map.js (carte, distance, suivi), place.js,
                               │   non : rien n'est partagé           compass.js, share.js, history.js, track.js
                               ▲
              fix.js (molettes) : texte corrigé ─► parse() à nouveau, point vérifié à la main
```

- `js/parser.js` est le cœur : son en-tête décrit l'algorithme, le barème des candidats (`SCORE`, `PEN`) et les structures de données (`Candidate`, `ParseResult`).
- Un résultat de `parse()` porte en plus `trust` ({ pct, level, why }, calculé par `auto.js` après une photo, par `app.js` pour un texte saisi), `ocr` (vient d'une photo) et `verified` (vérifié à la main). `trust.trusted()` décide de ce qui peut être transmis.
- `state` (`js/util.js`) est le seul état partagé : point affiché et position du téléphone. Après un changement, `updateMap()` met à jour la carte, le dénivelé et la boussole.
- Les bibliothèques de `vendor/` (Leaflet, qrcode, Tesseract) sont chargées en scripts classiques et utilisées comme variables globales (`L`, `qrcode`, `Tesseract`).

### Qualité du code

```
npm install          # une fois : ESLint et Prettier (outils de développement seulement, Node 20.19 ou plus)
npm run lint         # règles ESLint
npm run format       # mise en forme Prettier (format:check pour vérifier sans modifier)
npm run check        # tout ce que vérifie la CI : lint, mise en forme, tests
```

La CI refuse un push qui ne passe pas le lint ou la mise en forme. Le site lui-même n'a aucune dépendance ni étape de build.

Conventions, vérifiées par ESLint : `const` / `let` (jamais `var`), fonctions fléchées pour les rappels, `===`, pas d'import en double. Tout texte venu de l'extérieur (lecture, fichier GPX, lien, réponse d'un service) passe par `esc()` avant d'entrer dans du HTML ; la page n'accepte ni script ni style en ligne (Content-Security-Policy de `index.html`). Dependabot propose chaque mois les mises à jour des outils et des actions de la CI.

## Tests

```
npm test
```

Les tests n'ont besoin d'aucune dépendance. Ils tournent aussi à chaque push et à chaque pull request (GitHub Actions). Tout nouveau piège de lecture rencontré sur le terrain doit devenir un cas dans `test/parser.test.js`. Le barème du parser a été réglé sur ces cas : après toute modification d'un poids, relancer les tests.

## Mise en ligne

Après une modification des fichiers de l'appli, changer la version `V` en tête de `sw.js` (et la liste `SHELL` si un fichier est ajouté) pour que les téléphones récupèrent la nouvelle version, et la même version dans `VERSION` de `js/util.js` (affichée dans le bandeau). Les tests vérifient que les deux concordent, que chaque module de `js/` et chaque fichier appelé par `index.html` est dans `SHELL`, et que chaque fichier de `SHELL` existe.

## Licence

Code de l'appli sous licence MIT (fichier `LICENSE`). Les bibliothèques et polices de `vendor/` gardent leurs propres licences : Leaflet (BSD 2 clauses) et Tesseract (Apache 2.0) dans leurs dossiers, qrcode-generator (MIT) en tête de son fichier, polices sous SIL OFL 1.1.
