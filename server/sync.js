// Abgleich mit den Geräten eines Kontos (Änderungszähler, „neuester Stand gewinnt“)
const cfg = require('./config');
const { db, U, int, clean, cleanFood, RE_DATE, q, qf } = require('./db');

// „Essen aufzeichnen“: eigene Einstellung des Kontos, sonst die Voreinstellung aus der .env
const foodOn = (user) => (user.food === null || user.food === undefined ? cfg.FOOD_DEFAULT : !!user.food);

function sync(user, body) {
  const uid = user.id, food = foodOn(user), e2ee = !!user.e2ee;
  if (body.epoch && body.epoch !== user.epoch) return { reset: true, epoch: user.epoch, seq: 0, changes: [], food, e2ee };
  // Ende-zu-Ende-Verschlüsselung: Gerät und Konto müssen im selben Modus sein, sonst wird nichts gespeichert oder gesendet
  if (!!body.e2ee !== e2ee) return { mode: true, e2ee, epoch: user.epoch, food };
  const since = int(body.since, 0, Number.MAX_SAFE_INTEGER, 0);
  const incoming = Array.isArray(body.changes) ? body.changes.slice(0, 5000) : [];
  // Essen wird nur abgeglichen, wenn das Gerät es anfragt (foodSince vorhanden); ältere Apps kennen das Feld nicht
  const withFood = body.foodSince !== undefined;
  const foodSince = int(body.foodSince, 0, Number.MAX_SAFE_INTEGER, 0);
  const foodIn = withFood && Array.isArray(body.foodChanges) ? body.foodChanges.slice(0, 5000) : [];
  db.exec('BEGIN');
  try {
    let seq = q.maxSeq.get(uid).m;
    for (const raw of incoming) {
      const e = clean(raw);
      if (!e || !!e.blob !== e2ee) continue;
      const cur = q.get.get(uid, e.id);
      if (cur && cur.updated_at > e.updated_at) continue; // Server hat neueren Stand
      q.upsert.run({ user_id: uid, ...e, seq: ++seq });
    }
    let fseq = qf.maxSeq.get(uid).m;
    for (const raw of foodIn) {
      const f = cleanFood(raw);
      if (!f || !!f.blob !== e2ee) continue;
      const cur = qf.get.get(uid, f.id);
      if (cur && cur.updated_at > f.updated_at) continue;
      qf.upsert.run({ user_id: uid, ...f, seq: ++fseq });
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  // Geräte, die nur die letzten Monate speichern, bekommen ältere Einträge nicht
  const minDate = RE_DATE.test(String(body.minDate)) ? body.minDate : null;
  return {
    epoch: user.epoch,
    food,
    e2ee,
    seq: q.maxSeq.get(uid).m,
    changes: minDate ? q.sinceMin.all(uid, since, minDate) : q.since.all(uid, since),
    drops: minDate && since > 0 ? q.drops.all(uid, since, minDate).map((r) => r.id) : [],
    ...(withFood ? { foodSeq: qf.maxSeq.get(uid).m, foodChanges: qf.since.all(uid, foodSince) } : {}),
  };
}

// „Alle Daten löschen“ – nur die Daten dieses Kontos; Server-Backups bleiben bewusst erhalten
function wipe(user) {
  db.exec('BEGIN');
  let epoch;
  try { q.wipe.run(user.id); qf.wipe.run(user.id); epoch = U.rotateEpoch(user.id); db.exec('COMMIT'); } catch (err) { db.exec('ROLLBACK'); throw err; }
  db.exec('VACUUM');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  return { epoch };
}

module.exports = { sync, wipe, foodOn };
