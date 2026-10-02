const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

// Kryssjekker på tvers av bonger: medlemsnr, pris per vare, kjøpeutbytte, hendelsesord og diagnostikk.
const T = (a, c) => `<tr><td>${a}</td><td></td><td>${c}</td></tr>`;
const ONE = (c, n, a) => T(`${c} ${n}`, a);
const KU = (g, k) => `<tr><td>Grunnlag</td><td>Kjøpeutbytte</td><td>MVA bonus</td></tr><tr><td>${g}</td><td>${k}</td><td>0.10</td></tr>`;
const EAN = '7000000000001';
let seq = 0;
const ROWS = [];
const add = (store, ws, cashier, day, time, total, member, lines) => ROWS.push({ id: `${store}-${ws}-${++seq}`, store, ws, cashier, day, time, total, member: member || null, lines });
const hh = (i) => String(8 + i).padStart(2, '0') + ':' + String(10 + i).padStart(2, '0');

for (let i = 0; i < 8; i++) add(1005, 1, i < 4 ? 'A' : 'B', '2026-10-05', hh(i), 12.9, null, [ONE(EAN, 'MELK 1L', '12.90'), T('Bank:', '12.90')]);
for (let i = 0; i < 3; i++) add(1005, 2, 'C', '2026-10-05', '15:' + String(i * 10).padStart(2, '0'), 8, null, [ONE(EAN, 'MELK 1L', '8.00'), T('Bank:', '8.00')]);
add(1005, 1, 'A', '2026-10-06', '10:00', 50, 'M1', [ONE('7000000000050', 'BRØD', '50.00'), KU('47.50', '0.95'), T('Bank:', '50.00')]);
add(1010, 3, 'D', '2026-10-06', '10:15', 60, 'M1', [ONE('7000000000060', 'KAFFE', '60.00'), KU('57.00', '1.14'), T('Bank:', '60.00')]);
for (let i = 0; i < 4; i++) add(1005, 1, i % 2 ? 'A' : 'B', '2026-10-07', '1' + i + ':30', 70, 'M2', [ONE('7000000000070', 'OST', '70.00'), KU('66.50', '1.33'), T('Bank:', '70.00')]);
for (let i = 0; i < 11; i++) add(1005, 1, 'B', '2026-10-08', '0' + (i % 9) + ':45', 200, 'K' + i, [ONE('7000000000080', 'KJØTT', '200.00'), i === 0 ? '' : KU('190.00', '3.80'), T('Bank:', '200.00')]);
add(1005, 1, 'A', '2026-10-09', '09:00', 10, null, [ONE('7000000000090', 'TEST', '10.00'), '<tr><td>Linje annullert av kasserer</td></tr>', T('Bank:', '10.00')]);

const rows = ROWS.map(r => ({ transactionId: r.id, endDateTime: `${r.day} ${r.time}`, storeNumber: r.store, workstationNumber: r.ws, cashierNumber: r.cashier, totalAmount: r.total, receiptType: 1, memberNumber: r.member, journalSourceName: 'main' }));
const BYID = {};
ROWS.forEach(r => { BYID[r.id] = '<table>' + r.lines.join('') + '</table>'; });

const html = `<!doctype html><html><body>
<input id="fromDatePicker"><input id="toDatePicker"><input id="freetextSearchInput"><input id="receiptNumber">
<input ng-model="vm.selectedFilters.memberNumber"><input ng-model="vm.selectedFilters.externalLoyaltyNumber">
<button ng-click="vm.resetFilters()">Nullstill</button>
<button ng-click="vm.applyFilters()" onclick="window.__applied=(window.__applied||0)+1;(window.__bound||[]).forEach(function(f){f()})">Oppdater</button>
<div class="k-grid-header"><table><colgroup><col><col><col></colgroup><thead><tr><th>DATO</th><th>SUM</th><th>KASSERER</th></tr></thead></table></div>
<table id="g" data-role="grid"><colgroup><col><col><col></colgroup><tbody>
${rows.map((r, i) => `<tr data-uid="u${i}" data-id="${r.transactionId}"><td></td><td>${r.endDateTime}</td><td>${r.totalAmount}</td></tr>`).join('')}
</tbody></table>
<div data-w="1"></div><iframe id="rc"></iframe>
<script>
var rows=${JSON.stringify(rows)};
var receipts=${JSON.stringify(BYID)};
var items=rows.map(function(r,i){var o=Object.assign({uid:'u'+i},r);o.toJSON=function(){var c=Object.assign({},o);delete c.toJSON;return c};return o});
var cur=null;
var grid={tbody:[document.querySelector('tbody')],dataSource:{view:function(){return items}},
 dataItem:function(tr){return items.filter(function(i){return i.transactionId===tr.getAttribute('data-id')})[0]},
 bind:function(n,f){(window.__bound=window.__bound||[]).push(f)},
 select:function(tr){if(!arguments.length)return cur?[cur]:[];cur=tr;var id=tr.getAttribute('data-id');setTimeout(function(){document.getElementById('rc').contentDocument.body.innerHTML=receipts[id];},5);},clearSelection:function(){cur=null}};
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
  const apiCalls = [];
  await page.addInitScript(() => { window.__kvrScan = { settle: 0, poll: 10 }; });
  await page.route('https://chainweb.coop.no/**', async r => {
    const u = r.request().url();
    if (u.indexOf('/Api/') !== -1) { apiCalls.push(u); return r.fulfill({ status: 404, body: '' }); }
    return r.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
  });
  await page.goto('https://chainweb.coop.no/LindbakRetail_1/Journal/Viewer');
  for (const f of ['lib/html2canvas.min.js', 'lib/jszip.min.js', 'src/logic.js', 'src/report.js']) await page.addScriptTag({ path: path.join(dir, f) });
  await page.addStyleTag({ path: path.join(dir, 'src/panel.css') });
  await page.addScriptTag({ path: path.join(dir, 'src/content.js') });
  await page.waitForSelector('#kvr-panel');

  const go = async (main, sub) => { await page.click(`.kvr-tab:has-text("${main}")`); if (sub) await page.click(`.kvr-sub:text-is("${sub}")`); };
  const txt = async (sel) => (await page.innerText(sel)).replace(/\s+/g, ' ');
  const runAnalysis = async () => {
    await page.click('[data-sec=chk-top] button:text-is("Kjør analyse")');
    await page.waitForFunction(() => /Kontroller ferdig/.test(document.getElementById('kvr-panel').innerText), null, { timeout: 60000 });
  };

  await go('Analyse', 'Sjekk først');
  await runAnalysis();
  await go('Analyse', 'Detaljer');
  await page.click('button:text-is("Åpne alle")');
  const fnd = await txt('[data-sec=findings]');
  // medlemsnummer
  assert.match(fnd, /Medlem: Medlem i flere butikker samtidig Medlemsnr M1: butikk 1005 2026-10-06 10:00 og butikk 1010 10:15 \(innen 30 min\)/);
  assert.match(fnd, /Medlem: Medlemsnr flere ganger samme dag Medlemsnr M2: 4 bonger 2026-10-07/);
  assert.ok(!/Medlemsnr brukt svært mye/.test(fnd), 'totalgrensen på 15 nås ikke');
  const mem = await txt('[data-sec=member]');
  assert.match(mem, /Medlemsnr Bonger Kasserer Funn M2 4 \(1 d, 1 b\) B \(50 %\) dag M1 2 \(1 d, 2 b\) A \(50 %\) butikker K0 1 \(1 d, 1 b\)/);
  // pris per vare
  assert.match(fnd, /Pris: Avvikende pris på vare Kasse 2 15:00 kasserer C: MELK 1L kr 8\.00 mot vanlig 12\.90 \(−38 %\)/);
  assert.match(fnd, /Pris: Mange avvikende priser Kasserer C: 3 varelinjer/);
  // kjøpeutbytte
  assert.match(fnd, /Kjøpeutbytte: Medlem uten kjøpeutbytte Kasse 1 00:45 kasserer B: medlemsnr K0 men ingen Kjøpeutbytte-tabell \(16 av 17 medlemsbonger har den\)/);
  // hendelsesord
  assert.match(fnd, /Hendelse: Hendelsesord på bong Kasse 1 09:00 kasserer A: «Linje annullert av kasserer»/);
  const misc = await txt('[data-sec=misc]');
  assert.match(misc, /Pris per vare 29 av 29 salg har enhetspris/);
  assert.match(misc, /Kjøpeutbytte 17 medlemssalg, 17 skannet med ny skanning, 16 med Kjøpeutbytte-tabell\. Tabellen finnes på de fleste medlemsbonger/);
  assert.match(misc, /1 av 29 skannede bonger har ord som annullert/);

  // flaggene gir poeng og forklaring
  await go('Analyse', 'Sjekk først');
  const lt = await txt('[data-sec=chk-list]');
  assert.match(lt, /Avvikende pris på vare/);
  assert.match(lt, /Medlem i flere butikker samtidig/);

  // diagnostikk
  await go('Analyse', 'Detaljer');
  await page.click('[data-sec=misc] button:text-is("Diagnostikk: ukjente linjer…")');
  const dlg = await txt('.kvr-dlg');
  assert.match(dlg, /29 av 29 skannede bonger har ny skanningsdata/);
  assert.match(dlg, /annull 1 Linje annullert av kasserer 1005-1-29/);
  assert.match(dlg, /Linje annullert av kasserer 1 1005-1-29/);
  await page.click('.kvr-dlg button:text-is("Lukk")');

  // ansattliste: eget nummer
  await go('Mer', 'Innstillinger');
  await page.click('[data-sec=set-member] summary');
  await page.check('[data-sec=set-member] input[aria-label="Ansattes medlemsnr: på"]');
  const emp = page.locator('[data-sec=set-member] input[aria-label="Ansattes medlemsnr"]');
  await emp.fill('A=M1');
  await emp.press('Tab');
  await go('Analyse', 'Sjekk først');
  await runAnalysis();
  await go('Analyse', 'Detaljer');
  const fnd2 = await txt('[data-sec=findings]');
  assert.match(fnd2, /Medlem: Kasserer bruker eget medlemsnr Kasserer A har tastet sitt eget medlemsnr M1 på 1 bonger/);
  assert.match(fnd2, /Medlem: Ansatt-medlemsnr brukt Ansattnummer M1 brukt på 1 bonger \(kasserere D\)/);
  // klikk på medlemsnr filtrerer listen
  await page.click('[data-sec=member] button:text-is("M2")');
  assert.strictEqual(await page.$$eval('tbody tr', trs => trs.filter(t => t.style.display !== 'none').length), 4);

  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(apiCalls, [], 'pluginen skal aldri kalle CWs API');
  await browser.close();
  console.log('medlem: ok');
})().catch(e => { console.error(e); process.exit(1); });
