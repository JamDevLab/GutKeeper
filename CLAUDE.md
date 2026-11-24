# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

GutKeeper (German subtitle in the German README: DarmWächter) is a self-hosted bowel diary PWA with offline support, multi-device sync, statistics and PDF reports. Licensed AGPL-3.0. Code comments are in **German**. User docs come in pairs, English first: `X.md` is English (default on GitHub), `X.de.md` German (README, CHANGELOG, `docs/*`); `SECURITY.md`, `CONTRIBUTING.md` and `THIRD-PARTY-NOTICES.md` hold both languages, English first. Keep new code comments in German to match. Server log and CLI output is bilingual: use `server/log.js` (`info/warn/error(de, en)`: German line, then English line); tests match the German text. Compose files and `.env.example` are commented in English.

**Zero dependencies:** there is no `node_modules` and no build step for the UI. The server uses only Node built-ins, including `node:sqlite` (experimental in Node 22, so it needs Node >= 22.13 and `--disable-warning=ExperimentalWarning`). Do not add npm packages.

## Commands

```bash
npm start                 # server on PORT (default 3000), data in ./data
npm run dev               # --watch, ALLOW_ANY=1 (no private-network restriction)
npm test                  # all tests (node:test); CI runs it on Node 22 and 24
npm run build:static      # serverless build into dist/ (env: APP_LANG, APP_ICON, APP_NAME, ICON_FILE, OUT …)
```

- `npm run dev` uses a POSIX `ALLOW_ANY=1 …` prefix. In PowerShell run `$env:ALLOW_ANY='1'; node --disable-warning=ExperimentalWarning --watch server/index.js` instead.
- `tests/consistency.test.js` checks that every `t('…')` string has an English entry in `lang-en.js`, that every `public/js/*.js` is listed in the service worker `SHELL`, and that all client modules parse.
- `npm test` lists the test files explicitly (no glob). A new `tests/*.test.js` must be added to the `test` script in `package.json`, or it never runs.
- Run a single test file: `node --disable-warning=ExperimentalWarning --test tests/e2ee.test.js`. A single test: add `--test-name-pattern="<part of name>"`.
- Set `DEBUG_SERVER=1` to see server output during `tests/server.test.js`. The test helpers start servers with `NO_AUTH=1` (no login); tests of the real login flow pass `AUTH: '1'` to `start()` and read the one-time setup code from the log (`s.token`). `npm run dev` runs with auth: take the setup code from the console on first start.
- Admin CLI: `node server/cli.js list-users | reset-password [NAME] [PW] | logout-all [NAME] | decrypt FILE OUT [PW]` (single-user: no NAME; without PW the password is read from stdin).
- Docker: `docker compose up -d` pulls `ghcr.io/jamdevlab/gutkeeper:1`. The root `docker-compose.yml` is deliberately short (hardening plus `TZ`, `MULTIUSER`, `FOOD_DEFAULT`, `CORS_ORIGINS`, `BACKUP_KEEP`, `BACKUP_PASSWORD` from `.env`; backups stay in `./data/backups`); `compose/all-options.yml` passes every option from `.env.example`, so a new env var goes there (and into `.env.example`, `server/config.js`, docs/CONFIGURATION). The README quick start and `compose/quickstart.yml` show the same minimal `compose.yml`; build from source with `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build`. Releases (Docker image, signed APK, web zip) come from `.github/workflows/release.yml` on a `v*.*.*` tag.

## Architecture

### Server (`server/`, CommonJS)
- `index.js`: the plain `node:http` server. It handles routing for `/api/*`, static files, security headers/CSP, gzip, CORS (for the standalone/APK app via `CORS_ORIGINS` + Bearer token) the private-network check (disabled by `ALLOW_ANY=1`; `TRUST_PROXY` makes it use `X-Real-IP`, `TRUSTED_PROXY` limits which proxies are believed) and the Host check against DNS rebinding (`ALLOWED_HOSTS`: enforced only when set, or with `NO_AUTH=1`, where only IPs/localhost pass). `index.html` and `manifest.webmanifest` are **templates**: placeholders such as `__APP_NAME__`, `__LANG__` and `__ICONS__` are filled per language, and the language comes from `Accept-Language`.
- `config.js`: all configuration comes from environment variables only.
- `db.js`: SQLite schema (accounts, entries, foods; created in one go, there are no migrations yet), input validation (`clean`, `cleanFood`) and prepared queries (`q` for entries, `qf` for food, `U` for users). The file is `data/gutkeeper.db`, server backups are `gutkeeper-<stamp>-<tag>.db`.
- `sync.js`: the sync protocol. Each account has a monotonically increasing `seq` per table and an `epoch`. The client sends `since`/`changes` (and `foodSince`/`foodChanges`), and the newer `updated_at` wins. If the epoch differs (after "delete all data"), the client gets a reset. `minDate` limits the response for devices that store only the last N months, and `drops` tells those devices which entries to evict. The E2EE mode must match between device and account.
- `auth.js`: password login (single-user: owner account 1, hidden name `_owner`; multi-user: name + password), set up on first start with a one-time code from the server log (`needsSetup`/`/api/setup`), scrypt hash in the DB, no password in env vars. Sessions are sliding signed HttpOnly cookies (180 days, re-issued by `renewHeaders` when older than a day; `X-Session-Token` for Bearer clients), `token_ver` bump ends all sessions. Rate limiting by IP/account (global `owner` key in single-user). `NO_AUTH=1` (tests only) disables auth. `e2ee.js` stores the wrapped data key; `crypto-wrap.js` handles password-encrypted exports and backups; `backups.js` makes daily DB copies in `data/backups/`.

**Invariant:** every SQL query on `entries`/`foods` must filter by `user_id`, and the account comes only from the session, never from the request body. `tests/server.test.js` scans the source for any query that breaks this. Mark intentional exceptions with `/*global*/`.

### Client (`public/js/`, native ES modules, no bundler)
- `app.js` is the entry point. `state.js` exports the shared mutable state object `S`, because ES module imports can't be reassigned.
- `store.js` holds local storage and the sync loop. `vault.js` keeps local data encrypted in IndexedDB (AES-GCM, non-extractable device key) when the page is a secure context, and falls back to localStorage otherwise. `cipher.js` contains the shared crypto and also runs in Node (the tests import it). `e2ee.js`/`e2ee-ui.js` handle optional end-to-end encryption: when it is on, rows carry an encrypted `blob` and neutral plaintext fields.
- `nav.js` ties the back button/swipe gesture to layers (overlays via `openOverlay`, options sub-pages and non-capture tabs via `syncNav` in `ui.js`); `applock.js` is the optional local PIN lock of this device in every mode (never sent to the server), shown through `showLock` in `auth.js`; the server login (`showLogin`) and first-run `showSetup` live there too and are independent of the PIN.
- `onboarding.js` is the guided first-run dialog, on by default (server `ONBOARDING=0` turns it off via `/api/config`; `build-static.js`/`build-apk.js` add the `gutkeeper-onboarding` meta tag unless `ONBOARDING=0`). `autobackup.js` is the APK-only automatic backup on app open (Documents/GutKeeper, files `gutkeeper-auto-…`, interval and number kept are presets or a custom value, optional password: only the derived key is stored; when a password is set the user is asked whether old plaintext auto-backups get deleted). `bkprefs.js` holds the backup reminder (`backupDue` drives the red dot on the Options tab, the menu row and the save button).
- `data.js` renders the Options tab (home menu with search, sub-pages in `pages`). `admin.js` also exports the shared dialogs (`askSheet` with inline `check` validation, `askNewPin`, `askAutoPassword`, `askWhole`). `transfer.js` does export/import files (in the APK via Filesystem + Share sheet), `importcheck.js` validates imported rows, `native.js` wraps Capacitor plugins.
- `remote.js` loads older periods live from the server, keeps them in memory only and never writes them to storage.
- `net.js` detects the static build (meta tag) and an optional server connection. In the static build there is no server, no login and no sync (the local app lock still works).
- Version compatibility: `build-static.js` bakes the `package.json` version into a meta tag, the server reports its own version via `config.js`, and `version.js` (`versionMismatch`) warns when the app is newer (minor) or on a different major version. A breaking API/sync change therefore means a major version bump.
- **i18n:** UI strings are written in German directly in the code and wrapped in `t('…')`. `lang-en.js` maps each German string to its English translation (`export const T = {`, one `"de": "en",` per line; `server/langs.js` parses that format). When you add or change a UI string, add or update the matching key in `lang-en.js`. Languages are listed in `langs.js` (code, name, locale); any further language is a `lang-<code>.js` file loaded on demand by `i18n.js` (top-level `await import`), with English as fallback for missing strings. Server and static build discover languages from the `lang-*.js` files; unknown browser languages get English. CSV headers and file names stay German (`isDe`) or English. Don't use `LANG === 'en'` checks; use `LOC`, `isDe` or a field in `langs.js`. Steps for contributors: docs/DEVELOPMENT, "Adding a language". CSV import accepts German and English headers and values.
- Local storage keys use the fixed `gutkeeper.` prefix; do not rename it, or installed apps lose their data.

### Service worker
`public/sw.js` serves the files listed in `SHELL` cache-first. When you add a JS file, add it to `SHELL`. The cache name is never edited by hand: the placeholder `__CACHE_VERSION__` is filled with `<package version>-<8-char hash of all SHELL files>` by the server (when serving `/sw.js`, recomputed when a file's mtime changes) and by `build-static.js` (both via `server/swcache.js`), so any client file change makes installed clients update.

### Other
- The READMEs are kept short. Details live in `docs/CONFIGURATION`, `docs/DATA` and `docs/DEVELOPMENT` (plus `docs/INSTALLATION`), each in English (`.md`) and German (`.de.md`), like the READMEs. Keep the two languages in sync, and check links and anchors when you move text.
- `tools/make-social.js` renders the GitHub social preview `docs/social-preview.png` (1280x640) from `docs/screenshots/en/uebersicht.png`; layout and texts are plain HTML/CSS inside the script. Run with `TMPDIR=~/workspace/.t` (no /tmp).
- The recap images (`public/js/rewind.js`, canvas 1080x1350, 80 px margins) are rendered by `tools/make-screenshots.js` as `docs/screenshots/rueckblick*.png` (tracked) for checking layout.
- `tools/make-screenshots.js` regenerates `docs/screenshots/` (dark mode by default, start page also light, `uebersicht.png` is the composite used in the README; only the two overview images are tracked in git). It needs a local Chrome/Edge (or `CHROME=<path>`), starts a throwaway server with `docs/demo-data.csv` and drives the browser over the DevTools protocol, with no npm packages.
- `android-app/` is the Capacitor Android project (own package.json with Capacitor deps, `npm ci` there; `www/`, `node_modules/`, build outputs and keystores are ignored). Defaults are HTTPS-only and `allowBackup="false"`.
- `tools/android-http.js [app folder] [--off]` lets the Android app talk to an http server (mixed content + cleartext), `--off` reverts; the app warns before connecting.
- `tools/build-apk.js [app folder, default android-app] [--release]` builds the serverless version, copies it into the Capacitor project, syncs and runs Gradle (JAVA_HOME = JDK 21, ANDROID_HOME). Version name/code come from `package.json`. without `--release` it is a side-by-side test app (`applicationIdSuffix ".dev"`, name "GutKeeper Dev" from `src/debug/res`, `APK_DEV=1` meta tag so auto-backups go to `Documents/GutKeeper Dev`). `--release` signs with zipalign + apksigner using `APK_KEYSTORE` (outside the repo) and optional `APK_KEYSTORE_PASS`/`APK_KEY_PASS`/`APK_KEY_ALIAS` env vars; never put keys or passwords in files.
- `tools/android-style.js <app folder>` puts the project's icons and a plain splash screen into a Capacitor Android project.
- `tools/build-static.js` copies `public/` to `dist/`, fills the templates and picks the icon set. `tools/make-icons.js [set …]` generates the eight built-in icon sets (SVG motifs with named geometry constants, rendered with local Chrome/Edge; run with `TMPDIR=~/workspace/.t`).
- New versions: bump `package.json` (and `android-app/package.json`), add `## X.Y.Z` to both changelogs, run `npm test`, commit "Release X.Y.Z", tag `vX.Y.Z` (annotated); pushing the tag runs the release workflow. The maintainer keeps a local skill `.claude/skills/release` (not in git) with the full checklist.
- Record user-visible changes in both `CHANGELOG.md` (English) and `CHANGELOG.de.md` (German), same `## <version>` headings; the release workflow puts both into the release notes, English first. The version lives in `package.json`.

## Design guidelines

- **Colors (dark theme, also used for shared images):** background `#0f1514`, cards/surfaces `#18221f`, accent `#4fa68c` (light theme accent `#2f6f5e`), text `#e8efed`, muted text `#93a5a0`, empty/inactive `#26332f`. Icon background ("Bristol-Grün") `#1f3d36`, cream `#f4f1ea`.
- **Bristol type colors 1–7** (icon dots, recap "Typen"): `#8b5a33 #b07a3e #6fa577 #2f9a72 #d9a62e #e07b2c #c9503f`. Use them only for stool types, not as decoration elsewhere.
- **Style:** flat surfaces, rounded corners, no glows, radial "shimmer" or decorative gradients (they look generic). Hierarchy through size and weight, not color effects. Equal outer margins on all sides; check generated images visually (`tools/make-screenshots.js`, `tools/make-social.js`).
- **Tone:** factual, neutral wording; no jokes or judgement about health data. Every new UI string also needs a natural English entry in `lang-en.js`.
