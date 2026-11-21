# Changelog

**English** · [Deutsch](CHANGELOG.de.md)

## 1.0.0

First release.

- **Logging** in seconds on one screen: consistency (Bristol scale), urgency, amount, color, pain, blood, mucus, gas and a note with editable tags; optional **food** with meal, suggestions and pinned foods. No entries in the future.
- **History** with filters, **year overview** and **statistics:** key figures compared with the previous period, share of normal stools (type 3–4), an expandable "Notable entries" tile that jumps to the filtered history, stools per day/week, average consistency over time, time of day, weekday and calendar. Tapping the already open History or Statistics tab scrolls to the top. **Share a recap:** an image of the last 7 days, the last month, the last year (52 full weeks; each up to yesterday so only completed days count) or a custom period, in five designs you can swipe through (overview, overview with scale, shapes, time of day, calendar), to share or save as an image. The image leaves out blood, mucus, pain, color, food and notes.
- **PDF report** generated in the browser: the same analyses in every size, entries short (notable ones only), normal or detailed; optional name and date of birth, food, black and white, and password protection (AES-256).
- **Offline first** with sync between several devices; older entries are loaded live from the server when needed.
- **Sign-in and security:** server password with a one-time code during setup, optional multiple accounts (admin, temporary passwords, delete account), app lock with PIN and fingerprint/face, encrypted device storage and optional end-to-end encryption. Protection against DNS rebinding, private networks only, rate limiting against password guessing.
- **Backups:** daily server backups (optionally encrypted), JSON/CSV export and import with preview, export with password, backup reminder; in the Android app an automatic backup to the Documents folder (optionally with password).
- **Works without a server** as a web app or **Android app (APK)**; the app can connect to a server (also over http on the home network). In the Android app you can switch the home screen icon.
- **Eight built-in icons** (`APP_ICON`): Bristol, ring, guard, crest, classic, shield, list and diary, all on Bristol green; guard, crest, shield, list and diary reveal nothing on the home screen. All of them can be switched in the Android app.
- **Guided first-run dialog** (turn off with `ONBOARDING=0`).
- **Settings in `data/settings.json`:** meal times, number of food suggestions, shades of the stool colors, default note tags and pinned foods.
- **English and German**, light/dark mode, adapted layout for tablet and desktop.
- **Operation:** Docker image for amd64 and arm64 on ghcr.io (hardened container), a short `docker-compose.yml` with the main settings and templates in `compose/` (including one with all options), server log and admin CLI in German and English, tools to build the serverless version and the APK, tests for server, encryption and interface.
- **Documentation** in English and German: a short README, details in `docs/` (installation, configuration, data and security, development).
