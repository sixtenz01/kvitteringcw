// Enhetstester for 3.23.0: pant gir bare reaksjon på manuell pantelapp (99) og slettet pantelapp fra maskinen (399),
// makulert linje flagges alltid, og hendelsesord leses også i betalingslinjer og topp/bunn.
const assert = require('assert');
const L = require('../src/logic.js');

let seq = 0;
const bong = (o) => Object.assign({ transactionId: 'P-' + (++seq), endDateTime: '2026-10-05 12:00', storeNumber: 1005, workstationNumber: 1, cashierNumber: 'A', totalAmount: 10, receiptType: 1, memberNumber: null }, o);
const R = (rows) => L.parseReceipt(rows);
const mapOf = (pairs) => pairs.reduce((m, [it, s]) => (m[it.transactionId] = s, m), {});

// ---- standard: pant-testene som ikke er 99 eller 399 slettet er av
{
  const a = L.defaultAnom(), c = L.defaultControl();
  assert.deepStrictEqual([a.bigReturn, a.manyLapper, a.cashNoSale], ['', '', false]);
  assert.deepStrictEqual([c.cashNoSaleN, c.lappReuseMin, c.voidCashOn, c.lappDel, c.lappDelCodes, c.lappManualMin, c.voidLineOn], ['', '', '', '1', '399', '50', '1']);
  // panteretur med kontant tilbake: ingen reaksjon
  const p = R([['399 PANTELAPP', '', '-150.00'], ['399 PANTELAPP', '', '-350.00'], ['Kontant tilbake:', '', '500.00']]);
  assert.ok(L.pantOnly(p));
  assert.deepStrictEqual(L.anomalies(bong({ totalAmount: -500 }), p, a), [], 'ren panteretur på −500 er ikke rundt beløp');
  // samme beløp med varer: rundt beløp
  const g = R([['7000000000001 VARE', '', '500.00'], ['Bank:', '', '500.00']]);
  assert.deepStrictEqual(L.anomalies(bong({ totalAmount: 500 }), g, a), ['Rundt beløp']);
  assert.ok(!L.pantOnly(g) && L.goodsReturn(bong({ totalAmount: -20 }), R([['7000000000001 VARE', '', '-20.00']])) && !L.goodsReturn(bong({ totalAmount: -20 }), p));
  assert.ok(L.goodsReturn(bong({ totalAmount: -20 }), null), 'uten skanning regnes negativ sum som retur');
}

// ---- pantelapper: 99 manuell flagges, 399 bare når den er slettet
{
  const c = L.defaultControl();
  const man = bong(), mach = bong(), delMach = bong(), delMan = bong(), reuse1 = bong({ endDateTime: '2026-10-05 13:00' }), reuse2 = bong({ endDateTime: '2026-10-05 13:10' });
  const map = mapOf([
    [man, R([['99 PANTELAPP', '', '-60.00'], ['Kontant tilbake:', '', '60.00']])],
    [mach, R([['399 PANTELAPP', '', '-80.00'], ['Kontant tilbake:', '', '80.00']])],
    [delMach, R([['7000000000001 VARE', '', '30.00'], ['399 PANTELAPP', '', '-25.00'], ['399 PANTELAPP', '', '25.00'], ['Bank:', '', '30.00']])],
    [delMan, R([['7000000000001 VARE', '', '30.00'], ['99 PANTELAPP', '', '-25.00'], ['99 PANTELAPP', '', '25.00'], ['Bank:', '', '30.00']])],
    [reuse1, R([['399 PANTELAPP', '', '-45.00'], ['Kontant tilbake:', '', '45.00']])],
    [reuse2, R([['399 PANTELAPP', '', '-45.00'], ['Kontant tilbake:', '', '45.00']])]
  ]);
  const items = [man, mach, delMach, delMan, reuse1, reuse2];
  const r = L.lappChecks(items, items, map, c);
  const by = (code) => r.findings.filter((f) => f.code === code).map((f) => f.ids[0]);
  assert.deepStrictEqual(by('lappManual'), [man.transactionId]);
  assert.deepStrictEqual(by('lappDeleted'), [delMach.transactionId], 'bare 399 slettet');
  assert.deepStrictEqual(by('lappReuse'), [], 'gjenbruk er av');
  assert.deepStrictEqual(r.findings.map((f) => f.title).sort(), ['Manuell pantelapp', 'Pantelapp slettet']);
  // tom kodeliste: alle slettede pantelapper
  assert.deepStrictEqual(L.lappChecks(items, items, map, Object.assign(L.defaultControl(), { lappDelCodes: '' })).findings.filter((f) => f.code === 'lappDeleted').length, 2);
  // mønstre og avvik per bong reagerer ikke på pantebongene
  const pat = L.patterns(items.map((it) => Object.assign({}, it, { endDateTime: '2026-10-05 21:50', totalAmount: -45 })), map, Object.assign(L.defaultControl(), { repeatN: '2', repeatMin: '20' }));
  assert.deepStrictEqual(pat.filter((p) => /Små returer|Samme beløp|Kontant tilbake/.test(p.title)).flatMap((p) => p.ids.filter((id) => [man, mach, reuse1, reuse2].some((b) => b.transactionId === id))), [], 'rene pantebonger er ikke med');
  items.forEach((it) => assert.deepStrictEqual(L.anomalies(it, map[it.transactionId], L.defaultAnom()), []));
}

// ---- makulert linje: også når beløpet samtidig er rundt
{
  const c = L.defaultControl();
  const both = bong({ totalAmount: 500 });
  const sc = R([['7000000000001 VARE', '', '500.00'], ['7000000000002 BRUS', '', '100.00'], ['7000000000002 BRUS', '', '-100.00'], ['Bank:', '', '500.00']]);
  assert.deepStrictEqual(L.anomalies(both, sc, L.defaultAnom()), ['Rundt beløp']);
  const v = L.voidChecks([both], [both], mapOf([[both, sc]]), c);
  assert.deepStrictEqual(v.findings.map((f) => [f.title, f.ids[0]]), [['Makulert linje på bong', both.transactionId], ['Makulert vare ikke solgt på ny', both.transactionId]]);
  assert.match(v.findings[0].detail, /1 varelinje makulert \(100\.00 kr\): BRUS/);
  // hele bongen makulert
  const allv = bong({ totalAmount: 0 });
  const sa = R([['7000000000001 VARE', '', '500.00'], ['7000000000001 VARE', '', '-500.00']]);
  assert.match(L.voidChecks([allv], [allv], mapOf([[allv, sa]]), c).findings[0].detail, /Alle varelinjene på bongen er makulert/);
  assert.strictEqual(L.voidChecks([both], [both], mapOf([[both, sc]]), Object.assign(L.defaultControl(), { voidLineOn: '' })).findings.filter((f) => f.code === 'voidLine').length, 0);
  // samme forhold: gjensalgstesten og makulert linje teller bare én gang
  const bd = L.scoreBreakdown(['Makulert vare ikke solgt på ny', 'Makulert linje på bong']);
  assert.deepStrictEqual(bd.map((x) => x.counts), [true, false]);
}

// ---- hendelsesord i betalingsetikett og utenfor tabellen
{
  const lab = R([['7000000000001 VARE', '', '500.00'], ['Makulert:', '', '500.00']]);
  assert.deepStrictEqual((lab.ev || []).map((e) => e.k), ['makul']);
  const rows = [['7000000000001 VARE', '', '500.00']];
  rows.tl = ['*** MAKULERT KVITTERING ***', 'Butikk: 1005, Kassenr: 1, Kasserer: A'];
  rows.bl = ['Annullert av kasserer 12'];
  const out = R(rows);
  assert.deepStrictEqual(out.ev.map((e) => e.k), ['makul', 'annull']);
  assert.ok(!(out.bu || []).some((t) => /MAKULERT|Annullert/i.test(t)), 'hendelseslinjer listes ikke som ukjente');
  const it = bong({ totalAmount: 500 });
  const ev = L.eventWords([it], mapOf([[it, out]]), L.defaultControl());
  assert.deepStrictEqual(ev.findings.map((f) => f.title), ['Hendelsesord på bong']);
}

console.log('pant: ok');
