// Retur mot kvittering: aldri mer enn kjøpt, aldri flere ganger enn kjøpt antall, kryss-sjekket over tid og summert per kasserer.
const assert = require('assert');
const L = require('../src/logic.js');

let seq = 0;
const bong = (o) => Object.assign({ transactionId: 'R-' + (++seq), endDateTime: '2026-10-05 12:00', storeNumber: 1005, workstationNumber: 1, cashierNumber: 'A', totalAmount: 10, receiptType: 1, memberNumber: null }, o || {});
const scan = (lines, o) => Object.assign({ v: 7, items: lines.map((l) => Object.assign({ n: 'VARE' }, l)), pay: {}, np: lines.length, neg: 0, sale: 0, ret: 0, saleLines: 0, retLines: 0, disc: 0, discN: 0, discNR: 0, coupons: [] }, o || {});
const CT = (o) => Object.assign(L.defaultControl(), { retKvIdent: '' }, o || {});
const mapOf = (pairs) => pairs.reduce((m, [it, s]) => (m[it.transactionId] = s, m), {});
const X = '7038010000010', Y = '7038010000027', Z = '7038010000034';
const ref = 'T:DK7TVRW5F2PC5';

// kjøp av 2 × X (20 kr hver) og 1 × Y (25 kr) hos kasserer A
const buy = [bong({ cashierNumber: 'A', totalAmount: 65, endDateTime: '2026-10-05 10:00' }), scan([{ c: X, n: 'MELK', a: 40, q: 2, p: 20 }, { c: Y, n: 'BRØD', a: 25 }], { rf: [ref] })];
const ret = (cash, time, lines, o) => [bong(Object.assign({ cashierNumber: cash, endDateTime: '2026-10-06 ' + time, totalAmount: lines.reduce((a, l) => a + l.a, 0) }, o || {})), scan(lines, { rf: [ref] })];

// ---- netLines
{
  const n = L.netLines(scan([{ c: X, a: 40, q: 2 }, { c: X, a: -20 }, { c: '399', n: 'PANTELAPP', a: -20 }, { c: Y, a: 25 }, { c: Y, a: -25 }, { c: Z, a: 0 }]));
  assert.deepStrictEqual(Object.keys(n), [X], 'motlinjer går i null, pant og 0 kr utelates');
  assert.deepStrictEqual([n[X].q, n[X].a], [1, 20]);
}

// ---- kvittering: aldri mer enn kjøpt, aldri flere ganger enn kjøpt antall
{
  const r1 = ret('B', '09:00', [{ c: X, a: -20 }]);                         // 1 av 2: ok
  const r2 = ret('B', '09:10', [{ c: X, a: -20 }]);                         // 2 av 2: ok
  const r3 = ret('C', '09:20', [{ c: X, a: -20 }]);                         // 3 av 2, annen kasserer: flere ganger
  const r4 = ret('B', '09:30', [{ c: Z, a: -15 }]);                         // varen står ikke på kvitteringen
  const r5 = ret('B', '09:40', [{ c: Y, a: -31 }]);                         // høyere pris enn betalt (25 kr)
  const r6 = ret('B', '09:50', [{ c: Y, a: -25 }]);                         // Y ble returnert til høyere pris i r5, så Y er nå brukt opp
  const all = [buy, r1, r2, r3, r4, r5, r6];
  const its = all.map((x) => x[0]), map = mapOf(all);
  const r = L.returnLedger(its, its, map, CT());
  const f = (id) => r.findings.filter((x) => x.ids[0] === id.transactionId).map((x) => x.title);
  assert.deepStrictEqual([f(r1[0]), f(r2[0])], [[], []], 'retur opptil kjøpt antall er greit, også delt på flere bonger');
  assert.deepStrictEqual(f(r3[0]), ['Vare returnert flere ganger']);
  assert.deepStrictEqual(f(r4[0]), ['Vare ikke på kvitteringen']);
  assert.deepStrictEqual(f(r5[0]), ['Retur til høyere pris enn kjøpt']);
  assert.deepStrictEqual(f(r6[0]), ['Vare returnert flere ganger']);
  assert.strictEqual(r.findings.filter((x) => x.flag).length, 4);
  assert.deepStrictEqual([r.families, r.returns, r.linked, r.unlinked, r.bad], [1, 6, 6, 0, 4]);
  const d3 = r.findings.filter((x) => x.ids[0] === r3[0].transactionId)[0].detail;
  assert.match(d3, /«VARE» \(7038010000010\): retur 1 stk, 20\.00 kr; kjøpt 2 stk, 40\.00 kr, allerede returnert 2 stk, 40\.00 kr/);
  assert.match(d3, /kvittering R-\d+ \(2026-10-05 10:00, kasserer A\)/, 'viser kvitteringen det returneres mot');
  // tolerance: 0,40 kr over er greit, 0,60 er ikke
  const t1 = ret('B', '10:00', [{ c: Y, a: -25.4 }]), t2 = ret('B', '10:00', [{ c: Y, a: -25.6 }]);
  assert.strictEqual(L.returnLedger([t1[0]], [buy[0], t1[0]], mapOf([buy, t1]), CT()).findings.length, 0);
  assert.strictEqual(L.returnLedger([t2[0]], [buy[0], t2[0]], mapOf([buy, t2]), CT()).findings.length, 1);
  // retur av tre når to er kjøpt, i én bong
  const big = ret('B', '11:00', [{ c: X, a: -60, q: 3 }]);
  const rb = L.returnLedger([big[0]], [buy[0], big[0]], mapOf([buy, big]), CT());
  assert.deepStrictEqual(rb.findings.map((x) => x.title), ['Retur over kjøpt antall']);
  assert.match(rb.findings[0].detail, /retur 3 stk, 60\.00 kr; kjøpt 2 stk, 40\.00 kr, allerede returnert 0 stk/);
  // retur utenfor omfanget flagges ikke, men teller i kvitteringen
  const part = L.returnLedger([r3[0]], its, map, CT());
  assert.deepStrictEqual(part.findings.map((x) => x.title), ['Vare returnert flere ganger']);
  // av
  assert.deepStrictEqual(L.returnLedger(its, its, map, CT({ retKv: '' })).findings, []);
  // kjøp uten skannet innhold gir ikke noe å sammenligne med
  assert.deepStrictEqual(L.returnLedger([r3[0]], [buy[0], r3[0]], mapOf([r3]), CT()).findings, []);
}

// ---- uten referanse: ikke knyttet, ingen funn fra kvitteringen
{
  const b = [bong({ endDateTime: '2026-10-05 10:00', totalAmount: 20 }), scan([{ c: X, a: 20 }], { rf: ['T:AAAA1111'] })];
  const r = [bong({ endDateTime: '2026-10-06 10:00', totalAmount: -20 }), scan([{ c: X, a: -20 }], { rf: ['T:BBBB2222'] })];
  const out = L.returnLedger([r[0]], [b[0], r[0]], mapOf([b, r]), CT());
  assert.deepStrictEqual([out.findings.length, out.returns, out.linked, out.unlinked, out.families], [0, 1, 0, 1, 0]);
}

// ---- kryss-sjekk over tid: kort og medlem
{
  const card = [{ s: 'visa', f: '457123', n: '1234' }];
  const old = [bong({ endDateTime: '2026-08-01 10:00', totalAmount: 5, storeNumber: 1005 }), scan([{ c: Z, a: 5 }])];      // gammel bong som viser at tidsrommet er lastet
  const p1 = [bong({ endDateTime: '2026-09-25 10:00', totalAmount: 20, memberNumber: 'M1' }), scan([{ c: X, a: 20 }], { cd: card })];
  const r1 = [bong({ endDateTime: '2026-10-01 10:00', totalAmount: -20, cashierNumber: 'B' }), scan([{ c: X, a: -20 }], { cd: card })];
  const r2 = [bong({ endDateTime: '2026-10-03 10:00', totalAmount: -20, cashierNumber: 'B' }), scan([{ c: X, a: -20 }], { cd: card })];
  const m1 = [bong({ endDateTime: '2026-10-04 10:00', totalAmount: -20, cashierNumber: 'B', memberNumber: 'M1' }), scan([{ c: X, a: -20 }])];
  const all = [old, p1, r1, r2, m1], its = all.map((x) => x[0]), map = mapOf(all);
  const out = L.returnLedger(its, its, map, CT({ retKvIdent: '30' }));
  const t = (b) => out.findings.filter((x) => x.ids[0] === b[0].transactionId).map((x) => x.title);
  assert.deepStrictEqual([t(r1), t(r2), t(m1)], [[], ['Retur over kjøpt antall på kortet'], []], 'andre retur på kortet er over kjøpt; medlemmet har ikke selv returnert ennå på samme nøkkel');
  assert.match(out.findings[0].detail, /kortet har kjøpt 1 stk og allerede returnert 1 stk siste 30 dager/);
  assert.strictEqual(out.identChecked, 3);
  // medlem
  const m2 = [bong({ endDateTime: '2026-10-05 09:00', totalAmount: -20, cashierNumber: 'B', memberNumber: 'M1' }), scan([{ c: X, a: -20 }])];
  const out2 = L.returnLedger([m1[0], m2[0]], [old[0], p1[0], m1[0], m2[0]], mapOf([old, p1, m1, m2]), CT({ retKvIdent: '30' }));
  assert.deepStrictEqual(out2.findings.map((x) => x.title), ['Retur over kjøpt antall for medlemmet']);
  // for kort tid lastet: ikke vurdert
  const short = L.returnLedger([r2[0]], [p1[0], r1[0], r2[0]], mapOf([p1, r1, r2]), CT({ retKvIdent: '30' }));
  assert.deepStrictEqual([short.findings.length, short.short], [0, 1]);
  // aldri kjøpt av kortet: dekkes av «Retur av vare uten kjøp», ikke her
  const never = [bong({ endDateTime: '2026-10-05 10:00', totalAmount: -20 }), scan([{ c: Y, a: -20 }], { cd: card })];
  assert.strictEqual(L.returnLedger([never[0]], [old[0], p1[0], never[0]], mapOf([old, p1, never]), CT({ retKvIdent: '30' })).findings.length, 0);
  // for lite skannet
  const un = bong({ endDateTime: '2026-10-02 10:00', totalAmount: 5 });
  assert.strictEqual(L.returnLedger([r2[0]], [old[0], p1[0], r1[0], r2[0], un, bong(), bong()], mapOf([old, p1, r1, r2]), CT({ retKvIdent: '30' })).applicable, false);
}

// ---- per kasserer over tid
{
  const mk = (cash, i, ok) => ret(cash, '1' + (i % 10) + ':00', [{ c: X, a: -20 }, ...(ok ? [] : [{ c: Z, a: -9 }])], { endDateTime: '2026-10-0' + (6 + (i % 3)) + ' 10:' + String(10 + i) });
  const rets = [].concat([0, 1, 2, 3].map((i) => mk('C', i, false)), [4, 5].map((i) => mk('C', i, true)), [6, 7, 8, 9, 10].map((i) => mk('D', i, true)));
  const b2 = [bong({ cashierNumber: 'A', totalAmount: 400, endDateTime: '2026-10-05 09:00' }), scan([{ c: X, a: 400, q: 20 }], { rf: [ref] })];
  const all = [b2].concat(rets), its = all.map((x) => x[0]), map = mapOf(all);
  const out = L.returnLedger(its, its, map, CT());
  const c = out.rows.find((r) => r.id === 'C'), d = out.rows.find((r) => r.id === 'D');
  assert.deepStrictEqual([c.returns, c.linked, c.bad, c.flag, c.dayN], [6, 6, 4, true, 3]);
  assert.deepStrictEqual([d.returns, d.bad, d.flag], [5, 0, false]);
  const cf = out.findings.filter((x) => x.code === 'retKvCash');
  assert.deepStrictEqual(cf.map((x) => [x.cashier, x.flag]), [['C', false]]);
  assert.match(cf[0].detail, /Kasserer C: 4 av 6 returbonger \(67 %\)/);
  assert.strictEqual(L.returnLedger(its, its, map, CT({ retKvCashN: '' })).findings.filter((x) => x.code === 'retKvCash').length, 0, 'tom verdi = av');
  // kasserer-ID er lokal per butikk
  L.setMultiStore(true);
  try { assert.deepStrictEqual(L.returnLedger(its, its, map, CT()).rows.map((r) => r.id), ['C@1005', 'D@1005']); } finally { L.setMultiStore(false); }
}

// ---- betalingsreferanse-kontrollen er fjernet: kjøp og retur med samme referanse følges bare her
{
  assert.ok(!('ledger' in L) && !('refDup' in L.defaultControl()) && !('Samme betalingsreferanse på flere bonger' in L.RISK_WEIGHTS));
}

// ---- poeng og familie: bare høyeste teller per bong
{
  const W = L.RISK_WEIGHTS;
  assert.strictEqual(L.riskScore(['Vare returnert flere ganger', 'Retur over kjøpt antall på kortet', 'Retur av vare uten kjøp på kortet'], W), 5);
  assert.ok(['Vare returnert flere ganger', 'Retur over kjøpt antall', 'Retur til høyere pris enn kjøpt', 'Vare ikke på kvitteringen', 'Retur over kjøpt antall på kortet', 'Retur over kjøpt antall for medlemmet', 'Mange returer mot kvittering med avvik'].every((k) => k in W));
  assert.strictEqual(L.groupForReason('Vare returnert flere ganger'), 'retkv');
}

console.log('retkv: ok');
