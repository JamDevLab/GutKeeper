// Eingabeformular, Datum/Zeit-Leiste und Notiz-Editor
import { AMOUNT, COLORS, CONS, PAIN, URGE, YESNO, consInfo, glyph } from './constants.js';
import { LOC, t } from './i18n.js';
import { TAG_MAX_COUNT, TAG_MAX_LEN, checkTag, cleanTag, hasToken, loadTags, sanitizeTags, saveTags, toggleToken } from './notetags.js';
import { S } from './state.js';
import { ICON, LS, addDays, el, nowTime, parseD, todayStr, ymd, pad, openOverlay } from './util.js';

export function segment(options, get, set, cls) {
  const wrap = el('div', { class: 'seg ' + (cls || '') });
  const btns = options.map((o) => {
    const b = el('button', { type: 'button', class: `opt ${o.cls || ''}`.trim() + (cls === 'cons' ? ' c' + o.v : ''), 'data-v': o.v, html: o.html, style: o.style }, o.html ? null : o.label);
    b.addEventListener('click', () => { set(o.v); if (navigator.vibrate) navigator.vibrate(8); });
    wrap.append(b); return b;
  });
  wrap.paint = () => btns.forEach((b) => {
    const on = Number(b.dataset.v) === get();
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
  });
  return wrap;
}

export function buildForm(s, onChange) {
  const consDesc = el('span', { class: 'desc' });
  const change = () => { update(); onChange && onChange(); };
  const mk = (opts, key, cls = 'pill') => segment(opts, () => s[key] || 0, (v) => { s[key] = v; change(); }, cls);
  const consSeg = segment([...CONS.map((c) => ({ v: c.v, html: glyph(c.v) })), { v: 0, html: glyph(0) }],
    () => s.consistency || 0, (v) => {
      // Ohne Stuhl bleiben Drang, Blut, Schleim, Luft und Schmerzen wählbar; der Drang startet bei „Keiner“ und kommt beim Zurückwechseln wieder
      if (!v && s.consistency) { s._u = s.urge; s.urge = 0; }
      if (v && !s.consistency && !s.urge && s._u != null) s.urge = s._u;
      s.consistency = v; if (v && !s.amount) s.amount = 2; change();
    }, 'cons');
  const urgeSeg = mk(URGE, 'urge'), amountSeg = mk(AMOUNT, 'amount'), painSeg = mk(PAIN, 'pain');
  const bloodSeg = mk(YESNO, 'blood'), mucusSeg = mk(YESNO, 'mucus'), luftSeg = mk(YESNO, 'luft');
  const colorSeg = segment(COLORS.map((c) => ({ v: c.v, label: c.label, style: `--sw:${c.hex}` })), () => s.color || 0, (v) => { s.color = v; change(); }, 'sw');
  const colorDesc = el('span', { class: 'desc' });
  const g = (label, seg, extra) => el('div', { class: 'grp' }, el('div', { class: 'lbl' }, label, extra || null), seg);
  const gUrge = g(t('Stuhldrang'), urgeSeg), gColor = g(t('Farbe'), colorSeg, colorDesc), gAmount = g(t('Menge'), amountSeg), gBlood = g(t('Blut'), bloodSeg), gMucus = g(t('Schleim'), mucusSeg);
  const segs = [consSeg, urgeSeg, amountSeg, colorSeg, painSeg, bloodSeg, mucusSeg, luftSeg];
  function update() {
    segs.forEach((x) => x.paint());
    const c = consInfo(s.consistency || 0);
    consDesc.replaceChildren(...[c.short, c.note ? el('small', {}, ' · ' + c.note) : null].filter(Boolean));
    consDesc.style.color = `var(--c${s.consistency || 0})`;
    const col = COLORS.find((c) => c.v === s.color);
    colorDesc.textContent = col ? col.label : '';
    [gAmount, gColor].forEach((x) => x.classList.toggle('off', !s.consistency)); // Menge und Farbe gibt es nur mit Stuhl
  }
  const root = el('div', { class: 'form' },
    g(t('Konsistenz'), consSeg, consDesc), gUrge, gAmount, gColor, g(t('Schmerzen / Krämpfe'), painSeg),
    el('div', { class: 'trio' }, gBlood, gMucus, g(t('Luft'), luftSeg)));
  root.update = update; update();
  return root;
}

export function dateLabel(ds) {
  const today = todayStr();
  const base = parseD(ds).toLocaleDateString(LOC, { day: '2-digit', month: '2-digit', year: ds.slice(0, 4) === today.slice(0, 4) ? undefined : '2-digit' });
  if (ds === today) return `${t('Heute')} ${base}`;
  if (ds === ymd(addDays(new Date(), -1))) return `${t('Gestern')} ${base}`;
  return parseD(ds).toLocaleDateString(LOC, { weekday: 'short' }) + ' ' + base;
}

// Einträge in der Zukunft sind fast immer ein Versehen (falscher Tag im Kalender). Kleine Toleranz für Uhren, die zwischen Geräten etwas abweichen.
const FUTURE_TOLERANCE_MIN = 5;
export function inFuture(s) {
  const d = new Date(Date.now() + FUTURE_TOLERANCE_MIN * 60000);
  return `${s.date}T${s.time}` > `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const futureMsg = () => t('Datum und Uhrzeit liegen in der Zukunft. Bitte einen Zeitpunkt bis jetzt wählen.');

// Kopfzeile eines Fensters: Titel links, × rechts schließt ohne zu speichern (wie „Abbrechen“)
export function sheetHead(title, onClose) {
  const x = el('button', { type: 'button', class: 'nclose', html: ICON.x, 'aria-label': t('Schließen'), title: t('Schließen') });
  x.addEventListener('click', onClose);
  return el('div', { class: 'nhead' }, el('h2', {}, title), x);
}

export function dtRow(s, onTouch) {
  const dLabel = el('span'), tLabel = el('span');
  const d = el('input', { type: 'date', 'aria-label': t('Datum wählen') });
  // Mit Maus/Tastatur (kein Touch): Uhrzeit als Textfeld zum Tippen (z. B. 0830 oder 8:30, Pfeil hoch/runter = ±1 Min, mit Umschalt ±10); am Handy bleibt die Auswahl des Geräts
  const typed = !matchMedia('(pointer: coarse)').matches;
  const tm = el('input', typed
    ? { type: 'text', class: 'tinput', inputmode: 'numeric', maxlength: 5, autocomplete: 'off', spellcheck: 'false', placeholder: 'hh:mm', 'aria-label': t('Uhrzeit wählen') }
    : { type: 'time', 'aria-label': t('Uhrzeit wählen') });
  const now = el('button', { type: 'button', class: 'icon', title: t('Jetzt'), 'aria-label': t('Auf jetzt setzen'), html: ICON.now });
  const paint = () => {
    d.max = todayStr(); // der Kalender bietet keine künftigen Tage an
    d.value = s.date; tm.value = s.time;
    dLabel.textContent = dateLabel(s.date); tLabel.textContent = s.time;
  };
  const touched = (v) => { paint(); onTouch && onTouch(v); };
  if (typed) d.addEventListener('click', () => { try { d.showPicker && d.showPicker(); } catch {} });
  d.addEventListener('change', () => { if (d.value) s.date = d.value; touched(true); });
  if (!typed) tm.addEventListener('change', () => { if (tm.value) s.time = tm.value; touched(true); });
  else {
    const parse = (v) => { // „830“, „0830“, „8:30“, „8.30“ → „08:30“
      const m = String(v).trim().replace(/[.,hH]/g, ':').match(/^(\d{1,2}):(\d{1,2})$/) || String(v).trim().match(/^(\d{1,2})(\d{2})$/) || String(v).trim().match(/^(\d{1,2})()$/);
      if (!m) return null;
      const h = Number(m[1]), mi = m[2] === '' ? 0 : Number(m[2]);
      return h < 24 && mi < 60 ? `${pad(h)}:${pad(mi)}` : null;
    };
    const commit = () => { const v = parse(tm.value); if (v) { s.time = v; touched(true); } else paint(); };
    const shift = (min) => { const [h, m] = s.time.split(':').map(Number); const x = (((h * 60 + m + min) % 1440) + 1440) % 1440; s.time = `${pad(Math.floor(x / 60))}:${pad(x % 60)}`; touched(true); };
    tm.addEventListener('focus', () => tm.select());
    tm.addEventListener('input', (ev) => { if (ev.inputType === 'insertText' && /^\d{2}$/.test(tm.value)) tm.value += ':'; }); // nach zwei Ziffern den Doppelpunkt setzen
    tm.addEventListener('change', commit);
    tm.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); tm.blur(); }
      else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') { ev.preventDefault(); shift((ev.key === 'ArrowUp' ? 1 : -1) * (ev.shiftKey ? 10 : 1)); tm.select(); }
      else if (ev.key === 'Escape') { paint(); tm.blur(); }
    });
  }
  now.addEventListener('click', () => { s.date = todayStr(); s.time = nowTime(); touched(false); });
  const row = el('div', { class: 'dtbox' },
    el('div', { class: 'pick date' }, dLabel, d),
    el('div', { class: 'pick time' + (typed ? ' typed' : '') }, typed ? null : tLabel, tm), now);
  row.sync = paint; paint();
  return row;
}

/* ================= Notizen ================= */
export const NOTE_TAGS = ['Kaffee', 'Alkohol', 'Stress', 'Medikament', 'Reise', 'Sport', 'Fettiges Essen', 'Krank'].map((x) => t(x));
// Standard-Schlagwörter: aus data/settings.json („noteTags“, Server), sonst die eingebauten
const noteDefaults = () => (S.config && Array.isArray(S.config.noteTags) ? sanitizeTags(S.config.noteTags) : NOTE_TAGS);

// Tippen und langes Drücken (ca. 0,5 s) auf einem Knopf. Wer mehr als ca. 8 px wischt, scrollt nur: dann gibt es kein langes Drücken.
// Nach einem langen Drücken wird der folgende „Klick“ verschluckt.
export function pressable(node, onTap, onLong) {
  let timer = 0, x0 = 0, y0 = 0, fired = false;
  const stop = () => { clearTimeout(timer); timer = 0; };
  node.addEventListener('pointerdown', (ev) => {
    if (ev.button) return;
    fired = false; x0 = ev.clientX; y0 = ev.clientY; stop();
    timer = setTimeout(() => { timer = 0; fired = true; if (navigator.vibrate) navigator.vibrate(15); onLong(); }, 500);
  });
  node.addEventListener('pointermove', (ev) => { if (timer && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) stop(); });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) node.addEventListener(type, stop);
  node.addEventListener('contextmenu', (ev) => ev.preventDefault()); // Android öffnet beim langen Drücken sonst ein Menü
  node.addEventListener('click', (ev) => { if (fired) { fired = false; ev.preventDefault(); return; } onTap(); });
}

// Kleines Fenster zum Anlegen oder Umbenennen (und Löschen) eines Schlagworts. list = aktuelle Liste, skip = Position des umbenannten Eintrags
function openTagSheet({ title, value, list, skip, onSave, onDelete }) {
  const close = () => ov.remove();
  const inp = el('input', { type: 'text', class: 'tag-in', maxlength: TAG_MAX_LEN, autocomplete: 'off', enterkeyhint: 'done', 'aria-label': t('Schlagwort') });
  inp.value = value || '';
  const msg = el('p', { class: 'warn tag-msg', role: 'alert', hidden: true });
  const cancel = el('button', { type: 'button' }, t('Abbrechen'));
  const del = onDelete ? el('button', { type: 'button', class: 'danger' }, t('Löschen')) : null;
  const ok = el('button', { type: 'button', class: 'primary' }, t('Speichern'));
  const save = () => {
    const err = { empty: t('Bitte ein Schlagwort eingeben.'), dup: t('Dieses Schlagwort gibt es schon.'), full: t('Es sind höchstens {n} Schlagwörter möglich.', { n: TAG_MAX_COUNT }) }[checkTag(list, inp.value, skip)];
    if (err) { msg.textContent = err; msg.hidden = false; return; }
    close(); onSave(cleanTag(inp.value));
  };
  cancel.addEventListener('click', close);
  if (del) del.addEventListener('click', () => { close(); onDelete(); });
  ok.addEventListener('click', save);
  inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); save(); } });
  inp.addEventListener('input', () => { msg.hidden = true; });
  const sheet = el('div', { class: 'sheet tagsheet', role: 'dialog', 'aria-label': title }, el('h2', {}, title), inp, msg, el('div', { class: 'btns' }, cancel, del, ok));
  const ov = openOverlay(sheet, close);
  ov.classList.add('topov'); // oben statt unten, damit die Tastatur das Fenster nicht verdeckt
  setTimeout(() => { inp.focus(); inp.select(); }, 80);
}

// Notiz-Eingabe mit Schlagwörtern. Ein Schlagwort ist „an“, wenn es als durch Komma getrennter Eintrag in der Notiz steht.
// Die Liste der Schlagwörter ist nur auf diesem Gerät gespeichert (je Konto, Schlüssel „noteTags“ in LS): Sie ist eine Vorliebe, kein Teil der Einträge.
export function noteEditor(s, onChange) {
  const ta = el('textarea', { class: 'note-ta', rows: 3, maxlength: 300, placeholder: t('Notiz, z. B. Kaffee, Stress, neues Medikament …'), 'aria-label': t('Notiz') });
  ta.value = s.note || '';
  const defs = noteDefaults();
  let tags = loadTags(LS, defs), editing = false;
  const chips = el('div', { class: 'chips note-chips' });
  const hint = el('span', { class: 'note-hint' }, t('Tippen zum Umbenennen, × zum Löschen'));
  const reset = el('button', { type: 'button', class: 'linkbtn' }, t('Standard wiederherstellen'));
  const foot = el('div', { class: 'note-foot', hidden: true }, hint, reset);
  const changed = () => { s.note = ta.value; onChange && onChange(); };
  const sync = () => chips.querySelectorAll('button[data-tag]').forEach((b) => {
    const on = hasToken(ta.value, b.dataset.tag);
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
  });
  const store = (list) => { tags = saveTags(LS, list, defs); paint(); };
  const rename = (i) => openTagSheet({
    title: t('Schlagwort bearbeiten'), value: tags[i], list: tags, skip: i,
    onSave: (v) => store(tags.map((x, j) => (j === i ? v : x))),
    onDelete: () => store(tags.filter((_, j) => j !== i)),
  });
  function paint() {
    chips.replaceChildren();
    tags.forEach((tag, i) => {
      if (editing) {
        const name = el('button', { type: 'button', class: 'cname', 'aria-label': `${t('Schlagwort bearbeiten')}: ${tag}` }, tag);
        const x = el('button', { type: 'button', class: 'cx', 'aria-label': `${t('Löschen')}: ${tag}` }, '×');
        name.addEventListener('click', () => rename(i));
        x.addEventListener('click', () => store(tags.filter((_, j) => j !== i)));
        chips.append(el('span', { class: 'chip ed' }, name, x));
        return;
      }
      const b = el('button', { type: 'button', class: 'chip', 'data-tag': tag, 'aria-pressed': 'false' }, tag);
      // Fokus bleibt im Textfeld: Die Tastatur klappt beim Antippen eines Schlagworts nicht zu
      b.addEventListener('mousedown', (ev) => ev.preventDefault());
      pressable(b, () => { ta.value = toggleToken(ta.value, tag); changed(); sync(); }, () => rename(i));
      chips.append(b);
    });
    if (editing) {
      const add = el('button', { type: 'button', class: 'chip add' }, '+ ' + t('Schlagwort'));
      add.addEventListener('click', () => openTagSheet({ title: t('Neues Schlagwort'), list: tags, onSave: (v) => store([...tags, v]) }));
      chips.append(add);
    }
    const pen = el('button', { type: 'button', class: 'chip pen' + (editing ? ' on' : ''), 'aria-pressed': editing ? 'true' : 'false', 'aria-label': t('Schlagwörter bearbeiten'), title: t('Schlagwörter bearbeiten'), html: ICON.edit });
    pen.addEventListener('click', () => { editing = !editing; paint(); });
    chips.append(pen);
    foot.hidden = !editing;
    reset.disabled = tags.length === defs.length && tags.every((x, i) => x === defs[i]);
    sync();
  }
  reset.addEventListener('click', () => store(defs));
  ta.addEventListener('input', () => { changed(); sync(); });
  paint();
  const root = el('div', { class: 'note-ed' }, ta, chips, foot);
  root.clear = () => { ta.value = ''; changed(); sync(); };
  root.focus = () => ta.focus();
  return root;
}
// keep (optional): { get, set } für „Notiz merken“, d. h. die Notiz bleibt nach dem Speichern für die nächsten Einträge stehen
// Das Fenster ist eine schwebende Karte oben (Kopfzeile mit Abbrechen/Fertig, darunter Textfeld und Schlagwörter): Die Bildschirmtastatur schiebt es nicht
// hoch und verdeckt nur den unwichtigen unteren Teil.
export function openNoteSheet(s, done, keep) {
  const vv = window.visualViewport;
  const fit = () => { sheet.style.maxHeight = `calc(${vv ? vv.height : innerHeight}px - 24px - env(safe-area-inset-top))`; }; // höchstens so hoch wie der sichtbare Bereich über der Tastatur (abzüglich Rand der Karte)
  const close = () => { if (vv) vv.removeEventListener('resize', fit); ov.remove(); done && done(); };
  const before = s.note || '';
  const ed = noteEditor(s);
  let keepRow = null;
  if (keep) {
    const cb = el('input', { type: 'checkbox' }); cb.checked = keep.get();
    cb.addEventListener('change', () => keep.set(cb.checked));
    keepRow = el('label', { class: 'chk note-keep' }, cb, el('span', {}, t('Merken: Notiz für weitere Einträge behalten (z. B. „Krank“)')));
  }
  // × oben rechts: Änderungen verwerfen und die Notiz von vorher behalten; die Zurück-Geste zählt wie „Fertig“
  const cancel = el('button', { type: 'button', class: 'nclose', html: ICON.x, 'aria-label': t('Abbrechen'), title: t('Abbrechen') });
  const ok = el('button', { type: 'button', class: 'nok' }, t('Fertig'));
  const clear = el('button', { type: 'button', class: 'linkbtn danger' }, t('Notiz löschen'));
  cancel.addEventListener('click', () => { s.note = before; close(); });
  clear.addEventListener('click', () => ed.clear());
  ok.addEventListener('click', close);
  const sheet = el('div', { class: 'sheet notesheet', role: 'dialog', 'aria-label': t('Notiz') },
    el('div', { class: 'nhead' }, el('h2', {}, t('Notiz')), cancel), ed, keepRow, el('div', { class: 'nfoot' }, clear, ok));
  const ov = openOverlay(sheet, close);
  ov.classList.add('topov');
  if (vv) vv.addEventListener('resize', fit);
  fit();
  setTimeout(() => ed.focus(), 80);
}
