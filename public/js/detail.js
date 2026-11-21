// Detailansicht eines Eintrags: bei Stuhl das Essen davor, bei Essen die Einträge danach (wählbares Zeitfenster)
import { describeEntry, mealLabel } from './constants.js';
import { openSheet } from './edit.js';
import { openFoodSheet } from './food.js';
import { dateLabel } from './form.js';
import { t } from './i18n.js';
import { activeFoods, getEntry, getFood, setDeleted, setFoodDeleted, viewEntries } from './store.js';
import { refreshViews, toast } from './ui.js';
import { ICON, LS, el, openOverlay, DEV } from './util.js';

const WINS = [12, 24, 48, 72];
const ts = (x) => new Date(`${x.date}T${x.time}`).getTime();
export function fmtSpan(ms) {
  const m = Math.max(0, Math.round(ms / 60000)), h = Math.floor(m / 60), r = m % 60;
  if (!h) return t('{m} Min', { m: r });
  return r ? t('{h} Std {m} Min', { h, m: r }) : t('{h} Std', { h });
}

export function openDetail(kind, id) {
  const item = kind === 'food' ? getFood(id) : getEntry(id);
  if (!item) return;
  const saved = DEV.get('foodWin', 48);
  let win = WINS.includes(saved) ? saved : 48;
  const close = () => ov.remove();

  // Kopf: Symbol, Titel, Datum – und der Stift zum Bearbeiten
  const edit = el('button', { type: 'button', class: 'icon dt-edit', 'aria-label': t('Bearbeiten'), title: t('Bearbeiten'), html: ICON.edit });
  edit.addEventListener('click', () => { close(); if (kind === 'food') openFoodSheet(id); else openSheet(id); });
  // Löschen mit „Rückgängig“, wie beim Wischen im Verlauf
  const del = el('button', { type: 'button', class: 'icon dt-edit dt-del', 'aria-label': t('Löschen'), title: t('Löschen'), html: ICON.trash });
  del.addEventListener('click', () => {
    close();
    const set = kind === 'food' ? setFoodDeleted : setDeleted;
    set(id, true); refreshViews();
    toast(kind === 'food' ? t('Essen gelöscht') : t('Eintrag gelöscht'), t('Rückgängig'), () => { set(id, false); refreshViews(); });
  });
  let badge, title, sub = null;
  if (kind === 'food') {
    badge = el('div', { class: 'badge fb', html: ICON.food });
    title = el('div', { class: 'dt-name wrapname' }, item.text || '–');
    if (item.meal) sub = el('div', { class: 'dt-sub' }, mealLabel(item.meal));
  } else {
    const d = describeEntry(item);
    badge = el('div', { class: 'badge c' + item.consistency }, d.stool ? String(item.consistency) : '–');
    title = el('div', { class: 'dt-name' }, d.name);
    const pills = [item.blood ? el('span', { class: 'pill' }, t('Blut')) : null, item.mucus ? el('span', { class: 'pill mu' }, t('Schleim')) : null,
      item.luft && !d.onlyLuft ? el('span', { class: 'pill lf' }, t('Luft')) : null].filter(Boolean);
    if (d.parts.length || pills.length) sub = el('div', { class: 'dt-sub' }, d.parts.join(' · '), ...pills);
  }
  const head = el('div', { class: 'dt-head' }, badge,
    el('div', { class: 'dt-title' }, title, el('div', { class: 'dt-when' }, `${dateLabel(item.date)} · ${item.time}`)), el('div', { class: 'dt-acts' }, edit, del));
  const note = kind === 'stool' && item.note ? el('div', { class: 'rnote' }, item.note) : null;

  // Zeitfenster und Liste
  const chips = el('div', { class: 'chips' }, WINS.map((w) => {
    const b = el('button', { type: 'button', class: 'chip' + (w === win ? ' on' : '') }, t('{n} Std', { n: w }));
    b.addEventListener('click', () => { win = w; DEV.set('foodWin', w); chips.querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('on', WINS[i] === w)); draw(); });
    return b;
  }));
  const list = el('div', { class: 'dlist' });
  const line = (time, main, subText, when, lead) => el('div', { class: 'dline' }, el('div', { class: 'dtime' }, time), lead || null,
    el('div', { class: 'dtxt' }, el('div', { class: 'dmain' }, main), subText ? el('div', { class: 'dsub' }, subText) : null), el('div', { class: 'dwhen' }, when));
  const draw = () => {
    const t0 = ts(item), span = win * 3600000;
    let rows;
    if (kind === 'stool') { // Essen davor, das Nächstliegende zuerst
      rows = activeFoods().filter((f) => ts(f) <= t0 && ts(f) >= t0 - span).sort((a, b) => ts(b) - ts(a))
        .map((f) => ({ date: f.date, el: line(f.time, f.text, mealLabel(f.meal), t('vor {x}', { x: fmtSpan(t0 - ts(f)) })) }));
    } else { // danach eingetragene Einträge, das Nächstliegende zuerst
      rows = viewEntries().filter((e) => ts(e) >= t0 && ts(e) <= t0 + span && e.id !== item.id).sort((a, b) => ts(a) - ts(b))
        .map((e) => { const d = describeEntry(e); return { date: e.date, el: line(e.time, d.name, d.parts.join(' · '), t('nach {x}', { x: fmtSpan(ts(e) - t0) }), el('div', { class: 'badge sm c' + e.consistency }, d.stool ? String(e.consistency) : '–')) }; });
    }
    list.replaceChildren();
    if (!rows.length) { list.append(el('div', { class: 'empty small' }, kind === 'stool' ? t('In diesem Zeitraum wurde kein Essen eingetragen.') : t('In diesem Zeitraum wurde nichts weiter eingetragen.'))); return; }
    let last = '';
    for (const r of rows) {
      if (r.date !== last) { last = r.date; list.append(el('div', { class: 'dgroup' }, dateLabel(r.date))); }
      list.append(r.el);
    }
  };
  draw();

  const closeBtn = el('button', { type: 'button' }, t('Schließen'));
  closeBtn.addEventListener('click', close);
  const sheet = el('div', { class: 'sheet detail', role: 'dialog', 'aria-label': t('Details') },
    head, sub, note,
    el('div', { class: 'dt-sec' }, el('h3', {}, kind === 'stool' ? t('Essen davor') : t('Danach eingetragen')), chips), list,
    el('div', { class: 'btns' }, closeBtn));
  const ov = openOverlay(sheet, close);
}
