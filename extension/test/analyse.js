const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

// Analysen står fast når CW-listen byttes (nytt søk), og en bong utenfor listen kan hentes fram igjen.
const f2 = (n) => n.toFixed(2);
const TR = (a, c) => `<tr><td>${a}</td><td></td><td>${c}</td></tr>`;
const make = (n, o) => Object.assign({ id: `1001-1-${n}`, cashier: 'B', time: `2026-10-02 10:${String(10 + n).padStart(2, '0')}`, tot: 50 + n, body: [TR(`70000000000${n % 10} VARE`, f2(50 + n)), TR('Bank:', f2(50 + n))] }, o);
const FIRST = [];
for (let i = 1; i <= 5; i++) FIRST.push(make(i));
// tre bonger med manuell pantelapp (kode 99): flagges som avvik
for (let i = 6; i <= 8; i++) FIRST.push(make(i, { cashier: 'C', tot: -80, body: [TR('99 PANTELAPP', '-80.00'), TR('Kontant tilbake:', '80.00')] }));
// listen etter et manuelt søk i CW: helt andre bonger
const OTHER = [];
for (let i = 21; i <= 23; i++) OTHER.push(make(i, { time: `2026-10-03 09:${String(10 + i)}` }));
const row = (r) => ({ transactionId: r.id, endDateTime: r.time, storeNumber: 1001, workstationNumber: 1, cashierNumber: r.cashier, totalAmount: r.tot, receiptType: 1, memberNumber: null, journalSourceName: 'main' });
const ALL = FIRST.concat(OTHER);
const receipts = {};
ALL.forEach((r) => { receipts[r.id] = `<div>Kvittering: ${r.id.split('-')[2]} ${r.time.slice(8, 10)}.${r.time.slice(5, 7)}.${r.time.slice(0, 4)} ${r.time.slice(11, 16)}:00</div><table>${r.body.join('')}</table>`; });

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<input id="fromDatePicker"><input id="toDatePicker"><input id="freetextSearchInput"><input id="receiptNumber">
<input ng-model="vm.selectedFilters.memberNumber"><input ng-model="vm.selectedFilters.externalLoyaltyNumber">
<button ng-click="vm.resetFilters()">Nullstill</button><button ng-click="vm.applyFilters()" onclick="window.__apply()">Oppdater</button>
<div class="k-grid-header"><table><colgroup><col><col><col></colgroup><thead><tr><th>DATO</th><th>SUM</th><th>KASSERER</th></tr></thead></table></div>
<table id="g" data-role="grid"><colgroup><col><col><col></colgroup><tbody></tbody></table>
<div data-w="1"></div><iframe id="rc"></iframe>
<script>
var FIRST=${JSON.stringify(FIRST.map(row))}, OTHER=${JSON.stringify(OTHER.map(row))}, receipts=${JSON.stringify(receipts)};
var items=[],cur=null,gen=0;
function setRows(list){
  gen++;items=list.map(function(r,i){var o=Object.assign({uid:'g'+gen+'-'+i},r);o.toJSON=function(){var c=Object.assign({},o);delete c.toJSON;return c};return o});
  document.querySelector('tbody').innerHTML=items.map(function(o){return '<tr data-uid="'+o.uid+'" data-id="'+o.transactionId+'"><td></td><td>'+o.endDateTime+'</td><td>'+o.totalAmount+'</td></tr>'}).join('');
  cur=null;(window.__bound||[]).forEach(function(f){f()});
}
window.__setRows=setRows;
window.__apply=function(){setTimeout(function(){setRows(FIRST)},30)};
var grid={tbody:[document.querySelector('tbody')],dataSource:{view:function(){return items}},
 dataItem:function(tr){return items.filter(function(i){return i.transactionId===tr.getAttribute('data-id')})[0]},
 bind:function(n,f){(window.__bound=window.__bound||[]).push(f)},
 select:function(tr){if(!arguments.length)return cur?[cur]:[];cur=tr;var id=tr.getAttribute('data-id');setTimeout(function(){document.getElementById('rc').contentDocument.body.innerHTML=receipts[id];},window.__delay||5);},clearSelection:function(){cur=null}};
var ms={dataSource:{data:function(){return [{get:function(k){return {number:1001,text:'Coop Mega Kolbotn'}[k]}}]}},value:function(v){},trigger:function(){}};
function mk(list){return {each:function(fn){list.forEach(function(e,i){fn.call(e,i,e)})},eq:function(i){return mk([list[i]])},data:function(n){var e=list[0];if(!e)return undefined;if(e.getAttribute('data-w'))return n==='kendoMultiSelect'?ms:null;return n==='kendoGrid'?grid:null},val:function(){}}}
window.jQuery=function(a){ if(typeof a==='string') return a.indexOf('#storesWrapper')===0?mk([].slice.call(document.querySelectorAll('[data-w]'))):mk([]); return mk([a]); };
setRows(FIRST);
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
  await page.goto('https://chainweb.coop.no/LindbakRetail_1/Journal/Viewer');
  for (const f of ['lib/html2canvas.min.js', 'lib/jszip.min.js', 'src/logic.js', 'src/report.js']) await page.addScriptTag({ path: path.join(dir, f) });
  await page.addStyleTag({ path: path.join(dir, 'src/panel.css') });
  await page.addScriptTag({ path: path.join(dir, 'src/content.js') });
  await page.waitForSelector('#kvr-panel');
  const go = async (main, sub) => { await page.click(`.kvr-tab:has-text("${main}")`); if (sub) await page.click(`.kvr-sub:text-is("${sub}")`); };
  const txt = async (sel) => (await page.innerText(sel)).replace(/\s+/g, ' ');

  await go('Analyse', 'Sjekk først');
  await page.click('[data-sec=chk-top] button:text-is("Kjør analyse")');
  await page.waitForFunction(() => /Kontroller ferdig/.test(document.getElementById('kvr-panel').innerText), null, { timeout: 60000 });
  const before = await txt('[data-sec=chk-list]');
  assert.match(before, /sjekk først \(3\)/i);
  assert.strictEqual(await page.$$eval('#g tbody tr.kvr-flag', (n) => n.length), 3);
  // bongen vises som en kvittering, med den manuelle pantelappen markert
  const rc = await txt('[data-sec=chk-list] .kvr-rcpt');
  assert.match(rc, /COOP MEGA KOLBOTN|1001/i);
  assert.match(rc, /Kasse 1 · Kasserer C/);
  assert.match(rc, /PANTELAPP manuell 99 −80,00/i);
  assert.match(rc, /TOTALT −80,00/);
  assert.strictEqual(await page.$$eval('[data-sec=chk-list] .kvr-rcpt .kvr-rc-hit', (n) => n.length), 1);

  // brukeren søker manuelt i CW: listen byttes helt
  await page.evaluate(() => window.__setRows(OTHER));
  await page.waitForFunction(() => document.querySelectorAll('#g tbody tr').length === 3 && !document.querySelector('#g tbody tr.kvr-flag'));
  await go('Analyse', 'Sjekk først');
  const after = await txt('[data-sec=chk-list]');
  assert.match(after, /sjekk først \(3\)/i, 'resultatet står fast');
  assert.match(await txt('[data-sec=chk-top]'), /Resultatet står fast fra analysen .*8 av 8 analyserte bonger ligger ikke i listen nå/);

  // en bong som ikke er i listen kan hentes fram igjen uten å røre analysen
  const btn = page.locator('[data-sec=chk-list] .kvr-acts button:text-is("Hent i CW")');
  assert.strictEqual(await btn.count(), 1, 'Hent i CW når bongen ikke er i listen');
  await btn.click();
  await page.waitForSelector('[data-sec=chk-list] .kvr-acts button:text-is("Vis i listen")', { timeout: 10000 });
  assert.strictEqual(await page.$$eval('#g tbody tr.kvr-flag', (n) => n.length), 3, 'avviksmarkeringene er tilbake');
  assert.match(await txt('[data-sec=chk-list]'), /sjekk først \(3\)/i);

  // notat på en bong som ikke ligger i listen virker
  await page.evaluate(() => window.__setRows(OTHER));
  await page.waitForFunction(() => !document.querySelector('#g tbody tr.kvr-flag'));
  await go('Analyse', 'Sjekk først');
  await page.locator('[data-sec=chk-list] .kvr-acts button:text-is("Sjekket")').first().click();
  assert.match(await txt('[data-sec=chk-list]'), /sjekk først \(2\)/i);

  // filtrene i pluginen skjuler alle radene etter et nytt søk: melding og «Vis alle» som bare nullstiller pluginens filtre
  await go('Filtrer');
  await page.fill('input[placeholder="ord, EAN, beløp, kortnr, referanse …"]', 'finnes-ikke');
  await page.waitForFunction(() => /Filtrene i pluginen skjuler alle 3 kvitteringene i CW-listen/.test(document.getElementById('kvr-panel').innerText));
  assert.strictEqual(await page.$$eval('#g tbody tr', (t) => t.filter((x) => x.style.display !== 'none').length), 0);
  await page.click('#kvr-panel .kvr-notice button:text-is("Vis alle")');
  assert.strictEqual(await page.$$eval('#g tbody tr', (t) => t.filter((x) => x.style.display !== 'none').length), 3);
  assert.ok(!/Filtrene i pluginen skjuler alle/.test(await page.innerText('#kvr-panel')));

  // Tøm cache fjerner også analysen
  await go('Skann');
  await page.click('button:text-is("Tøm cache")');
  await go('Analyse', 'Sjekk først');
  assert.ok(!/sjekk først \(/i.test(await txt('#kvr-panel')), 'analysen er tømt sammen med cachen');

  // listen byttes midt i skanningen: bongene som er borte hoppes over med en gang, uten å vente på tidsavbrudd
  {
    const p2 = await (await browser.newContext({ locale: 'nb-NO' })).newPage();
    p2.on('pageerror', e => { errors.push(e.message); console.error('PAGEERROR', e.message); });
    await p2.addInitScript(() => { window.__kvrScan = { settle: 0, poll: 10 }; window.__delay = 250; });
    await p2.route('https://chainweb.coop.no/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
    await p2.goto('https://chainweb.coop.no/LindbakRetail_1/Journal/Viewer');
    for (const f of ['lib/html2canvas.min.js', 'lib/jszip.min.js', 'src/logic.js', 'src/report.js']) await p2.addScriptTag({ path: path.join(dir, f) });
    await p2.addStyleTag({ path: path.join(dir, 'src/panel.css') });
    await p2.addScriptTag({ path: path.join(dir, 'src/content.js') });
    await p2.waitForSelector('#kvr-panel');
    await p2.evaluate(() => { window.__saw = ''; new MutationObserver(() => { const m = /(\d+ lå ikke lenger i CW-listen og ble hoppet over)/.exec(document.getElementById('kvr-panel').innerText); if (m) window.__saw = m[1]; }).observe(document.getElementById('kvr-panel'), { subtree: true, childList: true, characterData: true }); });
    await p2.click('.kvr-tab:has-text("Analyse")');
    await p2.click('.kvr-sub:text-is("Sjekk først")');
    const t0 = Date.now();
    await p2.click('[data-sec=chk-top] button:text-is("Kjør analyse")');
    await p2.waitForTimeout(700);
    await p2.evaluate(() => window.__setRows(OTHER));
    await p2.waitForFunction(() => /Kontroller ferdig/.test(document.getElementById('kvr-panel').innerText), null, { timeout: 60000 });
    const saw = await p2.evaluate(() => window.__saw);
    assert.match(saw, /^\d+ lå ikke lenger i CW-listen og ble hoppet over$/, 'meldingen om bonger som forsvant fra listen');
    assert.ok(Date.now() - t0 < 12000, 'ingen ventetid på tidsavbrudd: ' + (Date.now() - t0) + ' ms');
    await p2.context().close();
  }

  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(apiCalls, []);
  await browser.close();
  console.log('analyse: ok');
})().catch(e => { console.error(e); process.exit(1); });
