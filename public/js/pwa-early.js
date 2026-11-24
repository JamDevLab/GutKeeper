// Klassisches Skript im <head>, läuft vor den Modulen und vor der ersten Darstellung.
// Gewählte Darstellung (Hell/Dunkel) sofort setzen, sonst blitzt beim Start kurz die Systemfarbe bzw. eine helle Statusleiste auf.
// Gleiche Regel wie applyTheme in ui.js (Schlüssel gutkeeper.theme, Farben wie dort).
(() => {
  let th = null;
  try { th = JSON.parse(localStorage.getItem('gutkeeper.theme')); } catch { /* Speicher nicht verfügbar */ }
  if (th === 'light' || th === 'dark') document.documentElement.dataset.theme = th;
  const dark = th ? th === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.content = dark ? '#0f1514' : '#edf1f0';
})();
// Der Browser meldet „installierbar“ nur einmal und oft früh nach dem Laden: Der Browser meldet „installierbar“ nur einmal und oft früh nach dem Laden.
window.__installEvt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__installEvt = e; dispatchEvent(new Event('gutkeeper-installable')); });
addEventListener('appinstalled', () => { window.__installEvt = null; window.__installed = true; dispatchEvent(new Event('gutkeeper-installable')); });
