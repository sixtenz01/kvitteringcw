const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const L = require('../src/logic.js');
const R = require('../src/report.js');

// ---- SHA-256 mot node:crypto
const nodeHash = (x) => crypto.createHash('sha256').update(x).digest('hex');
for (const s of ['', 'abc', 'æøå € 日本語', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(65), 'Kvittering\n'.repeat(500)]) assert.strictEqual(R.sha256(s), nodeHash(s), 'sha256 ' + s.length);
const rnd = crypto.randomBytes(1000003);
assert.strictEqual(R.sha256(new Uint8Array(rnd)), nodeHash(rnd));
assert.strictEqual(R.sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
assert.strictEqual(R.stable({ b: 1, a: [2, { d: 1, c: undefined }] }), '{"a":[2,{"c":null,"d":1}],"b":1}');
assert.strictEqual(R.fmtNum(-1234567.5), '−1 234 567,50');
assert.strictEqual(R.fmtNum(0), '0,00');

// ---- versjon i manifest og rapport er samme
assert.strictEqual(JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8')).version, R.VERSION);

// ---- modell
const mk = (id, day, time, kasse, who, sum, type, extra) => Object.assign({ transactionId: id, bongnr: id.replace(/^x-/, '1005-1-'), endDateTime: day + ' ' + time, storeNumber: 1005, workstationNumber: kasse, cashierNumber: who, totalAmount: sum, receiptType: type || 1, memberNumber: null }, extra || {});
const items = [
  mk('x-100', '2026-10-01', '10:00', 1, 'A', 100),
  mk('x-101', '2026-10-01', '10:20', 1, 'A', -100),
  mk('x-102', '2026-10-01', '22:15', 1, 'B', 40, 1, { memberNumber: 'M99' }),
  mk('x-103', '2026-10-01', '23:00', 1, 'A', null, 2)
];
const extra = mk('x-090', '2026-09-30', '23:00', 1, 'C', 12);
const scan = {
  'x-100': L.parseReceipt([['7000111 VARE X', '', '100.00'], ['Rabatt: Kr 10.00 (9.1%)'], ['Rabatt årsak: 2'], ['Bank:', '', '100.00']]),
  'x-101': L.parseReceipt([['7000111 VARE X', '', '-100.00'], ['Kontant tilbake:', '', '100.00']]),
  'x-103': L.parseSettlement([['Sum', '240.00'], ['Differanse'], ['Sum', '-40.00']])
};
scan['x-100'].t = 111; scan['x-101'].t = 222;
const cfg = L.defaultControl(), anom = L.defaultAnom(), W = L.sanitizeWeights(null);
cfg.saleReturnMin = '45'; W['Stor panteretur'] = 7;
const finding = { kind: 'Falsk retur', title: 'Salg og retur av samme beløp', detail: 'Kasse 1: salg 10:00 og retur 10:20, begge 100 kr', ids: ['x-101', 'x-100'], flag: true };
const cashierFinding = { kind: 'Tallanalyse', title: 'Mange runde beløp', detail: 'Kasserer A: 100 % hele kroner', ids: [], flag: false, cashier: 'A' };
const model = () => ({
  version: R.VERSION, generatedAt: '2026-10-02T12:00:00.000Z', generatedLocal: '02.10.2026 14:00', analysedLocal: '02.10.2026 13:55', analysedAt: '2026-10-02T11:55:00.000Z', reference: 'SAK-2026-14 <b>', author: 'Test Testesen',
  scope: { text: '2026-10-01 → 2026-10-01 · 1005 – Coop Mega Kolbotn', mode: 'scope', filters: [], coverageText: '', compare: null },
  items, pop: items.concat([extra]), scan, storeLabels: { 1005: '1005 – Coop Mega Kolbotn' },
  settings: { ctl: cfg, anom, weights: W, currentDiffers: false },
  checks: { falseRet: { coverage: 0.5, lineCheck: false }, numbers: { overall: { n: 3, enough: false } } },
  findings: [finding, cashierFinding],
  ranked: [{ id: 'x-101', reasons: ['Salg og retur av samme beløp', 'Kortkjøp refundert kontant'], score: 9 }, { id: 'x-100', reasons: ['Rabatt med overvåket årsak'], score: 3 }],
  explain: { 'x-101': ['Kasse 1: salg og retur <img src=x onerror=alert(1)> av samme beløp.'] },
  notes: { 'x-101': { status: 'oppfolging', note: 'Sjekk med <script>alert(1)</script> butikksjef' } },
  cashiers: [{ id: 'A', score: 12, flagged: 2, profile: ['høy returandel'] }],
  compare: null, failedScans: 1,
  evidence: { files: [{ id: 'x-101', path: 'bevis/01_1005-1-101.png', hash: 'a'.repeat(64) }], byId: { 'x-101': { path: 'bevis/01_1005-1-101.png' } }, missing: ['x-100'], requested: 1, cappedFrom: 2 },
  settingsJson: JSON.stringify({ app: 'kvitteringshenter', v: 1, ctl: cfg, anom, weights: W })
});
const out = R.build(model());
const byPath = {};
out.files.forEach(f => { byPath[f.path] = f.text; });
assert.deepStrictEqual(Object.keys(byPath).sort(), ['KONTROLLSUM.txt', 'data/flaggede_bonger.csv', 'data/funn.csv', 'data/innhold.json', 'data/kvitteringer.csv', 'innstillinger.json', 'rapport.html']);

// kontrollsum: hver linje stemmer med innholdet, og dataset-hash er hash av CSV-filen
const sums = byPath['KONTROLLSUM.txt'].trim().split('\n');
assert.strictEqual(sums.length, 7, '6 tekstfiler og 1 bevisbilde');
sums.forEach(l => {
  const m = /^([0-9a-f]{64})  (.+)$/.exec(l);
  assert.ok(m, l);
  if (byPath[m[2]] !== undefined) assert.strictEqual(m[1], nodeHash(byPath[m[2]]), m[2]);
});
assert.ok(sums.some(l => l === 'a'.repeat(64) + '  bevis/01_1005-1-101.png'));
assert.ok(!sums.some(l => /KONTROLLSUM/.test(l)), 'kontrollsumfilen står ikke i seg selv');
assert.deepStrictEqual(sums.map(l => l.slice(66)), sums.map(l => l.slice(66)).slice().sort());
assert.strictEqual(out.hashes.receipts, nodeHash(byPath['data/kvitteringer.csv']));
assert.strictEqual(out.hashes.content, nodeHash(byPath['data/innhold.json']));

// datafiler
const csv = byPath['data/kvitteringer.csv'];
assert.ok(csv.startsWith('﻿Bong-ID;'));
assert.strictEqual(csv.trim().split('\r\n').length, 1 + 5, 'pop + items uten duplikater');
assert.ok(/x-090;1005-1-090;2026-09-30 23:00;1005;1;C;Salg;12;nei;nei/.test(csv), 'utenfor omfang');
assert.ok(/x-102;1005-1-102;2026-10-01 22:15;1005;1;B;Salg;40;ja;ja/.test(csv), 'medlemsnummer er ikke med, bare ja/nei');
assert.ok(!/M99/.test(csv + byPath['data/innhold.json'] + byPath['rapport.html']));
const content = JSON.parse(byPath['data/innhold.json']);
assert.deepStrictEqual(Object.keys(content), ['x-100', 'x-101', 'x-103']);
assert.ok(!('t' in content['x-100']), 'skannetidspunkt er ikke med (ikke deterministisk)');
assert.strictEqual(content['x-100'].items[0].dr, '2');
assert.strictEqual(R.build(Object.assign(model(), { scan: Object.assign({}, scan, { 'x-100': Object.assign({}, scan['x-100'], { t: 999 }) }) })).hashes.content, out.hashes.content, 'samme innhold gir samme kontrollsum');
const shuffled = R.build(Object.assign(model(), { items: items.slice().reverse(), pop: items.concat([extra]).reverse() }));
assert.strictEqual(shuffled.hashes.receipts, out.hashes.receipts, 'rekkefølge påvirker ikke kontrollsummen');
assert.notStrictEqual(R.build(Object.assign(model(), { items: items.slice(0, 3) })).hashes.receipts, out.hashes.receipts, 'endret omfang endrer kontrollsummen');
assert.ok(byPath['data/funn.csv'].includes('Falsk retur;Salg og retur av samme beløp;Kasse 1: salg 10:00 og retur 10:20, begge 100 kr;"1005-1-101; 1005-1-100";;ja'));
assert.match(byPath['data/funn.csv'], /Tallanalyse;Mange runde beløp;.*;;A;nei/);
assert.match(byPath['data/flaggede_bonger.csv'], /1;Høy;9;54;1005-1-101;2026-10-01 10:20;1005;1;A;-100;"Salg og retur av samme beløp; Kortkjøp refundert kontant";oppfolging;Sjekk med <script>alert\(1\)<\/script> butikksjef;bevis\/01_1005-1-101.png/);
assert.strictEqual(JSON.parse(byPath['innstillinger.json']).app, 'kvitteringshenter');

// rapporten: alle deler, riktige tall, escaping
const html = byPath['rapport.html'];
for (const t of ['Revisjonsrapport – Kvitteringsjournal', '1. Sammendrag', '2. Omfang og datagrunnlag', '3. Dekningsgrad og begrensninger', '4. Metode: tester, terskler og poeng', '5. Funn', '6. Flaggede kvitteringer (rangert)', '7. Bevis (bong-PNG)', '8. Kontrollsummer og verifisering', '9. Forbehold'])
  assert.ok(html.includes(t), t);
assert.ok(html.includes('SAK-2026-14 &lt;b&gt;'), 'referanse er escapet');
assert.ok(!html.includes('<script>alert') && !html.includes('<img src=x'), 'ingen uescapet innhold');
assert.ok(html.includes('Test Testesen') && html.includes('02.10.2026 14:00 (lokal tid) · 2026-10-02T12:00:00.000Z') && html.includes('1005 – Coop Mega Kolbotn · 2026-10-01 → 2026-10-01') && html.includes('Kvitteringshenter ' + R.VERSION));
assert.ok(html.includes('2026-10-01 → 2026-10-01 · 1005 – Coop Mega Kolbotn'));
assert.ok(html.includes('4 kvitteringer i omfanget') && html.includes('2 funn, 2 flaggede kvitteringer (1 høy risiko, 0 middels, 1 lav)'));
assert.ok(html.includes('Skannet innhold: 2 av 3 salg (67 %)'));
assert.ok(html.includes('«Retur uten salg» ble ikke vurdert: bare 50 % av salgene'));
assert.ok(html.includes('Benford: bare 3 bonger') && html.includes('1 kvitteringer kunne ikke skannes'));
assert.ok(html.includes('begrenset til de 1 høyest rangerte av 2') && html.includes('Bevis-PNG mangler for 1 bonger'));
assert.ok(html.includes('<div class="chg">Salg og retur av samme beløp innen: <b>45 min</b></div>'), 'endret terskel er markert');
assert.ok(html.includes('<div class="chg">Stor panteretur: <b>7</b></div>'), 'endret poeng er markert');
assert.ok(html.includes('<div>Stenger (bonger etter dette flagges): <b>23:00</b></div>'), 'klokkeslett uten enhet');
assert.ok(html.includes('<div>Rundt beløp fra: <b>500 kr</b></div>') && html.split('<b><span class="off">av</span></b>').length === 5, 'ansattlisten, hendelsesord, overvåkede varer og retur uten kort/medlem samme dag er av i standardoppsettet');
assert.ok(html.includes('Kasse 1: salg 10:00 og retur 10:20, begge 100 kr'));
assert.ok(html.includes('(kassererfunn, gir poeng på kassereren)'));
assert.ok(html.includes('href="bevis/01_1005-1-101.png"') && html.includes('a'.repeat(64)));
assert.ok(html.includes(out.hashes.receipts) && html.includes(out.hashes.content) && html.includes(out.hashes.settings));
assert.ok(html.includes('sha256sum -c KONTROLLSUM.txt'));
assert.ok(html.includes('Til oppfølging: Sjekk med &lt;script&gt;'));

// dekning og begrensninger
const cov = R.coverageOf(model());
assert.deepStrictEqual([cov.sales, cov.salesScanned, cov.salesDisc, cov.settle, cov.settleScanned], [3, 2, 2, 1, 1]);
const lim = R.limitations(Object.assign(model(), { checks: { falseRet: { coverage: 0.95, lineCheck: true }, numbers: { overall: { n: 500, enough: true } } }, failedScans: 0, evidence: { files: [], byId: {}, missing: [], requested: 5, cappedFrom: 5 }, scope: { text: '', mode: 'scope', filters: [], coverageText: 'fra 2026-09-01' }, settings: { ctl: cfg, anom, weights: W, currentDiffers: true } }), cov);
assert.ok(!lim.some(t => /ikke vurdert|Benford|kunne ikke skannes|begrenset til|mangler for/.test(t)));
assert.ok(lim.some(t => /utenfor det som er hentet fra CW \(fra 2026-09-01\)/.test(t)) && lim.some(t => /endret etter analysen/.test(t)));

// tomt resultat gir fortsatt en gyldig rapport
const empty = R.build(Object.assign(model(), { findings: [], ranked: [], cashiers: [], notes: {}, explain: {}, evidence: { files: [], byId: {}, missing: [], requested: 0, cappedFrom: 0 } }));
const eh = empty.files.find(f => f.path === 'rapport.html').text;
assert.ok(eh.includes('Ingen funn med gjeldende terskler.') && eh.includes('Ingen flaggede kvitteringer.') && eh.includes('Ingen bevis-PNG er tatt med.'));

// notatlogg: hash-kjede, manipulasjon og med i pakken
{
  const log = { base: '', list: [] };
  R.logAppend(log, { t: 1, id: 'a', bong: '1-1-1', op: 'ny', s: 'oppfolging', n: 'sjekk' });
  R.logAppend(log, { t: 2, id: 'a', bong: '1-1-1', op: 'endret', s: 'sjekket', n: 'ok', ps: 'oppfolging', pn: 'sjekk' });
  R.logAppend(log, { t: 3, id: 'a', bong: '1-1-1', op: 'slettet', ps: 'sjekket', pn: 'ok' });
  assert.deepStrictEqual(R.logVerify(log), { ok: true, n: 3, head: log.list[2].h });
  assert.ok(/^[0-9a-f]{64}$/.test(log.list[0].h) && log.list[0].h !== log.list[1].h);
  const tampered = JSON.parse(JSON.stringify(log));
  tampered.list[1].n = 'endret etterpå';
  assert.deepStrictEqual(R.logVerify(tampered).ok, false);
  assert.strictEqual(R.logVerify(tampered).at, 1);
  const removed = JSON.parse(JSON.stringify(log)); removed.list.splice(1, 1);
  assert.deepStrictEqual([R.logVerify(removed).ok, R.logVerify(removed).at], [false, 1], 'fjernet hendelse bryter kjeden');
  const swapped = JSON.parse(JSON.stringify(log)); swapped.list.reverse();
  assert.strictEqual(R.logVerify(swapped).ok, false, 'omrokkert rekkefølge bryter kjeden');
  const trimmed = JSON.parse(JSON.stringify(log)); R.logTrim(trimmed, 2);
  assert.deepStrictEqual([trimmed.list.length, trimmed.base === log.list[0].h, R.logVerify(trimmed).ok], [2, true, true], 'trimming beholder verifiserbar kjede');
  assert.deepStrictEqual(R.logVerify({ base: '', list: [] }), { ok: true, n: 0, head: '' });
  const withLog = R.build(Object.assign(model(), { notelog: log }));
  const lf = withLog.files.find(f => f.path === 'data/notatlogg.json');
  assert.ok(lf && JSON.parse(lf.text).list.length === 3, 'loggen følger med pakken');
  assert.ok(withLog.files.find(f => f.path === 'KONTROLLSUM.txt').text.includes(withLog.hashes.notelog + '  data/notatlogg.json'));
  const lhtml = withLog.files.find(f => f.path === 'rapport.html').text;
  assert.ok(lhtml.includes('data/notatlogg.json (alle endringer av notater og status, hash-kjede: 3 hendelser, kjeden er ubrutt, hodekontrollsum ' + log.list[2].h.slice(0, 16)));
  const badHtml = R.build(Object.assign(model(), { notelog: tampered })).files.find(f => f.path === 'rapport.html').text;
  assert.ok(badHtml.includes('KJEDEN ER BRUTT ved hendelse 2'));
  assert.ok(!out.files.some(f => f.path === 'data/notatlogg.json'), 'uten logg ingen fil');
}

console.log('report: ok');

// ---- PDF av JPEG-bilder: gyldig struktur, sidefordeling og størrelse fra JPEG-en
{
  const J = (b64) => new Uint8Array(Buffer.from(b64, 'base64'));
  const A = J('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'), B = J('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');
  assert.deepStrictEqual([R.jpegSize(A), R.jpegSize(B)], [{ w: 90, h: 300 }, { w: 90, h: 150 }]);
  assert.throws(() => R.jpegSize(new Uint8Array([1, 2, 3, 4])), /ikke JPEG/);
  const imgs = [A, B, A, B].map((jpeg) => ({ jpeg, scale: 0.2 }));
  const one = R.pdf(imgs, { multi: false, title: 'Test (æøå)' }), many = R.pdf(imgs, { multi: true });
  const txt = (o) => Buffer.from(o.bytes).toString('latin1');
  assert.deepStrictEqual([one.pages, many.pages], [4, 2], 'én per side, og to ved siden av hverandre');
  assert.ok(txt(one).startsWith('%PDF-1.4') && /startxref\n\d+\n%%EOF\n$/.test(txt(one)));
  assert.strictEqual((txt(one).match(/\/DCTDecode/g) || []).length, 4);
  assert.ok(txt(one).includes('/Title (Test )') , 'bare ASCII i tittelen');
  // xref peker på objektene
  const t1 = txt(one), xo = Number(/startxref\n(\d+)/.exec(t1)[1]);
  assert.strictEqual(t1.slice(xo, xo + 4), 'xref');
  const offs = t1.slice(xo).split('\n').filter((l) => /^\d{10} 00000 n $/.test(l)).map((l) => Number(l.slice(0, 10)));
  offs.forEach((o, i) => assert.ok(t1.slice(o).startsWith((i + 1) + ' 0 obj'), 'objekt ' + (i + 1)));
  assert.strictEqual(R.pdf([], {}).pages, 0);
}
