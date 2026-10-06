const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

// Butikknummer = nivå + avdelingsnummer (1311003 = nivå 131, avdeling 1003): gruppert liste, søk, valg av nivå og navn.
const rows = [];
[1311003, 1311005, 1321001].forEach((st, k) => { for (let i = 0; i < 2; i++) rows.push({ transactionId: `${st}-1-${100 + i}`, endDateTime: `2026-10-02 1${k}:${10 + i}`, storeNumber: st, workstationNumber: 1, cashierNumber: 'A', totalAmount: 50 + i, receiptType: 1, memberNumber: null, journalSourceName: 'main' }); });
const receipts = {};
rows.forEach((r) => { receipts[r.transactionId] = '<div>Kvittering: 100 02.10.2026 10:10:00</div><table><tr><td>7000000000001 VARE</td><td></td><td>50.00</td></tr></table>'; });

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<input id="fromDatePicker"><input id="toDatePicker"><input id="freetextSearchInput"><input id="receiptNumber">
<input ng-model="vm.selectedFilters.memberNumber"><input ng-model="vm.selectedFilters.externalLoyaltyNumber">
<button ng-click="vm.resetFilters()">Nullstill</button><button ng-click="vm.applyFilters()">Oppdater</button>
<div class="k-grid-header"><table><colgroup><col><col><col></colgroup><thead><tr><th>DATO</th><th>SUM</th><th>BUTIKK</th></tr></thead></table></div>
<table id="g" data-role="grid"><colgroup><col><col><col></colgroup><tbody>
${rows.map((r, i) => `<tr data-uid="u${i}" data-id="${r.transactionId}"><td></td><td>${r.endDateTime}</td><td data-field="storeNumber">${r.storeNumber}</td></tr>`).join('')}
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
  const lvls = () => page.$$eval('[data-sec=store] .kvr-lvl b', (n) => n.map((x) => x.textContent));
  const items = () => page.$$eval('[data-sec=store] .kvr-chk span', (n) => n.map((x) => x.textContent));
  const viser = async () => (await page.innerText('.kvr-tiles')).match(/^(\d+) \/ (\d+)/)[1];
  const q = (v) => page.fill('[data-sec=store] input[placeholder^="søk butikk"]', v);
  await page.click('.kvr-tab:has-text("Filtrer")');
  assert.deepStrictEqual(await lvls(), ['Nivå 131', 'Nivå 132']);
  assert.deepStrictEqual(await items(), ['1003', '1005', '1001'], 'avdelingsnummer, gruppert etter nivå');
  assert.strictEqual(await page.getAttribute('[data-sec=store] .kvr-chk', 'title'), 'Butikknummer 1311003: nivå 131, avdeling 1003');
  // søk på hele nummeret, avdelingsnummer og nivå
  await q('1311005'); assert.deepStrictEqual(await items(), ['1005']);
  await q('1003'); assert.deepStrictEqual(await items(), ['1003']);
  await q('nivå 132'); assert.deepStrictEqual(await items(), ['1001']);
  await q('');
  // velg et helt nivå
  await page.click('[data-sec=store] .kvr-lvl:first-child button:text-is("Velg")');
  assert.match(await page.innerText('[data-sec=store] .kvr-boxacts'), /2 av 3 valgt/);
  assert.match(await page.innerText('.kvr-chipsrow'), /Butikk: 1003 \(nivå 131\), 1005 \(nivå 131\)/);
  assert.strictEqual(await viser(), '4');
  await page.click('[data-sec=store] .kvr-lvl:first-child button:text-is("Fjern")');
  assert.strictEqual(await viser(), '6');
  // navn på nivå og butikk
  assert.match(await page.innerText('[data-sec=store] .kvr-names summary'), /Gi 3 butikker navn og nivå \(131, 132\)/);
  await page.click('[data-sec=store] .kvr-names summary');
  assert.strictEqual(await page.inputValue('[data-sec=store] .kvr-names textarea'), '131=\n132=\n1311003=\n1311005=\n1321001=');
  await page.fill('[data-sec=store] .kvr-names textarea', '131=Coop Øst\n1311003=Prix Bø');
  await page.click('[data-sec=store] .kvr-names button:text-is("Lagre navn")');
  assert.deepStrictEqual(await lvls(), ['Nivå 131 – Coop Øst', 'Nivå 132']);
  assert.deepStrictEqual(await items(), ['1003 – Prix Bø', '1005', '1001']);
  await q('prix'); assert.deepStrictEqual(await items(), ['1003 – Prix Bø']); await q('');
  await page.click('[data-sec=store] .kvr-chk:has-text("1003") input');
  assert.match(await page.innerText('.kvr-chipsrow'), /Butikk: 1003 – Prix Bø \(nivå 131\)/);
  await load();
  await page.click('.kvr-tab:has-text("Filtrer")');
  assert.deepStrictEqual(await lvls(), ['Nivå 131 – Coop Øst', 'Nivå 132']);
  assert.deepStrictEqual(await items(), ['1003 – Prix Bø', '1005', '1001']);
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(apiCalls, []);
  await browser.close();
  console.log('avdeling: ok');
})().catch(e => { console.error(e); process.exit(1); });
