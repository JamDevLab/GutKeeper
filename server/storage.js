// Speicherverbrauch: eigene Daten für alle, Datenbank/Backups/Datenträger nur für Admins mit Vollzugriff
const fs = require('node:fs');
const { DATA_DIR } = require('./config');
const { DB_PATH, q, qf } = require('./db');
const { listBackups } = require('./backups');

const sizeOf = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };

function storageInfo(user, withServer) {
  const s = q.summary.get(user.id);
  const out = {
    entries: { active: s.active, total: s.total, first: s.first, last: s.last },
    foods: { active: qf.active.get(user.id).c },
  };
  if (!withServer) return out;
  const backups = listBackups();
  let disk = null;
  try {
    const st = fs.statfsSync(DATA_DIR);
    disk = { free: Number(st.bavail) * Number(st.bsize), total: Number(st.blocks) * Number(st.bsize) };
  } catch { /* nicht verfügbar */ }
  return {
    ...out, disk,
    db: sizeOf(DB_PATH) + sizeOf(DB_PATH + '-wal') + sizeOf(DB_PATH + '-shm'),
    backups: { count: backups.length, bytes: backups.reduce((a, b) => a + b.size, 0) },
  };
}

module.exports = { storageInfo };
