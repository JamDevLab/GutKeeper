// Backup-Erinnerung beim Öffnen und automatisches Backup (nur in der Android-App): schreibt eine JSON-Datei in den Ordner
// „Dokumente/GutKeeper“ (bleibt auch nach dem Deinstallieren erhalten) und behält die letzten N (einstellbar).
// Optional verschlüsselt mit Passwort: Gespeichert wird nur der daraus abgeleitete Schlüssel (siehe vault.js), nicht das Passwort.
import { backupAge, backupDue } from './bkprefs.js';
import { deriveWrapKey, wrapTextKey } from './cipher.js';
import { fileBase, t } from './i18n.js';
import { plugin } from './native.js';
import { S } from './state.js';
import { activeEntries } from './store.js';
import { backupData, exportJson } from './transfer.js';
import { toast } from './ui.js';
import { vault } from './vault.js';
import { DEV, LS, stampStr, todayStr } from './util.js';

const DAY = 86400000, NAME = /^gutkeeper-auto-[\w-]+\.json$/;
// Ordner in „Dokumente“, unabhängig von der Sprache
// Test-Version der APK (Debug-Build, neben der signierten App installiert): eigener Ordner, damit ihre Backups und das Aufräumen
// alter Dateien nie die Backups der echten App berühren
const DEV_APK = typeof document !== 'undefined' && !!document.querySelector('meta[name="gutkeeper-dev"]');
export const autoFolder = () => (DEV_APK ? 'GutKeeper Dev' : 'GutKeeper');
export const KEEP_OPTIONS = [3, 5, 10, 20], KEEP_MAX = 365, DAYS_OPTIONS = [1, 7], DAYS_MAX = 365;
// Ganze Zahl von 1 bis max aus einer Eingabe (sonst null); gemeinsam für die eigene Anzahl und das eigene Intervall
export const parseWhole = (text, max) => { const s = String(text == null ? '' : text).trim(); return /^\d{1,4}$/.test(s) && Number(s) >= 1 && Number(s) <= max ? Number(s) : null; };
const whole = (v, max) => Number.isInteger(v) && v >= 1 && v <= max;

// Hinweis beim Öffnen: höchstens einmal am Tag
export function remindBackup() {
  if (S.locked || !backupDue() || DEV.get('bkRemindedOn', '') === todayStr()) return;
  DEV.set('bkRemindedOn', todayStr());
  const a = backupAge();
  toast(a === null ? t('Du hast noch kein Backup gemacht.') : t('Dein letztes Backup ist {n} Tage alt.', { n: a }), t('Jetzt sichern'), () => toast(exportJson()));
}

export const autoAvailable = () => S.standalone && !!plugin('Filesystem');
export const autoDays = () => { const v = DEV.get('autoBk', 0); return whole(v, DAYS_MAX) ? v : 0; }; // 0 = aus, sonst alle v Tage
export const isCustomDays = () => autoDays() > 0 && !DAYS_OPTIONS.includes(autoDays());
export const setAutoDays = (v) => DEV.set('autoBk', v);
export const autoState = () => DEV.get('autoBkState', null); // { at, ok, name } oder { at, ok: false, error }
export const autoKeep = () => { const v = DEV.get('autoBkKeep', 5); return whole(v, KEEP_MAX) ? v : 5; };
export const isCustomKeep = () => !KEEP_OPTIONS.includes(autoKeep());
export const setAutoKeep = (v) => DEV.set('autoBkKeep', v);

// Verschlüsselung: geht nur, wenn der Schlüssel sicher gespeichert werden kann (IndexedDB mit WebCrypto)
export const autoEncAvailable = () => vault.mode !== 'plain';
export const autoEncrypted = () => !!DEV.get('autoBkEnc', false);
// Ursache des Fehlers „Backups sind trotz Passwort unverschlüsselt“: Nach dem Festlegen des Passworts galt das letzte (unverschlüsselte)
// Backup noch als aktuell, die nächste Datei kam erst nach einem Tag bzw. einer Woche, und die alten Klartext-Dateien blieben liegen.
// Deshalb wird der Zeitplan hier zurückgesetzt (beim Öffnen ist sofort ein Backup fällig) und runAutoBackup räumt Klartext-Dateien weg.
export async function setAutoPassword(password) {
  await vault.setBackupKey(await deriveWrapKey(password));
  DEV.set('autoBkEnc', true);
  DEV.set('autoBkState', null);
}
export async function clearAutoPassword() {
  DEV.set('autoBkEnc', false);
  DEV.set('autoBkState', null);
  await vault.clearBackupKey().catch(() => {});
}
const isEncName = (n) => /-enc\.json$/.test(n);
// Unverschlüsselte Alt-Backups beim verschlüsselten Backup löschen? Wird beim Festlegen des Passworts gefragt (Standard: ja)
export const dropPlain = () => DEV.get('autoBkDropPlain', true) !== false;
export const setDropPlain = (v) => DEV.set('autoBkDropPlain', !!v);
// Anzahl lesbarer Auto-Backups im Ordner (0, wenn es den Ordner nicht gibt oder kein Zugriff besteht)
export async function plainAutoCount() {
  const P = plugin('Filesystem'); if (!P) return 0;
  try { return (await P.readdir({ path: autoFolder(), directory: 'DOCUMENTS' })).files.map((f) => f.name || f).filter((n) => NAME.test(n) && !isEncName(n)).length; } catch { return 0; }
}

export async function runAutoBackup(force = false) {
  const P = plugin('Filesystem'), d = autoDays();
  if (!P || !S.standalone || S.locked || (!d && !force) || !activeEntries().length) return null;
  const st = autoState();
  if (!force && st) { // fällig? Nach einem Fehler erst nach einer Stunde wieder versuchen
    if (st.ok ? Date.now() - st.at < d * DAY - 3600000 : Date.now() - st.at < 3600000) return null;
  }
  const enc = autoEncrypted(), FOLDER = autoFolder();
  const name = `${fileBase()}-auto-${stampStr()}${enc ? '-enc' : ''}.json`;
  try {
    let data = JSON.stringify(backupData(), null, 1);
    if (enc) { // nie unverschlüsselt schreiben, wenn Verschlüsselung gewählt ist
      const k = await vault.getBackupKey().catch(() => null);
      if (!k || !k.key) throw new Error(t('Backup-Passwort fehlt, bitte neu festlegen.'));
      const wrapped = await wrapTextKey(data, k);
      if (!wrapped || wrapped.gutkeeper !== 'encrypted') throw new Error(t('Backup-Passwort fehlt, bitte neu festlegen.'));
      data = JSON.stringify(wrapped);
    }
    const write = () => P.writeFile({ path: `${FOLDER}/${name}`, data, directory: 'DOCUMENTS', encoding: 'utf8', recursive: true });
    try { await write(); } catch { await P.requestPermissions().catch(() => {}); await write(); }
    LS.set('lastBackup', Date.now());
    DEV.set('autoBkState', { at: Date.now(), ok: true, name });
    try { // nur die letzten Dateien behalten
      let list = (await P.readdir({ path: FOLDER, directory: 'DOCUMENTS' })).files.map((f) => f.name || f).filter((n) => NAME.test(n)).sort((a, b) => a.replace(/^[a-z]+-auto-/, '').localeCompare(b.replace(/^[a-z]+-auto-/, ''))); // nach Zeitstempel, egal welcher Präfix
      if (enc && dropPlain()) { // mit Passwort sollen (falls gewünscht) keine lesbaren Alt-Backups der App zurückbleiben (erst löschen, nachdem das verschlüsselte geschrieben ist)
        for (const n of list.filter((x) => !isEncName(x))) await P.deleteFile({ path: `${FOLDER}/${n}`, directory: 'DOCUMENTS' });
        list = list.filter(isEncName);
      }
      for (const n of list.slice(0, Math.max(0, list.length - autoKeep()))) await P.deleteFile({ path: `${FOLDER}/${n}`, directory: 'DOCUMENTS' });
    } catch { /* Aufräumen ist nicht wichtig */ }
    return true;
  } catch (e) {
    DEV.set('autoBkState', { at: Date.now(), ok: false, error: String((e && e.message) || e).slice(0, 120) });
    return false;
  }
}
