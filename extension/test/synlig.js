const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

// Panelet skal alltid kunne nås: lagret plassering utenfor skjermen, panel fjernet fra siden og panel dekket av noe i CW.
const rows = [0, 1, 2].map((i) => ({ transactionId: `1005-1-${i + 1}`, endDateTime: `2026-10-02 10:0${i}:00`, storeNumber: 1005, workstationNumber: 1, cashierNumber: 'A', totalAmount: 10 + i, receiptType: 1, memberNumber: null, journalSourceName: 'main' }));
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<input id="fromDatePicker"><input id="toDatePicker"><input id="freetextSearchInput"><input id="receiptNumber">
<button ng-click="vm.resetFilters()">Nullstill</button><button ng-click="vm.applyFilters()">Oppdater</button>
<div class="k-grid-header"><table><colgroup><col><col><col></colgroup><thead><tr><th>DATO</th><th>SUM</th><th>KASSERER</th></tr></thead></table></div>
<table id="g" data-role="grid"><colgroup><col><col><col></colgroup><tbody>
${rows.map((r, i) => `<tr data-uid="u${i}" data-id="${r.transactionId}"><td></td><td>${r.endDateTime}</td><td>${r.totalAmount}</td></tr>`).join('')}
</tbody></table>
<div data-w="1"></div><iframe id="rc"></iframe>
<script>
var rows=${JSON.stringify(rows)};
var items=rows.map(function(r,i){var o=Object.assign({uid:'u'+i},r);o.toJSON=function(){var c=Object.assign({},o);delete c.toJSON;return c};return o});
var cur=null;
var grid={tbody:[document.querySelector('tbody')],dataSource:{view:function(){return items}},
 dataItem:function(tr){return items.filter(function(i){return i.transactionId===tr.getAttribute('data-id')})[0]},
 bind:function(n,f){},select:function(tr){if(!arguments.length)return cur?[cur]:[];cur=tr;},clearSelection:function(){cur=null}};
var ms={dataSource:{data:function(){return [{get:function(k){return {number:1005,text:'Coop Mega Kolbotn'}[k]}}]}},value:function(v){},trigger:function(){}};
function mk(list){return {each:function(fn){list.forEach(function(e,i){fn.call(e,i,e)})},eq:function(i){return mk([list[i]])},data:function(n){var e=list[0];if(!e)return undefined;if(e.getAttribute('data-w'))return n==='kendoMultiSelect'?ms:null;return n==='kendoGrid'?grid:null},val:function(){}}}
window.jQuery=function(a){ if(typeof a==='string') return a.indexOf('#storesWrapper')===0?mk([].slice.call(document.querySelectorAll('[data-w]'))):mk([]); return mk([a]); };
</script></body></html>`;

(async () => {
  const dir = path.join(__dirname, '..');
  const browser = await chromium.launch();
  const errors = [];
  const open = async (seed) => {
    const ctx = await browser.newContext({ locale: 'nb-NO', viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { errors.push(e.message); console.error('PAGEERROR', e.message); });
    if (seed) await page.addInitScript((kv) => {
      const rq = indexedDB.open('kvr-store', 1);
      rq.onupgradeneeded = () => { rq.result.createObjectStore('kv'); rq.result.createObjectStore('scan'); };
      rq.onsuccess = () => { const tx = rq.result.transaction('kv', 'readwrite'); Object.keys(kv).forEach((k) => tx.objectStore('kv').put(kv[k], k)); };
    }, seed);
    await page.route('https://chainweb.coop.no/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
    await page.goto('https://chainweb.coop.no/LindbakRetail_1/Journal/Viewer');
    await page.waitForTimeout(400);
    for (const f of ['lib/html2canvas.min.js', 'lib/jszip.min.js', 'src/logic.js', 'src/report.js']) await page.addScriptTag({ path: path.join(dir, f) });
    await page.addStyleTag({ path: path.join(dir, 'src/panel.css') });
    await page.addScriptTag({ path: path.join(dir, 'src/content.js') });
    await page.waitForSelector('#kvr-panel');
    return { ctx, page };
  };
  const rect = (page) => page.evaluate(() => { const r = document.getElementById('kvr-panel').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }; });
  const inView = (r, min) => r.w >= 20 && r.h >= 20 && r.r > 120 && r.l < r.vw - 120 && r.b > 60 && Math.min(r.b, r.vh) - Math.max(r.t, 0) >= (min || 100);
  const headVisible = (page) => page.evaluate(() => { const p = document.getElementById('kvr-panel'), h = p.querySelector('.kvr-head').getBoundingClientRect(); const e = document.elementFromPoint(h.left + h.width / 2, h.top + h.height / 2); return !!e && p.contains(e); });

  // 1. lagret plassering utenfor skjermen, sammenfoldet panel og stor størrelse: panelet er likevel synlig
  for (const seed of [
    { 'kvr.pos.v1': { left: 5000, top: 4000 } },
    { 'kvr.pos.v1': { left: -3000, top: -500 }, 'kvr.collapsed.v1': true },
    { 'kvr.pos.v1': { left: 2400, top: 90 }, 'kvr.size.v1': { width: '4000px', height: '3000px' } }
  ]) {
    const { ctx, page } = await open(seed);
    await page.waitForTimeout(700);
    const r = await rect(page);
    assert.ok(inView(r, seed['kvr.collapsed.v1'] ? 30 : 150), 'synlig med lagret ' + JSON.stringify(seed) + ' → ' + JSON.stringify(r));
    assert.ok(await headVisible(page), 'tittelfeltet er øverst');
    await ctx.close();
  }

  // 2. panelet fjernes fra siden: det kommer tilbake innen to sekunder
  {
    const { ctx, page } = await open(null);
    await page.evaluate(() => document.getElementById('kvr-panel').remove());
    assert.strictEqual(await page.$('#kvr-panel'), null);
    await page.waitForSelector('#kvr-panel', { timeout: 4000 });
    assert.ok(inView(await rect(page)));
    await ctx.close();
  }

  // 3. noe i CW dekker panelet (samme z-index, lagt til etterpå): panelet løftes øverst
  {
    const { ctx, page } = await open(null);
    await page.evaluate(() => { const d = document.createElement('div'); d.id = 'dekk'; d.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.2)'; document.body.appendChild(d); });
    assert.strictEqual(await headVisible(page), false, 'dekket før sjekken');
    await page.waitForFunction(() => { const p = document.getElementById('kvr-panel'), h = p.querySelector('.kvr-head').getBoundingClientRect(); const e = document.elementFromPoint(h.left + h.width / 2, h.top + h.height / 2); return !!e && p.contains(e); }, null, { timeout: 4000 });
    // og vanlig CSS-regel fra siden som skjuler paneler overstyres
    await page.addStyleTag({ content: '#kvr-panel{display:none;visibility:hidden;position:static;z-index:1}' });
    const vis = await page.evaluate(() => { const cs = getComputedStyle(document.getElementById('kvr-panel')); return [cs.display, cs.visibility, cs.position, cs.zIndex]; });
    assert.deepStrictEqual(vis, ['flex', 'visible', 'fixed', '2147483646']);
    await ctx.close();
  }

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('synlig: ok');
})().catch((e) => { console.error(e); process.exit(1); });
