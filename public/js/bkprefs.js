// Backup-Erinnerung der eigenständigen Version (ohne Server): Wann ist das letzte Backup „zu alt“? Einstellbar (Aus, 7, 14, 30 Tage oder eigene Zahl).
import { S } from './state.js';
import { activeEntries } from './store.js';
import { DEV, LS } from './util.js';

const DAY = 86400000;
export const REMIND_OPTIONS = [7, 14, 30], REMIND_MAX = 365;
export const remindDays = () => { const v = DEV.get('bkRemind', 30); return v === 0 || (Number.isInteger(v) && v >= 1 && v <= REMIND_MAX) ? v : 30; };
export const isCustomRemind = () => remindDays() > 0 && !REMIND_OPTIONS.includes(remindDays());
export const setRemindDays = (v) => DEV.set('bkRemind', v);
// Alter des letzten Backups in Tagen (null = noch keins)
export const backupAge = () => { const last = LS.get('lastBackup', 0); return last ? Math.floor((Date.now() - last) / DAY) : null; };
// Zeit für ein Backup? Nur ohne Server (mit Server sichert der Server) und nur, wenn es Einträge gibt
export const backupDue = () => {
  const d = remindDays();
  if (!d || !S.standalone || !activeEntries().length) return false;
  const a = backupAge();
  return a === null || a >= d;
};
