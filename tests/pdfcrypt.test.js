// Tests für den Passwortschutz des PDF-Berichts (pdfcrypt.js, Pdf.buildAsync in report.js)
// Die Entschlüsselung hier ist bewusst unabhängig mit node:crypto umgesetzt (Algorithmus 2.A/2.B aus ISO 32000-2).
// Aufruf: npm test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nc = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const src = (f) => fs.readFileSync(path.join(ROOT, 'public/js', f), 'utf8');
const dataUrl = (code) => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');

// report.js ohne seine Abhängigkeiten laden: nur die Pdf-Klasse wird gebraucht
async function loadPdf() {
  let code = src('report.js').replace(/^import .*$/gm, '').replaceAll("'./pdfcrypt.js'", JSON.stringify(dataUrl(src('pdfcrypt.js'))));
  code = "const appName = () => 'GutKeeper', S = { config: {} }; const t = (s, o = {}) => s.replace(/\\{(\\w+)\\}/g, (_, k) => o[k]);\n" + code;
  return (await import(dataUrl(code))).Pdf;
}
function sample(Pdf) {
  const p = new Pdf();
  p.text(40, 50, 'Stuhlprotokoll – Test (äöü ß) \\ „x“', 22, { bold: true });
  p.rect(40, 100, 200, 50, '0.9 0.5 0.5');
  p.line(40, 200, 500, 200);
  p.page();
  p.text(40, 50, 'Seite zwei …');
  return p;
}
const bytes = async (blob) => Buffer.from(await blob.arrayBuffer());

// ---- unabhängige Gegenseite: Algorithmus 2.B und 2.A ----
function hash2B(pw, salt, udata = Buffer.alloc(0)) {
  let k = nc.createHash('sha256').update(Buffer.concat([pw, salt, udata])).digest();
  for (let round = 1; ; round++) {
    const k1 = Buffer.concat(Array(64).fill(Buffer.concat([pw, k, udata])));
    const c = nc.createCipheriv('aes-128-cbc', k.subarray(0, 16), k.subarray(16, 32)).setAutoPadding(false);
    const e = Buffer.concat([c.update(k1), c.final()]);
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += e[i];
    k = nc.createHash(['sha256', 'sha384', 'sha512'][sum % 3]).update(e).digest();
    if (round >= 64 && e[e.length - 1] <= round - 32) break;
  }
  return k.subarray(0, 32);
}
const hexOf = (pdf, key) => Buffer.from(pdf.match(new RegExp(`/${key} <([0-9a-f]+)>`))[1], 'hex');
// Algorithmus 2.A für das Benutzerpasswort: /U prüfen, Dateischlüssel aus /UE, /Perms kontrollieren
function userKey(pdf, password) {
  const pw = Buffer.from(password.normalize('NFC'), 'utf8').subarray(0, 127);
  const U = hexOf(pdf, 'U'), UE = hexOf(pdf, 'UE');
  assert.equal(U.length, 48); assert.equal(UE.length, 32);
  if (!hash2B(pw, U.subarray(32, 40)).equals(U.subarray(0, 32))) return null;
  const d = nc.createDecipheriv('aes-256-cbc', hash2B(pw, U.subarray(40, 48)), Buffer.alloc(16)).setAutoPadding(false);
  const key = Buffer.concat([d.update(UE), d.final()]);
  const pd = nc.createDecipheriv('aes-256-ecb', key, null).setAutoPadding(false);
  const perms = Buffer.concat([pd.update(hexOf(pdf, 'Perms')), pd.final()]);
  assert.equal(perms.subarray(9, 12).toString('latin1'), 'adb');
  assert.equal(perms.readInt32LE(0), Number(pdf.match(/\/P (-?\d+)/)[1]));
  return key;
}
function streams(buf) {
  const s = buf.toString('latin1'), out = [];
  const re = /<< \/Length (\d+) >>\nstream\n/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length, len = Number(m[1]);
    assert.equal(s.slice(start + len, start + len + 10), '\nendstream', 'Länge stimmt');
    out.push(buf.subarray(start, start + len));
  }
  return out;
}
function decryptStream(key, data) {
  const d = nc.createDecipheriv('aes-256-cbc', key, data.subarray(0, 16));
  return Buffer.concat([d.update(data.subarray(16)), d.final()]);
}

test('PDF ohne Passwort: buildAsync liefert dasselbe wie build, unverschlüsselt', async () => {
  const Pdf = await loadPdf();
  const a = await bytes(sample(Pdf).build('Max'));
  const b = await bytes(await sample(Pdf).buildAsync('Max'));
  assert.ok(a.equals(b));
  assert.ok(a.toString('latin1').startsWith('%PDF-1.4\n'));
  assert.ok(!a.toString('latin1').includes('/Encrypt'));
});

test('PDF mit Passwort: AES-256 (R6), Inhalt lässt sich mit dem Passwort entschlüsseln', async () => {
  const Pdf = await loadPdf();
  const plain = streams(await bytes(sample(Pdf).build('Max')));
  const buf = await bytes(await sample(Pdf).buildAsync('Max', { password: 'Grüße 123' }));
  const pdf = buf.toString('latin1');
  for (const k of ['/Filter /Standard', '/V 5', '/R 6', '/CFM /AESV3', '/StmF /StdCF', '/StrF /StdCF']) assert.ok(pdf.includes(k), k);
  assert.match(pdf, /trailer\n<< \/Size 10 \/Root 1 0 R \/Encrypt 9 0 R \/ID \[<([0-9a-f]{32})> <\1>\] >>/);
  assert.equal(hexOf(pdf, 'O').length, 48); assert.equal(hexOf(pdf, 'OE').length, 32);
  // Klartext darf nicht mehr sichtbar sein
  assert.ok(!pdf.includes('Stuhlprotokoll') && !pdf.includes(' Tj ET'));
  // xref-Offsets zeigen auf die Objekte
  const xref = Number(pdf.match(/startxref\n(\d+)/)[1]);
  const rows = pdf.slice(xref).split('\n').slice(3, 12);
  rows.forEach((r, i) => assert.equal(pdf.slice(Number(r.slice(0, 10)), Number(r.slice(0, 10)) + 8), `${i + 1} 0 obj\n`.slice(0, 8)));

  const key = userKey(pdf, 'Grüße 123');
  assert.ok(key, 'Passwort wird akzeptiert');
  const enc = streams(buf);
  assert.equal(enc.length, 2);
  enc.forEach((c, i) => assert.ok(decryptStream(key, c).equals(plain[i]), `Seite ${i + 1}`));
  // NFD-Eingabe ergibt dasselbe Passwort (NFC-Normalisierung)
  assert.ok(userKey(pdf, 'Grüße 123'));
});

test('PDF mit Passwort: falsches Passwort wird abgelehnt', async () => {
  const Pdf = await loadPdf();
  const pdf = (await bytes(await sample(Pdf).buildAsync('', { password: 'richtig' }))).toString('latin1');
  assert.equal(userKey(pdf, 'falsch'), null);
  assert.equal(userKey(pdf, ''), null);
});

test('pdfcrypt: hash2B stimmt mit der unabhängigen Umsetzung überein', async () => {
  const { hash2B: h, prepPassword } = await import(dataUrl(src('pdfcrypt.js')));
  const pw = prepPassword('x'.repeat(200)), salt = Buffer.from('0123456789abcdef', 'hex'), ud = nc.randomBytes(48);
  assert.equal(pw.length, 127);
  assert.ok(Buffer.from(await h(pw, salt, ud)).equals(hash2B(Buffer.from(pw), salt, ud)));
  assert.ok(Buffer.from(await h(pw, salt)).equals(hash2B(Buffer.from(pw), salt)));
});
