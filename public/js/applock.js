// Lokale App-Sperre (in jedem Betrieb optional): eine PIN nur für dieses Gerät, sie geht nie an den Server. Gespeichert wird nur ein Prüfwert
// (PBKDF2), nie die PIN selbst. Die PIN sperrt die Oberfläche; die Einträge werden dadurch nicht verschlüsselt (wer das Gerät aufbricht,
// kommt an den App-Speicher). Das Server-Passwort ist davon unabhängig (auth.js).
import { DEV } from './util.js';

const ITER = 300000;
const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
async function hash(pin, saltHex, iter) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}

export const PIN_RE = /^\d{4,12}$/;
export const lockOn = () => !!DEV.get('applock', null);
export const lockAvailable = () => !!(window.crypto && crypto.subtle && crypto.subtle.deriveBits);

export async function setPin(pin) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  DEV.set('applock', { salt, iter: ITER, check: await hash(pin, salt, ITER) });
  DEV.set('applockFail', null);
}
export function removePin() { DEV.set('applock', null); DEV.set('applockFail', null); }

// Nach „Sperren nach“ Sekunden im Hintergrund wird die App wieder gesperrt (0 = sofort)
export const lockAfter = () => { const v = DEV.get('applockAfter', 60); return [0, 60, 300].includes(v) ? v : 60; };
export const setLockAfter = (s) => DEV.set('applockAfter', s);

// Prüfen: { ok: true } | { ok: false, wait: Sekunden } (zu viele Fehlversuche) | { ok: false }
// Nach 5 falschen Eingaben in Folge wächst die Wartezeit (15 s, 30 s, 60 s … bis 5 Minuten).
export async function checkPin(pin) {
  const v = DEV.get('applock', null);
  if (!v) return { ok: true };
  const f = DEV.get('applockFail', null) || { n: 0, until: 0 };
  if (f.until > Date.now()) return { ok: false, wait: Math.ceil((f.until - Date.now()) / 1000) };
  if ((await hash(String(pin), v.salt, v.iter)) === v.check) { DEV.set('applockFail', null); return { ok: true }; }
  const n = f.n + 1;
  const wait = n >= 5 ? Math.min(300, 15 * 2 ** (n - 5)) : 0;
  DEV.set('applockFail', { n, until: wait ? Date.now() + wait * 1000 : 0 });
  return wait ? { ok: false, wait } : { ok: false }; // Wartezeit gleich beim auslösenden Fehlversuch melden
}
