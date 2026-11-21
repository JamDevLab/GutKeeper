// Server-Tests (Node >= 22.13): Konten, Trennung der Daten, Rollen, Umstellung alter Datenbanken, Verschlüsselung
// Aufruf: npm test
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { wrap, unwrap } = require('../server/crypto-wrap');

const ROOT = path.join(__dirname, '..');
const procs = [];
let portSeed = 9100 + Math.floor(Math.random() * 400);
after(() => procs.forEach((p) => p.kill()));

// Server mit eigenem Datenordner starten und warten, bis er läuft.
// Einzelnutzer-Tests laufen mit NO_AUTH=1 (ohne Anmeldung); AUTH: '1' schaltet das ab, dann gilt Einrichtung + Passwort wie im Betrieb.
function start({ AUTH, ...env } = {}, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-')), keepDir = false) {
  const port = portSeed++;
  if (!AUTH && env.MULTIUSER !== '1') env = { NO_AUTH: '1', ...env };
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'server/index.js')],
      { env: { ...process.env, DATA_DIR: dir, PORT: String(port), ALLOW_ANY: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    procs.push(p);
    let out = '';
    const onData = (d) => {
      out += d; if (process.env.DEBUG_SERVER) process.stderr.write('[server] ' + d);
      if (out.includes('läuft auf Port')) resolve({ base: `http://127.0.0.1:${port}`, proc: p, dir, log: () => out, token: (out.match(/Einmal-Code für die Einrichtung: (\w+)/) || [])[1], stop: () => new Promise((r) => { if (p.exitCode !== null || p.signalCode) return r(); p.once('exit', () => r()); p.kill(); }) }); // wartet, bis der Prozess die Datenbank freigegeben hat
    };
    p.stdout.on('data', onData); p.stderr.on('data', onData);
    p.on('exit', (c) => reject(new Error('Server beendet: ' + c + '\n' + out)));
    setTimeout(() => reject(new Error('Server startet nicht:\n' + out)), 15000);
  });
}

// kleiner HTTP-Client mit Cookie-Speicher (ein Client = ein Gerät)
function client(base) {
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* kein JSON */ }
    return { status: r.status, json, text };
  };
  return { get: (u) => call('GET', u), post: (u, b = {}, h = {}) => call('POST', u, b, h), del: (u, b = {}) => call('DELETE', u, b), cookie: () => cookie, setCookie: (c) => { cookie = c; } };
}

const entry = (id, over = {}) => ({ id, date: '2026-11-10', time: '08:30', consistency: 4, urge: 1, amount: 2, blood: 0, pain: 0, mucus: 0, luft: 0, color: 1, note: '', updated_at: Date.now(), deleted: 0, ...over });
const food = (id, text) => ({ id, date: '2026-11-10', time: '12:00', meal: 2, text, updated_at: Date.now(), deleted: 0 });
const PW = 'Sehr-geheim-123';

// ---------------------------------------------------------------------------------------------
test('Mehrbenutzer: Einrichten, Konten, strikte Trennung der Daten', async () => {
  const s = await start({ MULTIUSER: '1', FOOD_DEFAULT: '1' });
  const admin = client(s.base), bob = client(s.base), anon = client(s.base);

  const cfg = (await anon.get('/api/config')).json;
  assert.equal(cfg.multi, true); assert.equal(cfg.needsSetup, true); assert.equal(cfg.auth, 'password');
  assert.equal((await anon.post('/api/login', { name: 'x', password: 'y' })).status, 409, 'vor dem Einrichten kein Login');
  assert.equal((await anon.get('/api/me')).status, 401);
  assert.ok(s.token, 'Einmal-Code steht im Log');

  // Einrichten
  assert.equal((await admin.post('/api/setup', { secret: 'falsch', name: 'jam', password: PW })).status, 401);
  assert.equal((await admin.post('/api/setup', { secret: s.token, name: 'ab', password: PW })).json.error, 'name');
  assert.equal((await admin.post('/api/setup', { secret: s.token, name: 'jam', password: 'kurz' })).json.error, 'password');
  const setup = await admin.post('/api/setup', { secret: s.token, name: 'jam', password: PW });
  assert.equal(setup.status, 200); assert.equal(setup.json.user.role, 'admin'); assert.ok(!('verifier' in setup.json), 'kein Prüfwert für die Offline-Anmeldung');
  assert.equal((await admin.get('/api/me')).json.user.name, 'jam');
  assert.equal((await anon.post('/api/setup', { secret: s.token, name: 'zwei', password: PW })).status, 409, 'zweites Einrichten gesperrt');
  assert.equal((await anon.get('/api/config')).json.needsSetup, false);

  // Konto anlegen: Prüfungen
  assert.equal((await admin.post('/api/admin/users', { name: 'bob', password: 'kurz' })).json.error, 'password');
  assert.equal((await admin.post('/api/admin/users', { name: 'b b', password: PW })).json.error, 'name');
  assert.equal((await admin.post('/api/admin/users', { name: 'bob', password: PW })).status, 200);
  assert.equal((await admin.post('/api/admin/users', { name: 'BOB', password: PW })).status, 409, 'Namen sind nicht von Groß-/Kleinschreibung abhängig');
  assert.equal((await bob.post('/api/login', { name: 'bob', password: 'falsch-falsch' })).status, 401);
  assert.equal((await bob.post('/api/login', { name: 'nobody', password: PW })).status, 401, 'gleiche Antwort bei unbekanntem Namen');
  const bl = await bob.post('/api/login', { name: 'Bob', password: PW });
  assert.equal(bl.status, 200); assert.equal(bl.json.user.role, 'user');
  assert.equal(bl.json.food, true, 'Voreinstellung FOOD_DEFAULT gilt für neue Konten');

  // GLEICHE IDs in beiden Konten: nichts darf sich überschreiben
  const sameId = 'gleiche-id-0001';
  await admin.post('/api/sync', { since: 0, changes: [entry(sameId, { consistency: 1, note: 'admin' }), entry('nur-admin-001')], foodSince: 0, foodChanges: [food('food-admin-01', 'Suppe')] });
  await bob.post('/api/sync', { since: 0, changes: [entry(sameId, { consistency: 6, note: 'bob' })], foodSince: 0, foodChanges: [food(sameId, 'Pizza')] });
  const a = (await admin.post('/api/sync', { since: 0, foodSince: 0 })).json, b = (await bob.post('/api/sync', { since: 0, foodSince: 0 })).json;
  assert.equal(a.changes.length, 2); assert.equal(b.changes.length, 1);
  assert.equal(a.changes.find((e) => e.id === sameId).note, 'admin');
  assert.equal(b.changes[0].note, 'bob'); assert.equal(b.changes[0].consistency, 6);
  assert.equal(a.foodChanges.length, 1); assert.equal(a.foodChanges[0].text, 'Suppe');
  assert.equal(b.foodChanges.length, 1); assert.equal(b.foodChanges[0].text, 'Pizza');
  assert.ok(!('user_id' in a.changes[0]), 'keine Konto-Kennung in der Antwort');
  assert.equal((await bob.get('/api/entries?from=2026-01-01&to=2026-12-31')).json.entries.length, 1);
  assert.equal((await admin.get('/api/entries?from=2026-01-01&to=2026-12-31')).json.entries.length, 2);
  // Zähler und Epochen sind je Konto
  assert.equal(b.seq, 1); assert.equal(a.seq, 2); assert.notEqual(a.epoch, b.epoch);
  // Die Konto-Kennung kommt nur aus der Sitzung: eine mitgeschickte user_id wird ignoriert
  await bob.post('/api/sync', { since: 0, changes: [{ ...entry('fremd-versuch-1'), user_id: 1 }] });
  assert.equal((await admin.post('/api/sync', { since: 0 })).json.changes.length, 2, 'Admin sieht den Eintrag von Bob nicht');
  // CSV und Speicher nur eigene Daten
  const csvB = (await bob.get('/api/export.csv')).text;
  assert.equal(csvB.trim().split('\n').length, 1 + 2);
  const stB = (await bob.get('/api/storage')).json;
  assert.equal(stB.entries.active, 2); assert.equal(stB.db, undefined, 'normale Nutzer sehen keine Server-Größen');
  // Vertrag mit dem Client (data.js, Speicherverbrauch): db/backups/disk fehlen für normale Nutzer, die Seite muss damit umgehen (Regression: leere Seite „Speicher und Server“)
  assert.equal(stB.backups, undefined); assert.equal(stB.disk, undefined); assert.equal(typeof stB.foods.active, 'number');
  assert.ok((await admin.get('/api/storage')).json.db > 0);

  // Rechte: Bob ist kein Admin
  for (const [m, u] of [['get', '/api/admin/users'], ['get', '/api/backups'], ['post', '/api/backup'], ['post', '/api/admin/export'], ['post', '/api/restore'], ['post', '/api/admin/users']]) {
    assert.equal((await bob[m](u, {})).status, 403, `${m} ${u} nur für Admins`);
  }

  // Schutzregeln
  const users = (await admin.get('/api/admin/users')).json.users;
  const idOf = (n) => users.find((u) => u.name === n).id;
  assert.equal(users.find((u) => u.name === 'bob').entries, 2);
  assert.equal((await admin.post(`/api/admin/users/${idOf('jam')}`, { role: 'user' })).json.error, 'last-admin');
  assert.equal((await admin.post(`/api/admin/users/${idOf('jam')}`, { disabled: true })).json.error, 'last-admin');
  // das eigene Konto löscht man nicht über die Benutzerverwaltung, sondern mit „Konto löschen“ (/api/account/delete)
  assert.equal((await admin.del(`/api/admin/users/${idOf('jam')}`, { confirm: 'jam' })).json.error, 'self');
  assert.equal((await admin.del(`/api/admin/users/${idOf('bob')}`, { confirm: 'falsch' })).json.error, 'confirm');

  // Wipe gilt nur für das eigene Konto
  assert.equal((await bob.post('/api/wipe')).status, 200);
  assert.equal((await admin.post('/api/sync', { since: 0 })).json.changes.length, 2, 'Admin-Daten bleiben nach Wipe von Bob');
  assert.equal((await bob.post('/api/sync', { since: 0, epoch: b.epoch })).json.reset, true, 'Bobs alte Epoche ist ungültig');

  // Passwort zurücksetzen: Bobs Sitzung endet, das neue Passwort gilt
  await bob.post('/api/sync', { since: 0, changes: [entry('bob-neu-00001')] });
  const bobOld = bob.cookie();
  assert.equal((await admin.post(`/api/admin/users/${idOf('bob')}`, { password: 'kurz' })).json.error, 'password');
  assert.equal((await admin.post(`/api/admin/users/${idOf('bob')}`, { password: 'Neues-Passwort-9' })).status, 200);
  assert.equal((await bob.get('/api/me')).status, 401, 'alte Sitzung ungültig');
  assert.equal((await bob.post('/api/login', { name: 'bob', password: PW })).status, 401, 'altes Passwort ungültig');
  assert.equal((await bob.post('/api/login', { name: 'bob', password: 'Neues-Passwort-9' })).status, 200);
  const bob2 = client(s.base); bob2.setCookie(bobOld); assert.equal((await bob2.get('/api/me')).status, 401);

  // Passwort selbst ändern: andere Sitzungen enden, die eigene bleibt
  const bobPhone = client(s.base); await bobPhone.post('/api/login', { name: 'bob', password: 'Neues-Passwort-9' });
  assert.equal((await bob.post('/api/account/password', { current: 'falsch', next: 'Noch-ein-Passwort-1' })).status, 401);
  assert.equal((await bob.post('/api/account/password', { current: 'Neues-Passwort-9', next: 'kurz' })).json.error, 'password');
  assert.equal((await bob.post('/api/account/password', { current: 'Neues-Passwort-9', next: 'Noch-ein-Passwort-1' })).status, 200);
  assert.equal((await bob.get('/api/me')).status, 200, 'eigene Sitzung bleibt');
  assert.equal((await bobPhone.get('/api/me')).status, 401, 'Sitzung auf dem anderen Gerät endet');

  // Sperren
  assert.equal((await admin.post(`/api/admin/users/${idOf('bob')}`, { disabled: true })).status, 200);
  assert.equal((await bob.get('/api/me')).status, 401);
  assert.equal((await bob.post('/api/login', { name: 'bob', password: 'Noch-ein-Passwort-1' })).status, 401);
  await admin.post(`/api/admin/users/${idOf('bob')}`, { disabled: false });
  assert.equal((await bob.post('/api/login', { name: 'bob', password: 'Noch-ein-Passwort-1' })).status, 200);

  // Bremse gegen Raten (je Konto)
  const guess = client(s.base);
  let last = 0; for (let i = 0; i < 6; i++) last = (await guess.post('/api/login', { name: 'bob', password: 'falsch-' + i })).status;
  assert.equal(last, 429);
  assert.equal((await client(s.base).post('/api/login', { name: 'bob', password: 'Noch-ein-Passwort-1' })).status, 429, 'auch das richtige Passwort wartet');

  // Löschen mit Bestätigung entfernt Konto und Daten
  assert.equal((await admin.del(`/api/admin/users/${idOf('bob')}`, { confirm: 'BOB' })).status, 200);
  assert.equal((await admin.get('/api/admin/users')).json.users.length, 1);
  const db = new DatabaseSync(path.join(s.dir, 'gutkeeper.db'), { readOnly: true });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM entries WHERE user_id <> 1').get().c, 0, 'keine Reste von Bob');
  db.close(); await s.stop();
});

// ---------------------------------------------------------------------------------------------
test('Gesamt-Export, Backups und Wiederherstellen pro Konto (mit und ohne Passwort)', async () => {
  const s = await start({ MULTIUSER: '1' });
  const admin = client(s.base), bob = client(s.base);
  assert.equal((await admin.post('/api/setup', { secret: s.token, name: 'chef', password: PW })).status, 200);
  await admin.post('/api/admin/users', { name: 'bob', password: PW });
  await bob.post('/api/login', { name: 'bob', password: PW });
  await admin.post('/api/sync', { since: 0, changes: [entry('admin-eintrag-1'), entry('admin-eintrag-2')] });
  await bob.post('/api/sync', { since: 0, changes: [entry('bob-eintrag-001')], foodSince: 0, foodChanges: [food('bob-essen-0001', 'Reis')] });
  const bobId = (await admin.get('/api/admin/users')).json.users.find((u) => u.name === 'bob').id;

  // Export: ein Konto, alle Konten, mit Passwort
  const one = (await admin.post('/api/admin/export', { user: bobId })).json;
  assert.equal(one.entries.length, 1); assert.equal(one.foods[0].text, 'Reis'); assert.equal(one.user.name, 'bob');
  const all = (await admin.post('/api/admin/export', { user: 'all' })).json;
  assert.equal(all.bundle, true); assert.equal(all.users.length, 2); assert.equal(all.users.find((u) => u.name === 'chef').entries.length, 2);
  const enc = (await admin.post('/api/admin/export', { user: 'all', password: 'export-pw' })).json;
  assert.equal(enc.gutkeeper, 'encrypted'); assert.ok(!JSON.stringify(enc).includes('chef'), 'verschlüsselt: kein Klartext');
  assert.equal(JSON.parse((await unwrap(enc, 'export-pw')).toString()).users.length, 2);
  await assert.rejects(() => unwrap(enc, 'falsch'), 'falsches Passwort schlägt fehl');
  assert.equal((await bob.post('/api/admin/export', { user: 'all' })).status, 403);

  // Backup, Download mit/ohne Passwort, CLI-Entschlüsselung
  const name = (await admin.post('/api/backup')).json.name;
  const plain = await fetch(`${s.base}/api/admin/backup-download`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: admin.cookie() }, body: JSON.stringify({ name }) });
  assert.equal(Buffer.from(await plain.arrayBuffer()).subarray(0, 15).toString(), 'SQLite format 3');
  const encBk = (await admin.post('/api/admin/backup-download', { name, password: 'bk-pw' })).json;
  assert.equal(encBk.kind, 'db');
  const tmp = path.join(s.dir, 'dec.db'), encFile = path.join(s.dir, 'bk.enc.json');
  fs.writeFileSync(encFile, JSON.stringify(encBk));
  const cli = spawnSync(process.execPath, [path.join(ROOT, 'server/cli.js'), 'decrypt', encFile, tmp, 'bk-pw'], { env: { ...process.env, DATA_DIR: s.dir }, encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr); assert.equal(fs.readFileSync(tmp).subarray(0, 15).toString(), 'SQLite format 3');

  // Wiederherstellen gilt nur für das gewählte Konto
  await bob.post('/api/sync', { since: 0, changes: [entry('bob-eintrag-002')] }); // nach dem Backup
  await admin.post('/api/sync', { since: 0, changes: [entry('admin-eintrag-3')] });
  const r = await admin.post('/api/restore', { name, user: bobId });
  assert.equal(r.status, 200); assert.equal(r.json.count, 1);
  assert.equal((await bob.get('/api/entries?from=2000-01-01&to=2100-01-01')).json.entries.length, 1, 'Bob auf Backup-Stand');
  assert.equal((await admin.get('/api/entries?from=2000-01-01&to=2100-01-01')).json.entries.length, 3, 'Admin unverändert');
  assert.equal((await bob.post('/api/restore', { name })).status, 403);
  await bob.post('/api/admin/users', {}); // Zeilen ohne Wirkung
  // Konto ohne Daten im Backup: nicht versehentlich leeren
  await admin.post('/api/admin/users', { name: 'neu', password: PW });
  const neuId = (await admin.get('/api/admin/users')).json.users.find((u) => u.name === 'neu').id;
  assert.equal((await admin.post('/api/restore', { name, user: neuId })).json.error, 'no-data');
  await s.stop();
});

// ---------------------------------------------------------------------------------------------
test('ADMIN_FULL_ACCESS=0: Admin verwaltet nur Konten, kein Zugriff auf Backups und Gesamt-Export', async () => {
  const s = await start({ MULTIUSER: '1', ADMIN_FULL_ACCESS: '0' });
  const admin = client(s.base);
  await admin.post('/api/setup', { secret: s.token, name: 'chef', password: PW });
  assert.equal((await admin.get('/api/admin/users')).status, 200);
  assert.equal((await admin.get('/api/me')).json.fullAccess, false);
  for (const [m, u] of [['get', '/api/backups'], ['post', '/api/backup'], ['post', '/api/admin/export'], ['post', '/api/admin/backup-download'], ['post', '/api/restore']]) {
    assert.equal((await admin[m](u, {})).status, 403, `${u} gesperrt`);
  }
  assert.equal((await admin.get('/api/storage')).json.db, undefined, 'keine Server-Größen');
  await s.stop();
});

// ---------------------------------------------------------------------------------------------
test('NO_AUTH=1: Einzelnutzer-Betrieb ohne Anmeldung (nur für lokale Tests)', async () => {
  const open = await start({});
  const c = client(open.base);
  const cfg = (await c.get('/api/config')).json;
  assert.equal(cfg.auth, 'none'); assert.equal(cfg.needsSetup, false);
  assert.ok(!('noteTags' in cfg) && !('foodPins' in cfg), 'ohne settings.json keine Vorgaben');
  assert.equal((await c.get('/api/me')).json.user.role, 'admin');
  assert.equal((await c.post('/api/sync', { since: 0, changes: [entry('einzel-nutzer-1')] })).status, 200);
  assert.equal((await c.get('/api/admin/users')).json.error, 'single');
  assert.equal((await c.post('/api/backup')).status, 200, 'Backups wie bisher');
  assert.equal((await c.post('/api/logout-others', {})).json.error, 'no-lock', 'ohne Anmeldung keine Sitzungen');
  assert.equal((await c.post('/api/account/password', { current: 'x', next: PW })).json.error, 'no-lock');
  assert.match(open.log(), /NO_AUTH/);
  await open.stop();
  // bei MULTIUSER=1 gilt NO_AUTH nicht
  const multi = await start({ MULTIUSER: '1', NO_AUTH: '1' });
  assert.equal((await client(multi.base).get('/api/me')).status, 401);
  assert.equal((await client(multi.base).get('/api/config')).json.auth, 'password');
  await multi.stop();
});

test('Einzelnutzer: Einrichtung nur mit Einmal-Code, nur einmal, danach Anmeldung mit Passwort', async () => {
  const s = await start({ AUTH: '1' });
  const c = client(s.base), anon = client(s.base);
  assert.ok(s.token, 'Einmal-Code steht im Log');
  const cfg = (await anon.get('/api/config')).json;
  assert.equal(cfg.auth, 'password'); assert.equal(cfg.multi, false); assert.equal(cfg.needsSetup, true);
  assert.ok(!JSON.stringify(cfg).includes('verifier'), 'die Konfiguration enthält keinen Prüfwert');
  assert.equal((await anon.get('/api/me')).status, 401, 'vor der Einrichtung kein Zugriff');
  assert.equal((await anon.post('/api/sync', {})).status, 401);
  assert.equal((await anon.post('/api/login', { password: PW })).status, 409, 'vor der Einrichtung kein Login');

  assert.equal((await c.post('/api/setup', { secret: 'falsch', password: PW })).status, 401, 'falscher Code');
  assert.equal((await c.post('/api/setup', { password: PW })).status, 401, 'ohne Code');
  assert.equal((await c.post('/api/setup', { secret: s.token, password: 'kurz' })).json.error, 'password');
  assert.equal((await c.get('/api/me')).status, 401, 'nichts davon hat angemeldet');
  const setup = await c.post('/api/setup', { secret: s.token, password: PW });
  assert.equal(setup.status, 200); assert.equal(setup.json.user.role, 'admin'); assert.equal(setup.json.user.name, '', 'Einzelnutzer hat keinen sichtbaren Namen');
  assert.ok(!('verifier' in setup.json) && !('verifier' in (await c.get('/api/me')).json));
  assert.equal((await c.get('/api/me')).status, 200, 'nach der Einrichtung angemeldet');
  assert.equal((await anon.post('/api/setup', { secret: s.token, password: 'Anderes-Passwort-1' })).status, 409, 'zweites Einrichten gesperrt');
  assert.equal((await anon.get('/api/config')).json.needsSetup, false);
  assert.equal((await c.get('/api/admin/users')).json.error, 'single');

  // Anmeldung nur mit Passwort
  assert.equal((await c.post('/api/sync', { since: 0, changes: [entry('einzel-pw-0001')] })).status, 200);
  assert.equal((await c.post('/api/logout')).status, 200);
  assert.equal((await c.post('/api/sync', {})).status, 401, 'nach dem Abmelden gesperrt');
  assert.equal((await c.post('/api/login', { password: 'falsch-falsch' })).status, 401);
  assert.equal((await c.post('/api/login', {})).status, 401, 'ohne Passwort');
  const ok = await c.post('/api/login', { password: PW });
  assert.equal(ok.status, 200); assert.ok(!('verifier' in ok.json));
  assert.equal((await c.post('/api/sync', { since: 0 })).json.changes.length, 1, 'Daten sind noch da');
  // Das Passwort liegt nur als scrypt-Hash in der Datenbank
  const db = new DatabaseSync(path.join(s.dir, 'gutkeeper.db'), { readOnly: true });
  const stored = db.prepare('SELECT pass FROM users WHERE id = 1').get().pass; db.close();
  assert.match(stored, /^scrypt\$/); assert.ok(!stored.includes(PW));
  // nach einem Neustart ist nichts mehr einzurichten und die Sitzung bleibt gültig
  await s.stop();
  const s2 = await start({ AUTH: '1' }, s.dir);
  assert.equal(s2.token, undefined, 'kein neuer Einmal-Code'); assert.doesNotMatch(s2.log(), /Einmal-Code/);
  const c2 = client(s2.base); c2.setCookie(c.cookie());
  assert.equal((await c2.get('/api/me')).status, 200);
  await s2.stop();
});

test('Einzelnutzer: Fehlversuche sperren global (auch bei wechselnden Adressen) und je Adresse', async () => {
  const s = await start({ AUTH: '1', TRUST_PROXY: '1' });
  const c = client(s.base);
  await c.post('/api/setup', { secret: s.token, password: PW });
  const anon = client(s.base);
  const from = (ip, password) => anon.post('/api/login', { password }, { 'X-Real-IP': ip });
  for (let i = 1; i <= 5; i++) assert.equal((await from(`10.0.0.${i}`, 'falsch-falsch')).status, 401);
  const r = await from('10.0.0.99', 'falsch-falsch');
  assert.equal(r.status, 429); assert.equal(r.json.error, 'locked');
  assert.equal((await from('10.0.0.100', PW)).status, 429, 'auch das richtige Passwort ist gesperrt');
  assert.equal((await c.get('/api/me')).status, 200, 'angemeldete Geräte bleiben unberührt');
  await s.stop();
  // Einrichtung: falscher Code wird ebenfalls gebremst
  const s2 = await start({ AUTH: '1' });
  const d = client(s2.base);
  for (let i = 0; i < 5; i++) assert.equal((await d.post('/api/setup', { secret: 'x' + i, password: PW })).status, 401);
  assert.equal((await d.post('/api/setup', { secret: s2.token, password: PW })).status, 429, 'auch der richtige Code wartet');
  await s2.stop();
});

// Ein Sitzungs-Token mit frei wählbarem Ablauf (SESSION_SECRET ist im Test bekannt): Konto.Version.Ablauf.Signatur
const DAY = 86400000;
function forge(secret, cookie, expIn) {
  const [uid, ver] = cookie.split('=')[1].split('.');
  const body = `${uid}.${ver}.${Date.now() + expIn}`;
  const key = crypto.createHash('sha256').update(secret).digest();
  return `${body}.${crypto.createHmac('sha256', key).update(body).digest('base64url')}`;
}
const rawMe = (base, headers) => fetch(base + '/api/me', { headers });

test('Gleitende Sitzung: ein altes Token wird erneuert, ein frisches nicht, ein abgelaufenes gilt nicht', async () => {
  const SECRET = 'test-geheimnis-sitzung';
  const s = await start({ AUTH: '1', SESSION_SECRET: SECRET });
  const setup = await fetch(s.base + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: s.token, password: PW }) });
  const setCookie = setup.headers.get('set-cookie');
  assert.match(setCookie, /Max-Age=15552000/, 'Lebensdauer 180 Tage');
  assert.match(setCookie, /HttpOnly/);
  const cookie = setCookie.split(';')[0];
  const exp = (v) => Number(v.split('=')[1].split('.')[2]);
  assert.ok(Math.abs(exp(cookie) - (Date.now() + 180 * DAY)) < 60000, 'Ablauf in 180 Tagen');

  // frisch ausgestellt: keine Erneuerung
  const fresh = await rawMe(s.base, { Cookie: cookie });
  assert.equal(fresh.status, 200); assert.equal(fresh.headers.get('set-cookie'), null, 'unter einem Tag alt: kein neues Cookie');
  // vor 12 Stunden ausgestellt: noch nicht fällig
  const half = `gutkeeper_session=${forge(SECRET, cookie, 180 * DAY - 12 * 3600000)}`;
  assert.equal((await rawMe(s.base, { Cookie: half })).headers.get('set-cookie'), null);
  // vor 80 Tagen ausgestellt (Ablauf in 100 Tagen): gültig und wird erneuert
  const old = `gutkeeper_session=${forge(SECRET, cookie, 100 * DAY)}`;
  const renewed = await rawMe(s.base, { Cookie: old });
  assert.equal(renewed.status, 200);
  const sc = renewed.headers.get('set-cookie');
  assert.ok(sc, 'frisches Cookie');
  assert.ok(Math.abs(exp(sc.split(';')[0]) - (Date.now() + 180 * DAY)) < 60000, 'wieder 180 Tage');
  assert.match(sc, /Max-Age=15552000/);
  // auch bei anderen Anfragen als /api/me, und das neue Cookie gilt
  const sync = await fetch(s.base + '/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: old }, body: '{"since":0}' });
  assert.equal(sync.status, 200); assert.ok(sync.headers.get('set-cookie'));
  assert.equal((await rawMe(s.base, { Cookie: sc.split(';')[0] })).status, 200);
  // Token im Header (eigenständige App): neues Token in X-Session-Token statt Cookie
  const viaBearer = await rawMe(s.base, { Authorization: 'Bearer ' + forge(SECRET, cookie, 100 * DAY) });
  assert.equal(viaBearer.status, 200); assert.equal(viaBearer.headers.get('set-cookie'), null);
  const tok = viaBearer.headers.get('x-session-token');
  assert.ok(tok && tok.split('.').length === 4);
  assert.equal((await rawMe(s.base, { Authorization: 'Bearer ' + tok })).status, 200, 'erneuertes Token gilt');
  assert.equal((await rawMe(s.base, { Authorization: 'Bearer ' + tok })).headers.get('x-session-token'), null, 'und ist frisch');
  // abgelaufen (181 Tage ohne Nutzung): ungültig
  assert.equal((await rawMe(s.base, { Cookie: `gutkeeper_session=${forge(SECRET, cookie, -1000)}` })).status, 401);
  // Antworten ohne Anmeldung setzen kein Cookie
  assert.equal((await rawMe(s.base, {})).headers.get('set-cookie'), null);
  await s.stop();
});

test('Einzelnutzer: Passwort ändern und „Andere Geräte abmelden“ beenden die Sitzungen der anderen Geräte', async () => {
  const s = await start({ AUTH: '1' });
  const a = client(s.base), b = client(s.base), d = client(s.base);
  await a.post('/api/setup', { secret: s.token, password: PW });
  assert.equal((await b.post('/api/login', { password: PW })).status, 200);
  assert.equal((await d.post('/api/login', { password: PW })).status, 200);

  // Andere Geräte abmelden: dieses Gerät bleibt, die anderen müssen neu anmelden
  assert.equal((await a.post('/api/logout-others', {})).status, 200);
  assert.equal((await a.get('/api/me')).status, 200);
  assert.equal((await b.get('/api/me')).status, 401);
  assert.equal((await b.post('/api/login', { password: PW })).status, 200, 'erneutes Anmelden geht');
  assert.equal((await b.get('/api/me')).status, 200);
  assert.equal((await d.get('/api/me')).status, 401);

  // Passwort ändern: falsches aktuelles Passwort, zu kurz, dann Erfolg
  assert.equal((await a.post('/api/account/password', { current: 'falsch-falsch', next: 'Neues-Passwort-9' })).status, 401);
  assert.equal((await a.post('/api/account/password', { current: PW, next: 'kurz' })).json.error, 'password');
  const ch = await a.post('/api/account/password', { current: PW, next: 'Neues-Passwort-9' });
  assert.equal(ch.status, 200); assert.ok(!('verifier' in ch.json));
  assert.equal((await a.get('/api/me')).status, 200, 'eigene Sitzung bleibt');
  assert.equal((await b.get('/api/me')).status, 401, 'andere Sitzung endet');
  assert.equal((await d.post('/api/login', { password: PW })).status, 401, 'altes Passwort gilt nicht mehr');
  assert.equal((await d.post('/api/login', { password: 'Neues-Passwort-9' })).status, 200);
  await s.stop();
});

test('CLI: reset-password setzt das Passwort des Hauptkontos im Einzelnutzer-Betrieb und meldet alle ab', async () => {
  const s = await start({ AUTH: '1' });
  const a = client(s.base), anon = client(s.base);
  await a.post('/api/setup', { secret: s.token, password: PW });
  const cli = (...args) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'server/cli.js'), ...args], { env: { ...process.env, DATA_DIR: s.dir }, encoding: 'utf8' });
  const bad = cli('reset-password', 'kurz');
  assert.notEqual(bad.status, 0); assert.match(bad.stderr, /mindestens 8/);
  const r = cli('reset-password', 'Per-CLI-Passwort-1');
  assert.equal(r.status, 0, r.stderr);
  assert.equal((await a.get('/api/me')).status, 401, 'alte Sitzung beendet');
  assert.equal((await anon.post('/api/login', { password: PW })).status, 401);
  assert.equal((await anon.post('/api/login', { password: 'Per-CLI-Passwort-1' })).status, 200);
  assert.equal(cli('reset-password', 'egal', 'Mit-Name-Passwort-1').status, 0, 'auch mit (ignoriertem) Namen');
  assert.equal((await anon.post('/api/login', { password: 'Mit-Name-Passwort-1' })).status, 200);
  assert.match(cli('list-users').stdout, /Passwort ist festgelegt/);
  await s.stop();
});

test('Umstellung von Einzelnutzer auf Mehrbenutzer: das Hauptkonto bekommt beim Einrichten einen Namen und behält die Daten', async () => {
  const s = await start({ AUTH: '1' });
  const a = client(s.base);
  await a.post('/api/setup', { secret: s.token, password: PW });
  await a.post('/api/sync', { since: 0, changes: [entry('vorher-0001')] });
  await s.stop();
  const m = await start({ MULTIUSER: '1' }, s.dir);
  const c = client(m.base);
  assert.equal((await c.get('/api/config')).json.needsSetup, true);
  assert.equal((await c.post('/api/setup', { secret: m.token, name: 'jam', password: 'Anderes-Passwort-1' })).status, 200);
  assert.equal((await c.post('/api/sync', { since: 0 })).json.changes.length, 1);
  assert.equal((await c.get('/api/config')).json.needsSetup, false);
  await m.stop();
});

// ---------------------------------------------------------------------------------------------
test('Fehlerhafte Anfragen liefern passende Statuscodes (413, 400)', async () => {
  const s = await start();
  const post = (body) => fetch(s.base + '/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  assert.equal((await post('{"since":0}')).status, 200);
  assert.equal((await post('{kaputt')).status, 400, 'ungültiges JSON');
  assert.equal((await fetch(s.base + '/%E0%A4%A')).status, 400, 'fehlerhafte URL-Kodierung');
  let big; try { big = (await post('x'.repeat(5_100_000))).status; } catch { big = 413; } // der Server kappt die Verbindung ggf. vor dem Lesen der Antwort
  assert.equal(big, 413, 'Body über 5 MB');
  assert.equal((await post('{"since":0}')).status, 200, 'Server läuft danach weiter');
  await s.stop();
});

// ---------------------------------------------------------------------------------------------
test('Jede SQL-Abfrage auf Einträge und Essen filtert nach Konto (user_id)', () => {
  const files = ['db.js', 'sync.js', 'storage.js', 'index.js', 'e2ee.js', 'backups.js', 'account.js'].map((f) => [f, fs.readFileSync(path.join(ROOT, 'server', f), 'utf8')]);
  const sqls = [];
  for (const [f, src] of files) {
    for (const m of src.matchAll(/(?:prep|db\.prepare|db\.exec)\(\s*([`'"])([\s\S]*?)\1\s*\)/g)) sqls.push([f, m[2]]);
  }
  const risky = /\b(FROM|INTO|UPDATE|DELETE FROM)\s+(entries|foods)\b/i;
  const offenders = sqls.filter(([, s]) => risky.test(s) && !/user_id/.test(s) && !/\/\*global\*\//.test(s) && !/CREATE|DROP|ALTER|RENAME|entries_old|foods_old/i.test(s));
  assert.deepEqual(offenders, [], 'Abfragen ohne user_id: ' + JSON.stringify(offenders));
  assert.ok(sqls.length > 20, 'SQL wurde gefunden');
});

test('Verschlüsselung: Rundlauf, falsches Passwort, kein Klartext', async () => {
  const w = await wrap(Buffer.from('{"geheim":"Blut im Stuhl"}'), 'pw12345678', 'json');
  assert.ok(!JSON.stringify(w).includes('Blut'));
  assert.equal((await unwrap(w, 'pw12345678')).toString(), '{"geheim":"Blut im Stuhl"}');
  await assert.rejects(() => unwrap(w, 'anderes'));
});

test('BACKUP_PASSWORD: Backups sind verschlüsselt und lassen sich zurückspielen; settings.json wirkt', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-bk-'));
  const bdir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-bkdir-'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ mealTimes: { breakfastUntil: '9:00', lunchUntil: '14:00', snackUntil: '16:00', dinnerUntil: '20:00' }, recentFoods: 3, colors: { 1: '#112233', 3: 'kein-hex', 6: '#ABCDEF' }, noteTags: [' Kaffee ', 'kaffee', 'Laktose, Milch', 42, ''], foodPins: ['Haferflocken', 'x'.repeat(201)] }));
  const s = await start({ BACKUP_PASSWORD: 'geheim-123', BACKUP_DIR: bdir }, dir);
  const c = client(s.base);
  const cfg = (await c.get('/api/config')).json;
  assert.deepEqual(cfg.mealTimes, [540, 840, 960, 1200]);
  assert.equal(cfg.recentFoods, 3);
  assert.deepEqual(cfg.noteTags, ['Kaffee', 'Laktose Milch'], 'Schlagwörter bereinigt, Doppelte und Ungültige übersprungen');
  assert.deepEqual(cfg.foodPins, ['Haferflocken'], 'zu lange Speise übersprungen');
  assert.deepEqual(cfg.colors, ['#112233', null, null, null, null, '#abcdef'], 'gültige Farbtöne übernommen, ungültige ignoriert');
  assert.equal((await c.post('/api/sync', { since: 0, changes: [entry('bk-enc-1'), entry('bk-enc-2')] })).status, 200);
  const name = (await c.post('/api/backup')).json.name;
  assert.ok(name.endsWith('.db.enc.json'), 'verschlüsselter Dateiname');
  const file = fs.readFileSync(path.join(bdir, name), 'utf8');
  assert.ok(!file.includes('bk-enc-1') && JSON.parse(file).gutkeeper === 'encrypted', 'kein Klartext');
  assert.ok(!fs.readdirSync(bdir).some((f) => f.endsWith('.tmp') || (f.endsWith('.db') && !f.endsWith('.enc.json'))), 'keine unverschlüsselten Reste');
  const list = (await c.get('/api/backups')).json.backups;
  assert.equal(list.find((b) => b.name === name).encrypted, true);
  await c.post('/api/sync', { since: 0, changes: [entry('bk-enc-1', { deleted: 1, updated_at: Date.now() + 5 })] });
  const r = await c.post('/api/restore', { name });
  assert.equal(r.status, 200);
  assert.equal(r.json.count, 2, 'beide Einträge wieder da');
  await s.stop();
  // ohne Passwort lässt sich das verschlüsselte Backup nicht zurückspielen
  const s2 = await start({ BACKUP_DIR: bdir }, dir);
  const c2 = client(s2.base);
  const r2 = await c2.post('/api/restore', { name });
  assert.equal(r2.status, 409);
  assert.equal(r2.json.error, 'password');
  await s2.stop();
});

test('Backups in derselben Sekunde überschreiben sich nicht', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-bk2-'));
  const bdir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-bk2dir-'));
  const s = await start({ BACKUP_DIR: bdir }, dir);
  try {
    const c = client(s.base);
    await c.post('/api/sync', { since: 0, changes: [entry('bk-same-1')] });
    const names = [];
    for (let i = 0; i < 3; i++) names.push((await c.post('/api/backup')).json.name); // schnell hintereinander
    assert.equal(new Set(names).size, 3, 'drei verschiedene Namen: ' + names.join(', '));
    for (const n of names) assert.ok(fs.existsSync(path.join(bdir, n)), n + ' existiert');
    const list = (await c.get('/api/backups')).json.backups.map((b) => b.name);
    for (const n of names) assert.ok(list.includes(n), n + ' in der Liste');
  } finally { await s.stop(); }
});

// ---------------------------------------------------------------------------------------------
// Anfrage mit frei wählbarem Host-Header (fetch erlaubt das nicht)
const http = require('node:http');
function rawGet(base, host, urlPath = '/api/health') {
  return new Promise((resolve, reject) => {
    const u = new URL(base);
    const r = http.request({ host: u.hostname, port: u.port, path: urlPath, method: 'GET', headers: { host } }, (res) => {
      let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => resolve({ status: res.statusCode, text: t }));
    });
    r.on('error', reject); r.end();
  });
}

test('Host-Prüfung: mit NO_AUTH nur IP/localhost (DNS-Rebinding)', async () => {
  const s = await start();
  const port = new URL(s.base).port;
  assert.equal((await rawGet(s.base, 'evil.example')).status, 403);
  assert.equal((await rawGet(s.base, 'evil.example:' + port, '/')).status, 403, 'auch statische Dateien');
  assert.equal((await rawGet(s.base, '127.0.0.1:' + port)).status, 200);
  assert.equal((await rawGet(s.base, 'localhost:' + port)).status, 200);
  assert.equal((await rawGet(s.base, '[fd00::1]:' + port)).status, 200, 'IPv6 in Klammern');
  assert.match(s.log(), /ALLOWED_HOSTS/, 'Hinweis beim Start');
  await s.stop();
});

test('Host-Prüfung: ALLOWED_HOSTS erlaubt Namen, mit Anmeldung (auch vor der Einrichtung) bleiben Namen erlaubt', async () => {
  const s = await start({ ALLOWED_HOSTS: 'GutKeeper.Test, other.test' });
  const port = new URL(s.base).port;
  assert.equal((await rawGet(s.base, 'gutkeeper.test:' + port)).status, 200);
  assert.equal((await rawGet(s.base, 'other.test')).status, 200);
  assert.equal((await rawGet(s.base, 'evil.example')).status, 403);
  assert.equal((await rawGet(s.base, '127.0.0.1:' + port)).status, 200);
  await s.stop();
  const p = await start({ AUTH: '1' });
  const host = 'gutkeeper.fritz.box:' + new URL(p.base).port;
  assert.equal((await rawGet(p.base, host)).status, 200, 'vor der Einrichtung');
  assert.equal((await rawGet(p.base, host, '/')).status, 200);
  assert.doesNotMatch(p.log(), /DNS-Rebinding/);
  await client(p.base).post('/api/setup', { secret: p.token, password: PW });
  assert.equal((await rawGet(p.base, host)).status, 200, 'nach der Einrichtung');
  await p.stop();
  const m = await start({ MULTIUSER: '1', ALLOWED_HOSTS: 'gutkeeper.test' });
  assert.equal((await rawGet(m.base, 'evil.example')).status, 403, 'ALLOWED_HOSTS gilt auch mit Anmeldung');
  assert.equal((await rawGet(m.base, 'gutkeeper.test')).status, 200);
  await m.stop();
});

// ---------------------------------------------------------------------------------------------
test('Andere Geräte abmelden: Mehrbenutzer', async () => {
  const s = await start({ MULTIUSER: '1' });
  const a = client(s.base), b = client(s.base);
  await a.post('/api/setup', { secret: s.token, name: 'jam', password: PW });
  assert.equal((await b.post('/api/login', { name: 'jam', password: PW })).status, 200);
  assert.equal((await b.get('/api/me')).status, 200);
  const r = await a.post('/api/logout-others', {});
  assert.equal(r.status, 200); assert.equal(r.json.ok, true);
  assert.equal((await a.get('/api/me')).status, 200, 'dieses Gerät bleibt angemeldet');
  assert.equal((await b.get('/api/me')).status, 401, 'das andere Gerät ist abgemeldet');
  assert.equal((await b.post('/api/login', { name: 'jam', password: PW })).status, 200, 'erneutes Anmelden geht');
  await s.stop();
});

// ---------------------------------------------------------------------------------------------
// Fünf Fehlversuche mit wechselnden X-Real-IP-Headern und wechselnden Namen (Mehrbenutzer: Sperren gelten je Adresse und je Name).
// Wird der Header ignoriert, sperrt die Adresse 127.0.0.1; wird er geglaubt, hat jede (gefälschte) Adresse nur einen Fehlversuch.
async function spoofLogins(env) {
  const s = await start({ MULTIUSER: '1', TRUST_PROXY: '1', ...env });
  const c = client(s.base);
  await c.post('/api/setup', { secret: s.token, name: 'jam', password: PW });
  const anon = client(s.base);
  for (let i = 0; i < 5; i++) assert.equal((await anon.post('/api/login', { name: 'x' + i, password: 'falsch-falsch' }, { 'X-Real-IP': '10.1.1.' + i })).status, 401);
  const sixth = await anon.post('/api/login', { name: 'x9', password: 'falsch-falsch' }, { 'X-Real-IP': '10.1.1.99' });
  await s.stop();
  return sixth.status;
}

test('Mehrbenutzer: gleichzeitige Fehlversuche umgehen die Sperre nicht (asynchrones scrypt)', async () => {
  const s = await start({ MULTIUSER: '1' });
  const c = client(s.base);
  await c.post('/api/setup', { secret: s.token, name: 'jam', password: PW });
  const anon = client(s.base);
  const all = await Promise.all(Array.from({ length: 12 }, () => anon.post('/api/login', { name: 'jam', password: 'falsch-falsch' })));
  const codes = all.map((r) => r.status);
  await s.stop();
  assert.ok(codes.filter((x) => x === 401).length <= 5, 'höchstens fünf Versuche werden geprüft: ' + codes.join(','));
  assert.ok(codes.includes(429), 'der Rest wird gesperrt');
});

test('TRUSTED_PROXY: Header von fremden Adressen werden ignoriert', async () => {
  assert.equal(await spoofLogins({ TRUSTED_PROXY: '10.9.9.9' }), 429, 'gefälschte IPs umgehen die Sperre der echten Adresse nicht');
});

test('TRUSTED_PROXY: Header vom vertrauten Proxy werden beachtet', async () => {
  assert.equal(await spoofLogins({ TRUSTED_PROXY: '127.0.0.1' }), 401, 'jede weitergereichte Adresse zählt für sich');
  assert.equal(await spoofLogins({ TRUSTED_PROXY: '10.9.9.9, bogus, 127.0.0.0/8' }), 401, 'Subnetz passt, ungültiger Eintrag wird ignoriert');
});

test('TRUSTED_PROXY: ungültige Einträge erzeugen eine Warnung', async () => {
  const s = await start({ TRUST_PROXY: '1', TRUSTED_PROXY: 'bogus,1.2.3.4/99' });
  assert.match(s.log(), /TRUSTED_PROXY-Eintrag „bogus“ ist ungültig/);
  assert.match(s.log(), /TRUSTED_PROXY-Eintrag „1\.2\.3\.4\/99“ ist ungültig/);
  await s.stop();
  const s2 = await start({ TRUST_PROXY: '1' });
  assert.match(s2.log(), /ohne TRUSTED_PROXY/);
  await s2.stop();
});

// ---------------------------------------------------------------------------------------------
test('Restore: altes Backup ohne Konten (ohne user_id, blob, foods)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-'));
  const bdir = path.join(dir, 'bk');
  fs.mkdirSync(bdir);
  const old = new DatabaseSync(path.join(bdir, 'gutkeeper-2025-01-01_000000-auto.db'));
  old.exec('CREATE TABLE entries (id TEXT PRIMARY KEY, date TEXT, time TEXT, consistency INTEGER, urge INTEGER, amount INTEGER, blood INTEGER, pain INTEGER, mucus INTEGER, luft INTEGER, note TEXT, color INTEGER, updated_at INTEGER, deleted INTEGER, seq INTEGER)');
  const ins = old.prepare('INSERT INTO entries VALUES (?, ?, ?, 4, 1, 2, 0, 0, 0, 0, ?, 1, ?, 0, ?)');
  ins.run('old-entry-1', '2025-01-01', '08:00', 'alt', 1000, 1);
  ins.run('old-entry-2', '2025-01-02', '09:00', '', 1000, 2);
  old.close();
  fs.writeFileSync(path.join(bdir, 'gutkeeper-2025-01-02_000000-auto.db'), ''); // keine gültige Datenbank
  const other = new DatabaseSync(path.join(bdir, 'gutkeeper-2025-01-03_000000-auto.db'));
  other.exec('CREATE TABLE irgendwas (x INTEGER)'); other.close();

  const s = await start({ BACKUP_DIR: bdir, FOOD_DEFAULT: '1' }, dir);
  const c = client(s.base);
  await c.post('/api/sync', { since: 0, foodSince: 0, changes: [entry('cur-entry-1')], foodChanges: [food('cur-food-1', 'Brot')] });
  const r = await c.post('/api/restore', { name: 'gutkeeper-2025-01-01_000000-auto.db' });
  assert.equal(r.status, 200); assert.equal(r.json.count, 2);
  const after = (await c.post('/api/sync', { since: 0, foodSince: 0, changes: [], foodChanges: [] })).json;
  assert.deepEqual(after.changes.map((e) => e.id).sort(), ['old-entry-1', 'old-entry-2']);
  assert.equal(after.changes.find((e) => e.id === 'old-entry-1').note, 'alt');
  assert.deepEqual(after.foodChanges.map((f) => f.id), ['cur-food-1'], 'vorhandenes Essen bleibt erhalten');
  const bad = await c.post('/api/restore', { name: 'gutkeeper-2025-01-03_000000-auto.db' });
  assert.equal(bad.status, 409); assert.equal(bad.json.error, 'format');
  await s.stop();
});

// ---------------------------------------------------------------------------------------------
test('Abgleich: Zeitstempel aus der Zukunft werden begrenzt', async () => {
  const s = await start({ FOOD_DEFAULT: '1' });
  const a = client(s.base), b = client(s.base);
  const year = Date.now() + 365 * 86400000;
  const r = (await a.post('/api/sync', { since: 0, foodSince: 0, changes: [entry('future-1', { updated_at: year })], foodChanges: [{ ...food('future-f1', 'Zukunft'), updated_at: year }] })).json;
  const limit = Date.now() + 10 * 60 * 1000;
  assert.ok(r.changes[0].updated_at <= limit && r.changes[0].updated_at > Date.now(), 'Eintrag begrenzt');
  assert.ok(r.foodChanges[0].updated_at <= limit, 'Essen begrenzt');
  // Eine Änderung aus dem Toleranzfenster verliert noch gegen den begrenzten Stand (Obergrenze jetzt + 10 Minuten) ...
  await b.post('/api/sync', { since: 0, changes: [entry('future-1', { note: 'zu früh', updated_at: Date.now() + 60000 })] });
  assert.equal((await b.post('/api/sync', { since: 0, changes: [] })).json.changes[0].note, '');
  // ... eine spätere Änderung (hier: ebenfalls an der Obergrenze, aber später gesendet) gewinnt, der Stand ist nicht dauerhaft blockiert
  await b.post('/api/sync', { since: 0, changes: [entry('future-1', { note: 'neu', updated_at: Date.now() + 11 * 60000 })] });
  const after = (await b.post('/api/sync', { since: 0, changes: [] })).json;
  assert.equal(after.changes.find((e) => e.id === 'future-1').note, 'neu');
  await s.stop();
});

test('Installations-Kennung: /api/config meldet sie, sie bleibt über Neustarts gleich und ist reiner Zufall', async () => {
  const a = await start({ SESSION_SECRET: 'gleicher-schluessel' });
  const idA = (await client(a.base).get('/api/config')).json.instance;
  assert.match(idA, /^[0-9a-f]{24}$/);
  assert.equal(fs.readFileSync(path.join(a.dir, 'instance.id'), 'utf8').trim(), idA, 'liegt in data/instance.id');
  await a.stop();
  const a2 = await start({ SESSION_SECRET: 'gleicher-schluessel' }, a.dir);
  assert.equal((await client(a2.base).get('/api/config')).json.instance, idA, 'stabil nach Neustart');
  // gleicher Schlüssel, anderer Datenordner: andere Kennung (also nicht aus Geheimnissen abgeleitet)
  const b = await start({ SESSION_SECRET: 'gleicher-schluessel' });
  const idB = (await client(b.base).get('/api/config')).json.instance;
  assert.notEqual(idB, idA);
  // ohne SESSION_SECRET: die Kennung kommt weder aus session.key noch steht dieser in ihr
  const c = await start();
  const idC = (await client(c.base).get('/api/config')).json.instance;
  const key = fs.readFileSync(path.join(c.dir, 'session.key'), 'utf8').trim();
  assert.ok(!key.includes(idC) && !idC.includes(key.slice(0, 12)), 'nicht aus dem Sitzungsschlüssel');
  assert.equal(crypto.createHash('sha256').update(key).digest('hex').slice(0, 24) === idC, false);
  for (const s of [a2, b, c]) await s.stop();
});

test('Admin-Export trägt den Herkunftskopf (Instanz, Konto, Zeitpunkt)', async () => {
  const s = await start({ MULTIUSER: '1' });
  const admin = client(s.base), bob = client(s.base);
  await admin.post('/api/setup', { secret: s.token, name: 'chef', password: PW });
  await admin.post('/api/admin/users', { name: 'bob', password: PW });
  await bob.post('/api/login', { name: 'bob', password: PW });
  const inst = (await admin.get('/api/config')).json.instance;
  const bobId = (await admin.get('/api/admin/users')).json.users.find((u) => u.name === 'bob').id;
  const one = (await admin.post('/api/admin/export', { user: bobId })).json;
  assert.equal(one.origin.instance, inst); assert.equal(one.origin.account, 'bob'); assert.equal(one.origin.accountId, bobId); assert.equal(one.origin.kind, 'server');
  assert.ok(!Number.isNaN(Date.parse(one.origin.exportedAt)));
  const all = (await admin.post('/api/admin/export', { user: 'all' })).json;
  assert.equal(all.origin.instance, inst); assert.equal(all.origin.account, null);
  assert.deepEqual(all.users.map((u) => u.name).sort(), ['bob', 'chef']);
  assert.equal(all.users.find((u) => u.name === 'bob').id, bobId, 'Konto-ID je Eintrag im Bündel');
  const enc = (await admin.post('/api/admin/export', { user: bobId, password: 'export-pw' })).json;
  assert.ok(!JSON.stringify(enc).includes(inst), 'verschlüsselt: auch der Herkunftskopf ist nicht im Klartext');
  assert.equal(JSON.parse((await unwrap(enc, 'export-pw')).toString()).origin.instance, inst);
  await s.stop();
});

test('Geführter Einstieg: /api/config meldet onboarding, außer mit ONBOARDING=0', async () => {
  const on = await start();
  const off = await start({ ONBOARDING: '0' });
  const other = await start({ ONBOARDING: '1' });
  assert.equal((await client(on.base).get('/api/config')).json.onboarding, true, 'standardmäßig an');
  assert.equal((await client(off.base).get('/api/config')).json.onboarding, false);
  assert.equal((await client(other.base).get('/api/config')).json.onboarding, true);
  for (const s of [off, on, other]) await s.stop();
});

// ---------------------------------------------------------------------------------------------
// „Konto löschen“: Einzelnutzer, Mehrbenutzer, letzter Admin, Zurücksetzen (und kein Verlass mehr auf Konto 1)
const lastToken = (s) => [...s.log().matchAll(/Einmal-Code für die Einrichtung: (\w+)/g)].pop()[1]; // der neueste Code im Log
const dbOf = (s) => new DatabaseSync(path.join(s.dir, 'gutkeeper.db'), { readOnly: true });
const cliIn = (dir, input, ...args) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'server/cli.js'), ...args], { env: { ...process.env, DATA_DIR: dir }, input, encoding: 'utf8' });

test('Konto löschen (Einzelnutzer): Server beginnt wieder bei der Einrichtung, alte Sitzungen und Daten sind weg', async () => {
  const s = await start({ AUTH: '1' });
  const c = client(s.base), other = client(s.base), anon = client(s.base);
  await c.post('/api/setup', { secret: s.token, password: PW });
  await other.post('/api/login', { password: PW });
  await c.post('/api/settings', { food: true });
  await c.post('/api/sync', { since: 0, foodSince: 0, changes: [entry('del-single-1')], foodChanges: [food('del-single-f1', 'Pizza')] });
  assert.ok((await c.post('/api/backup')).json.name, 'Backup vorhanden');
  const oldCookie = c.cookie();

  assert.equal((await c.post('/api/account/delete', {})).status, 401, 'ohne Passwort');
  assert.equal((await c.post('/api/account/delete', { password: 'falsch-falsch' })).json.error, 'wrong');
  assert.equal((await c.post('/api/sync', { since: 0 })).json.changes.length, 1, 'falsches Passwort löscht nichts');

  const r = await c.post('/api/account/delete', { password: PW });
  assert.equal(r.status, 200); assert.equal(r.json.reset, true);
  assert.equal(c.cookie(), '', 'Cookie wird gelöscht');
  assert.match(s.log(), /Konto des Hauptkontos gelöscht/);
  const cfg = (await anon.get('/api/config')).json;
  assert.equal(cfg.needsSetup, true, 'Einrichtung ist wieder offen');
  assert.equal((await anon.post('/api/login', { password: PW })).status, 409, 'kein Login mehr');
  assert.equal((await other.get('/api/me')).status, 401, 'andere Sitzungen sind beendet');

  // neuer Einmal-Code: der alte gilt nicht mehr
  const fresh = lastToken(s);
  assert.notEqual(fresh, s.token, 'neuer Code im Log');
  const setup = client(s.base);
  assert.equal((await setup.post('/api/setup', { secret: s.token, password: PW })).status, 401, 'alter Code ungültig');
  assert.equal((await setup.post('/api/setup', { secret: fresh, password: 'Ganz-Neues-Passwort-1' })).status, 200);
  const sy = (await setup.post('/api/sync', { since: 0, foodSince: 0 })).json;
  assert.equal(sy.changes.length, 0); assert.equal(sy.foodChanges.length, 0); assert.equal(sy.food, false, 'Einstellungen zurückgesetzt');
  const old = client(s.base); old.setCookie(oldCookie);
  assert.equal((await old.get('/api/me')).status, 401, 'alte Sitzung bleibt auch nach der neuen Einrichtung ungültig');
  assert.equal((await client(s.base).post('/api/login', { password: PW })).status, 401, 'altes Passwort gilt nicht');
  // dieselbe Konto-ID: ein Backup von vorher lässt sich zurückspielen
  const name = (await setup.get('/api/backups')).json.backups[0].name;
  assert.equal((await setup.post('/api/restore', { name })).status, 200);
  assert.equal((await setup.post('/api/sync', { since: 0 })).json.changes.length, 1);

  // optional auch die Server-Backups löschen
  assert.equal((await setup.post('/api/account/delete', { password: 'Ganz-Neues-Passwort-1', dropBackups: true })).status, 200);
  assert.deepEqual(fs.readdirSync(path.join(s.dir, 'backups')), [], 'keine Backups mehr');
  const db = dbOf(s);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM entries WHERE user_id = 1').get().c, 0);
  const u = db.prepare('SELECT pass, e2ee, e2ee_key FROM users').all();
  assert.equal(u.length, 1); assert.equal(u[0].pass, ''); assert.equal(u[0].e2ee_key, '');
  db.close(); await s.stop();
});

test('Konto löschen: falsche Passwörter zählen als Fehlversuche und sperren, nichts wird gelöscht', async () => {
  const s = await start({ AUTH: '1' });
  const c = client(s.base);
  await c.post('/api/setup', { secret: s.token, password: PW });
  await c.post('/api/sync', { since: 0, changes: [entry('lock-del-001')] });
  let last = 0; for (let i = 0; i < 6; i++) last = (await c.post('/api/account/delete', { password: 'falsch-' + i })).status;
  assert.equal(last, 429, 'nach mehreren Fehlversuchen gesperrt');
  assert.equal((await c.post('/api/account/delete', { password: PW })).status, 429, 'auch das richtige Passwort wartet');
  assert.equal((await c.post('/api/sync', { since: 0 })).json.changes.length, 1, 'Daten sind noch da');
  assert.equal((await client(s.base).post('/api/login', { password: PW })).status, 429, 'der Zähler gilt auch für die Anmeldung (ein Konto)');
  await s.stop();
});

test('Konto löschen: NO_AUTH hat kein Passwort und kein Konto zum Löschen', async () => {
  const s = await start();
  assert.equal((await client(s.base).post('/api/account/delete', { password: 'x' })).json.error, 'no-lock');
  await s.stop();
});

test('Konto löschen (Mehrbenutzer): normales Konto weg, andere Konten und ihre Daten unberührt', async () => {
  const s = await start({ MULTIUSER: '1', FOOD_DEFAULT: '1' });
  const admin = client(s.base), bob = client(s.base), bob2 = client(s.base), carol = client(s.base);
  await admin.post('/api/setup', { secret: s.token, name: 'jam', password: PW });
  for (const n of ['bob', 'carol']) await admin.post('/api/admin/users', { name: n, password: PW });
  await bob.post('/api/login', { name: 'bob', password: PW }); await bob2.post('/api/login', { name: 'bob', password: PW });
  await carol.post('/api/login', { name: 'carol', password: PW });
  const put = (c, id) => c.post('/api/sync', { since: 0, foodSince: 0, changes: [entry(id)], foodChanges: [food(id + '-f', 'Brot')] });
  await put(admin, 'jam-eintrag-1'); await put(bob, 'bob-eintrag-01'); await put(carol, 'carol-eintrag1');

  assert.equal((await bob.post('/api/account/delete', { password: 'falsch-falsch' })).status, 401);
  assert.equal((await bob.get('/api/me')).status, 200, 'falsches Passwort: Konto bleibt');
  const r = await bob.post('/api/account/delete', { password: PW });
  assert.equal(r.status, 200); assert.equal(r.json.reset, false, 'nur das Konto, kein Zurücksetzen');
  assert.match(s.log(), /Konto „bob“ \(ID \d+\) wurde vom Besitzer gelöscht/);
  assert.equal((await bob2.get('/api/me')).status, 401, 'auch andere Geräte von bob sind abgemeldet');
  assert.equal((await client(s.base).post('/api/login', { name: 'bob', password: PW })).status, 401);
  assert.deepEqual((await admin.get('/api/admin/users')).json.users.map((u) => u.name), ['jam', 'carol']);
  assert.equal((await client(s.base).get('/api/config')).json.needsSetup, false, 'kein Zurücksetzen');
  assert.equal((await carol.post('/api/sync', { since: 0, foodSince: 0 })).json.changes[0].id, 'carol-eintrag1');
  assert.equal((await admin.post('/api/sync', { since: 0, foodSince: 0 })).json.foodChanges.length, 1);
  const db = dbOf(s);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM entries WHERE id LIKE 'bob-%'").get().c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM foods WHERE id LIKE 'bob-%'").get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM entries').get().c, 2);
  db.close(); await s.stop();
});

test('Konto löschen (Mehrbenutzer): letzter Admin muss erst übergeben, danach geht es; das letzte Konto setzt den Server zurück', async () => {
  const s = await start({ MULTIUSER: '1' });
  const jam = client(s.base), bob = client(s.base), anon = client(s.base);
  await jam.post('/api/setup', { secret: s.token, name: 'jam', password: PW });
  const jamId = (await jam.get('/api/me')).json.user.id;
  await jam.post('/api/admin/users', { name: 'bob', password: 'Bobs-Passwort-1' });
  await bob.post('/api/login', { name: 'bob', password: 'Bobs-Passwort-1' });
  const bobId = (await bob.get('/api/me')).json.user.id;
  await jam.post('/api/sync', { since: 0, changes: [entry('jam-uebergabe-1')] });
  assert.equal((await jam.get('/api/me')).json.user.main, true, 'jam ist das Hauptkonto');

  // jam ist der letzte Admin und es gibt bob: abgelehnt, auch mit richtigem Passwort, nichts passiert
  const no = await jam.post('/api/account/delete', { password: PW });
  assert.equal(no.status, 409); assert.equal(no.json.error, 'handover');
  assert.equal((await jam.get('/api/me')).status, 200);
  // bob ist kein Admin, kann sich aber löschen? Ja – normales Konto. Erst bob zum Admin machen (Übergabe)
  assert.equal((await jam.post(`/api/admin/users/${bobId}`, { role: 'admin' })).status, 200);
  const r = await jam.post('/api/account/delete', { password: PW });
  assert.equal(r.status, 200); assert.equal(r.json.reset, false);
  assert.equal((await jam.get('/api/me')).status, 401);

  // Konto 1 ist weg: nichts darf davon abhängen
  assert.equal(jamId, 1);
  const db = dbOf(s); assert.equal(db.prepare('SELECT COUNT(*) c FROM users WHERE id = 1').get().c, 0); db.close();
  assert.equal((await anon.get('/api/config')).json.needsSetup, false, 'Einrichtung bleibt geschlossen');
  assert.equal((await bob.get('/api/me')).json.user.main, true, 'bob ist jetzt das Hauptkonto');
  assert.equal((await bob.get('/api/admin/users')).json.users.length, 1);
  assert.equal((await bob.post('/api/admin/users', { name: 'dora', password: PW })).status, 200, 'bob verwaltet weiter');
  await s.stop();
  const s2 = await start({ MULTIUSER: '1' }, s.dir); // Neustart ohne Konto 1: kein neuer Einmal-Code, Sitzung bleibt
  assert.equal(s2.token, undefined);
  const bob2 = client(s2.base); bob2.setCookie(bob.cookie());
  assert.equal((await bob2.get('/api/me')).status, 200);
  assert.equal((await client(s2.base).post('/api/login', { name: 'bob', password: 'Bobs-Passwort-1' })).status, 200);

  // dora (Nutzer) löscht sich, dann ist bob wieder das einzige Konto und setzt mit „Konto löschen“ den Server zurück
  const dora = client(s2.base); await dora.post('/api/login', { name: 'dora', password: PW });
  assert.equal((await dora.post('/api/account/delete', { password: PW })).json.reset, false);
  await bob2.post('/api/sync', { since: 0, changes: [entry('bob-letzter-001')] });
  const last = await bob2.post('/api/account/delete', { password: 'Bobs-Passwort-1' });
  assert.equal(last.status, 200); assert.equal(last.json.reset, true, 'das letzte Konto setzt den Server zurück');
  const anon2 = client(s2.base);
  assert.equal((await anon2.get('/api/config')).json.needsSetup, true);
  assert.equal((await bob2.get('/api/me')).status, 401);
  const code = lastToken(s2);
  const fresh = client(s2.base);
  assert.equal((await fresh.post('/api/setup', { secret: code, name: 'neu', password: PW })).status, 200, 'erstes Konto wird neu eingerichtet');
  const me = (await fresh.get('/api/me')).json.user;
  assert.equal(me.role, 'admin'); assert.equal(me.main, true); assert.ok(me.id > bobId, 'neue ID, keine Wiederverwendung');
  assert.equal((await fresh.post('/api/sync', { since: 0 })).json.changes.length, 0);
  assert.equal((await bob2.get('/api/me')).status, 401, 'alte Sitzung bleibt ungültig');
  await s2.stop();
});

test('Benutzerverwaltung: auch das ursprüngliche Hauptkonto lässt sich löschen (kein Sonderfall Konto 1)', async () => {
  const s = await start({ MULTIUSER: '1' });
  const jam = client(s.base), bob = client(s.base);
  await jam.post('/api/setup', { secret: s.token, name: 'jam', password: PW });
  await jam.post('/api/admin/users', { name: 'bob', password: PW, role: 'admin' });
  await bob.post('/api/login', { name: 'bob', password: PW });
  const r = await bob.del('/api/admin/users/1', { confirm: 'jam' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await bob.get('/api/admin/users')).json.users.length, 1);
  assert.equal((await jam.get('/api/me')).status, 401);
  await s.stop();
});

test('CLI: delete-user löscht ein Konto nach Bestätigung, aber nicht den letzten Admin und nicht das letzte Konto', async () => {
  const s = await start({ MULTIUSER: '1' });
  const jam = client(s.base), bob = client(s.base);
  await jam.post('/api/setup', { secret: s.token, name: 'jam', password: PW });
  await jam.post('/api/admin/users', { name: 'bob', password: PW });
  await bob.post('/api/login', { name: 'bob', password: PW });
  const env = { MULTIUSER: '1' };
  const cli = (input, ...a) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'server/cli.js'), ...a], { env: { ...process.env, ...env, DATA_DIR: s.dir }, input, encoding: 'utf8' });
  assert.match(cli('', 'delete-user', 'jam').stderr, /letzte Admin/);
  assert.match(cli('falsch\n', 'delete-user', 'bob').stderr, /Abgebrochen/);
  assert.equal((await bob.get('/api/me')).status, 200, 'abgebrochen: nichts gelöscht');
  const ok = cli('bob\n', 'delete-user', 'bob');
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal((await bob.get('/api/me')).status, 401, 'Sitzung ungültig');
  assert.match(cli('', 'delete-user', 'jam').stderr, /letzte Konto/);
  assert.match(cli('', 'delete-user', 'gibtsnicht').stderr, /nicht gefunden/);
  await s.stop();
});

test('Einzelnutzer ohne Konto 1: das Hauptkonto ist das mit der kleinsten ID (Umstellung von Mehrbenutzer zurück)', async () => {
  const m = await start({ MULTIUSER: '1' });
  const jam = client(m.base);
  await jam.post('/api/setup', { secret: m.token, name: 'jam', password: PW });
  await jam.post('/api/admin/users', { name: 'bob', password: 'Bobs-Passwort-1', role: 'admin' });
  assert.equal((await jam.post('/api/account/delete', { password: PW })).status, 200, 'Konto 1 gelöscht');
  await m.stop();
  const s = await start({ AUTH: '1' }, m.dir);
  const c = client(s.base);
  assert.equal(s.token, undefined, 'bob hat ein Passwort: nichts einzurichten');
  assert.equal((await c.get('/api/config')).json.needsSetup, false);
  assert.equal((await c.post('/api/login', { password: PW })).status, 401);
  assert.equal((await c.post('/api/login', { password: 'Bobs-Passwort-1' })).status, 200, 'bob (ID 2) ist jetzt das Hauptkonto');
  assert.equal((await c.get('/api/me')).status, 200);
  await s.stop();
});

// ---------------------------------------------------------------------------------------------
test('Vorläufiges Passwort (pwTemp): gesetzt beim Anlegen/Zurücksetzen durch den Admin, gelöscht nach eigener Änderung, nicht beim Einrichten', async () => {
  const s = await start({ MULTIUSER: '1' });
  const admin = client(s.base), bob = client(s.base);
  const cli = (...args) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'server/cli.js'), ...args], { env: { ...process.env, DATA_DIR: s.dir, MULTIUSER: '1' }, encoding: 'utf8' });
  const setup = await admin.post('/api/setup', { secret: s.token, name: 'chef', password: PW });
  assert.equal(setup.json.pwTemp, false, 'Einrichtungskonto des Admins: kein vorläufiges Passwort');
  assert.equal((await admin.get('/api/me')).json.pwTemp, false);

  // Admin legt ein Konto an: vorläufig, in Anmeldung und /api/me sichtbar
  assert.equal((await admin.post('/api/admin/users', { name: 'bob', password: 'Start-Passwort-1' })).status, 200);
  const login = await bob.post('/api/login', { name: 'bob', password: 'Start-Passwort-1' });
  assert.equal(login.json.pwTemp, true);
  assert.equal((await bob.get('/api/me')).json.pwTemp, true);
  assert.equal((await admin.get('/api/me')).json.pwTemp, false, 'das Konto des Admins bleibt unberührt');

  // falsches aktuelles Passwort ändert nichts; eigenes Ändern löscht das Merkzeichen
  assert.equal((await bob.post('/api/account/password', { current: 'falsch-falsch', next: 'Eigenes-Passwort-1' })).status, 401);
  assert.equal((await bob.get('/api/me')).json.pwTemp, true);
  assert.equal((await bob.post('/api/account/password', { current: 'Start-Passwort-1', next: 'Eigenes-Passwort-1' })).status, 200);
  assert.equal((await bob.get('/api/me')).json.pwTemp, false);
  assert.equal((await client(s.base).post('/api/login', { name: 'bob', password: 'Eigenes-Passwort-1' })).json.pwTemp, false);

  // Admin setzt Bobs Passwort zurück: wieder vorläufig
  const bobId = (await admin.get('/api/admin/users')).json.users.find((u) => u.name === 'bob').id;
  assert.equal((await admin.post(`/api/admin/users/${bobId}`, { password: 'Reset-Passwort-12' })).status, 200);
  const again = client(s.base);
  assert.equal((await again.post('/api/login', { name: 'bob', password: 'Reset-Passwort-12' })).json.pwTemp, true);
  await again.post('/api/account/password', { current: 'Reset-Passwort-12', next: 'Wieder-Eigenes-1' });
  assert.equal((await again.get('/api/me')).json.pwTemp, false);

  // Ändert der Admin sein eigenes Passwort über die Benutzerverwaltung, ist es nicht vorläufig; ein Rollenwechsel allein setzt nichts
  const adminId = (await admin.get('/api/admin/users')).json.users.find((u) => u.name === 'chef').id;
  assert.equal((await admin.post(`/api/admin/users/${adminId}`, { password: 'Neues-Admin-Pw-1' })).status, 200);
  assert.equal((await client(s.base).post('/api/login', { name: 'chef', password: 'Neues-Admin-Pw-1' })).json.pwTemp, false);
  await admin.post(`/api/admin/users/${bobId}`, { role: 'user' });
  assert.equal((await again.get('/api/me')).json.pwTemp, false);

  // CLI: Zurücksetzen im Mehrbenutzer-Betrieb ist ebenfalls vorläufig
  assert.equal(cli('reset-password', 'bob', 'Per-CLI-Passwort-1').status, 0);
  const viaCli = client(s.base);
  assert.equal((await viaCli.post('/api/login', { name: 'bob', password: 'Per-CLI-Passwort-1' })).json.pwTemp, true);
  await s.stop();
});

test('Vorläufiges Passwort: Einzelnutzer-Betrieb kennt es nicht; ältere Datenbank ohne Spalte pw_temp wird ergänzt', async () => {
  const single = await start({ AUTH: '1' });
  const a = client(single.base);
  assert.equal((await a.post('/api/setup', { secret: single.token, password: PW })).json.pwTemp, false);
  const cli = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'server/cli.js'), 'reset-password', 'Per-CLI-Passwort-1'], { env: { ...process.env, DATA_DIR: single.dir }, encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal((await client(single.base).post('/api/login', { password: 'Per-CLI-Passwort-1' })).json.pwTemp, false, 'Einzelnutzer: nie vorläufig');
  await single.stop();

  const s = await start({ MULTIUSER: '1' });
  const admin = client(s.base);
  await admin.post('/api/setup', { secret: s.token, name: 'chef', password: PW });
  await s.stop();
  await new Promise((r) => setTimeout(r, 300));
  const db = new DatabaseSync(path.join(s.dir, 'gutkeeper.db'));
  db.exec('ALTER TABLE users DROP COLUMN pw_temp'); // Stand vor dieser Änderung
  db.close();
  const m = await start({ MULTIUSER: '1' }, s.dir);
  const c = client(m.base), bob = client(m.base);
  assert.equal((await c.post('/api/login', { name: 'chef', password: PW })).json.pwTemp, false);
  assert.equal((await c.post('/api/admin/users', { name: 'bob', password: 'Start-Passwort-1' })).status, 200);
  assert.equal((await bob.post('/api/login', { name: 'bob', password: 'Start-Passwort-1' })).json.pwTemp, true);
  await m.stop();
});

// ---------------------------------------------------------------------------------------------
test('Härtung: kein 500 bei Nicht-Objekt-Bodies, Namen und %00; __proto__-IDs und PBKDF2-Grenzen', async () => {
  const s = await start();
  const post = (url, body) => fetch(s.base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  for (const url of ['/api/sync', '/api/restore', '/api/admin/backup-download', '/api/settings', '/api/admin/export']) {
    for (const body of ['null', '[]', '5', '"x"']) assert.equal((await post(url, body)).status, 400, `${url} ${body}`);
  }
  assert.equal((await post('/api/restore', '{"name":{"a":1}}')).status, 400, 'Name kein String');
  assert.equal((await post('/api/admin/backup-download', '{"name":["x"]}')).status, 400);
  assert.equal((await fetch(s.base + '/%00')).status, 404, '%00 im Pfad');
  assert.equal((await fetch(s.base + '/api/backups/%00')).status, 404);
  assert.equal((await fetch(s.base + '/%2e%2e/%00x.js')).status < 500, true);

  // __proto__ & Co. als ID werden verworfen, der Rest der Anfrage geht durch
  const r = await post('/api/sync', JSON.stringify({ since: 0, changes: [entry('__proto__'), entry('constructor'), entry('prototype'), entry('gueltig-0001')], foodChanges: [food('__proto__', 'x')] }));
  assert.equal(r.status, 200);
  const list = await (await fetch(s.base + '/api/entries?from=2000-01-01&to=2999-12-31')).json();
  assert.deepEqual(list.entries.map((e) => e.id), ['gueltig-0001']);
  assert.deepEqual((await (await fetch(s.base + '/api/foods')).json()).foods, []);

  // PBKDF2-Runden aus der Datei
  const w = await wrap(Buffer.from('x'), 'pw12345678', 'json');
  for (const iter of [1e9, 10, -5, '600000', 5000001]) await assert.rejects(() => unwrap({ ...w, iter }, 'pw12345678'), /Runden/, String(iter));
  assert.equal((await unwrap(w, 'pw12345678')).toString(), 'x');
  await s.stop();
});

test('Härtung: Login/Einrichtung mit Nicht-Objekt-Body liefern 400, CSV-Export entschärft Formeln', async () => {
  const s = await start({ AUTH: '1' });
  const post = (url, body) => fetch(s.base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  for (const body of ['null', '[]', '7']) assert.equal((await post('/api/setup', body)).status, 400, 'setup ' + body);
  const c = client(s.base);
  assert.equal((await c.post('/api/setup', { secret: s.token, password: PW })).status, 200);
  for (const body of ['null', '[]', '7']) assert.equal((await post('/api/login', body)).status, 400, 'login ' + body);
  assert.equal((await c.post('/api/sync', { since: 0, changes: [entry('csv-test-0001', { note: '=1+1' }), entry('csv-test-0002', { note: '-3', time: '09:00' }), entry('csv-test-0003', { note: 'ok', time: '10:00' })] })).status, 200);
  const rows = (await c.get('/api/export.csv')).text.trim().split('\n').slice(1).map((l) => l.split(';').pop());
  assert.deepEqual(rows, ["'=1+1", '-3', 'ok']);
  await s.stop();
});

test('Service Worker: Cache-Name aus App-Version und Datei-Hash, ändert sich mit jeder Datei', async () => {
  const swcache = require('../server/swcache');
  const version = require('../package.json').version;
  const s = await start();
  const r = await fetch(s.base + '/sw.js'), body = await r.text();
  assert.equal(r.status, 200);
  assert.ok(!body.includes(swcache.PLACEHOLDER), 'Platzhalter wurde nicht ersetzt');
  assert.match(body, new RegExp(`const CACHE = 'gutkeeper-${version.replaceAll('.', '\\.')}-[0-9a-f]{8}'`));
  assert.equal(await (await fetch(s.base + '/sw.js')).text(), body, 'gleiche Dateien, gleicher Name');
  await s.stop();
  // anderer Inhalt einer Datei → anderer Name; './' zählt nicht doppelt
  const sw = "const CACHE = 'x-__CACHE_VERSION__';\nconst SHELL = [\n  './', 'a.js', 'js/b.js',\n];";
  assert.deepEqual(swcache.shellOf(sw), ['a.js', 'js/b.js']);
  const a = swcache.fillSw(sw, '1.0.0', (p) => p + '1'), b = swcache.fillSw(sw, '1.0.0', (p) => (p === 'js/b.js' ? 'neu' : p + '1'));
  assert.match(a, /'x-1\.0\.0-[0-9a-f]{8}'/);
  assert.notEqual(a, b);
});
