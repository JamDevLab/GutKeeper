// Tests für die Verbindung der eigenständigen App (andere Herkunft): CORS, Bearer-Token
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const procs = [];
let port = 9600 + Math.floor(Math.random() * 300);
after(() => procs.forEach((p) => p.kill()));
const PW = 'Sehr-geheim-123';
// Startet einen Server mit Anmeldung, richtet das Passwort mit dem Einmal-Code aus dem Log ein und liefert die Adresse
function start(env = {}) {
  const p0 = port++, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-r-'));
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'server/index.js')], { env: { ...process.env, DATA_DIR: dir, PORT: String(p0), ALLOW_ANY: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    procs.push(p); let out = '';
    const on = (d) => {
      out += d;
      if (!out.includes('läuft auf Port')) return;
      const base = `http://127.0.0.1:${p0}`, token = (out.match(/Einmal-Code für die Einrichtung: (\w+)/) || [])[1];
      fetch(base + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: token, password: PW }) }).then(() => resolve(base), reject);
    };
    p.stdout.on('data', on); p.stderr.on('data', on);
    p.on('exit', (c) => reject(new Error('Server beendet: ' + c + out)));
    setTimeout(() => reject(new Error('Server startet nicht')), 15000);
  });
}
const APP = 'https://localhost';
const SECRET = 'remote-test-geheimnis';
const call = (base, method, url, { body, origin, bearer, site } = {}) => fetch(base + url, {
  method, headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}), ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}), ...(site ? { 'Sec-Fetch-Site': site } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const entry = (id) => ({ id, date: '2026-11-10', time: '08:30', consistency: 4, urge: 1, amount: 2, blood: 0, pain: 0, mucus: 0, luft: 0, color: 1, note: '', updated_at: Date.now(), deleted: 0 });

test('CORS: nur ausdrücklich erlaubte Herkunft, Vorabfrage (OPTIONS) und Token nur auf Verlangen', async () => {
  const base = await start({ SESSION_SECRET: SECRET, CORS_ORIGINS: 'https://localhost/, https://app.example.org' });
  // Vorabfrage einer erlaubten Herkunft
  const pre = await call(base, 'OPTIONS', '/api/login', { origin: APP });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), APP);
  assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/);
  // Fremde Herkunft: keine CORS-Header
  const bad = await call(base, 'GET', '/api/health', { origin: 'https://evil.example' });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
  // Erlaubte Herkunft bekommt Header auf normalen Antworten
  const ok = await call(base, 'GET', '/api/health', { origin: APP });
  assert.equal(ok.headers.get('access-control-allow-origin'), APP);
  assert.match(ok.headers.get('vary') || '', /Origin/);

  // Anmeldung: ohne bearer:true kein Token; falsches Passwort abgelehnt
  assert.equal((await call(base, 'POST', '/api/login', { origin: APP, body: { password: 'falsch-falsch', bearer: true } })).status, 401);
  const plain = await (await call(base, 'POST', '/api/login', { origin: APP, body: { password: PW } })).json();
  assert.equal(plain.token, undefined);
  // Mit bearer:true von erlaubter Herkunft: Token
  const login = await (await call(base, 'POST', '/api/login', { origin: APP, body: { password: PW, bearer: true } })).json();
  assert.ok(login.token && login.token.split('.').length === 4);
  // Von nicht erlaubter Herkunft (z. B. „same-origin“ im Browser, ohne Origin) wird kein Token herausgegeben
  const noOrigin = await (await call(base, 'POST', '/api/login', { body: { password: PW, bearer: true } })).json();
  assert.equal(noOrigin.token, undefined);
  const evil = await call(base, 'POST', '/api/login', { origin: 'https://evil.example', site: 'cross-site', body: { password: PW, bearer: true } });
  assert.equal(evil.status, 403, 'fremde Seite wird als Cross-Site abgelehnt');

  // Bearer-Token statt Cookie
  assert.equal((await call(base, 'GET', '/api/me', { origin: APP })).status, 401);
  assert.equal((await call(base, 'GET', '/api/me', { origin: APP, bearer: 'x.y.z.w' })).status, 401);
  assert.equal((await call(base, 'GET', '/api/me', { origin: APP, bearer: login.token })).status, 200);
  const sync = await call(base, 'POST', '/api/sync', { origin: APP, bearer: login.token, site: 'cross-site', body: { since: 0, epoch: null, changes: [entry('remote-0001')] } });
  assert.equal(sync.status, 200, 'Sync mit Token von erlaubter Herkunft');
  const list = await (await call(base, 'GET', '/api/entries?from=2000-01-01&to=2999-12-31', { origin: APP, bearer: login.token })).json();
  assert.deepEqual(list.entries.map((e) => e.id), ['remote-0001']);
  // Schreiben ohne Token von fremder Seite bleibt verboten
  assert.equal((await call(base, 'POST', '/api/sync', { site: 'cross-site', body: { since: 0, changes: [] } })).status, 403);
});

test('ohne CORS_ORIGINS: keine CORS-Header, kein Token', async () => {
  const base = await start();
  const r = await call(base, 'POST', '/api/login', { origin: APP, body: { password: PW, bearer: true } });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  assert.equal((await r.json()).token, undefined);
  assert.equal((await call(base, 'OPTIONS', '/api/login', { origin: APP })).headers.get('access-control-allow-origin'), null);
});

test('gleitende Sitzung per Token: ein altes Token wird über X-Session-Token erneuert, der Header ist für die App lesbar', async () => {
  const base = await start({ SESSION_SECRET: SECRET, CORS_ORIGINS: APP });
  const login = await (await call(base, 'POST', '/api/login', { origin: APP, body: { password: PW, bearer: true } })).json();
  const [uid, ver] = login.token.split('.');
  const old = (() => { // vor 90 Tagen ausgestellt: Ablauf in 90 Tagen
    const body = `${uid}.${ver}.${Date.now() + 90 * 86400000}`;
    return `${body}.${crypto.createHmac('sha256', crypto.createHash('sha256').update(SECRET).digest()).update(body).digest('base64url')}`;
  })();
  const fresh = await call(base, 'GET', '/api/me', { origin: APP, bearer: login.token });
  assert.equal(fresh.status, 200); assert.equal(fresh.headers.get('x-session-token'), null, 'frisches Token: keine Erneuerung');
  const r = await call(base, 'GET', '/api/me', { origin: APP, bearer: old });
  assert.equal(r.status, 200);
  const renewed = r.headers.get('x-session-token');
  assert.ok(renewed && renewed.split('.').length === 4, 'neues Token');
  assert.match(r.headers.get('access-control-expose-headers'), /X-Session-Token/, 'für die App lesbar');
  assert.equal((await call(base, 'GET', '/api/me', { origin: APP, bearer: renewed })).status, 200);
});

test('Abmelden mit Bearer-Token beendet das Token serverseitig (Sitzungszähler des Kontos steigt)', async () => {
  const base = await start({ SESSION_SECRET: SECRET, CORS_ORIGINS: APP });
  const login = await (await call(base, 'POST', '/api/login', { origin: APP, body: { password: PW, bearer: true } })).json();
  assert.equal((await call(base, 'GET', '/api/me', { origin: APP, bearer: login.token })).status, 200);
  assert.equal((await call(base, 'POST', '/api/logout', { origin: APP, bearer: login.token, body: {} })).status, 200);
  assert.equal((await call(base, 'GET', '/api/me', { origin: APP, bearer: login.token })).status, 401, 'Token nach dem Abmelden ungültig');
});
