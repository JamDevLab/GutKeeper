// Essen (optional): erfassen und bearbeiten
import { MEALS, defaultMeal } from './constants.js';
import { dtRow, inFuture, futureMsg, pressable, sheetHead } from './form.js';
import { renderHist } from './history.js';
import { t } from './i18n.js';
import { S } from './state.js';
import { addFood, getFood, recentFoods, updateFood } from './store.js';
import { toast } from './ui.js';
import { ICON, LS, el, openOverlay, playAnim } from './util.js';
import { hasToken, toggleToken } from './notetags.js';

// Mahlzeit wählen (erneutes Tippen hebt die Auswahl wieder auf)
function mealChips(s) {
  const wrap = el('div', { class: 'chips mealchips' });
  const btns = MEALS.map((m) => {
    const b = el('button', { type: 'button', class: 'chip' }, m.label);
    b.addEventListener('click', () => { s.meal = s.meal === m.v ? 0 : m.v; wrap.paint(); });
    wrap.append(b); return b;
  });
  wrap.paint = () => btns.forEach((b, i) => b.classList.toggle('on', s.meal === MEALS[i].v));
  wrap.paint();
  return wrap;
}
// Textfeld mit kleinem ×-Knopf zum Leeren (nur sichtbar, wenn etwas drinsteht). onChange: z. B. Vorschläge neu markieren
function foodText(s, onChange) {
  const ta = el('textarea', { class: 'note-ta food-ta', rows: 3, maxlength: 200, placeholder: t('Was hast du gegessen? z. B. Pizza'), 'aria-label': t('Essen') });
  const clr = el('button', { type: 'button', class: 'ta-clear', html: ICON.x, 'aria-label': t('Text leeren'), title: t('Text leeren') });
  const wrap = el('div', { class: 'ta-wrap' }, ta, clr);
  wrap.paint = () => { clr.hidden = !ta.value; };
  wrap.set = (v) => { ta.value = v; s.text = v; wrap.paint(); onChange && onChange(); };
  ta.value = s.text || '';
  ta.addEventListener('input', () => { s.text = ta.value; wrap.paint(); onChange && onChange(); });
  clr.addEventListener('mousedown', (ev) => ev.preventDefault()); // Fokus (und Tastatur) bleibt im Textfeld
  clr.addEventListener('click', () => { wrap.set(''); ta.focus(); });
  wrap.ta = ta; wrap.paint();
  return wrap;
}

// Angeheftete Speisen: nur auf diesem Gerät (je Konto), stehen vor den zuletzt gegessenen
const PIN_MAX = 12;
// Noch nie etwas angeheftet oder gelöst (kein gespeicherter Wert): Vorgabe aus data/settings.json („foodPins“, Server)
const getPins = () => {
  let v = LS.get('foodPins', null);
  if (!Array.isArray(v)) v = S.config && S.config.foodPins;
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, PIN_MAX) : [];
};
const samePin = (a, b) => a.toLowerCase() === b.toLowerCase();
function togglePin(txt) {
  const pins = getPins();
  if (pins.some((p) => samePin(p, txt))) { LS.set('foodPins', pins.filter((p) => !samePin(p, txt))); toast(t('„{x}“ gelöst', { x: txt })); return; }
  if (pins.length >= PIN_MAX) { toast(t('Höchstens {n} angeheftete Speisen', { n: PIN_MAX })); return; }
  LS.set('foodPins', [...pins, txt]); toast(t('„{x}“ angeheftet', { x: txt }));
}
const group = (label, kid) => el('div', { class: 'grp' }, el('div', { class: 'lbl' }, label), kid);

// Eingabe im Tab „Erfassen“ (Datum und Uhrzeit kommen aus derselben Leiste wie beim Stuhl)
export function buildFoodBox(cap, onSaved) {
  const s = { meal: defaultMeal(cap.time), text: '' };
  const meal = mealChips(s);
  const recent = el('div', { class: 'chips note-chips' });
  const ta = foodText(s, () => markRecent());
  // Vorschläge: angeheftete zuerst (mit Nadel), dann die zuletzt gegessenen. Tippen = hinzufügen/entfernen (wie die Notiz-Schlagwörter),
  // lange drücken = anheften/lösen
  const recentBox = el('div', { class: 'grp' }, el('div', { class: 'lbl' }, t('Vorschläge'), el('span', { class: 'lbl-hint' }, t('Lange drücken: anheften'))), recent);
  const markRecent = () => recent.querySelectorAll('.chip').forEach((b) => b.classList.toggle('on', hasToken(s.text, b.dataset.v)));
  const drawRecent = () => {
    const pins = getPins();
    const rest = recentFoods().filter((x) => !pins.some((p) => samePin(p, x)));
    recent.replaceChildren(...[...pins.map((x) => [x, true]), ...rest.map((x) => [x, false])].map(([txt, pinned]) => {
      const b = el('button', { type: 'button', class: 'chip' + (pinned ? ' pinned' : ''), 'data-v': txt, title: pinned ? t('Angeheftet (lange drücken zum Lösen)') : '' },
        pinned ? el('i', { class: 'pinmark', html: ICON.pin }) : null, txt);
      pressable(b, () => ta.set(toggleToken(s.text, txt)), () => { togglePin(txt); drawRecent(); });
      return b;
    }));
    recentBox.hidden = !pins.length && !rest.length;
    markRecent();
  };
  const save = el('button', { type: 'button', class: 'save', html: ICON.check + '<span>' + t('Speichern') + '</span>' });
  save.addEventListener('click', () => {
    if (!s.text.trim()) { toast(t('Bitte beschreibe kurz, was du gegessen hast')); ta.ta.focus(); return; }
    if (inFuture(cap)) { toast(futureMsg()); return; }
    const f = addFood({ date: cap.date, time: cap.time, meal: s.meal, text: s.text }); if (f && f.id) S.justAdded = f.id; playAnim(save, 'saved');
    if (navigator.vibrate) navigator.vibrate(25);
    ta.set('');
    onSaved && onSaved(); box.refresh();
    toast(t('Gespeichert'));
  });
  const box = el('div', { class: 'capbox' },
    el('div', { class: 'form foodform' }, group(t('Mahlzeit'), meal), ta, recentBox),
    el('div', { class: 'saverow' }, save));
  // Mahlzeit passend zur Uhrzeit vorschlagen, solange noch nichts getippt wurde
  box.refresh = () => { if (!s.text) s.meal = defaultMeal(cap.time); meal.paint(); drawRecent(); };
  box.draft = () => !!s.text.trim(); // es steht schon etwas im Textfeld
  box.refresh();
  return box;
}

// Eintrag bearbeiten (Fenster)
export function openFoodSheet(id) {
  const f = getFood(id); if (!f) return;
  const s = { date: f.date, time: f.time, meal: f.meal || 0, text: f.text || '' };
  const dt = dtRow(s), meal = mealChips(s), ta = foodText(s);
  const close = () => ov.remove();
  const cancel = el('button', { type: 'button' }, t('Abbrechen'));
  const save = el('button', { type: 'button', class: 'primary' }, t('Speichern'));
  cancel.addEventListener('click', close);
  save.addEventListener('click', () => {
    if (!s.text.trim()) { toast(t('Bitte beschreibe kurz, was du gegessen hast')); return; }
    if (inFuture(s)) { toast(futureMsg()); return; }
    updateFood(id, s); close(); renderHist(); toast(t('Geändert'));
  });
  const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-label': t('Essen bearbeiten') },
    sheetHead(t('Essen bearbeiten'), close), el('div', { class: 'row' }, dt),
    el('div', { class: 'form foodform' }, group(t('Mahlzeit'), meal), ta), el('div', { class: 'btns' }, cancel, save));
  const ov = openOverlay(sheet, close);
}
