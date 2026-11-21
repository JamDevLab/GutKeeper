// Entsperren mit Fingerabdruck / Gesicht (WebAuthn, Gerätesensor). Bequemer Zugang auf diesem Gerät:
// Die Biometrie ersetzt auf diesem Gerät nur das Eintippen der lokalen PIN (App-Sperre); mit dem Server hat sie nichts zu tun.
import { appName, t } from './i18n.js';
import { S } from './state.js';
import { plugin } from './native.js';
import { LS } from './util.js';

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

export const bioEnabled = () => !!LS.get('bio', null);
// iPhone/iPad im Browser (Safari, Home-Bildschirm): Face ID / Touch ID läuft über einen Passkey im iCloud-Schlüsselbund
const iosWeb = () => !nat() && (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
// Safari erlaubt die Abfrage nur direkt nach einem Tippen; deshalb dort kein automatischer Versuch beim Sperrbildschirm
export const bioAutoTry = () => !iosWeb();
const iosNote = () => (iosWeb() ? ' ' + t('Auf dem iPhone fragt iOS beim Einschalten, ob ein Passkey im Schlüsselbund gesichert werden soll. Das ist richtig so: Mit „Fortfahren“ und Face ID bestätigen. Danach entsperrt Face ID die App.') : '');

// In der Android-App übernimmt ein natives Plugin die Abfrage (die WebView kennt WebAuthn nicht)
const nat = () => plugin('BiometricAuthNative');
const natAsk = () => nat().internalAuthenticate({ reason: t('Mit Fingerabdruck / Gesicht entsperren'), cancelTitle: t('Abbrechen'), androidTitle: appName(S.config), allowDeviceCredential: false });
// Hinweistexte: In der App läuft die Abfrage über das native Plugin (kein HTTPS nötig), im Browser über WebAuthn (nur mit HTTPS).
// Fingerabdruck / Gesicht ersetzt nur das Eintippen der PIN, deshalb braucht es in beiden Fällen eine PIN.
export const bioHintMsg = () => (nat() ? t('Funktioniert nur zusammen mit einer PIN. Die PIN kannst du jederzeit stattdessen eingeben.')
  : t('Funktioniert nur zusammen mit einer PIN und über HTTPS. Die PIN kannst du jederzeit stattdessen eingeben.') + iosNote());
export const bioNeedPinMsg = () => (nat() ? t('Zuerst eine PIN festlegen. Fingerabdruck / Gesicht funktioniert nur zusammen mit einer PIN.')
  : t('Zuerst eine PIN festlegen. Fingerabdruck / Gesicht funktioniert nur zusammen mit einer PIN und über HTTPS.'));
// Text, wenn es auf diesem Gerät nicht geht
export const bioUnavailableMsg = () => (nat() ? t('Auf diesem Gerät nicht verfügbar. Richte in den Android-Einstellungen einen Fingerabdruck oder ein Gesicht ein.')
  : t('Auf diesem Gerät nicht verfügbar (nur mit HTTPS und Fingerabdruck- oder Gesichtssensor).'));

// Native Plugin: braucht keinen sicheren Kontext. WebAuthn: geht nur über HTTPS (oder localhost) und mit einem Gerät, das Fingerabdruck oder Gesicht kann
export async function bioSupported() {
  if (nat()) { try { return !!(await nat().checkBiometry()).isAvailable; } catch { return false; } }
  try { return !!(window.isSecureContext && window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())); } catch { return false; }
}

// Einrichten: '' = geklappt, sonst eine Fehlermeldung
export async function bioEnable() {
  if (nat()) { // erst einmal bestätigen lassen, dann merken
    try { await natAsk(); LS.set('bio', { native: true }); return ''; } catch { return t('Einrichtung abgebrochen oder fehlgeschlagen.'); }
  }
  if (!(window.isSecureContext && window.PublicKeyCredential && navigator.credentials)) return t('Nicht verfügbar: Dafür braucht es HTTPS und ein Gerät mit Fingerabdruck oder Gesichtserkennung.');
  // Kein await vor create(): Safari verlangt, dass die Abfrage direkt aus dem Tippen heraus startet
  try {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: rand(32), rp: { name: appName(S.config), id: location.hostname },
        user: { id: rand(16), name: appName(S.config), displayName: `${appName(S.config)} (${t('App-Sperre')})` }, // so erscheint der Passkey im Schlüsselbund
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
        timeout: 60000, attestation: 'none',
      },
    });
    LS.set('bio', { id: b64(cred.rawId) });
    return '';
  } catch { return t('Einrichtung abgebrochen oder fehlgeschlagen.'); }
}
export const bioDisable = () => LS.set('bio', null);

// Abfrage beim Entsperren: true = der Sensor hat die Person bestätigt
export async function bioUnlock() {
  const b = LS.get('bio', null);
  if (!b) return false;
  if (b.native) { if (!nat()) return false; try { await natAsk(); return true; } catch { return false; } }
  try {
    const res = await navigator.credentials.get({
      publicKey: { challenge: rand(32), rpId: location.hostname, allowCredentials: [{ type: 'public-key', id: unb64(b.id) }], userVerification: 'required', timeout: 60000 },
    });
    const flags = new Uint8Array(res.response.authenticatorData)[32];
    return !!(flags & 0x04); // Bit „User Verified“: Fingerabdruck/Gesicht wurde wirklich geprüft
  } catch { return false; }
}
