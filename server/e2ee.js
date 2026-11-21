// Ende-zu-Ende-Verschlüsselung (optional, je Konto): Umstellung der gespeicherten Daten und der Schlüsselbund.
// Der Server sieht nie einen Schlüssel: Er speichert nur Chiffretext und den mit dem Wiederherstellungscode verpackten Datenschlüssel.
const cfg = require('./config');
const { db, U, q, qf, clean, cleanFood } = require('./db');
const bk = require('./backups');

// Der verpackte Schlüssel ist ein kleines JSON (Version 1); der Server prüft nur die Form
function validKey(key) {
  if (typeof key !== 'string' || key.length < 20 || key.length > 2000) return false;
  try { const k = JSON.parse(key); return !!k && k.v === 1 && k.t === 'recovery' && ['salt', 'iv', 'data'].every((f) => typeof k[f] === 'string'); } catch { return false; }
}

const idsOf = (stmt, uid) => new Set(stmt.all(uid).map((r) => r.id));
const covers = (have, rows) => { const got = new Set(rows.filter((r) => !r.deleted).map((r) => r.id)); for (const id of have) if (!got.has(id)) return false; return true; };

// Wandelt alle Einträge und das Essen eines Kontos um. toE2ee = true: Klartext → Chiffretext, false: zurück.
// Der Upload muss ALLE aktiven Zeilen des Kontos enthalten, sonst wird nichts geändert (so geht nichts verloren).
function convert(user, toE2ee, body) {
  if (!!user.e2ee === toE2ee) return { error: 'state' };
  if (!body || !Array.isArray(body.entries) || !Array.isArray(body.foods)) return { error: 'format' };
  if (toE2ee && !validKey(body.key)) return { error: 'key' };
  const entries = [], foods = [];
  for (const raw of body.entries) { const e = clean(raw); if (!e || !!e.blob !== toE2ee) return { error: 'format' }; entries.push(e); }
  for (const raw of body.foods) { const f = cleanFood(raw); if (!f || !!f.blob !== toE2ee) return { error: 'format' }; foods.push(f); }
  const uid = user.id;
  if (!covers(idsOf(q.ids, uid), entries) || !covers(idsOf(qf.ids, uid), foods)) return { error: 'incomplete' };
  let seq = 0, fseq = 0;
  db.exec('BEGIN');
  try {
    // neue Zähler beginnen oberhalb der alten, damit jedes Gerät beim nächsten Abgleich alle Zeilen neu bekommt
    seq = q.maxSeq.get(uid).m; fseq = qf.maxSeq.get(uid).m;
    q.wipe.run(uid); qf.wipe.run(uid);
    for (const e of entries) q.upsert.run({ user_id: uid, ...e, seq: ++seq });
    for (const f of foods) qf.upsert.run({ user_id: uid, ...f, seq: ++fseq });
    U.setE2ee(uid, toE2ee, body.key);
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  db.exec('VACUUM'); // alte Klartext-Seiten aus der Datei entfernen
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  // Alte Backups enthalten noch Klartext. Bei einem einzelnen Konto lassen sie sich auf Wunsch gleich löschen;
  // mit mehreren Konten gehören sie allen, dort entscheidet der Admin.
  let purged = 0;
  if (toE2ee && body.purgeBackups === true && !cfg.MULTIUSER) for (const b of bk.listBackups()) { bk.removeBackup(b.name); purged++; }
  return { ok: true, seq, foodSeq: fseq, purged, backupsKept: toE2ee && !purged && bk.listBackups().length > 0 };
}

// Neuen Wiederherstellungscode hinterlegen (der Datenschlüssel bleibt gleich, nur seine Verpackung ändert sich)
function replaceKey(user, key) {
  if (!user.e2ee) return { error: 'state' };
  if (!validKey(key)) return { error: 'key' };
  U.setE2ee(user.id, true, key);
  return { ok: true };
}

module.exports = { convert, replaceKey };
