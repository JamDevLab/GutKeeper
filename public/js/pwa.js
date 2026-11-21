// Installation als App (PWA): Knopf, wenn der Browser sie anbietet (HTTPS nötig), sonst ein Hinweis
export const isInstalled = () => !!window.__installed || matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
export const inApk = () => !!window.Capacitor; // Android-App (Capacitor): ist schon eine App
export const canPrompt = () => !!window.__installEvt;
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const secure = () => window.isSecureContext;
export async function promptInstall() {
  const e = window.__installEvt;
  if (!e) return false;
  e.prompt();
  const r = await e.userChoice.catch(() => ({ outcome: 'dismissed' }));
  window.__installEvt = null;
  return r.outcome === 'accepted';
}
