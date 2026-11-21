// Erzeugt das GitHub-Social-Preview-Bild (1280x640) nach docs/social-preview.png.
// Aufruf: node tools/make-social.js   (Browser wird gesucht; sonst CHROME=<Pfad>)
// Braucht keinen Server und keine npm-Pakete: Die Seite wird per CDP direkt in Chrome gesetzt,
// Bilder werden als data:-URIs eingebettet.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'social-preview.png');
const BROWSERS = [process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/chromium',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
const browser = BROWSERS.find((b) => b && fs.existsSync(b));
if (!browser) { console.error('Kein Chrome/Edge gefunden (Umgebungsvariable CHROME setzen).'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dataUri = (file) => 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, file)).toString('base64');
const icon = dataUri('public/icons/bristol/icon-512.png');
const sheet = dataUri('docs/screenshots/en/uebersicht.png');

// Ein Handy ist im Composite 360x740 Pixel groß; x = linke Kante, y = 20. Verkleinert auf 220x452, füllt den Rahmen (innen 220x452) genau aus
const phone = (x, cls) => `<div class="phone ${cls}"><div class="shot" style="background-position:-${x}px -20px"></div></div>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1280px;height:640px;overflow:hidden}
body{font-family:"Noto Sans","DejaVu Sans",sans-serif;color:#e6efec;position:relative;
  background:radial-gradient(900px 600px at 85% 40%,#1c332d 0%,#0f1514 70%)}
.left{position:absolute;left:64px;top:40px;bottom:40px;width:560px;display:flex;flex-direction:column;justify-content:center}
.icon{width:140px;height:140px;border-radius:32px;box-shadow:0 10px 30px rgba(0,0,0,.5)}
h1{font-size:80px;font-weight:800;letter-spacing:-2px;line-height:1;margin-top:36px}
.tag{font-size:38px;font-weight:600;color:#6cc4a8;margin-top:16px}
.sub{font-size:23px;line-height:1.45;color:#8fa39d;margin-top:22px;max-width:520px}
.foot{position:absolute;left:64px;bottom:40px;font-size:19px;color:#8fa39d;letter-spacing:.3px}
.foot b{color:#4fa68c}
.phone{position:absolute;width:226px;height:458px;border-radius:26px;border:3px solid #34453f;background:#0f1514;
  overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.6)}
.shot{width:360px;height:740px;transform:scale(.6111);transform-origin:0 0;background-image:url(${sheet});background-repeat:no-repeat}
.p1{left:668px;top:95px;transform:rotate(-5deg);z-index:1}
.p2{left:808px;top:77px;transform:rotate(0deg);z-index:3}
.p3{left:948px;top:95px;transform:rotate(5deg);z-index:2}
</style></head><body>
<div class="left">
  <img class="icon" src="${icon}">
  <h1>GutKeeper</h1>
  <div class="tag">Self-hosted bowel diary</div>
  <div class="sub">Offline-first PWA &amp; Android app<br>Sync &middot; end&#8209;to&#8209;end encryption &middot; PDF reports</div>
</div>
<div class="foot"><b>Open source</b> &middot; AGPL-3.0 &middot; Docker &middot; Android APK</div>
${phone(780, 'p1')}${phone(400, 'p3')}${phone(20, 'p2')}
</body></html>`;

(async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'social-'));
  const CDP = 9300 + Math.floor(Math.random() * 500);
  const chrome = spawn(browser, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${path.join(dir, 'profile')}`,
    '--no-first-run', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => { chrome.kill(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* egal */ } };
  process.on('exit', cleanup);
  try {
    let targets;
    for (let i = 0; i < 50 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch { await sleep(200); } }
    const page = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));
    let id = 0; const pending = new Map();
    ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const [res, rej] = pending.get(d.id); pending.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); } });
    const cdp = (method, params = {}) => new Promise((res, rej) => { const n = ++id; pending.set(n, [res, rej]); ws.send(JSON.stringify({ id: n, method, params })); });
    await cdp('Page.enable');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 640, deviceScaleFactor: 1, mobile: false });
    const { frameTree } = await cdp('Page.getFrameTree');
    await cdp('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
    await sleep(800);
    const r = await cdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT, Buffer.from(r.data, 'base64'));
    console.log('Geschrieben:', OUT, fs.statSync(OUT).size, 'Bytes');
  } finally { cleanup(); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
