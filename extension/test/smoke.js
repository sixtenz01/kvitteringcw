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
  't-1': '<table>' + tr('RETUR VARE', '', '') .replace('<td></td><td></td>', '') + tr('399 PANTELAPP', '', '-150.00') + tr('399 PANTELAPP', '', '-106.00') + '<tr><td>Kontant tilbake:</td><td></td><td>256.00</td></tr></table>',
  't-3': '<table>' + tr('7044610877488 PEPSI MAX 0.5L', '', '32.90') + tr('220 PANT', '', '2.00') + tr('7330196001042 SKRUF NO4 FRESH S4', '', '101.90') + '</table>',
  't-4': '<table>' + tr('7038010002274 BIOLA JORDBÆR 1000G', '', '39.90') + tr('7044416015367 REGAL HVETEMEL 1KG', '', '20.50') + '</table>',
  't-5': '<table>' + tr('7000000000001 BANAN KG', '', '15.00') + '</table>'
};

const html = `<!doctype html><html><body>
<input id="fromDatePicker"><input id="toDatePicker"><input id="freetextSearchInput"><input id="receiptNumber">
<input ng-model="vm.selectedFilters.memberNumber"><input ng-model="vm.selectedFilters.externalLoyaltyNumber">
<button ng-click="vm.applyFilters()" onclick="window.__applied=(window.__applied||0)+1">Oppdater</button>
<div class="k-grid-header"><table><colgroup><col><col><col></colgroup><thead><tr><th>DATO</th><th>TID</th><th>SUM</th></tr></thead></table></div>
<table id="g" data-role="grid"><colgroup><col><col><col></colgroup><tbody>
${rows.map(r => `<tr data-id="${r.transactionId}"><td></td><td>${r.endDateTime}</td><td>${r.totalAmount}</td></tr>`).join('')}
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
 bind:function(){},
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
  await page.route('https://chainweb.coop.no/**', async r => {
    const u = r.request().url();
    if (u.endsWith('/Api/GetReceiptDetails')) {
      const body = JSON.parse(r.request().postData());
      const id = 't-' + body.sequenceNum;
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
  const tab = (name) => page.click(`.kvr-tab:has-text("${name}")`);
  const grp = (name) => page.selectOption('.kvr-f:has-text("Filter: varegruppe") select', name ? name.split(',') : []);
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

  // butikknavn fra CW-widgeten
  const opts = await page.$$eval('#kvr-panel option', o => o.map(x => x.textContent));
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
  assert.match(await page.textContent('#kvr-panel'), /Skannet 4/);
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
  assert.match(await page.innerText('.kvr-list'), /Stor panteretur \(256 kr\)/);
  assert.match(await page.innerText('.kvr-list'), /Kontant tilbake uten salg/);
  await page.click('text=Kun avvik');
  assert.deepStrictEqual(await vis(), ['t-1']);
  await wipe();

  // CW-søk
  await tab('Søk');
  await page.fill('input[placeholder="EAN eller varenavn"]', 'ban');
  await page.fill('input[placeholder="bongnr"]', '1005-4-3');
  await page.selectOption('#kvr-panel select[multiple][size="6"]', '1005');
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
  await page.click('text=Rask skanning via CW-API');
  await page.click('text=Skann innhold (synlige)');
  await page.waitForFunction(() => /Ferdig\. Skannet/.test(document.getElementById('kvr-panel').innerText), null, { timeout: 15000 });
  assert.match(await page.textContent('#kvr-panel'), /Skannet 4/);
  await page.selectOption('.kvr-f:has-text("Pant (krever") select', 'sale');
  assert.deepStrictEqual(await vis(), ['t-3']);
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

  // PNG-eksport (rask modus er på: t-2 har ingen kvittering og skal feile)
  await page.click('button:text-is("Velg alle")');
  const [pd] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('.kvr-foot button:has-text("PNG")')]);
  const zipBuf = fs.readFileSync(await pd.path());
  assert.strictEqual(zipBuf.slice(0, 2).toString(), 'PK');
  assert.ok(zipBuf.includes(Buffer.from('\x89PNG', 'latin1')), 'PNG-data i zip');
  assert.strictEqual((zipBuf.toString('latin1').match(/\.png/g) || []).length >= 4, true);
  await page.waitForFunction(() => /Ferdig\. 4 PNG, feilet 1/.test(document.getElementById('kvr-panel').innerText));
  assert.match(await page.textContent('button:has-text("Prøv feilede på nytt (1)") >> nth=0'), /\(1\)/);

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
    await page.click('.kvr-tab:has-text("Filter")');
    await page.click('text=Negativ sum');
    await page.fill('input[placeholder="medlemsnr"]', 'M1');
    await page.screenshot({ path: process.env.SHOT });
    await page.click('.kvr-tab:has-text("Innhold")');
    await page.screenshot({ path: process.env.SHOT.replace('.png', '-b.png') });
  }

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('smoke: ok');
})().catch(e => { console.error(e); process.exit(1); });
