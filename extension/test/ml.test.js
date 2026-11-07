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

console.log('ml: ok');
