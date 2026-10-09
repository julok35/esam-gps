(function () {
  'use strict';
  var TESS = {
    lib: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
    worker: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
    core: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
    lang: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int'
  };
  var EX = {
    garmin: "Tania\nDistance du trajet: 2.4 km\nSurface: 271.04 m²\nDistance: 0.3 km\nPosition: N 45°16.277'\nE 005°56.052'\nAscension totale: 0 m\nAltitude max.: 0 m",
    dms: "45°16'16.6\"N 5°56'03.1\"E",
    utm: "31T 0730165 5017276",
    ocr: "sition: N 45'16.277\nE OO5o56.O52 |\nAscension totale: Omg"
  };
  var $ = function (id) { return document.getElementById(id); };
  var src = $('src'), out = $('result');
  var current = null, chosen = 0, lastParse = null, histTimer = null, me = null, qrMode = 'app';

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function f6(v) { return v.toFixed(6); }
  var FMT = { DD: 'Degrés décimaux', DMM: 'Degrés minutes décimales', DMS: 'Degrés minutes secondes', NMEA: 'NMEA (degrés-minutes collés)' };
  function fmtName(f) { return FMT[f] || (f.indexOf('UTM') === 0 ? 'UTM zone ' + f.slice(4) : f); }
  function fmtDist(d) { return d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(d < 10000 ? 2 : 1).replace('.', ',') + ' km'; }
  var CARD = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];

  // ---------- Copie ----------
  function flash(btn, txt) { var t = btn.textContent; btn.classList.add('done'); btn.textContent = txt || 'Copié'; setTimeout(function () { btn.classList.remove('done'); btn.textContent = t; }, 1400); }
  function copy(text, btn) {
    var ok = function () { flash(btn); };
    try { navigator.clipboard.writeText(text).then(ok, function () { fallback(text); ok(); }); } catch (e) { fallback(text); ok(); }
  }
  function fallback(text) {
    var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta);
  }

  // ---------- Résultat ----------
  function render() {
    var r = lastParse;
    if (!r || !r.ok) {
      current = null;
      out.className = 'result empty';
      out.innerHTML = r && r.empty
        ? '<div class="status"><span class="pill none">En attente</span></div><p style="margin:0">Photographiez l\'écran ou collez le texte reçu. Le format est détecté automatiquement.</p>'
        : '<div class="status"><span class="pill check">Aucune coordonnée trouvée</span></div><p style="margin:0">Vérifiez que le texte contient la position (latitude puis longitude). Si la lecture a mélangé les lignes, corrigez le texte ou recadrez la photo sur la ligne « Position ».</p>';
      $('eqCard').hidden = true; $('shareCard').hidden = true;
      updateMap(); return;
    }
    var all = [r.best].concat(r.alts), c = all[Math.min(chosen, all.length - 1)];
    current = c;
    var warn = c.notes.length || r.alts.length;
    var h = '<div class="status"><span class="pill ' + (warn ? 'check">À vérifier' : 'ok">Lecture fiable') + '</span><span class="pill fmt">' + esc(fmtName(c.fmt)) + '</span></div>';
    h += '<div class="seg">Lu dans le texte : <b>' + esc(c.seg) + '</b></div>';
    h += '<div class="coords">'
      + '<div class="coord"><div><div class="k">Latitude</div><div class="v">' + f6(c.lat) + '</div></div><button class="btn sec" type="button" data-copy="' + f6(c.lat) + '">Copier</button></div>'
      + '<div class="coord"><div><div class="k">Longitude</div><div class="v">' + f6(c.lon) + '</div></div><button class="btn sec" type="button" data-copy="' + f6(c.lon) + '">Copier</button></div>'
      + '</div>';
    h += '<button class="btn wide" type="button" data-copy="' + f6(c.lat) + ', ' + f6(c.lon) + '">Copier latitude, longitude</button>';
    var notes = c.notes.slice();
    if (r.alts.length) notes.push({ t: 'Le texte peut se lire de plusieurs façons : comparez avec la photo.' });
    if (notes.length) h += '<ul class="notes">' + notes.map(function (n) { return '<li>' + esc(n.t) + '</li>'; }).join('') + '</ul>';
    if (r.alts.length) {
      h += '<div class="alts"><span class="lbl" style="margin:0">Autres lectures possibles</span>';
      all.forEach(function (a, i) { if (a !== c) h += '<button type="button" data-alt="' + i + '">' + f6(a.lat) + ', ' + f6(a.lon) + ' <small>(' + esc(fmtName(a.fmt)) + ' : ' + esc(a.seg) + ')</small></button>'; });
      h += '</div>';
    }
    out.className = 'result'; out.innerHTML = h;

    $('eq').innerHTML =
      '<tr><th>DMM</th><td>' + esc(Geo.toDMM(c.lat, true)) + '&nbsp;&nbsp;' + esc(Geo.toDMM(c.lon, false)) + '</td></tr>' +
      '<tr><th>DMS</th><td>' + esc(Geo.toDMS(c.lat, true)) + '&nbsp;&nbsp;' + esc(Geo.toDMS(c.lon, false)) + '</td></tr>' +
      '<tr><th>UTM</th><td>' + esc(Geo.toUTM(c.lat, c.lon)) + '</td></tr>';
    var la = f6(c.lat), lo = f6(c.lon);
    $('links').innerHTML =
      '<a target="_blank" rel="noopener" data-airops="' + la + ', ' + lo + '" href="https://airops-supuav.fr/map/#15/' + la + '/' + lo + '">AirOps</a>' +
      '<a target="_blank" rel="noopener" href="https://cartes.gouv.fr/explorer-les-cartes/?c=' + lo + ',' + la + '&z=16&permalink=yes">cartes.gouv.fr</a>' +
      '<a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + la + ',' + lo + '">Google Maps</a>' +
      '<a target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' + la + ',' + lo + '">Itinéraire</a>';
    $('eqCard').hidden = false; $('shareCard').hidden = false;
    if (!$('qrBox').hidden) drawQR();
    updateMap(true);
    clearTimeout(histTimer); histTimer = setTimeout(function () { saveHist(c); }, 1500);
    try { history.replaceState(null, '', '#' + la + ',' + lo); } catch (e) {}
  }
  function update() { chosen = 0; lastParse = Geo.parse(src.value); render(); }

  // ---------- Carte ----------
  var map = null, tMark = null, meMark = null, meCirc = null, line = null, firstFix = true;
  function wmts(layer, fmt) {
    return 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=' + layer + '&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=' + fmt;
  }
  function initMap() {
    if (typeof L === 'undefined') { $('map').innerHTML = '<p class="hint" style="padding:12px">Carte indisponible (pas de réseau au premier lancement).</p>'; return; }
    var ign = L.tileLayer(wmts('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png'), { maxZoom: 19, maxNativeZoom: 19, attribution: 'IGN Géoplateforme' });
    var topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { subdomains: 'abc', maxZoom: 19, maxNativeZoom: 17, attribution: 'OpenTopoMap, OpenStreetMap' });
    var ortho = L.tileLayer(wmts('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'), { maxZoom: 19, maxNativeZoom: 19, attribution: 'IGN Géoplateforme' });
    var osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: 'OpenStreetMap' });
    map = L.map('map', { layers: [ign], zoomControl: true }).setView([45.2, 6.2], 8);
    L.control.layers({ 'Plan IGN': ign, 'Topo (courbes)': topo, 'Photo aérienne': ortho, 'OSM': osm }, null, { position: 'topright' }).addTo(map);
    L.control.scale({ imperial: false }).addTo(map);
    tMark = L.marker([0, 0], { icon: L.divIcon({ className: '', html: '<div class="pin-t"></div>', iconSize: [28, 28], iconAnchor: [3, 31] }) });
    meMark = L.marker([0, 0], { icon: L.divIcon({ className: '', html: '<div class="pin-me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false });
    meCirc = L.circle([0, 0], { radius: 1, color: '#1E6FD9', weight: 1, fillOpacity: .12, interactive: false });
    line = L.polyline([], { color: '#E6332A', weight: 3, dashArray: '8 8', interactive: false });
  }
  function updateMap(recentre) {
    if (map) {
      if (current) {
        tMark.setLatLng([current.lat, current.lon]).addTo(map);
        tMark.bindPopup('<b>' + f6(current.lat) + ', ' + f6(current.lon) + '</b>');
      } else map.removeLayer(tMark);
      if (me) { meMark.setLatLng([me.lat, me.lon]).addTo(map); meCirc.setLatLng([me.lat, me.lon]).setRadius(me.acc).addTo(map); }
      if (me && current) line.setLatLngs([[me.lat, me.lon], [current.lat, current.lon]]).addTo(map); else map.removeLayer(line);
      if (recentre) fit();
    }
    if (me && current) {
      var d = Geo.distM(me, current), b = Geo.bearing(me, current);
      $('dD').textContent = fmtDist(d); $('dB').textContent = Math.round(b) + '° ' + CARD[Math.round(b / 22.5) % 16];
    } else { $('dD').textContent = '-'; $('dB').textContent = '-'; }
    $('dA').textContent = me ? '± ' + Math.round(me.acc) + ' m' : '-';
  }
  function fit() {
    if (!map) return;
    if (me && current) map.fitBounds(L.latLngBounds([[me.lat, me.lon], [current.lat, current.lon]]), { padding: [40, 40], maxZoom: 16 });
    else if (current) map.setView([current.lat, current.lon], 15);
    else if (me) map.setView([me.lat, me.lon], 14);
  }
  function startGeo() {
    if (!('geolocation' in navigator)) { $('geoMsg').textContent = 'Localisation non disponible sur cet appareil.'; return; }
    navigator.geolocation.watchPosition(function (p) {
      me = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy };
      $('geoMsg').textContent = 'Position du téléphone : ' + f6(me.lat) + ', ' + f6(me.lon);
      updateMap(firstFix); firstFix = false;
    }, function (e) {
      $('geoMsg').textContent = e.code === 1 ? 'Localisation refusée : autorisez-la dans les réglages du navigateur pour voir votre position.' : 'Position du téléphone indisponible pour l\'instant.';
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  }

  // ---------- Partage et QR ----------
  function appUrl(c) { return location.origin + location.pathname + '#' + f6(c.lat) + ',' + f6(c.lon); }
  function mapsUrl(c) { return 'https://www.google.com/maps/search/?api=1&query=' + f6(c.lat) + ',' + f6(c.lon); }
  function message(c) {
    return 'Point ESAM\n' + f6(c.lat) + ', ' + f6(c.lon) + '\nDMM : ' + Geo.toDMM(c.lat, true) + ' ' + Geo.toDMM(c.lon, false)
      + '\nCarte : ' + mapsUrl(c) + '\nAppli GPS ESAM : ' + appUrl(c);
  }
  function drawQR() {
    if (!current) return;
    var data = qrMode === 'app' ? appUrl(current) : qrMode === 'maps' ? mapsUrl(current) : 'geo:' + f6(current.lat) + ',' + f6(current.lon);
    if (typeof qrcode === 'undefined') { $('qrImg').innerHTML = '<p class="hint">QR indisponible (bibliothèque non chargée).</p>'; return; }
    var q = qrcode(0, 'M'); q.addData(data); q.make();
    $('qrImg').innerHTML = '<img alt="QR code du point" src="' + q.createDataURL(8, 0) + '">';
    $('qrTxt').textContent = (qrMode === 'app' ? 'Ouvre cette appli sur le point. ' : qrMode === 'maps' ? 'Ouvre Google Maps sur le point. ' : 'Lien geo: ouvre l\'appli de carte sur Android. ') + data;
  }
  $('qrBtn').addEventListener('click', function () { $('qrBox').hidden = !$('qrBox').hidden; if (!$('qrBox').hidden) drawQR(); });
  document.querySelectorAll('[data-qr]').forEach(function (b) {
    b.addEventListener('click', function () {
      qrMode = b.dataset.qr; document.querySelectorAll('[data-qr]').forEach(function (x) { x.classList.toggle('on', x === b); }); drawQR();
    });
  });
  $('shareBtn').addEventListener('click', function () {
    if (!current) return;
    var text = message(current);
    if (navigator.share) {
      navigator.share({ title: 'Point ESAM', text: text }).catch(function (e) { if (e && e.name !== 'AbortError') copy(text, $('shareBtn')); });
    } else copy(text, $('shareBtn'));
  });
  $('copyMsg').addEventListener('click', function () { if (current) copy(message(current), $('copyMsg')); });

  // ---------- Historique ----------
  function loadHist() { try { return JSON.parse(localStorage.getItem('esam-gps-hist') || '[]'); } catch (e) { return []; } }
  function saveHist(c) {
    var h = loadHist(), key = f6(c.lat) + ', ' + f6(c.lon);
    h = h.filter(function (x) { return x.k !== key; });
    h.unshift({ k: key, src: src.value.slice(0, 400), t: Date.now() });
    try { localStorage.setItem('esam-gps-hist', JSON.stringify(h.slice(0, 10))); } catch (e) {}
    drawHist();
  }
  function drawHist() {
    var h = loadHist();
    $('histCard').hidden = !h.length;
    $('hist').innerHTML = h.map(function (x, i) {
      var d = new Date(x.t);
      var when = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      return '<li><button type="button" data-hist="' + i + '"><span>' + esc(x.k) + '</span><small>' + esc(when) + '</small></button></li>';
    }).join('');
  }

  // ---------- Photo, recadrage, OCR ----------
  var work = null, sel = { x: .1, y: .3, w: .8, h: .4 }, cv = $('cv'), stage = $('stage'), selEl = $('sel');
  function loadFile(file) {
    if (!file) return;
    var done = function (img) {
      var s = Math.min(1, 2400 / Math.max(img.width, img.height));
      work = document.createElement('canvas'); work.width = Math.round(img.width * s); work.height = Math.round(img.height * s);
      work.getContext('2d').drawImage(img, 0, 0, work.width, work.height);
      sel = { x: .15, y: .35, w: .7, h: .35 };
      showWork(); $('cropBox').hidden = false; $('prog').hidden = true;
      $('cropBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    if (window.createImageBitmap) createImageBitmap(file, { imageOrientation: 'from-image' }).then(done, function () { viaImg(file, done); });
    else viaImg(file, done);
  }
  function viaImg(file, cb) { var u = URL.createObjectURL(file), im = new Image(); im.onload = function () { cb(im); URL.revokeObjectURL(u); }; im.src = u; }
  function showWork() {
    var s = Math.min(1, 900 / work.width);
    cv.width = Math.round(work.width * s); cv.height = Math.round(work.height * s);
    cv.getContext('2d').drawImage(work, 0, 0, cv.width, cv.height);
    drawSel();
  }
  function drawSel() { selEl.style.left = sel.x * 100 + '%'; selEl.style.top = sel.y * 100 + '%'; selEl.style.width = sel.w * 100 + '%'; selEl.style.height = sel.h * 100 + '%'; }
  var drag = null;
  stage.addEventListener('pointerdown', function (e) {
    var r = stage.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    var h = e.target.classList.contains('h') ? e.target.className.replace('h ', '') : null;
    drag = { mode: h || 'new', px: px, py: py, s: { x: sel.x, y: sel.y, w: sel.w, h: sel.h } };
    if (drag.mode === 'new') sel = { x: px, y: py, w: 0.01, h: 0.01 };
    stage.setPointerCapture(e.pointerId); e.preventDefault();
  });
  stage.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var r = stage.getBoundingClientRect(), px = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), py = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    var s = drag.s, dx = px - drag.px, dy = py - drag.py, x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h;
    if (drag.mode === 'move') { sel.x = Math.max(0, Math.min(1 - s.w, s.x + dx)); sel.y = Math.max(0, Math.min(1 - s.h, s.y + dy)); }
    else {
      if (drag.mode === 'new') { x0 = drag.px; y0 = drag.py; x1 = px; y1 = py; }
      else {
        if (drag.mode.charAt(1) === 'l') x0 = px; else x1 = px;
        if (drag.mode.charAt(0) === 't') y0 = py; else y1 = py;
      }
      sel = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.max(.03, Math.abs(x1 - x0)), h: Math.max(.03, Math.abs(y1 - y0)) };
    }
    drawSel();
  });
  ['pointerup', 'pointercancel'].forEach(function (ev) { stage.addEventListener(ev, function () { drag = null; }); });
  $('rot').addEventListener('click', function () {
    if (!work) return;
    var c = document.createElement('canvas'); c.width = work.height; c.height = work.width;
    var g = c.getContext('2d'); g.translate(c.width, 0); g.rotate(Math.PI / 2); g.drawImage(work, 0, 0); work = c;
    sel = { x: .1, y: .1, w: .8, h: .8 }; showWork();
  });
  $('cropAll').addEventListener('click', function () { sel = { x: 0, y: 0, w: 1, h: 1 }; drawSel(); });
  $('cropClose').addEventListener('click', function () { $('cropBox').hidden = true; });
  $('cam').addEventListener('change', function (e) { loadFile(e.target.files[0]); e.target.value = ''; });
  $('gal').addEventListener('change', function (e) { loadFile(e.target.files[0]); e.target.value = ''; });

  function prepared() {
    var sx = Math.round(sel.x * work.width), sy = Math.round(sel.y * work.height), sw = Math.max(8, Math.round(sel.w * work.width)), sh = Math.max(8, Math.round(sel.h * work.height));
    var k = Math.max(1, Math.min(3, 1600 / sw));
    var c = document.createElement('canvas'); c.width = Math.round(sw * k); c.height = Math.round(sh * k);
    var g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(work, sx, sy, sw, sh, 0, 0, c.width, c.height);
    var d = g.getImageData(0, 0, c.width, c.height), p = d.data, hist = new Uint32Array(256), n = p.length / 4;
    for (var i = 0; i < p.length; i += 4) { var y = (p[i] * 299 + p[i + 1] * 587 + p[i + 2] * 114) / 1000 | 0; p[i] = y; hist[y]++; }
    var lo = 0, hi = 255, acc = 0;
    for (lo = 0; lo < 255; lo++) { acc += hist[lo]; if (acc > n * 0.02) break; }
    acc = 0; for (hi = 255; hi > 0; hi--) { acc += hist[hi]; if (acc > n * 0.02) break; }
    var span = Math.max(1, hi - lo);
    for (i = 0; i < p.length; i += 4) { var v = Math.max(0, Math.min(255, (p[i] - lo) * 255 / span)); p[i] = p[i + 1] = p[i + 2] = v; }
    g.putImageData(d, 0, 0);
    return c;
  }
  function loadScript(u) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = u; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
  var ocrWorker = null;
  function getWorker(logger) {
    if (ocrWorker) return ocrWorker;
    ocrWorker = (window.Tesseract ? Promise.resolve() : loadScript(TESS.lib)).then(function () {
      return Tesseract.createWorker('eng', 1, { workerPath: TESS.worker, corePath: TESS.core, langPath: TESS.lang, logger: logger });
    });
    ocrWorker.catch(function () { ocrWorker = null; });
    return ocrWorker;
  }
  var progCb = function () {};
  function setProg(t, f) { $('prog').hidden = false; $('progTxt').textContent = t; $('progBar').style.width = Math.round((f || 0) * 100) + '%'; }
  $('ocrGo').addEventListener('click', function () {
    if (!work) return;
    var btn = $('ocrGo'); btn.disabled = true;
    var LBL = { 'loading tesseract core': 'Chargement du moteur', 'initializing tesseract': 'Initialisation', 'loading language traineddata': 'Chargement de la langue', 'initializing api': 'Initialisation', 'recognizing text': 'Lecture du texte' };
    progCb = function (m) { setProg((LBL[m.status] || 'Préparation') + '...', m.progress); };
    setProg('Préparation...', 0);
    var img = prepared();
    var texts = [];
    getWorker(function (m) { progCb(m); }).then(function (w) {
      // deux lectures avec deux découpages différents : si elles concordent, la lecture est solide
      return w.setParameters({ tessedit_pageseg_mode: '6' }).then(function () { return w.recognize(img); }).then(function (r1) {
        texts.push((r1.data.text || '').trim());
        LBL['recognizing text'] = 'Seconde lecture';
        return w.setParameters({ tessedit_pageseg_mode: '11' }).then(function () { return w.recognize(img); });
      }).then(function (r2) { texts.push((r2.data.text || '').trim()); });
    }).then(function () {
      var p1 = Geo.parse(texts[0]), p2 = Geo.parse(texts[1]);
      var pick = p1, other = p2, txt = texts[0];
      if (!p1.ok || (p2.ok && p2.best.score > p1.best.score)) { pick = p2; other = p1; txt = texts[1]; }
      src.value = txt; chosen = 0; lastParse = pick;
      if (pick.ok && other.ok) {
        var gap = Geo.distM(pick.best, other.best);
        if (gap > 20) {
          other.best.seg = other.best.seg + ' (seconde lecture)';
          pick.alts = [other.best].concat(pick.alts).slice(0, 3);
          pick.best.notes = pick.best.notes.concat([{ lvl: 'warn', t: 'Les deux lectures de la photo diffèrent de ' + fmtDist(gap) + ' : comparez avec la photo.' }]);
        }
      }
      render();
      setProg(pick.ok ? 'Texte lu : vérifiez le résultat ci-dessous' : 'Texte lu mais aucune coordonnée : recadrez sur la ligne Position', 1);
      if (pick.ok) out.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function () {
      setProg('Lecture impossible : vérifiez le réseau au premier usage, ou tapez le texte', 0);
    }).then(function () { btn.disabled = false; });
  });

  // ---------- Hors ligne ----------
  function setNet() { $('net').hidden = navigator.onLine; }
  window.addEventListener('online', setNet); window.addEventListener('offline', setNet); setNet();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  $('prepOff').addEventListener('click', function () {
    var b = $('prepOff'); b.disabled = true; $('prepMsg').textContent = 'Téléchargement du moteur de lecture (environ 7 Mo)...';
    var wasm = typeof WebAssembly === 'object' && WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
    var urls = [TESS.lib, TESS.worker, TESS.core + '/tesseract-core-' + (wasm ? 'simd-' : '') + 'lstm.wasm.js', TESS.lang + '/eng.traineddata.gz'];
    Promise.all(urls.map(function (u) { return fetch(u, { mode: 'cors' }).then(function (r) { if (!r.ok) throw 0; return r.blob(); }); }))
      .then(function () { return getWorker(function () {}); })
      .then(function () { $('prepMsg').textContent = 'Prêt : la lecture de photo fonctionne maintenant sans réseau sur ce téléphone.'; flash(b, 'Prêt'); })
      .catch(function () { $('prepMsg').textContent = 'Échec du téléchargement : réessayez avec du réseau.'; })
      .then(function () { b.disabled = false; });
  });

  // ---------- Événements ----------
  src.addEventListener('input', update);
  $('clear').addEventListener('click', function () { src.value = ''; update(); try { history.replaceState(null, '', location.pathname); } catch (e) {} src.focus(); });
  $('fitBoth').addEventListener('click', fit);
  $('goTarget').addEventListener('click', function () { if (map && current) map.setView([current.lat, current.lon], 16); });
  $('goMe').addEventListener('click', function () { if (map && me) map.setView([me.lat, me.lon], 16); });
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-airops]');
    if (a) {
      // secours : coordonnées dans le presse-papier pour la recherche AirOps
      try { navigator.clipboard.writeText(a.dataset.airops).catch(function () {}); } catch (err) {}
      $('linkMsg').textContent = 'Coordonnées copiées : si AirOps ne se centre pas, collez-les dans sa recherche « Adresse, coordonnées ou zone ».';
      return;
    }
    var t = e.target.closest('button'); if (!t) return;
    if (t.dataset.ex) { src.value = EX[t.dataset.ex]; update(); }
    else if (t.dataset.copy) copy(t.dataset.copy, t);
    else if (t.dataset.alt) { chosen = +t.dataset.alt; render(); }
    else if (t.dataset.hist) { var x = loadHist()[+t.dataset.hist]; if (x) { src.value = x.src; update(); window.scrollTo({ top: 0 }); } }
  });

  // ---------- Démarrage ----------
  initMap();
  drawHist();
  var h = decodeURIComponent((location.hash || '').slice(1));
  if (/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(h)) src.value = h.replace(',', ', ');
  lastParse = Geo.parse(src.value); render();
  clearTimeout(histTimer);
  startGeo();
})();
