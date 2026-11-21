// Konsistenz der Oberfläche (ohne Browser): Übersetzungen, Service-Worker-Liste, Syntax aller Client-Module
// Fängt Fehler, die sonst erst im Browser auffallen (z. B. fehlende englische Texte oder ein vergessener Eintrag im Service Worker).
// Aufruf: npm test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'public', 'js');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js'));
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');

// Schlüssel und Werte von lang-en.js ("Deutsch": "English",)
function enMap() {
  const map = new Map();
  for (const m of read('lang-en.js').matchAll(/^\s*"((?:[^"\\]|\\.)*)":\s*"((?:[^"\\]|\\.)*)",?\s*$/gm)) map.set(JSON.parse('"' + m[1] + '"'), JSON.parse('"' + m[2] + '"'));
  return map;
}

test('Jeder Text in t(\'…\') hat eine englische Übersetzung', () => {
  const en = enMap();
  const missing = [];
  for (const f of files) {
    if (f === 'lang-en.js') continue;
    for (const m of read(f).matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) {
      const key = m[1].replace(/\\'/g, "'");
      if (!en.has(key)) missing.push(`${f}: ${key.slice(0, 80)}`);
    }
  }
  assert.deepEqual(missing, [], 'fehlende Einträge in public/js/lang-en.js');
});

test('Übersetzungen: nicht leer, Platzhalter {x} stimmen überein', () => {
  const bad = [];
  for (const [de, en] of enMap()) {
    const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
    if (!en.trim()) bad.push(`leer: ${de.slice(0, 60)}`);
    else if (ph(de) !== ph(en)) bad.push(`Platzhalter: ${de.slice(0, 60)}`);
  }
  assert.deepEqual(bad, []);
});

test('Service Worker: alle Client-Dateien stehen in der Liste, und jede Datei der Liste existiert', () => {
  const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  const shell = [...sw.matchAll(/'((?:js\/)?[\w.-]+\.(?:js|css|html|webmanifest))'/g)].map((m) => m[1]);
  const notListed = files.filter((f) => !shell.includes('js/' + f));
  assert.deepEqual(notListed, [], 'fehlt in SHELL (public/sw.js)');
  const gone = shell.filter((p) => !fs.existsSync(path.join(__dirname, '..', 'public', p)));
  assert.deepEqual(gone, [], 'in SHELL, aber nicht vorhanden');
});

test('Alle Client-Module sind syntaktisch gültig (ES-Module)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-syntax-'));
  try {
    const errors = [];
    for (const f of files) {
      const copy = path.join(tmp, f.replace(/\.js$/, '.mjs'));
      fs.writeFileSync(copy, read(f));
      const r = spawnSync(process.execPath, ['--check', copy], { encoding: 'utf8' });
      if (r.status !== 0) errors.push(`${f}: ${(r.stderr || '').split('\n').find((l) => /Error/.test(l)) || r.stderr}`);
    }
    assert.deepEqual(errors, []);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('Kein Offline-Prüfwert (verifier) und keine PIN/PASSWORD-Variablen mehr in Server und Oberfläche', () => {
  const hits = [];
  const dirs = [[path.join(__dirname, '..', 'server'), /\bverifier(For)?\b|process\.env\.(PIN|PASSWORD|PIN_REMEMBER)\b|env\.(PIN|PASSWORD)\b/], [DIR, /\bverifier\b|derive\(/]];
  for (const [dir, re] of dirs) {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js') && x !== 'lang-en.js')) {
      if (re.test(fs.readFileSync(path.join(dir, f), 'utf8'))) hits.push(f);
    }
  }
  assert.deepEqual(hits, []);
});

test('Serverlose Version: der Marker (Meta-Tag) für den geführten Einstieg ist standardmäßig da, ONBOARDING=0 lässt ihn weg', () => {
  const build = (env) => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-static-'));
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'build-static.js')], { env: { ...process.env, ONBOARDING: '', ...env, OUT: out }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    const files = fs.existsSync(path.join(out, 'js', 'onboarding.js'));
    fs.rmSync(out, { recursive: true, force: true });
    return { html, files };
  };
  const on = build({}), off = build({ ONBOARDING: '0' });
  assert.ok(on.html.includes('<meta name="gutkeeper-onboarding" content="1">'));
  assert.ok(!off.html.includes('gutkeeper-onboarding'));
  assert.ok(on.files && off.files, 'das Modul ist in beiden Versionen enthalten');
  assert.ok(read('net.js').includes('meta[name="gutkeeper-onboarding"]'), 'die App liest denselben Meta-Tag');
});
