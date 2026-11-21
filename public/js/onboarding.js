// Geführter Einstieg (optional, standardmäßig aus): ein Vollbild-Dialog mit den wichtigsten Einstellungen beim ersten Start.
// Standardmäßig an; abschalten kann ihn der Betreiber: Server über ONBOARDING=0 (/api/config meldet onboarding: false), serverlose Version/APK beim Bauen
// (ONBOARDING=0 bei build:static bzw. build-apk lässt den Meta-Tag „gutkeeper-onboarding“ weg, siehe net.js).
// Er erscheint einmal je Konto und Gerät: Das Merkzeichen „onboarded“ liegt im kontobezogenen Speicher (LS, Namensraum je Konto).
// Alle Einstellungen nutzen die vorhandenen Funktionen der Optionen; hier steht nur der Ablauf.
import { askAutoPassword, askNewPin, passwordForm } from './admin.js';
import { lockAvailable, lockOn, setPin } from './applock.js';
import { KEEP_OPTIONS, autoAvailable, autoDays, autoEncAvailable, autoEncrypted, autoFolder, autoKeep, clearAutoPassword, setAutoDays, setAutoKeep } from './autobackup.js';
import { refreshMe } from './auth.js';
import { bioDisable, bioEnable, bioEnabled, bioHintMsg, bioSupported, bioUnavailableMsg } from './bio.js';
import { remindDays, setRemindDays } from './bkprefs.js';
import { enableFlow } from './e2ee-ui.js';
import { supported as e2eeSupported } from './e2ee.js';
import { LANG, langChosen, setLang, t } from './i18n.js';
import { onboardingBaked } from './net.js';
import { S } from './state.js';
import { activeFoods, setFoodEnabled } from './store.js';
import { applyTheme, refreshViews, toast } from './ui.js';
import { DEV, LS, el, openOverlay } from './util.js';

// Eingeschaltet? Eingebaut (Build) oder vom Server gemeldet (auch bei einer mit Server verbundenen App)
export const onboardingOn = () => onboardingBaked || !!(S.config && S.config.onboarding);
const isDone = () => !!LS.get('onboarded', false);
// Nach einem Sprachwechsel im Einstieg (Neuladen): wieder beim Sprachschritt weitermachen, ohne Einblend-Animation
const RESUME = 'gutkeeper.onbLang';
const resumeLang = (() => { try { const v = sessionStorage.getItem(RESUME) === '1'; sessionStorage.removeItem(RESUME); return v; } catch { return false; } })();
const markDone = () => LS.set('onboarded', true);

// Auswahl-Chips (wie in den Optionen). cur() liefert den tatsächlichen Zustand, pick() darf scheitern (dann bleibt die alte Auswahl).
function chips(opts, cur, pick) {
  const row = el('div', { class: 'chips', role: 'group' });
  const paint = () => row.querySelectorAll('.chip').forEach((b, i) => { const on = opts[i][0] === cur(); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  for (const [v, label] of opts) {
    const b = el('button', { type: 'button', class: 'chip' }, label);
    b.addEventListener('click', async () => { if (cur() !== v) await pick(v); paint(); });
    row.append(b);
  }
  paint();
  return row;
}
const lbl = (text) => el('div', { class: 'setlbl' }, text);
const para = (text, cls = '') => el('p', { class: cls }, text);
const dbtn = (label, fn, cls = '') => { const b = el('button', { type: 'button', class: 'dbtn ' + cls }, label); b.addEventListener('click', fn); return b; };

// Die Schritte: applies() entscheidet beim Start, ob der Schritt nötig ist (nicht, wenn nicht möglich oder schon eingestellt).
// Für die letzte Seite: value() = aktueller Stand in wenigen Worten, where() = Seite in den Optionen (Name wie im Menü, siehe data.js)
const multi = () => !!(S.config && S.config.multi);
const onOff = (v) => (v ? t('An') : t('Aus'));
const STEPS = [
  { // 0. Eigenes Passwort (nur Konten, die der Admin angelegt bzw. deren Passwort er zurückgesetzt hat: er kennt es noch)
    applies: () => !!(S.me && S.me.pwTemp),
    title: () => t('Eigenes Passwort festlegen'),
    value: () => (S.me && S.me.pwTemp ? t('Noch nicht geändert') : t('Geändert')),
    where: () => t('Konto und Sicherheit'),
    render(box, ctx) {
      if (!(S.me && S.me.pwTemp)) { box.append(para(t('Passwort geändert. Auf anderen Geräten musst du dich neu anmelden.'))); return; }
      const msg = para('', 'warn');
      msg.hidden = true;
      box.append(para(t('Dein Passwort wurde vom Admin vergeben, er kennt es also. Lege ein eigenes fest, damit nur du es kennst.')), msg,
        passwordForm((m, ok) => { if (ok) ctx.rerender(); else { msg.textContent = m; msg.hidden = false; } }));
    },
  },
  { // 1a. Sprache (nur, wenn auf diesem Gerät noch nicht gewählt). Umschalten lädt die App neu; der Einstieg steht danach wieder
    // auf diesem Schritt, jetzt in der neuen Sprache (Merker in sessionStorage), und der Neustart wird ausgeblendet statt sichtbar zu flackern.
    lang: true,
    applies: () => !langChosen || resumeLang,
    title: () => 'Sprache / Language',
    value: () => (LANG === 'en' ? 'English' : 'Deutsch'),
    where: () => t('App'),
    render(box) {
      let want = LANG;
      box.append(chips([['de', 'Deutsch'], ['en', 'English']], () => want, (v) => {
        want = v; // Auswahl sofort zeigen, nicht erst nach dem Neuladen
        try { sessionStorage.setItem(RESUME, '1'); } catch { /* ohne Merker beginnt der Einstieg nach dem Neuladen beim nächsten Schritt */ }
        document.documentElement.classList.add('reloading');
        setTimeout(() => setLang(v), 160);
      }));
    },
  },
  { // 1. Darstellung
    applies: () => DEV.get('theme', undefined) === undefined,
    title: () => t('Darstellung'),
    value: () => ({ light: t('Hell'), dark: t('Dunkel') }[DEV.get('theme', null)] || t('Automatisch')),
    where: () => t('App'),
    render(box) {
      box.append(para(t('Wie soll die App aussehen? „Automatisch“ folgt der Einstellung deines Geräts.')),
        chips([[null, t('Automatisch')], ['light', t('Hell')], ['dark', t('Dunkel')]], () => DEV.get('theme', null) || null, (v) => { DEV.set('theme', v); applyTheme(v); }));
    },
  },
  { // 2. Essen (schon an, z. B. durch FOOD_DEFAULT oder vorhandene Einträge: nichts zu fragen)
    applies: () => !S.foodOn && !activeFoods().length,
    title: () => t('Essen aufzeichnen'),
    value: () => onOff(S.foodOn),
    where: () => t('App'),
    render(box) {
      box.append(para(t('Optional: Neben dem Stuhl auch grob eintragen, was du gegessen hast (z. B. „Pizza“). Im Verlauf siehst du dann zu jedem Eintrag, was du in den Stunden davor gegessen hast. Ausschalten blendet alles aus und löscht nichts.')),
        chips([[true, t('An')], [false, t('Aus')]], () => S.foodOn, async (v) => { if (await setFoodEnabled(v)) refreshViews(); }));
    },
  },
  { // 3. App-Sperre (lokale PIN), danach optional Fingerabdruck/Gesicht
    applies: () => lockAvailable() && !lockOn(),
    title: () => t('App-Sperre'),
    value: () => (lockOn() ? (bioEnabled() ? t('PIN und Fingerabdruck / Gesicht') : t('PIN')) : t('Nicht eingerichtet')),
    where: () => (multi() ? t('Konto und Sicherheit') : t('Sicherheit')),
    render(box, ctx) {
      if (!lockOn()) {
        box.append(para(t('Schützt die App mit einer PIN, falls jemand dein entsperrtes Handy in die Hand nimmt. Die Einträge werden dadurch nicht verschlüsselt.')),
          ...(S.standalone ? [] : [para(t('Die PIN gilt nur auf diesem Gerät und geht nie an den Server. Mit dem Server-Passwort lässt sie sich zurücksetzen.'), 'bk-2')]),
          el('div', { class: 'drow' }, dbtn(t('PIN festlegen …'), async () => {
            const p = await askNewPin(t('PIN festlegen'));
            if (p) { await setPin(p); ctx.rerender(); }
          }, 'primary')));
        return;
      }
      box.append(para(t('Die App-Sperre ist eingeschaltet.')));
      const bio = el('div', { class: 'setrow' });
      box.append(bio);
      bioSupported().then((ok) => {
        if (!bio.isConnected) return; // der Schritt wurde inzwischen verlassen
        if (!ok && !bioEnabled()) { bio.append(para(bioUnavailableMsg(), 'bk-2')); return; }
        bio.append(lbl(t('Mit Fingerabdruck / Gesicht entsperren')),
          chips([[true, t('An')], [false, t('Aus')]], bioEnabled, async (v) => {
            if (!v) { bioDisable(); return; }
            const m = await bioEnable();
            if (m) toast(m);
          }),
          para(bioHintMsg(), 'bk-2'));
      });
    },
  },
  { // 4. Ende-zu-Ende-Verschlüsselung (nur mit Server, falls möglich und noch aus)
    applies: () => !S.standalone && !S.offline && e2eeSupported() && S.e2eeServer === false && !S.dataKey && !S.needKey,
    title: () => t('Ende-zu-Ende-Verschlüsselung'),
    value: () => (S.dataKey ? t('An') : t('Nicht eingerichtet')),
    where: () => t('Verschlüsselung'),
    render(box, ctx) {
      if (S.dataKey) { box.append(para(t('Verschlüsselung ist eingeschaltet.'))); return; }
      box.append(para(t('Optional: Deine Einträge werden auf diesem Gerät verschlüsselt, bevor sie zum Server gehen. Der Server und seine Backups sehen dann nur unlesbaren Text. Dafür bekommst du einen Wiederherstellungscode, den du sicher aufbewahren musst.')),
        el('div', { class: 'drow' }, dbtn(t('Verschlüsselung einschalten …'), async () => { await enableFlow(); if (S.dataKey) ctx.rerender(); }, 'primary')));
    },
  },
  { // 5. Backups: serverlos die Erinnerung (und in der Android-App das automatische Backup), mit Server nur ein Hinweis
    applies: () => !S.offline && (!S.standalone || (DEV.get('bkRemind', undefined) === undefined && DEV.get('autoBk', undefined) === undefined)),
    title: () => t('Backups'),
    value: () => {
      if (!S.standalone) return t('Der Server sichert automatisch');
      const d = remindDays(), parts = [d ? t('Erinnerung nach {n} Tagen', { n: d }) : t('Erinnerung aus')];
      if (autoAvailable() && autoDays() > 0) parts.push(t('automatisches Backup an'));
      return parts.join(', ');
    },
    where: () => t('Sicherung und Import'),
    render(box, ctx) {
      if (!S.standalone) { box.append(para(t('Der Server legt regelmäßig automatisch Backups an. Eigene Sicherungen als Datei kannst du jederzeit erstellen.'))); return; }
      box.append(para(t('Deine Einträge liegen nur auf diesem Gerät. Geht es verloren oder wird die App gelöscht, sind sie weg. Sichere sie deshalb ab und zu als Datei mit Passwort (Optionen → Sicherung und Import) und lege sie woanders ab, z. B. in einer Cloud oder auf dem PC.')),
        el('div', { class: 'setrow' }, lbl(t('Backup-Erinnerung')),
          chips([[0, t('Aus')], [7, t('{n} Tage', { n: 7 })], [14, t('{n} Tage', { n: 14 })], [30, t('{n} Tage', { n: 30 })]], remindDays, setRemindDays),
          para(t('Zeigt beim Öffnen der App einen Hinweis und einen roten Punkt am Tab „Optionen“.'), 'bk-2')));
      if (!autoAvailable()) return;
      const on = autoDays() > 0;
      box.append(el('div', { class: 'setrow' }, lbl(t('Automatisches Backup')),
        chips([[0, t('Aus')], [7, t('Wöchentlich')], [1, t('Täglich')]], autoDays, (v) => { setAutoDays(v); ctx.rerender(); }),
        ...(on ? [lbl(t('Anzahl behalten')), chips(KEEP_OPTIONS.map((n) => [n, String(n)]), autoKeep, setAutoKeep),
          ...(autoEncAvailable() ? [lbl(t('Verschlüsselung')), chips([[true, t('Mit Passwort')], [false, t('Aus')]], autoEncrypted,
            async (v) => { if (v) await askAutoPassword(); else await clearAutoPassword(); })] : [])] : []),
        para(t('Speichert beim Öffnen der App eine Datei im Ordner Dokumente/{f} und behält die letzten {n}; ältere werden gelöscht.', { n: autoKeep(), f: autoFolder() }), 'bk-2'),
        para(t('Tipp: Mit Passwort ist die Datei verschlüsselt. Sie bleibt auch erhalten, wenn die App gelöscht wird, liegt aber auf dem Handy. Kopiere sie ab und zu woanders hin.'), 'bk-2')));
    },
  },
];

// Letzte Seite: nur das, was die Schritte oben abgedeckt haben (die gezeigten Schritte), und wo man es später ändert (Menü „Optionen“)
function finalPage(box, steps) {
  box.append(para(t('Das hast du eingestellt. Ändern kannst du alles jederzeit im Tab „Optionen“:')),
    el('ul', { class: 'onb-where' }, steps.map((s) => el('li', {}, el('div', {}, el('b', {}, s.title()), ' · ', s.value()),
      el('div', { class: 'bk-2' }, t('Ändern unter Optionen → {p}', { p: s.where() }))))));
}

let starting = false;
// Dialog zeigen, falls eingeschaltet, noch nicht erledigt und die App nicht gesperrt ist. Aufruf nach dem Start und nach jedem Entsperren/Anmelden.
export async function maybeOnboard() {
  if (starting || !onboardingOn() || isDone() || S.locked || document.querySelector('.onbov')) return;
  starting = true;
  try {
    // Mit Server zuerst den Kontostand holen (Essen, Verschlüsselung), sonst fragt der Dialog nach Dingen, die schon eingestellt sind
    if (!S.standalone && !S.offline) { await refreshMe(); if (S.locked) return; }
    const steps = STEPS.filter((s) => s.applies());
    if (!steps.length) { markDone(); return; }
    open(steps);
  } finally { starting = false; }
}

function open(steps) {
  let i = resumeLang ? Math.max(0, steps.findIndex((s) => s.lang)) : 0;
  const total = steps.length;
  const stepLbl = el('span', { class: 'onb-step' });
  const skipAll = el('button', { type: 'button', class: 'onb-skipall' }, t('Alles überspringen'));
  const body = el('div', { class: 'onb-body' });
  const note = el('p', { class: 'onb-note' }, t('Alles lässt sich später unter Optionen ändern.')); // auf der letzten Seite steht das ausführlicher im Text
  const back = el('button', { type: 'button', class: 'onb-back' }, t('Zurück'));
  const skip = el('button', { type: 'button' }, t('Überspringen'));
  const next = el('button', { type: 'button', class: 'primary' }, t('Weiter'));
  const btns = el('div', { class: 'btns' }, back, skip, next);
  const sheet = el('div', { class: 'sheet onb', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('Erste Schritte') },
    el('div', { class: 'onb-top' }, stepLbl, skipAll),
    note, body, btns);
  // Jeder Ausgang (Fertig, „Alles überspringen“, Zurück-Taste/Wischgeste, Esc) markiert den Einstieg als erledigt und schließt ihn.
  // Zurück-Taste = „Alles überspringen“: Wer die App so verlässt, will ihn nicht, und er soll nicht bei jedem Start wiederkommen.
  const finish = () => { markDone(); if (ov.isConnected) ov.remove(); };
  const ov = openOverlay(sheet, finish);
  ov.classList.add('onbov');
  if (resumeLang) ov.classList.add('noanim');
  skipAll.addEventListener('click', finish);
  // Esc schließt nur, wenn der Einstieg das oberste Fenster ist (nicht ein darüberliegender Dialog wie die PIN-Eingabe)
  document.addEventListener('keydown', function esc(ev) {
    if (!ov.isConnected) { document.removeEventListener('keydown', esc); return; }
    if (ev.key === 'Escape' && [...document.querySelectorAll('.overlay')].pop() === ov) finish();
  });
  const draw = () => {
    const last = i >= total;
    body.replaceChildren();
    const box = el('div', { class: 'dcard' });
    const head = el('h2', { tabindex: '-1' }, last ? t('Fertig') : steps[i].title());
    body.append(head, box);
    if (last) finalPage(box, steps); else steps[i].render(box, { rerender: draw });
    stepLbl.textContent = last ? '' : t('Schritt {i} von {n}', { i: i + 1, n: total });
    skipAll.hidden = last; skip.hidden = last; note.hidden = last; back.hidden = i === 0; // vor dem ersten Schritt gibt es kein Zurück
    next.textContent = last ? t('Fertig') : t('Weiter');
    head.focus({ preventScroll: true }); // Bildschirmleser lesen die neue Überschrift vor
  };
  const go = (d = 1) => { i = Math.max(0, Math.min(total, i + d)); draw(); body.scrollTop = 0; }; // die Liste enthält nur anwendbare Schritte: der vorherige ist immer i - 1
  skip.addEventListener('click', () => go(1));
  back.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => { if (i >= total) finish(); else go(1); });
  draw();
}
