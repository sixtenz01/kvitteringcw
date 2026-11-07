const assert = require('assert');
const L = require('../src/logic.js');

// Nettverk: kort og medlemsnummer på samme bong knyttes til grupper; mange nummer på ett kort og retur til kort i kassererens
// eller en ansatts nettverk flagges.
const pop = [], scan = {};
let n = 0;
const add = (o, sc) => {
  const id = 'R-' + String(++n).padStart(3, '0'), tot = o.totalAmount === undefined ? 100 : o.totalAmount;
  pop.push(Object.assign({ transactionId: id, endDateTime: '2026-10-0' + (1 + (n % 5)) + ' 12:' + String(n % 60).padStart(2, '0'), storeNumber: 1005, workstationNumber: 1, cashierNumber: 'A', totalAmount: tot, receiptType: 1, memberNumber: null }, o));
  scan[id] = Object.assign({ v: 9, items: [{ c: '7038010000010', n: 'VARE', a: tot }], pay: { Bank: tot }, tot: tot, coupons: [] }, sc);
  return id;
};
const visa = [{ s: 'visa', f: '', n: '1111' }];
['M1', 'M2', 'M3', 'M4', 'M5'].forEach((m) => { add({ memberNumber: m, cashierNumber: 'K' }, { cd: visa }); add({ memberNumber: m, cashierNumber: 'K' }, { cd: visa }); });
const ret = add({ cashierNumber: 'K', totalAmount: -200 }, { cd: visa });
for (let i = 0; i < 6; i++) add({ memberNumber: 'Q1', cashierNumber: ['A', 'B', 'C'][i % 3] }, { cd: [{ s: 'mastercard', f: '5555', n: '2222' }] });
add({ memberNumber: 'Q1', cashierNumber: 'A' }, { cd: [{ s: 'visa', f: '4925', n: '7777' }] });   // samme kunde, to kort (utstedernr: knyttes med én bong)
// ulike kunder med like siste fire siffer, én bong hver: knyttes ikke
add({ memberNumber: 'Z1' }, { cd: [{ s: 'visa', f: '', n: '3333' }] }); add({ memberNumber: 'Z2' }, { cd: [{ s: 'visa', f: '', n: '3333' }] }); add({ memberNumber: 'Z3' }, { cd: [{ s: 'visa', f: '', n: '3333' }] });

const cfg = Object.assign(L.defaultControl(), { empMembers: 'K=M3' });
assert.deepStrictEqual([cfg.netMembers, cfg.netSelfN, cfg.netEmpOn], ['4', '3', '1']);
const r = L.netChecks(pop, pop, scan, cfg);
const g = r.groups[0];
assert.deepStrictEqual([g.members, g.cards, g.n, g.top, g.topShare, g.refunds, g.refundSum, g.emp], [['M1', 'M2', 'M3', 'M4', 'M5'], ['VISA …1111'], 11, 'K', 1, 1, 200, ['M3']]);
const q = r.groups.find((x) => x.members.includes('Q1'));
assert.deepStrictEqual([q.members, q.cards.sort(), q.n, q.flags], [['Q1'], ['MASTERCARD 5555…2222', 'VISA 4925…7777'], 7, []]);
assert.ok(!r.groups.some((x) => x.members.includes('Z1')), 'like siste fire siffer på én bong hver knyttes ikke');
assert.strictEqual(r.weak, 3);
const by = (c) => r.findings.filter((f) => f.code === c);
assert.match(by('netGroup')[0].detail, /^5 medlemsnr \(M1, M2, M3, M4 …\) og 1 kort \(VISA …1111\) henger sammen på 11 bonger; kasserer K \(10\)\.$/);
assert.strictEqual(by('netGroup')[0].ids.length, 11);
assert.deepStrictEqual(by('netEmp').map((f) => [f.ids[0], f.cashier]), [[ret, 'K']]);
assert.match(by('netEmp')[0].detail, /200\.00 kr tilbake til VISA …1111, som er brukt med ansattnummer M3 \(kasserer K\)\./);
assert.match(by('netSelf')[0].detail, /står på 10 kjøp, 10 \(100 %\) hos kasserer K, som også ga returen\./);
// av
assert.strictEqual(L.netChecks(pop, pop, scan, Object.assign({}, cfg, { netMembers: '', netSelfN: '', netEmpOn: '' })).findings.length, 0);
assert.strictEqual(L.netChecks(pop, pop, scan, Object.assign({}, cfg, { empMembers: '' })).findings.filter((f) => f.code === 'netEmp').length, 0, 'uten ansattliste');
// bare bonger i omfanget flagges
assert.deepStrictEqual(L.netChecks([pop[0]], pop, scan, cfg).findings.map((f) => f.code), ['netGroup']);
// eldre skanning uten kortdata er ikke med
assert.strictEqual(L.netChecks(pop, pop, Object.fromEntries(Object.entries(scan).map(([k, v]) => [k, Object.assign({}, v, { v: 5 })])), cfg).scanned, 0);
// samme data i annen rekkefølge gir samme grupper
assert.deepStrictEqual(L.netChecks(pop.slice().reverse(), pop.slice().reverse(), scan, cfg).groups.map((x) => x.members), r.groups.map((x) => x.members));
assert.deepStrictEqual([L.RISK_WEIGHTS['Kort brukt med mange medlemsnr'], L.RISK_WEIGHTS['Retur til kort i kassererens nettverk'], L.RISK_WEIGHTS['Retur til kort knyttet til ansatt']], [2, 3, 4]);
console.log('net: ok');
