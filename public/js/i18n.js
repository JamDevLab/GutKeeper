// Sprache der Oberfläche. Die Texte stehen im Code auf Deutsch; Übersetzungen stehen in lang-<code>.js, die Liste in langs.js.
// Eigenständig (ohne Import aus util.js), damit util.js und alle anderen Module sie nutzen können.
import { T as EN } from './lang-en.js';
import { LANGS } from './langs.js';

const KEY = 'gutkeeper.lang'; // gleicher Präfix wie die übrigen lokalen Einstellungen
const known = (v) => LANGS.some((l) => l.code === v);
const meta = (n) => { const m = document.querySelector(`meta[name="${n}"]`); return m ? m.content : ''; };
const stored = (() => { try { const v = JSON.parse(localStorage.getItem(KEY)); return known(v) ? v : null; } catch { return null; } })();
// Erste Browser-Sprache, die es in der App gibt (aus "de-AT" wird "de"); sonst Englisch
const fromBrowser = () => {
  for (const l of navigator.languages || [navigator.language || '']) { const c = String(l).toLowerCase().split('-')[0]; if (known(c)) return c; }
  return 'en';
};
const fromBuild = meta('gutkeeper-lang');
// Reihenfolge: eigene Wahl auf diesem Gerät, dann Voreinstellung der serverlosen Version (APP_LANG), dann Browser-Sprache
export const LANG = stored || (known(fromBuild) ? fromBuild : fromBrowser());
const CUR = LANGS.find((l) => l.code === LANG);
export const LOC = CUR.locale; // Datums- und Zahlenformat
export const clock12 = !!CUR.clock12;
// Dateinamen und CSV-Spalten gibt es auf Deutsch und Englisch (der Import kennt beide); andere Sprachen nehmen Englisch
export const isDe = LANG === 'de';
export const langChosen = !!stored; // auf diesem Gerät schon selbst gewählt (sonst Voreinstellung bzw. Browser)

// Übersetzung der gewählten Sprache. Englisch ist immer geladen (Ersatz für fehlende Texte), andere Sprachen nur bei Bedarf.
const TR = LANG === 'de' ? null : LANG === 'en' ? EN
  : await import(`./lang-${LANG}.js`).then((m) => m.T, () => EN); // Datei fehlt oder ist kaputt: Englisch

export function setLang(l) {
  try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* Speicher nicht verfügbar */ }
  location.reload();
}
// Feste Leerzeichen in deutschen Abkürzungen („z. B.“, „d. h.“ …), damit sie nicht mitten in der Abkürzung umbrechen. Zentral hier, damit die Schlüssel in den Übersetzungsdateien unverändert bleiben.
const ABBR = /\b(z\. B\.|d\. h\.|u\. a\.|u\. Ä\.|o\. Ä\.|s\. o\.|s\. u\.|v\. a\.|i\. d\. R\.|e\. V\.)/g;
const nbsp = (s) => s.replace(ABBR, (m) => m.replaceAll(' ', '\u00a0'));
export function t(s, p) {
  let r = !TR ? s : Object.hasOwn(TR, s) ? TR[s] : Object.hasOwn(EN, s) ? EN[s] : s;
  if (p) r = r.replace(/\{(\w+)\}/g, (_, k) => (p[k] == null ? '' : p[k]));
  return nbsp(r);
}
// Name der App: eigener Name (APP_NAME) oder GutKeeper
export const defaultName = () => 'GutKeeper';
export function appName(cfg) {
  if (cfg && cfg.nameCustom && cfg.name) return cfg.name;
  return meta('gutkeeper-name') || defaultName();
}
export const fileBase = () => 'gutkeeper';
