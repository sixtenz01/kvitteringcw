const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const rows = [
  { transactionId: 't-1', endDateTime: '2026-10-02 00:22', storeNumber: 1005, workstationNumber: 6, cashierNumber: '10', totalAmount: -556, receiptType: 1, memberNumber: null, journalSourceName: 'main' },
  { transactionId: 't-2', endDateTime: '2026-10-02 00:04', storeNumber: 1005, workstationNumber: 1, cashierNumber: '11', totalAmount: null, receiptType: 2, memberNumber: null, journalSourceName: 'main' },
  { transactionId: 't-3', endDateTime: '2026-10-02 00:01', storeNumber: 1005, workstationNumber: 4, cashierNumber: '12', totalAmount: 296.8, receiptType: 1, memberNumber: 'M1', journalSourceName: 'main' },
  { transactionId: 't-4', endDateTime: '2026-10-02 00:01', storeNumber: 1005, workstationNumber: 4, cashierNumber: '12', totalAmount: 296.8, receiptType: 1, memberNumber: null, journalSourceName: 'main' },
  { transactionId: 't-5', endDateTime: '2026-10-01 14:00', storeNumber: 1005, workstationNumber: 2, cashierNumber: '10', totalAmount: 50, receiptType: 1, memberNumber: null, journalSourceName: 'main' }
];

const tr = (a, b, c) => `<tr><td>${a}</td><td></td><td>${c}</td></tr>`;
const RECEIPTS = {
  't-2': '<table>' + tr('Kontant:', '', '1 000.00') + tr('Sum', '', '1 000.00') + tr('Pose: 512324789405', '', '') + tr('Differanse', '', '') + tr('Kontant:', '', '+1 000.00') + tr('Sum', '', '+1 000.00') + '</table>',
  't-1': '<table>' + tr('RETUR VARE', '', '') .replace('<td></td><td></td>', '') + tr('399 PANTELAPP', '', '-150.00') + tr('399 PANTELAPP', '', '-106.00') + '<tr><td>Kontant tilbake:</td><td></td><td>256.00</td></tr></table>',
  't-3': '<table>' + tr('7044610877488 PEPSI MAX 0.5L', '', '32.90') + tr('220 PANT', '', '2.00') + tr('7330196001042 SKRUF NO4 FRESH S4', '', '101.90') + '</table>',
  't-4': '<table>' + tr('7038010002274 BIOLA JORDBÆR 1000G', '', '39.90') + tr('7044416015367 REGAL HVETEMEL 1KG', '', '20.50') + '</table>',
  't-5': '<table>' + tr('7000000000001 BANAN KG', '', '15.00') + '</table>'
};

const html = `<!doctype html><html><body>
<input id="fromDatePicker"><input id="toDatePicker"><input id="freetextSearchInput"><input id="receiptNumber">
<input ng-model="vm.selectedFilters.memberNumber"><input ng-model="vm.selectedFilters.externalLoyaltyNumber">
<button ng-click="vm.resetFilters()" onclick="window.__reset=(window.__reset||0)+1">Nullstill</button><button ng-click="vm.applyFilters()" onclick="window.__applied=(window.__applied||0)+1;(window.__bound||[]).forEach(function(f){f()})">Oppdater</button>
<div class="k-grid-header"><table><colgroup><col><col><col></colgroup><thead><tr><th>DATO</th><th>TID</th><th>SUM</th><th>KASSERER</th><th>KASSE</th></tr></thead></table></div>
<table id="g" data-role="grid"><colgroup><col><col><col></colgroup><tbody>
${rows.map(r => `<tr data-id="${r.transactionId}"><td></td><td>${r.endDateTime}</td><td>${r.totalAmount}</td><td data-field="cashierNumber">${r.cashierNumber}</td><td data-field="workstationNumber">${r.workstationNumber}</td></tr>`).join('')}
</tbody></table>
<div data-w="1"></div><div data-w="2"></div>
<iframe id="rc"></iframe>
<script>
var rows=${JSON.stringify(rows)};
var receipts=${JSON.stringify(RECEIPTS)};
var items=rows.map(function(r,i){var o=Object.assign({uid:'u'+i},r);o.toJSON=function(){var c=Object.assign({},o);delete c.toJSON;return c};return o});
var cur=null;
var grid={tbody:[document.querySelector('tbody')],dataSource:{view:function(){return items}},
 dataItem:function(tr){return items.filter(function(i){return i.transactionId===tr.getAttribute('data-id')})[0]},
 bind:function(n,f){ (window.__bound=window.__bound||[]).push(f) },
 select:function(tr){ if(!arguments.length) return cur?[cur]:[]; cur=tr; var id=tr.getAttribute('data-id'); setTimeout(function(){ document.getElementById('rc').contentDocument.body.innerHTML=receipts[id]||'<table><tr><td>X</td><td></td><td>1.00</td></tr></table>'; },200); },
 clearSelection:function(){cur=null}};
var ms={dataSource:{data:function(){return [{get:function(k){return {number:1005,text:'Coop Mega Kolbotn'}[k]}},{get:function(k){return {number:1010,text:'Extra Testby'}[k]}}]}},value:function(v){window.__storesSet=v},trigger:function(){}};
function mk(list){return {each:function(fn){list.forEach(function(e,i){fn.call(e,i,e)})},eq:function(i){return mk([list[i]])},data:function(n){var e=list[0];if(!e)return undefined;if(e.getAttribute('data-w'))return n==='kendoMultiSelect'?ms:null;return n==='kendoGrid'?grid:null}}}
window.jQuery=function(a){ if(typeof a==='string') return a.indexOf('#storesWrapper')===0?mk([].slice.call(document.querySelectorAll('[data-w]'))):mk([]); return mk([a]); };
</script></body></html>`;

(async () => {
  const dir = path.join(__dirname, '..');
  const browser = await chromium.launch();
  const context = await browser.newContext({ acceptDownloads: true, locale: 'nb-NO' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept('Bakeri'));
  const failIds = new Set();
  await page.route('https://chainweb.coop.no/**', async r => {
    const u = r.request().url();
    if (u.endsWith('/Api/GetReceiptDetails')) {
      const body = JSON.parse(r.request().postData());
      const id = 't-' + body.sequenceNum;
      if (failIds.has(id)) return r.fulfill({ contentType: 'application/json', body: '""' });
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify(RECEIPTS[id] || '') });
    }
    return r.fulfill({ contentType: 'text/html', body: html });
  });
  const load = async () => {
    await page.goto('https://chainweb.coop.no/LindbakRetail_1/Journal/Viewer');
    await page.addScriptTag({ path: path.join(dir, 'lib/html2canvas.min.js') });
    await page.addScriptTag({ path: path.join(dir, 'lib/jszip.min.js') });
    await page.addScriptTag({ path: path.join(dir, 'src/logic.js') });
    await page.addStyleTag({ path: path.join(dir, 'src/panel.css') });
    await page.addScriptTag({ path: path.join(dir, 'src/content.js') });
    await page.waitForSelector('#kvr-panel');
  };
  await load();
  await page.evaluate(() => localStorage.setItem('lindbak-own', 'uendret'));

  const idbGet = (store, key) => page.evaluate(([st, k]) => new Promise(res => { const rq = indexedDB.open('kvr-store', 1); rq.onsuccess = () => { const g = rq.result.transaction(st).objectStore(st).get(k); g.onsuccess = () => res(g.result === undefined ? null : g.result); }; }), [store, key]);
  const vis = () => page.$$eval('tbody tr', trs => trs.filter(t => t.style.display !== 'none').map(t => t.getAttribute('data-id')));
  const tiles = () => page.innerText('.kvr-tiles');
  const TABMAP = { 'Søk': ['Hent'], 'Filter': ['Filtrer'], 'Innhold': ['Skann'], 'Rapport': ['Analyse', 'Rapport'], 'Avvik': ['Analyse', 'Detaljer'], 'Kontroll': ['Analyse', 'Detaljer'], 'Fokus': ['Analyse', 'Fokus'], 'Sjekk': ['Analyse', 'Sjekk først'], 'Diagram': ['Analyse', 'Diagram'], 'Eksport': ['Mer'] };
  const tab = async (name) => {
    const m = TABMAP[name];
    await page.click(`.kvr-tab:has-text("${m[0]}")`);
    if (m[1]) await page.click(`.kvr-sub:text-is("${m[1]}")`);
  };
  const grp = async (name) => {
    const box = '[data-sec=groups] .kvr-pills';
    for (const p of await page.$$(box + ' .kvr-pill.kvr-on')) await p.click();
    if (name) await page.click(`${box} .kvr-pill:text-is("${name}")`);
  };
  const wipe = async () => { for (;;) { const c = await page.$('.kvr-fchip'); if (!c) break; await c.click(); } };

  assert.deepStrictEqual(await vis(), ['t-1', 't-2', 't-3', 't-4', 't-5']);
  assert.strictEqual(await page.$$eval('tr.kvr-dup', n => n.length), 2);
  assert.match(await tiles(), /5 \/ 5\s+Viser/);
  assert.strictEqual(await page.$$eval('th.kvr-cb-cell', n => n.length), 1);
  assert.strictEqual(await page.$$eval('tbody td.kvr-cb-cell', n => n.length), 5);
  assert.strictEqual(await page.$$eval('.k-grid-header .kvr-col, #g .kvr-col', n => n.length), 2);
  await page.click('#kvr-select-all');
  assert.match(await tiles(), /5\s+Valgt/);
  await page.click('#kvr-select-all');
  assert.match(await tiles(), /0\s+Valgt/);

  await page.click('text=Negativ sum');
  assert.match(await page.innerText('.kvr-chipsrow'), /Negativ sum/);
  assert.strictEqual(await page.innerText('.kvr-tab.kvr-active .kvr-dot'), '1');
  await page.click('.kvr-fchip');
  assert.deepStrictEqual(await vis(), ['t-1', 't-2', 't-3', 't-4', 't-5']);
  assert.strictEqual(await page.$$eval('.kvr-fchip', n => n.length), 0);
  assert.ok(await page.$eval('.kvr-foot button:has-text("PNG")', b => b.disabled));

  // nullstill alt uten refresh
  await page.click('text=Negativ sum');
  await page.selectOption('.kvr-f:has-text("Sortering") select', 'sumDesc');
  await page.click('button:text-is("Velg alle")');
  await tab('Søk');
  await page.fill('input[placeholder="EAN eller varenavn"]', 'xyz');
  await page.fill('.kvr-f:has-text("Dato fra") input >> nth=0', '2026-10-01');
  const chipTxt = await page.innerText('.kvr-chipsrow');
  for (const re of [/Negativ sum/, /Sortert: sum høyest/, /\d+ valgt/, /CW: .*vare «xyz»/]) assert.match(chipTxt, re);
  await page.click('.kvr-fchip:has-text("valgt")');
  assert.match(await tiles(), /0\s+Valgt/);
  await page.click('button:text-is("Velg alle")');
  await page.click('.kvr-chipsrow .kvr-link:text-is("Nullstill alt")');
  assert.strictEqual(await page.$$eval('.kvr-fchip', n => n.length), 0);
  assert.match(await tiles(), /0\s+Valgt/);
  assert.deepStrictEqual(await page.$$eval('tbody tr', t => t.map(x => x.getAttribute('data-id'))), ['t-1', 't-2', 't-3', 't-4', 't-5']);
  assert.strictEqual(await page.inputValue('input[placeholder="EAN eller varenavn"]'), '');
  assert.ok((await page.evaluate(() => window.__reset)) >= 1, 'CW-filter nullstilt');
  await tab('Filter');

  // piller i stedet for Ctrl-lister
  await page.click('[data-sec=who] .kvr-pill:text-is("6")');
  assert.deepStrictEqual(await vis(), ['t-1']);
  assert.match(await page.innerText('.kvr-chipsrow'), /Kasse: 6/);
  await page.click('[data-sec=who] .kvr-pill:text-is("6")');
  assert.strictEqual((await vis()).length, 5);

  // utvid-knapp
  const wpx = () => page.$eval('#kvr-panel', e => e.getBoundingClientRect().width);
  const w0 = await wpx();
  await page.click('.kvr-icon[title^="Utvid"]');
  assert.ok((await wpx()) > w0 + 200, 'bredt panel');
  await page.click('.kvr-icon[title^="Utvid"]');
  assert.ok(Math.abs((await wpx()) - w0) < 3, 'tilbake til normal bredde');

  // butikknavn fra CW-widgeten
  const opts = await page.$$eval('#kvr-panel .kvr-pill, #kvr-panel .kvr-chk span', o => o.map(x => x.textContent));
  assert.ok(opts.includes('1005 – Coop Mega Kolbotn'), 'butikknavn i lokalt filter');
  assert.ok(opts.includes('1010 – Extra Testby'), 'butikknavn i CW-liste');

  // grid-filtre
  await page.click('text=Negativ sum');
  assert.deepStrictEqual(await vis(), ['t-1']);
  await wipe();
  await page.fill('input[placeholder="medlemsnr"]', 'm1');
  assert.deepStrictEqual(await vis(), ['t-3']);
  await page.fill('input[placeholder="medlemsnr"]', '');
  await page.fill('input[placeholder="bongnr, f.eks. 1005-6-123"]', '1005-6-1');
  assert.deepStrictEqual(await vis(), ['t-1']);
  await page.fill('input[placeholder="bongnr, f.eks. 1005-6-123"]', '');
  await page.selectOption('.kvr-f:has-text("Sortering") select', 'sumDesc');
  assert.deepStrictEqual(await page.$$eval('tbody tr', t => t.map(x => x.getAttribute('data-id'))), ['t-3', 't-4', 't-5', 't-1', 't-2']);
  await page.selectOption('.kvr-f:has-text("Sortering") select', 'none');

  // skanning (DOM)
  await tab('Innhold');
  await page.click('text=Skann innhold (synlige)');
  await page.waitForFunction(() => /Ferdig\. Skannet/.test(document.getElementById('kvr-panel').innerText), null, { timeout: 15000 });
  assert.match(await page.textContent('#kvr-panel'), /Skannet 5/);
  await page.selectOption('.kvr-f:has-text("Pant (krever") select', 'return');
  assert.deepStrictEqual(await vis(), ['t-1']);
  await page.selectOption('.kvr-f:has-text("Pant (krever") select', 'sale');
  assert.deepStrictEqual(await vis(), ['t-3']);
  await wipe();

  // varevarsøk og varegrupper
  await tab('Filter');
  await page.fill('input[placeholder="EAN eller varenavn (skannede)"]', 'banan');
  assert.deepStrictEqual(await vis(), ['t-5']);
  await wipe();
  await tab('Innhold');
  await grp('Tobakk'); assert.deepStrictEqual(await vis(), ['t-3']);
  await grp('Meieri'); assert.deepStrictEqual(await vis(), ['t-4']);
  await grp('Frukt'); assert.deepStrictEqual(await vis(), ['t-5']);
  await grp(''); await wipe();
  // lær opp: REGAL HVETEMEL uten gruppe -> Bakeri
  assert.match(await page.innerText('#kvr-panel'), /REGAL HVETEMEL 1KG/);
  await page.click('.kvr-um button:text-is("Legg til")');
  assert.match(await page.innerText('#kvr-panel'), /REGAL HVETEMEL 1KG/, 'uten valgt gruppe skjer ingenting');
  await page.selectOption('.kvr-um select', 'Bakeri');
  await page.click('.kvr-um button:text-is("Legg til")');
  await grp('Bakeri'); assert.deepStrictEqual(await vis(), ['t-4']);
  await grp(''); await wipe();
  await page.waitForTimeout(300);
  assert.ok((await idbGet('kv', 'kvr.rules.v1')).find(r => r.name === 'Bakeri').include.includes('REGAL HVETEMEL 1KG'));
  await page.click('button:text-is("Velg alle")');
  assert.match(await page.innerText('.kvr-table'), /Tobakk/);

  // avvik (kun på knapp)
  await tab('Avvik');
  assert.strictEqual(await page.$$eval('tr.kvr-flag', n => n.length), 0);
  await page.fill('.kvr-f:has-text("Stor panteretur") input', '200');
  await page.click('text=Kjør avviksjekk');
  await page.waitForFunction(() => /Avviksjekk ferdig/.test(document.getElementById('kvr-panel').innerText));
  assert.match(await page.innerText('[data-sec=anom] .kvr-list'), /Stor panteretur \(256 kr\)/);
  assert.match(await page.innerText('[data-sec=anom] .kvr-list'), /Kontant tilbake uten salg/);
  await page.click('text=Kun avvik');
  assert.deepStrictEqual(await vis(), ['t-1', 't-2']);
  assert.match(await page.innerText('[data-sec=anom] .kvr-list'), /Kassadifferanse \(\+1000 kr\)/);
  await wipe();

  // CW-søk
  await tab('Søk');
  await page.fill('input[placeholder="EAN eller varenavn"]', 'ban');
  await page.fill('input[placeholder="bongnr"]', '1005-4-3');
  await page.click('.kvr-chk:has-text("1005 –") input');
  await page.fill('.kvr-f:has-text("Dato fra") input >> nth=0', '2026-10-01');
  await page.click('button:text-is("Søk i CW")');
  await page.waitForFunction(() => window.__applied === 1);
  assert.strictEqual(await page.inputValue('#freetextSearchInput'), 'ban');
  assert.strictEqual(await page.inputValue('#receiptNumber'), '1005-4-3');
  assert.strictEqual(await page.inputValue('#fromDatePicker'), '01.10.2026');
  assert.deepStrictEqual(await page.evaluate(() => window.__storesSet), [1005]);

  // rask skanning via API
  await tab('Innhold');
  await page.click('text=Tøm cache');
  await page.click('text=Rask skanning');
  // skanne-fella: filter som krever skanning før noe er skannet skjuler alt, men viser hva som mangler
  await page.selectOption('.kvr-f:has-text("Pant (krever") select', 'sale');
  assert.deepStrictEqual(await vis(), []);
  assert.match(await page.innerText('.kvr-scanwarn'), /5 kvitteringer er ikke skannet/);
  assert.match(await page.innerText('.kvr-scanrow'), /Skannet 0 av 5/);
  await page.click('.kvr-scanwarn button:text-is("Skann nå")');
  await page.waitForFunction(() => /Ferdig\. Skannet 5/.test(document.getElementById('kvr-panel').innerText), null, { timeout: 15000 });
  assert.deepStrictEqual(await vis(), ['t-3']);
  assert.ok(await page.$eval('.kvr-scanwarn', n => n.style.display === 'none'));
  assert.match(await page.innerText('.kvr-scanrow'), /Skannet 5 av 5/);
  await wipe();

  // egne regler, rapport og kassaoppgjør
  await tab('Avvik');
  await page.click('button:text-is("Ny regel")');
  await page.fill('.kvr-cond input[type=text]', '-200');
  await page.press('.kvr-cond input[type=text]', 'Tab');
  await page.click('text=Kjør avviksjekk');
  await page.waitForFunction(() => /Regel: Ny regel/.test(document.querySelector('[data-sec=anom] .kvr-list').innerText));
  await wipe();
  await tab('Rapport');
  assert.ok(await page.$('[data-sec=report] th[title^="Pantesalg"]'), 'kolonneforklaring');
  const repTxt = await page.innerText('[data-sec=report] .kvr-table');
  assert.match(repTxt, /Totalt/); assert.match(repTxt, /Kasse 6/); assert.match(repTxt, /Kasse 4/);
  await page.selectOption('[data-sec=report] select', 'kasserer');
  assert.match(await page.innerText('[data-sec=report] .kvr-table'), /Kasserer 10/);
  const [rd] = await Promise.all([page.waitForEvent('download'), page.click('button:text-is("Eksporter rapport (CSV)")')]);
  const repCsv = fs.readFileSync(await rd.path(), 'utf8');
  assert.ok(repCsv.startsWith('\ufeffDag;Gruppe;Antall salg;Sum;'));
  assert.ok(repCsv.includes('Kasserer 10'));
  const settleTxt = await page.innerText('[data-sec=settle]');
  assert.match(settleTxt, /Differanse \+1[\s\u00a0]000,00/);
  assert.match(settleTxt, /Pose 512324789405/);

  // kontroller på tvers av bonger
  await tab('Kontroll');
  assert.ok(await page.isHidden('[data-sec=profile]'), 'resultat skjules før kontrollene er kjørt');
  await page.click('button:text-is("Kjør alle kontroller (synlige)")');
  await page.waitForFunction(() => /Kontroller ferdig/.test(document.getElementById('kvr-panel').innerText), null, { timeout: 30000 });
  assert.match(await page.innerText('[data-sec=profile]'), /Butikksnitt/);
  assert.match(await page.innerText('[data-sec=findings]'), /Bonger utenfor åpningstid/);
  assert.match(await page.innerText('[data-sec=recon]'), /Forventet/);
  assert.match(await page.innerText('[data-sec=ctlsum]'), /\d+ funn · \d+ flaggede bonger/);
  await page.click('[data-sec=ctlsum] button:text-is("Avstemming")');
  assert.match(await page.innerText('[data-sec=pantbal]'), /2026-10-02/);
  await wipe();

  // notater, tastaturflyt og sammenligning
  await page.click('button:text-is("Fjern valg")');
  const sel = () => page.evaluate(() => { const s = grid.select()[0]; return s ? s.getAttribute('data-id') : null; });
  await page.evaluate(() => grid.select(document.querySelector('tr[data-id="t-3"]')));
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('n');
  await page.waitForSelector('.kvr-modal textarea');
  await page.selectOption('.kvr-modal select', 'oppfolging');
  await page.fill('.kvr-modal textarea', 'Sjekk kvittering mot kasse');
  await page.click('.kvr-modal button:text-is("Lagre")');
  assert.strictEqual(await page.$$eval('.kvr-modal', n => n.length), 0);
  assert.ok(await page.$eval('tr[data-id="t-3"]', t => t.classList.contains('kvr-follow')));
  assert.match(await page.innerText('[data-sec=notes]'), /Til oppfølging: Sjekk kvittering mot kasse/);
  await tab('Filter');
  await page.selectOption('.kvr-f:has-text("Notat/status") select', 'oppfolging');
  assert.deepStrictEqual(await vis(), ['t-3']);
  await wipe();
  await page.keyboard.press('ArrowDown');
  assert.strictEqual(await sel(), 't-4');
  await page.keyboard.press('ArrowUp');
  assert.strictEqual(await sel(), 't-3');
  await page.keyboard.press('m');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('m');
  assert.match(await tiles(), /2\s+Valgt/);
  await page.click('.kvr-foot button:text-is("Sammenlign")');
  await page.waitForSelector('.kvr-modal .kvr-cmp');
  assert.match(await page.innerText('.kvr-modal'), /0 like linjer · 3 bare i venstre · 2 bare i høyre/);
  await page.keyboard.press('Escape');
  assert.strictEqual(await page.$$eval('.kvr-modal', n => n.length), 0);
  await page.click('button:text-is("Fjern valg")');
  assert.ok(await page.$eval('.kvr-foot button:text-is("Sammenlign")', b => b.style.display === 'none'));

  // arbeidsoppgave: Morgenkontroll
  await tab('Kontroll');
  const y = new Date(Date.now() - 864e5);
  const yd = String(y.getDate()).padStart(2, '0') + '.' + String(y.getMonth() + 1).padStart(2, '0') + '.' + y.getFullYear();
  await page.click('[data-sec=tasks] button:text-is("Kjør")');
  await page.waitForSelector('.kvr-modal .kvr-sum', { timeout: 40000 });
  assert.strictEqual(await page.inputValue('#fromDatePicker'), yd);
  const sumTxt = await page.innerText('.kvr-modal');
  assert.match(sumTxt, /Oversikt/); assert.match(sumTxt, /Avvik \(\d+ bonger\)/); assert.match(sumTxt, /Dagsavstemming/);
  await page.keyboard.press('Escape');
  await tab('Kontroll');
  await page.fill('[data-sec=tasks] input[placeholder^="navn"]', 'Mandagens kontroll');
  await page.selectOption('[data-sec=tasks] select >> nth=1', 'lastweek');
  await page.click('button:text-is("Lagre som oppgave")');
  assert.ok((await page.$$eval('[data-sec=tasks] select option', o => o.map(x => x.textContent))).includes('Mandagens kontroll'));
  await wipe();

  // Sjekk først: prioritert liste, forklaring og handlinger i raden
  await tab('Sjekk');
  await page.click('[data-sec=chk-top] button:text-is("Kjør analyse (synlige)")');
  await page.waitForSelector('[data-sec=chk-list] .kvr-ck', { timeout: 30000 });
  const scores = await page.$$eval('[data-sec=chk-list] .kvr-ck .kvr-risk', n => n.map(x => parseFloat(x.textContent.split(' ').pop())));
  assert.ok(scores.length >= 3, 'flere flaggede bonger');
  assert.deepStrictEqual(scores, scores.slice().sort((a, b) => b - a), 'sortert etter risiko');
  assert.match(await page.innerText('[data-sec=chk-list] .kvr-ck'), /Hvorfor flagget\?/);
  assert.match(await page.innerText('[data-sec=chk-list] .kvr-ck'), /Bonglinjer/);
  assert.match(await page.innerText('[data-sec=chk-top]'), /\d+ å sjekke · \d+ høy risiko/);
  assert.match(await page.innerText('[data-sec=chk-cash]'), /Kasserer/i);
  const n0 = scores.length;
  await page.click('[data-sec=chk-list] .kvr-ck:first-child button:text-is("Sjekket")');
  assert.strictEqual(await page.$$eval('[data-sec=chk-list] .kvr-ck', n => n.length), n0 - 1, 'sjekket forsvinner fra listen');
  await page.click('[data-sec=chk-list] label:has-text("Vis sjekkede")');
  assert.strictEqual(await page.$$eval('[data-sec=chk-list] .kvr-ck', n => n.length), n0);
  assert.ok(await page.$('[data-sec=chk-list] .kvr-st:text-is("Sjekket")'));
  await page.click('[data-sec=chk-list] label:has-text("Vis sjekkede")');
  // ny siden sist: en ny regel flagger t-5 (50 kr) som ikke var flagget i forrige analyse
  await tab('Avvik');
  await page.click('[data-sec=custom] button:text-is("Ny regel")');
  const lastRule = page.locator('[data-sec=custom] .kvr-rule').last();
  await lastRule.locator('.kvr-cond select').nth(1).selectOption('=');
  await lastRule.locator('.kvr-cond input[type=text]').fill('50');
  await lastRule.locator('.kvr-cond input[type=text]').press('Tab');
  await tab('Sjekk');
  await page.click('[data-sec=chk-top] button:text-is("Kjør analyse (synlige)")');
  await page.waitForFunction(() => document.querySelector('[data-sec=chk-list] .kvr-new'), null, { timeout: 30000 });
  const newRow = await page.innerText('[data-sec=chk-list] .kvr-ck:has(.kvr-new)');
  assert.match(newRow, /10-01 14:00/); assert.match(newRow, /Regel: Ny regel 2/);
  assert.strictEqual(await page.$$eval('[data-sec=chk-list] .kvr-new', n => n.length), 1);
  await page.click('[data-sec=chk-list] .kvr-ck:has(.kvr-new) .kvr-ck-h');
  assert.match(await page.innerText('[data-sec=chk-list] .kvr-ck:has(.kvr-new)'), /Treffer din regel «Ny regel 2»: Sum \(kr\) = 50/);
  await page.click('[data-sec=chk-list] .kvr-ck:has(.kvr-new) button:text-is("Til oppfølging")');
  assert.match(await page.innerText('[data-sec=chk-list] .kvr-ck:has(.kvr-new)'), /Til oppfølging/);
  await page.click('button:text-is("Fjern valg")');
  await wipe();

  // diagrammer: klikk filtrerer, tooltip og tabellvisning
  await tab('Diagram');
  assert.strictEqual(await page.$$eval('[data-sec=ch-hours] .kvr-hit', n => n.length), 24);
  await page.hover('[data-sec=ch-hours] .kvr-hit >> nth=0');
  assert.match(await page.innerText('.kvr-tip'), /00:00–00:59 · 3 salg/);
  await page.click('[data-sec=ch-hours] .kvr-hit >> nth=0');
  assert.match(await page.innerText('.kvr-chipsrow'), /Tid 00:00 → 00:59/);
  assert.deepStrictEqual(await vis(), ['t-1', 't-2', 't-3', 't-4']);
  assert.strictEqual(await page.$$eval('[data-sec=ch-hours] .kvr-hit', n => n.length), 24, 'diagrammet krymper ikke når du klikker i det');
  await wipe();
  assert.ok(await page.$('[data-sec=ch-days]'), 'dagsdiagram med flere dager');
  await page.click('[data-sec=ch-days] .kvr-hit >> nth=0');
  assert.match(await page.innerText('.kvr-chipsrow'), /Dato 2026-10-01 → 2026-10-01/);
  assert.deepStrictEqual(await vis(), ['t-5']);
  await wipe();
  assert.ok((await page.$$eval('[data-sec=ch-cash] .kvr-hb', n => n.length)) >= 2);
  assert.match(await page.innerText('[data-sec=ch-cash]'), /Kasserer 10 \(/);
  assert.strictEqual(await page.$$eval('[data-sec=ch-heat] .kvr-hc', n => n.length), 3 * 24);
  await page.click('[data-sec=ch-heat] .kvr-ent:text-is("Kasse 6") ~ .kvr-hc >> nth=0');
  assert.deepStrictEqual(await vis(), ['t-1']);
  assert.match(await page.innerText('.kvr-chipsrow'), /Kasse: 6/);
  await wipe();
  assert.match(await page.innerText('[data-sec=ch-pant]'), /Pantesalg/);
  await page.click('[data-sec=ch-hours] button:text-is("Tabell")');
  assert.ok(await page.$eval('[data-sec=ch-hours] .kvr-svg', n => n.style.display === 'none'));
  assert.strictEqual(await page.$$eval('[data-sec=ch-hours] .kvr-table tr', n => n.length), 25);
  await page.click('[data-sec=ch-hours] button:text-is("Diagram")');

  // fokus: alt om én kasserer eller kasse
  await tab('Filter');
  await page.click('[data-sec=who] .kvr-pill:text-is("12")');
  await tab('Fokus');
  const fk = await page.innerText('.kvr-pane:has([data-sec=f-top])');
  assert.match(fk, /kasserer 12/i); assert.match(fk, /593,60/); assert.match(fk, /Kasse 4 \(2\)/);
  assert.match(fk, /mot butikksnitt/i); assert.match(fk, /aktivitet per time/i);
  assert.strictEqual(await page.$$eval('.kvr-hcol', n => n.length), 24);
  assert.deepStrictEqual(await vis(), ['t-3', 't-4']);
  await page.click('[data-sec=f-with] .kvr-ent:has-text("Kasse 4")');
  assert.match(await page.innerText('[data-sec=f-top] h4'), /kasse 4/i);
  assert.match(await page.innerText('.kvr-chipsrow'), /Kasse: 4/);
  assert.doesNotMatch(await page.innerText('.kvr-chipsrow'), /Kasserer:/);
  assert.match(await page.innerText('[data-sec=f-with]'), /Kasserer 12 \(2\)/);
  await wipe();
  await tab('Rapport');
  await page.selectOption('[data-sec=report] select', 'kasse');
  await page.click('[data-sec=report] .kvr-ent:text-is("Kasse 6")');
  assert.match(await page.innerText('[data-sec=f-top] h4'), /kasse 6/i);
  assert.deepStrictEqual(await vis(), ['t-1']);
  await wipe();
  assert.match(await page.getAttribute('tr[data-id="t-5"] td[data-field="cashierNumber"]', 'title'), /Alt\+klikk: se alt om kasserer 10/);
  await page.click('tr[data-id="t-5"] td[data-field="cashierNumber"]', { modifiers: ['Alt'] });
  assert.match(await page.innerText('[data-sec=f-top] h4'), /kasserer 10/i);
  assert.deepStrictEqual(await vis(), ['t-1', 't-5']);
  assert.strictEqual(await sel() === null || (await sel()) !== 't-5', true, 'Alt+klikk velger ikke raden');
  await page.click('button:text-is("Fjern fokus")');
  assert.strictEqual(await page.$$eval('.kvr-fchip', n => n.length), 0);
  assert.match(await page.innerText('.kvr-pane:has(.kvr-card h4:text-is("Fokus"))'), /Klikk på en kasserer eller kasse/);
  await wipe();

  // CSV
  await page.click('button:text-is("Velg alle")');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.kvr-foot button:has-text("CSV")')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  assert.ok(csv.startsWith('﻿Tid;Butikk;Kasse;Kasserer;Bongnr;Type;Sum;Medlem;Pant salg;Pant retur;Varegrupper;Avvik'));
  assert.ok(csv.includes('1005 – Coop Mega Kolbotn') && csv.includes('Tobakk'));
  assert.strictEqual(csv.trim().split('\r\n').length, 6);

  // lagring av filter
  await tab('Filter');
  await page.fill('input[placeholder="navn på filter"]', 'test');
  await page.click('button:text-is("Lagre")');
  await page.waitForTimeout(300);
  assert.ok(!!(await idbGet('kv', 'kvr.saved.v1')).test);

  // PNG-eksport (rask modus er på: t-5 feiler med vilje)
  failIds.add('t-5');
  await page.click('button:text-is("Velg alle")');
  const [pd] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('.kvr-foot button:has-text("PNG")')]);
  const zipBuf = fs.readFileSync(await pd.path());
  assert.strictEqual(zipBuf.slice(0, 2).toString(), 'PK');
  assert.ok(zipBuf.includes(Buffer.from('\x89PNG', 'latin1')), 'PNG-data i zip');
  assert.strictEqual((zipBuf.toString('latin1').match(/\.png/g) || []).length >= 4, true);
  const pngW = buf => { const i = buf.indexOf(Buffer.from('\x89PNG', 'latin1')); return { w: buf.readUInt32BE(i + 16), h: buf.readUInt32BE(i + 20), i }; };
  const dim1 = pngW(zipBuf);
  assert.strictEqual(dim1.w, 450 * 3, 'bong-bredde');
  if (process.env.PNGOUT) fs.writeFileSync(process.env.PNGOUT, zipBuf.slice(dim1.i, zipBuf.indexOf(Buffer.from('IEND', 'latin1'), dim1.i) + 8));
  await page.waitForFunction(() => /Ferdig\. 4 PNG, feilet 1/.test(document.getElementById('kvr-panel').innerText));
  assert.match(await page.textContent('button:has-text("Prøv feilede på nytt (1)") >> nth=0'), /\(1\)/);

  // A4-format
  await tab('Eksport');
  await page.selectOption('.kvr-f:has-text("PNG-format") select', 'a4');
  const [pd2] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('.kvr-foot button:has-text("PNG")')]);
  const dimA4 = pngW(fs.readFileSync(await pd2.path()));
  assert.strictEqual(dimA4.w, 794 * 2, 'a4-bredde');
  assert.ok(dimA4.h >= 1123 * 2, 'a4-høyde');
  await page.waitForFunction(() => /Ferdig\. 4 PNG/.test(document.getElementById('kvr-panel').innerText));

  // lagring: kun IndexedDB, aldri localStorage; overlever omlasting
  await load();
  assert.deepStrictEqual(await page.evaluate(() => Object.keys(localStorage).filter(k => k.indexOf('kvr') === 0)), []);
  assert.strictEqual(await page.evaluate(() => localStorage.getItem('lindbak-own')), 'uendret');
  await tab('Filter');
  assert.ok((await page.$$eval('#kvr-panel select option', o => o.map(x => x.textContent))).includes('test'), 'lagret filter overlever omlasting');
  await tab('Innhold');
  await page.click('text=Skann innhold (synlige)');
  assert.match(await page.textContent('#kvr-panel'), /Ingenting å skanne/);

  // flytting, skjuling og tastatursnarvei
  const box = async () => page.$eval('#kvr-panel', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
  const b0 = await box();
  const h = await page.$eval('.kvr-head', e => { const r = e.getBoundingClientRect(); return { x: r.x + 40, y: r.y + 12 }; });
  await page.mouse.move(h.x, h.y); await page.mouse.down(); await page.mouse.move(h.x - 300, h.y + 120, { steps: 5 }); await page.mouse.up();
  const b1 = await box();
  assert.ok(Math.abs((b0.x - b1.x) - 300) < 3 && Math.abs((b1.y - b0.y) - 120) < 3, 'panel flyttet');
  await page.keyboard.press('Alt+k');
  assert.ok(await page.$eval('#kvr-panel', e => e.classList.contains('kvr-collapsed')));
  await page.click('.kvr-head');
  assert.ok(await page.$eval('#kvr-panel', e => !e.classList.contains('kvr-collapsed')));
  await page.setViewportSize({ width: 500, height: 400 });
  await page.waitForTimeout(200);
  const b2 = await box();
  assert.ok(b2.x >= 0 && b2.x + b2.w <= 500 && b2.y < 400, 'panel innenfor etter resize');

  if (process.env.SHOT) {
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.evaluate(() => localStorage.removeItem('kvr.pos.v1'));
    await page.reload();
    await page.addScriptTag({ path: path.join(dir, 'src/logic.js') });
    await page.addStyleTag({ path: path.join(dir, 'src/panel.css') });
    await page.addScriptTag({ path: path.join(dir, 'src/content.js') });
    await page.waitForSelector('#kvr-panel');
    await page.setViewportSize({ width: 1100, height: 1900 });
    await page.evaluate(() => { const p = document.getElementById('kvr-panel'); p.style.top = '10px'; });
    await tab('Sjekk');
    await page.click('[data-sec=chk-top] button:text-is("Kjør analyse (synlige)")');
    await page.waitForSelector('[data-sec=chk-list] .kvr-ck', { timeout: 30000 });
    await (await page.$('#kvr-panel')).screenshot({ path: process.env.SHOT.replace('.png', '-sjekk.png') });
    await tab('Diagram');
    await page.waitForTimeout(200);
    await (await page.$('#kvr-panel')).screenshot({ path: process.env.SHOT.replace('.png', '-diagram.png') });
    await page.click('.kvr-icon[title^="Utvid"]');
    await page.waitForTimeout(300);
    await (await page.$('#kvr-panel')).screenshot({ path: process.env.SHOT.replace('.png', '-diagram-bred.png') });
  }

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('smoke: ok');
})().catch(e => { console.error(e); process.exit(1); });
