// Optionen: Konto, Benutzerverwaltung (Admin) und Administration (Backups, Gesamt-Export) sowie ein kleiner Eingabe-Dialog
import { PIN_RE } from './applock.js';
import { autoFolder, autoState, parseWhole, plainAutoCount, runAutoBackup, setAutoPassword, setDropPlain } from './autobackup.js';
import { handleUnauthorized, logout } from './auth.js';
import { apiFetch, serverConn, setServerToken } from './net.js';
import { api, bkKind, confirmDeleteBackup, confirmRestore, fmtDT, fmtSize, renderData } from './data.js';
import { t } from './i18n.js';
import { S } from './state.js';
import { pendingCount, sync, unsyncedCount } from './store.js';
import { download } from './transfer.js';
import { DEV } from './util.js';
import { refreshViews, toast } from './ui.js';
import { ICON, el, eyeField, nE, openOverlay, stampStr } from './util.js';

const card = (title, ...kids) => el('div', { class: 'dcard' }, el('h3', {}, title), ...kids);
const btn = (label, fn, cls = '') => { const b = el('button', { type: 'button', class: 'dbtn ' + cls }, label); b.addEventListener('click', fn); return b; };

// ---- Eingabe-Dialog: Felder (Text, Passwort, Auswahl), liefert die Werte oder null ----
// check(vals): Fehlertext oder leer; bei Fehler bleibt das Fenster offen und zeigt den Text (statt eines Toasts, der z. B. hinter der Tastatur verschwindet)
export function askSheet({ title, text = '', fields = [], ok = t('OK'), cancelText = t('Abbrechen'), danger = false, check = null, error = '', focus = true }) {
  return new Promise((resolve) => {
    const vals = {};
    const rows = fields.map((f) => {
      if (f.type === 'choice') {
        vals[f.name] = f.value !== undefined ? f.value : f.options[0][0];
        const chips = el('div', { class: 'chips' }, f.options.map(([v, label]) => {
          const b = el('button', { type: 'button', class: 'chip' + (vals[f.name] === v ? ' on' : '') }, label);
          b.addEventListener('click', () => { vals[f.name] = v; chips.querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('on', f.options[i][0] === v)); });
          return b;
        }));
        return el('div', { class: 'askf' }, f.label ? el('div', { class: 'setlbl' }, f.label) : null, chips);
      }
      if (f.type === 'toggle') { // Ankreuzfeld mit Beschriftung, Wert true/false
        vals[f.name] = !!f.value;
        const cb = el('input', { type: 'checkbox' }); cb.checked = vals[f.name];
        cb.addEventListener('change', () => { vals[f.name] = cb.checked; });
        return el('label', { class: 'chk askf' }, cb, el('span', {}, f.label));
      }
      vals[f.name] = f.value !== undefined ? String(f.value) : '';
      const inp = el('input', { type: f.type || 'text', class: 'askin', placeholder: f.label, 'aria-label': f.label, autocomplete: f.type === 'password' ? 'new-password' : 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: f.pin ? 12 : 128, ...(f.type === 'number' ? { inputmode: 'numeric', min: 1 } : {}),
        ...(f.pin ? { inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off' } : {}) }); // pin: Ziffern-Tastatur am Handy
      inp.value = vals[f.name];
      inp.addEventListener('input', () => { vals[f.name] = inp.value; });
      inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') okBtn.click(); });
      return el('div', { class: 'askf' }, f.type === 'password' ? eyeField(inp) : inp);
    });
    const close = (v) => { ov.remove(); resolve(v); };
    const cancel = el('button', { type: 'button' }, cancelText);
    const okBtn = el('button', { type: 'button', class: danger ? 'danger' : 'primary' }, ok);
    cancel.addEventListener('click', () => close(null));
    const errP = el('p', { class: 'askerr', role: 'alert', hidden: '' });
    if (error) { errP.textContent = error; errP.hidden = false; } // Fehler eines vorigen Versuchs (z. B. Verbindung fehlgeschlagen)
    okBtn.addEventListener('click', () => {
      if (fields.some((f) => f.required && !String(vals[f.name] || '').length)) { errP.textContent = t('Bitte alle Felder ausfüllen.'); errP.hidden = false; return; }
      const err = check ? check({ ...vals }) : '';
      if (err) { errP.textContent = err; errP.hidden = false; const i = sheet.querySelector('input'); if (i) i.focus(); return; }
      close({ ...vals });
    });
    const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-label': title }, el('h2', {}, title), text ? el('p', { class: danger ? 'warn' : '' }, text) : null, ...rows, errP, el('div', { class: 'btns' }, cancel, okBtn));
    const ov = openOverlay(sheet, () => close(null));
    const first = sheet.querySelector('input:not([type=checkbox])'); if (first && focus) setTimeout(() => first.focus(), 60);
  });
}

// Neue lokale PIN abfragen (zweimal), liefert die PIN oder null (abgebrochen/ungültig). Gemeinsam für Optionen und Einstieg (onboarding.js).
export async function askNewPin(title) {
  const v = await askSheet({ title, text: t('4 bis 12 Ziffern. Vergisst du die PIN, hilft nur, die App-Daten zu löschen. Mach vorher ein Backup.'),
    fields: [{ name: 'a', type: 'password', pin: true, label: t('Neue PIN'), required: true }, { name: 'b', type: 'password', pin: true, label: t('PIN wiederholen'), required: true }], ok: t('Speichern'),
    check: (x) => (!PIN_RE.test(x.a) ? t('Die PIN braucht 4 bis 12 Ziffern.') : x.a !== x.b ? t('Die PINs stimmen nicht überein.') : '') });
  return v ? v.a : null;
}
// Passwort für die automatischen Backups festlegen (gespeichert wird nur der abgeleitete Schlüssel). true = Verschlüsselung ist eingerichtet
export async function askAutoPassword() {
  const v = await askSheet({ title: t('Backup-Passwort'), text: t('Mindestens {n} Zeichen.', { n: 8 }) + ' ' + t('Die automatischen Backups lassen sich nur mit diesem Passwort öffnen. Vergisst du es, sind die Daten darin verloren.'),
    fields: [{ name: 'a', type: 'password', label: t('Passwort'), required: true }, { name: 'b', type: 'password', label: t('Passwort wiederholen'), required: true }], ok: t('Speichern'),
    check: (x) => (x.a.length < 8 ? t('Das Passwort braucht mindestens {n} Zeichen.', { n: 8 }) : x.a !== x.b ? t('Die Passwörter stimmen nicht überein.') : '') });
  if (!v) return false;
  try { await setAutoPassword(v.a); } catch { toast(t('Verschlüsselung nicht möglich: Dieses Gerät kann den Schlüssel nicht sicher speichern. Es wird nichts unverschlüsselt gesichert.')); return false; }
  // Liegen schon lesbare Auto-Backups im Ordner, fragen, ob sie weg sollen (die Wahl gilt auch für spätere Backups)
  const plain = await plainAutoCount();
  if (plain) {
    const del = await askSheet({ title: t('Alte Backups löschen?'),
      text: t('Im Ordner Dokumente/{f} liegen noch {n} unverschlüsselte automatische Backups. Andere Apps mit Dateizugriff können sie lesen. Sollen sie gelöscht werden, sobald das erste verschlüsselte Backup gespeichert ist?', { n: plain, f: autoFolder() }),
      ok: t('Löschen'), cancelText: t('Behalten'), danger: true });
    setDropPlain(!!del);
  }
  // sofort ein verschlüsseltes Backup anlegen (und je nach Wahl lesbare Alt-Dateien der App löschen), statt auf den nächsten Termin zu warten
  const done = await runAutoBackup(true);
  toast(done === false ? t('Passwort gespeichert, aber das Backup ist fehlgeschlagen: {e}', { e: (autoState() || {}).error || '' }) : t('Automatische Backups werden ab jetzt verschlüsselt.'));
  return true;
}
// Eine ganze Zahl von 1 bis max abfragen (eigene Anzahl / eigenes Intervall der automatischen Backups); null = abgebrochen
export async function askWhole({ title, text, label, max, value }) {
  const v = await askSheet({ title, text, fields: [{ name: 'n', type: 'number', label, required: true, value }], ok: t('Speichern'),
    check: (x) => (parseWhole(x.n, max) === null ? t('Bitte eine ganze Zahl von 1 bis {n} eingeben.', { n: max }) : '') });
  return v ? parseWhole(v.n, max) : null;
}

// ---- Aufrufe mit Fehlercodes ----
async function call(method, path, body) {
  try {
    const r = await apiFetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = {}; try { json = await r.clone().json(); } catch { /* keine JSON-Antwort (z. B. Datei) */ }
    if (r.status === 401 && json.error !== 'wrong') { handleUnauthorized(); return { status: 401, json: {} }; } // 'wrong' = falsches aktuelles Passwort: Fehlermeldung statt Abmeldung
    return { status: r.status, json, r };
  } catch { return { status: 0, json: {} }; }
}
const errMsg = (res) => {
  if (res.status === 0) return t('Server nicht erreichbar.');
  const min = (S.config && S.config.minPassword) || 8;
  return ({
    name: t('Benutzername: 3–32 Zeichen, nur Buchstaben, Ziffern, Punkt, Unterstrich und Bindestrich.'),
    password: t('Das Passwort braucht mindestens {n} Zeichen.', { n: min }),
    exists: t('Diesen Benutzernamen gibt es schon.'),
    'last-admin': t('Das ist der letzte Admin und kann nicht herabgestuft oder gesperrt werden.'),
    self: t('Das eigene Konto lässt sich hier nicht sperren oder löschen.'),
    handover: t('Du bist der letzte Admin. Mache zuerst ein anderes Konto zum Admin (Optionen → Benutzerverwaltung → „Zum Admin“). Danach kannst du dein Konto löschen.'),
    confirm: t('Der eingegebene Name stimmt nicht.'),
    wrong: t('Das aktuelle Passwort stimmt nicht.'),
    format: t('Das ist kein gültiges GutKeeper-Backup.'),
    'no-data': t('Dieses Backup enthält keine Einträge für dieses Konto.'),
    password: t('Das Backup ist verschlüsselt und lässt sich ohne das richtige BACKUP_PASSWORD nicht zurückspielen.'),
    'no-lock': t('Der Server läuft ohne Anmeldung (NO_AUTH). Es gibt keine Sitzungen und kein Passwort.'),
    'no-full-access': t('Der Vollzugriff ist auf diesem Server abgeschaltet.'),
  })[res.json && res.json.error] || (res.status === 429 ? t('Zu viele Versuche. Bitte {s} Sekunden warten.', { s: (res.json && res.json.retry) || 60 }) : t('Das hat nicht geklappt.'));
};
const say = (m) => { S.dataMsg = m; renderData(); };

// Antwort mit Datei speichern (Dateiname aus dem Kopf der Antwort)
async function saveResponse(res, fallback) {
  const cd = res.r.headers.get('Content-Disposition') || '';
  const name = (cd.match(/filename="([^"]+)"/) || [])[1] || fallback;
  download(name, await res.r.blob(), res.r.headers.get('Content-Type') || 'application/octet-stream');
}

// ---- Anmeldung: Passwort ändern, abmelden (Einzelnutzer: nur das Passwort; Mehrbenutzer: Konto mit Namen) ----
// Formular „Passwort ändern“ (aktuell, neu, wiederholen): gemeinsam für Optionen und Einstieg (onboarding.js).
// done(meldung, ok) wird nach jedem Versuch aufgerufen; bei Erfolg ist das Passwort „selbst gewählt“ (der Server setzt pwTemp zurück).
export function passwordForm(done) {
  const mk = (label, ac) => el('input', { type: 'password', class: 'askin', placeholder: label, 'aria-label': label, autocomplete: ac, maxlength: 128 });
  const cur = mk(t('Aktuelles Passwort'), 'current-password'), n1 = mk(t('Neues Passwort'), 'new-password'), n2 = mk(t('Neues Passwort wiederholen'), 'new-password');
  const change = btn(t('Passwort ändern'), async () => {
    if (!cur.value || !n1.value) return;
    if (n1.value !== n2.value) { done(t('Die Passwörter stimmen nicht überein.'), false); return; }
    const res = await call('POST', '/api/account/password', { current: cur.value, next: n1.value, ...(serverConn() ? { bearer: true } : {}) });
    if (res.status === 200) {
      if (res.json.token) setServerToken(res.json.token);
      if (S.me) S.me.pwTemp = false;
      done(t('Passwort geändert. Auf anderen Geräten musst du dich neu anmelden.'), true);
    } else done(errMsg(res), false);
  });
  return el('div', { class: 'setrow pwchange' }, el('div', { class: 'setlbl' }, t('Passwort ändern')), el('div', { class: 'askf' }, eyeField(cur)), el('div', { class: 'askf' }, eyeField(n1)), el('div', { class: 'askf' }, eyeField(n2)), el('div', { class: 'drow' }, change));
}
// Hinweis, solange der Admin das Passwort kennt (angelegtes oder zurückgesetztes Konto): Knopf springt zum Formular
export function pwTempCard() {
  if (!(S.me && S.me.pwTemp)) return null;
  const go = btn(t('Jetzt ändern'), () => {
    const f = document.querySelector('#vData .pwchange'); if (!f) return;
    f.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const i = f.querySelector('input'); if (i) i.focus({ preventScroll: true });
  }, 'primary');
  return el('div', { class: 'dmsg pwtemp' }, t('Dein Passwort wurde vom Admin vergeben. Ändere es, damit nur du es kennst.'), ' ', go);
}
export function accountCard() {
  const multi = !!(S.config && S.config.multi);
  if (multi && !S.user) return card(t('Konto'), el('p', {}, t('Lade …')));
  return card(multi ? t('Konto') : t('Anmeldung'),
    multi ? el('p', {}, el('b', {}, S.user.name), ' · ', S.user.role === 'admin' ? t('Admin') : t('Nutzer')) : null,
    el('p', { class: 'bk-2' }, t('Dieses Gerät bleibt angemeldet, bis du dich abmeldest oder die App 180 Tage lang nicht benutzt wird. Die PIN weiter unten gilt nur auf diesem Gerät.')),
    passwordForm((m) => say(m)),
    el('div', { class: 'drow mt' }, btn(t('Abmelden …'), multi ? logoutSheet : () => logout())),
    el('div', { class: 'drow mt' }, btn(t('Andere Geräte abmelden'), logoutOthers))); // eigene Zeile: der Text ist zu lang für zwei Knöpfe nebeneinander
}
// Warnung vor dem Löschen von Daten, die nur auf diesem Gerät liegen (noch nicht auf dem Server, z. B. im Offline-Modus).
// Liefert true, wenn weitergemacht werden darf. Mit „Nicht mehr nachfragen“ entfällt die Frage künftig (Option unter Optionen → App).
export async function confirmUnsynced(n) {
  if (!n || DEV.get('warnUnsynced', true) === false) return true;
  const v = await askSheet({
    title: t('Nicht gesendete Daten'), danger: true,
    text: n === 1 ? t('1 Eintrag liegt nur auf diesem Gerät und ist noch nicht auf dem Server. Er ist nach dem Löschen unwiederbringlich weg. Trotzdem löschen?')
      : t('{n} Einträge liegen nur auf diesem Gerät und sind noch nicht auf dem Server. Sie sind nach dem Löschen unwiederbringlich weg. Trotzdem löschen?', { n }),
    fields: [{ type: 'choice', name: 'ask', label: t('Künftig'), value: 'ask', options: [['ask', t('Nachfragen')], ['never', t('Nicht mehr nachfragen')]] }],
    ok: t('Ja, löschen'),
  });
  if (!v) return false;
  if (v.ask === 'never') DEV.set('warnUnsynced', false);
  return true;
}
// Alle anderen Geräte abmelden: der Server erhöht den Sitzungszähler und gibt diesem Gerät ein frisches Token
export async function logoutOthers() {
  const v = await askSheet({ title: t('Andere Geräte abmelden'), text: t('Alle anderen Geräte müssen sich neu anmelden. Dieses Gerät bleibt angemeldet.'), fields: [], ok: t('Andere Geräte abmelden') });
  if (!v) return;
  const res = await call('POST', '/api/logout-others', serverConn() ? { bearer: true } : {});
  if (res.status === 200) { if (res.json.token) setServerToken(res.json.token); toast(t('Alle anderen Geräte sind abgemeldet.')); } else toast(errMsg(res));
}
export async function logoutSheet() {
  const pend = pendingCount();
  const v = await askSheet({
    title: t('Abmelden'),
    text: pend ? t('Es gibt noch {n} nicht gesendete Änderungen. Sie werden vor dem Abmelden gesendet, wenn der Server erreichbar ist.', { n: pend }) : t('Du wirst auf diesem Gerät abgemeldet.'),
    fields: [{ type: 'choice', name: 'local', label: t('Daten auf diesem Gerät'), value: 'keep', options: [['keep', t('Behalten')], ['delete', t('Löschen')]] }],
    ok: t('Abmelden'),
  });
  if (!v) return;
  if (pend && S.online && !S.offline) { try { await sync(); } catch { /* offline */ } }
  if (v.local === 'delete' && !(await confirmUnsynced(unsyncedCount()))) return;
  await logout(v.local === 'delete');
}

// ---- Benutzerverwaltung ----
export function usersCards() {
  const body = el('div', { class: 'bk-body' }, el('p', {}, t('Lade …')));
  const list = card(t('Konten'), body);
  const act = async (method, path, payload, ok) => { const res = await call(method, path, payload); if (res.status === 200) { if (ok) toast(ok); load(); } else say(errMsg(res)); };
  async function load() {
    const res = await call('GET', '/api/admin/users');
    if (res.status !== 200) { body.replaceChildren(el('p', { class: 'bk-2' }, errMsg(res))); return; }
    body.replaceChildren(...res.json.users.map((u) => {
      const me = S.user && u.id === S.user.id;
      const tags = [u.role === 'admin' ? t('Admin') : null, u.disabled ? t('gesperrt') : null, me ? t('Du') : null].filter(Boolean);
      const name = u.name || t('(noch nicht eingerichtet)');
      const acts = [
        btn(u.role === 'admin' ? t('Zum Nutzer') : t('Zum Admin'), () => act('POST', `/api/admin/users/${u.id}`, { role: u.role === 'admin' ? 'user' : 'admin' })),
        ...(me ? [] : [btn(u.disabled ? t('Entsperren') : t('Sperren'), () => act('POST', `/api/admin/users/${u.id}`, { disabled: !u.disabled }))]),
        btn(t('Passwort'), async () => {
          const v = await askSheet({ title: t('Neues Passwort für {n}', { n: name }), text: t('Alle Geräte dieses Kontos werden abgemeldet.'), fields: [{ name: 'pw', type: 'password', label: t('Neues Passwort'), required: true }], ok: t('Setzen') });
          if (v) act('POST', `/api/admin/users/${u.id}`, { password: v.pw }, t('Passwort gesetzt'));
        }),
        ...(me ? [] : [btn(t('Löschen'), async () => {
          const v = await askSheet({ title: t('Konto löschen?'), danger: true, text: t('Das Konto „{n}“ und alle seine Einträge ({e}) werden unwiderruflich gelöscht. Zur Bestätigung den Namen eingeben.', { n: name, e: nE(u.entries) }), fields: [{ name: 'confirm', label: t('Benutzername'), required: true }], ok: t('Endgültig löschen') });
          if (v) act('DELETE', `/api/admin/users/${u.id}`, { confirm: v.confirm }, t('Konto gelöscht'));
        }, 'danger')]),
      ];
      return el('div', { class: 'urow' }, el('div', { class: 'urow-h' }, el('b', {}, name), ...tags.map((x) => el('span', { class: 'tag' }, x)), el('span', { class: 'bk-2 ur-n' }, nE(u.entries))), el('div', { class: 'drow wrap' }, ...acts));
    }));
  }
  load();

  // Konto anlegen
  const nm = el('input', { type: 'text', class: 'askin', placeholder: t('Benutzername'), 'aria-label': t('Benutzername'), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: 32 });
  const pw = el('input', { type: 'password', class: 'askin', placeholder: t('Passwort'), 'aria-label': t('Passwort'), autocomplete: 'new-password', maxlength: 128 });
  let role = 'user';
  const chips = el('div', { class: 'chips' }, [['user', t('Nutzer')], ['admin', t('Admin')]].map(([v, l]) => {
    const b = el('button', { type: 'button', class: 'chip' + (role === v ? ' on' : '') }, l);
    b.addEventListener('click', () => { role = v; chips.querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('on', ['user', 'admin'][i] === v)); });
    return b;
  }));
  const create = btn(t('Konto anlegen'), async () => {
    if (!nm.value || !pw.value) return;
    const res = await call('POST', '/api/admin/users', { name: nm.value.trim(), password: pw.value, role });
    if (res.status === 200) { nm.value = ''; pw.value = ''; toast(t('Konto angelegt')); load(); } else say(errMsg(res));
  }, 'primary');
  const form = card(t('Neues Konto'),
    el('div', { class: 'askf' }, nm), el('div', { class: 'askf' }, eyeField(pw)), el('div', { class: 'setrow' }, el('div', { class: 'setlbl' }, t('Rolle')), chips),
    el('p', { class: 'bk-2' }, t('Das Passwort gibst du der Person weiter; sie kann es unter Optionen → Konto ändern.')), el('div', { class: 'drow' }, create));
  const info = card(t('Hinweis'), el('p', { class: 'bk-2' }, t('Als Admin verwaltest du hier nur Konten. Die Einträge anderer Personen siehst du in der App nicht. Wer den Server betreibt, kann die Datenbank allerdings technisch lesen.')));
  return [list, form, info];
}

// ---- Administration: Server-Backups und Gesamt-Export ----
async function userOptions() {
  const res = await call('GET', '/api/admin/users');
  return res.status === 200 ? res.json.users.map((u) => [u.id, u.name || t('(noch nicht eingerichtet)')]) : [];
}

function adminBackupCard() {
  const multi = !!(S.config && S.config.multi);
  const body = el('div', { class: 'bk-body' }, el('p', {}, t('Lade …')));
  const c = card(t('Server-Backups'),
    el('p', {}, multi ? t('Ein Backup enthält die Daten aller Konten. Der Server sichert automatisch einmal täglich (die letzten 30 Stände bleiben). Zurückspielen gilt immer nur für ein gewähltes Konto.')
      : t('Der Server sichert automatisch einmal täglich (die letzten 30 Stände bleiben). Du kannst jederzeit einen Sicherungspunkt anlegen, Backups herunterladen oder einen älteren Stand zurückspielen.')), body);
  async function load() {
    const res = await call('GET', '/api/backups');
    if (res.status !== 200) { body.replaceChildren(el('p', { class: 'bk-2' }, res.status === 0 ? t('Server nicht erreichbar. Backups sind nur im Heimnetz verfügbar.') : errMsg(res))); return; }
    const now = btn(t('Jetzt Backup anlegen'), async () => { now.disabled = true; const r = await call('POST', '/api/backup', {}); if (r.status === 200) { toast(t('Backup angelegt')); load(); } else { toast(errMsg(r)); now.disabled = false; } }, 'primary');
    const rows = res.json.backups.map((b) => {
      const plain = el('button', { type: 'button' }, t('Laden'));
      plain.addEventListener('click', async () => { const r = await call('POST', '/api/admin/backup-download', { name: b.name }); if (r.status === 200) saveResponse(r, b.name); else toast(errMsg(r)); });
      const locked = el('button', { type: 'button', 'aria-label': t('Mit Passwort herunterladen'), title: t('Mit Passwort herunterladen'), html: ICON.lock });
      locked.addEventListener('click', async () => {
        const v = await askSheet({ title: t('Backup mit Passwort laden'), text: t('Die Datei wird verschlüsselt (AES-256). Ohne das Passwort lässt sie sich nicht öffnen und es gibt keine Wiederherstellung des Passworts.'), fields: [{ name: 'pw', type: 'password', label: t('Passwort'), required: true }], ok: t('Laden') });
        if (!v) return;
        const r = await call('POST', '/api/admin/backup-download', { name: b.name, password: v.pw });
        if (r.status === 200) saveResponse(r, b.name + '.enc.json'); else toast(errMsg(r));
      });
      const rs = el('button', { type: 'button' }, t('Zurückspielen'));
      rs.addEventListener('click', async () => {
        if (!multi) { confirmRestore(b); return; }
        const opts = await userOptions();
        const v = await askSheet({
          title: t('Backup für ein Konto zurückspielen'), danger: true,
          text: t('Die Daten des gewählten Kontos werden durch den Stand vom {d} ersetzt. Andere Konten bleiben unverändert. Vorher legt der Server einen Sicherungspunkt an.', { d: fmtDT(b.mtime) }),
          fields: [{ type: 'choice', name: 'user', label: t('Konto'), options: opts, value: S.user && S.user.id }], ok: t('Wiederherstellen'),
        });
        if (!v) return;
        const r = await call('POST', '/api/restore', { name: b.name, user: v.user });
        if (r.status !== 200) { say(errMsg(r)); return; }
        say(t('Backup vom {d} wiederhergestellt ({n}).', { d: fmtDT(b.mtime), n: nE(r.json.count) }));
        if (S.user && v.user === S.user.id) { await sync(); refreshViews(); }
      });
      const rm = el('button', { type: 'button', class: 'rm', 'aria-label': t('Backup löschen'), html: ICON.trash });
      rm.addEventListener('click', () => confirmDeleteBackup(b, load));
      return el('div', { class: 'bk-row wrapbtn' },
        el('div', { class: 'bk-t' }, el('div', { class: 'bk-1' }, fmtDT(b.mtime)), el('div', { class: 'bk-2' }, `${b.count == null ? '?' : nE(b.count)} · ${fmtSize(b.size)} · ${bkKind(b.name)}`)), plain, locked, rs, rm);
    });
    body.replaceChildren(el('div', { class: 'drow' }, now), el('div', { class: 'bk-list' }, rows.length ? rows : el('p', { class: 'bk-2' }, t('Noch kein Backup vorhanden. Das erste entsteht automatisch, sobald Daten gespeichert sind.'))));
  }
  load();
  return c;
}

function exportCard() {
  const chipsBox = el('div', { class: 'chips' });
  const pw = el('input', { type: 'password', class: 'askin', placeholder: t('Passwort (leer = unverschlüsselt)'), 'aria-label': t('Passwort (leer = unverschlüsselt)'), autocomplete: 'new-password', maxlength: 128 });
  let sel = 'all';
  const drawChips = (opts) => {
    const all = [['all', t('Alle Konten')], ...opts];
    chipsBox.replaceChildren(...all.map(([v, l]) => {
      const b = el('button', { type: 'button', class: 'chip' + (sel === v ? ' on' : '') }, l);
      b.addEventListener('click', () => { sel = v; chipsBox.querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('on', all[i][0] === v)); });
      return b;
    }));
  };
  drawChips([]); userOptions().then(drawChips);
  const go = btn(t('Exportieren'), async () => {
    const r = await call('POST', '/api/admin/export', { user: sel, stamp: stampStr(), ...(pw.value ? { password: pw.value } : {}) });
    if (r.status === 200) { await saveResponse(r, 'gutkeeper-export.json'); toast(t('Export gespeichert')); } else say(errMsg(r));
  }, 'primary');
  return card(t('Daten exportieren'),
    el('p', {}, t('Exportiert die Einträge und das Essen eines Kontos oder aller Konten als JSON-Datei. Mit Passwort wird die Datei verschlüsselt (AES-256); beim Import fragt die App danach.')),
    chipsBox, el('div', { class: 'askf mt' }, eyeField(pw)), el('div', { class: 'drow' }, go));
}

export function adminCards() {
  const full = !S.me || S.me.fullAccess !== false;
  if (!full) return [card(t('Administration'), el('p', {}, t('Der Vollzugriff ist auf diesem Server abgeschaltet (ADMIN_FULL_ACCESS=0). Backups und Gesamt-Export stehen daher nicht zur Verfügung.')))];
  return [adminBackupCard(), ...(S.config && S.config.multi ? [exportCard()] : [])];
}
