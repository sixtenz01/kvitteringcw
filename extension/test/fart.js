const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

// Fartsregulatoren under skanning: aldri raskere enn minsteintervallet, pause når CW svarer tregt flere ganger på rad,
// stopp når CW ikke svarer, og rask skanning som bare tar bonger CWs filtre har merket.
const ROWS = [];
for (let i = 1; i <= 24; i++) ROWS.push({ transactionId: `1005-1-${i}`, endDateTime: `2026-10-20 ${String(8 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 10).padStart(2, '0')}`, storeNumber: 1005, workstationNumber: 1, cashierNumber: 'A', totalAmount: i === 5 ? -40 : 20 + i, receiptType: 1, saleChannel: 2, memberNumber: null, journalSourceName: 'main' });
const receipts = {};
ROWS.forEach((r) => { receipts[r.transactionId] = `<table><tr><td>7038010000010 VARE</td><td></td><td>${r.totalAmount.toFixed(2)}</td></tr></table>`; });

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<input id="fromDatePicker"><input id="toDatePicker"><input id="freetextSearchInput"><input id="receiptNumber">
<button ng-click="vm.applyFilters()" id="apply">Oppdater</button>
<div class="k-grid-header"><table><thead><tr><th>DATO</th><th>SUM</th></tr></thead></table></div>
<div id="g" data-role="grid"><table><tbody></tbody></table></div>
<iframe id="rc"></iframe>
<script>
var ALL=${JSON.stringify(ROWS)}, receipts=${JSON.stringify(receipts)};
window.__selects=[];window.__delay={};
var tbody=document.querySelector('#g tbody'),handlers=[],data=[],uid=0,cur=null;
var grid={tbody:[tbody],dataSource:{data:function(){return data},view:function(){return data}},
  bind:function(n,f){if(n==='dataBound')handlers.push(f)},
  dataItem:function(tr){var u=tr.getAttribute('data-uid');return data.filter(function(d){return d.uid===u})[0]},
  select:function(tr){if(!arguments.length)return cur?[cur]:[];cur=tr;var d=grid.dataItem(tr),id=d.transactionId,ms=window.__delay[id];window.__selects.push({id:id,at:performance.now()});
    if(ms===-1)return;setTimeout(function(){document.getElementById('rc').contentDocument.body.innerHTML=receipts[id]},ms||15)},
  clearSelection:function(){cur=null}};
function render(list){data=list.map(function(r){return Object.assign({uid:'u'+(++uid)},r)});
  tbody.innerHTML=data.map(function(d){return '<tr data-uid="'+d.uid+'"><td data-field="endDateTime">'+d.endDateTime+'</td><td>'+d.totalAmount+'</td></tr>'}).join('');
  handlers.forEach(function(f){f()})}
document.getElementById('apply').addEventListener('click',function(){setTimeout(function(){render(ALL)},10)});
function mk(list){return{each:function(fn){list.forEach(function(e,i){fn.call(e,i,e)})},eq:function(i){return mk([list[i]])},data:function(n){var e=list[0];return e&&e.__w?e.__w[n]:undefined}}}
document.getElementById('g').__w={kendoGrid:grid};
window.jQuery=function(a){return typeof a==='string'?mk([]):mk([a])};
render(ALL);
</script></body></html>`;

(async () => {
  const dir = path.join(__dirname, '..');
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ locale: 'nb-NO' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.error('PAGEERROR', e.message); });
  await page.addInitScript(() => { window.__kvrScan = { settle: 0, poll: 10, min: 150, pause: 400, timeout: 1500 }; });
  await page.route('https://chainweb.coop.no/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  const load = async (prep) => {
    await page.goto('https://chainweb.coop.no/LindbakRetail_1/Journal/Viewer');
    if (prep) await page.evaluate(prep);
    for (const f of ['lib/html2canvas.min.js', 'lib/jszip.min.js', 'src/logic.js', 'src/report.js']) await page.addScriptTag({ path: path.join(dir, f) });
    await page.addStyleTag({ path: path.join(dir, 'src/panel.css') });
    await page.addScriptTag({ path: path.join(dir, 'src/content.js') });
    await page.waitForFunction(() => document.querySelectorAll('#g tbody td.kvr-cb-cell').length > 0);
  };
  const scan = async () => {
    await page.click('.kvr-tab:has-text("Skann")');
    await page.evaluate(() => { window.__selects = []; window.__says = []; const s = document.querySelector('#kvr-panel .kvr-optext'); if (s) new MutationObserver(() => window.__says.push(s.textContent)).observe(s, { childList: true, characterData: true, subtree: true }); });
    await page.click('button:text-is("Skann innhold (synlige)")');
    await page.waitForFunction(() => !document.querySelector('[data-sec=scan] button').disabled && window.__selects.length > 0, null, { timeout: 60000 });
    await page.waitForTimeout(200);
  };
  const statusText = () => page.evaluate(() => (window.__says || []).join(' | '));

  // 1) normal fart: aldri raskere enn minsteintervallet (150 ms i testen, 600 ms i bruk)
  await load();
  await page.evaluate(() => { ['1005-1-1', '1005-1-2', '1005-1-3', '1005-1-4', '1005-1-5', '1005-1-6'].forEach(() => 0); });
  // tre trege svar på rad (over ett sekund) gir pause; deretter svarer CW ikke på seks bonger, og skanningen stopper
  await page.evaluate(() => {
    ['1005-1-8', '1005-1-9', '1005-1-10'].forEach((id) => { window.__delay[id] = 1100; });
    for (let i = 13; i <= 18; i++) window.__delay['1005-1-' + i] = -1;
  });
  await scan();
  const sel = await page.evaluate(() => window.__selects);
  const gaps = [];
  for (let i = 1; i < 7; i++) gaps.push(sel[i].at - sel[i - 1].at);
  assert.ok(gaps.every((g) => g >= 140), 'minst 150 ms mellom bongene: ' + gaps.map(Math.round).join(','));
  const st = await statusText();
  assert.match(st, /CW svarer tregt: pause i 0 s før neste bong/, st.slice(0, 400));
  assert.match(st, /farten er senket/);
  const iSlow = sel.findIndex((x) => x.id === '1005-1-10'), iNext = sel.findIndex((x) => x.id === '1005-1-11');
  assert.ok(sel[iNext].at - sel[iSlow].at >= 1100 + 380, 'pausen ble holdt: ' + sel.map((x, i) => x.id.split('-')[2] + '@' + Math.round(i ? x.at - sel[i - 1].at : 0)).join(' '));
  assert.match(st, /CW svarte ikke på 6 bonger på rad, så skanningen er stoppet\. Prøv igjen senere\./);
  assert.ok(!sel.some((x) => x.id === '1005-1-19'), 'ingen bonger etter stoppen');

  // 2) rask skanning: bare bonger CWs filtre har merket, og returer
  await load(() => new Promise((res) => {
    const rq = indexedDB.open('kvr-store', 1);
    rq.onupgradeneeded = () => { rq.result.createObjectStore('kv'); rq.result.createObjectStore('scan'); };
    rq.onsuccess = () => {
      const tx = rq.result.transaction('kv', 'readwrite'), kv = tx.objectStore('kv');
      kv.put({ tags: { '1005-1-2': ['Slettet vare'], '1005-1-20': ['Betaling: Kontant tilbake'] }, sys: [], copies: {}, runs: [] }, 'kvr.cwx.v1');
      kv.put(true, 'kvr.quick.v1');
      kv.clear; tx.oncomplete = () => { const t2 = rq.result.transaction('scan', 'readwrite'); t2.objectStore('scan').clear(); t2.oncomplete = () => { rq.result.close(); res(); }; };
    };
  }));
  await page.evaluate(() => { window.__delay = {}; });
  await page.click('.kvr-tab:has-text("Skann")');
  assert.ok(await page.isChecked('[data-sec=scan] input[type=checkbox]'), 'valget er husket');
  assert.match(await page.innerText('#kvr-panel'), /rask skanning: 3 gjenstår/);
  await scan();
  assert.deepStrictEqual((await page.evaluate(() => window.__selects.map((x) => x.id))).sort(), ['1005-1-2', '1005-1-20', '1005-1-5'], 'merkede bonger og returen');

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('fart: ok');
})().catch((e) => { console.error(e); process.exit(1); });
