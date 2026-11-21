# GPS ESAM

Convertisseur de coordonnées GPS de l'Équipe de Secours Animalier en Montagne (ESAM).

**Appli en ligne : https://julok35.github.io/esam-gps/** (à ouvrir sur le téléphone, puis « Ajouter à l'écran d'accueil » pour l'installer).

- Photo de l'écran (Garmin, téléphone) ou capture d'écran : tout s'enchaîne seul, étape par étape, chacune affichée avec ce qu'elle a fait en mots simples et reprenable à la main : redressement (perspective d'après les bords de l'écran, inclinaison du texte), contraste et netteté, zone des coordonnées trouvée par une première lecture de toute la photo, lecture du texte sur le téléphone (Tesseract.js, plusieurs lectures et vote), note de confiance (une seule, avec sa raison et la conduite à tenir). Une lecture fiable se replie en une ligne (« Photo lue · fiable ») : « Détail » montre les étapes, leurs mesures techniques et la partie de la photo lue. En cours, douteuse, sans point ou arrêtée, la lecture garde ses étapes visibles, la reprise proposée d'abord à l'étape en doute
- Lot de photos : plusieurs photos choisies d'un coup, triées par date de prise de vue (EXIF, sinon date du fichier), réordonnables au doigt par leur poignée, ou au clavier avec les flèches (la date suit), lues en parallèle par plusieurs moteurs ; les points sûrs rejoignent le suivi datés de la photo, les autres portent un bouton « Vérifier » qui les ouvre pour être reprises à la main. Une fois le lot lu, la carte se centre sur les points lus (plusieurs), ou sur le point lu et votre position (un seul) ; le bouton « Les deux » montre toujours votre position et l'ensemble des points (point affiché, lot lu, suivi)
- Un point douteux (lectures discordantes, moteur hésitant, avertissement) n'est jamais transmis : copie, partage, drone, autres formats et suivi restent fermés tant qu'il n'est pas corrigé ou confirmé. Un seul bloc d'alerte dit ce qui cloche, ce qui est bloqué et quoi faire, avec la preuve à comparer : la zone lue de la photo et, juste dessous, la lecture en grand au format de l'écran GPS (« N 45°06.199' »), ligne à ligne ; pour un texte collé ou saisi, la comparaison se fait avec la source, sans recadrage proposé. Un point vérifié à la main garde le rappel discret de l'alerte d'origine, et « Annuler la vérification » le rend de nouveau douteux (il sort alors du suivi). L'état du point (vide, sûr, douteux, vérifié) se lit sur la bordure et l'en-tête de la tuile
- Correction de la lecture chiffre par chiffre, avec des molettes comme un cadenas à code ; reprise de la photo en trois réglages, un à la fois : cadrer (cadre au doigt, zoom au pincement), redresser (réglette d'inclinaison), perspective (quatre coins sur les bords de l'écran), puis « Lire les coordonnées »
- Suivi de plusieurs points : signalements successifs d'un même animal (nommé), distance parcourue, cap, durée et vitesse entre les points, tracé numéroté sur la carte, message de suivi à partager ; le suivi se poursuit plus tard ou sur un autre téléphone par un lien (`#s=...`, qui l'installe à l'ouverture) ou un fichier GPX (export et import, lisible aussi par les applis de carte). La tuile du suivi reste repliée (son résumé donne le nom, le nombre de points et la distance) ; le nom de l'animal s'y saisit, juste avant « Partager le suivi », dans un champ neutre : il n'est pas nécessaire pour lire ou transmettre un point, un rappel s'affiche seulement là où il sert (ajout au suivi, partage du suivi, lien, GPX). À l'ouverture, un suivi déjà enregistré est rappelé en tête de page avec ce nom, à continuer ou à effacer pour repartir de zéro ; tant que la question attend, elle est aussi posée sous le point affiché
- Détection automatique du format : DD, DMM, DMS, NMEA, UTM, liens Google Maps
- Sortie en degrés décimaux pour la RC Plus du M30T, saisie DJI Pilot 2 : longitude, latitude (degrés, minutes) et altitude ASL dans l'ordre de l'écran « Modifier les repères », chiffres noir sur blanc quel que soit le thème, animal et heure du point rappelés en tête ; sans altitude connue, la tuile dit où la lire
- Un toucher copie une valeur (coordonnées, Pilot 2, autres formats) : « Copié » s'affiche en pastille sur le bord du bouton, la valeur reste lisible et rien ne bouge
- Texte tapé : pas d'état d'erreur pendant la frappe, seulement après une courte pause ou le champ quitté
- Carte (Plan IGN, topo, photo aérienne) avec la position du téléphone, distance, cap et dénivelé
- Lieu du point : commune, altitude du terrain, lieux nommés à moins de 2 km (sommet, col, lac, cascade, refuge...), avec du réseau ; sans réseau ou sans réponse, une seule ligne discrète
- Boussole active d'elle-même dans le bandeau du haut : on pointe le téléphone vers l'animal, le repère jaune (gauche / droite selon le cap, haut / bas selon la hauteur du point) entre dans le viseur, « Tournez à gauche / droite » quand il est hors champ
- Écran en tuiles repliables (icône, titre, résumé une fois repliée), dans l'ordre de la mission : lire les coordonnées, point de l'animal, transmettre le point (ouvert d'office dès que le point est sûr), saisie drone, carte, suivi, autres formats, historique, hors ligne. L'état ouvert / replié de chaque tuile est gardé sur le téléphone ; quand l'ordre de la page change l'état par défaut d'une tuile, l'état gardé par une version précédente est oublié pour cette tuile seulement (`tilesFor`, `js/util.js`)
- AirOps sous le point : un toucher copie « lat, lon » et ouvre la carte AirOps centrée ; dans AirOps, loupe, coller, choisir le résultat, puis toucher le repère rouge pour les restrictions de vol (AirOps ne pose pas de repère par lien, d'où la copie). Aide « ? » à côté du bouton ; si la copie est refusée, les coordonnées s'affichent en gros avec un bouton Copier
- Itinéraire : Google Maps en voiture depuis la position du téléphone (l'appli Maps sur Android), ou « Autre appli GPS » par un lien geo: (OsmAnd, Waze...). AirOps et Itinéraire n'apparaissent qu'avec un point ; ils restent grisés, la raison dite une fois, tant que le point est douteux, hors de France métropolitaine (latitude 41 à 51,5, longitude -5,5 à 10) ou semble inversé (l'inversion est alors proposée)
- Transmettre le point : partage natif, WhatsApp, QR code (appli, Google Maps, autre appli GPS par un lien geo:), copie du message, ouverture dans cartes.gouv.fr ou Google Maps ; une fois le point parti, la tuile le dit (« Point partagé », « Message copié », avec l'heure) jusqu'au point suivant
- Autres formats (DD, DMM, DMS, UTM), chacun copié d'un toucher, avec une aide courte sur ces sigles
- Installable sur l'écran d'accueil, fonctionne hors ligne une fois préparée

## Organisation

Site statique sans build, servi tel quel (GitHub Pages).

| Fichier | Rôle |
| --- | --- |
| `index.html`, `app.css` | Page et styles |
| `js/app.js` | Point d'entrée : résultat, liens, événements |
| `js/parser.js` | Détection et conversion des coordonnées (sans DOM, testé sous Node) |
| `js/pipeline.js` | Chaîne de lecture d'une photo, de la perspective à la confiance : la même pour une photo seule et pour un lot |
| `js/shot.js` | Fiche d'une photo, seule ou d'un lot : date, lecture gardée, état, point retenu, versement au suivi (règles sans DOM testées sous Node) |
| `js/auto.js` | Photo affichée : la lire (`runShot`), l'afficher telle que lue (`openShot`), étapes de la chaîne, reprise à la main de chacune |
| `js/ocr.js` | Photo, zoom, cadre et coins de perspective, lecture Tesseract (pleine photo puis cadre, plusieurs moteurs) et vote entre lectures |
| `js/batch.js` | Lot de photos : la liste (ordre, glisser-déposer, retrait) et une boucle de lecture sur les fonctions d'une photo seule (plusieurs moteurs en parallèle) |
| `js/exif.js` | Date de prise de vue dans les métadonnées JPEG (sans DOM, testé sous Node) |
| `js/skew.js` | Mesure de l'inclinaison du texte (sans DOM, testé sous Node) |
| `js/warp.js` | Perspective : bords de l'écran (Hough), homographie, redressement (sans DOM, testé sous Node) |
| `js/enhance.js` | Contraste, netteté, mesure du flou, fond égalisé (éclairage inégal effacé) et repérage de l'écran lumineux (sans DOM, testé sous Node) |
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
| `e2e/` | Scénario de bout en bout dans un navigateur (Playwright, hors dépôt) : photo seule et lot de photos, étape par étape |
| `eslint.config.js`, `.prettierrc.json`, `.editorconfig` | Règles de qualité et de mise en forme |
| `vendor/` | Leaflet 1.9.4, qrcode-generator 1.4.4, tesseract.js 7.0.0 (bibliothèque, worker, moteur WebAssembly et langue), polices (licence OFL) |

Le moteur WebAssembly de Tesseract (`vendor/tesseract/core-7`, tesseract.js-core 7.0.0) et la langue (`vendor/tesseract/lang`, @tesseract.js-data/eng 1.0.0, modèle `4.0.0_best_int`) sont hébergés avec l'appli : aucun code ni donnée ne vient d'un autre site. Ces 7 Mo ne sont téléchargés qu'au premier usage ou par le bouton « Préparer la lecture de photo sans réseau », puis gardés par le service worker d'une version de l'appli à l'autre. Pour changer de version de Tesseract : remplacer les fichiers, renommer le dossier du moteur (`core-7`) dans `js/ocr.js` et `sw.js`, puis vérifier les lectures sur de vraies photos.

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
Photo(s) ─► pipeline.js, la même chaîne pour une photo seule (auto.js l'affiche étape par étape) et pour un lot (batch.js) :
                   1. redressement  warp.findQuad (bords de l'écran) ─► ocr.warpCanvas ; skew.skewAngle ─► ocr.rotateCanvas
                   2. contraste     enhance.autoParams (plage de gris, flou)
                   3. zone          ocr.findZone : vues successives de la photo (entière, fond égalisé, écran recadré)
                                    lues par Tesseract ─► zone.coordZone ; zone mal lue : cadre élargi aux lignes voisines
                   4. lecture       ocr.readFound : jusqu'à 11 lectures du cadre (dont 3 au fond égalisé) ─► parse() sur
                                    chacune ─► vote (votes, firm) ; sans accord net : second essai, cadre élargi
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
- Une photo, seule ou dans un lot, a une fiche (`js/shot.js`) et passe par les mêmes fonctions à chaque étape : `newShot` (date : EXIF, sinon fichier), `readShot` (chaîne de `pipeline.js`), `auto.openShot` (photo affichée telle que lue), `app.showShot` (point de l'animal, ou `clearPoint` si rien n'est lu), `fixShot` (correction, confirmation), `sendShot` (suivi). Le lot n'ajoute qu'une liste et une boucle. Toute évolution d'une étape se fait dans sa fonction, jamais dans un seul des deux parcours.
- Le point affiché est effacé dès qu'une lecture commence et chaque fois qu'elle ne donne rien : le point d'une photo précédente ne reste jamais à l'écran.
- Au suivi, le point d'une photo porte la clé de sa photo (`track.placePoint`) : une correction le remplace sur place, une relecture ne le double pas. Sans clé (texte saisi), un même signalement (moins de 3 m, même minute) n'est pas ajouté deux fois. Tant que la question du démarrage (continuer le suivi déjà sur le téléphone ou repartir de zéro) attend sa réponse, rien n'entre au suivi : les points sûrs lus entre-temps y sont versés une fois la réponse donnée.
- Chaque étape de la chaîne rend deux textes : `msg`, en mots du terrain (ce qui a été fait, ce qu'il reste à faire), et `det`, ses mesures techniques, montrées seulement sous « Détail ». La note de confiance est la seule valeur en pourcentage à l'écran ; `trust.why` en donne les raisons en clair, la plus grave d'abord.
- Un résultat de `parse()` porte en plus `trust` ({ pct, level, why }, calculé par `auto.js` après une photo, par `app.js` pour un texte saisi), `ocr` (vient d'une photo), `verified` (vérifié à la main) et `byHand` (`'fix'` : corrigé aux molettes, `'confirm'` : confirmé). `trust.trusted()` décide de ce qui peut être transmis. La confirmation marque une copie de la lecture : la lecture d'origine reste douteuse, ce qui permet d'annuler la vérification.
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

### Scénario de bout en bout

```
npm run e2e                    # option : -- --shots dossier, pour garder des captures au format téléphone
```

`e2e/parcours.js` ouvre l'appli dans Chromium et vérifie que la même photo, lue seule puis dans un lot, donne la même chose (point, étapes, zone lue, date, suivi), et que les règles de sécurité tiennent dans les deux parcours : aucun point affiché pendant une lecture ni après une photo sans coordonnées, lecture fiable repliée en une ligne avec « Point de l'animal » à l'écran, lecture douteuse dépliée et jamais transmise (preuve affichée dans le bloc de retenue, vérification annulable), correction faite sur place au suivi, relance sans doublon ; pour un texte tapé : pas d'erreur pendant la frappe, ni AirOps ni Itinéraire sans point, valeur copiée toujours lisible ; et que la page tient son ordre : « Transmettre le point » ouvert juste après un point sûr, à moins d'un écran de défilement, rien de rouge à l'ouverture, titres et zones annoncées. Playwright n'est pas une dépendance du dépôt (`npm i -g playwright`) : le scénario n'est pas lancé par la CI, il est à rejouer à la main après toute modification de `js/shot.js`, `js/auto.js`, `js/batch.js`, `js/app.js` ou `js/track.js`.

## Mise en ligne

Après une modification des fichiers de l'appli, changer la version `V` en tête de `sw.js` (et la liste `SHELL` si un fichier est ajouté) pour que les téléphones récupèrent la nouvelle version, et la même version dans `VERSION` de `js/util.js` (affichée dans le bandeau). Les tests vérifient que les deux concordent, que chaque module de `js/` et chaque fichier appelé par `index.html` est dans `SHELL`, et que chaque fichier de `SHELL` existe.

## Licence

Code de l'appli sous licence MIT (fichier `LICENSE`). Les bibliothèques et polices de `vendor/` gardent leurs propres licences : Leaflet (BSD 2 clauses) et Tesseract (Apache 2.0) dans leurs dossiers, qrcode-generator (MIT) en tête de son fichier, polices sous SIL OFL 1.1.
