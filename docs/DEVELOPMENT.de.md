# Entwicklung

[English](DEVELOPMENT.md) · **Deutsch**

[Zurück zur README](../README.de.md)

## Projektstruktur

```
server/         Node-Server (config, db, auth, sync, backups, storage, icons, crypto-wrap, index)
server/cli.js   Verwaltung auf dem Server (Konten, Passwort, Sitzungen abmelden, Entschlüsseln)
public/         Oberfläche (index.html, style.css, sw.js, manifest)
public/js/      ES-Module ohne Bundler (Einstieg app.js; Speicher und Sync in store.js, Verschlüsselung
                in cipher/vault/e2ee, Optionen in data.js, Texte auf Englisch in lang-en.js)
public/icons/   Eingebaute App-Icons (acht Sets: bristol, ring, guard, crest, classic, shield, list, diary)
android-app/    Capacitor-Projekt für die Android-App (APK)
compose/        Docker-Compose-Vorlagen (Schnellstart, mehrere Konten, Reverse Proxy)
tests/          Tests für Server, Sync, Verschlüsselung und Konsistenz (npm test)
tools/          Hilfsskripte (serverlose Version, APK bauen, Icons, Screenshots für die README)
docs/           Screenshots, Beispieldaten, Beispiel-Bericht, Installationsanleitung
data/           Datenbank und Backups (nicht im Repository)
```

Die Oberfläche kommt ohne Build-Schritt und ohne Abhängigkeiten aus. Der Server nutzt das in Node enthaltene SQLite-Modul `node:sqlite` und braucht deshalb keine zusätzlichen Pakete. In Node 22 ist es noch als experimentell markiert, ab Node 24.15 gilt es als Release Candidate. Die Docker-Datei verwendet `node:24-alpine`; bei einem Node-Update lohnt sich ein kurzer Test (`npm test`).

Entwicklung: `npm run dev` startet den Server mit Neustart bei Änderungen und ohne Netzwerk-Beschränkung (`ALLOW_ANY=1`).

## Tests

`npm test` führt alle Tests aus (`node:test`, keine zusätzlichen Pakete). Eine einzelne Testdatei: `node --disable-warning=ExperimentalWarning --test tests/e2ee.test.js`; ein einzelner Test: `--test-name-pattern="<Teil des Namens>"` anhängen. `npm test` nennt die Testdateien ausdrücklich, eine neue `tests/*.test.js` muss also in das `test`-Skript in der `package.json` eingetragen werden, sonst läuft sie nie.

## Übersetzungen

Texte der Oberfläche stehen direkt im Code auf Deutsch, eingepackt in `t('…')`. Die englische Fassung jedes Textes steht in `public/js/lang-en.js`. Wenn du einen Text hinzufügst oder änderst, ergänze oder ändere den passenden Schlüssel dort. `tests/consistency.test.js` prüft, dass jeder `t('…')`-Text einen englischen Eintrag hat.

## Hilfsskripte (`tools/`)

- `build-static.js`: baut die serverlose Version nach `dist/` (`npm run build:static`).
- `build-apk.js`: baut die Android-APK in einem Schritt (serverlose Version, Capacitor-Sync, Gradle); `--release` signiert mit deinem eigenen Keystore.
- `android-http.js`: erlaubt der Android-App die Verbindung zu einem http-Server (`--off` macht es rückgängig).
- `android-style.js`: setzt die Icons des Projekts und ein schlichtes Startbild in ein Capacitor-Android-Projekt.
- `make-icons.js`: erzeugt die eingebauten App-Icon-Sätze (braucht Chrome oder Edge).
- `make-screenshots.js`: erzeugt die Screenshots und den Beispiel-Bericht in `docs/screenshots/` (braucht Chrome oder Edge).
- `make-social.js`: erzeugt das GitHub-Social-Preview-Bild `docs/social-preview.png`.
