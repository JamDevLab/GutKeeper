// GutKeeper – HTTP-Server (ohne externe Abhängigkeiten, Node >= 22.13)
const http = require('node:http');
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const cfg = require('./config');
const log = require('./log');
const { db, q, qf, U, deleteUser, RE_DATE } = require('./db');
const { sync, wipe, foodOn } = require('./sync');
const e2ee = require('./e2ee');
const { wrap } = require('./crypto-wrap');
const bk = require('./backups');
const auth = require('./auth');
const account = require('./account');
const icons = require('./icons');
const swcache = require('./swcache');
const { storageInfo } = require('./storage');
const { INSTANCE } = require('./instance');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const JSON_H = { 'Content-Type': 'application/json' };
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.github.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
};

// index.html und Manifest enthalten den App-Namen als Platzhalter
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsonStr = (s) => JSON.stringify(s).slice(1, -1);
const nameFor = () => cfg.APP_NAME;
const DESC = { de: 'Selbst gehostetes Darm-Tagebuch', en: 'Self-hosted bowel diary' };
const langOf = (req) => (String(req.headers['accept-language'] || '').split(',')[0].trim().toLowerCase().startsWith('en') ? 'en' : 'de');
const template = (file, escape, lang) => fs.readFileSync(path.join(cfg.PUBLIC_DIR, file), 'utf8')
  .replaceAll('__APP_NAME__', escape(nameFor())).replaceAll('__APP_SHORT__', escape(nameFor().slice(0, 16)))
  .replaceAll('__LANG__', lang).replaceAll('__APP_DESC__', escape(DESC[lang]))
  .replaceAll('__THEME__', icons.theme).replaceAll('__ICON_192__', icons.u192).replaceAll('__ICON_512__', icons.u512)
  .replaceAll('__ICONS__', JSON.stringify(icons.icons));
// Name und Sprache der installierten App richten sich nach der Browser-Sprache (Accept-Language)
const TEMPLATES = Object.fromEntries(['de', 'en'].map((l) => [l, { '/index.html': template('index.html', esc, l), '/manifest.webmanifest': template('manifest.webmanifest', jsonStr, l) }]));

// Textzellen, die mit = + - @ Tab oder CR beginnen, würden Tabellenprogramme als Formel auswerten: ein Apostroph davor entschärft sie
// (Zahlen wie -3 bleiben unberührt). Der CSV-Import entfernt den Apostroph wieder.
const csvQ = (t) => {
  t = t == null ? '' : String(t);
  if (/^'?[=+\-@\t\r]/.test(t) && !/^[+-]?\d+([.,]\d+)?$/.test(t)) t = "'" + t;
  return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const COLOR_NAMES = { de: ['', 'braun', 'hell', 'gelb', 'grün', 'schwarz', 'rot'], en: ['', 'brown', 'light', 'yellow', 'green', 'black', 'red'] };
function exportCsv(uid, lang = 'de') {
  const en = lang === 'en', YES = en ? 'yes' : 'ja', NO = en ? 'no' : 'nein';
  const head = (en ? 'date;time;consistency;urge;amount;blood;pain;mucus;gas;color;note' : 'datum;uhrzeit;konsistenz;stuhldrang;menge;blut;schmerz;schleim;luft;farbe;notiz') + '\n';
  const rows = q.exportAll.all(uid).map((e) => [
    e.date, e.time, e.consistency || '', e.urge, e.amount || '', e.blood ? YES : NO, e.pain,
    e.mucus ? YES : NO, e.luft ? YES : NO, COLOR_NAMES[lang][e.color] || '', csvQ(e.note),
  ].join(';'));
  return '\ufeff' + head + rows.join('\n') + '\n';
}

function readBody(req, max = 5_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
const readJson = async (req, max) => {
  const raw = (await readBody(req, max)) || '{}';
  let v;
  try { v = JSON.parse(raw); } catch (e) { throw Object.assign(e, { status: 400 }); } // ungültiges JSON ist ein Fehler des Clients
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Object.assign(new Error('kein Objekt'), { status: 400 }); // null, Zahl, Liste: die Handler erwarten ein Objekt
  return v;
};

const COMPRESSIBLE = /^(application\/json|application\/javascript|application\/manifest\+json|text\/|image\/svg)/;
const send = (res, code, body, headers = {}) => {
  const h = { 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers };
  const pv = res.getHeader('Vary'); // z. B. „Origin“ (CORS), damit es nicht überschrieben wird
  if (pv) h.Vary = [pv, h.Vary].filter(Boolean).join(', ');
  // Große Antworten komprimieren (spart Datenvolumen, z. B. beim Abruf älterer Zeiträume)
  if (body.length > 1024 && String(res.req?.headers['accept-encoding'] || '').includes('gzip') && COMPRESSIBLE.test(h['Content-Type'] || '')) {
    body = zlib.gzipSync(Buffer.isBuffer(body) ? body : Buffer.from(body));
    h['Content-Encoding'] = 'gzip';
    h['Vary'] = [pv, 'Accept-Encoding'].filter(Boolean).join(', ');
  }
  res.writeHead(code, h);
  res.end(body);
  return true; // „Antwort ist gesendet“ (Aufrufer können damit sofort zurückkehren)
};
const sendJson = (res, data, code = 200, headers = {}) => send(res, code, JSON.stringify(data), { ...JSON_H, ...headers });

const publicUser = (u) => ({ id: u.id, name: u.name === auth.OWNER_NAME ? '' : u.name, role: u.role, main: u.id === U.owner().id }); // main: Hauptkonto (übernimmt beim Umstellen von Einzelnutzer auf Mehrbenutzer die lokalen Daten der Geräte)
const fullAccess = () => !cfg.MULTIUSER || cfg.ADMIN_FULL_ACCESS; // ohne Mehrbenutzer gehört alles der einen Person
const fail = (res, code, error) => sendJson(res, { error }, code);

// auth: 'password' (Anmeldung am Server nötig) oder 'none' (nur mit NO_AUTH, für lokale Tests); multi: Konten mit Name + Passwort;
// needsSetup: das Passwort bzw. das erste Konto muss noch festgelegt werden (Einmal-Code aus dem Server-Log)
function configInfo() {
  return {
    name: cfg.APP_NAME, nameCustom: cfg.APP_NAME_CUSTOM, version: cfg.VERSION, localMonths: cfg.LOCAL_MONTHS, mealTimes: cfg.MEAL_TIMES, recentFoods: cfg.RECENT_FOODS, ...(cfg.COLORS ? { colors: cfg.COLORS } : {}), ...(cfg.NOTE_TAGS ? { noteTags: cfg.NOTE_TAGS } : {}), ...(cfg.FOOD_PINS ? { foodPins: cfg.FOOD_PINS } : {}),
    auth: cfg.NO_AUTH ? 'none' : 'password', multi: cfg.MULTIUSER, needsSetup: auth.needsSetup(), minPassword: auth.MIN_PASSWORD, onboarding: cfg.ONBOARDING, instance: INSTANCE,
  };
}
const meInfo = (u) => ({ user: publicUser(u), food: foodOn(u), e2ee: !!u.e2ee, fullAccess: fullAccess(), multi: cfg.MULTIUSER, pwTemp: !!u.pw_temp });
// Zeitstempel für Dateinamen: vom Gerät (Ortszeit) übernehmen, wenn er die Form 2026-11-17_1432 hat, sonst Serverzeit
const stampOf = (s) => (/^\d{4}-\d{2}-\d{2}_\d{4}$/.test(String(s || '')) ? s : new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', ''));
const downloadHeaders = (name, type) => ({ 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}"` });

// Gesamt-Export (Admin): ein Konto im üblichen Format oder alle Konten als Bündel
function buildExport(sel) {
  const part = (u) => ({ id: u.id, name: publicUser(u).name || 'owner', role: u.role, entries: q.exportClean.all(u.id), foods: qf.exportClean.all(u.id) });
  const now = new Date().toISOString();
  // Herkunftskopf wie im App-Backup (die App warnt beim Import, wenn die Datei von einem anderen Konto stammt); beim Gesamt-Export gehört das Konto zu jedem Eintrag in users
  const origin = (u) => ({ account: u ? publicUser(u).name || null : null, accountId: u ? u.id : null, instance: INSTANCE, kind: 'server', exportedAt: now });
  const head = { app: 'gutkeeper', version: 1, exported_at: now };
  if (sel === 'all') return { ...head, origin: origin(null), bundle: true, users: U.all().map((u) => part(u)) };
  const u = U.byId(Number(sel));
  if (!u) return null;
  const { name, entries, foods } = part(u);
  return { ...head, origin: origin(u), user: { name }, entries, foods };
}

async function handleApi(req, res, url, ip) {
  const p = url.pathname;
  if (p === '/api/health') return sendJson(res, { status: 'ok', version: cfg.VERSION });
  if (p === '/api/config') return sendJson(res, configInfo());

  // ---- Anmeldung ----
  if (p === '/api/login' && req.method === 'POST') {
    if (cfg.NO_AUTH) return sendJson(res, { ok: true });
    if (auth.needsSetup()) return fail(res, 409, 'setup');
    const b = await readJson(req);
    const key = auth.failKey(b.name);
    // Fehlversuche zählen je Adresse und je Konto; im Einzelnutzer-Betrieb ist der Schlüssel global (gefälschte oder wechselnde Adressen umgehen die Sperre nicht)
    const wait = Math.max(auth.lockedFor(ip), auth.lockedFor(key));
    if (wait) return sendJson(res, { error: 'locked', retry: wait }, 429);
    // Den Versuch schon VOR der (asynchronen) Prüfung zählen: sonst kämen viele gleichzeitige Anfragen alle an der Sperre vorbei
    auth.recordFail(ip); auth.recordFail(key, 900000); // höchstens 15 Minuten Sperre je Konto; angemeldete Geräte bleiben unberührt
    const r = await auth.loginAccount(b.name, b.password);
    if (r.error) return fail(res, 401, 'wrong');
    auth.clearFails(ip); auth.clearFails(key);
    return sendJson(res, { ok: true, ...meInfo(r.user), ...auth.tokenFor(req, b, r.user) }, 200, { 'Set-Cookie': auth.loginCookie(req, r.user) });
  }
  if (p === '/api/setup' && req.method === 'POST') { // Passwort (Einzelnutzer) bzw. erstes Konto (Mehrbenutzer; wird Admin und übernimmt vorhandene Daten) festlegen
    if (!auth.needsSetup()) return fail(res, 409, 'done');
    const wait = Math.max(auth.lockedFor(ip), auth.lockedFor('setup'));
    if (wait) return sendJson(res, { error: 'locked', retry: wait }, 429);
    const b = await readJson(req);
    if (!auth.setupAllowed(b.secret)) { auth.recordFail(ip); auth.recordFail('setup', 900000); return fail(res, 401, 'secret'); }
    if (cfg.MULTIUSER && !auth.validName(b.name)) return fail(res, 400, 'name');
    if (!auth.validPassword(b.password)) return fail(res, 400, 'password');
    const u = await auth.completeSetup(cfg.MULTIUSER ? b.name : auth.OWNER_NAME, b.password);
    if (!u) return fail(res, 409, 'done');
    auth.clearFails(ip); auth.clearFails('setup');
    return sendJson(res, { ok: true, ...meInfo(u), ...auth.tokenFor(req, b, u) }, 200, { 'Set-Cookie': auth.loginCookie(req, u) });
  }
  if (p === '/api/logout' && req.method === 'POST') {
    // Ein Bearer-Token (eigenständige App/APK) lässt sich nicht per Cookie löschen und ist sonst bis zum Ablauf gültig.
    // Es gibt keinen Widerruf je Token: Das Abmelden in der App erhöht den Sitzungszähler und beendet damit ALLE Sitzungen des Kontos.
    const s = auth.session(req);
    if (s && s.bearer && !cfg.NO_AUTH) U.bumpTokenVer(s.user.id);
    return sendJson(res, { ok: true }, 200, { 'Set-Cookie': auth.logoutCookie(req) });
  }

  const sess = auth.session(req);
  if (!sess) return fail(res, 401, 'auth');
  const user = sess.user;
  for (const [k, v] of Object.entries(auth.renewHeaders(req, sess))) res.setHeader(k, v); // gleitende Sitzung: frisches Cookie bzw. Token, wenn das alte älter als ein Tag ist
  const admin = user.role === 'admin';
  const needAdmin = () => (admin ? null : fail(res, 403, 'admin'));
  const needFull = () => (!admin ? fail(res, 403, 'admin') : fullAccess() ? null : fail(res, 403, 'no-full-access'));

  // ---- Eigenes Konto ----
  if (p === '/api/me' && req.method === 'GET') return sendJson(res, meInfo(user));
  if (p === '/api/sync' && req.method === 'POST') return sendJson(res, sync(user, await readJson(req)));
  if (p === '/api/wipe' && req.method === 'POST') return sendJson(res, wipe(user));
  if (p === '/api/settings' && req.method === 'POST') { // Einstellungen des Kontos (bisher: Essen aufzeichnen)
    const b = await readJson(req);
    if (typeof b.food === 'boolean') U.setFood(user.id, b.food);
    return sendJson(res, { food: foodOn(U.byId(user.id)) });
  }
  if (p === '/api/account/password' && req.method === 'POST') {
    if (cfg.NO_AUTH) return fail(res, 400, 'no-lock');
    const b = await readJson(req);
    const fkey = auth.failKey(user.name);
    const wait = auth.lockedFor(fkey);
    if (wait) return sendJson(res, { error: 'locked', retry: wait }, 429);
    auth.recordFail(fkey, 900000); // vorab zählen (wie beim Anmelden), damit parallele Anfragen die Sperre nicht umgehen
    const r = await auth.changePassword(user, b.current, b.next);
    if (r.error) { if (r.error !== 'wrong') auth.undoFail(fkey); return fail(res, r.error === 'wrong' ? 401 : 400, r.error); }
    auth.clearFails(fkey);
    return sendJson(res, { ok: true, ...auth.tokenFor(req, b, r.user) }, 200, { 'Set-Cookie': auth.loginCookie(req, r.user) }); // alle anderen Sitzungen sind damit ungültig
  }
  if (p === '/api/account/delete' && req.method === 'POST') { // eigenes Konto löschen (Einzelnutzer/letztes Konto: Server zurücksetzen); verlangt das Passwort
    if (cfg.NO_AUTH) return fail(res, 400, 'no-lock');
    const b = await readJson(req);
    if (account.plan(user) === 'handover') return fail(res, 409, 'handover'); // letzter Admin: erst jemand anderen zum Admin machen (kein Passwort nötig, nichts passiert)
    const fkey = auth.failKey(user.name);
    const wait = Math.max(auth.lockedFor(ip), auth.lockedFor(fkey));
    if (wait) return sendJson(res, { error: 'locked', retry: wait }, 429);
    auth.recordFail(ip); auth.recordFail(fkey, 900000); // vorab zählen (wie beim Anmelden), damit parallele Anfragen die Sperre nicht umgehen
    if (!await auth.verifyPassword(String(b.password ?? ''), user.pass)) return fail(res, 401, 'wrong');
    auth.clearFails(ip); auth.clearFails(fkey);
    const now = U.byId(user.id); // Zustand nach dem Warten neu lesen (parallele Anfrage)
    if (!now) return fail(res, 401, 'auth');
    const r = account.remove(now, { dropBackups: b.dropBackups === true });
    if (r.plan === 'handover') return fail(res, 409, 'handover');
    return sendJson(res, { ok: true, reset: r.plan === 'reset' }, 200, { 'Set-Cookie': auth.logoutCookie(req) });
  }
  if (p === '/api/logout-others' && req.method === 'POST') { // alle anderen Geräte abmelden: Sitzungszähler erhöhen, dieses Gerät bekommt ein frisches Token
    const b = await readJson(req);
    if (cfg.NO_AUTH) return fail(res, 400, 'no-lock');
    U.bumpTokenVer(user.id);
    const fresh = U.byId(user.id);
    return sendJson(res, { ok: true, ...auth.tokenFor(req, b, fresh) }, 200, { 'Set-Cookie': auth.loginCookie(req, fresh) });
  }
  if (p === '/api/entries' && req.method === 'GET') { // Einträge eines Zeitraums (für Geräte, die nur die letzten Monate speichern)
    const from = url.searchParams.get('from'), to = url.searchParams.get('to');
    return sendJson(res, { entries: q.range.all(user.id, RE_DATE.test(from) ? from : '0000-01-01', RE_DATE.test(to) ? to : '9999-12-31') });
  }
  if (p === '/api/foods' && req.method === 'GET') return sendJson(res, { foods: qf.exportClean.all(user.id) }); // alle aktiven Essens-Einträge (für die Umstellung der Verschlüsselung)
  // ---- Ende-zu-Ende-Verschlüsselung (optional): Schlüsselbund abrufen, ein- und ausschalten, Code erneuern ----
  if (p === '/api/e2ee' && req.method === 'GET') return sendJson(res, { e2ee: !!user.e2ee, key: user.e2ee ? user.e2ee_key : '' });
  if (p === '/api/e2ee/enable' && req.method === 'POST') { const r = e2ee.convert(user, true, await readJson(req, 40_000_000)); return r.error ? fail(res, 409, r.error) : sendJson(res, r); }
  if (p === '/api/e2ee/disable' && req.method === 'POST') { const r = e2ee.convert(user, false, await readJson(req, 40_000_000)); return r.error ? fail(res, 409, r.error) : sendJson(res, r); }
  if (p === '/api/e2ee/key' && req.method === 'POST') { const b = await readJson(req); const r = e2ee.replaceKey(user, b.key); return r.error ? fail(res, 409, r.error) : sendJson(res, r); }
  if (p === '/api/storage') return sendJson(res, storageInfo(user, admin && fullAccess()));
  if (p === '/api/export.csv') {
    if (user.e2ee) return fail(res, 409, 'e2ee'); // der Server kann verschlüsselte Einträge nicht lesen: Export in der App
    const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'de';
    return send(res, 200, exportCsv(user.id, lang), downloadHeaders(`gutkeeper-${lang === 'en' ? 'full' : 'komplett'}-${stampOf(url.searchParams.get('stamp'))}.csv`, 'text/csv; charset=utf-8'));
  }

  // ---- Konten verwalten (nur Admin, nur mit MULTIUSER=1) ----
  if (p === '/api/admin/users' || p.startsWith('/api/admin/users/')) {
    const no = needAdmin(); if (no) return no;
    if (!cfg.MULTIUSER) return fail(res, 400, 'single');
    const id = Number(p.slice('/api/admin/users/'.length));
    if (p === '/api/admin/users' && req.method === 'GET') {
      return sendJson(res, { users: U.all().map((u) => ({ ...publicUser(u), id: u.id, disabled: !!u.disabled, created_at: u.created_at, entries: q.count.get(u.id).c, foods: qf.active.get(u.id).c })) });
    }
    if (p === '/api/admin/users' && req.method === 'POST') {
      const b = await readJson(req);
      if (!auth.validName(b.name)) return fail(res, 400, 'name');
      if (!auth.validPassword(b.password)) return fail(res, 400, 'password');
      const r = await auth.createAccount(b.name, b.password, b.role);
      return r.error ? fail(res, 409, r.error) : sendJson(res, { ok: true, id: r.id });
    }
    const target = U.byId(id);
    if (!target) return fail(res, 404, 'unknown');
    const lastAdmin = target.role === 'admin' && !target.disabled && U.activeAdmins() <= 1;
    if (req.method === 'POST') {
      const b = await readJson(req);
      if ((b.role === 'user' || b.disabled === true) && lastAdmin) return fail(res, 400, 'last-admin');
      if (b.disabled === true && target.id === user.id) return fail(res, 400, 'self');
      if (b.role === 'admin' || b.role === 'user') U.setRole(id, b.role);
      if (typeof b.disabled === 'boolean') U.setDisabled(id, b.disabled);
      if (b.password !== undefined) { if (!auth.validPassword(b.password)) return fail(res, 400, 'password'); await auth.resetPassword(id, b.password, target.id !== user.id); } // fremdes Konto: vorläufiges Passwort (pw_temp)
      return sendJson(res, { ok: true });
    }
    if (req.method === 'DELETE') {
      const b = await readJson(req);
      if (target.id === user.id) return fail(res, 400, 'self');
      if (lastAdmin) return fail(res, 400, 'last-admin');
      if (String(b.confirm || '').toLowerCase() !== target.name.toLowerCase()) return fail(res, 400, 'confirm');
      deleteUser(id);
      return sendJson(res, { ok: true });
    }
  }

  // ---- Backups und Gesamt-Export (Admin, mit ADMIN_FULL_ACCESS) ----
  if (p === '/api/backups' && req.method === 'GET') { const no = needFull(); return no || sendJson(res, { backups: bk.listWithCounts(), keep: bk.BACKUP_KEEP }); }
  if (p === '/api/backup' && req.method === 'POST') { const no = needFull(); return no || sendJson(res, { name: await bk.makeBackup('manuell') }); }
  if (p === '/api/restore' && req.method === 'POST') {
    const no = needFull(); if (no) return no;
    const b = await readJson(req);
    if (typeof b.name !== 'string') return fail(res, 400, 'name');
    if (!bk.exists(b.name)) return send(res, 404, 'Backup nicht gefunden');
    const target = cfg.MULTIUSER && b.user !== undefined ? U.byId(Number(b.user)) : user; // Einzelnutzer: immer das eigene Konto
    if (!target) return fail(res, 404, 'unknown');
    const r = await bk.restore(b.name, target.id);
    return r.error ? fail(res, 409, r.error) : sendJson(res, r);
  }
  if (p === '/api/admin/export' && req.method === 'POST') {
    const no = needFull(); if (no) return no;
    const b = await readJson(req);
    const data = buildExport(b.user === 'all' ? 'all' : b.user);
    if (!data) return fail(res, 404, 'unknown');
    const stamp = stampOf(b.stamp);
    const base = `gutkeeper-${b.user === 'all' ? 'alle' : (data.user.name || 'konto')}-${stamp}`;
    const json = Buffer.from(JSON.stringify(data));
    if (b.password) return send(res, 200, JSON.stringify(await wrap(json, b.password, 'json')), downloadHeaders(`${base}.enc.json`, 'application/json'));
    return send(res, 200, json, downloadHeaders(`${base}.json`, 'application/json'));
  }
  if (p === '/api/admin/backup-download' && req.method === 'POST') {
    const no = needFull(); if (no) return no;
    const b = await readJson(req);
    if (typeof b.name !== 'string') return fail(res, 400, 'name');
    if (!bk.exists(b.name)) return send(res, 404, 'Backup nicht gefunden');
    if (b.password && !b.name.endsWith('.enc.json')) return send(res, 200, JSON.stringify(await wrap(bk.readBackup(b.name), b.password, 'db')), downloadHeaders(`${b.name}.enc.json`, 'application/json'));
    return send(res, 200, bk.readBackup(b.name), downloadHeaders(b.name, 'application/octet-stream'));
  }
  if (p.startsWith('/api/backups/')) {
    const no = needFull(); if (no) return no;
    const name = decodeURIComponent(p.slice('/api/backups/'.length));
    if (!bk.exists(name)) return send(res, 404, 'Nicht gefunden');
    if (req.method === 'DELETE') { bk.removeBackup(name); return sendJson(res, { ok: true }); }
    if (req.method === 'GET') return send(res, 200, bk.readBackup(name), downloadHeaders(name, 'application/octet-stream'));
  }
  return send(res, 404, 'Nicht gefunden');
}

// sw.js mit Cache-Namen aus Version und Datei-Hash; neu berechnet, sobald sich eine Datei ändert (Änderungszeit)
let swMemo = { key: '', body: '' };
function swFile() {
  const sw = fs.readFileSync(path.join(cfg.PUBLIC_DIR, 'sw.js'), 'utf8');
  const key = sw + swcache.shellOf(sw).map((p) => { try { return fs.statSync(path.join(cfg.PUBLIC_DIR, p)).mtimeMs; } catch { return 0; } }).join(',');
  if (key !== swMemo.key) {
    // index.html und Manifest so, wie sie ausgeliefert werden (beide Sprachen)
    const read = (p) => (TEMPLATES.de['/' + p] ? TEMPLATES.de['/' + p] + TEMPLATES.en['/' + p] : fs.readFileSync(path.join(cfg.PUBLIC_DIR, p)));
    swMemo = { key, body: swcache.fillSw(sw, cfg.VERSION, read) };
  }
  return swMemo.body;
}

function serveStatic(res, pathname, lang) {
  const img = icons.assets[pathname];
  if (img) return send(res, 200, img, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' });
  if (icons.legacy[pathname]) return send(res, 200, icons.legacy[pathname], { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
  const rel = pathname === '/' ? '/index.html' : pathname;
  if (rel === '/sw.js') return send(res, 200, swFile(), { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-cache' });
  if (TEMPLATES[lang][rel]) {
    return send(res, 200, TEMPLATES[lang][rel], { 'Content-Type': MIME[path.extname(rel)], 'Cache-Control': 'no-cache', Vary: 'Accept-Language' });
  }
  const file = path.normalize(path.join(cfg.PUBLIC_DIR, rel));
  if (!file.startsWith(cfg.PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Nicht gefunden');
    send(res, 200, data, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const ip = auth.clientIp(req);
    if (!cfg.ALLOW_ANY && !auth.isPrivate(ip)) return send(res, 403, 'Nur aus dem lokalen Netzwerk oder per VPN erreichbar.');
    if (!auth.hostAllowed(req)) return send(res, 403, 'Host nicht erlaubt. Trage den Namen in ALLOWED_HOSTS ein (z. B. ALLOWED_HOSTS=gutkeeper.fritz.box) oder rufe die App per IP-Adresse auf.');
    const origin = auth.corsOrigin(req); // eigenständige App auf einer anderen Herkunft (CORS_ORIGINS)
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Session-Token');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); res.setHeader('Access-Control-Max-Age', '600');
        res.statusCode = 204; return res.end();
      }
    }
    if (auth.crossSite(req)) return send(res, 403, 'Anfrage von fremder Seite abgelehnt.');
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url, ip);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.includes('\0')) return send(res, 404, 'Nicht gefunden');
    return serveStatic(res, pathname, langOf(req));
  } catch (err) {
    const status = err.status || (err instanceof URIError ? 400 : 500); // 413 zu große Anfrage, 400 fehlerhafte Eingabe, sonst 500
    if (status >= 500) console.error(err);
    if (res.headersSent) return res.destroy();
    send(res, status, status === 413 ? 'Anfrage zu groß' : status === 400 ? 'Ungültige Anfrage' : 'Interner Fehler');
  }
});

bk.dailyBackup();
setInterval(bk.dailyBackup, 600 * 1000).unref(); // prüft alle 10 Minuten, ob ein automatisches Backup fällig ist
server.listen(cfg.PORT, '0.0.0.0', () => {
  if (process.env.NO_AUTH === '1' && cfg.MULTIUSER) log.warn('Hinweis: NO_AUTH wird bei MULTIUSER=1 ignoriert.', 'Note: NO_AUTH is ignored when MULTIUSER=1.');
  if (cfg.NO_AUTH) log.warn('ACHTUNG: NO_AUTH=1 – der Server läuft ohne Anmeldung (nur für lokale Tests, nie im Betrieb).', 'WARNING: NO_AUTH=1: the server runs without sign-in (for local tests only, never in production).');
  if (cfg.NO_AUTH && !cfg.ALLOWED_HOSTS.length) log.warn('Hinweis: Ohne Anmeldung ist der Zugriff nur per IP-Adresse oder localhost möglich (Schutz vor DNS-Rebinding). Für einen Hostnamen setze ALLOWED_HOSTS, z. B. ALLOWED_HOSTS=gutkeeper.fritz.box.',
    'Note: Without sign-in, access is only possible via IP address or localhost (protection against DNS rebinding). To use a hostname, set ALLOWED_HOSTS, e.g. ALLOWED_HOSTS=gutkeeper.fritz.box.');
  if (cfg.TRUST_PROXY && !cfg.TRUSTED_PROXY.length) log.warn('Hinweis: TRUST_PROXY=1 ohne TRUSTED_PROXY: Jedes Gerät im privaten Netz könnte X-Real-IP fälschen. Setze TRUSTED_PROXY auf die Adresse(n) deines Proxys, z. B. TRUSTED_PROXY=172.18.0.0/16.',
    'Note: TRUST_PROXY=1 without TRUSTED_PROXY: any device on the private network could forge X-Real-IP. Set TRUSTED_PROXY to your proxy address(es), e.g. TRUSTED_PROXY=172.18.0.0/16.');
  if (auth.needsSetup()) auth.logSetup();
  log.info(
    `${cfg.APP_NAME} ${cfg.VERSION} läuft auf Port ${cfg.PORT} · Anmeldung: ${cfg.NO_AUTH ? 'aus (NO_AUTH)' : cfg.MULTIUSER ? 'Konten (Mehrbenutzer)' : 'Passwort'} · Icon: ${icons.name}${cfg.TRUST_PROXY ? ' · Proxy-IP aktiv' : ''}`,
    `${cfg.APP_NAME} ${cfg.VERSION} running on port ${cfg.PORT} · sign-in: ${cfg.NO_AUTH ? 'off (NO_AUTH)' : cfg.MULTIUSER ? 'accounts (multi-user)' : 'password'} · icon: ${icons.name}${cfg.TRUST_PROXY ? ' · proxy IP active' : ''}`);
});
const shutdown = () => { server.close(); db.close(); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
