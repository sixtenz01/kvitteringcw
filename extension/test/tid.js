const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

// Klokkeslett: listen (rådata) og bongen kan avvike. Pluginen skal vise lokal tid som på bongen.
const LOCAL = [
  { id: '1005-1-1', store: 1005, ws: 1, cashier: 'A', t: '22:04', member: 'M1' },
  { id: '1010-1-1', store: 1010, ws: 1, cashier: 'B', t: '22:20', member: 'M1' },
  { id: '1005-1-2', store: 1005, ws: 1, cashier: 'A', t: '22:30', member: null },
  { id: '1005-1-3', store: 1005, ws: 1, cashier: 'A', t: '22:40', member: null },
  { id: '1005-1-4', store: 1005, ws: 1, cashier: 'A', t: '22:50', member: null },
  { id: '1005-1-5', store: 1005, ws: 1, cashier: 'A', t: '23:00', member: null }
];
const hm = (t, plus) => { const [h, m] = t.split(':').map(Number); const x = h * 60 + m + plus; return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); };

function pageFor(mode) {
  const rows = LOCAL.map((r, i) => {
    const utc = hm(r.t, -120);
    const raw = mode === 'shift' ? `2026-10-02 ${utc}` : `2026-10-02T${utc}:00Z`;
    return { transactionId: r.id, endDateTime: raw, storeNumber: r.store, workstationNumber: r.ws, cashierNumber: r.cashier, totalAmount: 100 + i, receiptType: 1, memberNumber: r.member, journalSourceName: 'main' };
  });
  const cellText = (r, i) => mode === 'cell' ? `02.10.2026 ${LOCAL[i].t}:00` : mode === 'shift' ? `02.10.2026 ${hm(LOCAL[i].t, -120)}:00` : '';
  const receipts = {};
  LOCAL.forEach((r) => { receipts[r.id] = `<div>Kvittering: 7 02.10.2026 ${r.t}:10</div><table><tr><td>7000000000001 VARE</td><td></td><td>10.00</td></tr><tr><td>Bank:</td><td></td><td>10.00</td></tr></table>`; });
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<input id="fromDatePicker"><input id="toDatePicker"><input id="freetextSearchInput"><input id="receiptNumber">
<input ng-model="vm.selectedFilters.memberNumber"><input ng-model="vm.selectedFilters.externalLoyaltyNumber">
<button ng-click="vm.resetFilters()">Nullstill</button><button ng-click="vm.applyFilters()">Oppdater</button>
<div class="k-grid-header"><table><colgroup><col><col><col></colgroup><thead><tr><th>DATO</th><th>SUM</th><th>KASSERER</th></tr></thead></table></div>
<table id="g" data-role="grid"><colgroup><col><col><col></colgroup><tbody>
${rows.map((r, i) => `<tr data-uid="u${i}" data-id="${r.transactionId}"><td></td>${mode === 'rawz' ? '' : `<td data-field="endDateTime">${cellText(r, i)}</td>`}<td>${r.totalAmount}</td></tr>`).join('')}
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
var ms={dataSource:{data:function(){return [{get:function(k){return {number:1005,text:'Coop Mega Kolbotn'}[k]}},{get:function(k){return {number:1010,text:'Extra Testby'}[k]}}]}},value:function(v){},trigger:function(){}};
function mk(list){return {each:function(fn){list.forEach(function(e,i){fn.call(e,i,e)})},eq:function(i){return mk([list[i]])},data:function(n){var e=list[0];if(!e)return undefined;if(e.getAttribute('data-w'))return n==='kendoMultiSelect'?ms:null;return n==='kendoGrid'?grid:null}}}
window.jQuery=function(a){ if(typeof a==='string') return a.indexOf('#storesWrapper')===0?mk([].slice.call(document.querySelectorAll('[data-w]'))):mk([]); return mk([a]); };
</script></body></html>`;
}

(async () => {
  const dir = path.join(__dirname, '..');
  const browser = await chromium.launch();
  const errors = [];
  const run = async (mode, body) => {
    const page = await (await browser.newContext({ locale: 'nb-NO', timezoneId: 'America/New_York' })).newPage();
    page.on('pageerror', e => { errors.push(e.message); console.error('PAGEERROR', e.message); });
    await page.addInitScript(() => { window.__kvrScan = { settle: 0, poll: 10 }; });
    await page.route('https://chainweb.coop.no/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: pageFor(mode) }));
    await page.goto('https://chainweb.coop.no/LindbakRetail_1/Journal/Viewer');
    for (const f of ['lib/html2canvas.min.js', 'lib/jszip.min.js', 'src/logic.js', 'src/report.js']) await page.addScriptTag({ path: path.join(dir, f) });
    await page.addStyleTag({ path: path.join(dir, 'src/panel.css') });
    await page.addScriptTag({ path: path.join(dir, 'src/content.js') });
    await page.waitForSelector('#kvr-panel');
    const go = async (main, sub) => { await page.click(`.kvr-tab:has-text("${main}")`); if (sub) await page.click(`.kvr-sub:text-is("${sub}")`); };
    const analyse = async () => {
      await go('Analyse', 'Sjekk først');
      await page.click('[data-sec=chk-top] button:text-is("Kjør analyse")');
      await page.waitForFunction(() => /Kontroller ferdig/.test(document.getElementById('kvr-panel').innerText), null, { timeout: 60000 });
      await go('Analyse', 'Detaljer');
      await page.click('button:text-is("Åpne alle")');
      return (await page.innerText('[data-sec=findings]')).replace(/\s+/g, ' ');
    };
    await body({ page, go, analyse });
    await page.context().close();
  };

  // 1. listen viser lokal tid i cellen, rådata er UTC med Z (nettleseren står i en annen tidssone)
  await run('cell', async ({ analyse }) => {
    assert.match(await analyse(), /Medlemsnr M1: butikk 1005 2026-10-02 22:04 og butikk 1010 22:20/);
  });
  // 2. ingen celle i listen: rådata med Z flyttes til norsk tid
  await run('rawz', async ({ analyse }) => {
    assert.match(await analyse(), /Medlemsnr M1: butikk 1005 2026-10-02 22:04 og butikk 1010 22:20/);
  });
  // 3. listen og rådata mangler tidssone og ligger to timer bak bongen: Diagnostikk foreslår forskyvning
  await run('shift', async ({ page, go, analyse }) => {
    assert.match(await analyse(), /Medlemsnr M1: butikk 1005 2026-10-02 20:04 og butikk 1010 20:20/);
    await page.click('[data-sec=misc] button:text-is("Diagnostikk: ukjente linjer…")');
    const d = (await page.innerText('.kvr-dlg')).replace(/\s+/g, ' ');
    assert.match(d, /6 bonger sammenlignet: 0 har samme klokkeslett i listen og på bongen/);
    assert.match(d, /Typisk avvik \(bong minus liste\): 120 min/);
    assert.match(d, /Listen ligger konsekvent 120 min bak bongen/);
    await page.click('.kvr-dlg button:text-is("Flytt listetid +120 min")');
    assert.match(await analyse(), /Medlemsnr M1: butikk 1005 2026-10-02 22:04 og butikk 1010 22:20/);
    await go('Mer', 'Innstillinger');
    assert.strictEqual(await page.inputValue('input[aria-label="Tidsforskyvning for listen (min)"]'), '120');
    await page.click('#kvr-panel button:text-is("Diagnostikk…")');
    assert.match((await page.innerText('.kvr-dlg')).replace(/\s+/g, ' '), /6 bonger sammenlignet: 6 har samme klokkeslett/);
  });

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('tid: ok');
})().catch(e => { console.error(e); process.exit(1); });
