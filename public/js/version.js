// Passen App-Version (APK bzw. serverlose Web-App) und Server-Version zusammen? Die App hat ihre Dateien eingefroren, der Server kann neuer
// oder älter sein. '' = in Ordnung, 'newer' = die App ist neuer als der Server (Funktionen können fehlen), 'major' = andere Hauptversion.
const parse = (v) => String(v || '').split('.').slice(0, 3).map((n) => parseInt(n, 10) || 0);

// Vergleich zweier Versionen (1.2.3, auch mit führendem „v“): negativ = a älter, 0 = gleich, positiv = a neuer
export function cmpVersion(a, b) {
  const x = parse(String(a || '').replace(/^v/i, '')), y = parse(String(b || '').replace(/^v/i, ''));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

export function versionMismatch(app, server) {
  if (!app || !server) return '';
  const a = parse(app), s = parse(server);
  if (a[0] !== s[0]) return 'major';
  return a[1] > s[1] ? 'newer' : '';
}
