# GutKeeper installieren: drei Wege

[English](INSTALLATION.md) · **Deutsch**

GutKeeper gibt es in drei Varianten. Sie nutzen denselben Code, unterscheiden sich aber darin, wo die Daten liegen und wie viel Technik du brauchst.

| | **A: Mit Server** | **B: Web-App ohne Server** | **C: Android-App (APK)** |
|---|---|---|---|
| Für wen | Technikaffine mit Heimserver, NAS oder Raspberry Pi | Alle, die Dateien auf einen Webspace legen können; die einzige Lösung ohne Server für iPhones | Android-Nutzer, die eine „echte“ App ohne Hosting wollen |
| Aufwand | mittel (Docker) | gering bis mittel | hoch (PC, Android Studio) |
| Daten liegen | auf dem Server, Kopie auf jedem Gerät | nur auf dem Gerät | nur auf dem Gerät |
| Mehrere Geräte synchron | ja | nur mit Server-Verbindung ([siehe unten](#b-und-c-mit-einem-server-verbinden-app-sync)) | nur mit Server-Verbindung ([siehe unten](#b-und-c-mit-einem-server-verbinden-app-sync)) |
| Server-Backups, Konten | ja | nur mit Server-Verbindung | nur mit Server-Verbindung |
| Anmeldung / Sperre | Passwort (oder Konten) des Servers, dazu optional lokale PIN | lokale PIN (optional) | lokale PIN (optional) |
| Android | ja (per Browser, installierbar) | ja (per Browser, installierbar) | ja |
| iPhone | ja (per Safari, „Zum Home-Bildschirm“) | ja (per Safari, „Zum Home-Bildschirm“) | nein |

## Weg A: Mit Server (Docker)

Siehe [Schnellstart im README](../README.de.md#schnellstart-docker). Der Server speichert alle Einträge, legt täglich Backups an und gleicht mehrere Geräte ab. Für die Installation als App auf dem Handy braucht die Adresse **HTTPS**; eine Anleitung steht im [Konfiguration](CONFIGURATION.de.md#https-einrichten).

Beim ersten Start steht im Server-Log ein **Einmal-Code** (`docker compose logs`). Öffne die App, gib den Code ein und lege dein **Passwort** fest (bei `MULTIUSER=1` das erste Konto). Es gibt kein Passwort in der `.env`; die Anmeldung gilt je Gerät einmal, danach bleibt das Gerät angemeldet, bis du dich abmeldest. Eine **PIN oder den Fingerabdruck** für das einzelne Gerät richtest du unter *Optionen → Sicherheit* ein (sie bleibt lokal auf dem Gerät). Passwort vergessen: `docker compose exec gutkeeper node server/cli.js reset-password` (mit mehreren Konten zusätzlich der Name; das neue Passwort fragt der Befehl ab oder du hängst es an). Eine eingeschaltete Ende-zu-Ende-Verschlüsselung bleibt davon unberührt: ihr Schlüssel hängt am Wiederherstellungscode, nicht am Passwort. Wer ganz von vorn anfangen will, nutzt *Optionen → Daten löschen → Konto löschen*: Der Server beginnt dann wieder bei der Einrichtung, mit einem neuen Einmal-Code im Log.

Willst du den Server über einen Namen erreichen, geht das ohne Zusatz-Einstellung (Namen sind erlaubt). Mit `ALLOWED_HOSTS=gutkeeper.fritz.box,gutkeeper.example.org` in der `.env` werden dagegen nur diese Namen sowie IP-Adressen und `localhost` angenommen (Schutz vor DNS-Rebinding).

Hinter einem Reverse Proxy setzt du `TRUST_PROXY=1` und zusätzlich `TRUSTED_PROXY` auf die Adresse(n) des Proxys (IP oder Subnetz, z. B. `TRUSTED_PROXY=172.18.0.0/16`). Nur von dort werden `X-Real-IP` und `X-Forwarded-Proto` geglaubt; ohne `TRUSTED_PROXY` gilt jede private Adresse als Proxy.

## Weg B: Web-App ohne Server

1. Auf einem Rechner mit Node.js (ab Version 22.13) im Projektordner ausführen:
   ```bash
   npm run build:static
   ```
   Es entsteht der Ordner `dist/`. Optional lassen sich Name, Sprache, Icon und Farbe festlegen, z. B. `APP_NAME="Mein Tagebuch" npm run build:static`:

   | Variable | Bedeutung |
   |---|---|
   | `APP_NAME` | eigener Name (sonst GutKeeper) |
   | `APP_LANG` | `de` oder `en`: Voreinstellung der Sprache (sonst folgt die App dem Browser) |
   | `APP_ICON` | `bristol`, `ring`, `guard`, `crest`, `classic`, `shield`, `list`, `diary` oder `custom` |
   | `ICON_FILE` | bei `custom`: dein quadratisches PNG, mindestens 512×512 px |
   | `ICON_MASKABLE_FILE` | optional: Bild für runde Android-Icons (Motiv im inneren 60 %) |
   | `APP_THEME_COLOR` | Farbe der Titelleiste, z. B. `#2f6f5e` |
   | `ONBOARDING` | Geführter Einstieg beim ersten Start (einmal je Gerät; Darstellung, Essen, App-Sperre, Backups), standardmäßig an. `ONBOARDING=0` schaltet ihn beim Bauen ab. Das gilt fest für diese Version, gilt also auch für die APK (`node tools/build-apk.js` übernimmt die Variable). Mit Server-Verbindung greift zusätzlich die Einstellung des Servers (dort `ONBOARDING=0`). |

   Beispiel mit eigenem Logo: `APP_ICON=custom ICON_FILE=mein-logo.png npm run build:static`.
2. Den **Inhalt** von `dist/` auf einen Webspace oder eigenen Server mit **HTTPS** legen. Die App funktioniert auch in einem Unterordner (z. B. `https://example.org/gutkeeper/`).
3. Die Adresse auf dem Handy öffnen und die App installieren (siehe unten für Android und iPhone).

Wichtig: Wer die Web-App öffentlich im Internet anbietet, ist **Betreiber einer Website** und muss je nach Land Pflichtangaben wie ein Impressum und eine Datenschutzerklärung bereitstellen. Wer GutKeeper nur für sich oder die Familie hostet, sollte den Zugang schützen oder nicht öffentlich verlinken. Das ist keine Rechtsberatung.

### Auf Android installieren
Chrome öffnen, die Adresse aufrufen, Menü ⋮ → **App installieren** (oder **Zum Startbildschirm hinzufügen**).

### Auf dem iPhone / iPad installieren
1. Die Adresse in **Safari** öffnen. Ab iOS 16.4 geht es auch in anderen Browsern wie Chrome, am zuverlässigsten ist weiterhin Safari.
2. Auf **Teilen** tippen (Quadrat mit Pfeil nach oben).
3. **Zum Home-Bildschirm** wählen (ggf. im Menü nach unten scrollen) und mit **Hinzufügen** bestätigen.
4. Die App ab jetzt **über das neue Symbol auf dem Home-Bildschirm** öffnen, nicht mehr über Safari.

Gut zu wissen auf dem iPhone:
- Die installierte App und Safari haben **getrennte Speicher**. Trage Einträge erst nach dem Installieren ein. Was vorher in Safari gespeichert wurde, ist in der App nicht vorhanden (Ausweg: JSON-Backup in Safari erstellen und in der App importieren).
- iOS kann Website-Daten löschen, die lange nicht genutzt wurden. Bei einer **auf den Home-Bildschirm installierten** App ist das Risiko geringer, aber nicht null. Mach regelmäßig ein **JSON-Backup** (Optionen → Sicherung und Import) und speichere es z. B. in „Dateien“ oder iCloud.
- Die App aktualisiert sich, wenn sie mit Internet geöffnet wird und eine neue Version auf dem Server liegt. Manchmal braucht es dafür einen zweiten Start.

## Weg C: Android-App (APK) selbst bauen

Dafür verpackt [Capacitor](https://capacitorjs.com) die serverlose Version (`dist/`) in eine Android-App. Das richtet sich an Android-Nutzer, die einen PC haben und etwas Technik nicht scheuen. Für iPhones gibt es diesen Weg praktisch nicht (dafür bräuchte man einen Mac, Xcode und ein kostenpflichtiges Apple-Entwicklerkonto); iPhone-Nutzer nehmen Weg A oder B.

### Voraussetzungen
- **Node.js** 22 oder neuer
- **Android-SDK** und **JDK 21**, am einfachsten über **Android Studio** (https://developer.android.com/studio). Setze `ANDROID_HOME` auf den SDK-Ordner und `JAVA_HOME` auf das JDK.
- Ein Android-Handy mit aktiviertem **USB-Debugging** (nur zum direkten Testen, optional)

Das Android-Projekt (Capacitor 8) liegt fertig im Ordner `android-app/` dieses Repositorys. Die App läuft ab Android 7.0. Die App-ID ist `de.jamdevlab.gutkeeper`. Baust du eine eigene, abgewandelte App, ändere sie vorher in `android-app/capacitor.config.json` und `android-app/android/app/build.gradle` (`applicationId`), damit sie nicht mit der offiziellen App kollidiert.

### Debug-APK zum Testen
Im GutKeeper-Ordner:
```bash
cd android-app && npm ci && cd ..
node tools/build-apk.js
```
Das Skript baut die serverlose Version, kopiert sie nach `android-app/www`, synchronisiert Capacitor und ruft Gradle auf. Die APK liegt danach unter `android-app/android/app/build/outputs/apk/debug/app-debug.apk`. Optionen wie bei `build:static` gehen über Umgebungsvariablen, z. B. `APP_LANG=en node tools/build-apk.js`. Die Version kommt aus `package.json`: `versionName` wird z. B. `1.2.3`, `versionCode` wird `MAJOR*10000 + MINOR*100 + PATCH` (also 10203); das Skript trägt beides in `android/app/build.gradle` ein.

Eine Debug-APK ist mit einem Test-Schlüssel signiert. Zum Weitergeben ist sie nicht gedacht, und eine Release-APK lässt sich nicht über sie installieren (vorher deinstallieren, Daten vorher sichern).

### Schlüssel erstellen (einmalig)
Für eine Release-APK brauchst du einen eigenen Schlüssel (Keystore). Android erkennt Updates daran, dass sie mit demselben Schlüssel signiert sind.
```bash
keytool -genkeypair -v -keystore ~/gutkeeper-release.jks -alias gutkeeper -keyalg EC -groupname secp256r1 -validity 10000
```
`keytool` gehört zum JDK. Es fragt nach einem Passwort und nach Name/Organisation (frei wählbar, erscheint im Zertifikat).

> **Keystore und Passwort gut sichern (z. B. Passwortmanager plus Kopie auf einem zweiten Datenträger) und niemals ins Repository legen.** Ohne den Schlüssel kannst du keine Updates mehr veröffentlichen, die sich über die alte Version installieren lassen. Das Skript bricht ab, wenn der Keystore im Repository-Ordner liegt.

### Release-APK bauen
```bash
APK_KEYSTORE=~/gutkeeper-release.jks node tools/build-apk.js --release
```
Das Skript baut die unsignierte Release-APK, richtet sie aus (`zipalign`), signiert sie (`apksigner`) und prüft die Signatur. Das Passwort fragt `apksigner` im Terminal ab. Für automatische Builds kannst du es stattdessen in den Umgebungsvariablen `APK_KEYSTORE_PASS` (und bei abweichendem Schlüssel-Passwort `APK_KEY_PASS`) übergeben; ein anderer Alias geht über `APK_KEY_ALIAS`. Die fertige Datei liegt unter `android-app/android/app/build/outputs/apk/release/gutkeeper-<Version>.apk`.

### Update veröffentlichen
1. Version in `package.json` erhöhen (und im CHANGELOG eintragen).
2. `node tools/build-apk.js --release` wie oben.
3. Die APK z. B. als Datei an das GitHub-Release hängen.

### Icons und Startbild
`android-app/` enthält schon die Icons dieses Projekts. Für ein anderes Icon-Set: `node tools/android-style.js android-app classic` (oder `list`, `diary`, `shield`, `ring`, `crest`, `guard`, `bristol`; bei eigenen Icons die Hintergrundfarbe mit `BG=#RRGGBB`). Der App-Name steht in `android-app/android/app/src/main/res/values/strings.xml` (`app_name`).

### Auf dem Handy installieren
APK aufs Handy übertragen, öffnen und die Installation aus unbekannter Quelle erlauben.

### B und C: mit einem Server verbinden (App-Sync)
Die serverlose Web-App und die APK lassen sich nachträglich mit deinem GutKeeper-Server verbinden. Danach werden die Daten wie in Weg A zwischen den Geräten abgeglichen.

1. **Server erlauben:** Trage in der `.env` des Servers die Herkunft der App ein und starte den Container neu. Bei der Capacitor-APK ist das `CORS_ORIGINS=https://localhost`, bei der Web-App die Adresse, unter der du `dist/` bereitstellst (mehrere mit Komma trennen).
2. **In der App verbinden:** *Optionen → Speicher → Server-Verbindung → Mit Server verbinden*, die `https://`-Adresse des Servers eingeben (ein `http://`-Server ist aus einer HTTPS-App nicht erreichbar).
3. **Anmelden:** mit dem Passwort bzw. dem Konto des Servers. Die Einträge des Geräts werden zum Server übertragen. Die Anmeldung läuft per Token im Header (kein Cookie nötig).
4. **Sperre:** Die lokale App-Sperre (PIN, Fingerabdruck) gilt weiterhin und liegt vor der Anmeldung am Server. Das Server-Passwort wird nur einmal je Gerät gebraucht; die Sitzung bleibt bestehen, bis du dich abmeldest oder 180 Tage lang nichts benutzt wurde.
5. **Trennen:** *Optionen → Speicher → Server trennen*. Wahlweise lädst du dabei alles vom Server auf das Gerät oder behältst nur, was dort liegt.

Der Ablauf ist im Code umgesetzt, wurde aber noch **nicht mit einer echten APK getestet**.

### Server ohne HTTPS (http, z. B. im Heimnetz ohne Domain)
Die APK darf sich auch mit einem Server über **http** verbinden. Dafür baust du sie entsprechend: Im GutKeeper-Ordner `node tools/android-http.js` ausführen (setzt `android.allowMixedContent` in `android-app/capacitor.config.json` und `usesCleartextTraffic` im Manifest), danach `node tools/build-apk.js`. `node tools/android-http.js --off` stellt wieder auf nur HTTPS um. Im Repository ist standardmäßig nur HTTPS erlaubt. Beim Verbinden mit einer http-Adresse warnt die App einmal. Die App selbst bleibt unter `https://localhost`, deshalb funktionieren verschlüsselter Gerätespeicher, Ende-zu-Ende-Verschlüsselung, App-Sperre und Fingerabdruck weiter. Die **Verbindung zum Server ist aber unverschlüsselt**: Anmeldung und (ohne Ende-zu-Ende-Verschlüsselung) alle Einträge sind im Netz lesbar. Nutze das nur im vertrauenswürdigen Heimnetz. `CORS_ORIGINS=https://localhost` bleibt gleich. Nicht auf einem echten Gerät getestet.

### Hinweise zur APK
- **Backups:** In der App öffnen sich Backup- und PDF-Dateien über das **Teilen-Menü** von Android (Plugins `filesystem` und `share`). Speichere sie dort z. B. in „Dateien“ oder Google Drive. Diese Funktion ist im Code vorbereitet, wurde aber noch **nicht auf einem echten Gerät getestet**. Probiere also nach dem ersten Bau aus, ob JSON-Backup und PDF-Bericht funktionieren und sich wieder importieren lassen.
- **App-Sperre:** Unter *Optionen → Sicherheit* (mit Server-Verbindung ebenso) lässt sich eine PIN (4–12 Ziffern) festlegen. Sie sperrt die Oberfläche, wenn die App geöffnet wird oder nach 1 oder 5 Minuten im Hintergrund (einstellbar). Die Einträge werden dadurch **nicht verschlüsselt**; die PIN schützt vor neugierigen Blicken, nicht vor Zugriff auf den App-Speicher. Nach 5 Fehlversuchen wächst die Wartezeit. **Vergessene PIN:** Mit Server-Verbindung meldest du dich über „PIN vergessen?“ mit dem Server-Passwort an, dann wird die PIN entfernt. Ohne Server-Verbindung hilft nur, die App-Daten zu löschen (Deinstallieren); mach also vorher ein Backup. Fingerabdruck/Gesicht läuft in der APK über das Plugin `@aparajita/capacitor-biometric-auth` (die WebView kennt die Browser-Funktion WebAuthn nicht). Es braucht einen eingerichteten Fingerabdruck oder ein Gesicht in den Android-Einstellungen, sonst bleibt der Schalter ausgegraut und es gilt nur die PIN.
- **Backup-Erinnerung und automatisches Backup:** Unter *Optionen → Sicherung und Import → Erinnerung und Automatik* stellst du ein, ob die App beim Öffnen an ein Backup erinnert (Aus, nach 7, 14 oder 30 Tagen oder eigener Wert; dazu ein roter Punkt am Tab „Optionen“ und an den Stellen zum Antippen). In der APK gibt es zusätzlich ein **automatisches Backup** (täglich oder wöchentlich): Die App schreibt beim Öffnen eine JSON-Datei in den Ordner *Dokumente/GutKeeper* und behält die letzten 3, 5, 10, 20 oder eine eigene Anzahl (ältere werden gelöscht). Die Dateien bleiben auch nach dem Deinstallieren erhalten. Ohne Passwort sind sie **nicht verschlüsselt**; unter „Verschlüsselung → Mit Passwort“ legst du einmal ein Backup-Passwort fest, danach wird jede Datei damit verschlüsselt (AES-256-GCM, wie „Mit Passwort“ beim Export). Die App speichert nur den daraus abgeleiteten, nicht auslesbaren Schlüssel, nie das Passwort; beim Import fragt sie danach. Ob Android das Schreiben in „Dokumente“ ohne Rückfrage erlaubt, hängt von der Android-Version ab; schlägt es fehl, steht der Fehler dort und „Jetzt sichern“ probiert es erneut. Das wurde **noch nicht auf einem echten Gerät getestet**.
- **Vorschau verbergen:** Unter *Optionen → Sicherheit* blendet die App ihren Inhalt im App-Wechsler von Android aus (das Plugin `@capacitor-community/privacy-screen`). Screenshots sind dann ebenfalls gesperrt.
- **Zurück-Taste und Wischgeste:** Sie schließen zuerst Fenster und Unterseiten der Optionen, dann führen sie zum Tab „Erfassen“; erst von dort beendet die Geste die App. Dafür nutzt die APK das Plugin `@capacitor/app`.
- **Eigene Plugins:** Zwei kleine Plugins sind Teil von GutKeeper (Java, `android-app/android/app/src/main/java/de/jamdevlab/gutkeeper/`, kein fremder Code): `AppIcon` wechselt das Icon auf dem Startbildschirm, `ImageSaver` speichert das Rückblick-Bild über den MediaStore unter *Bilder/GutKeeper*, damit es in der Galerie erscheint (ab Android 10 ohne Berechtigung; auf älteren Geräten landet es unter *Dokumente/GutKeeper*).
- **Android-Backup:** `android:allowBackup` ist in `android-app/android/app/src/main/AndroidManifest.xml` auf `false` gesetzt: Android sichert den App-Speicher (Gesundheitsdaten) nicht in das Google-Konto. Für den Umzug gibt es *Optionen → Gerät wechseln* bzw. das **Backup aus der App**.
- **Datenverlust:** Deinstallierst du die App oder löschst ihren Speicher, sind die Einträge weg. Mach regelmäßig ein JSON-Backup.
- **Lizenzen:** Capacitor steht unter der MIT-Lizenz. Wenn du die APK weitergibst, lege den Lizenztext von Capacitor und seinen Plugins bei (siehe [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md)). GutKeeper selbst steht unter der [AGPL-3.0](../LICENSE). Wenn du die APK weitergibst, gilt das auch für sie: Quellcode (inkl. deiner Änderungen) bereitstellen.
- **Quellcode:** Das Android-Projekt liegt in `android-app/`. Keystore, Passwörter und `local.properties` dürfen nie veröffentlicht werden (`.gitignore` schließt `*.jks`, `*.keystore` und `local.properties` aus).
