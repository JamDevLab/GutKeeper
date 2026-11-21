// Ende-zu-Ende-Verschlüsselung (optional), Oberfläche: Einschalten mit Wiederherstellungscode, Code eingeben, neuer Code, Ausschalten
import { askSheet } from './admin.js';
import { importKey, newDataKeyBytes, newRecoveryCode, sealRow, wrapDataKey } from './cipher.js';
import { renderData } from './data.js';
import { acceptCode, call, decodeRows, hooks, supported } from './e2ee.js';
import { fileBase, t } from './i18n.js';
import { S } from './state.js';
import { pendingCount, persist, persistFoods, sync } from './store.js';
import { download } from './transfer.js';
import { refreshViews, toast } from './ui.js';
import { el, openOverlay } from './util.js';
import { vault } from './vault.js';

const card = (title, ...kids) => el('div', { class: 'dcard' }, el('h3', {}, title), ...kids);
const btn = (label, fn, cls = '') => { const b = el('button', { type: 'button', class: 'dbtn ' + cls }, label); b.addEventListener('click', fn); return b; };
const done = (msg) => { S.dataMsg = msg; refreshViews(); renderData(); };

function errText(r) {
  if (r.status === 0) return t('Server nicht erreichbar.');
  if (r.json && r.json.error === 'incomplete') return t('Währenddessen wurden auf einem anderen Gerät Einträge geändert. Bitte noch einmal versuchen.');
  if (r.json && r.json.error === 'state') return t('Der Zustand hat sich zwischenzeitlich geändert. Bitte die App neu laden.');
  return t('Das hat nicht geklappt (Fehler {n}).', { n: r.status });
}

// Alle Zeilen des Kontos vom Server (Einträge und Essen)
async function fetchAll() {
  const e = await call('GET', '/api/entries'), f = await call('GET', '/api/foods');
  return e.status === 200 && f.status === 200 ? { entries: e.json.entries, foods: f.json.foods } : null;
}

// Abgleichen und prüfen, dass nichts mehr aussteht (sonst fehlen Änderungen beim Umstellen)
async function settled() {
  if (S.syncing) await new Promise((r) => setTimeout(r, 800));
  if (pendingCount()) await sync();
  return !pendingCount() && S.online;
}

/* ---- Wiederherstellungscode anzeigen: Kopieren, Speichern, Bestätigen ---- */
function codeSheet({ title, text, code, confirm, purge }) {
  return new Promise((resolve) => {
    const saved = el('input', { type: 'checkbox', id: 'codeSaved' });
    const purgeCb = purge ? el('input', { type: 'checkbox', id: 'codePurge', checked: true }) : null;
    const copy = btn(t('Kopieren'), () => { (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(() => toast(t('Code kopiert')), () => toast(t('Kopieren nicht möglich. Bitte den Code abschreiben oder als Datei speichern.'))); });
    const file = btn(t('Als Datei speichern'), () => download(`${fileBase()}-${t('wiederherstellungscode')}.txt`,
      `${t('Wiederherstellungscode')}\n\n${code}\n\n${t('Bewahre diese Datei sicher auf, z. B. im Passwortmanager. Wer den Code hat, kann die verschlüsselten Daten lesen.')}\n`, 'text/plain'));
    const ok = el('button', { type: 'button', class: 'primary', disabled: true }, confirm);
    const cancel = el('button', { type: 'button' }, t('Abbrechen'));
    saved.addEventListener('change', () => { ok.disabled = !saved.checked; });
    const row = (cb, label) => el('label', { class: 'chk', for: cb.id }, cb, el('span', {}, label));
    const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-label': title },
      el('h2', {}, title), el('p', { class: 'warn' }, text),
      el('div', { class: 'codebox', 'data-testid': 'recovery-code' }, code.split('-').slice(0, 4).join('-'), el('br'), code.split('-').slice(4).join('-')), // zwei Zeilen, damit keine Gruppe getrennt wird
      el('div', { class: 'drow' }, copy, file),
      row(saved, t('Ich habe den Code sicher gespeichert.')),
      ...(purgeCb ? [row(purgeCb, t('Ältere Server-Backups löschen (sie enthalten noch die unverschlüsselten Daten).'))] : []),
      el('div', { class: 'btns' }, cancel, ok));
    const close = () => ov.remove();
    const busy = (msg) => sheet.replaceChildren(el('h2', {}, title), el('p', { class: 'warn' }, msg));
    cancel.addEventListener('click', () => { close(); resolve(null); });
    ok.addEventListener('click', () => { const p = purgeCb ? purgeCb.checked : false; busy(t('Bitte warten …')); resolve({ purge: p, close, busy }); });
    const ov = openOverlay(sheet, () => {}); // nicht durch Tippen daneben schließen: der Code wird nur einmal angezeigt
  });
}

/* ---- Einschalten ---- */
export async function enableFlow() {
  if (!supported()) return;
  if (!(await settled())) { toast(t('Es warten noch Änderungen oder der Server ist nicht erreichbar. Bitte zuerst synchronisieren.')); return; }
  const code = newRecoveryCode(), raw = newDataKeyBytes();
  const res = await codeSheet({
    title: t('Wiederherstellungscode'), code: code.text, confirm: t('Verschlüsselung einschalten'), purge: !(S.config && S.config.multi),
    text: t('Schreibe diesen Code auf oder speichere ihn im Passwortmanager. Du brauchst ihn einmalig auf jedem neuen Gerät. Ohne ihn und ohne ein bereits freigeschaltetes Gerät sind deine Daten nicht mehr lesbar, auch nicht für den Admin.'),
  });
  if (!res) return;
  S.busyE2ee = true;
  try {
    res.busy(t('Lade Einträge vom Server …'));
    const all = await fetchAll();
    if (!all) { res.close(); done(t('Server nicht erreichbar.')); return; }
    res.busy(t('Verschlüssele {n} Einträge …', { n: all.entries.length + all.foods.length }));
    const key = await importKey(raw);
    const entries = await Promise.all(all.entries.map((e) => sealRow('e', e, key)));
    const foods = await Promise.all(all.foods.map((f) => sealRow('f', f, key)));
    const r = await call('POST', '/api/e2ee/enable', { key: await wrapDataKey(raw, code.bytes), entries, foods, purgeBackups: res.purge });
    res.close();
    if (r.status !== 200) { done(errText(r)); return; }
    await vault.setDataKey(raw);
    S.dataKey = key; S.e2eeServer = true; S.needKey = false; S.seq = 0; S.foodSeq = 0; persist(); persistFoods();
    done(t('Verschlüsselung ist eingeschaltet.') + (r.json.purged ? ' ' + t('Ältere Server-Backups wurden gelöscht.') : '')
      + (r.json.backupsKept ? ' ' + t('Ältere Server-Backups enthalten noch unverschlüsselte Daten. Du kannst sie unter „Administration“ löschen.') : ''));
  } catch (err) {
    res.close(); done(t('Das hat nicht geklappt: {m}', { m: String((err && err.message) || err) }));
  } finally { S.busyE2ee = false; }
  sync();
}

/* ---- Ausschalten (alles wieder lesbar auf dem Server) ---- */
async function disableFlow() {
  const v = await askSheet({ title: t('Verschlüsselung ausschalten?'), danger: true, ok: t('Ausschalten'), fields: [],
    text: t('Deine Einträge und das Essen werden wieder unverschlüsselt auf dem Server gespeichert (lesbar für alle, die den Server oder seine Backups lesen können). Der Wiederherstellungscode wird dann ungültig.') });
  if (!v) return;
  if (!(await settled())) { toast(t('Es warten noch Änderungen oder der Server ist nicht erreichbar. Bitte zuerst synchronisieren.')); return; }
  S.busyE2ee = true;
  try {
    const all = await fetchAll();
    if (!all) { done(t('Server nicht erreichbar.')); return; }
    const [e, f] = await Promise.all([decodeRows('e', all.entries), decodeRows('f', all.foods)]);
    if (e.failed || f.failed) { done(t('{n} Einträge lassen sich nicht entschlüsseln. Zur Sicherheit wurde nichts geändert.', { n: e.failed + f.failed })); return; }
    const r = await call('POST', '/api/e2ee/disable', { entries: e.rows, foods: f.rows });
    if (r.status !== 200) { done(errText(r)); return; }
    await vault.clearDataKey();
    S.dataKey = null; S.e2eeServer = false; S.needKey = false; S.seq = 0; S.foodSeq = 0; persist(); persistFoods();
    done(t('Verschlüsselung ist ausgeschaltet.'));
  } catch (err) { done(t('Das hat nicht geklappt: {m}', { m: String((err && err.message) || err) })); }
  finally { S.busyE2ee = false; }
  sync();
}

/* ---- Neuen Wiederherstellungscode erzeugen (der Datenschlüssel bleibt gleich) ---- */
async function newCodeFlow() {
  const key = await vault.getDataKey(true);
  if (!key) return;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  const code = newRecoveryCode();
  const res = await codeSheet({
    title: t('Neuer Wiederherstellungscode'), code: code.text, confirm: t('Neuen Code verwenden'),
    text: t('Der bisherige Code wird damit ungültig. Geräte, die schon freigeschaltet sind, bleiben es.'),
  });
  if (!res) return;
  const r = await call('POST', '/api/e2ee/key', { key: await wrapDataKey(raw, code.bytes) });
  res.close();
  done(r.status === 200 ? t('Der neue Code ist aktiv. Der alte Code gilt nicht mehr.') : errText(r));
}

/* ---- Code eingeben (Konto ist verschlüsselt, dieses Gerät hat noch keinen Schlüssel) ---- */
export function promptKeySheet() {
  if (document.querySelector('.overlay .keyin')) return;
  const input = el('input', { type: 'text', class: 'askin keyin', placeholder: t('Code eingeben'), 'aria-label': t('Wiederherstellungscode'),
    autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: 64 });
  const err = el('div', { class: 'lock-err' });
  const later = el('button', { type: 'button' }, t('Später'));
  const ok = el('button', { type: 'button', class: 'primary' }, t('Freischalten'));
  const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-label': t('Wiederherstellungscode eingeben') },
    el('h2', {}, t('Wiederherstellungscode eingeben')),
    el('p', { class: 'warn' }, t('Die Daten dieses Kontos sind verschlüsselt. Gib den Wiederherstellungscode ein, den du beim Einschalten bekommen hast, damit dieses Gerät sie lesen kann. Das ist nur einmal nötig.')),
    el('div', { class: 'askf' }, input), err, el('div', { class: 'btns' }, later, ok));
  const close = () => ov.remove();
  later.addEventListener('click', close);
  const go = async () => {
    ok.disabled = true; err.textContent = '';
    const m = await acceptCode(input.value);
    ok.disabled = false;
    if (m) { err.textContent = m; return; }
    S.seq = 0; S.foodSeq = 0; persist(); persistFoods(); close();
    toast(t('Dieses Gerät ist freigeschaltet.')); S.dataMsg = ''; refreshViews(); renderData(); sync();
  };
  ok.addEventListener('click', go);
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') go(); });
  const ov = openOverlay(sheet, close);
  setTimeout(() => input.focus(), 60);
}
hooks.promptKey = promptKeySheet;

// Hinweis im Hauptmenü der Optionen, solange dieses Gerät den Code noch braucht
export function keyBanner() {
  if (!S.needKey || S.dataKey) return null;
  return el('div', { class: 'dmsg' }, t('Dieses Gerät braucht den Wiederherstellungscode, um die verschlüsselten Daten zu lesen.'), ' ', btn(t('Code eingeben'), promptKeySheet, 'primary'));
}

/* ---- Seite „Verschlüsselung“ in den Optionen ---- */
export function encryptionCards() {
  const local = vault.mode === 'idb'
    ? t('Die Einträge auf diesem Gerät liegen verschlüsselt im Browser-Speicher (IndexedDB).')
    : t('Die Einträge auf diesem Gerät liegen unverschlüsselt im Browser-Speicher. Mit HTTPS wird der lokale Speicher automatisch verschlüsselt.');
  const kids = [];
  if (!supported()) {
    kids.push(el('p', {}, t('Die Ende-zu-Ende-Verschlüsselung braucht HTTPS (oder localhost) und einen Browser mit verschlüsseltem Speicher. Im Moment ist das nicht gegeben, deshalb ist sie hier nicht verfügbar.')));
  } else if (S.dataKey) {
    kids.push(el('p', {}, t('Eingeschaltet. Deine Einträge und das Essen verlassen dieses Gerät nur verschlüsselt. Der Server sieht weiter, wann Einträge angelegt werden und wie viele es sind, aber nicht, was darin steht.')),
      el('p', { class: 'bk-2' }, t('Dieses Gerät ist freigeschaltet. Auf einem neuen Gerät brauchst du einmalig den Wiederherstellungscode.')),
      el('div', { class: 'drow wrap' }, btn(t('Neuen Wiederherstellungscode erzeugen …'), newCodeFlow)),
      el('div', { class: 'drow wrap mt' }, btn(t('Verschlüsselung ausschalten …'), disableFlow, 'danger')));
  } else if (S.needKey || S.e2eeServer) {
    kids.push(el('p', {}, t('Die Daten dieses Kontos sind verschlüsselt. Dieses Gerät braucht den Wiederherstellungscode, um sie zu lesen.')),
      el('div', { class: 'drow' }, btn(t('Code eingeben'), promptKeySheet, 'primary')));
  } else {
    kids.push(el('p', {}, t('Optional: Deine Einträge und das Essen werden auf diesem Gerät verschlüsselt, bevor sie zum Server gehen. Der Server, sein Backup und der Admin sehen dann nur unlesbaren Text, den Monat der Einträge und den Zeitpunkt der Änderung.')),
      el('p', { class: 'bk-2' }, t('Du bekommst einen Wiederherstellungscode, den du einmalig auf jedem neuen Gerät brauchst. Geht er verloren und ist kein Gerät mehr freigeschaltet, sind die Daten nicht mehr lesbar. Das Anmelden und schnelle Eintragen bleibt wie bisher.')),
      el('div', { class: 'drow' }, btn(t('Verschlüsselung einschalten …'), enableFlow, 'primary')));
  }
  return [card(t('Ende-zu-Ende-Verschlüsselung'), ...kids), card(t('Speicher auf diesem Gerät'), el('p', {}, local))];
}
