// Einstiegspunkt
import { lockAfter, lockOn } from './applock.js';
import { remindBackup, runAutoBackup } from './autobackup.js';
import { applyPrivacy } from './native.js';
import { boot, showLock } from './auth.js';
import { buildCapture, hasFoodDraft, resetNow } from './capture.js';
import { LANG, appName, t } from './i18n.js';
import { maybeOnboard } from './onboarding.js';
import { S } from './state.js';
import { paintDot, purgeOld, scheduleSync, sync } from './store.js';
import { VIEWS, applyTheme, applyUrgeColor, showTab, showUpdateBanner, toast } from './ui.js';
import { $, ICON, LS, DEV } from './util.js';

document.documentElement.lang = LANG;
document.title = appName(S.config);
$('#syncBtn').setAttribute('aria-label', t('Jetzt synchronisieren'));
$('#syncLbl').textContent = t('Jetzt synchronisieren');
$('#modeBtn').setAttribute('aria-label', t('Zwischen Stuhl und Essen wechseln'));
$('#tabCap').innerHTML = ICON.plus + '<span>' + t('Erfassen') + '</span>';
$('#tabHist').innerHTML = ICON.list + '<span>' + t('Verlauf') + '</span>';
$('#tabStat').innerHTML = ICON.stats + '<span>' + t('Statistik') + '</span>';
$('#tabData').innerHTML = ICON.gear + '<span>' + t('Optionen') + '</span>';
// Tipp auf den schon offenen Tab Verlauf/Statistik: Inhalt sanft nach oben scrollen statt neu aufzubauen
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  const name = b.dataset.tab, list = S.tab === name && (name === 'hist' || name === 'stat') ? $(VIEWS[name] + ' .list') : null;
  if (list) list.scrollTo({ top: 0, behavior: 'smooth' }); else showTab(name);
}));
$('#syncBtn').addEventListener('click', () => { toast(t('Synchronisiere …')); sync(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(DEV.get('theme', null)));

applyTheme(DEV.get('theme', null));
applyUrgeColor();
buildCapture();
showTab('cap');
paintDot();
purgeOld();
boot().then(maybeOnboard); // geführter Einstieg (optional), falls nicht gesperrt
applyPrivacy();
// Nach dem Öffnen bzw. Entsperren: Backup-Erinnerung und (in der Android-App) automatisches Backup
const afterOpen = () => { if (!S.locked) { remindBackup(); runAutoBackup(); } };
setTimeout(afterOpen, 2500);
document.addEventListener('gutkeeper:unlocked', () => { setTimeout(afterOpen, 1500); maybeOnboard(); });

function goHome() {
  document.querySelectorAll('.overlay:not(.onbov)').forEach((o) => o.remove()); // offene Fenster schließen (außer dem geführten Einstieg: dort läuft man oft kurz in eine andere App, z. B. Passwortmanager)
  if (!hasFoodDraft()) S.capMode = 'stool'; // angefangenen Essens-Eintrag nicht wegschalten
  showTab('cap');
}

let byApp = false; // ging die App gerade wegen eines eigenen Dialogs (Datei wählen, Teilen) in den Hintergrund?
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    S.hiddenAt = Date.now();
    // Der Merker gilt nur, wenn die App kurz danach verschwindet. Das Android-Teilen-Menü liegt oft nur über der App,
    // ohne sie zu verstecken: dann bliebe der Merker sonst stehen und das nächste echte Minimieren würde ignoriert.
    byApp = (!!S.sharing && S.hiddenAt - S.sharing < 300000) || (!!S.stayOnReturn && S.hiddenAt - S.stayOnReturn < 3000); S.stayOnReturn = 0;
    return;
  }
  // Wieder geöffnet (auch aus dem Hintergrund): auf der Startseite „Erfassen“ beginnen, wenn so eingestellt.
  // Nicht nach einem Dateiauswahl- oder Teilen-Dialog der App selbst (z. B. Import): dort soll das Ergebnis sichtbar bleiben.
  const stay = byApp; byApp = false;
  if (!stay && DEV.get('homeOnOpen', true) && S.hiddenAt && Date.now() - S.hiddenAt > 5000) goHome();
  // Nur die lokale App-Sperre (PIN dieses Geräts) greift; die Server-Sitzung bleibt bestehen, bis man sich abmeldet
  if (lockOn() && !S.locked && S.hiddenAt && Date.now() - S.hiddenAt > lockAfter() * 1000) { showLock(); return; }
  if (S.locked) return;
  if (S.tab === 'cap' && !S.capTouched) resetNow();
  afterOpen();
  sync();
});
window.addEventListener('online', () => scheduleSync(300));
window.addEventListener('offline', () => { S.online = false; paintDot(); });
setInterval(() => { if (document.visibilityState === 'visible') { if (S.tab === 'cap' && !S.capTouched) resetNow(); sync(); } }, 60000);

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller; // beim allerersten Start gibt es noch keinen: dann ist ein Wechsel kein Update
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) showUpdateBanner(); });
}
