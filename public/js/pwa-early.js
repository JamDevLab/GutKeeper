// Klassisches Skript, läuft vor den Modulen: Der Browser meldet „installierbar“ nur einmal und oft früh nach dem Laden.
window.__installEvt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__installEvt = e; dispatchEvent(new Event('gutkeeper-installable')); });
addEventListener('appinstalled', () => { window.__installEvt = null; window.__installed = true; dispatchEvent(new Event('gutkeeper-installable')); });
