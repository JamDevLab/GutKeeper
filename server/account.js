// „Konto löschen“ (vom Besitzer selbst): je nach Betrieb wird nur das eigene Konto gelöscht oder der ganze Server auf die erste Einrichtung zurückgesetzt
const cfg = require('./config');
const { U, deleteUser, resetAccount, compact } = require('./db');
const log = require('./log');
const auth = require('./auth');
const bk = require('./backups');

// Was passiert, wenn dieses Konto sich löscht?
//   'reset'    – Einzelnutzer oder letztes Konto: alles weg, der Server beginnt wieder bei der Einrichtung (neuer Einmal-Code im Log)
//   'delete'   – Mehrbenutzer: nur dieses Konto samt Daten (auch ein Admin, solange es noch einen anderen aktiven Admin gibt)
//   'handover' – letzter Admin, es gibt aber noch andere Konten: erst muss jemand anderes Admin werden
function plan(user) {
  if (!cfg.MULTIUSER || U.count() <= 1) return 'reset';
  const lastAdmin = user.role === 'admin' && !user.disabled && U.activeAdmins() <= 1;
  return lastAdmin ? 'handover' : 'delete';
}

// Führt das Löschen aus und liefert { plan }. dropBackups (nur beim Zurücksetzen): auch die Server-Backups entfernen, sonst bleiben sie erhalten.
function remove(user, { dropBackups = false } = {}) {
  const p = plan(user);
  if (p === 'handover') return { plan: p };
  const label = cfg.MULTIUSER ? `„${user.name}“ (ID ${user.id})` : 'des Hauptkontos';
  if (p === 'reset') {
    resetAccount(user.id, !cfg.MULTIUSER); // Einzelnutzer: dasselbe Konto zurücksetzen (ID bleibt, Backups passen weiter); sonst neuer Platzhalter
    compact();
    let dropped = 0;
    if (dropBackups) for (const b of bk.listBackups()) { bk.removeBackup(b.name); dropped++; }
    log.info(`Konto ${label} gelöscht, alle Daten entfernt${dropped ? ` (${dropped} Server-Backups gelöscht)` : ''}. Der Server ist wieder im Zustand der ersten Einrichtung.`,
      `Account ${label} deleted, all data removed${dropped ? ` (${dropped} server backups deleted)` : ''}. The server is back in its first-setup state.`);
    auth.issueSetupToken();
  } else {
    deleteUser(user.id);
    compact();
    log.info(`Konto ${label} wurde vom Besitzer gelöscht (mit allen Einträgen und dem Essen).`,
      `Account ${label} was deleted by its owner (with all entries and food).`);
  }
  return { plan: p };
}

module.exports = { plan, remove };
