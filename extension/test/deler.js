const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

// «Hent og skann i deler»: dag for dag, dager som treffer grensen deles på beløp, hver del skannes, radene samles.
// Den falske CW-siden kutter som CW (de nyeste først), men ved 50 bonger i stedet for 1000.
const CAP = 50;
const ROWS = [];
let n = 0;
const add = (day, tot, o) => {
  n++;
  const t = `${String(8 + (n % 12)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  ROWS.push(Object.assign({ transactionId: `1005-${1 + (n % 3)}-${n}`, endDateTime: `${day} ${t}`, storeNumber: 1005, workstationNumber: 1 + (n % 3), cashierNumber: 'K' + (n % 4),
    totalAmount: tot, receiptType: 1, saleChannel: 2, memberNumber: n % 5 === 0 ? 'M' + n : null, journalSourceName: 'main' }, o || {}));
};
for (let i = 0; i < 30; i++) add('2026-09-20', 20 + i);
// 120 bonger: 10 negative, 70 mellom 0 og 100 (35 under 50), 30 mellom 100 og 300, 10 over 300. Én på nøyaktig 100,00.
for (let i = 0; i < 10; i++) add('2026-09-21', -10 - i);
for (let i = 0; i < 35; i++) add('2026-09-21', 1 + i);
for (let i = 0; i < 35; i++) add('2026-09-21', 50 + i);
add('2026-09-21', 100);
for (let i = 0; i < 29; i++) add('2026-09-21', 120 + i * 5);
for (let i = 0; i < 10; i++) add('2026-09-21', 400 + i);
for (let i = 0; i < 20; i++) add('2026-09-22', 30 + i);
const TR = (a, c) => `<tr><td>${a}</td><td></td><td>${c}</td></tr>`;
const receipts = {};
ROWS.forEach((r) => { receipts[r.transactionId] = `<table>${TR('7038010000010 VARE', r.totalAmount.toFixed(2))}${TR('Bank:', r.totalAmount.toFixed(2))}</table>`; });

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<input id="fromDatePicker"><input id="toDatePicker"><input id="freetextSearchInput"><input id="receiptNumber">
<input ng-model="vm.selectedFilters.memberNumber"><input ng-model="vm.selectedFilters.externalLoyaltyNumber">
<input type="number" ng-model="vm.selectedFilters.sumMin"><input type="number" ng-model="vm.selectedFilters.sumMax">
<button ng-click="vm.resetFilters()">Nullstill</button><button ng-click="vm.applyFilters()" id="apply">Oppdater</button>
<div class="k-grid-header"><table><thead><tr><th>DATO</th><th>SUM</th></tr></thead></table></div>
<div id="g" data-role="grid"><table><tbody></tbody></table></div>
<iframe id="rc"></iframe>
<script>
var ALL=${JSON.stringify(ROWS)}, receipts=${JSON.stringify(receipts)}, CAP=${CAP};
window.__searches=[];
var tbody=document.querySelector('#g tbody'), handlers=[], data=[], uid=0, cur=null;
var grid={tbody:[tbody],dataSource:{data:function(){return data},view:function(){return data}},
  bind:function(n,f){if(n==='dataBound')handlers.push(f)},
  dataItem:function(tr){var u=tr.getAttribute('data-uid');return data.filter(function(d){return d.uid===u})[0]},
  select:function(tr){if(!arguments.length)return cur?[cur]:[];cur=tr;var d=grid.dataItem(tr);setTimeout(function(){document.getElementById('rc').contentDocument.body.innerHTML=receipts[d.transactionId]||''},5)},
  clearSelection:function(){cur=null}};
function render(list){data=list.map(function(r){return Object.assign({uid:'u'+(++uid)},r)});
  tbody.innerHTML=data.map(function(d){return '<tr data-uid="'+d.uid+'"><td data-field="endDateTime">'+d.endDateTime+'</td><td>'+d.totalAmount+'</td></tr>'}).join('');
  handlers.forEach(function(f){f()})}
function iso(v){var m=/^(\\d{2})\\.(\\d{2})\\.(\\d{4})$/.exec(v||'');return m?m[3]+'-'+m[2]+'-'+m[1]:''}
function val(sel){return document.querySelector(sel).value}
function search(){
  var f=iso(val('#fromDatePicker')),t=iso(val('#toDatePicker')),mn=val('[ng-model="vm.selectedFilters.sumMin"]'),mx=val('[ng-model="vm.selectedFilters.sumMax"]');
  window.__searches.push({f:f,t:t,mn:mn,mx:mx,free:val('#freetextSearchInput')});
  if(window.__ignoreSum){mn='';mx=''}
  var list=ALL.filter(function(r){var d=r.endDateTime.slice(0,10);return (!f||d>=f)&&(!t||d<=t)&&(mn===''||r.totalAmount>=Number(mn))&&(mx===''||r.totalAmount<=Number(mx))});
  list.sort(function(a,b){return a.endDateTime<b.endDateTime?1:-1});
  if(window.__noAnswerDay&&f===window.__noAnswerDay)return;
  setTimeout(function(){render(list.slice(0,CAP))},20)}
document.getElementById('apply').addEventListener('click',search);
function mk(list){return{each:function(fn){list.forEach(function(e,i){fn.call(e,i,e)})},eq:function(i){return mk([list[i]])},data:function(n){var e=list[0];return e&&e.__w?e.__w[n]:undefined}}}
document.getElementById('g').__w={kendoGrid:grid};
window.jQuery=function(a){return typeof a==='string'?mk([]):mk([a])};
document.querySelector('#fromDatePicker').value='22.09.2026';document.querySelector('#toDatePicker').value='22.09.2026';
search();
</script></body></html>`;

(async () => {
  const dir = path.join(__dirname, '..');
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ locale: 'nb-NO' })).newPage();
  const errors = [], apiCalls = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.error('PAGEERROR', e.message); });
  await page.addInitScript((cap) => { window.__kvrScan = { settle: 0, poll: 10 }; window.__kvrParts = { pause: 0, timeout: 1500, cut: cap }; window.__kvrCwx = { pause: 0, timeout: 1500 }; }, CAP);
  await page.route('https://chainweb.coop.no/**', (r) => {
    if (r.request().url().indexOf('/Api/') !== -1) { apiCalls.push(r.request().url()); return r.fulfill({ status: 404, body: '' }); }
    return r.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
  });
  await page.goto('https://chainweb.coop.no/LindbakRetail_1/Journal/Viewer');
  for (const f of ['lib/html2canvas.min.js', 'lib/jszip.min.js', 'src/logic.js', 'src/report.js']) await page.addScriptTag({ path: path.join(dir, f) });
  await page.addStyleTag({ path: path.join(dir, 'src/panel.css') });
  await page.addScriptTag({ path: path.join(dir, 'src/content.js') });
  await page.waitForSelector('#kvr-panel');
  await page.waitForFunction(() => document.querySelectorAll('#g tbody td.kvr-cb-cell').length > 0);
  const go = async (main, sub) => { await page.click(`.kvr-tab:has-text("${main}")`); if (sub) await page.click(`.kvr-sub:text-is("${sub}")`); };
  const txt = async (sel) => (await page.innerText(sel)).replace(/\s+/g, ' ');
  const status = () => page.innerText('[data-sec=parts] [role=status]');
  const run = async () => {
    await page.evaluate(() => { document.querySelector('[data-sec=parts] [role=status]').textContent = ''; window.__searches = []; });
    await page.click('button:text-is("Hent og skann i deler")');
    await page.waitForFunction(() => /^(Ferdig|Stoppet)\./.test(document.querySelector('[data-sec=parts] [role=status]').innerText), null, { timeout: 120000 });
  };
  const sums = () => page.evaluate(() => ({ from: document.querySelector('#fromDatePicker').value, to: document.querySelector('#toDatePicker').value, min: document.querySelector('[ng-model="vm.selectedFilters.sumMin"]').value, max: document.querySelector('[ng-model="vm.selectedFilters.sumMax"]').value }));
  const idb = (key) => page.evaluate((k) => new Promise((res) => { const rq = indexedDB.open('kvr-store'); rq.onsuccess = () => { const g = rq.result.transaction('kv').objectStore('kv').get(k); g.onsuccess = () => res(g.result); }; }), key);

  await go('Hent');
  // uten dato: sier fra
  await page.click('button:text-is("Hent og skann i deler")');
  assert.match(await status(), /Velg Dato fra og Dato til/);
  await page.evaluate(() => {
    const d = document.querySelectorAll('[data-sec=cw] input[type=date]');
    d[0].value = '2026-09-20'; d[0].dispatchEvent(new Event('change', { bubbles: true }));
    d[1].value = '2026-09-22'; d[1].dispatchEvent(new Event('change', { bubbles: true }));
  });
  const before = await sums();
  await run();
  const s1 = await page.evaluate(() => window.__searches);
  const parts = s1.slice(0, -1);
  // dag 20 og 22 i ett søk; dag 21 kuttes, deles på beløp, og 0–100 deles en gang til
  assert.deepStrictEqual(parts.map((x) => [x.f, x.mn, x.mx]), [
    ['2026-09-20', '', ''],
    ['2026-09-21', '', ''], ['2026-09-21', '', '0'], ['2026-09-21', '-0.01', '100'], ['2026-09-21', '-0.01', '50'], ['2026-09-21', '49.99', '100'], ['2026-09-21', '99.99', '300'], ['2026-09-21', '299.99', ''],
    ['2026-09-22', '', '']
  ]);
  assert.ok(parts.every((x) => x.free === ''), 'aldri fritekst');
  assert.deepStrictEqual(await sums(), before, 'søket ditt er satt tilbake');
  assert.match(await status(), /^Ferdig\. 9 søk, 170 bonger hentet, 170 skannet\. Samlet grunnlag: 170 bonger\./);
  const info = await txt('[data-sec=parts]');
  assert.match(info, /Samlet grunnlag: 170 bonger fra 3 dager \(2026-09-20 – 2026-09-22\), 170 skannet\./);
  assert.match(info, /2026-09-20: 30 bonger · 2026-09-21: 120 bonger · 2026-09-22: 20 bonger/);
  const day21 = await idb('kvr.arch.v1:2026-09-21');
  assert.strictEqual(day21.rows.length, 120);
  assert.ok(day21.rows.every((r) => !('memberNumber' in r)), 'medlemsnummer lagres ikke');
  assert.ok(day21.rows.some((r) => r.totalAmount === 100), 'bongen på grensen er med');

  // analysen bruker samlet grunnlag sammen med listen
  await go('Analyse', 'Sjekk først');
  await page.click('[data-sec=chk-top] button:text-is("Kjør analyse")');
  await page.waitForFunction(() => /Kontroller ferdig/.test(document.getElementById('kvr-panel').innerText), null, { timeout: 60000 });
  assert.match(await page.evaluate(() => document.getElementById('kvr-panel').textContent), /→ 170 av 170 kvitteringer \(listen og samlet grunnlag\)/);

  // ny kjøring: dagene er hentet før og hoppes over
  await go('Hent');
  await run();
  assert.match(await status(), /^Ferdig\. 0 søk, 0 bonger hentet, 3 dager hentet før\./);
  assert.strictEqual((await page.evaluate(() => window.__searches)).length, 1, 'bare søket ditt tilbake');

  // CW bruker ikke beløpsfeltene: dagen kuttes, og det står tydelig
  await page.click('[data-sec=parts] button:text-is("Tøm samlet grunnlag")');
  await page.click('.kvr-modal button:text-is("Tøm")');
  await page.evaluate(() => { window.__ignoreSum = true; });
  await run();
  const s3 = (await page.evaluate(() => window.__searches)).slice(0, -1).map((x) => x.f + ' ' + x.mn + '/' + x.mx);
  assert.deepStrictEqual(s3, ['2026-09-20 /', '2026-09-21 /', '2026-09-21 /0', '2026-09-22 /']);
  assert.match(await txt('[data-sec=parts]'), /CW brukte ikke beløpsfeltene for 2026-09-21 \(samme bonger som uten beløp\)\. Dagen er kuttet ved 1000 bonger\./);
  assert.match(await txt('[data-sec=parts]'), /Kuttet ved 1000: 2026-09-21/);

  // CW svarer ikke: kjøringen stopper, dagen fortsetter neste gang, og søket ditt settes tilbake
  await page.click('[data-sec=parts] button:text-is("Tøm samlet grunnlag")');
  await page.click('.kvr-modal button:text-is("Tøm")');
  await page.evaluate(() => { window.__ignoreSum = false; window.__noAnswerDay = '2026-09-21'; });
  await run();
  assert.match(await txt('[data-sec=parts]'), /CW svarte ikke på søket for 2026-09-21 \(alle beløp\) innen 2 s\. Kjøringen ble stoppet; start igjen senere, så fortsetter den der den slapp\./);
  const s4 = (await page.evaluate(() => window.__searches)).map((x) => x.f);
  assert.deepStrictEqual(s4, ['2026-09-20', '2026-09-21', before.from.split('.').reverse().join('-')], 'ingen søk etter stoppen, bortsett fra søket tilbake');
  assert.deepStrictEqual(await sums(), before);
  await page.evaluate(() => { window.__noAnswerDay = ''; });
  await run();
  assert.deepStrictEqual((await page.evaluate(() => window.__searches)).slice(0, -1).map((x) => x.f).filter((v, i, a) => a.indexOf(v) === i), ['2026-09-21', '2026-09-22'], 'fortsetter der den slapp');

  assert.deepStrictEqual(apiCalls, []);
  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('deler: ok');
})().catch((e) => { console.error(e); process.exit(1); });
