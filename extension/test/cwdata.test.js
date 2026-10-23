// Enhetstester for 3.35.0: linjer merket «(SLETTET)», bongtyper og kanal, og testene på tilleggsdata hentet fra CWs filtre
// (innhold, betaling, innlogging/utlogging, bongkopi) og på svinn og internt forbruk.
const assert = require('assert');
const L = require('../src/logic.js');

let seq = 0;
const bong = (o) => Object.assign({ transactionId: 'T-' + (++seq), endDateTime: '2026-10-22 12:00', storeNumber: 1005, workstationNumber: 1, cashierNumber: 'A', totalAmount: 10, receiptType: 1, saleChannel: 2, memberNumber: null }, o || {});
const mapOf = (pairs) => pairs.reduce((m, [it, s]) => (m[it.transactionId] = s, m), {});

// ---- «(SLETTET)»: linjen står med beløp, men er ikke med i Totalt
{
  const rows = [['Beskrivelse', '', 'Beløp'], ['7038010000010 SALAT CRISPI 150G (SLETTET)', '', '23.94'], ['Rabatt: Kr 15.96 (40.0%)'], ['Rabatt årsak: Datovare'],
    ['7038010000027 MELK 1L', '', '22.90'], ['220 PANT (SLETTET)', '', '2.00'], ['', 'Totalt', '22.90'], ['Bank:', '', '22.90']];
  const s = L.parseReceipt(rows);
  assert.deepStrictEqual(s.items.map((l) => l.n), ['MELK 1L']);
  assert.deepStrictEqual(s.del.map((l) => [l.c, l.n, l.a]), [['7038010000010', 'SALAT CRISPI 150G', 23.94], ['220', 'PANT', 2]]);
  assert.strictEqual(s.np, 1); assert.strictEqual(s.saleLines, 0); assert.strictEqual(s.sale, 0);
  assert.strictEqual(s.discN, 0); assert.strictEqual(s.disc, 0);
  assert.strictEqual(s.del[0].dr, 'Datovare', 'rabatten følger den slettede linjen');
  // bongregnskapet går opp: linjene uten den slettede er lik Totalt
  const it = bong({ totalAmount: 22.9 });
  const g = L.ledger([it], [it], mapOf([[it, s]]), L.defaultControl());
  assert.ok(!g.findings.some((f) => f.code === 'lineSum'));
  // eldre lagret skanning med «(SLETTET)» i items rettes ved lasting, og det skjer bare én gang
  const old = { v: 9, items: [{ c: '7038010000010', n: 'SALAT (SLETTET)', a: 23.94 }, { c: '7038010000027', n: 'MELK', a: 22.9 }], pay: {}, np: 2, neg: 0, sale: 0, ret: 0, saleLines: 0, retLines: 0, disc: 0, discN: 0, discNR: 0, discNRsum: 0, coupons: [] };
  L.splitDeleted(old); L.splitDeleted(old);
  assert.strictEqual(old.np, 1); assert.strictEqual(old.del.length, 1); assert.strictEqual(old.del[0].n, 'SALAT');
  // slettet linje teller som makulert linje, og som slettet overvåket vare
  const cfg = Object.assign(L.defaultControl(), { watchItems: 'salat' });
  const v = L.voidChecks([it], [it], mapOf([[it, s]]), cfg);
  assert.ok(v.findings.some((f) => f.code === 'voidLine' && /SALAT CRISPI 150G \(slettet\)/.test(f.detail)));
  const w = L.watchItems([it], [it], mapOf([[it, s]]), cfg);
  assert.ok(w.findings.some((f) => f.code === 'watchDel'));
  // fritekstsøk finner slettede varer
  assert.ok(L.searchHit(s, it, 'salat slettet'));
  // slettet pantelapp fra pantemaskinen
  const s2 = L.parseReceipt([['399 PANTELAPP (SLETTET)', '', '-50.00'], ['7038010000027 MELK 1L', '', '22.90'], ['', 'Totalt', '22.90']]);
  assert.strictEqual(s2.retLines, 0);
  const lp = L.lappChecks([it], [it], mapOf([[it, s2]]), L.defaultControl());
  assert.ok(lp.findings.some((f) => f.code === 'lappDeleted' && !/motlinje/.test(f.detail)));
}

// ---- bongtyper og kanal
{
  assert.deepStrictEqual([6, 7, 8, 9, 11, 13, 19].map(L.typeLabel), ['Bankavstemming', 'Dagsavslutning (EOD)', 'Innlogging', 'Utlogging', 'Synlig svinn', 'Internt forbruk', 'Bongkopi']);
  assert.strictEqual(L.channelLabel(2), 'Betjent kasse');
  assert.ok(L.isShrink({ receiptType: 11 }) && L.isShrink({ receiptType: 13 }) && !L.isShrink({ receiptType: 1 }));
}

// ---- kassererprofil: hver kasserer mot snittet i egen kanal
{
  const items = [];
  // betjent kasse (kanal 2): A og B, få returer; selvbetjent (kanal 3): S1 og S2 med mange returer
  ['A', 'B'].forEach((c) => { for (let i = 0; i < 20; i++) items.push(bong({ cashierNumber: c, saleChannel: 2, totalAmount: i === 0 ? -10 : 50 })); });
  ['S1', 'S2'].forEach((c) => { for (let i = 0; i < 20; i++) items.push(bong({ cashierNumber: c, saleChannel: 3, totalAmount: i < 6 ? -10 : 50 })); });
  const cfg = Object.assign(L.defaultControl(), { profShrink: '' });
  const p = L.profiles(items, {}, cfg);
  assert.deepStrictEqual(p.channels.map((c) => [c.ch, c.cashiers]), [['2', 2], ['3', 2]]);
  assert.ok(p.rows.every((r) => !r.flags.retShare), 'innen egen kanal skiller ingen seg ut');
  const p2 = L.profiles(items, {}, Object.assign(cfg, { profChannel: '' }));
  assert.ok(p2.rows.filter((r) => r.flags.retShare).map((r) => r.id).join() === 'S1,S2', 'mot butikksnittet blir de selvbetjente røde');
}

// ---- innhold og betaling fra CW per kasserer, og kombinasjoner på samme bong
{
  const items = [], tags = {};
  // fire betjente kasserere med 40 salg; C har slettet vare på 10, de andre på 1
  ['A', 'B', 'C', 'D'].forEach((c) => {
    for (let i = 0; i < 40; i++) {
      const it = bong({ cashierNumber: c, saleChannel: 2, memberNumber: c === 'D' && i === 0 ? '555' : null });
      items.push(it);
      if (i < (c === 'C' ? 10 : 1)) (tags[it.transactionId] = tags[it.transactionId] || []).push('Slettet vare');
      if (c === 'B' && i < 8) (tags[it.transactionId] = tags[it.transactionId] || []).push('Betaling: Kontant');
    }
  });
  const vs = items.find((i) => i.cashierNumber === 'A');
  tags[vs.transactionId].push('Vensafe');
  const emp = items.find((i) => i.cashierNumber === 'D');
  (tags[emp.transactionId] = tags[emp.transactionId] || []).push('Manuell rabatt');
  const cfg = Object.assign(L.defaultControl(), { empMembers: '555' });
  const prof = L.profiles(items, {}, cfg);
  const r = L.cwChecks(items, { tags }, cfg, prof.mainCh);
  assert.ok(r.on);
  assert.strictEqual(r.tagged, 20, 'antall merkede salg (A 1, B 8, C 10, D 1)');
  const rate = r.findings.filter((f) => f.code === 'cwRate');
  assert.deepStrictEqual(rate.map((f) => f.cashier), ['C'], 'bare C har mye slettet vare; kontant sammenlignes ikke');
  assert.match(rate[0].detail, /Slettet vare på 10 av 40 salg \(25 %, de andre i kanalen 2,5 %\)/);
  const combo = r.findings.filter((f) => f.code === 'cwCombo');
  assert.deepStrictEqual(combo.map((f) => f.ids[0]).sort(), [vs.transactionId, emp.transactionId].sort());
  assert.match(combo.find((f) => f.ids[0] === emp.transactionId).detail, /manuell rabatt \+ ansattes medlemsnr/);
  assert.strictEqual(L.cwChecks(items, null, cfg, prof.mainCh).on, false);
  assert.strictEqual(L.cwChecks(items, { tags }, Object.assign({}, cfg, { cwRateN: '', cwComboOn: '' }), prof.mainCh).findings.length, 0);
}

// ---- innlogging: korte økter med retur, og salg på to betjente kasser om hverandre
{
  const sys = [
    { transactionId: 'L1', receiptType: 8, endDateTime: '2026-10-22 13:00', storeNumber: 1005, workstationNumber: 2, cashierNumber: 'X' },
    { transactionId: 'L2', receiptType: 9, endDateTime: '2026-10-22 13:06', storeNumber: 1005, workstationNumber: 2, cashierNumber: 'X' },
    { transactionId: 'L3', receiptType: 8, endDateTime: '2026-10-22 08:00', storeNumber: 1005, workstationNumber: 1, cashierNumber: 'A' },
    { transactionId: 'L4', receiptType: 9, endDateTime: '2026-10-22 16:00', storeNumber: 1005, workstationNumber: 1, cashierNumber: 'A' }
  ];
  const ret = bong({ cashierNumber: 'X', workstationNumber: 2, endDateTime: '2026-10-22 13:03', totalAmount: -199 });
  const items = [ret, bong({ cashierNumber: 'A', workstationNumber: 1, endDateTime: '2026-10-22 12:00' })];
  const ss = L.sessions(sys);
  assert.deepStrictEqual(ss.map((s) => [s.c, s.ws, s.end - s.start]).sort(), [['A', '1', 480], ['X', '2', 6]]);
  const r = L.shiftChecks(items, sys, {}, { tags: { [ret.transactionId]: ['Returnert vare'] } }, L.defaultControl());
  assert.ok(r.hasLogins && r.logins === 2 && r.short === 1);
  const f = r.findings.find((x) => x.code === 'shortLogin');
  assert.deepStrictEqual(f.ids, [ret.transactionId]);
  assert.match(f.detail, /Kasserer X logget inn på kasse 2 2026-10-22 kl\. 13:00 og var logget inn i 6 min \(utlogging kl\. 13:06\): 1 salg, 1 med retur eller sletting/);
  // uten tegn på retur eller sletting: ingen funn
  assert.strictEqual(L.shiftChecks(items, sys, {}, { tags: {} }, L.defaultControl()).short, 0);
  // A … B … A innen 5 min på betjente kasser; ikke på selvbetjente
  const mk = (ws, t, ch) => bong({ cashierNumber: 'K', workstationNumber: ws, endDateTime: '2026-10-22 ' + t, saleChannel: ch });
  const dual = [mk(1, '12:00', 2), mk(3, '12:02', 2), mk(1, '12:04', 2), mk(1, '14:00', 2), mk(3, '14:30', 2)];
  const d = L.shiftChecks(dual, [], {}, null, L.defaultControl());
  assert.strictEqual(d.dual, 1);
  assert.match(d.findings[0].detail, /Kasserer K: salg om hverandre på kasse 1 og 3 innen 5 min, 1 gang \(første 2026-10-22 12:00–12:04\)/);
  assert.strictEqual(d.findings[0].ids.length, 3);
  assert.strictEqual(L.shiftChecks(dual.map((i) => Object.assign({}, i, { saleChannel: 3 })), [], {}, null, L.defaultControl()).dual, 0);
}

// ---- bongkopi: opprinnelig bong, retur av samme vare etterpå, mange kopier
{
  const E = '7038010000010';
  const orig = bong({ transactionId: '1005-1-4711', cashierNumber: 'A', workstationNumber: 1, endDateTime: '2026-10-21 15:00', totalAmount: 89.9 });
  const ret = bong({ cashierNumber: 'B', workstationNumber: 2, endDateTime: '2026-10-22 10:30', totalAmount: -89.9 });
  const other = bong({ cashierNumber: 'B', workstationNumber: 2, endDateTime: '2026-10-22 10:20', totalAmount: -15 });
  const scans = mapOf([[orig, L.parseReceipt([[E + ' RØKELAKS', '', '89.90'], ['', 'Totalt', '89.90']])], [ret, L.parseReceipt([[E + ' RØKELAKS', '', '-89.90'], ['', 'Totalt', '-89.90']])],
    [other, L.parseReceipt([['7038010000027 MELK', '', '-15.00'], ['', 'Totalt', '-15.00']])]]);
  const sys = [{ transactionId: 'C1', receiptType: 19, endDateTime: '2026-10-22 10:10', storeNumber: 1005, workstationNumber: 2, cashierNumber: 'B' }];
  const items = [orig, ret, other];
  const r = L.copyChecks(items, items, sys, { C1: '4711' }, scans, Object.assign(L.defaultControl(), { copyRetMin: '' }));
  assert.strictEqual(r.n, 1); assert.strictEqual(r.found, 1);
  assert.strictEqual(r.copies[0].orig.transactionId, orig.transactionId);
  const f = r.findings.find((x) => x.code === 'copyRet');
  assert.deepStrictEqual(f.ids, [ret.transactionId], 'bare returen med samme vare');
  assert.match(f.detail, /etter bongkopi 2026-10-22 10:10 på kasse 2 \(kasserer B\) av bong 4711: «RØKELAKS» \(7038010000010\) står også på den opprinnelige bongen/);
  // uten skanning: retur hos samme kasserer innen 60 min
  const r2 = L.copyChecks(items, items, sys, { C1: '4711' }, {}, L.defaultControl());
  assert.deepStrictEqual(r2.findings.filter((x) => x.code === 'copyRet').map((x) => x.ids[0]).sort(), [ret.transactionId, other.transactionId].sort(), 'begge returene hos B innen 60 min');
  assert.ok(r2.findings.some((x) => /samme kasserer 10 min etter kopien \(varene er ikke sammenlignet\)/.test(x.detail)));
  // mange kopier
  const many = [1, 2, 3, 4, 5].map((i) => ({ transactionId: 'K' + i, receiptType: 19, endDateTime: '2026-10-22 0' + i + ':00', storeNumber: 1005, workstationNumber: 1, cashierNumber: 'Z' }));
  const r3 = L.copyChecks([bong({ cashierNumber: 'Z' })], [], many, {}, {}, L.defaultControl());
  assert.ok(r3.findings.some((x) => x.code === 'copyMany' && x.cashier === 'Z' && /5 bongkopier/.test(x.detail)));
}

// ---- svinn og internt forbruk
{
  const E = '7038010000010';
  const sv = bong({ receiptType: 11, workstationNumber: 77, cashierNumber: 'P', endDateTime: '2026-10-22 23:40', totalAmount: 1539.1 });
  const ib = bong({ receiptType: 13, workstationNumber: 77, cashierNumber: 'P', endDateTime: '2026-10-22 11:11', totalAmount: 143.6 });
  const ret = bong({ endDateTime: '2026-10-22 18:00', totalAmount: -59.9 });
  const scans = mapOf([
    [sv, L.parseReceipt([[E + ' JORDBÆR 500G', '', '539.10'], ['Antall: 9.000 stk à Kr 59.90'], ['7040913000011 MARLBORO RED', '', '1000.00'], ['', 'Sum', '1539.10']])],
    [ib, L.parseReceipt([['7038010000027 SALAT MIDDELHAV 125G', '', '143.60'], ['', 'Sum', '143.60']])],
    [ret, L.parseReceipt([[E + ' JORDBÆR 500G', '', '-59.90'], ['', 'Totalt', '-59.90']])]
  ]);
  const cfg = Object.assign(L.defaultControl(), { watchItems: 'marlboro' });
  const r = L.shrinkChecks([sv, ib], [ret], scans, cfg);
  assert.strictEqual(r.n, 2); assert.strictEqual(r.kr, 1682.7);
  assert.deepStrictEqual(r.byType, { 'Synlig svinn': { n: 1, kr: 1539.1 }, 'Internt forbruk': { n: 1, kr: 143.6 } });
  const codes = r.findings.map((f) => f.code).sort();
  assert.deepStrictEqual(codes, ['shrinkBig', 'shrinkHours', 'shrinkRet', 'shrinkWatch']);
  assert.match(r.findings.find((f) => f.code === 'shrinkRet').detail, /«JORDBÆR 500G» returnert kl\. 18:00 på kasse 1/);
  assert.strictEqual(r.rows[0].id, 'P'); assert.strictEqual(r.items[0].n, 'MARLBORO RED');
}

// ---- hent i deler: dager og beløpsvinduer
{
  assert.deepStrictEqual(L.dayList('2026-10-30', '2026-11-02'), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.deepStrictEqual(L.dayList('2026-10-02', '2026-10-01'), []);
  assert.strictEqual(L.dayList('2026-01-01', '2026-12-31', 92).length, 92);
  assert.deepStrictEqual(L.splitSum({ min: null, max: null }), [{ min: null, max: 0 }, { min: -0.01, max: 100 }, { min: 99.99, max: 300 }, { min: 299.99, max: null }], 'vinduene overlapper 0,01 kr');
  assert.deepStrictEqual(L.splitSum({ min: -0.01, max: 100 }), [{ min: -0.01, max: 50 }, { min: 49.99, max: 100 }]);
  assert.deepStrictEqual(L.splitSum({ min: 299.99, max: null }), [{ min: 299.99, max: 599.98 }, { min: 599.97, max: null }]);
  assert.deepStrictEqual(L.splitSum({ min: null, max: 0 }), [{ min: null, max: -100 }, { min: -100.01, max: 0 }]);
  assert.deepStrictEqual(L.splitSum({ min: 50, max: 51 }), [], 'kan ikke deles mer');
  assert.strictEqual(L.sumText({ min: 99.99, max: 300 }), '99,99 – 300 kr');
  assert.deepStrictEqual(L.archRow({ transactionId: 'a', endDateTime: '2026-10-22 10:00', totalAmount: 5, memberNumber: '123', toJSON: () => 1, extra: { x: 1 } }), { transactionId: 'a', endDateTime: '2026-10-22 10:00', totalAmount: 5 }, 'medlemsnummer og objekter lagres ikke');
  assert.strictEqual(L.archRow({ x: 1 }), null);
}

console.log('cwdata: ok');
