# Data, encryption and security

**English** · [Deutsch](DATA.de.md)

[Back to the README](../README.md)

## Encryption

Two levels, both without extra sign-in when you add an entry:

1. Local storage (automatic). Over HTTPS (or `localhost`) the app no longer keeps entries as plain text in the browser but in IndexedDB. Every value is encrypted with a random device key (AES-256-GCM; the key cannot be read out in the browser). Existing data is taken over on first start. This protects the browser data from being read, for example from a backup of the browser storage. It does not protect against someone using your unlocked device. Without HTTPS (e.g. `http://192.168.…`) the previous browser storage is used; *Settings → Storage and server* shows which case applies.

2. End-to-end encryption (optional, with a server only). Turn it on under *Settings → Encryption*. Entries and food are encrypted on the device before they go to the server. The server, its backups and the admin only see ciphertext, the month of the entries, the time of the change and the count. Consistency, blood, pain, notes and food cannot be read by them. A separate encryption of the server database is therefore not needed.

- Recovery code: when you turn it on you get a code of 32 characters (160 bits). It wraps the data key, which is stored on the server in a form the server cannot read. On a new device you sign in as usual and enter the code once. Write it down or keep it in a password manager.
- Forgot the password: reset it (`docker compose exec gutkeeper node server/cli.js reset-password`, see [Sign-in and sessions](#security-and-privacy)). Resetting does not affect the encryption: the data key is wrapped by the recovery code, not by the password. Your data stays readable, and devices that are already unlocked do not need the code again. You only need the code on new devices.
- Forgot the code: on a device that is already unlocked you can create a new code under *Settings → Encryption*.
- **Code and all unlocked devices lost:** then the data on the server can no longer be read, not even by the admin, which is the cost of end-to-end encryption. Back up a JSON file from the app regularly.
- Turning it off: possible at any time under *Settings → Encryption*; the data is readable on the server again afterwards. Old backups stay what they were: backups from before turning it on contain plain text (with a single account you can delete them when turning it on), backups from the encrypted period can only be read with the code of that time.
- Limits: the server delivers the app itself. A server that serves tampered program code could capture input. The encryption protects the database and backups from being read, but it gives no protection against a malicious operator. While encryption is active the server CSV export happens in the app. The feature needs HTTPS (or `localhost`).

## Security and privacy

- Network: the server only accepts requests from private address ranges (LAN, VPN, Tailscale). Do not forward the port on your router.
- Reverse proxy: without `TRUST_PROXY=1` the server only sees the (private) address of the proxy and allows everything. If the proxy is reachable from the internet (for example because it also publishes other services), you must set up the password and set `TRUST_PROXY=1`. The server then rejects public visitors by their real address. Also set `TRUSTED_PROXY` to the proxy's address, otherwise any device on the private network can spoof the client IP via `X-Real-IP`.
- Sign-in and sessions: on first start there is a one-time code in the server log; with it you set the password (single user) or the first account (multi-user) in the app. The password is stored only as a scrypt hash in the database. Signing in via `POST` returns a signed cookie (`HttpOnly`, `SameSite=Strict`, `Secure` over HTTPS; the standalone app uses a token in the header instead). The session is sliding: it is valid for 180 days from the last use, and the server issues a fresh cookie on requests once the old one is more than a day old. So a device stays signed in until you sign out, choose *Sign out other devices* (*Settings → Security*), change the password, or the app goes unused for 180 days. Change the password under *Settings → Security* (with multiple accounts: *Account and security*); this signs out the other devices. On the server: `docker compose exec gutkeeper node server/cli.js reset-password [NEW_PASSWORD]` (without a name in single-user mode, `reset-password NAME [NEW_PASSWORD]` with multiple accounts; without an argument the password is read from standard input) or `logout-all [NAME]`. Resetting does not change an enabled end-to-end encryption (see [Encryption](#encryption)). After five wrong attempts the waiting time increases per IP and per account; in single-user mode an additional shared lock of at most 15 minutes applies, so changing addresses does not help. The same lock slows down guessing of the one-time code during setup.
- Other protections: Content Security Policy, `X-Frame-Options`, `nosniff`, rejection of cross-site write requests (`Sec-Fetch-Site`), checking the Host header against DNS rebinding (`ALLOWED_HOSTS`, only when set). The Docker container is hardened: no Linux capabilities (`cap_drop: ALL`), `no-new-privileges`, read-only file system (only `/data`, `/backups` and `/tmp` are writable).
- App lock (PIN) and fingerprint/face: optional and only for the respective device. The PIN (4–12 digits) is stored locally as a verifier and never sent to the server; the server is not asked to unlock (so it also works offline). It locks the interface when the app opens and after 0, 1 or 5 minutes in the background (adjustable). If you forget the PIN, sign in with the server password ("Forgot PIN?"); the device's PIN is then removed. Fingerprint/face replaces typing the PIN and needs HTTPS. The lock protects the interface; the data in the browser is encrypted separately (see [Encryption](#encryption)). If the session becomes invalid on the server, the password sign-in appears, not the PIN prompt.
- Limits: the password and PIN lock the interface and protect the server, but they do not replace a screen lock or device encryption. Without end-to-end encryption the database on the server is unencrypted (use an encrypted disk if needed, or turn it on).
- Multiple accounts: accounts are strictly separated in the app. Without end-to-end encryption turned on, an admin with full access (`ADMIN_FULL_ACCESS=1`) can still read all data through backups and the full export. `ADMIN_FULL_ACCESS=0` removes backups and full export, but an admin can still reset an account's password and sign in to see its data (the person notices: the old password stops working and they must choose a new one). Real separation only comes from end-to-end encryption or one container per person.
- Privacy: there are no external requests, no third-party fonts or scripts and no telemetry. The only exception: when you tap "Check for updates" under *Settings → About*, the app asks `api.github.com` for the latest version number (no data from the app is sent).

## Data, sync and backups

- Sync: every entry has a unique ID and a timestamp; on conflicts the newer change wins. Syncing runs on open, after changes and every 60 seconds. The dot at the top right shows the state (green synced, orange waiting, gray offline).
- Storage on the device: by default only the last 12 months (`LOCAL_MONTHS`). 12 months take only a few hundred KB in the browser; even several years stay far below the limit of about 5 MB. Under *Settings → Storage and server* you can see the current usage of device and server.
- Older entries: if you pick a period before the locally stored range in history, statistics, calendar or report, the app loads the entries live from the server while a connection exists. They only live in memory and are discarded on reload. This is economical: in a test (4,600 entries) one month is about 3 KB, one year about 40 KB and everything about 150 KB, each transferred compressed. On Wi-Fi or via VPN at home no mobile data is used. Under *Settings → Storage and server → Data on this device* the retrieval can be switched to "on tap only". Without a connection the older entries are missing, and the app tells you so.
- Server backups: by default a daily copy of the database in `data/backups/` (number: `BACKUP_KEEP`, interval: `BACKUP_INTERVAL_HOURS`, folder: `BACKUP_HOST_DIR`). Under *Settings → Administration* they can be created, downloaded, restored (a restore point is created first) and deleted. "Delete all data" removes the entries but not the backups.
- Database: SQLite in `data/gutkeeper.db`. To back up, simply copy the `data/` folder.
- **Delete all data** takes effect on the server and, on the next sync, on all devices.
- **Delete account** (*Settings → Delete data*, asks for the password; wrong entries count as failed attempts like at sign-in, `POST /api/account/delete`): in single-user mode it deletes everything on the server (entries, food, settings, encryption key, password) and on the device. The server then starts over at setup, with a new one-time code in the log; old sessions are invalid. Optionally the server backups are deleted too, otherwise they stay and can be restored after the new setup. With accounts, each person deletes their own account with its data. The data of a deleted account stays in the existing server backups until they rotate out (`BACKUP_KEEP`), but it cannot be restored through the app because account IDs are never reused. Only a manual restore of the whole database file would bring it back. The last admin must first make another account an admin (*User management → Make admin*); if it is the very last account, the server is reset as in single-user mode. In the serverless version and the APK, "Delete account" resets the app on the device completely (entries, app lock, backup settings, appearance …; confirmed with the PIN or the word "DELETE"); backup files already written stay. On the server an admin can also delete an account with `node server/cli.js delete-user NAME`.

### CSV format (import/export)

Separator `;`, first row = header. Columns may be missing or empty; only date and time are required, plus at least consistency, gas or pain. The column names and values are German.
On export the header and words follow the selected language (e.g. `date;time;consistency;…` and `yes`/`no`). On import both German and English column names and values are recognized.

| Column | Values |
|---|---|
| `datum` | `2026-11-05` or `05.11.2026` |
| `uhrzeit` | `08:15` |
| `konsistenz` | `1`–`7` (Bristol), empty = no stool |
| `stuhldrang` | `0`–`3` or keiner/leicht/mittel/stark |
| `menge` | `1`–`3` or wenig/mittel/viel |
| `blut`, `schleim`, `luft` | `ja`/`nein` (or empty) |
| `schmerz` | `0`–`3` |
| `farbe` | braun, hell, gelb, grün, schwarz, rot |
| `notiz` | text (max. 300 characters), in quotes if it contains semicolons |

### Stool colors: numbers and shades

The color of an entry is stored as a number (database, JSON backup, API); the CSV export contains the word in the app's language. The shade the color is displayed in is only presentation and is not stored with the entries.

| Number | CSV word | Default shade |
|---|---|---|
| 0 | *(empty, unknown)* | – |
| 1 | brown | `#7a4e2d` |
| 2 | pale | `#d9ccab` |
| 3 | yellow | `#d6b23a` |
| 4 | green | `#5d8f3a` |
| 5 | black | `#1f1d1c` |
| 6 | red | `#c0334a` |

Adjust the shades (optional): in `data/settings.json` you can change the shades for all accounts. Steps you do not list keep the default; without the file or with an invalid value (`#RRGGBB` is expected) the default shades apply. The numbers and their meaning stay fixed. Restart the container after saving. The serverless version always uses the default shades.

```json
{ "colors": { "1": "#6b4423", "6": "#b00020" } }
```
