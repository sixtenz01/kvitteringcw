const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

// «Hent tilleggsdata fra CW»: pluginen huker av CWs filtre ett om gangen, trykker Oppdater og noterer bongene.
// Den falske CW-siden har filtertrær som i Kendo (avkrysning med barn), betalingsfilter og en liste som filtreres ved Oppdater.
const E1 = '7038010000010', E2 = '7038010000027', JB = '7038010000034';
const ROWS = [];
let n = 100;
const add = (o) => {
  n++;
  ROWS.push(Object.assign({ transactionId: `1005-${o.workstationNumber || 1}-${n}`, endDateTime: '2026-10-22 10:00', storeNumber: 1005, workstationNumber: 1, cashierNumber: 'A',
    totalAmount: 50, receiptType: 1, saleChannel: 2, memberNumber: null, journalSourceName: 'main', leaf: 'Salg', content: [], pay: [5], lines: [[E2, 'MELK 1L', 50]] }, o));
};
const two = (x) => String(x).padStart(2, '0');
// fire betjente kasserere med 30 salg hver; C har slettet vare på 8 bonger, de andre på én
['A', 'B', 'C', 'D'].forEach((c, k) => {
  for (let i = 0; i < 30; i++) {
    const content = i < (c === 'C' ? 8 : 1) ? ['Slettet vare'] : [];
    if (c === 'A' && i === 0) content.push('Vensafe');
    add({ cashierNumber: c, workstationNumber: k + 1, endDateTime: `2026-10-22 ${two(8 + Math.floor(i / 4))}:${two((i % 4) * 15)}`, content, pay: c === 'B' && i < 2 ? [2] : [5] });
  }
});
// selvbetjent kasse
for (let i = 0; i < 10; i++) add({ cashierNumber: 'S', workstationNumber: 21, saleChannel: 3, endDateTime: `2026-10-22 11:${two(i * 5)}` });
// opprinnelig bong 4711 og retur av samme vare etter bongkopi
ROWS.push(Object.assign({}, ROWS[0], { transactionId: '1005-1-4711', endDateTime: '2026-10-21 12:00', totalAmount: 89.9, content: [], lines: [[E1, 'RØKELAKS', 89.9]] }));
add({ cashierNumber: 'B', workstationNumber: 2, endDateTime: '2026-10-22 14:30', totalAmount: -89.9, content: ['Returnert vare'], lines: [[E1, 'RØKELAKS', -89.9]] });
// kort innlogging med retur på kasse 5
add({ cashierNumber: 'X', workstationNumber: 5, endDateTime: '2026-10-22 13:03', totalAmount: -45, content: ['Returnert vare'], lines: [[E2, 'OST', -45]] });
// synlig svinn fra PDA (Brekasje i CWs filter)
add({ cashierNumber: 'P', workstationNumber: 77, endDateTime: '2026-10-22 09:01', totalAmount: 1539.1, receiptType: 11, saleChannel: 1, leaf: 'Varetransaksjoner → Brekasje', pay: [], lines: [[JB, 'JORDBÆR 500G', 1539.1]] });
// systembonger: innlogging, utlogging, bongkopi og dagsavslutning (bare med når Systemtransaksjoner er huket av)
const sys = (o) => add(Object.assign({ receiptType: 8, saleChannel: 1, totalAmount: null, leaf: 'Systemtransaksjoner → Annet', pay: [], lines: null }, o));
sys({ cashierNumber: 'X', workstationNumber: 5, endDateTime: '2026-10-22 13:00' });
sys({ cashierNumber: 'X', workstationNumber: 5, endDateTime: '2026-10-22 13:06', receiptType: 9 });
sys({ cashierNumber: 'A', workstationNumber: 1, endDateTime: '2026-10-22 07:55' });
sys({ cashierNumber: 'B', workstationNumber: 2, endDateTime: '2026-10-22 14:10', receiptType: 19, text: '<div>Coop Mega Kolbotn</div><div>Kvittering: 9001 22.10.2026 14:10:00</div><div>BONGKOPI (4711)</div>' });
sys({ cashierNumber: 'A', workstationNumber: 1, endDateTime: '2026-10-22 23:59', receiptType: 7, leaf: 'Systemtransaksjoner → EOD kvittering', text: '<div>EOD 2026-10-22</div>' });

const TR = (a, c) => `<tr><td>${a}</td><td></td><td>${c}</td></tr>`;
const receipts = {};
ROWS.forEach((r) => {
  receipts[r.transactionId] = r.lines ? `<div>Butikk: 1005, Kassenr: ${r.workstationNumber}, Kasserer: ${r.cashierNumber}</div><div>Kvittering: ${String(r.transactionId).split('-')[2]} 22.10.2026 10:00:00</div><table>` +
    r.lines.map((l) => TR(`${l[0]} ${l[1]}`, l[2].toFixed(2))).join('') + TR('', 'Totalt', r.totalAmount.toFixed(2)).replace('<td></td><td>Totalt</td>', '<td>Totalt</td><td></td>') + TR('Bank:', r.totalAmount.toFixed(2)) + '</table>' : r.text;
});
const rows = ROWS.map((r) => { const o = Object.assign({}, r); delete o.lines; delete o.text; return o; });

const node = (name, kids, on) => `<li class="k-item"><div class="k-mid"><span class="k-checkbox-wrapper"><input type="checkbox" class="k-checkbox"${on ? ' checked' : ''}><span class="k-checkbox-label"></span></span><span class="k-in">${name}</span></div>${kids ? '<ul class="k-group">' + kids.map((k) => node(k, null, on)).join('') + '</ul>' : ''}</li>`;
const CONTENT = [['Spør pris'], ['Makulerte bonger', ['System', 'Manuell']], ['Pant', ['Skannet vare', 'Manuell']], ['Slettet vare'], ['Slettet annet'], ['Manuell rabatt'], ['Parkert bong'], ['Returnert vare'], ['Vensafe']];
const TYPES = [['Oppgjør', null, 1], ['Kasseskuff', ['Dropp', 'Innbetaling', 'Utbetaling'], 1], ['Varetransaksjoner', ['Brekasje', 'Internt forbruk'], 1], ['Salg', null, 1], ['Systemtransaksjoner', ['Bankavstemming', 'EOD kvittering', 'Annet'], 0]];

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<input id="fromDatePicker"><input id="toDatePicker"><input id="freetextSearchInput"><input id="receiptNumber">
<input ng-model="vm.selectedFilters.memberNumber"><input ng-model="vm.selectedFilters.externalLoyaltyNumber">
<div id="salesGroup"><select id="paymentMethods" multiple></select></div>
<div id="contentGroup"><div id="contentFilterTreeView" data-role="treeview"><ul>${CONTENT.map((c) => node(c[0], c[1], false)).join('')}</ul></div></div>
<div id="receiptTypeGroup"><div data-role="treeview"><ul>${TYPES.map((c) => node(c[0], c[1], !!c[2])).join('')}</ul></div></div>
<button ng-click="vm.resetFilters()">Nullstill</button><button ng-click="vm.applyFilters()" id="apply">Oppdater</button>
<div class="k-grid-header"><table><thead><tr><th>DATO</th><th>SUM</th></tr></thead></table></div>
<div id="g" data-role="grid"><table><tbody></tbody></table></div>
<iframe id="rc"></iframe>
<script>
var ALL=${JSON.stringify(rows)}, receipts=${JSON.stringify(receipts)};
window.__searches=[];
// avkrysning som Kendo med checkChildren: barna følger forelderen, forelderen er huket av når alle barna er det
document.addEventListener('change', function (e) {
  var cb = e.target; if (!cb.classList || !cb.classList.contains('k-checkbox')) return;
  var li = cb.closest('li');
  li.querySelectorAll('li input.k-checkbox').forEach(function (x) { x.checked = cb.checked; x.indeterminate = false; });
  cb.indeterminate = false;
  var up = li.parentElement.closest('li');
  while (up) {
    var kids = Array.prototype.map.call(up.querySelectorAll(':scope > ul > li > div input.k-checkbox'), function (x) { return x; });
    var all = kids.every(function (x) { return x.checked; }), none = kids.every(function (x) { return !x.checked && !x.indeterminate; });
    var pc = up.querySelector(':scope > div input.k-checkbox'); pc.checked = all; pc.indeterminate = !all && !none;
    up = up.parentElement.closest('li');
  }
});
function leaves(root) {
  return Array.prototype.filter.call(root.querySelectorAll('li'), function (li) { return !li.querySelector('li') && li.querySelector(':scope > div input').checked; }).map(function (li) {
    var up = li.parentElement.closest('li'), t = li.querySelector('.k-in').textContent;
    return (up ? up.querySelector(':scope > div .k-in').textContent + ' → ' : '') + t;
  });
}
var pmVal = [];
var pm = { value: function (v) { if (!arguments.length) return pmVal.slice(); pmVal = v.slice(); }, trigger: function () {}, options: { dataValueField: 'number', dataTextField: 'text' },
  dataSource: { data: function () { return [{ text: 'Kontant', number: 1 }, { text: 'Kontant tilbake', number: 2 }, { text: 'Kreditt', number: 4 }, { text: 'Bank', number: 5 }]; } } };
var tbody = document.querySelector('#g tbody'), handlers = [], data = [], uid = 0, cur = null;
var grid = { tbody: [tbody], dataSource: { data: function () { return data; }, view: function () { return data; } },
  bind: function (n, f) { if (n === 'dataBound') handlers.push(f); },
  dataItem: function (tr) { var u = tr.getAttribute('data-uid'); return data.filter(function (d) { return d.uid === u; })[0]; },
  select: function (tr) { if (!arguments.length) return cur ? [cur] : []; cur = tr; var d = grid.dataItem(tr); setTimeout(function () { document.getElementById('rc').contentDocument.body.innerHTML = receipts[d.transactionId] || ''; }, 5); },
  clearSelection: function () { cur = null; } };
function render(list) {
  data = list.map(function (r) { return Object.assign({ uid: 'u' + (++uid) }, r); });
  tbody.innerHTML = data.map(function (d) { return '<tr data-uid="' + d.uid + '"><td data-field="endDateTime">' + d.endDateTime + '</td><td>' + d.totalAmount + '</td></tr>'; }).join('');
  handlers.forEach(function (f) { f(); });
}
function search() {
  var c = leaves(document.getElementById('contentFilterTreeView')), t = leaves(document.querySelector('#receiptTypeGroup [data-role=treeview]')), p = pm.value();
  if (window.__ignoreContent) c = [];
  window.__searches.push({ c: c.join(','), t: t.length, p: p.join(',') });
  var list = ALL.filter(function (r) {
    return t.indexOf(r.leaf) !== -1 && (!c.length || r.content.some(function (x) { return c.indexOf(x) !== -1; })) && (!p.length || r.pay.some(function (x) { return p.indexOf(x) !== -1; }));
  });
  if (window.__noAnswer && p.indexOf(window.__noAnswer) !== -1) return;
  setTimeout(function () { render(list); }, 20);
}
document.getElementById('apply').addEventListener('click', search);
function mk(list) { return { each: function (fn) { list.forEach(function (e, i) { fn.call(e, i, e); }); }, eq: function (i) { return mk([list[i]]); }, data: function (n) { var e = list[0]; return e && e.__w ? e.__w[n] : undefined; } }; }
document.getElementById('g').__w = { kendoGrid: grid };
document.getElementById('paymentMethods').__w = { kendoMultiSelect: pm };
window.jQuery = function (a) { return typeof a === 'string' ? mk([]) : mk([a]); };
search();
</script></body></html>`;

(async () => {
  const dir = path.join(__dirname, '..');
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ locale: 'nb-NO' })).newPage();
  const errors = [], apiCalls = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.error('PAGEERROR', e.message); });
  await page.addInitScript(() => { window.__kvrScan = { settle: 0, poll: 10 }; window.__kvrCwx = { pause: 0, timeout: 1500 }; });
  await page.route('https://chainweb.coop.no/**', (r) => {
    if (r.request().url().indexOf('/Api/') !== -1) { apiCalls.push(r.request().url()); return r.fulfill({ status: 404, body: '' }); }
    return r.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
  });
  await page.goto('https://chainweb.coop.no/LindbakRetail_1/Journal/Viewer');
  for (const f of ['lib/html2canvas.min.js', 'lib/jszip.min.js', 'src/logic.js', 'src/report.js']) await page.addScriptTag({ path: path.join(dir, f) });
  await page.addStyleTag({ path: path.join(dir, 'src/panel.css') });
  await page.addScriptTag({ path: path.join(dir, 'src/content.js') });
  await page.waitForSelector('#kvr-panel');
  const go = async (main, sub) => { await page.click(`.kvr-tab:has-text("${main}")`); if (sub) await page.click(`.kvr-sub:text-is("${sub}")`); };
  const txt = async (sel) => (await page.innerText(sel)).replace(/\s+/g, ' ');
  const state = () => page.evaluate(() => ({
    content: Array.prototype.map.call(document.querySelectorAll('#contentFilterTreeView input'), (x) => x.checked),
    types: Array.prototype.map.call(document.querySelectorAll('#receiptTypeGroup input'), (x) => x.checked),
    pay: pm.value(), rows: document.querySelectorAll('#g tbody tr').length, cells: document.querySelectorAll('#g tbody td.kvr-cb-cell').length
  }));
  await page.waitForFunction(() => document.querySelectorAll('#g tbody td.kvr-cb-cell').length > 0);
  const before = await state();
  const baseN = rows.filter((r) => r.leaf !== 'Systemtransaksjoner → Annet' && r.leaf !== 'Systemtransaksjoner → EOD kvittering').length;
  assert.strictEqual(before.rows, baseN);

  // ---- henting
  await go('Hent');
  await page.click('button:text-is("Hent tilleggsdata fra CW")');
  await page.waitForFunction(() => /Tilleggsdata fra CW: \d+ søk/.test(document.getElementById('kvr-panel').innerText), null, { timeout: 60000 });
  const searches = await page.evaluate(() => window.__searches.slice(1));
  // 11 innholdsvalg, 3 betalingsmåter (bank hentes ikke), systembongene og søket ditt tilbake
  assert.strictEqual(searches.length, 11 + 3 + 1 + 1, JSON.stringify(searches));
  assert.deepStrictEqual(searches.slice(0, 11).map((s) => s.c), ['Spør pris', 'Makulerte bonger → System', 'Makulerte bonger → Manuell', 'Pant → Skannet vare', 'Pant → Manuell', 'Slettet vare', 'Slettet annet', 'Manuell rabatt', 'Parkert bong', 'Returnert vare', 'Vensafe']);
  assert.ok(searches.slice(0, 11).every((s) => s.p === '' && s.t === 7), 'bare innholdsfilteret endres i innholdssøkene ' + JSON.stringify(searches.slice(0, 11)));
  assert.deepStrictEqual(searches.slice(11, 14).map((s) => [s.c, s.p]), [['', '1'], ['', '2'], ['', '4']]);
  assert.strictEqual(searches[14].t, 3, 'bare systemtransaksjonene');
  const after = await state();
  assert.deepStrictEqual(after.content, before.content, 'innholdsfilteret satt tilbake');
  assert.deepStrictEqual(after.types, before.types, 'bongtypefilteret satt tilbake');
  assert.deepStrictEqual(after.pay, before.pay, 'betalingsfilteret satt tilbake');
  assert.strictEqual(after.rows, baseN); assert.strictEqual(after.cells, baseN, 'pluginen er koblet til listen igjen');
  const cw = await txt('[data-sec=cw]');
  assert.match(cw, /Slettet vare: 11 · Slettet annet: 0/);
  assert.match(cw, /Betaling: Kontant tilbake: 2/);
  assert.match(cw, /Systemtransaksjoner: 5/);
  assert.ok(!/kvr-cwx-err/.test(await page.innerHTML('[data-sec=cw]')), 'ingen merknader');
  const saved = await page.evaluate(() => new Promise((res) => { const rq = indexedDB.open('kvr-store'); rq.onsuccess = () => { const g = rq.result.transaction('kv').objectStore('kv').get('kvr.cwx.v1'); g.onsuccess = () => res(g.result); }; }));
  assert.deepStrictEqual(saved.copies, { [rows.find((r) => r.receiptType === 19).transactionId]: '4711' }, 'bongkopien er lest fra visningsfeltet');
  assert.strictEqual(saved.sys.length, 5);
  assert.deepStrictEqual(saved.tags['1005-1-101'].sort(), ['Slettet vare', 'Vensafe']);

  // ---- analysen bruker dataene
  await go('Analyse', 'Sjekk først');
  await page.click('[data-sec=chk-top] button:text-is("Kjør analyse")');
  await page.waitForFunction(() => /Kontroller ferdig/.test(document.getElementById('kvr-panel').innerText), null, { timeout: 60000 });
  await go('Analyse', 'Detaljer');
  await page.click('button:text-is("Åpne alle")');
  const fnd = await txt('[data-sec=findings]');
  assert.match(fnd, /Fra CW: Mye av ett innhold hos kasserer Kasserer C: Slettet vare på 8 av 30 salg \(26,7 %, de andre i kanalen 3,2 %\)/);
  assert.match(fnd, /Fra CW: Kombinasjon av innhold på bong Kasse 1 08:00 kasserer A: vensafe \+ slettet vare \(ifølge CWs filtre\)/);
  assert.match(fnd, /Innlogging: Kort innlogging med retur eller sletting Kasserer X logget inn på kasse 5 2026-10-22 kl\. 13:00 og var logget inn i 6 min/);
  assert.match(fnd, /Bongkopi: Bongkopi fulgt av retur Kasse 2 14:30 kasserer B: retur 89\.90 kr etter bongkopi 2026-10-22 14:10 på kasse 2 \(kasserer B\) av bong 4711: «RØKELAKS» \(7038010000010\) står også på den opprinnelige bongen/);
  assert.match(fnd, /Svinn: Stort svinn på én registrering Synlig svinn Kasse 77 09:01 kasserer P, 1539\.10 kr/);
  const card = await txt('[data-sec=cwx]');
  assert.match(card, /Innhold og betaling ifølge CWs filtre/);
  assert.match(card, /Innlogging og utlogging 2 innlogginger og 1 utlogginger gir 2 økter/);
  assert.match(card, /Bongkopier 1 bongkopier\. 1 av de opprinnelige bongene står i listen\. 1 kopier er fulgt av en retur\./);
  assert.match(card, /Synlig svinn og internt forbruk 1 registreringer, til sammen 1 539,10 kr/);
  // kassererprofilen viser kanal når det er flere
  assert.match(await txt('[data-sec=profile]'), /Snitt selvbetjent \(shop&go\)/);

  // ---- CW bruker ikke innholdsfilteret: resten av innholdssøkene hoppes over, og det sies tydelig
  const clearStatus = () => page.evaluate(() => { document.querySelector('[data-sec=cw] [role=status]').textContent = ''; });
  await page.evaluate(() => { window.__ignoreContent = true; window.__searches = []; });
  await go('Hent');
  await clearStatus();
  await page.click('button:text-is("Hent tilleggsdata fra CW")');
  await page.waitForFunction(() => /Tilleggsdata fra CW: \d+ søk/.test(document.querySelector('[data-sec=cw] [role=status]').innerText), null, { timeout: 60000 });
  assert.match(await txt('[data-sec=cw]'), /CW brukte ikke filteret «Spør pris» \(samme bonger som uten filter\)\. Resten av innholdsfilteret ble hoppet over\./);
  assert.strictEqual(await page.evaluate(() => window.__searches.length), 1 + 3 + 1 + 1);

  // ---- CW svarer ikke: kjøringen stopper, og filtrene settes tilbake
  await page.evaluate(() => { window.__ignoreContent = false; window.__noAnswer = 2; window.__searches = []; });
  await clearStatus();
  await page.click('button:text-is("Hent tilleggsdata fra CW")');
  await page.waitForFunction(() => /Tilleggsdata fra CW: \d+ søk/.test(document.querySelector('[data-sec=cw] [role=status]').innerText), null, { timeout: 60000 });
  assert.match(await txt('[data-sec=cw]'), /CW svarte ikke på søket «Betaling: Kontant tilbake» innen 2 s\. Kjøringen ble stoppet\./);
  const s3 = await page.evaluate(() => window.__searches.map((s) => s.p));
  assert.deepStrictEqual(s3.slice(-3), ['1', '2', ''], 'ingen søk etter stoppen, bortsett fra søket tilbake');
  const back = await state();
  assert.deepStrictEqual([back.content, back.types, back.pay, back.rows], [before.content, before.types, before.pay, baseN]);

  assert.deepStrictEqual(apiCalls, []);
  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('cwhent: ok');
})().catch((e) => { console.error(e); process.exit(1); });
