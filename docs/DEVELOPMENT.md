# Development

**English** · [Deutsch](DEVELOPMENT.de.md)

[Back to the README](../README.md)

## Project structure

```
server/         Node server (config, db, auth, sync, backups, storage, icons, crypto-wrap, index)
server/cli.js   Server administration (accounts, password, sign out sessions, decrypt)
public/         User interface (index.html, style.css, sw.js, manifest)
public/js/      ES modules without a bundler (entry point app.js; storage and sync in store.js, encryption
                in cipher/vault/e2ee, options in data.js, English texts in lang-en.js)
public/icons/   Built-in app icons (eight sets: bristol, ring, guard, crest, classic, shield, list, diary)
android-app/    Capacitor project for the Android app (APK)
compose/        Docker Compose templates (quick start, multiple accounts, reverse proxy)
tests/          Tests for server, sync, encryption and consistency (npm test)
tools/          Helper scripts (serverless version, build APK, icons, README screenshots)
docs/           Screenshots, sample data, example report, installation guide
data/           Database and backups (not in the repository)
```

The interface needs no build step and no dependencies. The server uses the SQLite module `node:sqlite` built into Node, so no extra packages are needed. It is still marked experimental in Node 22 and is a release candidate from Node 24.15. The Dockerfile uses `node:24-alpine`; after a Node update a short test (`npm test`) is worthwhile.

Development: `npm run dev` starts the server with restart on changes and without network restriction (`ALLOW_ANY=1`).

## Tests

`npm test` runs all tests (`node:test`, no extra packages). To run one test file, use `node --disable-warning=ExperimentalWarning --test tests/e2ee.test.js`; for a single test, add `--test-name-pattern="<part of name>"`. `npm test` lists the test files explicitly, so a new `tests/*.test.js` must be added to the `test` script in `package.json`, or it never runs.

## Translations

UI strings are written in German directly in the code and wrapped in `t('…')`. The English text for each string is in `public/js/lang-en.js`. When you add or change a UI string, add or update the matching key there. `tests/consistency.test.js` checks that every `t('…')` string has an English entry.

## Helper scripts (`tools/`)

- `build-static.js`: builds the serverless version into `dist/` (`npm run build:static`).
- `build-apk.js`: builds the Android APK in one step (serverless build, Capacitor sync, Gradle); `--release` signs it with your own keystore.
- `android-http.js`: lets the Android app connect to an http server (`--off` reverts it).
- `android-style.js`: puts the project's icons and a plain splash screen into a Capacitor Android project.
- `make-icons.js`: generates the built-in app icon sets (needs Chrome or Edge).
- `make-screenshots.js`: renders the screenshots and the example report in `docs/screenshots/` (needs Chrome or Edge).
- `make-social.js`: renders the GitHub social preview image `docs/social-preview.png`.
