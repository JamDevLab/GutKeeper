// Export und Import (JSON, CSV)
import { askSheet } from './admin.js';
import { iterOk, wrapText } from './cipher.js';
import { LOC, fileBase, isDe, t } from './i18n.js';
import { COLORS, mealLabel } from './constants.js';
import { apiFetch, serverConn } from './net.js';
import { S } from './state.js';
import { activeEntries, activeFoods, persist, persistFoods, scheduleSync, setFoodEnabled } from './store.js';
import { DEV, LS, el, fmtD, nE, nF, openOverlay, pad, stampStr, todayStr, uid } from './util.js';
import { cleanOrigin, fileKind, originRelation, planImport } from './importcheck.js';

// Kopfzeile und Wörter der CSV-Ausgabe folgen der Sprache; beim Import werden beide Sprachen verstanden
export const CSV_HEAD = isDe ? 'datum;uhrzeit;konsistenz;stuhldrang;menge;blut;schmerz;schleim;luft;farbe;notiz' : 'date;time;consistency;urge;amount;blood;pain;mucus;gas;color;note';
// Textzellen mit = + - @ Tab oder CR am Anfang würden Tabellenprogramme als Formel auswerten: Apostroph davor (Zahlen wie -3 bleiben). Der Import entfernt ihn wieder.
export const csvQ = (x) => {
  x = x == null ? '' : String(x);
  if (/^'?[=+\-@\t\r]/.test(x) && !/^[+-]?\d+([.,]\d+)?$/.test(x)) x = "'" + x;
  return /[;"\n\r]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
};
// Gegenstück beim Import (in parseCsv): den Schutz-Apostroph vor einer „Formel“ wieder entfernen
export const unprotect = (x) => String(x == null ? '' : x).replace(/^'(?='?[=+\-@\t\r])/, '');
// In der Android-App (Capacitor) funktionieren Datei-Downloads nicht: Datei zwischenspeichern und über das Teilen-Menü anbieten
async function shareNative(name, blob) {
  const cap = window.Capacitor, P = cap && cap.Plugins;
  if (!(cap && cap.isNativePlatform && cap.isNativePlatform() && P && P.Filesystem && P.Share)) return false;
  try {
    const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
    return await shareNativeB64(name, data);
  } catch { return false; }
}
// Teilen in der App mit schon vorhandenen Base64-Daten (spart das Umwandeln, z. B. beim Rückblick-Bild)
export async function shareNativeB64(name, data) {
  const P = window.Capacitor && window.Capacitor.Plugins;
  if (!(P && P.Filesystem && P.Share)) return false;
  try {
    const { uri } = await P.Filesystem.writeFile({ path: name, data, directory: 'CACHE' });
    S.stayOnReturn = S.sharing = Date.now(); // nach dem Teilen-Menü (auch aus der Ziel-App zurück) nicht auf die Startseite springen
    await P.Share.share({ title: name, url: uri, dialogTitle: t('Datei speichern oder teilen') });
    return true;
  } catch { return false; } finally { S.sharing = 0; }
}
export async function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  if (await shareNative(name, blob)) return;
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
// Datei vom Server laden und speichern. Mit verbundener eigenständiger App geht ein Link nicht (das Token steht im Header), dann als Blob.
export async function downloadApi(path, fallback) {
  if (!serverConn()) { const a = el('a', { href: path, download: fallback }); document.body.append(a); a.click(); a.remove(); return; }
  try {
    const r = await apiFetch(path);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const cd = r.headers.get('Content-Disposition') || '';
    await download((cd.match(/filename="([^"]+)"/) || [])[1] || fallback, await r.blob(), r.headers.get('Content-Type') || 'application/octet-stream');
  } catch { S.dataMsg = t('Server nicht erreichbar.'); }
}
export const sorted = () => activeEntries().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
// Inhalt des JSON-Backups (Einträge und, falls vorhanden, Essen)
export function backupData(list) {
  const foods = S.foodOn || activeFoods().length ? activeFoods().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).map(({ _d, ...f }) => f) : null;
  return { app: 'gutkeeper', version: 1, exported_at: new Date().toISOString(), origin: originHeader(), entries: (list || sorted()).map(({ _d, ...e }) => e), ...(foods ? { foods } : {}) };
}
const backupMsg = (data, how) => t(how, { n: nE(data.entries.length) }) + (data.foods ? ' ' + t('Essen: {n}', { n: nF(data.foods.length) }) : '');
export function exportJson(list) {
  const data = backupData(list);
  download(`${fileBase()}-backup-${stampStr()}.json`, JSON.stringify(data, null, 1), 'application/json');
  LS.set('lastBackup', Date.now());
  return backupMsg(data, '{n} als JSON gesichert.');
}

// Mit Passwort verschlüsseltes Backup (AES-256-GCM, Schlüssel per PBKDF2); dasselbe Format wie die Server-Backups, der Import erkennt es
export async function exportJsonEncrypted(password, list) {
  if (!(window.crypto && crypto.subtle)) throw new Error(t('Verschlüsseln geht hier nicht (dafür braucht es HTTPS oder die App).'));
  const data = backupData(list);
  const wrapped = await wrapText(JSON.stringify(data), password);
  await download(`${fileBase()}-backup-${stampStr()}.enc.json`, JSON.stringify(wrapped), 'application/json');
  LS.set('lastBackup', Date.now());
  return backupMsg(data, '{n} verschlüsselt gesichert.');
}
export function exportCsv(list) {
  const YES = isDe ? 'ja' : 'yes', NO = isDe ? 'nein' : 'no';
  const rows = (list || sorted()).map((e) => [e.date, e.time, e.consistency || '', e.urge || 0, e.amount || '', e.blood ? YES : NO, e.pain || 0, e.mucus ? YES : NO, e.luft ? YES : NO, e.color ? COLORS[e.color - 1].label.toLowerCase() : '', csvQ(e.note)].join(';'));
  download(`${fileBase()}-export-${stampStr()}.csv`, '\ufeff' + CSV_HEAD + '\n' + rows.join('\n') + '\n', 'text/csv');
  LS.set('lastBackup', Date.now());
  return t('{n} als CSV exportiert.', { n: nE(rows.length) });
}

// Essen als eigene CSV-Datei: Datum; Uhrzeit; Mahlzeit; Essen (Mahlzeit im Klartext der eingestellten Sprache)
export function exportFoodCsv() {
  const list = activeFoods().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const head = isDe ? 'datum;uhrzeit;mahlzeit;essen' : 'date;time;meal;food';
  const rows = list.map((f) => [f.date, f.time, f.meal ? mealLabel(f.meal) : '', csvQ(f.text)].join(';'));
  download(`${fileBase()}-${isDe ? 'essen' : 'food'}-${stampStr()}.csv`, '\ufeff' + head + '\n' + rows.join('\n') + '\n', 'text/csv');
  LS.set('lastBackup', Date.now());
  return t('{n} als CSV exportiert.', { n: nF(rows.length) });
}

export const WORDS = { keiner: 0, keine: 0, kein: 0, nein: 0, leicht: 1, wenig: 1, mittel: 2, stark: 3, viel: 3,
  none: 0, no: 0, mild: 1, slight: 1, low: 1, little: 1, small: 1, medium: 2, moderate: 2, strong: 3, severe: 3, high: 3, large: 3, lots: 3, 'a lot': 3 };
export function num(v, min, max, def) {
  if (v == null || v === '') return def;
  const t = String(v).trim().toLowerCase();
  const n = t in WORDS ? WORDS[t] : Math.trunc(Number(t));
  return Number.isFinite(n) && n >= min && n <= max ? n : def;
}
export const COLOR_WORDS = { braun: 1, normal: 1, hell: 2, grau: 2, lehmfarben: 2, gelb: 3, grün: 4, gruen: 4, schwarz: 5, rot: 6, blutig: 6,
  brown: 1, light: 2, pale: 2, grey: 2, gray: 2, yellow: 3, green: 4, black: 5, red: 6, bloody: 6 };
export function parseColor(v) {
  const t = String(v == null ? '' : v).trim().toLowerCase();
  const n = t in COLOR_WORDS ? COLOR_WORDS[t] : Math.trunc(Number(t));
  return Number.isFinite(n) && n >= 1 && n <= 6 ? n : 0;
}
export const bool = (v) => { const t = String(v == null ? '' : v).trim(); return /^(ja|j|yes|true|x)$/i.test(t) || Number(t) > 0 ? 1 : 0; };
export function normDate(v) {
  v = String(v || '').trim();
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return null;
}
export function normTime(v) {
  const m = String(v || '').trim().match(/^(\d{1,2})[:.](\d{2})/);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${pad(m[1])}:${m[2]}` : null;
}
export function normalize(r) {
  const date = normDate(r.date), time = normTime(r.time);
  if (!date || !time) return null;
  // Leere Felder sind erlaubt: Drang, Blut, Luft usw. werden dann „keiner/nein“
  const consistency = num(r.consistency, 0, 7, 0);
  const urge = num(r.urge, 0, 3, 0), pain = num(r.pain, 0, 3, 0), luft = bool(r.luft), blood = bool(r.blood), mucus = bool(r.mucus);
  if (!consistency && !luft && !pain && !blood && !mucus && !urge) return null; // keine Angaben
  const amount = consistency ? num(r.amount, 1, 3, 2) : 0;
  return { date, time, consistency, urge, amount, blood, pain, mucus, luft, color: consistency ? parseColor(r.color) : 0,
    note: String(r.note || '').replace(/\s+/g, ' ').trim().slice(0, 300) };
}
export const ALIAS = { datum: 'date', date: 'date', uhrzeit: 'time', zeit: 'time', time: 'time', konsistenz: 'consistency', consistency: 'consistency', bristol: 'consistency', type: 'consistency',
  stuhldrang: 'urge', drang: 'urge', urge: 'urge', menge: 'amount', amount: 'amount', blut: 'blood', blood: 'blood',
  schmerz: 'pain', schmerzen: 'pain', pain: 'pain', schleim: 'mucus', mucus: 'mucus',
  luft: 'luft', wind: 'luft', gas: 'luft', blähungen: 'luft', farbe: 'color', color: 'color', colour: 'color',
  notiz: 'note', note: 'note', bemerkung: 'note', kommentar: 'note',
  // Essen-CSV (eigene Datei, getrennt vom Stuhl)
  mahlzeit: 'meal', meal: 'meal', essen: 'text', speise: 'text', gericht: 'text', food: 'text', text: 'text' };
// Mahlzeit im Klartext (deutsch/englisch) oder als Zahl 0–5
export const MEAL_WORDS = { frühstück: 1, fruehstueck: 1, breakfast: 1, mittag: 2, mittagessen: 2, lunch: 2, abend: 3, abendessen: 3, dinner: 3, supper: 3, snack: 4, zwischenmahlzeit: 4, getränk: 5, getraenk: 5, drink: 5, beverage: 5 };
export function mealOf(v) {
  const t = String(v == null ? '' : v).trim().toLowerCase();
  if (!t) return 0;
  if (t in MEAL_WORDS) return MEAL_WORDS[t];
  const n = Math.trunc(Number(t));
  return Number.isFinite(n) && n >= 0 && n <= 5 ? n : 0;
}
// Eine CSV gehört zum Essen, wenn sie Essens-Spalten hat und keine Stuhl-Spalten
const isFoodCsv = (rows) => rows.length > 0 && rows.some((r) => r.text !== undefined) && !rows.some((r) => ['consistency', 'luft', 'blood', 'pain', 'mucus'].some((k) => r[k] !== undefined));
export const POS = ['date', 'time', 'consistency', 'urge', 'amount', 'blood', 'pain', 'mucus', 'luft', 'color', 'note'];

export function parseCsv(text) {
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = first.includes(';') ? ';' : first.includes('\t') ? '\t' : ',';
  const rows = []; let row = [], cur = '', q = false;
  const endRow = () => { row.push(cur.trim()); cur = ''; if (row.some((c) => c !== '')) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur.trim()); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; endRow(); }
    else cur += ch;
  }
  endRow();
  if (!rows.length) return [];
  let cols = rows[0].map((h) => ALIAS[h.toLowerCase()]), start = 1;
  if (!cols.includes('date')) { cols = POS; start = /^\d/.test(rows[0][0] || '') ? 0 : 1; }
  return rows.slice(start).map((c) => { const r = {}; cols.forEach((k, i) => { if (k && c[i] !== undefined) r[k] = unprotect(c[i]); }); return r; });
}

// Passwortgeschützte Datei (AES-256-GCM, Schlüssel per PBKDF2) im Browser entschlüsseln
const ITER_MSG = () => t('Ungültige Datei: Die Zahl der Schlüsselableitungs-Runden liegt außerhalb des erlaubten Bereichs.');
async function decryptWrapped(obj, password) {
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  if (!iterOk(obj.iter)) throw new Error(ITER_MSG());
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(obj.salt), iterations: obj.iter }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(obj.iv) }, key, b64(obj.data)));
}

// Wer ist diese Installation? Server: dessen Kennung aus /api/config. Eigenständige App/APK ohne Server: eine einmal angelegte Zufallskennung des Geräts.
function deviceId() {
  let id = DEV.get('instance', null);
  if (typeof id !== 'string' || !id) { id = uid(); DEV.set('instance', id); }
  return id;
}
export function importContext() {
  const server = !S.standalone && S.config && typeof S.config.instance === 'string' && S.config.instance;
  const name = S.user && S.user.name ? S.user.name : null;
  return { instance: server || deviceId(), kind: S.standalone ? 'standalone' : 'server', account: name, accountId: S.user && S.user.id != null ? S.user.id : null };
}
// Herkunftskopf für jede JSON-Sicherung (bei verschlüsselten steckt er in der verschlüsselten Nutzlast)
export function originHeader() {
  const c = importContext();
  return { account: c.account, accountId: c.accountId, instance: c.instance, kind: c.kind, exportedAt: new Date().toISOString() };
}

class Cancelled extends Error {}

// Datei lesen und prüfen (Passwort bei verschlüsselten Dateien, Konto bei Gesamt-Exporten). Verändert noch nichts.
async function readImport(file) {
  const kind = fileKind(file.name, file.type);
  if (!kind) throw new Error(t('„{n}“ wird nicht unterstützt. Es werden nur JSON-Backups und CSV-Dateien angenommen.', { n: file.name }));
  const text = (await file.text()).replace(/^﻿/, '');
  const tx = text.trim();
  let rows, foodRows = [], origin = null;
  if (/^[{[]/.test(tx)) {
    let d;
    try { d = JSON.parse(tx); } catch { throw new Error(t('Die Datei ist kein gültiges JSON.')); }
    if (d && d.gutkeeper === 'encrypted') { // verschlüsselter Export: Passwort abfragen
      if (d.kind === 'db') throw new Error(t('Das ist ein Datenbank-Backup. Es lässt sich nur auf dem Server zurückspielen (siehe README).'));
      if (!iterOk(d.iter)) throw new Error(ITER_MSG()); // klare Fehlermeldung statt „Falsches Passwort“
      // Falsches Passwort: Dialog erneut öffnen, die Meldung steht rot darin (statt nur oben auf der Seite, wo man sie leicht übersieht)
      for (let error = ''; ;) {
        const v = await askSheet({ title: t('Verschlüsselte Datei'), text: t('Passwort der Datei eingeben.'), fields: [{ name: 'pw', type: 'password', label: t('Passwort'), required: true }], ok: t('Entschlüsseln'), error });
        if (!v) throw new Cancelled();
        try { d = JSON.parse(await decryptWrapped(d, v.pw)); break; } catch { error = t('Falsches Passwort oder beschädigte Datei. Bitte noch einmal versuchen.'); }
      }
    }
    origin = cleanOrigin(d && d.origin);
    if (d && d.bundle && Array.isArray(d.users)) { // Gesamt-Export mehrerer Konten: ein Konto auswählen
      let idx = 0;
      if (d.users.length > 1) {
        const v = await askSheet({ title: t('Welches Konto importieren?'), fields: [{ type: 'choice', name: 'u', options: d.users.map((u, i) => [i, `${u.name} (${nE((u.entries || []).length)})`]) }], ok: t('Importieren') });
        if (!v) throw new Cancelled();
        idx = v.u;
      }
      d = d.users[idx];
      // Herkunft ist dann das gewählte Konto, nicht der Admin, der exportiert hat
      if (origin && d) origin = { ...origin, account: d.name && d.name !== 'owner' ? String(d.name).slice(0, 80) : null, accountId: d.id != null ? d.id : null };
    }
    rows = Array.isArray(d) ? d : d && d.entries;
    if (!Array.isArray(rows) && !(d && Array.isArray(d.foods))) throw new Error(t('keine Einträge gefunden'));
    if (!Array.isArray(rows)) rows = [];
    if (d && Array.isArray(d.foods)) foodRows = d.foods;
  } else {
    if (kind === 'json') throw new Error(t('Die Datei ist kein gültiges JSON.'));
    rows = parseCsv(text); if (isFoodCsv(rows)) { foodRows = rows; rows = []; } // Essen-CSV: getrennt vom Stuhl
  }
  if (!rows.length && !foodRows.length) throw new Error(t('keine Einträge gefunden'));
  return { name: file.name, rows, foodRows, origin };
}

const normFood = (r) => {
  const date = normDate(r && r.date), time = normTime(r && r.time), text = String((r && r.text) || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return date && time && text ? { date, time, text, meal: mealOf(r.meal) } : null;
};
// Plan für die aktuellen lokalen Daten (Vorschau und Import benutzen denselben)
const planFor = (info, newIds) => planImport(info.rows, info.foodRows, { newIds, entries: S.entries, foods: S.foods, activeEntries: activeEntries(), activeFoods: activeFoods(), normEntry: (r) => normalize(r), normFood, now: Date.now() });

// Vorschau vor dem Import. Liefert die gewählte Art ('merge' | 'new') oder null bei „Abbrechen“.
function askPreview(info) {
  return new Promise((resolve) => {
    let mode = S.importMode === 'new' ? 'new' : 'merge';
    const ctx = importContext(), rel = originRelation(info.origin, ctx), o = info.origin;
    const body = el('div', { class: 'impbody' });
    const close = (v) => { ov.remove(); resolve(v); };
    const sheet = el('div', { class: 'sheet imp', role: 'dialog', 'aria-label': t('Import prüfen') }, el('h2', {}, t('Import prüfen')), body);
    const who = (name) => name || t('Hauptkonto');
    const originInfo = () => {
      if (rel === 'otherAccount') return el('div', { class: 'impwarn', role: 'alert' }, el('b', {}, t('Diese Datei stammt vom Konto „{name}“. Du bist als „{me}“ angemeldet.', { name: who(o.account), me: who(ctx.account) })),
        el('span', {}, t('Wenn du sie hier einspielst, landen die Einträge dieses Kontos in deinem.')));
      if (rel === 'otherInstance') {
        const parts = [o.kind === 'server' ? t('Server') : t('eigenständige App')];
        if (o.account) parts.push(t('Konto „{n}“', { n: o.account }));
        if (/^\d{4}-\d{2}-\d{2}/.test(o.exportedAt || '')) parts.push(t('exportiert am {d}', { d: fmtD(o.exportedAt.slice(0, 10)) }));
        return el('p', { class: 'bk-2 impinfo' }, t('Aus einer anderen Installation ({d}).', { d: parts.join(', ') }));
      }
      if (rel === 'unknown') return el('p', { class: 'bk-2 impinfo' }, t('Herkunft unbekannt (ältere Datei).'));
      return null;
    };
    const block = (title, total, a, upd, dup, bad) => el('div', { class: 'impblk' }, el('div', { class: 'imph' }, el('span', {}, title), el('b', {}, total.toLocaleString(LOC))),
      el('div', { class: 'impr' }, el('span', {}, t('Neu')), el('b', {}, a)),
      upd ? el('div', { class: 'impr' }, el('span', {}, t('Werden aktualisiert')), el('b', {}, upd)) : null,
      dup ? el('div', { class: 'impr' }, el('span', {}, t('Schon vorhanden')), el('b', {}, dup)) : null,
      bad ? el('div', { class: 'impr bad' }, el('span', {}, t('Ungültig (übersprungen)')), el('b', {}, bad)) : null);
    const mk = (label, cls, fn) => { const b = el('button', { type: 'button', class: cls }, label); b.addEventListener('click', fn); return b; };
    const paint = () => {
      const c = planFor(info, mode === 'new').counts;
      const nothing = !(c.added || c.updated || c.fAdded || c.fUpd);
      const warn = rel === 'otherAccount'; // anderes Konto desselben Servers: Abbrechen ist die Hauptaktion
      const cancel = mk(t('Abbrechen'), warn ? 'primary' : '', () => close(null));
      const go = mk(warn ? t('Trotzdem importieren') : t('Importieren'), warn ? 'danger' : 'primary', () => close(mode));
      go.disabled = nothing;
      const copy = warn && mode !== 'new' ? mk(t('Als Kopie importieren (neue IDs)'), '', () => close('new')) : null;
      body.replaceChildren(...[
        el('p', { class: 'bk-2 impfile' }, info.name), originInfo(),
        c.entries ? block(t('Einträge in der Datei'), c.entries, c.added, c.updated, c.dupE, c.badE) : null,
        c.foods ? block(t('Essen in der Datei'), c.foods, c.fAdded, c.fUpd, c.dupF, c.badF) : null,
        c.from ? el('p', { class: 'bk-2' }, t('Zeitraum: {a} bis {b}', { a: fmtD(c.from), b: fmtD(c.to) })) : null,
        nothing ? el('p', { class: 'warn' }, t('Aus dieser Datei gibt es nichts zu importieren.')) : null,
        c.hasIds ? el('div', { class: 'impmode' }, el('div', { class: 'setlbl' }, t('Beim Import')),
          el('div', { class: 'chips' }, [['merge', t('Zusammenführen')], ['new', t('Als neue Einträge (neue IDs)')]].map(([v, l]) => mk(l, 'chip' + (mode === v ? ' on' : ''), () => { mode = v; S.importMode = v; paint(); }))),
          el('p', { class: 'bk-2' }, mode === 'new' ? t('Neue IDs: Nichts wird überschrieben, alles kommt als neue Einträge dazu (gleiche Einträge zur selben Zeit werden übersprungen).') : t('Zusammenführen: Einträge mit gleicher ID werden aktualisiert, wenn die Datei neuer ist.')))
          : el('p', { class: 'bk-2' }, t('Ohne IDs in der Datei: Gleiche Einträge zur selben Zeit werden übersprungen.')),
        el('div', { class: 'btns' + (warn ? ' col' : '') }, ...(warn ? [cancel, copy, go] : [cancel, go]))].filter(Boolean)); // replaceChildren würde null als Text „null“ einfügen
    };
    const ov = openOverlay(sheet, () => close(null));
    paint();
  });
}

// Plan ausführen (Zusammenführen, neue IDs usw. entscheidet planImport in importcheck.js)
async function applyImport(plan) {
  for (const o of plan.entries) { const id = o.id || uid(); S.entries[id] = { id, ...o.row, updated_at: o.upd || Date.now(), deleted: o.deleted, _d: 1 }; }
  const c = plan.counts;
  if (c.foods) {
    for (const o of plan.foods) { const id = o.id || uid(); S.foods[id] = { id, ...o.row, updated_at: o.upd || Date.now(), deleted: o.deleted, _d: 1 }; }
    persistFoods();
    if ((c.fAdded || c.fUpd) && !S.foodOn) await setFoodEnabled(true); // sonst bliebe das importierte Essen unsichtbar
  }
  persist(); scheduleSync();
  const tail = (c.dup ? ', ' + t('{n} schon vorhanden', { n: c.dup }) : '') + (c.bad ? ', ' + t('{n} ungültig', { n: c.bad }) : '') + '.';
  const upText = (u) => (u ? ', ' + t('{n} aktualisiert', { n: u }) : '');
  if (!c.entries && c.foods) return t('Essen: {n} neu', { n: c.fAdded }) + upText(c.fUpd) + tail;
  return t('Import: {n} neu', { n: c.added }) + upText(c.updated) + (c.foods ? ', ' + t('Essen: {n} neu', { n: c.fAdded }) + upText(c.fUpd) : '') + tail;
}

// Datei einlesen, Vorschau zeigen und erst nach Bestätigung importieren. Liefert die Meldung für die Oberfläche.
export async function importFile(file) {
  try {
    const info = await readImport(file);
    const mode = await askPreview(info);
    if (!mode) return t('Import abgebrochen.');
    return await applyImport(planFor(info, mode === 'new')); // neu geplant: der Stand kann sich seit der Vorschau geändert haben
  } catch (e) {
    if (e instanceof Cancelled) return t('Import abgebrochen.');
    throw e;
  }
}
