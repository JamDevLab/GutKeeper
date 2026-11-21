#!/usr/bin/env node
// Kleine Verwaltung auf dem Server (z. B. mit: docker compose exec gutkeeper node server/cli.js list-users)
//   list-users                           Konten anzeigen
//   reset-password NAME [NEUES_PASSWORT] Passwort eines Kontos setzen (ohne Angabe wird es von der Standardeingabe gelesen)
//                                        Einzelnutzer-Betrieb: Passwort des Hauptkontos; NAME entfällt (reset-password [NEUES_PASSWORT]),
//                                        auch wenn es noch gar nicht eingerichtet war
//                                        Mehrbenutzer: das Passwort gilt als vorläufig, die App fordert die Person auf, es zu ändern
//   logout-all [NAME]                    alle Sitzungen eines Kontos abmelden (ohne NAME: das Hauptkonto im Einzelnutzer-Betrieb)
//   delete-user NAME                     Konto samt allen Einträgen löschen (nur Mehrbenutzer; nicht das letzte Konto und nicht den letzten Admin)
//   decrypt DATEI AUSGABE [PASSWORT]     passwortgeschützten Export oder Backup (*.enc.json) entschlüsseln
const fs = require('node:fs');
const readline = require('node:readline');
const log = require('./log');

// Fehler mit deutschem und englischem Text (Zeile 1 / Zeile 2 der Meldung), ausgegeben am Ende von main()
const fail = (de, en) => new Error(`${de}\n${en}`);

const [, , cmd, ...args] = process.argv;
const ask = (q) => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  rl.question(q, (a) => { rl.close(); resolve(a); });
});

async function main() {
  if (cmd === 'decrypt') {
    const { unwrap } = require('./crypto-wrap');
    const [inFile, outFile] = args;
    if (!inFile || !outFile) throw fail('Aufruf: decrypt DATEI AUSGABE [PASSWORT]', 'Usage: decrypt FILE OUTPUT [PASSWORD]');
    const password = args[2] ?? (await ask('Passwort / Password: '));
    fs.writeFileSync(outFile, await unwrap(JSON.parse(fs.readFileSync(inFile, 'utf8')), password));
    log.info(`Entschlüsselt: ${outFile}`, `Decrypted: ${outFile}`);
    return;
  }
  const { U } = require('./db');
  const auth = require('./auth');
  const cfg = require('./config');
  if (cmd === 'list-users') {
    if (!cfg.MULTIUSER) { // Einzelnutzer-Betrieb: das versteckte Hauptkonto hat nur ein Passwort
      log.info('Einzelnutzer-Betrieb (MULTIUSER aus): ein verstecktes Hauptkonto, es gibt keine Benutzerkonten.', 'Single-user mode (MULTIUSER off): one hidden main account, there are no user accounts.');
      if (U.owner().pass) log.info('Das Passwort ist festgelegt (ändern: reset-password).', 'The password is set (change it with: reset-password).');
      else log.info('Noch nicht eingerichtet: Beim Start des Servers steht ein Einmal-Code im Log.', 'Not set up yet: the server prints a one-time code in its log on start.');
      return;
    }
    for (const u of U.all()) console.log(`${String(u.id).padStart(3)}  ${(u.name === '_owner' ? '(noch nicht eingerichtet / not set up yet)' : u.name).padEnd(24)} ${u.role}${u.disabled ? '  gesperrt / disabled' : ''}`);
    return;
  }
  if (cmd === 'reset-password') {
    const [name] = args;
    // Einzelnutzer: das Hauptkonto; ein einzelnes Argument ist dort das Passwort (einen Namen gibt es nicht)
    const u = cfg.MULTIUSER ? U.byName(name || '') : U.owner();
    if (!u) throw fail(`Konto „${name || ''}“ nicht gefunden (siehe list-users).`, `Account "${name || ''}" not found (see list-users).`);
    const label = cfg.MULTIUSER ? u.name : 'das Hauptkonto';
    const pw = (cfg.MULTIUSER ? args[1] : args[1] ?? args[0]) ?? (await ask(`Neues Passwort für ${label} / New password for ${cfg.MULTIUSER ? label : 'the main account'}: `));
    if (!auth.validPassword(pw)) throw fail(`Das Passwort muss mindestens ${auth.MIN_PASSWORD} Zeichen haben.`, `The password must be at least ${auth.MIN_PASSWORD} characters long.`);
    await auth.resetPassword(u.id, pw, cfg.MULTIUSER); // Mehrbenutzer: vorläufiges Passwort, die App fordert den Nutzer zum Ändern auf
    log.info(`Passwort von ${label} gesetzt. Alle Sitzungen dieses Kontos sind abgemeldet.`, `Password for ${cfg.MULTIUSER ? label : 'the main account'} set. All sessions of this account are signed out.`);
    return;
  }
  if (cmd === 'logout-all') {
    const [name] = args;
    const u = name ? U.byName(name) : U.owner();
    if (!u) throw fail(`Konto „${name || ''}“ nicht gefunden (siehe list-users).`, `Account "${name || ''}" not found (see list-users).`);
    U.bumpTokenVer(u.id);
    log.info(`Alle Sitzungen von ${u.name === '_owner' ? 'dem Hauptkonto' : u.name} sind abgemeldet.`, `All sessions of ${u.name === '_owner' ? 'the main account' : u.name} are signed out.`);
    return;
  }
  if (cmd === 'delete-user') {
    const [name] = args;
    if (!cfg.MULTIUSER) throw fail('Nur im Mehrbenutzer-Betrieb (MULTIUSER=1). Im Einzelnutzer-Betrieb gibt es kein Konto zum Löschen; nutze in der App „Konto löschen“.', 'Only in multi-user mode (MULTIUSER=1). In single-user mode there is no account to delete; use "Delete account" in the app.');
    const u = U.byName(name || '');
    if (!u) throw fail(`Konto „${name || ''}“ nicht gefunden (siehe list-users).`, `Account "${name || ''}" not found (see list-users).`);
    // Dieselben Regeln wie in der App: nicht das letzte Konto (das läuft über „Konto löschen“ bzw. einen Neustart des Servers) und nicht den letzten Admin
    if (U.count() <= 1) throw fail('Das ist das letzte Konto. Zum Zurücksetzen des Servers nutze in der App „Konto löschen“.', 'This is the last account. To reset the server, use "Delete account" in the app.');
    if (u.role === 'admin' && !u.disabled && U.activeAdmins() <= 1) throw fail('Das ist der letzte Admin. Mache zuerst ein anderes Konto zum Admin (Benutzerverwaltung in der App).', 'This is the last admin. Make another account an admin first (user management in the app).');
    if (String(await ask(`Konto „${u.name}“ mit allen Einträgen und dem Essen unwiderruflich löschen? Zur Bestätigung den Namen eingeben / Permanently delete account "${u.name}" with all entries and food? Type the name to confirm: `)).trim().toLowerCase() !== u.name.toLowerCase()) throw fail('Abgebrochen (Name stimmt nicht).', 'Cancelled (name does not match).');
    const { deleteUser, compact } = require('./db');
    deleteUser(u.id); compact();
    log.info(`Konto ${u.name} (ID ${u.id}) gelöscht. Laufende Sitzungen dieses Kontos sind ungültig.`, `Account ${u.name} (ID ${u.id}) deleted. Running sessions of this account are invalid.`);
    return;
  }
  log.info('Befehle: list-users | reset-password [NAME] [PASSWORT] | logout-all [NAME] | delete-user NAME | decrypt DATEI AUSGABE [PASSWORT]', 'Commands: list-users | reset-password [NAME] [PASSWORD] | logout-all [NAME] | delete-user NAME | decrypt FILE OUTPUT [PASSWORD]');
}
main().then(() => process.exit(0), (e) => { const [de, en] = String(e.message).split('\n'); log.error(`Fehler: ${de}`, `Error: ${en ?? de}`); process.exit(1); });
