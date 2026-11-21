// „Konto löschen“ (Optionen → Daten löschen): mit Server wird das eigene Konto gelöscht (Einzelnutzer und letztes Konto: der Server beginnt wieder
// bei der Einrichtung), in der serverlosen Version wird die ganze App auf diesem Gerät zurückgesetzt.
import { askSheet } from './admin.js';
import { checkPin, lockOn, removePin } from './applock.js';
import { handleUnauthorized } from './auth.js';
import { renderData } from './data.js';
import { autoFolder } from './autobackup.js';
import { t } from './i18n.js';
import { apiFetch, setServerToken } from './net.js';
import { S } from './state.js';
import { toast } from './ui.js';
import { DEV, el, forgetAccount, resetDevice } from './util.js';

const WORD = () => t('LÖSCHEN'); // Bestätigungswort der serverlosen Version (ohne PIN)
const say = (m) => { S.dataMsg = m; renderData(); };

// Ist das Löschen hier möglich? Nicht ohne Anmeldung (NO_AUTH) und nicht im Offline-Modus (der Server muss erreichbar sein).
export const accountDeleteAvailable = () => S.standalone || !(S.config && S.config.auth === 'none');

async function post(path, body) {
  try {
    const r = await apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let json = {}; try { json = await r.json(); } catch { /* keine JSON-Antwort */ }
    return { status: r.status, json };
  } catch { return { status: 0, json: {} }; }
}
async function listUsers() {
  try {
    const r = await apiFetch('/api/admin/users');
    return r.ok ? (await r.json()).users : null;
  } catch { return null; }
}

// ---- Serverlose Version: alles auf dem Gerät zurücksetzen ----
async function resetStandalone() {
  const pin = lockOn();
  const v = await askSheet({
    title: t('Konto löschen?'), danger: true,
    text: t('Alles in dieser App wird von diesem Gerät gelöscht: alle Einträge, das Essen, die App-Sperre (PIN, Fingerabdruck), die Backup-Erinnerung, das automatische Backup samt Passwort und alle Einstellungen. Die App startet danach wie frisch installiert. Bereits gespeicherte Backup-Dateien (z. B. im Ordner Dokumente/{f} oder in deinen Downloads) bleiben bestehen. Das lässt sich nicht rückgängig machen. Sichere die Daten vorher unter „Sicherung und Import“.', { f: autoFolder() }),
    fields: [pin ? { name: 'c', type: 'password', pin: true, label: t('Zur Bestätigung die PIN eingeben'), required: true }
      : { name: 'c', label: t('Zur Bestätigung „{w}“ eingeben', { w: WORD() }), required: true }],
    ok: t('Alles löschen'),
  });
  if (!v) return;
  if (pin) {
    const r = await checkPin(v.c);
    if (!r.ok) { say(r.wait ? t('Zu viele Versuche. Bitte {s} Sekunden warten.', { s: r.wait }) : t('Falsche PIN.')); return; }
  } else if (v.c.trim().toLowerCase() !== WORD().toLowerCase()) { say(t('Das Bestätigungswort stimmt nicht.')); return; }
  S.locked = true; clearTimeout(S.syncTimer); // nichts mehr speichern oder senden
  await resetDevice();
  location.reload();
}

// ---- Mit Server ----
async function deleteOnServer() {
  const multi = !!(S.config && S.config.multi), name = (S.user && S.user.name) || '';
  let plan = multi ? 'delete' : 'reset'; // reset = der Server beginnt wieder bei der Einrichtung
  if (multi && S.user && S.user.role === 'admin') {
    const users = await listUsers(); // nur zur Vorabinformation; entscheidend ist die Prüfung des Servers
    if (users && users.length <= 1) plan = 'reset';
    else if (users && !users.some((u) => u.id !== S.user.id && u.role === 'admin' && !u.disabled)) {
      const go = await askSheet({ title: t('Erst einen anderen Admin bestimmen'), text: t('Du bist der letzte Admin und es gibt noch andere Konten. Mache zuerst ein anderes Konto zum Admin („Zum Admin“ in der Benutzerverwaltung). Danach kannst du dein Konto löschen.'), fields: [], ok: t('Zur Benutzerverwaltung') });
      if (go) { S.optPage = 'users'; S.dataMsg = ''; renderData(); }
      return;
    }
  }
  const lines = plan === 'reset'
    ? [multi ? t('Dein Konto „{n}“ ist das letzte Konto. Es wird mit allen Einträgen, dem Essen und den Einstellungen auf dem Server endgültig gelöscht, und der Server beginnt wieder bei der Einrichtung (neuer Einmal-Code im Server-Log).', { n: name })
        : t('Auf dem Server werden alle Einträge, das Essen, die Einstellungen und das Passwort endgültig gelöscht. Der Server beginnt danach wieder bei der Einrichtung (neuer Einmal-Code im Server-Log).')]
    : [t('Dein Konto „{n}“ wird mit allen Einträgen, dem Essen und den Einstellungen auf dem Server endgültig gelöscht. Andere Konten bleiben unverändert. Ältere Server-Backups enthalten die Daten noch, bis sie ablaufen oder ein Admin sie löscht.', { n: name })];
  if (S.dataKey || S.e2eeServer) lines.push(t('Die Ende-zu-Ende-Verschlüsselung wird dabei ebenfalls entfernt.'));
  lines.push(t('Auch die Daten dieses Kontos auf diesem Gerät werden gelöscht. Das lässt sich nicht rückgängig machen. Sichere die Daten vorher unter „Sicherung und Import“.', { f: autoFolder() }));
  const v = await askSheet({
    title: t('Konto löschen?'), danger: true, text: lines.join(' '),
    fields: [...(plan === 'reset' ? [{ type: 'choice', name: 'backups', label: t('Server-Backups'), value: 'keep', options: [['keep', t('Behalten')], ['drop', t('Auch löschen')]] }] : []),
      { name: 'password', type: 'password', label: t('Zur Bestätigung dein Passwort'), required: true }],
    ok: t('Endgültig löschen'),
  });
  if (!v) return;
  const res = await post('/api/account/delete', { password: v.password, dropBackups: v.backups === 'drop' });
  if (res.status === 401 && res.json.error === 'auth') { handleUnauthorized(); return; }
  if (res.status !== 200) {
    say(res.status === 0 ? t('Server nicht erreichbar.')
      : res.status === 429 ? t('Zu viele Versuche. Bitte {s} Sekunden warten.', { s: res.json.retry || 60 })
        : res.json.error === 'wrong' ? t('Das Passwort stimmt nicht.')
          : res.json.error === 'handover' ? t('Du bist der letzte Admin. Mache zuerst ein anderes Konto zum Admin (Optionen → Benutzerverwaltung → „Zum Admin“). Danach kannst du dein Konto löschen.')
            : t('Das hat nicht geklappt.'));
    return;
  }
  // Der Server hat gelöscht: dieses Gerät vergisst das Konto und zeigt danach die Einrichtung bzw. die Anmeldung
  S.locked = true; clearTimeout(S.syncTimer);
  setServerToken(null);
  await forgetAccount(S.user && S.user.id, multi);
  if (!multi) { removePin(); DEV.set('applockAfter', null); } // Einzelnutzer: die Sperre gehörte zu diesem Konto; mit Konten bleibt sie als Gerätesperre
  DEV.set('session', null); DEV.set('config', null);
  toast(t('Konto gelöscht.'));
  location.reload();
}

export function deleteAccount() { return S.standalone ? resetStandalone() : deleteOnServer(); }

// Karte „Konto löschen“ für die Seite „Daten löschen“
export function accountDeleteCard(card, btn) {
  const solo = S.standalone;
  const multi = !!(S.config && S.config.multi);
  if (!solo && S.offline) return card(t('Konto löschen'), el('p', { class: 'bk-2' }, t('Dafür muss die App mit dem Server verbunden sein. Schalte den Offline-Modus aus.')));
  return card(t('Konto löschen'),
    el('p', {}, solo ? t('Setzt die App auf diesem Gerät komplett zurück: Einträge, Einstellungen, App-Sperre und Backup-Einstellungen. Sie startet danach wie frisch installiert.')
      : multi ? t('Löscht dein Konto mit allen Einträgen auf dem Server und auf diesem Gerät. Andere Konten bleiben unverändert.')
        : t('Löscht alles auf dem Server und auf diesem Gerät, auch das Passwort. Der Server beginnt danach wieder bei der Einrichtung.')),
    el('div', { class: 'drow' }, btn(t('Konto löschen …'), deleteAccount, 'danger')));
}
