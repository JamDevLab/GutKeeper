// Konfiguration ausschließlich über Umgebungsvariablen (siehe .env.example / docs/CONFIGURATION.de.md)
const path = require('node:path');
const pkg = require('../package.json');
const log = require('./log'); // log.js hat keine Abhängigkeiten (kein Zirkelbezug)

const env = process.env;
const num = (v, def) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : def;
};

const cfg = {
  VERSION: pkg.version,
  APP_NAME: (env.APP_NAME || '').trim() || 'GutKeeper',
  APP_NAME_CUSTOM: !!(env.APP_NAME || '').trim(), // ohne eigenen Namen: GutKeeper
  APP_ICON: (env.APP_ICON || 'bristol').trim().toLowerCase(), // bristol | classic | list | diary | shield | ring | crest | guard (oder 1–8) | custom
  APP_THEME_COLOR: /^#[0-9a-f]{6}$/i.test((env.APP_THEME_COLOR || '').trim()) ? env.APP_THEME_COLOR.trim() : '',
  PORT: num(env.PORT, 3000),
  DATA_DIR: env.DATA_DIR || path.join(__dirname, '..', 'data'),
  PUBLIC_DIR: path.join(__dirname, '..', 'public'),

  // Netzwerk
  ALLOW_ANY: env.ALLOW_ANY === '1', // nur für Tests: Beschränkung auf private Netze aus
  TRUST_PROXY: env.TRUST_PROXY === '1', // hinter einem Reverse Proxy: echte Client-IP aus X-Real-IP verwenden
  // Welche Proxys den Forwarded-Headern glauben dürfen: IP-Adressen und/oder Subnetze (CIDR, IPv4/IPv6), kommagetrennt, z. B. 172.18.0.0/16,192.168.1.10. Leer = jede private Adresse (wie bisher)
  TRUSTED_PROXY: String(env.TRUSTED_PROXY || '').split(',').map((a) => a.trim()).filter(Boolean),
  COOKIE_SECURE: ['0', '1'].includes(env.COOKIE_SECURE) ? env.COOKIE_SECURE : 'auto',

  // Eigenständige App (APK) oder andere Web-Adresse mit diesem Server verbinden: erlaubte Herkunft(en), kommagetrennt, z. B. https://localhost (Android-App)
  CORS_ORIGINS: String(env.CORS_ORIGINS || '').split(',').map((o) => o.trim().replace(/\/+$/, '').toLowerCase()).filter((o) => /^https?:\/\/[^\s/]+$/.test(o)),

  // Erlaubte Hostnamen (Schutz vor DNS-Rebinding), kommagetrennt, z. B. gutkeeper.fritz.box,gutkeeper.example.org. IP-Adressen und localhost gehen immer
  ALLOWED_HOSTS: String(env.ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase().replace(/:\d+$/, '')).filter(Boolean),

  // Anmeldung: Das Passwort wird beim ersten Start in der App festgelegt (Einmal-Code aus dem Server-Log) und als Hash in der Datenbank gespeichert
  MULTIUSER: env.MULTIUSER === '1', // mehrere Konten (Name + Passwort); aus = ein Nutzer (nur Passwort)
  NO_AUTH: env.NO_AUTH === '1' && env.MULTIUSER !== '1', // nur für lokale Tests: Server ganz ohne Anmeldung (nicht für den Betrieb!)
  FOOD_DEFAULT: env.FOOD_DEFAULT === '1', // Voreinstellung für „Essen aufzeichnen“ (jede Person kann sie selbst ändern)
  ONBOARDING: env.ONBOARDING !== '0', // geführter Einstieg nach der ersten Anmeldung (einmal je Konto und Gerät), standardmäßig an, 0 = aus
  ADMIN_FULL_ACCESS: env.ADMIN_FULL_ACCESS !== '0', // Admin darf Backups und Gesamt-Export aller Daten nutzen (0 = nur Konten verwalten)
  SESSION_SECRET: String(env.SESSION_SECRET || ''), // optional: fester Schlüssel für die Anmelde-Cookies (sonst Datei data/session.key)
  SESSION_DAYS: 180, // Lebensdauer einer Sitzung ohne Nutzung; jede Anfrage nach mehr als RENEW_HOURS verlängert sie (gleitend)
  RENEW_HOURS: 24,

  // Daten
  BACKUP_KEEP: Math.max(1, Math.trunc(num(env.BACKUP_KEEP, 30))),
  BACKUP_PASSWORD: String(env.BACKUP_PASSWORD || ''), // gesetzt: Server-Backups werden mit diesem Passwort verschlüsselt (*.db.enc.json)
  BACKUP_INTERVAL_HOURS: Math.max(1, num(env.BACKUP_INTERVAL_HOURS, 24)), // Abstand der automatischen Backups (24 = einmal pro Tag)
  BACKUP_DIR: env.BACKUP_DIR ? path.resolve(env.BACKUP_DIR) : '', // leer = DATA_DIR/backups
  LOCAL_MONTHS: Math.max(0, Math.trunc(num(env.LOCAL_MONTHS, 12))), // Standard für den Speicher auf dem Gerät, 0 = alles
};

// Globale Einstellungen aus data/settings.json (optional, gilt für alle Konten). Bisher: Mahlzeit-Zeiten für den Vorschlag im Tab „Essen“.
//   { "mealTimes": { "breakfastUntil": "10:30", "lunchUntil": "15:00", "snackUntil": "17:00", "dinnerUntil": "21:30" }, "recentFoods": 8 }
// Davor Frühstück, danach Mittagessen, Snack, Abendessen; nach dem letzten Zeitpunkt Snack. Die Zeiten müssen aufsteigend sein.
const MEAL_DEFAULT = [630, 900, 1020, 1290]; // Minuten seit Mitternacht
// settings.json einmal lesen: fehlende Datei = still keine Einstellungen, kaputtes JSON = eine Warnung (nicht je Abschnitt)
const SETTINGS = (() => {
  let text;
  try { text = require('node:fs').readFileSync(path.join(cfg.DATA_DIR, 'settings.json'), 'utf8'); } catch { return {}; }
  try { const o = JSON.parse(text); return o && typeof o === 'object' ? o : {}; } catch {
    log.warn('settings.json: kein gültiges JSON – alle Einstellungen daraus werden ignoriert, es gelten die Standardwerte.', 'settings.json: not valid JSON, all settings from it are ignored and the defaults apply.');
    return {};
  }
})();
function loadMealTimes() {
  const raw = SETTINGS.mealTimes;
  if (!raw) return MEAL_DEFAULT;
  const mins = ['breakfastUntil', 'lunchUntil', 'snackUntil', 'dinnerUntil'].map((k) => {
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(raw[k] || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  });
  if (mins.some(Number.isNaN) || mins.some((v, i) => i && v <= mins[i - 1])) {
    log.warn('settings.json: mealTimes ungültig (alle vier Zeiten als HH:MM, aufsteigend) – es gelten die Standardzeiten.', 'settings.json: mealTimes invalid (all four times as HH:MM, ascending): the default times apply.');
    return MEAL_DEFAULT;
  }
  return mins;
}
cfg.MEAL_TIMES = loadMealTimes();
// Anzahl der Vorschläge „Zuletzt gegessen“ (1 bis 30, Standard 8)
function loadRecentFoods() {
  if (SETTINGS.recentFoods === undefined) return 8;
  const n = Math.trunc(Number(SETTINGS.recentFoods));
  if (n >= 1 && n <= 30) return n;
  log.warn('settings.json: recentFoods ungültig (Zahl von 1 bis 30) – es gilt der Standard 8.', 'settings.json: recentFoods invalid (a number from 1 to 30): the default of 8 applies.');
  return 8;
}
cfg.RECENT_FOODS = loadRecentFoods();
// Anzeigefarben der sechs Stuhlfarben (nur die Farbtöne; die Zahlen 1 bis 6 und ihre Bedeutung bleiben fest):
//   { "colors": { "1": "#7a4e2d", "3": "#d6b23a" } }   – nicht genannte Stufen behalten den Standard. Ergebnis: Liste mit 6 Einträgen (Farbe oder null)
function loadColors() {
  const raw = SETTINGS.colors;
  if (!raw || typeof raw !== 'object') return null;
  const out = [1, 2, 3, 4, 5, 6].map((n) => {
    const v = Array.isArray(raw) ? raw[n - 1] : raw[n]; // Objekt { "1": … } oder Liste mit 6 Einträgen
    if (v === undefined || v === null) return null;
    if (/^#[0-9a-fA-F]{6}$/.test(String(v))) return String(v).toLowerCase();
    log.warn(`settings.json: colors.${n} ungültig (erwartet #RRGGBB) – es gilt der Standardton.`, `settings.json: colors.${n} invalid (expected #RRGGBB): the default color applies.`);
    return null;
  });
  return out.some(Boolean) ? out : null;
}
cfg.COLORS = loadColors();
// Vorgaben für Listen, die jede Person auf ihrem Gerät selbst ändern kann (gelten nur, solange sie das nicht getan hat):
//   { "noteTags": ["Kaffee", "Stress"], "foodPins": ["Haferflocken"] }
// Einträge werden bereinigt (Leerraum, ohne Doppelte); Grenzen wie in der App. Ungültig = Warnung, es gilt der Standard.
function loadList(key, { maxLen, maxCount, noComma }) {
  const raw = SETTINGS[key];
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) { log.warn(`settings.json: ${key} ungültig (erwartet eine Liste von Texten) – es gilt der Standard.`, `settings.json: ${key} invalid (expected a list of strings): the default applies.`); return null; }
  const seen = new Set(), out = [];
  let skipped = 0;
  for (const x of raw) {
    let c = typeof x === 'string' ? x : '';
    if (noComma) c = c.replace(/,/g, ' ');
    c = c.replace(/\s+/g, ' ').trim();
    const k = c.toLowerCase();
    if (!c || c.length > maxLen || seen.has(k) || out.length >= maxCount) { skipped++; continue; }
    seen.add(k); out.push(c);
  }
  if (skipped) log.warn(`settings.json: ${key}: ${skipped} Eintrag/Einträge übersprungen (leer, doppelt, länger als ${maxLen} Zeichen oder mehr als ${maxCount}).`, `settings.json: ${key}: ${skipped} entries skipped (empty, duplicate, longer than ${maxLen} characters or more than ${maxCount}).`);
  return out;
}
cfg.NOTE_TAGS = loadList('noteTags', { maxLen: 30, maxCount: 24, noComma: true }); // wie TAG_MAX_LEN/TAG_MAX_COUNT in notetags.js
cfg.FOOD_PINS = loadList('foodPins', { maxLen: 200, maxCount: 12 }); // wie PIN_MAX in food.js und die Textlänge in db.js
module.exports = cfg;
