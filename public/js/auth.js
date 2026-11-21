// Anmeldung am Server (Passwort, bei Mehrbenutzer Name + Passwort), Einrichtung beim ersten Start und die lokale App-Sperre (PIN, Fingerabdruck).
// Beides ist getrennt: Das Server-Passwort braucht man einmal je Gerät (die Sitzung gleitet weiter, bis man sich abmeldet oder 180 Tage lang
// nichts benutzt). Die PIN ist eine rein lokale, optionale Sperre dieses Geräts und geht nie an den Server.
import { checkPin, lockOn, removePin } from './applock.js';
import { bioAutoTry, bioDisable, bioEnabled, bioUnlock } from './bio.js';
import { apiFetch, serverConn, setServerToken } from './net.js';
import { LANG, appName, setLang, t } from './i18n.js';
import { resetNow } from './capture.js';
import { S } from './state.js';
import { sync } from './store.js';
import { refreshViews } from './ui.js';
import { $, DEV, ICON, LS, adoptLegacy, clearLocalAccount, el, eyeField, storeFor } from './util.js';

const saveAuth = () => LS.set('auth', S.auth);
const isMulti = () => !!(S.config && S.config.multi);
// Welche Ansicht gerade im Vollbild-Fenster (#lock) steht: '' (keine), 'lock' (lokale PIN), 'login' (Server-Anmeldung) oder 'setup' (Einrichtung)
let overlay = '';
// Muss sich dieses Gerät noch am Server anmelden? (nicht bei der eigenständigen Version, im Offline-Modus und mit NO_AUTH)
const loginNeeded = () => !S.standalone && !S.offline && !!S.config && S.config.auth !== 'none' && !S.auth.loggedIn;
export async function fetchT(url, opts = {}, ms = 6000) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try { return await apiFetch(url, { ...opts, signal: ctrl.signal }); } finally { clearTimeout(to); }
}
// Bei einer Verbindung zu einem Server per Token (bearer) anmelden; der Server gibt es nur heraus, wenn er diese App-Herkunft erlaubt (CORS_ORIGINS)
const post = (url, body) => fetchT(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(serverConn() ? { ...body, bearer: true } : body) });

// Nach erfolgreicher Anmeldung/Einrichtung: Konto merken. Bei einem anderen Konto wird die Seite neu geladen,
// damit der lokale Speicher dieses Kontos (und nur dieser) geladen wird.
function applyLogin(res) {
  if (res.token) setServerToken(res.token);
  const adopting = !!(serverConn() && serverConn().adopt); // gerade erst mit einem Server verbunden: lokale Daten gehören diesem Konto
  if (isMulti() && res.user) {
    const same = !!S.user && S.user.id === res.user.id;
    DEV.set('session', res.user);
    if (!same) {
      (async () => {
        if (res.user.main || adopting) await adoptLegacy(res.user.id); // Daten aus dem Einzelnutzer-Betrieb (gehören dem Hauptkonto) bzw. der eigenständigen Version gehören diesem Konto
        const mine = storeFor(res.user.id);
        mine.set('auth', { ...mine.get('auth', {}), loggedIn: true });
        if (res.food !== undefined) mine.set('foodOn', !!res.food);
        try { sessionStorage.setItem('gutkeeper.fresh', '1'); } catch { /* egal */ }
        location.reload();
      })();
      return;
    }
  }
  S.user = res.user || S.user;
  S.me = { fullAccess: res.fullAccess !== false, multi: !!res.multi, pwTemp: !!res.pwTemp };
  S.auth = { loggedIn: true };
  if (res.food !== undefined) { S.foodOn = !!res.food; LS.set('foodOn', S.foodOn); }
  saveAuth(); unlock();
}

// Mit dem Server-Passwort anmelden. Liefert eine Fehlermeldung oder '' bei Erfolg.
// forgot: Der Nutzer hat die lokale PIN vergessen; das Server-Passwort beweist, dass er es ist, dann wird die PIN dieses Geräts entfernt.
async function tryLogin(password, name, forgot) {
  let res = null;
  try {
    const r = await post('/api/login', { password, ...(isMulti() ? { name } : {}) });
    if (r.status === 429) return t('Zu viele Versuche. Bitte {s} Sekunden warten.', { s: (await r.json()).retry });
    if (r.status === 401) return isMulti() ? t('Benutzername oder Passwort falsch.') : t('Falsches Passwort.');
    if (r.status === 409) { await loadConfig(); showSetup(); return ''; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    res = await r.json();
  } catch { return t('Server nicht erreichbar. Zum Anmelden braucht es eine Verbindung.'); }
  if (forgot) { removePin(); bioDisable(); }
  applyLogin(res);
  return '';
}

// Aktuelles Konto, Rolle und Einstellungen vom Server holen
export async function refreshMe() {
  if (S.offline || S.standalone) return;
  try {
    const r = await fetchT('/api/me', {}, 5000);
    if (r.status === 401) { handleUnauthorized(); return; }
    if (!r.ok) return;
    const me = await r.json();
    if (me.multi && S.user && me.user.id !== S.user.id) { DEV.set('session', me.user); location.reload(); return; } // Cookie gehört zu einem anderen Konto
    S.user = me.user; S.me = { fullAccess: me.fullAccess, multi: me.multi, pwTemp: !!me.pwTemp };
    if (me.multi) DEV.set('session', me.user);
    if (S.foodOn !== !!me.food) { S.foodOn = !!me.food; LS.set('foodOn', S.foodOn); }
    S.e2eeServer = !!me.e2ee;
    refreshViews();
  } catch { /* offline */ }
}

function hideOverlay() {
  overlay = ''; S.locked = false; S.sessionUnlocked = true;
  const ov = $('#lock'); ov.hidden = true; ov.replaceChildren();
}
// Fenster schließen und die App freigeben (nach der lokalen PIN, der Anmeldung oder der Einrichtung)
export function unlock() {
  if (loginNeeded()) { showLogin(); return; } // lokal entsperrt, aber der Server verlangt noch die Anmeldung
  hideOverlay();
  document.dispatchEvent(new Event('gutkeeper:unlocked')); // z. B. Backup-Erinnerung (app.js)
  if (S.tab === 'cap' && !S.capTouched) resetNow();
  refreshViews(); refreshMe(); sync();
}

// Sprache schon vor dem Anmelden umschalten: zeigt die jeweils andere Sprache (in ihrer eigenen Schreibweise)
const langLink = () => {
  const b = el('button', { type: 'button', class: 'lock-link', lang: LANG === 'en' ? 'de' : 'en' }, LANG === 'en' ? 'Deutsch' : 'English');
  b.addEventListener('click', () => setLang(LANG === 'en' ? 'de' : 'en'));
  return b;
};
const textInput = (label, extra = {}) => el('input', { type: 'text', class: 'pin pw', 'aria-label': label, placeholder: label, autocapitalize: 'off', spellcheck: 'false', maxlength: 64, ...extra });

// Lokale App-Sperre dieses Geräts: PIN (nur Ziffern) oder Fingerabdruck/Gesicht, unabhängig vom Server
export function showLock(msg = '') {
  overlay = 'lock'; S.locked = true; S.sessionUnlocked = false;
  const ov = $('#lock'); ov.hidden = false; ov.replaceChildren();
  const input = el('input', { type: 'password', class: 'pin', 'aria-label': t('PIN'), maxlength: 12, inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off' });
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, ''); }); // nur Ziffern
  const err = el('div', { class: 'lock-err' }, msg);
  const go = el('button', { type: 'button', class: 'lock-go' }, t('Entsperren'));
  const submit = async () => {
    if (!input.value) { input.focus(); return; }
    go.disabled = true; err.textContent = '';
    const r = await checkPin(input.value);
    go.disabled = false;
    if (r.ok) { unlock(); return; }
    err.textContent = r.wait ? t('Zu viele Versuche. Bitte {s} Sekunden warten.', { s: r.wait }) : t('Falsche PIN.');
    input.value = ''; input.focus();
  };
  // Fingerabdruck/Gesicht: nur wenn eingerichtet
  let bioBtn = null;
  const bioTry = async (showMsg) => {
    if (await bioUnlock()) unlock(); else if (showMsg) err.textContent = t('Fingerabdruck/Gesicht nicht bestätigt. Du kannst auch die PIN eingeben.');
  };
  if (bioEnabled()) {
    bioBtn = el('button', { type: 'button', class: 'bio-go', html: ICON.finger + '<span>' + t('Mit Fingerabdruck / Gesicht entsperren') + '</span>' });
    bioBtn.addEventListener('click', () => bioTry(true));
  }
  go.addEventListener('click', submit);
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') submit(); });
  // PIN vergessen: mit Server kann das Server-Passwort sie zurücksetzen, sonst bleibt nur, die App-Daten zu löschen
  const forgot = !S.standalone && !S.offline && !!S.config && S.config.auth !== 'none'
    ? el('button', { type: 'button', class: 'lock-link' }, t('PIN vergessen?'))
    : el('p', { class: 'lock-hint' }, t('PIN vergessen? Dann hilft nur, die App-Daten zu löschen (z. B. die App deinstallieren). Die Einträge sind dann weg, wenn du kein Backup hast.'));
  if (forgot.tagName === 'BUTTON') forgot.addEventListener('click', () => showLogin('', true));
  ov.append(el('div', { class: 'lock-card' }, el('div', { class: 'lock-ic', html: ICON.lock }), el('h1', {}, appName(S.config)),
    el('p', {}, t('Bitte PIN eingeben')), eyeField(input), err, go, bioBtn, forgot, langLink()));
  setTimeout(() => input.focus(), 60);
  if (bioBtn && bioAutoTry()) setTimeout(() => { if (document.visibilityState === 'visible' && S.locked) bioTry(false); }, 350); // einmal von selbst versuchen
}

// Anmeldung am Server: Passwort, bei Mehrbenutzer zusätzlich der Benutzername
export function showLogin(msg = '', forgot = false) {
  overlay = 'login'; S.locked = true; S.sessionUnlocked = false;
  const ov = $('#lock'); ov.hidden = false; ov.replaceChildren();
  const multi = isMulti();
  const input = el('input', { type: 'password', class: 'pin pw', 'aria-label': t('Passwort'), placeholder: multi ? t('Passwort') : undefined, maxlength: 128, autocomplete: 'current-password', autocapitalize: 'off', spellcheck: 'false' });
  const nameIn = multi ? textInput(t('Benutzername'), { autocomplete: 'username', value: (S.user && S.user.name) || '' }) : null;
  const err = el('div', { class: 'lock-err' }, msg);
  const go = el('button', { type: 'button', class: 'lock-go' }, t('Anmelden'));
  const submit = async () => {
    if (multi && !nameIn.value.trim()) { nameIn.focus(); return; }
    if (!input.value) { input.focus(); return; }
    go.disabled = true; err.textContent = '';
    const m = await tryLogin(input.value, multi ? nameIn.value.trim() : '', forgot);
    go.disabled = false;
    if (m) { err.textContent = m; input.value = ''; input.focus(); }
  };
  go.addEventListener('click', submit);
  for (const i of [input, nameIn]) if (i) i.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') submit(); });
  let back = null;
  if (forgot) { back = el('button', { type: 'button', class: 'lock-link' }, t('Zurück')); back.addEventListener('click', () => showLock()); }
  ov.append(el('div', { class: 'lock-card' }, el('div', { class: 'lock-ic', html: ICON.lock }), el('h1', {}, appName(S.config)),
    el('p', {}, multi ? t('Bitte anmelden') : t('Bitte Passwort eingeben')),
    forgot ? el('p', { class: 'lock-hint' }, t('Melde dich mit dem Server-Passwort an. Die PIN dieses Geräts wird dann entfernt, du kannst danach eine neue festlegen.')) : null,
    nameIn, eyeField(input), err, go, back, langLink()));
  setTimeout(() => (multi && !nameIn.value ? nameIn : input).focus(), 60);
}

// Passwort (Einzelnutzer) bzw. erstes Konto (Mehrbenutzer) festlegen, solange noch nichts eingerichtet ist
export function showSetup(msg = '') {
  overlay = 'setup'; S.locked = true; S.sessionUnlocked = false;
  const ov = $('#lock'); ov.hidden = false; ov.replaceChildren();
  const multi = isMulti(), min = (S.config && S.config.minPassword) || 8;
  const secret = el('input', { type: 'password', class: 'pin pw', 'aria-label': t('Einmal-Code'), placeholder: t('Einmal-Code'), autocomplete: 'off', maxlength: 128 });
  const name = multi ? textInput(t('Benutzername'), { autocomplete: 'username' }) : null;
  const pw1 = el('input', { type: 'password', class: 'pin pw', 'aria-label': t('Passwort'), placeholder: t('Passwort'), autocomplete: 'new-password', maxlength: 128 });
  const pw2 = el('input', { type: 'password', class: 'pin pw', 'aria-label': t('Passwort wiederholen'), placeholder: t('Passwort wiederholen'), autocomplete: 'new-password', maxlength: 128 });
  const err = el('div', { class: 'lock-err' }, msg);
  const go = el('button', { type: 'button', class: 'lock-go' }, multi ? t('Konto anlegen') : t('Passwort festlegen'));
  const submit = async () => {
    err.textContent = '';
    if (pw1.value !== pw2.value) { err.textContent = t('Die Passwörter stimmen nicht überein.'); return; }
    go.disabled = true;
    try {
      const r = await post('/api/setup', { secret: secret.value, ...(multi ? { name: name.value.trim() } : {}), password: pw1.value });
      const j = await r.json().catch(() => ({}));
      if (r.status === 429) err.textContent = t('Zu viele Versuche. Bitte {s} Sekunden warten.', { s: j.retry });
      else if (r.status === 401) err.textContent = t('Der Einmal-Code stimmt nicht.');
      else if (j.error === 'name') err.textContent = t('Benutzername: 3–32 Zeichen, nur Buchstaben, Ziffern, Punkt, Unterstrich und Bindestrich.');
      else if (j.error === 'password') err.textContent = t('Das Passwort braucht mindestens {n} Zeichen.', { n: min });
      else if (r.status === 409) { await loadConfig(); showLogin(); }
      else if (r.ok) { applyLogin(j); }
      else err.textContent = t('Einrichtung fehlgeschlagen.');
    } catch { err.textContent = t('Server nicht erreichbar.'); }
    go.disabled = false;
  };
  go.addEventListener('click', submit);
  for (const i of [secret, name, pw1, pw2]) if (i) i.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') submit(); });
  ov.append(el('div', { class: 'lock-card' }, el('div', { class: 'lock-ic', html: ICON.lock }), el('h1', {}, appName(S.config)),
    el('h2', {}, multi ? t('Erstes Konto einrichten') : t('Passwort festlegen')),
    multi ? el('p', { class: 'lock-hint' }, t('Dieses Konto wird zum Admin und übernimmt vorhandene Daten.'))
      : el('p', { class: 'lock-hint' }, t('Mit diesem Passwort meldest du dich an jedem Gerät einmal an. Danach bleibt das Gerät angemeldet, bis du dich abmeldest.')),
    el('p', { class: 'lock-hint' }, t('Gib den Einmal-Code aus dem Server-Log ein (z. B. mit „docker compose logs“).')),
    eyeField(secret), name, eyeField(pw1), eyeField(pw2), err, go, langLink()));
  setTimeout(() => secret.focus(), 60);
}

async function loadConfig() {
  try { const r = await fetchT('/api/config', {}, 5000); if (r.ok) { S.config = await r.json(); DEV.set('config', S.config); } } catch { /* offline: gespeicherte Config */ }
}

// Vollständig abmelden: Cookie am Server löschen. Mit Konten optional auch die lokalen Daten dieses Geräts entfernen.
export async function logout(deleteLocal = false) {
  const uid = S.user && S.user.id;
  if (!S.offline) { try { await fetchT('/api/logout', { method: 'POST' }, 4000); } catch { /* offline */ } }
  S.auth = {}; saveAuth(); setServerToken(null);
  if (isMulti() && deleteLocal && uid) { await clearLocalAccount(uid); DEV.set('session', null); location.reload(); return; }
  showLogin(t('Abgemeldet.'));
}
// Der Server hat die Sitzung abgelehnt (abgemeldet, Passwort geändert, „Andere Geräte abmelden“, 180 Tage ungenutzt): Server-Anmeldung zeigen.
// Ist gerade die lokale PIN-Sperre sichtbar, bleibt sie; nach dem Entsperren folgt die Anmeldung (unlock).
export function handleUnauthorized() {
  S.auth.loggedIn = false; saveAuth();
  if (S.locked) return;
  const wasMulti = isMulti();
  showLogin(t('Bitte neu anmelden.'));
  loadConfig().then(() => {
    if (overlay === 'login' && S.config && S.config.needsSetup) showSetup();
    else if (overlay === 'login' && wasMulti !== isMulti()) showLogin(t('Bitte neu anmelden.'));
  });
}

export async function boot() {
  const locked = lockOn() && !S.sessionUnlocked; // lokale PIN-Sperre dieses Geräts (nach einer Anmeldung mit Seitenneuladen nicht)
  if (locked) showLock(); // sofort sperren, bevor Daten sichtbar werden
  else if (loginNeeded()) showLogin();
  if (S.standalone) { // ohne Server: kein Abgleich; den Browser bitten, die Daten nicht von selbst zu löschen
    if (!locked) hideOverlay();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    return;
  }
  if (S.offline) { if (!locked) hideOverlay(); return; } // Offline-Modus: keine Serverzugriffe, nur die lokale Sperre
  const wasMulti = isMulti();
  await loadConfig();
  if (S.config && S.config.needsSetup) { showSetup(); return; }
  if (locked) return; // unlock() holt nach dem Entsperren das Konto und gleicht ab
  if (loginNeeded()) { if (overlay !== 'login' || wasMulti !== isMulti()) showLogin(); return; }
  hideOverlay(); refreshMe(); sync();
}
