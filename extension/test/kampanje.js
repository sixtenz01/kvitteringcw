const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

// Kampanjevare: samme vare med rabatt hos flere kasserere. Standard: klassifiseres automatisk.
// Uten automatikk: bongene tas med med notat, og brukeren blir spurt.
const f2 = (n) => n.toFixed(2);
const TR = (a, c) => `<tr><td>${a}</td><td></td><td>${c}</td></tr>`;
const E1 = '7038010000010';
const ROWS = [];
let n = 0;
const add = (o) => { n++; ROWS.push(Object.assign({ id: `1001-1-${n}`, cashier: 'A', time: `2026-10-02 1${Math.floor(n / 10)}:${String(10 + (n % 10) * 5)}`, ws: 1, tot: 0, body: [] }, o)); };
for (let i = 0; i < 6; i++) add({ cashier: 'B', tot: 50 + i, body: [TR(`70000000000${i} VARE`, f2(50 + i)), TR('Bank:', f2(50 + i))] });
['A', 'B', 'C', 'D'].forEach((c) => add({ cashier: c, tot: 12, body: [TR(`${E1} KAMPANJEVARE`, '12.00'), '<tr><td>Rabatt: Kr 8.00 (40 %)</td></tr>', TR('Bank:', '12.00')] }));
['E', 'F'].forEach((c) => add({ cashier: c, tot: 13.4, body: [TR(`${E1} KAMPANJEVARE`, '13.40'), '<tr><td>Rabatt: Kr 6.60 (33 %)</td></tr>', TR('Bank:', '13.40')] }));   // samme vare, annen prosent
add({ cashier: 'G', time: '2026-10-02 15:55', tot: 10, body: [TR('7038010000027 SJOKOLADE', '10.00'), '<tr><td>Rabatt: Kr 10.00 (50 %)</td></tr>', TR('Bank:', '10.00')] });   // én bong: ikke kampanjevare
const rows = ROWS.map((r) => ({ transactionId: r.id, endDateTime: r.time, storeNumber: 1001, workstationNumber: r.ws, cashierNumber: r.cashier, totalAmount: r.tot, receiptType: 1, memberNumber: null, journalSourceName: 'main' }));
const receipts = {};
ROWS.forEach((r) => {
  receipts[r.id] = `<div>Kvittering: ${r.id.split('-')[2]} ${r.time.slice(8, 10)}.${r.time.slice(5, 7)}.${r.time.slice(0, 4)} ${r.time.slice(11)}:00</div><table>` + r.body.join('') + `<tr><td></td><td>Totalt</td><td>${f2(r.tot)}</td></tr></table>`;
});

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
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
  const analyse = async () => {
    await go('Analyse', 'Sjekk først');
    await page.click('[data-sec=chk-top] button:text-is("Kjør analyse")');
    await page.waitForFunction(() => /Kontroller ferdig/.test(document.getElementById('kvr-panel').innerText), null, { timeout: 90000 });
  };
  // bonger med «Rabatt uten årsak», utenom sjokoladebongen kl 15:55 (all = med)
  const flagged = async (all) => page.$$eval('[data-sec=chk-list] .kvr-ck', (n, all) => n.filter((x) => (all || !/15:55/.test(x.querySelector('.kvr-ck-t').textContent)) && [...x.querySelectorAll('.kvr-reason')].some((r) => r.textContent === 'Rabatt uten årsak')).length, all);
  const note = /Kan være sentral kampanje: «KAMPANJEVARE» med 40 % og 33 % rabatt er på 6 bonger hos 6 kasserere/;

  await analyse();
  // automatisk kampanjevare (standard): flere enn én kasserer, flere enn to ulike bonger
  assert.strictEqual(await flagged(), 0, 'kampanjevare flagges ikke');
  assert.ok(!/venter på svar/.test(await txt('[data-sec=chk-top]')), 'ingen spørsmål');
  await go('Analyse', 'Detaljer');
  await page.click('button:text-is("Åpne alle")');
  assert.match(await txt('[data-sec=disc]'), /Kampanjevarer .*KAMPANJEVARE 40 % og 33 % 6 6 1 1 Kampanjevare \(automatisk\) Ikke kampanje/);
  assert.match(await txt('[data-sec=disc]'), /1 varer er klassifisert som kampanjevare/);
  // dekning og varer som ikke er kampanjevare, med manuell merking
  assert.match(await txt('[data-sec=disc]'), /Kampanjesjekken ser 13 av 13 salg i grunnlaget \(7 av 7 kasserere har skannede bonger\)/);
  assert.match(await txt('[data-sec=disc]'), /Rabatt uten årsak på varer som ikke er kampanjevare Vare Rabatt Bonger Uten årsak Kasserere Hvorfor ikke SJOKOLADE 50 % 1 1 1 bare 1 bong \(grense 3\) Kampanjevare/);
  assert.strictEqual(await flagged(true), 1, 'sjokoladen er flagget');
  await page.click('[data-sec=disc] button:text-is("Kampanjevare")');
  await page.waitForFunction(() => /SJOKOLADE 50 % 1 1 1 1 Kampanje\s*Angre/.test(document.querySelector('[data-sec=disc]').innerText.replace(/\s+/g, ' ')), null, { timeout: 30000 });
  await go('Analyse', 'Sjekk først');
  assert.strictEqual(await flagged(true), 0, 'merket som kampanjevare: ikke flagget');
  await go('Analyse', 'Detaljer');
  await page.click('[data-sec=disc] button:text-is("Angre")');
  await page.waitForFunction(() => /bare 1 bong/.test(document.querySelector('[data-sec=disc]').innerText), null, { timeout: 30000 });
  await page.click('[data-sec=disc] button:text-is("Ikke kampanje")');
  await page.waitForFunction(() => /Ikke kampanje\s*Angre/.test(document.querySelector('[data-sec=disc]').innerText), null, { timeout: 30000 });
  await go('Analyse', 'Sjekk først');
  assert.strictEqual(await flagged(), 6, '«Ikke kampanje» flagger som vanlig');
  await go('Analyse', 'Detaljer');
  await page.click('[data-sec=disc] button:text-is("Angre")');
  await page.waitForFunction(() => /Kampanjevare \(automatisk\)/.test(document.querySelector('[data-sec=disc]').innerText), null, { timeout: 30000 });
  await go('Analyse', 'Sjekk først');
  assert.strictEqual(await flagged(), 0);
  // slå av automatikken: du blir spurt i stedet
  await go('Mer', 'Innstillinger');
  if (!(await page.$eval('[data-sec=set-disc]', d => d.open))) await page.click('[data-sec=set-disc] summary');
  await page.uncheck('[data-sec=set-disc] .kvr-set-row:has-text("Klassifiser automatisk som kampanjevare") input[type=checkbox]');
  await analyse();
  // bongene tas med, med notat og spørsmål
  assert.strictEqual(await flagged(), 6, 'alle seks bongene er flagget, også de med annen prosent');
  assert.match(await txt('[data-sec=chk-top]'), /1 mulig sentral kampanje venter på svar/);
  assert.match(await txt('.kvr-ctlsum'), /7 å sjekke/);
  if (!(await page.$('[data-sec=chk-list] .kvr-camp'))) await page.locator('[data-sec=chk-list] .kvr-ck').filter({ hasNotText: '15:55' }).first().locator('.kvr-ck-h').click();
  assert.match(await txt('[data-sec=chk-list] .kvr-camp'), /Kan være sentral kampanje: «KAMPANJEVARE» med 40 % og 33 % rabatt er på 6 bonger hos 6 kasserere\. Stemmer det\?/);
  assert.ok(!/\.\./.test(await txt('[data-sec=chk-list]')), 'forklaringen slutter ikke på to punktum');
  assert.ok(await page.$('[data-sec=chk-list] .kvr-camp button:text-is("Ja, kampanje")') && await page.$('[data-sec=chk-list] .kvr-camp button:text-is("Nei, ikke kampanje")'));
  await go('Analyse', 'Detaljer');
  await page.click('button:text-is("Åpne alle")');
  const disc = await txt('[data-sec=disc]');
  assert.match(disc, /Mulige sentrale kampanjer 1 vare venter på svar/);
  assert.match(disc, /KAMPANJEVARE 40 % og 33 % 6 6 1 1/);
  assert.match(await txt('[data-sec=ctlsum] .kvr-ctlsum'), /1 kampanjer å bekrefte/);
  assert.match(await txt('[data-sec=findings]'), note);

  // spørsmålet i dialogen: Ja
  await go('Analyse', 'Sjekk først');
  await page.click('[data-sec=chk-top] button:text-is("Svar nå")');
  assert.match(await txt('.kvr-dlg'), /Mulige sentrale kampanjer.*KAMPANJEVARE 40 % og 33 % 6 6 1 1/);
  await page.click('.kvr-dlg button:text-is("Ja")');
  await page.waitForFunction(() => /Kampanje\s*Angre/.test((document.querySelector('.kvr-dlg') || {}).innerText || ''), null, { timeout: 30000 });
  await page.click('.kvr-dlg button:text-is("Lukk")');
  assert.strictEqual(await flagged(), 0, 'bekreftet kampanje: alle seks bonger oppdateres, også de med 33 %');
  assert.match(await txt('#kvr-panel'), /Merket som sentral kampanje, uansett rabattprosent\. Rabatten flagges ikke lenger\. Gjelder alle 6 bongene med varen \(7 → 1 flaggede bonger\)/);
  assert.ok(!/venter på svar/.test(await txt('[data-sec=chk-top]')));

  // svaret huskes etter omlasting
  await load();
  await analyse();
  assert.strictEqual(await flagged(), 0);
  await go('Analyse', 'Detaljer');
  await page.click('button:text-is("Åpne alle")');
  assert.match(await txt('[data-sec=disc]'), /KAMPANJEVARE 40 % og 33 % 6 6 1 1 Kampanje Angre/);
  // angre: flagges igjen, med spørsmål
  await page.click('[data-sec=disc] button:text-is("Angre")');
  await page.waitForFunction(() => /venter på svar/.test(document.querySelector('[data-sec=disc]').innerText), null, { timeout: 30000 });
  await go('Analyse', 'Sjekk først');
  assert.strictEqual(await flagged(), 6);
  // Nei: flagges som vanlig, uten notat
  await go('Analyse', 'Detaljer');
  await page.click('[data-sec=disc] button:text-is("Nei")');
  await page.waitForFunction(() => /Ikke kampanje\s*Angre/.test(document.querySelector('[data-sec=disc]').innerText), null, { timeout: 30000 });
  assert.ok(!note.test(await txt('[data-sec=findings]')), 'ingen kampanjenotat etter Nei');
  assert.match(await txt('[data-sec=findings]'), /Rabatt uten årsak/);
  await go('Analyse', 'Sjekk først');
  assert.strictEqual(await flagged(), 6);
  assert.ok(!(await page.$('[data-sec=chk-top] button:text-is("Svar nå")')));

  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(apiCalls, []);
  await browser.close();
  console.log('kampanje: ok');
})().catch(e => { console.error(e); process.exit(1); });
