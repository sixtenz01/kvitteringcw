const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

// Lagre innstillinger i en mappe (File System Access, her etterlignet i minnet): velg mappe, automatisk lagring,
// les inn fra mappen, tilgang etter omstart, fil fra en annen PC som ikke skrives over, og glem mappen.
const rows = [], receipts = {};
for (let i = 0; i < 24; i++) {
  const id = `1001-${1 + (i % 2)}-${100 + i}`;
  rows.push({ transactionId: id, endDateTime: `2026-10-0${1 + (i % 3)} 1${i % 10}:15`, storeNumber: 1001, workstationNumber: 1 + (i % 2), cashierNumber: ['A', 'B', 'C'][i % 3], totalAmount: i === 5 ? 600 : 50 + i * 7, receiptType: 1, memberNumber: null, journalSourceName: 'main' });
  receipts[id] = `<div>Kvittering: ${100 + i} 01.10.2026 10:00:00</div><table><tr><td>7000000000001 VARE</td><td></td><td>${(50 + i * 7).toFixed(2)}</td></tr><tr><td>Bank:</td><td></td><td>${(50 + i * 7).toFixed(2)}</td></tr></table>`;
}
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
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
  const page = await (await browser.newContext({ locale: 'nb-NO', viewport: { width: 1400, height: 900 } })).newPage();
  const errors = [], apiCalls = [];
  page.on('pageerror', e => { errors.push(e.message); console.error('PAGEERROR', e.message); });
  await page.addInitScript(() => { window.__kvrScan = { settle: 0, poll: 10 }; });
  // falsk mappe: filene ligger i window.__files { navn: { text, mod } }, tilgangen i window.__perm
  await page.addInitScript(() => {
    window.__files = {}; window.__perm = 'granted'; window.__picks = 0;
    const file = (name) => ({ kind: 'file', name,
      async getFile() { const f = window.__files[name]; if (!f) throw new DOMException('mangler', 'NotFoundError'); return { lastModified: f.mod, text: async () => f.text }; },
      async createWritable() { let buf = ''; return { write: async (d) => { buf += d; }, close: async () => { window.__files[name] = { text: buf, mod: Date.now() }; } }; } });
    window.__dir = { kind: 'directory', name: 'Fellesdisk',
      queryPermission: async () => window.__perm, requestPermission: async () => (window.__perm = 'granted'),
      getFileHandle: async (n, o) => { if (!window.__files[n] && !(o && o.create)) throw new DOMException('mangler', 'NotFoundError'); return file(n); } };
    window.showDirectoryPicker = async () => { window.__picks++; return window.__dir; };
  });
  await page.route('https://chainweb.coop.no/**', r => {
    if (r.request().url().indexOf('/Api/') !== -1) { apiCalls.push(r.request().url()); return r.fulfill({ status: 404, body: '' }); }
    return r.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
  });
  await page.goto('https://chainweb.coop.no/LindbakRetail_1/Journal/Viewer');
  for (const f of ['lib/html2canvas.min.js', 'lib/jszip.min.js', 'src/logic.js', 'src/report.js']) await page.addScriptTag({ path: path.join(dir, f) });
  await page.addStyleTag({ path: path.join(dir, 'src/panel.css') });
  await page.addScriptTag({ path: path.join(dir, 'src/content.js') });
  await page.waitForSelector('#kvr-panel');
  await page.click('.kvr-tab:has-text("Mer")'); await page.click('.kvr-sub:text-is("Innstillinger")');
  const info = async () => (await page.innerText('[data-sec=set-general]')).replace(/\s+/g, ' ');
  const fileJson = () => page.evaluate(() => { const f = window.__files['kvitteringshenter-innstillinger.json']; return f ? JSON.parse(f.text) : null; });
  const diffInput = '[data-sec=set-diff] input[aria-label="Eller minus totalt over"]';
  const setDiff = async (v) => {
    if (!(await page.$eval('[data-sec=set-diff]', d => d.open))) await page.click('[data-sec=set-diff] summary');
    await page.fill(diffInput, v); await page.press(diffInput, 'Tab');
  };
  assert.match(await info(), /Ingen mappe valgt\. Innstillingene ligger bare i nettleseren/);

  // velg mappe: tom mappe, innstillingene skrives med en gang
  await page.click('[data-sec=set-general] button:text-is("Velg mappe…")');
  await page.waitForFunction(() => !!window.__files['kvitteringshenter-innstillinger.json']);
  assert.strictEqual((await fileJson()).app, 'kvitteringshenter');
  assert.match(await info(), /Lagrer automatisk til mappen «Fellesdisk» \(kvitteringshenter-innstillinger\.json\)\. Sist lagret/);

  // endring lagres automatisk
  await setDiff('60');
  await page.waitForFunction(() => /"diffTotal": "60"/.test((window.__files['kvitteringshenter-innstillinger.json'] || {}).text || ''), null, { timeout: 5000 });

  // les inn fra mappen (endret på en annen PC)
  await page.evaluate(() => { const k = 'kvitteringshenter-innstillinger.json', d = JSON.parse(window.__files[k].text); d.ctl.diffTotal = '75'; window.__files[k] = { text: JSON.stringify(d), mod: Date.now() }; });
  await page.click('[data-sec=set-general] button:text-is("Les inn fra mappen")');
  await page.waitForFunction((s) => document.querySelector(s).value === '75', diffInput);

  // tilgang mangler (etter omstart av Chrome): ingenting skrives før brukeren gir tilgang
  await page.evaluate(() => { window.__perm = 'prompt'; });
  await setDiff('80');
  await page.waitForTimeout(1300);
  assert.strictEqual((await fileJson()).ctl.diffTotal, '75', 'ikke skrevet uten tilgang');
  assert.match(await info(), /Mappen «Fellesdisk» trenger tilgang på nytt/);
  await page.click('[data-sec=set-general] button:text-is("Gi tilgang")');
  await page.waitForFunction(() => /"diffTotal": "80"/.test(window.__files['kvitteringshenter-innstillinger.json'].text), null, { timeout: 5000 });

  // glem mappen, og velg den igjen når filen er ulik: brukeren velger hva som gjelder
  await page.click('[data-sec=set-general] button:text-is("Glem mappen")');
  assert.match(await info(), /Ingen mappe valgt/);
  await setDiff('90');
  await page.waitForTimeout(1000);
  assert.strictEqual((await fileJson()).ctl.diffTotal, '80', 'glemt mappe skrives ikke til');
  await page.click('[data-sec=set-general] button:text-is("Velg mappe…")');
  await page.waitForSelector('.kvr-modal:has-text("Mappen har innstillinger fra før")');
  assert.match(await info(), /er endret .*etter din siste lagring/);
  await setDiff('95');
  await page.waitForTimeout(1000);
  assert.strictEqual((await fileJson()).ctl.diffTotal, '80', 'nyere fil skrives ikke over før brukeren har valgt');
  await page.click('.kvr-modal button:text-is("Skriv mine til mappen")');
  await page.waitForFunction(() => /"diffTotal": "95"/.test(window.__files['kvitteringshenter-innstillinger.json'].text), null, { timeout: 5000 });
  assert.match(await info(), /Lagrer automatisk til mappen «Fellesdisk»/);

  // eksport lager samme fil
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:text-is("Eksporter innstillinger")')]);
  assert.strictEqual(dl.suggestedFilename(), 'kvitteringshenter-innstillinger.json');

  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(apiCalls, [], 'pluginen skal aldri kalle CWs API');
  await browser.close();
  console.log('mappe: ok');
})().catch(e => { console.error(e); process.exit(1); });
