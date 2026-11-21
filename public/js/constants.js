// Auswahlmöglichkeiten (Konsistenz, Drang, Farbe …)
import { t } from './i18n.js';
import { S } from './state.js';

export const CONS = [
  { v: 1, short: t('Harte Klumpen'), note: t('Verstopfung') },
  { v: 2, short: t('Klumpige Wurst'), note: t('leicht verstopft') },
  { v: 3, short: t('Wurst mit Rissen'), note: t('normal') },
  { v: 4, short: t('Glatte Wurst'), note: t('ideal') },
  { v: 5, short: t('Weiche Klümpchen'), note: t('leicht weich') },
  { v: 6, short: t('Breiig'), note: t('zu weich') },
  { v: 7, short: t('Flüssig'), note: t('Durchfall') },
];
export const consInfo = (v) => (v ? CONS[v - 1] : { short: t('Kein Stuhl'), note: t('z. B. nur Luft') });
export const G = {
  0: '<circle cx="20" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M15 17L25 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  1: '<circle cx="7" cy="13" r="4"/><circle cx="20" cy="9" r="4"/><circle cx="33" cy="14" r="4"/>',
  2: '<path d="M4 12a5 5 0 015-5h2a3 3 0 016 0h2a3 3 0 016 0h6a5 5 0 010 10h-6a3 3 0 01-6 0h-2a3 3 0 01-6 0H9a5 5 0 01-5-5z"/>',
  3: '<rect x="3" y="6" width="34" height="13" rx="6.5"/><path d="M12 6v5M21 19v-5M29 6v4" stroke="var(--surface)" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
  4: '<rect x="3" y="6" width="34" height="13" rx="6.5"/>',
  5: '<ellipse cx="8" cy="13" rx="5" ry="5"/><ellipse cx="20" cy="11" rx="5.5" ry="6"/><ellipse cx="32" cy="14" rx="5" ry="4.5"/>',
  6: '<path d="M3 19c-1-4 2-5 4-6 0-4 5-6 8-3 2-3 8-3 9 1 4-1 8 1 8 5 2 1 3 3 2 4z"/>',
  7: '<path d="M3 9q4-4 8 0t8 0 8 0 8 0M3 17q4-4 8 0t8 0 8 0 8 0" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
};
export const glyph = (v) => `<svg class="g" viewBox="0 0 40 24" aria-hidden="true">${G[v]}</svg><span class="n">${v || t('kein')}</span>`;
export const URGE = [{ v: 0, label: t('Keiner') }, { v: 1, label: t('Leicht') }, { v: 2, label: t('Mittel') }, { v: 3, label: t('Stark') }];
export const AMOUNT = [{ v: 1, label: t('Wenig') }, { v: 2, label: t('Mittel') }, { v: 3, label: t('Viel') }];
export const PAIN = [{ v: 0, label: t('Keine') }, { v: 1, label: t('Leicht') }, { v: 2, label: t('Mittel') }, { v: 3, label: t('Stark') }];
// Die Farbtöne sind Standardwerte; mit data/settings.json (Server, Eintrag „colors“) lassen sie sich ändern. Gespeichert wird nur die Zahl v (1 bis 6).
const COLOR_DEFAULT = ['#7a4e2d', '#d9ccab', '#d6b23a', '#5d8f3a', '#1f1d1c', '#c0334a'];
const colorHex = (i) => { const c = S.config && Array.isArray(S.config.colors) && S.config.colors[i]; return /^#[0-9a-f]{6}$/i.test(c || '') ? c : COLOR_DEFAULT[i]; };
export const COLORS = [t('Braun'), t('Hell'), t('Gelb'), t('Grün'), t('Schwarz'), t('Rot')].map((label, i) => ({ v: i + 1, label, get hex() { return colorHex(i); } }));
export const YESNO = [{ v: 0, label: t('Nein') }, { v: 1, label: t('Ja'), cls: 'yes' }];

// Essen: grobe Mahlzeit-Zuordnung (optional)
export const MEALS = [{ v: 1, label: t('Frühstück') }, { v: 2, label: t('Mittagessen') }, { v: 3, label: t('Abendessen') }, { v: 4, label: t('Snack') }, { v: 5, label: t('Getränk') }];
export const mealLabel = (v) => (MEALS.find((m) => m.v === v) || {}).label || '';
export const defaultMeal = (time) => { // Vorschlag nach Tageszeit; die Zeiten kommen vom Server (data/settings.json), sonst Standard
  const m = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const c = S.config && Array.isArray(S.config.mealTimes) && S.config.mealTimes.length === 4 ? S.config.mealTimes : [630, 900, 1020, 1290];
  return m < c[0] ? 1 : m < c[1] ? 2 : m < c[2] ? 4 : m < c[3] ? 3 : 4;
};
// Zeile eines Stuhl-Eintrags: Name und Einzelangaben (gemeinsam für Verlauf und Detailansicht)
export function describeEntry(e) {
  const stool = e.consistency > 0;
  const onlyLuft = !stool && !!e.luft && !e.blood && !e.mucus && !e.pain && !e.urge; // „Nur Luft“ nur, wenn sonst nichts angegeben ist
  const name = stool ? consInfo(e.consistency).short : onlyLuft ? t('Nur Luft') : t('Kein Stuhl');
  const parts = [];
  if (stool) parts.push(`${t('Menge')} ${AMOUNT.find((a) => a.v === e.amount).label.toLowerCase()}`);
  let urgeAt = -1; // Position der Drang-Angabe in parts (für die Einfärbung im Verlauf)
  if (stool || e.urge) { urgeAt = parts.length; parts.push(`${t('Drang')} ${URGE.find((u) => u.v === e.urge).label.toLowerCase()}`); }
  if (e.pain) parts.push(`${t('Schmerzen')} ${PAIN[e.pain].label.toLowerCase()}`);
  if (e.color > 1) parts.push(`${t('Farbe')} ${COLORS[e.color - 1].label.toLowerCase()}`);
  return { stool, name, parts, onlyLuft, urgeAt };
}
