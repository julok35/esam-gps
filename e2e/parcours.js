/* Scénario de bout en bout dans un vrai navigateur : la même photo, lue seule puis dans un lot, doit donner la même
   chose à chaque étape (point, étapes, zone lue, date, suivi), et les règles de sécurité tenir dans les deux parcours.
   `npm run e2e` (option : --shots dossier, pour garder des captures au format téléphone).
   Playwright n'est pas une dépendance du dépôt : le scénario se lance là où il est installé (il n'est pas dans la CI).
   Les photos sont dessinées dans la page, sauf la vraie photo d'écran Garmin de test/. */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, writeFileSync, utimesSync, rmSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch (e) {
  console.error(
    'Playwright introuvable : installez-le hors du dépôt (npm i -g playwright), puis relancez npm run e2e.'
  );
  process.exit(1);
}
const at = process.argv.indexOf('--shots'),
  SHOTS = at > 0 ? process.argv[at + 1] : '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// ---------- Le dépôt servi tel quel ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.gz': 'application/gzip'
};
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  readFile(join(ROOT, path || 'index.html')).then(
    (b) => {
      res.writeHead(200, { 'Content-Type': MIME[extname(path || '.html')] || 'application/octet-stream' });
      res.end(b);
    },
    () => {
      res.writeHead(404);
      res.end();
    }
  );
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const URL0 = `http://127.0.0.1:${server.address().port}/index.html`;

// ---------- Photos de test : des fichiers datés, dans un dossier temporaire ----------
const DIR = mkdtempSync(join(tmpdir(), 'esam-e2e-')),
  browser = await chromium.launch(),
  A = ["N 45°06.199'", "E005°54.834'"], // 45.103317, 5.913900
  B = ["N 45°08.500'", "E005°58.100'"], // 45.141667, 5.968333
  C = ["N 45°03.250'", "E005°50.400'"], // 45.054167, 5.840000
  WEST = ["N 45°06.199'", "O 001°54.834'"], // longitude ouest : avertissement, donc lecture douteuse
  NONE = ['Batterie 80 %', 'Menu principal'];
// Écran de GPS dessiné : deux lignes de texte ; avec la photo Garmin, les niveaux de gris bruts de test/
async function images() {
  const page = await browser.newPage(),
    gray = gunzipSync(await readFile(join(ROOT, 'test/garmin-ecran-560x525.gray.gz')));
  const out = await page.evaluate(
    ({ sets, gray }) => {
      const c = document.createElement('canvas'),
        g = c.getContext('2d'),
        res = {};
      for (const [name, lines, type] of sets) {
        c.width = 900;
        c.height = 700;
        g.fillStyle = '#ebebeb';
        g.fillRect(0, 0, 900, 700);
        g.strokeStyle = '#282828';
        g.lineWidth = 6;
        g.strokeRect(20, 20, 860, 660);
        g.fillStyle = '#0f0f0f';
        g.font = 'bold 64px sans-serif';
        g.textBaseline = 'top';
        lines.forEach((l, i) => g.fillText(l, 90, 220 + i * 104));
        res[name] = c.toDataURL(type || 'image/png');
      }
      // la dernière photo dessinée (a3), appareil tenu de côté : un quart de tour à gauche
      const t = document.createElement('canvas'),
        gt = t.getContext('2d');
      t.width = 700;
      t.height = 900;
      gt.translate(0, 900);
      gt.rotate(-Math.PI / 2);
      gt.drawImage(c, 0, 0);
      res.couchee = t.toDataURL('image/png');
      c.width = 560;
      c.height = 525;
      const d = g.createImageData(560, 525);
      for (let i = 0; i < gray.length; i++) {
        d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = gray[i];
        d.data[i * 4 + 3] = 255;
      }
      g.putImageData(d, 0, 0);
      res.garmin = c.toDataURL('image/png');
      return res;
    },
    {
      sets: [
        ['a', A],
        ['a2', A],
        ['b', B],
        ['c', C],
        ['west', WEST],
        ['none', NONE],
        ['none2', NONE],
        ['exif', B, 'image/jpeg'],
        ['a3', A]
      ],
      gray: Array.from(gray)
    }
  );
  await page.close();
  return out;
}
// JPEG : la date EXIF DateTime (IFD0) est insérée après l'en-tête
function withExif(jpg, date) {
  const tiff = Buffer.alloc(26 + 20);
  tiff.write('II*\0', 0, 'latin1');
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0132, 10);
  tiff.writeUInt16LE(2, 12);
  tiff.writeUInt32LE(20, 14);
  tiff.writeUInt32LE(26, 18);
  tiff.write(`${date}\0`, 26, 'latin1');
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]),
    head = Buffer.from([0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 255]);
  return Buffer.concat([jpg.subarray(0, 2), head, app1, jpg.subarray(2)]);
}
const IMG = {};
{
  const urls = await images(),
    // dates des fichiers (heure locale) ; la photo « exif » a été prise le 02/11 à 17:45, son fichier date du 05/11
    when = {
      a: '08:00',
      a2: '08:05',
      b: '09:00',
      west: '09:30',
      none: '10:00',
      none2: '10:10',
      c: '07:00',
      garmin: '06:00',
      couchee: '09:40',
      a3: '08:10'
    };
  for (const [name, url] of Object.entries(urls)) {
    let buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    if (name === 'exif') buf = withExif(buf, '2026:11:02 17:45:00');
    IMG[name] = join(DIR, `${name}.${name === 'exif' ? 'jpg' : 'png'}`);
    writeFileSync(IMG[name], buf);
    const d = name === 'exif' ? new Date(2026, 10, 5, 12, 0) : new Date(`2026-11-01T${when[name]}:00`);
    utimesSync(IMG[name], d, d);
  }
  IMG.bad = join(DIR, 'abimee.jpg');
  writeFileSync(IMG.bad, Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
}

// ---------- Outils ----------
// Appli ouverte sur un téléphone neuf (stockage vide), sans réseau extérieur
async function open(geo) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    serviceWorkers: 'block',
    ...(geo ? { geolocation: geo, permissions: ['geolocation'] } : {})
  });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => failures.push(`erreur dans la page : ${e.message}`));
  await page.route(
    (u) => !u.href.startsWith('http://127.0.0.1'),
    (r) => r.abort()
  );
  await page.goto(URL0);
  await page.waitForSelector('#ver:not(:empty)');
  page.close0 = () => ctx.close();
  return page;
}
const tap = (page, sel) => page.$eval(sel, (e) => e.click());
const pause = (page, ms) => page.waitForTimeout(ms || 400);
// Fin de lecture d'une photo seule : un point, ou « Aucun point » (plus « Lecture en cours »)
async function readOne(page, name, input) {
  await page.setInputFiles(input || '#gal', IMG[name]);
  await page.waitForFunction(() => /Lecture en cours/.test(document.getElementById('result').textContent));
  await page.waitForFunction(() => !/Lecture en cours/.test(document.getElementById('result').textContent), null, {
    timeout: 120000
  });
  await pause(page);
}
async function addLot(page, names) {
  const before = await page.$$eval('#batchList li', (l) => l.length);
  await page.setInputFiles(
    '#gal',
    names.map((n) => IMG[n])
  );
  await page.waitForFunction((n) => document.querySelectorAll('#batchList li').length >= n, before + names.length);
  await pause(page, 600); // vignettes
}
async function readLot(page, names) {
  if (names) await addLot(page, names);
  await tap(page, '#batchGo');
  await page.waitForFunction(() => document.getElementById('batchGo').textContent === 'Arrêter');
  await page.waitForFunction(() => document.getElementById('batchGo').textContent === 'Lire tout', null, {
    timeout: 300000
  });
  await pause(page, 800);
}
// Ligne du lot dont le texte contient part : son numéro (à partir de 1)
const rowOf = (page, part) =>
  page.evaluate(
    (p) => [...document.querySelectorAll('#batchList li')].findIndex((l) => l.textContent.includes(p)) + 1,
    part
  );
async function openRow(page, part) {
  const n = await rowOf(page, part);
  assert.ok(n, `ligne « ${part} » absente du lot`);
  await tap(page, `#batchList li:nth-child(${n}) .bb`);
  await pause(page, 900);
}
// Molettes : dernier chiffre de la latitude + 1, puis Valider (45°06.199' devient 45°06.190' : 45.103167)
async function fixLat(page) {
  await tap(page, '#result button[data-fix]');
  await page.locator('#fixRows .fix-row').first().locator('.wh').last().focus();
  await page.keyboard.press('ArrowUp');
  await tap(page, '#fixOk');
  await pause(page);
}
// Ce que l'écran dit du point affiché, de la photo ouverte, du lot, du suivi et de l'historique
const view = (page) =>
  page.evaluate(() => {
    const txt = (e) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : ''),
      $ = (id) => document.getElementById(id),
      shownEl = (id) => !$(id).hidden && $(id).getClientRects().length > 0,
      big = document.querySelector('#result .big1'),
      zone = $('zoneCv');
    let sig = 0;
    if (shownEl('zoneView')) for (const ch of zone.toDataURL()) sig = (sig * 31 + ch.charCodeAt(0)) | 0;
    return {
      point: big ? big.firstChild.textContent : '',
      copy: !!document.querySelector('#result button.big1[data-copy]'),
      pills: [...document.querySelectorAll('#result .status .pill')].map(txt),
      lines: [...document.querySelectorAll('#result .seg1')].map(txt),
      result: txt($('result')),
      track: txt($('trk')),
      steps: $('steps').hidden ? [] : [...document.querySelectorAll('#steps li .st-t')].map(txt),
      zone: shownEl('zoneView') ? `${zone.width}x${zone.height}:${sig}` : '',
      pilot: shownEl('pilotCard'),
      share: shownEl('shareCard'),
      hash: location.hash,
      rows: [...document.querySelectorAll('#batchList li')].map(
        (l) => `${l.className.replace('bp ', '')} | ${txt(l.querySelector('.bb'))}`
      ),
      msg: $('batchMsg').hidden ? '' : txt($('batchMsg')),
      points: [...document.querySelectorAll('#trackList li')].map(
        (l) => `${txt(l.querySelector('.tp-c'))} @ ${l.querySelector('input[type=datetime-local]').value.slice(5)}`
      ),
      hist: [...document.querySelectorAll('#hist li span')].map(txt),
      photoMsg: $('photoMsg').hidden ? '' : txt($('photoMsg')),
      top: Math.round($('resCard').getBoundingClientRect().top)
    };
  });
// Rien de transmissible à l'écran : ni copie, ni drone, ni partage, ni lien
function nothingToSend(v, what) {
  assert.equal(v.point, '', `${what} : aucun point affiché`);
  assert.ok(!v.copy && !v.pilot && !v.share && v.hash === '', `${what} : rien de transmissible`);
}
const failures = [];
let shotNo = 0;
async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${String(++shotNo).padStart(2, '0')}-${name}.png`) });
}
async function scene(title, fn) {
  const pages = [],
    op = async (geo) => {
      const p = await open(geo);
      pages.push(p);
      return p;
    };
  try {
    await fn(op);
    console.log(`ok   ${title}`);
  } catch (e) {
    failures.push(`${title}\n     ${String(e.message).split('\n').slice(0, 6).join('\n     ')}`);
    console.log(`ÉCHEC ${title}`);
  }
  for (const p of pages) await p.close0();
}
const PA = '45.103317, 5.913900',
  PA_FIXED = '45.103167, 5.913900',
  PB = '45.141667, 5.968333',
  PC = '45.054167, 5.840000';

// ---------- Scénarios ----------
for (const [name, point] of [
  ['a', PA],
  ['garmin', '45.271283, 5.934200']
])
  await scene(`équivalence : la photo « ${name} » lue seule et dans un lot donne la même chose`, async (op) => {
    const one = await op();
    await readOne(one, name);
    await pause(one, 1700); // l'historique attend que le point reste affiché 1,5 s
    const s = await view(one);
    await shot(one, `seule-${name}`);
    const lot = await op();
    await readLot(lot, [name, 'b']);
    await openRow(lot, point);
    const l = await view(lot);
    await shot(lot, `lot-${name}`);
    assert.equal(s.point, point);
    for (const k of ['point', 'copy', 'pills', 'lines', 'steps', 'zone', 'pilot', 'share', 'hash', 'track'])
      assert.deepEqual(l[k], s[k], `« ${k} » diffère entre la photo seule et le lot`);
    assert.ok(s.zone, 'zone lue affichée');
    assert.match(s.lines.join(' '), /Photo du 01\/11 0[68]:00 \(date du fichier\)/);
    // même point du suivi, à la même date ; au même endroit de l'écran en fin de lecture
    assert.deepEqual(s.points, [`${point} @ 11-01T${name === 'a' ? '08' : '06'}:00`]);
    assert.ok(l.points.includes(s.points[0]));
    assert.ok(s.top < 300 && s.top > -50, `photo seule : l'écran est au point (${s.top})`);
    assert.deepEqual(s.hist, [point]);
  });

await scene('date : EXIF d’abord, sinon date du fichier, dans les deux parcours', async (op) => {
  const one = await op();
  await readOne(one, 'exif');
  const s = await view(one);
  assert.match(s.lines.join(' '), /Photo du 02\/11 17:45 \(date de prise de vue\)/);
  assert.deepEqual(s.points, [`${PB} @ 11-02T17:45`]);
  const lot = await op();
  await readLot(lot, ['exif', 'a']);
  assert.deepEqual((await view(lot)).points, [`${PA} @ 11-01T08:00`, `${PB} @ 11-02T17:45`]);
});

await scene(
  'sécurité : photo sans coordonnées, photo illisible, lecture en cours : plus aucun point affiché',
  async (op) => {
    const one = await op();
    await readOne(one, 'a');
    assert.ok((await view(one)).copy);
    // pendant la lecture suivante, puis à la fin : le point de la photo d'avant a disparu
    await one.setInputFiles('#gal', IMG.none);
    await one.waitForFunction(() => /Lecture en cours/.test(document.getElementById('result').textContent));
    nothingToSend(await view(one), 'pendant la lecture');
    await one.waitForFunction(() => /Aucun point/.test(document.getElementById('result').textContent));
    await pause(one);
    let v = await view(one);
    await shot(one, 'seule-sans-coordonnees');
    nothingToSend(v, 'photo seule sans coordonnées');
    assert.match(v.result, /Coordonnées non trouvées/);
    assert.deepEqual(v.points, [`${PA} @ 11-01T08:00`], 'le suivi ne reçoit rien');
    await readOne(one, 'a');
    await one.setInputFiles('#gal', IMG.bad);
    await one.waitForFunction(() => /Photo illisible/.test(document.getElementById('result').textContent));
    v = await view(one);
    nothingToSend(v, 'photo seule illisible');
    assert.match(v.photoMsg, /Photo illisible/);
    // lot sans aucun point sûr, après une photo seule lue
    const lot = await op();
    await readOne(lot, 'a');
    await addLot(lot, ['none', 'none2', 'bad']);
    await tap(lot, '#batchGo');
    await lot.waitForFunction(() => document.getElementById('batchGo').textContent === 'Arrêter');
    nothingToSend(await view(lot), 'pendant la lecture du lot');
    await lot.waitForFunction(() => document.getElementById('batchGo').textContent === 'Lire tout', null, {
      timeout: 120000
    });
    await pause(lot, 800);
    v = await view(lot);
    await shot(lot, 'lot-sans-point-sur');
    nothingToSend(v, 'lot sans point sûr');
    assert.match(v.msg, /Aucun point sûr/);
    assert.equal(v.rows.filter((r) => /^st-none/.test(r)).length, 2);
    assert.ok(v.rows.some((r) => /^st-bad.*photo illisible/.test(r)));
    // ouvrir une photo sans coordonnées, puis l'illisible : toujours aucun point, et le suivi n'a que la photo seule
    await tap(lot, '#batchList li:nth-child(1) [data-chk]');
    await pause(lot, 900);
    v = await view(lot);
    nothingToSend(v, 'photo du lot sans coordonnées, ouverte');
    assert.match(v.rows[0], /affiché/);
    await openRow(lot, 'photo illisible');
    nothingToSend(await view(lot), 'photo du lot illisible, ouverte');
    assert.deepEqual((await view(lot)).points, [`${PA} @ 11-01T08:00`]);
  }
);

await scene(
  'sécurité : lecture douteuse non transmise, ni par l’historique ni après une frappe ; confirmée, elle va au suivi',
  async (op) => {
    for (const mode of ['seule', 'lot']) {
      const page = await op();
      if (mode === 'seule') await readOne(page, 'west');
      else {
        await readLot(page, ['west', 'none']);
        await tap(page, '#batchList li:nth-child(1) [data-chk]');
        await pause(page, 900);
      }
      let v = await view(page);
      assert.match(v.pills.join(' '), /À vérifier/, mode);
      assert.ok(!v.copy && !v.pilot && !v.share && v.hash === '', `${mode} : douteux, rien de transmissible`);
      assert.deepEqual(v.points, [], `${mode} : rien au suivi`);
      // l'appli passe en arrière-plan, puis une espace est tapée dans le texte
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      assert.deepEqual((await view(page)).hist, [], `${mode} : un point douteux n'entre pas dans l'historique`);
      if (mode === 'seule') {
        await page.focus('#src');
        await page.keyboard.press('End');
        await page.keyboard.type(' ');
        await pause(page);
        v = await view(page);
        assert.ok(!v.copy && /À vérifier/.test(v.pills.join(' ')), 'texte retouché : toujours à vérifier');
        await readOne(page, 'west');
      }
      await tap(page, '#result button[data-verify]');
      await pause(page);
      v = await view(page);
      if (mode === 'lot') await shot(page, 'lot-douteuse-confirmee');
      assert.ok(v.copy && /Vérifié à la main/.test(v.pills.join(' ')), `${mode} : confirmé, transmissible`);
      assert.deepEqual(v.points, ['45.103317, -1.913900 @ 11-01T09:30'], `${mode} : confirmé, versé au suivi`);
      if (mode === 'lot') assert.match(v.rows[0], /^st-ok.*confirmée à la main/);
    }
  }
);

await scene('correction : le point de la photo est corrigé sur place au suivi, dans les deux parcours', async (op) => {
  const one = await op();
  await readOne(one, 'a');
  await fixLat(one);
  let v = await view(one);
  assert.equal(v.point, PA_FIXED);
  assert.deepEqual(v.points, [`${PA_FIXED} @ 11-01T08:00`], 'photo seule : un seul point, corrigé');
  assert.match(v.track, /Point 1 du suivi/);
  // lot : deux photos au même endroit à cinq minutes d'écart ; corriger la seconde ne touche pas la première
  const lot = await op();
  await readLot(lot, ['a', 'a2', 'b']);
  assert.deepEqual((await view(lot)).points, [`${PA} @ 11-01T08:00`, `${PA} @ 11-01T08:05`, `${PB} @ 11-01T09:00`]);
  await tap(lot, '#batchList li:nth-child(2) .bb');
  await pause(lot, 900);
  await fixLat(lot);
  v = await view(lot);
  await shot(lot, 'lot-corrigee');
  assert.deepEqual(v.points, [`${PA} @ 11-01T08:00`, `${PA_FIXED} @ 11-01T08:05`, `${PB} @ 11-01T09:00`]);
  assert.match(v.rows[1], /^st-ok on.*45\.103167.*corrigée à la main/);
  assert.match(v.pills.join(' '), /DMM/, 'format lu gardé');
  // rouverte après une autre : même point, même format, zone lue toujours là
  await openRow(lot, PB);
  await tap(lot, '#batchList li:nth-child(2) .bb');
  await pause(lot, 900);
  const again = await view(lot);
  assert.equal(again.point, PA_FIXED);
  assert.deepEqual(again.pills, v.pills);
  assert.ok(again.zone, 'zone lue de la photo corrigée');
  // lot vidé : la photo encore affichée, corrigée à nouveau, garde son point du suivi
  await tap(lot, '#batchClear');
  await fixLat(lot);
  assert.equal((await view(lot)).points.length, 3, 'après « Vider » : toujours trois points');
});

await scene(
  'reprise à la main : une photo du lot pivotée puis relue va au suivi et se rouvre telle quelle',
  async (op) => {
    const page = await op();
    await readLot(page, ['b', 'couchee']);
    assert.match((await view(page)).rows[1], /^st-none/, 'texte couché : coordonnées non trouvées');
    await tap(page, '#batchList li:nth-child(2) [data-chk]');
    await pause(page, 900);
    nothingToSend(await view(page), 'photo couchée ouverte');
    // Pivoter, Tout, Lire
    await tap(page, '#rot');
    await tap(page, '#cropAll');
    await tap(page, '#ocrGo');
    await page.waitForFunction(() => /Lecture en cours/.test(document.getElementById('result').textContent));
    await page.waitForFunction(() => !/Lecture en cours/.test(document.getElementById('result').textContent), null, {
      timeout: 120000
    });
    await pause(page);
    const v = await view(page);
    assert.equal(v.point, PA);
    assert.match(v.rows[1], /^st-ok on.*45\.103317.*fiable/, 'la ligne du lot suit la lecture reprise');
    assert.deepEqual(v.points, [`${PB} @ 11-01T09:00`, `${PA} @ 11-01T09:40`]);
    // une autre photo, puis retour : la reprise est gardée (étapes, zone lue, point), « Corriger » montre la zone
    await openRow(page, PB);
    await tap(page, '#batchList li:nth-child(2) .bb');
    await pause(page, 900);
    const again = await view(page);
    await shot(page, 'lot-reprise-rouverte');
    assert.equal(again.point, PA);
    assert.deepEqual(again.steps, v.steps);
    assert.equal(again.zone, v.zone);
    await tap(page, '#result button[data-fix]');
    assert.ok(await page.$eval('#fixZone', (e) => !e.hidden), 'zone lue sous les molettes');
  }
);

await scene('relance du lot : ni doublon ni point revenu ; photo déplacée : sa date suit au suivi', async (op) => {
  const page = await op();
  await readLot(page, ['a', 'b', 'none']);
  // date du point 1 changée dans le suivi, photo 1 descendue, point de la photo b retiré à la main
  await page.fill('#trackList input[data-tt="0"]', '2026-11-01T07:30');
  await page.dispatchEvent('#trackList input[data-tt="0"]', 'change');
  await tap(page, '#batchList button[data-dn="0"]');
  let v = await view(page);
  assert.match(v.rows[1], /date déplacée/);
  assert.deepEqual(v.points, [`${PB} @ 11-01T09:00`, `${PA} @ 11-01T09:30`], 'la date déplacée est celle du suivi');
  await tap(page, '#trackList button[data-tdel="0"]');
  // deux photos de plus, dont une au même endroit que la photo a, à une autre heure : seules ces deux-là s'ajoutent
  await readLot(page, ['c', 'a2']);
  v = await view(page);
  assert.deepEqual(v.points, [`${PC} @ 11-01T07:00`, `${PA} @ 11-01T08:05`, `${PA} @ 11-01T09:30`]);
  assert.match(v.msg, /2 points ajoutés au suivi/);
  assert.ok(!/à relire/.test(v.msg), 'la photo sans coordonnées n’est pas relue');
});

await scene('texte tapé par-dessus une lecture : un point à part, celui de la photo reste', async (op) => {
  const page = await op();
  await readLot(page, ['a', 'b']);
  await page.fill('#src', '45.200000, 5.700000');
  await page.dispatchEvent('#src', 'change');
  await pause(page);
  let v = await view(page);
  assert.ok(!v.rows.some((r) => /affiché/.test(r)), 'plus aucune photo du lot marquée affichée');
  assert.ok(!v.lines.some((l) => /Photo du/.test(l)), 'pas de date de photo sous un texte saisi');
  await tap(page, '#result button[data-track]');
  await pause(page);
  v = await view(page);
  assert.equal(v.points.length, 3);
  assert.ok(v.points.includes(`${PA} @ 11-01T08:00`) && v.points.includes(`${PB} @ 11-01T09:00`));
  assert.match(v.rows[1], /45\.141667.*fiable/);
});

await scene(
  'un lot existe : une photo choisie ou prise est lue tout de suite et inscrite au lot ; arrêt ; file',
  async (op) => {
    const page = await op();
    await readLot(page, ['a', 'b']);
    await readOne(page, 'c');
    let v = await view(page);
    assert.equal(v.point, PC);
    assert.equal(v.rows.length, 3);
    assert.match(v.rows[0], /^st-ok on.*45\.054167/);
    await readOne(page, 'exif', '#cam');
    v = await view(page);
    assert.equal(v.rows.length, 4);
    assert.match(v.rows[3], /^st-ok on.*02\/11 17:45 photo/);
    await shot(page, 'lot-photo-seule-inscrite');
    // pendant la lecture d'un lot : tout est grisé sauf « Arrêter », une photo prise entre dans la file
    const run = await op();
    await addLot(run, ['a', 'garmin', 'none']);
    await tap(run, '#batchGo');
    await run.waitForFunction(() => document.getElementById('batchGo').textContent === 'Arrêter');
    const off = await run.evaluate(() =>
      ['batchClear', 'ocrGo']
        .map((id) => document.getElementById(id).disabled)
        .concat([...document.querySelectorAll('#batchList button')].every((b) => b.disabled))
    );
    assert.deepEqual(off, [true, true, true], 'pendant la lecture : Vider, Lire et les boutons de la liste grisés');
    await run.setInputFiles('#cam', IMG.b);
    await run.waitForFunction(() => document.getElementById('batchGo').textContent === 'Lire tout', null, {
      timeout: 120000
    });
    await pause(run, 800);
    v = await view(run);
    assert.equal(v.rows.length, 4);
    assert.ok(
      v.rows.some((r) => /^st-ok.*45\.141667/.test(r)),
      'la photo prise pendant le lot a été lue'
    );
    assert.equal(v.point, PB, 'point de la victime : le plus récent des points sûrs');
    // arrêt demandé dès le début : rien n'est lu de travers, les photos restent à lire
    const stop = await op();
    await addLot(stop, ['a', 'b', 'c']);
    await tap(stop, '#batchGo');
    await stop.waitForFunction(() => document.getElementById('batchGo').textContent === 'Arrêter');
    await tap(stop, '#batchGo');
    await stop.waitForFunction(() => /Lecture arrêtée/.test(document.getElementById('batchMsg').textContent), null, {
      timeout: 60000
    });
    v = await view(stop);
    assert.ok(
      v.rows.some((r) => /^st-wait/.test(r)),
      'des photos restent en attente'
    );
    assert.equal(v.points.length, v.rows.filter((r) => /^st-ok/.test(r)).length);
  }
);

await scene('carte : après un lot, tous ses points sont à l’écran, avec ou sans position du téléphone', async (op) => {
  for (const geo of [null, { latitude: 45.19, longitude: 5.72 }]) {
    const page = await op(geo);
    if (geo) await pause(page, 1200);
    await readLot(page, ['a', 'b', 'c']);
    await pause(page, 1200);
    const pins = await page.evaluate(() => {
      const m = document.getElementById('map').getBoundingClientRect();
      return [...document.querySelectorAll('.pin-n')].map((p) => {
        const r = p.getBoundingClientRect();
        return r.left >= m.left && r.right <= m.right && r.top >= m.top && r.bottom <= m.bottom;
      });
    });
    assert.deepEqual(pins, [true, true, true], geo ? 'avec position' : 'sans position');
    assert.ok((await view(page)).top < 300, 'fin du lot : l’écran est au point de la victime');
    if (!geo) await shot(page, 'lot-lu');
  }
});

// ---------- Bilan ----------
await browser.close();
server.close();
rmSync(DIR, { recursive: true, force: true });
if (failures.length) {
  console.error(`\n${failures.length} scénario(s) en échec :\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('\nTous les scénarios passent.');
