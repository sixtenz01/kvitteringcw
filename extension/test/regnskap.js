const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

// Regnskapskontrollene (linjer mot Totalt, betaling, MVA, betalingsreferanse) er fjernet: feil på bongene gir ingen funn. CSV og «Skann på nytt» for eldre skanninger.
const f2 = (n) => n.toFixed(2);
const TR = (a, c) => `<tr><td>${a}</td><td></td><td>${c}</td></tr>`;
const vat = (tot, r = 25, bad) => { const g = Math.round(tot / (1 + r / 100) * 100) / 100; const m = bad !== undefined ? bad : Math.round((tot - g) * 100) / 100; return `<tr><td>MVA-grunnlag</td><td>MVA-%</td><td>MVA</td><td>Sum</td></tr><tr><td>${f2(g)}</td><td>${r} %</td><td>${f2(m)}</td><td>${f2(tot)}</td></tr>`; };
const ROWS = [];
let n = 0;
const add = (o) => { n++; ROWS.push(Object.assign({ id: `1001-1-${n}`, cashier: 'A', time: `2026-10-02 10:${String(10 + n)}`, ws: 1 }, o)); };
for (let i = 0; i < 12; i++) add({ tot: 120 + i, lines: [100 + i, 20], pay: `Bank:|${120 + i}`, mva: vat(120 + i), ref: `TransId: GOOD${1000 + i}` });
add({ tot: 250, lines: [100, 132], pay: 'Bank:|250', mva: vat(250), ref: 'TransId: BADLINE01' });   // linjer 232 mot Totalt 250
add({ tot: 120, lines: [100, 20], pay: 'Bank:|100', mva: vat(120), ref: 'TransId: BADPAY001' });     // betalt 100 mot 120
add({ tot: 120, lines: [100, 20], pay: 'Bank:|120', mva: vat(120, 25, 30), ref: 'TransId: BADVAT001' }); // MVA 30 mot 24
add({ tot: 120, lines: [100, 20], pay: 'Bank:|120', mva: vat(120, 20), ref: 'TransId: BADRATE01' });  // sats 20
add({ tot: 90, lines: [90], pay: 'Bank:|90', ref: 'TransId: SAMEREF001' });
add({ tot: 95, lines: [95], pay: 'Bank:|95', ref: 'TransId: SAMEREF001', ws: 2 });                    // samme TransId på to kasser
const rows = ROWS.map((r) => ({ transactionId: r.id, endDateTime: r.time, storeNumber: 1001, workstationNumber: r.ws, cashierNumber: r.cashier, totalAmount: r.tot, receiptType: 1, memberNumber: null, journalSourceName: 'main' }));
const receipts = {};
ROWS.forEach((r) => {
  const [pl, pa] = r.pay.split('|');
  receipts[r.id] = `<div>Kvittering: ${r.id.split('-')[2]} 02.10.2026 ${r.time.slice(11)}:00</div><table>` + r.lines.map((a, i) => TR(`7000000000${String(i + 1).padStart(3, '0')} VARE ${i + 1}`, f2(a))).join('') +
    `<tr><td></td><td>Totalt</td><td>${f2(r.tot)}</td></tr>` + TR(pl, pa) + `<tr><td>${r.ref}</td></tr>` + (r.mva || '') + '</table>';
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
    await page.waitForFunction(() => /Kontroller ferdig/.test(document.getElementById('kvr-panel').innerText), null, { timeout: 60000 });
    await go('Analyse', 'Detaljer');
    await page.click('button:text-is("Åpne alle")');
  };
  await analyse();
  const fnd = await txt('[data-sec=findings]');
  assert.doesNotMatch(fnd, /Regnskap|stemmer ikke med totalen|MVA|Ugyldig MVA-sats|betalingsreferanse på flere bonger/, 'regnskapskontrollene er fjernet');
  const acct = await txt('[data-sec=acct]');
  assert.match(acct, /Topptekst og bunn/);
  assert.doesNotMatch(acct, /Linjer mot Totalt|MVA-tabell|betalingsreferanser lest/);
  assert.ok(!(await page.$('[data-sec=acct] button:text-is("Skann på nytt")')) && !/Skann på nytt \(/.test(acct), 'ingen eldre skanninger ennå');

  // CSV har betaling og referanser
  await go('Mer', 'Eksport');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:text-is("CSV")')]);
  const csv = require('fs').readFileSync(await dl.path(), 'utf8');
  const head = csv.split('\r\n')[0], line = csv.split('\r\n').find((l) => l.includes('1001-1-13'));
  assert.match(head, /Betaling;Rabatt kr \(årsakskode\);Betalingsref;Totalt på bong$/);
  assert.match(line, /;Bank 250;0;BADLINE01;250$/);

  // gjør skanningene «eldre» (v4), last på nytt: kortet tilbyr omskanning med bekreftelse
  await page.evaluate(() => new Promise(res => { const rq = indexedDB.open('kvr-store', 1); rq.onsuccess = () => { const tx = rq.result.transaction('scan', 'readwrite'), st = tx.objectStore('scan'); const c = st.openCursor(); c.onsuccess = () => { const cur = c.result; if (cur) { const v = cur.value; v.v = 4; delete v.tot; delete v.rf; delete v.mv; delete v.rnd; cur.update(v); cur.continue(); } }; tx.oncomplete = () => res(); }; }));
  await load();
  await analyse();
  assert.match(await txt('[data-sec=acct]'), /Ingen salg med topptekst og bunn/);
  await page.click('[data-sec=acct] button:has-text("Skann på nytt (18 eldre)")');
  assert.match(await txt('.kvr-dlg'), /18 bonger har eldre skanning uten topptekst, bunn og kortdata\. Skanner dem på nytt \(ca\. 20 s\)/);
  await page.click('.kvr-dlg button:text-is("Skann på nytt")');
  await page.waitForFunction(() => /Ferdig\. Skannet 18/.test(document.getElementById('kvr-panel').innerText), null, { timeout: 60000 });
  await analyse();
  assert.match(await txt('[data-sec=acct]'), /0 av 18 skannede salg har lest topptekst/);
  assert.doesNotMatch(await txt('[data-sec=findings]'), /Regnskap/);

  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(apiCalls, []);
  await browser.close();
  console.log('regnskap: ok');
})().catch(e => { console.error(e); process.exit(1); });
