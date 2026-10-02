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
const BYID = {};
rows.forEach(r => { BYID[r.transactionId] = RECEIPTS[`${r.storeNumber}-${r.workstationNumber}-${r.transactionId.slice(r.transactionId.lastIndexOf('-') + 1)}`] || '<table><tr><td>X</td><td></td><td>1.00</td></tr></table>'; });

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
var receipts=${JSON.stringify(BYID)};
var items=rows.map(function(r,i){var o=Object.assign({uid:'u'+i},r);o.toJSON=function(){var c=Object.assign({},o);delete c.toJSON;return c};return o});
var cur=null;
var grid={tbody:[document.querySelector('tbody')],dataSource:{view:function(){return items}},
 dataItem:function(tr){return items.filter(function(i){return i.transactionId===tr.getAttribute('data-id')})[0]},
 bind:function(n,f){(window.__bound=window.__bound||[]).push(f)},
 select:function(tr){if(!arguments.length)return cur?[cur]:[];cur=tr;var id=tr.getAttribute('data-id');setTimeout(function(){document.getElementById('rc').contentDocument.body.innerHTML=receipts[id];},5);},clearSelection:function(){cur=null}};
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
  const apiCalls = [];
  await page.addInitScript(() => { window.__kvrScan = { settle: 0, poll: 10 }; });
  await page.route('https://chainweb.coop.no/**', async r => {
    const u = r.request().url();
    if (u.indexOf('/Api/') !== -1) { apiCalls.push(u); return r.fulfill({ status: 404, body: '' }); }
    return r.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
  });
  await page.goto('https://chainweb.coop.no/LindbakRetail_1/Journal/Viewer');
  for (const f of ['lib/html2canvas.min.js', 'lib/jszip.min.js', 'src/logic.js', 'src/report.js']) await page.addScriptTag({ path: path.join(dir, f) });
  await page.addStyleTag({ path: path.join(dir, 'src/panel.css') });
  await page.addScriptTag({ path: path.join(dir, 'src/content.js') });
  await page.waitForSelector('#kvr-panel');

  const fs = require('fs');
  const os = require('os');
  const crypto = require('crypto');
  const JSZip = require('../lib/jszip.min.js');
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  const go = async (main, sub) => { await page.click(`.kvr-tab:has-text("${main}")`); if (sub) await page.click(`.kvr-sub:text-is("${sub}")`); };
  const runAnalysis = async () => {
    await go('Analyse', 'Sjekk først');
    await page.click('[data-sec=chk-top] button:text-is("Kjør analyse")');
    await page.waitForFunction(() => /Kontroller ferdig/.test(document.getElementById('kvr-panel').innerText), null, { timeout: 40000 });
  };
  const makeReport = async (ref, who, evidence) => {
    await page.click('.kvr-modal input[placeholder*="saksnr"]').catch(() => {});
    await page.fill('.kvr-modal input[placeholder*="saksnr"]', ref);
    await page.fill('.kvr-modal input[placeholder="navn"]', who);
    await page.fill('.kvr-modal input[type=number]', String(evidence));
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click('.kvr-modal button:text-is("Lag rapport (ZIP)")')]);
    const file = path.join(os.tmpdir(), 'kvr-' + ref + '.zip');
    await dl.saveAs(file);
    await page.waitForSelector('.kvr-modal:has-text("Rapport laget")', { timeout: 60000 });
    const zipHash = await page.inputValue('.kvr-modal input[readonly]');
    await page.click('.kvr-modal button:text-is("Lukk")');
    const buf = fs.readFileSync(file);
    return { buf, zipHash, zip: await JSZip.loadAsync(buf), name: dl.suggestedFilename() };
  };

  await go('Skann');
  await go('Analyse', 'Sjekk først');
  assert.ok(await page.isHidden('[data-sec=chk-top] button:text-is("Lag revisjonsrapport…")'), 'knappen kommer først etter analysen');

  // uten analyse: dialogen ber om å kjøre den
  await go('Mer', 'Eksport');
  await page.click('[data-sec=auditrep] button:text-is("Lag revisjonsrapport…")');
  assert.match(await page.innerText('.kvr-modal'), /Kjør analysen først/);
  await page.click('.kvr-modal button:text-is("Lukk")');
  assert.match(await page.innerText('[data-sec=auditrep]'), /Ingen rapporter laget ennå/);

  // analyse, en oppfølgingsmerking, og rapport med tre bevisbilder
  await runAnalysis();
  await page.click('[data-sec=chk-list] .kvr-ck:first-child button:text-is("Til oppfølging")');
  await page.click('[data-sec=chk-top] button:text-is("Lag revisjonsrapport…")');
  assert.match(await page.innerText('.kvr-modal'), /Omfang: hele listen · 11 bonger · 9 flaggede/);
  const r1 = await makeReport('TEST-1', 'Rev Isor', 3);
  assert.match(r1.name, /^revisjonsrapport_\d{8}_\d{4}\.zip$/);
  assert.strictEqual(r1.zipHash, sha(r1.buf), 'kontrollsummen i panelet er SHA-256 av ZIP-filen');
  const names = Object.keys(r1.zip.files).filter(n => !r1.zip.files[n].dir).sort();
  assert.deepStrictEqual(names.filter(n => !n.startsWith('bevis/')), ['KONTROLLSUM.txt', 'data/flaggede_bonger.csv', 'data/funn.csv', 'data/innhold.json', 'data/kvitteringer.csv', 'innstillinger.json', 'rapport.html']);
  const pngs = names.filter(n => n.startsWith('bevis/'));
  assert.strictEqual(pngs.length, 3);
  for (const n of pngs) {
    const b = await r1.zip.file(n).async('nodebuffer');
    assert.strictEqual(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', n + ' er PNG');
    assert.ok(b.length > 2000, n + ' har innhold');
  }
  // hver linje i KONTROLLSUM.txt stemmer med filen
  const sums = (await r1.zip.file('KONTROLLSUM.txt').async('string')).trim().split('\n');
  assert.strictEqual(sums.length, names.length - 1);
  for (const l of sums) {
    const m = /^([0-9a-f]{64})  (.+)$/.exec(l);
    assert.ok(m, l);
    assert.strictEqual(sha(await r1.zip.file(m[2]).async('nodebuffer')), m[1], m[2]);
  }
  const rep1 = await r1.zip.file('rapport.html').async('string');
  const csv = await r1.zip.file('data/kvitteringer.csv').async('string');
  assert.ok(rep1.includes(sha(Buffer.from(csv, 'utf8'))), 'datasettets kontrollsum står i rapporten');
  assert.strictEqual(csv.trim().split('\r\n').length, 12, '11 kvitteringer og overskrift');
  for (const t of ['TEST-1', 'Rev Isor', 'Omfang', 'hele listen', 'Dekningsgrad', 'Skannet innhold: 8 av 8 salg (100 %)', 'Stor panteretur fra', 'Falsk retur', 'Salg etter kassaoppgjør', 'Hull i bongnummer', '1005-1-104', 'Til oppfølging', 'href="bevis/01_', 'sha256sum -c KONTROLLSUM.txt', 'Kvitteringshenter 3.10.0'])
    assert.ok(rep1.includes(t), 'rapporten mangler «' + t + '»');
  for (const p of pngs) assert.ok(rep1.includes('href="' + p + '"'), p + ' er lenket');
  const exported = JSON.parse(await r1.zip.file('innstillinger.json').async('string'));
  assert.strictEqual(exported.app, 'kvitteringshenter');
  assert.strictEqual(exported.ctl.diffTotal, '100');
  const flagged = await r1.zip.file('data/flaggede_bonger.csv').async('string');
  assert.ok(flagged.split('\r\n')[1].startsWith('1;Høy;10;1005-1-104'), 'rangert etter risiko');
  assert.ok(flagged.includes('oppfolging'), 'status fra notater er med');

  if (process.env.REPORT_OUT) {
    for (const n of names) { const f = path.join(process.env.REPORT_OUT, n); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, await r1.zip.file(n).async('nodebuffer')); }
  }

  // loggen i Eksport og versjon i hjelpen
  await go('Mer', 'Eksport');
  const logTxt = await page.innerText('[data-sec=auditrep]');
  assert.ok(logTxt.includes('TEST-1') && logTxt.includes(r1.zipHash.slice(0, 12)) && logTxt.includes('9 av 11'));
  assert.deepStrictEqual(await page.evaluate(() => JSON.parse(JSON.stringify(window.KvReport.VERSION))), '3.10.0');

  // innstillinger endret etter analysen: rapporten viser verdiene som ble brukt
  await go('Mer', 'Innstillinger');
  await page.click('[data-sec=set-diff] summary');
  await page.fill('[data-sec=set-diff] input[aria-label="Eller minus totalt over"]', '77');
  await page.press('[data-sec=set-diff] input[aria-label="Eller minus totalt over"]', 'Tab');
  await go('Mer', 'Eksport');
  await page.click('[data-sec=auditrep] button:text-is("Lag revisjonsrapport…")');
  assert.match(await page.innerText('.kvr-modal'), /Innstillingene er endret etter analysen/);
  assert.strictEqual(await page.inputValue('.kvr-modal input[placeholder="navn"]'), 'Rev Isor', 'navn huskes');
  const r2 = await makeReport('TEST-2', 'Rev Isor', 0);
  const rep2 = await r2.zip.file('rapport.html').async('string');
  assert.ok(rep2.includes('Eller minus totalt over: <b>100 kr</b>') && !rep2.includes('77 kr'), 'terskelen fra analysen, ikke den nye');
  assert.ok(rep2.includes('Innstillingene er endret etter analysen'));
  assert.ok(rep2.includes('Ingen bevis-PNG er tatt med.'));
  assert.ok(!Object.keys(r2.zip.files).some(n => n.startsWith('bevis/') && !r2.zip.files[n].dir));
  assert.strictEqual(JSON.parse(await r2.zip.file('innstillinger.json').async('string')).ctl.diffTotal, '100');
  assert.strictEqual(sha(await r2.zip.file('data/kvitteringer.csv').async('nodebuffer')), sha(await r1.zip.file('data/kvitteringer.csv').async('nodebuffer')), 'samme data gir samme kontrollsum');
  assert.strictEqual(sha(await r2.zip.file('data/innhold.json').async('nodebuffer')), sha(await r1.zip.file('data/innhold.json').async('nodebuffer')));
  assert.notStrictEqual(r2.zipHash, r1.zipHash);

  // innstillingsfilen fra rapporten kan leses inn igjen
  await go('Mer', 'Innstillinger');
  const sfile = path.join(os.tmpdir(), 'kvr-report-settings.json');
  fs.writeFileSync(sfile, await r1.zip.file('innstillinger.json').async('string'));
  await page.setInputFiles('[data-sec=set-general] input[type=file]', sfile);
  await page.waitForFunction(() => /Innstillingene er lest inn/.test(document.getElementById('kvr-panel').innerText));
  assert.strictEqual(await page.inputValue('[data-sec=set-diff] input[aria-label="Eller minus totalt over"]'), '100');

  // synlige-modus (Kontroll-knappen) gir egen beskrivelse av omfanget
  await go('Analyse', 'Detaljer');
  await page.click('button:text-is("Kjør alle kontroller (synlige)")');
  await page.waitForFunction(() => /Kontroller ferdig/.test(document.getElementById('kvr-panel').innerText) && /på 11 synlige/.test(document.getElementById('kvr-panel').innerText), null, { timeout: 40000 });
  await go('Mer', 'Eksport');
  await page.click('[data-sec=auditrep] button:text-is("Lag revisjonsrapport…")');
  const r3 = await makeReport('TEST-3', 'Rev Isor', 1);
  const rep3 = await r3.zip.file('rapport.html').async('string');
  assert.ok(rep3.includes('synlige kvitteringer i listen') && rep3.includes('Synlige kvitteringer i listen (filtre: ingen)'));
  assert.strictEqual(Object.keys(r3.zip.files).filter(n => n.startsWith('bevis/') && !r3.zip.files[n].dir).length, 1);

  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(apiCalls, [], 'pluginen skal aldri kalle CWs API');
  await browser.close();
  console.log('rapport: ok');
})().catch(e => { console.error(e); process.exit(1); });
