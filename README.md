# GPS ESAM

Convertisseur de coordonnées GPS de l'Équipe de Secours Animalier en Montagne (ESAM).

- Photo de l'écran (Garmin, téléphone) et lecture du texte sur le téléphone (Tesseract.js, plusieurs lectures et vote)
- Détection automatique du format : DD, DMM, DMS, NMEA, UTM, liens Google Maps
- Sortie en degrés décimaux pour la RC Plus du M30T, saisie DJI Pilot 2
- Carte (Plan IGN, topo, photo aérienne) avec la position du téléphone, distance et cap
- Partage natif, QR code (appli, Google Maps, geo:)
- Installable sur l'écran d'accueil, fonctionne hors ligne une fois préparée

## Organisation

Site statique sans build, servi tel quel (GitHub Pages).

| Fichier | Rôle |
| --- | --- |
| `index.html`, `app.css` | Page et styles |
| `js/app.js` | Point d'entrée : résultat, liens, événements |
| `js/parser.js` | Détection et conversion des coordonnées (sans DOM, testé sous Node) |
| `js/ocr.js` | Photo, recadrage, lecture Tesseract et vote entre lectures |
| `js/map.js` | Carte, position du téléphone, distance et cap |
| `js/share.js`, `js/history.js`, `js/util.js` | Partage et QR, historique, outils communs |
| `sw.js` | Service worker : appli hors ligne, moteur de lecture et tuiles en cache |
| `vendor/` | Leaflet 1.9.4, qrcode-generator 1.4.4, tesseract.js 5.1.1 (bibliothèque et worker), polices (licence OFL) |

Le moteur WebAssembly de Tesseract et la langue (environ 7 Mo) restent sur jsDelivr, en versions figées, et sont gardés par le service worker après le premier usage ou le bouton « Préparer la lecture de photo sans réseau ».

## Tests

```
npm test
```

Node 18 ou plus, aucune dépendance. Les tests tournent aussi à chaque push (GitHub Actions). Tout nouveau piège de lecture rencontré sur le terrain doit devenir un cas dans `test/parser.test.js`.

## Mise en ligne

Après une modification des fichiers de l'appli, changer la version `V` en tête de `sw.js` (et la liste `SHELL` si un fichier est ajouté) pour que les téléphones récupèrent la nouvelle version.
