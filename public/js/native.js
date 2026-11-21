// Brücke zur Android-App (Capacitor): Alles, was nur in der APK geht, läuft über diese Datei. Im Browser und in der Web-App
// gibt es keine Plugins; dann liefert plugin() null und die Aufrufer weichen auf die Web-Funktion aus (oder lassen es weg).
export const isNative = () => { const c = window.Capacitor; return !!(c && c.isNativePlatform && c.isNativePlatform()); };
export const plugin = (name) => (isNative() && window.Capacitor.Plugins && window.Capacitor.Plugins[name]) || null;

// „Vorschau verbergen“ (Android: FLAG_SECURE): Die App erscheint im App-Wechsler ohne Inhalt, Screenshots sind gesperrt
export const privacyAvailable = () => !!plugin('PrivacyScreen');
export const privacyOn = () => { try { return localStorage.getItem('gutkeeper.privacy') === 'true'; } catch { return false; } };
export function setPrivacy(on) {
  try { localStorage.setItem('gutkeeper.privacy', on ? 'true' : 'false'); } catch { /* egal */ }
  const P = plugin('PrivacyScreen');
  if (P) (on ? P.enable() : P.disable()).catch(() => {});
}
export const applyPrivacy = () => { if (privacyOn()) setPrivacy(true); };
