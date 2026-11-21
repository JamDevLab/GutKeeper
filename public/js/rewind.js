// Rückblick teilen (Statistik): erzeugt ein Bild der letzten 4 Wochen, 3 Monate oder des letzten Jahres zum Teilen.
// Bewusst zurückhaltend: keine Angaben zu Blut, Schleim, Schmerzen, Farbe, Essen oder Notizen und kein Name.
import { CONS } from './constants.js';
import { getRange } from './filters.js';
import { LOC, appName, clock12, t } from './i18n.js';
import { needFor, ensureRemote } from './remote.js';
import { S } from './state.js';
import { viewEntries } from './store.js';
import { download, shareNativeB64 } from './transfer.js';
import { isNative } from './native.js';
import { toast } from './ui.js';
import { DEV, ICON, addDays, el, fmtN, openOverlay, parseD, playAnim, todayStr, ymd } from './util.js';
import { sheetHead } from './form.js';

const W = 1080, H = 1350;
const PERIODS = ['7d', '1m', '1y', 'range'];
// Feste Zeiträume enden gestern: nur abgeschlossene Tage, damit der letzte Balken nicht halb leer ist.
// 1 Monat: vom gleichen Tag des Vormonats bis gestern (z. B. 21. Okt. – 20. Nov.); 1 Jahr: 52 volle Wochen bis gestern.
export function periodRange(k, today = todayStr()) {
  const end = addDays(parseD(today), -1);
  if (k === '7d') return [ymd(addDays(end, -6)), ymd(end)];
  if (k === '1m') {
    const d = parseD(today), last = new Date(d.getFullYear(), d.getMonth(), 0).getDate(); // Tage im Vormonat
    return [ymd(new Date(d.getFullYear(), d.getMonth() - 1, Math.min(d.getDate(), last))), ymd(end)];
  }
  return [ymd(addDays(end, -363)), ymd(end)];
}
const label = (k) => ({ '7d': t('7 Tage'), '1m': t('1 Monat'), '1y': t('1 Jahr'), range: t('Zeitraum') }[k]);
const monthIdx = (ds) => Number(ds.slice(0, 4)) * 12 + Number(ds.slice(5, 7)) - 1;
// Bristol-Typen 1–7 in den Farben des App-Icons
const TYPE_COL = ['#8b5a33', '#b07a3e', '#6fa577', '#2f9a72', '#d9a62e', '#e07b2c', '#c9503f'];

// Kennzahlen des Zeitraums (nur Stuhlgänge zählen; für die Serie zählt jeder Tag mit irgendeinem Eintrag)
export function rewindStats(entries, from, to) {
  const inR = entries.filter((e) => e.date >= from && e.date <= to);
  const stools = inR.filter((e) => e.consistency > 0);
  const days = Math.round((parseD(to) - parseD(from)) / 86400000) + 1;
  const byType = Array(8).fill(0), hours = Array(24).fill(0), wd = Array(7).fill(0), perDate = {};
  for (const e of stools) {
    byType[e.consistency]++;
    if (e.time) hours[Number(e.time.slice(0, 2))]++;
    wd[(parseD(e.date).getDay() + 6) % 7]++; // Montag = 0
    perDate[e.date] = (perDate[e.date] || 0) + 1;
  }
  const top = stools.length ? byType.indexOf(Math.max(...byType)) : 0;
  const normal = byType[3] + byType[4];
  const dates = new Set(inR.map((e) => e.date));
  let streak = 0, run = 0;
  for (let i = 0; i < days; i++) { if (dates.has(ymd(addDays(parseD(from), i)))) { run++; streak = Math.max(streak, run); } else run = 0; }
  // Balken je Tag (bis 40 Tage), je Woche (bis gut ein Jahr) oder je Kalendermonat
  const size = days > 400 ? 30 : days > 40 ? 7 : 1;
  const bars = Array(size === 30 ? monthIdx(to) - monthIdx(from) + 1 : Math.ceil(days / size)).fill(0);
  const slot = (d) => (size === 30 ? monthIdx(d) - monthIdx(from) : Math.floor((parseD(d) - parseD(from)) / 86400000 / size));
  for (const e of stools) bars[Math.min(bars.length - 1, slot(e.date))]++;
  return { n: stools.length, days, perDay: stools.length / days, top, normalPct: stools.length ? Math.round((normal / stools.length) * 100) : 0, streak, logged: dates.size, bars, size, byType, hours, wd, perDate, dates };
}

const none = () => t('Keine Einträge in diesem Zeitraum.');

// Designs zum Durchwischen: jedes mit eigenem Inhalt und Layout
export const DESIGNS = ['overview', 'overviewScale', 'types', 'clock', 'calendar'];
const designName = (k) => ({ overview: t('Übersicht'), overviewScale: t('Übersicht mit Skala'), calendar: t('Kalender'), types: t('Formen'), clock: t('Tageszeit') }[k]);
// Alle Designs in den Farben der App (dunkel mit Grün); nur die Bristol-Typen behalten ihre eigenen Farben
const T = { bg: '#0f1514', card: '#18221f', acc: '#4fa68c', ink: '#e8efed', dim: '#93a5a0', off: '#26332f' };
const F = (w, px) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif`;

// Verstecktes Menü (Doppeltippen auf den Titel): Name im Bild und Icon-Punkte anpassen; null = Name der App
const optsGet = () => ({ name: null, dots: true, ...(DEV.get('rewindOpts') || {}) });
const brand = (o) => (o.name == null ? appName(S.config) : o.name).trim();

function draw(s, key, from, to, design = 'overview') {
  const o = optsGet(), who = brand(o);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  // Flacher Hintergrund (kein Verlauf/Schimmer); als Erkennungszeichen oben rechts die sieben Punkte des App-Icons
  g.fillStyle = T.bg; g.fillRect(0, 0, W, H);
  const dotMark = (right, cy, r) => {
    const pitch = r * 2.3, rowGap = r * 2.75;
    [[0, 4], [4, 3]].forEach(([i0, n], row) => {
      for (let i = 0; i < n; i++) {
        g.beginPath(); g.arc(right - r - (3 - (4 - n) / 2 - i) * pitch, cy + (row - 0.5) * rowGap, r, 0, Math.PI * 2);
        g.fillStyle = TYPE_COL[i0 + i]; g.fill();
      }
    });
  };
  if (o.dots) dotMark(W - 80, 112, 13); // Oberkante bündig mit dem App-Namen
  const rr = (x, y, w, h, r, fill) => { g.beginPath(); g.roundRect(x, y, w, h, r); g.fillStyle = fill; g.fill(); };
  const txt = (str, x, y, font, col, align = 'left', max) => { g.font = font; g.fillStyle = col; g.textAlign = align; max ? g.fillText(str, x, y, max) : g.fillText(str, x, y); g.textAlign = 'left'; };
  // Datum; beim Anfang ohne Jahr, wenn beide im selben Jahr liegen („21. Okt. – 20. Nov. 2026“)
  const fmtD = (ds, withYear = true) => parseD(ds).toLocaleDateString(LOC, { day: 'numeric', month: 'short', year: withYear ? 'numeric' : undefined });

  // Kopf und Fuß sind bei allen Designs gleich; oben und unten je 80 px Rand (Oberkante Schrift bzw. Unterlänge)
  const year = to.slice(0, 4);
  const yearMode = (key === '1y' && to.slice(5, 7) === '12') || (from === `${year}-01-01` && to >= `${year}-12-01`);
  if (who) txt(who.toUpperCase(), 80, 105, F(700, 34), T.acc, 'left', W - 160 - (o.dots ? 140 : 0));
  txt(yearMode ? t('Mein Jahr {y}', { y: year }) : t('Mein Rückblick'), 80, 200, F(800, 76), T.ink);
  const len = key === 'range' ? t('{n} Tage', { n: s.days }) : label(key);
  txt(`${len} · ${fmtD(from, from.slice(0, 4) !== to.slice(0, 4))} – ${fmtD(to)}`, 80, 257, F(500, 36), T.dim, 'left', W - 160);
  const foot = (line) => {
    g.restore(); // der Fuß steht fest unten, unabhängig von der Verschiebung des Inhalts
    if (line) txt(line, 80, 1215, F(700, 44), T.ink, 'left', W - 160);
    txt(who ? t('Erstellt mit {app} · eigene Aufzeichnung, keine Diagnose', { app: who }) : t('Eigene Aufzeichnung, keine Diagnose'), 80, 1263, F(500, 26), T.dim, 'left', W - 160);
  };
  // Inhalt zwischen Kopf und Fuß: um 15 px nach oben, passend zum Kopf
  g.save(); g.translate(0, -15);
  const big = (value, unit) => {
    txt(value, 72, 480, F(800, 190), T.ink);
    g.font = F(800, 190); const w = g.measureText(value).width;
    txt(unit, 92 + w, 478, F(600, 42), T.dim, 'left', W - 172 - w);
  };

  if (design === 'calendar') {
    // Jeder Tag ein Kästchen, je dunkler, desto mehr Stuhlgänge; Spalten = Wochen (bei langen Zeiträumen in mehreren Bändern)
    big(fmtN(s.logged), t('von {n} Tagen notiert', { n: s.days }));
    const off = (parseD(from).getDay() + 6) % 7, cols = Math.ceil((off + s.days) / 7);
    const shade = (n) => (!n ? T.off : `rgba(79,166,140,${n === 1 ? 0.45 : n === 2 ? 0.75 : 1})`);
    const loggedNoStool = (ds) => s.dates.has(ds) && !s.perDate[ds];
    let gridBottom = 0;
    if (s.days <= 42) {
      // Kurz: Wochen als Zeilen mit Wochentagen oben
      const rows = Math.ceil((off + s.days) / 7), cell = Math.min(920 / 7, 560 / (rows + 0.5)), gx = 80 + (920 - 7 * cell + 10) / 2;
      for (let i = 0; i < 7; i++) txt(addDays(new Date(2024, 0, 1), i).toLocaleDateString(LOC, { weekday: 'short' }).replace('.', ''), gx + i * cell + (cell - 10) / 2, 570, F(600, 26), T.dim, 'center');
      gridBottom = 600 + rows * cell - 10;
      for (let i = 0; i < s.days; i++) {
        const ds = ymd(addDays(parseD(from), i)), k = off + i, x = gx + (k % 7) * cell, y = 600 + Math.floor(k / 7) * cell;
        rr(x, y, cell - 10, cell - 10, 18, loggedNoStool(ds) ? T.card : shade(s.perDate[ds] || 0));
        txt(String(Number(ds.slice(8))), x + (cell - 10) / 2, y + (cell - 10) / 2 + 11, F(600, 30), s.perDate[ds] ? '#ffffff' : T.dim, 'center');
      }
    } else {
      let best = 1, cell = 0;
      for (let b = 1; b <= 8; b++) { const cs = Math.min(920 / Math.ceil(cols / b), (560 - (b - 1) * 28) / (7 * b)); if (cs > cell) { cell = cs; best = b; } }
      const per = Math.ceil(cols / best), gap = Math.max(2, cell * 0.14), gx = 80 + (920 - per * cell + gap) / 2;
      gridBottom = 560 + best * 7 * cell + (best - 1) * 28 - gap;
      for (let i = 0; i < s.days; i++) {
        const ds = ymd(addDays(parseD(from), i)), k = off + i, col = Math.floor(k / 7), band = Math.floor(col / per);
        const x = gx + (col % per) * cell, y = 560 + band * (7 * cell + 28) + (k % 7) * cell;
        rr(x, y, cell - gap, cell - gap, Math.min(8, cell / 4), loggedNoStool(ds) ? T.card : shade(s.perDate[ds] || 0));
      }
    }
    // Legende mittig unter dem Raster
    g.font = F(500, 26);
    const lw = g.measureText(t('weniger')).width, mw = g.measureText(t('mehr')).width;
    const lx = (W - (lw + 14 + 4 * 40 - 8 + 14 + mw)) / 2, ly = gridBottom + 34;
    txt(t('weniger'), lx, ly + 26, F(500, 26), T.dim);
    let x = lx + lw + 14;
    for (const n of [0, 1, 2, 3]) { rr(x, ly, 32, 32, 8, shade(n)); x += 40; }
    txt(t('mehr'), x + 6, ly + 26, F(500, 26), T.dim); // x steht nach dem letzten Kästchen 8 px weiter
    foot(s.streak === 1 ? t('{n} Tag am Stück notiert', { n: s.streak }) : t('{n} Tage am Stück notiert', { n: s.streak }));
  } else if (design === 'types') {
    // Verteilung der Bristol-Typen, Normalbereich (3–4) hinterlegt
    txt(s.top ? `${t('Typ')} ${s.top}` : '–', 72, 470, F(800, 170), T.ink);
    txt(s.top ? t('{a} · am häufigsten', { a: CONS[s.top - 1].short }) : t('häufigste Form'), 80, 555, F(600, 40), T.dim, 'left', W - 160);
    const max = Math.max(1, ...s.byType.slice(1)), y0 = 615, rh = 78;
    rr(60, y0 + 2 * rh - 2, W - 120, rh + 76, 22, 'rgba(79,166,140,.12)'); // Kästchen von Typ 3 und 4 mit je 10 px Luft
    for (let v = 1; v <= 7; v++) {
      const y = y0 + (v - 1) * rh, n = s.byType[v], pct = s.n ? Math.round((n / s.n) * 100) : 0;
      rr(80, y + 8, 56, 56, 16, TYPE_COL[v - 1]);
      txt(String(v), 108, y + 48, F(800, 30), '#ffffff', 'center');
      rr(160, y + 22, 700, 28, 14, T.off);
      if (n) rr(160, y + 22, Math.max(28, (n / max) * 700), 28, 14, TYPE_COL[v - 1]);
      txt(`${pct} %`, W - 80, y + 48, F(700, 30), T.ink, 'right');
    }
    foot(s.n ? t('{a} % im Normalbereich (Typ 3–4)', { a: s.normalPct }) : none());
  } else if (design === 'clock') {
    // 24-Stunden-Uhr: ein Strahl je Stunde, Mitternacht oben
    const peak = s.n ? s.hours.indexOf(Math.max(...s.hours)) : -1;
    txt(peak < 0 ? '–' : t('{a}–{b} Uhr', { a: peak, b: (peak + 1) % 24 }), 72, 460, F(800, 140), T.ink, 'left', W - 150);
    txt(t('deine häufigste Uhrzeit'), 80, 525, F(600, 40), T.dim);
    const cx = W / 2, cy = 860, r0 = 110, rl = 170, max = Math.max(1, ...s.hours);
    g.lineCap = 'round';
    for (let h = 0; h < 24; h++) {
      const a = (h / 24) * Math.PI * 2 - Math.PI / 2, len = s.hours[h] ? 16 + (s.hours[h] / max) * rl : 6;
      g.strokeStyle = s.hours[h] ? (h === peak ? T.ink : T.acc) : T.off; g.lineWidth = 30;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len)); g.stroke();
    }
    for (const h of [0, 6, 12, 18]) {
      const a = (h / 24) * Math.PI * 2 - Math.PI / 2;
      txt(clock12 ? `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}` : String(h), cx + Math.cos(a) * 70, cy + Math.sin(a) * 70 + 10, F(700, 28), T.dim, 'center');
    }
    const wdTop = s.n ? s.wd.indexOf(Math.max(...s.wd)) : -1;
    foot(wdTop < 0 ? none() : t('Meist am {d}', { d: addDays(new Date(2024, 0, 1), wdTop).toLocaleDateString(LOC, { weekday: 'long' }) }));
  } else {
    // Übersicht (mit oder ohne Skala): große Zahl, vier Kacheln, Balken
    big(fmtN(s.n), s.n === 1 ? t('Stuhlgang') : t('Stuhlgänge'));
    const tiles = [
      [fmtN(Math.round(s.perDay * 10) / 10), t('pro Tag im Schnitt')],
      [s.top ? `${t('Typ')} ${s.top}` : '–', s.top ? CONS[s.top - 1].short : t('häufigste Form')],
      [s.n ? `${s.normalPct} %` : '–', t('im Normalbereich (Typ 3–4)')],
      [`${s.streak}`, s.streak === 1 ? t('Tag am Stück notiert') : t('Tage am Stück notiert')],
    ];
    tiles.forEach(([v, l], i) => {
      const x = 80 + (i % 2) * 470, y = 540 + Math.floor(i / 2) * 200;
      rr(x, y, 450, 180, 28, T.card);
      txt(v, x + 34, y + 94, F(800, 72), T.ink);
      txt(l, x + 34, y + 144, F(500, 30), T.dim, 'left', 390);
    });
    // Balken; im Design „Übersicht mit Skala“ mit Hilfslinien und Zahlen links
    const scale = design === 'overviewScale';
    const lab = scale ? 56 : 0; // Platz für die Zahlen der Skala
    const bx = 80 + lab, by = scale ? 1022 : 1000, bw = W - 160 - lab, bh = (s.n ? 205 : 140) - (scale ? 22 : 0); // mit Skala etwas Luft unter der Überschrift
    const peak = Math.max(1, ...s.bars);
    const tick = peak <= 6 ? 1 : Math.ceil(peak / 5); // höchstens etwa 6 Linien
    const max = scale ? Math.ceil(peak / tick) * tick : peak;
    const base = by + bh + 10; // Grundlinie der Balken
    txt(s.size === 1 ? t('Stuhlgänge pro Tag') : s.size === 7 ? t('Stuhlgänge pro Woche') : t('Stuhlgänge pro Monat'), 80, 982, F(600, 28), T.dim);
    if (scale) {
      for (let v = 0; v <= max; v += tick) {
        const y = base - (v / max) * bh;
        g.fillStyle = T.off; g.fillRect(bx, Math.round(y) - 1, bw, 2);
        txt(String(v), bx - 16, y + 9, F(600, 26), T.dim, 'right');
      }
    }
    const step = bw / s.bars.length, barW = Math.max(4, step * (scale ? 0.6 : 0.7));
    s.bars.forEach((v, i) => {
      const h = v ? Math.max(8, (v / max) * bh) : 4;
      rr(bx + i * step + (step - barW) / 2, base - h, barW, h, Math.min(8, barW / 2), v ? T.acc : T.off);
    });
    foot(s.n ? '' : none()); // ohne Schlusssatz: die Balken bekommen den Platz
  }
  return c;
}

export function rewindButton() {
  const b = el('button', { type: 'button', class: 'rewind-btn' }, el('i', { html: ICON.share }), t('Rückblick teilen'));
  b.addEventListener('click', openRewind);
  return b;
}

export function openRewind() {
  const today = todayStr();
  let theme = DESIGNS.includes(DEV.get('rewindDesign')) ? DEV.get('rewindDesign') : 'overview';
  // Voreinstellung nach dem Zeitraum der Statistik: „7 Tage“ → 7 Tage, „30 Tage“ → 1 Monat, sonst derselbe Zeitraum als eigener
  const cur = getRange();
  let to = cur.to > today ? today : cur.to, from = cur.from > to ? to : cur.from;
  let key = cur.days === 7 ? '7d' : cur.days === 30 ? '1m' : 'range';
  let canvas = null;
  const close = () => ov.remove();
  const chips = el('div', { class: 'chips' });
  const sub = el('div', { class: 'sub' });
  const img = el('img', { class: 'rewind-img', alt: t('Vorschau des Rückblicks'), draggable: 'false' });
  const stage = el('div', { class: 'rewind-stage' }, img); // Bühne für das Karussell (schneidet seitlich ab)
  const dots = el('div', { class: 'rewind-dots' });
  const share = el('button', { type: 'button', class: 'primary' }, t('Teilen'));
  const save = el('button', { type: 'button', 'aria-label': t('Bild speichern') }, t('Speichern'));
  const range = () => {
    if (key === 'range') return from <= to ? [from, to] : [to, from];
    return periodRange(key, today);
  };
  const fi = el('input', { type: 'date', class: 'dt', value: from, max: today, 'aria-label': t('Von') });
  const ti = el('input', { type: 'date', class: 'dt', value: to, max: today, 'aria-label': t('Bis') });
  fi.addEventListener('change', () => { if (fi.value) { from = fi.value > today ? today : fi.value; paint(); } });
  ti.addEventListener('change', () => { if (ti.value) { to = ti.value > today ? today : ti.value; paint(); } });
  sub.append(fi, el('span', { class: 'sep' }, t('bis')), ti);
  // Designwechsel als Karussell: das neue Bild schiebt sich direkt neben dem alten herein (immer in Wischrichtung, auch vom letzten zum ersten)
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const GAP = 14; // Abstand zwischen altem und neuem Bild während der Animation
  let busy = false;
  const setTheme = async (k, fromPx = 0, dir = DESIGNS.indexOf(k) > DESIGNS.indexOf(theme) ? 1 : -1) => {
    if (busy) return;
    if (k === theme) { slide(fromPx); return; }
    busy = true;
    const old = img.cloneNode();
    old.classList.add('ghost');
    Object.assign(old.style, { left: img.offsetLeft + 'px', top: img.offsetTop + 'px', width: img.offsetWidth + 'px', transform: `translateX(${fromPx}px)` });
    stage.append(old);
    theme = k; DEV.set('rewindDesign', k); paint();
    try {
      if (!reduce && img.animate) {
        const w = img.offsetWidth + GAP, opt = { duration: 300, easing: 'cubic-bezier(.2,.75,.25,1)' };
        await Promise.all([
          old.animate([{ transform: `translateX(${fromPx}px)` }, { transform: `translateX(${-dir * w}px)` }], opt).finished,
          img.animate([{ transform: `translateX(${dir * w + fromPx}px)` }, { transform: 'translateX(0)' }], opt).finished,
        ]);
      }
    } catch { /* Animation abgebrochen */ } finally { old.remove(); busy = false; img.style.transform = ''; }
  };
  const slide = (fromPx) => { img.style.transform = ''; if (fromPx && img.animate) img.animate([{ transform: `translateX(${fromPx}px)` }, { transform: 'translateX(0)' }], { duration: 180, easing: 'ease-out' }); };
  const step = (n, fromPx) => setTheme(DESIGNS[(DESIGNS.indexOf(theme) + n + DESIGNS.length) % DESIGNS.length], fromPx, n);
  const paint = () => {
    chips.replaceChildren(...PERIODS.map((k) => {
      const c = el('button', { type: 'button', class: 'chip' + (k === key ? ' on' : '') }, label(k));
      c.addEventListener('click', () => { key = k; paint(); });
      return c;
    }));
    sub.hidden = key !== 'range';
    dots.replaceChildren(...DESIGNS.map((k) => {
      const d = el('button', { type: 'button', class: 'rewind-dot' + (k === theme ? ' on' : ''), 'aria-label': t('Design: {a}', { a: designName(k) }), 'aria-pressed': String(k === theme) });
      d.addEventListener('click', () => setTheme(k));
      return d;
    }));
    const [a, b] = range();
    ensureRemote(needFor(a, b), () => { if (ov.isConnected) paint(); });
    const s = rewindStats(viewEntries(), a, b);
    canvas = draw(s, key, a, b, theme);
    img.src = canvas.toDataURL('image/png');
    share.disabled = save.disabled = !s.n;
  };
  // Wischen auf dem Bild wechselt das Design: das Bild folgt dem Finger (waagrecht; senkrecht scrollt weiter)
  let x0 = null, y0 = 0, dx = 0;
  img.addEventListener('pointerdown', (e) => { if (busy) return; x0 = e.clientX; y0 = e.clientY; dx = 0; });
  img.addEventListener('pointermove', (e) => {
    if (x0 == null) return;
    dx = e.clientX - x0;
    if (Math.abs(dx) > Math.abs(e.clientY - y0)) img.style.transform = `translateX(${dx}px)`;
  });
  const end = (e) => {
    if (x0 == null) return;
    const dy = e.clientY - y0; x0 = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1, dx); else slide(dx);
  };
  img.addEventListener('pointerup', end);
  img.addEventListener('pointercancel', () => { x0 = null; slide(dx); });
  // Das Bild liegt schon als data:-URL vor; daraus direkt Base64 bzw. Blob machen spart Zeit beim Teilen
  const name = () => `gutkeeper-${t('rueckblick')}-${range().join('_')}.png`;
  const b64 = () => img.src.split(',')[1];
  const blob = () => new Blob([Uint8Array.from(atob(b64()), (ch) => ch.charCodeAt(0))], { type: 'image/png' });
  // Rückmeldung an den Knöpfen: während der Arbeit pulsieren (und gesperrt), danach kurzer Ring bei Erfolg
  const busyRun = async (btn, fn) => {
    if (btn.classList.contains('busy')) return;
    btn.classList.add('busy');
    try { if (await fn()) playAnim(btn, 'saved'); } catch (e) { if (!e || e.name !== 'AbortError') toast(t('Das hat nicht geklappt.')); } finally { btn.classList.remove('busy'); }
  };
  share.addEventListener('click', () => busyRun(share, async () => {
    if (isNative()) { await shareNativeB64(name(), b64()); return false; } // Abbrechen im Teilen-Menü ist kein Fehler
    const file = new File([blob()], name(), { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return false; }
    await download(name(), file, 'image/png'); return true;
  }));
  save.addEventListener('click', () => busyRun(save, () => saveImage(name(), b64())));
  // Easter Egg: zweimal auf den Titel tippen öffnet ein kleines Menü zum Anpassen des Bildes
  const head = sheetHead(t('Rückblick teilen'), close);
  const egg = el('div', { class: 'rewind-egg', hidden: true });
  const setOpt = (patch) => { DEV.set('rewindOpts', { ...optsGet(), ...patch }); fillEgg(); paint(); };
  const nameIn = el('input', { type: 'text', class: 'askin', maxlength: 24, autocomplete: 'off', spellcheck: 'false', 'aria-label': t('Name im Bild') });
  nameIn.addEventListener('input', () => { DEV.set('rewindOpts', { ...optsGet(), name: nameIn.value }); fillChips(); paint(); });
  const picks = el('div', { class: 'chips' });
  const fillChips = () => {
    const cur = brand(optsGet());
    picks.replaceChildren(...[...new Set([appName(S.config), 'GutKeeper', 'DarmWächter'])].map((n) => {
      const c = el('button', { type: 'button', class: 'chip' + (n === cur ? ' on' : '') }, n);
      c.addEventListener('click', () => setOpt({ name: n }));
      return c;
    }));
  };
  const dotsCb = el('input', { type: 'checkbox' });
  dotsCb.addEventListener('change', () => setOpt({ dots: dotsCb.checked }));
  const reset = el('button', { type: 'button', class: 'linkbtn' }, t('Zurücksetzen'));
  reset.addEventListener('click', () => { DEV.set('rewindOpts', null); fillEgg(); paint(); });
  const fillEgg = () => { const o = optsGet(); nameIn.value = brand(o); dotsCb.checked = o.dots; fillChips(); };
  egg.append(el('b', {}, t('Bild anpassen')), el('span', { class: 'bk-2' }, t('Name im Bild (leer = ohne Namen)')), nameIn, picks,
    el('label', { class: 'chk' }, dotsCb, el('span', {}, t('App-Icon zeigen'))), reset);
  let lastTap = 0;
  head.querySelector('h2').addEventListener('click', () => {
    const now = Date.now();
    if (now - lastTap < 400) { lastTap = 0; egg.hidden = !egg.hidden; if (!egg.hidden) fillEgg(); } else lastTap = now;
  });
  const sheet = el('div', { class: 'sheet rewind', role: 'dialog', 'aria-label': t('Rückblick teilen') },
    head, egg, chips, sub, stage, dots,
    el('p', { class: 'bk-2' }, t('Wische über das Bild, um das Design zu wechseln.') + ' ' + t('Ohne Blut, Schleim, Schmerzen, Farbe, Essen und Notizen. Das Bild entsteht nur auf diesem Gerät.')),
    el('div', { class: 'btns' }, save, share));
  const ov = openOverlay(sheet, close);
  paint();
}

// Bild speichern: in der App über den MediaStore unter Bilder/GutKeeper (Galerie, eigenes Plugin ImageSaver),
// bei altem Android (unter 10) oder Fehler unter Dokumente/GutKeeper; im Browser als Download
async function saveImage(name, b64) {
  const P = window.Capacitor && window.Capacitor.Plugins;
  if (!(isNative() && P && P.Filesystem)) {
    const a = el('a', { href: 'data:image/png;base64,' + b64, download: name });
    document.body.append(a); a.click(); a.remove();
    return true;
  }
  if (P.ImageSaver) {
    try { await P.ImageSaver.savePng({ name, data: b64 }); toast(t('Gespeichert unter {a}', { a: t('Bilder/GutKeeper') }), null, null, 3500); return true; } catch { /* weiter mit Dokumente */ }
  }
  await P.Filesystem.writeFile({ path: `GutKeeper/${name}`, data: b64, directory: 'DOCUMENTS', recursive: true });
  toast(t('Gespeichert unter {a}', { a: t('Dokumente/GutKeeper') }), null, null, 3500);
  return true;
}
