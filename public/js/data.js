// Ansicht „Daten“: Sichern, Bericht, Backups, Sicherheit
import { LANG, LOC, appName, fileBase, isDe, setLang, t } from './i18n.js';
import { LANGS } from './langs.js';
import { handleUnauthorized, showLock } from './auth.js';
import { getRange } from './filters.js';
import { loadRemote, needFor, remoteStatus } from './remote.js';
import { buildReport } from './report.js';
import { S } from './state.js';
import { activeEntries, activeFoods, cutoff, keepMonths, paintDot, pendingCount, persist, persistFoods, purgeOld, scheduleSync, setFoodEnabled, sync, unsyncedCount, viewEntries, wipeFoods } from './store.js';
import { download, downloadApi, exportCsv, exportJson, exportJsonEncrypted, importFile, exportFoodCsv, sorted } from './transfer.js';
import { accountDeleteAvailable, accountDeleteCard } from './account.js';
import { accountCard, adminCards, askAutoPassword, askWhole, askNewPin, askSheet, confirmUnsynced, logoutSheet, pwTempCard, usersCards } from './admin.js';
import { canPrompt, inApk, isInstalled, isIos, promptInstall, secure } from './pwa.js';
import { bioDisable, bioEnable, bioEnabled, bioHintMsg, bioNeedPinMsg, bioSupported, bioUnavailableMsg } from './bio.js';
import { encryptionCards, keyBanner } from './e2ee-ui.js';
import { apiFetch, appVersion, cleanServerUrl, serverConn } from './net.js';
import { cmpVersion, versionMismatch } from './version.js';
import { vault } from './vault.js';
import { applyTheme, applyUrgeColor, paintBadge, refreshViews, syncNav, toast, updateShown } from './ui.js';
import { DAYS_MAX, KEEP_MAX, KEEP_OPTIONS, autoAvailable, autoDays, autoEncAvailable, autoEncrypted, autoFolder, autoKeep, autoState, clearAutoPassword, isCustomDays, isCustomKeep, runAutoBackup, setAutoDays, setAutoKeep } from './autobackup.js';
import { REMIND_MAX, REMIND_OPTIONS, backupDue, isCustomRemind, remindDays, setRemindDays } from './bkprefs.js';
import { isNative, plugin, privacyAvailable, privacyOn, setPrivacy } from './native.js';
import { checkPin, lockAfter, lockAvailable, lockOn, removePin, setLockAfter, setPin } from './applock.js';
import { $, ICON, LS, addDays, diffDays, parseD, el, fmtBytes, fmtD, nE, nF, pad, stampStr, todayStr, ymd, openOverlay, DEV, clearLocalAccount, releaseToBase } from './util.js';

export const rep = { from: null, to: null };
const moreOpen = {}; // aufgeklappte „Weitere …“-Bereiche (bleiben beim Neuzeichnen offen)

export async function wipeAll() {
  S.foods = {}; S.foodSeq = 0; persistFoods(); // „Alle Daten“ umfasst auch das Essen
  if (S.standalone) { S.entries = {}; persist(); S.dataMsg = t('Alle Daten wurden gelöscht.'); refreshViews(); renderData(); return; }
  S.entries = {}; S.seq = 0; LS.set('wipe', true); persist();
  S.dataMsg = t('Alle Daten wurden gelöscht.');
  if (!S.syncing) await sync(); else scheduleSync(300);
  if (LS.get('wipe', false)) S.dataMsg = t('Auf dem Handy gelöscht. Der Server wird beim nächsten Sync geleert.');
  refreshViews(); renderData();
}
export function confirmWipe() {
  const n = activeEntries().length;
  const close = () => ov.remove();
  const cancel = el('button', { type: 'button' }, t('Abbrechen'));
  const del = el('button', { type: 'button', class: 'danger' }, t('Endgültig löschen'));
  cancel.addEventListener('click', close);
  del.addEventListener('click', async () => { close(); if (await confirmUnsynced(unsyncedCount())) wipeAll(); });
  const sheet = el('div', { class: 'sheet', role: 'alertdialog', 'aria-label': t('Alle Daten löschen') },
    el('h2', {}, t('Alle Daten löschen?')),
    el('p', { class: 'warn' }, S.standalone
      ? (n === 1 ? t('{x} wird von diesem Gerät entfernt. Das lässt sich nicht rückgängig machen, sichere die Daten vorher als JSON-Backup.', { x: nE(n) }) : t('{x} werden von diesem Gerät entfernt. Das lässt sich nicht rückgängig machen, sichere die Daten vorher als JSON-Backup.', { x: nE(n) }))
      : (n === 1 ? t('{x} wird auf diesem Handy, auf dem Server und auf allen anderen Geräten entfernt. Server-Backups bleiben erhalten, du kannst sie danach unter „Daten“ zurückspielen oder einzeln löschen.', { x: nE(n) }) : t('{x} werden auf diesem Handy, auf dem Server und auf allen anderen Geräten entfernt. Server-Backups bleiben erhalten, du kannst sie danach unter „Daten“ zurückspielen oder einzeln löschen.', { x: nE(n) }))),
    el('div', { class: 'btns' }, cancel, del));
  const ov = openOverlay(sheet, close);
}

export function confirmWipeFoods() {
  const n = activeFoods().length;
  const close = () => ov.remove();
  const cancel = el('button', { type: 'button' }, t('Abbrechen'));
  const del = el('button', { type: 'button', class: 'danger' }, t('Endgültig löschen'));
  cancel.addEventListener('click', close);
  del.addEventListener('click', async () => { close(); if (!(await confirmUnsynced(unsyncedCount('food')))) return; wipeFoods(); S.dataMsg = t('Essensdaten wurden gelöscht.'); refreshViews(); renderData(); });
  const sheet = el('div', { class: 'sheet', role: 'alertdialog', 'aria-label': t('Essensdaten löschen') },
    el('h2', {}, t('Essensdaten löschen?')),
    el('p', { class: 'warn' }, S.standalone ? t('Alle Essens-Einträge ({n}) werden von diesem Gerät entfernt. Deine Stuhl-Einträge bleiben unverändert.', { n })
      : t('Alle Essens-Einträge ({n}) werden auf diesem Gerät, auf dem Server und auf allen anderen Geräten entfernt. Deine Stuhl-Einträge bleiben unverändert.', { n })),
    el('div', { class: 'btns' }, cancel, del));
  const ov = openOverlay(sheet, close);
}

// Essen ein-/ausschalten (standardmäßig aus; Ausschalten blendet nur aus und löscht nichts)
export function foodCard() {
  const mk = (label, v) => {
    const b = el('button', { type: 'button', class: 'chip' + (S.foodOn === v ? ' on' : '') }, label);
    b.addEventListener('click', async () => { if (S.foodOn === v) return; if (await setFoodEnabled(v)) { refreshViews(); renderData(); } });
    return b;
  };
  return el('div', { class: 'dcard' }, el('h3', {}, t('Essen aufzeichnen')),
    el('p', {}, t('Optional: Neben dem Stuhl auch grob eintragen, was du gegessen hast (z. B. „Pizza“). Im Verlauf siehst du dann zu jedem Eintrag, was du in den Stunden davor gegessen hast. Ausschalten blendet alles aus und löscht nichts.') + (S.standalone ? '' : ' ' + t('Die Einstellung gilt für alle Geräte, die auf diesen Server zugreifen.'))),
    el('div', { class: 'chips' }, mk(t('An'), true), mk(t('Aus'), false)),
    ...(S.foodOn ? [el('p', { class: 'bk-2 mt' }, nF(activeFoods().length))] : []));
}

const repMode = () => (['short', 'normal', 'full'].includes(DEV.get('reportMode', 'normal')) ? DEV.get('reportMode', 'normal') : 'normal');
export function reportCard() {
  const today = todayStr();
  if (!rep.from) { const r = getRange(); rep.from = r.from; rep.to = r.to > today ? today : r.to; }
  const f = el('input', { type: 'date', class: 'dt', value: rep.from, 'aria-label': t('Von') });
  const tt = el('input', { type: 'date', class: 'dt', value: rep.to, 'aria-label': t('Bis') });
  f.addEventListener('change', () => { if (f.value) rep.from = f.value; });
  tt.addEventListener('change', () => { if (tt.value) rep.to = tt.value; });
  const quick = (label, from) => {
    const b = el('button', { type: 'button', class: 'chip' }, label);
    b.addEventListener('click', async () => { rep.from = await from(); rep.to = today; renderData(); });
    return b;
  };
  // „Alles“: ältester Eintrag auf Gerät UND Server (die Server-Angabe wird bei Bedarf geholt, sonst gälte nur der lokale Zeitraum)
  const first = async () => {
    if (!S.standalone && !S.serverInfo) { try { S.serverInfo = await api('/api/storage'); } catch { /* Server nicht erreichbar: nur lokale Einträge */ } }
    const dates = [S.serverInfo && S.serverInfo.entries.first, activeEntries().map((e) => e.date).sort()[0]].filter(Boolean).sort();
    return dates[0] || today;
  };
  const go = el('button', { type: 'button', class: 'dbtn primary' }, t('PDF erstellen'));
  go.addEventListener('click', async () => {
    let [a, b] = [rep.from, rep.to]; if (a > b) [a, b] = [b, a];
    // Angaben für den Bericht: Name/Geburtsdatum nur im PDF, Essen optional; auf Wunsch auf diesem Gerät gemerkt
    const info = LS.get('reportInfo', null) || null;
    const hasFood = S.foodOn || activeFoods().length > 0;
    const v = await askSheet({ title: t('PDF-Bericht'), focus: false, ok: t('PDF erstellen'),
      text: t('Name und Geburtsdatum sind freiwillig und erscheinen nur im PDF, z. B. für die Arztpraxis.'),
      fields: [{ name: 'name', label: t('Name (optional)'), value: (info && info.name) || '' }, { name: 'birth', label: t('Geburtsdatum (optional)'), value: (info && info.birth) || '' },
        ...(hasFood ? [{ name: 'food', type: 'toggle', label: t('Essen einbeziehen'), value: !!(info && info.food) }] : []),
        { name: 'bw', type: 'toggle', label: t('Schwarz-Weiß (für Drucker ohne Farbe)'), value: !!(info && info.bw) },
        { name: 'password', type: 'password', label: t('Passwort für das PDF (optional)'), value: '' },
        { name: 'keep', type: 'toggle', label: t('Angaben auf diesem Gerät merken'), value: !!info }] });
    if (!v) return;
    const opts = { name: v.name.trim().slice(0, 60), birth: v.birth.trim().slice(0, 20), food: !!v.food, bw: !!v.bw };
    LS.set('reportInfo', v.keep ? opts : null); // das Passwort wird nie gespeichert
    opts.password = v.password || '';
    // auch der gleich lange Zeitraum davor wird gebraucht (Vergleich in der Zusammenfassung)
    const span = diffDays(a, b > today ? today : b) + 1, pa = ymd(addDays(parseD(a), -span));
    const need = needFor(pa, b); // Zeitraum reicht über den lokal gespeicherten Bereich hinaus: vom Server nachladen
    let missing = false;
    if (need && remoteStatus(need) !== 'ok') {
      S.dataMsg = t('Lade ältere Einträge vom Server …'); renderData();
      await loadRemote(need); missing = remoteStatus(need) !== 'ok';
    }
    const mode = repMode();
    const { blob, count } = await buildReport(a, b, mode, opts);
    const modeName = { short: isDe ? 'kurz' : 'short', normal: 'normal', full: isDe ? 'ausfuehrlich' : 'detailed' }[mode];
    download(`${fileBase()}-${isDe ? 'bericht' : 'report'}-${modeName}-${a}_${b}-${stampStr()}.pdf`, blob, 'application/pdf');
    S.dataMsg = (count ? (count === 1 ? t('PDF mit 1 Eintrag erstellt.') : t('PDF mit {n} Einträgen erstellt.', { n: count.toLocaleString(LOC) })) : t('PDF erstellt (keine Einträge im Zeitraum).'))
      + (missing ? ' ' + t('Ältere Einträge konnten nicht vom Server geladen werden, der Bericht enthält nur lokale Einträge.') : '');
    renderData();
  });
  // Hinweis nur, wenn der Zeitraum über die lokal gespeicherten Monate hinausgeht
  const hint = el('p', { class: 'bk-2 rep-hint' }, t('Ältere Einträge werden beim Erstellen vom Server geladen.'));
  const updHint = () => { let [a, b] = [rep.from, rep.to]; if (a > b) [a, b] = [b, a]; hint.hidden = S.standalone || !needFor(a, b); };
  f.addEventListener('change', updHint); tt.addEventListener('change', updHint); updHint();
  // kompakte Seite: eigene Klasse „rep-card“ (siehe style.css), die Überschrift steht schon im Seitenkopf
  return el('div', { class: 'dcard rep-card' },
    el('div', { class: 'setlbl' }, t('Umfang')),
    el('div', { class: 'chips' }, [['short', t('Kurz')], ['normal', t('Normal')], ['full', t('Ausführlich')]].map(([v, label]) => {
      const b = el('button', { type: 'button', class: 'chip' + (repMode() === v ? ' on' : '') }, label);
      b.addEventListener('click', () => { DEV.set('reportMode', v); renderData(); }); return b;
    })),
    el('p', { class: 'bk-2 rep-desc' }, { short: t('Alle Auswertungen, von den Einträgen nur die Auffälligkeiten.'), normal: t('Alle Auswertungen und alle Einträge als kompakte Tabelle mit Notizen.'), full: t('Alle Auswertungen und alle Einträge, jede Angabe in eigener Spalte.') }[repMode()]),
    el('div', { class: 'setlbl' }, t('Zeitraum')),
    el('div', { class: 'chips rep-chips' }, quick(t('4 Wochen'), () => ymd(addDays(new Date(), -27))), quick(t('3 Monate'), () => ymd(addDays(new Date(), -90))), quick(t('Alles'), first)),
    el('div', { class: 'sub rep-sub' }, f, el('span', { class: 'sep' }, t('bis')), tt),
    hint,
    el('div', { class: 'drow' }, go));
}

/* ---- Server-Backups ---- */
export async function api(path, opts = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await apiFetch(path, { ...opts, signal: ctrl.signal, headers: { 'Content-Type': 'application/json' } });
    if (r.status === 401) { handleUnauthorized(); throw new Error('HTTP 401'); }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(to); }
}
export const fmtDT = (ms) => {
  const d = new Date(ms), same = d.getFullYear() === new Date().getFullYear();
  return `${d.toLocaleDateString(LOC, { weekday: 'short' }).replace('.', '')} ${d.toLocaleDateString(LOC, { day: '2-digit', month: '2-digit', year: same ? undefined : '2-digit' })} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fmtSize = (b) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);
export const bkKind = (n) => (n.endsWith('-auto.db') ? t('automatisch') : n.endsWith('-vor-restore.db') ? t('vor Wiederherstellung') : t('manuell'));

export function confirmRestore(b, done) {
  const close = () => ov.remove();
  const cancel = el('button', { type: 'button' }, t('Abbrechen'));
  const go = el('button', { type: 'button', class: 'danger' }, t('Wiederherstellen'));
  cancel.addEventListener('click', close);
  go.addEventListener('click', async () => {
    close();
    try {
      const r = await api('/api/restore', { method: 'POST', body: JSON.stringify({ name: b.name }) });
      S.dataMsg = t('Backup vom {d} wiederhergestellt ({n}).', { d: fmtDT(b.mtime), n: nE(r.count) });
      if (!S.syncing) await sync(); else scheduleSync(200);
    } catch { S.dataMsg = t('Wiederherstellen fehlgeschlagen – Server nicht erreichbar?'); }
    refreshViews(); renderData();
  });
  const sheet = el('div', { class: 'sheet', role: 'alertdialog', 'aria-label': t('Backup wiederherstellen') },
    el('h2', {}, t('Backup wiederherstellen?')),
    el('p', { class: 'warn' }, t('Der Stand vom {d} ({n}) ersetzt die aktuellen Daten auf dem Server und auf allen Geräten. Noch nicht synchronisierte Änderungen auf diesem Handy gehen verloren. Vorher legt der Server automatisch einen Sicherungspunkt vom jetzigen Stand an.', { d: fmtDT(b.mtime), n: b.count == null ? '?' : nE(b.count) })),
    el('div', { class: 'btns' }, cancel, go));
  const ov = openOverlay(sheet, close);
}

export function confirmDeleteBackup(b, done) {
  const close = () => ov.remove();
  const cancel = el('button', { type: 'button' }, t('Abbrechen'));
  const go = el('button', { type: 'button', class: 'danger' }, t('Backup löschen'));
  cancel.addEventListener('click', close);
  go.addEventListener('click', async () => {
    close();
    try { await api('/api/backups/' + encodeURIComponent(b.name), { method: 'DELETE' }); toast(t('Backup gelöscht')); }
    catch { toast(t('Löschen fehlgeschlagen – Server nicht erreichbar?')); }
    done();
  });
  const sheet = el('div', { class: 'sheet', role: 'alertdialog', 'aria-label': t('Backup löschen') },
    el('h2', {}, t('Backup löschen?')),
    el('p', { class: 'warn' }, t('Das Backup vom {d} ({n}) wird vom Server entfernt. Deine aktuellen Daten bleiben unverändert.', { d: fmtDT(b.mtime), n: b.count == null ? '?' : nE(b.count) })),
    el('div', { class: 'btns' }, cancel, go));
  const ov = openOverlay(sheet, close);
}

export function backupCard() {
  const body = el('div', { class: 'bk-body' }, el('p', {}, t('Lade …')));
  const card = el('div', { class: 'dcard' }, el('h3', {}, t('Server-Backups')),
    el('p', {}, t('Der Server sichert automatisch einmal täglich (die letzten 30 Stände bleiben). Du kannst jederzeit einen Sicherungspunkt anlegen, Backups herunterladen oder einen älteren Stand zurückspielen.')),
    body);
  const draw = (data) => {
    const now = el('button', { type: 'button', class: 'dbtn primary' }, t('Jetzt Backup anlegen'));
    now.addEventListener('click', async () => {
      now.disabled = true;
      try { await api('/api/backup', { method: 'POST', body: '{}' }); toast(t('Backup angelegt')); load(); }
      catch { toast(t('Server nicht erreichbar')); now.disabled = false; }
    });
    const list = el('div', { class: 'bk-list' }, data.backups.length ? data.backups.map((b) => {
      const dl = el('button', { type: 'button', 'aria-label': t('Herunterladen') }, t('Laden'));
      const rs = el('button', { type: 'button', 'aria-label': t('Wiederherstellen') }, t('Zurückspielen'));
      dl.addEventListener('click', () => downloadApi('/api/backups/' + encodeURIComponent(b.name), b.name));
      const rm = el('button', { type: 'button', class: 'rm', 'aria-label': t('Backup löschen'), html: ICON.trash });
      rs.addEventListener('click', () => confirmRestore(b));
      rm.addEventListener('click', () => confirmDeleteBackup(b, load));
      return el('div', { class: 'bk-row' },
        el('div', { class: 'bk-t' }, el('div', { class: 'bk-1' }, fmtDT(b.mtime)),
          el('div', { class: 'bk-2' }, `${b.count == null ? '?' : nE(b.count)} · ${fmtSize(b.size)} · ${bkKind(b.name)}`)), dl, rs, rm);
    }) : el('p', { class: 'bk-2' }, t('Noch kein Backup vorhanden. Das erste entsteht automatisch, sobald Daten gespeichert sind.')));
    body.replaceChildren(el('div', { class: 'drow' }, now), list);
  };
  async function load() {
    try { draw(await api('/api/backups')); }
    catch { body.replaceChildren(el('p', { class: 'bk-2' }, t('Server nicht erreichbar. Backups sind nur im Heimnetz verfügbar.'))); }
  }
  load();
  return card;
}

// Web-App aus dem Cache neu laden: holt geänderte Dateien vom eigenen Server bzw. Webspace (nur Web-App; die APK bekommt Updates über eine neue APK)
async function checkUpdate() {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) { toast(t('Updates werden hier nicht unterstützt.')); return; }
  toast(t('Suche nach Updates …'));
  try { await reg.update(); } catch { toast(t('Server nicht erreichbar.')); return; }
  if (reg.installing || reg.waiting) { toast(t('Neue Version wird geladen …')); return; }
  setTimeout(() => { if (!updateShown()) toast(t('Du hast die neueste Version.')); }, 1500);
}

// Einträge für den Export: mit Server immer alle, auch die älteren, die nicht auf dem Gerät liegen. null = abgebrochen.
// Ist der Server nicht erreichbar, bleibt nur ein lokales Backup; das wird erst nach einer Rückfrage erstellt.
async function exportEntries() {
  if (S.standalone || !cutoff()) return sorted(); // alles liegt auf dem Gerät
  let ok = false;
  if (!S.offline) {
    toast(t('Lade alle Einträge …'));
    const need = { key: 'export-all', from: '0000-01-01', to: '9999-12-31' };
    delete S.remoteMeta[need.key]; await loadRemote(need);
    ok = !!(S.remoteMeta[need.key] && S.remoteMeta[need.key].ok);
  }
  if (ok) return viewEntries().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const v = await askSheet({ title: t('Server nicht erreichbar'), ok: t('Lokales Backup erstellen'),
    text: t('Ohne Server ist nur ein lokales Backup möglich. Es enthält nur die Einträge, die auf diesem Gerät liegen; ältere fehlen.') });
  return v ? sorted() : null;
}

// Hinweis, wenn die verbundene App und der Server nicht zusammenpassen (leer = alles in Ordnung)
function versionWarning() {
  const srv = S.config && S.config.version, kind = serverConn() ? versionMismatch(appVersion, srv) : '';
  if (kind === 'newer') return t('Die App ({a}) ist neuer als der Server ({s}). Aktualisiere zuerst den Server, sonst funktionieren manche Funktionen nicht.', { a: appVersion, s: srv });
  if (kind === 'major') return t('App ({a}) und Server ({s}) haben unterschiedliche Hauptversionen. Aktualisiere beide auf dieselbe Version.', { a: appVersion, s: srv });
  return '';
}

// Quellcode und Fehlermeldungen (öffnet im Browser; in der Android-App öffnet Capacitor externe Adressen im System-Browser)
const REPO = 'https://github.com/JamDevLab/GutKeeper';
// Links als Liste wie in den Einstellungen anderer Apps: Titel, kurze Erklärung, Symbol für „öffnet extern“
// Neueste veröffentlichte Version auf GitHub abfragen. Nur auf Tippen (keine automatische Anfrage an Dritte), ohne Anmeldung.
// Das Ergebnis erscheint in einem Fenster. Verglichen wird, was hier läuft: die App selbst (APK bzw. serverlose Web-App)
// und/oder der Server, dessen Dateien die Web-App lädt (Docker).
async function checkGithub() {
  toast(t('Frage GitHub …'));
  let rel;
  try {
    const r = await fetch('https://api.github.com/repos/JamDevLab/GutKeeper/releases/latest', { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (r.status === 404) { toast(t('Auf GitHub ist noch keine Version veröffentlicht.')); return; }
    if (!r.ok) throw new Error(String(r.status));
    rel = await r.json();
  } catch { toast(t('GitHub ist nicht erreichbar. Später noch einmal versuchen.')); return; }
  const latest = String(rel.tag_name || '').replace(/^v/i, '');
  const date = rel.published_at ? new Date(rel.published_at).toLocaleDateString(LOC) : '';
  const srvVer = S.config && S.config.version;
  const url = rel.html_url || REPO + '/releases/latest';
  const behind = (v) => v && cmpVersion(v, latest) < 0;
  const appOld = S.staticBuild && behind(appVersion), srvOld = (!S.staticBuild || serverConn()) && behind(srvVer);
  const body = [el('p', { class: 'bk-2' }, date ? t('Neueste Version {v} vom {d}', { v: latest, d: date }) : t('Neueste Version: {v}', { v: latest }))];
  if (!appOld && !srvOld) body.push(el('p', {}, t('Du bist auf dem neuesten Stand.')));
  if (appOld && inApk()) body.push(el('p', {}, t('Neue App-Version {v}: Lade die APK aus dem Release herunter und installiere sie über die alte (die Daten bleiben erhalten).', { v: latest })));
  else if (appOld) body.push(el('p', {}, t('Neue Version {v}: Lade die Web-Version (ZIP) aus dem Release und ersetze die Dateien auf deinem Webspace.', { v: latest })));
  if (srvOld) body.push(el('p', {}, t('Neue Server-Version {v} (läuft: {s}). Aktualisieren mit Docker:', { v: latest, s: srvVer })), el('code', { class: 'cmd' }, 'docker compose pull && docker compose up -d'));
  const close = () => ov.remove();
  const shut = el('button', { type: 'button' }, t('Schließen'));
  const open = el('a', { class: 'primary', href: url, target: '_blank', rel: 'noopener noreferrer' }, appOld || srvOld ? t('Zum Release') : t('Änderungen ansehen'));
  shut.addEventListener('click', close);
  const sheet = el('div', { class: 'sheet ghsheet', role: 'dialog', 'aria-label': t('Updates') },
    el('h2', {}, appOld || srvOld ? t('Update verfügbar') : t('Kein Update nötig')), ...body, el('div', { class: 'btns' }, shut, open));
  const ov = openOverlay(sheet, close);
}

// Zeile im Stil der Links, aber als Knopf (öffnet nichts Externes)
const actRow = (title, sub, onClick) => { const b = el('button', { type: 'button', class: 'menurow' }, el('span', { class: 'mr-t' }, el('b', {}, title), el('span', { class: 'bk-2' }, sub)), el('i', { class: 'chev', html: ICON.right })); b.addEventListener('click', onClick); return b; };

const extRow = (title, sub, href) => el('a', { class: 'menurow', href, target: '_blank', rel: 'noopener noreferrer' },
  el('span', { class: 'mr-t' }, el('b', {}, title), el('span', { class: 'bk-2' }, sub)), el('i', { class: 'chev', html: ICON.ext }));
export function aboutCard() {
  const name = appName(S.config);
  const srvVer = S.config && S.config.version;
  const verText = appVersion ? `${t('Version')} ${appVersion}${serverConn() ? ` · ${t('Server')} ${srvVer || '?'}` : ''} · ` : srvVer ? `${t('Version')} ${srvVer} · ` : '';
  const warn = versionWarning();
  return el('div', { class: 'dcard about' }, el('h3', {}, t('Über {name}', { name })),
    el('p', {}, `GutKeeper · ${verText}${t('Lizenz: GNU AGPL-3.0 · Copyright © 2026 JamDevLab')}`),
    ...(warn ? [el('p', { class: 'warn' }, warn)] : []),
    el('div', { class: 'menu about-links' },
      actRow(t('Nach Updates suchen'), t('Fragt github.com nach der neuesten Version, nur beim Tippen'), checkGithub),
      ...('serviceWorker' in navigator && !inApk() ? [actRow(t('Web-App neu laden'), t('Holt geänderte Dateien vom eigenen Server'), checkUpdate)] : []),
      extRow(t('Fehler melden oder Idee vorschlagen'), t('GitHub-Issues'), REPO + '/issues/new/choose'),
      extRow(t('Neuigkeiten'), t('Änderungen je Version'), REPO + (isDe ? '/blob/main/CHANGELOG.de.md' : '/blob/main/CHANGELOG.md')),
      extRow(t('Quellcode'), 'github.com/JamDevLab/GutKeeper', REPO)),
    el('p', { class: 'bk-2' }, t('Hinweis: Dieses Tagebuch dient der eigenen Aufzeichnung und ersetzt keine ärztliche Beratung, Untersuchung oder Diagnose. Bei Blut im Stuhl, anhaltenden Beschwerden oder Unsicherheit wende dich bitte an eine Ärztin oder einen Arzt. Die Nutzung erfolgt auf eigene Verantwortung, es wird keine Haftung übernommen.')));
}

// Als App installieren (PWA): Knopf, wenn der Browser es anbietet (nur über HTTPS), sonst ein Hinweis
function installRow(row) {
  if (inApk() || isInstalled()) return [];
  const title = t('Als App installieren');
  if (canPrompt()) {
    const b = el('button', { type: 'button', class: 'dbtn primary' }, t('Installieren'));
    b.addEventListener('click', async () => { await promptInstall(); renderData(); });
    return [row(title, el('div', { class: 'drow' }, b), t('Legt ein Symbol auf dem Startbildschirm an; die App öffnet ohne Browserleiste.'))];
  }
  const hint = isIos() ? t('Safari: Teilen-Symbol, dann „Zum Home-Bildschirm“.')
    : !secure() ? t('Der Browser bietet die Installation nur über HTTPS an.')
      : t('Im Browser-Menü: „App installieren“ oder „Zum Startbildschirm hinzufügen“.');
  return [row(title, el('p', { class: 'bk-2' }, hint))];
}
addEventListener('gutkeeper-installable', () => { if (S.tab === 'data') renderData(); });

// Eigenständige Version (auch Android-App): mit einem GutKeeper-Server verbinden bzw. wieder trennen
function serverLinkCard() {
  const conn = serverConn();
  const msg = (m) => { S.dataMsg = m; renderData(); };
  // Bei einem Fehler öffnet sich der Dialog erneut mit der eingegebenen Adresse und der Meldung, statt die Eingabe zu verwerfen
  const connect = async (last = '', error = '') => {
    const v = await askSheet({
      title: t('Mit Server verbinden'),
      text: t('Adresse deines GutKeeper-Servers, z. B. https://gutkeeper.example.org. Die Einträge dieses Geräts werden zum Server übertragen. Der Server muss diese App in der Einstellung CORS_ORIGINS erlauben ({o}).', { o: location.origin }) + (autoAvailable() || remindDays() ? ' ' + t('Mit Server sichert der Server die Daten. Backup-Erinnerung und automatische Backups auf diesem Gerät entfallen dann.') : ''),
      fields: [{ name: 'url', label: t('Server-Adresse'), required: true, value: last }], ok: t('Verbinden'), error,
    });
    if (!v) return;
    const retry = (m) => connect(v.url, m);
    const url = cleanServerUrl(v.url);
    if (!url) return retry(t('Ungültige Adresse.'));
    if (location.protocol === 'https:' && url.startsWith('http:') && isNative()) { // Android-App: http ist erlaubt, wenn sie dafür gebaut wurde (tools/android-http.js); vorher warnen
      const ok = await askSheet({ title: t('Unverschlüsselte Verbindung'), danger: true, ok: t('Trotzdem verbinden'),
        text: t('Dieser Server ist nur über http erreichbar. Anmeldung und Einträge laufen dann unverschlüsselt durch dein Netz. Nutze das nur im eigenen, vertrauenswürdigen Heimnetz. Mit Ende-zu-Ende-Verschlüsselung bleiben die Einträge selbst geschützt.') });
      if (!ok) return;
    } else if (location.protocol === 'https:' && url.startsWith('http:')) return retry(t('Diese App läuft über HTTPS und erreicht keinen unverschlüsselten http://-Server. Bitte die https://-Adresse verwenden.'));
    toast(t('Verbinde …'));
    try {
      const ctrl = new AbortController(), to = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(url + '/api/health', { credentials: 'omit', signal: ctrl.signal }); clearTimeout(to);
      const j = await r.json();
      if (!r.ok || j.status !== 'ok') throw new Error('health');
    } catch { return retry(isNative() && url.startsWith('http:') ? t('Keine Verbindung. Bei http muss die App dafür gebaut sein (siehe Anleitung, tools/android-http.js). Außerdem muss der Server die App in CORS_ORIGINS erlauben ({o}).', { o: location.origin }) : t('Keine Verbindung. Adresse prüfen. Der Server muss diese App in CORS_ORIGINS erlauben ({o}).', { o: location.origin })); }
    DEV.set('server', { url, adopt: true }); DEV.set('config', null); DEV.set('session', null);
    location.reload();
  };
  const disconnect = async () => {
    const v = await askSheet({
      title: t('Server trennen'),
      text: t('Danach arbeitet die App wieder nur mit den Daten auf diesem Gerät. Der Server und seine Daten bleiben unverändert.'),
      fields: [{ type: 'choice', name: 'all', label: t('Daten'), value: 'all', options: [['all', t('Alles vom Server laden')], ['local', t('Nur das behalten, was auf dem Gerät ist')]] }],
      ok: t('Trennen'),
    });
    if (!v) return;
    if (v.all === 'all') {
      msg(t('Lade alle Einträge …'));
      if (pendingCount() && S.online && !S.offline) await sync();
      if (cutoff()) { // das Gerät speichert nur die letzten Monate: den Rest vom Server holen
        const need = { key: 'disconnect-all', from: '0000-01-01', to: '9999-12-31' };
        delete S.remoteMeta[need.key]; await loadRemote(need);
        if (!S.remoteMeta[need.key] || !S.remoteMeta[need.key].ok) return msg(t('Server nicht erreichbar. Die Verbindung bleibt bestehen.'));
        for (const e of Object.values(S.remote)) if (!e.deleted && !S.entries[e.id]) S.entries[e.id] = { ...e };
      }
    }
    for (const e of Object.values(S.entries)) delete e._d;
    for (const f of Object.values(S.foods)) delete f._d;
    S.seq = 0; S.epoch = null; S.foodSeq = 0; LS.set('seq', 0); LS.set('epoch', null); LS.set('foodSeq', 0); LS.set('wipe', false);
    persist(); persistFoods();
    if (S.dataKey) { await vault.clearDataKey(); S.dataKey = null; } // lokal liegen die Daten im Klartext (im verschlüsselten Geräte-Speicher)
    await vault.flush();
    const uid = S.user && S.user.id;
    if (uid) { await releaseToBase(uid); await clearLocalAccount(uid); }
    DEV.set('server', null); DEV.set('config', null); DEV.set('session', null); DEV.set('offline', false);
    location.reload();
  };
  return conn
    ? card2(t('Server-Verbindung'), el('p', {}, t('Verbunden mit {u}', { u: conn.url })), ...(conn.url.startsWith('http:') ? [el('p', { class: 'warn' }, t('Die Verbindung ist nicht verschlüsselt (http). Nutze sie nur im vertrauenswürdigen Heimnetz.'))] : []), el('p', { class: 'bk-2' }, t('Abgleich, Anmeldung und Server-Funktionen laufen über diese Adresse.')), el('div', { class: 'drow' }, dbtn(t('Server trennen …'), disconnect, 'danger')))
    : card2(t('Server-Verbindung'), el('p', {}, t('Diese App speichert alles nur auf diesem Gerät. Du kannst sie mit deinem eigenen GutKeeper-Server verbinden (Abgleich zwischen Geräten, Backups). Vorhandene Einträge werden übertragen.')), el('div', { class: 'drow' }, dbtn(t('Mit Server verbinden …'), () => connect(), 'primary')));
}
const card2 = (title, ...kids) => el('div', { class: 'dcard' }, el('h3', {}, title), ...kids);
const dbtn = (label, fn, cls = '') => { const b = el('button', { type: 'button', class: 'dbtn ' + cls }, label); b.addEventListener('click', fn); return b; };

// App-Einstellungen dieses Geräts: Darstellung, Sprache, Start
export function appCard() {
  const chips = (opts, isOn, pick) => el('div', { class: 'chips' }, opts.map(([v, label]) => {
    const b = el('button', { type: 'button', class: 'chip' + (isOn(v) ? ' on' : '') }, label);
    b.addEventListener('click', () => pick(v)); return b;
  }));
  const row = (label, kid, hint) => el('div', { class: 'setrow' }, el('div', { class: 'setlbl' }, label), kid, hint ? el('p', { class: 'bk-2' }, hint) : null);
  const theme = DEV.get('theme', null) || null;
  return el('div', { class: 'dcard' }, el('h3', {}, t('App')),
    row(t('Darstellung'), chips([[null, t('Automatisch')], ['light', t('Hell')], ['dark', t('Dunkel')]], (v) => theme === v, (v) => { DEV.set('theme', v); applyTheme(v); renderData(); })),
    row('Sprache / Language', chips(LANGS.map((l) => [l.code, l.name]), (v) => LANG === v, (v) => { if (LANG !== v) setLang(v); })),
    row(t('Stuhldrang im Verlauf farbig'), chips([[true, t('An')], [false, t('Aus')]], (v) => DEV.get('urgeColor', true) === v, (v) => { DEV.set('urgeColor', v); applyUrgeColor(); renderData(); }),
      t('Der Stuhldrang in der Verlaufsliste wird gelb, orange oder rot hervorgehoben.')),
    row(t('Beim Öffnen mit „Erfassen“ starten'), chips([[true, t('An')], [false, t('Aus')]], (v) => DEV.get('homeOnOpen', true) === v, (v) => { DEV.set('homeOnOpen', v); renderData(); }),
      t('Auch wenn die App nur im Hintergrund war.')),
    ...(S.standalone ? [] : [
      row(t('Nur auf diesem Gerät (Offline-Modus)'), chips([[true, t('An')], [false, t('Aus')]], (v) => S.offline === v, (v) => {
        if (S.offline === v) return;
        S.offline = v; DEV.set('offline', v); paintDot(); if (!v) sync(); renderData();
      }), t('Kein Abgleich mit dem Server: Einträge bleiben auf diesem Gerät, bis du den Modus ausschaltest. Dann werden sie gesendet.')),
      row(t('Warnen, wenn Daten nur auf diesem Gerät liegen'), chips([[true, t('An')], [false, t('Aus')]], (v) => DEV.get('warnUnsynced', true) === v, (v) => { DEV.set('warnUnsynced', v); renderData(); }),
        t('Vor dem Löschen von Einträgen, die noch nicht auf dem Server sind.')),
    ]),
    ...iconRow(row),
    ...installRow(row));
}

// Icon auf dem Startbildschirm (nur Android-App): feste Varianten in der APK, umgeschaltet über das Plugin AppIcon
const ICON_SETS = [['bristol', 'Bristol'], ['ring', 'Kranz'], ['guard', 'Wächter'], ['crest', 'Wappen'], ['classic', 'Klassisch'], ['shield', 'Schild'], ['list', 'Liste'], ['diary', 'Tagebuch']];
function iconRow(row) {
  const P = plugin('AppIcon');
  if (!P) return [];
  const box = el('div', { class: 'iconpick' });
  const paint = (cur) => box.replaceChildren(...ICON_SETS.map(([v, label]) => {
    const b = el('button', { type: 'button', class: 'iconopt' + (cur === v ? ' on' : ''), 'aria-pressed': String(cur === v) },
      el('img', { src: `icons/${v}/icon-192.png`, alt: '', width: 48, height: 48 }), el('span', {}, t(label)));
    b.addEventListener('click', async () => {
      if (cur === v) return;
      try { await P.set({ icon: v }); paint(v); toast(t('Icon geändert. Der Startbildschirm zeigt es nach wenigen Sekunden.')); } catch { toast(t('Das hat nicht geklappt.')); }
    });
    return b;
  }));
  paint(null);
  P.get().then((r) => paint(r && r.icon)).catch(() => {});
  return [row(t('Icon auf dem Startbildschirm'), box, t('„Wächter“, „Wappen“, „Schild“, „Liste“ und „Tagebuch“ sind neutral und verraten nicht, wofür die App ist.'))];
}

export function renderData() {
  const root = $('#vData');
  const oldList = root.querySelector('.list'), keepTop = oldList ? oldList.scrollTop : 0, keepPage = oldList && oldList.dataset.page; // dieselbe Seite neu zeichnen (z. B. nach einem Tipp auf eine Auswahl): Position behalten
  root.replaceChildren();
  const active = activeEntries().length, pend = pendingCount();
  const btn = (label, fn, cls = '') => { const b = el('button', { type: 'button', class: 'dbtn ' + cls }, label); b.addEventListener('click', fn); return b; };
  const show = (m) => { S.dataMsg = m; renderData(); };
  const file = el('input', { type: 'file', accept: '.json,.csv,text/csv,application/json', hidden: true });
  const pickFile = () => { S.stayOnReturn = Date.now(); file.click(); }; // nach der Auswahl auf dieser Seite bleiben (siehe app.js)
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    let failed = false;
    try { S.dataMsg = await importFile(f); } catch (err) { S.dataMsg = t('Import fehlgeschlagen: ') + err.message; failed = !!err.message; }
    file.value = ''; refreshViews(); renderData();
    // Die Meldung steht oben auf der Seite; dorthin scrollen, damit man sie sieht (Fehler zusätzlich als Hinweis unten)
    const l = $('#vData .list'); if (l && S.dataMsg) l.scrollTop = 0;
    if (failed) toast(S.dataMsg);
  });
  const card = (title, ...kids) => el('div', { class: 'dcard' }, el('h3', {}, title), ...kids);
  const setKeep = (m) => {
    const old = keepMonths(); S.keepOverride = m; LS.set('keep', m);
    if (!m || (old && m > old)) { S.seq = 0; persist(); } // mehr Daten gewünscht: beim nächsten Abgleich vom Server nachladen
    purgeOld(); persist(); S.dataMsg = m ? t('Dieses Gerät speichert jetzt {x}.', { x: monthsLabel(m) }) : t('Dieses Gerät speichert jetzt alle Einträge.');
    scheduleSync(0); refreshViews(); renderData();
  };
  const monthsLabel = (m) => (m === 0 ? t('alles') : m % 12 === 0 && m >= 24 ? t('{n} Jahre', { n: m / 12 }) : t('{n} Monate', { n: m }));
  const deviceCard = () => {
    const cut = cutoff(), def = S.config && Number.isFinite(S.config.localMonths) ? S.config.localMonths : 12;
    const opts = [...new Set([def, 12, 36, 0])].sort((x, y) => (x || 1e9) - (y || 1e9));
    return card(t('Daten auf diesem Gerät'),
      el('p', {}, t('Wie weit zurück soll dieses Gerät Einträge speichern? Ältere bleiben auf dem Server und können bei bestehender Verbindung trotzdem angesehen werden.')),
      el('div', { class: 'chips' }, opts.map((m) => {
        const b = el('button', { type: 'button', class: 'chip' + (keepMonths() === m ? ' on' : '') }, m === 0 ? t('Alles') : monthsLabel(m));
        b.addEventListener('click', () => setKeep(m)); return b;
      })),
      el('p', { class: 'bk-2 mt' }, `${t('{n} gespeichert', { n: nE(active) })}${cut ? ' ' + t('seit {d}', { d: fmtD(cut) }) : ''}. ${t('Standard des Servers: {x}.', { x: def ? monthsLabel(def) : t('alles') })}`),
      ...(cut ? [
        el('p', { class: 'mt' }, t('Ältere Zeiträume in Verlauf, Statistik und Bericht:')),
        el('div', { class: 'chips' }, [[true, t('Automatisch laden')], [false, t('Nur auf Tipp')]].map(([v, l]) => {
          const b = el('button', { type: 'button', class: 'chip' + (S.remoteAuto === v ? ' on' : '') }, l);
          b.addEventListener('click', () => { S.remoteAuto = v; LS.set('remote', v); renderData(); }); return b;
        })),
        el('p', { class: 'bk-2 mt' }, t('Dabei werden nur die gewünschten Einträge komprimiert übertragen und nicht auf dem Gerät gespeichert. Grobe Größe: ein Monat etwa 3 KB, ein Jahr etwa 40 KB, alle 4.600 Einträge etwa 150 KB. Im WLAN oder per VPN daheim kostet das kein Mobilfunk-Datenvolumen; per Mobilfunk zählt es dazu. Ohne Verbindung fehlen die älteren Einträge.')),
      ] : []));
  };

  // Speicherverbrauch: Gerät und Server
  const storageCard = () => {
    const LIMIT = 5 * 1024 * 1024; // grobe Obergrenze des Browser-Speichers (localStorage)
    const idb = vault.mode === 'idb'; // verschlüsselter Speicher (IndexedDB): keine 5-MB-Grenze
    let used = 0;
    if (idb) used = JSON.stringify(S.entries).length + JSON.stringify(S.foods).length;
    else for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('gutkeeper.')) used += k.length + localStorage.getItem(k).length; }
    const bar = (f) => el('div', { class: 'stor-bar' }, el('i', { style: `width:${Math.max(1, Math.min(100, f * 100))}%` }));
    const block = (title, ...kids) => el('div', { class: 'stor-b' }, el('div', { class: 'stor-t' }, title), ...kids);
    const cut = cutoff();
    const local = block(t('Auf diesem Gerät'), ...(idb ? [] : [bar(used / LIMIT)]),
      el('p', { class: 'bk-2' }, `${idb ? fmtBytes(used) : t('{a} von ca. {b}', { a: fmtBytes(used), b: fmtBytes(LIMIT) })} · ${nE(active)}${cut ? ' ' + t('seit {d}', { d: fmtD(cut) }) : ''}`),
      el('p', { class: 'bk-2' }, idb ? t('Verschlüsselt gespeichert (IndexedDB).') : t('Unverschlüsselt im Browser-Speicher. Mit HTTPS wird der lokale Speicher automatisch verschlüsselt.')));
    // Die asynchronen Angaben werden beim erneuten Zeichnen sofort aus dem Zwischenspeicher gesetzt, damit die Höhe der Seite (und damit die Scrollposition) stabil bleibt
    const showUsage = (u) => { if (u) local.append(el('p', { class: 'bk-2' }, t('Browser-Speicher der App insgesamt: {x} (inkl. App-Dateien)', { x: fmtBytes(u) }))); };
    if (S.usageCache) showUsage(S.usageCache);
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then((e) => { if (e.usage && !S.usageCache) showUsage(e.usage); S.usageCache = e.usage || 0; }).catch(() => {});
    }
    if (S.standalone) return card(t('Speicherverbrauch'), local);
    const server = block(t('Auf dem Server'), el('p', { class: 'bk-2' }, t('Lade …')));
    // Normale Nutzer bekommen nur ihre eigenen Zahlen (kein db/backups/disk, siehe server/storage.js): die Angaben sind optional
    const fill = (i) => {
      const range = i.entries.first ? ` (${fmtD(i.entries.first)} – ${fmtD(i.entries.last)})` : '';
      const rows = [];
      if (i.db != null) rows.push(t('Datenbank: {a} · {b}', { a: fmtBytes(i.db), b: nE(i.entries.active) + range }));
      else rows.push(nE(i.entries.active) + range);
      if (i.backups) rows.push(t('Backups: {a} in {n} {u}', { a: fmtBytes(i.backups.bytes), n: i.backups.count, u: i.backups.count === 1 ? t('Datei') : t('Dateien') }));
      if (S.foodOn && i.foods) rows.push(t('Essen: {n}', { n: nF(i.foods.active) }));
      if (i.entries.active > active) rows.push(t('{n} nur auf dem Server (älter als der Speicher-Zeitraum dieses Geräts)', { n: nE(i.entries.active - active) }));
      server.replaceChildren(el('div', { class: 'stor-t' }, t('Auf dem Server')),
        ...(i.disk ? [bar((i.disk.total - i.disk.free) / i.disk.total)] : []),
        ...rows.map((r) => el('p', { class: 'bk-2' }, r)),
        ...(i.disk ? [el('p', { class: 'bk-2' }, t('Datenträger: {a} frei von {b}', { a: fmtBytes(i.disk.free), b: fmtBytes(i.disk.total) }))] : []));
    };
    // Eine unerwartete Antwort darf die Seite nie leer lassen: Zwischenspeicher verwerfen, Platzhalter zeigen
    const safeFill = (i) => { try { fill(i); } catch { S.serverInfo = null; server.replaceChildren(el('div', { class: 'stor-t' }, t('Auf dem Server')), el('p', { class: 'bk-2' }, t('Server nicht erreichbar.'))); } };
    if (S.serverInfo) safeFill(S.serverInfo); // zuletzt bekannter Stand, wird gleich aktualisiert
    api('/api/storage').then((i) => { S.serverInfo = i; safeFill(i); })
      .catch(() => { if (!S.serverInfo) server.replaceChildren(el('div', { class: 'stor-t' }, t('Auf dem Server')), el('p', { class: 'bk-2' }, t('Server nicht erreichbar.'))); });
    return card(t('Speicherverbrauch'), local, server);
  };
  const bioRow = (forceOff = false) => {
    // Fingerabdruck / Gesicht (ersetzt auf diesem Gerät das Eintippen der PIN)
    const bioHint = el('p', { class: 'bk-2' }, bioHintMsg());
    const bioChip = (label, v) => {
      const b = el('button', { type: 'button', class: 'chip' + (bioEnabled() === v ? ' on' : '') }, label);
      b.addEventListener('click', async () => {
        if (bioEnabled() === v) return;
        if (!v) { bioDisable(); renderData(); return; }
        const m = await bioEnable();
        if (m) toast(m); else S.dataMsg = t('Fingerabdruck/Gesicht ist eingerichtet.');
        renderData();
      });
      return b;
    };
    const bioChips = el('div', { class: 'chips' }, bioChip(t('An'), true), bioChip(t('Aus'), false));
    bioSupported().then((ok) => { if (!forceOff && !ok && !bioEnabled()) { bioHint.textContent = bioUnavailableMsg(); bioChips.querySelectorAll('.chip').forEach((c) => { c.disabled = true; }); } });
    if (forceOff) { bioChips.querySelectorAll('.chip').forEach((c) => { c.disabled = true; }); bioHint.textContent = bioNeedPinMsg(); }
    return el('div', { class: 'setrow' }, el('div', { class: 'setlbl' }, t('Mit Fingerabdruck / Gesicht entsperren')), bioChips, bioHint);
  };
  const solo = S.standalone;
  // ---- App-Sperre (lokale PIN dieses Geräts, in jedem Betrieb optional; geht nie an den Server) ----
  const askOldPin = async (title) => {
    const v = await askSheet({ title, fields: [{ name: 'p', type: 'password', pin: true, label: t('Aktuelle PIN'), required: true }], ok: t('Weiter') });
    if (!v) return false;
    const r = await checkPin(v.p);
    if (r.ok) return true;
    toast(r.wait ? t('Zu viele Versuche. Bitte {s} Sekunden warten.', { s: r.wait }) : t('Falsche PIN.'));
    return false;
  };
  const appLockCard = () => {
    if (!lockAvailable()) return card(t('App-Sperre'), el('p', {}, t('Nicht verfügbar: Dafür braucht es HTTPS oder die App.')));
    if (!lockOn()) {
      return card(t('App-Sperre'), el('p', {}, t('Schützt die App mit einer PIN, falls jemand dein entsperrtes Handy in die Hand nimmt. Die Einträge werden dadurch nicht verschlüsselt.')),
        ...(solo ? [] : [el('p', { class: 'bk-2' }, t('Die PIN gilt nur auf diesem Gerät und geht nie an den Server. Mit dem Server-Passwort lässt sie sich zurücksetzen.'))]),
        el('div', { class: 'drow' }, btn(t('PIN festlegen …'), async () => { const p = await askNewPin(t('PIN festlegen')); if (p) { await setPin(p); S.dataMsg = t('Die App-Sperre ist eingeschaltet.'); renderData(); } }, 'primary')), bioRow(true));
    }
    const after = lockAfter();
    const chips = el('div', { class: 'chips' }, [[0, t('Sofort')], [60, t('Nach 1 Minute')], [300, t('Nach 5 Minuten')]].map(([v, l]) => {
      const b = el('button', { type: 'button', class: 'chip' + (after === v ? ' on' : '') }, l);
      b.addEventListener('click', () => { setLockAfter(v); renderData(); }); return b;
    }));
    return card(t('App-Sperre'), el('p', {}, t('Die App ist mit einer PIN gesperrt.')),
      el('div', { class: 'setrow' }, el('div', { class: 'setlbl' }, t('Sperren')), chips, el('p', { class: 'bk-2' }, t('Wann die App nach dem Verlassen wieder nach der PIN fragt.'))),
      bioRow(),
      el('div', { class: 'drow mt' },
        btn(t('Jetzt sperren'), () => showLock()),
        btn(t('PIN ändern …'), async () => { if (!(await askOldPin(t('PIN ändern')))) return; const p = await askNewPin(t('Neue PIN')); if (p) { await setPin(p); S.dataMsg = t('Die PIN wurde geändert.'); renderData(); } }),
        btn(t('Sperre ausschalten …'), async () => { if (await askOldPin(t('Sperre ausschalten'))) { removePin(); bioDisable(); S.dataMsg = t('Die App-Sperre ist ausgeschaltet.'); renderData(); } }, 'danger')));
  };
  const privacyCard = () => !privacyAvailable() ? null : card(t('Vorschau verbergen'),
    el('p', {}, t('Verbirgt den Inhalt der App im App-Wechsler von Android. Screenshots sind dann ebenfalls gesperrt.')),
    chipSet([[true, t('An')], [false, t('Aus')]], privacyOn(), setPrivacy));
  // Backup mit Passwort (AES-256-GCM); beim Import fragt die App danach
  const encryptedBackup = async () => {
    const entries = await exportEntries(); if (!entries) return;
    const v = await askSheet({ title: t('Verschlüsselt sichern'), text: t('Die Datei lässt sich nur mit diesem Passwort öffnen. Vergisst du es, sind die Daten darin verloren.'),
      fields: [{ name: 'a', type: 'password', label: t('Passwort'), required: true }, { name: 'b', type: 'password', label: t('Passwort wiederholen'), required: true }], ok: t('Sichern'),
      // Fehler direkt im Dialog zeigen; das Fenster bleibt offen
      check: (x) => (x.a.length < 8 ? t('Das Passwort braucht mindestens {n} Zeichen.', { n: 8 }) : x.a !== x.b ? t('Die Passwörter stimmen nicht überein.') : '') });
    if (!v) return;
    try { show(await exportJsonEncrypted(v.a, entries)); } catch (e) { show(e.message); }
  };
  const lastBk = LS.get('lastBackup', 0), daysSince = Math.floor((Date.now() - lastBk) / 86400000);
  const bkWarn = solo && backupDue()
    ? el('div', { class: 'dmsg' }, lastBk ? t('Dein letztes Backup ist {n} Tage alt.', { n: daysSince }) : t('Du hast noch kein Backup gemacht.'), ' ' + t('Die Daten liegen nur auf diesem Gerät – sichere sie regelmäßig als JSON-Datei.')) : null;
  const lastBkText = !lastBk ? t('Letzter Export: noch keiner') : daysSince < 1 ? t('Letzter Export: heute') : daysSince === 1 ? t('Letzter Export: gestern') : t('Letzter Export: vor {n} Tagen', { n: daysSince });
  const exRow = (title, hint, ...btns) => el('div', { class: 'exrow' }, el('b', {}, title), el('p', { class: 'bk-2' }, hint), el('div', { class: 'drow' }, ...btns));
  const hasFood = S.foodOn || activeFoods().length;
  // Aufklappbarer Bereich für Seltenes; der Zustand bleibt beim Neuzeichnen erhalten
  const more = (key, title, ...kids) => {
    const d = el('details', { class: 'more' }, el('summary', {}, title), ...kids);
    d.open = !!moreOpen[key]; d.addEventListener('toggle', () => { moreOpen[key] = d.open; });
    return d;
  };
  const chipSet = (opts, cur, pick) => el('div', { class: 'chips' }, opts.map(([v, l]) => {
    const b = el('button', { type: 'button', class: 'chip' + (cur === v ? ' on' : '') }, l);
    b.addEventListener('click', () => { pick(v); renderData(); }); return b;
  }));
  // Automatisches Backup (nur Android-App): Datei in „Dokumente/GutKeeper“
  const autoRow = () => {
    const st = autoState();
    const stat = !st ? null : st.ok ? t('Letztes automatisches Backup: {d}', { d: new Date(st.at).toLocaleString(LOC, { dateStyle: 'short', timeStyle: 'short' }) })
      : t('Automatisches Backup fehlgeschlagen: {e}', { e: st.error });
    const enc = autoEncrypted(), on = autoDays() > 0;
    // Passwort festlegen: abgeleiteter Schlüssel wird gespeichert, das Passwort selbst nicht (askAutoPassword in admin.js)
    const askAutoPw = async () => { if (await askAutoPassword()) renderData(); };
    const pickEnc = (v) => { if (v && !enc) askAutoPw(); else if (!v && enc) clearAutoPassword().then(renderData); };
    // „Eigene“: Zahl über das Eingabefenster; der gewählte Wert steht dann auf dem Chip
    const customDays = isCustomDays(), customKeep = isCustomKeep();
    const pickDays = async (v) => { if (v !== 'custom') return setAutoDays(v); const n = await askWhole({ title: t('Eigenes Intervall'), text: t('Alle wie viele Tage soll ein Backup angelegt werden?'), label: t('Tage (1 bis {n})', { n: DAYS_MAX }), max: DAYS_MAX, value: autoDays() || '' }); if (n) { setAutoDays(n); renderData(); } };
    const pickKeep = async (v) => { if (v !== 'custom') return setAutoKeep(v); const n = await askWhole({ title: t('Eigene Anzahl'), text: t('Wie viele automatische Backups sollen aufbewahrt werden? Ältere werden gelöscht.'), label: t('Anzahl (1 bis {n})', { n: KEEP_MAX }), max: KEEP_MAX, value: autoKeep() }); if (n) { setAutoKeep(n); renderData(); } };
    return el('div', { class: 'setrow' }, el('div', { class: 'setlbl' }, t('Automatisches Backup')),
      chipSet([[0, t('Aus')], [7, t('Wöchentlich')], [1, t('Täglich')], ['custom', customDays ? t('Eigene: alle {n} Tage', { n: autoDays() }) : t('Eigene')]], customDays ? 'custom' : autoDays(), pickDays),
      ...(on ? [
        el('div', { class: 'setlbl' }, t('Anzahl behalten')),
        chipSet([...KEEP_OPTIONS.map((n) => [n, String(n)]), ['custom', customKeep ? t('Eigene: {n}', { n: autoKeep() }) : t('Eigene')]], customKeep ? 'custom' : autoKeep(), pickKeep),
        ...(autoEncAvailable() ? [el('div', { class: 'setlbl' }, t('Verschlüsselung')), chipSet([[true, t('Mit Passwort')], [false, t('Aus')]], enc, pickEnc)]
          : [el('p', { class: 'warn' }, t('Verschlüsselte Backups gehen hier nicht: Das Gerät kann den Schlüssel nicht sicher speichern. Die Dateien werden unverschlüsselt gespeichert.'))]),
        ...(enc && !autoEncAvailable() ? [el('p', { class: 'warn' }, t('Das Backup-Passwort ist nicht mehr verfügbar. Es wird nichts gesichert, bis du es neu festlegst.'))] : []),
      ] : []),
      el('p', { class: 'bk-2' }, t('Speichert beim Öffnen der App eine Datei im Ordner Dokumente/{f} und behält die letzten {n}; ältere werden gelöscht.', { n: autoKeep(), f: autoFolder() }) + ' '
        + (enc ? t('Die Dateien sind mit deinem Backup-Passwort verschlüsselt. Beim Import fragt die App danach.') : t('Die Datei ist nicht verschlüsselt und für andere Apps mit Dateizugriff lesbar.'))),
      ...(stat ? [el('p', { class: st && !st.ok ? 'warn' : 'bk-2' }, stat)] : []),
      el('div', { class: 'drow' }, btn(t('Jetzt sichern'), async () => {
        const r = await runAutoBackup(true);
        toast(r === true ? t('Backup gespeichert: {f}', { f: (autoState() || {}).name || '' }) : r === false ? t('Backup fehlgeschlagen: {e}', { e: (autoState() || {}).error || '' }) : t('Nichts gesichert: Es gibt noch keine Einträge.'));
        renderData();
      }),
        ...(enc ? [btn(t('Passwort ändern'), askAutoPw)] : [])));
  };
  // Roter Punkt an dem, was man antippen soll, solange ein Backup fällig ist (wie am Tab „Optionen“)
  const due = solo && backupDue();
  const dotted = (b) => { if (due) b.classList.add('alert'); return b; };
  const saveCard = () => card(t('Sichern (Export)'),
    el('p', { class: 'bk-2' }, lastBkText + ' ' + t('(auf diesem Gerät)')),
    ...(solo ? [el('p', {}, t('Deine Einträge liegen nur auf diesem Gerät. Sichere sie regelmäßig als Datei und bewahre sie woanders auf, z. B. in einer Cloud oder auf dem PC.'))] : [el('p', { class: 'bk-2' }, t('Mit Server werden auch ältere Einträge gesichert, die nicht auf diesem Gerät liegen.'))]),
    el('div', { class: 'drow' }, dotted(btn(t('Als JSON mit Passwort'), encryptedBackup, 'primary'))),
    el('p', { class: 'bk-2' }, t('Eine Datei mit allen Einträgen und dem Essen. Lässt sich später wieder vollständig einlesen. Beim Import fragt die App nach dem Passwort.')),
    more('nopw', t('Ohne Passwort sichern'),
      exRow(t('JSON ohne Passwort'), t('Jeder, der die Datei bekommt, kann sie lesen. Nur sinnvoll, wenn sie auf deinem eigenen Gerät bleibt.'),
        btn(t('Ohne Passwort sichern'), async () => { const l = await exportEntries(); if (l) show(exportJson(l)); }))),
    more('fmt', t('Weitere Formate'),
      exRow(t('Als Tabelle'), hasFood ? t('CSV für Tabellenprogramme. Das Essen ist eine eigene Datei, beim Import wird sie automatisch erkannt.') : t('CSV für Tabellenprogramme.'),
        btn(hasFood ? t('Stuhl (CSV)') : t('CSV'), async () => { const l = await exportEntries(); if (l) show(exportCsv(l)); }), ...(hasFood ? [btn(t('Essen (CSV)'), () => show(exportFoodCsv()))] : []))));
  // Erinnerung und automatisches Backup: eigener Bereich, nur ohne Server
  const remindCard = () => (!solo ? null : card(autoAvailable() ? t('Erinnerung und Automatik') : t('Backup-Erinnerung'),
      el('div', { class: 'setrow' }, ...(autoAvailable() ? [el('div', { class: 'setlbl' }, t('Backup-Erinnerung'))] : []),
        chipSet([[0, t('Aus')], ...REMIND_OPTIONS.map((n) => [n, t('{n} Tage', { n })]), ['custom', isCustomRemind() ? t('Eigene: {n} Tage', { n: remindDays() }) : t('Eigene')]],
          isCustomRemind() ? 'custom' : remindDays(), async (v) => {
            if (v !== 'custom') return setRemindDays(v);
            const n = await askWhole({ title: t('Eigene Erinnerung'), text: t('Nach wie vielen Tagen ohne Backup soll die App erinnern?'), label: t('Tage (1 bis {n})', { n: REMIND_MAX }), max: REMIND_MAX, value: remindDays() || '' });
            if (n) setRemindDays(n);
            renderData();
          }),
        el('p', { class: 'bk-2' }, t('Zeigt beim Öffnen der App einen Hinweis und einen roten Punkt am Tab „Optionen“.'))),
      ...(autoAvailable() ? [autoRow()] : [])));
  const importCard = () => card(t('Importieren'),
    el('p', {}, t('Liest eine JSON- oder CSV-Datei ein. Vorhandene Einträge bleiben erhalten, doppelte werden übersprungen.')),
    el('p', { class: 'bk-2' }, t('Angenommen werden nur JSON-Backups und CSV-Dateien. Vor dem Import siehst du eine Vorschau, erst dann wird etwas übernommen.')),
    more('imp', t('Beim Import'),
      el('div', { class: 'chips' }, [['merge', t('Zusammenführen')], ['new', t('Als neue Einträge (neue IDs)')]].map(([v, l]) => {
        const b = el('button', { type: 'button', class: 'chip' + (S.importMode === v ? ' on' : '') }, l);
        b.addEventListener('click', () => { S.importMode = v; renderData(); }); return b;
      })),
      el('p', { class: 'bk-2' }, S.importMode === 'new' ? t('Neue IDs: Nichts wird überschrieben, alles kommt als neue Einträge dazu (gleiche Einträge zur selben Zeit werden übersprungen).') : t('Zusammenführen: Einträge mit gleicher ID werden aktualisiert, wenn die Datei neuer ist.'))),
    el('div', { class: 'drow' }, btn(t('Datei wählen …'), pickFile, 'primary')),
    el('p', { class: 'bk-2 mt' }, t('Felder wie Drang, Blut oder Luft dürfen leer sein.')), file);
  const moveCard = () => card(t('Auf ein neues Gerät übertragen'),
    el('p', {}, t('Ohne Server wandern die Daten per Datei. Das geht in drei Schritten.')),
    exRow(t('1. Auf dem alten Gerät'), t('Sichere alle Einträge in einer Datei. Mit Passwort ist sie geschützt, falls sie unterwegs in einer Cloud oder in einem Postfach liegt.'),
      btn(t('Mit Passwort sichern'), encryptedBackup, 'primary')),
    exRow(t('2. Datei übertragen'), t('Schicke sie dir selbst, z. B. per Teilen-Menü, E-Mail, Cloud oder USB. Installiere die App auf dem neuen Gerät.')),
    exRow(t('3. Auf dem neuen Gerät'), t('Wähle hier die Datei aus. Bei einer verschlüsselten Datei fragt die App nach dem Passwort.'), btn(t('Datei wählen …'), pickFile, 'primary')),
    el('p', { class: 'bk-2 mt' }, t('Danach kannst du auf dem alten Gerät die Einträge löschen.')), file);
  const statusCard = () => card(t('Status'),
    el('p', {}, (S.offline ? `${t('{n} gespeichert', { n: nE(active) })} · ${t('Offline-Modus')} · ${t('{p} nicht gesendet', { p: pend })}` : `${t('{n} gespeichert', { n: nE(active) })} · ${pend ? t('{p} warten auf Sync', { p: pend }) : t('alles gesendet')} · ${S.online ? t('Server erreichbar') : t('Server nicht erreichbar')}`)),
    el('div', { class: 'drow' }, btn(t('Jetzt synchronisieren'), () => { toast(t('Synchronisiere …')); sync(); })));
  const deleteCard = () => card(t('Daten löschen'),
    el('p', {}, solo ? t('Entfernt alle Einträge von diesem Gerät.') : t('Entfernt alle Einträge auf dem Handy, dem Server und anderen Geräten. Server-Backups bleiben erhalten.')),
    el('div', { class: 'drow' }, btn(t('Alle Daten löschen …'), confirmWipe, 'danger')),
    ...(activeFoods().length ? [el('div', { class: 'dsep' }), el('p', {}, t('Nur das Essen (Stuhl-Einträge bleiben erhalten):')), el('div', { class: 'drow' }, btn(t('Essensdaten löschen …'), confirmWipeFoods, 'danger'))] : []));
  const accountDelCard = () => (accountDeleteAvailable() ? accountDeleteCard(card, btn) : null);
  // ---- Aufbau des Tabs „Optionen“: Startseite mit Menü, darunter Unterseiten ----
  const multi = !!(S.config && S.config.multi);
  const isAdmin = !multi || !!(S.user && S.user.role === 'admin');
  const hasLogin = !solo && !(S.config && S.config.auth === 'none'); // Anmeldung am Server (Passwort); die App-Sperre gibt es immer
  const go = (p) => { S.optPage = p; S.dataMsg = ''; renderData(); const l = $('#vData .list'); if (l) l.scrollTop = 0; };
  const menuRow = (title, sub, p) => {
    const b = el('button', { type: 'button', class: 'menurow' + (p === 'backup' && due ? ' alert' : '') }, el('span', { class: 'mr-t' }, el('b', {}, title), el('span', { class: 'bk-2' }, sub)), el('i', { class: 'chev', html: ICON.right }));
    b.addEventListener('click', () => go(p));
    return b;
  };
  const home = () => {
    const acct = multi && S.user ? el('div', { class: 'acctbar' }, el('div', { class: 'avatar' }, (S.user.name || '?').slice(0, 1).toUpperCase()),
      el('div', { class: 'ab-t' }, el('b', {}, S.user.name), el('span', { class: 'bk-2' }, S.user.role === 'admin' ? t('Admin') : t('Nutzer'))), btn(t('Abmelden …'), logoutSheet)) : null;
    const menu = el('div', { class: 'menu' },
      menuRow(t('PDF-Bericht'), t('Für Arzttermine, zum Drucken oder Senden'), 'report'),
      menuRow(t('Sicherung und Import'), t('Export, Import, Backups'), 'backup'),
      ...(solo ? [menuRow(t('Gerät wechseln'), t('Daten auf ein neues Handy übertragen'), 'move')] : []),
      menuRow(t('App'), t('Darstellung, Sprache, Essen'), 'app'),
      menuRow(multi ? t('Konto und Sicherheit') : t('Sicherheit'), hasLogin ? t('Passwort, Sperre, Abmelden') : t('Sperre, Fingerabdruck'), 'account'),
      ...(!solo ? [menuRow(t('Verschlüsselung'), S.dataKey ? t('Ende-zu-Ende aktiv') : t('Ende-zu-Ende'), 'encryption')] : []),
      menuRow(solo ? t('Speicher') : t('Speicher und Server'), solo ? t('Speicher auf diesem Gerät') : t('Status, Speicher, Zeitraum'), 'storage'),
      ...(multi && isAdmin ? [menuRow(t('Benutzerverwaltung'), t('Konten und Passwörter'), 'users')] : []),
      ...(!solo && isAdmin ? [menuRow(t('Administration'), multi ? t('Server-Backups, Gesamt-Export') : t('Server-Backups'), 'admin')] : []),
      menuRow(t('Über'), t('Version, Lizenz, Updates'), 'help'));
    // Löschen steht abgesetzt am Ende, damit man es nicht versehentlich antippt
    const dzHead = el('h3', { class: 'dzh' }, t('Gefahrenzone'));
    const dz = el('div', { class: 'menu dz' }, menuRow(t('Daten löschen'), accountDeleteAvailable() ? t('Einträge, Essen oder Konto') : t('Einträge oder Essen'), 'delete'));
    // Suche in den Optionen: findet Einstellungen nach Stichwort und springt auf die passende Seite
    const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const idx = () => [
      [t('PDF-Bericht'), 'pdf bericht arzt arztpraxis zeitraum report doctor kurz ausfuehrlich drucken', 'report'],
      [t('Sichern (Export)'), 'backup sicherung sichern json csv export datei tabelle server', 'backup'],
      [t('Erinnerung und Automatik'), 'erinnerung automatisch auto backup sicherung taeglich woechentlich intervall passwort', 'backup', () => solo],
      [t('Importieren'),'import einlesen datei json csv wiederherstellen restore zusammenfuehren', 'backup'],
      [t('Darstellung (hell / dunkel)'), 'darstellung design hell dunkel dark light theme modus', 'app'],
      [t('Sprache'), 'sprache language deutsch english englisch', 'app'],
      [t('Stuhldrang im Verlauf farbig'), 'stuhldrang drang farbe farbig verlauf gelb orange rot urge color', 'app'],
      [t('Beim Öffnen mit „Erfassen“ starten'), 'start oeffnen erfassen startseite', 'app'],
      [t('Als App installieren'), 'installieren app pwa startbildschirm homescreen install', 'app'],
      [t('Essen aufzeichnen'), 'essen mahlzeit food ernaehrung', 'app'],
      [t('Passwort ändern'), 'passwort aendern password anmeldung abmelden logout sitzung geraete', 'account', () => hasLogin],
      [t('App-Sperre (PIN)'), 'sperre pin lock app sperren', 'account'],
      [t('Fingerabdruck / Gesicht'), 'fingerabdruck gesicht biometrie finger face', 'account'],
      [t('Gerät wechseln'), 'geraet wechseln umziehen neues handy uebertragen datei verschluesselt', 'move', () => solo],
      [t('Verschlüsselung'), 'verschluesselung ende-zu-ende e2ee wiederherstellungscode code schluessel encryption', 'encryption', () => !solo],
      [t('Status und Synchronisation'), 'status sync synchronisieren server verbindung erreichbar', 'storage', () => !solo],
      [t('Speicherverbrauch'), 'speicher verbrauch platz groesse storage', 'storage'],
      [t('Server-Verbindung'), 'server verbinden trennen verbindung adresse apk app cors', 'storage', () => S.staticBuild],
      [t('Zeitraum auf diesem Gerät'), 'zeitraum monate geraet speicher kuerzen lokal aeltere eintraege laden', 'storage', () => !solo],
      [t('Server-Backups'), 'server backup sicherung zurueckspielen wiederherstellen', 'admin'],
      [t('Benutzerverwaltung'), 'benutzer konten nutzer passwort sperren admin', 'users'],
      [t('Alle Daten löschen'), 'loeschen daten alles entfernen zuruecksetzen reset', 'delete'],
      [t('Essensdaten löschen'), 'essen loeschen food', 'delete'],
      [t('Konto löschen'), 'konto loeschen account zuruecksetzen reset passwort abmelden neu anfangen', 'delete', () => accountDeleteAvailable()],
      [t('Über'), 'ueber version lizenz agpl hinweis about update aktualisieren', 'help'],
    ];
    const searchBox = (hide) => {
      const input = el('input', { type: 'search', class: 'optsearch', placeholder: t('Einstellungen suchen …'), 'aria-label': t('Einstellungen suchen'), autocomplete: 'off', enterkeyhint: 'search' });
      const out = el('div', { class: 'menu srch', hidden: true });
      input.addEventListener('input', () => {
        const q = norm(input.value).split(/\s+/).filter(Boolean);
        out.replaceChildren(); out.hidden = !q.length;
        hide.forEach((n) => { if (n && n.nodeType) n.hidden = !!q.length; });
        if (!q.length) return;
        const hits = idx().filter(([label, kw, p, cond]) => (!cond || cond()) && allowed(p) && q.every((w) => norm(`${label} ${kw}`).includes(w)));
        out.append(...(hits.length ? hits.map(([label, , p]) => menuRow(label, pages[p][0], p)) : [el('p', { class: 'bk-2 nores' }, t('Nichts gefunden.'))]));
      });
      return el('div', { class: 'optsearchw' }, input, out);
    };
    const kb = keyBanner();
    const verWarn = versionWarning() ? el('div', { class: 'dmsg' }, versionWarning()) : null;
    return [searchBox([acct, verWarn, bkWarn, kb, menu, dzHead, dz]), acct, verWarn, bkWarn, kb, menu, dzHead, dz];
  };
  const pages = {
    report: [t('PDF-Bericht'), () => [reportCard()]],
    backup: [t('Sicherung und Import'), () => [saveCard(), remindCard(), importCard()]],
    app: [t('App'), () => [appCard(), foodCard()]],
    move: [t('Gerät wechseln'), () => [moveCard()]],
    account: [multi ? t('Konto und Sicherheit') : t('Sicherheit'), () => [...(hasLogin ? [pwTempCard(), accountCard()] : []), appLockCard(), privacyCard()]],
    storage: [solo ? t('Speicher') : t('Speicher und Server'), () => [S.staticBuild ? serverLinkCard() : null, solo ? null : statusCard(), storageCard(), solo ? null : deviceCard()]],
    encryption: [t('Verschlüsselung'), () => encryptionCards()],
    users: [t('Benutzerverwaltung'), () => usersCards()],
    admin: [t('Administration'), () => adminCards()],
    delete: [t('Daten löschen'), () => [deleteCard(), accountDelCard()]],
    help: [t('Über'), () => [aboutCard()]],
  };
  const allowed = (p) => p === 'home' || (pages[p] && !(p === 'encryption' && solo) && !(p === 'users' && !(multi && isAdmin)) && !(p === 'admin' && (solo || !isAdmin)) && !(p === 'move' && !solo));
  let page = S.optPage || 'home';
  if (!allowed(page)) page = S.optPage = 'home';
  syncNav(); paintBadge();
  const msg = S.dataMsg ? el('div', { class: 'dmsg' }, S.dataMsg) : null;
  if (page === 'home') root.append(el('div', { class: 'list' }, msg, ...home().filter(Boolean)));
  else {
    const [title, build] = pages[page];
    const back = el('button', { type: 'button', class: 'backrow' }, el('span', { html: ICON.left }), el('span', {}, t('Optionen')));
    back.addEventListener('click', () => go('home'));
    root.append(el('div', { class: 'list' }, el('div', { class: 'pagehead' }, back, el('h2', {}, title)), msg, ...build().flat().filter(Boolean)));
  }
  const list = root.querySelector('.list');
  list.dataset.page = page;
  if (oldList && keepPage !== page) list.classList.add(page === 'home' ? 'pg-back' : 'pg-fwd'); // Unterseite gleitet von rechts herein, zurück von links
  if (keepPage === page && keepTop) {
    // Karten wie „Daten auf diesem Gerät“ füllen sich asynchron und sind anfangs kürzer: ein Platzhalter hält die Höhe, sonst wird scrollTop zu klein begrenzt
    const spacer = el('div', { 'aria-hidden': 'true' });
    spacer.style.height = Math.max(0, keepTop + list.clientHeight - list.scrollHeight) + 'px';
    list.append(spacer); list.scrollTop = keepTop;
    setTimeout(() => { if (spacer.isConnected) spacer.remove(); }, 2500);
  }
}
