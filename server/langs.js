'use strict';
// Sprachen der Oberfläche für Server und Build: Deutsch (Sprache im Code) plus jede Datei public/js/lang-<code>.js.
// Die Liste für die App steht in public/js/langs.js; tests/consistency.test.js prüft, dass beide zusammenpassen.
const fs = require('node:fs');
const path = require('node:path');

const FILE = /^lang-([a-z]{2,3})\.js$/;

function languages(publicDir) {
  const files = fs.readdirSync(path.join(publicDir, 'js')).map((f) => (f.match(FILE) || [])[1]).filter(Boolean).sort();
  return ['de', ...files.filter((c) => c !== 'de')];
}

// Übersetzungen einer Sprachdatei lesen (eine Zeile je Eintrag: "Deutsch": "Übersetzung",), ohne das Modul auszuführen
function strings(publicDir, code) {
  const map = new Map();
  if (code === 'de') return map;
  let text = '';
  try { text = fs.readFileSync(path.join(publicDir, 'js', `lang-${code}.js`), 'utf8'); } catch { return map; }
  for (const m of text.matchAll(/^\s*"((?:[^"\\]|\\.)*)":\s*"((?:[^"\\]|\\.)*)",?\s*$/gm)) map.set(JSON.parse('"' + m[1] + '"'), JSON.parse('"' + m[2] + '"'));
  return map;
}

// Text in einer Sprache, Ersatz wie in der App: erst die Sprache selbst, dann Englisch, dann Deutsch
function translate(publicDir, code, de) {
  return strings(publicDir, code).get(de) || (code === 'de' ? de : strings(publicDir, 'en').get(de) || de);
}

// Erste Sprache aus Accept-Language, die es gibt ("de-AT" zählt als "de"); sonst Englisch. Gleiche Regel wie in public/js/i18n.js.
function pick(header, codes) {
  const wanted = String(header || '').split(',')
    .map((p, i) => { const [tag, ...params] = p.trim().split(';'); const q = params.map((x) => x.trim()).find((x) => x.startsWith('q='));
      return { c: tag.trim().toLowerCase().split('-')[0], q: q ? Number(q.slice(2)) || 0 : 1, i }; })
    .filter((x) => x.c && x.q > 0).sort((a, b) => b.q - a.q || a.i - b.i);
  const hit = wanted.find((x) => codes.includes(x.c));
  return hit ? hit.c : 'en';
}

module.exports = { languages, strings, translate, pick };
