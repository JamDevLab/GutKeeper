// Kleine Hilfsfunktionen: DOM, Speicher, Datum, Symbole
import { LANG, LOC, t } from './i18n.js';
import { pushBack } from './nav.js';
import { DATA_KEYS, vault } from './vault.js';

export const $ = (s, r = document) => r.querySelector(s);
export const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
};
// Zwei Speicherbereiche im Browser:
//  - Geräteeinstellungen (Sprache, Darstellung, Start …) gelten für alle Konten: DEV
//  - Daten eines Kontos (Einträge, Essen, Abgleichstand …) sind je Konto getrennt (Namensraum „gutkeeper.u<ID>.“): LS
// Ohne Mehrbenutzer gibt es keine Sitzung, dann ist der Namensraum wie bisher „gutkeeper.“ und beides identisch.
export const BASE = 'gutkeeper.';
// Animation einmal abspielen: Klasse setzen (auch erneut, falls sie noch dran ist) und nach Ablauf wieder entfernen
export function playAnim(node, cls, ms = 700) {
  if (!node) return;
  node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls);
  clearTimeout(node['_t_' + cls]); node['_t_' + cls] = setTimeout(() => node.classList.remove(cls), ms);
}
const session = (() => { try { return JSON.parse(localStorage.getItem(BASE + 'session')); } catch { return null; } })();
export const PREFIX = session && session.id ? `${BASE}u${session.id}.` : BASE;
// Die Gesundheitsdaten (DATA_KEYS) liegen im verschlüsselten Speicher (vault.js), alles andere im localStorage
const DATA = new Set(DATA_KEYS);
const store = (prefix, viaVault = false) => ({
  get(k, d) { if (viaVault && DATA.has(k)) return vault.get(k, d); try { const v = localStorage.getItem(prefix + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { if (viaVault && DATA.has(k)) return vault.set(k, v); try { localStorage.setItem(prefix + k, JSON.stringify(v)); return true; } catch { return false; } },
});
export const LS = store(PREFIX, true);
export const DEV = store(BASE);
export const storeFor = (id) => store(`${BASE}u${id}.`); // Daten eines bestimmten Kontos (z. B. direkt nach der Anmeldung, vor dem Neuladen)
// Daten aus dem Einzelnutzer-Betrieb (ohne Namensraum) gehören dem Hauptkonto (kleinste ID, vom Server als „main“ gemeldet): einmalig übernehmen
export async function adoptLegacy(id) {
  const ns = `${BASE}u${id}.`;
  try {
    if (localStorage.getItem(ns + 'entries') === null) {
      for (const k of ['entries', 'seq', 'epoch', 'foods', 'foodSeq', 'foodOn', 'keep', 'remote', 'bio', 'lastBackup', 'wipe', 'onboarded']) {
        const v = localStorage.getItem(BASE + k);
        if (v !== null) { localStorage.setItem(ns + k, v); localStorage.removeItem(BASE + k); }
      }
    }
  } catch { /* Speicher nicht verfügbar */ }
  try { if (PREFIX === BASE) await vault.moveTo(ns); } catch { /* verschlüsselter Speicher: dann bleiben die Daten unter dem alten Namen */ }
}
// Umkehrung von adoptLegacy: Daten eines Kontos zurück in den allgemeinen Namensraum (eigenständige Version nach dem Trennen vom Server)
export async function releaseToBase(id) {
  const ns = `${BASE}u${id}.`;
  try {
    for (const k of ['entries', 'seq', 'epoch', 'foods', 'foodSeq', 'foodOn', 'keep', 'remote', 'bio', 'lastBackup', 'wipe', 'onboarded']) {
      const v = localStorage.getItem(ns + k);
      if (v !== null) { localStorage.setItem(BASE + k, v); localStorage.removeItem(ns + k); }
    }
  } catch { /* Speicher nicht verfügbar */ }
  try { if (PREFIX === ns) await vault.moveTo(BASE); } catch { /* verschlüsselter Speicher: Daten bleiben dann unter dem Konto */ }
}
// Alle lokalen Daten eines Kontos auf diesem Gerät löschen
export async function clearLocalAccount(id) {
  const ns = `${BASE}u${id}.`;
  try { Object.keys(localStorage).filter((k) => k.startsWith(ns)).forEach((k) => localStorage.removeItem(k)); } catch { /* egal */ }
  try { await vault.clearPrefix(ns); } catch { /* egal */ }
}
// Ein Konto auf diesem Gerät vergessen, wenn es auf dem Server gelöscht wurde („Konto löschen“). Mehrbenutzer: nur der Namensraum dieses Kontos;
// Einzelnutzer: die Kontodaten im allgemeinen Namensraum (Einträge, Abgleichstand, Merkzeichen) samt Datenschlüssel – die Geräteeinstellungen bleiben.
const ACCOUNT_KEYS = ['entries', 'seq', 'epoch', 'foods', 'foodSeq', 'foodOn', 'keep', 'remote', 'bio', 'lastBackup', 'wipe', 'onboarded', 'auth', 'filter', 'last', 'noteKeep', 'noteKept', 'noteTags', 'foodPins', 'reportInfo'];
export async function forgetAccount(id, multi) {
  if (multi && id) { await clearLocalAccount(id); return; }
  try { ACCOUNT_KEYS.forEach((k) => localStorage.removeItem(BASE + k)); } catch { /* egal */ }
  try { await vault.clearPrefix(BASE); } catch { /* egal */ }
}
// Die ganze App auf diesem Gerät zurücksetzen (serverlose Version): alle Daten und Einstellungen, als wäre sie frisch installiert.
// Muss direkt vor dem Neuladen der Seite stehen; danach darf nichts mehr gespeichert werden.
export async function resetDevice() {
  try { await vault.flush(); await vault.clearAll(); } catch { /* egal */ }
  try { Object.keys(localStorage).filter((k) => k.startsWith(BASE)).forEach((k) => localStorage.removeItem(k)); } catch { /* egal */ }
}
export const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
export const ICON = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  ext: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  pin: svg('<path d="M12 17v5M8 3h8l-1 6 3 4H6l3-4z"/>'),
  list: svg('<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>'),
  stats: svg('<path d="M5 20V11M12 20V4M19 20v-6"/>'),
  data: svg('<path d="M12 4v10M8 10l4 4 4-4M5 20h14"/>'),
  now: svg('<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/><path d="M12 8v4l3 2"/>'),
  moon: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  left: svg('<path d="M15 6l-6 6 6 6"/>'),
  right: svg('<path d="M9 6l6 6-6 6"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  note: svg('<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/><path d="M8 10h8M8 14h5"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6h.01"/>'),
  finger: svg('<path d="M12 4a8 8 0 00-8 8v2M12 4a8 8 0 018 8v1c0 3-1 5.5-2.5 7M8 20c.8-1.5 1.5-3.2 1.5-6v-2a2.5 2.5 0 015 0v1.5c0 3.2-.6 5-1.6 7M12 12v2.5c0 2.2-.4 4-1.2 5.5"/>'),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeoff: svg('<path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.4 0 10 7 10 7a17 17 0 01-3.2 4M6.5 6.6A17 17 0 002 12s3.6 7 10 7a10 10 0 004.3-1M9.9 9.9a3 3 0 004.2 4.2"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>'),
  toilet: svg('<path d="M7 3h10v6H7zM3.5 11.5h17M5 11.5c0 4 2.5 6.5 5.5 7V21h3v-2.5c3-.5 5.5-3 5.5-7"/>'),
  food: svg('<path d="M5 3v5a3 3 0 006 0V3M8 3v18M17 21V3c-2.2 1.2-3.5 3.8-3.5 7.5V14H17"/>'),
  share: svg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>'),
};
export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => ymd(new Date());
// Zeitstempel für Dateinamen von Exporten: 2026-11-17_1432 (Ortszeit des Geräts)
export const stampStr = () => { const d = new Date(); return `${ymd(d)}_${pad(d.getHours())}${pad(d.getMinutes())}`; };
export const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const parseD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const diffDays = (a, b) => Math.round((parseD(b) - parseD(a)) / 86400000);
export const fmtN = (n) => n.toLocaleString(LOC, { maximumFractionDigits: 1 });
// year=true hängt das Jahr zweistellig an (für Zeiträume über einen Jahreswechsel)
export const short = (ds, year = false) => {
  const y = year ? ds.slice(2, 4) : '';
  return LANG === 'en' ? `${ds.slice(8, 10)}/${ds.slice(5, 7)}${y && '/' + y}` : `${ds.slice(8, 10)}.${ds.slice(5, 7)}.${y}`;
};
export const uid = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};
export const fmtD = (ds) => (LANG === 'en' ? `${ds.slice(8, 10)}/${ds.slice(5, 7)}/${ds.slice(0, 4)}` : `${ds.slice(8, 10)}.${ds.slice(5, 7)}.${ds.slice(0, 4)}`);
export const fmtD2 = (ds) => (LANG === 'en' ? `${ds.slice(8, 10)}/${ds.slice(5, 7)}/${ds.slice(2, 4)}` : `${ds.slice(8, 10)}.${ds.slice(5, 7)}.${ds.slice(2, 4)}`);
export const nF = (n) => (n === 1 ? t('1 Essens-Eintrag') : `${n.toLocaleString(LOC)} ${t('Essens-Einträge')}`);
export const nE = (n) => (n === 1 ? t('1 Eintrag') : `${n.toLocaleString(LOC)} ${t('Einträge')}`);

export const fmtBytes = (b) => (b < 1024 ? `${b} B` : b < 1048576
  ? `${(b / 1024).toLocaleString(LOC, { maximumFractionDigits: b < 10240 ? 1 : 0 })} KB`
  : b < 1073741824 ? `${(b / 1048576).toLocaleString(LOC, { maximumFractionDigits: 1 })} MB`
  : `${(b / 1073741824).toLocaleString(LOC, { maximumFractionDigits: 1 })} GB`);

// Fenster über der Seite. Ein Klick auf den Hintergrund schließt es – aber nicht in den ersten Zehntelsekunden:
// Beim Tippen auf dem Handy folgt dem Antippen noch ein „Klick“, der sonst das gerade geöffnete Fenster sofort wieder
// schließt, wenn der Finger oberhalb des Fensters lag (betraf vor allem die obersten, neuesten Einträge im Verlauf).
export function openOverlay(sheet, onClose) {
  const t0 = Date.now();
  const ov = el('div', { class: 'overlay' }, sheet);
  ov.escClose = onClose; // Esc schließt das oberste Fenster wie ein Klick auf den Hintergrund (siehe unten)
  ov.addEventListener('click', (ev) => { if (ev.target === ov && Date.now() - t0 > 450) onClose(); });
  document.body.append(ov);
  // Zurück-Taste/Wischgeste schließt das Fenster; wird es anders entfernt, geben wir den Verlaufseintrag wieder frei
  const release = pushBack(() => { if (ov.isConnected) { onClose(); if (ov.isConnected) ov.remove(); } });
  const mo = new MutationObserver(() => { if (!ov.isConnected) { mo.disconnect(); release(); } });
  mo.observe(document.body, { childList: true });
  dragToClose(ov, sheet, onClose);
  return ov;
}

// Fenster von unten lassen sich nach unten wegziehen (wie das X), aber nur wenn ihr Inhalt ganz oben steht.
// Nur für Finger (Touch-Ereignisse); Fenster von oben (topov) und die Einführung (onbov) sind ausgenommen.
function dragToClose(ov, sheet, onClose) {
  let y0 = 0, x0 = 0, t0 = 0, dy = 0, mode = null; // mode: null = noch offen, 'drag' = zieht, 'no' = normal scrollen
  const scrolledInside = (node) => {
    for (let n = node; n && n !== ov; n = n.parentElement) if (n.scrollTop > 0) return true;
    return false;
  };
  sheet.addEventListener('touchstart', (ev) => {
    mode = null; dy = 0;
    if (ev.touches.length !== 1 || ov.classList.contains('topov') || ov.classList.contains('onbov') || matchMedia('(min-width: 700px)').matches
      || ev.target.closest('input, textarea, select, [contenteditable]') || scrolledInside(ev.target)) { mode = 'no'; return; }
    y0 = ev.touches[0].clientY; x0 = ev.touches[0].clientX; t0 = Date.now();
  }, { passive: true });
  sheet.addEventListener('touchmove', (ev) => {
    if (mode === 'no') return;
    const my = ev.touches[0].clientY - y0, mx = ev.touches[0].clientX - x0;
    if (!mode) {
      if (Math.abs(my) < 8 && Math.abs(mx) < 8) return;
      mode = my > 0 && my > Math.abs(mx) ? 'drag' : 'no';
      if (mode === 'no') return;
      sheet.style.animation = 'none'; sheet.style.transition = 'none';
    }
    ev.preventDefault(); // sonst scrollt bzw. lädt die Seite neu
    dy = Math.max(0, my);
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: false });
  const end = () => {
    if (mode !== 'drag') { mode = null; return; }
    mode = null;
    const fast = dy / Math.max(1, Date.now() - t0) > 0.6; // kurzer, schneller Wisch reicht auch
    sheet.style.transition = 'transform .18s ease-out';
    if (dy > Math.min(140, sheet.offsetHeight * 0.3) || (fast && dy > 40)) {
      sheet.style.transform = 'translateY(100%)';
      setTimeout(() => { onClose(); if (ov.isConnected) { sheet.style.transform = ''; } }, 170); // bleibt offen (z. B. Rückfrage): zurückfedern
    } else sheet.style.transform = '';
  };
  sheet.addEventListener('touchend', end);
  sheet.addEventListener('touchcancel', end);
}

// Esc schließt das oberste Fenster – über denselben onClose-Weg wie der Klick daneben, damit der Verlaufseintrag (nav.js) stimmt.
// Fenster, die sich bewusst nicht per Klick daneben schließen (onClose leer), bleiben auch bei Esc offen.
// Der Einstieg (onboarding.js) hat einen eigenen Esc-Handler und wird hier übergangen.
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || ev.defaultPrevented || ev.isComposing) return;
    const all = document.querySelectorAll('.overlay');
    const top = all[all.length - 1];
    if (!top || !top.escClose || top.classList.contains('onbov')) return;
    ev.preventDefault();
    top.escClose();
  });
}

// Passwort- oder PIN-Feld mit Auge zum Anzeigen/Verbergen (überall gleich: Anmeldung, Sperre, Dialoge, Optionen)
export function eyeField(input) {
  const eye = el('button', { type: 'button', class: 'eye', 'aria-label': t('Passwort anzeigen'), 'aria-pressed': 'false', html: ICON.eye });
  eye.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password'; eye.innerHTML = show ? ICON.eyeoff : ICON.eye;
    eye.setAttribute('aria-pressed', String(show)); input.focus();
  });
  return el('div', { class: 'pin-wrap' }, input, eye);
}
