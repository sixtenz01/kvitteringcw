const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

// Skanning: feil bong i visningsfeltet skal ikke knyttes til valgt rad, og bevisstørrelse skal ha grenser.
const N = 8;
const ids = Array.from({ length: N }, (_, i) => `1005-1-${i + 1}`);

function pageFor(headerMode, swap) {
  const rows = ids.map((id, i) => ({ transactionId: id, endDateTime: `2026-10-02 10:${String(10 + i)}`, storeNumber: 1005, workstationNumber: 1, cashierNumber: 'A', totalAmount: 10 + i, receiptType: 1, memberNumber: null, journalSourceName: 'main' }));
  const receipts = {};
  ids.forEach((id, i) => {
    const seq = i + 1;
    const head = headerMode === 'same' ? `Kvittering: ${seq} 02.10.2026 10:${10 + i}:00` : `Kvittering: ${9000 + seq} 02.10.2026 10:${10 + i}:00`;
    receipts[id] = `<div>${head}</div><table><tr><td>70000000000${seq} VARE ${seq}</td><td></td><td>10.00</td></tr><tr><td>Bank:</td><td></td><td>10.00</td></tr></table>`;
  });
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<input id="fromDatePicker"><input id="toDatePicker"><input id="freetextSearchInput"><input id="receiptNumber">
<input ng-model="vm.selectedFilters.memberNumber"><input ng-model="vm.selectedFilters.externalLoyaltyNumber">
<button ng-click="vm.resetFilters()">Nullstill</button><button ng-click="vm.applyFilters()">Oppdater</button>
<div class="k-grid-header"><table><colgroup><col><col><col></colgroup><thead><tr><th>DATO</th><th>SUM</th><th>KASSERER</th></tr></thead></table></div>
<table id="g" data-role="grid"><colgroup><col><col><col></colgroup><tbody>
${rows.map((r, i) => `<tr data-uid="u${i}" data-id="${r.transactionId}"><td></td><td>${r.endDateTime}</td><td>${r.totalAmount}</td></tr>`).join('')}
</tbody></table>
<div data-w="1"></div><iframe id="rc"></iframe>
<script>
var rows=${JSON.stringify(rows)};var receipts=${JSON.stringify(receipts)};var swap=${JSON.stringify(swap)};
var items=rows.map(function(r,i){var o=Object.assign({uid:'u'+i},r);o.toJSON=function(){var c=Object.assign({},o);delete c.toJSON;return c};return o});
var cur=null;
var grid={tbody:[document.querySelector('tbody')],dataSource:{view:function(){return items}},
 dataItem:function(tr){return items.filter(function(i){return i.transactionId===tr.getAttribute('data-id')})[0]},
 bind:function(n,f){},
 select:function(tr){if(!arguments.length)return cur?[cur]:[];cur=tr;var id=tr.getAttribute('data-id');setTimeout(function(){document.getElementById('rc').contentDocument.body.innerHTML=receipts[swap[id]||id];},5);},clearSelection:function(){cur=null}};
var ms={dataSource:{data:function(){return [{get:function(k){return {number:1005,text:'Coop Mega Kolbotn'}[k]}}]}},value:function(v){},trigger:function(){}};
function mk(list){return {each:function(fn){list.forEach(function(e,i){fn.call(e,i,e)})},eq:function(i){return mk([list[i]])},data:function(n){var e=list[0];if(!e)return undefined;if(e.getAttribute('data-w'))return n==='kendoMultiSelect'?ms:null;return n==='kendoGrid'?grid:null}}}
window.jQuery=function(a){ if(typeof a==='string') return a.indexOf('#storesWrapper')===0?mk([].slice.call(document.querySelectorAll('[data-w]'))):mk([]); return mk([a]); };
</script></body></html>`;
}

(async () => {
  const dir = path.join(__dirname, '..');
  const browser = await chromium.launch();
  const errors = [];
  const run = async (headerMode, swap, body) => {
    const page = await (await browser.newContext({ locale: 'nb-NO' })).newPage();
    page.on('pageerror', e => { errors.push(e.message); console.error('PAGEERROR', e.message); });
    await page.addInitScript(() => { window.__kvrScan = { settle: 0, poll: 10 }; });
    await page.route('https://chainweb.coop.no/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: pageFor(headerMode, swap) }));
    await page.goto('https://chainweb.coop.no/LindbakRetail_1/Journal/Viewer');
    for (const f of ['lib/html2canvas.min.js', 'lib/jszip.min.js', 'src/logic.js', 'src/report.js']) await page.addScriptTag({ path: path.join(dir, f) });
    await page.addStyleTag({ path: path.join(dir, 'src/panel.css') });
    await page.addScriptTag({ path: path.join(dir, 'src/content.js') });
    await page.waitForSelector('#kvr-panel');
    await page.click('.kvr-tab:has-text("Skann")');
    await page.click('button:text-is("Skann innhold (synlige)")');
    await page.waitForFunction(() => /(Ferdig|Stoppet)\. Skannet/.test(document.getElementById('kvr-panel').innerText), null, { timeout: 60000 });
    const scan = await page.evaluate(() => new Promise(res => { const rq = indexedDB.open('kvr-store', 1); rq.onsuccess = () => { const st = rq.result.transaction('scan').objectStore('scan'); const o = {}; const c = st.openCursor(); c.onsuccess = () => { const cur = c.result; if (cur) { o[cur.key] = cur.value; cur.continue(); } else res(o); }; }; }));
    const status = (await page.innerText('[data-sec=scan]')).replace(/\s+/g, ' ');
    await body({ scan, status, page });
    await page.context().close();
  };

  // 1. et sent svar: raden 1005-1-6 får innholdet til 1005-1-5. Etter tre treff avvises feil bong, ingen feil tilordning.
  await run('same', { '1005-1-6': '1005-1-5' }, async ({ scan }) => {
    assert.deepStrictEqual(Object.keys(scan).sort(), ids.filter(x => x !== '1005-1-6').sort());
    ids.filter(x => x !== '1005-1-6').forEach((id, i) => { const seq = id.split('-')[2]; assert.strictEqual(scan[id].items[0].n, 'VARE ' + seq, id + ' har eget innhold'); });
  });
  // 2. feil bong blant de tre første: formatet er ikke bevist ennå, så skanningen fortsetter (ingen stopp av hele kjøringen)
  await run('same', { '1005-1-2': '1005-1-1' }, async ({ scan }) => {
    assert.strictEqual(Object.keys(scan).length, N);
  });
  // 3. topptekstens nummer følger en annen nummerering: kontrollen aktiveres aldri, alt skannes
  await run('other', {}, async ({ scan }) => {
    assert.strictEqual(Object.keys(scan).length, N);
  });
  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('skann: ok');
})().catch(e => { console.error(e); process.exit(1); });
