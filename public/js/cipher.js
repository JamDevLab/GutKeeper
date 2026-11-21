// Verschlüsselung mit WebCrypto (läuft im Browser und in Node, keine Abhängigkeiten):
// Datenschlüssel, Wiederherstellungscode und einzelne Einträge als Chiffretext (AES-256-GCM).
const C = globalThis.crypto;
export const cryptoAvailable = () => !!(C && C.subtle && C.getRandomValues);

const te = new TextEncoder(), td = new TextDecoder();
const rand = (n) => C.getRandomValues(new Uint8Array(n));

/* ---- Base64 (URL-sicher, ohne Auffüllung) ---- */
export function toB64(bytes) {
  bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

/* ---- Datenschlüssel: 32 zufällige Bytes; im Betrieb ein nicht auslesbarer CryptoKey ---- */
export const newDataKeyBytes = () => rand(32);
export const importKey = (raw, extractable = false) => C.subtle.importKey('raw', raw, { name: 'AES-GCM' }, extractable, ['encrypt', 'decrypt']);

/* ---- Wiederherstellungscode: 160 Bit, Crockford-Base32, in Vierergruppen (z. B. 7K2M-9QXA-…) ---- */
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function formatCode(bytes) {
  let bits = 0, val = 0, out = '';
  for (const b of bytes) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHA[(val >>> (bits - 5)) & 31]; bits -= 5; }
    val &= (1 << bits) - 1;
  }
  return out.match(/.{1,4}/g).join('-');
}
export function newRecoveryCode() {
  const bytes = rand(20);
  return { bytes, text: formatCode(bytes) };
}
// Eingabe tolerant lesen (Groß-/Kleinschreibung, Leerzeichen, Bindestriche; O→0, I/L→1). null = ungültig
export function parseCode(text) {
  const s = String(text || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 32) return null;
  let bits = 0, val = 0; const out = [];
  for (const ch of s) {
    const i = ALPHA.indexOf(ch);
    if (i < 0) return null;
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
    val &= (1 << bits) - 1;
  }
  return Uint8Array.from(out);
}

/* ---- Datenschlüssel mit dem Code verpacken (so liegt er auf dem Server, ohne dass der Server ihn lesen kann) ---- */
const INFO = te.encode('gutkeeper/recovery/v1'), AAD_KEY = te.encode('gutkeeper/datakey/v1');
async function kekFrom(codeBytes, salt) {
  const ikm = await C.subtle.importKey('raw', codeBytes, 'HKDF', false, ['deriveKey']);
  return C.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: INFO }, ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function wrapDataKey(rawKey, codeBytes) {
  const salt = rand(16), iv = rand(12), kek = await kekFrom(codeBytes, salt);
  const data = new Uint8Array(await C.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD_KEY }, kek, rawKey));
  return JSON.stringify({ v: 1, t: 'recovery', salt: toB64(salt), iv: toB64(iv), data: toB64(data) });
}
// Gibt die Schlüssel-Bytes zurück; wirft bei falschem Code oder beschädigten Daten
export async function unwrapDataKey(bundleText, codeBytes) {
  const b = JSON.parse(bundleText);
  if (!b || b.v !== 1 || b.t !== 'recovery') throw new Error('format');
  const kek = await kekFrom(codeBytes, fromB64(b.salt));
  return new Uint8Array(await C.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(b.iv), additionalData: AAD_KEY }, kek, fromB64(b.data)));
}

/* ---- Einzelne Werte: Initialisierungsvektor + Chiffretext + Prüfwert, gebunden an eine Kennung (AAD) ---- */
export async function seal(key, obj, aad) {
  const iv = rand(12);
  const ct = new Uint8Array(await C.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, key, te.encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return toB64(out);
}
export async function open(key, blob, aad) {
  const raw = fromB64(blob);
  const pt = await C.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: te.encode(aad) }, key, raw.subarray(12));
  return JSON.parse(td.decode(pt));
}

/* ---- Zeilen für den Server: nur Kennung, Zeitstempel (Änderung), Monat und „gelöscht“ bleiben lesbar ---- */
// kind: 'e' = Stuhl-Eintrag, 'f' = Essen
const FIELDS = {
  e: ['date', 'time', 'consistency', 'urge', 'amount', 'blood', 'pain', 'mucus', 'luft', 'color', 'note'],
  f: ['date', 'time', 'meal', 'text'],
};
const NEUTRAL = {
  e: { time: '00:00', consistency: 0, urge: 0, amount: 0, blood: 0, pain: 0, mucus: 0, luft: 0, color: 0, note: '' },
  f: { time: '00:00', meal: 0, text: '' },
};
export const monthFloor = (d) => String(d).slice(0, 7) + '-01';

export async function sealRow(kind, rec, key) {
  const body = {};
  for (const f of FIELDS[kind]) body[f] = rec[f];
  return { id: rec.id, ...NEUTRAL[kind], date: monthFloor(rec.date), updated_at: rec.updated_at, deleted: rec.deleted ? 1 : 0, blob: await seal(key, body, `${kind}:${rec.id}`) };
}
export async function openRow(kind, row, key) {
  const body = await open(key, row.blob, `${kind}:${row.id}`);
  const out = { id: row.id, updated_at: row.updated_at, deleted: row.deleted ? 1 : 0 };
  for (const f of FIELDS[kind]) out[f] = body[f]; // nur bekannte Felder übernehmen
  return out;
}

/* ---- Passwortgeschützte Datei (Export): gleiches Format wie die Server-Backups (server/crypto-wrap.js) ---- */
const b64std = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x2000) s += String.fromCharCode(...u8.subarray(i, i + 0x2000)); return btoa(s); };
// Schlüssel aus dem Passwort ableiten. Das Ergebnis lässt sich speichern (Schlüssel nicht auslesbar, nur zum Verschlüsseln),
// so kann das automatische Backup ohne Passwort-Abfrage verschlüsseln; zum Öffnen braucht es trotzdem das Passwort.
// Dateien nennen ihre PBKDF2-Runden selbst: unsinnige Werte (Rechenbombe oder wertlos schwach) ablehnen
export const ITER_MIN = 100000, ITER_MAX = 5000000;
export const iterOk = (iter) => Number.isInteger(iter) && iter >= ITER_MIN && iter <= ITER_MAX;
export async function deriveWrapKey(password, iter = 600000) {
  const salt = rand(16);
  const base = await C.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await C.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  return { key, salt: b64std(salt), iter };
}
export async function wrapTextKey(text, { key, salt, iter }, kind = 'json') {
  const iv = rand(12);
  const data = new Uint8Array(await C.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(text)));
  return { gutkeeper: 'encrypted', v: 1, kind, kdf: 'PBKDF2-SHA256', iter, salt, iv: b64std(iv), data: b64std(data) };
}
export async function wrapText(text, password, kind = 'json') {
  return wrapTextKey(text, await deriveWrapKey(password), kind);
}
