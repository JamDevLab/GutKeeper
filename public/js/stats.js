// Ansicht „Statistik“ inkl. Kalender
import { LOC, t } from './i18n.js';
import { AMOUNT, COLORS, CONS, PAIN, URGE } from './constants.js';
import { buildFilters, flt, getRange, inRange, isWarn, saveFlt } from './filters.js';
import { viewKey } from './history.js';
import { S } from './state.js';
import { ensureRemote, needFor, remoteNeed, remoteNote } from './remote.js';
import { cutoff, viewEntries } from './store.js';
import { showTab } from './ui.js';
import { rewindButton } from './rewind.js';
import { $, ICON, addDays, diffDays, el, fmtN, pad, parseD, short, todayStr, ymd } from './util.js';

const RED_BLACK = new Set([5, 6]); // Farbe schwarz/rot (wie im PDF-Bericht)

export function barChart(vals, { xl = [], marks = [], showVals = false, center = false } = {}) {
  const W = 320, H = 112, pl = 16, pb = 16, pt = showVals ? 22 : 12; // mit Zahlen über den Balken: oben Platz für Zahl und Markierungspunkte
  const max = Math.max(3, ...vals), n = vals.length, bw = (W - pl) / n;
  const bar = Math.min(18, bw * 0.72), ph = H - pb - pt;
  let s = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">`;
  for (const t of new Set([0, Math.round(max / 2), max])) {
    const y = H - pb - (ph * t) / max;
    s += `<line x1="${pl}" x2="${W}" y1="${y}" y2="${y}"/><text x="0" y="${y + 3}">${t}</text>`;
  }
  vals.forEach((v, i) => {
    const h = (ph * v) / max, x = pl + i * bw + (bw - bar) / 2, y = H - pb - h;
    if (v) s += `<rect class="bar" x="${x}" y="${y}" width="${bar}" height="${h}" rx="2.5"/>`;
    if (showVals && v) s += `<text class="val" x="${x + bar / 2}" y="${y - 3}" text-anchor="middle">${v}</text>`;
    const mk = marks[i] || [];
    const cy = Math.max(4, (v ? y : H - pb) - (showVals && v ? 19 : 5)); // Punkte über der Zahl, nicht darauf
    mk.forEach((k, m) => { s += `<circle class="mk ${k}" cx="${x + bar / 2 + (m - (mk.length - 1) / 2) * 7}" cy="${cy}" r="2.8"/>`; });
  });
  for (const [i, t] of xl) {
    const x = pl + i * bw + bw / 2;
    const anchor = center ? 'middle' : i === 0 && xl.length > 2 ? 'start' : i === n - 1 && xl.length > 2 ? 'end' : 'middle';
    s += `<text x="${anchor === 'start' ? pl : anchor === 'end' ? W : x}" y="${H - 3}" text-anchor="${anchor}">${t}</text>`;
  }
  return el('div', { class: 'chartbox', html: s + '</svg>' });
}

// Liniendiagramm der Ø-Konsistenz (Achse 1–7, Normalbereich 3–4 hell hinterlegt); null = keine Stuhlgänge, Linie bricht dort ab
export function lineChart(vals, { xl = [] } = {}) {
  const W = 320, H = 112, pl = 16, pb = 16, pt = 8, n = vals.length, bw = (W - pl) / n, ph = H - pb - pt;
  const yv = (v) => H - pb - (ph * (v - 1)) / 6, xv = (i) => pl + i * bw + bw / 2;
  let s = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img"><rect class="band" x="${pl}" y="${yv(4)}" width="${W - pl}" height="${yv(3) - yv(4)}"/>`;
  for (const v of [1, 3, 4, 7]) s += `<line x1="${pl}" x2="${W}" y1="${yv(v)}" y2="${yv(v)}"/><text x="0" y="${yv(v) + 3}">${v}</text>`;
  let d = '';
  vals.forEach((v, i) => { if (v != null) d += `${d && vals[i - 1] != null ? 'L' : 'M'}${xv(i).toFixed(1)} ${yv(v).toFixed(1)}`; });
  s += `<path class="ln" d="${d}"/>`;
  vals.forEach((v, i) => { if (v != null) s += `<circle class="pt" cx="${xv(i).toFixed(1)}" cy="${yv(v).toFixed(1)}" r="${n > 40 ? 2 : 2.8}"/>`; });
  for (const [i, t] of xl) {
    const anchor = i === 0 && xl.length > 2 ? 'start' : i === n - 1 && xl.length > 2 ? 'end' : 'middle';
    s += `<text x="${anchor === 'start' ? pl : anchor === 'end' ? W : xv(i)}" y="${H - 3}" text-anchor="${anchor}">${t}</text>`;
  }
  return el('div', { class: 'chartbox', html: s + '</svg>' });
}

export function stack(title, opts, key, list, colors) {
  if (!list.length) return null;
  const counts = opts.map((o) => list.filter((e) => (e[key] || 0) === o.v).length);
  const shade = (i) => (colors ? colors[i] : `color-mix(in srgb, var(--acc) ${28 + i * (72 / Math.max(1, opts.length - 1))}%, var(--opt))`);
  const bar = el('div', { class: 'stkbar' });
  counts.forEach((c, i) => { if (c) bar.append(el('span', { style: `width:${(c / list.length) * 100}%;background:${shade(i)}` })); });
  const legend = el('div', { class: 'legend' }, opts.map((o, i) => el('span', {}, el('i', { style: `background:${shade(i)}` }), `${o.label} ${counts[i]}`)));
  return el('div', { class: 'stk' }, el('div', { class: 'stk-t' }, title), bar, legend);
}

/* ---- Kalender ---- */
export function calendarCard() {
  const card = el('div', { class: 'scard' });
  const [y, m] = S.calMonth.split('-').map(Number);
  const today = todayStr();
  const byDay = {};
  ensureRemote(needFor(`${S.calMonth}-01`, `${S.calMonth}-31`), () => { if (card.isConnected) card.replaceWith(calendarCard()); });
  for (const e of viewEntries()) if (e.date.startsWith(S.calMonth)) (byDay[e.date] = byDay[e.date] || []).push(e);
  const go = (n) => {
    const d = new Date(y, m - 1 + n, 1); S.calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const sc = card.closest('.list'), top = sc ? sc.scrollTop : 0;
    card.replaceWith(calendarCard());
    if (sc) sc.scrollTop = top; // Seite springt beim Monatswechsel nicht nach oben
  };
  const prev = el('button', { class: 'icon sm', 'aria-label': t('Vorheriger Monat'), html: ICON.left });
  const next = el('button', { class: 'icon sm', 'aria-label': t('Nächster Monat'), html: ICON.right });
  prev.addEventListener('click', () => go(-1)); next.addEventListener('click', () => go(1));
  if (S.calMonth >= today.slice(0, 7)) next.disabled = true;
  card.append(el('h3', {}, t('Kalender'), el('span', { class: 'calnav' }, prev,
    el('b', {}, new Date(y, m - 1, 1).toLocaleDateString(LOC, { month: 'long', year: 'numeric' })), next)));
  const grid = el('div', { class: 'cal' }, ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => el('div', { class: 'wd' }, t(d))));
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  for (let i = 0; i < offset; i++) grid.append(el('div', { class: 'cal-d empty' }));
  for (let d = 1; d <= new Date(y, m, 0).getDate(); d++) {
    const ds = `${S.calMonth}-${pad(d)}`, items = (byDay[ds] || []).sort((a, b) => a.time.localeCompare(b.time));
    const stools = items.filter((e) => e.consistency > 0);
    const dots = el('div', { class: 'dots' }, stools.slice(0, 4).map((e) => el('i', { style: `background:var(--c${e.consistency})` })));
    if (stools.length > 4) dots.append(el('small', {}, '+' + (stools.length - 4)));
    const flags = el('div', { class: 'dots flags' },
      items.some((e) => e.blood) ? el('i', { class: 'fb' }) : null, items.some((e) => e.mucus) ? el('i', { class: 'fm' }) : null,
      items.some((e) => e.luft) ? el('i', { class: 'fl' }) : null);
    const cell = el('button', { type: 'button', class: 'cal-d' + (ds === today ? ' today' : '') + (ds > today ? ' fut' : ''), 'aria-label': ds }, el('span', { class: 'num' }, String(d)), dots, flags);
    cell.addEventListener('click', () => { flt.mode = 'range'; flt.from = ds; flt.to = ds; saveFlt(); showTab('hist'); });
    grid.append(cell);
  }
  card.append(grid, el('div', { class: 'legend cal-leg' },
    el('span', {}, el('i', { style: 'background:var(--c4)' }), t('Stuhlgang (Farbe = Typ)')), el('span', {}, el('i', { class: 'fb' }), t('Blut')),
    el('span', {}, el('i', { class: 'fm' }), t('Schleim')), el('span', {}, el('i', { class: 'fl' }), t('Luft'))));
  return card;
}

export function fmtGap(ms) {
  const h = Math.round(ms / 3600000);
  if (h < 48) return `${h} ${t('Std')}`;
  const d = Math.floor(h / 24), r = h % 24;
  return `${d} ${t('T')}${r ? ' ' + r + ' ' + t('Std') : ''}`;
}

export function renderStats(partial = false) {
  const root = $('#vStat');
  const oldList = $('.list', root), key = viewKey();
  const prevScroll = oldList ? oldList.scrollTop : 0; // Position beim Wechseln von Zeitraum/Monat behalten
  const keep = partial && $('.filters', root);
  if (keep) root.querySelectorAll('.list').forEach((n) => n.remove()); else root.replaceChildren();
  const range = getRange(), { from, to, days } = range;
  // Datum mit Jahr, sobald der Zeitraum über einen Jahreswechsel geht
  const sd = (ds) => short(ds, from.slice(0, 4) !== to.slice(0, 4));
  const need = remoteNeed(range), again = () => { if (S.tab === 'stat') renderStats(true); };
  ensureRemote(need, again);
  const all = inRange().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const list = all.filter((e) => e.consistency > 0); // Stuhlgänge
  const body = el('div', { class: 'list stats' });
  body.dataset.key = key;
  if (keep) root.append(body); else root.append(buildFilters(renderStats), body);
  const note = remoteNote(need, again); // steht am Ende der Seite, damit er nichts verdeckt
  if (!all.length) { body.append(el('div', { class: 'empty' }, t('Keine Einträge in diesem Zeitraum.'))); if (note) body.append(note); return; }

  const n = list.length, today = todayStr(), effTo = to > today ? today : to;
  const withDays = new Set(list.map((e) => e.date).filter((d) => d >= from && d <= effTo)).size;
  const avgC = n ? list.reduce((a, e) => a + e.consistency, 0) / n : null;
  let gap = 0, gapTo = '';
  for (let i = 1; i < n; i++) {
    const g = new Date(`${list[i].date}T${list[i].time}`) - new Date(`${list[i - 1].date}T${list[i - 1].time}`);
    if (g > gap) { gap = g; gapTo = list[i].date; }
  }
  const kpi = (val, label, sub, cmp) => el('div', { class: 'kpi' }, el('div', { class: 'v' }, val), el('div', { class: 'l' }, label), sub ? el('div', { class: 's' }, sub) : null, cmp || null);
  const cnt = (arr, k) => arr.filter((e) => e[k]).length;
  const pct = (c, base) => (base ? `${Math.round((c / base) * 100)} %` : '–');

  // Vergleich mit dem gleich langen Zeitraum davor (nicht bei „Alle“; nur wenn dieser Zeitraum lokal vollständig vorliegt, also nicht vor der lokalen Grenze)
  let prev = null;
  if (flt.mode !== 'all') {
    const pTo = ymd(addDays(parseD(from), -1)), pFrom = ymd(addDays(parseD(from), -days)), cut = cutoff();
    if (!cut || pFrom >= cut) {
      const pAll = viewEntries().filter((e) => e.date >= pFrom && e.date <= pTo), pList = pAll.filter((e) => e.consistency > 0);
      if (pAll.length) prev = { perDay: pList.length / days, noStool: days - new Set(pList.map((e) => e.date)).size, avgC: pList.length ? pList.reduce((a, e) => a + e.consistency, 0) / pList.length : null };
    }
  }
  // Neutrale Anzeige ohne Wertung: Pfeil zeigt nur die Richtung
  const cmp = (cur, old, fmt) => {
    if (!prev || cur == null || old == null) return null;
    const arrow = Math.abs(cur - old) < 0.05 ? '→' : cur > old ? '↑' : '↓';
    return el('div', { class: 's cmp' }, `${arrow} ${t('davor')} ${fmt(old)}`);
  };
  const normal = list.filter((e) => e.consistency === 3 || e.consistency === 4).length;
  const warn = all.filter(isWarn), nRB = all.filter((e) => RED_BLACK.has(e.color)).length;
  // Kachel klappt die Einzelwerte (Blut, Schleim, Schmerzen, Luft) auf; offen bleibt sie für diese Sitzung
  const chev = el('span', { class: 'chev', 'aria-hidden': 'true' }, S.statOpen ? '▴' : '▾');
  const warnTile = el('button', { type: 'button', class: 'kpi warn', 'aria-expanded': String(!!S.statOpen) },
    el('div', { class: 'v' }, String(warn.length)), el('div', { class: 'l' }, t('Auffälligkeiten'), ' ', chev),
    el('div', { class: 's' }, warn.length ? [[cnt(all, 'blood'), t('Blut')], [nRB, t('Farbe rot/schwarz')], [cnt(all, 'mucus'), t('Schleim')]].filter(([c]) => c).map(([c, l]) => `${c}× ${l}`).join(' · ') : t('keine')));
  const toHist = el('button', { type: 'button', class: 'dbtn kpi-hist' }, t('Im Verlauf anzeigen') + ' ›');
  toHist.addEventListener('click', () => { S.histWarn = true; showTab('hist'); }); // gleicher Zeitraum, gefiltert (Chip dort löscht den Filter)
  const detail = el('div', { class: 'kpi-more', hidden: !S.statOpen },
    el('div', { class: 'kpis four' },
      kpi(String(cnt(all, 'blood')), t('Blut'), pct(cnt(all, 'blood'), all.length)),
      kpi(String(cnt(all, 'mucus')), t('Schleim'), pct(cnt(all, 'mucus'), all.length)),
      kpi(String(cnt(all, 'pain')), t('Schmerzen'), pct(cnt(all, 'pain'), all.length)),
      kpi(String(cnt(all, 'luft')), t('Luft'), pct(cnt(all, 'luft'), all.length))),
    warn.length ? toHist : null);
  warnTile.addEventListener('click', () => {
    S.statOpen = !S.statOpen; detail.hidden = !S.statOpen;
    chev.textContent = S.statOpen ? '▴' : '▾'; warnTile.setAttribute('aria-expanded', String(S.statOpen));
  });

  body.append(
    el('div', { class: 'kpis' },
      kpi(n.toLocaleString(LOC), n === 1 ? t('Stuhlgang') : t('Stuhlgänge'), `${t('Ø')} ${fmtN(n / days)} ${t('pro Tag')}`, prev && cmp(n / days, prev.perDay, fmtN)),
      kpi(String(Math.max(0, days - withDays)), t('Tage ohne Stuhlgang'), t('von {n} Tagen', { n: days }), prev && cmp(Math.max(0, days - withDays), prev.noStool, String)),
      kpi(n > 1 ? fmtGap(gap) : '–', t('Längste Pause'), n > 1 ? t('bis {d}', { d: sd(gapTo) }) : null),
      kpi(n ? fmtN(avgC) : '–', t('Ø Konsistenz'), n ? CONS[Math.round(avgC) - 1].short : null, prev && cmp(avgC, prev.avgC, fmtN)),
      kpi(n ? pct(normal, n) : '–', t('Anteil normal'), n ? t('Typ 3–4: {a} von {n}', { a: normal, n }) : null),
      warnTile),
    detail);

  body.append(calendarCard());

  if (n) {
    // Stuhlgänge pro Tag / Woche
    const size = days > 62 ? 7 : 1, nb = Math.ceil(days / size);
    const vals = Array(nb).fill(0), marks = Array.from({ length: nb }, () => []);
    const bucket = (e) => Math.min(nb - 1, Math.max(0, Math.floor(diffDays(from, e.date) / size)));
    for (const e of list) vals[bucket(e)]++;
    for (const e of all) { // Markierungen auch für Einträge ohne Stuhl (nur Luft)
      const m = marks[bucket(e)];
      if (e.blood && !m.includes('b')) m.push('b');
      if (e.mucus && !m.includes('m')) m.push('m');
      if (e.luft && !m.includes('l')) m.push('l');
    }
    const bucketDate = (i) => ymd(addDays(parseD(from), i * size));
    const xlFor = (nb, size) => (nb <= 8
      ? Array.from({ length: nb }, (_, i) => [i, size === 1 ? parseD(bucketDate(i)).toLocaleDateString(LOC, { weekday: 'short' }).replace('.', '') : sd(bucketDate(i))])
      : [[0, sd(bucketDate(0))], [Math.floor(nb / 2), sd(bucketDate(Math.floor(nb / 2)))], [nb - 1, sd(bucketDate(nb - 1))]]);
    body.append(el('div', { class: 'scard' },
      el('h3', {}, size === 1 ? t('Stuhlgänge pro Tag') : t('Stuhlgänge pro Woche'), el('span', { class: 'legend-mk' }, el('i', { class: 'b' }), t('Blut'), el('i', { class: 'm' }), t('Schleim'), el('i', { class: 'l' }), t('Luft'))),
      barChart(vals, { xl: xlFor(nb, size), marks, showVals: nb <= 14 })));

    // Ø Konsistenz im Verlauf: pro Tag (bis ca. 31 Tage), sonst pro Woche
    const csize = days > 31 ? 7 : 1, cnb = Math.ceil(days / csize);
    const sum = Array(cnb).fill(0), num = Array(cnb).fill(0);
    for (const e of list) { const b = Math.min(cnb - 1, Math.max(0, Math.floor(diffDays(from, e.date) / csize))); sum[b] += e.consistency; num[b]++; }
    body.append(el('div', { class: 'scard' },
      el('h3', {}, csize === 1 ? t('Ø Konsistenz pro Tag') : t('Ø Konsistenz pro Woche'), el('span', { class: 'legend-mk' }, el('i', { class: 'nb' }), t('normal (3–4)'))),
      lineChart(sum.map((v, i) => (num[i] ? v / num[i] : null)), { xl: xlFor(cnb, csize) })));

    // Konsistenz
    const cc = CONS.map((c) => list.filter((e) => e.consistency === c.v).length), cmax = Math.max(...cc);
    body.append(el('div', { class: 'scard' }, el('h3', {}, t('Konsistenz')),
      CONS.map((c, i) => el('div', { class: 'crow' },
        el('div', { class: 'cname' }, el('b', { style: `color:var(--c${c.v})` }, String(c.v)), ' ', c.short),
        el('div', { class: 'cbar' }, cc[i] ? el('span', { style: `width:${(cc[i] / cmax) * 100}%;background:var(--c${c.v})` }) : null),
        el('div', { class: 'cnum' }, String(cc[i]))))));

    // Tageszeit
    const hours = Array(24).fill(0);
    for (const e of list) hours[Number(e.time.slice(0, 2))]++;
    const peak = hours.indexOf(Math.max(...hours));
    body.append(el('div', { class: 'scard' },
      el('h3', {}, t('Tageszeit'), el('span', { class: 'sub-r' }, t('meist {a}–{b} Uhr', { a: peak, b: peak + 1 }))),
      barChart(hours, { xl: [[0, '0'], [6, '6'], [12, '12'], [18, '18'], [23, t('23 Uhr')]] })));

    // Wochentag (Mo–So)
    const wd = Array(7).fill(0), wn = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => t(d));
    for (const e of list) wd[(parseD(e.date).getDay() + 6) % 7]++;
    body.append(el('div', { class: 'scard' },
      el('h3', {}, t('Wochentag'), el('span', { class: 'sub-r' }, t('meist {d}', { d: wn[wd.indexOf(Math.max(...wd))] }))),
      barChart(wd, { xl: wn.map((d, i) => [i, d]), showVals: true, center: true })));
  }

  body.append(el('div', { class: 'scard' }, el('h3', {}, t('Verteilung')),
    stack(t('Stuhldrang'), URGE, 'urge', list), stack(t('Menge'), AMOUNT, 'amount', list),
    stack(t('Farbe'), COLORS, 'color', list.filter((e) => e.color > 0), COLORS.map((c) => c.hex)), stack(t('Schmerzen / Krämpfe'), PAIN, 'pain', all)));
  body.append(rewindButton()); // bewusst unauffällig am Ende
  if (note) body.append(note);
  body.scrollTop = prevScroll;
}
