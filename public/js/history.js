// Ansicht „Verlauf“ inkl. Jahresübersicht
import { LOC, t } from './i18n.js';
import { describeEntry, mealLabel } from './constants.js';
import { openDetail } from './detail.js';
import { openSheet } from './edit.js';
import { buildFilters, flt, getRange, inRange, isWarn, saveFlt } from './filters.js';
import { S } from './state.js';
import { ensureRemote, remoteNeed, remoteNote } from './remote.js';
import { openFoodSheet } from './food.js';
import { activeFoods, setDeleted, setFoodDeleted } from './store.js';
import { toast } from './ui.js';
import { $, ICON, LS, addDays, el, fmtD, fmtN, nF, pad, parseD, todayStr, ymd, DEV } from './util.js';

export function dayLabel(ds) {
  const today = todayStr();
  const full = parseD(ds).toLocaleDateString(LOC, { day: '2-digit', month: '2-digit', year: 'numeric' });
  if (ds === today) return `${t('Heute')}, ${full}`;
  if (ds === ymd(addDays(new Date(), -1))) return `${t('Gestern')}, ${full}`;
  return `${parseD(ds).toLocaleDateString(LOC, { weekday: 'short' })} ${full}`;
}

export const ACT_W = 148;
export function closeOpen(except) {
  if (S.openRow && S.openRow !== except) { S.openRow.classList.remove('open'); S.openRow.style.transform = ''; S.openRow = null; }
}
// Knöpfe hinter einer aufgeschobenen Zeile: schon beim Loslassen auslösen. Ein „click“ fällt auf Android oft aus,
// wenn der Tipp zugleich ein letztes Nachschwingen der Liste anhält; dann musste man zweimal tippen.
export function onAct(btn, fn) {
  let x = 0, y = 0, at = 0;
  btn.addEventListener('pointerdown', (ev) => { x = ev.clientX; y = ev.clientY; });
  btn.addEventListener('pointerup', (ev) => {
    if (ev.pointerType === 'mouse' || Math.abs(ev.clientX - x) > 10 || Math.abs(ev.clientY - y) > 10) return;
    at = Date.now(); fn();
  });
  btn.addEventListener('click', () => { if (Date.now() - at > 600) fn(); }); // Maus und Tastatur
}
export function attachSwipe(c, onTap) {
  let sx = 0, sy = 0, base = 0, dx = 0, lock = null, active = false;
  c.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    if (ev.target.closest && ev.target.closest('.ibtn')) return;
    active = true; lock = null; sx = ev.clientX; sy = ev.clientY;
    base = c.classList.contains('open') ? -ACT_W : 0; dx = base;
    closeOpen(c);
  });
  c.addEventListener('pointermove', (ev) => {
    if (!active) return;
    const mx = ev.clientX - sx, my = ev.clientY - sy;
    if (!lock && (Math.abs(mx) > 8 || Math.abs(my) > 8)) {
      lock = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if (lock === 'x') { try { c.setPointerCapture(ev.pointerId); } catch {} c.style.transition = 'none'; }
      else active = false;
    }
    if (lock === 'x') {
      dx = Math.max(-ACT_W, Math.min(0, base + mx));
      c.style.transform = `translateX(${dx}px)`;
    }
  });
  const end = (cancelled) => {
    if (!active) return; active = false;
    if (lock === 'x') {
      c.style.transition = '';
      const open = dx < -ACT_W / 2;
      c.classList.toggle('open', open);
      c.style.transform = open ? `translateX(${-ACT_W}px)` : '';
      S.openRow = open ? c : null;
    } else if (!lock && !cancelled) {
      if (c.classList.contains('open')) closeOpen(); else onTap();
    }
  };
  c.addEventListener('pointerup', () => end(false));
  c.addEventListener('pointercancel', () => end(true));
}

// Zuletzt gespeicherte oder wiederhergestellte Zeile einmal sanft einblenden
function markNew(wrap, id) {
  if (S.justAdded !== id) return;
  S.justAdded = null; wrap.classList.add('row-new');
  setTimeout(() => wrap.classList.remove('row-new'), 600);
}
// Gelöschte Zeile klappt zusammen, danach wird die Liste neu gezeichnet
function collapse(wrap, done) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return; }
  wrap.style.height = wrap.offsetHeight + 'px'; void wrap.offsetHeight;
  wrap.classList.add('row-gone');
  setTimeout(done, 220);
}

export function rowEl(e) {
  const { stool, name, parts, onlyLuft, urgeAt } = describeEntry(e);
  const edit = el('button', { class: 'e', 'aria-label': t('Bearbeiten'), html: ICON.edit });
  const del = el('button', { class: 'd', 'aria-label': t('Löschen'), html: ICON.trash });
  const c = el('div', { class: 'srow' },
    el('div', { class: 'time' }, e.time),
    el('div', { class: 'badge c' + e.consistency }, stool ? String(e.consistency) : '–'),
    el('div', { class: 'txt' },
      el('div', { class: 't1' }, el('span', { class: 'nm' }, name),
        e.blood ? el('span', { class: 'pill' }, t('Blut')) : null, e.mucus ? el('span', { class: 'pill mu' }, t('Schleim')) : null,
        e.luft && !onlyLuft ? el('span', { class: 'pill lf' }, t('Luft')) : null),
      // Drang leicht/mittel/stark farbig (gelb bis rot), alles andere bleibt grau
      parts.length ? el('div', { class: 't2' }, ...parts.flatMap((p, i) => [i ? ' · ' : '', i === urgeAt && e.urge ? el('span', { class: 'urge u' + e.urge }, p) : p])) : null,
      e.note ? el('div', { class: 'rnote', hidden: true }, e.note) : null),
    e.note ? el('button', { type: 'button', class: 'ibtn', 'aria-label': t('Notiz anzeigen'), html: ICON.info }) : null);
  const infoBtn = c.querySelector('.ibtn');
  if (infoBtn) infoBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const n = c.querySelector('.rnote'); n.hidden = !n.hidden; infoBtn.classList.toggle('on', !n.hidden);
  });
  const wrap = el('div', { class: 'swrap' }, el('div', { class: 'acts' }, edit, del), c);
  // Mit Essen: Tippen öffnet die Detailansicht (Essen davor, Stift zum Bearbeiten); sonst direkt das Bearbeiten-Fenster
  const openRow = () => (S.foodOn ? openDetail('stool', e.id) : openSheet(e.id));
  attachSwipe(c, openRow); rowKeys(c, openRow, del);
  onAct(edit, () => { closeOpen(); openSheet(e.id); });
  onAct(del, () => {
    closeOpen();
    collapse(wrap, () => { setDeleted(e.id, true); renderHist(); });
    toast(t('Eintrag gelöscht'), t('Rückgängig'), () => { setDeleted(e.id, false); S.justAdded = e.id; renderHist(); });
  });
  markNew(wrap, e.id);
  return wrap;
}

// Tastatur-Alternative zum Wischen/Tippen: Zeile ist fokussierbar, Enter/Leertaste öffnet, Entf löscht (Mit der Maus geht auch Ziehen wie beim Wischen)
function rowKeys(c, open, del) {
  c.tabIndex = 0; c.setAttribute('role', 'button');
  c.addEventListener('keydown', (ev) => {
    if (ev.target !== c) return; // nicht, wenn der Fokus auf dem Info-Knopf in der Zeile liegt
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
    else if (ev.key === 'Delete') { ev.preventDefault(); del.click(); }
  });
}

// Essen im Verlauf
export function foodRowEl(f) {
  const edit = el('button', { class: 'e', 'aria-label': t('Bearbeiten'), html: ICON.edit });
  const del = el('button', { class: 'd', 'aria-label': t('Löschen'), html: ICON.trash });
  const c = el('div', { class: 'srow food' },
    el('div', { class: 'time' }, f.time),
    el('div', { class: 'badge fb', html: ICON.food }),
    el('div', { class: 'txt' }, el('div', { class: 't1' }, el('span', { class: 'nm wrapname' }, f.text || '–')), f.meal ? el('div', { class: 't2' }, mealLabel(f.meal)) : null));
  const wrap = el('div', { class: 'swrap' }, el('div', { class: 'acts' }, edit, del), c);
  const openRow = () => openDetail('food', f.id);
  attachSwipe(c, openRow); rowKeys(c, openRow, del);
  onAct(edit, () => { closeOpen(); openFoodSheet(f.id); });
  onAct(del, () => {
    closeOpen();
    collapse(wrap, () => { setFoodDeleted(f.id, true); renderHist(); });
    toast(t('Essen gelöscht'), t('Rückgängig'), () => { setFoodDeleted(f.id, false); S.justAdded = f.id; renderHist(); });
  });
  markNew(wrap, f.id);
  return wrap;
}
function kindRow() { // Anzeige: nur Stuhl, beides oder nur Essen
  return el('div', { class: 'chips kindchips' }, [['stool', t('Stuhl')], ['both', t('Beides')], ['food', t('Essen')]].map(([v, label]) => {
    const b = el('button', { type: 'button', class: 'chip' + (S.histKind === v ? ' on' : '') }, label);
    b.addEventListener('click', () => { S.histKind = v; DEV.set('histKind', v); renderHist(); });
    return b;
  }));
}

export const METRICS = [['stool', t('Stuhlgang'), 'var(--acc)'], ['blood', t('Blut'), 'var(--blood)'], ['mucus', t('Schleim'), '#b58420'], ['luft', t('Luft'), '#4a7fb5'], ['pain', t('Schmerzen'), '#8a6bbf']];
export const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'].map((m) => t(m));

export function yearOverview(list, y) {
  const body = el('div', { class: 'list yearv' });
  const [, , base] = METRICS.find((m) => m[0] === S.yearMetric);
  const val = (e) => (S.yearMetric === 'stool' ? (e.consistency > 0 ? 1 : 0) : e[S.yearMetric] ? 1 : 0);
  const perDay = {}, perMonth = Array.from({ length: 12 }, () => ({ n: 0, cons: 0, stools: 0 }));
  for (const e of list) {
    const v = val(e), m = Number(e.date.slice(5, 7)) - 1;
    if (v) { perDay[e.date] = (perDay[e.date] || 0) + v; perMonth[m].n += v; }
    if (e.consistency > 0) { perMonth[m].cons += e.consistency; perMonth[m].stools++; }
  }
  const today = todayStr();
  const chips = el('div', { class: 'chips ymetric' }, METRICS.map(([k, l]) => {
    const b = el('button', { class: 'chip' + (S.yearMetric === k ? ' on' : '') }, l);
    b.addEventListener('click', () => { S.yearMetric = k; renderHist(true); });
    return b;
  }));
  // Heatmap: Monate als Spalten, Tage als Zeilen
  const hm = el('div', { class: 'hm' }, el('div'), MONTHS.map((m) => el('div', { class: 'mh' }, m)));
  for (let d = 1; d <= 31; d++) {
    hm.append(el('div', { class: 'dl' }, d === 1 || d % 5 === 0 ? String(d) : ''));
    for (let m = 1; m <= 12; m++) {
      const dim = new Date(y, m, 0).getDate();
      if (d > dim) { hm.append(el('div', { class: 'hc x' })); continue; }
      const ds = `${y}-${pad(m)}-${pad(d)}`, n = perDay[ds] || 0;
      const cell = el('button', { type: 'button', class: 'hc' + (ds > today ? ' f' : ''), 'aria-label': `${fmtD(ds)}: ${n}`,
        style: n ? `background:color-mix(in srgb, ${base} ${n === 1 ? 45 : n === 2 ? 72 : 100}%, var(--opt))` : null });
      cell.addEventListener('click', () => { flt.mode = 'range'; flt.from = ds; flt.to = ds; saveFlt(); renderHist(); });
      hm.append(cell);
    }
  }
  const total = perMonth.reduce((a, m) => a + m.n, 0);
  body.append(chips,
    el('div', { class: 'scard' }, el('h3', {}, t('Jahresübersicht') + ' ' + y, el('span', { class: 'sub-r' }, `${total}×`)), hm,
      el('div', { class: 'hm-leg' }, t('weniger'), ...[0, 45, 72, 100].map((p) => el('i', { style: `background:color-mix(in srgb, ${base} ${p}%, var(--opt))` })), t('mehr'))));
  // Monatsübersicht
  const mx = Math.max(1, ...perMonth.map((m) => m.n));
  const rows = el('div', { class: 'scard' }, el('h3', {}, t('Monate')));
  perMonth.forEach((m, i) => {
    const key = `${y}-${pad(i + 1)}`, future = key > today.slice(0, 7);
    const dim = new Date(y, i + 1, 0).getDate();
    const elapsed = key === today.slice(0, 7) ? Number(today.slice(8)) : dim;
    const avg = m.stools ? Math.round(m.cons / m.stools) : 0;
    const r = el('button', { type: 'button', class: 'mrow' + (future ? ' f' : '') },
      el('span', { class: 'mn' }, MONTHS[i]),
      el('span', { class: 'mbar' }, m.n ? el('i', { style: `width:${(m.n / mx) * 100}%;background:${base}` }) : null),
      el('span', { class: 'mc' }, String(m.n)),
      el('span', { class: 'ma' }, m.n && !future ? `${t('Ø')} ${fmtN(m.n / elapsed)}/${t('Tag')}` : ''),
      S.yearMetric === 'stool' && avg ? el('span', { class: 'badge sm c' + avg }, String(avg)) : el('span'));
    r.addEventListener('click', () => { flt.mode = 'month'; flt.month = key; saveFlt(); renderHist(); });
    rows.append(r);
  });
  body.append(rows);
  return body;
}

export const viewKey = () => JSON.stringify([flt.mode, flt.month, flt.year, flt.from, flt.to, S.yearMetric, S.foodOn ? S.histKind : '', !!S.histWarn]);
export function renderHist(partial = false) {
  const root = $('#vHist');
  const oldList = $('.list', root), key = viewKey();
  const prevScroll = oldList && oldList.dataset.key === key ? oldList.scrollTop : 0; // Scrollposition nur bei gleicher Ansicht behalten
  const keep = partial && $('.filters', root); // Filterfelder behalten, damit das Tippen im Datumsfeld nicht unterbrochen wird
  if (keep) root.querySelectorAll('.summary, .list, .remote-note').forEach((n) => n.remove()); else root.replaceChildren();
  S.openRow = null;
  const range = getRange(), { days } = range;
  const need = remoteNeed(range), again = () => { if (S.tab === 'hist') renderHist(true); };
  ensureRemote(need, again);
  const note = remoteNote(need, again);
  const kind = S.foodOn ? S.histKind : 'stool'; // was angezeigt wird: Stuhl, beides oder nur Essen
  const list = inRange().filter((e) => !S.histWarn || isWarn(e)).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const foods = kind === 'stool' || S.histWarn ? [] : activeFoods().filter((f) => f.date >= range.from && f.date <= range.to);
  const cnt = (k) => list.filter((e) => e[k]).length;
  const stools = list.filter((e) => e.consistency > 0).length;
  const [blood, mucus, pain, luft] = [cnt('blood'), cnt('mucus'), cnt('pain'), cnt('luft')];
  const warnChip = S.histWarn ? el('button', { type: 'button', class: 'chip on wchip' }, t('Auffälligkeiten'), el('span', { class: 'x', 'aria-hidden': 'true' }, ' ×')) : null;
  if (warnChip) { warnChip.setAttribute('aria-label', t('Filter Auffälligkeiten entfernen')); warnChip.addEventListener('click', () => { S.histWarn = false; renderHist(); }); }
  const summary = kind === 'food' && !S.histWarn ? el('div', { class: 'summary' }, el('span', {}, nF(foods.length))) : el('div', { class: 'summary' },
    warnChip,
    el('span', {}, el('b', {}, stools.toLocaleString(LOC)), ' ' + (stools === 1 ? t('Stuhlgang') : t('Stuhlgänge'))),
    S.histWarn ? null : el('span', {}, t('Ø') + ' ', el('b', {}, fmtN(stools / days)), ' ' + t('pro Tag')), // gefiltert ergibt ein Tagesschnitt keinen Sinn
    blood ? el('span', {}, el('b', {}, blood + '×'), ' ' + t('Blut')) : null,
    mucus ? el('span', {}, el('b', {}, mucus + '×'), ' ' + t('Schleim')) : null,
    pain ? el('span', {}, el('b', {}, pain + '×'), ' ' + t('Schmerzen')) : null,
    luft ? el('span', {}, el('b', {}, luft + '×'), ' ' + t('Luft')) : null,
    kind === 'both' ? el('span', {}, nF(foods.length)) : null);

  let body, more = null;
  if (flt.mode === 'year' && kind !== 'food') body = yearOverview(list, Number(flt.year));
  else {
    body = el('div', { class: 'list' });
    const all = [...(kind === 'food' ? [] : list).map((e) => ({ e, d: e.date, k: e.date + e.time })), ...foods.map((f) => ({ f, d: f.date, k: f.date + f.time }))].sort((a, b) => b.k.localeCompare(a.k));
    if (!all.length) body.append(el('div', { class: 'empty' }, t('Keine Einträge in diesem Zeitraum.')));
    const byDay = new Map();
    for (const x of all) { if (!byDay.has(x.d)) byDay.set(x.d, []); byDay.get(x.d).push(x); }
    const dayList = [...byDay]; let idx = 0;
    // Bei vielen Einträgen (Tausende) wird die Liste stückweise aufgebaut
    more = (n = 120) => {
      let c = 0;
      while (idx < dayList.length && c < n) {
        const [d, items] = dayList[idx++];
        const nodes = [el('div', { class: 'day' }, el('span', {}, dayLabel(d)), el('span', {}, items.length + '×')),
          el('div', { class: 'card' }, items.map((x) => (x.e ? rowEl(x.e) : foodRowEl(x.f))))];
        if (note && note.parentNode === body) note.before(...nodes); else body.append(...nodes); // Hinweis bleibt ganz unten
        c += items.length;
      }
      return idx < dayList.length;
    };
    more();
    body.addEventListener('scroll', () => { if (body.scrollTop + body.clientHeight > body.scrollHeight - 700) more(); });
  }
  if (note) body.append(note); // Hinweis zu älteren Einträgen steht am Ende der Seite, damit er nichts verdeckt
  body.dataset.key = key;
  const parts = [summary, body].filter(Boolean);
  if (keep) root.append(...parts); else { const filters = buildFilters(renderHist); if (S.foodOn) filters.append(kindRow()); root.append(filters, ...parts); }
  if (more) while (body.scrollHeight < prevScroll + body.clientHeight + 300 && more()); // Scrollposition nach Änderungen halten
  body.scrollTop = prevScroll;
}
