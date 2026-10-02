const assert = require('assert');
const L = require('../src/logic.js');

const rows = [
  { transactionId: 'a-1', endDateTime: '2026-10-02 00:22', storeNumber: 1005, workstationNumber: 6, cashierNumber: '10', totalAmount: -556, receiptType: 1, memberNumber: null },
  { transactionId: 'a-2', endDateTime: '2026-10-02 00:04', storeNumber: 1005, workstationNumber: 1, cashierNumber: '11', totalAmount: null, receiptType: 2, memberNumber: null },
  { transactionId: 'a-3', endDateTime: '2026-10-02 00:04', storeNumber: 1005, workstationNumber: 6, cashierNumber: '10', totalAmount: -0.7, receiptType: 1, memberNumber: null },
  { transactionId: 'a-4', endDateTime: '2026-10-01 23:30', storeNumber: 1005, workstationNumber: 4, cashierNumber: '12', totalAmount: 296.8, receiptType: 1, memberNumber: 'M12345' },
  { transactionId: 'a-5', endDateTime: '2026-10-01 23:30', storeNumber: 1005, workstationNumber: 4, cashierNumber: '12', totalAmount: 296.8, receiptType: 1, memberNumber: null }
];
const ids = (f, ctx) => rows.filter(r => L.matches(r, f, ctx)).map(r => r.transactionId);
const F = (o) => Object.assign(L.defaultFilters(), o);

assert.deepStrictEqual(ids(F({})), ['a-1', 'a-2', 'a-3', 'a-4', 'a-5']);
assert.deepStrictEqual(ids(F({ types: ['1'] })), ['a-1', 'a-3', 'a-4', 'a-5']);
assert.deepStrictEqual(ids(F({ workstations: ['6'] })), ['a-1', 'a-3']);
assert.deepStrictEqual(ids(F({ cashiers: ['12'] })), ['a-4', 'a-5']);
assert.deepStrictEqual(ids(F({ onlyNegative: true })), ['a-1', 'a-3']);
assert.deepStrictEqual(ids(F({ sumMin: '100' })), ['a-4', 'a-5']);
assert.deepStrictEqual(ids(F({ sumMax: '0' })), ['a-1', 'a-3']);
assert.deepStrictEqual(ids(F({ member: 'm123' })), ['a-4']);
assert.deepStrictEqual(ids(F({ onlyMember: true })), ['a-4']);
assert.deepStrictEqual(ids(F({ dateFrom: '2026-10-02', dateTo: '2026-10-02' })), ['a-1', 'a-2', 'a-3']);
assert.deepStrictEqual(ids(F({ timeFrom: '00:00', timeTo: '05:59' })), ['a-1', 'a-2', 'a-3']);
assert.deepStrictEqual(ids(F({ timeFrom: '23:00', timeTo: '00:10' })), ['a-2', 'a-3', 'a-4', 'a-5']);

const dup = L.findDuplicates(rows);
assert.deepStrictEqual(Object.keys(dup.ids).sort(), ['a-4', 'a-5']);
assert.strictEqual(dup.groups.length, 1);
assert.deepStrictEqual(ids(F({ onlyDup: true }), { dupIds: dup.ids }), ['a-4', 'a-5']);

const sorted = rows.slice().sort((a, b) => L.compare(a, b, 'sumDesc')).map(r => r.transactionId);
assert.deepStrictEqual(sorted, ['a-4', 'a-5', 'a-3', 'a-1', 'a-2']);
const asc = rows.slice().sort((a, b) => L.compare(a, b, 'sumAsc')).map(r => r.transactionId);
assert.deepStrictEqual(asc, ['a-1', 'a-3', 'a-4', 'a-5', 'a-2']);

assert.deepStrictEqual(L.sumSelected([rows[0], rows[2]]), { count: 2, sum: -556.7 });
assert.deepStrictEqual(L.quickRange('today', new Date(2026, 9, 2, 12)), { dateFrom: '2026-10-02', dateTo: '2026-10-02', timeFrom: '', timeTo: '' });
assert.strictEqual(L.quickRange('yesterday', new Date(2026, 9, 2, 12)).dateFrom, '2026-10-01');
assert.deepStrictEqual(L.sanitizeFilters({ stores: [1], bogus: 1, sort: 'sumAsc' }).stores, ['1']);
assert.strictEqual(L.activeCount(F({ types: ['1'], onlyNegative: true, sort: 'sumAsc' })), 2);
assert.strictEqual(L.typeLabel(11), 'PDA-operasjon (uavklart)');
assert.strictEqual(L.typeLabel(99), 'Type 99');
const r47 = [['Beskrivelse', '', 'Beløp'], ['RETUR VARE'], ['399 PANTELAPP', '', '-150.00'], ['RETUR VARE'], ['399 PANTELAPP', '', '-109.00'], ['RETUR VARE'], ['399 PANTELAPP', '', '-125.00'], ['RETUR VARE'], ['399 PANTELAPP', '', '-172.00'], ['', 'Totalt', '-556.00'], ['Kontant tilbake:', '', '556.00']];
const sub = (o, k) => k.reduce((a, x) => (a[x] = o[x], a), {});
assert.deepStrictEqual(sub(L.parseReceipt(r47), ['sale', 'ret', 'saleLines', 'retLines']), { sale: 0, ret: -556, saleLines: 0, retLines: 4 });
const r97 = [['7025110196576 COOP FROKOSTEGG 6PK', '', '31.90'], ['399 PANTELAPP', '', '-61.00'], ['399 PANTELAPP', '', '-33.00'], ['399 PANTELAPP', '', '-4.00'], ['7038010002274 BIOLA JORDBÆR 1000G (SLETT', '', '39.90']];
assert.deepStrictEqual(sub(L.parseReceipt(r97), ['sale', 'ret', 'saleLines', 'retLines']), { sale: 0, ret: -98, saleLines: 0, retLines: 3 });
const rSale = [['7044610877488 PEPSI MAX LEMON 0.5L', '', '32.90'], ['220 PANT', '', '2.00'], ['7044610877999 KARTOFFEL PANT 1KG', '', '10.00'], ['81.52', '25 %', '20.38', '101.90', '']];
assert.deepStrictEqual(sub(L.parseReceipt(rSale), ['sale', 'ret', 'saleLines', 'retLines']), { sale: 2, ret: 0, saleLines: 1, retLines: 0 });
assert.deepStrictEqual(sub(L.parseReceipt([]), ['sale', 'ret']), { sale: 0, ret: 0 });
assert.strictEqual(L.parseAmount('1\u00a0000.00'), 1000);
assert.strictEqual(L.parseAmount('-0,70'), -0.7);
const pm = { 'a-1': { sale: 0, ret: -556, items: [] }, 'a-4': { sale: 2, ret: 0, items: [] }, 'a-3': { sale: 0, ret: 0, items: [] } };
assert.deepStrictEqual(ids(F({ pant: 'any' }), { scan: pm }), ['a-1', 'a-4']);
assert.deepStrictEqual(ids(F({ pant: 'sale' }), { scan: pm }), ['a-4']);
assert.deepStrictEqual(ids(F({ pant: 'return' }), { scan: pm }), ['a-1']);
assert.deepStrictEqual(ids(F({ pant: 'any' })), []);
assert.deepStrictEqual(L.sumPant(rows, pm), { sale: 2, ret: -556, net: -554, scanned: 3, total: 5 });

// ---- varelinjer, grupper, avvik, butikknavn, CSV
const full = L.parseReceipt([
  ['Beskrivelse', '', 'Beløp'],
  ['7330196001042 SKRUF NO4 FRESH S4', '', '101.90'],
  ['7044610877488 PEPSI MAX LEMON 0.5L', '', '32.90'],
  ['220 PANT', '', '2.00'],
  ['1024 FROKOSTBRØD FIN', '', '95.40'],
  ['Antall: 6.000 stk à Kr 15.90'],
  ['7038010002274 BIOLA JORDBÆR 1000G (SLETT', '', '39.90'],
  ['7044416015367 REGAL HVETEMEL 1KG', '', '20.50'],
  ['Øreavrunding', '-0.30'],
  ['Totalt', '293.35'],
  ['Bank:', '', '293.35'],
  ['Kontant tilbake:', '', '5.00'],
  ['Referanse: 59778'],
  ['81.52', '25 %', '20.38', '101.90', '']
]);
assert.strictEqual(full.items.length, 6);
assert.strictEqual(full.items[3].q, 6);
assert.deepStrictEqual(full.pay, { 'Bank': 293.35, 'Kontant tilbake': 5 });
assert.strictEqual(full.np, 5);
const R = L.defaultRules();
const g = (name, code) => L.classify({ c: code || '7000000000000', n: name }, R);
assert.strictEqual(g('SKRUF NO4 FRESH S4'), 'Tobakk');
assert.strictEqual(g('PRINCE WHITE 28PK'), 'Tobakk');
assert.strictEqual(g('PEPSI MAX LEMON 0.5L'), 'Brus');
assert.strictEqual(g('BANAN KG'), 'Frukt');
assert.strictEqual(g('BIOLA JORDBÆR 1000G (SLETT'), 'Meieri');
assert.strictEqual(g('JORDBÆR 250G'), 'Frukt');
assert.strictEqual(g('BLÅBÆRKNUTE VANILJE'), 'Bakeri');
assert.strictEqual(g('FROKOSTBRØD FIN'), 'Bakeri');
assert.strictEqual(g('AGURK STK'), 'Grønt');
assert.strictEqual(g('POTETCHIPS SALT'), 'Snacks og godteri');
assert.strictEqual(g('PANT', '220'), 'Pant');
assert.strictEqual(g('PANTELAPP', '399'), 'Pant');
assert.strictEqual(g('REGAL HVETEMEL 1KG'), null);
assert.strictEqual(L.classify({ c: '7044999', n: 'X' }, [{ name: 'Pre', include: ['#7044*'], exclude: [] }]), 'Pre');
assert.deepStrictEqual(L.groupsOfScan(full, R).sort(), ['Bakeri', 'Brus', 'Meieri', 'Pant', 'Tobakk', 'Uten gruppe']);
const sc = { s1: full };
const gs = L.groupSums(['s1', 'missing'], sc, R);
assert.strictEqual(gs.find(x => x.group === 'Tobakk').sum, 101.9);
assert.strictEqual(L.unmatched(sc, R)[0].name, 'REGAL HVETEMEL 1KG');
assert.strictEqual(L.sanitizeRules('x').length, R.length);

const cfg = L.defaultAnom();
assert.deepStrictEqual(L.anomalies({ totalAmount: 1000 }, null, cfg), ['Rundt beløp']);
assert.deepStrictEqual(L.anomalies({ totalAmount: 1000.5 }, null, cfg), []);
assert.deepStrictEqual(L.anomalies({ totalAmount: 300 }, null, cfg), []);
const pr = L.parseReceipt([['399 PANTELAPP', '', '-150.00'], ['399 PANTELAPP', '', '-250.00'], ['Kontant tilbake:', '', '400.00']]);
assert.deepStrictEqual(L.anomalies({ totalAmount: -400 }, pr, cfg), ['Stor panteretur (400 kr)', 'Kontant tilbake uten salg']);
const lapper = L.parseReceipt(Array.from({ length: 9 }, () => ['399 PANTELAPP', '', '-5.00']));
assert.deepStrictEqual(L.anomalies({ totalAmount: -45 }, lapper, cfg), ['Mange pantelapper (9)']);
assert.deepStrictEqual(L.anomalies({ totalAmount: 1000 }, null, Object.assign({}, cfg, { roundMin: '' })), []);

assert.strictEqual(L.storeLabel(1005, { 1005: 'Coop Mega Kolbotn' }), '1005 – Coop Mega Kolbotn');
assert.strictEqual(L.storeLabel(1005, { 1005: '1005 - Coop Mega Kolbotn' }), '1005 - Coop Mega Kolbotn');
assert.strictEqual(L.storeLabel(2000, {}), '2000');
assert.deepStrictEqual(L.parseStoreText('1005=Coop Mega Kolbotn\nrusk\n1010 - Extra X'), { 1005: 'Coop Mega Kolbotn', 1010: 'Extra X' });
assert.strictEqual(L.toCsv([['a;b', 'c"d'], [1, null]]), '\ufeff"a;b";"c""d"\r\n1;');
assert.deepStrictEqual(ids(F({ bong: '1005-6' })), []);
assert.deepStrictEqual(L.matches({ bongnr: '1005-6-12', transactionId: 'x' }, F({ bong: '6-12' })), true);

// ---- kassaoppgjør
const settle = L.parseSettlement([
  ['Kontant:', '1 000.00'], ['Sjekk:', '0.00'], ['Kreditt:', '0.00'], ['Tilgodelapp:', '0.00'], ['Sum', '1 000.00'],
  ['Pose: 512324789405'], ['Sendt bank:'], ['NOK', '1 000.00'], ['Differanse'],
  ['Kontant:', '+1 000.00'], ['Sjekk:', '0.00'], ['Kreditt:', '0.00'], ['Tilgodelapp:', '0.00'], ['Sum', '+1 000.00'],
  ['Tilgodelapp'], ['egne:', '0.00'], ['fremmede:', '0.00'], ['utlevert:', '0.00'], ['Sum:', '0.00'],
  ['Valør', 'Beløp'], ['1', '0.00'], ['500', '0.00'], ['1000', '1 000.00']
]).settle;
assert.deepStrictEqual(settle.telt, { kontant: 1000, sjekk: 0, kreditt: 0, tilgodelapp: 0, sum: 1000 });
assert.deepStrictEqual(settle.diff, { kontant: 1000, sjekk: 0, kreditt: 0, tilgodelapp: 0, sum: 1000 });
assert.strictEqual(settle.pose, '512324789405');
assert.strictEqual(settle.bank, 1000);
assert.strictEqual(settle.valor['1000'], 1000);
assert.strictEqual(settle.tilg.sum, 0);
assert.strictEqual(L.parseAmount('+1 000.00'), 1000);
const stRec = L.parseSettlement([['Kontant:', '500.00'], ['Sum', '500.00'], ['Differanse'], ['Sum', '-50.00']]);
assert.deepStrictEqual(L.anomalies({ totalAmount: null }, stRec, cfg), ['Kassadifferanse (-50 kr)']);
assert.deepStrictEqual(L.anomalies({ totalAmount: null }, stRec, Object.assign({}, cfg, { settleDiff: '100' })), []);

// ---- dagsrapport
const repItems = [
  { transactionId: 'r1', endDateTime: '2026-10-02 10:00', workstationNumber: 1, cashierNumber: 'A', totalAmount: 100, receiptType: 1 },
  { transactionId: 'r2', endDateTime: '2026-10-02 11:00', workstationNumber: 1, cashierNumber: 'B', totalAmount: -50, receiptType: 1 },
  { transactionId: 'r3', endDateTime: '2026-10-03 11:00', workstationNumber: 2, cashierNumber: 'A', totalAmount: 25.5, receiptType: 1 },
  { transactionId: 'r4', endDateTime: '2026-10-03 23:00', workstationNumber: 2, cashierNumber: 'A', totalAmount: null, receiptType: 2 },
  { transactionId: 'r5', endDateTime: '2026-10-03 12:00', workstationNumber: 2, cashierNumber: 'A', totalAmount: 5, receiptType: 11 }
];
const repScan = { r2: { sale: 0, ret: -50, items: [] }, r4: { sale: 0, ret: 0, items: [], settle: { diff: { sum: -20 } } } };
const rep = L.report(repItems, repScan, { r2: ['x'] }, { by: 'kasse' });
assert.deepStrictEqual(rep.rows.map(r => [r.label, r.count, r.sum, r.retCount, r.retSum, r.pantRet, r.anom, r.settleCount, r.settleDiff]),
  [['Kasse 1', 2, 50, 1, -50, -50, 1, 0, 0], ['Kasse 2', 1, 25.5, 0, 0, 0, 0, 1, -20]]);
assert.strictEqual(rep.total.sum, 75.5);
assert.strictEqual(rep.total.count, 3);
const repK = L.report(repItems, repScan, {}, { by: 'kasserer', byDay: true });
assert.deepStrictEqual(repK.rows.map(r => r.day + ' ' + r.label), ['2026-10-02 Kasserer A', '2026-10-02 Kasserer B', '2026-10-03 Kasserer A']);

// ---- egne regler
const mk = (f, op, v) => ({ f, op, v });
const itm = { totalAmount: -250, endDateTime: '2026-10-02 22:30', workstationNumber: 6, cashierNumber: '10', receiptType: 1, memberNumber: null, storeNumber: 1005 };
const scn = L.parseReceipt([['399 PANTELAPP', '', '-150.00'], ['399 PANTELAPP', '', '-100.00'], ['7044610877488 PEPSI MAX', '', '30.00'], ['Kontant tilbake:', '', '220.00']]);
const rl = (...c) => ({ name: 'T', enabled: true, conds: c });
assert.strictEqual(L.evalRule(rl(mk('sum', '<=', '-200'), mk('tid', '>=', '22:00')), itm, null, null), true);
assert.strictEqual(L.evalRule(rl(mk('sum', '<=', '-200'), mk('tid', '>=', '23:00')), itm, null, null), false);
assert.strictEqual(L.evalRule(rl(mk('medlem', '=', '')), itm, null, null), true);
assert.strictEqual(L.evalRule(rl(mk('medlem', '≠', '')), itm, null, null), false);
assert.strictEqual(L.evalRule(rl(mk('kasse', '=', '6')), itm, null, null), true);
assert.strictEqual(L.evalRule(rl(mk('panteretur', '>=', '200')), itm, null, null), false, 'krever skanning');
assert.strictEqual(L.evalRule(rl(mk('panteretur', '>=', '200')), itm, scn, null), true);
assert.strictEqual(L.evalRule(rl(mk('pantelapper', '>=', '2'), mk('kontanttilbake', '>', '200')), itm, scn, null), true);
assert.strictEqual(L.evalRule(rl(mk('vare', 'inneholder', 'pepsi')), itm, scn, null), true);
assert.strictEqual(L.evalRule(rl(mk('vare', '=', '7044610877488')), itm, scn, null), true);
assert.strictEqual(L.evalRule(rl(mk('vare', '≠', 'banan')), itm, scn, null), true);
assert.strictEqual(L.evalRule(rl(mk('gruppe', '=', 'Brus')), itm, scn, ['Brus', 'Pant']), true);
assert.strictEqual(L.evalRule(rl(mk('betaling', 'inneholder', 'kontant')), itm, scn, null), true);
assert.strictEqual(L.evalRule({ name: 'x', enabled: false, conds: [mk('sum', '<', '0')] }, itm, null, null), false);
assert.strictEqual(L.evalRule({ name: 'x', conds: [] }, itm, null, null), false);
assert.deepStrictEqual(L.anomalies(itm, scn, Object.assign({}, cfg, { bigReturn: '', manyLapper: '', cashNoSale: false, roundMin: '' }), [rl(mk('sum', '<', '0'))], null), ['Regel: T']);
assert.deepStrictEqual(L.sanitizeCustom([{ name: 'a', conds: [{ f: 'sum', op: '>=', v: 5 }, { f: 'bogus', op: '=', v: 1 }, { f: 'sum', op: '??', v: 1 }] }])[0].conds, [{ f: 'sum', op: '>=', v: '5' }]);
console.log('logic: ok');
