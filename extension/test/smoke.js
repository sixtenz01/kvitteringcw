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
<script>
var rows=${JSON.stringify(rows)};
var items=rows.map(function(r,i){var o=Object.assign({uid:'u'+i},r);o.toJSON=function(){var c=Object.assign({},o);delete c.toJSON;return c};return o});
var bound=[];
var grid={tbody:[document.querySelector('tbody')],dataSource:{view:function(){return items}},
 dataItem:function(tr){return items.filter(function(i){return i.transactionId===tr.getAttribute('data-id')})[0]},
 bind:function(n,f){bound.push(f)}};
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
  assert.match(await page.textContent('.kv-summary'), /Viser 5 av 5.*Duplikatgrupper: 1/);

  await page.click('text=Negativ sum');
  assert.deepStrictEqual(await vis(), ['t-1']);
  await page.click('text=Nullstill');
  assert.strictEqual((await vis()).length, 5);

  await page.fill('input[placeholder=medlemsnr]', 'm1');
  assert.deepStrictEqual(await vis(), ['t-3']);
  await page.fill('input[placeholder=medlemsnr]', '');

  await page.selectOption('.kv-f select:not([multiple])', 'sumDesc');
  const order = await page.$$eval('tbody tr', trs => trs.map(t => t.getAttribute('data-id')));
  assert.deepStrictEqual(order, ['t-3', 't-4', 't-5', 't-1', 't-2']);

  await page.click('text=Velg synlige');
  assert.match(await page.textContent('.kv-summary'), /Valgt: 5 · Sum valgt: 87,60 kr|Valgt: 5 · Sum valgt: 87,60/);
  await page.fill('input[placeholder="navn på filter"]', 'test');
  await page.click('text=Lagre');
  assert.ok(await page.evaluate(() => !!JSON.parse(localStorage.getItem('kvr.saved.v1')).test));

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('smoke: ok');
})().catch(e => { console.error(e); process.exit(1); });
