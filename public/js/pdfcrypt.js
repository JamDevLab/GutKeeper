// Passwortschutz für den PDF-Bericht: Standard Security Handler Revision 6 (AES-256, ISO 32000-2, /V 5 /R 6).
// Nur WebCrypto (crypto.subtle), läuft daher im Browser und in Node (globalThis.crypto) – die Tests nutzen das.
// WebCrypto kennt kein AES-ECB und hängt bei AES-CBC immer PKCS#7-Padding an. Wo die Norm ECB eines Blocks oder
// CBC ohne Padding verlangt, verschlüsseln wir per CBC (bei ECB mit Null-IV) und schneiden den Padding-Block ab:
// Bei Eingaben mit einer Länge von Vielfachen von 16 Byte ist das Ergebnis davor identisch.

const subtle = () => globalThis.crypto.subtle;
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
export const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

// Berechtigungen (/P, Bits 1-basiert): erlaubt sind Drucken (3), Kopieren (5), Barrierefreiheit (10) und
// hochwertiges Drucken (12); Ändern (4), Kommentare (6), Formulare (9) und Seiten zusammenstellen (11) sind gesperrt.
// Bits 7, 8 und 13–32 müssen laut Norm 1 sein. 0xFFFFFAD4 als vorzeichenbehaftete 32-Bit-Zahl = -1324.
// Das Eigentümerpasswort ist zufällig und wird nicht gespeichert – die Rechte sind ohnehin nur ein Hinweis an den Leser.
export const PDF_PERMS = -1324;

// Passwort vorbereiten: Die Norm empfiehlt SASLprep (RFC 4013). Wir normalisieren vereinfacht nach NFC und kürzen
// das UTF-8 auf 127 Byte (wie die Norm es verlangt). Für übliche Passwörter ist das gleichwertig.
export function prepPassword(pw) {
  return new TextEncoder().encode(String(pw ?? '').normalize('NFC')).slice(0, 127);
}

async function cbc(key, iv, data) {
  const k = await subtle().importKey('raw', key, { name: 'AES-CBC' }, false, ['encrypt']);
  return new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv }, k, data));
}
// CBC ohne Padding (Länge der Eingabe ist ein Vielfaches von 16): letzten (Padding-)Block weglassen
const cbcRaw = async (key, iv, data) => (await cbc(key, iv, data)).slice(0, data.length);
const sha = async (alg, data) => new Uint8Array(await subtle().digest(alg, data));

// Algorithmus 2.B (ISO 32000-2, 7.6.4.3.4): Hash für Revision 6
export async function hash2B(pw, salt, udata = new Uint8Array(0)) {
  let k = await sha('SHA-256', cat(pw, salt, udata));
  for (let round = 0; ; round++) {
    const block = cat(pw, k, udata), k1 = new Uint8Array(block.length * 64);
    for (let i = 0; i < 64; i++) k1.set(block, i * block.length);
    const e = await cbcRaw(k.slice(0, 16), k.slice(16, 32), k1);
    let mod = 0;
    for (let i = 0; i < 16; i++) mod += e[i];
    k = await sha(['SHA-256', 'SHA-384', 'SHA-512'][mod % 3], e);
    if (round >= 63 && e[e.length - 1] <= round + 1 - 32) break;
  }
  return k.slice(0, 32);
}

// Algorithmen 8 und 9: /U + /UE bzw. /O + /OE (beim Eigentümer fließt /U als udata ein)
async function passwordEntries(pw, fileKey, udata) {
  const vs = rand(8), ks = rand(8);
  const h = await hash2B(pw, vs, udata);
  const ek = await hash2B(pw, ks, udata);
  return { check: cat(h, vs, ks), wrapped: await cbcRaw(ek, new Uint8Array(16), fileKey) };
}

// Erzeugt Schlüssel und Verschlüsselungs-Wörterbuch. Ergebnis:
//   dict: Inhalt des /Encrypt-Objekts, id: Hex für /ID, stream(bytes): verschlüsselt einen Stream (Promise<Uint8Array>)
export async function pdfEncryptor(password, perms = PDF_PERMS) {
  const fileKey = rand(32);
  const user = await passwordEntries(prepPassword(password), fileKey, new Uint8Array(0));
  const owner = await passwordEntries(prepPassword(hex(rand(24))), fileKey, user.check);
  // Algorithmus 10: /Perms = AES-256-ECB(fileKey) über P (little endian), 0xFF×4, 'T' (Metadaten verschlüsselt), 'adb', Zufall
  const p = cat(new Uint8Array(4), new Uint8Array([255, 255, 255, 255, 84, 97, 100, 98]), rand(4));
  new DataView(p.buffer).setInt32(0, perms, true);
  const permsEnc = await cbcRaw(fileKey, new Uint8Array(16), p);
  const dict = `<< /Filter /Standard /V 5 /R 6 /Length 256 /CF << /StdCF << /CFM /AESV3 /AuthEvent /DocOpen /Length 32 >> >> /StmF /StdCF /StrF /StdCF `
    + `/O <${hex(owner.check)}> /U <${hex(user.check)}> /OE <${hex(owner.wrapped)}> /UE <${hex(user.wrapped)}> /P ${perms} /Perms <${hex(permsEnc)}> >>`;
  // Streams: AES-256-CBC mit dem Dateischlüssel direkt (ab R6 kein Schlüssel pro Objekt), zufällige IV vorangestellt, PKCS#7
  const stream = async (bytes) => { const iv = rand(16); return cat(iv, await cbc(fileKey, iv, bytes)); };
  return { dict, id: hex(rand(16)), stream };
}
