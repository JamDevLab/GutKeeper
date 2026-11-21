// Sprache (Deutsch/Englisch). Die Texte stehen im Code auf Deutsch; die englische Übersetzung steht in lang-en.js.
// Eigenständig (ohne Import aus util.js), damit util.js und alle anderen Module sie nutzen können.
import { EN } from './lang-en.js';

const KEY = 'gutkeeper.lang'; // gleicher Präfix wie die übrigen lokalen Einstellungen
const meta = (n) => { const m = document.querySelector(`meta[name="${n}"]`); return m ? m.content : ''; };
const stored = (() => { try { const v = JSON.parse(localStorage.getItem(KEY)); return v === 'en' || v === 'de' ? v : null; } catch { return null; } })();
const fromBrowser = () => ((navigator.languages && navigator.languages[0]) || navigator.language || '').toLowerCase().startsWith('en') ? 'en' : 'de';
const fromBuild = meta('gutkeeper-lang');
// Reihenfolge: eigene Wahl auf diesem Gerät, dann Voreinstellung der serverlosen Version (APP_LANG), dann Browser-Sprache
export const LANG = stored || (fromBuild === 'en' || fromBuild === 'de' ? fromBuild : fromBrowser());
export const LOC = LANG === 'en' ? 'en-GB' : 'de-DE'; // Datums- und Zahlenformat
export const isEn = LANG === 'en';
export const langChosen = !!stored; // auf diesem Gerät schon selbst gewählt (sonst Voreinstellung bzw. Browser)

export function setLang(l) {
  try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* Speicher nicht verfügbar */ }
  location.reload();
}
// Feste Leerzeichen in deutschen Abkürzungen („z. B.“, „d. h.“ …), damit sie nicht mitten in der Abkürzung umbrechen. Zentral hier, damit die Schlüssel in lang-en.js unverändert bleiben.
const ABBR = /\b(z\. B\.|d\. h\.|u\. a\.|u\. Ä\.|o\. Ä\.|s\. o\.|s\. u\.|v\. a\.|i\. d\. R\.|e\. V\.)/g;
const nbsp = (s) => s.replace(ABBR, (m) => m.replaceAll(' ', '\u00a0'));
export function t(s, p) {
  let r = LANG === 'en' && Object.hasOwn(EN, s) ? EN[s] : s;
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
