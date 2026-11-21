// Kennung dieser Installation: eine Zufallszahl, einmal angelegt in data/instance.id (nicht aus Schlüsseln oder Daten abgeleitet).
// Sie steht in Backup-Dateien und in /api/config, damit die App beim Import erkennt, ob eine Datei von diesem Server stammt.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cfg = require('./config');
const log = require('./log');
const RE = /^[0-9a-f]{24}$/;
function load() {
  const file = path.join(cfg.DATA_DIR, 'instance.id');
  try { const v = fs.readFileSync(file, 'utf8').trim(); if (RE.test(v)) return v; } catch { /* neu anlegen */ }
  const id = crypto.randomBytes(12).toString('hex');
  try { fs.mkdirSync(cfg.DATA_DIR, { recursive: true }); fs.writeFileSync(file, id + '\n'); } catch (e) { log.warn(`instance.id konnte nicht gespeichert werden: ${e.message}`, `Could not save instance.id: ${e.message}`); }
  return id;
}
module.exports = { INSTANCE: load() };
