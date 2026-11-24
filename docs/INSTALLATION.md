# Installing GutKeeper: three ways

**English** · [Deutsch](INSTALLATION.de.md)

GutKeeper comes in three variants. They use the same code but differ in where the data lives and how much technical effort you need.

| | **A: With server** | **B: Web app without server** | **C: Android app (APK)** |
|---|---|---|---|
| For whom | Tech-savvy users with a home server, NAS or Raspberry Pi | Anyone who can put files on web space; the only serverless option for iPhones | Android users who want a "real" app without hosting |
| Effort | medium (Docker) | low to medium | high (PC, Android Studio) |
| Data lives | on the server, with a copy on each device | only on the device | only on the device |
| Several devices in sync | yes | only when connected to a server ([see below](#b-and-c-connect-to-a-server-app-sync)) | only when connected to a server ([see below](#b-and-c-connect-to-a-server-app-sync)) |
| Server backups, accounts | yes | only when connected to a server | only when connected to a server |
| Sign-in / lock | server password (or accounts), plus optional local PIN | local PIN (optional) | local PIN (optional) |
| Android | yes (via browser, installable) | yes (via browser, installable) | yes |
| iPhone | yes (via Safari, "Add to Home Screen") | yes (via Safari, "Add to Home Screen") | no |

## Way A: With server (Docker)

See the [quick start in the README](../README.md#quick-start-docker). The server stores all entries, creates daily backups and syncs several devices. To install the app on a phone the address needs **HTTPS**; instructions are in the [Configuration](CONFIGURATION.md#setting-up-https).

On first start the server log shows a **one-time code** (`docker compose logs`). Open the app, enter the code and set your **password** (with `MULTIUSER=1` the first account). There is no password in `.env`; you sign in once per device, after which the device stays signed in until you sign out. You set up a **PIN or fingerprint** for the individual device under *Settings → Security* (it stays local on the device). Forgot the password: `docker compose exec gutkeeper node server/cli.js reset-password` (with multiple accounts add the name; the command asks for the new password or you append it). An enabled end-to-end encryption is not affected: its key depends on the recovery code, not on the password. To start over completely, use *Settings → Delete data → Delete account*: the server then starts over at setup, with a new one-time code in the log.

To reach the server by a name no extra setting is needed (names are allowed). With `ALLOWED_HOSTS=gutkeeper.fritz.box,gutkeeper.example.org` in `.env`, only these names plus IP addresses and `localhost` are accepted (protection against DNS rebinding).

Behind a reverse proxy, set `TRUST_PROXY=1` and also `TRUSTED_PROXY` to the proxy's address(es) (IP or subnet, e.g. `TRUSTED_PROXY=172.18.0.0/16`). Only requests from there are believed for `X-Real-IP` and `X-Forwarded-Proto`; without `TRUSTED_PROXY` any private address counts as a proxy.

## Way B: Web app without server

1. On a computer with Node.js (version 22.13 or newer), run in the project folder:
   ```bash
   npm run build:static
   ```
   This creates the `dist/` folder. Optionally set name, language, icon and color, e.g. `APP_NAME="My Diary" npm run build:static`:

   | Variable | Meaning |
   |---|---|
   | `APP_NAME` | your own name (otherwise GutKeeper) |
   | `APP_LANG` | `de` or `en`: default language (otherwise the app follows the browser) |
   | `APP_ICON` | `bristol`, `ring`, `guard`, `crest`, `classic`, `shield`, `list`, `diary` or `custom` |
   | `ICON_FILE` | with `custom`: your square PNG, at least 512×512 px |
   | `ICON_MASKABLE_FILE` | optional: image for round Android icons (motif within the inner 60 %) |
   | `APP_THEME_COLOR` | title bar color, e.g. `#2f6f5e` |
   | `ONBOARDING` | Guided first-run dialog (once per device; appearance, food, app lock, backups), on by default. `ONBOARDING=0` at build time turns it off. It is fixed at build time, so it also applies to the APK (`node tools/build-apk.js` passes the variable on). With a server connection the server's setting (`ONBOARDING=0` there) applies as well. |

   Example with your own logo: `APP_ICON=custom ICON_FILE=my-logo.png npm run build:static`.
2. Put the **contents** of `dist/` on a web space or your own server with **HTTPS**. The app also works in a subfolder (e.g. `https://example.org/gutkeeper/`).
3. Open the address on your phone and install the app (see below for Android and iPhone).

Important: Anyone who offers the web app publicly on the internet is the **operator of a website** and, depending on the country, may have to provide mandatory information such as an imprint and a privacy policy. If you only host GutKeeper for yourself or your family, protect access or do not link to it publicly. This is not legal advice.

### Install on Android
Open Chrome, go to the address, menu ⋮ → **Install app** (or **Add to Home screen**).

### Install on iPhone / iPad
1. Open the address in **Safari**. From iOS 16.4 it also works in other browsers such as Chrome; Safari is still the most reliable.
2. Tap **Share** (square with an arrow pointing up).
3. Choose **Add to Home Screen** (scroll down in the menu if needed) and confirm with **Add**.
4. From now on open the app **via the new icon on the Home Screen**, no longer via Safari.

Good to know on iPhone:
- The installed app and Safari have **separate storage**. Enter entries only after installing. What was saved earlier in Safari is not available in the app (workaround: create a JSON backup in Safari and import it in the app).
- iOS may delete website data that has not been used for a long time. For an app **installed on the Home Screen** the risk is lower but not zero. Make a **JSON backup** regularly (Settings → Backup and import) and keep it, e.g., in "Files" or iCloud.
- The app updates when it is opened with internet access and a new version is on the server. Sometimes it takes a second launch.

## Way C: Build the Android app (APK) yourself

[Capacitor](https://capacitorjs.com) packages the serverless version (`dist/`) into an Android app. This is for Android users who have a PC and don't shy away from some technical work. For iPhones this way is practically not an option (it would need a Mac, Xcode and a paid Apple developer account); iPhone users should use way A or B.

### Requirements
- **Node.js** 22 or newer
- **Android SDK** and **JDK 21**, most easily via **Android Studio** (https://developer.android.com/studio). Set `ANDROID_HOME` to the SDK folder and `JAVA_HOME` to the JDK.
- An Android phone with **USB debugging** enabled (only for direct testing, optional)

The ready-made Android project (Capacitor 8) lives in the `android-app/` folder of this repository. The app runs on Android 7.0 and later. The app ID is `de.jamdevlab.gutkeeper`. If you build your own, modified app, change it first in `android-app/capacitor.config.json` and `android-app/android/app/build.gradle` (`applicationId`) so it does not collide with the official app.

### Debug APK for testing
In the GutKeeper folder:
```bash
cd android-app && npm ci && cd ..
node tools/build-apk.js
```
The script builds the serverless version, copies it to `android-app/www`, syncs Capacitor and runs Gradle. The APK is then at `android-app/android/app/build/outputs/apk/debug/app-debug.apk`. Options as with `build:static` are passed through environment variables, e.g. `APP_LANG=en node tools/build-apk.js`. The version comes from `package.json`: `versionName` becomes e.g. `1.2.3`, `versionCode` becomes `MAJOR*10000 + MINOR*100 + PATCH` (10203); the script writes both into `android/app/build.gradle`.

A debug APK is signed with a test key and is not meant for distribution. It installs as a separate app next to the release app: app ID `de.jamdevlab.gutkeeper.dev`, name "GutKeeper Dev", its own local data and its own folder for automatic backups (`Documents/GutKeeper Dev`). Neither app touches the other's data, so you can test while you keep using the signed app.

- Test with your data: export a backup in the signed app and import it in GutKeeper Dev.
- Do not connect GutKeeper Dev to the server account you use every day. Test changes would sync to your real data, and actions such as "Delete all data" or switching end-to-end encryption on or off would reach all your devices. Use a separate test account or a test server instead.
- Debug builds allow WebView debugging: with the phone connected over USB, `chrome://inspect` on a computer shows the console and the performance tools.

### Create a key (once)
For a release APK you need your own key (keystore). Android recognizes updates by their being signed with the same key.
```bash
keytool -genkeypair -v -keystore ~/gutkeeper-release.jks -alias gutkeeper -keyalg EC -groupname secp256r1 -validity 10000
```
`keytool` is part of the JDK. It asks for a password and for name/organization (your choice, shown in the certificate).

> **Keep the keystore and its password safe (e.g. password manager plus a copy on a second storage medium) and never put them in the repository.** Without the key you can no longer publish updates that install over the old version. The script aborts if the keystore is inside the repository folder.

### Build a release APK
```bash
APK_KEYSTORE=~/gutkeeper-release.jks node tools/build-apk.js --release
```
The script builds the unsigned release APK, aligns it (`zipalign`), signs it (`apksigner`) and verifies the signature. `apksigner` asks for the password in the terminal. For automated builds you can pass it instead in the environment variables `APK_KEYSTORE_PASS` (and `APK_KEY_PASS` if the key password differs); a different alias goes in `APK_KEY_ALIAS`. The finished file is at `android-app/android/app/build/outputs/apk/release/gutkeeper-<version>.apk`.

### Publishing an update
1. Raise the version in `package.json` (and add it to `CHANGELOG.md` and `CHANGELOG.de.md`).
2. Run `node tools/build-apk.js --release` as above.
3. Attach the APK, e.g. as a file on the GitHub release.

### Icons and splash screen
`android-app/` already contains this project's icons. For a different icon set: `node tools/android-style.js android-app classic` (or `list`, `diary`, `shield`, `ring`, `crest`, `guard`, `bristol`; for your own icons give the background color with `BG=#RRGGBB`). The app name is in `android-app/android/app/src/main/res/values/strings.xml` (`app_name`).

### Install on the phone
Transfer the APK to the phone, open it and allow installation from unknown sources.

### B and C: connect to a server (app sync)
The serverless web app and the APK can be connected to your GutKeeper server later. The data is then synced between devices as in way A.

1. **Allow the app on the server:** In the server's `.env`, enter the app's origin and restart the container. For the Capacitor APK this is `CORS_ORIGINS=https://localhost`; for the web app it is the address where you host `dist/` (separate several with commas).
2. **Connect in the app:** *Settings → Storage → Server connection → Connect to server*, enter the server's `https://` address (an `http://` server cannot be reached from an HTTPS app).
3. **Sign in:** with the server's password or account. The device's entries are sent to the server. Sign-in works with a token in the header (no cookie needed).
4. **Lock:** The local app lock (PIN, fingerprint) still applies and comes before the server sign-in. The server password is only needed once per device; the session lasts until you sign out or nothing was used for 180 days.
5. **Disconnect:** *Settings → Storage → Disconnect server*. You can load everything from the server onto the device or keep only what is already there.

The flow is implemented in the code but has **not been tested with a real APK yet**.

### Server without HTTPS (http, e.g. home network without a domain)
The APK may also connect to a server over **http**. For this you build it accordingly: in the GutKeeper folder run `node tools/android-http.js` (sets `android.allowMixedContent` in `android-app/capacitor.config.json` and `usesCleartextTraffic` in the manifest), then `node tools/build-apk.js`. `node tools/android-http.js --off` switches back to HTTPS only. By default the repository allows only HTTPS. When you connect to an http address the app warns once. The app itself stays on `https://localhost`, so the encrypted device storage, end-to-end encryption, app lock and fingerprint keep working. The **connection to the server is unencrypted**, though: sign-in and (without end-to-end encryption) all entries can be read on the network. Only use this on a trusted home network. `CORS_ORIGINS=https://localhost` stays the same. Not tested on a real device.

### Notes on the APK
- **Backups:** In the app, backup and PDF files open via the Android **share menu** (plugins `filesystem` and `share`). Save them there, e.g., to "Files" or Google Drive. This feature is prepared in the code but has **not yet been tested on a real device**. After the first build, try whether the JSON backup and PDF report work and can be imported again.
- **App lock:** Under *Settings → Security* (also with a server connection) you can set a PIN (4–12 digits). It locks the interface when the app opens or after 1 or 5 minutes in the background (adjustable). This does **not encrypt** the entries; the PIN protects against prying eyes, not against access to the app storage. After 5 wrong attempts the waiting time grows. **Forgotten PIN:** with a server connection choose "Forgot PIN?" and sign in with the server password; the PIN is then removed. Without a server connection the only way out is to clear the app data (uninstall), so make a backup first. In the APK, fingerprint/face works through the plugin `@aparajita/capacitor-biometric-auth` (the WebView does not know the browser feature WebAuthn). It needs a fingerprint or face set up in the Android settings; otherwise the switch stays greyed out and only the PIN applies.
- **Backup reminder and automatic backup:** Under *Settings → Backup and import → Reminder and automation* you choose whether the app reminds you of a backup when it opens (off, after 7, 14 or 30 days, or a custom value; plus a red dot on the "Settings" tab and on the places you tap). The APK also offers an **automatic backup** (daily or weekly): when the app opens it writes a JSON file to the folder *Documents/GutKeeper* and keeps the last 3, 5, 10, 20 or a custom number (older ones are deleted). The files survive uninstalling. Without a password they are **not encrypted**; under "Encryption → With password" you set a backup password once, and from then on every file is encrypted with it (AES-256-GCM, like "With password" on export). The app stores only the derived key, which cannot be read out, never the password; it asks for the password on import. Whether Android lets the app write to "Documents" without asking depends on the Android version; if it fails, the error is shown there and "Back up now" tries again. This has **not been tested on a real device yet**.
- **Hide preview:** Under *Settings → Security* the app hides its content in the Android app switcher (the plugin `@capacitor-community/privacy-screen`). Screenshots are then blocked as well.
- **Back button and swipe gesture:** They first close windows and sub-pages of the options, then lead to the "Log" tab; only from there does the gesture close the app. For this the APK uses the plugin `@capacitor/app`.
- **Own plugins:** Two small plugins are part of GutKeeper (Java, `android-app/android/app/src/main/java/de/jamdevlab/gutkeeper/`, no third-party code): `AppIcon` switches the home screen icon, and `ImageSaver` saves the recap image through the MediaStore to *Pictures/GutKeeper* so it shows up in the gallery (no permission needed on Android 10 and later; older devices save it to *Documents/GutKeeper*).
- **Android backup:** `android:allowBackup` is set to `false` in `android-app/android/app/src/main/AndroidManifest.xml`: Android does not back up the app storage (health data) to your Google account. For moving to a new device use *Settings → Switch device* or the **backup from the app**.
- **Data loss:** If you uninstall the app or clear its storage, the entries are gone. Make a JSON backup regularly.
- **Licenses:** Capacitor is under the MIT license. If you distribute the APK, include the license text of Capacitor and its plugins (see [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md)). GutKeeper itself is under the [AGPL-3.0](../LICENSE). If you distribute the APK this applies to it too: make the source code (including your changes) available.
- **Source code:** The Android project lives in `android-app/`. Keystore, passwords and `local.properties` must never be published (`.gitignore` excludes `*.jks`, `*.keystore` and `local.properties`).
