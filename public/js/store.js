// Lokale Daten (Einträge), Aufbewahrung und Abgleich mit dem Server
import { t } from './i18n.js';
import { handleUnauthorized } from './auth.js';
import { apiFetch, serverConn } from './net.js';
import { decodeRows, encodeRows, monthFloor, onModeMismatch } from './e2ee.js';
import { vault } from './vault.js';
import { renderData } from './data.js';
import { S } from './state.js';
import { refreshViews, toast } from './ui.js';
import { okId } from './importcheck.js';
import { $, DEV, LS, uid, ymd } from './util.js';

let storageWarned = false;
vault.onError = () => warnFull(); // verschlüsselter Speicher konnte nicht schreiben
const warnFull = () => { if (!storageWarned) { storageWarned = true; toast(t('Speicher voll – bitte unter „Daten“ den Zeitraum auf diesem Gerät verkürzen.')); } };

// Wie weit zurück dieses Gerät Einträge speichert (Monate, 0 = alles): eigene Wahl, sonst Standard vom Server (LOCAL_MONTHS), sonst 12
export const keepMonths = () => (S.keepOverride != null ? S.keepOverride : S.config && Number.isFinite(S.config.localMonths) ? S.config.localMonths : 12);
// Ohne Server (eigenständige Version) oder im Offline-Modus: kein Abgleich, alles bleibt auf dem Gerät
export const noServer = () => S.standalone || S.offline;
export const cutoff = () => { if (noServer()) return null; const m = keepMonths(); if (!m) return null; const d = new Date(); d.setMonth(d.getMonth() - m); return ymd(d); };
export const persist = () => {
  const ok = LS.set('entries', S.entries) && LS.set('seq', S.seq);
  if (!ok) warnFull();
};
export const activeEntries = () => Object.values(S.entries).filter((e) => !e.deleted);
// Lokale Einträge plus (bei Bedarf geladene) ältere Einträge vom Server – für Verlauf, Statistik, Kalender und Bericht
export const viewEntries = () => {
  const out = activeEntries();
  for (const e of Object.values(S.remote)) if (!S.entries[e.id] && !e.deleted) out.push(e);
  return out;
};
export const getEntry = (id) => S.entries[id] || S.remote[id];
export function purgeOld() {
  const c = cutoff(); if (!c) return false;
  let changed = false;
  for (const [id, e] of Object.entries(S.entries)) {
    if (e.date < c && !e._d) {
      delete S.entries[id]; changed = true;
      if (e.deleted) delete S.remote[id]; else S.remote[id] = e; // bleibt im Arbeitsspeicher sichtbar, bis die App neu geladen wird
    }
  }
  if (changed) persist();
  return changed;
}

export const hasContent = (s) => s.consistency > 0 || !!(s.luft || s.blood || s.mucus) || s.pain > 0 || s.urge > 0;
export function fields(s) {
  const stool = s.consistency > 0; // ohne Stuhl entfallen nur Menge und Farbe; Drang, Blut, Schleim, Luft und Schmerzen bleiben
  return { date: s.date, time: s.time, consistency: s.consistency || 0, urge: s.urge || 0, amount: stool ? s.amount || 2 : 0,
    blood: s.blood || 0, pain: s.pain || 0, mucus: s.mucus || 0, luft: s.luft || 0, color: stool ? s.color || 0 : 0,
    note: String(s.note || '').replace(/\s+/g, ' ').trim().slice(0, 300) };
}
export function addEntry(s) {
  const e = { id: uid(), ...fields(s), updated_at: Date.now(), deleted: 0, _d: 1 };
  S.entries[e.id] = e; persist(); scheduleSync(); return e;
}
export function updateEntry(id, s) {
  S.entries[id] = { ...getEntry(id), ...fields(s), updated_at: Date.now(), deleted: 0, _d: 1 };
  persist(); scheduleSync();
}
export function setDeleted(id, flag) {
  S.entries[id] = { ...getEntry(id), deleted: flag ? 1 : 0, updated_at: Date.now(), _d: 1 };
  persist(); scheduleSync();
}

/* ---- Essen (optional): eigener Speicherbereich, gleicher Abgleich ---- */
export const persistFoods = () => { if (!(LS.set('foods', S.foods) && LS.set('foodSeq', S.foodSeq))) warnFull(); };
export const activeFoods = () => Object.values(S.foods).filter((f) => !f.deleted);
export const getFood = (id) => S.foods[id];
export const foodFields = (s) => ({ date: s.date, time: s.time, meal: Number(s.meal) || 0, text: String(s.text || '').replace(/\s+/g, ' ').trim().slice(0, 200) });
export function addFood(s) {
  const f = { id: uid(), ...foodFields(s), updated_at: Date.now(), deleted: 0, _d: 1 };
  S.foods[f.id] = f; persistFoods(); scheduleSync(); return f;
}
export function updateFood(id, s) {
  S.foods[id] = { ...S.foods[id], ...foodFields(s), updated_at: Date.now(), deleted: 0, _d: 1 };
  persistFoods(); scheduleSync();
}
export function setFoodDeleted(id, flag) {
  S.foods[id] = { ...S.foods[id], deleted: flag ? 1 : 0, updated_at: Date.now(), _d: 1 };
  persistFoods(); scheduleSync();
}
// „Essen aufzeichnen“ ein-/ausschalten: mit Server für alle Geräte (Server-Einstellung), ohne Server nur lokal
export async function setFoodEnabled(on) {
  if (noServer()) { S.foodOn = on; LS.set('foodOn', on); return true; }
  try {
    const r = await apiFetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ food: on }) });
    if (r.status === 401) { handleUnauthorized(); return false; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    S.foodOn = !!(await r.json()).food; LS.set('foodOn', S.foodOn);
    if (S.foodOn) scheduleSync(0);
    return true;
  } catch { toast(t('Server nicht erreichbar')); return false; }
}
// Alle Essens-Einträge löschen (mit Server als „gelöscht“ markieren, damit andere Geräte nachziehen)
export function wipeFoods() {
  if (S.standalone) S.foods = {};
  else { const now = Date.now(); for (const f of Object.values(S.foods)) if (!f.deleted) S.foods[f.id] = { ...f, deleted: 1, updated_at: now, _d: 1 }; }
  persistFoods(); scheduleSync();
}
// Zuletzt gegessene Speisen (ohne Doppelte) als Schnellauswahl
export function recentFoods(n = (S.config && S.config.recentFoods) || 8) { // Anzahl aus data/settings.json (Server), sonst 8
  const seen = new Set(), out = [];
  for (const f of activeFoods().sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))) {
    const k = f.text.toLowerCase(); if (!k || seen.has(k)) continue;
    seen.add(k); out.push(f.text); if (out.length >= n) break;
  }
  return out;
}
const foodPending = () => (S.foodOn && !S.noFoodSync ? Object.values(S.foods).filter((f) => f._d).length : 0);

/* ---- Synchronisation ---- */
export const pendingCount = () => Object.values(S.entries).filter((e) => e._d).length + foodPending();
// Einträge (und Essen), die nur auf diesem Gerät liegen, weil sie noch nicht auf dem Server sind. Ohne Server gibt es diese Unterscheidung nicht.
export function unsyncedCount(what = 'all') {
  if (S.standalone) return 0;
  const e = what === 'food' ? 0 : Object.values(S.entries).filter((x) => x._d && !x.deleted).length;
  const f = what === 'stool' ? 0 : Object.values(S.foods).filter((x) => x._d && !x.deleted).length;
  return e + f;
}

export function paintDot(state) {
  if (S.standalone) { $('#syncBtn').hidden = true; return; } // ohne Server gibt es nichts abzugleichen
  const p = pendingCount();
  if (S.offline) { $('.dot').className = 'dot'; $('#syncBtn').title = p ? t('Offline-Modus – {p} Änderungen nicht gesendet', { p }) : t('Offline-Modus – Daten bleiben auf diesem Gerät'); return; }
  $('.dot').className = 'dot ' + (state || (S.online && !p ? 'ok' : p ? 'pending' : ''));
  $('#syncBtn').title = S.online ? (p ? t('{p} Änderungen werden gesendet', { p }) : t('Synchronisiert'))
    : p ? t('Offline – {p} Änderungen warten auf Sync', { p }) : t('Offline – Daten sind lokal gespeichert');
}
export function scheduleSync(delay = 500) { clearTimeout(S.syncTimer); S.syncTimer = setTimeout(sync, delay); }

export async function sync() {
  if (S.syncing && !noServer()) { S.syncAgain = true; return; } // läuft schon: danach noch einmal abgleichen, sonst geht der Anstoß verloren
  if (noServer() || S.locked || S.needKey || S.busyE2ee) return; // ohne Schlüssel (Ende-zu-Ende) oder mitten in der Umstellung nicht abgleichen
  S.syncing = true; paintDot('sync');
  const conn = serverConn();
  if (conn && conn.adopt && !S.needKey) { // frisch verbunden: alle lokalen Einträge zum Server senden
    for (const e of Object.values(S.entries)) e._d = 1;
    for (const f of Object.values(S.foods)) f._d = 1;
    persist(); persistFoods(); DEV.set('server', { ...conn, adopt: false });
  }
  const sent = Object.values(S.entries).filter((e) => e._d).slice(0, 1000).map(({ _d, ...e }) => e);
  const withFood = S.foodOn && !S.noFoodSync; // Essen nur abgleichen, wenn es auf diesem Gerät eingeschaltet ist
  const foodSent = withFood ? Object.values(S.foods).filter((f) => f._d).slice(0, 1000).map(({ _d, ...f }) => f) : [];
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 8000);
  const post = (url, body) => apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: ctrl.signal });
  try {
    if (LS.get('wipe', false)) { // ausstehendes „Alle Daten löschen“ zuerst auf dem Server ausführen
      const w = await post('/api/wipe');
      if (w.status === 401) { handleUnauthorized(); return; }
      if (!w.ok) throw new Error('HTTP ' + w.status);
      S.epoch = (await w.json()).epoch; S.seq = 0;
      LS.set('epoch', S.epoch); LS.set('wipe', false); persist();
    }
    const e2 = !!S.dataKey, cut = cutoff();
    const r = await post('/api/sync', { since: S.seq, epoch: S.epoch, e2ee: e2, minDate: cut ? (e2 ? monthFloor(cut) : cut) : null, changes: e2 ? await encodeRows('e', sent) : sent,
      ...(withFood ? { foodSince: S.foodSeq, foodChanges: e2 ? await encodeRows('f', foodSent) : foodSent } : {}) });
    if (r.status === 401) { handleUnauthorized(); return; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    if (Array.isArray(data.changes)) data.changes = data.changes.filter((s) => s && okId(s.id)); // unzulässige IDs (z. B. „__proto__“) verwerfen
    if (Array.isArray(data.foodChanges)) data.foodChanges = data.foodChanges.filter((s) => s && okId(s.id));
    if (data.mode) { await onModeMismatch(data); S.online = true; return; } // Konto und Gerät sind nicht im selben Verschlüsselungs-Modus
    if (data.reset) { // Daten wurden auf einem anderen Gerät gelöscht
      // Auf einem anderen Gerät wurde alles gelöscht. Noch nicht gesendete Einträge dieses Geräts bleiben erhalten und werden mit dem neuen Stand gesendet.
      const keepE = Object.fromEntries(Object.entries(S.entries).filter(([, x]) => x._d && !x.deleted));
      const keepF = Object.fromEntries(Object.entries(S.foods).filter(([, x]) => x._d && !x.deleted));
      const kept = Object.keys(keepE).length + Object.keys(keepF).length;
      if (kept) toast(t('{n} nicht gesendete Einträge bleiben erhalten und werden gesendet.', { n: kept }));
      S.entries = keepE; S.seq = 0; S.foods = keepF; S.foodSeq = 0; S.epoch = data.epoch; LS.set('epoch', S.epoch); persist(); persistFoods(); S.online = true;
      refreshViews(); scheduleSync(100); return;
    }
    let failed = 0;
    if (e2) { // Chiffretext aus dem Server entschlüsseln; was sich nicht entschlüsseln lässt (falscher Schlüssel), wird übersprungen
      const d = await decodeRows('e', data.changes); data.changes = d.rows; failed += d.failed;
      if (data.foodChanges) { const df = await decodeRows('f', data.foodChanges); data.foodChanges = df.rows; failed += df.failed; }
    } else {
      for (const s of data.changes) delete s.blob;
      for (const s of data.foodChanges || []) delete s.blob;
    }
    if (failed) toast(t('{n} Einträge konnten nicht entschlüsselt werden. Passt der Schlüssel dieses Geräts zum Konto?', { n: failed }));
    for (const s of sent) {
      const l = S.entries[s.id];
      if (l && l._d && l.updated_at === s.updated_at) delete l._d;
    }
    for (const s of data.changes) {
      const l = S.entries[s.id];
      if (!l || !l._d || s.updated_at >= l.updated_at) S.entries[s.id] = s; // neuerer Stand gewinnt
    }
    let foodChanged = false;
    if (typeof data.food === 'boolean' && data.food !== S.foodOn) { // auf einem anderen Gerät ein- oder ausgeschaltet
      S.foodOn = data.food; foodChanged = true; if (S.foodOn) scheduleSync(100); LS.set('foodOn', S.foodOn);
    }
    if (S.foodOn && !withFood && !S.noFoodSync) S.syncAgain = true; // Essen wurde erst während dieses Abgleichs eingeschaltet (z. B. frisches Gerät): gleich nachholen
    if (withFood) {
      if (data.foodSeq === undefined) S.noFoodSync = true; // älterer Server ohne Essen: nicht endlos erneut senden
      else {
        for (const s of foodSent) { const l = S.foods[s.id]; if (l && l._d && l.updated_at === s.updated_at) delete l._d; }
        for (const s of data.foodChanges || []) { const l = S.foods[s.id]; if (!l || !l._d || s.updated_at >= l.updated_at) { S.foods[s.id] = s; foodChanged = true; } }
        S.foodSeq = data.foodSeq; persistFoods();
      }
    }
    for (const id of data.drops || []) if (S.entries[id] && !S.entries[id]._d) delete S.entries[id];
    if ((data.drops || []).length) { S.remote = {}; S.remoteMeta = {}; } // ältere Einträge wurden anderswo geändert: bei Bedarf neu laden
    if (S.epoch !== data.epoch) { S.epoch = data.epoch; LS.set('epoch', S.epoch); }
    const purged = purgeOld();
    S.seq = data.seq; persist(); S.online = true;
    if (data.changes.length || (data.drops || []).length || purged || foodChanged) refreshViews();
  } catch {
    S.online = false;
  } finally {
    clearTimeout(to); S.syncing = false; paintDot();
    if (S.syncAgain) { S.syncAgain = false; scheduleSync(100); }
    if (S.tab === 'data') renderData();
    if (pendingCount() && S.online) scheduleSync(1000);
  }
}
