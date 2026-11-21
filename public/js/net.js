// Verbindung zu einem Server: Die eigenständige Version (statischer Build bzw. Android-App) kann sich mit einem
// GutKeeper-Server verbinden. Dann gehen alle Anfragen an dessen Adresse, die Anmeldung läuft per Token im Header
// (Cookies einer fremden Herkunft zählen nicht). Der Server muss diese App-Herkunft in CORS_ORIGINS erlauben.
import { DEV } from './util.js';

export const staticBuild = !!document.querySelector('meta[name="gutkeeper-standalone"]');
// Version der eigenständigen App (APK/serverlose Web-App); null bei der vom Server ausgelieferten App
export const appVersion = ((document.querySelector('meta[name="gutkeeper-version"]') || {}).content) || null;
// Geführter Einstieg beim Bauen eingeschaltet (Standard; ONBOARDING=0 bei build:static bzw. build-apk schaltet ihn ab)? Mit Server-Verbindung zählt zusätzlich dessen Einstellung (S.config.onboarding)
export const onboardingBaked = !!document.querySelector('meta[name="gutkeeper-onboarding"]');
// { url, token?, adopt? } oder null. Nur im statischen Build; die vom Server ausgelieferte App spricht immer ihren eigenen Server an.
export const serverConn = () => (staticBuild ? DEV.get('server', null) : null);

// Eingabe zu einer Server-Adresse bereinigen: „https://host[:port]“ ohne Pfad. Ohne Schema gilt https. '' = ungültig.
export function cleanServerUrl(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return u.origin;
  } catch { return ''; }
}

export async function apiFetch(path, opts = {}) {
  const c = serverConn();
  if (!c) return fetch(path, opts);
  const headers = { ...(opts.headers || {}) };
  if (c.token) headers.Authorization = 'Bearer ' + c.token;
  const r = await fetch(c.url + path, { ...opts, headers, credentials: 'omit' });
  // Gleitende Sitzung: ist das Token älter als ein Tag, schickt der Server ein frisches (bei Cookies passiert das von selbst)
  const fresh = r.headers.get('X-Session-Token');
  const now = serverConn(); // nach einem Abmelden während der Anfrage kein Token mehr ablegen
  if (fresh && now && now.token) setServerToken(fresh);
  return r;
}
export function setServerToken(token) {
  const c = DEV.get('server', null);
  if (c) DEV.set('server', { ...c, token: token || undefined });
}
export const apiUrl = (path) => { const c = serverConn(); return c ? c.url + path : path; };
