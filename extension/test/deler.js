const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

// «Hent og skann i deler»: dag for dag, dager som treffer grensen deles på klokkeslett, hver del skannes, radene samles.
// Den falske CW-siden kutter som CW (de nyeste først), men ved 50 bonger i stedet for 1000.
const CAP = 50;
const ROWS = [];
let n = 0;
const add = (day, tot, o, time) => {
  n++;
  const t = time || `${String(8 + (n % 12)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  ROWS.push(Object.assign({ transactionId: `1005-${1 + (n % 3)}-${n}`, endDateTime: `${day} ${t}`, storeNumber: 1005, workstationNumber: 1 + (n % 3), cashierNumber: 'K' + (n % 4),
    totalAmount: tot, receiptType: 1, saleChannel: 2, memberNumber: n % 5 === 0 ? 'M' + n : null, journalSourceName: 'main' }, o || {}));
};
for (let i = 0; i < 30; i++) add('2026-09-20', 20 + i);
// 120 bonger: travel formiddag (70 bonger 07:00–11:58), 49 bonger 12:00–21:48, én på nøyaktig 11:59 og ett kassaoppgjør uten beløp
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
for (let i = 0; i < 70; i++) add('2026-09-21', 10 + i, null, hm(420 + Math.floor(i * 4.2)));
add('2026-09-21', 55, null, '11:59');
for (let i = 0; i < 48; i++) add('2026-09-21', 30 + i, null, hm(720 + i * 12));
add('2026-09-21', null, { receiptType: 2 }, '21:58');
for (let i = 0; i < 20; i++) add('2026-09-22', 30 + i);
const TR = (a, c) => `<tr><td>${a}</td><td></td><td>${c}</td></tr>`;
const receipts = {};
ROWS.forEach((r) => { receipts[r.transactionId] = r.totalAmount === null ? `<table>${TR('Kontant:', '1000.00')}${TR('Sum', '1000.00')}</table>` : `<table>${TR('7038010000010 VARE', r.totalAmount.toFixed(2))}${TR('Bank:', r.totalAmount.toFixed(2))}</table>`; });

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<input id="fromDatePicker"><input id="toDatePicker"><input id="freetextSearchInput"><input id="receiptNumber">
<input ng-model="vm.selectedFilters.memberNumber"><input ng-model="vm.selectedFilters.externalLoyaltyNumber">
<input type="number" ng-model="vm.selectedFilters.sumMin"><input type="number" ng-model="vm.selectedFilters.sumMax">
<input id="fromTimePicker" data-role="timepicker"><input id="toTimePicker" data-role="timepicker">
<button ng-click="vm.resetFilters()">Nullstill</button><button ng-click="vm.applyFilters()" id="apply">Oppdater</button>
<div class="k-grid-header"><table><thead><tr><th>DATO</th><th>SUM</th></tr></thead></table></div>
<div id="g" data-role="grid"><table><tbody></tbody></table></div>
<iframe id="rc"></iframe>
<script>
var ALL=${JSON.stringify(ROWS)}, receipts=${JSON.stringify(receipts)}, CAP=${CAP};
window.__searches=[];
var tbody=document.querySelector('#g tbody'), handlers=[], data=[], uid=0, cur=null;
var grid={tbody:[tbody],dataSource:{data:function(){return data},view:function(){return data}},
  bind:function(n,f){if(n==='dataBound')handlers.push(f)},
  dataItem:function(tr){var u=tr.getAttribute('data-uid');return data.filter(function(d){return d.uid===u})[0]},
  select:function(tr){if(!arguments.length)return cur?[cur]:[];cur=tr;var d=grid.dataItem(tr);setTimeout(function(){document.getElementById('rc').contentDocument.body.innerHTML=receipts[d.transactionId]||''},5)},
  clearSelection:function(){cur=null}};
// __rawUtc: rådata i UTC uten tidssone (to timer før), cellen viser norsk tid, som i CW
function utc(s){var d=new Date(Date.UTC(+s.slice(0,4),+s.slice(5,7)-1,+s.slice(8,10),+s.slice(11,13)-2,+s.slice(14,16)));return d.toISOString().slice(0,16).replace('T',' ')}
function render(list){data=list.map(function(r){var o=Object.assign({uid:'u'+(++uid),__shown:r.__shown||r.endDateTime},r);if(window.__rawUtc&&!r.__shown)o.endDateTime=utc(r.endDateTime);return o});
  tbody.innerHTML=data.map(function(d){return '<tr data-uid="'+d.uid+'"><td data-field="endDateTime">'+d.__shown.slice(8,10)+'.'+d.__shown.slice(5,7)+'.'+d.__shown.slice(0,4)+' '+d.__shown.slice(11,16)+'</td><td>'+d.totalAmount+'</td></tr>'}).join('');
  handlers.forEach(function(f){f()})}
function iso(v){var m=/^(\\d{2})\\.(\\d{2})\\.(\\d{4})$/.exec(v||'');return m?m[3]+'-'+m[2]+'-'+m[1]:''}
function val(sel){return document.querySelector(sel).value}
// tidsfeltene som Kendo TimePicker: widgeten har verdien, feltet viser teksten
function tp(id){var n=document.getElementById(id),v=null;n.__w={kendoTimePicker:{value:function(x){if(!arguments.length)return v;v=x;n.value=x?String(x.getHours()).padStart(2,'0')+':'+String(x.getMinutes()).padStart(2,'0'):''},trigger:function(){}}}}
tp('fromTimePicker');tp('toTimePicker');
// som CWs ng-blur="vm.onFromTimeChange()": feiler når tiden er tom
window.__cwCrash=0;['fromTimePicker','toTimePicker'].forEach(function(id){var n=document.getElementById(id);n.addEventListener('blur',function(){if(!n.__w.kendoTimePicker.value())window.__cwCrash++})});
// datofeltene som Kendo DatePicker: som i CW følger søket widgetens verdi, ikke teksten i feltet
var p2=function(x){return String(x).padStart(2,'0')};
// som Kendo med min/max fra CW: fra kan ikke settes etter til, og til ikke før fra (verdien blir tom)
function dp(id,other,isFrom){var n=document.getElementById(id),v=null;n.__w={kendoDatePicker:{value:function(x){if(!arguments.length)return v;
    var o=document.getElementById(other).__w,ov=o&&o.kendoDatePicker.value();if(x&&ov&&(isFrom?x>ov:x<ov)){window.__clamped=(window.__clamped||0)+1;x=null}
    v=x;n.value=x?p2(x.getDate())+'.'+p2(x.getMonth()+1)+'.'+x.getFullYear():''},trigger:function(){}}};
  n.__set=function(t){var m=/^(\\d{2})\\.(\\d{2})\\.(\\d{4})$/.exec(t);n.__w.kendoDatePicker.value(m?new Date(+m[3],+m[2]-1,+m[1]):null)}}
dp('fromDatePicker','toDatePicker',true);dp('toDatePicker','fromDatePicker',false);
// setInputValue: Kendo leser teksten ved change, med samme grenser
['fromDatePicker','toDatePicker'].forEach(function(id){var n=document.getElementById(id);n.addEventListener('change',function(){var m=/^(\\d{2})\\.(\\d{2})\\.(\\d{4})$/.exec(n.value);var w=n.__w.kendoDatePicker,c=m?new Date(+m[3],+m[2]-1,+m[1]):null,cur=w.value();if(!cur||!c||cur.getTime()!==c.getTime())w.value(c)})});
function dval(id){var w=document.getElementById(id).__w.kendoDatePicker.value();return w?w.getFullYear()+'-'+p2(w.getMonth()+1)+'-'+p2(w.getDate()):''}
var mask=document.createElement('div');mask.className='k-loading-mask';mask.style.cssText='position:absolute;width:20px;height:20px;display:none';document.getElementById('g').appendChild(mask);
function search(){
  var f=window.__forceDay||dval('fromDatePicker'),t=window.__forceDay||dval('toDatePicker'),mn=val('[ng-model="vm.selectedFilters.sumMin"]'),mx=val('[ng-model="vm.selectedFilters.sumMax"]'),a=val('#fromTimePicker'),b=val('#toTimePicker');
  window.__searches.push({f:f,t:t,a:a,b:b,mn:mn,mx:mx,free:val('#freetextSearchInput')});
  if(window.__ignoreTime){a='';b=''}
  var list=ALL.filter(function(r){var d=r.endDateTime.slice(0,10),h=r.endDateTime.slice(11,16);return (!f||d>=f)&&(!t||d<=t)&&(!a||h>=a)&&(!b||h<=b)&&(mn===''||r.totalAmount>=Number(mn))&&(mx===''||r.totalAmount<=Number(mx))});
  list.sort(function(a,b){return a.endDateTime<b.endDateTime?1:-1});
  if(window.__noAnswerDay&&f===window.__noAnswerDay)return;
  // som CW: listen tømmes eller tegnes på nytt med gamle data (dataBound) før svaret kommer
  var slow=window.__slow||0;
  if(!slow){setTimeout(function(){render(list.slice(0,CAP))},20);return}
  if(window.__stray&&!document.getElementById('stray')){var x=document.createElement('div');x.id='stray';x.className='page-loading-bar';x.style.cssText='width:40px;height:10px';document.body.appendChild(x)}
  if(window.__noMask)setTimeout(function(){render(data.map(function(d){var c=Object.assign({},d);delete c.uid;return c}))},10);
  else{mask.style.display='block';setTimeout(function(){render([])},10)}
  setTimeout(function(){mask.style.display='none';render(list.slice(0,CAP))},slow)}
document.getElementById('apply').addEventListener('click',search);
function mk(list){return{each:function(fn){list.forEach(function(e,i){fn.call(e,i,e)})},eq:function(i){return mk([list[i]])},data:function(n){var e=list[0];return e&&e.__w?e.__w[n]:undefined}}}
document.getElementById('g').__w={kendoGrid:grid};
window.jQuery=function(a){return typeof a==='string'?mk([]):mk([a])};
document.querySelector('#fromDatePicker').__set('22.09.2026');document.querySelector('#toDatePicker').__set('22.09.2026');
document.querySelector('[ng-model="vm.selectedFilters.sumMin"]').value='5';
search();
</script></body></html>`;

(async () => {
  const dir = path.join(__dirname, '..');
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ locale: 'nb-NO' })).newPage();
  const errors = [], apiCalls = [];
  page.on('console', (m) => { if (/DBG/.test(m.text())) console.log(m.text()); });
  page.on('pageerror', (e) => { errors.push(e.message); console.error('PAGEERROR', e.message); });
  await page.addInitScript((cap) => { window.__kvrScan = { settle: 0, poll: 10 }; window.__kvrParts = { pause: 0, timeout: 1500, cut: cap }; window.__kvrCwx = { pause: 0, timeout: 1500 };
    window.__kvrSearch = { poll: 20, quiet: 100, empty: 300, same: 400, misfit: 600, stuck: 1000, busyOk: 200 }; }, CAP);
  await page.route('https://chainweb.coop.no/**', (r) => {
    if (r.request().url().indexOf('/Api/') !== -1) { apiCalls.push(r.request().url()); return r.fulfill({ status: 404, body: '' }); }
    return r.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
  });
  await page.goto('https://chainweb.coop.no/LindbakRetail_1/Journal/Viewer');
  for (const f of ['lib/html2canvas.min.js', 'lib/jszip.min.js', 'src/logic.js', 'src/report.js']) await page.addScriptTag({ path: path.join(dir, f) });
  await page.addStyleTag({ path: path.join(dir, 'src/panel.css') });
  await page.addScriptTag({ path: path.join(dir, 'src/content.js') });
  await page.waitForSelector('#kvr-panel');
  await page.waitForFunction(() => document.querySelectorAll('#g tbody td.kvr-cb-cell').length > 0);
  const go = async (main, sub) => { await page.click(`.kvr-tab:has-text("${main}")`); if (sub) await page.click(`.kvr-sub:text-is("${sub}")`); };
  const txt = async (sel) => (await page.innerText(sel)).replace(/\s+/g, ' ');
  const status = () => page.innerText('[data-sec=parts] [role=status]');
  const run = async () => {
    await page.evaluate(() => { document.querySelector('[data-sec=parts] [role=status]').textContent = ''; window.__searches = []; });
    await page.click('button:text-is("Hent og skann i deler")');
    await page.waitForFunction(() => /^(Ferdig|Stoppet)\./.test(document.querySelector('[data-sec=parts] [role=status]').innerText), null, { timeout: 120000 });
  };
  const sums = () => page.evaluate(() => ({ from: document.querySelector('#fromDatePicker').value, to: document.querySelector('#toDatePicker').value, min: document.querySelector('[ng-model="vm.selectedFilters.sumMin"]').value, max: document.querySelector('[ng-model="vm.selectedFilters.sumMax"]').value, a: document.querySelector('#fromTimePicker').value, b: document.querySelector('#toTimePicker').value }));
  const idb = (key) => page.evaluate((k) => new Promise((res) => { const rq = indexedDB.open('kvr-store'); rq.onsuccess = () => { const g = rq.result.transaction('kv').objectStore('kv').get(k); g.onsuccess = () => res(g.result); }; }), key);

  await go('Hent');
  // uten dato: sier fra
  await page.click('button:text-is("Hent og skann i deler")');
  assert.match(await status(), /Velg Dato fra og Dato til/);
  await page.evaluate(() => {
    const d = document.querySelectorAll('[data-sec=cw] input[type=date]');
    d[0].value = '2026-09-20'; d[0].dispatchEvent(new Event('change', { bubbles: true }));
    d[1].value = '2026-09-22'; d[1].dispatchEvent(new Event('change', { bubbles: true }));
  });
  const before = await sums();
  await run();
  const s1 = await page.evaluate(() => window.__searches);
  const parts = s1.slice(0, -1);
  // dag 20 og 22 i ett søk; dag 21 kuttes og deles på klokkeslett, og den travle formiddagen deles en gang til
  assert.deepStrictEqual(parts.map((x) => [x.f, x.a, x.b]), [
    ['2026-09-20', '00:00', '23:59'],
    ['2026-09-21', '00:00', '23:59'], ['2026-09-21', '00:00', '11:59'], ['2026-09-21', '00:00', '05:59'], ['2026-09-21', '05:58', '11:59'], ['2026-09-21', '05:58', '08:58'], ['2026-09-21', '08:57', '11:59'],
    ['2026-09-21', '11:58', '23:59'], ['2026-09-21', '11:58', '17:58'], ['2026-09-21', '17:57', '23:59'],
    ['2026-09-22', '00:00', '23:59']
  ]);
  assert.ok(parts.every((x) => x.free === '' && x.mn === '' && x.mx === ''), 'aldri fritekst, og beløp brukes ikke');
  // tomme tidsfelt blir hele døgnet: CW feiler på tom tid
  const after = Object.assign({}, before, { a: '00:00', b: '23:59' });
  assert.deepStrictEqual(await sums(), after, 'søket ditt er satt tilbake');
  assert.match(await status(), /^Ferdig\. 11 søk, 170 bonger hentet, 170 skannet\. Samlet grunnlag: 170 bonger\./);
  const info = await txt('[data-sec=parts]');
  assert.match(info, /Samlet grunnlag: 170 bonger fra 3 dager \(2026-09-20 – 2026-09-22\), 170 skannet\./);
  assert.match(info, /2026-09-20: 30 bonger · 2026-09-21: 120 bonger · 2026-09-22: 20 bonger/);
  const day21 = await idb('kvr.arch.v1:2026-09-21');
  assert.strictEqual(day21.rows.length, 120);
  assert.ok(day21.rows.every((r) => !('memberNumber' in r)), 'medlemsnummer lagres ikke');
  assert.ok(day21.rows.some((r) => r.endDateTime.indexOf('2026-09-21 11:59') === 0), 'bongen på grensen er med');
  assert.ok(day21.rows.some((r) => r.receiptType === 2), 'kassaoppgjør uten beløp er med');

  // analysen bruker samlet grunnlag sammen med listen
  await go('Analyse', 'Sjekk først');
  await page.click('[data-sec=chk-top] button:text-is("Kjør analyse")');
  await page.waitForFunction(() => /Kontroller ferdig/.test(document.getElementById('kvr-panel').innerText), null, { timeout: 60000 });
  assert.match(await page.evaluate(() => document.getElementById('kvr-panel').textContent), /→ 170 av 170 kvitteringer \(listen og samlet grunnlag\)/);

  // ny kjøring: dagene er hentet før og hoppes over
  await go('Hent');
  await run();
  assert.match(await status(), /^Ferdig\. 0 søk, 0 bonger hentet, 3 dager hentet før\./);
  assert.strictEqual((await page.evaluate(() => window.__searches)).length, 1, 'bare søket ditt tilbake');

  // CW bruker ikke klokkeslett-feltene: dagen kuttes, og det står tydelig
  await page.click('[data-sec=parts] button:text-is("Tøm samlet grunnlag")');
  await page.click('.kvr-modal button:text-is("Tøm")');
  await page.evaluate(() => { window.__ignoreTime = true; });
  await run();
  const s3 = (await page.evaluate(() => window.__searches)).slice(0, -1).map((x) => x.f + ' ' + x.a + '–' + x.b);
  assert.deepStrictEqual(s3, ['2026-09-20 00:00–23:59', '2026-09-21 00:00–23:59', '2026-09-21 00:00–11:59', '2026-09-22 00:00–23:59']);
  assert.match(await txt('[data-sec=parts]'), /CW brukte ikke klokkeslett-feltene for 2026-09-21 \(bonger utenfor 00:00–11:59\)\. Dagen er kuttet ved 1000 bonger\./);
  assert.match(await txt('[data-sec=parts]'), /Kuttet ved 1000: 2026-09-21/);

  // CW svarer ikke: kjøringen stopper, dagen fortsetter neste gang, og søket ditt settes tilbake
  await page.click('[data-sec=parts] button:text-is("Tøm samlet grunnlag")');
  await page.click('.kvr-modal button:text-is("Tøm")');
  await page.evaluate(() => { window.__ignoreTime = false; window.__noAnswerDay = '2026-09-21'; });
  await run();
  assert.match(await txt('[data-sec=parts]'), /CW svarte ikke på søket for 2026-09-21 \(hele dagen\) innen 2 s\. Kjøringen ble stoppet; start igjen senere, så fortsetter den der den slapp\./);
  const s4 = (await page.evaluate(() => window.__searches)).map((x) => x.f);
  assert.deepStrictEqual(s4, ['2026-09-20', '2026-09-21', before.from.split('.').reverse().join('-')], 'ingen søk etter stoppen, bortsett fra søket tilbake');
  assert.deepStrictEqual(await sums(), after);
  await page.evaluate(() => { window.__noAnswerDay = ''; });
  await run();
  assert.deepStrictEqual((await page.evaluate(() => window.__searches)).slice(0, -1).map((x) => x.f).filter((v, i, a) => a.indexOf(v) === i), ['2026-09-21', '2026-09-22'], 'fortsetter der den slapp');

  // CW tømmer listen og viser et lastesymbol før svaret kommer: pluginen venter på svaret
  for (const mode of [{ slow: 300 }, { slow: 300, noMask: true }, { slow: 300, rawUtc: true }, { slow: 300, stray: true }]) {
    await page.click('[data-sec=parts] button:text-is("Tøm samlet grunnlag")');
    await page.click('.kvr-modal button:text-is("Tøm")');
    await page.evaluate((m) => { window.__slow = m.slow; window.__noMask = !!m.noMask; window.__rawUtc = !!m.rawUtc; window.__stray = !!m.stray; const x = document.getElementById('stray'); if (x) x.remove(); }, mode);
    const tRun = Date.now();
    await run();
    assert.ok(Date.now() - tRun < 30000, 'ingen lang venting: ' + (Date.now() - tRun) + ' ms ' + JSON.stringify(mode));
    assert.match(await status(), /^Ferdig\. 11 søk, 170 bonger hentet\. Samlet grunnlag: 170 bonger\.$/, JSON.stringify(mode) + ' ' + await txt('[data-sec=parts]'));
    assert.strictEqual((await idb('kvr.arch.v1:2026-09-21')).rows.length, 120);
    assert.strictEqual((await idb('kvr.arch.v1:2026-09-20')).rows.length, 30);
    assert.match(await txt('[data-sec=parts]'), /Søkene mot CW \(11\)/);
  }
  await page.evaluate(() => { window.__slow = 0; window.__noMask = false; window.__rawUtc = false; window.__stray = false; const x = document.getElementById('stray'); if (x) x.remove(); });

  assert.strictEqual(await page.evaluate(() => window.__clamped || 0), 0, 'fra ble aldri satt etter til');

  // CW viser en annen dag enn den som ble søkt på: stopper uten å lagre
  await page.click('[data-sec=parts] button:text-is("Tøm samlet grunnlag")');
  await page.click('.kvr-modal button:text-is("Tøm")');
  await page.evaluate(() => { window.__forceDay = '2026-09-22'; });
  await run();
  assert.match(await txt('[data-sec=parts]'), /Listen i CW viser 2026-09-22, ikke 2026-09-20 som det ble søkt på\. Datofeltet i CW ble trolig ikke satt/);
  assert.strictEqual(await idb('kvr.arch.v1:2026-09-20'), undefined, 'ingenting lagret');
  await page.evaluate(() => { window.__forceDay = ''; });

  // CW godtar ikke datoen i feltet: stopper før søket, med hva feltet viser
  await page.evaluate(() => { const w = document.getElementById('fromDatePicker').__w.kendoDatePicker, set = w.value; w.value = function (x) { if (!arguments.length) return set(); set(new Date(2026, 8, 22)); }; });
  const nBefore = await page.evaluate(() => window.__searches.length);
  await run();
  assert.match(await txt('[data-sec=parts]'), /CW godtok ikke 2026-09-20 hele dagen i søkefeltene \(Dato fra viser 2026-09-22, Dato til viser tomt\)\. Kjøringen ble stoppet; ingenting fra dette søket er lagret\./);
  assert.strictEqual((await page.evaluate(() => window.__searches)).length, 1, 'bare søket ditt tilbake, ingen søk med feil dato');

  assert.strictEqual(await page.evaluate(() => window.__cwCrash), 0, 'CW fikk aldri tom tid');
  assert.deepStrictEqual(apiCalls, []);
  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('deler: ok');
})().catch((e) => { console.error(e); process.exit(1); });
