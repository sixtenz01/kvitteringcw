const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

const T = (a, c) => `<tr><td>${a}</td><td></td><td>${c}</td></tr>`;
const SPAN = (t) => `<tr><td colspan="3">${t}</td></tr>`;
const R = (store, ws, seq, cashier, day, time, total, type, lines) => ({ store, ws, seq, cashier, day, time, total, type: type || 1, lines });
const ROWS = [
  R(1005, 1, 100, 'A', '2026-09-28', '10:00', 100, 1, [T('7000111 VARE X', '100.00'), SPAN('Rabatt: Kr 10.00 (9.1%)'), SPAN('Rabatt årsak: 6'), T('Bank:', '100.00')]),
  R(1005, 1, 101, 'A', '2026-09-28', '10:20', -100, 1, [T('7000111 VARE X', '-100.00'), T('Kontant tilbake:', '100.00')]),
  R(1005, 1, 102, 'B', '2026-09-28', '11:00', -50, 1, [T('9999999 UKJENT VARE', '-50.00'), T('Kontant tilbake:', '50.00')]),
  R(1005, 1, 103, 'A', '2026-09-28', '22:00', null, 2, [T('Sum', '240.00'), T('Differanse', ''), T('Sum', '-40.00')]),
  R(1005, 1, 104, 'C', '2026-09-28', '22:15', 120, 1, [T('7000222 VARE Y', '120.00'), SPAN('Rabatt: Kr 12.00 (9.1%)'), SPAN('Rabatt årsak: 2'), T('Kontant:', '120.00')]),
  R(1005, 1, 109, 'C', '2026-09-28', '22:30', 30, 1, [T('7000333 VARE Z', '30.00'), T('Kontant:', '30.00')]),
  R(1005, 1, 110, 'A', '2026-10-01', '09:00', 80, 1, [T('7000111 VARE X', '80.00'), SPAN('Rabatt: Kr 5.00 (6.0%)'), SPAN('Rabatt årsak: Datovare'), T('Bank:', '80.00')]),
  R(1005, 1, 111, 'A', '2026-10-01', '22:00', null, 2, [T('Sum', '240.00'), T('Differanse', ''), T('Sum', '-30.00')]),
  R(1005, 2, 200, 'D', '2026-10-01', '10:00', 60, 1, [T('7000444 VARE W', '60.00'), T('Bank:', '60.00')]),
  R(1005, 2, 201, 'D', '2026-10-01', '21:30', null, 2, [T('Sum', '100.00'), T('Differanse', ''), T('Sum', '-35.00')]),
  R(1010, 5, 300, 'E', '2026-10-01', '10:00', 40, 1, [T('7000555 VARE V', '40.00'), SPAN('Rabatt: Kr 40.00 (50.0%)'), SPAN('Rabatt årsak: '), T('Kupong (1ESD2P6DRVPCCJY1 - Gruppe - Coop koppnudler, 65 g):', '0.00'), T('Bank:', '40.00')])
];
const rows = ROWS.map(r => ({ transactionId: `x-${r.seq}`, endDateTime: `${r.day} ${r.time}`, storeNumber: r.store, workstationNumber: r.ws, cashierNumber: r.cashier, totalAmount: r.total, receiptType: r.type, memberNumber: null, journalSourceName: 'main' }));
const RECEIPTS = {};
ROWS.forEach(r => { RECEIPTS[`${r.store}-${r.ws}-${r.seq}`] = '<table>' + r.lines.join('') + '</table>'; });

const html = `<!doctype html><html><body>
<input id="fromDatePicker"><input id="toDatePicker"><input id="freetextSearchInput"><input id="receiptNumber">
<input ng-model="vm.selectedFilters.memberNumber"><input ng-model="vm.selectedFilters.externalLoyaltyNumber">
<button ng-click="vm.resetFilters()">Nullstill</button>
<button ng-click="vm.applyFilters()" onclick="window.__applied=(window.__applied||0)+1;(window.__bound||[]).forEach(function(f){f()})">Oppdater</button>
<div class="k-grid-header"><table><colgroup><col><col><col></colgroup><thead><tr><th>DATO</th><th>SUM</th><th>KASSERER</th></tr></thead></table></div>
<table id="g" data-role="grid"><colgroup><col><col><col></colgroup><tbody>
${rows.map(r => `<tr data-id="${r.transactionId}"><td></td><td>${r.endDateTime}</td><td>${r.totalAmount}</td></tr>`).join('')}
</tbody></table>
<div data-w="1"></div><iframe id="rc"></iframe>
<script>
var rows=${JSON.stringify(rows)};
var items=rows.map(function(r,i){var o=Object.assign({uid:'u'+i},r);o.toJSON=function(){var c=Object.assign({},o);delete c.toJSON;return c};return o});
var cur=null;
var grid={tbody:[document.querySelector('tbody')],dataSource:{view:function(){return items}},
 dataItem:function(tr){return items.filter(function(i){return i.transactionId===tr.getAttribute('data-id')})[0]},
 bind:function(n,f){(window.__bound=window.__bound||[]).push(f)},
 select:function(tr){if(!arguments.length)return cur?[cur]:[];cur=tr;},clearSelection:function(){cur=null}};
var ms={dataSource:{data:function(){return [{get:function(k){return {number:1005,text:'Coop Mega Kolbotn'}[k]}},{get:function(k){return {number:1010,text:'Extra Testby'}[k]}}]}},value:function(v){window.__storesSet=v},trigger:function(){}};
function mk(list){return {each:function(fn){list.forEach(function(e,i){fn.call(e,i,e)})},eq:function(i){return mk([list[i]])},data:function(n){var e=list[0];if(!e)return undefined;if(e.getAttribute('data-w'))return n==='kendoMultiSelect'?ms:null;return n==='kendoGrid'?grid:null}}}
window.jQuery=function(a){ if(typeof a==='string') return a.indexOf('#storesWrapper')===0?mk([].slice.call(document.querySelectorAll('[data-w]'))):mk([]); return mk([a]); };
</script></body></html>`;

(async () => {
  const dir = path.join(__dirname, '..');
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ locale: 'nb-NO' })).newPage();
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.error('PAGEERROR', e.message); });
  await page.route('https://chainweb.coop.no/**', async r => {
    const u = r.request().url();
    if (u.endsWith('/Api/GetReceiptDetails')) {
      const b = JSON.parse(r.request().postData());
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify(RECEIPTS[`${b.retailStoreNum}-${b.workstationNum}-${b.sequenceNum}`] || '') });
    }
    return r.fulfill({ contentType: 'text/html', body: html });
  });
  await page.goto('https://chainweb.coop.no/LindbakRetail_1/Journal/Viewer');
  for (const f of ['lib/html2canvas.min.js', 'lib/jszip.min.js', 'src/logic.js']) await page.addScriptTag({ path: path.join(dir, f) });
  await page.addStyleTag({ path: path.join(dir, 'src/panel.css') });
  await page.addScriptTag({ path: path.join(dir, 'src/content.js') });
  await page.waitForSelector('#kvr-panel');

  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  const idbGet = (store, key) => page.evaluate(([st, k]) => new Promise(res => { const rq = indexedDB.open('kvr-store', 1); rq.onsuccess = () => { const g = rq.result.transaction(st).objectStore(st).get(k); g.onsuccess = () => res(g.result === undefined ? null : g.result); }; }), [store, key]);
  const go = async (main, sub) => { await page.click(`.kvr-tab:has-text("${main}")`); if (sub) await page.click(`.kvr-sub:text-is("${sub}")`); };
  const group = async (id) => { if (!(await page.$eval(`[data-sec=set-${id}]`, d => d.open))) await page.click(`[data-sec=set-${id}] summary`); };
  const input = (id, label) => page.locator(`[data-sec=set-${id}] input[aria-label="${label}"]`);
  const badge = (id) => page.$eval(`[data-sec=set-${id}] .kvr-set-badge`, b => (b.style.display === 'none' ? '' : b.textContent));

  // førstegangsmelding og hjelp
  assert.match(await page.innerText('.kvr-first'), /Første gang\?/);
  await page.click('.kvr-icon[title="Hjelp og tegnforklaring"]');
  const help = await page.innerText('.kvr-modal');
  for (const t of ['Slik går du frem', 'Tegnforklaring', 'Snarveier', 'Risikoscore er summen av poeng']) assert.ok(help.includes(t), t);
  assert.ok(await page.isHidden('.kvr-first'), 'meldingen skjules når hjelpen åpnes');
  await page.click('.kvr-modal button:text-is("Innstillinger")');
  assert.ok(await page.isVisible('[data-sec=set-bong]'), 'Innstillinger fra hjelpen');
  await page.waitForTimeout(300);
  assert.strictEqual(await idbGet('kv', 'kvr.help.v1'), 1);

  // innstillingssiden: alle grupper, endring, av/på, standard
  assert.strictEqual(await page.$$eval('details.kvr-set', n => n.length), 12);
  await group('bong');
  assert.strictEqual(await badge('bong'), '');
  await input('bong', 'Stor panteretur fra').fill('250');
  await input('bong', 'Stor panteretur fra').press('Tab');
  assert.strictEqual(await badge('bong'), '1 endret');
  assert.ok(await page.$eval('[data-sec=set-bong] .kvr-set-row', r => r.classList.contains('kvr-changed')));
  await page.waitForTimeout(300);
  assert.strictEqual((await idbGet('kv', 'kvr.anom.v1')).bigReturn, '250');
  await page.uncheck('[data-sec=set-bong] input[aria-label="Stor panteretur fra: på"]');
  assert.ok(await input('bong', 'Stor panteretur fra').isDisabled());
  await page.waitForTimeout(300);
  assert.strictEqual((await idbGet('kv', 'kvr.anom.v1')).bigReturn, '');
  await page.check('[data-sec=set-bong] input[aria-label="Stor panteretur fra: på"]');
  assert.strictEqual(await input('bong', 'Stor panteretur fra').inputValue(), '250');
  await input('bong', 'Poeng: Stor panteretur').fill('9');
  await input('bong', 'Poeng: Stor panteretur').press('Tab');
  assert.strictEqual(await badge('bong'), '2 endret');
  await page.click('[data-sec=set-bong] button:text-is("Standard for denne gruppen")');
  assert.strictEqual(await badge('bong'), '');
  assert.strictEqual(await input('bong', 'Stor panteretur fra').inputValue(), '300');
  assert.strictEqual(await input('bong', 'Poeng: Stor panteretur').inputValue(), '3');
  assert.match(await page.innerText('.kvr-stats'), /«Avvik per bong» er satt tilbake til standard/);

  // terskler gjelder fra neste analyse: melding i Sjekk først
  await go('Skann'); await page.click('text=Rask skanning');
  await go('Analyse', 'Sjekk først');
  await page.click('[data-sec=chk-top] button:text-is("Kjør analyse")');
  await page.waitForFunction(() => /Kontroller ferdig/.test(document.getElementById('kvr-panel').innerText), null, { timeout: 40000 });
  assert.ok(await page.isHidden('[data-sec=chk-top] .kvr-notice'));
  await go('Mer', 'Innstillinger');
  await group('diff');
  await input('diff', 'Eller minus totalt over').fill('60');
  await input('diff', 'Eller minus totalt over').press('Tab');
  assert.ok(await page.isVisible('.kvr-notice:has-text("endret siden siste analyse")'));
  await go('Analyse', 'Sjekk først');
  assert.match(await page.innerText('[data-sec=chk-top] .kvr-notice'), /Innstillingene er endret siden sist/);
  await page.click('[data-sec=chk-top] button:text-is("Kjør analyse")');
  await page.waitForFunction(() => !document.querySelector('[data-sec=chk-top] .kvr-notice'), null, { timeout: 40000 });

  // «Juster» fra en forklaring åpner riktig gruppe
  await page.click('[data-sec=chk-list] .kvr-ck:first-child .kvr-ck-h');
  await page.click('[data-sec=chk-list] .kvr-ck:first-child .kvr-ck-h');
  assert.ok(await page.isVisible('[data-sec=chk-list] .kvr-ck:first-child .kvr-adj'));
  await page.click('[data-sec=chk-list] .kvr-ck:first-child .kvr-adj >> nth=0');
  assert.ok(await page.$$eval('details.kvr-set[open]', n => n.length) >= 1, 'gruppen åpnes');
  assert.ok(await page.isVisible('[data-sec=set-general]'));

  // eksport og import av innstillinger
  await go('Mer', 'Innstillinger');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:text-is("Eksporter innstillinger")')]);
  const file = path.join(require('os').tmpdir(), 'kvr-settings-test.json');
  await dl.saveAs(file);
  const exported = JSON.parse(require('fs').readFileSync(file, 'utf8'));
  assert.strictEqual(exported.app, 'kvitteringshenter');
  assert.strictEqual(exported.ctl.diffTotal, '60');
  await group('numbers');
  await input('numbers', 'Benford: minst antall bonger').fill('7');
  await input('numbers', 'Benford: minst antall bonger').press('Tab');
  await page.setInputFiles('[data-sec=set-general] input[type=file]', file);
  await page.waitForFunction(() => /Innstillingene er lest inn/.test(document.getElementById('kvr-panel').innerText));
  assert.strictEqual(await input('numbers', 'Benford: minst antall bonger').inputValue(), '100');
  assert.strictEqual(await input('diff', 'Eller minus totalt over').inputValue(), '60');
  const bad = path.join(require('os').tmpdir(), 'kvr-bad.json');
  require('fs').writeFileSync(bad, '{"x":1}');
  await page.setInputFiles('[data-sec=set-general] input[type=file]', bad);
  await page.waitForFunction(() => /Ugyldig innstillingsfil/.test(document.getElementById('kvr-panel').innerText));

  // alt til standard med bekreftelse i panelet
  await page.click('button:text-is("Alt til standard")');
  assert.match(await page.innerText('.kvr-modal'), /Sette alle terskler/);
  await page.click('.kvr-modal button:text-is("Avbryt")');
  assert.strictEqual(await input('diff', 'Eller minus totalt over').inputValue(), '60');
  await page.click('button:text-is("Alt til standard")');
  await page.click('.kvr-modal button:text-is("Tilbakestill")');
  assert.strictEqual(await input('diff', 'Eller minus totalt over').inputValue(), '100');

  // sletting bekreftes i panelet, ikke med nettleserdialog
  await go('Analyse', 'Detaljer');
  await page.click('[data-sec=custom] button:text-is("Ny regel")');
  assert.strictEqual(await page.$$eval('[data-sec=custom] .kvr-rule', n => n.length), 1);
  await page.click('[data-sec=custom] .kvr-rule button:text-is("✕")');
  assert.match(await page.innerText('.kvr-modal'), /Slette regelen/);
  await page.click('.kvr-modal button:text-is("Slett")');
  assert.strictEqual(await page.$$eval('[data-sec=custom] .kvr-rule', n => n.length), 0);
  assert.deepStrictEqual(dialogs, [], 'ingen native dialoger');

  // sammenfoldbare kort husker tilstanden
  assert.ok(!(await page.$eval('[data-sec=disc]', n => n.classList.contains('kvr-folded'))));
  await page.click('[data-sec=disc] > h4');
  assert.ok(await page.$eval('[data-sec=disc]', n => n.classList.contains('kvr-folded')));
  await page.waitForTimeout(300);
  assert.strictEqual((await idbGet('kv', 'kvr.sec.v1')).disc, false);
  await page.click('button:text-is("Åpne alle")');
  assert.ok(!(await page.$eval('[data-sec=disc]', n => n.classList.contains('kvr-folded'))));
  await page.click('button:text-is("Fold sammen alle")');
  assert.strictEqual(await page.$$eval('.kvr-fold:not(.kvr-folded)', n => n.length), 0);

  // piltaster bytter fane
  await page.focus('.kvr-tab:has-text("Hent")');
  await page.keyboard.press('ArrowRight');
  assert.strictEqual(await page.getAttribute('.kvr-tab:has-text("Filtrer")', 'aria-selected'), 'true');
  assert.strictEqual(await page.evaluate(() => document.activeElement.textContent.trim()), 'Filtrer');
  await page.keyboard.press('End');
  assert.strictEqual(await page.getAttribute('.kvr-tab:has-text("Mer")', 'aria-selected'), 'true');
  await page.keyboard.press('ArrowRight');
  assert.strictEqual(await page.getAttribute('.kvr-tab:has-text("Hent")', 'aria-selected'), 'true');
  await go('Mer');
  await page.focus('.kvr-sub:text-is("Eksport")');
  await page.keyboard.press('ArrowRight');
  assert.ok(await page.isVisible('[data-sec=set-general]'));

  // Fokus: valg uten å lete etter lenker
  await go('Analyse', 'Fokus');
  const picks = '.kvr-card:has(h4:text-is("Kasserere i listen"))';
  assert.match(await page.innerText(picks), /Kasserer A/);
  await page.click(picks + ' .kvr-ent:text-is("Kasserer A")');
  assert.match(await page.innerText('.kvr-ftiles'), /Kvitteringer/);

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('settings: ok');
})().catch(e => { console.error(e); process.exit(1); });
