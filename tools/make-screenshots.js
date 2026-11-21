// Erzeugt die Screenshots für die README (docs/screenshots/) mit einem headless Chrome/Edge – ohne npm-Pakete.
// Aufruf: node tools/make-screenshots.js        (Browser wird gesucht; sonst CHROME=<Pfad zur chrome.exe/msedge.exe>)
//         node tools/make-screenshots.js --en   (englische Oberfläche; es entsteht nur docs/screenshots/en/uebersicht.png für die englische README)
// Es startet einen Wegwerf-Server mit den Demodaten aus docs/demo-data.csv (Datum so verschoben, dass der letzte Eintrag „gestern“ ist).
// Standard ist der Dunkelmodus; die Startseite gibt es zusätzlich hell, und uebersicht.png fasst fünf Ansichten zusammen.
// Dazu entsteht ein Beispiel-Bericht: docs/beispiel-bericht.pdf (englisch: docs/example-report.pdf) samt Vorschau von Seite 1
// (docs/screenshots/beispiel-bericht.png bzw. docs/screenshots/en/example-report.png).
// Zum Schluss wird „Essen aufzeichnen“ eingeschaltet (Demo-Mahlzeiten der letzten Wochen): essen-*.png und uebersicht-essen.png.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const EN = process.argv.includes('--en');
const OUT = path.join(ROOT, 'docs', 'screenshots', EN ? 'en' : '');
// Beschriftungen für die Bedienung: im englischen Lauf die Übersetzung aus public/js/lang-en.js
const EN_MAP = {};
if (EN) for (const m of fs.readFileSync(path.join(ROOT, 'public', 'js', 'lang-en.js'), 'utf8').matchAll(/^\s*"((?:[^"\\]|\\.)*)":\s*"((?:[^"\\]|\\.)*)",?\s*$/gm)) EN_MAP[JSON.parse('"' + m[1] + '"')] = JSON.parse('"' + m[2] + '"');
const L = (de) => (EN && EN_MAP[de]) || de;
const NOTES_EN = { 'Alkohol am Abend': 'Alcohol in the evening', 'Fettiges Essen': 'Fatty food', 'Kaffee': 'Coffee', 'Krank, Magen-Darm': 'Sick, stomach bug', 'Reise': 'Travel', 'Sport': 'Exercise', 'Stress im Job': 'Stress at work', 'Viel Ballaststoffe': 'Lots of fiber', 'neues Medikament': 'New medication' };
const PORT = 9790 + Math.floor(Math.random() * 100), CDP = 9400 + Math.floor(Math.random() * 100);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BROWSERS = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
const browser = BROWSERS.find((b) => b && fs.existsSync(b));
if (!browser) { console.error('Kein Chrome/Edge gefunden (Umgebungsvariable CHROME setzen).'); process.exit(1); }

// ---- Demodaten einlesen und in die Gegenwart verschieben ----
const COLORS = { braun: 1, hell: 2, gelb: 3, 'grün': 4, schwarz: 5, rot: 6 };
function demoEntries() {
  const lines = fs.readFileSync(path.join(ROOT, 'docs', 'demo-data.csv'), 'utf8').replace(/^\ufeff/, '').trim().split(/\r?\n/);
  const head = lines.shift().split(';');
  const rows = lines.map((l) => Object.fromEntries(l.split(';').map((v, i) => [head[i], v])));
  const last = rows.map((r) => r.datum).sort().pop();
  const day = 86400000, ymd = (d) => d.toISOString().slice(0, 10);
  const target = new Date(Date.now() - day); // letzter Eintrag = gestern
  const shift = Math.round((Date.UTC(target.getFullYear(), target.getMonth(), target.getDate()) - Date.parse(last + 'T00:00:00Z')) / day);
  const yn = (v) => (v === 'ja' ? 1 : 0);
  return rows.map((r, i) => ({
    id: 'demo-' + String(i).padStart(4, '0'), date: ymd(new Date(Date.parse(r.datum + 'T00:00:00Z') + shift * day)), time: r.uhrzeit,
    consistency: Number(r.konsistenz) || 0, urge: Number(r.stuhldrang) || 0, amount: Number(r.menge) || 0, blood: yn(r.blut), pain: Number(r.schmerz) || 0,
    mucus: yn(r.schleim), luft: yn(r.luft), color: COLORS[r.farbe] || 0, note: EN ? (NOTES_EN[r.notiz] || r.notiz || '') : (r.notiz || ''), updated_at: Date.now(), deleted: 0,
  }));
}

// Demo-Mahlzeiten der letzten fünf Wochen bis gestern (Frühstück, Mittag, Abend, ab und zu Snack/Getränk)
function demoFoods() {
  const de = { 1: ['Müsli mit Joghurt', 'Brot mit Käse', 'Haferbrei mit Banane', 'Brötchen mit Marmelade'],
    2: ['Spaghetti Bolognese', 'Salat mit Hähnchen', 'Linsensuppe', 'Reis mit Gemüse', 'Pizza', 'Currywurst mit Pommes'],
    3: ['Brot mit Wurst', 'Gemüsepfanne', 'Lachs mit Kartoffeln', 'Chili con Carne', 'Burger', 'Tomatensuppe'],
    4: ['Apfel', 'Schokolade', 'Nüsse'], 5: ['Kaffee', 'Bier', 'Cola'] };
  const en = { 1: ['Muesli with yogurt', 'Bread with cheese', 'Oatmeal with banana', 'Roll with jam'],
    2: ['Spaghetti bolognese', 'Chicken salad', 'Lentil soup', 'Rice with vegetables', 'Pizza', 'Currywurst with fries'],
    3: ['Bread with ham', 'Stir-fried vegetables', 'Salmon with potatoes', 'Chili con carne', 'Burger', 'Tomato soup'],
    4: ['Apple', 'Chocolate', 'Nuts'], 5: ['Coffee', 'Beer', 'Cola'] };
  const names = EN ? en : de, times = { 1: '07:30', 2: '12:40', 3: '19:00', 4: '15:30', 5: '10:15' };
  const out = [], day = 86400000;
  for (let k = 1; k <= 35; k++) {
    const date = new Date(Date.now() - k * day).toISOString().slice(0, 10);
    for (const meal of [1, 2, 3, 4, 5]) {
      if ((meal === 4 && k % 3) || (meal === 5 && k % 2)) continue; // Snack jeden dritten, Getränk jeden zweiten Tag
      const list = names[meal];
      out.push({ id: `food-${k}-${meal}`.padEnd(10, '0'), date, time: times[meal], meal, text: list[(k * 7 + meal * 3) % list.length], updated_at: Date.now(), deleted: 0 });
    }
  }
  return out;
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-shots-'));
  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'server', 'index.js')],
    { env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), ALLOW_ANY: '1', NO_AUTH: '1', ONBOARDING: '0' }, stdio: 'ignore' });
  const chrome = spawn(browser, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${path.join(dataDir, 'profile')}`, '--no-first-run', '--disable-gpu',
    '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => { server.kill(); chrome.kill(); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* egal */ } };
  process.on('exit', cleanup);
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) break; } catch { /* startet noch */ } await sleep(200); }
    const sync = await fetch(`http://127.0.0.1:${PORT}/api/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ since: 0, changes: demoEntries(), foodSince: 0, foodChanges: demoFoods() }) });
    if (!sync.ok) throw new Error('Demodaten konnten nicht geladen werden: ' + sync.status);

    let targets;
    for (let i = 0; i < 50 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch { await sleep(200); } }
    const page = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));
    let id = 0; const pending = new Map();
    ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const [res, rej] = pending.get(d.id); pending.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); } });
    const cdp = (method, params = {}) => new Promise((res, rej) => { const n = ++id; pending.set(n, [res, rej]); ws.send(JSON.stringify({ id: n, method, params })); });
    const js = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
    const ua = (await cdp('Browser.getVersion')).userAgent;
    await cdp('Page.enable');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 2, mobile: true });
    await cdp('Emulation.setUserAgentOverride', { userAgent: ua, acceptLanguage: EN ? 'en-US' : 'de-DE' });
    await cdp('Emulation.setTimezoneOverride', { timezoneId: 'Europe/Berlin' });
    const scheme = (v) => cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: v }] });

    const tab = (name) => js(`document.querySelector('.tabs button[data-tab="${name}"]').click()`).then(() => sleep(900));
    // nur sichtbare Elemente (die Ansichten der anderen Tabs liegen versteckt im Dokument)
    const visible = `const vis = (x) => x.offsetParent !== null;`;
    const chip = (text) => js(`(() => { ${visible} const b = [...document.querySelectorAll('button')].find((x) => vis(x) && (x.textContent.trim() === ${JSON.stringify(text)} || (x.classList.contains('menurow') && x.textContent.trim().startsWith(${JSON.stringify(text)})))); if (b) b.click(); return !!b; })()`).then(() => sleep(900));
    const scrollTo = (text) => js(`(() => { ${visible} const e = [...document.querySelectorAll('*')].find((x) => vis(x) && [...x.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() === ${JSON.stringify(text)})); if (!e) return false; let p = e.parentElement; while (p && p.scrollHeight <= p.clientHeight + 1) p = p.parentElement; if (p) p.scrollTop += e.getBoundingClientRect().top - p.getBoundingClientRect().top - 12; return !!p; })()`).then(async (v) => { await sleep(600); return v; });
    const shot = async (name) => { const r = await cdp('Page.captureScreenshot', { format: 'png' }); const buf = Buffer.from(r.data, 'base64'); if (!EN) fs.writeFileSync(path.join(OUT, name), buf); // englisch: nur die Übersicht wird gespeichert
      console.log(name); return r.data; };
    const open = async (dark) => {
      await scheme(dark ? 'dark' : 'light');
      await cdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
      await sleep(3500); // laden und abgleichen
    };

    fs.mkdirSync(OUT, { recursive: true });
    for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.rmSync(path.join(OUT, f));
    await open(true);
    const s = {};
    s.erfassen = await shot('erfassen.png');
    await tab('hist'); await chip(L('30 Tage')); s.verlauf = await shot('verlauf.png');
    await chip(L('Jahr')); await shot('jahresuebersicht.png');
    await tab('stat'); await chip(L('30 Tage')); s.statistik = await shot('statistik.png');
    console.log('scroll:', await scrollTo(L('Kalender'))); await shot('statistik-kalender.png');
    // Rückblick teilen: Dialog und das erzeugte Bild
    await js(`document.querySelector('#vStat .rewind-btn').click()`); await sleep(1200);
    await js(`[...document.querySelectorAll('.sheet.rewind > .chips .chip')][1].click()`); await sleep(600); // 1 Monat
    await shot('rueckblick-dialog.png');
    const rw = await js(`document.querySelector('.rewind-img').src`);
    if (rw) fs.writeFileSync(path.join(OUT, 'rueckblick.png'), Buffer.from(rw.split(',')[1], 'base64'));
    // Weitere Designs (über die Punkte): Kalender mit 1 Monat, dann alle mit „1 Jahr“; danach zurück auf das erste Design
    const saveImg = async (name) => { const src = await js(`document.querySelector('.rewind-img').src`); if (src) fs.writeFileSync(path.join(OUT, name), Buffer.from(src.split(',')[1], 'base64')); };
    await js(`document.querySelectorAll('.rewind-dot')[4].click()`); await sleep(900); await saveImg('rueckblick-kalender-monat.png');
    await js(`[...document.querySelectorAll('.sheet.rewind > .chips .chip')][2].click()`); await sleep(600);
    for (const [i, name] of [[1, 'rueckblick-skala.png'], [2, 'rueckblick-formen.png'], [3, 'rueckblick-tageszeit.png'], [4, 'rueckblick-kalender.png']]) {
      await js(`document.querySelectorAll('.rewind-dot')[${i}].click()`); await sleep(900); await saveImg(name);
    }
    await js(`document.querySelectorAll('.rewind-dot')[0].click()`); await sleep(300);
    await js(`document.querySelector('.overlay').remove()`); await sleep(300);
    await tab('data'); s.optionen = await shot('optionen.png');
    await chip(L('Sicherung und Import')); await scrollTo(L('Sichern (Export)')); await shot('sichern.png');
    await open(false);
    s.hell = await shot('erfassen-hell.png');

    // Essen aufzeichnen einschalten: Erfassen im Essens-Modus, Verlauf mit beidem, Detailansicht „Essen davor“
    await fetch(`http://127.0.0.1:${PORT}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ food: true }) });
    await open(true);
    await js(`document.querySelector('#modeBtn').click()`); await sleep(900);
    s.essen = await shot('essen-erfassen.png');
    await tab('hist'); await chip(L('30 Tage')); await chip(L('Beides')); s.essenVerlauf = await shot('essen-verlauf.png');
    await js(`(() => { const r = [...document.querySelectorAll('.srow')].find((x) => x.offsetParent !== null && !x.classList.contains('food')); r.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`); await sleep(1200);
    s.essenDetail = await shot('essen-detail.png');

    // Übersicht: fünf Ansichten nebeneinander (vier dunkel, die Startseite zusätzlich hell)
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1920, height: 780, deviceScaleFactor: 1, mobile: false });
    await cdp('Page.navigate', { url: 'about:blank' }); await sleep(500);
    const list = [s.erfassen, s.verlauf, s.statistik, s.optionen, s.hell];
    const url = await js(`(async () => {
      const imgs = await Promise.all(${JSON.stringify(list)}.map((b) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + b; })));
      const c = document.createElement('canvas'); c.width = 1920; c.height = 780; const x = c.getContext('2d');
      imgs.forEach((im, k) => { x.save(); x.beginPath(); x.roundRect(20 + k * 380, 20, 360, 740, 16); x.clip(); x.drawImage(im, 20 + k * 380, 20, 360, 740); x.restore(); });
      return c.toDataURL('image/png');
    })()`);
    fs.writeFileSync(path.join(OUT, 'uebersicht.png'), Buffer.from(url.split(',')[1], 'base64'));
    console.log('uebersicht.png');
    // zweite Übersicht mit Essen: drei Ansichten
    const url2 = await js(`(async () => {
      const imgs = await Promise.all(${JSON.stringify([s.essen, s.essenVerlauf, s.essenDetail])}.map((b) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + b; })));
      const c = document.createElement('canvas'); c.width = 1160; c.height = 780; const x = c.getContext('2d');
      imgs.forEach((im, k) => { x.save(); x.beginPath(); x.roundRect(20 + k * 380, 20, 360, 740, 16); x.clip(); x.drawImage(im, 20 + k * 380, 20, 360, 740); x.restore(); });
      return c.toDataURL('image/png');
    })()`);
    fs.writeFileSync(path.join(OUT, 'uebersicht-essen.png'), Buffer.from(url2.split(',')[1], 'base64'));
    console.log('uebersicht-essen.png');

    // Beispiel-Bericht (ausführlich, mit Essen) der letzten vier Wochen: im Browser erzeugen, als Base64 zurückholen
    await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 2, mobile: true });
    await open(true);
    const b64 = await js(`(async () => {
      const m = await import('/js/report.js');
      const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      const to = ymd(new Date(Date.now() - 86400000)), from = ymd(new Date(Date.now() - 28 * 86400000));
      const r = await m.buildReport(from, to, 'full', { name: 'Max Mustermann', birth: '01.02.1980', food: true });
      const bytes = new Uint8Array(await r.blob.arrayBuffer());
      let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    })()`);
    if (typeof b64 !== "string") throw new Error("Bericht fehlgeschlagen: " + JSON.stringify(b64));
    const pdfPath = path.join(ROOT, 'docs', EN ? 'example-report.pdf' : 'beispiel-bericht.pdf');
    fs.writeFileSync(pdfPath, Buffer.from(b64, 'base64'));
    console.log(path.relative(ROOT, pdfPath));
    // Vorschau: PDF im Browser öffnen (Seite 1, ohne Werkzeugleiste, Seitenbreite) und fotografieren
    await cdp('Emulation.setDeviceMetricsOverride', { width: 900, height: 1270, deviceScaleFactor: 1, mobile: false });
    await cdp('Page.navigate', { url: 'file://' + pdfPath + '#toolbar=0&navpanes=0&view=FitH&page=1' });
    await sleep(3000);
    const prev = await cdp('Page.captureScreenshot', { format: 'png' });
    const prevPath = path.join(OUT, EN ? 'example-report.png' : 'beispiel-bericht.png');
    fs.writeFileSync(prevPath, Buffer.from(prev.data, 'base64'));
    console.log(path.relative(ROOT, prevPath), Math.round(fs.statSync(prevPath).size / 1024) + ' KB');
    ws.close();
  } finally { cleanup(); }
})().catch((e) => { console.error(e); process.exit(1); });
