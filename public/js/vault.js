// Lokaler Speicher für die Gesundheitsdaten (Einträge, Essen, Abgleichstand) auf diesem Gerät.
// Normalfall: IndexedDB, jeder Wert verschlüsselt mit einem zufälligen Geräteschlüssel (AES-256-GCM), der sich
// im Browser nicht auslesen lässt. So liegen die Daten nicht mehr als lesbarer Text im Browser-Speicher.
// Ohne WebCrypto oder IndexedDB (z. B. bei http:// im Heimnetz) bleibt es beim bisherigen localStorage.
// Eigenständig (ohne Import aus util.js), weil util.js diesen Speicher benutzt. Das Modul wartet beim Laden (Top-Level-await),
// bis die Daten entschlüsselt im Arbeitsspeicher liegen; danach sind get/set synchron wie bisher.
import { cryptoAvailable, importKey } from './cipher.js';

const BASE = 'gutkeeper.';
const session = (() => { try { return JSON.parse(localStorage.getItem(BASE + 'session')); } catch { return null; } })();
const PREFIX = session && session.id ? `${BASE}u${session.id}.` : BASE;
export const DATA_KEYS = ['entries', 'seq', 'foods', 'foodSeq', 'epoch', 'reportInfo']; // reportInfo: Name/Geburtsdatum für den PDF-Bericht

const te = new TextEncoder(), td = new TextDecoder();
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (t) => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('abort')); });
const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));

function plainVault() {
  return {
    mode: 'plain', problem: false, onError: null,
    get(k, d) {
      try {
        let v = localStorage.getItem(PREFIX + k);
        return v == null ? d : JSON.parse(v);
      } catch { return d; }
    },
    set(k, v) { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); return true; } catch { return false; } },
    async getDataKey() { return null; },
    async setDataKey() { throw new Error('unsupported'); },
    async clearDataKey() { /* nichts zu tun */ },
    async getBackupKey() { return null; },
    async setBackupKey() { throw new Error('unsupported'); },
    async clearBackupKey() { /* nichts zu tun */ },
    async moveTo() { /* localStorage wird in util.js umgezogen */ },
    async clearPrefix() { /* localStorage wird in util.js geleert */ },
    async clearAll() { /* localStorage wird in util.js geleert */ },
    async flush() { /* schreibt sofort */ },
  };
}

function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('gutkeeper', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('keys', { keyPath: 'id' }); r.result.createObjectStore('data', { keyPath: 'k' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked'));
  });
}

async function idbVault(db) {
  const tx = (stores, mode = 'readonly') => db.transaction(stores, mode);
  // Geräteschlüssel: einmal erzeugen, nicht auslesbar (extractable = false)
  const getVaultKey = async () => { const r = await req(tx('keys').objectStore('keys').get('vault')); return r && r.key; };
  let vkey = await getVaultKey();
  if (!vkey) {
    const fresh = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    try { const t = tx('keys', 'readwrite'); t.objectStore('keys').add({ id: 'vault', key: fresh }); await done(t); } catch { /* ein anderer Tab war schneller */ }
    vkey = await getVaultKey();
  }
  // Wert verschlüsseln/entschlüsseln; die Kennung (AAD) bindet ihn an seinen Namen
  const enc = async (bytes, aad) => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    return { iv, data: await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, vkey, bytes) };
  };
  const dec = async (rec, aad) => new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv, additionalData: te.encode(aad) }, vkey, rec.data));

  const api = { mode: 'idb', problem: false, onError: null };
  const cache = {}, dirty = new Set();

  // Laden: alle Werte dieses Kontos entschlüsseln
  for (const row of await req(tx('data').objectStore('data').getAll())) {
    if (!row.k.startsWith(PREFIX)) continue;
    const key = row.k.slice(PREFIX.length);
    if (!DATA_KEYS.includes(key)) continue;
    try { cache[key] = JSON.parse(td.decode(await dec(row, row.k))); } catch { api.problem = true; }
  }

  const writeKeys = async (keys) => {
    const rows = [];
    for (const k of keys) rows.push({ k: PREFIX + k, ...(await enc(te.encode(JSON.stringify(cache[k])), PREFIX + k)) });
    const t = tx('data', 'readwrite');
    for (const r of rows) t.objectStore('data').put(r);
    await done(t);
  };

  // Einmalige Übernahme aus dem localStorage (z. B. wenn die Seite vorher ohne HTTPS lief): danach dort löschen
  if (!('entries' in cache)) {
    const moved = [];
    for (const key of DATA_KEYS) {
      let v = localStorage.getItem(PREFIX + key);
      if (v == null) continue;
      try { cache[key] = JSON.parse(v); moved.push(key); } catch { /* beschädigt: ignorieren */ }
    }
    if (moved.length) {
      await writeKeys(moved);
      for (const key of DATA_KEYS) { localStorage.removeItem(PREFIX + key); }
    }
  }

  // Schreiben: Änderungen eines Durchgangs werden zusammengefasst und der Reihe nach gespeichert
  let chain = Promise.resolve(), queued = false;
  const flushNow = () => {
    chain = chain.then(async () => {
      const keys = [...dirty]; dirty.clear();
      if (!keys.length) return;
      try { await writeKeys(keys); } catch (err) { keys.forEach((k) => dirty.add(k)); if (api.onError) api.onError(err); }
    });
    return chain;
  };
  const schedule = () => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; flushNow(); }); };
  addEventListener('pagehide', () => { if (dirty.size) flushNow(); });

  let frozen = false; // nach dem Löschen des eigenen Kontos: nichts mehr schreiben (die Seite lädt gleich neu), sonst käme alles zurück
  api.get = (k, d) => (k in cache ? cache[k] : d);
  api.set = (k, v) => { if (frozen) return false; cache[k] = v; dirty.add(k); schedule(); return true; };
  api.flush = flushNow;

  // Datenschlüssel der Ende-zu-Ende-Verschlüsselung: mit dem Geräteschlüssel verpackt abgelegt
  const dekId = (p = PREFIX) => 'dek:' + p;
  api.getDataKey = async (extractable = false) => {
    const rec = await req(tx('keys').objectStore('keys').get(dekId()));
    return rec ? importKey(await dec(rec, dekId()), extractable) : null;
  };
  api.setDataKey = async (raw) => {
    const t = tx('keys', 'readwrite'); t.objectStore('keys').put({ id: dekId(), ...(await enc(raw, dekId())) }); await done(t);
  };
  api.clearDataKey = async () => { const t = tx('keys', 'readwrite'); t.objectStore('keys').delete(dekId()); await done(t); };
  // Schlüssel für verschlüsselte automatische Backups: { key (CryptoKey, nur Verschlüsseln), salt, iter }.
  // IndexedDB speichert den CryptoKey selbst; auslesen lässt er sich nicht.
  api.getBackupKey = async () => { const r = await req(tx('keys').objectStore('keys').get('autobk')); return r ? { key: r.key, salt: r.salt, iter: r.iter } : null; };
  api.setBackupKey = async (k) => { const t = tx('keys', 'readwrite'); t.objectStore('keys').put({ id: 'autobk', ...k }); await done(t); };
  api.clearBackupKey = async () => { const t = tx('keys', 'readwrite'); t.objectStore('keys').delete('autobk'); await done(t); };

  // Konto wechseln (Einzelnutzer-Daten werden zum Hauptkonto) bzw. lokale Daten eines Kontos löschen
  api.moveTo = async (toPrefix) => {
    await flushNow();
    const rows = [];
    for (const k of Object.keys(cache)) rows.push({ k: toPrefix + k, ...(await enc(te.encode(JSON.stringify(cache[k])), toPrefix + k)) });
    const old = await req(tx('keys').objectStore('keys').get(dekId()));
    const dekRow = old ? { id: dekId(toPrefix), ...(await enc(await dec(old, dekId()), dekId(toPrefix))) } : null;
    const t = tx(['data', 'keys'], 'readwrite');
    for (const r of rows) t.objectStore('data').put(r);
    for (const k of Object.keys(cache)) t.objectStore('data').delete(PREFIX + k);
    if (dekRow) { t.objectStore('keys').put(dekRow); t.objectStore('keys').delete(dekId()); }
    await done(t);
  };
  api.clearPrefix = async (prefix) => {
    if (prefix === PREFIX) { frozen = true; dirty.clear(); await chain; }
    const t = tx(['data', 'keys'], 'readwrite');
    for (const k of DATA_KEYS) t.objectStore('data').delete(prefix + k);
    t.objectStore('keys').delete(dekId(prefix));
    await done(t);
  };
  // Alles löschen (serverlose Version zurücksetzen): Daten, Datenschlüssel und Backup-Schlüssel; der Geräteschlüssel entsteht beim nächsten Start neu
  api.clearAll = async () => {
    frozen = true; dirty.clear(); await chain;
    const t = tx(['data', 'keys'], 'readwrite');
    t.objectStore('data').clear(); t.objectStore('keys').clear();
    await done(t);
  };
  return api;
}

async function createVault() {
  if (!(cryptoAvailable() && globalThis.indexedDB)) return plainVault();
  try { return await Promise.race([openDb().then(idbVault), timeout(6000)]); }
  catch (err) { console.warn('Verschlüsselter Speicher nicht verfügbar, nutze localStorage:', err); return plainVault(); }
}

export const vault = await createVault();
