// Gemeinsamer, veränderlicher Zustand der App (ES-Module können importierte Variablen nicht neu zuweisen)
import { serverConn, staticBuild } from './net.js';
import { DEV, LS, todayStr } from './util.js';
import { vault } from './vault.js';

const standalone = staticBuild && !serverConn(); // eigenständige Version ohne Server-Verbindung
const config = DEV.get('config', null);
const fresh = (() => { try { const f = sessionStorage.getItem('gutkeeper.fresh') === '1'; sessionStorage.removeItem('gutkeeper.fresh'); return f; } catch { return false; } })(); // gerade angemeldet (Seite wurde danach neu geladen)

const dataKey = await vault.getDataKey().catch(() => null); // Datenschlüssel der Ende-zu-Ende-Verschlüsselung (nur wenn auf diesem Gerät eingerichtet)

export const S = {
  // Einträge und Abgleich
  entries: LS.get('entries', {}), seq: LS.get('seq', 0), epoch: LS.get('epoch', null),
  // Essen (optional, eigener Speicherbereich und eigener Änderungszähler)
  // „Essen aufzeichnen“: mit Server gilt die Einstellung des Servers für alle Geräte, ohne Server nur dieses Gerät
  foods: LS.get('foods', {}), foodSeq: LS.get('foodSeq', 0), foodOn: !!LS.get('foodOn', false), noFoodSync: false, // mit Server: Einstellung des Kontos (vom Server gemeldet und hier zwischengespeichert)
  dataOpen: DEV.get('dataOpen', {}), optPage: 'home', importMode: 'merge', // welche Bereiche aufgeklappt sind / welche Unterseite im Tab „Optionen“ offen ist
  capMode: 'stool', histKind: ['stool', 'both', 'food'].includes(DEV.get('histKind', 'stool')) ? DEV.get('histKind', 'stool') : 'stool',
  statOpen: false, // Statistik: Einzelwerte unter „Auffälligkeiten“ aufgeklappt (nur diese Sitzung)
  histWarn: false, // Verlauf nur mit Auffälligkeiten (Blut, Schleim, Farbe rot/schwarz), nur für diese Sitzung
  keepOverride: LS.get('keep', null), // eigene Wahl „wie weit zurück speichern“ (null = Standard vom Server)
  usageCache: 0, syncing: false, syncAgain: false, syncTimer: null, online: false,
  // Ohne Server (statischer Build, Meta-Tag „gutkeeper-standalone“): alles bleibt auf dem Gerät, kein Abgleich, keine Server-Anmeldung
  standalone, staticBuild, // staticBuild: eigenständige Version (auch wenn sie mit einem Server verbunden ist)
  // Offline-Modus („Nur auf diesem Gerät“): mit Server-Installation, aber ohne jeden Abgleich, bis er wieder ausgeschaltet wird
  offline: !standalone && !!DEV.get('offline', false),
  // Ende-zu-Ende-Verschlüsselung: Schlüssel dieses Geräts, Zustand am Server (null = unbekannt), Schlüssel fehlt, Umstellung läuft
  dataKey, e2eeServer: null, needKey: false, busyE2ee: false,
  // Anmeldung
  config, auth: LS.get('auth', {}), sessionUnlocked: fresh, user: DEV.get('session', null), me: null, hiddenAt: 0, stayOnReturn: 0, sharing: 0, locked: false,
  // Oberfläche
  tab: 'cap', capTouched: false, capDT: null, openRow: null, yearMetric: 'stool', calMonth: todayStr().slice(0, 7),
  dataMsg: '', lastCons: 4, toastTimer: null,
  // Ältere Einträge (vor dem Speicher-Zeitraum des Geräts), bei Bedarf live vom Server – nur im Arbeitsspeicher
  remote: {}, remoteMeta: {}, remoteBusy: {}, remoteAuto: LS.get('remote', true), serverInfo: null,
};
