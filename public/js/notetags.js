// Schlagwörter für Notizen: reine Hilfsfunktionen (ohne Imports, damit sie auch in Node getestet werden können)
// und die Ablage der eigenen Liste. Gespeichert wird nur, wenn die Liste von den Standard-Schlagwörtern abweicht.
export const TAG_MAX_LEN = 30;
export const TAG_MAX_COUNT = 24;
export const TAGS_KEY = 'noteTags';

const norm = (s) => String(s).trim().toLowerCase();

// Die Notiz als Liste von Einträgen, getrennt an Kommas (getrimmt, ohne leere)
export const tokens = (text) => String(text || '').split(',').map((x) => x.trim()).filter(Boolean);

// Steht das Schlagwort als eigener Eintrag in der Notiz? (ohne Beachtung der Groß-/Kleinschreibung)
export const hasToken = (text, tag) => {
  const k = norm(tag);
  return !!k && tokens(text).some((x) => x.toLowerCase() === k);
};

// Schlagwort an- oder abwählen: vorhanden → entfernen („a, b, c“ minus b → „a, c“), sonst anhängen
export function toggleToken(text, tag) {
  if (hasToken(text, tag)) {
    const k = norm(tag);
    return tokens(text).filter((x) => x.toLowerCase() !== k).join(', ');
  }
  const cur = String(text || '').trim().replace(/[,\s]+$/, '');
  return cur ? `${cur}, ${tag}` : tag;
}

// Einzelnes Schlagwort bereinigen: Leerraum zusammenfassen, Kommas wären Trenner und fallen weg, höchstens TAG_MAX_LEN Zeichen
export const cleanTag = (s) => String(s == null ? '' : s).replace(/,/g, ' ').replace(/\s+/g, ' ').trim().slice(0, TAG_MAX_LEN).trim();

// Liste bereinigen: Text, nicht leer, ohne Doppelte (Groß-/Kleinschreibung egal), höchstens TAG_MAX_COUNT
export function sanitizeTags(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set(), out = [];
  for (const x of list) {
    if (typeof x !== 'string') continue;
    const c = cleanTag(x), k = c.toLowerCase();
    if (!c || seen.has(k)) continue;
    seen.add(k); out.push(c);
    if (out.length >= TAG_MAX_COUNT) break;
  }
  return out;
}

// Prüfung für neue oder umbenannte Schlagwörter: 'ok' | 'empty' | 'dup' | 'full'; skip = Position, die gerade umbenannt wird
export function checkTag(list, value, skip = -1) {
  const c = cleanTag(value);
  if (!c) return 'empty';
  if (list.some((x, i) => i !== skip && x.toLowerCase() === c.toLowerCase())) return 'dup';
  if (skip < 0 && list.length >= TAG_MAX_COUNT) return 'full';
  return 'ok';
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Eigene Liste laden; ohne gespeicherte Liste (oder bei ungültigem Inhalt) gelten die Standard-Schlagwörter
export function loadTags(store, defaults) {
  const v = store.get(TAGS_KEY, null);
  return Array.isArray(v) ? sanitizeTags(v) : defaults.slice();
}

// Liste speichern; entspricht sie den Standard-Schlagwörtern, wird nichts abgelegt (dann gilt wieder die Übersetzung der Standards)
export function saveTags(store, list, defaults) {
  const clean = sanitizeTags(list);
  store.set(TAGS_KEY, same(clean, defaults) ? null : clean);
  return clean;
}
