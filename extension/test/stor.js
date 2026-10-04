const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

// Stor visning: panelstørrelse vanlig → stor (dokket til høyre) → full, flerkolonne-layout og husk valget.
const rows = [], receipts = {};
for (let i = 0; i < 24; i++) {
  const id = `1001-${1 + (i % 2)}-${100 + i}`;
  rows.push({ transactionId: id, endDateTime: `2026-10-0${1 + (i % 3)} 1${i % 10}:15`, storeNumber: 1001, workstationNumber: 1 + (i % 2), cashierNumber: ['A', 'B', 'C'][i % 3], totalAmount: i === 5 ? 600 : 50 + i * 7, receiptType: 1, memberNumber: null, journalSourceName: 'main' });
  receipts[id] = `<div>Kvittering: ${100 + i} 01.10.2026 10:00:00</div><table><tr><td>7000000000001 VARE</td><td></td><td>${(50 + i * 7).toFixed(2)}</td></tr><tr><td>Bank:</td><td></td><td>${(50 + i * 7).toFixed(2)}</td></tr></table>`;
}
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
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
  const page = await (await browser.newContext({ locale: 'nb-NO', viewport: { width: 1600, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.error('PAGEERROR', e.message); });
  await page.addInitScript(() => { window.__kvrScan = { settle: 0, poll: 10 }; });
  await page.route('https://chainweb.coop.no/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  const load = async () => {
    await page.goto('https://chainweb.coop.no/LindbakRetail_1/Journal/Viewer');
    for (const f of ['lib/html2canvas.min.js', 'lib/jszip.min.js', 'src/logic.js', 'src/report.js']) await page.addScriptTag({ path: path.join(dir, f) });
    await page.addStyleTag({ path: path.join(dir, 'src/panel.css') });
    await page.addScriptTag({ path: path.join(dir, 'src/content.js') });
    await page.waitForSelector('#kvr-panel');
  };
  await load();
  const box = () => page.$eval('#kvr-panel', n => { const r = n.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), cls: n.className }; });
  const go = async (main, sub) => { await page.click(`.kvr-tab:has-text("${main}")`); if (sub) await page.click(`.kvr-sub:text-is("${sub}")`); };
  const cols = () => page.$$eval('#kvr-panel .kvr-scroll .kvr-card', cs => { const x = {}; cs.filter(c => c.offsetParent !== null).forEach(c => { x[Math.round(c.getBoundingClientRect().left / 20)] = true; }); return Object.keys(x).length; });

  await go('Analyse', 'Diagram');
  const b0 = await box();
  assert.ok(!/kvr-big|kvr-full/.test(b0.cls) && b0.w < 500, 'vanlig størrelse først');
  assert.strictEqual(await cols(), 1);
  await page.click('button[aria-label="Panelstørrelse"]');
  const b1 = await box();
  assert.ok(/kvr-big/.test(b1.cls));
  assert.ok(b1.w >= 980 && b1.w <= 1000, 'stor: 62 % av bredden (' + b1.w + ')');
  assert.ok(b1.l > 560 && b1.l + b1.w <= 1600 - 10, 'dokket til høyre, lista til venstre er synlig');
  assert.ok(b1.h >= 870, 'stor: nesten full høyde');
  assert.strictEqual(await page.$eval('#kvr-panel .kvr-head', n => getComputedStyle(n).cursor), 'default');
  assert.ok(await page.$eval('html', n => n.classList.contains('kvr-bigui')));
  assert.ok((await page.$$eval('tbody tr', t => t[0].getBoundingClientRect().left)) < 200, 'Lindbak-lista ligger fortsatt til venstre');
  assert.ok((await cols()) >= 2, 'minst to kolonner i stor');
  assert.match(await page.$eval('button[aria-label="Panelstørrelse"]', n => n.title), /Fullskjerm/);
  await page.click('button[aria-label="Panelstørrelse"]');
  const b2 = await box();
  assert.ok(/kvr-full/.test(b2.cls) && b2.w >= 1550 && b2.h >= 860, 'full: nesten hele skjermen (' + JSON.stringify(b2) + ')');
  assert.ok((await cols()) >= 3, 'minst tre kolonner i full');
  // modal bruker mer bredde i stor visning
  await page.click('#kvr-panel button[aria-label="Hjelp"]');
  assert.ok((await page.$eval('.kvr-dlg', n => n.getBoundingClientRect().width)) > 900, 'dialog blir bredere');
  await page.keyboard.press('Escape');

  // valget huskes etter omlasting
  await load();
  assert.ok(/kvr-full/.test((await box()).cls), 'full huskes');
  // innstillingen under Generelt følger knappen og kan endre størrelsen
  await go('Mer', 'Innstillinger');
  assert.strictEqual(await page.inputValue('select[aria-label="Panelstørrelse"]'), '2');
  await page.selectOption('select[aria-label="Panelstørrelse"]', '1');
  assert.ok(/kvr-big/.test((await box()).cls));
  // «Vis i listen» fra full visning flytter panelet til siden (dokket), uten å lagre valget
  await page.selectOption('select[aria-label="Panelstørrelse"]', '2');
  await go('Analyse', 'Sjekk først');
  await page.click('[data-sec=chk-top] button:text-is("Kjør analyse")');
  await page.waitForFunction(() => /Kontroller ferdig/.test(document.getElementById('kvr-panel').innerText), null, { timeout: 60000 });
  await page.click('#kvr-panel button:text-is("Vis i listen")');
  assert.ok(/kvr-big/.test((await box()).cls) && !/kvr-full/.test((await box()).cls), 'midlertidig dokket');
  assert.ok((await page.$eval('tbody tr[data-id="1001-2-105"]', t => t.classList.contains('kvr-flag'))), 'raden er flagget og i lista');
  await load();
  assert.ok(/kvr-full/.test((await box()).cls), 'valget ble ikke endret av midlertidig bytte');
  // tilbake til vanlig: plassering og størrelse gjenopprettes
  await go('Mer', 'Innstillinger');
  await page.selectOption('select[aria-label="Panelstørrelse"]', '0');
  const b3 = await box();
  assert.ok(!/kvr-big|kvr-full/.test(b3.cls) && b3.w < 500, 'tilbake til vanlig');
  assert.ok(!(await page.$eval('html', n => n.classList.contains('kvr-bigui'))));
  assert.ok(b3.l >= 0 && b3.l + b3.w <= 1600 && b3.t >= 0, 'panelet ligger innenfor skjermen');
  await load();
  assert.ok(!/kvr-big|kvr-full/.test((await box()).cls), 'vanlig huskes');
  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('stor: ok');
})().catch(e => { console.error(e); process.exit(1); });
