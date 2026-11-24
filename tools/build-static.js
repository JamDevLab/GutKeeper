// Baut die serverlose Version (reine Dateien, alle Daten bleiben auf dem Gerät) nach dist/
// Aufruf: npm run build:static
// Optionen (Umgebungsvariablen):
//   APP_NAME            eigener Name (sonst GutKeeper)
//   APP_LANG            de | en – Voreinstellung der Sprache (sonst richtet sich die App nach dem Browser)
//   APP_ICON            bristol | classic | list | diary | shield | ring | crest | guard (oder 1–8) | custom
//   ICON_FILE           bei APP_ICON=custom: quadratisches PNG, mindestens 512x512 px
//   ICON_MASKABLE_FILE  optional bei custom: Bild, dessen Motiv im inneren 60 % liegt (für runde Android-Icons)
//   APP_THEME_COLOR     Farbe der Titelleiste als #rrggbb
//   APK_DEV             1 = Test-Version der APK (setzt build-apk.js ohne --release): eigener Backup-Ordner „GutKeeper Dev“
//   ONBOARDING          geführter Einstieg beim ersten Start (einmal je Gerät), standardmäßig an, 0 = aus
//   OUT                 Zielordner (Standard: dist)
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'public');
const out = path.resolve(root, process.env.OUT || 'dist');
const fail = (m) => { console.error(m); process.exit(1); };

const VARIANTS = { bristol: '#1f3d36', classic: '#1f3d36', list: '#1f3d36', diary: '#1f3d36', shield: '#1f3d36', ring: '#1f3d36', crest: '#1f3d36', guard: '#1f3d36' };
const ALIAS = { 1: 'classic', 2: 'diary', 3: 'bristol', 4: 'list', 5: 'shield', 6: 'ring', 7: 'crest', 8: 'guard' }; // 1–3 aus früheren Versionen
const iconName = String(ALIAS[process.env.APP_ICON] || process.env.APP_ICON || 'bristol').trim().toLowerCase();
if (iconName !== 'custom' && !VARIANTS[iconName]) fail(`Unbekanntes APP_ICON „${iconName}“ (erlaubt: ${Object.keys(VARIANTS).join(', ')}, custom)`);

const langs = require('../server/langs');
const lang = langs.languages(src).includes(process.env.APP_LANG) ? process.env.APP_LANG : '';
const customName = (process.env.APP_NAME || '').trim();
const name = customName || 'GutKeeper';
const theme = /^#[0-9a-f]{6}$/i.test((process.env.APP_THEME_COLOR || '').trim()) ? process.env.APP_THEME_COLOR.trim()
  : (VARIANTS[iconName] || VARIANTS.bristol);

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsonStr = (s) => JSON.stringify(s).slice(1, -1);
const pngSize = (b) => (b && b.length > 24 && b.readUInt32BE(0) === 0x89504e47 ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null);

// Dateien kopieren; die Icons werden getrennt behandelt (nur das gewählte Set bzw. das eigene Bild)
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true, filter: (f) => { const rel = path.relative(src, f); return rel !== 'icons' && !rel.startsWith('icons' + path.sep); } });

const dir = `icons/${iconName}`;
fs.mkdirSync(path.join(out, dir), { recursive: true });
let icons;
if (iconName === 'custom') {
  if (!process.env.ICON_FILE) fail('APP_ICON=custom braucht ICON_FILE=pfad/zum/icon.png (quadratisches PNG, mindestens 512x512 px).');
  const main = fs.readFileSync(path.resolve(process.env.ICON_FILE));
  const size = pngSize(main);
  if (!size) fail(`ICON_FILE „${process.env.ICON_FILE}“ ist kein PNG.`);
  if (size.w !== size.h || size.w < 512) console.warn(`Warnung: ICON_FILE hat ${size.w}x${size.h} px – empfohlen ist ein quadratisches PNG mit mindestens 512x512 px.`);
  fs.writeFileSync(path.join(out, dir, 'icon-192.png'), main);
  fs.writeFileSync(path.join(out, dir, 'icon-512.png'), main);
  icons = [
    { src: `${dir}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: `${dir}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
  ];
  if (process.env.ICON_MASKABLE_FILE) {
    const mk = fs.readFileSync(path.resolve(process.env.ICON_MASKABLE_FILE));
    if (!pngSize(mk)) fail('ICON_MASKABLE_FILE ist kein PNG.');
    fs.writeFileSync(path.join(out, dir, 'icon-maskable-512.png'), mk);
    icons.push({ src: `${dir}/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' });
  }
} else {
  fs.cpSync(path.join(src, 'icons', iconName), path.join(out, dir), { recursive: true });
  icons = [
    { src: `${dir}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: `${dir}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: `${dir}/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ];
}

const L = lang || 'de';
const fill = (text, escape) => text.replaceAll('__APP_NAME__', escape(name)).replaceAll('__APP_SHORT__', escape(name.slice(0, 16)))
  .replaceAll('__LANG__', L).replaceAll('__APP_DESC__', escape(langs.translate(src, L, 'Selbst gehostetes Darm-Tagebuch')))
  .replaceAll('__THEME__', theme).replaceAll('__ICON_192__', `${dir}/icon-192.png`).replaceAll('__ICON_512__', `${dir}/icon-512.png`)
  .replaceAll('__ICONS__', JSON.stringify(icons));

// index.html: Marker „serverlos“ setzen (die App schaltet dann Abgleich, Anmeldung und Server-Funktionen ab)
const metas = ['<meta name="gutkeeper-standalone" content="1">', `<meta name="gutkeeper-version" content="${require('../package.json').version}">`]; // die App merkt sich ihre Version (Vergleich mit dem Server)
if (lang) metas.push(`<meta name="gutkeeper-lang" content="${lang}">`);
if (process.env.ONBOARDING !== '0') metas.push('<meta name="gutkeeper-onboarding" content="1">');
if (process.env.APK_DEV === '1') metas.push('<meta name="gutkeeper-dev" content="1">'); // nur build-apk.js ohne --release (Test-Version)
if (customName) metas.push(`<meta name="gutkeeper-name" content="${esc(customName)}">`);
let html = fill(fs.readFileSync(path.join(src, 'index.html'), 'utf8'), esc);
html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  ' + metas.join('\n  '));
fs.writeFileSync(path.join(out, 'index.html'), html);

// Manifest mit relativen Pfaden, damit die App auch in einem Unterordner (z. B. /gutkeeper/) oder aus der APK läuft
const manifest = fill(fs.readFileSync(path.join(src, 'manifest.webmanifest'), 'utf8'), jsonStr)
  .replace('"start_url": "/"', '"start_url": "./"').replace('"scope": "/"', '"scope": "./"');
JSON.parse(manifest); // Kontrolle
fs.writeFileSync(path.join(out, 'manifest.webmanifest'), manifest);

// Service Worker: Cache-Name aus Version und Hash der fertigen Dateien (siehe server/swcache.js)
const swPath = path.join(out, 'sw.js');
fs.writeFileSync(swPath, require('../server/swcache').fillSw(fs.readFileSync(swPath, 'utf8'), require('../package.json').version, (p) => fs.readFileSync(path.join(out, p))));

console.log(`Serverlose Version gebaut: ${path.relative(process.cwd(), out) || '.'}/ (${name}, Icon „${iconName}“${lang ? `, Sprache ${lang}` : ''})`);
