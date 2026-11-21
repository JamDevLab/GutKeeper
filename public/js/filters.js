// Zeitraum-Filter für Verlauf und Statistik
import { LOC, t } from './i18n.js';
import { viewEntries } from './store.js';
import { ICON, LS, addDays, diffDays, el, pad, todayStr, ymd } from './util.js';

export const MODES = [['7', t('7 Tage')], ['30', t('30 Tage')], ['month', t('Monat')], ['year', t('Jahr')], ['range', t('Zeitraum')], ['all', t('Alle')]];
export const flt = { mode: '7', month: todayStr().slice(0, 7), year: todayStr().slice(0, 4), from: ymd(addDays(new Date(), -13)), to: todayStr(), ...LS.get('filter', {}) };
export const saveFlt = () => LS.set('filter', flt);

export function getRange() {
  const today = todayStr();
  if (flt.mode === '7' || flt.mode === '30') {
    const n = Number(flt.mode);
    return { from: ymd(addDays(new Date(), -(n - 1))), to: today, days: n };
  }
  let from, to;
  if (flt.mode === 'month') {
    const [y, m] = flt.month.split('-').map(Number);
    from = `${y}-${pad(m)}-01`; to = ymd(new Date(y, m, 0));
  } else if (flt.mode === 'year') {
    from = `${flt.year}-01-01`; to = `${flt.year}-12-31`;
  } else if (flt.mode === 'range') {
    from = flt.from; to = flt.to; if (from > to) [from, to] = [to, from];
  } else {
    const all = viewEntries().map((e) => e.date).sort();
    from = all[0] || today; to = today;
  }
  const effTo = to > today ? today : to;
  return { from, to, days: Math.max(1, diffDays(from, effTo) + 1) };
}
// Auffälligkeiten (neutral, keine Bewertung): Blut, Schleim oder Farbe schwarz/rot
export const isWarn = (e) => !!(e.blood || e.mucus || e.color === 5 || e.color === 6);
export const inRange = () => {
  const { from, to } = getRange();
  return viewEntries().filter((e) => e.date >= from && e.date <= to);
};

export function buildFilters(rerender) {
  const chips = el('div', { class: 'chips' }, MODES.map(([m, label]) => {
    const b = el('button', { class: 'chip' + (flt.mode === m ? ' on' : '') }, label);
    b.addEventListener('click', () => { flt.mode = m; saveFlt(); rerender(); });
    return b;
  }));
  const filters = el('div', { class: 'filters' }, chips);
  if (flt.mode === 'month') {
    const [y, m] = flt.month.split('-').map(Number);
    const shift = (n) => { const d = new Date(y, m - 1 + n, 1); flt.month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; saveFlt(); rerender(); };
    const prev = el('button', { class: 'icon', 'aria-label': t('Vorheriger Monat'), html: ICON.left });
    const next = el('button', { class: 'icon', 'aria-label': t('Nächster Monat'), html: ICON.right });
    prev.addEventListener('click', () => shift(-1)); next.addEventListener('click', () => shift(1));
    if (flt.month >= todayStr().slice(0, 7)) next.disabled = true;
    filters.append(el('div', { class: 'sub' }, prev,
      el('div', { class: 'lab' }, new Date(y, m - 1, 1).toLocaleDateString(LOC, { month: 'long', year: 'numeric' })), next));
  } else if (flt.mode === 'year') {
    const y = Number(flt.year);
    const shift = (n) => { flt.year = String(y + n); saveFlt(); rerender(); };
    const prev = el('button', { class: 'icon', 'aria-label': t('Vorheriges Jahr'), html: ICON.left });
    const next = el('button', { class: 'icon', 'aria-label': t('Nächstes Jahr'), html: ICON.right });
    prev.addEventListener('click', () => shift(-1)); next.addEventListener('click', () => shift(1));
    if (y >= new Date().getFullYear()) next.disabled = true;
    filters.append(el('div', { class: 'sub' }, prev, el('div', { class: 'lab' }, String(y)), next));
  } else if (flt.mode === 'range') {
    const f = el('input', { type: 'date', class: 'dt', value: flt.from, 'aria-label': t('Von') });
    const tt = el('input', { type: 'date', class: 'dt', value: flt.to, 'aria-label': t('Bis') });
    f.addEventListener('change', () => { if (f.value) { flt.from = f.value; saveFlt(); rerender(true); } });
    tt.addEventListener('change', () => { if (tt.value) { flt.to = tt.value; saveFlt(); rerender(true); } });
    filters.append(el('div', { class: 'sub' }, f, el('span', { class: 'sep' }, t('bis')), tt));
  }
  return filters;
}
