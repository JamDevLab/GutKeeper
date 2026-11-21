// Passwortgeschützte Exporte und Backups: AES-256-GCM, Schlüssel aus dem Passwort per PBKDF2-SHA256.
// Das Format lässt sich im Browser (WebCrypto) und mit server/cli.js entschlüsseln.
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const pbkdf2 = promisify(crypto.pbkdf2);
const ITER = 600000, ITER_MIN = 100000, ITER_MAX = 5000000;

async function wrap(buf, password, kind) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = await pbkdf2(String(password), salt, ITER, 32, 'sha256');
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(buf), c.final(), c.getAuthTag()]); // Authentifizierungs-Tag hinten (wie WebCrypto)
  return { gutkeeper: 'encrypted', v: 1, kind, kdf: 'PBKDF2-SHA256', iter: ITER, salt: salt.toString('base64'), iv: iv.toString('base64'), data: data.toString('base64') };
}

const isWrapped = (o) => !!o && o.gutkeeper === 'encrypted' && o.v === 1 && typeof o.data === 'string';

async function unwrap(obj, password) {
  if (!isWrapped(obj)) throw new Error('Keine verschlüsselte Datei');
  const iter = obj.iter === undefined ? ITER : obj.iter;
  if (!Number.isInteger(iter) || iter < ITER_MIN || iter > ITER_MAX) throw new Error('Ungültige Datei: Die Zahl der Schlüsselableitungs-Runden liegt außerhalb des erlaubten Bereichs.'); // Rechenbombe bzw. wertlos schwach
  const key = await pbkdf2(String(password), Buffer.from(obj.salt, 'base64'), iter, 32, 'sha256');
  const raw = Buffer.from(obj.data, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(obj.iv, 'base64'));
  d.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]); // wirft bei falschem Passwort
}

module.exports = { wrap, unwrap, isWrapped };
