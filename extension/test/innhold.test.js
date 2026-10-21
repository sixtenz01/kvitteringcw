// Enhetstester: tempo, overvåkede varer, retur uten kjøp av samme EAN, topptekst og bunn (v7), betalingsmåter, fulltekstsøk og returårsak (v9).
const assert = require('assert');
const L = require('../src/logic.js');

let seq = 0;
const bong = (o) => Object.assign({ transactionId: 'T-' + (++seq), endDateTime: '2026-10-05 12:00:00', storeNumber: 1005, workstationNumber: 1, cashierNumber: 'A', totalAmount: 10, receiptType: 1, memberNumber: null }, o);
const scan = (lines, o) => Object.assign({ v: 7, items: lines.map((l) => Object.assign({ n: 'VARE' }, l)), pay: {}, np: lines.length, neg: 0, sale: 0, ret: 0, saleLines: 0, retLines: 0, coupons: [] }, o);
const CT = () => L.defaultControl();
const mapOf = (pairs) => pairs.reduce((m, [it, s]) => (m[it.transactionId] = s, m), {});
const E1 = '7038010000010', E2 = '7038010000027', E3 = '7038010000034', E4 = '7038010000041';

// ---- tempo
{
  const at = (t, o) => bong(Object.assign({ endDateTime: '2026-10-05 10:' + t }, o));
  const fast = ['00:00', '00:10', '00:20', '00:30', '00:40'].map((t) => at(t));
  const slow = ['01:00', '01:10', '01:20'].map((t) => at(t, { workstationNumber: 2 }));
  const later = [at('05:00')];
  let r = L.tempoChecks(fast.concat(slow, later), CT());
  assert.strictEqual(r.secOK, true);
  assert.strictEqual(r.series, 1);
  assert.strictEqual(r.inSeries, 5);
  assert.strictEqual(r.minGap, 10);
  assert.deepStrictEqual(r.findings.map((f) => [f.title, f.flag, f.ids.length]), [['Bonger i rask rekkefølge', true, 5]]);
  assert.match(r.findings[0].detail, /Kasse 1 2026-10-05 10:00–10:00: 5 bonger på 40 s, høyst 10 s mellom \(grense 25 s\)/);
  // serie på 4 med 30 s mellom er ikke en serie
  r = L.tempoChecks(['00:00', '00:30', '01:00', '01:30'].map((t) => at(t)), CT());
  assert.strictEqual(r.series, 0);
  // av når grensen er tom
  r = L.tempoChecks(fast, Object.assign(CT(), { paceSec: '' }));
  assert.deepStrictEqual([r.series, r.findings.length], [0, 0]);
  // andre typer og ikke-tall ignoreres
  r = L.tempoChecks(fast.map((b) => Object.assign({}, b, { receiptType: 2 })), CT());
  assert.strictEqual(r.sales, 0);
  // uten sekunder: bonger i samme minutt
  const min = (n) => Array.from({ length: n }, (_, i) => bong({ endDateTime: '2026-10-05 11:15', cashierNumber: 'B', totalAmount: 5 + i }));
  r = L.tempoChecks(min(6), CT());
  assert.strictEqual(r.secOK, false);
  assert.deepStrictEqual([r.series, r.findings[0].title, r.findings[0].detail.includes('i samme minutt (grense 6)')], [1, 'Bonger i rask rekkefølge', true]);
  assert.strictEqual(L.tempoChecks(min(5), CT()).series, 0);
  assert.strictEqual(L.tempoChecks(min(6), Object.assign(CT(), { paceMinuteN: '' })).series, 0);
  // 0-kr-bonger: kassererfunn
  const zeros = Array.from({ length: 5 }, () => bong({ cashierNumber: 'Z', totalAmount: 0, endDateTime: '2026-10-05 09:' + String(seq % 50 + 10) + ':00' }));
  r = L.tempoChecks(zeros.concat(bong({ cashierNumber: 'Z' })), CT());
  assert.deepStrictEqual(r.findings.filter((f) => f.code === 'zeroBon').map((f) => [f.cashier, f.flag, f.ids.length]), [['Z', false, 0]]);
  assert.strictEqual(r.zero, 5);
}

// ---- overvåkede varer
{
  const mk = (cash, lines) => { const it = bong({ cashierNumber: cash }); return [it, scan(lines)]; };
  const sale = mk('A', [{ c: E1, n: 'MARLBORO', a: 99 }]);
  const ret = mk('A', [{ c: E1, n: 'MARLBORO', a: -99 }]);
  const del = mk('A', [{ c: E1, n: 'MARLBORO', a: 99 }, { c: E1, n: 'MARLBORO', a: -99 }, { c: E2, n: 'MELK', a: 20 }]);
  const none = [0, 1, 2, 3, 4, 5].map(() => mk('B', [{ c: E2, n: 'MELK', a: 20 }]));
  const all = [sale, ret, del].concat(none);
  const items = all.map((x) => x[0]), map = mapOf(all);
  const cfg = Object.assign(CT(), { watchItems: '7038010000010, tobakk', watchN: '3', profMin: '3' });
  const r = L.watchItems(items, items, map, cfg);
  assert.deepStrictEqual(r.terms, ['7038010000010', 'tobakk']);
  assert.deepStrictEqual(r.findings.filter((f) => f.flag).map((f) => [f.title, f.ids[0] === ret[0].transactionId || f.ids[0] === del[0].transactionId]), [['Overvåket vare i retur', true], ['Overvåket vare slettet', true]]);
  assert.strictEqual(r.byTerm['7038010000010'].bongs, 3);
  assert.deepStrictEqual([r.byTerm['7038010000010'].sale, r.byTerm['7038010000010'].ret, r.byTerm['7038010000010'].del], [99, 99, 99]);
  const cash = r.findings.filter((f) => f.code === 'watchCash');
  assert.deepStrictEqual(cash.map((f) => [f.cashier, f.flag]), [['A', false]]);
  // navn-treff, og av når listen er tom eller flaggene er av
  const byName = L.watchItems(items, items, map, Object.assign(CT(), { watchItems: 'marlbo', watchRet: '', watchDel: '', watchN: '' }));
  assert.deepStrictEqual([byName.bongs, byName.findings.length], [3, 0]);
  assert.deepStrictEqual(L.watchItems(items, items, map, CT()).terms, []);
}

// ---- retur av vare uten kjøp av samme EAN
{
  const card = [{ f: '', n: '1234', s: 'visa' }];
  const day = (n, t) => '2026-10-' + String(n).padStart(2, '0') + ' ' + (t || '12:00:00');
  const old = bong({ endDateTime: day(1), cashierNumber: 'X' });
  const s1 = bong({ endDateTime: day(8), memberNumber: 'M1' });
  const s2 = bong({ endDateTime: day(9), memberNumber: 'M1' });
  const sales = [[old, scan([{ c: E3, a: 10 }])], [s1, scan([{ c: E1, a: 50 }, { c: E2, a: 20 }], { cd: card })], [s2, scan([{ c: E3, a: 30 }], { cd: card })]];
  const mkRet = (lines, o, extra) => { const it = bong(Object.assign({ endDateTime: day(10), totalAmount: -20, memberNumber: 'M1' }, o)); return [it, scan(lines, Object.assign({ cd: card, retLines: lines.length }, extra))]; };
  const bad = mkRet([{ c: E4, n: 'SKO', a: -20 }]);
  const good = mkRet([{ c: E1, n: 'JAKKE', a: -20 }]);
  const all = sales.concat([bad, good]), items = all.map((x) => x[0]), map = mapOf(all);
  let r = L.itemReturns(items, items, map, CT());
  assert.strictEqual(r.applicable, true);
  assert.deepStrictEqual(r.findings.map((f) => [f.title, f.ids[0] === bad[0].transactionId]), [['Retur av vare uten kjøp på kortet', true]]);
  assert.match(r.findings[0].detail, /«SKO» \(7038010000041, 20.00 kr\) er ikke kjøpt med samme kort siste 7 dager, selv om kortet har 2 andre kjøp i perioden/);
  assert.deepStrictEqual([r.returns, r.flagged, r.byCard], [2, 1, 1]);
  // bare medlem, uten kort på returbongen
  const mem = mkRet([{ c: E4, n: 'SKO', a: -20 }], {}, { cd: undefined });
  r = L.itemReturns(sales.map((x) => x[0]).concat(mem[0]), sales.map((x) => x[0]).concat(mem[0]), mapOf(sales.concat([mem])), CT());
  assert.deepStrictEqual(r.findings.map((f) => f.title), ['Retur av vare uten kjøp av medlemmet']);
  // for kort historikk: ikke vurdert
  r = L.itemReturns(items, items, map, Object.assign(CT(), { retEanDays: '30' }));
  assert.deepStrictEqual([r.findings.length, r.short], [0, 2]);
  // av
  assert.strictEqual(L.itemReturns(items, items, map, Object.assign(CT(), { retEanDays: '' })).on, false);
  // uten kort og medlem: samme dag (valgfritt)
  const solo = bong({ endDateTime: day(10, '15:00:00'), totalAmount: -20 });
  const soloScan = scan([{ c: E4, n: 'SKO', a: -20 }], { retLines: 1 });
  const dayOther = bong({ endDateTime: day(10, '09:00:00') });
  const dayAll = [[solo, soloScan], [dayOther, scan([{ c: E2, a: 10 }])], [old, scan([{ c: E3, a: 10 }])]];
  const di = dayAll.map((x) => x[0]), dm = mapOf(dayAll);
  assert.strictEqual(L.itemReturns(di, di, dm, CT()).findings.length, 0, 'av som standard');
  r = L.itemReturns(di, di, dm, Object.assign(CT(), { retEanDay: '1' }));
  assert.deepStrictEqual(r.findings.map((f) => f.title), ['Retur av vare uten salg samme dag']);
  // dekning under 80 %: ikke vurdert
  r = L.itemReturns(items, items.concat(Array.from({ length: 10 }, () => bong())), map, CT());
  assert.deepStrictEqual([r.applicable, r.findings.length], [false, 0]);
}

// ---- topptekst og bunn (v7)
{
  const rows = [['7000 VARE', '', '10.00'], ['Bank:', '', '10.00']];
  assert.strictEqual(L.parseReceipt(rows).v, 6, 'uten topptekst og bunn blir den v6');
  rows.tl = ['Coop Mega Kolbotn', 'Butikk: 1003, Kassenr: 4, Kasserer: 12', 'Medlemsnr.: 123456', 'Kvittering: 2371 02.10.2026 22:04:15'];
  rows.bl = ['Terminal: T123456', 'Aut.kode: A1B2C3', 'Kontaktløs', 'Visa', 'Takk for besøket'];
  const r = L.parseReceipt(rows);
  assert.strictEqual(r.v, 9);
  assert.ok(r.tx.includes('Takk for besøket') && r.tx.includes('Kontaktløs'), 'tekstlinjer tas vare på for hendelsesord');
  assert.deepStrictEqual(r.hdr, { s: '1003', w: '4', c: '12', m: '123456' });
  assert.deepStrictEqual(r.ft, { t: 'T123456', a: 'A1B2C3', e: ['kontaktløs'] });
  assert.ok(r.bu.includes('Takk for besøket') && r.bu.includes('Coop Mega Kolbotn'));
  assert.ok(L.hasV7(r) && !L.hasV7({ v: 6 }) && !L.hasV7({ v: 7, settle: {} }));
  // falske treff: ord uten tall regnes ikke som kode
  assert.strictEqual(L.parseOutside([], ['Autorisert uten PIN', 'Terminal type: Chip', 'Automat: ok']).ft.a, undefined);
  assert.strictEqual(L.parseOutside([], ['Terminal type: Chip']).ft && L.parseOutside([], ['Terminal type: Chip']).ft.t, undefined);
  assert.deepStrictEqual(L.parseOutside([], ['Autorisasjon 998877', 'Terminal ID 5544332']).ft, { t: '5544332', a: '998877' });

  // topptekst mot listen
  const mk = (n, hdr, o) => { const it = bong(Object.assign({ cashierNumber: '12', workstationNumber: 4 }, o)); return [it, scan([{ c: E1, a: 10 }], { hdr })]; };
  const ok = Array.from({ length: 12 }, () => mk(0, { c: '12', w: '4' }));
  const wrong = mk(0, { c: '99', w: '4' });
  const all = ok.concat([wrong]), items = all.map((x) => x[0]), map = mapOf(all);
  let h = L.headerChecks(items, items, map, CT());
  assert.deepStrictEqual(h.findings.map((f) => [f.title, f.ids[0] === wrong[0].transactionId]), [['Topptekst stemmer ikke med listen', true]]);
  assert.match(h.findings[0].detail, /bongen sier kasserer 99, listen sier kasserer 12/);
  assert.deepStrictEqual([h.fields.c.trusted, h.fields.w.trusted, h.fields.m.n], [true, true, 0]);
  // for få bonger: ikke kalibrert, ingen funn
  const few = all.slice(0, 5).concat([wrong]);
  h = L.headerChecks(few.map((x) => x[0]), few.map((x) => x[0]), mapOf(few), CT());
  assert.deepStrictEqual([h.fields.c.trusted, h.findings.length], [false, 0]);
  // medlem: bong mangler, listen har nummer
  const m1 = ok.map((x) => [Object.assign({}, x[0], { memberNumber: 'M5' }), Object.assign({}, x[1], { hdr: { c: '12', w: '4', m: 'M5' } })]);
  const m2 = mk(0, { c: '12', w: '4' }, { memberNumber: 'M5' });
  const mm = m1.concat([m2]);
  h = L.headerChecks(mm.map((x) => x[0]), mm.map((x) => x[0]), mapOf(mm), CT());
  assert.match(h.findings[0].detail, /bongen sier medlem mangler, listen sier medlem M5/);
  // samme autorisasjonskode
  const a1 = bong({ totalAmount: 50 }), a2 = bong({ totalAmount: 60, workstationNumber: 3 });
  const au = [[a1, scan([{ c: E1, a: 50 }], { ft: { t: 'T1', a: 'ZZ99' } })], [a2, scan([{ c: E1, a: 60 }], { ft: { t: 'T1', a: 'zz99' } })]];
  h = L.headerChecks(au.map((x) => x[0]), au.map((x) => x[0]), mapOf(au), CT());
  assert.deepStrictEqual(h.findings.map((f) => [f.title, f.ids.length]), [['Samme autorisasjonskode på flere bonger', 2]]);
  assert.strictEqual(L.headerChecks(au.map((x) => x[0]), au.map((x) => x[0]), mapOf(au), Object.assign(CT(), { authDup: '' })).findings.length, 0);
  // diagnostikk teller v7
  const dg = L.diagnostics({ a: scan([], { hdr: { c: '1' }, ft: { t: 'T1', a: 'Z9', e: ['chip'] }, bu: ['Rar linje'] }), b: { v: 6, items: [], pay: {} } });
  assert.deepStrictEqual([dg.total, dg.v7, dg.hdr, dg.ft.term, dg.ft.auth, dg.ft.modes.chip, dg.bu[0].t], [2, 1, 1, 1, 1, 1, 'Rar linje']);
}

// ---- betalingsmåter
{
  const a = bong({ cashierNumber: '1' }), b = bong({ cashierNumber: '2' }), c = bong({ cashierNumber: '1' });
  const map = mapOf([[a, scan([], { pay: { Bank: 100, Kontant: 20 } })], [b, scan([], { pay: { Bank: 50 } })], [c, scan([], { pay: { Coopay: 30 } })]]);
  let r = L.payStats([a, b, c], map, null);
  assert.deepStrictEqual(r.rows.map((x) => [x.label, x.bongs, x.sum, x.cashiers, x.inCw]), [['Bank', 2, 150, 2, 'ukjent'], ['Coopay', 1, 30, 1, 'ukjent'], ['Kontant', 1, 20, 1, 'ukjent']]);
  r = L.payStats([a, b, c], map, ['Bank', 'Kontant']);
  assert.deepStrictEqual(r.rows.map((x) => x.inCw), ['ja', 'nei', 'ja']);
  const ctx = { scan: map };
  const f = Object.assign(L.defaultFilters(), { pay: 'coopay' });
  assert.deepStrictEqual([a, b, c].map((i) => L.matches(i, f, ctx)), [false, false, true]);
}

// ---- fulltekstsøk
{
  const it = bong({ memberNumber: '4455' });
  const s = scan([{ c: E1, n: 'COCA COLA 0.5L', a: 12.5, q: 2, p: 6.25, d: 1, dr: 'Datovare' }], { pay: { 'Bank Axept': 12.5 }, rf: ['R:998877', 'T:DK7TVRW5F2PC5'], cd: [{ f: '492500', n: '4321', s: 'visa' }], coupons: [{ i: '1ESD2LJ54X', n: 'COOP FROKOSTEGG', a: 0 }], unk: ['Rar linje #'], hdr: { c: '12' }, ft: { t: 'T123', a: 'A9' } });
  const hit = (q) => L.searchHit(s, it, q);
  ['7038010000010', 'cola', 'COLA 0.5L', '"bank axept"', '12,50', '12.50', '998877', 'dk7tvrw5f2pc5', '4321', 'visa', 'frokostegg', 'datovare', 'rar linje', 't123', 'a9', '4455', it.transactionId.toLowerCase(), 'cola 998877', '6,25'].forEach((q) => assert.ok(hit(q), 'skal treffe: ' + q));
  ['fanta', 'cola 111111', '"bank kontant"', '13,50', ''].forEach((q) => assert.strictEqual(hit(q), q === '', 'skal ikke treffe: ' + q));
  assert.deepStrictEqual(L.searchTerms('a "b c"  d'), ['a', 'b c', 'd']);
  const ctx = { scan: { [it.transactionId]: s } };
  assert.strictEqual(L.matches(it, Object.assign(L.defaultFilters(), { text: 'cola' }), ctx), true);
  assert.strictEqual(L.matches(it, Object.assign(L.defaultFilters(), { text: 'fanta' }), ctx), false);
  assert.strictEqual(L.matches(it, Object.assign(L.defaultFilters(), { text: 'cola' }), {}), false, 'uten skanning skjules bongen');
  assert.strictEqual(L.activeCount(Object.assign(L.defaultFilters(), { text: 'x', pay: 'y' })), 2);
  assert.strictEqual(L.sanitizeFilters({ text: 5 }).text, '5');
}

// ---- vekter og grupper
{
  ['Bonger i rask rekkefølge', 'Mange 0-kr-bonger', 'Overvåket vare i retur', 'Overvåket vare slettet', 'Mange overvåkede varer hos kasserer', 'Retur av vare uten kjøp på kortet',
    'Retur av vare uten kjøp av medlemmet', 'Retur av vare uten salg samme dag', 'Topptekst stemmer ikke med listen', 'Samme autorisasjonskode på flere bonger'].forEach((t) => {
    assert.ok(L.groupForReason(t), 'mangler innstillingsgruppe: ' + t);
  });
  // retur uten kjøp: bare det høyeste teller
  const bd = L.scoreBreakdown(['Retur av vare uten kjøp på kortet', 'Retur av vare uten kjøp av medlemmet']);
  assert.deepStrictEqual(bd.map((x) => x.counts), [true, false]);
}

// ---- returårsak (v9): «RETUR VARE Coop Matvaregaranti» over returlinjen
{
  const P = (rows) => { const r = rows.slice(); r.tl = ['Kvittering: 1 05.10.2026 12:00:00']; return L.parseReceipt(r); };
  const r = P([['RETUR VARE Coop Matvaregaranti'], [E1 + ' KYLLINGFILET', '', '-89.90'], ['RETUR VARE'], ['399 PANTELAPP', '', '-20.00'], ['RETUR VARE', 'Feil vare'], [E2 + ' MELK', '', '-21.50'], [E3 + ' BRØD', '', '35.00'], ['', 'Totalt', '-96.40'], ['Kontant tilbake:', '', '96.40']]);
  assert.strictEqual(r.v, 9);
  assert.deepStrictEqual(r.items.map((l) => [l.n, l.rv || 0, l.rr || '']), [['KYLLINGFILET', 1, 'Coop Matvaregaranti'], ['PANTELAPP', 1, ''], ['MELK', 1, 'Feil vare'], ['BRØD', 0, '']]);
  assert.ok(!r.unk, 'RETUR VARE er ikke en ukjent linje');
  assert.ok(L.searchHit(r, L.searchTerms('matvaregaranti')), 'fulltekstsøket finner årsaken');
  const MG = [['RETUR VARE Coop Matvaregaranti'], [E1 + ' KYLLINGFILET', '', '-89.90'], ['Kontant tilbake:', '', '89.90']];
  const pairs = [];
  for (let i = 0; i < 4; i++) pairs.push([bong({ cashierNumber: '12', totalAmount: -89.9 }), P(MG)]);
  for (let i = 0; i < 20; i++) pairs.push([bong({ cashierNumber: i % 2 ? '13' : '14' }), P([[E2 + ' MELK', '', '21.50'], ['Bank:', '', '21.50']])]);
  pairs.push([bong({ cashierNumber: '13', totalAmount: -89.9 }), P(MG)]);
  pairs.push([bong({ cashierNumber: '14', totalAmount: -26.5 }), P([['RETUR VARE', 'Feil vare'], [E2 + ' MELK', '', '-21.50'], ['RETUR VARE'], ['399 PANTELAPP', '', '-5.00']])]);
  const old = bong({ cashierNumber: '14', totalAmount: -10 });
  pairs.push([old, scan([{ c: E3, n: 'BRØD', a: -10 }], { v: 8 })]);
  const its = pairs.map((x) => x[0]), m = mapOf(pairs);
  const rr = L.returnReasons(its, m, CT());
  assert.deepStrictEqual([rr.scanned, rr.old, rr.bongs, rr.lines, rr.sum, rr.watched], [26, 1, 6, 6, 471, 5], 'pant telles ikke; eldre skanning med negativ linje telles som «old»');
  assert.deepStrictEqual(rr.reasons.map((x) => [x.name, x.bongs, x.watched, x.cashiers.map((c) => c.id + '×' + c.n).join()]), [['Coop Matvaregaranti', 5, 'matvaregaranti', '12×4,13×1'], ['Feil vare', 1, '', '14×1']]);
  assert.deepStrictEqual(rr.findings.map((f) => [f.code, f.flag, f.cashier]), [['retWatchCash', false, '12']], 'bare kassereren markeres som standard');
  assert.match(rr.findings[0].detail, /Kasserer 12: 4 av 4 bonger har retur med overvåket årsak \(matvaregaranti 4; 100 % mot 4,5 % hos de andre kassererne, grense 3 bonger\)/);
  assert.deepStrictEqual(rr.rows.map((x) => [x.id, x.withW, x.flag]), [['12', 4, true], ['13', 1, false], ['14', 0, false]]);
  // flagg hver bong
  const rf = L.returnReasons(its, m, Object.assign(CT(), { retWatchFlag: '1' }));
  assert.strictEqual(rf.findings.filter((f) => f.code === 'retWatch' && f.flag).length, 5);
  assert.match(rf.findings.find((f) => f.code === 'retWatch').detail, /KYLLINGFILET 89\.90 kr \(«Coop Matvaregaranti»\)/);
  // egne årsaker, og av
  assert.deepStrictEqual(L.returnReasons(its, m, Object.assign(CT(), { retWatch: 'feil vare' })).reasons.map((x) => x.watched), ['', 'feil vare']);
  assert.strictEqual(L.returnReasons(its, m, Object.assign(CT(), { retWatch: '' })).findings.length, 0);
  assert.strictEqual(L.returnReasons(its, m, Object.assign(CT(), { retWatchN: '' })).findings.length, 0);
  // kasserer med samme andel som de andre markeres ikke
  const even = [];
  ['A', 'B'].forEach((c) => { for (let i = 0; i < 4; i++) even.push([bong({ cashierNumber: c }), P(MG)]); });
  assert.strictEqual(L.returnReasons(even.map((x) => x[0]), mapOf(even), CT()).findings.length, 0);
  assert.strictEqual(L.maybeReturn(m[old.transactionId]), true);
  assert.strictEqual(L.wordHit('Coop Matvaregaranti', ['matvare']), 'matvare');
  assert.strictEqual(L.wordHit('Coop Matvaregaranti', ['garanti']), '', 'starten av et ord');
  // kjente returårsaker skrives likt; ukjente beholdes
  assert.deepStrictEqual(['Coop Matvaregaranti', 'matvaregaranti', 'ANGRERETT', 'Gevinst', 'feilslag', 'Prisløfte', 'Datovare', 'Annen returårsak', 'Noe annet', ''].map(L.retReasonName),
    ['Coop Matvaregaranti', 'Coop Matvaregaranti', 'Angrerett', 'Gevinst', 'Feilslag', 'Prisløfte', 'Datovare', 'Annen returårsak', 'Noe annet', 'Uten årsak']);
  const kr = [[bong({ cashierNumber: '20' }), P([['RETUR VARE GEVINST'], [E1 + ' LOTTO', '', '-50.00']])], [bong({ cashierNumber: '20' }), P([['RETUR VARE Rart'], [E1 + ' X', '', '-5.00']])]];
  const krr = L.returnReasons(kr.map((x) => x[0]), mapOf(kr), Object.assign(CT(), { retWatch: 'gevinst' }));
  assert.deepStrictEqual(krr.reasons.map((x) => [x.name, x.known, x.watched]), [['Gevinst', true, 'gevinst'], ['Rart', false, '']]);
}
// ---- bongkopi: bare hendelsesord
{
  const orig = bong({ totalAmount: 40 }), copy = bong({ totalAmount: 40 });
  const m = mapOf([[orig, scan([{ c: E1, a: 40 }], { tx: ['Butikk 1005'] })], [copy, scan([{ c: E1, a: 40 }], { tx: ['*** BONG KOPI ***'] })]]);
  assert.deepStrictEqual([L.isCopy(m[orig.transactionId]), L.isCopy(m[copy.transactionId]), L.isCopy(null)], [false, true, false]);
  const sp = L.splitCopies([orig, copy], m);
  assert.deepStrictEqual([sp.items.map((i) => i.transactionId), sp.copies.map((i) => i.transactionId)], [[orig.transactionId], [copy.transactionId]]);
  assert.ok(L.wordList(L.DEFAULT_EV).includes('bong kopi'));
  const ev = L.eventWords([orig, copy], Object.assign({}, m, { [copy.transactionId]: Object.assign({}, m[copy.transactionId], { v: 8 }) }), CT());
  assert.deepStrictEqual(ev.findings.map((f) => [f.ids[0], /«\*\*\* BONG KOPI \*\*\*»/.test(f.detail)]), [[copy.transactionId, true]], 'kopien flagges som hendelsesord');
}

console.log('innhold: ok');
