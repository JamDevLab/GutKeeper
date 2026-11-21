// PDF-Bericht (eigener minimaler PDF-Writer)
import { appName, t } from './i18n.js';
import { AMOUNT, COLORS, CONS, PAIN, URGE, describeEntry, mealLabel } from './constants.js';
import { S } from './state.js';
import { fmtGap } from './stats.js';
import { activeFoods, viewEntries } from './store.js';
import { addDays, diffDays, fmtD, fmtD2, fmtN, parseD, short, todayStr, ymd } from './util.js';

export const rgb = (h) => [1, 3, 5].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
export const CONS_HEX = ['#8a5a2b', '#a56d33', '#62a06f', '#2f8f6a', '#c9a227', '#d9772b', '#c24a3a'];
export const PDF_ACC = rgb('#2f6f5e'), PDF_GREY = '0.45 0.45 0.45';
export function pdfStr(s) {
  const map = { '–': 0x96, '—': 0x97, '•': 0x95, '„': 0x84, '“': 0x93, '”': 0x94, '’': 0x92, '‘': 0x91, '…': 0x85 };
  let o = '';
  for (const ch of String(s)) {
    let c = map[ch] || ch.charCodeAt(0);
    if (c > 255) c = 63;
    const t = String.fromCharCode(c);
    o += t === '\\' || t === '(' || t === ')' ? '\\' + t : t;
  }
  return o;
}
export class Pdf {
  constructor() { this.pages = []; this.page(); }
  page() { this.ops = []; this.pages.push(this.ops); }
  text(x, top, s, size = 9, { bold = false, color = '0 0 0' } = {}) {
    this.ops.push(`BT /F${bold ? 2 : 1} ${size} Tf ${color} rg ${x.toFixed(1)} ${(842 - top).toFixed(1)} Td (${pdfStr(s)}) Tj ET`);
  }
  rect(x, top, w, h, color) { this.ops.push(`${color} rg ${x.toFixed(1)} ${(842 - top - h).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`); }
  line(x1, t1, x2, t2, color = '0.8 0.8 0.8', w = 0.5) { this.ops.push(`${color} RG ${w} w ${x1} ${842 - t1} m ${x2} ${842 - t2} l S`); }
  // Fußzeile auf jede Seite, dann die Objekte als [id, Wörterbuch] bzw. [id, null, Stream-Inhalt als Byte-String]
  objects(who) {
    const n = this.pages.length;
    this.pages.forEach((ops, i) => { this.ops = ops; this.text(40, 818, `${appName(S.config)}${who ? ` · ${who}` : ''} · ${t('Seite {a} von {b}', { a: i + 1, b: n })}`, 7.5, { color: PDF_GREY }); });
    const objs = [
      [1, '<< /Type /Catalog /Pages 2 0 R >>'],
      [2, `<< /Type /Pages /Kids [${this.pages.map((_, i) => `${5 + 2 * i} 0 R`).join(' ')}] /Count ${n} >>`],
      [3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'],
      [4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'],
    ];
    this.pages.forEach((ops, i) => {
      objs.push([5 + 2 * i, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + 2 * i} 0 R >>`]);
      objs.push([6 + 2 * i, null, ops.join('\n')]);
    });
    return objs;
  }
  // Objekte (ids 1…n lückenlos) zur PDF-Datei zusammensetzen; Texte sind Byte-Strings (Zeichencodes 0–255)
  serialize(objs, head = '%PDF-1.4', trailer = '') {
    let out = `${head}\n`; const offs = [];
    for (const [id, body, data] of objs) {
      offs[id] = out.length;
      out += `${id} 0 obj\n${data == null ? body : `<< /Length ${data.length} >>\nstream\n${data}\nendstream`}\nendobj\n`;
    }
    const total = objs.length + 1, xref = out.length;
    out += `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let id = 1; id < total; id++) out += `${String(offs[id]).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${total} /Root 1 0 R${trailer} >>\nstartxref\n${xref}\n%%EOF`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return new Blob([bytes], { type: 'application/pdf' });
  }
  // Unverschlüsselt, synchron (wie bisher)
  build(who = '') { return this.serialize(this.objects(who)); }
  // Mit Passwort: AES-256 (Revision 6), asynchron wegen WebCrypto; ohne Passwort identisch zu build()
  async buildAsync(who = '', { password } = {}) {
    if (!password) return this.build(who);
    const { pdfEncryptor } = await import('./pdfcrypt.js');
    const enc = await pdfEncryptor(password), objs = this.objects(who);
    for (const o of objs) {
      if (o[2] == null) continue;
      const plain = new Uint8Array(o[2].length);
      for (let i = 0; i < plain.length; i++) plain[i] = o[2].charCodeAt(i) & 255;
      const c = await enc.stream(plain);
      let s = '';
      for (let i = 0; i < c.length; i += 8192) s += String.fromCharCode(...c.subarray(i, i + 8192));
      o[2] = s;
    }
    const encId = objs.length + 1;
    objs.push([encId, enc.dict]);
    return this.serialize(objs, '%PDF-2.0', ` /Encrypt ${encId} 0 R /ID [<${enc.id}> <${enc.id}>]`);
  }
}

// mode: Auswertungen sind in allen Umfängen gleich, nur die Einträge unterscheiden sich:
// 'full' = Tabelle mit allen Spalten und Notizen, 'normal' = kompakte Tabelle, 'short' = nur Auffälligkeiten
// opts: name/birth (nur im PDF), food = Essen einbeziehen
// Hervorgehoben (neutral, ohne Bewertung): Blut, Stuhlfarbe rot oder schwarz; auffällig außerdem Schleim und Schmerzen ab „mittel“
const RED_BLACK = new Set([5, 6]);
const warnColor = (e) => RED_BLACK.has(e.color);
export async function buildReport(from, to, mode = 'full', opts = {}) {
  // Farben: normal farbig; bw = Schwarz-Weiß für Drucker/Fax ohne Farbe (Grautöne, Hervorhebungen schwarz und fett)
  const mono = !!opts.bw;
  const C = mono
    ? { acc: '0.2 0.2 0.2', title: '0 0 0', cons: () => '0.45 0.45 0.45', mk: { b: '0 0 0', m: '0.5 0.5 0.5', l: '0.78 0.78 0.78' }, warn: '0 0 0', bar: '0.35 0.35 0.35' }
    : { acc: PDF_ACC, title: PDF_ACC, cons: (i) => rgb(CONS_HEX[i]), mk: { b: rgb('#c0334a'), m: rgb('#b58420'), l: rgb('#4a7fb5') }, warn: rgb('#c0334a'), bar: PDF_ACC };
  const isShort = mode === 'short', isFull = mode === 'full';
  const today = todayStr(), effTo = to > today ? today : to;
  const days = Math.max(1, diffDays(from, effTo) + 1);
  const all = viewEntries().filter((e) => e.date >= from && e.date <= to).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const list = all.filter((e) => e.consistency > 0), n = list.length;
  const withDays = new Set(list.map((e) => e.date)).size;
  let gap = 0, gapEnd = '';
  for (let i = 1; i < n; i++) {
    const g = new Date(`${list[i].date}T${list[i].time}`) - new Date(`${list[i - 1].date}T${list[i - 1].time}`);
    if (g > gap) { gap = g; gapEnd = list[i].date; }
  }
  const avgC = n ? list.reduce((a, e) => a + e.consistency, 0) / n : 0;
  const cnt = (arr, k) => arr.filter((e) => e[k]).length;
  // Vergleich mit dem gleich langen Zeitraum davor (nur wenn es dort Einträge gibt)
  const pFrom = ymd(addDays(parseD(from), -days)), pTo = ymd(addDays(parseD(from), -1));
  const prev = viewEntries().filter((e) => e.date >= pFrom && e.date <= pTo && e.consistency > 0);
  const who = [opts.name, opts.birth ? t('geb. {d}', { d: opts.birth }) : ''].filter(Boolean).join(', ');
  const foods = opts.food ? activeFoods().filter((f) => f.date >= from && f.date <= to).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)) : [];
  const foodBefore = (e) => { const end = new Date(`${e.date}T${e.time}`).getTime(), start = end - 864e5; return foods.filter((f) => { const x = new Date(`${f.date}T${f.time}`).getTime(); return x <= end && x >= start; }); };
  const pdf = new Pdf();
  let y = 50;

  pdf.text(40, y, t('Stuhlprotokoll'), 22, { bold: true, color: C.title });
  if (isShort) pdf.text(200, y, t('Kurzbericht'), 11, { color: PDF_GREY });
  if (who) pdf.text(555 - Math.min(250, who.length * 5.6), y - 4, who, 10.5, { bold: true });
  y += 18;
  pdf.text(40, y, t('Zeitraum: {a} – {b} ({n} Tage)   ·   erstellt am {c}', { a: fmtD(from), b: fmtD(effTo), n: days, c: fmtD(today) }), 10); y += 12;
  pdf.text(40, y, t('Eigene Aufzeichnung, keine Diagnose. Konsistenz nach Bristol-Stuhlformen-Skala (1–2 hart, 3–4 normal, 5–7 weich bis flüssig).'), 7.5, { color: PDF_GREY }); y += 16;

  // Zusammenfassung
  pdf.rect(40, y, 515, 93, '0.95 0.96 0.96');
  const kv = (x, top, k, v) => { pdf.text(x, top, k, 9, { color: PDF_GREY }); pdf.text(x + 118, top, v, 9.5, { bold: true }); };
  const t0 = y + 16;
  kv(50, t0, t('Stuhlgänge'), `${n}  (${t('Ø')} ${fmtN(n / days)} ${t('pro Tag')})`);
  kv(50, t0 + 15, t('Tage ohne Stuhlgang'), t('{a} von {b}', { a: Math.max(0, days - withDays), b: days }));
  kv(50, t0 + 30, t('Längste Pause'), n > 1 ? `${fmtGap(gap)} (${t('bis {d}', { d: fmtD(gapEnd) })})` : '–');
  kv(50, t0 + 45, t('Ø Konsistenz (Bristol)'), n ? `${fmtN(avgC)}  (${CONS[Math.round(avgC) - 1].short})` : '–');
  kv(310, t0, t('Mit Blut'), `${cnt(all, 'blood')}`);
  kv(310, t0 + 15, t('Mit Schleim'), `${cnt(all, 'mucus')}`);
  kv(310, t0 + 30, t('Mit Schmerzen/Krämpfen'), `${cnt(all, 'pain')}`);
  kv(310, t0 + 45, t('Luft'), `${cnt(all, 'luft')}`);
  const rb = all.filter(warnColor).length;
  kv(310, t0 + 60, t('Farbe rot/schwarz'), `${rb}`);
  if (rb) pdf.rect(304, t0 + 53, 3, 9, C.warn); // Hervorhebung: kleiner Balken davor
  if (cnt(all, 'blood')) pdf.rect(304, t0 - 7, 3, 9, C.warn);
  const pn = prev.length, pDays = days;
  kv(50, t0 + 60, t('Zeitraum davor'), pn ? t('Ø {a} pro Tag, Konsistenz {b}', { a: fmtN(pn / pDays), b: fmtN(prev.reduce((a, e) => a + e.consistency, 0) / pn) }) : '–');
  y += 111;

  // Diagramm: Stuhlgänge pro Tag/Woche
  const size = days > 62 ? 7 : 1, nb = Math.ceil(days / size);
  const vals = Array(nb).fill(0), marks = Array.from({ length: nb }, () => []);
  const bk = (e) => Math.min(nb - 1, Math.max(0, Math.floor(diffDays(from, e.date) / size)));
  for (const e of list) vals[bk(e)]++;
  for (const e of all) { const m = marks[bk(e)]; for (const [k, c] of [['blood', 'b'], ['mucus', 'm'], ['luft', 'l']]) if (e[k] && !m.includes(c)) m.push(c); }
  pdf.text(40, y, size === 1 ? t('Stuhlgänge pro Tag') : t('Stuhlgänge pro Woche'), 11, { bold: true }); y += 8;
  const raw = Math.max(3, ...vals), step = Math.max(1, Math.ceil(raw / 4)), max = Math.ceil(raw / step) * step; // gleichmäßige Achse: 0, 1, 2, 3 bzw. 0, 2, 4 …
  const cx = 62, cw = 493, chh = 78, base = y + 14 + chh, bw = cw / nb, bar = Math.min(14, bw * 0.7);
  for (let gv = 0; gv <= max; gv += step) {
    const yy = base - (chh * gv) / max;
    pdf.line(cx, yy, cx + cw, yy, '0.86 0.86 0.86'); pdf.text(44, yy + 3, String(gv), 7.5, { color: PDF_GREY });
  }
  const MK = C.mk;
  vals.forEach((v, i) => {
    const x = cx + i * bw + (bw - bar) / 2, h = (chh * v) / max;
    if (v) pdf.rect(x, base - h, bar, h, C.bar);
    marks[i].forEach((k, mi) => pdf.rect(x + bar / 2 - (marks[i].length * 4.5) / 2 + mi * 4.5, base - h - 7, 3.5, 3.5, MK[k]));
  });
  const xl = nb <= 10 ? vals.map((_, i) => i) : [0, Math.floor(nb / 2), nb - 1];
  for (const i of xl) pdf.text(cx + i * bw, base + 11, short(ymd(addDays(parseD(from), i * size))), 7.5, { color: PDF_GREY });
  [[t('Blut'), 'b'], [t('Schleim'), 'm'], [t('Luft'), 'l']].forEach(([lab, k], i) => {
    pdf.rect(400 + i * 52, y - 8, 5, 5, MK[k]); pdf.text(408 + i * 52, y - 3, lab, 8, { color: PDF_GREY });
  });
  y = base + 30;

  // Verteilung der Konsistenz
  if (n) {
    pdf.text(40, y, t('Konsistenz (Bristol-Skala)'), 11, { bold: true }); y += 6;
    const cc = CONS.map((c) => list.filter((e) => e.consistency === c.v).length), cmax = Math.max(...cc);
    CONS.forEach((c, i) => {
      y += 13;
      pdf.text(40, y, `${c.v}  ${c.short}`, 9);
      pdf.rect(150, y - 8, 4 + (300 * cc[i]) / cmax, 9, C.cons(i));
      pdf.text(150 + 12 + (300 * cc[i]) / cmax, y, `${cc[i]}  (${Math.round((cc[i] / n) * 100)} %)`, 8.5, { color: PDF_GREY });
    });
    y += 24;
  }

  // weitere Auswertungen wie in der Statistik der App, zweispaltig (Tageszeit | Farbe, Drang | Schmerzen)
  if (all.length) {
    const groups = (x, top, title, rows) => {
      pdf.text(x, top, title, 11, { bold: true });
      const m = Math.max(1, ...rows.map((r) => r[1])), tot = rows.reduce((a, r) => a + r[1], 0) || 1;
      rows.forEach(([lab, c, col], i) => {
        const yy = top + 15 + i * 12.5;
        pdf.text(x, yy, lab, 8.5);
        pdf.rect(x + 78, yy - 7.5, 2 + (110 * c) / m, 8.5, col);
        pdf.text(x + 84 + (110 * c) / m, yy, `${c}  (${Math.round((c / tot) * 100)} %)`, 8, { color: PDF_GREY });
      });
      return top + 15 + rows.length * 12.5;
    };
    if (y > 560) { pdf.page(); y = 50; }
    const slots = [[0, 6], [6, 9], [9, 12], [12, 15], [15, 18], [18, 21], [21, 24]];
    const tod = slots.map(([a, b]) => [t('{a}–{b} Uhr', { a, b }), list.filter((e) => { const h = Number(e.time.slice(0, 2)); return h >= a && h < b; }).length, C.bar]);
    const colRows = COLORS.map((c, i) => [c.label, list.filter((e) => e.color === i + 1).length, mono ? '0.45 0.45 0.45' : rgb(c.hex)]);
    const y1 = Math.max(groups(40, y, t('Tageszeit'), tod), groups(300, y, t('Farbe'), colRows));
    y = y1 + 18;
    const lvl = (arr, k, src) => arr.map((u) => [u.label, src.filter((e) => (e[k] || 0) === u.v).length, C.bar]);
    const y2 = Math.max(groups(40, y, t('Stuhldrang'), lvl(URGE, 'urge', list)), groups(300, y, t('Schmerzen / Krämpfe'), lvl(PAIN, 'pain', all)));
    y = y2 + 24;
  }

  const cut = (x, n) => (x.length > n ? x.slice(0, n - 1) + '…' : x);
  if (isShort) { // statt der Tabelle nur Auffälligkeiten, neueste zuletzt
    if (y > 740) { pdf.page(); y = 50; }
    const odd = all.filter((e) => e.blood || e.mucus || e.pain >= 2 || warnColor(e));
    pdf.text(40, y, t('Auffälligkeiten (Blut, rote/schwarze Farbe, Schleim, Schmerzen ab mittel)'), 11, { bold: true }); y += 14;
    const lines = (e) => 1 + (e.note ? 1 : 0) + (opts.food && foodBefore(e).length ? 1 : 0);
    for (const e of odd) {
      if (y + lines(e) * 10.5 > 805) { pdf.page(); y = 50; } // Eintrag nicht über den Seitenrand teilen
      const d = describeEntry(e), warn = e.blood || warnColor(e);
      const tags = [e.blood ? t('Blut') : '', warnColor(e) ? `${t('Farbe')} ${COLORS[e.color - 1].label.toLowerCase()}` : '', e.mucus ? t('Schleim') : '', e.pain ? `${t('Schmerzen')} ${PAIN[e.pain].label.toLowerCase()}` : ''].filter(Boolean);
      if (warn) pdf.rect(38, y - 7.5, 2, 9, C.warn);
      pdf.text(42, y, `${fmtD2(e.date)}  ${e.time}`, 8.5); pdf.text(128, y, d.name, 8.5); pdf.text(240, y, tags.join(', '), 8.5, { bold: !!warn });
      y += 10.5;
      if (e.note) { pdf.text(128, y, cut(`${t('Notiz')}: ${e.note}`, 110), 7.5, { color: PDF_GREY }); y += 10.5; }
      if (opts.food) { const fb = foodBefore(e); if (fb.length) { pdf.text(128, y, cut(`${t('Essen 24 Std davor')}: ${fb.map((f) => f.text).join(', ')}`, 110), 7.5, { color: PDF_GREY }); y += 10.5; } }
    }
    if (!odd.length) pdf.text(42, y, t('Keine Auffälligkeiten im Zeitraum.'), 9, { color: PDF_GREY });
    return { blob: await pdf.buildAsync(who, { password: opts.password }), count: all.length };
  }

  // Tabelle
  const COLX = isFull ? [40, 92, 128, 238, 282, 326, 372, 426, 462, 508] : [40, 92, 128, 238]; // normal: Datum, Zeit, Typ, Angaben
  const head = () => {
    pdf.rect(40, y - 10, 515, 15, C.acc);
    (isFull ? ['Datum', 'Zeit', 'Typ', 'Drang', 'Menge', 'Farbe', 'Schmerzen', 'Blut', 'Schleim', 'Luft'] : ['Datum', 'Zeit', 'Typ', 'Angaben']).map((x) => t(x)).forEach((h, i) => pdf.text(COLX[i] + 2, y, h, 8.5, { bold: true, color: '1 1 1' }));
    y += 15;
  };
  if (y > 700) { pdf.page(); y = 50; }
  pdf.text(40, y, t('Einträge').replace(/^./, (c) => c.toUpperCase()), 11, { bold: true }); y += 14;
  head();
  let prevDate = '', shade = false;
  const wrapText = (t, n) => { const out = []; let cur = ''; for (const w of String(t).split(' ')) { if ((cur + ' ' + w).trim().length > n) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); } if (cur) out.push(cur); return out; };
  for (const e of all) {
    const nl = e.note ? (isFull ? wrapText(e.note, 120).slice(0, 2) : [cut(e.note, 120)]) : [], rowH = (isFull ? 13.5 : 12.5) + nl.length * 9;
    if (y + rowH > 800) { pdf.page(); y = 50; head(); }
    if (e.date !== prevDate) { shade = !shade; prevDate = e.date; }
    if (shade) pdf.rect(40, y - 9.5, 515, rowH, '0.95 0.96 0.96');
    const stool = e.consistency > 0, dash = '-';
    const cells = !isFull ? (() => {
      const d = describeEntry(e);
      const tags = [...d.parts, e.blood ? t('Blut') : '', e.mucus ? t('Schleim') : '', e.luft && !d.onlyLuft ? t('Luft') : ''].filter(Boolean);
      const txt = tags.join(', ');
      return [fmtD2(e.date), e.time, stool ? `${e.consistency}  ${d.name}` : d.name, txt.length > 70 ? txt.slice(0, 69) + '…' : txt];
    })() : [
      fmtD2(e.date), e.time,
      stool ? `${e.consistency}  ${CONS[e.consistency - 1].short}` : e.luft && !e.blood && !e.mucus && !e.pain && !e.urge ? t('nur Luft') : t('kein Stuhl'),
      stool || e.urge ? URGE[e.urge].label.toLowerCase() : dash, stool ? AMOUNT.find((a) => a.v === e.amount).label.toLowerCase() : dash,
      e.color ? COLORS[e.color - 1].label.toLowerCase() : dash, e.pain ? PAIN[e.pain].label.toLowerCase() : dash,
      e.blood ? t('ja') : dash, e.mucus ? t('ja') : dash, e.luft ? t('ja') : dash,
    ];
    const warn = !!e.blood || warnColor(e);
    if (warn) pdf.rect(38, y - 9.5, 2, rowH, C.warn); // am Rand hervorheben
    cells.forEach((c, i) => pdf.text(COLX[i] + 2, y, c, 8.5, { bold: isFull ? ((i === 7 && !!e.blood) || (i === 5 && warnColor(e))) : (i === 3 && warn) }));
    nl.forEach((l, k) => pdf.text(COLX[1] + 2, y + 9 * (k + 1), (k === 0 ? t('Notiz') + ': ' : '') + l, 7.5, { color: PDF_GREY }));
    y += rowH;
  }
  if (!all.length) pdf.text(42, y, t('Keine Einträge im Zeitraum.'), 9, { color: PDF_GREY });

  // Essen (optional): eigene Tabelle Datum, Zeit, Mahlzeit, Essen
  if (opts.food) {
    y += 24;
    if (y > 740) { pdf.page(); y = 50; }
    pdf.text(40, y, t('Essen'), 11, { bold: true }); y += 14;
    const FX = [40, 92, 128, 218];
    const fhead = () => { pdf.rect(40, y - 10, 515, 15, C.acc); [t('Datum'), t('Zeit'), t('Mahlzeit'), t('Essen')].forEach((h, i) => pdf.text(FX[i] + 2, y, h, 8.5, { bold: true, color: '1 1 1' })); y += 15; };
    fhead();
    let pd = '', sh = false;
    for (const f of foods) {
      if (y + 12.5 > 800) { pdf.page(); y = 50; fhead(); }
      if (f.date !== pd) { sh = !sh; pd = f.date; }
      if (sh) pdf.rect(40, y - 9.5, 515, 12.5, '0.95 0.96 0.96');
      [fmtD2(f.date), f.time, f.meal ? mealLabel(f.meal) : '', cut(f.text || '', 85)].forEach((c, i) => pdf.text(FX[i] + 2, y, c, 8.5));
      y += 12.5;
    }
    if (!foods.length) pdf.text(42, y, t('Kein Essen im Zeitraum eingetragen.'), 9, { color: PDF_GREY });
  }
  return { blob: await pdf.buildAsync(who, { password: opts.password }), count: all.length };
}
