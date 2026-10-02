const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

const T = (a, c) => `<tr><td>${a}</td><td></td><td>${c}</td></tr>`;
const SPAN = (t) => `<tr><td colspan="3">${t}</td></tr>`;
const R = (store, ws, seq, cashier, day, time, total, type, lines) => ({ store, ws, seq, cashier, day, time, total, type: type || 1, lines });
const ROWS = [
  R(1005, 1, 100, 'A', '2026-09-28', '10:00', 100, 1, [T('7000111 VARE X', '100.00'), SPAN('Rabatt: Kr 10.00 (9.1%)'), SPAN('Rabatt årsak: 6'), T('Bank:', '100.00')]),
  R(1005, 1, 101, 'A', '2026-09-28', '10:20', -100, 1, [T('7000111 VARE X', '-100.00'), T('Kontant tilbake:', '100.00')]),
  R(1005, 1, 102, 'B', '2026-09-28', '11:00', -50, 1, [T('9999999 UKJENT VARE', '-50.00'), T('Kontant tilbake:', '50.00')]),
  R(1005, 1, 103, 'A', '2026-09-28', '22:00', null, 2, [T('Sum', '240.00'), T('Differanse', ''), T('Sum', '-40.00')]),
  R(1005, 1, 104, 'C', '2026-09-28', '22:15', 120, 1, [T('7000222 VARE Y', '120.00'), SPAN('Rabatt: Kr 12.00 (9.1%)'), SPAN('Rabatt årsak: 2'), T('Kontant:', '120.00')]),
  R(1005, 1, 109, 'C', '2026-09-28', '22:30', 30, 1, [T('7000333 VARE Z', '30.00'), T('Kontant:', '30.00')]),
  R(1005, 1, 110, 'A', '2026-10-01', '09:00', 80, 1, [T('7000111 VARE X', '80.00'), SPAN('Rabatt: Kr 5.00 (6.0%)'), SPAN('Rabatt årsak: Datovare'), T('Bank:', '80.00')]),
  R(1005, 1, 111, 'A', '2026-10-01', '22:00', null, 2, [T('Sum', '240.00'), T('Differanse', ''), T('Sum', '-30.00')]),
  R(1005, 2, 200, 'D', '2026-10-01', '10:00', 60, 1, [T('7000444 VARE W', '60.00'), T('Bank:', '60.00')]),
  R(1005, 2, 201, 'D', '2026-10-01', '21:30', null, 2, [T('Sum', '100.00'), T('Differanse', ''), T('Sum', '-35.00')]),
  R(1010, 5, 300, 'E', '2026-10-01', '10:00', 40, 1, [T('7000555 VARE V', '40.00'), SPAN('Rabatt: Kr 40.00 (50.0%)'), SPAN('Rabatt årsak: '), T('Kupong (1ESD2P6DRVPCCJY1 - Gruppe - Coop koppnudler, 65 g):', '0.00'), T('Bank:', '40.00')])
];
const rows = ROWS.map(r => ({ transactionId: `x-${r.seq}`, endDateTime: `${r.day} ${r.time}`, storeNumber: r.store, workstationNumber: r.ws, cashierNumber: r.cashier, totalAmount: r.total, receiptType: r.type, memberNumber: null, journalSourceName: 'main' }));
const RECEIPTS = {};
ROWS.forEach(r => { RECEIPTS[`${r.store}-${r.ws}-${r.seq}`] = '<table>' + r.lines.join('') + '</table>'; });

const html = `<!doctype html><html><body>
<input id="fromDatePicker"><input id="toDatePicker"><input id="freetextSearchInput"><input id="receiptNumber">
<input ng-model="vm.selectedFilters.memberNumber"><input ng-model="vm.selectedFilters.externalLoyaltyNumber">
<button ng-click="vm.resetFilters()">Nullstill</button>
<button ng-click="vm.applyFilters()" onclick="window.__applied=(window.__applied||0)+1;(window.__bound||[]).forEach(function(f){f()})">Oppdater</button>
<div class="k-grid-header"><table><colgroup><col><col><col></colgroup><thead><tr><th>DATO</th><th>SUM</th><th>KASSERER</th></tr></thead></table></div>
<table id="g" data-role="grid"><colgroup><col><col><col></colgroup><tbody>
${rows.map(r => `<tr data-id="${r.transactionId}"><td></td><td>${r.endDateTime}</td><td>${r.totalAmount}</td></tr>`).join('')}
</tbody></table>
<div data-w="1"></div><iframe id="rc"></iframe>
<script>
var rows=${JSON.stringify(rows)};
var items=rows.map(function(r,i){var o=Object.assign({uid:'u'+i},r);o.toJSON=function(){var c=Object.assign({},o);delete c.toJSON;return c};return o});
var cur=null;
var grid={tbody:[document.querySelector('tbody')],dataSource:{view:function(){return items}},
 dataItem:function(tr){return items.filter(function(i){return i.transactionId===tr.getAttribute('data-id')})[0]},
 bind:function(n,f){(window.__bound=window.__bound||[]).push(f)},
 select:function(tr){if(!arguments.length)return cur?[cur]:[];cur=tr;},clearSelection:function(){cur=null}};
var ms={dataSource:{data:function(){return [{get:function(k){return {number:1005,text:'Coop Mega Kolbotn'}[k]}},{get:function(k){return {number:1010,text:'Extra Testby'}[k]}}]}},value:function(v){window.__storesSet=v},trigger:function(){}};
function mk(list){return {each:function(fn){list.forEach(function(e,i){fn.call(e,i,e)})},eq:function(i){return mk([list[i]])},data:function(n){var e=list[0];if(!e)return undefined;if(e.getAttribute('data-w'))return n==='kendoMultiSelect'?ms:null;return n==='kendoGrid'?grid:null}}}
window.jQuery=function(a){ if(typeof a==='string') return a.indexOf('#storesWrapper')===0?mk([].slice.call(document.querySelectorAll('[data-w]'))):mk([]); return mk([a]); };
</script></body></html>`;

(async () => {
  const dir = path.join(__dirname, '..');
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ locale: 'nb-NO' })).newPage();
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.error('PAGEERROR', e.message); });
  await page.route('https://chainweb.coop.no/**', async r => {
    const u = r.request().url();
    if (u.endsWith('/Api/GetReceiptDetails')) {
      const b = JSON.parse(r.request().postData());
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify(RECEIPTS[`${b.retailStoreNum}-${b.workstationNum}-${b.sequenceNum}`] || '') });
    }
    return r.fulfill({ contentType: 'text/html', body: html });
  });
  await page.goto('https://chainweb.coop.no/LindbakRetail_1/Journal/Viewer');
  for (const f of ['lib/html2canvas.min.js', 'lib/jszip.min.js', 'src/logic.js', 'src/report.js']) await page.addScriptTag({ path: path.join(dir, f) });
  await page.addStyleTag({ path: path.join(dir, 'src/panel.css') });
  await page.addScriptTag({ path: path.join(dir, 'src/content.js') });
  await page.waitForSelector('#kvr-panel');

  const out = process.env.TOUR || '';
  const shot = async (name) => {
    if (!out) return;
    await page.waitForTimeout(150);
    await (await page.$('#kvr-panel')).screenshot({ path: path.join(out, name + '.png') });
  };
  const go = async (main, sub) => { await page.click(`.kvr-tab:has-text("${main}")`); if (sub) await page.click(`.kvr-sub:text-is("${sub}")`); };
  await page.setViewportSize({ width: 1100, height: 2600 });
  await page.evaluate(() => { const p = document.getElementById('kvr-panel'); p.style.top = '10px'; });
  await shot('00-start');
  for (const t of ['Hent', 'Filtrer', 'Skann']) { await go(t); await shot('1-' + t); }
  await go('Skann');
  await page.click('text=Rask skanning');
  await page.click('text=Skann innhold (synlige)');
  await page.waitForFunction(() => /Ferdig\. Skannet/.test(document.getElementById('kvr-panel').innerText), null, { timeout: 30000 });
  await go('Analyse', 'Sjekk først');
  await shot('2-Sjekk-for');
  await page.click('[data-sec=chk-top] button:text-is("Kjør analyse")');
  await page.waitForFunction(() => /Kontroller ferdig/.test(document.getElementById('kvr-panel').innerText), null, { timeout: 40000 });
  await shot('2-Sjekk-etter');
  for (const s of ['Diagram', 'Rapport', 'Fokus', 'Detaljer']) { await go('Analyse', s); await shot('3-' + s); }
  await go('Mer'); await shot('4-Mer');
  await page.click('[data-sec=auditrep] button:text-is("Lag revisjonsrapport…")');
  if (out) await (await page.$('.kvr-dlg')).screenshot({ path: path.join(out, '4-Rapportdialog.png') });
  await page.click('.kvr-modal button:text-is("Avbryt")');
  await page.click('.kvr-sub:text-is("Innstillinger")');
  await shot('5-Innstillinger');
  await page.click('[data-sec=set-bong] summary');
  await page.click('[data-sec=set-disc] summary');
  await shot('5-Innstillinger-apen');
  await page.click('.kvr-icon[title="Hjelp og tegnforklaring"]');
  if (out) await page.screenshot({ path: path.join(out, '6-Hjelp.png') });
  await page.click('.kvr-modal button:text-is("Lukk")');
  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('tour: ok');
})().catch(e => { console.error(e); process.exit(1); });
