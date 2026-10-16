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
assert.strictEqual(L.storeLabel(1005, { 1005: '1005 - Coop Mega Kolbotn' }), '1005 – Coop Mega Kolbotn', 'nummeret foran navnet tas bort og settes på igjen likt');
// 7-sifret butikknummer = nivå + avdelingsnummer
assert.deepStrictEqual(L.storeParts(1311003), { full: '1311003', level: '131', dept: '1003' });
assert.deepStrictEqual(L.storeParts('1005'), { full: '1005', level: '', dept: '1005' });
assert.strictEqual(L.storeLabel(1311003, {}), '1003 (nivå 131)');
assert.strictEqual(L.storeLabel('1311003', { 1311003: 'Coop Prix Bø' }), '1003 – Coop Prix Bø (nivå 131)');
assert.strictEqual(L.storeLabel(1311003, { 1311003: '1311003 - Coop Prix Bø' }), '1003 – Coop Prix Bø (nivå 131)');
assert.strictEqual(L.storeLabel(1311003, { 1311003: '1003 Coop Prix Bø' }), '1003 – Coop Prix Bø (nivå 131)');
assert.strictEqual(L.storeShort(1311003) + ' ' + L.storeShort(1005), '1003 (131) 1005');
assert.ok(['1311003', '1003', 'nivå 131', 'prix'].every((q) => L.storeSearch(1311003, { 1311003: 'Coop Prix Bø' }).indexOf(q) !== -1));
assert.deepStrictEqual(L.parseStoreText('1311003=Coop Prix Bø\n131=Coop Øst\n1005 - Mega'), { 1311003: 'Coop Prix Bø', 131: 'Coop Øst', 1005: 'Mega' });
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
// differanse i ett kassaoppgjør er ikke lenger et avvik per bong (gjentatte differanser følges i Kassadifferanse over tid)
assert.deepStrictEqual(L.anomalies({ totalAmount: null }, stRec, cfg), []);
assert.ok(!('settleDiff' in L.defaultAnom()) && !('settleDiff' in L.sanitizeAnom({ settleDiff: '1' })));
assert.ok(!('Kassadifferanse' in L.RISK_WEIGHTS));

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

// ---- kontroller
const C = L.defaultControl();
const rcpt = (rows) => L.parseReceipt(rows);
const neg1 = rcpt([['7000000000001 BANAN KG', '', '-15.00'], ['399 PANTELAPP', '', '-20.00']]);
assert.strictEqual(neg1.neg, 1);
assert.strictEqual(neg1.retLines, 1);
const mkI = (id, day, time, kasse, kasserer, total, type) => ({ transactionId: id, endDateTime: day + ' ' + time, storeNumber: 1005, workstationNumber: kasse, cashierNumber: kasserer, totalAmount: total, receiptType: type || 1, memberNumber: null });

// profil: kasserer B har mange returer
const pi = [];
const pscan = {};
for (let i = 0; i < 10; i++) { pi.push(mkI('a-' + (100 + i), '2026-10-02', '10:0' + i, 1, 'A', 100 + i)); pscan['a-' + (100 + i)] = rcpt([['7000 VARE', '', '100.00']]); }
for (let i = 0; i < 10; i++) {
  const neg = i < 6;
  pi.push(mkI('b-' + (200 + i), '2026-10-02', '11:0' + i, 2, 'B', neg ? -30 : 100));
  pscan['b-' + (200 + i)] = rcpt(neg ? [['399 PANTELAPP', '', '-30.00'], ['399 PANTELAPP', '', '-5.00']] : [['7000 VARE', '', '100.00']]);
}
const prof = L.profiles(pi, pscan, C);
const pa = prof.rows.find(r => r.id === 'A'), pb = prof.rows.find(r => r.id === 'B');
assert.strictEqual(pa.retShare, 0);
assert.strictEqual(pb.retShare, 0.6);
assert.strictEqual(pb.flags.retShare, true);
assert.strictEqual(pb.flags.lapperPer, true);
assert.strictEqual(pa.flagged, false);
assert.strictEqual(pb.flagged, true);
assert.strictEqual(prof.store.count, 20);
assert.strictEqual(L.profiles(pi.slice(0, 3), pscan, C).rows[0].flags.retShare, undefined, 'for få til profil');

// mønstre
const mi = [
  mkI('m-1', '2026-10-02', '21:10', 3, 'X', -40), mkI('m-2', '2026-10-02', '21:30', 3, 'X', -25), mkI('m-3', '2026-10-02', '21:55', 3, 'X', -60),
  mkI('m-4', '2026-10-02', '15:00', 3, 'X', -30), mkI('m-5', '2026-10-02', '21:20', 4, 'X', -30),
  mkI('r-1', '2026-10-02', '12:00', 5, 'Y', 199), mkI('r-2', '2026-10-02', '12:30', 5, 'Y', 199), mkI('r-3', '2026-10-02', '13:00', 6, 'Y', 199),
  mkI('r-4', '2026-10-03', '12:00', 5, 'Y', 199), mkI('r-5', '2026-10-02', '14:00', 5, 'Y', 20), mkI('r-6', '2026-10-02', '14:05', 5, 'Y', 20), mkI('r-7', '2026-10-02', '14:10', 5, 'Y', 20)
];
const cn = rcpt([['399 PANTELAPP', '', '-50.00'], ['Kontant tilbake:', '', '50.00']]);
const mscan = { 'c-1': cn, 'c-2': cn, 'c-3': cn, 'c-4': rcpt([['7000 VARE', '', '10.00'], ['399 PANTELAPP', '', '-5.00'], ['Kontant tilbake:', '', '5.00']]) };
const ci = ['c-1', 'c-2', 'c-3', 'c-4'].map((id, i) => mkI(id, '2026-10-02', '09:0' + i, 7, 'Z', -50));
const pat = L.patterns(mi.concat(ci), mscan, C);
const byCode = c => pat.filter(x => x.code === c);
// «Små returer før stenging» og «Samme beløp gjentatt» er fjernet
assert.deepStrictEqual(pat.map(x => x.code).filter(c => c !== 'cashNoSale'), []);
assert.ok(!('smallReturnN' in C) && !('repeatN' in C) && !('closeTime' in C));
assert.strictEqual(byCode('cashNoSale').length, 1);
assert.strictEqual(byCode('cashNoSale')[0].ids.length, 3);
assert.match(byCode('cashNoSale')[0].detail, /Kasse 7: 3 ganger, totalt 150 kr/);

// pantcheck
const pci = [mkI('p-1', '2026-10-02', '10:00', 1, 'A', -150, 1), mkI('p-2', '2026-10-02', '11:00', 1, 'A', -150, 1), mkI('p-3', '2026-10-02', '12:00', 1, 'A', 30, 1), mkI('p-4', '2026-10-02', '12:10', 2, 'A', -150, 1)];
const pcs = { 'p-1': rcpt([['399 PANTELAPP', '', '-150.00']]), 'p-2': rcpt([['399 PANTELAPP', '', '-150.00']]), 'p-3': rcpt([['220 PANT', '', '2.00']]), 'p-4': rcpt([['399 PANTELAPP', '', '-150.00']]) };
const pk = L.pantCheck(pci, pcs, C);
assert.strictEqual(pk.findings.length, 0, 'gjentatte pantebeløp ligger nå i lappChecks (Pantelapp innløst flere ganger)');
assert.deepStrictEqual(pk.balance.map(b => [b.sale, b.ret, b.diff, b.flag]), [[2, 450, -448, true]]);
assert.strictEqual(L.pantCheck(pci, pcs, Object.assign({}, C, { pantRatio: '' })).balance[0].flag, false);

// sekvens
const si = [mkI('x-100', '2026-10-02', '10:00', 1, 'A', 10), mkI('x-101', '2026-10-02', '10:05', 1, 'A', 10), mkI('x-104', '2026-10-02', '10:10', 1, 'A', 10),
  mkI('x-105', '2026-10-02', '10:15', 1, 'A', 10), mkI('y-500', '2026-10-02', '10:00', 2, 'A', 10), mkI('y-900', '2026-10-02', '10:30', 2, 'A', 10),
  mkI('z-1', '2026-10-02', '03:10', 3, 'A', 10), mkI('z-2', '2026-10-02', '23:30', 3, 'A', 10), mkI('z-3', '2026-10-02', '12:00', 3, 'A', 10)];
const sq = L.sequence(si, C);
assert.ok(!sq.findings.some(f => f.code === 'gap') && !('skippedGaps' in sq), 'hull i bongnummer er fjernet');
const hrs = sq.findings.filter(f => f.code === 'hours');
assert.strictEqual(hrs.length, 1);
assert.strictEqual(hrs[0].ids.length, 2);
assert.strictEqual(hrs[0].title, 'Transaksjoner utenfor åpningstid');
assert.match(hrs[0].detail, /åpent 07:00–23:00/);
assert.ok(!/hvorav/.test(hrs[0].detail), 'ingen returer blant bongene utenfor åpningstid');
// returer før åpning og etter stengetid får eget funn
const ri2 = [mkI('o-1', '2026-10-03', '06:30', 1, 'A', -80), mkI('o-2', '2026-10-03', '06:50', 1, 'A', 120), mkI('o-3', '2026-10-03', '23:20', 1, 'B', -45),
  mkI('o-4', '2026-10-03', '07:00', 1, 'A', -10), mkI('o-5', '2026-10-03', '23:00', 1, 'A', -10), mkI('o-6', '2026-10-03', '12:00', 1, 'A', -300)];
const oq = L.sequence(ri2, C, { 'o-2': rcpt([['399 PANTELAPP', '', '-20.00'], ['Kontant tilbake:', '', '20.00']]) });
const oh = oq.findings.filter(f => f.code === 'hours'), orr = oq.findings.filter(f => f.code === 'hoursReturn');
assert.deepStrictEqual(oh.map(f => f.ids), [['o-1', 'o-2', 'o-3']], '07:00 og 23:00 er innenfor');
assert.match(oh[0].detail, /3 bonger \(06:30–23:20, åpent 07:00–23:00\), hvorav 3 returer/);
assert.deepStrictEqual(orr.map(f => f.ids), [['o-1', 'o-2', 'o-3']], 'negativ sum eller pantelapper regnes som retur');
assert.match(orr[0].detail, /Retur utenfor åpningstid|3 returer \(06:30–23:20, åpent 07:00–23:00\), til sammen 245\.00 kr/);
assert.strictEqual(orr[0].title, 'Retur utenfor åpningstid');
assert.strictEqual(L.riskScore(['Transaksjoner utenfor åpningstid', 'Retur utenfor åpningstid'], L.RISK_WEIGHTS), 4, 'samme forhold teller bare høyeste');
assert.strictEqual(L.sequence(si, Object.assign({}, C, { openFrom: '', openTo: '' })).findings.filter(f => f.code === 'hours').length, 0);

// avstemming
const ri = [mkI('s-1', '2026-10-02', '10:00', 1, 'A', 300), mkI('s-2', '2026-10-02', '11:00', 1, 'A', 120), mkI('s-3', '2026-10-02', '12:00', 1, 'A', -50), mkI('s-4', '2026-10-02', '23:00', 1, 'A', null, 2), mkI('s-5', '2026-10-02', '10:00', 2, 'A', 80)];
const rs = {
  's-1': rcpt([['7000 V', '', '300.00'], ['Kontant:', '', '300.00']]),
  's-2': rcpt([['7000 V', '', '120.00'], ['Bank:', '', '120.00']]),
  's-3': rcpt([['399 PANTELAPP', '', '-50.00'], ['Kontant tilbake:', '', '50.00']]),
  's-4': L.parseSettlement([['Kontant:', '240.00'], ['Sum', '240.00'], ['Sendt bank:'], ['NOK', '200.00'], ['Differanse'], ['Sum', '0.00']]),
  's-5': rcpt([['7000 V', '', '80.00'], ['Bank:', '', '80.00']])
};
const rec = L.reconcile(ri, rs, C);
assert.strictEqual(rec.length, 2);
assert.deepStrictEqual([rec[0].expected, rec[0].telt, rec[0].diff, rec[0].flag, rec[0].bank, rec[0].pay.Bank], [250, 240, -10, true, 200, 120]);
assert.strictEqual(rec[1].diff, null);
assert.strictEqual(rec[0].complete, true);
assert.strictEqual(L.reconcile(ri, rs, Object.assign({}, C, { reconTol: '20' }))[0].flag, false);

// relative datoer og filter/notat
assert.deepStrictEqual(L.relativeRange('yesterday', new Date(2026, 9, 2, 12)), { dateFrom: '2026-10-01', dateTo: '2026-10-01' });
assert.deepStrictEqual(L.relativeRange('lastweek', new Date(2026, 9, 2, 12)), { dateFrom: '2026-09-21', dateTo: '2026-09-27' });
assert.deepStrictEqual(L.relativeRange('thismonth', new Date(2026, 9, 8, 12)), { dateFrom: '2026-10-01', dateTo: '2026-10-08' });
assert.deepStrictEqual(L.relativeRange('lastmonth', new Date(2026, 9, 8, 12)), { dateFrom: '2026-09-01', dateTo: '2026-09-30' });
assert.deepStrictEqual(L.relativeRange('lastmonth', new Date(2026, 2, 5, 12)), { dateFrom: '2026-02-01', dateTo: '2026-02-28' });
assert.deepStrictEqual(L.relativeRange('last7', new Date(2026, 9, 8, 12)), { dateFrom: '2026-10-01', dateTo: '2026-10-07' });
const nctx = { notes: { 'a-1': { status: 'oppfolging', note: 'sjekk' }, 'a-2': { status: 'sjekket' }, 'a-3': { status: '', note: 'hei' } } };
assert.deepStrictEqual(ids(F({ note: 'any' }), nctx), ['a-1', 'a-2', 'a-3']);
assert.deepStrictEqual(ids(F({ note: 'oppfolging' }), nctx), ['a-1']);
assert.deepStrictEqual(ids(F({ note: 'sjekket' }), nctx), ['a-2']);
assert.strictEqual(L.sanitizeControl({ openFrom: '06:30', bogus: 1 }).openFrom, '06:30');
assert.strictEqual(L.defaultControl().openFrom, '07:00');
assert.strictEqual(L.mins('07:05'), 425);

// ---- fokus
const fi = [mkI('f-1', '2026-10-02', '10:05', 1, 'K', 100), mkI('f-2', '2026-10-02', '10:40', 1, 'K', -30), mkI('f-3', '2026-10-02', '15:00', 2, 'K', 300),
  mkI('f-4', '2026-10-02', '23:00', 2, 'K', null, 2)];
const fs = { 'f-1': rcpt([['7000 V', '', '100.00'], ['Bank:', '', '100.00']]), 'f-2': rcpt([['399 PANTELAPP', '', '-30.00'], ['Kontant tilbake:', '', '30.00']]), 'f-4': L.parseSettlement([['Sum', '10.00'], ['Differanse'], ['Sum', '-5.00']]) };
const fo = L.focusStats(fi, fs);
assert.deepStrictEqual([fo.all, fo.sales, fo.sum, fo.avg, fo.rets, fo.retSum], [4, 3, 370, 200, 1, -30]);
assert.deepStrictEqual([fo.first, fo.last], ['2026-10-02 10:05', '2026-10-02 23:00']);
assert.deepStrictEqual([fo.kasse[1], fo.kasse[2], fo.kasserer.K], [2, 2, 4]);
assert.deepStrictEqual([fo.hours[10], fo.hours[15], fo.hours[23], fo.hours[0]], [2, 1, 1, 0]);
assert.deepStrictEqual([fo.pantRet, fo.lapper, fo.scanned, fo.scannable, fo.settle, fo.settleDiff], [-30, 1, 3, 4, 1, -5]);
assert.deepStrictEqual(fo.pay, { 'Bank': 100, 'Kontant tilbake': 30 });
assert.strictEqual(L.focusStats([], {}).avg, 0);

// ---- risikoscore, rangering og forklaring
const W = L.sanitizeWeights(null);
assert.strictEqual(L.riskScore(['Stor panteretur (256 kr)', 'Kontant tilbake uten salg', 'Rundt beløp'], W), 5, 'pant og kontant tilbake er samme familie: høyeste (4) + rundt beløp (1)');
// tester som måler samme forhold teller bare det høyeste poenget per bong
assert.strictEqual(L.riskScore(['Kontant tilbake uten salg', 'Kontant tilbake uten salg flere ganger', 'Varelinjer slettet, pant utbetalt kontant'], W), 5);
assert.strictEqual(L.riskScore(['Høy rabattprosent', 'Rabatt med overvåket årsak', 'Rabatt uten treff på andre salg'], W), 4);
assert.strictEqual(L.riskScore(['Transaksjoner utenfor åpningstid', 'Salg etter kassaoppgjør'], W), 4, 'samme hendelse etter stengetid og oppgjør teller én gang');
assert.strictEqual(L.riskScore(['Retur uten salg', 'Vare ikke på kvitteringen', 'Retur av vare uten salg samme dag'], W), 4, 'returer uten kjøp er én familie');
assert.strictEqual(L.riskScore(['Overvåket vare slettet', 'Makulert vare ikke solgt på ny'], W), 3);
assert.strictEqual(L.riskScore(['Avvikende pris på vare', 'Spør pris avviker fra dagens salg'], W), 3);
assert.strictEqual(L.riskScore(['Medlemsnr flere ganger samme dag', 'Medlemsnr brukt svært mye'], W), 2, 'samme bruk av medlemsnr, to tidsvinduer');
assert.strictEqual(L.riskScore(['Medlemsnr flere ganger samme dag', 'Medlemsnr nesten bare hos én kasserer'], W), 5, 'ulike signaler summeres');
assert.strictEqual(L.riskScore(['Retur uten salg', 'Kortkjøp refundert kontant'], W), 8, 'ulike familier summeres');
assert.strictEqual(L.riskScore(['Kontant tilbake uten salg', 'Høy rabattprosent', 'Dobbelt bongnummer'], W), 10, 'ulike familier summeres');
const bd = L.scoreBreakdown(['Rabatt med overvåket årsak', 'Høy rabattprosent', 'Rundt beløp (500 kr)'], W);
assert.deepStrictEqual(bd.map((x) => [x.counts, x.by]), [[true, null], [false, 'Rabatt med overvåket årsak'], [true, null]], 'lik vekt: den første teller');
assert.strictEqual(L.reasonFamily('Stor panteretur (256 kr)'), 'kontant');
assert.strictEqual(L.reasonFamily('Rundt beløp'), null);
assert.strictEqual(L.scoreBreakdown(['Høy rabattprosent', 'Rabatt med overvåket årsak'], Object.assign({}, W, { 'Rabatt med overvåket årsak': 9 })).find((x) => x.counts).reason, 'Rabatt med overvåket årsak', 'vektene avgjør hvilken som teller');
// kassererfunn i samme familie teller bare det høyeste
const cx = L.cashierExtras([{ flag: false, cashier: 'A', title: 'Mange runde beløp' }, { flag: false, cashier: 'A', title: 'Avvikende siste siffer' }, { flag: false, cashier: 'A', title: 'Avvikende sifferfordeling' }, { flag: false, cashier: 'B', title: 'Mange spør pris' }, { flag: true, cashier: 'B', title: 'Rundt beløp' }], W);
assert.deepStrictEqual([cx.A.points, cx.A.notes.length, cx.B.points], [4, 2, 2], 'runde beløp og siste siffer er samme forhold');
Object.keys(L.FAMILIES).forEach((f) => L.FAMILIES[f].forEach((t) => assert.ok(t in L.RISK_WEIGHTS, 'ukjent test i familie: ' + t)));
assert.strictEqual(L.riskScore(['Regel: Min regel'], W), 3);
assert.strictEqual(L.riskScore(['Ukjent grunn'], W), 2);
assert.strictEqual(L.riskScore(['Stor panteretur (1 kr)'], Object.assign({}, W, { 'Stor panteretur': '10' })), 10);
assert.strictEqual(L.sanitizeWeights({ 'Rundt beløp': 'abc' })['Rundt beløp'], 1);
assert.deepStrictEqual([L.riskLevel(9), L.riskLevel(8), L.riskLevel(4), L.riskLevel(3.9)], ['høy', 'høy', 'middels', 'lav']);
const rkItems = [mkI('k-1', '2026-10-02', '10:00', 1, 'A', 100), mkI('k-2', '2026-10-02', '11:00', 1, 'B', -300), mkI('k-3', '2026-10-02', '12:00', 2, 'B', 500), mkI('k-4', '2026-10-02', '13:00', 1, 'A', 50)];
const rkAnom = { 'k-1': ['Rundt beløp'], 'k-2': ['Stor panteretur (300 kr)', 'Kontant tilbake uten salg'], 'k-3': ['Rundt beløp', 'Kontant tilbake uten salg flere ganger'] };
const rkr = L.rankReceipts(rkItems, rkAnom, W);
assert.deepStrictEqual(rkr.map(r => [r.id, r.score]), [['k-3', 6], ['k-2', 4], ['k-1', 1]], 'k-2: pant og kontant tilbake er samme familie, høyeste (4) teller');
const rkc = L.rankCashiers(rkItems, rkAnom, W, { rows: [{ id: 'A', flags: { retShare: true, avg: false } }, { id: 'C', flags: {} }] });
assert.deepStrictEqual(rkc.map(c => [c.id, c.score, c.flagged]), [['B', 10, 2], ['A', 3, 1]]);
assert.deepStrictEqual(rkc[1].profile, ['høy returandel']);
const ex = r => L.explainReason(r, { id: 'k-2', cfg: L.defaultAnom(), ctl: L.defaultControl(), rules: [{ name: 'Min', conds: [{ f: 'sum', op: '<=', v: '-200' }, { f: 'tid', op: '>=', v: '20:00' }] }], findings: [{ title: 'Kontant tilbake uten salg flere ganger', ids: ['k-2'], detail: 'Kasse 1: 3 ganger, totalt 300 kr' }] });
assert.match(ex('Stor panteretur (300 kr)'), /300 kr\. Grensen er 300 kr/);
assert.match(ex('Mange pantelapper (9)'), /9 pantelapper\. Grensen er 8/);
assert.match(ex('Regel: Min'), /Treffer din regel «Min»: Sum \(kr\) <= -200 OG Klokkeslett \(HH:MM\) >= 20:00/);
assert.match(ex('Kontant tilbake uten salg flere ganger'), /Kasse 1: 3 ganger/);
assert.match(ex('Transaksjoner utenfor åpningstid'), /07:00–23:00/);
assert.match(ex('Retur utenfor åpningstid'), /^Returen er tatt utenfor åpningstid \(07:00–23:00\)/);
assert.strictEqual(ex('Noe annet'), 'Noe annet');

// ---- diagramdata
const cdI = [mkI('c-1', '2026-10-02', '10:05', 1, 'A', 100), mkI('c-2', '2026-10-02', '10:40', 1, 'A', -30), mkI('c-3', '2026-10-02', '15:00', 2, 'B', 300),
  mkI('c-4', '2026-10-03', '10:00', 2, 'B', 50), mkI('c-5', '2026-10-03', '23:00', 2, 'B', null, 2)];
const cdS = { 'c-1': rcpt([['220 PANT', '', '2.00']]), 'c-2': rcpt([['399 PANTELAPP', '', '-30.00']]) };
const cd = L.chartData(cdI, cdS);
assert.deepStrictEqual([cd.hours.count[10], cd.hours.count[15], cd.hours.count[23], cd.hours.sum[10]], [3, 1, 0, 120]);
assert.deepStrictEqual(cd.days.map(d => [d.day, d.count, d.sum]), [['2026-10-02', 3, 370], ['2026-10-03', 1, 50]]);
assert.deepStrictEqual(cd.cashiers.map(c => [c.id, c.count, c.ret, Math.round(c.share * 100)]), [['A', 2, 1, 50], ['B', 2, 0, 0]]);
assert.strictEqual(Math.round(cd.storeShare * 100), 25);
assert.deepStrictEqual(cd.heat.rows.map(r => [r.id, r.counts[10]]), [['1', 2], ['2', 1]]);
assert.strictEqual(cd.heat.max, 2);
assert.deepStrictEqual(cd.pant, [{ day: '2026-10-02', sale: 2, ret: 30 }]);
assert.deepStrictEqual([L.niceMax(0), L.niceMax(3), L.niceMax(7), L.niceMax(12), L.niceMax(130), L.niceMax(0.4)], [1, 5, 10, 20, 200, 0.5]);

// ======== revisjonstester ========
const sale = (id, time, kasse, kasserer, total, day) => mkI(id, day || '2026-10-02', time, kasse, kasserer, total);
const C2 = L.defaultControl();

// ---- falsk retur
const frS1 = sale('s-100', '10:00', 1, 'A', 100);
const frR1 = sale('s-101', '10:20', 1, 'B', -100);
const frR2 = sale('s-102', '11:00', 1, 'B', -50);
const frR3 = sale('s-103', '12:00', 1, 'B', -30);
const frR4 = sale('s-104', '14:30', 2, 'B', -100);
const frScan = {
  's-100': rcpt([['7000111 VARE X', '', '100.00'], ['Bank:', '', '100.00']]),
  's-101': rcpt([['7000111 VARE X', '', '-100.00'], ['Kontant tilbake:', '', '100.00']]),
  's-102': rcpt([['9999999 UKJENT VARE', '', '-50.00'], ['Kontant tilbake:', '', '50.00']]),
  's-103': rcpt([['399 PANTELAPP', '', '-30.00'], ['Kontant tilbake:', '', '30.00']]),
  's-104': rcpt([['7000111 VARE X', '', '-100.00'], ['Kontant tilbake:', '', '100.00']])
};
const frPop = [frS1, frR1, frR2, frR3, frR4];
const fr = L.falseReturns(frPop, frPop, frScan, C2);
const frBy = c => fr.findings.filter(f => f.code === c);
assert.strictEqual(frBy('saleThenReturn').length, 1);
assert.deepStrictEqual(frBy('saleThenReturn')[0].ids, ['s-101', 's-100']);
assert.match(frBy('saleThenReturn')[0].detail, /Kasse 1: salg 10:00 og retur 10:20, begge 100 kr \(kasserer A og B\)/);
assert.deepStrictEqual(frBy('cardRefundCash').map(f => f.ids[0]).sort(), ['s-101', 's-104']);
assert.deepStrictEqual(frBy('returnNoSale').map(f => f.ids[0]), ['s-102']);
assert.match(frBy('returnNoSale')[0].detail, /UKJENT VARE \(50 kr\) uten tilsvarende salg/);
assert.ok(!fr.findings.some(f => f.ids.includes('s-103')), 'ren panteretur er ikke falsk retur');
assert.strictEqual(fr.coverage, 1);
const frHalf = L.falseReturns(frPop, frPop, { 's-102': frScan['s-102'] }, C2);
assert.strictEqual(frHalf.findings.filter(f => f.code === 'returnNoSale').length, 0, 'for lav skannedekning gir ikke retur uten salg');
assert.strictEqual(L.falseReturns(frPop, frPop, frScan, Object.assign({}, C2, { falseRet: '' })).findings.length, 0);
assert.strictEqual(L.falseReturns([frR4], frPop, frScan, C2).findings.filter(f => f.code === 'saleThenReturn').length, 0, 'ulike kasser/utenfor tidsvindu');

// ---- salg etter kassaoppgjør
const st = (id, time, kasse, kasserer, day) => mkI(id, day || '2026-10-02', time, kasse, kasserer, null, 2);
const asPop = [sale('a-1', '09:00', 1, 'A', 50), sale('a-2', '21:50', 1, 'A', 70), st('a-3', '22:00', 1, 'B'), sale('a-4', '22:03', 1, 'A', 10), sale('a-5', '22:10', 1, 'C', 120), sale('a-6', '23:30', 1, 'C', 30),
  sale('b-1', '21:00', 2, 'A', 40), st('b-2', '21:30', 2, 'A'), sale('b-3', '21:45', 2, 'A', 20), st('b-4', '22:30', 2, 'A'),
  sale('c-1', '23:50', 3, 'A', 99), st('c-2', '00:05', 3, 'A', '2026-10-03'), sale('c-3', '08:00', 3, 'A', 99, '2026-10-03')];
const af = L.afterSettlement(asPop, asPop, C2);
assert.strictEqual(af.length, 1);
assert.deepStrictEqual(af[0].ids, ['a-5', 'a-6']);
assert.match(af[0].detail, /Kasse 1 2026-10-02: 2 salg \(150 kr\) etter kassaoppgjør kl 22:00 \(oppgjør av kasserer B; salg av C\)/);
assert.deepStrictEqual(L.afterSettlement(asPop, asPop, Object.assign({}, C2, { settleGraceMin: '15' }))[0].ids, ['a-6'], 'a-5 ligger innenfor fristen');
assert.ok(!af.some(f => f.ids.includes('c-3')), 'oppgjør etter midnatt er forrige dags avslutning');
assert.strictEqual(L.afterSettlement(asPop, asPop, Object.assign({}, C2, { settleGraceMin: '' })).length, 0);
assert.strictEqual(L.afterSettlement(asPop.filter(x => x.cashierNumber === 'C'), asPop, C2)[0].ids.length, 2, 'omfang på kasserer, oppgjør fra hele grunnlaget');

// ---- slettede bonger
const dl = (id, time, kasse, cashier) => mkI(id, '2026-10-02', time, kasse, cashier || 'A', 10);
const dPop = [dl('x-100', '10:00', 1), dl('x-101', '10:05', 1), dl('x-104', '10:20', 1), dl('x-105', '10:10', 1), dl('x-106', '10:30', 1),
  dl('y-7', '09:00', 2), dl('y-8', '09:10', 2), dl('y-8b', '09:11', 2), dl('z-1', '08:00', 3), dl('z-900', '08:30', 3)];
dPop[8].transactionId = 'y-8'; dPop[7].transactionId = 'y-8x';
const dr = L.deletedReceipts(dPop, C2);
const dBy = c => dr.findings.filter(f => f.code === c);
assert.strictEqual(dBy('gap').length, 0, 'hull i bongnummer er fjernet');
assert.strictEqual(dBy('timeInversion').length, 1);
assert.match(dBy('timeInversion')[0].detail, /nr 105 kl 10:10 kommer etter nr 104 kl 10:20/);
assert.strictEqual(dBy('dupSeq').length, 1);
assert.match(dBy('dupSeq')[0].detail, /Kasse 2: bongnummer 8 finnes to ganger/);
assert.ok(dr.findings.every(f => f.flag === true));

// ---- Benford og runde beløp
const bf = [];
let bi = 0;
for (let d = 1; d <= 9; d++) {
  const cnt = Math.round(600 * Math.log10(1 + 1 / d));
  for (let k = 0; k < cnt; k++) bf.push(mkI('bf-' + (bi++), '2026-10-02', '10:00', 1, 'A', d * 10 + 3.5 + (k % 7) * 0.1));
}
const bfAll = L.numbers(bf, {}, C2);
assert.ok(bfAll.overall.n >= 590 && bfAll.overall.enough);
assert.strictEqual(bfAll.overall.verdict, 'nær Benford');
assert.ok(bfAll.overall.mad < 0.006);
assert.strictEqual(bfAll.findings.length, 0);
assert.strictEqual(L.firstDigit(0.45), 4);
assert.strictEqual(L.firstDigit(1234.5), 1);
const unif = [];
for (let d = 1; d <= 9; d++) for (let k = 0; k < 40; k++) unif.push(mkI('u-' + d + '-' + k, '2026-10-02', '11:00', 2, 'Z', d * 10 + 0.5 + k * 0.01));
const bu = L.numbers(unif, {}, C2);
assert.strictEqual(bu.overall.verdict, 'avviker');
assert.ok(bu.findings.some(f => f.code === 'benford' && f.cashier === 'Z'));
assert.strictEqual(bu.findings.find(f => f.code === 'benford').flag, false);
const rd = [];
for (let k = 0; k < 40; k++) rd.push(mkI('r-' + k, '2026-10-02', '10:00', 1, 'Q', k % 2 ? 100 : 100 + 0.5 + k * 0.1));
for (let k = 0; k < 60; k++) rd.push(mkI('p-' + k, '2026-10-02', '10:00', 1, 'P', 100.37 + k * 0.01));
const rn = L.numbers(rd, {}, C2);
assert.ok(rn.findings.some(f => f.code === 'round' && f.cashier === 'Q'));
assert.ok(!rn.findings.some(f => f.code === 'round' && f.cashier === 'P'));
assert.strictEqual(L.numbers(rd, {}, Object.assign({}, C2, { roundShare: '' })).findings.filter(f => f.code === 'round').length, 0);
assert.strictEqual(L.numbers(rd.slice(0, 5), {}, C2).overall.enough, false);

// ---- periode mot periode
const pA = [], pB = [];
for (let k = 0; k < 10; k++) { pA.push(mkI('pa-' + k, '2026-09-20', '10:0' + k, 1, 'A', 100)); pB.push(mkI('pb-' + k, '2026-10-01', '10:0' + k, 1, 'A', k < 4 ? -50 : 100)); }
for (let k = 0; k < 10; k++) { pA.push(mkI('qa-' + k, '2026-09-20', '11:0' + k, 1, 'B', 80)); pB.push(mkI('qb-' + k, '2026-10-01', '11:0' + k, 1, 'B', 80)); }
const cmpP = L.comparePeriods(pA, pB, {}, { 'pb-0': ['Stor panteretur (300 kr)'], 'pb-1': ['Kasserer bruker eget medlemsnr'] }, W, C2);
const cA = cmpP.rows.find(r => r.id === 'A'), cB = cmpP.rows.find(r => r.id === 'B');
assert.deepStrictEqual([cA.A.retShare, cA.B.retShare, Math.round(cA.dRet * 100)], [0, 0.4, 40]);
assert.strictEqual(cA.flagged, true);
assert.ok(cA.flags.some(f => /returandel \+40 poeng/.test(f)));
assert.ok(cA.flags.some(f => /risikoscore \+8/.test(f)));
assert.strictEqual(cB.flagged, false);
assert.deepStrictEqual([cmpP.total.A.count, cmpP.total.B.count, cmpP.total.B.anom], [20, 20, 2]);

// ---- rabatt og kuponger (kvittering fra produksjon, anonymisert)
const dsc = L.parseReceipt([
  ['Beskrivelse', '', 'Beløp'],
  ['7071862047727 LINEA GAVEBÅND 20M', '', '4.36'],
  ['Rabatt: Kr 4.36 (50.0%)'],
  ['Rabatt årsak: '],
  ['7340191181243 COOP COLOR 1000ML', '', '20.00'],
  ['7340191181243 COOP COLOR 1000ML', '', '20.00'],
  ['5712 APPELSIN', '', '28.41'],
  ['Antall: 0.712 kg à Kr 39.90'],
  ['', 'Totalt', '72.77'],
  ['Kupong (1ESD2LJ54XDMBB6F - COOP FROKOSTEGG FRITTG. 12PK L):', '', '0.00'],
  ['Kupong (1ESD2P6DRVPCCJY1 - Gruppe - Coop koppnudler, 65 g):', '', '0.00'],
  ['Coopay:', '', '72.77'],
  ['TransId: DK7TVRW5F2PC5'],
  ['35.49', '25 %', '8.87', '44.36', '']
]);
assert.strictEqual(dsc.v, 6);
assert.deepStrictEqual([dsc.items[3].p, dsc.ku, dsc.ev, dsc.unk], [39.9, undefined, undefined, undefined]);
assert.strictEqual(dsc.items.length, 4);
assert.deepStrictEqual([dsc.items[0].d, dsc.items[0].dp, dsc.items[0].dr], [4.36, 50, '']);
assert.strictEqual(dsc.items[1].d, undefined);
assert.strictEqual(dsc.items[3].q, 0.712);
assert.deepStrictEqual(dsc.pay, { 'Coopay': 72.77 });
assert.deepStrictEqual(dsc.coupons, [{ i: '1ESD2LJ54XDMBB6F', n: 'COOP FROKOSTEGG FRITTG. 12PK L', a: 0 }, { i: '1ESD2P6DRVPCCJY1', n: 'Gruppe - Coop koppnudler, 65 g', a: 0 }]);
assert.deepStrictEqual([dsc.disc, dsc.discN, dsc.discNR, dsc.discNRsum], [4.36, 1, 1, 4.36]);
assert.strictEqual(dsc.np, 4);
const withReason = L.parseReceipt([['7000 VARE', '', '10.00'], ['Rabatt: Kr 5.00 (33.3%)'], ['Rabatt årsak:', 'Utgått dato']]);
assert.deepStrictEqual([withReason.items[0].dr, withReason.discNR, withReason.discN], ['Utgått dato', 0, 1]);
const oldRec = { v: 2, items: [], pay: {}, sale: 0, ret: 0, saleLines: 0, retLines: 0, np: 0 };
const dmm = { 'd-1': dsc, 'd-2': withReason, 'd-3': rcpt([['7000 VARE', '', '10.00']]), 'd-4': oldRec };
const dmeta = (id, o) => Object.assign({ transactionId: id, endDateTime: '2026-10-01 12:00', storeNumber: 1005, workstationNumber: 1, cashierNumber: 'A', totalAmount: 10, receiptType: 1, memberNumber: null }, o || {});
const ditems = ['d-1', 'd-2', 'd-3', 'd-4'].map(id => dmeta(id));
const didsf = (disc) => ditems.filter(r => L.matches(r, F({ disc }), { scan: dmm })).map(r => r.transactionId);
assert.deepStrictEqual(didsf('reason'), ['d-2'], 'bare rabatt med årsakskode');
assert.deepStrictEqual([L.sanitizeFilters({ disc: 'any' }).disc, L.sanitizeFilters({ disc: 'noreason' }).disc, L.sanitizeFilters({ disc: 'coupon' }).disc, L.sanitizeFilters({ disc: 'r:Best før' }).disc], ['reason', '', '', 'r:Best før']);
assert.deepStrictEqual(ditems.filter(r => L.matches(r, F({ disc: 'reason' }), {})).length, 0);
assert.strictEqual(L.activeCount(F({ disc: 'reason' })), 1);
assert.strictEqual(L.hasDisc(oldRec), false);
assert.strictEqual(L.matches(dmeta('d-4'), F({ disc: 'reason' }), { scan: dmm }), false);
assert.strictEqual(L.matches(ditems[0], F({ discFrom: '40' }), { scan: dmm }), false, 'prosentfilteret gjelder bare rabatt med årsakskode');
assert.strictEqual(L.matches(ditems[1], F({ discFrom: '30', discTo: '40' }), { scan: dmm }), true);
const drul = (f, op, v) => ({ name: 'r', enabled: true, conds: [{ f, op, v }] });
assert.strictEqual(L.evalRule(drul('rabattpst', '>=', '50'), ditems[0], dsc), true);
assert.ok(!('rabattuten' in L.RULE_FIELDS) && !('kuponger' in L.RULE_FIELDS) && !('kupong' in L.RULE_FIELDS), 'rabatt uten årsak og kupong finnes ikke som regelfelt');
const gone = L.sanitizeCustom([{ name: 'g', conds: [{ f: 'kuponger', op: '>=', v: '1' }, { f: 'sum', op: '>', v: '10' }] }, { name: 'h', conds: [{ f: 'sum', op: '>', v: '10' }] }]);
assert.deepStrictEqual(gone.map(r => [r.enabled, r.conds.length]), [[false, 1], [true, 1]], 'regel med fjernet felt skrus av i stedet for å bli bredere');
const dsFo = L.focusStats(ditems, dmm);
assert.deepStrictEqual([dsFo.disc, dsFo.discN, dsFo.discScanned], [5, 1, 3], 'fokus teller bare rabatt med årsakskode');

// discounts(): bare rabatt med årsakskode, og kasserer-sammenligning mot butikk og alle kasserere
const dbase = Object.assign({}, C2, { discCash: '1', discCashN: '3', profMin: '5', profFactor: '1.5', discHiFrom: '', discMatchPct: '' });
const ddd = L.discounts(ditems, dmm, dbase);
assert.strictEqual(ddd.scanned, 3);
assert.strictEqual(ddd.sales, 4);
assert.ok(ddd.coverage < 1);
assert.deepStrictEqual([ddd.total.n, ddd.total.withR, ddd.total.disc, ddd.total.lines], [3, 1, 5, 1], 'rabatt uten årsak (d-1) er ikke med');
assert.ok(!('campaigns' in ddd) && !('camp' in ddd) && !ddd.findings.some(f => /NoReason/.test(f.code)));
const dcs = {}, dci = [];
const withR = (k, reason, lim) => [['7000 V', '', '50.00'], ...(k < lim ? [['Rabatt: Kr 5.00 (10.0%)'], ['Rabatt årsak: ' + reason]] : [])];
for (let k = 0; k < 10; k++) { dcs['x-' + k] = rcpt(withR(k, 'Datovare', 4)); dci.push(dmeta('x-' + k, { cashierNumber: 'Z', endDateTime: '2026-10-01 10:0' + k })); }
for (let k = 0; k < 10; k++) { dcs['y-' + k] = rcpt(withR(k, 'Feil pris', 1)); dci.push(dmeta('y-' + k, { cashierNumber: 'Y', endDateTime: '2026-10-01 11:0' + k })); }
for (let k = 0; k < 10; k++) { dcs['w-' + k] = rcpt([['7000 V', '', '50.00'], ['Rabatt: Kr 5.00 (10.0%)'], ['Rabatt årsak: ']]); dci.push(dmeta('w-' + k, { cashierNumber: 'W', endDateTime: '2026-10-01 12:0' + k })); }
const dcdsc = L.discounts(dci, dcs, dbase);
const dcf = dcdsc.findings.filter(f => f.code === 'discCash');
assert.deepStrictEqual(dcf.map(f => [f.cashier, f.flag]), [['Z', false]], 'Z ligger over snittet; W har bare rabatt uten årsak og telles ikke');
assert.match(dcf[0].detail, /Kasserer Z: 4 av 10 bonger \(40 %\) har rabatt med årsakskode\. Snitt butikk 16,7 %, alle kasserere 16,7 %\. Over snittet per årsak: Datovare 4 \(40 % mot butikk 13,3 %\) \(grense 1,5× butikksnittet\)/);
const zr = dcdsc.rows.find(r => r.id === 'Z'), wr = dcdsc.rows.find(r => r.id === 'W');
assert.deepStrictEqual([zr.flag, zr.flagCodes, Math.round(zr.storeShare * 1000), Math.round(zr.allShare * 1000)], [true, ['Datovare'], 167, 167]);
assert.deepStrictEqual([wr.withR, wr.share, wr.flag], [0, 0, false]);
assert.deepStrictEqual([dcdsc.total.n, dcdsc.total.withR, Math.round(dcdsc.total.share * 1000)], [30, 5, 167]);
assert.deepStrictEqual(Object.keys(dcdsc.byStore), ['1005']);
assert.strictEqual(dcdsc.byStore['1005'].codes['Datovare'].n, 4);
assert.strictEqual(L.discounts(dci, dcs, Object.assign({}, dbase, { discCashN: '5' })).findings.filter(f => f.code === 'discCash').length, 0, 'under minste antall');
assert.strictEqual(L.discounts(dci, dcs, Object.assign({}, dbase, { discCash: '' })).findings.filter(f => f.code === 'discCash').length, 0);
assert.strictEqual(L.discounts(dci, dcs, Object.assign({}, dbase, { profMin: '11' })).findings.filter(f => f.code === 'discCash').length, 0, 'under minste antall bonger for profil');
// to butikker: egen butikkandel og felles snitt for alle kasserere
const dci2 = dci.map(r => Object.assign({}, r, r.cashierNumber === 'Y' || r.cashierNumber === 'W' ? { storeNumber: 2002 } : {}));
const d2 = L.discounts(dci2, dcs, dbase);
assert.deepStrictEqual(Object.keys(d2.byStore), ['1005', '2002']);
assert.deepStrictEqual([Math.round(d2.rows.find(r => r.id === 'Z').storeShare * 1000), Math.round(d2.rows.find(r => r.id === 'Y').storeShare * 1000), Math.round(d2.rows.find(r => r.id === 'Z').allShare * 1000)], [400, 50, 167]);
// høy rabattprosent og manglende treff gjelder bare rabatt med årsakskode
const hcs = { 'h-1': rcpt([['7000000000001 VARE', '', '15.00'], ['Rabatt: Kr 15.00 (50.0%)'], ['Rabatt årsak: Feil pris']]), 'h-2': rcpt([['7000000000002 ANNEN', '', '15.00'], ['Rabatt: Kr 15.00 (50.0%)'], ['Rabatt årsak: ']]) };
const hit = ['h-1', 'h-2'].map(id => dmeta(id));
const hd = L.discounts(hit, hcs, Object.assign({}, dbase, { discHiFrom: '40', discHiTo: '100', discMatchPct: '30' }));
assert.deepStrictEqual(hd.findings.filter(f => f.code === 'discHigh').map(f => f.ids[0]), ['h-1']);
assert.deepStrictEqual(hd.findings.filter(f => f.code === 'discNoMatch').map(f => f.ids[0]), ['h-1']);
assert.match(hd.findings.find(f => f.code === 'discHigh').detail, /VARE −15 kr \(50 %\), årsak Feil pris/);
// rabattårsaker (tekstnr 1–6 eller tekst)
assert.deepStrictEqual(L.DISC_REASONS, ['Datovare', 'Feil pris', 'Prisløfte', 'Reserveløsning kupong', 'Annen rabattårsak', 'Best før']);
assert.deepStrictEqual(['', ' ', '1', '6', '4 ', 'datovare', '2 Feil pris', 'ANNEN RABATTÅRSAK', 'Reserveløsning kupong', '9', 'Medarbeider'].map(L.reasonName),
  ['Uten årsak', 'Uten årsak', 'Datovare', 'Best før', 'Reserveløsning kupong', 'Datovare', 'Feil pris', 'Annen rabattårsak', 'Reserveløsning kupong', '9', 'Medarbeider']);
const qrs = { 'e-1': rcpt([['7000 A', '', '10.00'], ['Rabatt: Kr 2.00 (16.7%)'], ['Rabatt årsak: 1'], ['7001 B', '', '5.00'], ['Rabatt: Kr 5.00 (50.0%)'], ['Rabatt årsak: Best før']]),
  'e-2': rcpt([['7000 A', '', '10.00'], ['Rabatt: Kr 3.00 (23.1%)'], ['Rabatt årsak: Datovare']]),
  'e-3': rcpt([['7000 A', '', '10.00'], ['Rabatt: Kr 1.00 (9.1%)'], ['Rabatt årsak: Medarbeider']]),
  'e-4': rcpt([['7000 A', '', '10.00'], ['Rabatt: Kr 1.00 (9.1%)'], ['Rabatt årsak: ']]) };
const qit = [['e-1', 'A'], ['e-2', 'B'], ['e-3', 'B'], ['e-4', 'B']].map(x => dmeta(x[0], { cashierNumber: x[1] }));
const qrf = (v) => qit.filter(r => L.matches(r, F({ disc: v }), { scan: qrs })).map(r => r.transactionId);
assert.deepStrictEqual(qrf('r:Datovare'), ['e-1', 'e-2']);
assert.deepStrictEqual(qrf('r:Best før'), ['e-1']);
assert.deepStrictEqual(qrf('r:Prisløfte'), []);
assert.strictEqual(L.evalRule(drul('rabattarsak', '=', 'Best før'), qit[0], qrs['e-1']), true);
assert.strictEqual(L.evalRule(drul('rabattarsak', '=', 'Best før'), qit[1], qrs['e-2']), false);
const qrd2 = L.discounts(qit, qrs, dbase);
assert.deepStrictEqual(qrd2.reasons.map(r => [r.name, r.lines, r.bongs, r.sum, r.known]),
  [['Datovare', 2, 2, 5, true], ['Best før', 1, 1, 5, true], ['Medarbeider', 1, 1, 1, false]]);
assert.strictEqual(qrd2.reasons.find(r => r.name === 'Datovare').avgPct, 19.9);
assert.deepStrictEqual(qrd2.codes, qrd2.reasons.map(r => r.name));
const codeN = (id) => qrd2.codes.map(c => qrd2.rows.find(r => r.id === id).codes[c].n);
assert.deepStrictEqual([codeN('A'), codeN('B')], [[1, 1, 0], [1, 0, 1]]);
// overvåkede rabattårsaker: bong-flagg, terskler og kasserer-flagg
assert.deepStrictEqual(L.watchReasons({ discWatch: '2, 4;5,5,xyz, Best før' }), ['Feil pris', 'Reserveløsning kupong', 'Annen rabattårsak', 'Best før']);
assert.deepStrictEqual(L.watchReasons({ discWatch: '' }), []);
assert.deepStrictEqual(L.watchReasons(L.defaultControl()), ['Feil pris', 'Reserveløsning kupong', 'Annen rabattårsak']);
const wl = (reason, d, dp) => [['7000 VARE', '', '50.00'], ['Rabatt: Kr ' + d + ' (' + dp + '%)'], ['Rabatt årsak: ' + reason]];
const wsc = { 'w-1': rcpt(wl('2', '10.00', '16.7')), 'w-2': rcpt(wl('Annen Rabattårsak', '3.00', '5.7')), 'w-3': rcpt(wl('4', '8.00', '13.8')),
  'w-4': rcpt(wl('1', '9.00', '15.3')), 'w-5': rcpt(wl('Feil pris', '1.00', '2.0')), 'w-6': rcpt(wl('2', '5.00', '9.1')) };
const wit = [['w-1', 'A'], ['w-2', 'A'], ['w-3', 'A'], ['w-4', 'A'], ['w-5', 'B'], ['w-6', 'B']].map(x => dmeta(x[0], { cashierNumber: x[1] }));
const wd = L.discounts(wit, wsc, C2);
assert.deepStrictEqual(wd.findings.filter(f => f.code === 'discWatch').map(f => f.ids[0]), ['w-1', 'w-2', 'w-3', 'w-5', 'w-6']);
assert.match(wd.findings.find(f => f.code === 'discWatch').detail, /Kasse 1 12:00 kasserer A: VARE −10 kr \(16.7 %\) – årsak Feil pris/);
assert.strictEqual(wd.findings.find(f => f.code === 'discWatch').flag, true);
const wf = (o) => L.discounts(wit, wsc, Object.assign({}, C2, o)).findings.filter(f => /^discWatch/.test(f.code)).map(f => f.ids[0]);
assert.deepStrictEqual(wf({ discWatchPct: '5' }), ['w-1', 'w-2', 'w-3', 'w-6']);
assert.deepStrictEqual(wf({ discWatchKr: '5' }), ['w-1', 'w-3', 'w-6']);
assert.deepStrictEqual(wf({ discWatch: '' }), []);
assert.deepStrictEqual(wf({ discWatch: '1' }), ['w-4']);
assert.ok(L.RISK_WEIGHTS['Rabatt med overvåket årsak'] > 0 && L.reasonWeight('Mange rabatter med årsakskode', W) > 0);
['Rabatt uten årsak', 'Mange rabatter uten årsak', 'Mange rabatter med overvåket årsak', 'Hull i bongnummer', 'Gjentatte kassadifferanser', 'Retur og kassadifferanse henger sammen', 'Medlem uten kjøpeutbytte', 'Kjøpeutbytte avviker fra varesum',
  'Linjer stemmer ikke med totalen', 'Betaling stemmer ikke med totalen', 'MVA stemmer ikke', 'Ugyldig MVA-sats', 'Samme betalingsreferanse på flere bonger', 'Spesialbetaling på bong', 'Mange spesialbetalinger'].forEach(k => assert.ok(!(k in L.RISK_WEIGHTS), 'fjernet: ' + k));
['maxGap', 'diffRepeatN', 'diffMin', 'diffTotal', 'corrRho', 'corrDays', 'discPct', 'discMatchNR', 'discWatchN', 'kuMissing', 'kuDiffPct', 'kuDiffKr', 'evOn', 'lineTol', 'payTol', 'vatOn', 'vatTol', 'vatRates', 'refDup', 'specialWords', 'specialN', 'campBongs', 'campCashiers', 'campDay']
  .forEach(k => assert.ok(!(k in L.defaultControl()), 'fjernet terskel: ' + k));
assert.deepStrictEqual([L.defaultControl().evWords, L.defaultControl().discCashN], ['', '3'], 'hendelsesord er en tom liste brukeren setter opp selv');
// innstillingsgrupper: hver terskel, avviksgrense og vekt ligger i nøyaktig én gruppe
const sgFields = L.SETTING_GROUPS.flatMap(g => g.fields.map(f => f.src + ':' + f.k));
assert.strictEqual(new Set(sgFields).size, sgFields.length, 'ingen felt i to grupper');
assert.deepStrictEqual(L.CONTROL_FIELDS.map(f => 'ctl:' + f[0]).filter(k => !sgFields.includes(k)), [], 'alle terskler har en gruppe');
assert.deepStrictEqual(Object.keys(L.defaultAnom()).map(k => 'anom:' + k).filter(k => !sgFields.includes(k)), [], 'alle avviksgrenser har en gruppe');
assert.deepStrictEqual(sgFields.filter(k => k.startsWith('ctl:') && !(k.slice(4) in L.defaultControl())), [], 'ukjent terskel i gruppe');
const sgWeights = L.SETTING_GROUPS.flatMap(g => g.weights);
assert.strictEqual(new Set(sgWeights).size, sgWeights.length);
assert.deepStrictEqual(Object.keys(L.RISK_WEIGHTS).filter(k => !sgWeights.includes(k)), [], 'alle vekter har en gruppe');
assert.deepStrictEqual(sgWeights.filter(k => !(k in L.RISK_WEIGHTS)), []);
assert.strictEqual(new Set(L.SETTING_GROUPS.map(g => g.id)).size, L.SETTING_GROUPS.length);
assert.ok(L.SETTING_GROUPS.every(g => g.title && g.text !== undefined));
assert.strictEqual(L.groupForReason('Stor panteretur (300 kr)'), 'bong');
assert.strictEqual(L.groupForReason('Rabatt med overvåket årsak'), 'disc');
assert.strictEqual(L.groupForReason('Regel: Min regel'), 'rules');
assert.strictEqual(L.groupForReason('Ukjent test'), null);
const gBong = L.SETTING_GROUPS.find(g => g.id === 'bong'), gDisc = L.SETTING_GROUPS.find(g => g.id === 'disc');
const sgW = L.sanitizeWeights(null);
assert.strictEqual(L.groupChanges(gBong, L.defaultControl(), L.defaultAnom(), sgW), 0);
assert.strictEqual(L.groupChanges(gBong, L.defaultControl(), Object.assign(L.defaultAnom(), { bigReturn: '' , cashNoSale: false }), Object.assign({}, sgW, { 'Stor panteretur': 9 })), 3);
assert.strictEqual(L.groupChanges(gDisc, Object.assign(L.defaultControl(), { discWatch: '' }), L.defaultAnom(), sgW), 1);
assert.ok(L.SETTING_GROUPS.every(g => g.fields.every(f => ['num', 'time', 'text', 'flag'].includes(f.kind) && ['ctl', 'anom'].includes(f.src))));

{
// ---- v4: kjøpeutbytte, hendelsesord og ukjente linjer ----
const v4p = L.parseReceipt([
  ['Beskrivelse', '', 'Beløp'], ['7000111 VARE A', '', '100.00'], ['Subtotal', 'Totalt', '100.00'],
  ['Parkert bong gjenopptatt'], ['Linje annullert av kasserer', '', '-10.00'], ['Referanse: 4411'],
  ['Grunnlag', 'Kjøpeutbytte', 'MVA bonus'], ['100.00', '2.00', '0.40'], ['Bank:', '', '100.00'], ['Merkelig linje 77']
]);
assert.strictEqual(v4p.v, 6);
assert.deepStrictEqual(v4p.ku, { g: 100, k: 2, m: 0.4 });
assert.deepStrictEqual(v4p.ev.map(e => e.k), ['parker', 'annull']);
assert.deepStrictEqual(v4p.unk, ['Parkert bong gjenopptatt', 'Linje annullert av kasserer', 'Merkelig linje #']);
assert.deepStrictEqual(v4p.pay, { Bank: 100 });
assert.ok(L.hasV4(v4p) && !L.hasV4({ v: 3 }) && !L.hasV4(L.parseSettlement([])) && !L.hasV4(null));
assert.strictEqual(L.parseReceipt([['7000 VARE VANLIG PARKER', '', '5.00']]).ev, undefined, 'varenavn gir ikke hendelsesord');
assert.strictEqual(L.parseReceipt([['Grunnlag', 'Kjøpeutbytte'], ['Totalt', '5.00']]).ku.k, 0);

// ---- medlemsnummer (kun fra listen) ----
let mseq = 0;
const R4 = (store, ws, cashier, day, time, total, member) => ({ transactionId: `${store}-${ws}-${++mseq}`, endDateTime: `${day} ${time}`, storeNumber: store, workstationNumber: ws, cashierNumber: cashier, totalAmount: total, receiptType: 1, memberNumber: member || null, journalSourceName: 'main' });
const mpop = [];
for (let i = 0; i < 30; i++) mpop.push(R4(1005, 1 + (i % 3), ['10', '11', '12'][i % 3], '2026-10-0' + (1 + (i % 5)), '1' + (i % 10) + ':05', 100 + i, null));
const x1a = R4(1005, 1, '10', '2026-10-01', '10:00', 50, 'M1'), x1b = R4(1010, 2, '11', '2026-10-01', '10:20', 60, 'M1'), x1c = R4(1010, 2, '11', '2026-10-01', '13:00', 60, 'M1');
const d4 = [1, 2, 3, 4].map(i => R4(1005, 1, ['10', '11'][i % 2], '2026-10-02', String(6 + i).padStart(2, '0') + ':10', 70, 'M2'));
const c5 = [1, 2, 3, 4, 5, 6].map(i => R4(1005, 3, '12', '2026-10-0' + i, '12:00', 80, 'M3'));
const c5x = R4(1005, 1, '10', '2026-10-03', '12:30', 80, 'M3');
const e1 = R4(1005, 1, '10', '2026-10-04', '09:00', 40, 'E1'), e2 = R4(1005, 1, '12', '2026-10-04', '09:30', 41, 'E2'), e3 = R4(1005, 1, '11', '2026-10-04', '09:40', 42, 'E2');
const all = mpop.concat([x1a, x1b, x1c], d4, c5, [c5x, e1, e2, e3]);
const mcfg = Object.assign(L.defaultControl(), { memberN: '', empMembers: '' });
const mc = L.memberChecks(all, all, mcfg);
const mf = (code) => mc.findings.filter(f => f.code === code);
assert.deepStrictEqual(mf('memberStores').map(f => f.ids), [[x1a.transactionId, x1b.transactionId]]);
assert.match(mf('memberStores')[0].detail, /Medlemsnr M1: butikk 1005 2026-10-01 10:00 og butikk 1010 10:20 \(innen 30 min\)/);
assert.deepStrictEqual(mf('memberDay').map(f => f.ids.length), [4]);
assert.match(mf('memberDay')[0].detail, /Medlemsnr M2: 4 bonger 2026-10-02/);
assert.deepStrictEqual(mf('memberCash').map(f => f.ids.length), [6]);
assert.match(mf('memberCash')[0].detail, /Medlemsnr M3: 6 av 7 bonger \(86 %\) hos kasserer 12/);
assert.strictEqual(mf('memberMany').length, 0, 'tom grense slår testen av');
assert.strictEqual(mf('empOwn').length + mf('empUse').length, 0, 'ansattliste er tom');
assert.ok(mc.findings.every(f => f.flag === true && f.ids.length));
assert.ok(mc.rows.find(r => r.id === 'M3').flags.includes('én kasserer'));
const mc2 = L.memberChecks(all, all, Object.assign({}, mcfg, { memberN: '7', memberStoreMin: '', memberDayN: '', memberCashN: '', empMembers: '12=E2, E1' }));
assert.deepStrictEqual(mc2.findings.map(f => f.code).sort(), ['empOwn', 'empUse', 'empUse', 'memberMany']);
assert.deepStrictEqual(mc2.findings.find(f => f.code === 'empOwn').ids, [e2.transactionId]);
assert.deepStrictEqual(mc2.findings.filter(f => f.code === 'empUse').map(f => f.ids.length).sort(), [1, 1]);
assert.strictEqual(L.memberKey({ memberNumber: { number: 55 } }), '55');
assert.strictEqual(L.memberKey({ memberNumber: null }), '');
// butikkdominerende kasserer er ikke mistenkelig: andelen må være minst 1,5 × kassererens vanlige andel
const dom = [];
for (let i = 0; i < 20; i++) dom.push(R4(1005, 1, '10', '2026-10-01', '10:00', 90, i < 6 ? 'M9' : null));
assert.strictEqual(L.memberChecks(dom, dom, Object.assign({}, mcfg, { memberStoreMin: '', memberDayN: '' })).findings.length, 0);

// ---- pris per vare ----
const sc4 = (lines, extra) => Object.assign({ v: 4, items: lines, pay: {}, np: lines.length, neg: 0, sale: 0, ret: 0, saleLines: 0, retLines: 0, disc: 0, discN: 0, discNR: 0, discNRsum: 0, coupons: [] }, extra || {});
const pitems = [], pscan = {};
const EAN = '7000000000001';
for (let i = 0; i < 8; i++) {
  const it = R4(1005, 1, i < 4 ? '10' : '11', '2026-10-05', '1' + i + ':00', 12.9, null);
  pitems.push(it);
  pscan[it.transactionId] = sc4([{ c: EAN, n: 'MELK 1L', a: 12.9 }]);
}
const lowA = R4(1005, 1, '12', '2026-10-05', '15:00', 8, null), lowB = R4(1005, 1, '12', '2026-10-05', '15:10', 8, null), lowC = R4(1005, 1, '12', '2026-10-05', '15:20', 6, null);
[lowA, lowB, lowC].forEach(it => pitems.push(it));
pscan[lowA.transactionId] = sc4([{ c: EAN, n: 'MELK 1L', a: 8 }]);
pscan[lowB.transactionId] = sc4([{ c: EAN, n: 'MELK 1L', a: 8 }]);
pscan[lowC.transactionId] = sc4([{ c: EAN, n: 'MELK 1L', a: 4, d: 2, p: 6 }]);
const withDisc = R4(1005, 1, '10', '2026-10-05', '16:00', 10.9, null);
pitems.push(withDisc);
pscan[withDisc.transactionId] = sc4([{ c: EAN, n: 'MELK 1L', a: 10.9, d: 2 }, { c: '220', n: 'PANT', a: 2 }, { c: '7000000000002', n: 'RETURVARE', a: -5 }]);
const pr = L.priceDeviation(pitems, pitems, pscan, L.defaultControl());
assert.deepStrictEqual(pr.findings.filter(f => f.code === 'priceDev').map(f => f.ids[0]).sort(), [lowA, lowB, lowC].map(f => f.transactionId).sort());
assert.match(pr.findings.find(f => f.ids[0] === lowA.transactionId).detail, /MELK 1L kr 8\.00 mot vanlig 12\.90 \(−38 %\)/);
assert.ok(!pr.findings.some(f => f.ids[0] === withDisc.transactionId), 'rabatt legges tilbake i enhetsprisen');
assert.deepStrictEqual(pr.findings.filter(f => f.code === 'priceCash').map(f => [f.cashier, f.flag]), [['12', false]]);
assert.strictEqual(pr.coverage, 1);
assert.strictEqual(L.priceDeviation(pitems, pitems, pscan, Object.assign(L.defaultControl(), { priceDevPct: '' })).findings.length, 0);
assert.strictEqual(L.priceDeviation(pitems, pitems, pscan, Object.assign(L.defaultControl(), { priceMinN: '20' })).findings.length, 0, 'for få salg gir ingen referansepris');
assert.strictEqual(L.priceDeviation([lowA], pitems, pscan, L.defaultControl()).findings.filter(f => f.code === 'priceDev').length, 1, 'bare omfanget flagges, referansen bruker alle');
const pOld = Object.assign({}, pscan, { [lowA.transactionId]: Object.assign({}, pscan[lowA.transactionId], { v: 3 }) });
assert.ok(L.priceDeviation(pitems, pitems, pOld, L.defaultControl()).coverage < 1, 'v3-skanninger har ikke enhetspris');

// ---- hendelsesord og diagnostikk ----
const evIt = R4(1005, 1, '10', '2026-10-07', '09:00', 10, null), evIt2 = R4(1005, 1, '11', '2026-10-07', '09:05', 10, null);
const evScan = { [evIt.transactionId]: sc4([], { ev: [{ k: 'annull', t: 'Linje annullert' }], unk: ['Linje annullert', 'Rar tekst'] }), [evIt2.transactionId]: sc4([], { unk: ['Rar tekst'] }), old: { v: 3, items: [] } };
const evCfg = (w) => Object.assign(L.defaultControl(), { evWords: w });
const ew0 = L.eventWords([evIt, evIt2], evScan, L.defaultControl());
assert.deepStrictEqual([ew0.findings.length, ew0.hits, ew0.words], [0, 0, []], 'tom liste: av');
const ew = L.eventWords([evIt, evIt2], evScan, evCfg('annullert'));
assert.deepStrictEqual(ew.findings.map(f => [f.title, f.flag, f.ids[0]]), [['Hendelsesord på bong', true, evIt.transactionId]]);
assert.match(ew.findings[0].detail, /Kasse 1 09:00 kasserer 10: «Linje annullert» \(tekst\)/);
assert.deepStrictEqual([ew.hits, ew.scanned, ew.byWord['annullert'].bongs], [1, 2, 1]);
assert.strictEqual(L.eventWords([evIt, evIt2], evScan, evCfg('rar tekst, annullert')).findings.length, 2, 'egne ord treffer også andre tekstlinjer');
assert.strictEqual(L.eventWords([evIt, evIt2], evScan, evCfg('annull')).findings.length, 0, 'hele ord');
const evCov = L.eventWords([evIt], evScan, evCfg('annullert'), { [evIt.transactionId]: true });
assert.strictEqual(evCov.findings.length, 1, 'andre ord enn spør pris og manuell telles også på dekkede bonger');
const evCov2 = L.eventWords([evIt], { [evIt.transactionId]: sc4([], { ev: [{ k: 'manuell', t: 'Manuell pris' }] }) }, evCfg('manuell'), { [evIt.transactionId]: true });
assert.deepStrictEqual([evCov2.findings.length, evCov2.covered], [0, 1], 'manuell og spør pris er dekket av egne tester');
const evPay = L.eventWords([evIt], { [evIt.transactionId]: sc4([{ c: '1', n: 'Gavekort', a: 100 }], { pay: { 'Eget forbruk': 30 } }) }, evCfg('eget forbruk, gavekort'));
assert.match(evPay.findings[0].detail, /«Eget forbruk» \(betaling, 30\.00 kr\), «Gavekort» \(linje, 100\.00 kr\)/);
assert.strictEqual(L.matches(evIt, F({ event: '*' }), { scan: { [evIt.transactionId]: evScan[evIt.transactionId] }, evWords: 'annullert' }), true);
assert.strictEqual(L.matches(evIt2, F({ event: 'annullert' }), { scan: { [evIt2.transactionId]: evScan[evIt2.transactionId] }, evWords: 'annullert' }), false);
assert.strictEqual(L.matches(evIt, F({ event: '*' }), { scan: { [evIt.transactionId]: evScan[evIt.transactionId] }, evWords: '' }), false, 'tom liste gir ingen treff');
const dg = L.diagnostics(evScan);
assert.deepStrictEqual([dg.total, dg.v4], [3, 2]);
assert.deepStrictEqual(dg.unk.map(u => [u.t, u.n]), [['Rar tekst', 2], ['Linje annullert', 1]]);
assert.deepStrictEqual(dg.ev.map(e => [e.k, e.n, e.id]), [['annull', 1, evIt.transactionId]]);
assert.ok(!('ku' in dg));
assert.strictEqual(L.groupForReason('Kasserer bruker eget medlemsnr'), 'member');
assert.strictEqual(L.groupForReason('Hendelsesord på bong'), 'events');
assert.strictEqual(L.groupForReason('Mange rabatter med årsakskode'), 'disc');
assert.strictEqual(L.groupForReason('Kontant tilbake uten salg flere ganger'), 'bong');
assert.strictEqual(L.groupForReason('Mange avvikende priser'), 'price');
}


// ---- klokkeslett: liste mot bong ----
{
  assert.strictEqual(L.localDT('2026-10-02T20:04:00Z'), '2026-10-02 22:04:00', 'sommertid +2');
  assert.strictEqual(L.localDT('2026-01-15T10:00:00.123Z'), '2026-01-15 11:00:00', 'vintertid +1');
  assert.strictEqual(L.localDT('2026-10-02T20:04Z'), '2026-10-02 22:04', 'sekunder bare hvis kilden har dem');
  assert.strictEqual(L.localDT('2026-10-02T22:04:00+02:00'), '2026-10-02 22:04:00');
  assert.strictEqual(L.localDT('2026-10-02T20:04:00+0000'), '2026-10-02 22:04:00');
  assert.strictEqual(L.localDT('2026-10-02T22:04:00'), '2026-10-02 22:04:00', 'uten tidssone regnes som lokal tid');
  assert.strictEqual(L.localDT('2026-10-02 22:04'), '2026-10-02 22:04');
  assert.strictEqual(L.localDT(new Date('2026-10-02T20:04:00Z')), '2026-10-02 22:04:00');
  assert.strictEqual(L.localDT(null), '');
  assert.strictEqual(L.localDT('ukjent'), 'ukjent');
  assert.deepStrictEqual(L.parseDT(L.localDT('2026-10-02T21:59:00Z')), { date: '2026-10-02', time: '23:59' });
  assert.deepStrictEqual(L.parseDT(L.localDT('2026-10-02T22:30:00Z')), { date: '2026-10-03', time: '00:30' }, 'over midnatt');
  assert.strictEqual(L.parseCellDT('02.10.2026 22:04:15'), '2026-10-02 22:04:15');
  // sekunder tas bare med når listen viser dem (S1: tidligere ble :00 fylt inn)
  assert.strictEqual(L.parseCellDT(' 2.10.2026, 9:05 '), '2026-10-02 09:05');
  assert.strictEqual(L.parseCellDT('2026-10-02 22:04'), '2026-10-02 22:04');
  assert.strictEqual(L.parseCellDT('02.10.2026 22:04:00'), '2026-10-02 22:04:00');
  // rådata med sekunder brukes når de er samme minutt som listen viser
  assert.strictEqual(L.mergeDT('2026-10-02 22:04', '2026-10-02 22:04:37'), '2026-10-02 22:04:37');
  assert.strictEqual(L.mergeDT('2026-10-02 22:04', '2026-10-02 22:05:37'), '2026-10-02 22:04', 'annet minutt: listen vinner');
  assert.strictEqual(L.mergeDT('2026-10-02 22:04:15', '2026-10-02 22:04:37'), '2026-10-02 22:04:15', 'listen med sekunder vinner');
  assert.strictEqual(L.mergeDT('', '2026-10-02 22:04:37'), '2026-10-02 22:04:37');
  assert.strictEqual(L.mergeDT('', ''), '');
  assert.strictEqual(L.parseCellDT('02.10.2026'), '', 'uten klokkeslett brukes ikke');
  assert.strictEqual(L.headerDT('Butikk: 1001, Kassenr: 2 Kvittering: 2371 02.10.2026 22:03:10 Medlemsnr.: 5'), '2026-10-02 22:03:10');
  assert.strictEqual(L.headerDT('ingen topptekst'), '');
  assert.strictEqual(L.shiftDT('2026-10-02 23:30', 60), '2026-10-03 00:30');
  assert.strictEqual(L.shiftDT('2026-10-02 23:30:15', -60), '2026-10-02 22:30:15');
  assert.strictEqual(L.shiftDT('2026-10-02 00:10', -20), '2026-10-01 23:50');
  assert.strictEqual(L.shiftDT('2026-10-02 10:00', 0), '2026-10-02 10:00');
  const tcItems = [], tcScan = {};
  for (let i = 0; i < 8; i++) { const id = 'tc-' + i; tcItems.push({ transactionId: id, endDateTime: '2026-10-02 20:' + String(10 + i) }); tcScan[id] = { v: 4, hd: '2026-10-02 22:' + String(10 + i) + ':30' }; }
  tcItems.push({ transactionId: 'tc-x', endDateTime: '2026-10-02 20:00' });
  const tc = L.timeCheck(tcItems, tcScan);
  assert.deepStrictEqual([tc.n, tc.same, tc.median, tc.suggest], [8, 0, 120, 120]);
  assert.strictEqual(tc.sample.diff, 120);
  tcItems.forEach((it) => { it.endDateTime = L.shiftDT(it.endDateTime, 120); });
  assert.deepStrictEqual([L.timeCheck(tcItems, tcScan).same, L.timeCheck(tcItems, tcScan).suggest], [8, null]);
  const few = L.timeCheck(tcItems.slice(0, 3).map((it) => Object.assign({}, it, { endDateTime: '2026-10-02 20:10' })), tcScan);
  assert.strictEqual(few.suggest, null, 'for få bonger til å foreslå');
  assert.strictEqual(L.timeCheck(tcItems, {}).n, 0);
}


// ---- herding (revisjonsfunn F1–F9, F12) ----
{
  const T = (a, c) => [a, '', c];
  // F1 CSV-injeksjon
  const csv = L.toCsv([['=HYPERLINK("x")', '+1+1', '@SUM(1)', '\t=1', '-5', '-12,50', '+3', '1 234,50', 'vanlig', '- punkt', 12, null]]).slice(1);
  assert.strictEqual(csv, '"\'=HYPERLINK(""x"")";\'+1+1;\'@SUM(1);\'\t=1;-5;-12,50;+3;1 234,50;vanlig;\'- punkt;12;');
  // F2 skjulte tegn og normalisering
  assert.deepStrictEqual(L.parseReceipt([T('Bank​ :', '10.00'), T('Bank:', '5.00')]).pay, { Bank: 15 });
  const nfd = L.parseReceipt([T('7000 VARE', '10.00'), ['Rabatt: Kr 5.00 (50%)'], ['Rabatt årsak: Datovare']]).items[0];
  assert.strictEqual(nfd.dr, 'Datovare', 'oppløst å gir samme årsak');
  assert.strictEqual(L.cleanText(' A​B C‮D '), 'AB CD');
  assert.strictEqual(L.parseSettlement([['Kontant​:', '', '100.00'], ['Sum', '', '100.00']]).settle.telt.kontant, 100);
  // F3 beløpsparser
  const amt = { '1 000.00': 1000, '1 000,50': 1000.5, '1.234,56': 1234.56, '1,000.50': 1000.5, '−5.00': -5, '–5.00': -5, '5.00-': -5, '(5.00)': -5, '+1.00': 1, '1.234.567': 1234567, '12.345': 12.345, '-0.00': 0 };
  Object.keys(amt).forEach((k) => assert.strictEqual(L.parseAmount(k), amt[k], k));
  ['1e3', '', 'Kr 5.00', 'Infinity', '--5', '0x10', '١٢'].forEach((k) => assert.strictEqual(L.parseAmount(k), null, 'null: ' + k));
  assert.strictEqual(L.parseReceipt([T('7000 VARE', '−10.00')]).items[0].a, -10);
  // F4 størrelsesgrenser
  const many = []; for (let i = 0; i < 800; i++) many.push(T('7000000000001 ' + 'N'.repeat(300), '1.00'));
  many.push(['Rabatt: Kr 0.50 (50%)']);
  for (let i = 0; i < 40; i++) many.push(T('Betaling' + i + ':', '1.00'));
  const big = L.parseReceipt(many);
  assert.deepStrictEqual([big.items.length, big.trunc, big.np], [500, 300, 800]);
  assert.ok(big.items.every((x) => x.n.length === 80));
  assert.strictEqual(Object.keys(big.pay).length, 20);
  assert.deepStrictEqual([big.disc, big.discN], [0.5, 1], 'rabatt på bortkortet linje telles');
  assert.ok(JSON.stringify(big).length < 120000);
  // F6 datovalidering
  ['2026-02-31 10:00', '2026-13-01 10:00', '2026-10-02 24:00', '2026-10-02 10:60'].forEach((x) => assert.deepStrictEqual(L.parseDT(x), { date: '', time: '' }, x));
  assert.deepStrictEqual(L.parseDT('2028-02-29 23:59'), { date: '2028-02-29', time: '23:59' });
  assert.deepStrictEqual(L.parseDT('2026-02-29 12:00'), { date: '', time: '' }, 'ikke skuddår');
  ['31.02.2026 10:00', '02.10.2026 25:99', '2026-02-30 10:00'].forEach((x) => assert.strictEqual(L.parseCellDT(x), '', x));
  assert.strictEqual(L.mins('25:99'), null);
  assert.strictEqual(L.mins('00:00'), 0);
  // F7 medlemsnr
  assert.deepStrictEqual(['007', 7, ' 7 ', '0', 'm1', '75 1', '', null].map((m) => L.memberKey({ memberNumber: m })), ['7', '7', '7', '0', 'M1', '751', '', '']);
  // F8 og F9
  assert.strictEqual(L.findDuplicates([{ transactionId: 'a', totalAmount: 0, endDateTime: '2026-10-02 10:00' }, { transactionId: 'b', totalAmount: 0, endDateTime: '2026-10-02 10:00' }]).groups.length, 0);
  assert.deepStrictEqual(L.sumSelected([{ totalAmount: 1 }, { totalAmount: NaN }, { totalAmount: Infinity }, { totalAmount: 2.5 }]), { count: 4, sum: 3.5, skipped: 2 });
  assert.deepStrictEqual(L.sumSelected([{ totalAmount: 1 }]), { count: 1, sum: 1 });
  // F12 grense på innstillinger
  assert.strictEqual(L.sanitizeControl({ memberN: 'x'.repeat(5000) }).memberN.length, 200);
  assert.strictEqual(L.sanitizeAnom({ bigReturn: 'y'.repeat(5000) }).bigReturn.length, 200);
  assert.strictEqual(L.headerSeq('Butikk: 1 Kvittering: 2371 02.10.2026 22:03'), 2371);
  assert.strictEqual(L.headerSeq('ingenting'), null);
}


// ---- parser: Totalt, Øreavrunding, referanser og MVA-tabell ----
{
  const T = (a, c) => [a, '', c];
  const f2 = (n) => n.toFixed(2);
  let seq = 0;
  const mkRows = (o) => {
    const rows = o.lines.map((a, i) => T(`70000000000${i + 1} VARE ${i + 1}`, f2(a)));
    rows.push(['', 'Totalt', f2(o.tot)]);
    if (o.rnd !== undefined) rows.push(['Øreavrunding', f2(o.rnd)]);
    Object.keys(o.pay || {}).forEach((k) => rows.push(T(k + ':', f2(o.pay[k]))));
    (o.rf || []).forEach((r) => rows.push([r]));
    if (o.mva) { rows.push(['MVA-grunnlag', 'MVA-%', 'MVA', 'Sum']); o.mva.forEach((v) => rows.push([f2(v[0]), v[1] + ' %', f2(v[2]), f2(v[3])])); }
    return rows;
  };
  // parser: Totalt, Øreavrunding, referanser og MVA-tabell fra den virkelige bongen
  const real = L.parseReceipt([T('7071862047727 LINEA GAVEBÅND 20M', '4.36'), T('5712 APPELSIN', '28.41'), ['', 'Totalt', '72.77'], ['Øreavrunding', '-0.30'], T('Coopay:', '72.77'), ['TransId: DK7TVRW5F2PC5'],
    ['MVA-grunnlag', 'MVA-%', 'MVA', 'Sum'], ['35.49', '25 %', '8.87', '44.36', ''], ['25.00', '15 %', '3.75', '28.75', '']]);
  assert.deepStrictEqual([real.tot, real.rnd, real.rf], [72.77, -0.3, ['T:DK7TVRW5F2PC5']]);
  assert.deepStrictEqual(real.mv, [{ g: 35.49, r: 25, m: 8.87, s: 44.36 }, { g: 25, r: 15, m: 3.75, s: 28.75 }]);
}


// ---- RRS 0–100 og krymping i kassererprofilen ----
{
  assert.deepStrictEqual([0, 4, 8, 9, 16, 24, 40, -5, NaN, null, 1e9].map((p) => L.rrs(p)), [0, 29, 50, 54, 75, 88, 97, 0, 0, 0, 100]);
  assert.strictEqual(L.riskLevel(8), 'høy');
  assert.ok(L.rrs(8) >= 50 && L.rrs(7) < 50 && L.rrs(4) >= 25 && L.rrs(3) < 25, 'RRS 50 = høy, 25 = middels');
  const mkS = (cashier, n, rets) => { const out = []; for (let i = 0; i < n; i++) out.push({ transactionId: cashier + '-' + i, endDateTime: '2026-10-02 10:00', storeNumber: 1, workstationNumber: 1, cashierNumber: cashier, receiptType: 1, totalAmount: i < rets ? -50 : 100 }); return out; };
  // butikk: kasserer A 300 bonger med 15 retur (5 %), B 5 bonger med 1 retur (20 %), C 40 bonger med 16 retur (40 %)
  const sItems = mkS('A', 300, 15).concat(mkS('B', 5, 1), mkS('C', 40, 16));
  const raw = L.profiles(sItems, {}, Object.assign(L.defaultControl(), { profShrink: '' }));
  const shr = L.profiles(sItems, {}, L.defaultControl());
  const fl = (p, id) => p.rows.find((r) => r.id === id).flags.retShare;
  assert.deepStrictEqual([fl(raw, 'B'), fl(raw, 'C')], [true, true], 'rå tall flagger begge');
  assert.deepStrictEqual([fl(shr, 'B'), fl(shr, 'C')], [false, true], 'krymping fjerner treffet for 5 bonger, beholder 40 bonger');
  assert.strictEqual(L.sanitizeControl({}).profShrink, '10');
}


// ---- siste siffer og løpenummer mot tid ----
{
  // χ²-fordelingen og Spearman
  const near = (a, b, e) => Math.abs(a - b) <= e;
  assert.ok(near(L.chiSqP(16.919, 9), 0.05, 0.0005) && near(L.chiSqP(21.666, 9), 0.01, 0.0002) && near(L.chiSqP(27.877, 9), 0.001, 0.00002) && near(L.chiSqP(3.841, 1), 0.05, 0.0005) && L.chiSqP(0, 5) === 1);
  assert.ok(!('spearman' in L) && !('retDiffCorr' in L) && !('diffTrend' in L), 'kassadifferanse over tid er fjernet');
  // siste siffer
  const even = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10];
  assert.ok(L.lastDigitTest(even.map((x) => x / 2), even).p > 0.99, 'samme fordeling gir høy p');
  assert.ok(L.lastDigitTest([60, 0, 0, 0, 0, 0, 0, 0, 0, 0], even.map((x) => x / 100)).p < 1e-10, 'andeler fungerer som grunnlag');
  assert.ok(L.lastDigitTest([60, 0, 0, 0, 0, 0, 0, 0, 0, 0], [20, 20, 20, 20, 20, 20, 20, 20, 20, 20]).p < 1e-10);
  assert.strictEqual(L.lastDigitTest([0, 0, 0, 0, 0, 0, 0, 0, 0, 0], even), null);
  const mkN = (cashier, n, f) => { const o = []; for (let i = 0; i < n; i++) o.push({ transactionId: cashier + '-' + i, endDateTime: '2026-10-02 10:00', storeNumber: 1, workstationNumber: 1, cashierNumber: cashier, receiptType: 1, totalAmount: f(i) }); return o; };
  const dItems = mkN('A', 60, (i) => 100 + i + 0.9 - 0.9 + 0.1 * 0).concat(mkN('B', 100, (i) => 100 + i + (i % 10) / 100), mkN('C', 100, (i) => 200 + i + ((i * 3) % 10) / 100));
  const dn = L.numbers(dItems, {}, L.defaultControl());
  const rowOf = (id) => dn.cashiers.find((c) => c.id === id);
  assert.deepStrictEqual([rowOf('A').flagDigit, rowOf('B').flagDigit, rowOf('C').flagDigit], [true, false, false]);
  assert.ok(rowOf('A').digitP < 1e-6 && rowOf('B').digitP > 0.001);
  const dfind = dn.findings.filter((f) => f.code === 'digit');
  assert.deepStrictEqual(dfind.map((f) => [f.cashier, f.flag, f.title]), [['A', false, 'Avvikende siste siffer']]);
  assert.match(dfind[0].detail, /Kasserer A: siste siffer i totalbeløpet avviker fra de andre kassererne \(χ² [\d.]+, p < 0,0001, 60 bonger; vanligste siffer 0 hos 100 %\)/);
  assert.strictEqual(L.numbers(dItems, {}, Object.assign(L.defaultControl(), { digitP: '' })).findings.filter((f) => f.code === 'digit').length, 0);
  assert.strictEqual(L.numbers(dItems, {}, Object.assign(L.defaultControl(), { digitMin: '70' })).cashiers.find((c) => c.id === 'A').digitP, null);
  // løpenummer mot tid
  const mkQ = (n, t, day) => ({ transactionId: '1001-1-' + n, endDateTime: (day || '2026-10-02') + ' ' + t, storeNumber: 1001, workstationNumber: 1, cashierNumber: 'A', receiptType: 1, totalAmount: 10 });
  const qs = [];
  for (let i = 0; i < 12; i++) qs.push(mkQ(100 + i, i === 5 ? '09:03' : '14:' + String(i).padStart(2, '0')));
  for (let i = 0; i < 7; i++) qs.push(mkQ(112 + i, '07:' + String(i).padStart(2, '0'), '2026-10-03'));
  const dr = L.deletedReceipts(qs, L.defaultControl());
  assert.deepStrictEqual(dr.findings.filter((f) => f.code === 'seqReg').map((f) => f.ids[0]), ['1001-1-105'], 'bare ett punkt ligger utenfor naboene; dagsskiftet gir ikke treff');
  assert.match(dr.findings.find((f) => f.code === 'seqReg').detail, /Kasse 1: nr 105 kl 09:03 2026-10-02 ligger 299 min fra de nærmeste nabonumrene \(2026-10-02 14:02 – 2026-10-02 14:08\)/);
  assert.ok(dr.findings.find((f) => f.code === 'seqReg').flag);
  assert.strictEqual(dr.findings.filter((f) => f.code === 'timeInversion').length, 0, 'bongen som ligger langt fra naboene telles ikke en gang til som byttet rekkefølge');
  assert.strictEqual(L.deletedReceipts(qs, Object.assign(L.defaultControl(), { seqRegMin: '' })).findings.filter((f) => f.code === 'seqReg').length, 0);
  assert.strictEqual(L.deletedReceipts(qs, Object.assign(L.defaultControl(), { seqRegMin: '400' })).findings.filter((f) => f.code === 'seqReg').length, 0);
  assert.strictEqual(L.deletedReceipts(qs.slice(0, 4), L.defaultControl()).findings.filter((f) => f.code === 'seqReg').length, 0, 'for få naboer');
}

// butikknavn fra cellen i BUTIKK-kolonnen
assert.strictEqual(L.storeNameFromCell('1005', 1005), '');
assert.strictEqual(L.storeNameFromCell('1005 Coop Mega', 1005), 'Coop Mega');
assert.strictEqual(L.storeNameFromCell('1005 – Coop Mega Kolbotn', 1005), 'Coop Mega Kolbotn');
assert.strictEqual(L.storeNameFromCell('Coop Mega (1005)', 1005), 'Coop Mega');
assert.strictEqual(L.storeNameFromCell('Coop Mega', 1005), 'Coop Mega');
assert.strictEqual(L.storeNameFromCell('1006 Coop Mega', 1005), '', 'navn som hører til en annen butikk brukes ikke');
assert.strictEqual(L.storeNameFromCell('', 1005) + L.storeNameFromCell(null, 1005) + L.storeNameFromCell('12', 1005), '');

{
  const mk = (id, ch, ws, tot, mem, raw, cash) => ({ transactionId: id, saleChannel: ch, workstationNumber: ws, totalAmount: tot, memberNumber: mem, rawDT: raw, cashierNumber: cash, storeNumber: 1005, receiptType: 1 });
  const cs = L.channelStats([mk('a-1', 2, 3, 100, 5, '2026-10-02T10:00:00', '10'), mk('a-2', 2, 1, -50, null, '2026-10-02T10:00:00', '11'), mk('a-3', 3, 81, 20, 9, '2026-10-02T10:01:00', '0'), mk('a-4', undefined, 1, 10, null, undefined, '10')]);
  assert.deepStrictEqual(cs.rows.map(r => [r.k, r.n, r.cashiers, r.ws, r.wsList, r.avg, r.member, r.ret]), [['2', 2, 2, 2, '1,3', 25, 50, 1], ['3', 1, 1, 1, '81', 20, 100, 0], ['?', 1, 1, 1, '1', 10, 0, 0]]);
  assert.deepStrictEqual(cs.raw, { n: 3, distinct: 2, type: 'string', sample: '2026-10-02T10:00:00' });
  assert.ok(cs.rows.every(r => typeof r.cashiers === 'number' && !('cashierNumber' in r)), 'bare antall kasserere, ingen kassernumre');
  assert.deepStrictEqual(L.channelStats([]).rows, []);
}

console.log('logic: ok');
