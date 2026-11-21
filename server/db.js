// SQLite-Datenbank (node:sqlite): Schema (mit Konten), Validierung, Abfragen
// Alle Abfragen auf Einträge und Essen sind nach Konto (user_id) getrennt; ein Test prüft das für jede SQL-Zeile.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { DATA_DIR, BACKUP_DIR: BACKUP_DIR_CFG } = require('./config');
const log = require('./log');
// Eigener Backup-Ordner (BACKUP_DIR, im Docker-Image /backups): fehlt er bzw. ist er nicht beschreibbar (z. B. kein Volume
// eingehängt bei schreibgeschütztem Container), nicht abstürzen, sondern mit Warnung auf data/backups ausweichen
const FALLBACK_DIR = path.join(DATA_DIR, 'backups');
function backupDir() {
  if (BACKUP_DIR_CFG) {
    try { fs.mkdirSync(BACKUP_DIR_CFG, { recursive: true }); fs.accessSync(BACKUP_DIR_CFG, fs.constants.W_OK); return BACKUP_DIR_CFG; } catch (e) {
      log.warn(`[backup] Ordner ${BACKUP_DIR_CFG} nicht nutzbar (${e.code || e.message}), Backups landen in ${FALLBACK_DIR}. Volume für ${BACKUP_DIR_CFG} einhängen (siehe compose/all-options.yml) oder BACKUP_DIR weglassen.`,
        `[backup] Folder ${BACKUP_DIR_CFG} not usable (${e.code || e.message}), backups go to ${FALLBACK_DIR}. Mount a volume for ${BACKUP_DIR_CFG} (see compose/all-options.yml) or leave BACKUP_DIR unset.`);
    }
  }
  fs.mkdirSync(FALLBACK_DIR, { recursive: true });
  return FALLBACK_DIR;
}
const BACKUP_DIR = backupDir();
const DB_PATH = path.join(DATA_DIR, 'gutkeeper.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
const newEpoch = () => crypto.randomBytes(8).toString('hex');
// blob = verschlüsselter Inhalt bei aktiver Ende-zu-Ende-Verschlüsselung (sonst leer); die übrigen Felder sind dann neutral
const ENTRY_COLS = ['id', 'date', 'time', 'consistency', 'urge', 'amount', 'blood', 'pain', 'mucus', 'luft', 'note', 'color', 'updated_at', 'deleted', 'seq', 'blob'];
const FOOD_COLS = ['id', 'date', 'time', 'meal', 'text', 'updated_at', 'deleted', 'seq', 'blob'];

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
      pass       TEXT NOT NULL DEFAULT '',   -- scrypt-Hash; leer = Hauptkonto, das noch eingerichtet werden muss
      role       TEXT NOT NULL DEFAULT 'user', -- admin | user
      disabled   INTEGER NOT NULL DEFAULT 0,
      food       INTEGER,                    -- „Essen aufzeichnen“: NULL = Voreinstellung (FOOD_DEFAULT)
      epoch      TEXT NOT NULL,              -- ändert sich bei „Alle Daten löschen“/Wiederherstellen dieses Kontos
      token_ver  INTEGER NOT NULL DEFAULT 1, -- erhöhen = alle Sitzungen dieses Kontos ungültig
      e2ee       INTEGER NOT NULL DEFAULT 0, -- 1 = Einträge liegen nur verschlüsselt auf dem Server
      e2ee_key   TEXT NOT NULL DEFAULT '',   -- mit dem Wiederherstellungscode verpackter Datenschlüssel (für den Server nicht lesbar)
      pw_temp    INTEGER NOT NULL DEFAULT 0, -- 1 = Passwort vom Admin vergeben bzw. zurückgesetzt (der Admin kennt es); die App fordert zum Ändern auf
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS entries (
      user_id     INTEGER NOT NULL,
      id          TEXT NOT NULL,
      date        TEXT NOT NULL,      -- YYYY-MM-DD
      time        TEXT NOT NULL,      -- HH:MM
      consistency INTEGER NOT NULL,   -- Bristol 1-7, 0 = kein Stuhl (z. B. nur Luft)
      urge        INTEGER NOT NULL,   -- 0-3
      amount      INTEGER NOT NULL,   -- 1-3, 0 = kein Stuhl
      blood       INTEGER NOT NULL,   -- 0/1
      pain        INTEGER NOT NULL DEFAULT 0, -- Schmerzen/Krämpfe 0-3
      mucus       INTEGER NOT NULL DEFAULT 0, -- Schleim 0/1
      luft        INTEGER NOT NULL DEFAULT 0, -- Luft 0/1
      note        TEXT NOT NULL DEFAULT '',   -- Notiz (max. 300 Zeichen)
      color       INTEGER NOT NULL DEFAULT 0, -- 0 unbekannt, 1 braun, 2 hell, 3 gelb, 4 grün, 5 schwarz, 6 rot
      updated_at  INTEGER NOT NULL,   -- ms, vom Gerät gesetzt (neuester Stand gewinnt)
      deleted     INTEGER NOT NULL DEFAULT 0,
      seq         INTEGER NOT NULL,   -- Änderungszähler (je Konto) für die Synchronisation
      blob        TEXT NOT NULL DEFAULT '',   -- verschlüsselter Inhalt (Ende-zu-Ende-Verschlüsselung), sonst leer
      PRIMARY KEY (user_id, id)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS idx_entries_user_seq ON entries(user_id, seq);
    CREATE INDEX IF NOT EXISTS idx_entries_user_date ON entries(user_id, date, time);
    -- Essen: eigene Tabelle in derselben Datei (gemeinsame Backups), unabhängig von den Stuhl-Einträgen
    CREATE TABLE IF NOT EXISTS foods (
      user_id    INTEGER NOT NULL,
      id         TEXT NOT NULL,
      date       TEXT NOT NULL,
      time       TEXT NOT NULL,
      meal       INTEGER NOT NULL DEFAULT 0, -- 0 ohne Angabe, 1 Frühstück, 2 Mittagessen, 3 Abendessen, 4 Snack, 5 Getränk
      text       TEXT NOT NULL DEFAULT '',   -- grobe Beschreibung (max. 200 Zeichen)
      updated_at INTEGER NOT NULL,
      deleted    INTEGER NOT NULL DEFAULT 0,
      seq        INTEGER NOT NULL,
      blob       TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (user_id, id)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS idx_foods_user_seq ON foods(user_id, seq);
  `);
}

// Es gibt immer mindestens ein Konto: das Hauptkonto (das mit der kleinsten ID). Es ist im Einzelnutzer-Betrieb unsichtbar (nur Passwort)
// und wird bei MULTIUSER=1 beim Einrichten zum ersten Admin. Solange es nur den Platzhalter (Name „_owner“, kein Passwort) gibt, ist die
// Einrichtung offen. Auf die ID 1 verlässt sich nichts: Das Hauptkonto kann gelöscht werden, dann zählt das nächste.
const PLACEHOLDER = '_owner';
function ensureOwner() {
  if (db.prepare('SELECT 1 FROM users LIMIT 1').get()) return;
  db.prepare("INSERT INTO users (name, pass, role, disabled, food, epoch, token_ver, created_at) VALUES (?, '', 'admin', 0, NULL, ?, 1, ?)").run(PLACEHOLDER, newEpoch(), Date.now());
}

// Ältere Datenbanken haben die Spalte pw_temp noch nicht (CREATE TABLE IF NOT EXISTS ergänzt sie nicht): einmalig nachrüsten
function addMissingColumns() {
  if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'pw_temp')) db.exec('ALTER TABLE users ADD COLUMN pw_temp INTEGER NOT NULL DEFAULT 0');
}

createTables();
addMissingColumns();
ensureOwner();
db.exec('PRAGMA user_version = 1;');

// ---- Konten ----
const prep = (sql) => db.prepare(sql);
const uq = {
  byId: prep('SELECT * FROM users WHERE id = ?'),
  byName: prep('SELECT * FROM users WHERE name = ?'),
  all: prep('SELECT id, name, role, disabled, food, created_at FROM users ORDER BY id'),
  insert: prep("INSERT INTO users (name, pass, role, disabled, food, epoch, token_ver, created_at, pw_temp) VALUES (?, ?, ?, 0, NULL, ?, 1, ?, ?)"),
  first: prep('SELECT * FROM users ORDER BY id LIMIT 1'),
  count: prep('SELECT COUNT(*) AS c FROM users'),
  named: prep("SELECT 1 FROM users WHERE pass != '' AND name != '_owner' LIMIT 1"), // gibt es ein eingerichtetes Konto mit eigenem Namen?
  pending: prep("SELECT id FROM users WHERE pass = '' OR name = '_owner' ORDER BY id LIMIT 1"), // Platzhalter, der noch eingerichtet werden muss
  claim: prep("UPDATE users SET name = ?, pass = ?, role = 'admin', disabled = 0, pw_temp = 0, token_ver = token_ver + 1 WHERE id = ?"),
  resetOwner: prep("UPDATE users SET name = '_owner', pass = '', role = 'admin', disabled = 0, pw_temp = 0, food = NULL, epoch = ?, token_ver = token_ver + 1, e2ee = 0, e2ee_key = '' WHERE id = ?"),
  insertPlaceholder: prep("INSERT INTO users (name, pass, role, disabled, food, epoch, token_ver, created_at) VALUES ('_owner', '', 'admin', 0, NULL, ?, 1, ?)"),
  setRole: prep('UPDATE users SET role = ? WHERE id = ?'),
  setDisabled: prep('UPDATE users SET disabled = ?, token_ver = token_ver + 1 WHERE id = ?'),
  setPass: prep('UPDATE users SET pass = ?, pw_temp = ?, token_ver = token_ver + 1 WHERE id = ?'),
  setFood: prep('UPDATE users SET food = ? WHERE id = ?'),
  bumpTokenVer: prep('UPDATE users SET token_ver = token_ver + 1 WHERE id = ?'),
  setE2ee: prep('UPDATE users SET e2ee = ?, e2ee_key = ? WHERE id = ?'),
  setEpoch: prep('UPDATE users SET epoch = ? WHERE id = ?'),
  admins: prep("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND disabled = 0"),
  del: prep('DELETE FROM users WHERE id = ?'),
};
const U = {
  byId: (id) => uq.byId.get(id),
  byName: (name) => uq.byName.get(String(name)),
  all: () => uq.all.all(),
  create: (name, pass, role, temp = false) => Number(uq.insert.run(name, pass, role, newEpoch(), Date.now(), temp ? 1 : 0).lastInsertRowid),
  owner: () => uq.first.get(), // Hauptkonto: das mit der kleinsten ID (Einzelnutzer-Betrieb: das einzige Konto)
  count: () => uq.count.get().c,
  hasNamed: () => !!uq.named.get(),
  // Einrichtung: den Platzhalter (bzw. im Notfall ein neues Konto) zum ersten Admin machen. Gibt die ID zurück, bei einem schon vergebenen Namen null.
  claimOwner: (name, pass) => {
    const p = uq.pending.get();
    try {
      if (p) { uq.claim.run(name, pass, p.id); return p.id; }
      return Number(uq.insert.run(name, pass, 'admin', newEpoch(), Date.now(), 0).lastInsertRowid);
    } catch { return null; }
  },
  setRole: (id, role) => uq.setRole.run(role, id),
  setDisabled: (id, v) => uq.setDisabled.run(v ? 1 : 0, id),
  setPass: (id, pass, temp = false) => uq.setPass.run(pass, temp ? 1 : 0, id), // temp: vom Admin vergeben (true) oder selbst gewählt (false)
  bumpTokenVer: (id) => uq.bumpTokenVer.run(id),
  setFood: (id, v) => uq.setFood.run(v ? 1 : 0, id),
  setE2ee: (id, on, key) => uq.setE2ee.run(on ? 1 : 0, on ? String(key) : '', id),
  rotateEpoch: (id) => { const e = newEpoch(); uq.setEpoch.run(e, id); return e; },
  activeAdmins: () => uq.admins.get().c,
};

// ---- Validierung ----
const int = (v, min, max, def) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : def;
};
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RE_TIME = /^\d{2}:\d{2}$/;
const RE_BLOB = /^[A-Za-z0-9_-]{16,6000}$/;
const blobOf = (e) => (typeof e.blob === 'string' && RE_BLOB.test(e.blob) ? e.blob : '');

// Geräte mit falscher Uhr: Zeitstempel aus der Zukunft würden „neuester Stand gewinnt“ dauerhaft für sich entscheiden
const FUTURE_TOLERANCE_MS = 10 * 60 * 1000;
const stamp = (v) => Math.min(int(v, 0, Number.MAX_SAFE_INTEGER, Date.now()), Date.now() + FUTURE_TOLERANCE_MS);

// Namen, die in einfachen Objekten (id → Zeile) Ärger machen würden
const RESERVED_IDS = new Set(['__proto__', 'constructor', 'prototype']);

function clean(e) {
  if (!e || typeof e.id !== 'string' || e.id.length < 8 || e.id.length > 64 || RESERVED_IDS.has(e.id)) return null;
  if (!RE_DATE.test(e.date) || !RE_TIME.test(e.time)) return null;
  const blob = blobOf(e);
  if (blob) { // verschlüsselt: der Server behält nur den Monat, alle anderen Felder werden neutralisiert
    return {
      id: e.id, date: e.date.slice(0, 8) + '01', time: '00:00', consistency: 0, urge: 0, amount: 0, blood: 0, pain: 0, mucus: 0, luft: 0, color: 0, note: '', blob,
      updated_at: stamp(e.updated_at), deleted: int(e.deleted, 0, 1, 0),
    };
  }
  return {
    id: e.id, date: e.date, time: e.time, blob: '',
    consistency: int(e.consistency, 0, 7, 0),
    urge: int(e.urge, 0, 3, 1),
    amount: int(e.amount, 0, 3, 2),
    blood: int(e.blood, 0, 1, 0),
    pain: int(e.pain, 0, 3, 0),
    mucus: int(e.mucus, 0, 1, 0),
    luft: int(e.luft, 0, 1, 0),
    color: int(e.color, 0, 6, 0),
    note: typeof e.note === 'string' ? e.note.replace(/\s+/g, ' ').trim().slice(0, 300) : '',
    updated_at: stamp(e.updated_at),
    deleted: int(e.deleted, 0, 1, 0),
  };
}

function cleanFood(e) {
  if (!e || typeof e.id !== 'string' || e.id.length < 8 || e.id.length > 64 || RESERVED_IDS.has(e.id)) return null;
  if (!RE_DATE.test(e.date) || !RE_TIME.test(e.time)) return null;
  const blob = blobOf(e);
  if (blob) {
    return {
      id: e.id, date: e.date.slice(0, 8) + '01', time: '00:00', meal: 0, text: '', blob,
      updated_at: stamp(e.updated_at), deleted: int(e.deleted, 0, 1, 0),
    };
  }
  return {
    id: e.id, date: e.date, time: e.time, blob: '',
    meal: int(e.meal, 0, 5, 0),
    text: typeof e.text === 'string' ? e.text.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
    updated_at: stamp(e.updated_at),
    deleted: int(e.deleted, 0, 1, 0),
  };
}

// ---- Abfragen auf Einträge: das Konto (user_id) steht immer an erster Stelle ----
const E = ENTRY_COLS.join(', '), Ex = ENTRY_COLS.filter((c) => c !== 'seq').join(', ');
const q = {
  get: prep('SELECT updated_at FROM entries WHERE user_id = ? AND id = ?'),
  maxSeq: prep('SELECT COALESCE(MAX(seq), 0) AS m FROM entries WHERE user_id = ?'),
  upsert: prep(`
    INSERT INTO entries (user_id, ${E})
    VALUES (@user_id, @id, @date, @time, @consistency, @urge, @amount, @blood, @pain, @mucus, @luft, @note, @color, @updated_at, @deleted, @seq, @blob)
    ON CONFLICT(user_id, id) DO UPDATE SET
      date=excluded.date, time=excluded.time, consistency=excluded.consistency,
      urge=excluded.urge, amount=excluded.amount, blood=excluded.blood,
      pain=excluded.pain, mucus=excluded.mucus, luft=excluded.luft, color=excluded.color, note=excluded.note,
      updated_at=excluded.updated_at, deleted=excluded.deleted, seq=excluded.seq, blob=excluded.blob`),
  since: prep(`SELECT ${E} FROM entries WHERE user_id = ? AND seq > ? ORDER BY seq`),
  sinceMin: prep(`SELECT ${E} FROM entries WHERE user_id = ? AND seq > ? AND date >= ? ORDER BY seq`),
  drops: prep('SELECT id FROM entries WHERE user_id = ? AND seq > ? AND date < ?'),
  exportAll: prep('SELECT * FROM entries WHERE user_id = ? AND deleted = 0 ORDER BY date, time'),
  exportClean: prep(`SELECT ${Ex} FROM entries WHERE user_id = ? AND deleted = 0 ORDER BY date, time`),
  count: prep('SELECT COUNT(*) AS c FROM entries WHERE user_id = ? AND deleted = 0'),
  ids: prep('SELECT id FROM entries WHERE user_id = ? AND deleted = 0'),
  range: prep(`SELECT ${Ex} FROM entries WHERE user_id = ? AND deleted = 0 AND date >= ? AND date <= ? ORDER BY date, time`),
  summary: prep(`SELECT COUNT(*) AS total, COALESCE(SUM(deleted = 0), 0) AS active,
    MIN(CASE WHEN deleted = 0 THEN date END) AS first, MAX(CASE WHEN deleted = 0 THEN date END) AS last FROM entries WHERE user_id = ?`),
  wipe: prep('DELETE FROM entries WHERE user_id = ?'),
  countAllUsers: prep('SELECT COUNT(*) AS c FROM entries WHERE deleted = 0 /*global*/'), // nur für den täglichen Backup-Check
};

// Essen (eigene Tabelle, eigener Änderungszähler je Konto)
const F = FOOD_COLS.join(', '), Fx = FOOD_COLS.filter((c) => c !== 'seq').join(', ');
const qf = {
  get: prep('SELECT updated_at FROM foods WHERE user_id = ? AND id = ?'),
  maxSeq: prep('SELECT COALESCE(MAX(seq), 0) AS m FROM foods WHERE user_id = ?'),
  upsert: prep(`
    INSERT INTO foods (user_id, ${F})
    VALUES (@user_id, @id, @date, @time, @meal, @text, @updated_at, @deleted, @seq, @blob)
    ON CONFLICT(user_id, id) DO UPDATE SET
      date=excluded.date, time=excluded.time, meal=excluded.meal, text=excluded.text,
      updated_at=excluded.updated_at, deleted=excluded.deleted, seq=excluded.seq, blob=excluded.blob`),
  since: prep(`SELECT ${F} FROM foods WHERE user_id = ? AND seq > ? ORDER BY seq`),
  exportClean: prep(`SELECT ${Fx} FROM foods WHERE user_id = ? AND deleted = 0 ORDER BY date, time`),
  active: prep('SELECT COUNT(*) AS c FROM foods WHERE user_id = ? AND deleted = 0'),
  ids: prep('SELECT id FROM foods WHERE user_id = ? AND deleted = 0'),
  wipe: prep('DELETE FROM foods WHERE user_id = ?'),
};

// Konto samt aller Daten löschen
function deleteUser(id) {
  db.exec('BEGIN');
  try { q.wipe.run(id); qf.wipe.run(id); uq.del.run(id); db.exec('COMMIT'); } catch (err) { db.exec('ROLLBACK'); throw err; }
}
// Zurück auf Anfang (wie nach der Installation): Daten und Konto weg, es bleibt nur der Platzhalter, der neu eingerichtet werden muss.
// keepId (Einzelnutzer): dasselbe Konto wird zurückgesetzt, die ID bleibt, damit Backups dazu weiter passen. Sonst (Mehrbenutzer, letztes Konto)
// entsteht ein neuer Platzhalter mit neuer ID. Alte Sitzungen sind in beiden Fällen ungültig (Sitzungszähler wächst, die ID wird nicht wiederverwendet).
function resetAccount(id, keepId) {
  db.exec('BEGIN');
  try {
    q.wipe.run(id); qf.wipe.run(id);
    if (keepId) uq.resetOwner.run(newEpoch(), id);
    else { uq.del.run(id); uq.insertPlaceholder.run(newEpoch(), Date.now()); }
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
}
// Gelöschte Klartext-Seiten aus der Datei entfernen (nach dem Löschen eines Kontos)
function compact() { db.exec('VACUUM'); db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); }

module.exports = { db, DB_PATH, BACKUP_DIR, U, deleteUser, resetAccount, compact, PLACEHOLDER, int, clean, cleanFood, RE_DATE, q, qf, ENTRY_COLS, FOOD_COLS };
