// Meldungen, Navigation und Darstellung (hell/dunkel)
import { paintCapMode, resetNow } from './capture.js';
import { renderData } from './data.js';
import { renderHist } from './history.js';
import { pushBack } from './nav.js';
import { S } from './state.js';
import { t } from './i18n.js';
import { renderStats } from './stats.js';
import { backupDue } from './bkprefs.js';
import { $, DEV, ICON, el, playAnim } from './util.js';

export function toast(msg, actionLabel, action, ms) {
  const box = $('#toast'); box.replaceChildren(msg);
  if (actionLabel) {
    const b = el('button', {}, actionLabel);
    b.addEventListener('click', () => { box.hidden = true; action(); });
    box.append(b);
  }
  box.hidden = false; clearTimeout(S.toastTimer);
  S.toastTimer = setTimeout(() => { box.hidden = true; }, ms || (actionLabel ? 5000 : 1600));
}

/* ================= Navigation, Theme ================= */
export const VIEWS = { cap: '#vCap', hist: '#vHist', stat: '#vStat', data: '#vData' };
export const TITLES = { hist: t('Verlauf'), stat: t('Statistik'), data: t('Optionen') };
export const RENDER = { hist: () => renderHist(), stat: () => renderStats(), data: () => renderData() };
// Zurück-Taste: Ein anderer Tab als „Erfassen“ und eine Unterseite der Optionen sind je eine Ebene (Zurück führt eine Ebene hoch)
let tabLayer = null, optLayer = null;
export function syncNav() {
  if (S.tab !== 'cap' && !tabLayer) tabLayer = pushBack(() => { tabLayer = null; if (optLayer) { optLayer = null; S.optPage = 'home'; } showTab('cap'); });
  else if (S.tab === 'cap' && tabLayer) { const r = tabLayer; tabLayer = null; r(); }
  const wantOpt = S.tab === 'data' && S.optPage !== 'home';
  if (wantOpt && !optLayer) optLayer = pushBack(() => { optLayer = null; S.optPage = 'home'; S.dataMsg = ''; renderData(); });
  else if (!wantOpt && optLayer) { const r = optLayer; optLayer = null; r(); }
}
export function showTab(name) {
  S.tab = name;
  if (name === 'data') { S.optPage = 'home'; S.dataMsg = ''; } // ein Tipp auf „Optionen“ führt immer ins Hauptmenü
  const changed = S.tabShown !== name; S.tabShown = name;
  for (const [k, sel] of Object.entries(VIEWS)) $(sel).hidden = k !== name;
  if (changed && name === 'stat') playAnim($(VIEWS.stat), 'grow', 900); // Diagramme wachsen beim Öffnen einmal auf
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $('#syncLbl').hidden = name !== 'data'; $('#syncBtn').classList.toggle('withlbl', name === 'data'); // auf der Optionen-Seite erklärt ein Text, wofür der Punkt da ist
  const left = $('#topLeft'); left.replaceChildren();
  paintCapMode();
  if (name === 'cap') { if (!S.capTouched) resetNow(); left.append(S.capDT); }
  else { left.append(el('h1', {}, TITLES[name])); RENDER[name](); }
  syncNav(); paintBadge();
}
// Roter Punkt am Tab „Optionen“, wenn ohne Server das letzte Backup zu alt ist (Einstellung „Backup-Erinnerung“) oder es noch keins gibt
export function paintBadge() {
  $('#tabData').classList.toggle('alert', backupDue());
}
// Neue Version verfügbar (der Service Worker hat die neuen Dateien geladen): Hinweis mit „Neu laden“
let updBar = null;
export const updateShown = () => !!updBar;
export function showUpdateBanner() {
  if (updBar) return;
  const b = el('button', { type: 'button' }, t('Neu laden'));
  b.addEventListener('click', () => location.reload());
  updBar = el('div', { class: 'toast updbar', role: 'status' }, t('Neue Version verfügbar'), b);
  document.body.append(updBar);
}
export function refreshViews() { paintBadge(); paintCapMode(); if (RENDER[S.tab]) RENDER[S.tab](); }

// Farbige Hervorhebung des Stuhldrangs im Verlauf pro Gerät ein-/ausschalten (Klasse am <html>, CSS dazu in style.css)
export function applyUrgeColor() { document.documentElement.classList.toggle('no-urge-color', DEV.get('urgeColor', true) === false); }
export function applyTheme(th) {
  if (th) document.documentElement.dataset.theme = th; else delete document.documentElement.dataset.theme;
  const dark = th ? th === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  $('meta[name="theme-color"]').content = dark ? '#0f1514' : '#edf1f0';
}
