// Enhetstester for pantelapper (99 manuell, 399 maskin), slettede linjer, spesialbetaling, rabattspenn og kampanje,
// spør pris, kort og manuell kvittering. Alt er rene funksjoner mot skannede bonger.
const assert = require('assert');
const L = require('../src/logic.js');

let seq = 0;
const bong = (o) => Object.assign({ transactionId: 'T-' + (++seq), endDateTime: '2026-10-05 12:00', storeNumber: 1005, workstationNumber: 1, cashierNumber: 'A', totalAmount: 10, receiptType: 1, memberNumber: null }, o || {});
const scanOf = (rows) => L.parseReceipt(rows);
const sc = (lines, o) => Object.assign({ v: 6, items: lines.map((l) => Object.assign({ n: 'VARE' }, l)), pay: {}, np: lines.filter((l) => !/^(99|399|220)$/.test(l.c)).length, neg: 0, sale: 0, ret: 0, saleLines: 0, retLines: 0, disc: 0, discN: 0, discNR: 0, discNRsum: 0, coupons: [] }, o || {});
const CT = () => L.defaultControl();
const EAN = '7038010000010', EAN2 = '7038010000027', EAN3 = '7038010000034', EAN4 = '7038010000041';
const mapOf = (pairs) => pairs.reduce((m, [it, s]) => (m[it.transactionId] = s, m), {});

// ---- parser v6: kort
{
  const r = scanOf([['99 PANTELAPP', '', '-20.00'], ['Visa'], ['Kort: ************1234'], ['Bank:', '', '100']]);
  assert.strictEqual(r.v, 6);
  assert.deepStrictEqual(r.cd, [{ f: '', n: '1234', s: 'visa' }]);
  assert.deepStrictEqual(scanOf([['Bankaxept:', '', '50.00'], ['Kortnr: 492500******4321']]).cd, [{ f: '492500', n: '4321', s: 'bankaxept' }]);
  assert.deepStrictEqual(scanOf([['XXXX XXXX XXXX 9876'], ['Mastercard']]).cd, [{ f: '', n: '9876', s: 'mastercard' }]);
  assert.strictEqual(scanOf([['7000 VARE', '', '10.00'], ['Bank:', '', '10.00']]).cd, undefined);
  assert.strictEqual(scanOf([['7000 XX 1234 VARE', '', '10.00']]).cd, undefined, 'varelinjer leses ikke som kort');
  assert.ok(L.hasV6({ v: 6 }) && !L.hasV6({ v: 5 }) && !L.hasV6({ v: 6, settle: {} }));
}

// ---- pantelapp: 99 manuell, 399 maskin, slettede linjer
{
  assert.strictEqual(L.lappKind({ c: '99', n: 'PANTELAPP' }), 'man');
  assert.strictEqual(L.lappKind({ c: '399', n: 'PANTELAPP' }), 'mach');
  assert.strictEqual(L.lappKind({ c: '12', n: 'PANTELAPP' }), 'other');
  assert.strictEqual(L.lappKind({ c: '220', n: 'PANT' }), null);
  const s1 = sc([{ c: EAN, a: 150 }, { c: EAN, a: -150 }, { c: '399', n: 'PANTELAPP', a: -150 }, { c: '399', n: 'PANTELAPP', a: -20 }, { c: '399', n: 'PANTELAPP', a: 20 }], { retLines: 3, pay: { 'Kontant tilbake': 150 } });
  const cx = L.cancelled(s1);
  assert.deepStrictEqual([cx.itemLines, cx.itemSum, cx.pant.length, cx.pant[0].a, cx.pant[0].k], [1, 150, 1, 20, 1]);
  assert.strictEqual(L.netNp(s1), 0, 'varelinje og motlinje går i null');
  assert.strictEqual(L.netNp(sc([{ c: EAN, a: 10 }])), 1);
  // «Kontant tilbake uten salg» gjelder også når varelinjene er slettet med motlinje
  const cfg = L.defaultAnom();
  assert.ok(L.anomalies(bong(), s1, cfg, [], {}).includes('Kontant tilbake uten salg'));
  assert.ok(L.anomalies(bong(), sc([{ c: '399', n: 'PANTELAPP', a: -50 }], { np: 0, retLines: 1, pay: { 'Kontant tilbake': 50 } }), cfg, [], {}).includes('Kontant tilbake uten salg'));
  assert.ok(!L.anomalies(bong(), sc([{ c: EAN, a: 20 }, { c: '399', n: 'PANTELAPP', a: -50 }], { retLines: 1, pay: { 'Kontant tilbake': 30 } }), cfg, [], {}).includes('Kontant tilbake uten salg'));
}

// ---- lappChecks
{
  const mk = (kasserer, time, lines, day, ws) => { const it = bong({ cashierNumber: kasserer, endDateTime: (day || '2026-10-05') + ' ' + time, workstationNumber: ws || (kasserer === 'A' ? 1 : 2) }); return [it, sc(lines, { retLines: lines.filter((l) => l.a < 0).length, ret: lines.filter((l) => l.a < 0).reduce((a, l) => a + l.a, 0) })]; };
  const lapp = (c, a, n) => ({ c, n: n || 'PANTELAPP', a });
  const set = [
    mk('A', '10:00', [lapp('99', -30), lapp('99', -40)]),            // manuell 70
    mk('A', '10:30', [lapp('99', -60)]),                              // manuell 60
    mk('A', '11:00', [lapp('99', -5)]),                               // manuell under grensen
    mk('B', '11:10', [lapp('399', -45)]),                             // maskin 45
    mk('B', '11:40', [lapp('399', -45)]),                             // samme sum innen 60 min
    mk('B', '15:00', [lapp('399', -45)], null, 3),                    // for sent og på annen kasse
    mk('B', '16:00', [lapp('399', -25), lapp('399', 25)]),            // slettet
    mk('C', '17:00', [lapp('399', -33, 'PANTELAPP 5550001112')]),     // lappnr
    mk('C', '09:00', [lapp('399', -33, 'PANTELAPP 5550001112')], '2026-10-06')
  ];
  const its = set.map((x) => x[0]), map = mapOf(set);
  const r = L.lappChecks(its, its, map, CT());
  const f = (code) => r.findings.filter((x) => x.code === code);
  assert.deepStrictEqual(f('lappManual').map((x) => x.ids[0]).sort(), [its[0], its[1]].map((x) => x.transactionId).sort(), 'manuell fra 50 kr');
  assert.match(f('lappManual')[0].detail, /manuell pantelapp \(kode 99\)/);
  assert.deepStrictEqual(f('lappDeleted').map((x) => x.ids[0]), [its[6].transactionId]);
  assert.match(f('lappDeleted')[0].detail, /1 × pantelapp 25\.00 kr slettet \(linje og motlinje\)/);
  const reuse = f('lappReuse');
  assert.strictEqual(reuse.length, 2, 'samme sum innen 60 min + samme lappnr over to dager');
  assert.ok(reuse.some((x) => x.ids.length === 2 && x.ids.indexOf(its[3].transactionId) !== -1 && x.ids.indexOf(its[4].transactionId) !== -1 && !x.ids.includes(its[5].transactionId)));
  assert.ok(reuse.some((x) => /nr 5550001112/.test(x.detail) && x.ids.length === 2));
  const rowA = r.rows.find((x) => x.id === 'A'), rowB = r.rows.find((x) => x.id === 'B');
  assert.deepStrictEqual([rowA.man.n, rowA.man.sum, rowA.mach.n, rowA.manBongs, rowA.bongs], [4, 135, 0, 3, 3]);
  assert.deepStrictEqual([rowB.mach.n, rowB.mach.sum, rowB.del, rowB.man.n], [4, 160, 1, 0], 'maskinlapper 3 × 45 + 25; den positive 25 er motlinjen');
  assert.strictEqual(r.man.sum, 135);
  // kassererflagg krever antall og høyere andel enn butikken
  assert.strictEqual(f('lappManualCash').length, 0, 'tre manuelle bonger er under grensen 5');
  const r2 = L.lappChecks(its, its, map, Object.assign(CT(), { lappManualN: '3' }));
  assert.deepStrictEqual(r2.findings.filter((x) => x.code === 'lappManualCash').map((x) => [x.cashier, x.flag]), [['A', false]]);
  // av
  const off = L.lappChecks(its, its, map, Object.assign(CT(), { lappManualMin: '', lappDel: '', lappReuseMin: '', lappManualN: '' }));
  assert.strictEqual(off.findings.length, 0);
  // små beløp teller ikke som gjenbruk (pantMin 20)
  const small = [mk('A', '10:00', [lapp('399', -6)]), mk('B', '10:10', [lapp('399', -6)])];
  assert.strictEqual(L.lappChecks(small.map((x) => x[0]), small.map((x) => x[0]), mapOf(small), CT()).findings.length, 0);
  // bare omfanget flagges for manuell pantelapp, men referansen for gjenbruk er alle
  // samme kasse samme dag regnes som samme pantelapp uansett tid (den gamle «samme pantebeløp»-testen)
  const same = [mk('A', '09:00', [lapp('399', -150)]), mk('A', '17:30', [lapp('399', -150)]), mk('A', '17:40', [lapp('399', -150)], null, 4)];
  const sr = L.lappChecks(same.map((x) => x[0]), same.map((x) => x[0]), mapOf(same), CT());
  assert.deepStrictEqual(sr.findings.filter((x) => x.code === 'lappReuse').map((x) => x.ids.length), [3], 'to på samme kasse hele dagen, den tredje innen 60 min');
  // bongsum: ulike lapper, samme sum, bare på bongnivå
  const tot = [mk('A', '10:00', [lapp('399', -50), lapp('399', -50), lapp('399', -50)]), mk('A', '11:00', [lapp('399', -100), lapp('399', -30), lapp('399', -20)])];
  const tr = L.lappChecks(tot.map((x) => x[0]), tot.map((x) => x[0]), mapOf(tot), CT()).findings.filter((x) => x.code === 'lappReuse');
  assert.strictEqual(tr.length, 1);
  assert.match(tr[0].detail, /Pantelapper på til sammen 150\.00 kr innløst på 2 bonger/);
  // gjentatte like lapper på samme bong gir ikke flere funn, og bongsummen gjentar ikke lapp-funnet
  const rep3 = [mk('A', '10:00', [lapp('399', -50), lapp('399', -50), lapp('399', -50)]), mk('A', '10:20', [lapp('399', -50), lapp('399', -50), lapp('399', -50)])];
  assert.strictEqual(L.lappChecks(rep3.map((x) => x[0]), rep3.map((x) => x[0]), mapOf(rep3), CT()).findings.filter((x) => x.code === 'lappReuse').length, 1);
  const part = L.lappChecks([its[3]], its, map, CT());
  assert.strictEqual(part.findings.filter((x) => x.code === 'lappReuse').length, 2);
  assert.strictEqual(part.findings.filter((x) => x.code === 'lappManual').length, 0);
}

// ---- slettede varelinjer, pant og kontant tilbake + makulert EAN
{
  const combo = bong({ cashierNumber: 'K', endDateTime: '2026-10-05 13:00', totalAmount: -150 });
  const sCombo = sc([{ c: EAN3, a: 150 }, { c: EAN3, a: -150 }, { c: '399', n: 'PANTELAPP', a: -150 }], { retLines: 1, pay: { 'Kontant tilbake': 150 } });
  const v1 = bong({ cashierNumber: 'K', endDateTime: '2026-10-05 14:00', totalAmount: 0 });
  const sV1 = sc([{ c: EAN2, n: 'KAFFE', a: 60 }, { c: EAN2, n: 'KAFFE', a: -60 }, { c: EAN4, n: 'SMØR', a: 20 }]);
  const resale = bong({ cashierNumber: 'L', endDateTime: '2026-10-05 14:50', totalAmount: 60 });   // selger kaffe 50 min etter
  const sResale = sc([{ c: EAN2, n: 'KAFFE', a: 60 }]);
  const v2 = bong({ cashierNumber: 'K', endDateTime: '2026-10-05 16:00', totalAmount: 20 });
  const sV2 = sc([{ c: EAN, n: 'MELK', a: 20 }, { c: EAN, n: 'MELK', a: -20 }, { c: EAN, n: 'MELK', a: 20 }]);
  const far = bong({ cashierNumber: 'L', endDateTime: '2026-10-05 19:30', totalAmount: 20 });     // melk 3,5 t etter
  const sFar = sc([{ c: EAN, n: 'MELK', a: 20 }]);
  const all = [combo, v1, resale, v2, far], map = mapOf([[combo, sCombo], [v1, sV1], [resale, sResale], [v2, sV2], [far, sFar]]);
  const r = L.voidChecks(all, all, map, CT());
  const f = (code) => r.findings.filter((x) => x.code === code);
  assert.deepStrictEqual(f('voidCash').map((x) => x.ids[0]), [combo.transactionId]);
  assert.match(f('voidCash')[0].detail, /1 varelinje slettet \(150\.00 kr\)/);
  assert.match(f('voidCash')[0].detail, /150\.00 kr betalt tilbake kontant/);
  // v1: kaffe makulert og solgt på ny innen 120 min -> ok. Melk makulert på v2 men solgt på ny på samme bong (net 1) og 3,5 t senere på annen bong.
  const nr = f('voidNoResale');
  assert.deepStrictEqual(nr.map((x) => x.ids[0]).sort(), [combo.transactionId, v2.transactionId].sort());
  assert.match(nr.find((x) => x.ids[0] === v2.transactionId).detail, /MELK \(7038010000010\) 20\.00 kr makulert og ikke solgt på ny/);
  assert.strictEqual(r.resold, 1);
  assert.strictEqual(r.voided, 3);
  assert.ok(r.applicable);
  // utenfor 120 min: stor mellomtid gir treff på kaffe også
  const tight = L.voidChecks(all, all, map, Object.assign(CT(), { voidResaleMin: '30' }));
  assert.ok(tight.findings.some((x) => x.code === 'voidNoResale' && x.ids[0] === v1.transactionId));
  // kassererflagg
  const k = L.voidChecks(all, all, map, Object.assign(CT(), { voidCashN: '3' }));
  assert.deepStrictEqual(k.findings.filter((x) => x.code === 'voidCash2').map((x) => [x.cashier, x.flag]), [['K', false]]);
  // av
  assert.strictEqual(L.voidChecks(all, all, map, Object.assign(CT(), { voidCashOn: '', voidResaleMin: '', voidCashN: '' })).findings.length, 0);
  // for lav dekning gir ingen gjensalgstest
  const half = L.voidChecks(all, all.concat(Array.from({ length: 20 }, () => bong())), map, CT());
  assert.ok(!half.applicable && !half.findings.some((x) => x.code === 'voidNoResale'));
}

// ---- spesialbetaling: søk og test
{
  const a = bong({ cashierNumber: 'A' }), b = bong({ cashierNumber: 'A' }), c = bong({ cashierNumber: 'B' }), d = bong({ cashierNumber: 'B' });
  const map = mapOf([
    [a, sc([{ c: '7000', n: 'VARE', a: 10 }], { pay: { 'Eget forbruk': 10 } })],
    [b, sc([{ c: '7001', n: 'Utbetaling av kasse', a: -500 }])],
    [c, sc([{ c: '7002', n: 'SJEKKLISTE', a: 5 }], { pay: { Kontant: 5 } })],
    [d, sc([{ c: '7003', n: 'VARE', a: 5 }], { pay: { Kontant: 5 }, unk: ['Sjekken er innløst #'] })]
  ]);
  const its = [a, b, c, d];
  const r = L.specialChecks(its, map, CT());
  assert.deepStrictEqual(r.findings.filter((x) => x.code === 'special').map((x) => x.ids[0]), [a.transactionId, b.transactionId, d.transactionId], 'SJEKKLISTE er ikke «sjekk»');
  assert.match(r.findings[0].detail, /«Eget forbruk» \(betaling, 10\.00 kr\)/);
  assert.deepStrictEqual(Object.keys(r.byWord).sort(), ['eget forbruk', 'sjekk', 'utbetaling']);
  assert.strictEqual(L.specialHits(sc([], { pay: { 'Internt forbruk': 1 } }), L.wordList('internt forbruk'))[0].src, 'betaling');
  assert.strictEqual(L.specialHits(sc([{ c: '1', n: 'Utbetalinger', a: 1 }]), ['utbetaling']).length, 1, 'flertall');
  assert.strictEqual(L.specialHits(sc([{ c: '1', n: 'Finansieringskostnad', a: 1 }]), ['finansiering']).length, 0, 'bare hele ord');
  const cash = L.specialChecks(its, map, Object.assign(CT(), { specialN: '2' }));
  assert.deepStrictEqual(cash.findings.filter((x) => x.code === 'specialCash').map((x) => [x.cashier, x.flag]), [['A', false]]);
  assert.strictEqual(L.specialChecks(its, map, Object.assign(CT(), { specialWords: '' })).findings.length, 0);
  // søkefilter
  const ctx = { scan: map };
  const ids = (special) => its.filter((x) => L.matches(x, Object.assign(L.defaultFilters(), { special }), ctx)).map((x) => x.transactionId);
  assert.deepStrictEqual(ids('*'), [a.transactionId, b.transactionId, d.transactionId]);
  assert.deepStrictEqual(ids('Eget forbruk'), [a.transactionId]);
  assert.deepStrictEqual(ids('sjekk'), [d.transactionId]);
  assert.deepStrictEqual(its.filter((x) => L.matches(x, Object.assign(L.defaultFilters(), { special: '*' }), {})).length, 0, 'uten skanning ingen treff');
  assert.strictEqual(L.activeCount(Object.assign(L.defaultFilters(), { special: '*' })), 1);
  assert.strictEqual(L.sanitizeFilters({ special: 'sjekk', discFrom: '40', discTo: '50' }).special, 'sjekk');
}

// ---- rabatt: spenn, treff på andre salg og kampanje
{
  const CODES = { KAFFE: EAN2, SMØR: EAN3, OST: EAN4, JUICE: '7038010000058' };
  const dl = (name, a, d, dp, dr) => ({ c: CODES[name] || EAN, n: name, a, d, dp, dr });
  const day = (id, time, cashier, lines, d) => { const it = bong({ transactionId: id, endDateTime: (d || '2026-10-05') + ' ' + time, cashierNumber: cashier }); return [it, sc(lines, { v: 6, disc: lines.reduce((x, l) => x + (l.d || 0), 0), discN: lines.filter((l) => l.d).length, discNR: lines.filter((l) => l.d && !l.dr).length, discNRsum: 0, coupons: [] })]; };
  const base = { discPct: '', discHiFrom: '', discMatchPct: '', campBongs: '', campDay: '', discWatch: '', discCash: '' };
  const cfgOf = (o) => Object.assign(CT(), base, o);
  // høy rabatt
  const h1 = day('h-1', '10:00', 'A', [dl('MELK', 3, 7, 70)]), h2 = day('h-2', '10:10', 'A', [dl('MELK', 0, 10, 100, '1')]), h3 = day('h-3', '10:20', 'A', [dl('MELK', 4, 6, 60)]), h4 = day('h-4', '10:30', 'A', [dl('MELK', 2, 10)]);
  const hs = [h1, h2, h3, h4], hit = hs.map((x) => x[0]), hm = mapOf(hs);
  const hi = L.discounts(hit, hm, cfgOf({ discHiFrom: '70', discHiTo: '100' }));
  const hf = hi.findings.filter((f) => f.code === 'discHigh');
  assert.deepStrictEqual(hf.map((f) => f.ids[0]), ['h-1', 'h-2', 'h-4'], '70, 100 og regnet 83 % (uten oppgitt prosent) treffer; 60 % ikke');
  assert.match(hf[1].detail, /årsak Datovare/);
  assert.match(hf[2].detail, /uten årsak/);
  assert.strictEqual(L.discounts(hit, hm, cfgOf({ discHiFrom: '70', discHiTo: '90' })).findings.filter((f) => f.code === 'discHigh').length, 2);
  assert.strictEqual(L.discRate({ a: 3, d: 7 }), 70);
  assert.strictEqual(L.discRate({ a: 0, d: 0 }), null);
  // treff på andre salg
  const m1 = day('m-1', '11:00', 'A', [dl('KAFFE', 6, 4, 40)]);                  // ingen andre
  const m2 = day('m-2', '11:05', 'B', [dl('SMØR', 15, 10, 40)]);                  // SMØR har samme rabatt på m-3
  const m3 = day('m-3', '11:10', 'B', [dl('SMØR', 15, 10, 40)]);
  const m4 = day('m-4', '11:15', 'B', [dl('KAFFE', 6, 4, 40)], '2026-10-06');    // samme rabatt annen dag
  const m5 = day('m-5', '11:20', 'B', [dl('OST', 9, 1, 10)]);                     // under grensen
  const m6 = day('m-6', '11:25', 'B', [dl('JUICE', 6, 4, 40, '2')]);              // har årsak
  const ms = [m1, m2, m3, m4, m5, m6], mit = ms.map((x) => x[0]), mm = mapOf(ms);
  const nm = L.discounts(mit, mm, cfgOf({ discMatchPct: '30' }));
  const nf = nm.findings.filter((f) => f.code === 'discNoMatch');
  assert.deepStrictEqual(nf.map((f) => f.ids[0]).sort(), ['m-1', 'm-4'], 'm-2/m-3 matcher hverandre, m-6 har årsak, m-5 er under grensen');
  assert.match(nf.find((f) => f.ids[0] === 'm-1').detail, /KAFFE −40 % \(samme rabatt på varen 1 annen dag\)/);
  assert.match(nf.find((f) => f.ids[0] === 'm-4').detail, /Ingen andre bonger i butikken samme dag/);
  assert.ok(L.discounts(mit, mm, cfgOf({ discMatchPct: '30', discMatchNR: '' })).findings.some((f) => f.ids[0] === 'm-6' && f.code === 'discNoMatch'), 'alle rabatter når «bare uten årsak» er av');
  assert.strictEqual(L.discounts(mit, mm, cfgOf({ discMatchPct: '' })).findings.length, 0);
  // mulig sentral kampanje: samme vare og rabatt hos flere kasserere. Bongen tas med, med notat og spørsmål.
  const camp = Array.from({ length: 12 }, (_, i) => day('c-' + i, '12:' + (10 + i), 'A' + (i % 3), [dl('KAMPANJEVARE', 12, 8, 40)], i < 6 ? '2026-10-05' : '2026-10-06'));
  const cit = camp.map((x) => x[0]), cm = mapOf(camp);
  const three = { discMatchPct: '30', discPct: '30', discHiFrom: '30', discHiTo: '50' };
  const off = L.discounts(cit, cm, cfgOf(three));
  assert.ok(off.findings.length > 0 && off.findings.every((f) => !f.camp && !/Kan være sentral kampanje/.test(f.detail)), 'uten kampanjeregel: ingen notat');
  const asked = L.discounts(cit, cm, cfgOf(Object.assign({ campBongs: '3', campCashiers: '2' }, three)));
  const nr = asked.findings.filter((f) => f.code === 'discNoReason');
  assert.strictEqual(nr.length, 12, 'bongene tas fortsatt med');
  assert.ok(nr.every((f) => f.flag && f.camp.length === 1 && f.camp[0].key === L.campKey(EAN)));
  assert.match(nr[0].detail, /Kan være sentral kampanje: «KAMPANJEVARE» med 40 % rabatt er på 12 bonger hos 3 kasserere\. Bekreft eller avvis\./);
  assert.deepStrictEqual([asked.camp.items.length, asked.camp.items[0].n, asked.camp.items[0].cashierN, asked.camp.items[0].dayN, asked.camp.pending, asked.camp.confirmed], [1, 12, 3, 2, 1, 0]);
  assert.ok(asked.findings.filter((f) => /^disc(High|NoReason)$/.test(f.code)).every((f) => f.camp), 'alle tre testene får notatet');
  // brukeren bekrefter: rabatten flagges ikke lenger, og telles ikke mot kassereren
  const yes = L.discounts(cit, cm, cfgOf(Object.assign({ campBongs: '3', campCashiers: '2' }, three)), cit, { [L.campKey(EAN)]: 'kampanje' });
  assert.strictEqual(yes.findings.filter((f) => /^disc(NoMatch|High|NoReason)$/.test(f.code)).length, 0);
  assert.deepStrictEqual([yes.camp.pending, yes.camp.confirmed, yes.camp.skipped >= 12, yes.total.withNR], [0, 1, true, 0]);
  // svaret gjelder varen, uansett rabattprosent: andre flaggede bonger med samme vare (annen prosent) oppdateres også
  const mixed = camp.concat(Array.from({ length: 3 }, (_, i) => day('v-' + i, '13:' + (10 + i), 'Z' + i, [dl('KAMPANJEVARE', 13.4, 6.6, 33)])));
  const mit2 = mixed.map((x) => x[0]), mm2 = mapOf(mixed), mcfg = cfgOf(Object.assign({ campBongs: '3', campCashiers: '2' }, three));
  const mx0 = L.discounts(mit2, mm2, mcfg);
  assert.strictEqual(mx0.camp.items.length, 1, 'én vare, to rabattprosenter');
  assert.deepStrictEqual([mx0.camp.items[0].n, mx0.camp.items[0].rateText, mx0.camp.items[0].rates.map((r) => [r.rate, r.n])], [15, '40 % og 33 %', [[40, 12], [33, 3]]]);
  assert.ok(mx0.findings.filter((f) => f.code === 'discNoReason').every((f) => f.camp && f.camp.length === 1 && f.camp[0].key === EAN));
  assert.match(mx0.findings.find((f) => f.code === 'discNoReason').detail, /«KAMPANJEVARE» med 40 % og 33 % rabatt er på 15 bonger hos 6 kasserere/);
  assert.strictEqual(mx0.findings.filter((f) => f.code === 'discNoReason').length, 15);
  const mx1 = L.discounts(mit2, mm2, mcfg, mit2, { [EAN]: 'kampanje' });
  assert.strictEqual(mx1.findings.filter((f) => /^disc(NoMatch|High|NoReason)$/.test(f.code)).length, 0, 'alle 15 bonger oppdateres, også de med 33 %');
  assert.deepStrictEqual([mx1.camp.confirmed, mx1.camp.pending, mx1.total.withNR], [1, 0, 0]);
  // eldre svar («ean|prosent») gjelder nå varen
  assert.deepStrictEqual(L.sanitizeCamp({ [EAN + '|40']: 'kampanje', [EAN2]: 'ikke', '123': 'ja', [EAN3 + '|9']: 'tull' }), { [EAN]: 'kampanje', [EAN2]: 'ikke' });
  // brukeren avviser: flagges som vanlig, uten notat
  const no = L.discounts(cit, cm, cfgOf(Object.assign({ campBongs: '3', campCashiers: '2' }, three)), cit, { [L.campKey(EAN)]: 'ikke' });
  assert.ok(no.findings.length > 0 && no.findings.every((f) => !f.camp && !/Kan være sentral kampanje/.test(f.detail)));
  assert.deepStrictEqual([no.camp.pending, no.camp.denied], [0, 1]);
  assert.strictEqual(no.camp.items[0].possible, false);
  // én kasserer alene er ikke kampanje
  const solo = Array.from({ length: 12 }, (_, i) => day('s-' + i, '12:' + (10 + i), 'A', [dl('SOLOVARE', 12, 8, 40)]));
  const sr = L.discounts(solo.map((x) => x[0]), mapOf(solo), cfgOf(Object.assign({ campBongs: '3', campCashiers: '2' }, three)));
  assert.ok(sr.findings.length > 0 && sr.findings.every((f) => !f.camp) && sr.camp.items.length === 0, 'samme vare og rabatt hos bare én kasserer gir ingen kampanje');
  // for få bonger
  assert.strictEqual(L.discounts(cit.slice(0, 2), cm, cfgOf(Object.assign({ campBongs: '3', campCashiers: '2' }, three))).camp.items.length, 0);
  // svar på vare som ikke finnes i dataene kan angres
  assert.deepStrictEqual(L.discounts([], {}, cfgOf({}), [], { [L.campKey(EAN2)]: 'kampanje' }).camp.items.map((e) => [e.c, e.status, e.n]), [[EAN2, 'kampanje', 0]]);
  // kampanjedag: mange bonger med rabatt samme dag (minst 30 salg) gir notat, ikke skjuling
  const dayMany = Array.from({ length: 40 }, (_, i) => day('k-' + i, '09:' + (10 + (i % 50)), 'A', i % 2 ? [dl('VARE' + i, 6, 4, 40)] : [{ c: EAN2, n: 'X', a: 5 }]));
  dayMany.forEach((x, i) => { if (i % 2) x[1].items[0].c = String(7038010100000 + i); });
  const dit = dayMany.map((x) => x[0]), dm = mapOf(dayMany);
  const dflag = L.discounts(dit, dm, cfgOf({ discPct: '30', campDay: '' }));
  assert.ok(dflag.findings.some((f) => f.code === 'discNoReason') && dflag.findings.every((f) => !/kampanjedag/.test(f.detail)));
  const dCamp = L.discounts(dit, dm, cfgOf({ discPct: '30', campDay: '40' }));
  assert.strictEqual(dCamp.findings.filter((f) => f.code === 'discNoReason').length, 20, 'bongene tas fortsatt med');
  assert.ok(dCamp.findings.filter((f) => f.code === 'discNoReason').every((f) => /50 % av salgene i butikken denne dagen har rabatt, så det kan være en kampanjedag/.test(f.detail)));
  assert.strictEqual(dCamp.camp.days.length, 1);
  assert.strictEqual(dCamp.camp.days[0].n, 40);
  assert.strictEqual(L.discounts(dit.slice(0, 20), dm, cfgOf({ discPct: '30', campDay: '40' })).camp.days.length, 0, 'under 30 salg');
  // søk på rabatt-%
  const ctx = { scan: Object.assign({}, hm, mm) };
  const f40 = (from, to) => mit.filter((x) => L.matches(x, Object.assign(L.defaultFilters(), { discFrom: from, discTo: to }), ctx)).map((x) => x.transactionId);
  assert.deepStrictEqual(f40('40', '40'), ['m-1', 'm-2', 'm-3', 'm-4', 'm-6']);
  assert.deepStrictEqual(f40('41', ''), []);
  assert.deepStrictEqual(f40('', '10'), ['m-5']);
  assert.strictEqual(L.activeCount(Object.assign(L.defaultFilters(), { discFrom: '40', discTo: '50' })), 2);
}

// ---- spør pris
{
  const sale = (time, cashier, lines, extra) => { const it = bong({ endDateTime: '2026-10-05 ' + time, cashierNumber: cashier }); return [it, sc(lines, Object.assign({ v: 6 }, extra || {}))]; };
  const reg = [0, 1, 2, 3].map((i) => sale('10:0' + i, 'A', [{ c: EAN, n: 'MELK', a: 20, p: 20 }]));
  const ask1 = sale('11:00', 'B', [{ c: '7001', n: 'SPØR PRIS', a: 0 }, { c: EAN, n: 'MELK', a: 12, p: 12 }]);   // EAN under spør pris
  const ask2 = sale('11:10', 'B', [{ c: EAN, n: 'SPØR PRIS MELK', a: 20, p: 20 }]);                                // riktig pris
  const ask3 = sale('11:20', 'B', [{ c: EAN2, n: 'SPØR PRIS', a: 0 }, { c: EAN2, n: 'KAFFE', a: 50, p: 50 }]);       // ingen sammenligning
  const evOnly = sale('11:30', 'C', [{ c: EAN, n: 'MELK', a: 20, p: 20 }], { ev: [{ k: 'spør pris', t: 'Spør pris benyttet' }] });
  const all = reg.concat([ask1, ask2, ask3, evOnly]), its = all.map((x) => x[0]), map = mapOf(all);
  const r = L.askPrice(its, its, map, CT());
  assert.deepStrictEqual(r.findings.filter((x) => x.code === 'askDev').map((x) => x.ids[0]), [ask1[0].transactionId]);
  assert.match(r.findings[0].detail, /MELK spør pris 12\.00 mot 20\.00 \(−40 %, 5 salg samme dag\)/);
  assert.deepStrictEqual([r.lines, r.noRef, r.deviating, r.evOnly], [3, 1, 1, 1]);
  assert.strictEqual(L.askPrice(its, its, map, Object.assign(CT(), { askDevPct: '' })).findings.length, 0);
  assert.strictEqual(L.askPrice(its, its, map, Object.assign(CT(), { askMinN: '10' })).findings.length, 0, 'for få salg gir ingen referanse');
  const c = L.askPrice(its, its, map, Object.assign(CT(), { askN: '3' }));
  assert.deepStrictEqual(c.findings.filter((x) => x.code === 'askCash').map((x) => [x.cashier, x.flag]), [['B', false]]);
  // eldre skanning uten enhetspris regnes ikke
  assert.strictEqual(L.askPrice(its, its, mapOf(all.map(([i, s]) => [i, Object.assign({}, s, { v: 3 })])), CT()).scanned, 0);
}

// ---- kort: gjentatte returer
{
  const ret = (day, time, cashier, cards, total) => { const it = bong({ endDateTime: day + ' ' + time, cashierNumber: cashier, totalAmount: total === undefined ? -100 : total }); return [it, sc([{ c: EAN, n: 'RETUR', a: total === undefined ? -100 : total }], { cd: cards })]; };
  const visa = [{ f: '', n: '1234', s: 'visa' }], mc = [{ f: '', n: '1234', s: 'mastercard' }];
  const set = [
    ret('2026-10-01', '10:00', 'A', visa), ret('2026-10-10', '10:00', 'B', visa), ret('2026-10-20', '10:00', 'A', visa), // 3 på 19 dager
    ret('2026-10-02', '10:00', 'A', mc), ret('2026-10-12', '10:00', 'A', mc),                                          // bare 2
    ret('2026-10-03', '10:00', 'C', visa, 50)                                                                          // positivt salg? (se under)
  ];
  set[5][0].totalAmount = 50; set[5][1].items[0].a = 50;
  const its = set.map((x) => x[0]), map = mapOf(set);
  const r = L.cardChecks(its, its, map, CT());
  assert.strictEqual(r.findings.length, 1);
  assert.deepStrictEqual(r.findings[0].ids.sort(), [its[0], its[1], its[2]].map((x) => x.transactionId).sort());
  assert.match(r.findings[0].detail, /VISA …1234: 3 returer innen 30 dager, totalt 300\.00 kr \(kasserer A ×2, B ×1\)/);
  assert.deepStrictEqual([r.returns, r.withCard], [5, 5]);
  assert.strictEqual(r.rows[0].best, 3);
  assert.strictEqual(L.cardChecks(its, its, map, Object.assign(CT(), { cardRetDays: '10' })).findings.length, 0, 'innen 10 dager er det bare to');
  assert.strictEqual(L.cardChecks(its, its, map, Object.assign(CT(), { cardRetN: '' })).findings.length, 0);
  assert.strictEqual(L.cardChecks(its, its, mapOf(set.map(([i, s]) => [i, Object.assign({}, s, { v: 5 })])), CT()).scanned, 0, 'v5 har ikke kortdata');
  // samme siste fire hos ulik leverandør er ikke samme kort
  assert.strictEqual(r.rows.filter((x) => /1234/.test(x.label)).length, 2);
}

// ---- manuell kvittering som matcher annen bong
{
  const m = bong({ endDateTime: '2026-10-05 12:00', totalAmount: 199 });
  const sM = scanOf([['Manuell kvittering'], ['7001 JAKKE', '', '199.00']]);
  const twin = bong({ endDateTime: '2026-10-04 15:00', totalAmount: 199, workstationNumber: 3 });
  const sT = scanOf([['7001 JAKKE', '', '199.00']]);
  const other = bong({ endDateTime: '2026-10-05 12:30', totalAmount: 120 });
  const sO = scanOf([['7002 SKO', '', '120.00']]);
  const far = bong({ endDateTime: '2026-09-20 12:30', totalAmount: 199 });
  const credit = bong({ endDateTime: '2026-10-05 13:00', totalAmount: 80 });
  const sC = scanOf([['7005 BELTE', '', '80.00'], ['Til gode:', '', '80.00']]);
  const twin2 = bong({ endDateTime: '2026-10-05 13:40', totalAmount: -80 });
  const sT2 = scanOf([['7005 BELTE', '', '-80.00']]);
  const all = [m, twin, other, far, credit, twin2], map = mapOf([[m, sM], [twin, sT], [other, sO], [far, sT], [credit, sC], [twin2, sT2]]);
  const r = L.manualReceipts(all, all, map, CT());
  assert.deepStrictEqual(r.findings.map((x) => x.ids[0]).sort(), [m.transactionId, credit.transactionId].sort());
  assert.ok(r.findings.find((x) => x.ids[0] === m.transactionId).ids.includes(twin.transactionId));
  assert.ok(!r.findings.find((x) => x.ids[0] === m.transactionId).ids.includes(far.transactionId), 'for langt unna i tid');
  assert.ok(r.findings.find((x) => x.ids[0] === credit.transactionId).ids.includes(twin2.transactionId), 'til gode-lapp: samme beløp, motsatt fortegn');
  assert.strictEqual(r.manual, 2);
  assert.strictEqual(L.manualReceipts(all, all, map, Object.assign(CT(), { manualWords: '' })).findings.length, 0);
  assert.strictEqual(L.manualReceipts(all, all, map, Object.assign(CT(), { manualDays: '0' })).findings.filter((x) => x.ids[0] === m.transactionId).length, 0);
}

// ---- innstillinger og vekter henger sammen
{
  ['lapp', 'voids', 'special', 'ask', 'card', 'manual'].forEach((id) => assert.ok(L.SETTING_GROUPS.some((g) => g.id === id), id));
  const w = ['Manuell pantelapp', 'Mange manuelle pantelapper', 'Pantelapp slettet', 'Pantelapp innløst flere ganger', 'Varelinjer slettet, pant utbetalt kontant', 'Makulert vare ikke solgt på ny',
    'Mange makulerte varelinjer', 'Spesialbetaling på bong', 'Mange spesialbetalinger', 'Høy rabattprosent', 'Rabatt uten treff på andre salg', 'Spør pris avviker fra dagens salg', 'Mange spør pris',
    'Gjentatte returer på samme kort', 'Manuell kvittering matcher annen bong'];
  w.forEach((t) => { assert.ok(t in L.RISK_WEIGHTS, t); assert.ok(L.groupForReason(t), 'gruppe for ' + t); });
  assert.strictEqual(L.groupForReason('Pantelapp slettet'), 'lapp');
  assert.strictEqual(L.groupForReason('Høy rabattprosent'), 'disc');
  const dc = L.defaultControl();
  assert.deepStrictEqual([dc.lappManualMin, dc.lappReuseMin, dc.voidResaleMin, dc.discHiFrom, dc.discHiTo, dc.campBongs, dc.campCashiers, dc.campDay, dc.askDevPct, dc.cardRetN], ['50', '60', '120', '70', '100', '3', '2', '40', '5', '3']);
  assert.strictEqual(dc.specialWords, 'eget forbruk, internt forbruk, utbetaling, finansiering, sjekk');
  assert.ok(L.rrs(L.riskScore(['Pantelapp slettet', 'Varelinjer slettet, pant utbetalt kontant'])) > 50);
}

console.log('linjer: ok');
