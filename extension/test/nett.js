const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

// Nettverk i panelet: grupper av kort og medlemsnr, funn, diagram og ansattnummer.
const ROWS = [], receipts = {};
const TR = (a, c) => `<tr><td>${a}</td><td></td><td>${c}</td></tr>`;
let n = 0;
const add = (o, card) => {
  const id = '1005-1-' + (++n), tot = o.totalAmount === undefined ? 100 : o.totalAmount;
  ROWS.push(Object.assign({ transactionId: id, endDateTime: '2026-10-0' + (1 + (n % 5)) + ' 1' + (n % 10) + ':' + String(n % 60).padStart(2, '0'), storeNumber: 1005, workstationNumber: 1, cashierNumber: 'A', totalAmount: tot, receiptType: 1, saleChannel: 2, memberNumber: null, journalSourceName: 'main' }, o));
  receipts[id] = `<table>${TR('7038010000010 VARE', tot.toFixed(2))}${TR('Totalt', tot.toFixed(2))}${TR('Bank:', tot.toFixed(2))}<tr><td>${card}</td></tr></table>`;
  return id;
};
// ett Visa-kort med fem medlemsnr, nesten bare hos kasserer K, og retur til kortet hos K
['M1', 'M2', 'M3', 'M4', 'M5'].forEach((m) => { add({ memberNumber: m, cashierNumber: 'K' }, 'VISA ************1111'); add({ memberNumber: m, cashierNumber: 'K' }, 'VISA ************1111'); });
const RET = add({ cashierNumber: 'K', totalAmount: -200 }, 'VISA ************1111');
for (let i = 0; i < 6; i++) add({ memberNumber: 'Q1', cashierNumber: ['A', 'B', 'C'][i % 3] }, 'MASTERCARD 5555********2222');
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<input id="fromDatePicker"><input id="toDatePicker"><input id="freetextSearchInput"><input id="receiptNumber">
<button ng-click="vm.applyFilters()" id="apply">Oppdater</button>
<div class="k-grid-header"><table><thead><tr><th>DATO</th><th>SUM</th></tr></thead></table></div>
<div id="g" data-role="grid"><table><tbody></tbody></table></div>
<iframe id="rc"></iframe>
<script>
var ALL=${JSON.stringify(ROWS)}, receipts=${JSON.stringify(receipts)};
var tbody=document.querySelector('#g tbody'),handlers=[],data=[],uid=0,cur=null;
var grid={tbody:[tbody],dataSource:{data:function(){return data},view:function(){return data}},
  bind:function(n,f){if(n==='dataBound')handlers.push(f)},
  dataItem:function(tr){var u=tr.getAttribute('data-uid');return data.filter(function(d){return d.uid===u})[0]},
  select:function(tr){if(!arguments.length)return cur?[cur]:[];cur=tr;var d=grid.dataItem(tr);setTimeout(function(){document.getElementById('rc').contentDocument.body.innerHTML=receipts[d.transactionId]},3)},
  clearSelection:function(){cur=null}};
function render(list){data=list.map(function(r){return Object.assign({uid:'u'+(++uid)},r)});
  tbody.innerHTML=data.map(function(d){return '<tr data-uid="'+d.uid+'"><td data-field="endDateTime">'+d.endDateTime+'</td><td>'+d.totalAmount+'</td></tr>'}).join('');
  handlers.forEach(function(f){f()})}
function mk(list){return{each:function(fn){list.forEach(function(e,i){fn.call(e,i,e)})},eq:function(i){return mk([list[i]])},data:function(n){var e=list[0];return e&&e.__w?e.__w[n]:undefined}}}
document.getElementById('g').__w={kendoGrid:grid};
window.jQuery=function(a){return typeof a==='string'?mk([]):mk([a])};
render(ALL);
</script></body></html>`;

(async () => {
  const dir = path.join(__dirname, '..');
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ locale: 'nb-NO', viewport: { width: 1400, height: 1000 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.error('PAGEERROR', e.message); });
  await page.addInitScript(() => { window.__kvrScan = { settle: 0, poll: 5, min: 1, pause: 50, timeout: 1500 }; });
  await page.route('https://chainweb.coop.no/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  const load = async (prep, arg) => {
    await page.goto('https://chainweb.coop.no/LindbakRetail_1/Journal/Viewer');
    if (prep) await page.evaluate(prep, arg);
    for (const f of ['lib/html2canvas.min.js', 'lib/jszip.min.js', 'src/logic.js', 'src/report.js']) await page.addScriptTag({ path: path.join(dir, f) });
    await page.addStyleTag({ path: path.join(dir, 'src/panel.css') });
    await page.addScriptTag({ path: path.join(dir, 'src/content.js') });
    await page.waitForFunction(() => document.querySelectorAll('#g tbody td.kvr-cb-cell').length > 0);
  };
  const analyse = async () => {
    await page.click('.kvr-tab:has-text("Analyse")');
    await page.click('.kvr-sub:text-is("Sjekk først")');
    await page.click('[data-sec=chk-top] button:text-is("Kjør analyse")');
    await page.waitForFunction(() => /Kontroller ferdig/.test(document.getElementById('kvr-panel').innerText) && document.querySelector('[data-sec=chk-list] .kvr-ck'), null, { timeout: 120000 });
  };

  await load();
  await analyse();
  await page.click('.kvr-sub:text-is("Detaljer")');
  await page.evaluate(() => { const b = [...document.querySelectorAll('#kvr-panel button')].find(x => x.textContent === 'Vis alt'); if (b) b.click(); });
  const all = (await page.innerText('#kvr-panel')).replace(/\s+/g, ' ');
  assert.match(all, /Nettverk: Kort brukt med mange medlemsnr 5 medlemsnr \(M1, M2, M3, M4 …\) og 1 kort \(VISA …1111\) henger sammen på 11 bonger; kasserer K \(10\)\./);
  assert.match(all, /Nettverk: Retur til kort i kassererens nettverk Kasse 1 [\d:]+ kasserer K: 200\.00 kr tilbake til VISA …1111/);
  const net = (await page.innerText('[data-sec=net]')).replace(/\s+/g, ' ');
  assert.match(net, /17 av 17 salg er skannet med kortdata\. 1 gruppe med minst tre ledd/);
  assert.match(net, /Medlemsnr Kort Bonger Mest hos kasserer Retur til kortene Funn 5: M1, M2, M3 … 1: VISA …1111 11 K \(100 %\) 1 \(200,00 kr\) mange medlemsnr, egen kasserer/);
  // diagram for gruppen
  await page.click('[data-sec=net] button:text-is("5: M1, M2, M3 …")');
  await page.waitForSelector('[data-sec=net] svg.kvr-net');
  const labels = await page.$$eval('[data-sec=net] svg.kvr-net .kvr-net-t', (t) => t.map((x) => x.firstChild.nodeValue));
  assert.deepStrictEqual(labels.sort(), ['K', 'M1', 'M2', 'M3', 'M4', 'M5', 'VISA …1111'].sort());
  assert.strictEqual(await page.$$eval('[data-sec=net] svg.kvr-net line.kvr-net-ret', (l) => l.length), 1, 'returen er rød');
  await page.click('[data-sec=net] button:has-text("Velg bongene")');
  assert.match(await page.innerText('.kvr-tiles'), /11\s*Valgt/);
  // ansattnummer: retur til kort knyttet til ansatt
  await page.click('.kvr-tab:has-text("Mer")');
  await page.click('.kvr-sub:text-is("Innstillinger")');
  if (!(await page.$eval('[data-sec=set-member]', (d) => d.open))) await page.click('[data-sec=set-member] summary');
  await page.check('[data-sec=set-member] input[aria-label="Ansattes medlemsnr: på"]').catch(() => {});
  const emp = page.locator('[data-sec=set-member] input[aria-label="Ansattes medlemsnr"]');
  await emp.fill('K=M3'); await emp.press('Tab');
  await analyse();
  await page.click('.kvr-sub:text-is("Detaljer")');
  await page.evaluate(() => { const b = [...document.querySelectorAll('#kvr-panel button')].find(x => x.textContent === 'Vis alt'); if (b) b.click(); });
  assert.match((await page.innerText('#kvr-panel')).replace(/\s+/g, ' '), /Nettverk: Retur til kort knyttet til ansatt Kasse 1 [\d:]+ kasserer K: 200\.00 kr tilbake til VISA …1111, som er brukt med ansattnummer M3 \(kasserer K\)\./);

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('nett e2e: ok');
})().catch((e) => { console.error(e); process.exit(1); });
