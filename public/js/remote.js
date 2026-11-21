// Ältere Einträge (vor dem Speicher-Zeitraum des Geräts) bei Bedarf live vom Server holen – nur im Arbeitsspeicher
import { t } from './i18n.js';
import { fetchT, handleUnauthorized } from './auth.js';
import { apiUrl } from './net.js';
import { flt } from './filters.js';
import { S } from './state.js';
import { decodeRows, monthFloor } from './e2ee.js';
import { cutoff } from './store.js';
import { okId } from './importcheck.js';
import { addDays, el, fmtBytes, parseD, ymd } from './util.js';

const FRESH_OK = 5 * 60 * 1000, FRESH_FAIL = 30 * 1000;

// Welcher Teil des Zeitraums liegt vor dem Speicher-Zeitraum des Geräts? (null = alles lokal vorhanden)
export function needFor(from, to) {
  const c = cutoff();
  if (!c || from >= c) return null;
  const end = to < c ? to : ymd(addDays(parseD(c), -1));
  return { key: `${from}|${end}`, from, to: end };
}
export function remoteNeed(range) {
  const c = cutoff();
  if (!c) return null;
  if (flt.mode === 'all') return { key: 'all', from: '0000-01-01', to: ymd(addDays(parseD(c), -1)) };
  return needFor(range.from, range.to);
}

// null | 'loading' | 'ok' | 'failed' | 'idle' (lädt gleich) | 'manual' (nur auf Tipp)
export function remoteStatus(need) {
  if (!need) return null;
  if (S.remoteBusy[need.key]) return 'loading';
  const m = S.remoteMeta[need.key];
  if (m && Date.now() - m.at < (m.ok ? FRESH_OK : FRESH_FAIL)) return m.ok ? 'ok' : 'failed';
  return S.remoteAuto ? 'idle' : 'manual';
}

export async function loadRemote(need) {
  S.remoteBusy[need.key] = true;
  // verschlüsselt: der Server kennt nur den Monat, genau gefiltert wird nach dem Entschlüsseln
  const url = `/api/entries?from=${S.dataKey ? monthFloor(need.from) : need.from}&to=${need.to}`;
  try {
    const res = await fetchT(url, {}, 20000);
    if (res.status === 401) { handleUnauthorized(); throw new Error('auth'); }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const data = JSON.parse(text);
    // ohne Schlüssel (Konto verschlüsselt, Gerät noch nicht freigeschaltet) sind die Zeilen nicht lesbar und werden nicht angezeigt
    const rows = S.dataKey ? (await decodeRows('e', data.entries)).rows.filter((e) => e.date >= need.from && e.date <= need.to) : data.entries.filter((e) => !e.blob);
    for (const e of rows) if (okId(e.id)) S.remote[e.id] = e;
    const pe = performance.getEntriesByName(new URL(apiUrl(url), location.href).href).pop(); // übertragene Bytes (komprimiert)
    S.remoteMeta[need.key] = { at: Date.now(), ok: true, n: rows.length, bytes: (pe && pe.transferSize) || text.length };
  } catch {
    S.remoteMeta[need.key] = { at: Date.now(), ok: false };
  } finally {
    delete S.remoteBusy[need.key];
  }
}

// Startet den Abruf (wenn automatisch erlaubt) und ruft danach rerender auf
export function ensureRemote(need, rerender) {
  if (remoteStatus(need) === 'idle') loadRemote(need).then(rerender);
  return remoteStatus(need);
}

export function remoteNote(need, rerender) {
  const st = remoteStatus(need);
  if (!st) return null;
  const m = S.remoteMeta[need.key];
  const box = el('div', { class: 'remote-note' });
  if (st === 'loading' || st === 'idle') box.append(t('Lade ältere Einträge vom Server …'));
  else if (st === 'ok') box.append(t('Ältere Einträge live vom Server geladen ({n} Einträge, {b} übertragen). Sie werden nicht auf dem Gerät gespeichert.', { n: m.n, b: fmtBytes(m.bytes) }));
  else {
    const btn = el('button', { type: 'button' }, st === 'failed' ? t('Erneut versuchen') : t('Vom Server laden'));
    btn.addEventListener('click', () => { delete S.remoteMeta[need.key]; const p = loadRemote(need).then(rerender); rerender(); return p; });
    box.append(st === 'failed' ? t('Server nicht erreichbar – ältere Einträge fehlen.') : t('Ältere Einträge liegen nur auf dem Server. '), btn);
  }
  return box;
}
