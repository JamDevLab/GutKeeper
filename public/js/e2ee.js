// Ende-zu-Ende-Verschlüsselung (optional), Kern: Zeilen für den Server ver- und entschlüsseln, Schlüssel verwalten.
// Die Oberfläche (Einrichten, Code eingeben, Ausschalten) steht in e2ee-ui.js.
import { handleUnauthorized } from './auth.js';
import { apiFetch } from './net.js';
import { importKey, monthFloor, openRow, parseCode, sealRow, unwrapDataKey } from './cipher.js';
import { t } from './i18n.js';
import { S } from './state.js';
import { vault } from './vault.js';

export { monthFloor };
// Die Oberfläche trägt sich hier ein (vermeidet einen Import-Kreis zwischen Speicher und Oberfläche)
export const hooks = { promptKey: () => {} };

// Verschlüsselung geht nur mit Server, WebCrypto und dem verschlüsselten Geräte-Speicher (HTTPS bzw. localhost)
export const supported = () => vault.mode === 'idb' && !S.standalone;

export async function encodeRows(kind, list) {
  return Promise.all(list.map((rec) => sealRow(kind, rec, S.dataKey)));
}
// Entschlüsselt Zeilen; unlesbare (falscher Schlüssel, beschädigt) werden gezählt und übersprungen
export async function decodeRows(kind, rows) {
  const out = await Promise.all(rows.map(async (row) => { try { return await openRow(kind, row, S.dataKey); } catch { return null; } }));
  return { rows: out.filter(Boolean), failed: out.filter((x) => !x).length };
}

// Aufruf mit Fehlercodes (Status 0 = Server nicht erreichbar)
export async function call(method, path, body) {
  try {
    const r = await apiFetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status === 401) { handleUnauthorized(); return { status: 401, json: {} }; }
    let json = {}; try { json = await r.json(); } catch { /* keine JSON-Antwort */ }
    return { status: r.status, json };
  } catch { return { status: 0, json: {} }; }
}

// Der Server meldet beim Abgleich, dass Konto und Gerät nicht im selben Modus sind
export async function onModeMismatch(data) {
  S.e2eeServer = !!data.e2ee;
  if (data.e2ee && !S.dataKey) { // Konto ist verschlüsselt (z. B. auf einem anderen Gerät eingeschaltet), dieses Gerät hat noch keinen Schlüssel
    if (!S.needKey) { S.needKey = true; hooks.promptKey(); }
  } else if (!data.e2ee && S.dataKey) { // auf einem anderen Gerät wieder ausgeschaltet: lokalen Schlüssel verwerfen
    await vault.clearDataKey(); S.dataKey = null; S.needKey = false;
  }
}

// Wiederherstellungscode prüfen und den Datenschlüssel auf diesem Gerät einrichten. Gibt '' zurück oder einen Fehlertext.
export async function acceptCode(text) {
  const bytes = parseCode(text);
  if (!bytes) return t('Der Code ist unvollständig oder enthält ungültige Zeichen. Er besteht aus 32 Zeichen (Ziffern und Buchstaben).');
  const r = await call('GET', '/api/e2ee');
  if (r.status === 0) return t('Server nicht erreichbar.');
  if (!r.json.e2ee || !r.json.key) return t('Auf dem Server ist keine Verschlüsselung eingeschaltet.');
  let raw;
  try { raw = await unwrapDataKey(r.json.key, bytes); } catch { return t('Der Code passt nicht. Bitte prüfen und erneut eingeben.'); }
  await vault.setDataKey(raw);
  S.dataKey = await importKey(raw); S.needKey = false; S.e2eeServer = true;
  return '';
}
