// Netzwerk-Beschränkung, Anmeldung (Einzelnutzer: ein Passwort, Mehrbenutzer: Konten mit Name + Passwort; beides als scrypt-Hash
// in der Datenbank, festgelegt beim ersten Start mit einem Einmal-Code aus dem Log), Sitzungen per HttpOnly-Cookie, Schutz vor Raten
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const net = require('node:net');
const cfg = require('./config');
const { U, PLACEHOLDER } = require('./db');
const log = require('./log');

const COOKIE = 'gutkeeper_session';
const OWNER_NAME = PLACEHOLDER; // Name des Hauptkontos (kleinste ID); im Einzelnutzer-Betrieb bleibt er, das Konto ist dort unsichtbar

// ---- Zugriff nur aus privaten Netzen (LAN, VPN, Tailscale) ----
function isPrivate(addr) {
  if (!addr) return false;
  if (addr.startsWith('::ffff:')) addr = addr.slice(7);
  if (addr === '::1') return true;
  if (/^f[cd]/i.test(addr) || /^fe80/i.test(addr)) return true; // IPv6 ULA / link-local
  const m = addr.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 10 || a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) // CGNAT / Tailscale
  );
}

// Vertrauenswürdige Proxys (TRUSTED_PROXY) als BlockList; ungültige Einträge werden ignoriert
const proxyList = new net.BlockList();
let proxyCount = 0;
for (const entry of cfg.TRUSTED_PROXY) {
  const [addr, bits] = entry.split('/');
  const fam = net.isIPv4(addr) ? 'ipv4' : net.isIPv6(addr) ? 'ipv6' : null;
  const max = fam === 'ipv4' ? 32 : 128;
  try {
    if (!fam) throw new Error('keine IP-Adresse');
    if (bits === undefined) proxyList.addAddress(addr, fam);
    else if (/^\d+$/.test(bits) && Number(bits) <= max) proxyList.addSubnet(addr, Number(bits), fam);
    else throw new Error('ungültige Präfixlänge');
    proxyCount++;
  } catch { log.warn(`Hinweis: TRUSTED_PROXY-Eintrag „${entry}“ ist ungültig und wird ignoriert.`, `Note: TRUSTED_PROXY entry "${entry}" is invalid and will be ignored.`); }
}
// Kommt die Anfrage von einem Proxy, dem wir die Forwarded-Header glauben? Ohne TRUSTED_PROXY (leer) gilt wie bisher jede private Adresse.
function fromProxy(req) {
  let remote = req.socket.remoteAddress || '';
  if (remote.startsWith('::ffff:')) remote = remote.slice(7); // IPv4 in IPv6-Schreibweise
  if (!cfg.TRUSTED_PROXY.length) return isPrivate(remote);
  const fam = net.isIPv4(remote) ? 'ipv4' : net.isIPv6(remote) ? 'ipv6' : null;
  return !!fam && proxyList.check(remote, fam);
}

function clientIp(req) {
  const remote = req.socket.remoteAddress;
  if (cfg.TRUST_PROXY && fromProxy(req)) {
    const real = req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
    if (real) return real;
  }
  return remote;
}

function isHttps(req) {
  if (cfg.COOKIE_SECURE === '1') return true;
  if (cfg.COOKIE_SECURE === '0') return false;
  return !!req.socket.encrypted || (cfg.TRUST_PROXY && fromProxy(req) && req.headers['x-forwarded-proto'] === 'https');
}

// ---- Schlüssel für die Sitzungen: eigene Datei (nicht in den Backups) oder SESSION_SECRET ----
const sessionKey = (() => {
  if (cfg.SESSION_SECRET) return crypto.createHash('sha256').update(cfg.SESSION_SECRET).digest();
  const file = path.join(cfg.DATA_DIR, 'session.key');
  try { const k = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex'); if (k.length === 32) return k; } catch { /* neu anlegen */ }
  const k = crypto.randomBytes(32);
  fs.writeFileSync(file, k.toString('hex'), { mode: 0o600 });
  return k;
})();
const mac = (s) => crypto.createHmac('sha256', sessionKey).update(s).digest('base64url');
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();

// ---- Passwörter (scrypt, Salz je Konto) ----
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const scrypt = promisify(crypto.scrypt); // asynchron, damit eine Passwortprüfung (~50–100 ms) die Ereignisschleife nicht blockiert
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(String(pw), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${h.toString('base64')}`;
}
async function verifyPassword(pw, stored) {
  const [alg, N, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !hash) return false;
  try {
    const want = Buffer.from(hash, 'base64');
    const got = await scrypt(String(pw), Buffer.from(salt, 'base64'), want.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: 128 * 1024 * 1024 });
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  } catch { return false; }
}
let dummyHash = null; // gleicht die Antwortzeit bei unbekannten Namen an; wird erst bei Bedarf einmal berechnet
const DUMMY_HASH = () => dummyHash || (dummyHash = hashPassword('zeitausgleich-fuer-unbekannte-konten'));

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,30}[A-Za-z0-9]$/; // 3–32 Zeichen, beginnt/endet mit Buchstabe oder Ziffer
const MIN_PASSWORD = 8;
const validName = (n) => typeof n === 'string' && NAME_RE.test(n);
const validPassword = (p) => typeof p === 'string' && p.length >= MIN_PASSWORD && p.length <= 128;

// ---- Sitzungs-Token: Konto.Version.Ablauf.Signatur ----
// Die Version ist der Sitzungszähler (token_ver) des Kontos: Passwort ändern, „Andere Geräte abmelden“ und Sperren machen alle Token ungültig.
// Gleitende Sitzung: Jede Anfrage mit einem Token, das älter als RENEW_HOURS ist, bekommt ein frisches (Lebensdauer SESSION_DAYS ab jetzt).
const SESSION_MS = cfg.SESSION_DAYS * 86400000, RENEW_MS = cfg.RENEW_HOURS * 3600000;
function makeToken(user) {
  const body = `${user.id}.${user.token_ver}.${Date.now() + SESSION_MS}`;
  return `${body}.${mac(body)}`;
}
function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
// Anmelde-Token auch per Header „Authorization: Bearer …“ (für die eigenständige App, die Cookies einer fremden Herkunft nicht nutzen kann)
const bearerOf = (req) => { const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || '')); return m ? m[1] : ''; };
// Herkunft der Anfrage, wenn sie in CORS_ORIGINS erlaubt ist (sonst leer)
const corsOrigin = (req) => { const o = String(req.headers.origin || '').toLowerCase(); return o && cfg.CORS_ORIGINS.includes(o) ? req.headers.origin : ''; };
// Das Token wird nur herausgegeben, wenn die App es verlangt (bearer: true) und ihre Herkunft ausdrücklich erlaubt ist
const tokenFor = (req, body, user) => (body && body.bearer === true && corsOrigin(req) ? { token: makeToken(user) } : {});
// Einrichtung offen: Einzelnutzer: das Hauptkonto hat noch kein Passwort. Mehrbenutzer: es gibt noch kein eingerichtetes Konto mit eigenem
// Namen (auch nach dem Umstellen von Einzelnutzer auf Mehrbenutzer, wo das Hauptkonto erst einen Namen wählen muss).
// Das gilt auch nach „Konto löschen“ des letzten Kontos: Der Server ist dann wieder im Zustand der ersten Einrichtung.
const needsSetup = () => {
  if (cfg.NO_AUTH) return false;
  if (cfg.MULTIUSER) return !U.hasNamed();
  const o = U.owner();
  return !o || o.pass === '';
};

// Wer ruft an? Gibt { user, due, bearer } zurück (Konto frisch aus der Datenbank, mit Rolle; due = Token sollte erneuert werden) oder null
function session(req) {
  if (cfg.NO_AUTH) return { user: U.owner(), due: false, bearer: false };
  if (needsSetup()) return null;
  const bearer = bearerOf(req);
  const parts = String(bearer || cookies(req)[COOKIE] || '').split('.');
  if (parts.length !== 4) return null;
  const [uid, ver, exp, sig] = parts;
  const a = Buffer.from(sig), b = Buffer.from(mac(`${uid}.${ver}.${exp}`));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b) || !(Number(exp) > Date.now())) return null;
  const user = U.byId(Number(uid));
  if (!user || user.disabled || ver !== String(user.token_ver)) return null;
  if (!cfg.MULTIUSER && user.id !== U.owner().id) return null; // Einzelnutzer: nur das Hauptkonto
  return { user, due: Number(exp) - SESSION_MS < Date.now() - RENEW_MS, bearer: !!bearer };
}
// Antwort-Header für die gleitende Erneuerung: Cookie bzw. (bei Token im Header) X-Session-Token
function renewHeaders(req, s) {
  if (!s.due) return {};
  return s.bearer ? { 'X-Session-Token': makeToken(s.user) } : { 'Set-Cookie': loginCookie(req, s.user) };
}

// Host-Header prüfen (Schutz vor DNS-Rebinding): IP-Adressen, localhost und ALLOWED_HOSTS sind erlaubt.
// Mit ALLOWED_HOSTS immer prüfen; ohne nur bei NO_AUTH (dann wäre jede Anfrage aus dem privaten Netz der Besitzer).
// Mit Anmeldung (auch vor der Einrichtung, die den Einmal-Code aus dem Log braucht) bleiben beliebige Namen erlaubt.
function hostName(req) {
  const h = String(req.headers.host || '').trim().toLowerCase();
  if (!h) return '';
  if (h.startsWith('[')) { const i = h.indexOf(']'); return i > 0 ? h.slice(1, i) : ''; } // [fd00::1]:3000
  return h.replace(/:\d*$/, '');
}
const hostEnforced = () => cfg.ALLOWED_HOSTS.length > 0 || cfg.NO_AUTH;
function hostAllowed(req) {
  if (!hostEnforced()) return true;
  const h = hostName(req);
  if (!h) return false;
  return net.isIP(h) !== 0 || h === 'localhost' || cfg.ALLOWED_HOSTS.includes(h);
}

function sessionCookie(req, value, maxAgeSec) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${isHttps(req) ? '; Secure' : ''}`;
}
const loginCookie = (req, user) => sessionCookie(req, makeToken(user), Math.floor(SESSION_MS / 1000));
const logoutCookie = (req) => sessionCookie(req, '', 0);

// Schreibende Anfragen von fremden Seiten ablehnen (zusätzlich zu SameSite=Strict)
function crossSite(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return false;
  if (bearerOf(req) || corsOrigin(req)) return false; // Token im Header bzw. ausdrücklich erlaubte Herkunft: kein Cookie-Missbrauch möglich
  const s = req.headers['sec-fetch-site'];
  return !!s && s !== 'same-origin' && s !== 'none';
}

// ---- Anmeldung ----
// Schlüssel der Fehlversuchszähler: je Konto (Mehrbenutzer) bzw. ein globaler Zähler für das Hauptkonto (damit gefälschte oder
// wechselnde Adressen das Durchprobieren nicht umgehen)
const failKey = (name) => (cfg.MULTIUSER ? 'u:' + String(name || '').trim().toLowerCase() : 'owner');
async function loginAccount(name, password) { // { user } oder { error }; Einzelnutzer: immer das Hauptkonto
  const u = cfg.MULTIUSER ? U.byName(String(name || '').trim()) : U.owner();
  const ok = await verifyPassword(String(password ?? ''), u && u.pass ? u.pass : await DUMMY_HASH());
  if (!u || !u.pass || !ok || u.disabled) return { error: 'wrong' }; // bewusst immer dieselbe Antwort
  return { user: u };
}

// ---- Einrichtung: Passwort (bzw. erstes Konto) festlegen, solange das Hauptkonto noch keins hat ----
// Der Einmal-Code steht nur im Server-Log und gilt bis zum Neustart des Servers.
let setupToken = null;
if (needsSetup()) setupToken = crypto.randomBytes(6).toString('hex');
// Neuen Einmal-Code erzeugen und ins Log schreiben (nach „Konto löschen“ des letzten Kontos: der Server beginnt wieder bei der Einrichtung)
function issueSetupToken(reason = '') {
  setupToken = crypto.randomBytes(6).toString('hex');
  clearFails('setup');
  logSetup(reason);
}
// Hinweis mit dem Einmal-Code, auf Deutsch und Englisch (der Server kennt die Sprache des Betreibers nicht)
function logSetup(reason = '') {
  log.info(
    `${reason ? reason + ' ' : ''}Noch nicht eingerichtet: Öffne die App und lege ${cfg.MULTIUSER ? 'das erste Konto' : 'dein Passwort'} fest. Einmal-Code für die Einrichtung: ${setupToken}`,
    `${reason ? reason + ' ' : ''}Not set up yet: open the app and set ${cfg.MULTIUSER ? 'up the first account' : 'your password'}. One-time setup code: ${setupToken}`);
}
const setupAllowed = (input) => !!setupToken && crypto.timingSafeEqual(sha(input ?? ''), sha(setupToken));
async function completeSetup(name, password) { // Einzelnutzer: name = OWNER_NAME
  if (!needsSetup()) return null;
  const hash = await hashPassword(password);
  if (!needsSetup()) return null; // nach dem Warten erneut prüfen (parallele Anfrage)
  const id = U.claimOwner(name, hash);
  if (!id) return null;
  setupToken = null;
  return U.byId(id);
}

// ---- Konten verwalten ----
// Vom Admin angelegt: Er kennt das Passwort, die App fordert den Nutzer auf, ein eigenes zu setzen (pw_temp)
async function createAccount(name, password, role) {
  const hash = await hashPassword(password);
  if (U.byName(name)) return { error: 'exists' }; // erst nach dem Hashen prüfen, damit zwischen Prüfung und Anlegen nichts dazwischenkommt
  return { id: U.create(name, hash, role === 'admin' ? 'admin' : 'user', true) };
}
async function changePassword(user, current, next) {
  if (!await verifyPassword(String(current ?? ''), user.pass)) return { error: 'wrong' };
  if (!validPassword(next)) return { error: 'password' };
  U.setPass(user.id, await hashPassword(next), false); // selbst gewählt: kein „vorläufiges“ Passwort mehr
  return { user: U.byId(user.id) };
}
// temp: Ein Admin (oder die Server-Verwaltung) hat das Passwort für ein Konto gesetzt und kennt es; die App fordert dann zum Ändern auf
const resetPassword = async (id, password, temp = false) => U.setPass(id, await hashPassword(password), temp);

// ---- Schutz vor dem Durchprobieren (je Adresse und je Konto: Verzögerung statt dauerhafter Sperre) ----
const fails = new Map(); // Schlüssel -> { n, until, last }
const lockedFor = (key) => { const f = fails.get(key); return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0; };
function recordFail(key, maxMs = 3600000) {
  const f = fails.get(key) || { n: 0, until: 0, last: 0 };
  f.n++; f.last = Date.now();
  if (f.n >= 5) f.until = Date.now() + Math.min(maxMs, 30000 * 2 ** (f.n - 5));
  fails.set(key, f);
}
const clearFails = (key) => fails.delete(key);
// Einen vorab gezählten Versuch zurücknehmen (z. B. richtiges Passwort, aber das neue ist zu kurz)
function undoFail(key) { const f = fails.get(key); if (!f) return; f.n--; if (f.n < 5) f.until = 0; if (f.n <= 0) fails.delete(key); }
// Die Liste begrenzen: abgelaufene Sperren, deren letzter Fehlversuch über eine Stunde zurückliegt, werden verworfen
setInterval(() => { const now = Date.now(); for (const [k, f] of fails) if (f.until <= now && now - f.last > 3600000) fails.delete(k); }, 600000).unref();

module.exports = {
  OWNER_NAME, setupToken: () => setupToken, issueSetupToken, logSetup, needsSetup, setupAllowed, completeSetup, verifyPassword,
  isPrivate, fromProxy, clientIp, hostAllowed, session, renewHeaders, corsOrigin, tokenFor, failKey, loginAccount, loginCookie, logoutCookie, crossSite,
  lockedFor, recordFail, clearFails, undoFail, hashPassword, validName, validPassword, createAccount, changePassword, resetPassword, MIN_PASSWORD,
};
