// Zweisprachige Log-Ausgabe: erst die deutsche, dann die englische Zeile (der Server kennt die Sprache des Betreibers nicht).
// Bewusst ohne Abhängigkeiten (auch nicht config.js), damit jedes Modul es ohne Zirkelbezug laden kann.
const out = (fn, de, en, extra) => { fn(de); fn(en); if (extra !== undefined) fn(extra); };
module.exports = {
  info: (de, en) => out(console.log, de, en),
  warn: (de, en) => out(console.warn, de, en),
  error: (de, en, err) => out(console.error, de, en, err),
};
