// Tests für die automatischen Backups (autobackup.js): Verschlüsselung mit Passwort, Zeitplan, eigene Werte
// Aufruf: npm test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const src = (f) => fs.readFileSync(path.join(ROOT, 'public/js', f), 'utf8');
const load = (code) => import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const { unwrap } = require('../server/crypto-wrap.js');

// autobackup.js mit Attrappen für Oberfläche, Speicher und das native Dateisystem-Plugin laden
let run = 0;
async function setup({ vaultMode = 'idb', noKey = false, lang = 'de' } = {}) {
  const cipher = await load(src('cipher.js'));
  const mem = new Map(), files = new Map(), calls = [];
  let key = null;
  Object.assign(globalThis, {
    __lang: lang, __cipher: cipher, __mem: mem, __files: files, __calls: calls,
    __fs: {
      writeFile: async (o) => { files.set(o.path.split('/').pop(), o.data); calls.push(['write', o.path]); },
      readdir: async () => ({ files: [...files.keys()].map((name) => ({ name })) }),
      deleteFile: async (o) => { files.delete(o.path.split('/').pop()); calls.push(['delete', o.path]); },
      requestPermissions: async () => ({}),
    },
    __vault: {
      mode: vaultMode,
      getBackupKey: async () => (noKey ? null : key),
      setBackupKey: async (k) => { if (vaultMode === 'plain') throw new Error('unsupported'); key = k; },
      clearBackupKey: async () => { key = null; },
    },
  });
  const head = `const DEV = { get: (k, d) => (__mem.has(k) ? JSON.parse(__mem.get(k)) : d), set: (k, v) => __mem.set(k, JSON.stringify(v)) };
const LS = DEV, isEn = __lang === 'en', fileBase = () => 'gutkeeper', stampStr = () => '2026-01-01_0000', todayStr = () => '2026-01-01';
const { deriveWrapKey, wrapTextKey } = __cipher, t = (s) => s, plugin = () => __fs, S = { standalone: true, locked: false };
const activeEntries = () => [1], backupData = () => ({ entries: [{ id: 'e1', note: 'geheim' }] }), exportJson = () => '', toast = () => {}, vault = __vault;
const backupAge = () => null, backupDue = () => false;`;
  const code = src('autobackup.js').split('\n').filter((l) => !l.startsWith('import ')).join('\n');
  const mod = await load(`${head}\n${code}\n// Lauf ${++run}`); // eindeutiger Text, sonst nimmt Node das Modul aus dem Zwischenspeicher
  return { mod, files, calls, mem };
}

test('Auto-Backup mit Passwort: jede Datei ist verschlüsselt und lässt sich mit dem Passwort öffnen', async () => {
  const { mod, files } = await setup();
  mod.setAutoDays(1);
  await mod.setAutoPassword('geheim-1234');
  assert.equal(await mod.runAutoBackup(true), true);
  assert.equal(files.size, 1);
  const [name, data] = [...files][0];
  assert.match(name, /-enc\.json$/);
  assert.ok(!data.includes('geheim"') && !data.includes('"entries"'), 'kein Klartext in der Datei');
  const w = JSON.parse(data);
  assert.equal(w.gutkeeper, 'encrypted');
  assert.equal(JSON.parse((await unwrap(w, 'geheim-1234')).toString('utf8')).entries[0].note, 'geheim');
  await assert.rejects(() => unwrap(w, 'falsch'));
});

test('Passwort nach dem ersten Backup: sofort neues verschlüsseltes Backup fällig, Klartext-Dateien verschwinden', async () => {
  const { mod, files, calls } = await setup();
  mod.setAutoDays(7);
  assert.equal(await mod.runAutoBackup(true), true); // erstes Backup noch ohne Passwort
  assert.ok([...files.keys()].every((n) => !n.endsWith('-enc.json')));
  assert.equal(await mod.runAutoBackup(), null, 'ohne Passwort: erst in einer Woche wieder fällig');
  await mod.setAutoPassword('geheim-1234');
  assert.equal(await mod.runAutoBackup(), true, 'nach dem Festlegen des Passworts ist sofort ein Backup fällig');
  assert.deepEqual([...files.keys()].filter((n) => !n.endsWith('-enc.json')), [], 'keine lesbaren Alt-Dateien');
  assert.ok(calls.some((c) => c[0] === 'delete'));
});

test('Auto-Backup: fehlt der Schlüssel, wird nichts (auch nicht unverschlüsselt) geschrieben', async () => {
  const { mod, files, calls } = await setup({ noKey: true });
  mod.setAutoDays(1);
  await mod.setAutoPassword('geheim-1234');
  assert.equal(await mod.runAutoBackup(true), false);
  assert.equal(files.size, 0);
  assert.ok(!calls.some((c) => c[0] === 'write'));
  assert.equal(mod.autoState().ok, false);
  assert.match(mod.autoState().error, /Passwort fehlt/);
});

test('Auto-Backup: ohne sicheren Speicher lässt sich kein Passwort festlegen', async () => {
  const { mod } = await setup({ vaultMode: 'plain' });
  assert.equal(mod.autoEncAvailable(), false);
  await assert.rejects(() => mod.setAutoPassword('geheim-1234'));
  assert.equal(mod.autoEncrypted(), false);
});

test('Eigene Anzahl und eigenes Intervall: Eingabe prüfen, speichern, ungültige Werte fallen zurück', async () => {
  const { mod, mem } = await setup();
  assert.equal(mod.parseWhole(' 30 ', 365), 30);
  for (const bad of ['0', '366', '-1', '1.5', 'abc', '', '1e2', null]) assert.equal(mod.parseWhole(bad, 365), null, String(bad));
  assert.equal(mod.autoKeep(), 5);
  mod.setAutoKeep(42); assert.equal(mod.autoKeep(), 42); assert.equal(mod.isCustomKeep(), true);
  mod.setAutoKeep(10); assert.equal(mod.isCustomKeep(), false);
  mem.set('autoBkKeep', '9999'); assert.equal(mod.autoKeep(), 5);
  mod.setAutoDays(3); assert.equal(mod.autoDays(), 3); assert.equal(mod.isCustomDays(), true);
  mod.setAutoDays(7); assert.equal(mod.isCustomDays(), false);
  mod.setAutoDays(0); assert.equal(mod.autoDays(), 0); assert.equal(mod.isCustomDays(), false);
});

test('Auto-Backup: behält nur die eingestellte (eigene) Anzahl', async () => {
  const { mod, files } = await setup();
  mod.setAutoDays(1); mod.setAutoKeep(2);
  for (const n of ['a', 'b', 'c']) files.set(`gutkeeper-auto-2025-01-0${n === 'a' ? 1 : n === 'b' ? 2 : 3}_0000.json`, '{}');
  assert.equal(await mod.runAutoBackup(true), true);
  assert.equal(files.size, 2);
});

test('Ordner und Dateiname sind unabhängig von der Sprache', async () => {
  for (const lang of ['en', 'de']) {
    const { mod, calls } = await setup({ lang });
    assert.equal(mod.autoFolder(), 'GutKeeper');
    assert.equal(await mod.runAutoBackup(true), true);
    assert.deepEqual(calls[0], ['write', 'GutKeeper/gutkeeper-auto-2026-01-01_0000.json']);
  }
});

test('Rotation sortiert nach Zeitstempel und lässt fremde Dateien liegen', async () => {
  const { mod, files } = await setup({ lang: 'en' });
  mod.setAutoKeep(2);
  files.set('gutkeeper-auto-2025-01-01_0000.json', '{}');
  files.set('gutkeeper-auto-2025-01-02_0000.json', '{}');
  files.set('notiz.json', '{}');
  assert.equal(await mod.plainAutoCount(), 2);
  assert.equal(await mod.runAutoBackup(true), true);
  assert.deepEqual([...files.keys()].sort(), ['gutkeeper-auto-2025-01-02_0000.json', 'gutkeeper-auto-2026-01-01_0000.json', 'notiz.json']);
});
