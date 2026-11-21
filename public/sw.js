// Service Worker: App-Dateien offline verfügbar machen (die API wird nie zwischengespeichert)
const CACHE = 'gutkeeper-__CACHE_VERSION__'; // vom Server bzw. build-static.js gefüllt: App-Version plus Hash der Dateien (server/swcache.js)
const SHELL = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'js/app.js', 'js/i18n.js', 'js/lang-en.js', 'js/util.js', 'js/constants.js', 'js/state.js', 'js/auth.js', 'js/store.js', 'js/form.js', 'js/capture.js',
  'js/filters.js', 'js/remote.js', 'js/history.js', 'js/stats.js', 'js/transfer.js', 'js/report.js', 'js/data.js', 'js/edit.js', 'js/food.js', 'js/detail.js', 'js/bio.js', 'js/admin.js', 'js/ui.js', 'js/cipher.js', 'js/vault.js', 'js/e2ee.js', 'js/e2ee-ui.js', 'js/pwa.js', 'js/pwa-early.js', 'js/net.js', 'js/nav.js', 'js/native.js', 'js/version.js', 'js/bkprefs.js', 'js/autobackup.js', 'js/applock.js', 'js/onboarding.js', 'js/account.js', 'js/notetags.js', 'js/importcheck.js', 'js/pdfcrypt.js', 'js/rewind.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Erst Cache (schnell und offline), im Hintergrund aktualisieren
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true }) || (e.request.mode === 'navigate' ? await c.match('index.html') : null);
    const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
