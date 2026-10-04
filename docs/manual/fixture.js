'use strict';
// Fiktivt datasett og en enkel etterligning av Chain Web-siden, brukt til skjermbildene i brukerveiledningen.
// Alle butikker, kasserere og bonger er oppdiktet. Avvikene er plantet med vilje (se PLANTED).

function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STORES = { 1001: 'Eksempel Sentrum', 1002: 'Eksempel Torget' };
const DAYS = ['2026-09-29', '2026-09-30', '2026-10-01'];
const CATALOG = [
  ['7038010002274', 'BIOLA JORDBÆR 1000G', 39.9], ['7044610877488', 'PEPSI MAX 0.5L', 32.9, true], ['7025110196576', 'COOP FROKOSTEGG 6PK', 31.9],
  ['7340191181243', 'COOP COLOR 1000ML', 20], ['7044416015367', 'REGAL HVETEMEL 1KG', 20.5], ['7330196001042', 'SKRUF NO4 FRESH S4', 101.9],
  ['7071862047727', 'LINEA GAVEBÅND 20M', 8.72], ['7035620058783', 'TINE LETTMELK 1L', 21.9], ['7040913336684', 'COOP KAFFE 500G', 54.9],
  ['7311041012582', 'PRINGLES ORIGINAL', 29.9], ['7090039310182', 'FLØTEBOLLER 4PK', 36.5], ['7044610871233', 'COCA-COLA 0.5L', 28.9, true]
];
const CAMPAIGNS = [
  ['1ESD2LJ54XDMBB6F', 'COOP FROKOSTEGG FRITTG. 12PK L'], ['1ESD2P6DRVPCCJY1', 'Gruppe - Coop koppnudler, 65 g'],
  ['1ESD2QPUH6SUM2QH', 'Gruppe - Coop D ferdigretter, 300-350 g'], ['1ESD2TCL2ANF9LV8', 'GRUPPE 240 - Coop knekkebrød 170-320 g']
];
const OPEN_FROM = 7 * 60, CLOSE = 22 * 60;

const T = (a, c) => `<tr><td>${a}</td><td></td><td>${c}</td></tr>`;
const SPAN = (t) => `<tr><td colspan="3">${t}</td></tr>`;
const TOT = (s) => `<tr><td></td><td>Totalt</td><td>${s}</td></tr>`;
const f2 = (n) => n.toFixed(2);
const r2 = (n) => Math.round(n * 100) / 100;
const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

function build(scale) {
  scale = scale || 1;
  const rnd = rng(20261002);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const events = {}; // "store|ws|day" -> [ev]
  const push = (store, ws, day, ev) => { (events[store + '|' + ws + '|' + day] = events[store + '|' + ws + '|' + day] || []).push(Object.assign({ store, ws, day }, ev)); };
  const cashierFor = (store, ws, m) => store === 1002 ? (ws === 1 ? '4201' : '4202') : ws === 1 ? (m < 15 * 60 ? '4101' : '4102') : ws === 2 ? '4103' : '4101';
  const randTime = () => {
    const x = rnd();
    const m = x < 0.35 ? 11 * 60 + rnd() * 120 : x < 0.7 ? 16 * 60 + rnd() * 150 : OPEN_FROM + rnd() * (CLOSE - 10 - OPEN_FROM);
    return Math.floor(m);
  };

  function saleLines(o) {
    o = o || {};
    const n = 1 + Math.floor(rnd() * 4);
    const lines = []; let total = 0, disc = null;
    for (let i = 0; i < n; i++) {
      const it = o.items ? o.items[i] : pick(CATALOG);
      if (!it) break;
      let price = it[2], d = null;
      if (i === 0 && (o.discount || (!o.items && rnd() < 0.07))) {
        const dd = o.discount || { pct: pick([20, 30, 50]), reason: pick(['Datovare', 'Best før', 'Datovare']) };
        d = r2(price * dd.pct / 100); disc = dd; price = r2(price - d);
      }
      lines.push(T(`${it[0]} ${it[1]}`, f2(price)));
      total += price;
      if (d !== null) { lines.push(SPAN(`Rabatt: Kr ${f2(d)} (${f2(disc.pct).replace('.00', '.0')}%)`)); lines.push(SPAN(`Rabatt årsak: ${disc.reason}`)); }
      if (it[3]) { lines.push(T('220 PANT', '2.00')); total += 2; }
    }
    if (!o.noCoupons && rnd() < 0.3) { for (let k = 0; k < 1 + Math.floor(rnd() * 3); k++) { const c = pick(CAMPAIGNS); lines.push(T(`Kupong (${c[0]} - ${c[1]}):`, '0.00')); } }
    total = r2(total);
    lines.splice(lines.length, 0, TOT(f2(total)));
    const pay = o.pay || (rnd() < 0.75 ? 'Bank' : 'Kontant');
    lines.push(T(pay + ':', f2(total)));
    if (pay === 'Bank') {
      lines.push(T('Referanse: ' + (10000 + Math.floor(rnd() * 80000)), ''));
      lines.push(SPAN('TransId: ' + (o.transId || 'DK' + Math.floor(rnd() * 1e9).toString(36).toUpperCase().padStart(6, '0') + 'F2')));
    }
    const g = r2(total / 1.25);
    lines.push(`<tr><td>MVA-grunnlag</td><td>MVA-%</td><td>MVA</td><td>Sum</td></tr><tr><td>${f2(g)}</td><td>25 %</td><td>${f2(r2(total - g))}</td><td>${f2(total)}</td></tr>`);
    return { lines, total, pay };
  }

  const retItem = (it, qty) => { const s = []; for (let i = 0; i < (qty || 1); i++) s.push(T(`${it[0]} ${it[1]}`, f2(-it[2]))); return s; };
  const kt = (amt) => T('Kontant tilbake:', f2(amt));

  // normale salg
  const perDay = { '1001|1': 15 * scale, '1001|2': 12 * scale, '1001|3': 9 * scale, '1002|1': 10 * scale, '1002|2': 8 * scale };
  DAYS.forEach((day) => {
    Object.keys(perDay).forEach((k) => {
      const [store, ws] = k.split('|').map(Number);
      const n = perDay[k] + Math.floor(rnd() * 4) - 1;
      for (let i = 0; i < n; i++) {
        const m = randTime(), s = saleLines();
        push(store, ws, day, { m, type: 1, cashier: cashierFor(store, ws, m), lines: s.lines, total: s.total, pay: s.pay, member: rnd() < 0.25 ? '75' + String(1000000 + Math.floor(rnd() * 8999999)) : null });
      }
    });
  });

  // plantede avvik
  const PLANTED = [];
  // A: små returer før stenging, kasse 2, kasserer 4103, 30.9
  [[21 * 60 + 22, CATALOG[0]], [21 * 60 + 38, CATALOG[2]], [21 * 60 + 51, CATALOG[4]]].forEach((x) => push(1001, 2, '2026-09-30', { m: x[0], type: 1, cashier: '4103', lines: [T('RETUR VARE', '')].concat(retItem(x[1]), [TOT(f2(-x[1][2])), kt(x[1][2])]), total: -x[1][2], pay: 'Kontant tilbake', ret: x[1][2] }));
  // B: pantelapper med kontant tilbake, kasse 2
  [['2026-09-29', 14 * 60 + 10, 150], ['2026-09-30', 15 * 60 + 30, 150], ['2026-09-30', 16 * 60 + 5, 150], ['2026-10-01', 11 * 60 + 45, 320]].forEach((x) =>
    push(1001, 2, x[0], { m: x[1], type: 1, cashier: '4103', lines: [T('RETUR VARE', '')].concat(Array.from({ length: x[2] === 320 ? 8 : 3 }, (_, i) => T('399 PANTELAPP', f2(-(x[2] === 320 ? 40 : 50))) ), [TOT(f2(-x[2])), kt(x[2])]), total: -x[2], pay: 'Kontant tilbake', ret: x[2] }));
  // C: kortkjøp refundert kontant
  { const it = CATALOG[3]; push(1001, 1, '2026-10-01', { m: 10 * 60 + 5, type: 1, cashier: '4101', lines: [T(`${it[0]} ${it[1]}`, '20.00'), T(`${it[0]} ${it[1]}`, '20.00'), TOT('40.00'), T('Bank:', '40.00'), T('Referanse: 44321', '')], total: 40, pay: 'Bank' });
    push(1001, 1, '2026-10-01', { m: 10 * 60 + 25, type: 1, cashier: '4101', lines: [T('RETUR VARE', '')].concat(retItem(it, 2), [TOT('-40.00'), kt(40)]), total: -40, pay: 'Kontant tilbake', ret: 40 }); }
  // D: salg etter kassaoppgjør, kasse 3 den 29.
  push(1001, 3, '2026-09-29', { m: 21 * 60 + 58, type: 2, cashier: '4101', forced: true });
  [[22 * 60 + 12, [CATALOG[5]]], [22 * 60 + 20, [CATALOG[8], CATALOG[7]]]].forEach((x) => { const s = saleLines({ items: x[1], pay: 'Kontant', noCoupons: true }); push(1001, 3, '2026-09-29', { m: x[0], type: 1, cashier: '4101', lines: s.lines, total: s.total, pay: 'Kontant' }); });
  // G: rabatt med skjønnsmessige årsaker (4102 om kvelden) og en uten årsak (4101)
  [['2026-09-29', 18 * 60 + 5, 1, 'Annen rabattårsak', 50], ['2026-09-30', 19 * 60 + 40, 1, 'Annen rabattårsak', 50], ['2026-10-01', 17 * 60 + 15, 1, 'Feil pris', 30], ['2026-10-01', 20 * 60 + 5, 1, 'Reserveløsning kupong', 20]]
    .forEach((x) => { const s = saleLines({ items: [CATALOG[5], CATALOG[1]], discount: { pct: x[4], reason: x[3] }, noCoupons: true }); push(1001, 1, x[0], { m: x[1], type: 1, cashier: '4102', lines: s.lines, total: s.total, pay: s.pay }); });
  { const s = saleLines({ items: [CATALOG[9], CATALOG[10]], discount: { pct: 50, reason: '' }, noCoupons: true }); push(1001, 1, '2026-09-30', { m: 12 * 60 + 15, type: 1, cashier: '4101', lines: s.lines, total: s.total, pay: s.pay }); }

  // H: medlemsnummer. Én "ansatt" taster samme nummer på mange bonger hos kasserer 4102, og ett nummer brukes i to butikker med 12 minutters mellomrom.
  [['2026-09-29', [16 * 60 + 5, 17 * 60 + 20, 18 * 60 + 40]], ['2026-09-30', [19 * 60 + 30, 20 * 60 + 1, 20 * 60 + 25, 20 * 60 + 50, 21 * 60 + 10]], ['2026-10-01', [16 * 60 + 15, 18 * 60 + 25]]].forEach((d) =>
    d[1].forEach((m) => { const s = saleLines({ noCoupons: true }); push(1001, 1, d[0], { m, type: 1, cashier: '4102', lines: s.lines, total: s.total, pay: s.pay, member: '751000111' }); }));
  { const a = saleLines({ noCoupons: true }), b = saleLines({ noCoupons: true });
    push(1001, 3, '2026-09-30', { m: 14 * 60, type: 1, cashier: '4101', lines: a.lines, total: a.total, pay: a.pay, member: '751000222' });
    push(1002, 2, '2026-09-30', { m: 14 * 60 + 12, type: 1, cashier: '4202', lines: b.lines, total: b.total, pay: b.pay, member: '751000222' }); }
  // I: manuell pris på Pepsi Max (24,90 mot 32,90) hos 4102 den 30., med vanlige salg som referanse
  for (let i = 0; i < 6; i++) { const s = saleLines({ items: [CATALOG[1]], noCoupons: true, pay: 'Bank' }); push(1001, 2, '2026-09-30', { m: 10 * 60 + i * 41, type: 1, cashier: '4103', lines: s.lines, total: s.total, pay: s.pay }); }
  for (let i = 0; i < 3; i++) { const s = saleLines({ items: [['7044610877488', 'PEPSI MAX 0.5L', 24.9, true]], noCoupons: true, pay: 'Bank' }); push(1001, 1, '2026-09-30', { m: 19 * 60 + 20 + i * 47, type: 1, cashier: '4102', lines: s.lines, total: s.total, pay: s.pay }); }
  // J: tekstlinje som tyder på annullering
  { const s = saleLines({ items: [CATALOG[7], CATALOG[8]], noCoupons: true, pay: 'Bank' }); s.lines.splice(1, 0, SPAN('Linje annullert av kasserer')); push(1001, 1, '2026-10-01', { m: 13 * 60 + 40, type: 1, cashier: '4101', lines: s.lines, total: s.total, pay: s.pay }); }
  // K: bong der Totalt er 18 kr høyere enn linjene og betalingen (endret total)
  { const s = saleLines({ items: [CATALOG[5], CATALOG[8]], noCoupons: true, pay: 'Bank' }); const lines = s.lines.map((l) => (l.indexOf('Totalt') !== -1 ? TOT(f2(s.total + 18)) : l));
    push(1001, 1, '2026-10-01', { m: 20 * 60 + 40, type: 1, cashier: '4101', lines, total: r2(s.total + 18), pay: s.pay }); }
  // L: samme TransId på to bonger i ulike kasser (dobbeltregistrert kortbetaling)
  [[1, 12 * 60 + 5], [2, 12 * 60 + 9]].forEach((x) => { const s = saleLines({ items: [CATALOG[2]], noCoupons: true, pay: 'Bank', transId: 'DK7DUPLIKAT01' }); push(1001, x[0], '2026-09-29', { m: x[1], type: 1, cashier: x[0] === 1 ? '4101' : '4103', lines: s.lines, total: s.total, pay: s.pay }); });
  // Kjøpeutbytte-tabell på medlemsbonger (sist på bongen)
  Object.keys(events).forEach((k) => events[k].forEach((e) => {
    if (e.type !== 1 || !e.member || !(e.total > 0)) return;
    const g = r2(e.total * 0.95), ku = r2(g * 0.02);
    e.lines.push('<tr><td>Grunnlag</td><td>Kjøpeutbytte</td><td>MVA bonus</td></tr>', `<tr><td>${f2(g)}</td><td>${f2(ku)}</td><td>${f2(r2(ku * 0.25))}</td></tr>`);
  }));

  // kassaoppgjør og bongnummer
  const DIFFS = { '1001|2|2026-09-29': -40, '1001|2|2026-09-30': -35, '1001|2|2026-10-01': -60, '1001|1|2026-10-01': 10 };
  const seq = {}; const out = []; const dropped = [];
  Object.keys(events).sort().forEach(() => {});
  const keys = Object.keys(perDay);
  keys.forEach((k) => {
    const [store, ws] = k.split('|').map(Number);
    seq[k] = 2000 + Math.floor(rnd() * 400);
    DAYS.forEach((day) => {
      const list = events[store + '|' + ws + '|' + day] || [];
      const hasSettle = list.some((e) => e.type === 2);
      if (!hasSettle) {
        const last = list.filter((e) => e.m <= CLOSE + 30).sort((a, b) => b.m - a.m)[0];
        list.push({ store, ws, day, m: CLOSE + 8 + Math.floor(rnd() * 20), type: 2, cashier: last ? last.cashier : cashierFor(store, ws, 20 * 60) });
      }
      list.sort((a, b) => a.m - b.m);
      list.forEach((e) => {
        e.seq = ++seq[k];
        e.id = `${store}-${ws}-${e.seq}`;
        if (e.type === 2) {
          const before = list.filter((x) => x.type === 1 && x.m < e.m);
          let expected = 0;
          before.forEach((x) => { if (x.pay === 'Kontant') expected += x.total; if (x.pay === 'Kontant tilbake') expected -= x.ret; });
          const d = DIFFS[`${store}|${ws}|${day}`] || 0, telt = r2(expected + d);
          e.lines = [T('Kontant:', f2(telt)), T('Sum', f2(telt)), T('Pose: ' + (51230000 + Math.floor(rnd() * 9999)), ''), T('Differanse', ''), T('Kontant:', (d > 0 ? '+' : '') + f2(d)), T('Sum', (d > 0 ? '+' : '') + f2(d))];
          e.total = null;
        }
        out.push(e);
      });
    });
  });
  // E: hull i bongnummer, kasse 1 den 30. (seks bonger fjernet)
  const k1 = out.filter((e) => e.store === 1001 && e.ws === 1 && e.day === '2026-09-30' && e.type === 1 && e.m > 13 * 60 && e.m < 19 * 60).sort((a, b) => a.seq - b.seq);
  const start = Math.max(1, Math.floor(k1.length / 2) - 3);
  k1.slice(start, start + 6).forEach((e) => { dropped.push(e.id); });
  const kept = out.filter((e) => dropped.indexOf(e.id) === -1);

  const rows = kept.map((e) => ({ transactionId: e.id, endDateTime: `${e.day} ${hhmm(e.m)}`, storeNumber: e.store, workstationNumber: e.ws, cashierNumber: e.cashier, totalAmount: e.total, receiptType: e.type, memberNumber: e.member || null, journalSourceName: 'main' }))
    .sort((a, b) => (a.endDateTime < b.endDateTime ? 1 : a.endDateTime > b.endDateTime ? -1 : 0));
  const receipts = {};
  kept.forEach((e) => { receipts[e.id] = `<div>Kvittering: ${e.seq} ${e.day.slice(8, 10)}.${e.day.slice(5, 7)}.${e.day.slice(0, 4)} ${hhmm(e.m)}:00</div><table>` + e.lines.join('') + '</table>'; });
  return { rows, receipts, droppedIds: dropped };
}

function pageHtml(rows) {
  const storeData = Object.keys(STORES).map((n) => ({ number: Number(n), text: STORES[n] }));
  return `<!doctype html><html><head><meta charset="utf-8"><title>Journal</title></head><body style="font:13px system-ui;margin:0;background:#eef1f0">
<input id="fromDatePicker"><input id="toDatePicker"><input id="freetextSearchInput"><input id="receiptNumber">
<input ng-model="vm.selectedFilters.memberNumber"><input ng-model="vm.selectedFilters.externalLoyaltyNumber">
<button ng-click="vm.resetFilters()">Nullstill</button>
<button ng-click="vm.applyFilters()" onclick="window.__applied=(window.__applied||0)+1;(window.__bound||[]).forEach(function(f){f()})">Oppdater</button>
<div class="k-grid-header"><table><colgroup><col><col><col><col><col></colgroup><thead><tr><th>DATO</th><th>KASSERER</th><th>KASSE</th><th>BONGNR</th><th>SUBTOTAL</th></tr></thead></table></div>
<table id="g" data-role="grid"><colgroup><col><col><col><col><col></colgroup><tbody>
${rows.map((r, i) => `<tr data-uid="u${i}" data-id="${r.transactionId}"><td></td><td>${r.endDateTime}</td><td data-field="cashierNumber">${r.cashierNumber}</td><td data-field="workstationNumber">${r.workstationNumber}</td><td>${r.transactionId}</td><td>${r.totalAmount === null ? '' : r.totalAmount}</td></tr>`).join('')}
</tbody></table>
<div data-w="1"></div><iframe id="rc"></iframe>
<script>
var rows=${JSON.stringify(rows)};
var items=rows.map(function(r,i){var o=Object.assign({uid:'u'+i},r);o.toJSON=function(){var c=Object.assign({},o);delete c.toJSON;return c};return o});
var cur=null;
var grid={tbody:[document.querySelector('tbody')],dataSource:{view:function(){return items}},
 dataItem:function(tr){return items.filter(function(i){return i.transactionId===tr.getAttribute('data-id')})[0]},
 bind:function(n,f){(window.__bound=window.__bound||[]).push(f)},
 select:function(tr){if(!arguments.length)return cur?[cur]:[];cur=tr;var id=tr.getAttribute('data-id');fetch('/__receipt/'+encodeURIComponent(id)).then(function(r){return r.text()}).then(function(t){if(cur===tr)document.getElementById('rc').contentDocument.body.innerHTML=t});},clearSelection:function(){cur=null}};
var ms={dataSource:{data:function(){return ${JSON.stringify(storeData)}.map(function(s){return {get:function(k){return s[k]}}})}},value:function(v){window.__storesSet=v},trigger:function(){}};
function mk(list){return {each:function(fn){list.forEach(function(e,i){fn.call(e,i,e)})},eq:function(i){return mk([list[i]])},data:function(n){var e=list[0];if(!e)return undefined;if(e.getAttribute('data-w'))return n==='kendoMultiSelect'?ms:null;return n==='kendoGrid'?grid:null}}}
window.jQuery=function(a){ if(typeof a==='string') return a.indexOf('#storesWrapper')===0?mk([].slice.call(document.querySelectorAll('[data-w]'))):mk([]); return mk([a]); };
</script></body></html>`;
}

module.exports = { build, pageHtml, STORES };
