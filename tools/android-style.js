// Setzt Icon und Startbild im Android-Projekt (Capacitor) auf die Icons dieses Projekts; Capacitor legt sonst sein eigenes Logo an.
// Aufruf: node tools/android-style.js <Ordner des App-Projekts> [bristol|ring|guard|crest|classic|shield|list|diary]
// Die Hintergrundfarbe des Icons steht in BG (Standard je Icon-Satz); bei eigenen Icons: BG=#RRGGBB node tools/android-style.js …
// Das Skript enthält keine Zugangsdaten und ändert nur Dateien unter android/app/src/main/res/.
const fs = require('node:fs');
const path = require('node:path');

const app = process.argv[2];
const icon = process.argv[3] || 'bristol';
const BGS = { bristol: '#1F3D36', classic: '#1F3D36', list: '#1F3D36', diary: '#1F3D36', shield: '#1F3D36', ring: '#1F3D36', crest: '#1F3D36', guard: '#1F3D36' }; // wie BG in tools/make-icons.js
const bg = process.env.BG || BGS[icon];
if (!app) { console.error('Aufruf: node tools/android-style.js <Ordner des App-Projekts> [Icon-Satz]'); process.exit(1); }
if (!bg) { console.error(`Für den Icon-Satz „${icon}“ ist keine Hintergrundfarbe bekannt. Bitte BG=#RRGGBB angeben.`); process.exit(1); }
const SRC = path.join(__dirname, '..', 'public', 'icons', icon);
const RES = path.join(app, 'android', 'app', 'src', 'main', 'res');
if (!fs.existsSync(SRC)) { console.error('Icon-Satz nicht gefunden: ' + SRC); process.exit(1); }
if (!fs.existsSync(RES)) { console.error('Kein Android-Projekt gefunden (erst „npx cap add android“ ausführen): ' + RES); process.exit(1); }

for (const d of fs.readdirSync(RES)) {
  if (!d.startsWith('mipmap-') || d === 'mipmap-anydpi-v26') continue;
  const dir = path.join(RES, d);
  fs.copyFileSync(path.join(SRC, 'icon-192.png'), path.join(dir, 'ic_launcher.png'));
  fs.copyFileSync(path.join(SRC, 'icon-192.png'), path.join(dir, 'ic_launcher_round.png'));
  if (d === 'mipmap-xxxhdpi') fs.copyFileSync(path.join(SRC, 'icon-maskable-512.png'), path.join(dir, 'ic_launcher_foreground.png'));
  else fs.rmSync(path.join(dir, 'ic_launcher_foreground.png'), { force: true });
}
fs.writeFileSync(path.join(RES, 'values', 'ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${bg}</color>\n</resources>\n`);

// Adaptives Icon: Das Motiv des „maskable“-Bildes füllt fast die ganze sichtbare Fläche; ein Rand von 12 % verkleinert es auf ein gutes Maß
const ADAPTIVE = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@drawable/ic_launcher_foreground_inset"/>
</adaptive-icon>
`;
fs.writeFileSync(path.join(RES, 'drawable', 'ic_launcher_foreground_inset.xml'), `<?xml version="1.0" encoding="utf-8"?>
<inset xmlns:android="http://schemas.android.com/apk/res/android" android:drawable="@mipmap/ic_launcher_foreground" android:inset="12%"/>
`);
for (const f of ['ic_launcher.xml', 'ic_launcher_round.xml']) fs.writeFileSync(path.join(RES, 'mipmap-anydpi-v26', f), ADAPTIVE);

// Alle Icon-Sätze zusätzlich als eigene Ressourcen (ic_launcher_<satz>): Die App kann ihr Icon auf dem Startbildschirm
// selbst umschalten (activity-alias je Satz in AndroidManifest.xml, Plugin AppIconPlugin.java), ohne neu gebaut zu werden.
const SETS = Object.keys(BGS);
let colors = '';
for (const s of SETS) {
  const src = path.join(__dirname, '..', 'public', 'icons', s);
  for (const d of fs.readdirSync(RES)) {
    if (!d.startsWith('mipmap-') || d === 'mipmap-anydpi-v26') continue;
    fs.copyFileSync(path.join(src, 'icon-192.png'), path.join(RES, d, `ic_launcher_${s}.png`));
    fs.copyFileSync(path.join(src, 'icon-192.png'), path.join(RES, d, `ic_launcher_${s}_round.png`));
  }
  fs.copyFileSync(path.join(src, 'icon-maskable-512.png'), path.join(RES, 'mipmap-xxxhdpi', `ic_launcher_${s}_foreground.png`));
  fs.writeFileSync(path.join(RES, 'drawable', `ic_launcher_${s}_foreground_inset.xml`), `<?xml version="1.0" encoding="utf-8"?>
<inset xmlns:android="http://schemas.android.com/apk/res/android" android:drawable="@mipmap/ic_launcher_${s}_foreground" android:inset="12%"/>
`);
  const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_${s}_background"/>
    <foreground android:drawable="@drawable/ic_launcher_${s}_foreground_inset"/>
</adaptive-icon>
`;
  for (const f of [`ic_launcher_${s}.xml`, `ic_launcher_${s}_round.xml`]) fs.writeFileSync(path.join(RES, 'mipmap-anydpi-v26', f), adaptive);
  colors += `    <color name="ic_launcher_${s}_background">${BGS[s]}</color>\n`;
}
fs.writeFileSync(path.join(RES, 'values', 'ic_launcher_variants.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${colors}</resources>\n`);

// Startbild: einfarbig statt Capacitor-Logo
for (const d of fs.readdirSync(RES)) if (d.startsWith('drawable')) fs.rmSync(path.join(RES, d, 'splash.png'), { force: true });
fs.writeFileSync(path.join(RES, 'drawable', 'splash.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">\n    <solid android:color="${bg}"/>\n</shape>\n`);
const styles = path.join(RES, 'values', 'styles.xml');
let st = fs.readFileSync(styles, 'utf8');
if (!st.includes('windowSplashScreenBackground')) {
  st = st.replace('<item name="android:background">@drawable/splash</item>', '<item name="android:background">@drawable/splash</item>\n        <item name="windowSplashScreenBackground">@color/ic_launcher_background</item>\n        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher</item>');
  fs.writeFileSync(styles, st);
}
console.log(`Icon „${icon}“ und Startbild gesetzt in ${RES}`);
