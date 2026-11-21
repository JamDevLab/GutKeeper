// Erzeugt die eingebauten App-Icons nach public/icons/<set>/ (icon-192.png, icon-512.png, icon-maskable-512.png).
// Aufruf: TMPDIR=<Ordner> node tools/make-icons.js [set …]   (ohne Angabe: alle Sets; Browser wird gesucht, sonst CHROME=<Pfad>)
// Braucht keine npm-Pakete: Die Motive sind SVG, Chrome rendert sie per CDP (wie tools/make-social.js).
//
// Eigenes Icon? Du brauchst dieses Skript nicht: Lege ein quadratisches PNG (mind. 512x512) als
// data/icon.png ab und setze APP_ICON=custom. Optional data/icon-maskable.png (Motiv im inneren 60 %).
//
// Aufbau: Jedes Motiv ist eine Funktion (bg) => SVG-Markup für viewBox 0 0 512 512. Der Hintergrund wird
// vom Aufrufer gezeichnet und als Farbe übergeben (Aussparungen nutzen bg). Alle Motive sind um (0,0)
// gebaut und werden in die Bildmitte verschoben, deshalb sind alle Maße relativ zur Mitte.
// Zum Anpassen genügt meist eine Konstante.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const OUT = path.join(__dirname, '..', 'public', 'icons');
const SIZE = 512;
const BG = '#1f3d36'; // Bristol-Grün, Hintergrund aller Sets
const CORNER = 0.22; // Eckenradius des normalen Icons als Anteil der Kantenlänge
// Maskable: Motiv um die Mitte verkleinern, damit es im inneren 80-%-Kreis der Maske bleibt.
// Hinweis: tools/android-style.js legt für Android Adaptive Icons noch einmal 12 % Rand um das Motiv.
const MASKABLE_SCALE = 0.92;

// Farben
const CREAM = '#f4f1ea';
const MINT = '#a9e0cc'; // helles Mint als Zweitfarbe
const BRISTOL = ['#8a5a2b', '#a56d33', '#62a06f', '#2f8f6a', '#c9a227', '#d9772b', '#c24a3a']; // Bristol 1 bis 7

// --- Hilfsfunktionen -------------------------------------------------------------------------

const f = (n) => +n.toFixed(2);
// Motiv in die Bildmitte setzen (dx/dy: optische Feinkorrektur in Pixeln)
const centered = (inner, dx = 0, dy = 0) => `<g transform="translate(${SIZE / 2 + dx} ${SIZE / 2 + dy})">${inner}</g>`;
const dot = (x, y, r, color) => `<circle cx="${f(x)}" cy="${f(y)}" r="${r}" fill="${color}"/>`;
const pill = (x, y, w, h, color, extra = '') => `<rect x="${f(x)}" y="${f(y)}" width="${w}" height="${h}" rx="${h / 2}" fill="${color}" ${extra}/>`;

// Punkte auf einem Kreis (Start oben, im Uhrzeigersinn), Farbe i = Bristol-Typ i+1
function ringDots(cx, cy, R, r) {
  return BRISTOL.map((c, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / BRISTOL.length;
    return dot(cx + R * Math.cos(a), cy + R * Math.sin(a), r, c);
  }).join('');
}

// Zeilen mit Punkten, jede Zeile für sich waagerecht zentriert, Gruppe senkrecht zentriert
function dotRows(counts, pitch, rowGap, r, cy = 0) {
  let idx = 0;
  return counts.map((n, row) => {
    const y = cy + (row - (counts.length - 1) / 2) * rowGap;
    return [...Array(n)].map((_, i) => dot((i - (n - 1) / 2) * pitch, y, r, BRISTOL[idx++ % 7])).join('');
  }).join('');
}

// Schild (relativ zur Mitte): symmetrisch, Spitze unten
const SHIELD = {
  halfW: 104, // halbe Breite
  top: -122, // Oberkante (Mitte oben)
  shoulder: -96, // Höhe der oberen Ecken
  side: 6, // ab hier laufen die Seiten in die Rundung
  bottom: 128, // Spitze unten
  belly: 76, // Höhe, bei der die Rundung zur Spitze beginnt
  tip: 54, // Breite der Rundung kurz vor der Spitze
};
const shieldPath = () => {
  const s = SHIELD;
  return `M0 ${s.top}L${s.halfW} ${s.shoulder}V${s.side}C${s.halfW} ${s.belly} ${s.tip} ${s.bottom - 22} 0 ${s.bottom}`
    + `C${-s.tip} ${s.bottom - 22} ${-s.halfW} ${s.belly} ${-s.halfW} ${s.side}V${s.shoulder}Z`;
};
// Haken (relativ zur Mitte), bbox exakt zentriert
const checkPath = () => 'M-44 0L-12 32L44 -32';

// Drei Balken gestapelt, nach unten breiter (Farben oben nach unten)
function stackBars(colors) {
  const H = 84; // Balkenhöhe
  const GAP = 20; // Abstand
  const W = [200, 290, 380]; // Breiten oben nach unten
  const total = 3 * H + 2 * GAP;
  return centered(W.map((w, i) => pill(-w / 2, -total / 2 + i * (H + GAP), w, H, colors[i])).join(''), 0, -4);
}

// --- Die Sets (Ordnername -> Motiv) ------------------------------------------------------------

const designs = {
  // Bristol-Punkte in zwei Zeilen (4+3), Maße als Anteil von 512
  bristol: () => {
    const R = 0.088 * SIZE; // Punktradius
    const PITCH = 0.2 * SIZE; // Abstand der Punktmitten in der Zeile
    const ROW = 0.24 * SIZE; // Abstand der beiden Zeilen
    return centered(dotRows([4, 3], PITCH, ROW, R));
  },

  // Klassisch: drei Balken, Verlauf von kräftigem Mint über helles Mint nach Creme
  classic: () => stackBars(['#6cc4a8', '#bfe6d8', CREAM]),

  // Liste: drei Zeilen mit Punkt und Balken, Gesamtbreite exakt zentriert
  list: () => {
    const DOT_R = 32; // Punktradius
    const SPACE = 30; // Abstand Punkt zu Balken
    const BAR_H = 54;
    const WIDTHS = [260, 196, 228]; // Balkenlängen
    const PITCH = 122; // Zeilenabstand
    const total = 2 * DOT_R + SPACE + Math.max(...WIDTHS);
    const x0 = -total / 2;
    return centered(WIDTHS.map((w, i) => {
      const y = (i - 1) * PITCH;
      return dot(x0 + DOT_R, y, DOT_R, MINT) + pill(x0 + 2 * DOT_R + SPACE, y - BAR_H / 2, w, BAR_H, CREAM);
    }).join(''));
  },

  // Tagebuch: aufgeschlagenes Buch mit leicht gewölbten Seiten, Zeilen in Hintergrundfarbe, Lesezeichen
  diary: (bg) => {
    const K = 1.5; // Maßstab des ganzen Buchs
    const SPINE = 5; // halber Abstand der Seiten in der Mitte
    const OUT_X = 120; // äußere Kante (x)
    const TOP_IN = -66, TOP_OUT = -80; // Oberkante innen/außen (Wölbung)
    const BOT_IN = 86, BOT_OUT = 74;
    const page = (m) => `<path d="M${m * SPINE} ${TOP_IN}Q${m * 62} ${TOP_IN - 24} ${m * OUT_X} ${TOP_OUT}V${BOT_OUT}Q${m * 62} ${BOT_IN - 20} ${m * SPINE} ${BOT_IN}Z" fill="${CREAM}"/>`;
    const lines = (m) => [[-36, 84], [-4, 84], [28, 52]].map(([y, w]) => {
      const x = m > 0 ? SPINE + 18 : -(SPINE + 18 + w);
      return pill(x, y, w, 14, bg, 'opacity=".3"');
    }).join('');
    const mark = `<path d="M${SPINE + 62} ${TOP_IN - 14}h34v62l-17-14-17 14z" fill="#d9772b"/>`;
    return centered(`<g transform="scale(${K})">${page(-1) + page(1) + lines(-1) + lines(1) + mark}</g>`, 0, 4);
  },

  // Schild: cremefarbenes Schild mit Haken (Haken in Hintergrundfarbe ausgespart)
  shield: (bg) => centered(`<g transform="scale(1.45)">`
    + `<path d="${shieldPath()}" fill="${CREAM}" stroke="${CREAM}" stroke-width="12" stroke-linejoin="round"/>`
    + `<path d="${checkPath()}" fill="none" stroke="${bg}" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 -6)"/></g>`),

  // Kranz: Bristol-Punkte im Kreis, ohne Mittelpunkt
  ring: () => {
    const RING_R = 145; // Radius des Kranzes (Mitte der Punkte)
    const DOT_R = 48; // Punktradius
    return centered(ringDots(0, 0, RING_R, DOT_R));
  },

  // Wappen: nur Schild-Umriss, innen der farbige Kranz
  crest: () => {
    const K = 1.45; // Maßstab des Schilds
    const RING_R = 64, DOT_R = 21; // Kranz im Schild (vor Skalierung)
    return centered(`<g transform="scale(${K})"><path d="${shieldPath()}" fill="none" stroke="${CREAM}" stroke-width="14" stroke-linejoin="round"/>`
      + ringDots(0, -8, RING_R, DOT_R) + '</g>'); // Kranz leicht nach oben, weil das Schild unten spitz zuläuft
  },

  // Wächter: großer Punktkranz mit kleinem Schild in der Mitte (Abstand zu den Punkten ca. 30 px)
  guard: (bg) => {
    const RING_R = 150, DOT_R = 40; // Kranz
    const K = 0.55; // Maßstab des Schildes
    return centered(ringDots(0, 0, RING_R, DOT_R)
      + `<g transform="scale(${K})"><path d="${shieldPath()}" fill="${CREAM}" stroke="${CREAM}" stroke-width="12" stroke-linejoin="round"/>`
      + `<path d="${checkPath()}" fill="none" stroke="${bg}" stroke-width="30" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 -6)"/></g>`);
  },
};

// --- Rendern ---------------------------------------------------------------------------------

// SVG für eine Datei: maskable = Vollfläche + verkleinertes Motiv, sonst abgerundetes Quadrat
function svgFor(name, px, maskable) {
  const motif = designs[name](BG);
  const bgShape = maskable
    ? `<rect width="${SIZE}" height="${SIZE}" fill="${BG}"/>`
    : `<rect width="${SIZE}" height="${SIZE}" rx="${SIZE * CORNER}" fill="${BG}"/>`;
  const body = maskable ? `<g transform="translate(${SIZE / 2} ${SIZE / 2}) scale(${MASKABLE_SCALE}) translate(${-SIZE / 2} ${-SIZE / 2})">${motif}</g>` : motif;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${SIZE} ${SIZE}">${bgShape}${body}</svg>`;
}

const FILES = [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true]];

const BROWSERS = [process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/chromium',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
const browser = BROWSERS.find((b) => b && fs.existsSync(b));
if (!browser) { console.error('Kein Chrome/Edge gefunden (Umgebungsvariable CHROME setzen).'); process.exit(1); }
const sets = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(designs);
for (const s of sets) if (!designs[s]) { console.error(`Unbekanntes Set „${s}“. Verfügbar: ${Object.keys(designs).join(', ')}`); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'icons-'));
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
    await cdp('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } }); // transparente Ecken
    const { frameTree } = await cdp('Page.getFrameTree');
    for (const name of sets) {
      const folder = path.join(OUT, name);
      fs.mkdirSync(folder, { recursive: true });
      for (const [fname, px, maskable] of FILES) {
        await cdp('Emulation.setDeviceMetricsOverride', { width: px, height: px, deviceScaleFactor: 1, mobile: false });
        const html = `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0}html,body{background:transparent;overflow:hidden}svg{display:block}</style></head><body>${svgFor(name, px, maskable)}</body></html>`;
        await cdp('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
        await sleep(150);
        const r = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: px, height: px, scale: 1 }, fromSurface: true });
        fs.writeFileSync(path.join(folder, fname), Buffer.from(r.data, 'base64'));
      }
      console.log('erzeugt:', name);
    }
  } finally { cleanup(); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
