// Server-Backups: SQLite-Kopien in data/backups bzw. BACKUP_DIR (automatisch im Abstand BACKUP_INTERVAL_HOURS, manuell, wiederherstellbar).
// Ein Backup enthält die Daten ALLER Konten; Verwalten dürfen es nur Admins (siehe index.js).
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { BACKUP_KEEP, BACKUP_INTERVAL_HOURS, BACKUP_PASSWORD } = require('./config');
const { wrap, unwrap } = require('./crypto-wrap');
const log = require('./log');
const { db, BACKUP_DIR, U, clean, cleanFood, q, qf } = require('./db');

const BACKUP_RE = /^gutkeeper-[\w-]+\.db(\.enc\.json)?$/; // „.enc.json“: mit BACKUP_PASSWORD verschlüsselt
const isEnc = (name) => name.endsWith('.enc.json');
const AUTO_RE = /-auto\.db(\.enc\.json)?$/;
const p2 = (n) => String(n).padStart(2, '0');
const stamp = () => {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
};
const fileOf = (name) => path.join(BACKUP_DIR, name);
const exists = (name) => BACKUP_RE.test(String(name)) && fs.existsSync(fileOf(name));

function listBackups() {
  return fs.readdirSync(BACKUP_DIR).filter((f) => BACKUP_RE.test(f)).map((f) => {
    const st = fs.statSync(fileOf(f));
    return { name: f, size: st.size, mtime: Math.round(st.mtimeMs) };
  }).sort((a, b) => b.mtime - a.mtime);
}

function countOf(file) { // Einträge insgesamt (alle Konten)
  try {
    const s = new DatabaseSync(file, { readOnly: true });
    const c = s.prepare('SELECT COUNT(*) AS c FROM entries WHERE deleted = 0').get().c;
    s.close();
    return c;
  } catch { return null; }
}

const listWithCounts = () => listBackups().map((b) => ({ ...b, count: isEnc(b.name) ? null : countOf(fileOf(b.name)), encrypted: isEnc(b.name) }));

async function makeBackup(tag) {
  const ext = BACKUP_PASSWORD ? '.enc.json' : '';
  let plain = `gutkeeper-${stamp()}-${tag}.db`;
  for (let n = 2; fs.existsSync(fileOf(plain + ext)); n++) plain = `gutkeeper-${stamp()}-${n}-${tag}.db`; // gleiche Sekunde: Zähler vor dem Typ einfügen (Endung „-auto.db“ usw. bleibt erhalten)
  const name = plain + ext;
  {
    const tmp = fileOf(plain + '.tmp'); // passt nicht auf BACKUP_RE, taucht also in keiner Liste auf
    fs.rmSync(tmp, { force: true });
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    try {
      if (BACKUP_PASSWORD) fs.writeFileSync(fileOf(name), JSON.stringify(await wrap(fs.readFileSync(tmp), BACKUP_PASSWORD, 'db')));
      else fs.renameSync(tmp, fileOf(name));
    } finally { fs.rmSync(tmp, { force: true }); }
  }
  for (const x of listBackups().slice(BACKUP_KEEP)) fs.rmSync(fileOf(x.name), { force: true });
  return name;
}

async function dailyBackup() {
  try {
    if (!q.countAllUsers.get().c) return;
    const autos = listBackups().filter((b) => AUTO_RE.test(b.name));
    if (BACKUP_INTERVAL_HOURS >= 24) { // einmal pro Kalendertag
      if (autos.some((b) => b.name.includes(stamp().slice(0, 10)))) return;
    } else if (autos.length && Date.now() - autos[0].mtime < BACKUP_INTERVAL_HOURS * 3600 * 1000) return;
    await makeBackup('auto');
  } catch (err) { log.error('Backup fehlgeschlagen:', 'Backup failed:', err); }
}

function removeBackup(name) { fs.rmSync(fileOf(name), { force: true }); }
const readBackup = (name) => fs.readFileSync(fileOf(name));

// Die Daten EINES Kontos aus einem Backup zurückspielen (andere Konten bleiben unberührt).
// Backups aus Versionen ohne Konten enthalten keine Kontoangabe: dann gehören alle Zeilen dem Zielkonto.
async function restore(name, uid) {
  let file = fileOf(name), tmpDir = null;
  if (isEnc(name)) { // verschlüsseltes Backup: mit BACKUP_PASSWORD in eine temporäre Datei entschlüsseln
    if (!BACKUP_PASSWORD) return { error: 'password' };
    try {
      const buf = await unwrap(JSON.parse(fs.readFileSync(file, 'utf8')), BACKUP_PASSWORD);
      tmpDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dp-restore-'));
      file = path.join(tmpDir, 'restore.db');
      fs.writeFileSync(file, buf);
    } catch { return { error: 'password' }; } // falsches Passwort oder beschädigte Datei
  }
  try { return await restoreFrom(file, uid); } finally { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); }
}

async function restoreFrom(file, uid) {
  const src = new DatabaseSync(file, { readOnly: true });
  let rows, foodRows = null; // foodRows = null: Backup ohne Essens-Tabelle, die Daten des Zielkontos bleiben dann erhalten
  try {
    const has = (t) => !!src.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
    const hasUser = (t) => src.prepare(`PRAGMA table_info(${t})`).all().some((c) => c.name === 'user_id');
    if (!has('entries')) return { error: 'format' }; // keine GutKeeper-Datenbank
    // Alte Backups ohne Konten (ohne user_id) gehören komplett dem Zielkonto; fehlende Spalten ergänzen clean()/cleanFood()
    rows = hasUser('entries') ? src.prepare('SELECT * FROM entries WHERE user_id = ?').all(uid) : src.prepare('SELECT * FROM entries').all();
    if (has('foods')) foodRows = hasUser('foods') ? src.prepare('SELECT * FROM foods WHERE user_id = ?').all(uid) : src.prepare('SELECT * FROM foods').all();
  } finally { src.close(); }
  // Backups gehören zu dem Modus, in dem sie entstanden sind: Klartext-Zeilen passen nicht in ein verschlüsseltes Konto und umgekehrt
  const target = U.byId(uid), want = !!(target && target.e2ee);
  if (rows.some((r) => !!r.blob !== want) || (foodRows && foodRows.some((r) => !!r.blob !== want))) return { error: 'mode' };
  if (!rows.length) return { error: 'no-data' }; // nichts für dieses Konto im Backup: nicht versehentlich leeren
  await makeBackup('vor-restore'); // Sicherungspunkt vom aktuellen Stand
  db.exec('BEGIN');
  try {
    q.wipe.run(uid);
    let seq = 0, count = 0;
    for (const r of rows) {
      const e = clean(r);
      if (!e) continue;
      q.upsert.run({ user_id: uid, ...e, seq: ++seq });
      count++;
    }
    if (foodRows) {
      qf.wipe.run(uid);
      let fseq = 0;
      for (const r of foodRows) { const f = cleanFood(r); if (f) qf.upsert.run({ user_id: uid, ...f, seq: ++fseq }); }
    }
    const epoch = U.rotateEpoch(uid);
    db.exec('COMMIT');
    return { epoch, count };
  } catch (err) { db.exec('ROLLBACK'); throw err; }
}

module.exports = { exists, listBackups, listWithCounts, makeBackup, dailyBackup, removeBackup, readBackup, restore, BACKUP_KEEP };
