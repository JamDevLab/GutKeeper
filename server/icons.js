// App-Icon: eingebaute Varianten (APP_ICON=bristol|ring|guard|crest|classic|shield|list|diary, alt auch 1–8) oder eigenes Icon (APP_ICON=custom, Datei data/icon.png)
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cfg = require('./config');
const log = require('./log');
const VARIANTS = { bristol: '#1f3d36', classic: '#1f3d36', list: '#1f3d36', diary: '#1f3d36', shield: '#1f3d36', ring: '#1f3d36', crest: '#1f3d36', guard: '#1f3d36' }; // Name -> Farbe der Startansicht
const ALIAS = { 1: 'classic', 2: 'diary', 3: 'bristol', 4: 'list', 5: 'shield', 6: 'ring', 7: 'crest', 8: 'guard' }; // 1–3 aus früheren Versionen
const DEFAULT_THEME = '#2f6f5e';

const pngSize = (b) => (b.length > 24 && b.readUInt32BE(0) === 0x89504e47 ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null);
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f) : null);
const short = (b) => crypto.createHash('sha1').update(b).digest('hex').slice(0, 8);

function load() {
  let name = ALIAS[cfg.APP_ICON] || cfg.APP_ICON;
  let any192, any512, maskable, sizes = { 192: '192x192', 512: '512x512' };

  if (name === 'custom') {
    const main = read(path.join(cfg.DATA_DIR, 'icon.png'));
    const size = main && pngSize(main);
    if (!size) {
      log.warn('APP_ICON=custom, aber data/icon.png fehlt oder ist kein PNG – es wird das Icon „bristol“ verwendet.', 'APP_ICON=custom, but data/icon.png is missing or not a PNG: using the "bristol" icon.');
      name = 'bristol';
    } else {
      if (size.w !== size.h || size.w < 512) log.warn(`data/icon.png hat ${size.w}x${size.h} px – empfohlen ist ein quadratisches PNG mit mindestens 512x512 px.`, `data/icon.png is ${size.w}x${size.h} px: a square PNG of at least 512x512 px is recommended.`);
      any192 = any512 = main;
      maskable = read(path.join(cfg.DATA_DIR, 'icon-maskable.png'));
    }
  }
  if (name !== 'custom') {
    if (!VARIANTS[name]) { log.warn(`Unbekanntes APP_ICON „${cfg.APP_ICON}“ – es wird „bristol“ verwendet.`, `Unknown APP_ICON "${cfg.APP_ICON}": using "bristol".`); name = 'bristol'; }
    const dir = path.join(cfg.PUBLIC_DIR, 'icons', name);
    any192 = read(path.join(dir, 'icon-192.png'));
    any512 = read(path.join(dir, 'icon-512.png'));
    maskable = read(path.join(dir, 'icon-maskable-512.png'));
  }

  const theme = cfg.APP_THEME_COLOR || VARIANTS[name] || DEFAULT_THEME;
  const assets = {}; // URL-Pfad -> Bild
  const url = (kind, buf) => { const p = `/icon/${kind}-${short(buf)}.png`; assets[p] = buf; return p; };
  const u192 = url('192', any192), u512 = url('512', any512);
  const icons = [
    { src: u192, sizes: sizes[192], type: 'image/png', purpose: 'any' },
    { src: u512, sizes: sizes[512], type: 'image/png', purpose: 'any' },
  ];
  if (maskable) icons.push({ src: url('maskable', maskable), sizes: sizes[512], type: 'image/png', purpose: 'maskable' });
  // Alte feste Adressen weiter bedienen (zwischengespeicherte Manifeste älterer Versionen)
  const legacy = { '/icon-192.png': any192, '/icon-512.png': any512 };
  if (maskable) legacy['/icon-maskable-512.png'] = maskable;
  return { name, theme, icons, u192, u512, assets, legacy };
}

module.exports = load();
