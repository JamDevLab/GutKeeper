// Baut die APK in einem Schritt: serverlose Version bauen, in das Capacitor-Projekt kopieren, synchronisieren, mit Gradle bauen.
// Aufruf: node tools/build-apk.js [Ordner des App-Projekts, Standard android-app] [--release]
//   (die Umgebungsvariablen APP_NAME, APP_LANG, APP_ICON, ONBOARDING … gelten wie bei build:static)
// Ohne --release: Debug-APK (zum Testen, mit dem Debug-Schlüssel signiert).
// Mit --release: Release-APK, signiert mit deinem eigenen Schlüssel (Keystore). Angaben über Umgebungsvariablen, nie in Dateien:
//   APK_KEYSTORE=Pfad zur .jks-Datei   APK_KEY_ALIAS=Alias (Standard gutkeeper)
//   APK_KEYSTORE_PASS / APK_KEY_PASS: Passwörter (optional; fehlen sie, fragt apksigner im Terminal danach)
// Voraussetzung: npm ci im App-Ordner, ANDROID_HOME (Android-SDK mit build-tools) und JAVA_HOME auf ein JDK 21.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2), release = args.includes('--release');
const app = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(__dirname, '..', 'android-app'));
if (!fs.existsSync(path.join(app, 'android'))) {
  console.error(`Kein Android-Projekt in ${app}.\nAufruf: node tools/build-apk.js [Ordner des App-Projekts] [--release]`);
  process.exit(1);
}
if (!fs.existsSync(path.join(app, 'node_modules', '@capacitor', 'cli'))) { console.error(`Capacitor fehlt: zuerst im App-Ordner „npm ci“ ausführen (${app}).`); process.exit(1); }
// Release: Schlüssel und Werkzeuge vorher prüfen, damit nicht erst nach dem Bauen etwas fehlt
let keystore = '', buildTools = '';
if (release) {
  keystore = process.env.APK_KEYSTORE ? path.resolve(process.env.APK_KEYSTORE) : '';
  if (!keystore || !fs.existsSync(keystore)) { console.error('Für --release APK_KEYSTORE auf deine Keystore-Datei setzen (siehe docs/INSTALLATION.de.md, „Schlüssel erstellen“).'); process.exit(1); }
  if (keystore.startsWith(path.resolve(__dirname, '..') + path.sep)) { console.error('Der Keystore liegt im Repository-Ordner. Bitte außerhalb ablegen, damit er nie committet wird.'); process.exit(1); }
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '';
  const bt = path.join(sdk, 'build-tools');
  const vers = sdk && fs.existsSync(bt) ? fs.readdirSync(bt).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : [];
  if (!vers.length) { console.error('Android-SDK build-tools nicht gefunden: ANDROID_HOME setzen.'); process.exit(1); }
  buildTools = path.join(bt, vers[vers.length - 1]);
}
if (!process.env.JAVA_HOME) console.warn('Hinweis: JAVA_HOME ist nicht gesetzt; Gradle nimmt das Java aus dem Pfad (nötig: JDK 21).');

const run = (title, cmd, args, cwd, env = {}) => {
  console.log(`\n== ${title}`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' && cmd !== process.execPath, env: { ...process.env, ...env } });
  if (r.error) console.error(r.error.message); // z. B. Programm fehlt oder ist nicht ausführbar (EACCES)
  if (r.status !== 0) { console.error(`Fehlgeschlagen: ${title}`); process.exit(r.status || 1); }
};

// Version aus package.json übernehmen: versionName = „1.2.3“, versionCode = MAJOR*10000 + MINOR*100 + PATCH
// (Android installiert ein Update nur, wenn versionCode nicht kleiner ist; deshalb Minor und Patch jeweils unter 100 halten)
const version = require('../package.json').version;
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
if (!m || +m[2] > 99 || +m[3] > 99) { console.error(`Version in package.json ungültig für die APK: ${version} (erwartet z. B. 1.2.3, Minor und Patch unter 100)`); process.exit(1); }
const versionCode = +m[1] * 10000 + +m[2] * 100 + +m[3];
const gradle = path.join(app, 'android', 'app', 'build.gradle');
const g = fs.readFileSync(gradle, 'utf8');
if (!/versionCode\s+\d+/.test(g) || !/versionName\s+"[^"]*"/.test(g)) { console.error(`versionCode/versionName nicht gefunden in ${gradle}`); process.exit(1); }
fs.writeFileSync(gradle, g.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`).replace(/versionName\s+"[^"]*"/, `versionName "${version}"`));
console.log(`Version ${version} (versionCode ${versionCode})`);

run('Serverlose Version bauen', process.execPath, [path.join(__dirname, 'build-static.js')], path.join(__dirname, '..'), { OUT: path.join(app, 'www'), APK_DEV: release ? '' : '1' }); // Test-Version: eigener Ordner für Backups
// Vorschaubilder aller Icon-Sätze für die Auswahl „Icon auf dem Startbildschirm“ (Optionen → App)
for (const set of ['bristol', 'classic', 'list', 'diary', 'shield', 'ring', 'crest', 'guard']) {
  const dst = path.join(app, 'www', 'icons', set);
  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'public', 'icons', set, 'icon-192.png'), path.join(dst, 'icon-192.png'));
}
run('Capacitor synchronisieren', 'npx', ['cap', 'sync', 'android'], app);
run('APK bauen (Gradle)', process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew', [release ? 'assembleRelease' : 'assembleDebug', '--no-daemon', '-q'], path.join(app, 'android'));

const out = path.join(app, 'android', 'app', 'build', 'outputs', 'apk', release ? 'release' : 'debug');
if (!release) {
  const apk = path.join(out, 'app-debug.apk');
  console.log(fs.existsSync(apk) ? `\nFertig (Version ${version}, debug): ${apk}` : '\nGradle lief durch, aber die APK wurde nicht gefunden.');
  process.exit(0);
}
// Release: Gradle liefert eine unsignierte APK; ausrichten (zipalign) und mit dem eigenen Schlüssel signieren (apksigner).
// Die Passwörter gehen nur über Umgebungsvariablen an apksigner (env:NAME), nie über die Kommandozeile oder eine Datei.
const tool = (n) => path.join(buildTools, process.platform === 'win32' ? (n === 'apksigner' ? 'apksigner.bat' : n + '.exe') : n);
const unsigned = path.join(out, 'app-release-unsigned.apk'), aligned = path.join(out, 'app-release-aligned.apk');
const signed = path.join(out, `gutkeeper-${version}.apk`);
if (!fs.existsSync(unsigned)) { console.error(`Unsignierte APK nicht gefunden: ${unsigned}`); process.exit(1); }
fs.rmSync(aligned, { force: true });
run('Ausrichten (zipalign)', tool('zipalign'), ['-p', '-f', '4', unsigned, aligned], out);
const sign = ['sign', '--ks', keystore, '--ks-key-alias', process.env.APK_KEY_ALIAS || 'gutkeeper', '--out', signed];
if (process.env.APK_KEYSTORE_PASS) sign.push('--ks-pass', 'env:APK_KEYSTORE_PASS');
if (process.env.APK_KEY_PASS) sign.push('--key-pass', 'env:APK_KEY_PASS');
run('Signieren (apksigner)', tool('apksigner'), [...sign, aligned], out);
run('Signatur prüfen', tool('apksigner'), ['verify', '--print-certs', signed], out);
fs.rmSync(aligned, { force: true });
console.log(`\nFertig (Version ${version}, release): ${signed}`);
