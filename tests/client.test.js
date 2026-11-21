// Tests für Teile der Oberfläche, die ohne Browser laufen: Zurück-Navigation, App-Sperre (PIN), Passwort-Backup
// Aufruf: npm test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const src = (f) => fs.readFileSync(path.join(ROOT, 'public/js', f), 'utf8');
const load = (code) => import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

test('Zurück-Taste: Ebenen schließen sich der Reihe nach, auch wenn eine anders geschlossen wird', async () => {
  // einfacher Verlauf zum Testen: Liste von Zuständen und ein Zeiger
  const states = [null]; let pos = 0; const listeners = [];
  globalThis.history = {
    replaceState(s) { states[pos] = s; },
    pushState(s) { states.length = pos + 1; states.push(s); pos++; },
    go(n) { pos += n; setTimeout(() => listeners.forEach((l) => l({ state: states[pos] })), 0); },
  };
  globalThis.window = { addEventListener: (ev, fn) => { if (ev === 'popstate') listeners.push(fn); } };
  const { pushBack, backDepth } = await load(src('nav.js'));
  const log = [];
  const tick = () => new Promise((r) => setTimeout(r, 5));
  const r1 = pushBack(() => log.push('tab'));
  pushBack(() => log.push('seite'));
  pushBack(() => log.push('fenster'));
  assert.equal(backDepth(), 3);
  history.go(-1); await tick(); // Zurück: oberstes Fenster
  assert.deepEqual(log, ['fenster']);
  assert.equal(backDepth(), 2);
  r1(); await tick(); // Tab auf anderem Weg geschlossen: Eintrag wird frei, keine Aufrufe
  assert.deepEqual(log, ['fenster']);
  assert.equal(backDepth(), 1);
  history.go(-1); await tick();
  assert.deepEqual(log, ['fenster', 'seite']);
  assert.equal(backDepth(), 0);
  delete globalThis.history; delete globalThis.window;
});

test('App-Sperre: PIN prüfen, Fehlversuche bremsen, entfernen', async () => {
  const mem = new Map();
  const code = src('applock.js').replace("import { DEV } from './util.js';",
    `const DEV = { get: (k, d) => (globalThis.__mem.has(k) ? JSON.parse(globalThis.__mem.get(k)) : d), set: (k, v) => globalThis.__mem.set(k, JSON.stringify(v)) };`);
  globalThis.__mem = mem;
  const L = await load(code);
  assert.equal(L.lockOn(), false);
  await L.setPin('4711');
  assert.equal(L.lockOn(), true);
  assert.ok(!JSON.stringify([...mem.values()]).includes('4711'), 'die PIN selbst wird nicht gespeichert');
  assert.deepEqual(await L.checkPin('4711'), { ok: true });
  for (let i = 0; i < 4; i++) assert.deepEqual(await L.checkPin('0000'), { ok: false });
  const fifth = await L.checkPin('0000');
  assert.equal(fifth.ok, false); // der fünfte Fehlversuch löst die Wartezeit aus
  const wait = await L.checkPin('4711');
  assert.equal(wait.ok, false);
  assert.ok(wait.wait > 0 && wait.wait <= 15, 'richtige PIN wird während der Wartezeit nicht angenommen');
  L.removePin();
  assert.equal(L.lockOn(), false);
  assert.match('1234', L.PIN_RE); assert.doesNotMatch('12', L.PIN_RE); assert.doesNotMatch('12ab', L.PIN_RE);
  delete globalThis.__mem;
});

test('Versionsvergleich App und Server', async () => {
  const { versionMismatch } = await load(src('version.js'));
  assert.equal(versionMismatch('1.2.0', '1.2.0'), '');
  assert.equal(versionMismatch('1.2.5', '1.2.0'), '', 'Patch-Unterschiede stören nicht');
  assert.equal(versionMismatch('1.3.0', '1.2.9'), 'newer');
  assert.equal(versionMismatch('1.1.0', '1.2.0'), '', 'App älter als Server ist in Ordnung');
  assert.equal(versionMismatch('2.0.0', '1.9.0'), 'major');
  assert.equal(versionMismatch('1.0.0', '2.0.0'), 'major');
  assert.equal(versionMismatch(null, '1.2.0'), '');
});

test('Passwort-Backup aus der App lässt sich mit dem Server-Format (crypto-wrap) öffnen', async () => {
  const { wrapText } = await load(src('cipher.js'));
  const { unwrap, isWrapped } = require('../server/crypto-wrap.js');
  const text = JSON.stringify({ app: 'gutkeeper', entries: [{ id: 'abc', date: '2026-01-02', note: 'Ä ö ü ß' }] });
  const w = await wrapText(text, 'geheim-123');
  assert.ok(isWrapped(w));
  assert.equal((await unwrap(w, 'geheim-123')).toString('utf8'), text);
  await assert.rejects(() => unwrap(w, 'falsch'));
});

test('stored backup key: files decrypt with the password, each with its own iv', async () => {
  const { deriveWrapKey, wrapTextKey } = await load(src('cipher.js'));
  const { unwrap } = require('../server/crypto-wrap.js');
  const k = await deriveWrapKey('backup-pw-1', 100000);
  const a = await wrapTextKey('{"a":1}', k), b = await wrapTextKey('{"a":1}', k);
  assert.notEqual(a.iv, b.iv);
  assert.equal(a.salt, k.salt);
  assert.equal((await unwrap(a, 'backup-pw-1')).toString('utf8'), '{"a":1}');
  assert.equal((await unwrap(b, 'backup-pw-1')).toString('utf8'), '{"a":1}');
  await assert.rejects(() => unwrap(a, 'falsch'));
});

test('Notiz-Schlagwörter: an-/abwählen, Erkennung ohne Groß-/Kleinschreibung, Komma-Aufräumen', async () => {
  const { hasToken, toggleToken, tokens } = await load(src('notetags.js'));
  assert.deepEqual(tokens(' a ,b,, c ,'), ['a', 'b', 'c']);
  assert.equal(hasToken('Kaffee, Stress', 'stress'), true);
  assert.equal(hasToken('  kaffee ,Stress', ' Kaffee '), true);
  assert.equal(hasToken('Kaffeepause', 'Kaffee'), false, 'nur ganze Einträge zählen, keine Teilstrings');
  assert.equal(hasToken('', 'Kaffee'), false);
  assert.equal(toggleToken('', 'Kaffee'), 'Kaffee');
  assert.equal(toggleToken('Kaffee', 'Stress'), 'Kaffee, Stress');
  assert.equal(toggleToken('  Kaffee,  ', 'Stress'), 'Kaffee, Stress', 'ein Komma am Ende wird nicht verdoppelt');
  assert.equal(toggleToken('a, b, c', 'b'), 'a, c');
  assert.equal(toggleToken('a, b, c', 'a'), 'b, c');
  assert.equal(toggleToken('a, b, c', 'C'), 'a, b');
  assert.equal(toggleToken('a,b ,c', 'B'), 'a, c');
  assert.equal(toggleToken('b', 'b'), '');
  assert.equal(toggleToken('Heute viel Stress, Kaffee', 'Kaffee'), 'Heute viel Stress');
  assert.equal(toggleToken(toggleToken('x', 'Sport'), 'Sport'), 'x', 'zweimal tippen = Ausgangszustand');
});

test('Notiz-Schlagwörter: Bereinigung und Prüfung der Liste', async () => {
  const { cleanTag, sanitizeTags, checkTag, TAG_MAX_COUNT, TAG_MAX_LEN } = await load(src('notetags.js'));
  assert.equal(cleanTag('  Fettiges   Essen '), 'Fettiges Essen');
  assert.equal(cleanTag('a,b'), 'a b', 'Kommas trennen Einträge und sind im Schlagwort nicht erlaubt');
  assert.equal(cleanTag('x'.repeat(50)).length, TAG_MAX_LEN);
  assert.equal(cleanTag(null), '');
  assert.deepEqual(sanitizeTags(['Kaffee', ' kaffee', '', '  ', 5, null, 'Stress,Sport']), ['Kaffee', 'Stress Sport']);
  assert.deepEqual(sanitizeTags('kein Array'), []);
  const many = Array.from({ length: 40 }, (_, i) => 'T' + i);
  assert.equal(sanitizeTags(many).length, TAG_MAX_COUNT);
  assert.equal(checkTag(['Kaffee', 'Stress'], 'stress'), 'dup');
  assert.equal(checkTag(['Kaffee', 'Stress'], 'stress', 1), 'ok', 'Umbenennen auf sich selbst (nur Schreibweise) ist erlaubt');
  assert.equal(checkTag(['Kaffee'], ' , '), 'empty');
  assert.equal(checkTag(many.slice(0, TAG_MAX_COUNT), 'Neu'), 'full');
  assert.equal(checkTag(many.slice(0, TAG_MAX_COUNT), 'Neu', 0), 'ok', 'Umbenennen geht auch bei voller Liste');
  assert.equal(checkTag(['Kaffee'], 'Tee'), 'ok');
});

test('Notiz-Schlagwörter: nur geänderte Listen werden gespeichert, Standard bleibt übersetzbar', async () => {
  const { loadTags, saveTags, TAGS_KEY } = await load(src('notetags.js'));
  const mem = new Map();
  const store = { get: (k, d) => (mem.has(k) && mem.get(k) != null ? mem.get(k) : d), set: (k, v) => { mem.set(k, v); return true; } };
  const defaults = ['Kaffee', 'Stress'];
  assert.deepEqual(loadTags(store, defaults), defaults);
  assert.notEqual(loadTags(store, defaults), defaults, 'Kopie, damit die Standardliste nicht verändert wird');
  assert.deepEqual(saveTags(store, ['Kaffee', 'Stress'], defaults), defaults);
  assert.equal(mem.get(TAGS_KEY), null, 'unverändert = nichts gespeichert');
  saveTags(store, ['Kaffee', 'Tee'], defaults);
  assert.deepEqual(loadTags(store, ['Coffee', 'Stress']), ['Kaffee', 'Tee'], 'eigene Liste gilt unabhängig von den (übersetzten) Standards');
  saveTags(store, [], defaults);
  assert.deepEqual(loadTags(store, defaults), [], 'alle Schlagwörter gelöscht bleibt gelöscht');
  saveTags(store, defaults, defaults);
  assert.deepEqual(loadTags(store, ['Coffee', 'Stress']), ['Coffee', 'Stress'], 'nach „Standard wiederherstellen“ gelten wieder die übersetzten Standards');
  mem.set(TAGS_KEY, 'kaputt');
  assert.deepEqual(loadTags(store, defaults), defaults, 'ungültiger Inhalt fällt auf die Standards zurück');
  mem.set(TAGS_KEY, ['A', 'a', 3]);
  assert.deepEqual(loadTags(store, defaults), ['A']);
});

// ---- Import: Herkunft, Vorschau, Dateityp (importcheck.js ist frei von Browser-Abhängigkeiten) ----
const normRow = (r) => (r.date && r.time ? { date: r.date, time: r.time, consistency: Number(r.consistency) || 0, luft: Number(r.luft) || 0 } : null);
const normFoodRow = (r) => (r && r.date && r.time && r.text ? { date: r.date, time: r.time, text: String(r.text), meal: 0 } : null);
const baseCtx = (over = {}) => ({ newIds: false, entries: {}, foods: {}, activeEntries: [], activeFoods: [], normEntry: normRow, normFood: normFoodRow, now: 1000, ...over });

test('Import: Herkunft der Datei im Vergleich zur aktuellen Installation', async () => {
  const { originRelation, cleanOrigin } = await load(src('importcheck.js'));
  const ctx = { instance: 'srv-1', accountId: 2 };
  const o = (over) => ({ account: 'anna', accountId: 1, instance: 'srv-1', kind: 'server', exportedAt: '2026-11-19T10:00:00Z', ...over });
  assert.equal(originRelation(undefined, ctx), 'unknown', 'ältere Datei ohne Kopf');
  assert.equal(originRelation({ account: 'x' }, ctx), 'unknown', 'ohne Instanz-Kennung unbrauchbar');
  assert.equal(originRelation(o(), ctx), 'otherAccount', 'gleicher Server, anderes Konto');
  assert.equal(originRelation(o({ accountId: 2 }), ctx), 'same');
  assert.equal(originRelation(o({ accountId: '2' }), ctx), 'same', 'Zahl und Text gleicher ID');
  assert.equal(originRelation(o({ instance: 'srv-2' }), ctx), 'otherInstance', 'anderer Server: normaler Umzug, keine Warnung');
  assert.equal(originRelation(o({ instance: 'dev-9', kind: 'standalone', account: null, accountId: null }), ctx), 'otherInstance');
  assert.equal(originRelation(o({ accountId: null }), ctx), 'same', 'Konto unbekannt: keine falsche Warnung');
  assert.equal(originRelation(o(), { instance: 'dev-9', accountId: null }), 'otherInstance');
  assert.equal(originRelation(o({ instance: 'dev-9', accountId: null }), { instance: 'dev-9', accountId: null }), 'same', 'dasselbe Gerät');
  assert.equal(originRelation(o(), null), 'otherInstance');
  // Bereinigung: Müll wird abgewiesen, Längen begrenzt
  assert.equal(cleanOrigin('text'), null); assert.equal(cleanOrigin([]), null); assert.equal(cleanOrigin({ instance: 5 }), null);
  const c = cleanOrigin(o({ account: 'a'.repeat(500), kind: 'weird', accountId: { x: 1 } }));
  assert.equal(c.account.length, 80); assert.equal(c.kind, 'standalone'); assert.equal(c.accountId, null);
});

test('Import: Vorschau zählt neu, vorhanden, aktualisiert und ungültig (beide Arten) und ändert nichts', async () => {
  const { summarize, planImport } = await load(src('importcheck.js'));
  const row = (id, time, upd, extra = {}) => ({ id, date: '2026-03-0' + (extra.d || 1), time, consistency: 4, updated_at: upd, ...extra });
  const entries = { 'id-vorhanden-1': { updated_at: 500 }, 'id-vorhanden-2': { updated_at: 100 } };
  const file = [row('id-vorhanden-1', '08:00', 500), row('id-vorhanden-2', '09:00', 900), row('id-neu-000001', '10:00', 300, { d: 5 }), { foo: 1 }, row('id-neu-000001', '10:00', 300, { d: 5 })];
  const before = JSON.stringify(entries);
  const m = summarize(file, [], baseCtx({ entries }));
  assert.deepEqual([m.added, m.updated, m.dupE, m.badE, m.entries], [1, 1, 2, 1, 5], 'gleicher Stand = vorhanden, neuerer = aktualisiert, doppelte ID in der Datei zählt einmal');
  assert.equal(m.from, '2026-03-01'); assert.equal(m.to, '2026-03-05'); assert.equal(m.hasIds, true);
  assert.equal(JSON.stringify(entries), before, 'die Vorschau verändert die lokalen Daten nicht');
  // Neue IDs: nichts wird überschrieben, nur gleiche Einträge zur selben Zeit fallen weg
  const active = [{ date: '2026-03-01', time: '08:00', consistency: 4, luft: 0 }];
  const n = summarize(file, [], baseCtx({ entries, activeEntries: active, newIds: true }));
  assert.deepEqual([n.added, n.updated, n.dupE, n.badE], [2, 0, 2, 1]);
  // Essen
  const f = summarize([], [{ id: 'food-0000001', date: '2026-03-02', time: '12:00', text: 'Reis' }, { date: '2026-03-02', time: '12:00', text: '' }, { date: '2026-03-03', time: '12:00', text: 'Tee' }],
    baseCtx({ foods: { 'food-0000001': { updated_at: 1 } }, activeFoods: [{ date: '2026-03-03', time: '12:00', text: 'TEE' }] }));
  assert.deepEqual([f.fAdded, f.fUpd, f.dupF, f.badF, f.foods], [0, 1, 1, 1, 3], 'ohne Zeitstempel zählt „jetzt“ als neuer; Essen ohne Text ist ungültig; gleiches Essen (Groß-/Kleinschreibung egal) vorhanden');
  // CSV-artige Zeilen ohne IDs
  const csv = summarize([{ date: '2026-04-01', time: '07:00', consistency: 3 }, { date: '2026-04-01', time: '07:00', consistency: 3 }], [], baseCtx());
  assert.deepEqual([csv.added, csv.dupE, csv.hasIds], [1, 1, false]);
  // der Plan enthält genau die Schritte, die importFile ausführt
  const p = planImport(file, [], baseCtx({ entries }));
  assert.deepEqual(p.entries.map((o) => [o.id, o.update]), [['id-vorhanden-2', true], ['id-neu-000001', false]]);
  assert.equal(planImport([{ date: '2026-04-01', time: '07:00', consistency: 3 }], [], baseCtx()).entries[0].id, null, 'ohne ID vergibt der Import eine neue');
});

test('Import: Dateityp nur JSON oder CSV', async () => {
  const { fileKind } = await load(src('importcheck.js'));
  assert.equal(fileKind('backup.json', ''), 'json'); assert.equal(fileKind('Backup.ENC.JSON', 'text/plain'), 'json');
  assert.equal(fileKind('werte.csv', ''), 'csv'); assert.equal(fileKind('x.CSV', 'application/octet-stream'), 'csv');
  assert.equal(fileKind('notizen.txt', 'text/plain'), null); assert.equal(fileKind('foto.png', 'image/png'), null);
  assert.equal(fileKind('backup.json.txt', 'application/json'), null, 'falsche Endung gilt, auch bei passendem MIME-Typ');
  assert.equal(fileKind('teilen', 'application/json'), 'json', 'ohne Endung entscheidet der MIME-Typ');
  assert.equal(fileKind('teilen', 'text/csv'), 'csv'); assert.equal(fileKind('teilen', ''), null);
});

// ---- Härtung: CSV-Formeln, PBKDF2-Grenzen, reservierte IDs ----
test('CSV: Formel-Zellen werden entschärft und beim Import wieder zurückgeholt (transfer.js ist nicht direkt ladbar, daher Ausschnitt)', async () => {
  const code = src('transfer.js');
  const a = code.indexOf('export const csvQ'), b = code.indexOf('// In der Android-App');
  const c = code.indexOf('export const ALIAS'), d = code.indexOf('// Passwortgeschützte Datei');
  assert.ok(a > 0 && b > a && c > 0 && d > c);
  const m = await load((code.slice(a, b) + code.slice(c, d)).replace(/^export /gm, '') + '\nexport { csvQ as q, parseCsv as parse };');
  assert.equal(m.q('=1+1'), "'=1+1");
  assert.equal(m.q('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(m.q('-cmd'), "'-cmd");
  assert.equal(m.q('-3'), '-3', 'Zahlen bleiben');
  assert.equal(m.q('Hallo = Welt'), 'Hallo = Welt');
  assert.equal(m.q(''), ''); assert.equal(m.q(undefined), '');
  const notes = ['=HYPERLINK("http://x";"y")', '+49 123', "'=schon mit Apostroph", '@a;b', 'normal', '-5 Grad'];
  const csv = 'datum;uhrzeit;konsistenz;notiz\n' + notes.map((n) => `2026-01-01;08:00;4;${m.q(n)}`).join('\n');
  assert.deepEqual(m.parse(csv).map((r) => r.note), notes, 'Rundlauf ohne Änderung des Textes');
});

test('PBKDF2-Runden aus Dateien: nur sinnvolle Werte', async () => {
  const { iterOk } = await load(src('cipher.js'));
  assert.ok(iterOk(600000) && iterOk(100000) && iterOk(5000000));
  for (const v of [99999, 5000001, 1e12, 0, -1, NaN, '600000', undefined, 1.5]) assert.equal(iterOk(v), false, String(v));
});

test('Import: reservierte IDs (__proto__ usw.) werden nicht als ID übernommen', async () => {
  const { planImport, okId } = await load(src('importcheck.js'));
  for (const id of ['__proto__', 'constructor', 'prototype']) assert.equal(okId(id), false, id);
  const rows = ['__proto__', 'constructor', 'prototype'].map((id, i) => ({ id, date: '2026-03-01', time: `0${i}:00`, consistency: 4, updated_at: 5 }));
  const p = planImport(rows, [{ id: '__proto__', date: '2026-03-01', time: '12:00', text: 'Reis' }], baseCtx());
  assert.ok([...p.entries, ...p.foods].every((o) => o.id === null), 'bekommen neue IDs');
  assert.equal(p.counts.hasIds, false);
});
