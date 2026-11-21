// Import-Prüfung ohne Browser-Abhängigkeiten (läuft auch in Node, siehe tests/client.test.js):
// Herkunftskopf der Backups, Vergleich mit der aktuellen Installation und die Vorschau/der Plan eines Imports.

const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

// Herkunftskopf einer Datei bereinigen. Fehlt er oder ist er unbrauchbar (keine Instanz-Kennung): null = Herkunft unbekannt
export function cleanOrigin(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const instance = clip(o.instance, 64);
  if (!instance) return null;
  const id = o.accountId;
  return {
    account: clip(o.account, 80) || null,
    accountId: typeof id === 'number' || (typeof id === 'string' && id.length <= 64) ? id : null,
    instance,
    kind: o.kind === 'server' ? 'server' : 'standalone',
    exportedAt: clip(o.exportedAt, 40) || null,
  };
}

// Wie verhält sich die Herkunft der Datei zur aktuellen Installation? ctx = { instance, accountId }
//  'unknown'       – ältere Datei ohne Herkunftskopf
//  'same'          – gleiche Installation, gleiches Konto: nichts zu melden
//  'otherAccount'  – gleiche Installation, aber ein anderes Konto: Warnung
//  'otherInstance' – andere Installation (anderer Server, App ↔ Server, neues Gerät): der normale Umzugsweg
export function originRelation(origin, ctx) {
  const o = cleanOrigin(origin);
  if (!o) return 'unknown';
  if (ctx && ctx.instance && o.instance === ctx.instance) {
    if (o.accountId != null && ctx.accountId != null && String(o.accountId) !== String(ctx.accountId)) return 'otherAccount';
    return 'same';
  }
  return 'otherInstance';
}

export const entryKey = (e) => `${e.date} ${e.time} ${e.consistency} ${e.luft}`;
export const foodKey = (f) => `${f.date} ${f.time} ${f.text.toLowerCase()}`;
// Zeilen liegen in einfachen Objekten (id → Zeile): „__proto__“ & Co. dürfen nie als ID durchgehen
export const okId = (id) => typeof id === 'string' && id.length >= 8 && id.length <= 64 && id !== '__proto__' && id !== 'constructor' && id !== 'prototype';

// Plan eines Imports, ohne etwas zu verändern. Dieselbe Funktion liefert die Vorschau (counts) und die Schritte,
// die importFile danach ausführt (entries/foods), so stimmt die Vorschau immer mit dem Ergebnis überein.
// ctx: { newIds, entries, foods (Objekte id → Zeile), activeEntries, activeFoods (Listen), normEntry(row), normFood(row), now }
// Schritt: { id (null = neue ID vergeben), row (bereinigt), upd (null = jetzt), deleted, update (ersetzt vorhandene Zeile) }
export function planImport(rows, foodRows, ctx) {
  const now = ctx.now || Date.now();
  const c = { entries: rows.length, foods: foodRows.length, added: 0, updated: 0, dupE: 0, badE: 0, fAdded: 0, fUpd: 0, dupF: 0, badF: 0, hasIds: false, from: null, to: null };
  const range = (d) => { if (!c.from || d < c.from) c.from = d; if (!c.to || d > c.to) c.to = d; };

  const entries = [], planned = new Map(); // planned: id → Stand, damit dieselbe ID zweimal in einer Datei wie beim echten Import wirkt
  const known = new Set(ctx.activeEntries.map(entryKey));
  for (const r of rows) {
    const e = ctx.normEntry(r || {});
    if (!e) { c.badE++; continue; }
    range(e.date);
    const id = !ctx.newIds && r && okId(r.id) ? r.id : null;
    if (r && okId(r.id)) c.hasIds = true;
    const upd = Number(r.updated_at) || now;
    if (id) {
      const have = planned.has(id) ? planned.get(id) : ctx.entries[id] ? ctx.entries[id].updated_at : undefined;
      if (have !== undefined && have >= upd) { c.dupE++; continue; }
      const had = have !== undefined; // gleiche ID, aber neuerer Stand: aktualisiert statt neu
      planned.set(id, upd);
      entries.push({ id, row: e, upd, deleted: r.deleted ? 1 : 0, update: had });
      if (had) c.updated++; else c.added++;
      continue;
    }
    if (known.has(entryKey(e))) { c.dupE++; continue; }
    known.add(entryKey(e));
    entries.push({ id: null, row: e, upd: null, deleted: 0, update: false });
    c.added++;
  }

  // Essen: Text ist Pflicht, doppelte werden übersprungen
  const foods = [], fplanned = new Map();
  const fknown = new Set(ctx.activeFoods.map(foodKey));
  for (const r of foodRows) {
    const f = ctx.normFood(r);
    if (!f) { c.badF++; continue; }
    range(f.date);
    const id = !ctx.newIds && r && okId(r.id) ? r.id : null;
    if (r && okId(r.id)) c.hasIds = true;
    const upd = Number(r.updated_at) || now;
    if (id) {
      const have = fplanned.has(id) ? fplanned.get(id) : ctx.foods[id] ? ctx.foods[id].updated_at : undefined;
      if (have !== undefined && have >= upd) { c.dupF++; continue; }
      const had = have !== undefined;
      fplanned.set(id, upd);
      foods.push({ id, row: f, upd, deleted: r.deleted ? 1 : 0, update: had });
      if (had) c.fUpd++; else c.fAdded++;
      continue;
    }
    if (fknown.has(foodKey(f))) { c.dupF++; continue; }
    fknown.add(foodKey(f));
    foods.push({ id: null, row: f, upd: null, deleted: 0, update: false });
    c.fAdded++;
  }
  c.dup = c.dupE + c.dupF; c.bad = c.badE + c.badF;
  return { entries, foods, counts: c };
}

// Nur die Zahlen für die Vorschau
export const summarize = (rows, foodRows, ctx) => planImport(rows, foodRows, ctx).counts;

// Dateityp aus Name und MIME-Typ: 'json', 'csv' oder null (nicht unterstützt)
export function fileKind(name, type) {
  const n = String(name || '').toLowerCase(), m = String(type || '').toLowerCase();
  if (n.endsWith('.json')) return 'json';
  if (n.endsWith('.csv')) return 'csv';
  if (!/\.[a-z0-9]{1,5}$/.test(n)) { // ohne Endung (z. B. aus dem Teilen-Menü): der MIME-Typ entscheidet
    if (m === 'application/json') return 'json';
    if (m === 'text/csv' || m === 'text/comma-separated-values') return 'csv';
  }
  return null;
}
