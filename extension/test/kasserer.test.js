// S17: kasserer-ID og kassenummer er lokale per butikk. Med flere butikker i datagrunnlaget skal to personer med samme nummer ikke slås sammen.
const assert = require('assert');
const L = require('../src/logic.js');

let seq = 0;
const bong = (o) => Object.assign({ transactionId: 'K-' + (++seq), endDateTime: '2026-10-05 12:00', storeNumber: 1005, workstationNumber: 1, cashierNumber: '12', totalAmount: 100, receiptType: 1, memberNumber: null }, o);
const many = (n, o) => Array.from({ length: n }, (_, i) => bong(typeof o === 'function' ? o(i) : o));
const CT = () => L.defaultControl();

// butikk 1005: kasserer 12 har 40 % retur, kasserer 13 ingen. Butikk 2002: kasserer 12 har ingen retur, kasserer 14 ingen.
const data = [].concat(
  many(20, (i) => ({ cashierNumber: '12', totalAmount: i < 8 ? -50 : 100 })),
  many(20, () => ({ cashierNumber: '13' })),
  many(20, () => ({ storeNumber: 2002, cashierNumber: '12' })),
  many(20, () => ({ storeNumber: 2002, cashierNumber: '14' }))
);

try {
  // ---- hjelpefunksjoner
  L.setMultiStore(true);
  assert.strictEqual(L.cashierId(data[0]), '12@1005');
  assert.strictEqual(L.wsId(data[0]), '1@1005');
  assert.strictEqual(L.idLabel('12@1005'), '12 (1005)');
  assert.strictEqual(L.idLabel('12'), '12');
  assert.strictEqual(L.idPart('12@1005', 0), '12');
  assert.strictEqual(L.idPart('12@1005', 1), '1005');
  assert.strictEqual(L.cashierLabel(data[0]), '12 (1005)');
  // treff: vanlig nummer treffer alle butikker, sammensatt id bare én
  assert.strictEqual(L.isCashier(data[0], '12'), true);
  assert.strictEqual(L.isCashier(data[0], '12@1005'), true);
  assert.strictEqual(L.isCashier(data[0], '12@2002'), false);
  assert.strictEqual(L.isWs(data[0], '1@2002'), false);
  const F = (f) => data.filter((it) => L.matches(it, Object.assign(L.defaultFilters(), f), {})).length;
  assert.strictEqual(F({ cashiers: ['12'] }), 40);
  assert.strictEqual(F({ cashiers: ['12@1005'] }), 20);
  assert.strictEqual(F({ cashiers: ['12@2002'], workstations: ['1@2002'] }), 20);
  assert.strictEqual(F({ cashiers: ['12@2002'], workstations: ['1@1005'] }), 0);

  // ---- profil: to personer, hver mot sitt butikksnitt
  let p = L.profiles(data, {}, CT());
  assert.deepStrictEqual(p.rows.map((r) => r.id), ['12@1005', '12@2002', '13@1005', '14@2002']);
  const byId = (id) => p.rows.filter((r) => r.id === id)[0];
  assert.strictEqual(byId('12@1005').count, 20);
  assert.strictEqual(byId('12@1005').retShare, 0.4);
  assert.strictEqual(byId('12@1005').flags.retShare, true, 'kasserer 12 i 1005 mot snittet i 1005');
  assert.strictEqual(byId('12@2002').retShare, 0);
  assert.strictEqual(byId('12@2002').flags.retShare, false);
  assert.strictEqual(byId('12@2002').store, 2002);
  assert.strictEqual(p.byStore[1005].retShare, 0.2);
  assert.strictEqual(p.byStore[2002].retShare, 0);
  // uten flere butikker er id vanlig nummer, som før
  L.setMultiStore(false);
  p = L.profiles(data.filter((it) => it.storeNumber === 1005), {}, CT());
  assert.deepStrictEqual(p.rows.map((r) => r.id), ['12', '13']);
  assert.strictEqual(p.rows[0].flags.retShare, true);
  assert.strictEqual(p.byStore[1005].retShare, 0.2);
  assert.strictEqual(L.cashierId(data[0]), '12');

  // ---- kontant tilbake uten salg: tre i hver butikk er ikke seks på én kasse
  const cn = (store) => bong({ storeNumber: store, workstationNumber: 1, cashierNumber: '12' });
  const cnItems = [cn(1005), cn(1005), cn(1005), cn(2002), cn(2002), cn(2002)];
  const cnScan = {};
  cnItems.forEach((it) => { cnScan[it.transactionId] = { v: 5, items: [{ c: '399', n: 'PANTELAPP', a: -50 }], pay: { 'Kontant tilbake': 50 }, np: 0, neg: 0, sale: 0, ret: -50, saleLines: 0, retLines: 1, coupons: [] }; });
  const cnCfg = Object.assign(CT(), { cashNoSaleN: '4' });
  L.setMultiStore(true);
  assert.strictEqual(L.patterns(cnItems, cnScan, cnCfg).filter((f) => f.code === 'cashNoSale').length, 0);
  L.setMultiStore(false);
  assert.strictEqual(L.patterns(cnItems, cnScan, cnCfg).filter((f) => f.code === 'cashNoSale').length, 1, 'uten skille per butikk slås de sammen (gammel oppførsel)');
  L.setMultiStore(true);
  const f3 = L.patterns(cnItems, cnScan, Object.assign(CT(), { cashNoSaleN: '3' })).filter((f) => f.code === 'cashNoSale');
  assert.strictEqual(f3.length, 2);
  assert.match(f3[0].detail, /Kasse 1 \(1005\): 3 ganger, totalt 150 kr/);
  assert.match(f3[1].detail, /Kasse 1 \(2002\): 3 ganger, totalt 150 kr/);

  // ---- avstemming: samme kassenummer i to butikker er to kasser
  const settle = (store, kontant) => ({ transactionId: 'S-' + store, endDateTime: '2026-10-05 22:00', storeNumber: store, workstationNumber: 1, cashierNumber: '12', totalAmount: null, receiptType: 2 });
  const sA = bong({ transactionId: 'RA', cashierNumber: '12' }), sB = bong({ transactionId: 'RB', storeNumber: 2002, cashierNumber: '12' });
  const scanOf = { RA: { v: 5, items: [], pay: { Kontant: 100 }, np: 0, neg: 0, sale: 0, ret: 0, saleLines: 0, retLines: 0, coupons: [] }, RB: { v: 5, items: [], pay: { Kontant: 100 }, np: 0, neg: 0, sale: 0, ret: 0, saleLines: 0, retLines: 0, coupons: [] },
    'S-1005': { settle: { telt: { kontant: 100 }, diff: { sum: 0 } } }, 'S-2002': { settle: { telt: { kontant: 90 }, diff: { sum: -10 } } } };
  const rc = L.reconcile([sA, sB, settle(1005), settle(2002)], scanOf, CT());
  assert.deepStrictEqual(rc.map((r) => [r.kasse, r.ws, r.expected, r.telt, r.diff]), [['1 (1005)', '1@1005', 100, 100, 0], ['1 (2002)', '1@2002', 100, 90, -10]]);
  assert.deepStrictEqual(rc.map((r) => r.flag), [false, true]);
  L.setMultiStore(false);
  assert.strictEqual(L.reconcile([sA, settle(1005)], scanOf, CT())[0].kasse, 1, 'én butikk: kassenummer som før');
  L.setMultiStore(true);

  // ---- kassererrangering og tempo bruker sammensatt id
  const rank = L.rankCashiers([sA, sB], { RA: ['Rundt beløp'], RB: ['Rundt beløp'] }, null, null, null);
  assert.deepStrictEqual(rank.map((c) => c.id), ['12@1005', '12@2002']);
  const tmp = [].concat(many(4, (i) => ({ cashierNumber: '12', endDateTime: '2026-10-05 12:00:0' + i })), many(4, (i) => ({ storeNumber: 2002, cashierNumber: '12', endDateTime: '2026-10-05 12:00:0' + i })));
  const tr = L.tempoChecks(tmp, CT());
  assert.deepStrictEqual(tr.rows.map((r) => [r.id, r.series, r.inSeries]), [['12@1005', 1, 4], ['12@2002', 1, 4]]);

  // ---- ansattliste: «12=M1» gjelder alle butikker, «12@1005=M1» bare 1005
  const mem = (store) => bong({ storeNumber: store, cashierNumber: '12', memberNumber: 'M1' });
  const pop = [mem(1005), mem(2002)];
  const emp = (list) => L.memberChecks(pop, pop, Object.assign(CT(), { empMembers: list })).findings.filter((f) => f.code === 'empOwn');
  assert.strictEqual(emp('12=M1')[0].ids.length, 2);
  assert.strictEqual(emp('12@1005=M1')[0].ids.length, 1);
  assert.match(emp('12@1005=M1')[0].detail, /Kasserer 12 \(1005\) har tastet sitt eget medlemsnr M1 på 1 bonger/);
  assert.strictEqual(emp('12@3003=M1').length, 0);

  // ---- baseline for «medlemsnr nesten bare hos én kasserer» er kassererens andel i egen butikk
  const mb = [].concat(many(5, { cashierNumber: '12', memberNumber: 'M9' }), many(45, { cashierNumber: '13' }), many(50, { storeNumber: 2002, cashierNumber: '14' }));
  const mc = L.memberChecks(mb, mb, Object.assign(CT(), { memberCashN: '5', memberCashShare: '80' }));
  const hit = mc.findings.filter((f) => f.code === 'memberCash');
  assert.strictEqual(hit.length, 1);
  assert.match(hit[0].detail, /hos kasserer 12 \(1005\), som ellers har 10 % av bongene/, 'andel av egen butikk (5 av 50), ikke av begge butikker (5 av 100)');
} finally {
  L.setMultiStore(false);
}
console.log('kasserer: ok');
