const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

// Pantelapper (99 manuell, 399 maskin), slettede linjer, spesialbetaling, rabatt-prosent, spør pris og kort via skanning i visningsfeltet.
const f2 = (n) => n.toFixed(2);
const TR = (a, c) => `<tr><td>${a}</td><td></td><td>${c}</td></tr>`;
const E1 = '7038010000010', E2 = '7038010000027', E3 = '7038010000034';
const ROWS = [];
let n = 0;
const add = (o) => { n++; ROWS.push(Object.assign({ id: `1001-${o.ws || 1}-${n}`, cashier: 'A', time: `2026-10-02 10:${String(10 + n).padStart(2, '0')}`, ws: 1, tot: 0, body: [] }, o)); };
const vare = (code, name, a) => TR(`${code} ${name}`, f2(a));
// bakgrunn: vanlige salg
for (let i = 0; i < 8; i++) add({ cashier: 'B', tot: 50 + i, body: [vare(`70000000000${i}`, 'VARE', 50 + i), TR('Bank:', f2(50 + i))] });
// 1: manuell pantelapp 60 kr (kode 99), maskin 45 kr (399) hos B to ganger innen 60 min (gjenbruk)
add({ cashier: 'A', tot: -60, body: [TR('99 PANTELAPP', '-60.00'), TR('Kontant tilbake:', '60.00')] });
add({ cashier: 'B', time: '2026-10-02 12:00', tot: -45, body: [TR('399 PANTELAPP', '-45.00'), TR('Kontant tilbake:', '45.00')] });
add({ cashier: 'B', time: '2026-10-02 12:20', ws: 2, tot: -45, body: [TR('399 PANTELAPP', '-45.00'), TR('Kontant tilbake:', '45.00')] });
// 2: slettet pantelapp
add({ cashier: 'C', tot: 0, body: [vare(E3, 'JUICE', 25), TR('399 PANTELAPP', '-25.00'), TR('399 PANTELAPP', '25.00'), TR('Bank:', '25.00')] });
// 3: varer slettet, bare pant og kontant tilbake
add({ cashier: 'C', time: '2026-10-02 13:00', tot: -150, body: [vare(E1, 'MELK', 150), vare(E1, 'MELK', -150), TR('399 PANTELAPP', '-150.00'), TR('Kontant tilbake:', '150.00')] });
// 4: eget forbruk
add({ cashier: 'C', tot: 30, body: [vare(E2, 'KAFFE', 30), TR('Eget forbruk:', '30.00')] });
// 5: rabatt 80 % og 40 % uten treff
add({ cashier: 'D', tot: 10, body: [vare(E2, 'KAFFE', 10), '<tr><td>Rabatt: Kr 40.00 (80 %)</td></tr>', TR('Bank:', '10.00')] });
add({ cashier: 'D', tot: 12, body: [vare(E3, 'JUICE', 12), '<tr><td>Rabatt: Kr 8.00 (40 %)</td></tr>', TR('Bank:', '12.00')] });
// 6: tre returer på samme Visa
for (let i = 0; i < 3; i++) add({ cashier: i === 1 ? 'B' : 'A', tot: -100, time: `2026-10-0${i + 1} 15:00`, body: [vare(E1, 'RETUR', -100), TR('Visa:', '-100.00'), '<tr><td>Kort: ************1234</td></tr>'] });
// 7: spør pris: fire vanlige salg av melk til 20, én med spør pris til 12
for (let i = 0; i < 4; i++) add({ cashier: 'E', tot: 20, time: `2026-10-02 16:0${i}`, body: [vare(E1, 'MELK', 20), '<tr><td>Antall: 1 stk à Kr 20.00</td></tr>', TR('Bank:', '20.00')] });
add({ cashier: 'E', tot: 12, time: '2026-10-02 16:30', body: [vare('7000', 'SPØR PRIS', 0), vare(E1, 'MELK', 12), '<tr><td>Antall: 1 stk à Kr 12.00</td></tr>', TR('Bank:', '12.00')] });
const rows = ROWS.map((r) => ({ transactionId: r.id, endDateTime: r.time, storeNumber: 1001, workstationNumber: r.ws, cashierNumber: r.cashier, totalAmount: r.tot, receiptType: 1, memberNumber: null, journalSourceName: 'main' }));
const receipts = {};
ROWS.forEach((r) => {
  receipts[r.id] = `<div>Kvittering: ${r.id.split('-')[2]} ${r.time.slice(8, 10)}.${r.time.slice(5, 7)}.${r.time.slice(0, 4)} ${r.time.slice(11)}:00</div><table>` + r.body.join('') + `<tr><td></td><td>Totalt</td><td>${f2(r.tot)}</td></tr></table>`;
});

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<input id="fromDatePicker"><input id="toDatePicker"><input id="freetextSearchInput"><input id="receiptNumber">
<input ng-model="vm.selectedFilters.memberNumber"><input ng-model="vm.selectedFilters.externalLoyaltyNumber">
<button ng-click="vm.resetFilters()">Nullstill</button><button ng-click="vm.applyFilters()">Oppdater</button>
<div class="k-grid-header"><table><colgroup><col><col><col></colgroup><thead><tr><th>DATO</th><th>SUM</th><th>KASSERER</th></tr></thead></table></div>
<table id="g" data-role="grid"><colgroup><col><col><col></colgroup><tbody>
${rows.map((r, i) => `<tr data-uid="u${i}" data-id="${r.transactionId}"><td></td><td>${r.endDateTime}</td><td>${r.totalAmount}</td></tr>`).join('')}
</tbody></table>
<div data-w="1"></div><iframe id="rc"></iframe>
<script>
var rows=${JSON.stringify(rows)};var receipts=${JSON.stringify(receipts)};
var items=rows.map(function(r,i){var o=Object.assign({uid:'u'+i},r);o.toJSON=function(){var c=Object.assign({},o);delete c.toJSON;return c};return o});
var cur=null;
var grid={tbody:[document.querySelector('tbody')],dataSource:{view:function(){return items}},
 dataItem:function(tr){return items.filter(function(i){return i.transactionId===tr.getAttribute('data-id')})[0]},
 bind:function(n,f){},
 select:function(tr){if(!arguments.length)return cur?[cur]:[];cur=tr;var id=tr.getAttribute('data-id');setTimeout(function(){document.getElementById('rc').contentDocument.body.innerHTML=receipts[id];},5);},clearSelection:function(){cur=null}};
var ms={dataSource:{data:function(){return [{get:function(k){return {number:1001,text:'Coop Mega Kolbotn'}[k]}}]}},value:function(v){},trigger:function(){}};
function mk(list){return {each:function(fn){list.forEach(function(e,i){fn.call(e,i,e)})},eq:function(i){return mk([list[i]])},data:function(n){var e=list[0];if(!e)return undefined;if(e.getAttribute('data-w'))return n==='kendoMultiSelect'?ms:null;return n==='kendoGrid'?grid:null}}}
window.jQuery=function(a){ if(typeof a==='string') return a.indexOf('#storesWrapper')===0?mk([].slice.call(document.querySelectorAll('[data-w]'))):mk([]); return mk([a]); };
</script></body></html>`;

(async () => {
  const dir = path.join(__dirname, '..');
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ locale: 'nb-NO' })).newPage();
  const errors = [], apiCalls = [];
  page.on('pageerror', e => { errors.push(e.message); console.error('PAGEERROR', e.message); });
  await page.addInitScript(() => { window.__kvrScan = { settle: 0, poll: 10 }; });
  await page.route('https://chainweb.coop.no/**', r => {
    if (r.request().url().indexOf('/Api/') !== -1) { apiCalls.push(r.request().url()); return r.fulfill({ status: 404, body: '' }); }
    return r.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
  });
  const load = async () => {
    await page.goto('https://chainweb.coop.no/LindbakRetail_1/Journal/Viewer');
    for (const f of ['lib/html2canvas.min.js', 'lib/jszip.min.js', 'src/logic.js', 'src/report.js']) await page.addScriptTag({ path: path.join(dir, f) });
    await page.addStyleTag({ path: path.join(dir, 'src/panel.css') });
    await page.addScriptTag({ path: path.join(dir, 'src/content.js') });
    await page.waitForSelector('#kvr-panel');
  };
  await load();
  const go = async (main, sub) => { await page.click(`.kvr-tab:has-text("${main}")`); if (sub) await page.click(`.kvr-sub:text-is("${sub}")`); };
  const txt = async (sel) => (await page.innerText(sel)).replace(/\s+/g, ' ');
  const analyse = async () => {
    await go('Analyse', 'Sjekk først');
    await page.click('[data-sec=chk-top] button:text-is("Kjør analyse")');
    await page.waitForFunction(() => /Kontroller ferdig/.test(document.getElementById('kvr-panel').innerText), null, { timeout: 60000 });
    await go('Analyse', 'Detaljer');
    await page.click('button:text-is("Åpne alle")');
  };
  await analyse();
  const fnd = await txt('[data-sec=findings]');
  assert.match(fnd, /Pantelapp: Manuell pantelapp Kasse 1 10:\d\d kasserer A: 1 manuell pantelapp \(kode 99\), 60\.00 kr/);
  assert.match(fnd, /Pantelapp: Pantelapp innløst flere ganger Pantelapp 45\.00 kr innløst på 2 bonger \(innen 60 min, eller samme kasse samme dag\): 10-02 12:00 kasse 1 \(kasserer B\), 10-02 12:20 kasse 2 \(kasserer B\)/);
  assert.match(fnd, /Pantelapp: Pantelapp slettet .*kasserer C: 1 × pantelapp 25\.00 kr slettet \(linje og motlinje\)/);
  assert.match(fnd, /Slettede linjer: Varelinjer slettet, pant utbetalt kontant .*1 varelinje slettet \(150\.00 kr\)\. Igjen er bare pant, og 150\.00 kr betalt tilbake kontant/);
  assert.match(fnd, /Mønster: Kontant tilbake uten salg flere ganger|Slettede linjer: Varelinjer slettet/);
  assert.match(fnd, /Spesialbetaling: Spesialbetaling på bong .*«Eget forbruk» \(betaling, 30\.00 kr\)/);
  assert.match(fnd, /Rabatt: Høy rabattprosent .*KAFFE −40 kr \(80 %\)/);
  assert.match(fnd, /Rabatt: Rabatt uten treff på andre salg .*JUICE −40 % \(ingen andre dager heller\)/);
  assert.match(fnd, /Kort: Gjentatte returer på samme kort Kort VISA …1234: 3 returer innen 30 dager, totalt 300\.00 kr \(kasserer A ×2, B ×1\)/);
  assert.match(fnd, /Spør pris: Spør pris avviker fra dagens salg .*MELK spør pris 12\.00 mot 20\.00 \(−40 %, 4 salg samme dag\)/);

  // kortet for pantelapper: manuell og maskin per kasserer
  const lapp = await txt('[data-sec=lapp]');
  assert.match(lapp, /Pantemaskin \(kode 399\): \d+ pantelapper, 2\d\d,\d\d kr\. Manuelt innlagt \(kode 99\): 1 pantelapper, 60,00 kr/);
  assert.match(lapp, /Kasserer A\s+1 0 · 0,00 1 · 60,00/);
  const lines = await txt('[data-sec=lines]');
  assert.match(lines, /1 varelinje slettet på 1 bong, 1 av dem med pant og kontant tilbake/);
  assert.match(lines, /Eget forbruk 1 30,00/);
  assert.match(lines, /VISA …1234 3 3 300,00/);

  // samme forhold teller bare én gang: den svakeste årsaken vises overstrøket med forklaring
  await go('Analyse', 'Sjekk først');
  const cov = await page.$$eval('.kvr-reason.kvr-cov', (n) => n.map((x) => x.title + '|' + x.textContent));
  assert.ok(cov.length >= 2, 'overstrøkne årsaker: ' + cov.length);
  assert.ok(cov.every((c) => /^Teller ikke: samme forhold er dekket av «[^»]+»\|/.test(c)), cov.join(' ; '));
  assert.ok(cov.some((c) => /Kontant tilbake uten salg\b/.test(c.split('|')[1])), 'kontant tilbake uten salg er dekket av høyere poeng i samme familie');
  assert.ok(await page.$('.kvr-reason:not(.kvr-cov)'));

  // søk: spesialbetaling og rabatt-prosent
  const viser = async () => (await txt('.kvr-tiles')).match(/^(\d+) \/ (\d+)/)[1];
  await go('Skann');
  await page.selectOption('.kvr-f:has-text("Spesialbetaling") select', '*');
  assert.strictEqual(await viser(), '1');
  assert.match(await txt('.kvr-chipsrow'), /Spesial: alle ord/);
  await page.selectOption('.kvr-f:has-text("Spesialbetaling") select', 'eget forbruk');
  assert.strictEqual(await viser(), '1');
  await page.selectOption('.kvr-f:has-text("Spesialbetaling") select', 'sjekk');
  assert.strictEqual(await viser(), '0');
  await page.selectOption('.kvr-f:has-text("Spesialbetaling") select', '');
  await page.fill('input[placeholder="fra %"]', '70');
  assert.strictEqual(await viser(), '1', 'bare 80 %-rabatten');
  await page.fill('input[placeholder="fra %"]', '40');
  await page.fill('input[placeholder="til %"]', '40');
  assert.strictEqual(await viser(), '1', 'bare 40 %-rabatten');
  assert.match(await txt('.kvr-chipsrow'), /Rabatt % 40 → 40/);
  await page.fill('input[placeholder="fra %"]', '');
  await page.fill('input[placeholder="til %"]', '');
  assert.strictEqual(await viser(), String(rows.length));

  // pantelapp-chip i hopplisten finnes
  await go('Analyse', 'Detaljer');
  assert.ok(await page.$('.kvr-chips button:text-is("Pantelapper")') && await page.$('.kvr-chips button:text-is("Linjer m.m.")'));

  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(apiCalls, []);
  await browser.close();
  console.log('linjer e2e: ok');
})().catch(e => { console.error(e); process.exit(1); });
