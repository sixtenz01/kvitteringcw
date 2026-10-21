const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

// Tempo, overvåkede varer, retur uten kjøp, topptekst og bunn (v7), betalingsmåter og fulltekstsøk via skanning i visningsfeltet.
const f2 = (n) => n.toFixed(2);
const TR = (a, c) => `<tr><td>${a}</td><td></td><td>${c}</td></tr>`;
const E1 = '7038010000010', E2 = '7038010000027', E4 = '7038010000041', MARL = '7040913000011';
const ROWS = [];
let n = 0;
const top = (ws, cash, extra) => `<div>Coop Mega Kolbotn</div><div>Butikk: 1001, Kassenr: ${ws}, Kasserer: ${cash}</div><div>Kvittering: ${n} 02.10.2026 10:00:00</div>${extra || ''}`;
const add = (o) => {
  n++;
  const r = Object.assign({ id: `1001-${o.ws || 1}-${n}`, cashier: 'B', ws: 1, tot: 10, date: '2026-10-02', time: '10:00:00', lines: [], pay: 'Bank', auth: 'AU' + n, term: 'T555111', hdrCash: null, card: null }, o);
  r.hdrCash = r.hdrCash || r.cashier;
  ROWS.push(r);
};
// bakgrunn: 11 vanlige salg på kasse 3, fem minutter mellom hver, unike autorisasjonskoder
for (let i = 0; i < 11; i++) add({ cashier: 'B', ws: 3, time: `10:${String(10 + i * 5).padStart(2, '0')}:00`, tot: 40 + i, lines: [[`70000000000${i}`, 'VARE', 40 + i]] });
// serie: seks bonger på kasse 1 med 10 sekunder mellom hver, to av dem med samme autorisasjonskode
for (let i = 0; i < 6; i++) add({ cashier: 'A', ws: 1, time: `09:00:${String(i * 10).padStart(2, '0')}`, tot: 20 + i, lines: [[`70000000010${i}`, 'SMÅVARE', 20 + i]], auth: i < 2 ? 'ZZ99' : 'AU' + (100 + i), term: i < 2 ? 'T111222' : 'T555111' });
// topptekst som ikke stemmer med listen
add({ cashier: 'D', ws: 4, time: '12:00:00', tot: 33, lines: [['7000000000333', 'RAR VARE', 33]], hdrCash: 'Z' });
// overvåket vare: salg og retur
add({ cashier: 'E', ws: 5, time: '13:00:00', tot: 99, lines: [[MARL, 'MARLBORO RED', 99]] });
add({ cashier: 'E', ws: 5, time: '13:10:00', tot: -99, lines: [[MARL, 'MARLBORO RED', -99]] });
// retur uten kjøp: kortet har kjøpt melk for en uke siden og brød i dag, men leverer tilbake sko
const card = '<tr><td>Kort: ************1234</td></tr>';
add({ cashier: 'B', ws: 3, date: '2026-09-24', time: '12:00:00', tot: 15, lines: [['7000000000999', 'ANKER', 15]] });
add({ cashier: 'F', ws: 6, date: '2026-09-28', time: '12:00:00', tot: 20, lines: [[E1, 'TINE MELK', 20]], pay: 'Visa', card });
add({ cashier: 'F', ws: 6, time: '11:00:00', tot: 30, lines: [[E2, 'BRØD', 30]], pay: 'Visa', card });
add({ cashier: 'F', ws: 6, time: '11:30:00', tot: -20, lines: ['RETUR VARE Coop Matvaregaranti', [E4, 'SKO', -20]], pay: 'Visa', card });
// returårsak: kasserer G har tre returer med matvaregaranti
for (let i = 0; i < 3; i++) add({ cashier: 'G', ws: 7, time: `14:${i}5:00`, tot: -30, lines: ['RETUR VARE Coop Matvaregaranti', [E2, 'BRØD', -30]] });
add({ cashier: 'F', ws: 6, time: '11:40:00', tot: -20, lines: [[E1, 'TINE MELK', -20]], pay: 'Visa', card });

const rows = ROWS.map((r) => ({ transactionId: r.id, endDateTime: `${r.date} ${r.time}`, storeNumber: 1001, workstationNumber: r.ws, cashierNumber: r.cashier, totalAmount: r.tot, receiptType: 1, memberNumber: null, journalSourceName: 'main' }));
const receipts = {};
ROWS.forEach((r, i) => {
  n = i + 1;
  const body = r.lines.map((l) => typeof l === 'string' ? `<tr><td>${l}</td></tr>` : TR(`${l[0]} ${l[1]}`, f2(l[2]))).join('') + TR(r.pay + ':', f2(r.tot)) + (r.card || '');
  receipts[r.id] = top(r.ws, r.hdrCash) + `<table>${body}</table><div>Terminal: ${r.term}</div><div>Aut.kode: ${r.auth}</div><div>Kontaktløs</div>`;
});

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<input id="fromDatePicker"><input id="toDatePicker"><input id="freetextSearchInput"><input id="receiptNumber">
<input ng-model="vm.selectedFilters.memberNumber"><input ng-model="vm.selectedFilters.externalLoyaltyNumber">
<select id="paymentMethods"><option>Bank</option><option>Visa</option><option>Kontant</option></select>
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
function mk(list){return {each:function(fn){list.forEach(function(e,i){fn.call(e,i,e)})},eq:function(i){return mk([list[i]])},data:function(n){var e=list[0];if(!e)return undefined;if(e.getAttribute('data-w'))return n==='kendoMultiSelect'?ms:null;return n==='kendoGrid'?grid:null},val:function(){}}}
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
  const group = async (id) => { if (!(await page.$eval(`[data-sec=set-${id}]`, d => d.open))) await page.click(`[data-sec=set-${id}] summary`); };
  const analyse = async () => {
    await go('Analyse', 'Sjekk først');
    await page.click('[data-sec=chk-top] button:text-is("Kjør analyse")');
    await page.waitForFunction(() => /Kontroller ferdig/.test(document.getElementById('kvr-panel').innerText), null, { timeout: 60000 });
    await go('Analyse', 'Detaljer');
    await page.click('button:text-is("Åpne alle")');
  };

  // overvåkede varer er av til listen fylles ut under Innstillinger
  await analyse();
  assert.ok(!/Overvåket vare i retur/.test(await txt('[data-sec=findings]')), 'overvåkede varer er av som standard');
  await go('Mer', 'Innstillinger');
  await group('watch');
  await page.check('[data-sec=set-watch] input[aria-label="Varer (EAN eller del av navn, komma): på"]');
  const wi = page.locator('[data-sec=set-watch] input[aria-label="Varer (EAN eller del av navn, komma)"]');
  await wi.fill('marlbo');
  await wi.press('Tab');
  await analyse();

  const fnd = await txt('[data-sec=findings]');
  assert.match(fnd, /Tempo: Bonger i rask rekkefølge Kasse 1 2026-10-02 09:00–09:00: 6 bonger på 50 s, høyst 10 s mellom \(grense 25 s\)/);
  assert.match(fnd, /Overvåket vare: Overvåket vare i retur .*«MARLBORO RED» \(7040913000011, 99\.00 kr\)/);
  assert.match(fnd, /Retur av vare: Retur av vare uten kjøp på kortet .*«SKO» \(7038010000041, 20\.00 kr, årsak: Coop Matvaregaranti\) er ikke kjøpt med samme kort siste 7 dager, selv om kortet har 2 andre kjøp i perioden/);
  assert.ok(!/«TINE MELK» \(7038010000010, 20\.00 kr\) er ikke kjøpt/.test(fnd), 'melk er kjøpt med samme kort');
  assert.match(fnd, /Topptekst: Topptekst stemmer ikke med listen .*bongen sier kasserer Z, listen sier kasserer D/);
  assert.match(fnd, /Topptekst: Samme autorisasjonskode på flere bonger Autorisasjon ZZ99 \(terminal T111222\) står på 2 bonger/);

  // kort i Detaljer
  const lines = await txt('[data-sec=lines]');
  assert.match(lines, /Tempo: tid mellom bonger \d+ salg\. Listen viser sekunder \(100 %[^)]*\)\. 1 serier på 6 bonger/);
  assert.match(lines, /Overvåkede varer 2 av \d+ skannede salg har varene: marlbo\./);
  assert.match(lines, /Retur av vare uten kjøp \d+ returer med \d+ vare-linjer vurdert\. 1 uten kjøp av samme vare \(kort 1, medlem 0, samme dag 0\)/);
  // returårsak
  assert.match(lines, /Retur per årsak 4 bonger med 4 returlinjer \(110[.,]00 kr\) blant \d+ skannede salg\. 4 bonger har overvåket årsak \(matvaregaranti\)/);
  assert.match(lines, /Coop Matvaregaranti 4 4 110[.,]00 G ×3, F ×1/);
  assert.match(fnd, /Mange returer med overvåket årsak.*Kasserer G: 3 av 3 bonger har retur med overvåket årsak \(matvaregaranti 3; 100 % mot \d,\d % hos de andre kassererne, grense 3 bonger\)/);
  assert.ok(await page.$eval('[data-sec=lines] td.kvr-bad button:text-is("Coop Matvaregaranti")', () => true), 'overvåket årsak er rød');
  await page.click('[data-sec=lines] button:text-is("Coop Matvaregaranti")');
  assert.match(await txt('#kvr-panel'), /Viser kvitteringer med «Coop Matvaregaranti»/);
  assert.strictEqual(await page.$$eval('tbody tr', (t) => t.filter((r) => r.offsetParent !== null).length), 4, 'listen viser de fire returbongene');
  await go('Filtrer');
  await page.fill('#kvr-panel input[placeholder^="ord, EAN"]', '');
  await page.press('#kvr-panel input[placeholder^="ord, EAN"]', 'Tab');
  await page.waitForFunction((n) => [...document.querySelectorAll('tbody tr')].filter((r) => r.offsetParent !== null).length === n, rows.length, { timeout: 10000 });
  // kvitteringen viser linjen «RETUR VARE …», markert når årsaken er overvåket
  await go('Analyse', 'Sjekk først');
  const nck = await page.$$eval('[data-sec=chk-list] .kvr-ck', (x) => x.length);
  for (let i = 0; i < nck; i++) { const ck = page.locator('[data-sec=chk-list] .kvr-ck').nth(i); if (!(await ck.locator('.kvr-rcpt').count())) await ck.locator('.kvr-ck-h').click(); }
  assert.ok(await page.$$eval('[data-sec=chk-list] .kvr-rcpt .kvr-rc-row.kvr-rc-hit', (x) => x.some((n) => /RETUR VARE Coop Matvaregaranti/.test(n.textContent))), 'RETUR VARE-linjen i kvitteringen');
  await go('Analyse', 'Detaljer');
  const acct = await txt('[data-sec=acct]');
  assert.match(acct, /Topptekst og bunn \d+ av \d+ skannede salg har lest topptekst \(kasserer: 2\d av 2\d stemmer med listen \(9\d %\); kasse: 2\d av 2\d/);
  assert.ok(!/kasserer: [^;]*ikke kalibrert/.test(acct), 'kasserer er kalibrert');
  assert.match(acct, /\d+ har tekst fra kortterminalen, \d+ med autorisasjonskode, 1 koder brukt på flere bonger/);

  // Diagnostikk: betalingsmåter og topptekst/bunn
  await page.click('[data-sec=misc] button:text-is("Diagnostikk: ukjente linjer…")');
  const dg = (await page.innerText('.kvr-dlg')).replace(/\s+/g, ' ');
  assert.match(dg, /Betalingsmåter Betalingsmåte Bonger Sum kr Kasserere I CW-listen Bank \d+ [\d  ,]+ \d ja Visa 4 /);
  assert.match(dg, /Betalingsmåter i CW-filteret: Bank, Visa, Kontant\./);
  assert.match(dg, /Topptekst og bunn \(versjon 7\) \d+ av \d+ skannede bonger har topptekst\/bunn lest\. Topptekst \(butikk, kasse, kasserer, medlem\) på \d+; terminal-ID på \d+; autorisasjonskode på \d+\. Inngangsmåter: kontaktløs \d+\./);
  assert.match(dg, /Coop Mega Kolbotn/);
  await page.click('.kvr-dlg button:text-is("Lukk")');

  // søk i alt innhold, og betalingsmåte
  const viser = async () => (await txt('.kvr-tiles')).match(/^(\d+) \/ (\d+)/)[1];
  await go('Filtrer');
  const search = page.locator('input[placeholder="ord, EAN, beløp, kortnr, referanse …"]');
  await search.fill('zz99');
  assert.strictEqual(await viser(), '2');
  assert.match(await txt('.kvr-chipsrow'), /Søk: zz99/);
  await search.fill('marlboro 99,00');
  assert.strictEqual(await viser(), '2');
  await search.fill('"aut.kode"');
  assert.strictEqual(await viser(), '0', 'rå tekst lagres ikke, bare strukturerte verdier');
  await search.fill('t111222 kontaktløs');
  assert.strictEqual(await viser(), '2');
  await search.fill('1234 visa');
  assert.strictEqual(await viser(), '4');
  await search.fill('');
  const labels = await page.$$eval('select[aria-label="Betalingsmåte"] option', o => o.map(x => x.textContent));
  assert.deepStrictEqual(labels, ['Alle', 'Bank', 'Visa']);
  await page.selectOption('select[aria-label="Betalingsmåte"]', 'Visa');
  assert.strictEqual(await viser(), '4');
  assert.match(await txt('.kvr-chipsrow'), /Betaling: Visa/);
  await page.selectOption('select[aria-label="Betalingsmåte"]', '');
  assert.strictEqual(await viser(), String(rows.length));

  // skanningen (versjon 7) overlever omlasting uten ny skanning
  await new Promise((r) => setTimeout(r, 600));
  await load();
  await go('Filtrer');
  await page.locator('input[placeholder="ord, EAN, beløp, kortnr, referanse …"]').fill('zz99');
  assert.strictEqual(await viser(), '2');

  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(apiCalls, []);
  await browser.close();
  console.log('innhold e2e: ok');
})().catch(e => { console.error(e); process.exit(1); });
