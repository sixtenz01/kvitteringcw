const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

// Butikknavn: fra gridets BUTIKK-kolonne, egne navn lagt inn i panelet, og nummer alene når ingenting finnes.
const CELL = { 1001: '1001 – Coop Mega Kolbotn', 1002: '1002', 1003: 'Coop Prix Test (1003)', 1004: '1004' };
const rows = [];
[1001, 1002, 1003, 1004].forEach((st, k) => { for (let i = 0; i < 2; i++) rows.push({ transactionId: `${st}-1-${100 + i}`, endDateTime: `2026-10-02 1${k}:${10 + i}`, storeNumber: st, workstationNumber: 1, cashierNumber: 'A', totalAmount: 50 + i, receiptType: 1, memberNumber: null, journalSourceName: 'main' }); });
const receipts = {};
rows.forEach((r) => { receipts[r.transactionId] = '<div>Kvittering: 100 02.10.2026 10:10:00</div><table><tr><td>7000000000001 VARE</td><td></td><td>50.00</td></tr></table>'; });

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<input id="fromDatePicker"><input id="toDatePicker"><input id="freetextSearchInput"><input id="receiptNumber">
<input ng-model="vm.selectedFilters.memberNumber"><input ng-model="vm.selectedFilters.externalLoyaltyNumber">
<button ng-click="vm.resetFilters()">Nullstill</button><button ng-click="vm.applyFilters()">Oppdater</button>
<div class="k-grid-header"><table><colgroup><col><col><col></colgroup><thead><tr><th>DATO</th><th>SUM</th><th>BUTIKK</th></tr></thead></table></div>
<table id="g" data-role="grid"><colgroup><col><col><col></colgroup><tbody>
${rows.map((r, i) => `<tr data-uid="u${i}" data-id="${r.transactionId}"><td></td><td>${r.endDateTime}</td><td data-field="storeNumber">${CELL[r.storeNumber]}</td></tr>`).join('')}
</tbody></table>
<iframe id="rc"></iframe>
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
  const labels = async () => page.$$eval('[data-sec=store] .kvr-chk span', (n) => n.map((x) => x.textContent));
  await go('Filtrer');
  assert.deepStrictEqual(await labels(), ['1001 – Coop Mega Kolbotn', '1002', '1003 – Coop Prix Test', '1004'], 'navn fra BUTIKK-kolonnen, nummer alene der det ikke finnes navn');
  // søk på navn
  await page.fill('[data-sec=store] input[placeholder^="søk butikk"]', 'prix');
  assert.deepStrictEqual(await labels(), ['1003 – Coop Prix Test']);
  await page.fill('[data-sec=store] input[placeholder^="søk butikk"]', '');
  // redigering for butikkene uten navn
  const sum = await page.innerText('[data-sec=store] .kvr-names summary');
  assert.match(sum, /Gi 2 butikker navn \(1002, 1004\)/);
  await page.click('[data-sec=store] .kvr-names summary');
  assert.strictEqual(await page.inputValue('[data-sec=store] .kvr-names textarea'), '1002=\n1004=');
  await page.fill('[data-sec=store] .kvr-names textarea', '1002=Extra Testby\n1004=');
  await page.click('[data-sec=store] .kvr-names button:text-is("Lagre navn")');
  assert.deepStrictEqual(await labels(), ['1001 – Coop Mega Kolbotn', '1002 – Extra Testby', '1003 – Coop Prix Test', '1004']);
  assert.match(await page.innerText('[data-sec=store] .kvr-names summary'), /Gi butikken navn \(1004\)/);
  // navnet vises i filterchipen og overlever omlasting
  await page.click('[data-sec=store] .kvr-chk:has-text("1002") input');
  assert.match(await page.innerText('.kvr-chipsrow'), /Butikk: 1002 – Extra Testby/);
  await load();
  await go('Filtrer');
  assert.deepStrictEqual(await labels(), ['1001 – Coop Mega Kolbotn', '1002 – Extra Testby', '1003 – Coop Prix Test', '1004']);
  // innholdsfiltrene ligger under Filtrer, Skann har bare skanning og varegrupper
  const filt = await page.innerText('[data-sec=content]');
  assert.match(filt, /INNHOLD[\s\S]*Vare[\s\S]*Varegruppe[\s\S]*Pant[\s\S]*Rabatt[\s\S]*Spesialbetaling/);
  assert.ok(!(await page.$('[data-sec=scan] select')), 'ingen filtervalg igjen i Skann');
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(apiCalls, []);
  await browser.close();
  console.log('butikk: ok');
})().catch(e => { console.error(e); process.exit(1); });
