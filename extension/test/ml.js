const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

// Maskinlæring i panelet: uvanlige bonger blir funn med forklaring, og «Sjekk først» kan sorteres etter vurderingene dine.
const ROWS = [], receipts = {};
let seed = 3;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const TR = (a, c) => `<tr><td>${a}</td><td></td><td>${c}</td></tr>`;
for (let i = 1; i <= 230; i++) {
  const amt = Math.round((40 + rnd() * 250) * 100) / 100, h = 9 + Math.floor(rnd() * 10), m = Math.floor(rnd() * 60);
  const id = `1005-${1 + (i % 3)}-${i}`;
  ROWS.push({ transactionId: id, endDateTime: `2026-10-0${1 + (i % 5)} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, storeNumber: 1005, workstationNumber: 1 + (i % 3), cashierNumber: 'K' + (i % 4), totalAmount: amt, receiptType: 1, saleChannel: 2, memberNumber: null, journalSourceName: 'main' });
  receipts[id] = `<table>${TR('7038010000010 VARE', amt.toFixed(2))}${TR('Totalt', amt.toFixed(2))}${TR('Bank:', amt.toFixed(2))}</table>`;
}
ROWS.push({ transactionId: '1005-2-999', endDateTime: '2026-10-03 05:10', storeNumber: 1005, workstationNumber: 2, cashierNumber: 'K1', totalAmount: -150, receiptType: 1, saleChannel: 2, memberNumber: null, journalSourceName: 'main' });
receipts['1005-2-999'] = `<table>${TR('7038010000027 VARE', '150.00')}${TR('7038010000027 VARE', '-150.00')}${TR('399 PANTELAPP', '-150.00')}${TR('Totalt', '-150.00')}${TR('Kontant tilbake:', '150.00')}</table>`;

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<input id="fromDatePicker"><input id="toDatePicker"><input id="freetextSearchInput"><input id="receiptNumber">
<button ng-click="vm.applyFilters()" id="apply">Oppdater</button>
<div class="k-grid-header"><table><thead><tr><th>DATO</th><th>SUM</th></tr></thead></table></div>
<div id="g" data-role="grid"><table><tbody></tbody></table></div>
<iframe id="rc"></iframe>
<script>
var ALL=${JSON.stringify(ROWS)}, receipts=${JSON.stringify(receipts)};
var tbody=document.querySelector('#g tbody'),handlers=[],data=[],uid=0,cur=null;
var grid={tbody:[tbody],dataSource:{data:function(){return data},view:function(){return data}},
  bind:function(n,f){if(n==='dataBound')handlers.push(f)},
  dataItem:function(tr){var u=tr.getAttribute('data-uid');return data.filter(function(d){return d.uid===u})[0]},
  select:function(tr){if(!arguments.length)return cur?[cur]:[];cur=tr;var d=grid.dataItem(tr);setTimeout(function(){document.getElementById('rc').contentDocument.body.innerHTML=receipts[d.transactionId]},3)},
  clearSelection:function(){cur=null}};
function render(list){data=list.map(function(r){return Object.assign({uid:'u'+(++uid)},r)});
  tbody.innerHTML=data.map(function(d){return '<tr data-uid="'+d.uid+'"><td data-field="endDateTime">'+d.endDateTime+'</td><td>'+d.totalAmount+'</td></tr>'}).join('');
  handlers.forEach(function(f){f()})}
function mk(list){return{each:function(fn){list.forEach(function(e,i){fn.call(e,i,e)})},eq:function(i){return mk([list[i]])},data:function(n){var e=list[0];return e&&e.__w?e.__w[n]:undefined}}}
document.getElementById('g').__w={kendoGrid:grid};
window.jQuery=function(a){return typeof a==='string'?mk([]):mk([a])};
render(ALL);
</script></body></html>`;

(async () => {
  const dir = path.join(__dirname, '..');
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ locale: 'nb-NO', viewport: { width: 1400, height: 1000 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.error('PAGEERROR', e.message); });
  await page.addInitScript(() => { window.__kvrScan = { settle: 0, poll: 5, min: 1, pause: 50, timeout: 1500 }; });
  await page.route('https://chainweb.coop.no/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  const load = async (prep, arg) => {
    await page.goto('https://chainweb.coop.no/LindbakRetail_1/Journal/Viewer');
    if (prep) await page.evaluate(prep, arg);
    for (const f of ['lib/html2canvas.min.js', 'lib/jszip.min.js', 'src/logic.js', 'src/report.js']) await page.addScriptTag({ path: path.join(dir, f) });
    await page.addStyleTag({ path: path.join(dir, 'src/panel.css') });
    await page.addScriptTag({ path: path.join(dir, 'src/content.js') });
    await page.waitForFunction(() => document.querySelectorAll('#g tbody td.kvr-cb-cell').length > 0);
  };
  const analyse = async () => {
    await page.click('.kvr-tab:has-text("Analyse")');
    await page.click('.kvr-sub:text-is("Sjekk først")');
    await page.click('[data-sec=chk-top] button:text-is("Kjør analyse")');
    await page.waitForFunction(() => /Kontroller ferdig/.test(document.getElementById('kvr-panel').innerText) && document.querySelector('[data-sec=chk-list] .kvr-ck'), null, { timeout: 120000 });
  };

  // 1) uvanlig bong: kl. 05:10, varene slettet og pant betalt ut kontant
  await load();
  await analyse();
  const top = await page.innerText('[data-sec=chk-list] .kvr-ck:first-child');
  assert.match(top, /Uvanlig bong \(maskinlæring\)/, top);
  await page.click('.kvr-sub:text-is("Detaljer")');
  await page.evaluate(() => { const b = [...document.querySelectorAll('#kvr-panel button')].find(x => x.textContent === 'Vis alt'); if (b) b.click(); });
  const all = (await page.innerText('#kvr-panel')).replace(/\s+/g, ' ');
  assert.match(all, /Maskinlæring: Uvanlig bong \(maskinlæring\) Kasse 2 05:10 kasserer K1: uvanlighet \d+ av 100 \(blant de 1 % mest uvanlige av 231 skannede salg\)\. Uvanlig: -150\.00 kr \([\d,]+ % av bongene har så lavt\); kl\. 05:10/);
  assert.match(all, /Modellen har lært av 231 skannede salg i datagrunnlaget og flagger \d+ bonger i omfanget/);
  assert.match(all, /Lær av vurderingene: 0 «Til oppfølging» og 0 «Sjekket» så langt; minst 8 av hver trengs\./);
  assert.match(all, /Ligner sikre funn: \d+ sikre funn og \d+ rene bonger; minst 10 sikre funn og 30 rene trengs\./);

  // 2) lær av vurderingene: 8 + 8 bonger med status, så kan «Sjekk først» sorteres etter dem
  const ids = ROWS.slice(0, 16).map((r) => r.transactionId);
  await load((list) => new Promise((res) => {
    const rq = indexedDB.open('kvr-store', 1);
    rq.onsuccess = () => {
      const tx = rq.result.transaction('kv', 'readwrite'), kv = tx.objectStore('kv'), g = kv.get('kvr.notes.v1');
      g.onsuccess = () => { const n = g.result || {}; list.forEach((id, i) => { n[id] = { status: i < 8 ? 'oppfolging' : 'sjekket', note: '', t: 1 }; }); kv.put(n, 'kvr.notes.v1'); };
      tx.oncomplete = () => { rq.result.close(); res(); };
    };
  }), ids);
  await analyse();
  const box = await page.innerText('[data-sec=chk-top]');
  assert.match(box, /Sorter etter vurderingene dine \(maskinlæring(, AUC \d,\d+)?\)/, box);
  assert.ok(await page.$('[data-sec=chk-list] .kvr-ck .kvr-ml'), 'flaggede bonger viser lært sannsynlighet');
  await page.click('[data-sec=chk-top] label:has-text("Sorter etter vurderingene dine")');
  const ps = await page.$$eval('[data-sec=chk-list] .kvr-ck .kvr-ml', (n) => n.map((x) => parseInt(x.textContent.replace(/\D/g, ''), 10)));
  assert.deepStrictEqual(ps, ps.slice().sort((a, b) => b - a), 'sortert etter lært sannsynlighet: ' + ps.join(','));

  // 3) «Vurder disse neste»: ti bonger som ikke er vurdert, høyst tre per kasserer; vurderingen teller med en gang
  await page.click('[data-sec=chk-top] button:text-is("Vurder disse neste")');
  await page.waitForSelector('[data-sec=chk-review]');
  assert.match(await page.innerText('[data-sec=chk-review] h4'), /Vurder disse \(0 av 10 vurdert\)/i);
  assert.match(await page.innerText('[data-sec=chk-review]'), /Valgt fordi modellen som lærer av vurderingene dine, er mest usikker på dem\./);
  assert.ok(!(await page.$('[data-sec=chk-list]')), 'listen er byttet ut med de ti');
  const picked = await page.$$eval('[data-sec=chk-review] .kvr-ck .kvr-ck-t', (n) => n.map((x) => x.textContent));
  assert.strictEqual(picked.length, 10);
  assert.ok(!(await page.$('[data-sec=chk-review] .kvr-st')), 'ingen av dem er vurdert fra før');
  await page.click('[data-sec=chk-review] .kvr-ck.kvr-open button:text-is("Sjekket")');
  await page.waitForFunction(() => /1 av 10 vurdert/i.test(document.querySelector('[data-sec=chk-review] h4').textContent));
  assert.strictEqual(await page.$$eval('[data-sec=chk-review] .kvr-ck.kvr-open', (n) => n.length), 1, 'neste bong er åpnet');
  await page.click('[data-sec=chk-review] button:text-is("Tilbake til listen")');
  await page.waitForSelector('[data-sec=chk-list]');

  // 4) «Flagg som avvik»: valgte bonger får «Flagget av deg» (høy risiko) og «Til oppfølging»; trykk igjen fjerner flagget
  const pickIds = ROWS.slice(100, 103).map((r) => r.transactionId);
  for (const id of pickIds) await page.evaluate((x) => [...document.querySelectorAll('#g tbody input.kvr-cb')].find((c) => c.getAttribute('data-id') === x).click(), id);
  assert.strictEqual(await page.innerText('.kvr-foot button:has-text("Flagg som avvik")'), 'Flagg som avvik (3)');
  await page.click('.kvr-foot button:has-text("Flagg som avvik")');
  await page.waitForFunction(() => /3 bonger flagget som avvik/.test(document.getElementById('kvr-panel').innerText));
  const st = await page.evaluate((list) => new Promise((res) => {
    const rq = indexedDB.open('kvr-store', 1);
    rq.onsuccess = () => { const g = rq.result.transaction('kv').objectStore('kv').get('kvr.notes.v1'); g.onsuccess = () => { res(list.map((id) => g.result[id] && g.result[id].status + ':' + g.result[id].flag)); rq.result.close(); }; };
  }), pickIds);
  assert.deepStrictEqual(st, ['oppfolging:1', 'oppfolging:1', 'oppfolging:1']);
  while (await page.$('[data-sec=chk-list] button:has-text("Vis flere")')) await page.click('[data-sec=chk-list] button:has-text("Vis flere")');
  const flaggedRows = await page.$$eval('[data-sec=chk-list] .kvr-ck', (n) => n.filter((x) => /Flagget av deg/.test(x.textContent)).length);
  assert.strictEqual(flaggedRows, 3, 'de flaggede står i Sjekk først');
  assert.strictEqual(await page.innerText('.kvr-foot button:has-text("Fjern flagg")'), 'Fjern flagg (3)');
  await page.click('.kvr-foot button:has-text("Fjern flagg")');
  await page.waitForFunction(() => /Flagget er fjernet fra 3 bonger/.test(document.getElementById('kvr-panel').innerText));
  assert.strictEqual(await page.$$eval('[data-sec=chk-list] .kvr-ck', (n) => n.filter((x) => /Flagget av deg/.test(x.textContent)).length), 0);

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('ml e2e: ok');
})().catch((e) => { console.error(e); process.exit(1); });
