'use strict';
// Name des Service-Worker-Caches: App-Version plus kurzer Hash über alle Dateien der SHELL-Liste.
// Ändert sich irgendeine App-Datei, ändert sich sw.js und installierte Apps laden die neuen Dateien.
// Wird vom Server (bei jeder Anfrage auf sw.js, mit Zwischenspeicher) und von tools/build-static.js genutzt.
const crypto = require('node:crypto');

const PLACEHOLDER = '__CACHE_VERSION__';

// Pfade aus „const SHELL = [ … ]“ in sw.js; './' ist dieselbe Datei wie index.html
function shellOf(sw) {
  const m = sw.match(/const SHELL = \[([\s\S]*?)\];/);
  if (!m) throw new Error('SHELL-Liste in sw.js nicht gefunden');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).filter((p) => p !== './');
}

// read(p) liefert den ausgelieferten Inhalt einer Datei (Buffer oder String)
function cacheName(sw, version, read) {
  const h = crypto.createHash('sha256');
  for (const p of shellOf(sw)) h.update(p + '\0').update(read(p)).update('\0');
  return `${version}-${h.digest('hex').slice(0, 8)}`;
}

const fillSw = (sw, version, read) => sw.replace(PLACEHOLDER, cacheName(sw, version, read));

module.exports = { PLACEHOLDER, shellOf, cacheName, fillSw };
