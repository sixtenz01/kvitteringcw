const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

// Pluginen sier fra på siden når den ikke kan vise panelet: venter på listen, eller fikk en feil ved oppstart.
const rows = [0, 1].map((i) => ({ transactionId: `1005-1-${i + 1}`, endDateTime: `2026-10-02 10:0${i}:00`, storeNumber: 1005, workstationNumber: 1, cashierNumber: 'A', totalAmount: 10 + i, receiptType: 1, memberNumber: null }));
const gridScript = `
var rows=${JSON.stringify(rows)};
var items=rows.map(function(r,i){var o=Object.assign({uid:'u'+i},r);o.toJSON=function(){var c=Object.assign({},o);delete c.toJSON;return c};return o});
function addGrid(){
  var t=document.createElement('table');t.id='g';t.setAttribute('data-role','grid');
  t.innerHTML='<tbody>'+items.map(function(o){return '<tr data-uid="'+o.uid+'" data-id="'+o.transactionId+'"><td></td><td>'+o.endDateTime+'</td></tr>'}).join('')+'</tbody>';
  document.body.appendChild(t);
  var cur=null;
  window.__grid={tbody:[t.querySelector('tbody')],dataSource:{view:function(){return items}},dataItem:function(tr){return items.filter(function(i){return i.transactionId===tr.getAttribute('data-id')})[0]},bind:function(){},select:function(tr){if(!arguments.length)return cur?[cur]:[];cur=tr},clearSelection:function(){cur=null}};
}
function mk(list){return {each:function(fn){list.forEach(function(e,i){fn.call(e,i,e)})},eq:function(i){return mk([list[i]])},data:function(n){var e=list[0];if(!e)return undefined;return n==='kendoGrid'?window.__grid:null},val:function(){}}}
window.jQuery=function(a){ if(typeof a==='string') return mk([]); return mk([a]); };
`;
const page0 = `<!doctype html><html><head><meta charset="utf-8"></head><body><input id="fromDatePicker"><iframe id="rc"></iframe><script>${gridScript}</script></body></html>`;

(async () => {
  const dir = path.join(__dirname, '..');
  const browser = await chromium.launch();
  const open = async (before) => {
    const ctx = await browser.newContext({ locale: 'nb-NO' });
    const page = await ctx.newPage();
    await page.addInitScript(() => { window.__kvrWait = 400; });
    await page.route('https://chainweb.coop.no/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: page0 }));
    await page.goto('https://chainweb.coop.no/LindbakRetail_1/Journal/Viewer');
    for (const f of ['lib/html2canvas.min.js', 'lib/jszip.min.js', 'src/logic.js', 'src/report.js']) await page.addScriptTag({ path: path.join(dir, f) });
    if (before) await page.evaluate(before);
    await page.addStyleTag({ path: path.join(dir, 'src/panel.css') });
    await page.addScriptTag({ path: path.join(dir, 'src/content.js') });
    return { ctx, page };
  };

  // 1. ingen liste: boksen sier at pluginen venter, og forsvinner når panelet kommer
  {
    const { ctx, page } = await open(null);
    await page.waitForSelector('#kvr-boot', { timeout: 5000 });
    assert.match(await page.innerText('#kvr-boot'), /Kvitteringshenter \d+\.\d+\.\d+ er lastet og venter på listen i CW/);
    assert.strictEqual(await page.$('#kvr-panel'), null);
    await page.evaluate(() => window.addGrid());
    await page.waitForSelector('#kvr-panel', { timeout: 5000 });
    await page.waitForFunction(() => !document.getElementById('kvr-boot'));
    await ctx.close();
  }

  // 2. feil ved oppstart: vises på siden med melding og kan kopieres
  {
    const { ctx, page } = await open(() => { window.KvLogic.sanitizeControl = function () { throw new Error('testfeil i oppstart'); }; });
    await page.waitForSelector('#kvr-boot[role=alert]', { timeout: 5000 });
    const t = await page.innerText('#kvr-boot');
    assert.match(t, /Kvitteringshenter \d+\.\d+\.\d+ fikk en feil: testfeil i oppstart/);
    assert.match(t, /Kopier feilen/);
    assert.match(await page.evaluate(() => window.__kvBootErr), /testfeil i oppstart/);
    await ctx.close();
  }

  // 3. feil mens panelet bygges: vises, og pluginen prøver igjen (gridet merkes ikke som ferdig)
  {
    const { ctx, page } = await open(() => {
      window.addGrid();
      window.__kvFail = 1;
      // DISC_REASONS.map brukes når panelet bygges; den feiler så lenge __kvFail er satt
      window.KvLogic.DISC_REASONS = new Proxy(window.KvLogic.DISC_REASONS, { get: (t, k) => { if (k === 'map' && window.__kvFail) throw new Error('feil i panelet'); return Reflect.get(t, k); } });
    });
    await page.waitForSelector('#kvr-boot[role=alert]', { timeout: 5000 });
    assert.match(await page.innerText('#kvr-boot'), /fikk en feil: feil i panelet/);
    await page.evaluate(() => { window.__kvFail = 0; });
    await page.waitForSelector('#kvr-panel', { timeout: 5000 });
    await ctx.close();
  }

  await browser.close();
  console.log('oppstart: ok');
})().catch((e) => { console.error(e); process.exit(1); });
