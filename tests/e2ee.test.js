// Tests der Ende-zu-Ende-Verschlüsselung: Krypto-Modul (public/js/cipher.js) und Umstellung am Server
// Aufruf: npm test
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const procs = [];
let portSeed = 9600 + Math.floor(Math.random() * 300);
after(() => procs.forEach((p) => p.kill()));

// Das Modul ist ein ES-Modul im Browser-Ordner; für den Test wird es als Daten-URL geladen
const loadCipher = () => import('data:text/javascript;base64,' + fs.readFileSync(path.join(ROOT, 'public/js/cipher.js')).toString('base64'));

function start(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-e2ee-')), port = portSeed++;
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'server/index.js')],
      { env: { ...process.env, DATA_DIR: dir, PORT: String(port), ALLOW_ANY: '1', NO_AUTH: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    procs.push(p);
    let out = '';
    const onData = (d) => { out += d; if (out.includes('läuft auf Port')) resolve({ base: `http://127.0.0.1:${port}`, dir }); };
    p.stdout.on('data', onData); p.stderr.on('data', onData);
    p.on('exit', (c) => reject(new Error('Server beendet: ' + c + '\n' + out)));
    setTimeout(() => reject(new Error('Server startet nicht:\n' + out)), 15000);
  });
}
const api = (base) => async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* kein JSON */ }
  return { status: r.status, json, text };
};
const entry = (id, over = {}) => ({ id, date: '2026-11-10', time: '08:30', consistency: 6, urge: 2, amount: 2, blood: 1, pain: 1, mucus: 0, luft: 0, color: 1, note: 'geheime Notiz', updated_at: Date.now(), deleted: 0, ...over });
const food = (id, text) => ({ id, date: '2026-11-10', time: '12:00', meal: 2, text, updated_at: Date.now(), deleted: 0 });

// ---------------------------------------------------------------------------------------------
test('Krypto: Rundlauf, falscher Schlüssel, Bindung an die Kennung, Wiederherstellungscode', async () => {
  const c = await loadCipher();
  const key = await c.importKey(c.newDataKeyBytes());
  const blob = await c.seal(key, { a: 'Blut im Stuhl' }, 'e:abc');
  assert.ok(!blob.includes('Blut'));
  assert.deepEqual(await c.open(key, blob, 'e:abc'), { a: 'Blut im Stuhl' });
  await assert.rejects(() => c.open(key, blob, 'e:andere-id'), 'an andere Kennung gebunden: Vertauschen fällt auf');
  const other = await c.importKey(c.newDataKeyBytes());
  await assert.rejects(() => c.open(other, blob, 'e:abc'), 'falscher Schlüssel');
  assert.notEqual(await c.seal(key, { a: 1 }, 'x'), await c.seal(key, { a: 1 }, 'x'), 'jedes Mal ein neuer Initialisierungsvektor');

  const code = c.newRecoveryCode();
  assert.match(code.text, /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
  assert.deepEqual(c.parseCode(code.text.toLowerCase().replaceAll('-', ' ')), code.bytes, 'Eingabe ohne Bindestriche, klein geschrieben');
  assert.equal(c.parseCode(code.text.slice(0, -1)), null, 'zu kurz');
  assert.equal(c.parseCode('!'.repeat(32)), null, 'ungültige Zeichen');

  const raw = c.newDataKeyBytes(), bundle = await c.wrapDataKey(raw, code.bytes);
  assert.ok(bundle.length < 400 && !bundle.includes(c.toB64(raw)));
  assert.deepEqual(await c.unwrapDataKey(bundle, code.bytes), raw);
  await assert.rejects(() => c.unwrapDataKey(bundle, c.newRecoveryCode().bytes), 'falscher Code');
});

test('Krypto: Zeilen enthalten nur Kennung, Zeitstempel und Monat im Klartext', async () => {
  const c = await loadCipher();
  const key = await c.importKey(c.newDataKeyBytes());
  const e = entry('eintrag-0001'), row = await c.sealRow('e', e, key);
  assert.equal(row.date, '2026-11-01'); assert.equal(row.note, ''); assert.equal(row.consistency, 0); assert.equal(row.blood, 0);
  assert.ok(!JSON.stringify(row).includes('geheime'));
  assert.deepEqual(await c.openRow('e', row, key), { id: e.id, updated_at: e.updated_at, deleted: 0, date: e.date, time: e.time, consistency: 6, urge: 2, amount: 2, blood: 1, pain: 1, mucus: 0, luft: 0, color: 1, note: 'geheime Notiz' });
  const f = food('essen-00001', 'Pizza'), frow = await c.sealRow('f', f, key);
  assert.equal(frow.text, ''); assert.equal((await c.openRow('f', frow, key)).text, 'Pizza');
  await assert.rejects(() => c.openRow('f', { ...frow, id: 'essen-00002' }, key), 'Zeile mit vertauschter Kennung');
  assert.equal((await c.openRow('e', await c.sealRow('e', { ...e, deleted: 1 }, key), key)).deleted, 1);
});

test('Server: Umstellung auf Ende-zu-Ende-Verschlüsselung und zurück', async () => {
  const c = await loadCipher();
  const s = await start(), call = api(s.base);
  const key = await c.importKey(c.newDataKeyBytes()), code = c.newRecoveryCode();
  const bundle = await c.wrapDataKey(c.newDataKeyBytes(), code.bytes);

  // Klartext-Stand: zwei Einträge, ein Essen, ein Backup
  const e1 = entry('eintrag-0001'), e2 = entry('eintrag-0002', { note: 'zweite geheime Notiz' }), f1 = food('essen-00001', 'Pizza');
  const first = (await call('POST', '/api/sync', { since: 0, foodSince: 0, changes: [e1, e2], foodChanges: [f1] })).json;
  assert.equal(first.e2ee, false); assert.equal(first.changes.length, 2);
  await call('POST', '/api/backup', {});
  assert.equal((await call('GET', '/api/me')).json.e2ee, false);
  assert.equal((await call('GET', '/api/export.csv')).status, 200);

  // unvollständiger Upload (ein Eintrag fehlt) wird abgelehnt, nichts ändert sich
  const sealed = await Promise.all([e1, e2].map((e) => c.sealRow('e', e, key)));
  const sealedFood = await Promise.all([f1].map((f) => c.sealRow('f', f, key)));
  let r = await call('POST', '/api/e2ee/enable', { key: bundle, entries: [sealed[0]], foods: sealedFood });
  assert.equal(r.status, 409); assert.equal(r.json.error, 'incomplete');
  assert.equal((await call('GET', '/api/me')).json.e2ee, false);
  // Klartext-Zeilen in einem Upload für die Verschlüsselung: Formatfehler; ungültiger Schlüssel
  assert.equal((await call('POST', '/api/e2ee/enable', { key: bundle, entries: [e1, e2], foods: [f1] })).json.error, 'format');
  assert.equal((await call('POST', '/api/e2ee/enable', { key: 'kein-schluessel', entries: sealed, foods: sealedFood })).json.error, 'key');

  // Umstellen
  r = await call('POST', '/api/e2ee/enable', { key: bundle, entries: sealed, foods: sealedFood });
  assert.equal(r.status, 200); assert.ok(r.json.seq > first.seq, 'neue Zähler liegen über den alten');
  assert.equal((await call('POST', '/api/e2ee/enable', { key: bundle, entries: sealed, foods: sealedFood })).json.error, 'state', 'nicht zweimal');
  assert.equal((await call('GET', '/api/me')).json.e2ee, true);
  const k = (await call('GET', '/api/e2ee')).json;
  assert.equal(k.e2ee, true); assert.equal(k.key, bundle);

  // Auf der Festplatte steht kein Klartext mehr (Datenbank, Write-Ahead-Log)
  const dbFiles = fs.readdirSync(s.dir).filter((f) => f.startsWith('gutkeeper.db')).map((f) => fs.readFileSync(path.join(s.dir, f)));
  for (const buf of dbFiles) { assert.ok(!buf.includes('geheime Notiz'), 'Notiz im Klartext in der Datenbank'); assert.ok(!buf.includes('Pizza'), 'Essen im Klartext in der Datenbank'); }
  // Die Server-Antworten enthalten nur Chiffretext
  const range = (await call('GET', '/api/entries')).json.entries;
  assert.equal(range.length, 2); assert.ok(range.every((x) => x.blob && x.note === '' && x.date === '2026-11-01'));

  // Abgleich: nur noch im selben Modus
  assert.equal((await call('POST', '/api/sync', { since: 0 })).json.mode, true, 'Gerät ohne Schlüssel bekommt keine Daten');
  const plain = (await call('POST', '/api/sync', { since: 0, e2ee: true, changes: [entry('klartext-001')] })).json;
  assert.equal(plain.changes.length, 2, 'Klartext-Zeile wird nicht gespeichert');
  const e3 = entry('eintrag-0003', { note: 'dritte geheime Notiz' });
  const up = (await call('POST', '/api/sync', { since: 0, e2ee: true, changes: [await c.sealRow('e', e3, key)] })).json;
  assert.equal(up.e2ee, true); assert.equal(up.changes.length, 3);
  const back = await Promise.all(up.changes.map((row) => c.openRow('e', row, key)));
  assert.deepEqual(back.map((x) => x.note).sort(), ['dritte geheime Notiz', 'geheime Notiz', 'zweite geheime Notiz']);

  // Export auf dem Server und alte Klartext-Backups passen nicht mehr
  assert.equal((await call('GET', '/api/export.csv')).status, 409);
  const bks = (await call('GET', '/api/backups')).json.backups;
  assert.ok(bks.length >= 1);
  assert.equal((await call('POST', '/api/restore', { name: bks[0].name })).json.error, 'mode');
  assert.equal((await call('GET', '/api/entries')).json.entries.length, 3, 'nach abgelehntem Zurückspielen unverändert');

  // Neuer Code für denselben Datenschlüssel
  const bundle2 = await c.wrapDataKey(c.newDataKeyBytes(), c.newRecoveryCode().bytes);
  assert.equal((await call('POST', '/api/e2ee/key', { key: 'x' })).json.error, 'key');
  assert.equal((await call('POST', '/api/e2ee/key', { key: bundle2 })).status, 200);
  assert.equal((await call('GET', '/api/e2ee')).json.key, bundle2);

  // Zurück zu Klartext
  assert.equal((await call('POST', '/api/e2ee/disable', { entries: [e1], foods: [] })).json.error, 'incomplete');
  const all = (await call('GET', '/api/entries')).json.entries;
  const plainRows = await Promise.all(all.map((row) => c.openRow('e', row, key)));
  const foodRows = await Promise.all((await call('GET', '/api/foods')).json.foods.map((row) => c.openRow('f', row, key)));
  r = await call('POST', '/api/e2ee/disable', { entries: plainRows, foods: foodRows });
  assert.equal(r.status, 200);
  const after = (await call('POST', '/api/sync', { since: 0, foodSince: 0, e2ee: false })).json;
  assert.equal(after.e2ee, false); assert.equal(after.changes.length, 3); assert.equal(after.foodChanges[0].text, 'Pizza');
  assert.equal((await call('GET', '/api/e2ee')).json.key, '');
});

test('Server: alte Backups beim Umstellen auf Wunsch löschen (nur ohne mehrere Konten)', async () => {
  const c = await loadCipher();
  const s = await start(), call = api(s.base);
  const key = await c.importKey(c.newDataKeyBytes());
  const bundle = await c.wrapDataKey(c.newDataKeyBytes(), c.newRecoveryCode().bytes);
  await call('POST', '/api/sync', { since: 0, changes: [entry('eintrag-0001')] });
  await call('POST', '/api/backup', {});
  assert.ok((await call('GET', '/api/backups')).json.backups.length >= 1);
  const rows = [await c.sealRow('e', entry('eintrag-0001'), key)];
  const r = await call('POST', '/api/e2ee/enable', { key: bundle, entries: rows, foods: [], purgeBackups: true });
  assert.equal(r.status, 200); assert.ok(r.json.purged >= 1);
  assert.equal((await call('GET', '/api/backups')).json.backups.length, 0);
});

test('Server: Datenbanken ohne Verschlüsselungsspalten werden beim Start ergänzt', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-e2ee-old-'));
  const s0 = await start(); // erzeugt eine aktuelle Datenbank
  const file = path.join(s0.dir, 'gutkeeper.db');
  await new Promise((r) => setTimeout(r, 200));
  const d = new DatabaseSync(file);
  d.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const cols = (t) => d.prepare(`PRAGMA table_info(${t})`).all().map((x) => x.name);
  assert.ok(cols('entries').includes('blob') && cols('foods').includes('blob') && cols('users').includes('e2ee') && cols('users').includes('e2ee_key'));
  d.close(); fs.rmSync(dir, { recursive: true, force: true });
});
