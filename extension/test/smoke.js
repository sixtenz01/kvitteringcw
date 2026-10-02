const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

const rows = [
  { transactionId: 't-1', endDateTime: '2026-10-02 00:22', storeNumber: 1005, workstationNumber: 6, cashierNumber: '10', totalAmount: -556, receiptType: 1, memberNumber: null },
  { transactionId: 't-2', endDateTime: '2026-10-02 00:04', storeNumber: 1005, workstationNumber: 1, cashierNumber: '11', totalAmount: null, receiptType: 2, memberNumber: null },
  { transactionId: 't-3', endDateTime: '2026-10-02 00:01', storeNumber: 1005, workstationNumber: 4, cashierNumber: '12', totalAmount: 296.8, receiptType: 1, memberNumber: 'M1' },
  { transactionId: 't-4', endDateTime: '2026-10-02 00:01', storeNumber: 1005, workstationNumber: 4, cashierNumber: '12', totalAmount: 296.8, receiptType: 1, memberNumber: null },
  { transactionId: 't-5', endDateTime: '2026-10-01 14:00', storeNumber: 1005, workstationNumber: 2, cashierNumber: '10', totalAmount: 50, receiptType: 1, memberNumber: null }
];

const html = `<!doctype html><html><body><table id="g" data-role="grid"><tbody>
${rows.map(r => `<tr data-id="${r.transactionId}"><td></td><td>${r.endDateTime}</td><td>${r.totalAmount}</td></tr>`).join('')}
</tbody></table>
<iframe id="rc"></iframe>
<script>
var rows=${JSON.stringify(rows)};
var items=rows.map(function(r,i){var o=Object.assign({uid:'u'+i},r);o.toJSON=function(){var c=Object.assign({},o);delete c.toJSON;return c};return o});
var bound=[];
var grid={tbody:[document.querySelector('tbody')],dataSource:{view:function(){return items}},
 dataItem:function(tr){return items.filter(function(i){return i.transactionId===tr.getAttribute('data-id')})[0]},
 bind:function(n,f){bound.push(f)},
 select:function(tr){ if(!arguments.length) return cur?[cur]:[]; cur=tr; var id=tr.getAttribute('data-id'); setTimeout(function(){ document.getElementById('rc').contentDocument.body.innerHTML=receipts[id]||'<table><tr><td>X</td><td></td><td>1.00</td></tr></table>'; },300); },
 clearSelection:function(){cur=null}};
var cur=null;
var receipts={'t-1':'<table><tr><td>RETUR VARE</td></tr><tr><td>399 PANTELAPP</td><td></td><td>-150.00</td></tr><tr><td>399 PANTELAPP</td><td></td><td>-106.00</td></tr></table>','t-3':'<table><tr><td>7044610877488 PEPSI</td><td></td><td>32.90</td></tr><tr><td>220 PANT</td><td></td><td>2.00</td></tr></table>'};
window.jQuery=function(el){return {data:function(){return grid}}};
</script></body></html>`;

(async () => {
  const dir = path.join(__dirname, '..');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://chainweb.coop.no/**', r => r.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('https://chainweb.coop.no/LindbakRetail_1/Journal/Viewer');
  await page.addScriptTag({ path: path.join(dir, 'src/logic.js') });
  await page.addStyleTag({ path: path.join(dir, 'src/panel.css') });
  await page.addScriptTag({ path: path.join(dir, 'src/content.js') });
  await page.waitForSelector('#kv-panel');

  const vis = () => page.$$eval('tbody tr', trs => trs.filter(t => t.style.display !== 'none').map(t => t.getAttribute('data-id')));
  assert.deepStrictEqual(await vis(), ['t-1', 't-2', 't-3', 't-4', 't-5']);
  assert.strictEqual(await page.$$eval('tr.kv-dup', n => n.length), 2);
  assert.match(await page.innerText('.kv-tiles'), /5 \/ 5\s+Viser/);
  assert.match(await page.innerText('.kv-tiles'), /1\s+Duplikater/);

  await page.click('text=Negativ sum');
  assert.deepStrictEqual(await vis(), ['t-1']);
  await page.click('text=Nullstill');
  assert.strictEqual((await vis()).length, 5);

  await page.fill('input[placeholder=medlemsnr]', 'm1');
  assert.deepStrictEqual(await vis(), ['t-3']);
  await page.fill('input[placeholder=medlemsnr]', '');

  await page.selectOption('.kv-f:has-text("Sortering") select', 'sumDesc');
  const order = await page.$$eval('tbody tr', trs => trs.map(t => t.getAttribute('data-id')));
  assert.deepStrictEqual(order, ['t-3', 't-4', 't-5', 't-1', 't-2']);

  await page.click('text=Velg synlige');
  assert.match(await page.innerText('.kv-tiles'), /5\s+Valgt/);
  assert.match(await page.innerText('.kv-tiles'), /87,60\s+Sum valgt/);
  await page.click('summary:has-text("Lagrede filtre")');
  await page.fill('input[placeholder="navn på filter"]', 'test');
  await page.click('button:text-is("Lagre")');
  assert.ok(await page.evaluate(() => !!JSON.parse(localStorage.getItem('kvr.saved.v1')).test));

  await page.click('text=Nullstill');
  await page.click('text=Skann pant (synlige)');
  await page.waitForFunction(() => /Ferdig|Ingenting/.test(document.getElementById('kv-panel').innerText), null, { timeout: 15000 });
  assert.match(await page.textContent('#kv-panel'), /Skannet 4/);
  await page.selectOption('.kv-f:has-text("Pant (krever") select', 'return');
  assert.deepStrictEqual(await vis(), ['t-1']);
  await page.selectOption('.kv-f:has-text("Pant (krever") select', 'sale');
  assert.deepStrictEqual(await vis(), ['t-3']);
  await page.selectOption('.kv-f:has-text("Pant (krever") select', '');
  await page.click('text=Velg synlige');
  assert.match(await page.textContent('.kv-pantline'), /salg 2,00 · retur [-\u2212]256,00 · netto [-\u2212]254,00 kr \(4 av 5 skannet\)/);
  assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('kvr.pant.v1'))['t-1'].ret === -256));


  // flytting, skjuling og tastatursnarvei
  const box = async () => page.$eval('#kv-panel', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
  const b0 = await box();
  const h = await page.$eval('.kv-head', e => { const r = e.getBoundingClientRect(); return { x: r.x + 40, y: r.y + 12 }; });
  await page.mouse.move(h.x, h.y); await page.mouse.down(); await page.mouse.move(h.x - 300, h.y + 120, { steps: 5 }); await page.mouse.up();
  const b1 = await box();
  assert.ok(Math.abs((b0.x - b1.x) - 300) < 3 && Math.abs((b1.y - b0.y) - 120) < 3, 'panel flyttet');
  assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('kvr.pos.v1')).top > 100));
  await page.keyboard.press('Alt+k');
  assert.ok(await page.$eval('#kv-panel', e => e.classList.contains('kv-collapsed')));
  await page.click('.kv-head');
  assert.ok(await page.$eval('#kv-panel', e => !e.classList.contains('kv-collapsed')));
  await page.setViewportSize({ width: 500, height: 400 });
  await page.waitForTimeout(200);
  const b2 = await box();
  assert.ok(b2.x >= 0 && b2.x + b2.w <= 500 && b2.y < 400, 'panel innenfor etter resize');
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.evaluate(() => localStorage.removeItem('kvr.pos.v1'));
  await page.reload();
  await page.addScriptTag({ path: path.join(dir, 'src/logic.js') });
  await page.addStyleTag({ path: path.join(dir, 'src/panel.css') });
  await page.addScriptTag({ path: path.join(dir, 'src/content.js') });
  await page.waitForSelector('#kv-panel');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('smoke: ok');
})().catch(e => { console.error(e); process.exit(1); });
