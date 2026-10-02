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
  for (const f of ['lib/html2canvas.min.js', 'lib/jszip.min.js', 'src/logic.js']) await page.addScriptTag({ path: path.join(dir, f) });
  await page.addStyleTag({ path: path.join(dir, 'src/panel.css') });
  await page.addScriptTag({ path: path.join(dir, 'src/content.js') });
  await page.waitForSelector('#kvr-panel');

  const go = async (main, sub) => { await page.click(`.kvr-tab:has-text("${main}")`); if (sub) await page.click(`.kvr-sub:text-is("${sub}")`); };
  const info = () => page.innerText('[data-sec=scope] .kvr-hint >> nth=-1').catch(() => '');
  const scopeTxt = async () => (await page.innerText('[data-sec=scope]')).replace(/\s+/g, ' ');
  const listTxt = async () => (await page.innerText('[data-sec=chk-list]')).replace(/\s+/g, ' ');
  const runAnalysis = async (needle) => {
    await page.click('[data-sec=chk-top] button:text-is("Kjør analyse")');
    await page.waitForFunction(n => new RegExp(n).test(document.getElementById('kvr-panel').innerText), needle || 'Kontroller ferdig', { timeout: 40000 });
  };

  await go('Skann');
  await page.click('text=Rask skanning');
  await go('Analyse', 'Sjekk først');
  await page.click('[data-sec=scope] summary');

  // omfang: hele listen, periode, butikk, kasserer og kombinasjoner
  assert.match(await scopeTxt(), /Omfang: hele listen → 11 av 11 kvitteringer/);
  await page.fill('[data-sec=scope] .kvr-f:has-text("Periode fra") input', '2026-10-01');
  await page.fill('[data-sec=scope] .kvr-f:has-text("Periode til") input', '2026-10-01');
  assert.match(await scopeTxt(), /Omfang: 2026-10-01 → 2026-10-01 → 5 av 11/);
  await page.click('[data-sec=scope] .kvr-chk:has-text("1010") input');
  assert.match(await scopeTxt(), /1010 – Extra Testby → 1 av 11/);
  await page.click('[data-sec=scope] .kvr-chk:has-text("1010") input');
  await page.click('[data-sec=scope] .kvr-chk:has-text("1005") input');
  assert.match(await scopeTxt(), /1005 – Coop Mega Kolbotn → 4 av 11/);
  await page.click('[data-sec=scope] .kvr-pills .kvr-pill:text-is("A")');
  assert.match(await scopeTxt(), /kasserer A → 2 av 11/);
  await page.click('[data-sec=scope] button:text-is("Nullstill omfang")');
  assert.match(await scopeTxt(), /Omfang: hele listen → 11 av 11/);

  // hele analysen: alle fem nye tester
  await page.click('[data-sec=scope] button:text-is("Hele listen")');
  await go('Mer', 'Innstillinger');
  await page.click('[data-sec=set-diff] summary');
  await page.fill('[data-sec=set-diff] input[aria-label="Eller minus totalt over"]', '60');
  await page.press('[data-sec=set-diff] input[aria-label="Eller minus totalt over"]', 'Tab');
  await go('Analyse', 'Sjekk først');
  await runAnalysis();
  const lt = await listTxt();
  for (const re of [/Salg og retur av samme beløp/, /Kortkjøp refundert kontant/, /Retur uten salg/, /Salg etter kassaoppgjør/, /Hull i bongnummer/, /Gjentatte kassadifferanser/]) assert.match(lt, re);
  await go('Analyse', 'Detaljer');
  await page.click('button:text-is("Åpne alle")');
  const fnd = (await page.innerText('[data-sec=findings]')).replace(/\s+/g, ' ');
  assert.match(fnd, /Kasse 1: salg 10:00 og retur 10:20, begge 100 kr \(kasserer A\)/);
  assert.match(fnd, /UKJENT VARE \(50 kr\) uten tilsvarende salg/);
  assert.match(fnd, /Kasse 1 2026-09-28: 2 salg \(150 kr\) etter kassaoppgjør kl 22:00 \(oppgjør av kasserer A; salg av C\)/);
  assert.match(fnd, /Kasse 1: mangler 105–108 \(4\)/);
  assert.match(fnd, /Kasserer A: 2 av 2 oppgjør med minus, totalt -70 kr/);
  const diff = (await page.innerText('[data-sec=diff]')).replace(/\s+/g, ' ');
  assert.match(diff, /Kasserer A 2 2 0 −70,00/);
  assert.match(await page.innerText('[data-sec=numbers]'), /Benford \(første siffer i totalbeløp\): \d+ bonger/);
  assert.ok(await page.$('[data-sec=ch-benford]') === null, 'Benford-diagrammet ligger under Diagram');
  // rabatt og kupong: rabatt uten årsak er et funn, rabatt med årsak og kupong er bare tall
  assert.match(fnd, /Rabatt: Rabatt uten årsak Kasse 5 10:00 kasserer E: VARE V −40 kr \(50 %\) uten rabattårsak/);
  assert.ok(!/Datovare|Best før|VARE X −/.test(fnd), 'rabatt med årsak flagges ikke');
  const dsc = (await page.innerText('[data-sec=disc]')).replace(/\s+/g, ' ');
  assert.match(dsc, /4 bonger har rabattlinje \(67,00 kr\), 1 av dem uten årsak \(40,00 kr\)\. 1 bonger har kupong\/kampanje \(1 kuponger\)/);
  assert.match(dsc, /Kasserer E 1 1 40,00 1 40,00 100 % 0 1 1/);
  assert.match(dsc, /Rabatt per årsak Årsak Linjer Bonger Rabatt kr Snitt % Overvåket Datovare 1 1 5,00 6 Feil pris 1 1 12,00 9,1 ja Best før 1 1 10,00 9,1 Uten årsak 1 1 40,00 50/);
  assert.match(fnd, /Rabatt: Rabatt med overvåket årsak Kasse 1 22:15 kasserer C: VARE Y −12 kr \(9.1 %\) – årsak Feil pris/);
  assert.match(dsc, /Kasserer C 2 1 12,00 0 0,00 0 % 1 0 0/);
  assert.match(dsc, /Overvåkede årsaker: Feil pris, Reserveløsning kupong, Annen rabattårsak\. Bongen flagges ved rabatt på minst 0 % og 0 kr; kassereren markeres ved minst 3 bonger/);
  assert.match(dsc, /Kasserer × årsak \(antall rabattlinjer\) Kasserer Datovare Feil pris Best før Uten årsak Kasserer A 1 · 1 · Kasserer C · 1 · · Kasserer E · · · 1/);
  assert.match(dsc, /1ESD2P6DRVPCCJY1 Gruppe - Coop koppnudler, 65 g 1 0,00/);
  if (process.env.SHOT) { await page.evaluate(() => { document.querySelector('[data-sec=findings]').scrollIntoView({ block: 'start' }); }); await page.waitForTimeout(200); await (await page.$('#kvr-panel')).screenshot({ path: process.env.SHOT.replace('.png', '-funn.png') }); await page.evaluate(() => { document.querySelector('[data-sec=diff]').scrollIntoView({ block: 'start' }); }); await page.waitForTimeout(200); await (await page.$('#kvr-panel')).screenshot({ path: process.env.SHOT.replace('.png', '-diff.png') }); }

  // kasserer-omfang: bare funn som gjelder kassereren
  await go('Analyse', 'Sjekk først');
  await page.click('[data-sec=scope] .kvr-pills .kvr-pill:text-is("C")');
  assert.match(await scopeTxt(), /kasserer C → 2 av 11/);
  await runAnalysis();
  const cl = await listTxt();
  assert.match(cl, /Salg etter kassaoppgjør/); assert.match(cl, /Hull i bongnummer/);
  assert.ok(!/Retur uten salg|Kortkjøp/.test(cl), 'funn for andre kasserere vises ikke');
  await page.click('[data-sec=scope] button:text-is("Nullstill omfang")');

  // periode mot periode
  await page.click('[data-sec=scope] label:has-text("Sammenlign med en annen periode") input');
  await page.fill('[data-sec=scope] .kvr-f:has-text("Periode A fra") input', '2026-09-28');
  await page.fill('[data-sec=scope] .kvr-f:has-text("Periode A til") input', '2026-09-28');
  await page.fill('[data-sec=scope] .kvr-f:has-text("Periode B fra") input', '2026-10-01');
  await page.fill('[data-sec=scope] .kvr-f:has-text("Periode B til") input', '2026-10-01');
  assert.match(await scopeTxt(), /A 2026-09-28 → 2026-09-28 mot B 2026-10-01 → 2026-10-01 → 11 av 11/);
  await runAnalysis();
  const cmp = (await page.innerText('[data-sec=chk-cmp]')).replace(/\s+/g, ' ');
  assert.match(cmp, /Alle 5 3 40 % → 0 %/);
  assert.match(cmp, /Kasserer D 0 1 .*risikoscore \+5/);
  assert.match(cmp, /Kasserer A/);
  if (process.env.SHOT) { await page.setViewportSize({ width: 1100, height: 1500 }); await page.evaluate(() => { document.getElementById('kvr-panel').style.top = '10px'; }); await (await page.$('#kvr-panel')).screenshot({ path: process.env.SHOT.replace('.png', '-omfang.png') }); }
  await page.click('[data-sec=scope] label:has-text("Sammenlign med en annen periode") input');
  await page.click('[data-sec=scope] button:text-is("Nullstill omfang")');

  // omfang utenfor det som er hentet: advarsel og henting fra CW
  await page.fill('[data-sec=scope] .kvr-f:has-text("Periode fra") input', '2026-08-01');
  await page.waitForSelector('[data-sec=scope] .kvr-scanwarn', { state: 'visible' });
  assert.match(await page.innerText('[data-sec=scope] .kvr-scanwarn'), /fra 2026-08-01/);
  await page.click('[data-sec=scope] .kvr-scanwarn button:text-is("Hent fra CW")');
  await page.waitForSelector('[data-sec=scope] .kvr-scanwarn', { state: 'hidden', timeout: 30000 });
  assert.strictEqual(await page.inputValue('#fromDatePicker'), '01.08.2026');
  assert.ok((await page.evaluate(() => window.__applied)) >= 1);

  // Benford-diagram finnes under Diagram
  await go('Analyse', 'Diagram');
  assert.ok(await page.$('[data-sec=ch-benford] svg'), 'Benford-diagram');
  assert.strictEqual(await page.$$eval('[data-sec=ch-benford] .kvr-hit', n => n.length), 9);

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('audit: ok');
})().catch(e => { console.error(e); process.exit(1); });
