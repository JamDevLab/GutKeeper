// Erlaubt der Android-App (Capacitor), sich mit einem Server über http (ohne HTTPS) zu verbinden, z. B. im Heimnetz ohne eigene Domain.
// Aufruf: node tools/android-http.js [Ordner des App-Projekts, Standard android-app] [--off]   (--off: wieder nur HTTPS)
// Die App selbst läuft weiter unter https://localhost (sicherer Kontext: verschlüsselter Speicher, Ende-zu-Ende-Verschlüsselung, PIN und
// Fingerabdruck funktionieren); nur die Verbindung zum Server darf unverschlüsselt sein. Der Verkehr ist dann im Netz lesbar.
// Geändert werden capacitor.config.json (android.allowMixedContent) und AndroidManifest.xml (usesCleartextTraffic). Danach die APK neu bauen.
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2), off = args.includes('--off');
const app = args.find((a) => !a.startsWith('--')) || path.join(__dirname, '..', 'android-app');
const cfgFile = path.join(app, 'capacitor.config.json');
const manifest = path.join(app, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (!fs.existsSync(cfgFile) || !fs.existsSync(manifest)) { console.error('Kein Capacitor-Android-Projekt gefunden (capacitor.config.json oder AndroidManifest.xml fehlt).'); process.exit(1); }

const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
if (off) { // zurück auf den Standard: nur HTTPS
  if (cfg.android) { delete cfg.android.allowMixedContent; if (!Object.keys(cfg.android).length) delete cfg.android; }
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');
  fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace(/\s*android:usesCleartextTraffic="true"/, ''));
  console.log('Nur noch HTTPS-Verbindungen. Bitte die APK neu bauen (node tools/build-apk.js).');
  process.exit(0);
}
cfg.android = { ...(cfg.android || {}), allowMixedContent: true };
fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');

let xml = fs.readFileSync(manifest, 'utf8');
if (!xml.includes('usesCleartextTraffic')) {
  if (!/<application\b/.test(xml)) { console.error('Kein <application>-Element im Manifest.'); process.exit(1); }
  xml = xml.replace(/<application\b/, '<application android:usesCleartextTraffic="true"');
  fs.writeFileSync(manifest, xml);
}
console.log('http-Verbindungen sind erlaubt. Bitte „npx cap sync android“ und die APK neu bauen (node tools/build-apk.js).');
