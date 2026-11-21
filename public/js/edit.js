// Eintrag bearbeiten (Fenster)
import { buildForm, dtRow, noteEditor, inFuture, futureMsg, sheetHead } from './form.js';
import { renderHist } from './history.js';
import { S } from './state.js';
import { fields, getEntry, hasContent, updateEntry } from './store.js';
import { t } from './i18n.js';
import { toast } from './ui.js';
import { el, openOverlay } from './util.js';

export function openSheet(id) {
  const e = getEntry(id); if (!e) return;
  const s = fields(e);
  const form = buildForm(s);
  const dt = dtRow(s);
  const close = () => ov.remove();
  const cancel = el('button', { type: 'button' }, t('Abbrechen'));
  const save = el('button', { type: 'button', class: 'primary' }, t('Speichern'));
  cancel.addEventListener('click', close);
  save.addEventListener('click', () => {
    if (!hasContent(s)) { toast(t('Bitte Konsistenz oder eine Angabe wählen (z. B. Luft, Blut, Schmerzen)')); return; }
    if (inFuture(s)) { toast(futureMsg()); return; }
    updateEntry(id, s); close(); renderHist(); toast(t('Geändert'));
  });
  const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-label': t('Eintrag bearbeiten') },
    sheetHead(t('Eintrag bearbeiten'), close), el('div', { class: 'row' }, dt), form,
    el('div', { class: 'grp' }, el('div', { class: 'lbl' }, t('Notiz')), noteEditor(s)), el('div', { class: 'btns' }, cancel, save));
  const ov = openOverlay(sheet, close);
}
