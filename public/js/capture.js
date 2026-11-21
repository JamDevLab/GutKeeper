// Ansicht „Erfassen“
import { buildFoodBox } from './food.js';
import { buildForm, dtRow, openNoteSheet, inFuture, futureMsg } from './form.js';
import { S } from './state.js';
import { addEntry, hasContent } from './store.js';
import { toast } from './ui.js';
import { t } from './i18n.js';
import { $, ICON, LS, el, nowTime, playAnim, todayStr } from './util.js';

export const last = { consistency: 4, urge: 1, amount: 2, blood: 0, ...LS.get('last', {}) };
S.lastCons = last.consistency || 4;
export const cap = { date: todayStr(), time: nowTime(), ...last, consistency: S.lastCons, pain: 0, mucus: 0, luft: 0, color: 1, note: '' };

let stoolBox, foodBox;
// Umschalter „Stuhl | Essen“ (nur sichtbar, wenn Essen in den Einstellungen eingeschaltet ist)
// Steht im Essen-Feld schon etwas? Dann springt die App beim Zurückkehren nicht auf „Stuhl“ zurück.
export const hasFoodDraft = () => !!(foodBox && foodBox.draft && foodBox.draft());
export function paintCapMode(dir) {
  if (!stoolBox) return;
  const on = S.foodOn, food = on && S.capMode === 'food';
  stoolBox.hidden = food; foodBox.hidden = !food;
  const btn = $('#modeBtn'); // kleiner Knopf oben rechts, nur mit Symbolen (nur im Tab „Erfassen“ und nur mit Essen)
  btn.hidden = !(on && S.tab === 'cap');
  btn.querySelectorAll('.m').forEach((m) => { const sel = m.dataset.v === (food ? 'food' : 'stool'); m.classList.toggle('on', sel); });
  if (food) foodBox.refresh();
  if (dir && !matchMedia('(prefers-reduced-motion: reduce)').matches) { // kleine Einblend-Bewegung in Wischrichtung
    const shown = food ? foodBox : stoolBox;
    shown.classList.remove('slide-l', 'slide-r'); void shown.offsetWidth; shown.classList.add(dir === 'left' ? 'slide-l' : 'slide-r');
  }
}

// Bildschirmtastatur: Die App passt sich an den sichtbaren Bereich darüber an (Textfeld schrumpft, Speichern-Knopf bleibt sichtbar),
// die Tab-Leiste verschwindet solange. Legt die Tastatur sich nur über die Seite (Chrome-Standard), wird #app auf den sichtbaren
// Bereich gesetzt; verkleinert das System das Fenster selbst (manche WebViews), genügt die Klasse für die Tab-Leiste.
function watchKeyboard() {
  const vv = window.visualViewport; if (!vv) return;
  const app = document.getElementById('app');
  let full = 0, w = 0;
  const typing = () => { const a = document.activeElement; return !!a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && /^(text|search|email|password|number|tel|url)$/.test(a.type))); };
  const fit = () => {
    if (innerWidth !== w) { w = innerWidth; full = 0; } // gedreht: Höhe neu messen
    full = Math.max(full, innerHeight);
    const kb = typing() && vv.height < full - 120;
    document.body.classList.toggle('kb', kb);
    const overlay = kb && vv.height < innerHeight - 1;
    app.style.top = overlay ? `${vv.offsetTop}px` : '';
    app.style.height = overlay ? `${vv.height}px` : '';
    app.style.bottom = overlay ? 'auto' : '';
  };
  vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); addEventListener('resize', fit);
  document.addEventListener('focusin', () => setTimeout(fit, 50));
  document.addEventListener('focusout', () => setTimeout(fit, 50));
  fit();
}

export function buildCapture() {
  watchKeyboard();
  const form = buildForm(cap, () => { if (cap.consistency) S.lastCons = cap.consistency; LS.set('last', { consistency: S.lastCons, urge: cap.consistency ? cap.urge : (cap._u != null ? cap._u : 1), amount: cap.amount || 2, blood: cap.blood }); });
  const save = el('button', { type: 'button', class: 'save', html: ICON.check + '<span>' + t('Speichern') + '</span>' });
  const noteBtn = el('button', { type: 'button', class: 'notebtn', html: ICON.note });
  // „Notiz merken“: Die Notiz bleibt nach dem Speichern stehen (auch nach einem Neustart), bis man sie löscht oder Merken ausschaltet
  const keep = { get: () => !!LS.get('noteKeep', false), set: (v) => { LS.set('noteKeep', v); LS.set('noteKept', v ? cap.note || '' : ''); } };
  if (keep.get() && !cap.note) cap.note = LS.get('noteKept', '');
  const paintNote = () => { if (keep.get()) LS.set('noteKept', cap.note || ''); noteBtn.classList.toggle('on', !!cap.note); noteBtn.title = cap.note || t('Notiz hinzufügen'); noteBtn.setAttribute('aria-label', cap.note ? t('Notiz bearbeiten') : t('Notiz hinzufügen')); };
  noteBtn.addEventListener('click', () => openNoteSheet(cap, paintNote, keep));
  paintNote();
  save.addEventListener('click', () => {
    if (!hasContent(cap)) { toast(t('Bitte Konsistenz oder eine Angabe wählen (z. B. Luft, Blut, Schmerzen)')); return; }
    if (inFuture(cap)) { toast(futureMsg()); return; }
    const added = addEntry(cap); S.justAdded = added.id; playAnim(save, 'saved');
    if (navigator.vibrate) navigator.vibrate(25);
    cap.pain = 0; cap.mucus = 0; cap.luft = 0; cap.color = 1; if (!keep.get()) cap.note = ''; paintNote();
    if (!cap.consistency) { cap.consistency = S.lastCons; if (!cap.amount) cap.amount = 2; cap.urge = cap._u != null ? cap._u : 1; }
    form.update();
    S.capTouched = false; resetNow();
    toast(t('Gespeichert'));
  });
  stoolBox = el('div', { class: 'capbox' }, form, el('div', { class: 'saverow' }, noteBtn, save));
  foodBox = buildFoodBox(cap, () => { S.capTouched = false; resetNow(); });
  const btn = $('#modeBtn');
  btn.innerHTML = `<span class="m" data-v="stool" title="${t('Stuhl')}">${ICON.toilet}</span><span class="m" data-v="food" title="${t('Essen')}">${ICON.food}</span>`;
  btn.addEventListener('click', () => { S.capMode = S.capMode === 'food' ? 'stool' : 'food'; paintCapMode(); });
  $('#vCap').append(stoolBox, foodBox);
  S.capDT = dtRow(cap, (touched) => { S.capTouched = touched; if (!foodBox.hidden) foodBox.refresh(); });
  attachModeSwipe($('#vCap'));
  paintCapMode();
}

// Wischen nach links = Essen, nach rechts = Stuhl (nur mit Touch/Stift und wenn Essen eingeschaltet ist)
function attachModeSwipe(root) {
  let x0 = 0, y0 = 0, t0 = 0, on = false;
  root.addEventListener('pointerdown', (ev) => {
    const field = ev.target.closest('textarea, input, [contenteditable]'); // beim Tippen/Markieren im aktiven Feld nicht wischen
    on = ev.pointerType !== 'mouse' && S.foodOn && !(field && document.activeElement === field);
    x0 = ev.clientX; y0 = ev.clientY; t0 = Date.now();
  });
  root.addEventListener('pointerup', (ev) => {
    if (!on) return;
    on = false;
    const dx = ev.clientX - x0, dy = ev.clientY - y0;
    if (Math.abs(dx) < 60 || Math.abs(dx) < 1.6 * Math.abs(dy) || Date.now() - t0 > 800) return;
    const to = dx < 0 ? 'food' : 'stool';
    if (S.capMode !== to) { S.capMode = to; paintCapMode(dx < 0 ? 'left' : 'right'); }
  });
  root.addEventListener('pointercancel', () => { on = false; });
}
export function resetNow() { cap.date = todayStr(); cap.time = nowTime(); S.capDT && S.capDT.sync(); }
