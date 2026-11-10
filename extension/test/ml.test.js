const assert = require('assert');
const L = require('../src/logic.js');

// Maskinlæring i pluginen: isolasjonsskog for uvanlige bonger og en modell som lærer av vurderingene. Alt lokalt og deterministisk.
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pop = [], scan = {};
for (let i = 0; i < 600; i++) {
  const id = 'S-' + String(i).padStart(4, '0'), h = 8 + Math.floor(rnd() * 12), m = Math.floor(rnd() * 60), amt = Math.round((40 + rnd() * 250) * 100) / 100;
  pop.push({ transactionId: id, endDateTime: '2026-10-0' + (1 + (i % 5)) + ' ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'), storeNumber: 1005, workstationNumber: 1 + (i % 3), cashierNumber: 'K' + (i % 4), totalAmount: amt, receiptType: 1, memberNumber: i % 7 ? null : 'M' + i });
  scan[id] = { v: 9, items: [{ c: '7038010000010', n: 'VARE', a: amt }], pay: { Bank: amt }, tot: amt, ret: 0, coupons: [] };
}
// varene slettes, pant betales ut kontant kl. 05:10: skiller seg ut på flere egenskaper
const odd = { transactionId: 'ODD', endDateTime: '2026-10-03 05:10', storeNumber: 1005, workstationNumber: 2, cashierNumber: 'K1', totalAmount: -150, receiptType: 1 };
pop.push(odd);
scan.ODD = { v: 9, items: [{ c: '7038010000027', n: 'VARE', a: 150 }, { c: '7038010000027', n: 'VARE', a: -150 }, { c: '399', n: 'PANTELAPP', a: -150 }], pay: { 'Kontant tilbake': 150 }, tot: -150, ret: -150, retLines: 1, coupons: [] };
const cfg = L.defaultControl();
assert.deepStrictEqual([cfg.mlTopPct, cfg.mlMinScore, cfg.mlMinN, cfg.mlLearnMin], ['1', '60', '200', '8']);

const r = L.mlAnomaly(pop, pop, scan, cfg);
assert.ok(r.applicable && r.n === 601);
const f = r.findings.find((x) => x.ids[0] === 'ODD');
assert.ok(f && f.flag && f.code === 'mlOdd' && f.title === 'Uvanlig bong (maskinlæring)');
assert.match(f.detail, /Kasse 2 05:10 kasserer K1: uvanlighet \d+ av 100 \(blant de 1 % mest uvanlige av 601 skannede salg\)\. Uvanlig: .*kl\. 05:10 \(0,2 % av bongene har så tidlig\)/);
assert.ok(r.scores.ODD > 0.65 && r.scores.ODD === Math.max(...Object.values(r.scores)), 'den avvikende bongen er mest uvanlig');
assert.ok(r.findings.length <= Math.ceil(601 * 0.01), 'høyst 1 %');
assert.ok(r.findings.every((x) => /Uvanlig: .*\(\d|Uvanlig: .*under 0,1/.test(x.detail)), 'hvert funn har en tydelig egenskap');
assert.strictEqual(L.RISK_WEIGHTS['Uvanlig bong (maskinlæring)'], 2);

// samme data gir samme resultat, uansett rekkefølge i listen
const rev = pop.slice().reverse();
assert.deepStrictEqual(L.mlAnomaly(rev, rev, scan, cfg).scores, r.scores);
// medlemsnummer og kasserer er ikke med i modellen
const anon = pop.map((it) => Object.assign({}, it, { cashierNumber: 'X', memberNumber: null }));
assert.deepStrictEqual(L.mlAnomaly(anon, anon, scan, cfg).scores, r.scores);
// bare bonger i omfanget flagges; modellen lærer av hele grunnlaget
assert.deepStrictEqual(L.mlAnomaly([pop[0]], pop, scan, cfg).findings.length, 0);
assert.strictEqual(L.mlAnomaly([odd], pop, scan, cfg).findings.length, 1);
// for få skannede salg: ikke kjørt; av: uvanlighet regnes, men ingen funn
const few = pop.slice(0, 150);
assert.ok(!L.mlAnomaly(few, few, scan, cfg).applicable);
const off = L.mlAnomaly(pop, pop, scan, Object.assign({}, cfg, { mlTopPct: '' }));
assert.ok(off.applicable && off.findings.length === 0 && off.scores.ODD > 0.65);
// uskannede bonger og andre typer er ikke med
assert.strictEqual(L.mlAnomaly(pop, pop.concat([{ transactionId: 'U', endDateTime: '2026-10-01 10:00', storeNumber: 1005, workstationNumber: 1, cashierNumber: 'K0', totalAmount: 10, receiptType: 1 }]), scan, cfg).n, 601);

// isolasjonsskogen alene: et punkt langt unna gir høyere poeng
const X = [];
for (let i = 0; i < 300; i++) X.push([rnd(), rnd()]);
const forest = L.isolationForest(X, { trees: 100, sample: 128, seed: 1 });
assert.ok(forest.score([5, 5]) > forest.score([0.5, 0.5]) + 0.15);

// ---- lær av vurderingene
const notes = {}, anom = {};
const ids = Object.keys(r.raw).filter((id) => id !== 'ODD').slice(0, 40);
ids.forEach((id, i) => {
  const pos = i % 2 === 0;
  anom[id] = pos ? ['Rabatt med overvåket årsak', 'Høy rabattprosent'] : ['Rundt beløp'];
  notes[id] = { status: pos ? 'oppfolging' : 'sjekket', note: '' };
});
const cand = ['NEW-1', 'NEW-2'];
anom['NEW-1'] = ['Rabatt med overvåket årsak']; anom['NEW-2'] = ['Rundt beløp'];
const lr = L.mlLearn(cand, anom, notes, r, cfg);
assert.ok(lr.trained && lr.pos === 20 && lr.neg === 20);
assert.ok(lr.auc > 0.9, 'testene som slo ut, skiller vurderingene: AUC ' + lr.auc);
assert.ok(lr.p['NEW-1'] > 0.6 && lr.p['NEW-2'] < 0.3, JSON.stringify(lr.p));
assert.ok(lr.why['NEW-1'].includes('«Rabatt med overvåket årsak»'));
// for få vurderinger, eller av
const few2 = {}; ids.slice(0, 10).forEach((id) => { few2[id] = notes[id]; });
const lf = L.mlLearn(cand, anom, few2, r, cfg);
assert.ok(!lf.trained && lf.on && lf.pos === 5 && lf.neg === 5);
assert.ok(!L.mlLearn(cand, anom, notes, r, Object.assign({}, cfg, { mlLearnMin: '' })).on);
// samme vurderinger gir samme modell
assert.deepStrictEqual(L.mlLearn(cand, anom, notes, r, cfg).p, lr.p);
// «Flagget av deg» følger vurderingen og er ikke en egenskap: samme modell med og uten
const anomM = Object.assign({}, anom);
ids.forEach((id, i) => { if (i % 2 === 0) anomM[id] = anom[id].concat([L.MANUAL_FLAG]); });
assert.strictEqual(L.MANUAL_FLAG, 'Flagget av deg');
assert.strictEqual(L.RISK_WEIGHTS['Flagget av deg'], 8);
assert.deepStrictEqual(L.mlLearn(cand, anomM, notes, r, cfg).p, lr.p);

// ---- selvtrening: lærer av reglenes sikre funn og flagger bonger som ligner
{
  let s2 = 11;
  const r2 = () => (s2 = (s2 * 16807) % 2147483647) / 2147483647;
  const items = [], raw = {}, an = {};
  for (let i = 0; i < 400; i++) {
    const id = 'T' + String(i).padStart(4, '0');
    items.push({ transactionId: id, endDateTime: '2026-10-02 12:' + String(i % 60).padStart(2, '0'), storeNumber: 1, workstationNumber: 1 + (i % 4), cashierNumber: 'K' + (i % 5), totalAmount: 100, receiptType: 1 });
    let back = 0;
    if (i % 20 === 0) back = 300 + r2() * 200;      // sikre funn (høy risiko fra reglene)
    if (i % 50 === 7) back = 180 + r2() * 40;        // like under: reglene ser dem ikke
    raw[id] = [100 + r2() * 200, 600 + r2() * 300, 1 + Math.floor(r2() * 8), 0, 0, 0, 0, back, r2(), 2 + r2() * 5];
    if (i % 20 === 0) an[id] = ['Kontant tilbake uten salg'];
  }
  const ml = { raw }, w8 = Object.assign({}, L.sanitizeWeights({}), { 'Kontant tilbake uten salg': 8 });
  const near = items.filter((_, i) => i % 50 === 7).map((it) => it.transactionId);
  const c0 = L.defaultControl();
  assert.deepStrictEqual([c0.mlSelfP, c0.mlSelfMinPos, c0.mlSelfAuc, c0.mlSelfTop], ['80', '10', '75', '1']);
  assert.strictEqual(L.RISK_WEIGHTS['Ligner sikre funn (maskinlæring)'], 2);
  const c5 = Object.assign({}, c0, { mlSelfTop: '5' });
  const sf = L.mlSelf(items, an, {}, ml, w8, c5);
  assert.ok(sf.applicable && sf.trained && sf.pos === 20 && sf.neg === 380 && sf.auc >= 0.9, JSON.stringify({ pos: sf.pos, neg: sf.neg, auc: sf.auc }));
  assert.deepStrictEqual(sf.findings.map((f) => f.ids[0]).sort(), near.slice().sort(), 'alle bongene like under terskelen, og ingen andre');
  const f0 = sf.findings[0];
  assert.ok(f0.flag && f0.code === 'mlSelf' && f0.kind === 'Maskinlæring' && f0.title === 'Ligner sikre funn (maskinlæring)');
  assert.match(f0.detail, /^Kasse \d \d\d:\d\d kasserer K\d: \d+ % likhet med bonger som har høy risiko \([\d.]+ kr kontant tilbake\), men reglene har ikke gitt den høy risiko\. Modellen er trent på 20 sikre funn og 380 rene bonger; treffsikkerhet på bonger den ikke har trent på \(AUC\) 1\.$/);
  // bonger med høy risiko fra før flagges ikke igjen
  assert.ok(sf.findings.every((f) => !an[f.ids[0]]));
  // standard: høyst 1 % av salgene
  assert.strictEqual(L.mlSelf(items, an, {}, ml, w8, c0).findings.length, 4);
  // vurderingene dine: «Sjekket» flagges ikke og teller som ren; «Til oppfølging» teller som sikkert funn
  const nt = { [near[0]]: { status: 'sjekket' }, [items[3].transactionId]: { status: 'oppfolging' } };
  const su = L.mlSelf(items, an, nt, ml, w8, c5);
  assert.ok(su.user === 2 && su.pos === 21 && !su.findings.some((f) => f.ids[0] === near[0]));
  assert.match(su.findings[0].detail, /trent på 21 sikre funn og 379 rene bonger, 2 av dem vurdert av deg;/);
  // samme data gir samme modell, uansett rekkefølge
  assert.deepStrictEqual(L.mlSelf(items.slice().reverse(), an, {}, ml, w8, c5).p, sf.p);
  // av, for få sikre funn, eller modellen skiller ikke (tilfeldige funn): ingen funn
  assert.ok(!L.mlSelf(items, an, {}, ml, w8, Object.assign({}, c5, { mlSelfP: '' })).on);
  const fewPos = L.mlSelf(items, an, {}, ml, w8, Object.assign({}, c5, { mlSelfMinPos: '30' }));
  assert.ok(fewPos.on && !fewPos.applicable && fewPos.findings.length === 0);
  const rnd2 = {};
  items.forEach((it, i) => { if (i % 20 === 3) rnd2[it.transactionId] = ['Kontant tilbake uten salg']; });
  const noise = L.mlSelf(items, rnd2, {}, ml, w8, c5);
  assert.ok(noise.trained && noise.auc < 0.75 && noise.findings.length === 0, 'AUC ' + noise.auc);
  // maskinlæringsfunn teller ikke som regler: en bong med bare «Uvanlig bong» er ren
  const an2 = Object.assign({}, an, { [items[1].transactionId]: ['Uvanlig bong (maskinlæring)'] });
  assert.strictEqual(L.mlSelf(items, an2, {}, ml, w8, c5).neg, 380);
  // eget flagg uten vurdering teller heller ikke som regel
  const an3 = Object.assign({}, an, { [items[1].transactionId]: [L.MANUAL_FLAG] });
  assert.strictEqual(L.mlSelf(items, an3, {}, ml, w8, c5).neg, 380);
}

// ---- «Vurder disse neste»: mest usikre først, høyst N per kasserer; uten modell etter poeng
{
  const rows = [{ id: 'a', cashier: 1, p: 0.9, score: 1 }, { id: 'b', cashier: 1, p: 0.52, score: 1 }, { id: 'c', cashier: 2, p: 0.45, score: 3 }, { id: 'd', cashier: 1, p: 0.5, score: 0 }, { id: 'e', cashier: 3, p: 0.1, score: 9 }];
  assert.deepStrictEqual(L.reviewNext(rows, 3, 1), { ids: ['d', 'c', 'e'], mode: 'usikker' });
  assert.deepStrictEqual(L.reviewNext(rows, 10, 3).ids, ['d', 'b', 'c', 'e', 'a'], 'like usikre (0,9 og 0,1): høyest poeng først');
  const np = rows.map((r) => ({ id: r.id, cashier: r.cashier, score: r.score }));
  assert.deepStrictEqual(L.reviewNext(np, 3, 3), { ids: ['e', 'c', 'a'], mode: 'poeng' });
}

console.log('ml: ok');
