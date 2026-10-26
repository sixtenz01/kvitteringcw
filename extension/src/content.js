(function () {
  'use strict';
  if (window.__kvRewamp) return;
  window.__kvRewamp = true;

  // Feil i pluginen skal synes på siden, ikke bare i Console: en liten boks nederst til venstre sier hva som gikk galt.
  window.addEventListener('error', function (ev) { if (ev && /\/src\/(content|logic|report)\.js/.test(ev.filename || '')) showBootError(ev.error || ev.message); });
  window.addEventListener('unhandledrejection', function (ev) { var r = ev && ev.reason; if (r && /\/src\/(content|logic|report)\.js/.test(String(r.stack || ''))) showBootError(r); });

  var L = window.KvLogic;
  var K = {
    saved: 'kvr.saved.v1', collapsed: 'kvr.collapsed.v1', scan: 'kvr.scan.v2', pos: 'kvr.pos.v1',
    size: 'kvr.size.v1', sec: 'kvr.sec.v1', rules: 'kvr.rules.v1', anom: 'kvr.anom.v1',
    stores: 'kvr.stores.v1', tab: 'kvr.tab.v1', layout: 'kvr.layout.v1', arules: 'kvr.arules.v1', notes: 'kvr.notes.v1', tasks: 'kvr.tasks.v1', ctl: 'kvr.ctl.v1', keynav: 'kvr.keynav.v1', tshift: 'kvr.tshift.v1', nlog: 'kvr.nlog.v1', wide: 'kvr.wide.v1', sub: 'kvr.sub.v1', weights: 'kvr.weights.v1', camp: 'kvr.camp.v1', lastrun: 'kvr.lastrun.v1', scope: 'kvr.scope.v1', help: 'kvr.help.v1', sub2: 'kvr.sub2.v1', reports: 'kvr.reports.v1', repopts: 'kvr.repopts.v1', pantmig: 'kvr.pantmig.v1', pos2: 'kvr.pos2.v1', campmig: 'kvr.campmig.v1', discmig: 'kvr.discmig.v1', evmig: 'kvr.evmig.v1', folder: 'kvr.folder.v1', folderAt: 'kvr.folderat.v1', cwx: 'kvr.cwx.v1', arch: 'kvr.arch.v1', quick: 'kvr.quick.v1'
  };
  var sayTimer = null;
  var failedRecs = [];
  var lastRetry = null;
  var SCAN_TIMEOUT = 6000;
  var SCAN_LIMIT = 10000, SCAN_BYTES = 25 * 1024 * 1024;
  var SCAN_TYPES = [1, 2, 11, 13];   // salg, kassaoppgjør, synlig svinn og internt forbruk
  var SCAN_MIN_MS = 600;   // fartsregulator: høyst én bong per 0,6 s, saktere når CW svarer tregere enn normalt
  var seqProof = { ok: 0, bad: 0 };

  var filters = L.defaultFilters();
  var selected = {};
  var recs = [];
  var grid = null;
  var ui = {};
  var scanning = false;
  var cancelScan = false;
  var optsKey = '';
  var gcache = {};
  var anomMap = {};
  var cw = { dateFrom: '', dateTo: '', stores: {}, members: '', loyal: '', free: '', bong: '', storeQuery: '' };
  var cwStoreList = [];
  var campDec = {};   // brukerens svar om sentral kampanje: «ean|prosent» → 'kampanje' | 'ikke'
  var gridStores = {};   // butikknavn lest fra gridets BUTIKK-kolonne (lavest prioritet)
  var storeMap = {};

  // Lagring: kun egen IndexedDB ('kvr-store'). Ingenting skrives til localStorage/sessionStorage,
  // slik at Lindbaks egne data aldri påvirkes. Hard grense på antall cachede kvitteringer.
  var mem = {};
  var scanMap = {};
  var dirty = {};
  var db = null;
  var rules, anomCfg, manualStores, customRules = [];
  var scope = null, lastMode = 'scope', fetched = null;
  var weights = null, checkState = { newIds: {}, at: null, shown: 15, showChecked: false }, expanded = {};
  var notes = {}, ctlRes = null, ctlCfg = null, tasksCustom = [], boundCount = 0, keyNav = true, settingsStale = false, timeShift = 0;
  var cwx = null, cwRun = null;   // tilleggsdata fra CWs filtre, og kjøringen som pågår
  var lastLoadMs = 0, lastSearchMs = 0, quickScan = false;   // svartid for siste bong og søk; målrettet skanning
  // samlet grunnlag fra «Hent og skann i deler»: listerader fra mange CW-søk. Medlemsnummer bare i minnet (archMem).
  var arch = { days: {} }, archMem = {}, archVer = 0, allCache = null, bulk = null;
  var ARCH_LIMIT = 30000, ARCH_DAYS = 92, PART_PAUSE = 1500;

  function openDb() {
    return new Promise(function (res) {
      try {
        var rq = indexedDB.open('kvr-store', 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore('kv'); rq.result.createObjectStore('scan'); };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = rq.onblocked = function () { res(null); };
      } catch (e) { res(null); }
    });
  }

  function readAll(d, name) {
    return new Promise(function (res) {
      var out = {};
      try {
        var rq = d.transaction(name).objectStore(name).openCursor();
        rq.onsuccess = function () { var c = rq.result; if (c) { out[c.key] = c.value; c.continue(); } else res(out); };
        rq.onerror = function () { res(out); };
      } catch (e) { res(out); }
    });
  }

  function put(name, key, val) {
    if (!db) return;
    try {
      var tx = db.transaction(name, 'readwrite');
      if (val === null || val === undefined) tx.objectStore(name).delete(key); else tx.objectStore(name).put(val, key);
      tx.onabort = tx.onerror = function () { db = null; };
    } catch (e) { db = null; }
  }

  function store(key, value) {
    if (value === undefined) return mem[key] === undefined ? null : mem[key];
    if (value === null) delete mem[key]; else mem[key] = value;
    put('kv', key, value);
    if (isSettingsKey(key)) folderChanged();
  }

  // Som put, men en verdi som ikke kan lagres (for eksempel et mappevalg nettleseren ikke tillater) slår ikke av databasen.
  function putSafe(key, val) {
    if (!db) return false;
    try {
      var tx = db.transaction('kv', 'readwrite');
      if (val === null || val === undefined) tx.objectStore('kv').delete(key); else tx.objectStore('kv').put(val, key);
      return true;
    } catch (e) { return false; }
  }

  // Skannecachen har hard grense både i antall og byte. Eldste skanninger går først.
  var sizes = new WeakMap();
  function recBytes(r) {
    var n = sizes.get(r);
    if (n === undefined) { try { n = JSON.stringify(r).length; } catch (e) { n = 2000; } sizes.set(r, n); }
    return n;
  }

  function saveScan() {
    var keys = Object.keys(scanMap).sort(function (a, b) { return (scanMap[a].t || 0) - (scanMap[b].t || 0); });
    var total = keys.reduce(function (a, k) { return a + recBytes(scanMap[k]); }, 0), drop = 0;
    while (drop < keys.length - 1 && (keys.length - drop > SCAN_LIMIT || total > SCAN_BYTES)) { total -= recBytes(scanMap[keys[drop]]); drop++; }
    keys.slice(0, drop).forEach(function (k) { delete scanMap[k]; delete dirty[k]; put('scan', k, null); });
    Object.keys(dirty).forEach(function (k) { if (scanMap[k]) put('scan', k, scanMap[k]); });
    dirty = {};
  }

  function clearScan() {
    scanMap = {}; dirty = {}; gcache = {};
    cwx = null; store(K.cwx, null);
    if (db) { try { db.transaction('scan', 'readwrite').objectStore('scan').clear(); } catch (e) { db = null; } }
  }

  // Rydd bort evt. gamle kvr.*-nøkler i localStorage fra tidligere versjoner (flytter innstillinger til IndexedDB).
  function migrateLocal() {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf('kvr.') === 0) keys.push(k); }
      keys.forEach(function (k) {
        if (k !== 'kvr.scan.v2' && k !== 'kvr.pant.v1' && mem[k] === undefined) {
          try { mem[k] = JSON.parse(localStorage.getItem(k)); put('kv', k, mem[k]); } catch (e) { /* ignorer */ }
        }
        localStorage.removeItem(k);
      });
    } catch (e) { /* ignorer */ }
  }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  function fmt(n) {
    return n.toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function jq() { return window.jQuery || window.$; }
  function wait(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

  function download(blob, name) {
    var a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---- oppstart: feil og venting vises på siden ------------------------------
  var bootShown = '', waitSince = Date.now();
  function bootBox(text, isError) {
    var b = document.getElementById('kvr-boot');
    if (!b) {
      b = document.createElement('div');
      b.id = 'kvr-boot';
      b.setAttribute('role', isError ? 'alert' : 'status');
      b.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;max-width:560px;background:#fff;color:#1b2a24;border:2px solid #00704a;border-radius:10px;padding:10px 12px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25)';
      (document.body || document.documentElement).appendChild(b);
    }
    b.style.borderColor = isError ? '#d93025' : '#00704a';
    b.innerHTML = '';
    var t = document.createElement('div'); t.textContent = text; t.style.marginBottom = '6px'; b.appendChild(t);
    var mk = function (label, fn) { var x = document.createElement('button'); x.type = 'button'; x.textContent = label; x.style.cssText = 'margin-right:6px;font:12px system-ui;padding:3px 8px;border:1px solid #bccac3;border-radius:6px;background:#f0faf5;cursor:pointer'; x.addEventListener('click', fn); b.appendChild(x); };
    if (isError) mk('Kopier feilen', function () { try { navigator.clipboard.writeText(text); } catch (e) { /* ingen utklippstavle */ } });
    mk('Nullstill visning', resetLayout);
    mk('Lukk', function () { b.remove(); });
  }
  // Plassering, størrelse, faner og sammenfolding nullstilles; skanninger, notater og innstillinger beholdes. Siden lastes på nytt.
  function resetLayout() {
    [K.pos, K.pos2, K.size, K.wide, K.collapsed, K.tab, K.sub, K.sub2, K.sec, K.layout].forEach(function (k) { try { store(k, null); } catch (e) { /* lagring utilgjengelig */ } });
    setTimeout(function () { location.reload(); }, 300);
  }
  function showBootError(e) {
    var msg = (e && e.message) || String(e), at = String((e && e.stack) || '').split('\n').slice(1, 3).map(function (x) { return x.trim(); }).join(' ');
    var txt = 'Kvitteringshenter ' + ((window.KvReport && window.KvReport.VERSION) || '') + ' fikk en feil: ' + msg + (at ? ' (' + at + ')' : '') + '. Last siden på nytt (F5). Hjelper ikke det, kopier feilen og send den.';
    window.__kvBootErr = txt;
    try { console.error('[Kvitteringshenter]', e); } catch (x) { /* ingen konsoll */ }
    if (bootShown === msg) return;
    bootShown = msg;
    bootBox(txt, true);
  }
  // Ingen liste ennå: vis hvorfor panelet ikke er der, etter en stund.
  function showWaiting() {
    if (bootShown || document.getElementById('kvr-panel') || Date.now() - waitSince < (window.__kvrWait || 15000)) return;
    var why = !document.querySelector('[data-role=grid]') ? 'venter på listen i CW. Hent kvitteringer (Oppdater i Lindbak), så kommer panelet.'
      : !jq() ? 'finner ikke jQuery på siden, så gridet kan ikke leses.' : 'finner listen, men ikke Kendo-gridet bak den.';
    if (document.getElementById('kvr-boot')) return;
    bootBox('Kvitteringshenter ' + ((window.KvReport && window.KvReport.VERSION) || '') + ' er lastet og ' + why, false);
  }

  // ---- grid ---------------------------------------------------------------
  function getGrid() {
    var node = document.querySelector('[data-role=grid]');
    var $ = jq();
    if (!node || !$) return null;
    return $(node).data('kendoGrid') || null;
  }

  function base64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  function plain(item) { return item && item.toJSON ? item.toJSON() : item; }

  function seqOf(tid) { return parseInt(String(tid).substr(String(tid).lastIndexOf('-') + 1), 10); }

  function collect() {
    var tbody = grid.tbody && grid.tbody[0];
    if (!tbody) return [];
    var view = grid.dataSource.view();
    var pos = new Map(), byUid = {};
    for (var i = 0; i < view.length; i++) {
      if (!pos.has(view[i])) pos.set(view[i], i);
      if (view[i] && view[i].uid && byUid[view[i].uid] === undefined) byUid[view[i].uid] = i;
    }
    var out = [];
    Array.prototype.forEach.call(tbody.children, function (tr) {
      if (tr.tagName !== 'TR') return;
      var vi = byUid[tr.getAttribute('data-uid')];
      var di = vi !== undefined ? view[vi] : grid.dataItem(tr);
      if (!di) return;
      var item = plain(di);
      // Klokkeslett: det CW-listen viser (lokal tid) går først. Ellers rådata, flyttet til norsk tid hvis de har tidssone.
      var dcell = tr.querySelector('td[data-field="endDateTime"]');
      var shown = dcell ? L.parseCellDT(dcell.textContent) : '';
      item.rawDT = item.endDateTime;
      item.endDateTime = L.shiftDT(shown || L.localDT(item.endDateTime), timeShift);
      var cell = tr.querySelector('td[data-field="receiptIdentifier"]');
      item.bongnr = cell && cell.textContent.trim() ? cell.textContent.trim() : [item.storeNumber, item.workstationNumber, seqOf(item.transactionId)].join('-');
      var orig = pos.has(di) ? pos.get(di) : (di.uid && byUid[di.uid] !== undefined ? byUid[di.uid] : 0);
      out.push({ tr: tr, item: item, orig: orig });
    });
    return out;
  }

  // ---- butikknavn (som i CW) ----------------------------------------------
  function readCwStores() {
    var $ = jq();
    if (!$) return [];
    var cands = $('#storesWrapper div.k-widget.k-multiselect');
    var result = [];
    cands.each(function () {
      var ms = $(this).data('kendoMultiSelect');
      if (!ms || !ms.dataSource) return;
      var data = ms.dataSource.data();
      var list = [];
      var vf = (ms.options && ms.options.dataValueField) || 'number', tf = (ms.options && ms.options.dataTextField) || 'text';
      var read = function (d, f) { return d.get ? d.get(f) : d[f]; };
      for (var i = 0; i < data.length; i++) {
        var d = data[i];
        var num = read(d, 'number'), name = read(d, 'text');
        if (num === undefined || num === null) num = read(d, vf);
        if (!name) name = read(d, tf);
        if (num !== undefined && num !== null && name) list.push({ number: num, name: String(name) });
      }
      if (list.length > result.length) result = list;
    });
    return result;
  }

  function refreshStoreMap() {
    var list = readCwStores();
    var changed = false;
    if (list.length && list.length !== cwStoreList.length) { cwStoreList = list; changed = true; }
    var map = {};
    Object.keys(gridStores).forEach(function (k) { map[k] = gridStores[k]; });
    cwStoreList.forEach(function (s) { map[String(s.number)] = s.name; });
    var manual = L.parseStoreText(manualStores);
    Object.keys(manual).forEach(function (k) { map[k] = manual[k]; });
    if (JSON.stringify(map) !== JSON.stringify(storeMap)) { storeMap = map; changed = true; }
    return changed;
  }

  function sLabel(n) { return L.storeLabel(n, storeMap); }

  // Butikknavn fra cellen i BUTIKK-kolonnen, for butikker CWs liste ikke ga navn til. Bare navn som står der, ikke gjetting.
  function harvestGridStores() {
    var hdr = document.querySelector('.k-grid-header table'), col = -1, changed = false;
    if (hdr) Array.prototype.forEach.call(hdr.querySelectorAll('thead th'), function (th, i) { if (th.textContent.trim().toUpperCase() === 'BUTIKK') col = i; });
    recs.forEach(function (r) {
      var num = String(r.item.storeNumber);
      if (gridStores[num]) return;
      var td = r.tr.querySelector('td[data-field="storeNumber"]') || (col >= 0 ? r.tr.children[col] : null);
      var name = td ? L.storeNameFromCell(td.textContent, num) : '';
      if (name) { gridStores[num] = name; changed = true; }
    });
    return changed;
  }

  // ---- CW-søk (samme kontrollene som den gamle pluginen) ---------------------
  function setInputValue(node, value, noBlur) {
    if (!node) return;
    var d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (d && d.set) d.set.call(node, value); else node.value = value;
    (noBlur ? ['input', 'change'] : ['input', 'change', 'blur']).forEach(function (ev) { node.dispatchEvent(new Event(ev, { bubbles: true })); });
  }

  function noDate(s) {
    if (!s) return '';
    var p = s.split('-');
    return p[2] + '.' + p[1] + '.' + p[0];
  }

  function setCwStores(numbers) {
    var $ = jq();
    if (!$ || !numbers.length) return;
    var ms = $('#storesWrapper div.k-widget.k-multiselect').eq(1).data('kendoMultiSelect');
    if (!ms) return;
    ms.value(numbers.map(function (n) { return parseInt(n, 10); }));
    ms.trigger('change');
  }

  // Datoene settes som i «Hent og skann i deler»: via datovelgeren, og CW får verdiene før feltene forlates.
  async function cwSearch() {
    var q = function (sel) { return document.querySelector(sel); }, fd = q('#fromDatePicker'), td = q('#toDatePicker');
    await setFields([{ node: fd, kind: 'd', v: cw.dateFrom }, { node: td, kind: 'd', v: cw.dateTo }]);
    var nums = Object.keys(cw.stores).filter(function (k) { return cw.stores[k]; });
    if (nums.length) setCwStores(nums);
    if (cw.members) setInputValue(q('[ng-model="vm.selectedFilters.memberNumber"]'), cw.members);
    if (cw.loyal) setInputValue(q('[ng-model="vm.selectedFilters.externalLoyaltyNumber"]'), cw.loyal);
    if (cw.free) setInputValue(q('#freetextSearchInput'), cw.free);
    if (cw.bong) setInputValue(q('#receiptNumber'), cw.bong);
    setTimeout(function () {
      var b = q('[ng-click="vm.applyFilters()"]');
      ui.cwStatus.textContent = b ? 'Søk sendt til CW.' : 'Fant ikke OPPDATER-knappen i CW.';
      if (b) b.click();
    }, 500);
  }

  function cwReset() {
    var b = document.querySelector('[ng-click="vm.resetFilters()"]');
    if (b) b.click();
    ui.cwStatus.textContent = b ? 'CW-filter nullstilt.' : 'Fant ikke nullstill-knappen i CW.';
  }

  // ---- tilleggsdata fra CW: CWs egne filtre, ett om gangen ------------------------------------
  // Pluginen huker av ett valg i CWs filter, trykker Oppdater og noterer hvilke bonger CW viser. Pluginen sender ingen egne kall;
  // det er CW som søker, akkurat som når du trykker selv. Det er pause mellom søkene, kjøringen stopper ved første søk som ikke
  // svarer, og filtrene og søket settes tilbake til slutt. Fritekstsøk brukes aldri, fordi det er tungt for CWs server.
  var CWX_PAUSE = 1500, CWX_TIMEOUT = 60000, CWX_CUT = 1000, CWX_COPIES = 200, CWX_SYS = 5000, CWX_TAGS = 30000;
  var CWX_PAY = ['Kontant', 'Kontant tilbake', 'Kreditt', 'Kupong', 'Tilgodelapp', 'Gavekort', 'Finansiering'];
  var COPY_REF = /BONG\s*KOPI\s*\(\s*([A-Za-z0-9-]+)\s*\)/i;

  function nodeText(li) { var t = li.querySelector(':scope > div .k-in, :scope > .k-in'); return t ? t.textContent.replace(/\s+/g, ' ').trim() : ''; }
  // Nodene i et filtertre i CW (Kendo TreeView): avkrysningsboks, navn, sti («Pant → Manuell»), toppnivå og blad.
  function treeNodes(root) {
    if (!root) return [];
    return Array.prototype.map.call(root.querySelectorAll('li'), function (li) {
      var up = li.parentElement ? li.parentElement.closest('li') : null;
      if (up && !root.contains(up)) up = null;
      var name = nodeText(li);
      return { cb: li.querySelector(':scope > div input[type=checkbox], :scope > input[type=checkbox]'), name: name, top: !up, leaf: !li.querySelector('li'), path: (up ? nodeText(up) + ' → ' : '') + name };
    }).filter(function (x) { return x.cb && x.name; });
  }
  function contentTree() { return treeNodes(document.getElementById('contentFilterTreeView')); }
  function typeTree() { var g = document.getElementById('receiptTypeGroup'); return treeNodes(g ? g.querySelector('[data-role=treeview]') || g : null); }
  function clearTree(nodes) {
    nodes.filter(function (x) { return x.top; }).forEach(function (x) { for (var i = 0; i < 2 && (x.cb.checked || x.cb.indeterminate); i++) x.cb.click(); });
    nodes.forEach(function (x) { if (x.cb.checked) x.cb.click(); });
  }
  function setTree(nodes, want) { clearTree(nodes); nodes.forEach(function (x, i) { if (want[i] && !x.cb.checked) x.cb.click(); }); }
  function treeIs(nodes, want) { return nodes.every(function (x, i) { return x.cb.checked === want[i]; }); }
  function payWidget() { var $ = jq(), n = document.getElementById('paymentMethods'); var w = $ && n ? $(n).data('kendoMultiSelect') : null; return w && typeof w.value === 'function' ? w : null; }
  function payValues(w) { var v = w.value(); return Array.isArray(v) ? v.slice() : v && v.length !== undefined ? Array.prototype.slice.call(v) : []; }
  function setPay(w, v) { w.value(v); if (typeof w.trigger === 'function') w.trigger('change'); }
  function gridData() {
    var ds = grid && grid.dataSource;
    var a = !ds ? [] : typeof ds.data === 'function' ? ds.data() : ds.view();
    return Array.prototype.slice.call(a || []);
  }
  function idsKey(a) { return a.map(function (d) { return String(d.transactionId); }).sort().join('|'); }
  // En rad fra CW-listen i samme form som pluginens egne: klokkeslett som CW viser det, og bare feltene testene trenger.
  function cwxRow(di) {
    var tb = grid.tbody && grid.tbody[0], tr = tb && di.uid ? tb.querySelector('tr[data-uid="' + di.uid + '"]') : null;
    var dcell = tr && tr.querySelector('td[data-field="endDateTime"]'), shown = dcell ? L.parseCellDT(dcell.textContent) : '';
    var x = plain(di);
    return { tr: tr, item: { transactionId: x.transactionId, endDateTime: L.shiftDT(shown || L.localDT(x.endDateTime), timeShift), storeNumber: x.storeNumber, workstationNumber: x.workstationNumber,
      cashierNumber: x.cashierNumber, receiptType: x.receiptType, saleChannel: x.saleChannel, totalAmount: x.totalAmount } };
  }

  function cwxSearch() {
    return searchNow(cwRun && cwRun.pause >= 0 ? cwRun.pause : CWX_PAUSE, cwRun && cwRun.timeout ? cwRun.timeout : CWX_TIMEOUT);
  }

  // Teksten i visningsfeltet for en rad (bongkopier har ofte ingen tabell, så skanningen kan ikke brukes).
  async function viewerText(tr) {
    var d = iframeDoc();
    if (!d || !tr) return null;
    d.body.innerHTML = '';
    if (typeof grid.clearSelection === 'function') grid.clearSelection();
    grid.select(tr);
    for (var w = 0; w < SCAN_TIMEOUT; w += 100) {
      await wait(100);
      d = iframeDoc();
      var t = d ? (d.body.innerText || d.body.textContent || '') : '';
      if (t.trim()) { await wait(150); d = iframeDoc(); return d ? (d.body.innerText || d.body.textContent || '') : t; }
    }
    return null;
  }

  function cwxSay(t) { if (ui.cwxStatus) ui.cwxStatus.textContent = t; say(t); }

  async function fetchCwExtra() {
    if (cwRun || scanning || !grid || (bulk && !bulk.inExtra)) return;
    var base = gridData();
    if (!base.length) { cwxSay('Hent først kvitteringer i CW (Søk i CW eller Oppdater i Lindbak), så tilleggsdataene gjelder samme periode og butikker.'); return; }
    var pause = window.__kvrCwx && window.__kvrCwx.pause >= 0 ? window.__kvrCwx.pause : CWX_PAUSE;
    cwRun = { stop: false, pause: pause, timeout: window.__kvrCwx && window.__kvrCwx.timeout || CWX_TIMEOUT };
    var run = { at: Date.now(), n: base.length, cut: base.length >= CWX_CUT, from: '', to: '', searches: 0, log: [], errors: [], cutTags: [] };
    var baseKey = idsKey(base), baseIds = {};
    base.forEach(function (d) { baseIds[d.transactionId] = true; var t = L.parseDT(cwxRow(d).item.endDateTime).date; if (t && (!run.from || t < run.from)) run.from = t; if (t && t > run.to) run.to = t; });
    var tags = {}, sys = [], copies = {};
    var ct = contentTree(), tt = typeTree(), pw = payWidget();
    var ctOrig = ct.map(function (x) { return x.cb.checked; }), ttOrig = tt.map(function (x) { return x.cb.checked; }), pwOrig = pw ? payValues(pw) : [];
    var steps = [];
    ct.filter(function (x) { return x.leaf; }).forEach(function (x) { steps.push({ g: 'innhold', tag: x.path, set: function () { setTree(ct, ct.map(function (y) { return y === x; })); } }); });
    if (pw) {
      var pd = Array.prototype.slice.call(pw.dataSource && pw.dataSource.data ? pw.dataSource.data() : []);
      var vf = (pw.options && pw.options.dataValueField) || 'number', tf = (pw.options && pw.options.dataTextField) || 'text';
      CWX_PAY.forEach(function (name) {
        var m = pd.filter(function (d) { return String(d.get ? d.get(tf) : d[tf]).trim().toLowerCase() === name.toLowerCase(); })[0];
        if (m) steps.push({ g: 'betaling', tag: 'Betaling: ' + name, set: function () { if (ct.length) setTree(ct, ctOrig); setPay(pw, [m.get ? m.get(vf) : m[vf]]); } });
      });
    }
    var sysNode = tt.filter(function (x) { return x.top && /^Systemtransaksjoner$/i.test(x.name); })[0];
    if (sysNode) steps.push({ g: 'system', tag: 'Systemtransaksjoner', set: function () { if (pw) setPay(pw, pwOrig); setTree(tt, tt.map(function (y) { return y === sysNode; })); } });
    if (!ct.length) run.errors.push('Fant ikke innholdsfilteret i CW.');
    if (!pw) run.errors.push('Fant ikke betalingsfilteret i CW.');
    if (!sysNode) run.errors.push('Fant ikke «Systemtransaksjoner» i bongtypefilteret i CW.');
    var skip = {}, t0 = Date.now();
    ui.cwxBtn.disabled = true; ui.cwxStop.disabled = false; ui.scanBtn.disabled = true; ui.anomBtn.disabled = true;
    try {
      for (var i = 0; i < steps.length; i++) {
        var st = steps[i];
        if (cwRun.stop) { run.errors.push('Stoppet av deg etter ' + i + ' av ' + steps.length + ' søk.'); break; }
        if (skip[st.g]) continue;
        progress(i, steps.length + 1, t0, 'Henter fra CW (' + st.tag + ')', 0);
        st.set();
        var rows = await cwxSearch();
        run.searches++;
        if (rows === null) { run.errors.push('CW svarte ikke på søket «' + st.tag + '» innen ' + Math.round(cwRun.timeout / 1000) + ' s. Kjøringen ble stoppet. Sjekk at listen viser søket ditt, og trykk Oppdater i CW hvis den ikke gjør det.'); break; }
        if (st.g !== 'system' && base.length >= 20 && idsKey(rows) === baseKey) { skip[st.g] = true; run.errors.push('CW brukte ikke filteret «' + st.tag + '» (samme bonger som uten filter). Resten av ' + st.g + 'sfilteret ble hoppet over.'); continue; }
        if (rows.length >= CWX_CUT) run.cutTags.push(st.tag);
        run.log.push({ tag: st.tag, n: rows.length });
        if (st.g === 'system') {
          var cps = [];
          rows.forEach(function (d) { var r = cwxRow(d); if (sys.length < CWX_SYS) sys.push(r.item); if (r.item.receiptType === 19 && cps.length < CWX_COPIES) cps.push(r); });
          var cpc = scanPacer();
          for (var c = 0; c < cps.length && !cwRun.stop; c++) {
            progress(i, steps.length + 1, t0, 'Leser bongkopi ' + (c + 1) + ' av ' + cps.length, 0);
            var ct0 = Date.now(), txt = await viewerText(cps[c].tr);
            var m = txt ? COPY_REF.exec(txt) : null;
            copies[cps[c].item.transactionId] = m ? m[1] : '';
            var cd = L.paceNext(cpc, Date.now() - ct0, txt !== null);
            if (cd.stop) { run.errors.push('CW svarte ikke da bongkopiene skulle leses. Resten ble hoppet over.'); break; }
            if (cd.pause) await pauseFor(cd.pause); else if (cd.wait) await wait(cd.wait);
          }
        } else rows.forEach(function (d) { var id = d.transactionId; (tags[id] = tags[id] || []).push(st.tag); });
      }
    } catch (e) { run.errors.push(String(e && e.message || e)); }
    // tilbake til filtrene og søket du hadde
    try {
      if (ct.length) setTree(ct, ctOrig);
      if (tt.length) setTree(tt, ttOrig);
      if (pw) setPay(pw, pwOrig);
      var back = (!ct.length || treeIs(ct, ctOrig)) && (!tt.length || treeIs(tt, ttOrig));
      if (!back) run.errors.push('Filtrene i CW ble ikke satt helt tilbake. Trykk Nullstill i CW og søk på nytt.');
      cwRun.stop = false;
      var again = await cwxSearch();
      if (again === null) run.errors.push('CW svarte ikke da søket ditt skulle hentes tilbake. Trykk Oppdater i CW.');
      else if (idsKey(again) !== baseKey) run.errors.push('Listen etter tilbakestillingen er ikke helt lik listen før (' + again.length + ' mot ' + base.length + ' bonger). Det kan være nye bonger siden; søk på nytt i CW om du vil være sikker.');
    } catch (e2) { run.errors.push('Tilbakestilling: ' + (e2 && e2.message || e2)); }
    cwRun = null;
    setProgress(0);
    ui.cwxBtn.disabled = false; ui.cwxStop.disabled = true; ui.scanBtn.disabled = false; ui.anomBtn.disabled = false;
    mergeCwx(run, baseIds, tags, sys, copies);
    apply();
    renderCwx();
    cwxSay('Tilleggsdata fra CW: ' + run.searches + ' søk, ' + plur(Object.keys(tags).length, 'bong', 'bonger') + ' merket, ' + plur(sys.length, 'systembong', 'systembonger') + ', ' + plur(Object.keys(copies).length, 'bongkopi', 'bongkopier') + '.' + (run.errors.length ? ' Merknader: ' + run.errors.length + ' (se Hent → Tilleggsdata fra CW).' : ''));
  }

  // Nye data erstatter de gamle for bongene i søket; data fra andre søk beholdes innenfor faste grenser.
  function mergeCwx(run, baseIds, tags, sys, copies) {
    var old = cwx || { tags: {}, sys: [], copies: {}, runs: [] };
    var nt = {};
    Object.keys(old.tags || {}).forEach(function (id) { if (!baseIds[id]) nt[id] = old.tags[id]; });
    var keys = Object.keys(nt);
    if (keys.length + Object.keys(tags).length > CWX_TAGS) keys.slice(0, keys.length + Object.keys(tags).length - CWX_TAGS).forEach(function (id) { delete nt[id]; });
    Object.keys(tags).forEach(function (id) { nt[id] = tags[id]; });
    var seen = {}, ns = [];
    sys.concat(old.sys || []).forEach(function (r) { if (!seen[r.transactionId] && ns.length < CWX_SYS) { seen[r.transactionId] = true; ns.push(r); } });
    var nc = {};
    Object.keys(old.copies || {}).forEach(function (id) { if (seen[id]) nc[id] = old.copies[id]; });
    Object.keys(copies).forEach(function (id) { nc[id] = copies[id]; });
    cwx = { tags: nt, sys: ns, copies: nc, runs: [run].concat(old.runs || []).slice(0, 10) };
    store(K.cwx, cwx);
  }

  function sanitizeCwx(raw) {
    if (!raw || typeof raw !== 'object' || !raw.tags || typeof raw.tags !== 'object' || !Array.isArray(raw.sys)) return null;
    return { tags: raw.tags, sys: raw.sys.slice(0, CWX_SYS), copies: raw.copies && typeof raw.copies === 'object' ? raw.copies : {}, runs: Array.isArray(raw.runs) ? raw.runs.slice(0, 10) : [] };
  }

  function renderCwx() {
    if (!ui.cwxInfo) return;
    ui.cwxInfo.innerHTML = '';
    var r = cwx && cwx.runs[0];
    if (!r) { ui.cwxInfo.appendChild(hintEl('Ikke hentet ennå.')); return; }
    var when = new Date(r.at).toLocaleString('nb-NO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    ui.cwxInfo.appendChild(hintEl('Sist hentet ' + when + ' for ' + r.n + ' bonger (' + (r.from === r.to ? r.from : r.from + ' – ' + r.to) + '), ' + r.searches + ' søk.' +
      (r.cut ? ' Søket ditt hadde 1000 bonger, så CW har trolig kuttet det; velg kortere periode for at tallene skal være hele.' : '')));
    if (r.log.length) ui.cwxInfo.appendChild(hintEl(r.log.map(function (x) { return x.tag + ': ' + x.n + (r.cutTags.indexOf(x.tag) !== -1 ? ' (kuttet)' : ''); }).join(' · ')));
    r.errors.forEach(function (e) { ui.cwxInfo.appendChild(el('div', { class: 'kvr-hint kvr-cwx-err', text: e })); });
  }

  function stopCwExtra() { if (cwRun) { cwRun.stop = true; cwxSay('Stopper etter søket som pågår, og setter filtrene tilbake…'); } }

  // ---- samlet grunnlag og «Hent og skann i deler» ---------------------------------------------
  // CW viser høyst 1000 bonger per søk og kutter de eldste. Perioden hentes derfor dag for dag; en dag med 1000 bonger deles
  // på klokkeslett (CWs fra- og til-tid). Hver del skannes mens den står i listen, og radene lagres i et samlet grunnlag
  // som analysen bruker sammen med listen. Pause mellom søkene, stopp ved første søk uten svar, og søket ditt settes tilbake.
  function archKey(day) { return K.arch + ':' + day; }
  function loadArchive() {
    var idx = store(K.arch);
    arch = { days: {} };
    if (idx && Array.isArray(idx.days)) idx.days.forEach(function (d) {
      if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d.day)) return;
      var v = store(archKey(d.day));
      var rows = v && Array.isArray(v.rows) ? v.rows.map(L.archRow).filter(Boolean) : [];
      arch.days[d.day] = { day: d.day, at: Number(d.at) || 0, done: !!d.done, cut: Number(d.cut) || 0, fv: Number(d.fv) || 1, rows: rows };
    });
    archVer++;
  }
  function archCount() { return Object.keys(arch.days).reduce(function (a, d) { return a + arch.days[d].rows.length; }, 0); }
  function saveArchiveIndex() {
    store(K.arch, { v: 1, days: Object.keys(arch.days).sort().map(function (d) { var x = arch.days[d]; return { day: d, at: x.at, done: x.done, cut: x.cut, fv: x.fv || 1, n: x.rows.length }; }) });
  }
  var ARCH_FETCH = 3;   // hentemåte: 3 = dato og klokkeslett satt slik CWs kode forventer, søket kontrollert (3.39.2)
  function addArchive(day, items) {
    var e = arch.days[day] || (arch.days[day] = { day: day, at: 0, done: false, cut: 0, fv: 1, rows: [] });
    var have = {};
    e.rows.forEach(function (r, i) { have[r.transactionId] = i; });
    items.forEach(function (it) {
      var r = L.archRow(it);
      if (!r) return;
      if (it.memberNumber !== undefined && it.memberNumber !== null && it.memberNumber !== '') archMem[r.transactionId] = it.memberNumber;
      if (have[r.transactionId] !== undefined) e.rows[have[r.transactionId]] = r; else { have[r.transactionId] = e.rows.length; e.rows.push(r); }
    });
    e.at = Date.now();
    // tak: de eldste dagene går først (aldri dagen som hentes nå)
    var days = Object.keys(arch.days).sort();
    while (archCount() > ARCH_LIMIT && days.length > 1) { var old = days.shift(); if (old === day) { days.push(old); continue; } delete arch.days[old]; store(archKey(old), null); }
    store(archKey(day), { rows: e.rows });
    saveArchiveIndex();
    archVer++;
  }
  function clearArchive() {
    Object.keys(arch.days).forEach(function (d) { store(archKey(d), null); });
    arch = { days: {} }; archMem = {}; archVer++;
    store(K.arch, null);
  }
  // Listen i CW pluss raden fra samlet grunnlag som ikke står i listen nå. Slike rader kan analyseres, men ikke skannes eller markeres.
  function allRecs() {
    var days = Object.keys(arch.days);
    if (!days.length) return recs;
    if (allCache && allCache.recs === recs && allCache.ver === archVer) return allCache.out;
    var have = {}, out = recs.slice(), prev = allCache ? allCache.arch : {}, next = {};
    recs.forEach(function (r) { have[r.item.transactionId] = true; });
    days.sort().forEach(function (d) {
      arch.days[d].rows.forEach(function (row) {
        var id = row.transactionId;
        if (have[id]) return;
        have[id] = true;
        var r = prev[id] && prev[id].row === row ? prev[id] : { row: row, item: archMem[id] !== undefined ? Object.assign({}, row, { memberNumber: archMem[id] }) : row, tr: null, show: true, base: true, arch: true };
        next[id] = r;
        out.push(r);
      });
    });
    allCache = { recs: recs, ver: archVer, out: out, arch: next };
    return out;
  }

  function sumInputs() { return { min: document.querySelector('[ng-model="vm.selectedFilters.sumMin"]'), max: document.querySelector('[ng-model="vm.selectedFilters.sumMax"]') }; }
  function timeInputs() { return { from: document.getElementById('fromTimePicker'), to: document.getElementById('toTimePicker') }; }
  function timeWidget(node) { var $ = jq(), w = $ && node ? $(node).data('kendoTimePicker') : null; return w && typeof w.value === 'function' ? w : null; }
  // Klokkeslett i CWs tidsfelt: via Kendo-widgeten når den finnes, og i feltet, som når du skriver selv.
  // Datodelen er dagens dato, som når Kendo tolker et klokkeslett du skriver; CW setter grenser på til-tiden ut fra fra-tiden,
  // og et klokkeslett med en annen dato regnes da som utenfor grensen (CW satte til-tiden lik fra-tiden). «base» velger en annen dato.
  // CW leser klokkeslettet når feltet mister fokus (ng-blur="vm.onFromTimeChange()"), men sin egen kopi av verdien oppdateres litt etter;
  // derfor sendes blur først etter en kort pause, ett felt om gangen, som når du skriver selv. Ellers søkte CW med forrige klokkeslett
  // (eller feilet på tom tid: «Cannot read properties of null (reading 'valueOf')»).
  function settleMs() { var h = window.__kvrSearch || {}; return h.settle >= 0 ? h.settle : 250; }
  // CWs kopi av verdien (k-ng-model="vm.fromTime" osv.), når den kan leses; ellers undefined. CW kjører uten Angulars debug-info,
  // så scope() og controller() gir ingenting; Kendo-widgeten har likevel scopet sitt ($angular_scope) når den er laget av Angular.
  function cwCopy(node) {
    try {
      var ex = node.getAttribute('k-ng-model') || node.getAttribute('ng-model');
      if (!ex) return undefined;
      var $ = jq(), w = $ ? ($(node).data('kendoTimePicker') || $(node).data('kendoDatePicker')) : null;
      var sc = w && w.$angular_scope;
      if (sc && typeof sc.$eval === 'function') return sc.$eval(ex);
      var ng = window.angular, el = ng && ng.element ? ng.element(node) : null;
      sc = el && typeof el.scope === 'function' ? el.scope() : null;
      if (sc && typeof sc.$eval === 'function') return sc.$eval(ex);
      var c = el && typeof el.controller === 'function' ? el.controller() : null, m = /^vm\.(\w+)$/.exec(ex);
      return c && m && m[1] in c ? c[m[1]] : undefined;
    } catch (e) { return undefined; }
  }
  function copyMin(v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getHours() * 60 + v.getMinutes();
    if (v === null || v === '') return null;
    return typeof v === 'string' ? L.mins(v.trim().slice(0, 5)) : undefined;
  }
  function copyDay(v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.getFullYear() + '-' + p2(v.getMonth() + 1) + '-' + p2(v.getDate());
    if (v === null || v === '') return '';
    var m = typeof v === 'string' ? /^(\d{4}-\d{2}-\d{2})|^(\d{2})\.(\d{2})\.(\d{4})/.exec(v.trim()) : null;
    return m ? (m[1] || m[4] + '-' + m[3] + '-' + m[2]) : undefined;
  }
  // Dato og klokkeslett settes slik CWs kode forventer. CW søker på selectedFilters.fromDate/toDate (dato + klokkeslett), som bare
  // oppdateres når et felt forlates (ng-blur: vm.onFromDateChange, onToDateChange, onFromTimeChange, onToTimeChange). Funksjonene leser
  // CWs kopier (k-ng-model) av alle fire feltene, sammenligner fra mot til og «retter» den andre siden når fra er etter til, og
  // onFromTimeChange/onToTimeChange feiler når den andre tiden er tom. Derfor settes alle verdiene først, så ventes det til CWs kopier
  // har dem (eller en fast pause når de ikke kan leses), og først da forlates feltene, ett om gangen. Da er fra aldri etter til når CW
  // sammenligner, og hver side av søket får sin dato og sitt klokkeslett. Klokkeslettene får samme dato (i dag), så CWs sammenligning
  // av hele tidspunkter blir en sammenligning av klokkeslett.
  function fieldValue(f, base) {
    if (f.kind === 't') { var d = new Date(base.getTime()); d.setHours(Math.floor(f.v / 60), f.v % 60, 0, 0); return d; }
    var p = String(f.v).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function fieldIs(f, c) { return f.kind === 't' ? copyMin(c) === f.v : copyDay(c) === f.v; }
  async function setFields(fields, reverse) {
    fields = fields.filter(function (f) { return f.node && f.v !== null && f.v !== undefined && f.v !== ''; });
    var base = new Date();
    base.setHours(0, 0, 0, 0);
    fields.forEach(function (f) {
      var w = f.kind === 't' ? timeWidget(f.node) : dateWidget(f.node);
      if (w) { w.value(fieldValue(f, base)); if (typeof w.trigger === 'function') w.trigger('change'); }
      setInputValue(f.node, f.kind === 't' ? L.hhmm(f.v) : noDate(f.v), true);
    });
    var t0 = Date.now();
    await wait(settleMs());
    while (Date.now() - t0 < 3000 && fields.some(function (f) { var c = cwCopy(f.node); return c !== undefined && !fieldIs(f, c); })) await wait(50);
    var order = reverse ? fields.slice().reverse() : fields;
    for (var i = 0; i < order.length; i++) {
      var c = cwCopy(order[i].node);
      if (c !== undefined && !fieldIs(order[i], c)) continue;   // CW har ikke fått verdien: blur ville bare få CW til å feile eller sette den tilbake
      order[i].node.dispatchEvent(new Event('blur', { bubbles: true }));
      await wait(Math.min(settleMs(), 60));
    }
    await wait(settleMs());
  }
  // Det CW faktisk søker på (vm.selectedFilters.fromDate/toDate), som «ÅÅÅÅ-MM-DD TT:MM»; null når det ikke kan leses.
  function cwFilters() {
    try {
      var $ = jq(), n = document.querySelector('#fromDatePicker'), w = $ && n ? $(n).data('kendoDatePicker') : null, sc = w && w.$angular_scope;
      var f = sc && typeof sc.$eval === 'function' ? sc.$eval('vm.selectedFilters') : null;
      if (!f || typeof f !== 'object') return null;
      var at = function (v) { var m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(String(v || '')); return m ? m[1] + ' ' + m[2] : null; };
      return { from: at(f.fromDate), to: at(f.toDate) };
    } catch (e) { return null; }
  }
  function partSay(t) { if (ui.partStatus) ui.partStatus.textContent = t; say(t); }

  // Lastesymboler som er synlige nå (utenfor panelet og utenfor radene i listen). Brukes for å se når CW begynner og slutter å laste.
  function loaders() {
    return Array.prototype.filter.call(document.querySelectorAll('.k-loading-mask, .k-loading-image, .k-loading, [class*="loading"], [class*="spinner"]'), function (n) {
      if (n.closest('#kvr-panel') || n.closest('tbody')) return false;
      var cs = window.getComputedStyle(n), r = n.getBoundingClientRect();
      return r.width >= 8 && r.height >= 8 && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0;
    });
  }
  function domRows() { var tb = grid && grid.tbody && grid.tbody[0]; return tb ? tb.querySelectorAll(':scope > tr').length : 0; }

  // Søk med CWs Oppdater-knapp. Pausen før er minst like lang som forrige søk tok, så CW aldri jobber mer enn halve tiden for oss.
  // Svaret regnes som ferdig når CW har begynt å laste (dataBound eller et nytt lastesymbol), lastesymbolet er borte,
  // og listen har stått stille en stund etterpå. En liste som er lik den før søket, eller som ikke passer med «expect»
  // (dato og klokkeslett), brukes først etter lengre stillhet. Et lastesymbol som blir stående, holder ikke søket i gang:
  // når listen er ny, passer og har stått stille i 2 s, eller symbolet har stått i 20 s, ses det bort fra det. Uten svar innen timeout: null.
  async function searchNow(pause, timeout, expect, say) {
    var b = document.querySelector('[ng-click="vm.applyFilters()"]');
    if (!b) throw new Error('Fant ikke OPPDATER-knappen i CW.');
    await wait(Math.max(pause, pause > 0 ? lastSearchMs : 0));
    var hook = window.__kvrSearch || {}, opt = function (k, d) { return hook[k] >= 0 ? hook[k] : d; };
    var poll = opt('poll', 150) || 150, quietN = opt('quiet', 600), emptyN = opt('empty', 4000), sameN = opt('same', 6000), misfitN = opt('misfit', 15000), stuckN = opt('stuck', 20000), busyOkN = opt('busyOk', 2000);
    var before = boundCount, key0 = idsKey(gridData()), t0 = Date.now(), old = loaders(), started = false, sawBusy = false, busySince = 0, last = null, since = 0;
    var state = '', said = 0, seen = [];
    var note = function (st) {
      state = st;
      if (say && Date.now() - said >= 1000) { said = Date.now(); say(st + ' (' + Math.round((Date.now() - t0) / 1000) + ' s)'); }
    };
    b.click();
    while (Date.now() - t0 < timeout) {
      await wait(poll);
      var now = Date.now(), fresh = loaders().filter(function (n) { return old.indexOf(n) === -1; }), busy = fresh.length > 0;
      fresh.forEach(function (n) { var c = String(n.className || n.tagName).slice(0, 60); if (seen.length < 3 && seen.indexOf(c) === -1) seen.push(c); });
      if (busy && !busySince) busySince = now;
      if (!busy && busySince) { sawBusy = true; busySince = 0; since = now; }   // stillheten regnes fra lastesymbolet forsvant
      if (busy && now - busySince > stuckN) { old = old.concat(loaders()); busy = false; busySince = 0; }
      if (busy || boundCount > before) started = true;
      if (!started) { note('venter på svar fra CW'); continue; }
      var data = gridData(), ids = idsKey(data), key = ids + '#' + data.length + '#' + domRows();
      if (key !== last) { last = key; since = now; note(busy ? 'CW laster' : 'listen tegnes'); continue; }
      var quiet = now - since;
      if (busy) {
        if (!(boundCount > before && data.length && ids !== key0 && quiet >= busyOkN && (!expect || expect(data)))) { note('CW laster'); continue; }
      } else {
        if (quiet < (data.length ? quietN : emptyN)) { note(data.length ? 'listen tegnes' : 'listen er tom, venter litt'); continue; }
        if (!sawBusy && ids === key0 && quiet < sameN) { note('listen er lik som før søket'); continue; }
        if (expect && quiet < misfitN && !expect(data)) { note('listen viser ikke dagen og klokkeslettet det ble søkt på'); continue; }
      }
      lastSearchMs = since - t0;
      lastSearchInfo = { wait: state, loaders: seen };
      return data;
    }
    lastSearchInfo = { wait: state, loaders: seen };
    return null;
  }
  var lastSearchInfo = { wait: '', loaders: [] };

  // Klokkeslettet slik CW har det (uten pluginens tidsforskyvning) innenfor vinduet, med ett minutts slingring.
  function inWindow(it, w) {
    var t = L.mins(L.parseDT(it.endDateTime).time);
    if (t === null) return true;
    t -= timeShift;
    return t >= w.from - 1 && t <= w.to + 1;
  }

  // Dato i CWs datofelt: via Kendo-widgeten når den finnes, og i feltet (dd.mm.åååå), som når du skriver selv.
  function dateWidget(node) { var $ = jq(), w = $ && node ? $(node).data('kendoDatePicker') : null; return w && typeof w.value === 'function' ? w : null; }
  // Dato og klokkeslett for radene slik CW viser dem (cellen i listen; ellers rådata i norsk tid), uten pluginens tidsforskyvning.
  // Rader uten lesbar tid teller ikke.
  function cwTimes(data) {
    var tb = grid && grid.tbody && grid.tbody[0], byUid = {};
    if (tb) Array.prototype.forEach.call(tb.querySelectorAll(':scope > tr[data-uid]'), function (tr) { byUid[tr.getAttribute('data-uid')] = tr; });
    return data.map(function (d) {
      var tr = d && d.uid ? byUid[d.uid] : null, c = tr && tr.querySelector('td[data-field="endDateTime"]'), shown = c ? L.parseCellDT(c.textContent) : '';
      var p = L.parseDT(shown || L.localDT(plain(d).endDateTime));
      return { date: p.date, min: L.mins(p.time) };
    }).filter(function (x) { return x.date; });
  }
  function onDay(tm, day) { return !tm.length || tm.filter(function (x) { return x.date === day; }).length >= tm.length * 0.9; }
  function fitsWin(tm, win) {
    if (win.from === L.DAY_WINDOW.from && win.to === L.DAY_WINDOW.to) return true;
    return tm.every(function (x) { return x.min === null || (x.min >= win.from - 1 && x.min <= win.to + 1); });
  }

  function p2(n) { return (n < 10 ? '0' : '') + n; }
  // Verdien i CWs dato- og tidsfelt slik widgeten har den (ÅÅÅÅ-MM-DD og minutter); tomt felt gir '' og null.
  function readDate(node) {
    if (!node) return '';
    var w = dateWidget(node), v = w ? w.value() : null, m;
    if (w) return v instanceof Date ? v.getFullYear() + '-' + p2(v.getMonth() + 1) + '-' + p2(v.getDate()) : '';
    return (m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(node.value || '')) ? m[3] + '-' + m[2] + '-' + m[1] : '';
  }
  function readTime(node) {
    if (!node) return null;
    var w = timeWidget(node), v = w ? w.value() : null;
    if (w) return v instanceof Date ? v.getHours() * 60 + v.getMinutes() : null;
    return L.mins(String(node.value || '').trim());
  }
  // Grensene CW har satt på et dato- eller tidsfelt, for feilmeldingen.
  function limits(node) {
    var $ = jq(), w = $ && node ? ($(node).data('kendoTimePicker') || $(node).data('kendoDatePicker')) : null, f = function (d) {
      return d instanceof Date ? d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) : '–';
    };
    if (!w) return '';
    try {
      var mn = typeof w.min === 'function' ? w.min() : w.options && w.options.min, mx = typeof w.max === 'function' ? w.max() : w.options && w.options.max;
      // lik min og maks er Kendos standard (ingen grense)
      if (mn instanceof Date && mx instanceof Date && mn.getHours() === mx.getHours() && mn.getMinutes() === mx.getMinutes()) return '';
      return mn instanceof Date || mx instanceof Date ? f(mn) + ' til ' + f(mx) : '';
    } catch (e) { return ''; }
  }
  function shownVal(v, time) { return v === null || v === '' ? 'tomt' : time ? L.hhmm(v) : v; }
  // Avvik mellom ønsket og faktisk klokkeslett: i feltet, og i CWs egen kopi når den kan leses.
  function timeBad(ti, from, to) {
    var bad = [];
    if (!ti.from || !ti.to) return bad;
    if (readTime(ti.from) !== from) bad.push({ f: 'Fra-tid', n: ti.from, v: shownVal(readTime(ti.from), true), t: 1 });
    if (readTime(ti.to) !== to) bad.push({ f: 'Til-tid', n: ti.to, v: shownVal(readTime(ti.to), true), t: 1 });
    [['Fra-tid i CW', ti.from, from], ['Til-tid i CW', ti.to, to]].forEach(function (x) {
      var c = cwCopy(x[1]), cm = c === undefined ? undefined : copyMin(c);
      if (cm !== undefined && cm !== x[2]) bad.push({ f: x[0], n: x[1], v: shownVal(cm, true), t: 1 });
    });
    return bad;
  }

  async function setRange(day, win, ti) {
    var fd = document.querySelector('#fromDatePicker'), td = document.querySelector('#toDatePicker');
    var fields = [{ node: fd, kind: 'd', v: day }, { node: td, kind: 'd', v: day }];
    if (ti.from && ti.to) fields.push({ node: ti.from, kind: 't', v: win.from }, { node: ti.to, kind: 't', v: win.to });
    var check = function () {
      var bad = [];
      if (fd && readDate(fd) !== day) bad.push({ f: 'Dato fra', n: fd, v: shownVal(readDate(fd)) });
      if (td && readDate(td) !== day) bad.push({ f: 'Dato til', n: td, v: shownVal(readDate(td)) });
      [['Dato fra i CW', fd], ['Dato til i CW', td]].forEach(function (x) {
        var c = x[1] ? cwCopy(x[1]) : undefined, cd = c === undefined ? undefined : copyDay(c);
        if (cd !== undefined && cd !== day) bad.push({ f: x[0], n: x[1], v: shownVal(cd) });
      });
      bad = bad.concat(timeBad(ti, win.from, win.to));
      var sf = cwFilters(), timed = ti.from && ti.to;
      if (sf) {
        var wf = day + ' ' + L.hhmm(win.from), wt = day + ' ' + L.hhmm(win.to);
        if (sf.from !== null && (timed ? sf.from !== wf : sf.from.slice(0, 10) !== day)) bad.push({ f: 'Søket i CW fra', v: sf.from, t: 1 });
        if (sf.to !== null && (timed ? sf.to !== wt : sf.to.slice(0, 10) !== day)) bad.push({ f: 'Søket i CW til', v: sf.to, t: 1 });
      }
      return bad;
    };
    var bad = [];
    for (var k = 0; k < 3; k++) { await setFields(fields, k === 1); bad = check(); if (!bad.length) return; }
    var lim = bad.map(function (b) { var l = b.n ? limits(b.n) : ''; return l ? b.f.toLowerCase() + ' ' + l : ''; }).filter(Boolean);
    throw new Error('CW godtok ikke ' + day + ' ' + L.timeText(win) + ' i søkefeltene (' + bad.map(function (b) { return b.f + ' viser ' + b.v; }).join(', ') +
      (lim.length ? '; grenser i CW: ' + lim.join(', ') : '') + '). Kjøringen ble stoppet; ingenting fra dette søket er lagret.');
  }

  // Passer ikke listen med dagen og klokkeslettet, søkes det én gang til med feltene satt på nytt (CW kan ha brukt verdiene fra forrige søk).
  async function partSearch(day, win, ti) {
    var head = 'Henter ' + day + ' (' + L.timeText(win) + ')', t0 = Date.now(), rows = null, again = 0;
    var fit = function (data) { var tm = cwTimes(data); return onDay(tm, day) && fitsWin(tm, win); };
    for (; again < 2; again++) {
      await setRange(day, win, ti);
      rows = await searchNow(bulk.pause, bulk.timeout, fit, function (t) { partSay(head + (again ? ', nytt forsøk' : '') + ': ' + t); });
      if (rows === null || fit(rows) || bulk.stop) break;
    }
    bulk.log.push({ day: day, win: L.timeText(win), n: rows ? rows.length : null, ms: Date.now() - t0, wait: lastSearchInfo.wait, loaders: lastSearchInfo.loaders.slice(), again: again > 0 });
    if (bulk.log.length > 400) bulk.log.shift();
    return rows;
  }

  function wrongDay(rows, day) {
    var seen = {};
    cwTimes(rows).forEach(function (x) { if (x.date !== day) seen[x.date] = 1; });
    return 'Listen i CW viser ' + (Object.keys(seen).sort().slice(0, 3).join(', ') || 'andre datoer') + ', ikke ' + day + ' som det ble søkt på. Datofeltet i CW ble trolig ikke satt, eller CW var ikke ferdig med å laste. Kjøringen ble stoppet; ingenting fra dette søket er lagret.';
  }

  async function fetchParts() {
    if (bulk || cwRun || scanning || !grid) return;
    var from = cw.dateFrom || (ui.cwFrom && ui.cwFrom.value), to = cw.dateTo || (ui.cwTo && ui.cwTo.value) || from;
    var days = L.dayList(from, to, ARCH_DAYS);
    if (!days.length) { partSay('Velg Dato fra og Dato til under «Søk i hele journalen» først.'); return; }
    if (cw.free) { partSay('Fjern «Vare (EAN/navn)» først: fritekstsøk brukes ikke i deler, fordi det er tungt for CWs server.'); return; }
    var q = function (sel) { return document.querySelector(sel); };
    var si = sumInputs(), ti = timeInputs(), ft = q('#freetextSearchInput'), fd = q('#fromDatePicker'), td = q('#toDatePicker');
    var tw = function (n) { var w = timeWidget(n); return { t: n ? n.value : '', w: w ? w.value() : null }; };
    var dw = function (n) { var w = dateWidget(n); return { t: n ? n.value : '', w: w ? w.value() : null }; };
    var orig = { dFrom: dw(fd), dTo: dw(td), from: fd ? fd.value : '', to: td ? td.value : '', min: si.min ? si.min.value : '', max: si.max ? si.max.value : '', free: ft ? ft.value : '', tFrom: tw(ti.from), tTo: tw(ti.to) };
    var hook = window.__kvrParts || {};
    bulk = { stop: false, pause: hook.pause >= 0 ? hook.pause : PART_PAUSE, timeout: hook.timeout || CWX_TIMEOUT, cut: hook.cut || CWX_CUT, scan: ui.partScan.box.checked, extra: ui.partExtra.box.checked, log: [] };
    var errors = [], log = [], t0 = Date.now(), nRows = 0, nScan = 0, nCut = 0, skipped = 0, parts = 0, today = todayStr();
    if (!ti.from || !ti.to) errors.push('Fant ikke CWs felt for fra- og til-tid. Dager med 1000 bonger kan ikke deles og blir kuttet.');
    ui.partBtn.disabled = true; ui.partStop.disabled = false; ui.cwxBtn.disabled = true;
    var nums = Object.keys(cw.stores).filter(function (k) { return cw.stores[k]; });
    if (nums.length) setCwStores(nums);
    if (ft) setInputValue(ft, '');
    if (si.min) setInputValue(si.min, '');   // beløp brukes ikke: hele dagen skal med
    if (si.max) setInputValue(si.max, '');
    if (cw.members) setInputValue(q('[ng-model="vm.selectedFilters.memberNumber"]'), cw.members);
    if (cw.loyal) setInputValue(q('[ng-model="vm.selectedFilters.externalLoyaltyNumber"]'), cw.loyal);
    try {
      for (var di = 0; di < days.length && !bulk.stop; di++) {
        var day = days[di];
        // dager hentet før 3.38.6 kan mangle bonger (CW søkte med forrige klokkeslett) og hentes på nytt
        if (arch.days[day] && arch.days[day].done && (arch.days[day].fv || 1) >= ARCH_FETCH && day < today) { skipped++; continue; }
        if (bulk.extra) {
          // tilleggsdata for hele dagen først (søk uten klokkeslett, så CWs filtre ett om gangen), så rask skanning vet hvilke bonger som trengs
          var whole = await partSearch(day, L.DAY_WINDOW, ti);
          if (whole === null) { errors.push('CW svarte ikke på søket for ' + day + ' før tilleggsdata. Kjøringen ble stoppet.'); break; }
          if (!onDay(cwTimes(whole), day)) { errors.push(wrongDay(whole, day)); break; }
          bulk.inExtra = true;
          await fetchCwExtra();
          bulk.inExtra = false;
          var rr = cwx && cwx.runs[0];
          if (rr && rr.errors.length) errors.push(day + ', tilleggsdata: ' + rr.errors.join(' '));
          if (bulk.stop) break;
        }
        var queue = [{ win: L.DAY_WINDOW, depth: 0 }], cutHere = 0, dayN = 0;
        while (queue.length && !bulk.stop) {
          var p = queue.shift();
          parts++;
          partSay('Henter ' + day + ' (' + L.timeText(p.win) + ')' + (days.length > 1 ? ', dag ' + (di + 1) + ' av ' + days.length : '') + '…');
          var rows = await partSearch(day, p.win, ti);
          if (rows === null) { errors.push('CW svarte ikke på søket for ' + day + ' (' + L.timeText(p.win) + ') innen ' + Math.round(bulk.timeout / 1000) + ' s. Kjøringen ble stoppet; start igjen senere, så fortsetter den der den slapp.'); bulk.stop = true; break; }
          if (!onDay(cwTimes(rows), day)) { errors.push(wrongDay(rows, day)); bulk.stop = true; break; }
          var got = collect();
          // CW har brukt tidsfeltene når alle bongene ligger i vinduet (ett minutts slingring). Ellers kuttes dagen, og det står hvorfor.
          if (p.depth > 0 && got.some(function (r) { return !inWindow(r.item, p.win); })) {
            errors.push('CW brukte ikke klokkeslett-feltene for ' + day + ' (bonger utenfor ' + L.timeText(p.win) + '). Dagen er kuttet ved 1000 bonger.');
            addArchive(day, got.map(function (r) { return r.item; }));
            queue = []; cutHere++;
            continue;
          }
          if (rows.length >= bulk.cut && ti.from && ti.to) {
            var sub = p.depth < 12 ? L.splitTime(p.win) : [];
            if (sub.length) { addArchive(day, got.map(function (r) { return r.item; })); queue = sub.map(function (w) { return { win: w, depth: p.depth + 1 }; }).concat(queue); continue; }
            cutHere++;
          } else if (rows.length >= bulk.cut) cutHere++;
          addArchive(day, got.map(function (r) { return r.item; }));
          if (bulk.scan) {
            var todo = todoFor(got);
            if (todo.length) {
              var sr = await scanList(todo);
              nScan += sr.done;
              if (sr.stopped) { errors.push('Skanningen ble stoppet fordi CW ikke svarte på flere bonger på rad. Start igjen senere, så fortsetter den der den slapp.'); bulk.stop = true; break; }
            }
            if (cancelScan && bulk.stop) break;
          }
        }
        if (bulk.stop) break;
        var e = arch.days[day];
        dayN = e ? e.rows.length : 0;
        if (e) { e.done = true; e.cut = cutHere; e.fv = ARCH_FETCH; e.at = Date.now(); saveArchiveIndex(); }
        nRows += dayN; nCut += cutHere;
        log.push(day + ': ' + plur(dayN, 'bong', 'bonger') + (cutHere ? ' (kuttet)' : ''));
      }
    } catch (ex) { errors.push(String(ex && ex.message || ex)); }
    var stopped = bulk.stop && !errors.length;
    // tilbake til søket ditt
    try {
      // dato og klokkeslett settes tilbake samme vei som under hentingen og kontrolleres; tomme klokkeslett blir 00:00 og 23:59
      var oDay = function (o) { var v = o.w; return v instanceof Date ? copyDay(v) : copyDay(o.t || '') || ''; };
      var oMin = function (o, empty) { var v = o.w; return v instanceof Date ? v.getHours() * 60 + v.getMinutes() : (L.mins(String(o.t || '').trim()) === null ? empty : L.mins(String(o.t).trim())); };
      var df = oDay(orig.dFrom), dt = oDay(orig.dTo), tf = oMin(orig.tFrom, L.DAY_WINDOW.from), tt = oMin(orig.tTo, L.DAY_WINDOW.to);
      var back3 = [{ node: fd, kind: 'd', v: df }, { node: td, kind: 'd', v: dt }];
      if (ti.from && ti.to) back3.push({ node: ti.from, kind: 't', v: tf }, { node: ti.to, kind: 't', v: tt });
      var restoreBad = function () {
        var b = timeBad(ti, tf, tt), sf = cwFilters();
        if (df && readDate(fd) !== df) b.push({ f: 'Dato fra', v: shownVal(readDate(fd)) });
        if (dt && readDate(td) !== dt) b.push({ f: 'Dato til', v: shownVal(readDate(td)) });
        if (sf && ti.from && ti.to && df && dt) {
          if (sf.from !== null && sf.from !== df + ' ' + L.hhmm(tf)) b.push({ f: 'Søket i CW fra', v: sf.from });
          if (sf.to !== null && sf.to !== dt + ' ' + L.hhmm(tt)) b.push({ f: 'Søket i CW til', v: sf.to });
        }
        return b;
      };
      var tb = [];
      for (var ri = 0; ri < 3; ri++) { await setFields(back3, ri === 1); tb = restoreBad(); if (!tb.length) break; }
      if (tb.length) errors.push('Søket ditt i CW ble ikke satt helt tilbake (' + tb.map(function (b) { return b.f + ' viser ' + b.v; }).join(', ') + '). Sjekk dato og fra- og til-tid i CW før du søker selv.');
      if (si.min) setInputValue(si.min, orig.min);
      if (si.max) setInputValue(si.max, orig.max);
      if (ft && orig.free) setInputValue(ft, orig.free);
      var back = await searchNow(bulk.pause, bulk.timeout);
      if (back === null) errors.push('CW svarte ikke da søket ditt skulle hentes tilbake. Trykk Oppdater i CW.');
    } catch (ex2) { errors.push('Tilbakestilling: ' + (ex2 && ex2.message || ex2)); }
    var searches = bulk.log.slice();
    bulk = null; cancelScan = false;
    ui.partBtn.disabled = false; ui.partStop.disabled = true; ui.cwxBtn.disabled = false;
    setProgress(0);
    archVer++;
    lastParts = { at: Date.now(), days: days.length, skipped: skipped, parts: parts, rows: nRows, scanned: nScan, cut: nCut, log: log, errors: errors, stopped: stopped, sec: Math.round((Date.now() - t0) / 1000), searches: searches };
    apply();
    renderParts();
    partSay((stopped ? 'Stoppet. ' : 'Ferdig. ') + parts + ' søk, ' + plur(nRows, 'bong', 'bonger') + ' hentet' + (nScan ? ', ' + nScan + ' skannet' : '') + (skipped ? ', ' + plur(skipped, 'dag', 'dager') + ' hentet før' : '') + '. Samlet grunnlag: ' + archCount() + ' bonger.' + (errors.length ? ' Merknader: se under.' : ''));
  }
  var lastParts = null;

  function stopParts() { if (bulk) { bulk.stop = true; cancelScan = true; partSay('Stopper etter søket eller bongen som pågår, og setter søket ditt tilbake…'); } }

  function renderParts() {
    if (!ui.partInfo) return;
    ui.partInfo.innerHTML = '';
    var days = Object.keys(arch.days).sort(), n = archCount();
    if (!days.length) ui.partInfo.appendChild(hintEl('Samlet grunnlag er tomt.'));
    else {
      var scanned = 0, cut = days.filter(function (d) { return arch.days[d].cut; });
      days.forEach(function (d) { arch.days[d].rows.forEach(function (r) { if (scanMap[r.transactionId]) scanned++; }); });
      ui.partInfo.appendChild(hintEl('Samlet grunnlag: ' + n + ' bonger fra ' + plur(days.length, 'dag', 'dager') + ' (' + days[0] + (days.length > 1 ? ' – ' + days[days.length - 1] : '') + '), ' + scanned + ' skannet. ' +
        (cut.length ? 'Kuttet ved 1000: ' + cut.join(', ') + '. ' : '') +
        (days.some(function (d) { return arch.days[d].done && (arch.days[d].fv || 1) < ARCH_FETCH; }) ? 'Dager hentet med eldre versjon kan mangle bonger og hentes på nytt neste gang. ' : '') + 'Analysen bruker det sammen med listen. Medlemsnummer for bonger som ikke står i listen, finnes bare til siden lastes på nytt.'));
    }
    if (lastParts) {
      if (lastParts.log.length) ui.partInfo.appendChild(hintEl('Sist: ' + lastParts.log.join(' · ') + ' (' + Math.round(lastParts.sec / 60) + ' min).'));
      lastParts.errors.forEach(function (e) { ui.partInfo.appendChild(el('div', { class: 'kvr-hint kvr-cwx-err', text: e })); });
      if (lastParts.searches.length) {
        var det = el('details', { class: 'kvr-hint' });
        det.appendChild(el('summary', { text: 'Søkene mot CW (' + lastParts.searches.length + ')' }));
        det.appendChild(el('div', { text: lastParts.searches.map(function (x) {
          return x.day + ' ' + x.win + ': ' + (x.n === null ? 'ikke svar' : plur(x.n, 'bong', 'bonger')) + ', ' + (x.ms / 1000).toFixed(1) + ' s' +
            (x.again ? ' (søkt to ganger)' : '') + (x.ms > 5000 && x.wait ? ' (ventet på: ' + x.wait + ')' : '') + (x.loaders && x.loaders.length ? ' [lastesymbol: ' + x.loaders.join(', ') + ']' : '');
        }).join(' · ') }));
        ui.partInfo.appendChild(det);
      }
    }
  }

  // ---- skanning -------------------------------------------------------------
  function iframeDoc() {
    var f = document.querySelector('iframe');
    var d = null;
    try { d = f && f.contentDocument; } catch (e) { d = null; }
    return d && d.body ? d : null;
  }

  // Tekst utenfor tabellene: linjer før første tabell er topptekst, resten (mellom og etter tabeller) er bunn. Linjene deles på BR, NEWLINE, P og DIV.
  function outsideText(doc) {
    var lines = [], cur = '', tables = 0;
    var brk = function () { var t = cur.replace(/\s+/g, ' ').trim(); if (t) lines.push({ t: t.slice(0, 200), after: tables }); cur = ''; };
    var walk = function (n) {
      if (n.nodeType === 3) { cur += n.nodeValue; return; }
      if (n.nodeType !== 1) return;
      var tag = n.tagName;
      if (tag === 'STYLE' || tag === 'SCRIPT') return;
      if (tag === 'TABLE') { brk(); tables++; return; }
      var block = tag === 'BR' || tag === 'NEWLINE' || tag === 'P' || tag === 'DIV';
      if (block) brk();
      for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
      if (block) brk();
    };
    try { if (doc.body) walk(doc.body); brk(); } catch (e) { return { tl: [], bl: [] }; }
    return { tl: lines.filter(function (x) { return !x.after; }).map(function (x) { return x.t; }).slice(0, 60), bl: lines.filter(function (x) { return x.after; }).map(function (x) { return x.t; }).slice(0, 60) };
  }

  function rowsFrom(doc) {
    var rows = Array.prototype.map.call(doc.querySelectorAll('tr'), function (tr) {
      return Array.prototype.map.call(tr.children, function (c) { return c.textContent.replace(/\s+/g, ' ').trim(); });
    });
    var head = doc.body ? doc.body.textContent : '';
    rows.hd = L.headerDT(head);
    rows.hs = L.headerSeq(head);
    var out = outsideText(doc);
    rows.tl = out.tl;
    rows.bl = out.bl;
    return rows;
  }

  async function loadViaDom(r, force) {
    var sel = grid.select();
    var already = !force && sel && sel[0] === r.tr;
    var d = iframeDoc();
    if (!d) return null;
    if (!already) { d.body.innerHTML = ''; if (force && typeof grid.clearSelection === 'function') grid.clearSelection(); grid.select(r.tr); }
    // Bongen er klar når den har innhold og ikke har endret seg på «settle» ms (høyst 600 ms etter at den kom).
    var pace = window.__kvrScan || {}, settle = pace.settle >= 0 ? pace.settle : 60, poll = pace.poll > 0 ? pace.poll : 25;
    var t0 = Date.now(), seen = -1, since = 0, first = 0, limit = pace.timeout > 0 ? pace.timeout : SCAN_TIMEOUT;
    while (Date.now() - t0 < limit) {
      d = iframeDoc();
      if (d && d.body.innerHTML.length > 0 && (d.querySelector('tr') || d.querySelector('.no-details'))) {
        var len = d.body.innerHTML.length, now = Date.now();
        if (!first) { first = now; lastLoadMs = already ? 0 : now - t0; }
        if (len !== seen) { seen = len; since = now; }
        else if (now - since >= settle || now - first >= 600) return rowsFrom(d);
      }
      await wait(poll);
    }
    return null;
  }

  // Kontroll mot feil bong i visningsfeltet: løpenummeret i topptekst skal være det samme som i den valgte raden.
  // Håndheves først når formatet er bevist (minst 3 treff), slik at en annen nummerering ikke stopper skanningen.
  function seqCheck(rows, rec) {
    if (rows.hs === null || rows.hs === undefined) return 'unknown';
    if (rows.hs === seqOf(rec.item.transactionId)) { seqProof.ok++; return 'ok'; }
    seqProof.bad++;
    return seqProof.ok >= 3 ? 'bad' : 'unknown';
  }

  async function scanList(todo) {
    if (scanning || cwRun || !todo.length) return { done: 0, failed: 0 };
    scanning = true; cancelScan = false;
    ui.scanBtn.disabled = true; ui.anomBtn.disabled = true; ui.stopBtn.disabled = false; ui.stopTop.style.display = ''; ui.retryBtn.disabled = true; if (ui.retryBtn2) ui.retryBtn2.disabled = true;
    var prev = grid.select();
    var prevTr = prev && prev[0];
    var done = 0, failed = 0, mism = 0, gone = 0, t0 = Date.now(), pc = scanPacer(), paceTxt = '', stopped = '';
    failedRecs = [];
    for (var i = 0; i < todo.length && !cancelScan; i++) {
      progress(i, todo.length, t0, 'Skanner', failed, paceTxt);
      // CW-listen kan ha skiftet (nytt søk): bruk raden som står der nå, eller hopp over bongen uten å vente på tidsavbrudd
      if (!todo[i].tr.isConnected) {
        var lv = recById(todo[i].item.transactionId);
        if (lv) todo[i] = lv; else { gone++; continue; }
      }
      var rows = null, chk = 'unknown', bt = Date.now();
      lastLoadMs = 0;
      try {
        for (var attempt = 0; attempt < 2; attempt++) {
          rows = await loadViaDom(todo[i], attempt > 0);
          chk = rows ? seqCheck(rows, todo[i]) : 'unknown';
          if (chk !== 'bad') break;
        }
      } catch (e) { rows = null; }
      // fartsregulator: neste bong venter etter hvor raskt CW svarte (feil bong i visningsfeltet er ikke en feil hos CW)
      var ms = lastLoadMs || Date.now() - bt, dec = L.paceNext(pc, ms, rows !== null || chk === 'bad');
      paceTxt = paceText(ms, dec, pc);
      if (chk === 'bad') { rows = null; mism++; }
      if (rows) {
        var id = todo[i].item.transactionId;
        scanMap[id] = todo[i].item.receiptType === 2 ? L.parseSettlement(rows) : L.parseReceipt(rows);
        scanMap[id].t = Date.now();
        if (rows.hd) scanMap[id].hd = rows.hd;
        dirty[id] = true;
        done++;
      } else { failed++; failedRecs.push(todo[i]); }
      if (dec.stop) { stopped = 'CW svarte ikke på ' + pc.fail + ' bonger på rad, så skanningen er stoppet. Prøv igjen senere.'; break; }
      if (dec.pause) { say('CW svarer tregt: pause i ' + Math.round(dec.pause / 1000) + ' s før neste bong…'); await pauseFor(dec.pause); }
      else if (dec.wait) await wait(dec.wait);
    }
    saveScan();
    setProgress(0);
    lastRetry = failedRecs.length ? retryScan : null;
    syncRetry();
    gcache = {};
    if (prevTr && prevTr.isConnected) grid.select(prevTr); else if (typeof grid.clearSelection === 'function') grid.clearSelection();
    scanning = false;
    ui.scanBtn.disabled = false; ui.anomBtn.disabled = false; ui.stopBtn.disabled = true;
    say((stopped ? stopped + ' ' : cancelScan ? 'Stoppet. ' : 'Ferdig. ') + 'Skannet ' + done + (failed ? ', feilet ' + failed : '') + (mism ? ' (' + mism + ' med feil bong i visningsfeltet)' : '') + (gone ? '. ' + gone + ' lå ikke lenger i CW-listen og ble hoppet over' : '') + '.');
    return { done: done, failed: failed, stopped: !!stopped };
  }

  function scanPacer() { var pz = window.__kvrScan || {}; return L.pacer({ min: pz.min >= 0 ? pz.min : window.__kvrScan ? 0 : SCAN_MIN_MS, pause: pz.pause > 0 ? pz.pause : 60000 }); }
  function paceText(ms, dec, pc) {
    var s = function (x) { return (x / 1000).toFixed(1).replace('.', ',') + ' s'; };
    return 'CW svarer på ' + s(ms) + (dec.state === 'treg' || pc.interval > pc.min * 1.2 ? ', farten er senket (' + s(pc.interval) + ' per bong)' : '');
  }
  async function pauseFor(ms) { var t = Date.now(); while (Date.now() - t < ms && !cancelScan && !(bulk && bulk.stop) && !(cwRun && cwRun.stop)) await wait(250); }

  function todoVisible() { return todoFor(recs.filter(function (r) { return r.base; })); }

  function etaText(sec) {
    if (!(sec > 0)) return '';
    return ' ≈ ' + (sec >= 60 ? Math.floor(sec / 60) + 'm ' + (sec % 60) + 's' : sec + 's') + ' igjen';
  }

  function progress(i, total, t0, label, failed, extra) {
    var elapsed = (Date.now() - t0) / 1000;
    var rem = i > 0 ? Math.round(elapsed / i * (total - i)) : 0;
    var pct = Math.round(i / total * 100);
    setProgress(Math.max(pct, 2));
    var msg = label + ' ' + (i + 1) + ' av ' + total + ' (' + pct + '%)' + etaText(rem) + (failed ? ' · feilet: ' + failed : '') + (extra ? ' · ' + extra : '') + (document.hidden ? ' · fanen er skjult, Chrome bremser skanningen' : '');
    say(msg);
  }

  function say(msg) {
    ui.opText.textContent = msg;
    ui.opRow.style.display = msg || scanning ? 'flex' : 'none';
    ui.stopTop.style.display = scanning ? '' : 'none';
    clearTimeout(sayTimer);
    if (msg && !scanning) sayTimer = setTimeout(function () { say(''); }, 9000);
  }

  function setProgress(pct) {
    if (!ui.bar) return;
    ui.barWrap.style.display = pct > 0 ? 'block' : 'none';
    ui.bar.style.width = pct + '%';
  }

  function syncRetry() {
    [ui.retryBtn, ui.retryBtn2].forEach(function (b) {
      if (!b) return;
      b.disabled = !lastRetry;
      b.textContent = lastRetry ? 'Prøv feilede på nytt (' + failedRecs.length + ')' : 'Prøv feilede på nytt';
    });
  }

  async function retryScan() {
    var list = failedRecs.slice();
    await scanList(list);
    apply();
  }

  async function scanVisible() {
    if (bulk) return;
    var todo = todoVisible();
    if (!todo.length) { say('Ingenting å skanne (alt er skannet, eller ingen synlige salg).'); return; }
    await scanList(todo);
    apply();
  }

  // ---- omfang for analysen: periode, butikk, kasserer, kasse og periode mot periode ------------
  function defaultScope() {
    return { dateFrom: '', dateTo: '', stores: [], cashiers: [], workstations: [], useFilters: false, compare: { on: false, from: '', to: '' } };
  }

  function sanitizeScope(raw) {
    var d = defaultScope();
    if (!raw || typeof raw !== 'object') return d;
    ['dateFrom', 'dateTo'].forEach(function (k) { if (typeof raw[k] === 'string') d[k] = raw[k]; });
    ['stores', 'cashiers', 'workstations'].forEach(function (k) { if (Array.isArray(raw[k])) d[k] = raw[k].map(String); });
    d.useFilters = !!raw.useFilters;
    if (raw.compare && typeof raw.compare === 'object') {
      d.compare.on = !!raw.compare.on;
      ['from', 'to'].forEach(function (k) { if (typeof raw.compare[k] === 'string') d.compare[k] = raw.compare[k]; });
    }
    return d;
  }

  function inRange(it, from, to) {
    var d = L.parseDT(it.endDateTime).date;
    return !!d && (!from || d >= from) && (!to || d <= to);
  }

  function storeOK(it) { return !scope.stores.length || scope.stores.indexOf(String(it.storeNumber)) !== -1; }

  function periodOK(it) {
    var a = inRange(it, scope.dateFrom, scope.dateTo);
    return scope.compare.on ? a || inRange(it, scope.compare.from, scope.compare.to) : a;
  }

  function scopeMatches(it) {
    return storeOK(it) && periodOK(it) &&
      (!scope.cashiers.length || scope.cashiers.indexOf(String(it.cashierNumber)) !== -1) &&
      (!scope.workstations.length || scope.workstations.indexOf(String(it.workstationNumber)) !== -1);
  }

  function analysisRecs(mode) {
    if (mode === 'visible') return recs.filter(function (r) { return r.show; });
    return allRecs().filter(function (r) { return scopeMatches(r.item) && (!scope.useFilters || r.show); });
  }

  function analysisItems(mode) { return analysisRecs(mode).map(function (r) { return r.item; }); }

  function todoFor(list) {
    var quick = quickScan && cwx && Object.keys(cwx.tags).length;
    return list.filter(function (r) {
      var sc = scanMap[r.item.transactionId];
      if (!(r.tr && SCAN_TYPES.indexOf(r.item.receiptType) !== -1 && (!sc || (r.item.receiptType === 1 && !L.hasV4(sc))))) return false;
      return !quick || quickNeeds(r.item);
    });
  }
  // Målrettet skanning: salg som CWs filtre har merket (innhold eller betaling), returer og alt som ikke er vanlige salg.
  function quickNeeds(it) {
    return it.receiptType !== 1 || (typeof it.totalAmount === 'number' && it.totalAmount < 0) || !!(cwx && cwx.tags[it.transactionId] && cwx.tags[it.transactionId].length);
  }

  function loadedRange() {
    var min = '', max = '';
    allRecs().forEach(function (r) {
      var d = L.parseDT(r.item.endDateTime).date;
      if (!d) return;
      if (!min || d < min) min = d;
      if (!max || d > max) max = d;
    });
    return { min: min, max: max };
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  }

  function neededRange() {
    var froms = [scope.dateFrom], tos = [scope.dateTo];
    if (scope.compare.on) { froms.push(scope.compare.from); tos.push(scope.compare.to); }
    var f = froms.filter(Boolean).sort()[0], t = tos.filter(Boolean).sort().slice(-1)[0];
    if (!f && !t) return null;
    return { from: f || t, to: t || todayStr() };
  }

  function scopeCoverage() {
    var need = neededRange(), have = loadedRange(), miss = [];
    if (fetched && fetched.count === boundCount) {
      if (!have.min || fetched.from < have.min) have.min = fetched.from;
      if (!have.max || fetched.to > have.max) have.max = fetched.to;
    }
    if (need) {
      if (!have.min || need.from < have.min) miss.push('fra ' + need.from);
      if (!have.max || need.to > have.max) miss.push('til ' + need.to);
    }
    var haveStores = {};
    allRecs().forEach(function (r) { haveStores[String(r.item.storeNumber)] = true; });
    var missStores = scope.stores.filter(function (st) { return !haveStores[st] && !(fetched && fetched.count === boundCount && fetched.stores.indexOf(st) !== -1); });
    if (missStores.length) miss.push(missStores.length + (missStores.length > 1 ? ' butikker' : ' butikk'));
    return { missing: miss.length > 0, text: miss.join(', '), need: need };
  }

  async function fetchScopeData() {
    var need = neededRange();
    if (!need && !scope.stores.length) return;
    var r = need || { from: loadedRange().min || todayStr(), to: loadedRange().max || todayStr() };
    cw.dateFrom = r.from; cw.dateTo = r.to;
    ui.cwFrom.value = r.from; ui.cwTo.value = r.to;
    cw.members = cw.loyal = cw.free = cw.bong = '';
    [ui.cwMem, ui.cwLoy, ui.cwFree, ui.cwBong].forEach(function (n) { if (n) n.value = ''; });
    if (scope.stores.length) {
      cw.stores = {};
      scope.stores.forEach(function (st) { cw.stores[st] = true; });
      renderCwStores();
      ui.cwCount.textContent = scope.stores.length + ' butikker valgt';
    }
    var before = boundCount;
    say('Henter ' + r.from + ' – ' + r.to + ' fra CW…');
    cwSearch();
    await waitFor(function () { return boundCount > before; }, 30000);
    await wait(400);
    fetched = { from: r.from, to: r.to, stores: scope.stores.slice(), count: boundCount };
    apply();
  }

  async function runAnom(mode) {
    mode = mode === 'visible' ? 'visible' : 'scope';
    if (scanning || bulk) return;
    var list = analysisRecs(mode);
    await scanList(todoFor(list));
    anomMap = {};
    var n = 0;
    list.forEach(function (r) {
      if (L.isCopy(scanMap[r.item.transactionId]) || L.isShrink(r.item)) return;   // bongkopi: bare hendelsesord; svinn: egne tester
      var reasons = L.anomalies(r.item, scanMap[r.item.transactionId], anomCfg, customRules, groupsOf(r.item.transactionId));
      if (reasons.length) { anomMap[r.item.transactionId] = reasons; n++; }
    });
    settingsStale = false; renderStale();
    say('Avviksjekk ferdig: ' + n + ' kvitteringer flagget.');
    apply();
  }

  // ---- visning --------------------------------------------------------------
  function groupsOf(id) {
    var sc = scanMap[id];
    if (!sc) return null;
    return gcache[id] || (gcache[id] = L.groupsOfScan(sc, rules));
  }

  function recById(id) {
    for (var i = 0; i < recs.length; i++) if (recs[i].item.transactionId === id) return recs[i];
    return null;
  }

  function syncChecks() {
    if (!grid || !grid.tbody[0]) return;
    Array.prototype.forEach.call(grid.tbody[0].querySelectorAll('input.kvr-cb'), function (cb) { cb.checked = !!selected[cb.getAttribute('data-id')]; });
    var sa = document.getElementById('kvr-select-all');
    if (sa) {
      var vis = recs.filter(function (r) { return r.show; });
      sa.checked = vis.length > 0 && vis.every(function (r) { return selected[r.item.transactionId]; });
    }
  }

  function ensureColumn() {
    var dataTable = grid.tbody[0].closest('table');
    var hdr = document.querySelector('.k-grid-header table');
    [dataTable, hdr].forEach(function (t) {
      if (!t) return;
      var cg = t.querySelector('colgroup');
      if (cg && !cg.querySelector('.kvr-col')) cg.insertBefore(el('col', { class: 'kvr-col', style: 'width:40px;min-width:40px;' }), cg.firstChild);
    });
    if (hdr && !hdr.querySelector('th.kvr-cb-cell')) {
      var htr = hdr.querySelector('thead tr');
      if (htr) {
        var sa = el('input', { type: 'checkbox', id: 'kvr-select-all', title: 'Velg alle synlige' });
        sa.addEventListener('change', function () {
          recs.forEach(function (r) {
            if (!r.show) return;
            if (sa.checked) selected[r.item.transactionId] = r.item; else delete selected[r.item.transactionId];
          });
          syncChecks(); summary();
        });
        htr.insertBefore(el('th', { class: 'kvr-cb-cell', style: 'width:40px;text-align:center;padding:0;' }, [sa]), htr.firstChild);
      }
    }
  }

  function ensureCell(r) {
    var id = r.item.transactionId;
    var td = r.tr.querySelector(':scope > td.kvr-cb-cell');
    if (!td) {
      var cb = el('input', { type: 'checkbox', class: 'kvr-cb', title: 'Velg kvittering', 'data-id': id });
      cb.addEventListener('click', function (e) { e.stopPropagation(); });
      cb.addEventListener('change', function () {
        var rec = recById(cb.getAttribute('data-id'));
        if (cb.checked) { if (rec) selected[cb.getAttribute('data-id')] = rec.item; } else delete selected[cb.getAttribute('data-id')];
        syncChecks(); summary();
      });
      td = el('td', { class: 'kvr-cb-cell', style: 'width:40px;text-align:center;padding:0;vertical-align:middle;' }, [cb]);
      td.addEventListener('click', function (e) { e.stopPropagation(); });
      r.tr.insertBefore(td, r.tr.firstChild);
    }
    var box = td.querySelector('input.kvr-cb');
    box.setAttribute('data-id', id);
    box.checked = !!selected[id];
  }

  function distinct(key) {
    var seen = {};
    allRecs().forEach(function (r) { var v = r.item[key]; if (v !== null && v !== undefined) seen[v] = true; });
    return Object.keys(seen).sort(function (a, b) { return a - b || (a < b ? -1 : 1); });
  }

  function pills(cb) {
    var b = el('div', { class: 'kvr-pills', role: 'group' });
    b.cb = cb;
    b.isPills = true;
    b.sel = {};
    return b;
  }

  function fillSelect(box, values, labelFn, chosen) {
    box.innerHTML = '';
    box.sel = {};
    values.forEach(function (v) {
      var key = String(v);
      var on = chosen.indexOf(key) !== -1;
      box.sel[key] = on;
      var b = el('button', { type: 'button', class: 'kvr-pill' + (on ? ' kvr-on' : ''), text: labelFn ? labelFn(v) : key, 'aria-pressed': String(on) });
      b.addEventListener('click', function () {
        box.sel[key] = !box.sel[key];
        b.classList.toggle('kvr-on', box.sel[key]);
        b.setAttribute('aria-pressed', String(box.sel[key]));
        (box.cb || onChange)();
      });
      box.appendChild(b);
    });
    if (!values.length) box.appendChild(el('span', { class: 'kvr-hint', text: 'Ingen verdier i listen.' }));
  }

  function storeBox(cb, editNames) {
    var box = el('div', { class: 'kvr-storebox' });
    box.cb = cb;
    if (editNames) box.names = el('div', {});
    box.isChecklist = true; box.sel = {}; box.values = []; box.counts = {}; box.query = '';
    box.search = el('input', { type: 'text', placeholder: 'søk butikk (navn eller nr)' });
    box.search.addEventListener('input', function () { box.query = box.search.value; renderStoreBox(box); });
    box.list = el('div', { class: 'kvr-checklist', role: 'group', 'aria-label': 'Butikker' });
    box.info = el('span', { class: 'kvr-hint' });
    box.appendChild(box.search);
    box.appendChild(box.list);
    box.appendChild(el('div', { class: 'kvr-row kvr-boxacts' }, [
      box.info,
      el('button', { type: 'button', class: 'kvr-link', text: 'Velg viste', onclick: function () { shownStores(box).forEach(function (v) { box.sel[String(v)] = true; }); renderStoreBox(box); (box.cb || onChange)(); } }),
      el('button', { type: 'button', class: 'kvr-link', text: 'Fjern butikkvalg', onclick: function () { Object.keys(box.sel).forEach(function (k) { box.sel[k] = false; }); renderStoreBox(box); (box.cb || onChange)(); } })
    ]));
    if (box.names) box.appendChild(box.names);
    return box;
  }

  // Butikker uten navn: skriv inn navn her, så vises «nr – navn» overalt.
  function renderStoreNames(box) {
    if (!box.names) return;
    box.names.innerHTML = '';
    var miss = box.values.filter(function (v) { return !storeMap[String(v)]; });
    var levels = {};
    box.values.forEach(function (v) { var lv = L.storeParts(v).level; if (lv && !storeMap[lv]) levels[lv] = true; });
    var lvMiss = Object.keys(levels).sort(function (a, b) { return a - b; });
    if (!miss.length && !lvMiss.length) return;
    var ta = el('textarea', { rows: String(Math.min(5, miss.length + lvMiss.length)), 'aria-label': 'Butikknavn' });
    ta.value = lvMiss.concat(miss.map(String)).map(function (v) { return v + '='; }).join('\n');
    box.names.appendChild(el('details', { class: 'kvr-sub kvr-names' }, [
      el('summary', { text: (miss.length === 1 ? 'Gi butikken navn' : 'Gi ' + miss.length + ' butikker navn') + (lvMiss.length ? ' og nivå' : '') + ' (' + (lvMiss.length ? lvMiss : miss).slice(0, 4).join(', ') + ((lvMiss.length ? lvMiss : miss).length > 4 ? ' …' : '') + ')' }),
      hintEl('Skriv navnet etter =. ' + (lvMiss.length ? 'Et nivå er de tre første sifrene i butikknummeret (131 i 1311003). ' : '') + 'Navnene lagres i nettleseren og brukes i alle lister og rapporter.'), ta,
      btn('Lagre navn', function () {
        var add = L.parseStoreText(ta.value), cur = L.parseStoreText(manualStores);
        if (!Object.keys(add).length) { say('Skriv et navn etter = for minst én butikk.'); return; }
        Object.keys(add).forEach(function (k) { cur[k] = add[k]; });
        manualStores = Object.keys(cur).sort(function (a, b) { return a - b; }).map(function (k) { return k + '=' + cur[k]; }).join('\n');
        store(K.stores, manualStores); optsKey = ''; apply(); say('Butikknavn lagret.');
      }, 'kvr-sm')
    ]));
  }

  function setStoreBox(box, values, counts, chosen) {
    box.values = values;
    box.counts = counts;
    box.sel = {};
    values.forEach(function (v) { box.sel[String(v)] = chosen.indexOf(String(v)) !== -1; });
    renderStoreBox(box);
  }

  function shownStores(box) {
    var q = box.query.toLowerCase();
    return box.values.filter(function (v) { return !q || L.storeSearch(v, storeMap).indexOf(q) !== -1; });
  }

  function renderStoreBox(box) {
    box.list.innerHTML = '';
    var shown = shownStores(box);
    if (!box.values.length) box.list.appendChild(el('div', { class: 'kvr-hint', text: 'Ingen butikker i listen ennå.' }));
    else if (!shown.length) box.list.appendChild(el('div', { class: 'kvr-hint', text: 'Ingen treff.' }));
    var grouped = shown.some(function (v) { return L.storeParts(v).level; });
    var row = function (v) {
      var key = String(v), p = L.storeParts(v), nm = L.storeName(v, storeMap), cb = el('input', { type: 'checkbox', value: key });
      cb.checked = !!box.sel[key];
      cb.addEventListener('change', function () { box.sel[key] = cb.checked; renderStoreInfo(box); (box.cb || onChange)(); });
      return el('label', { class: 'kvr-chk', title: p.level ? 'Butikknummer ' + p.full + ': nivå ' + p.level + ', avdeling ' + p.dept : '' },
        [cb, el('span', { text: grouped ? p.dept + (nm ? ' – ' + nm : '') : sLabel(v) }), el('em', { class: 'kvr-cnt', text: String(box.counts[key] || 0) })]);
    };
    if (!grouped) shown.forEach(function (v) { box.list.appendChild(row(v)); });
    else {
      // nummeret er nivå + avdelingsnummer: gruppert etter nivå, med valg av hele nivået
      var by = {};
      shown.forEach(function (v) { var lv = L.storeParts(v).level || '–'; (by[lv] = by[lv] || []).push(v); });
      Object.keys(by).sort(function (a, b) { return a === '–' ? 1 : b === '–' ? -1 : a - b; }).forEach(function (lv) {
        var vals = by[lv], set = function (on) { vals.forEach(function (v) { box.sel[String(v)] = on; }); renderStoreBox(box); (box.cb || onChange)(); };
        box.list.appendChild(el('div', { class: 'kvr-lvl' }, [
          el('b', { text: lv === '–' ? 'Uten nivå' : 'Nivå ' + lv + (storeMap[lv] ? ' – ' + storeMap[lv] : '') }),
          el('span', { class: 'kvr-hint', text: vals.length + (vals.length === 1 ? ' butikk' : ' butikker') }),
          el('button', { type: 'button', class: 'kvr-link', text: 'Velg', onclick: function () { set(true); } }),
          el('button', { type: 'button', class: 'kvr-link', text: 'Fjern', onclick: function () { set(false); } })
        ]));
        vals.forEach(function (v) { box.list.appendChild(row(v)); });
      });
    }
    renderStoreInfo(box);
    renderStoreNames(box);
  }

  function renderStoreInfo(box) {
    var n = Object.keys(box.sel).filter(function (k) { return box.sel[k]; }).length;
    box.info.textContent = n + ' av ' + box.values.length + ' valgt';
  }

  function readSelect(box) {
    return Object.keys(box.sel).filter(function (k) { return box.sel[k]; });
  }

  function groupNames() {
    return rules.map(function (r) { return r.name; }).concat([L.NO_GROUP]);
  }

  function refreshOptions() {
    var key = [distinct('storeNumber'), distinct('workstationNumber'), distinct('cashierNumber'), distinct('receiptType'), JSON.stringify(storeMap), groupNames(), allRecs().length, cwStoreList.length].join('|');
    if (key === optsKey) return;
    optsKey = key;
    var storeVals = distinct('storeNumber'), sc = {};
    allRecs().forEach(function (r) { sc[r.item.storeNumber] = (sc[r.item.storeNumber] || 0) + 1; });
    setStoreBox(ui.stores, storeVals, sc, filters.stores);
    if (ui.scStores) {
      var union = {};
      storeVals.forEach(function (v) { union[String(v)] = true; });
      cwStoreList.forEach(function (st) { union[String(st.number)] = true; });
      setStoreBox(ui.scStores, Object.keys(union).sort(function (a, b) { return a - b; }), sc, scope.stores);
      fillSelect(ui.scCashiers, distinct('cashierNumber'), null, scope.cashiers);
      fillSelect(ui.scKasser, distinct('workstationNumber'), null, scope.workstations);
    }
    fillSelect(ui.workstations, distinct('workstationNumber'), null, filters.workstations);
    fillSelect(ui.cashiers, distinct('cashierNumber'), null, filters.cashiers);
    fillSelect(ui.types, distinct('receiptType'), function (v) { return v + ' – ' + L.typeLabel(v); }, filters.types);
    fillSelect(ui.groups, groupNames(), null, filters.groups);
  }

  function apply() {
    if (!grid) return;
    refreshStoreMap();
    recs = collect();
    if (harvestGridStores()) refreshStoreMap();
    var items = recs.map(function (r) { return r.item; });
    var dup = L.findDuplicates(L.splitCopies(items, scanMap).items);   // en bongkopi er ikke et duplikatkjøp
    var bf = Object.assign({}, filters, { pant: '', disc: '', discFrom: '', discTo: '', special: '', item: '', groups: [] });
    var ctx = { dupIds: dup.ids, scan: scanMap, groupsOf: groupsOf, anom: anomMap, notes: notes, specialWords: ctlCfg.specialWords };
    var visible = 0;
    ensureColumn();
    var cdx = colIndexes();
    recs.forEach(function (r) {
      var id = r.item.transactionId;
      var show = L.matches(r.item, filters, ctx);
      r.show = show;
      r.base = L.matches(r.item, bf, ctx);
      r.tr.style.display = show ? '' : 'none';
      r.tr.classList.toggle('kvr-dup', !!dup.ids[id]);
      r.tr.classList.toggle('kvr-flag', !!(anomMap[id] && anomMap[id].length));
      var tips = [];
      if (dup.ids[id]) tips.push('Mulig duplikat: samme beløp, butikk, kasse og tid');
      if (anomMap[id]) tips.push('Avvik: ' + anomMap[id].join(', '));
      var gs = groupsOf(id);
      if (gs) tips.push('Varegrupper: ' + gs.join(', '));
      var nt = notes[id];
      r.tr.classList.toggle('kvr-noted', !!nt);
      r.tr.classList.toggle('kvr-follow', !!(nt && nt.status === 'oppfolging'));
      if (nt) tips.push('Notat' + (nt.status ? ' (' + (nt.status === 'oppfolging' ? 'til oppfølging' : 'sjekket') + ')' : '') + ': ' + (nt.note || ''));
      if (tips.length) r.tr.title = tips.join('\n'); else r.tr.removeAttribute('title');
      ensureCell(r);
      [['kasserer', 'cashierNumber', 'kasserer '], ['kasse', 'workstationNumber', 'kasse ']].forEach(function (c) {
        var td = r.tr.querySelector('td[data-field="' + c[1] + '"]') || (cdx[c[0]] !== undefined ? r.tr.children[cdx[c[0]]] : null);
        if (td) td.title = 'Alt+klikk: se alt om ' + c[2] + r.item[c[1]];
      });
      if (show) visible++;
    });
    allRecs().forEach(function (r) { if (r.arch) { r.show = L.matches(r.item, filters, ctx); r.base = L.matches(r.item, bf, ctx); } });
    reorder();
    syncChecks();
    ui.dup = dup;
    ui.visible = visible;
    if (ui.hideAll) {
      var hides = recs.length > 0 && visible === 0 && L.activeCount(filters) > 0;
      ui.hideAll.style.display = hides ? 'flex' : 'none';
      if (hides) ui.hideAllTxt.textContent = 'Filtrene i pluginen skjuler alle ' + recs.length + ' kvitteringene i CW-listen. Søket i CW er i orden.';
    }
    refreshOptions();
    renderDerived();
    summary();
  }

  function reorder() {
    var tbody = grid.tbody[0];
    var sorted = recs.slice().sort(function (a, b) {
      return L.compare(a.item, b.item, filters.sort) || a.orig - b.orig;
    });
    var cur = tbody.children, same = cur.length === sorted.length;
    for (var i = 0; same && i < sorted.length; i++) if (cur[i] !== sorted[i].tr) same = false;
    if (same) return;
    sorted.forEach(function (r) { tbody.appendChild(r.tr); });
  }

  function chosenItems() {
    return Object.keys(selected).map(function (k) { return selected[k]; });
  }

  function renderScanState() {
    if (!ui.scanRow) return;
    syncSpecialOpts();
    syncPayOpts();
    var base = recs.filter(function (r) { return r.base && (r.item.receiptType === 1 || r.item.receiptType === 2); });
    var none = base.filter(function (r) { return !scanMap[r.item.transactionId]; }).length;
    var old = base.filter(function (r) { var sc = scanMap[r.item.transactionId]; return sc && r.item.receiptType === 1 && !L.hasV4(sc); }).length;
    var noDisc = base.filter(function (r) { var sc = scanMap[r.item.transactionId]; return sc && r.item.receiptType === 1 && !L.hasDisc(sc); }).length;
    var missing = none + old;
    ui.scanRow.style.display = base.length ? 'flex' : 'none';
    var quick = quickScan && cwx && Object.keys(cwx.tags).length ? todoFor(base).length : null;
    ui.scanTxt.textContent = 'Skannet ' + (base.length - none) + ' av ' + base.length + (old ? ' (' + old + ' eldre skanninger tas på nytt)' : '') + (quick !== null ? ' · rask skanning: ' + quick + ' gjenstår' : '');
    ui.scanNow.style.display = missing > 0 ? '' : 'none';
    ui.scanNow.disabled = scanning;
    var hide = filters.pant || filters.item || filters.text || filters.pay || filters.special || filters.groups.length ? none : 0;
    if (filters.disc || filters.discFrom || filters.discTo) hide = none + noDisc;
    ui.scanWarn.style.display = hide > 0 ? '' : 'none';
    ui.scanWarnTxt.textContent = hide + ' kvitteringer ' + ((filters.disc || filters.discFrom || filters.discTo) && noDisc ? 'mangler skanning eller rabattdata' : 'er ikke skannet') + ' og skjules av dette filteret.';
    ui.scanWarnBtn.disabled = scanning;
  }

  function summary() {
    if (!ui.stVisible) return;
    var chosen = chosenItems();
    var sm = L.sumSelected(chosen);
    var p = L.sumPant(chosen, scanMap);
    var active = L.activeCount(filters);
    ui.stVisible.textContent = (ui.visible || 0) + ' / ' + recs.length;
    ui.stSelected.textContent = String(sm.count);
    ui.stSum.textContent = fmt(sm.sum);
    ui.stDup.textContent = String(ui.dup ? ui.dup.groups.length : 0);
    ui.pantLine.textContent = 'Pant valgte: salg ' + fmt(p.sale) + ' · retur ' + fmt(p.ret) + ' · netto ' + fmt(p.net) +
      ' kr (' + p.scanned + ' av ' + p.total + ' skannet)';
    ui.badge.textContent = (active ? active + ' filter' : 'ingen filter') + (sm.count ? ' · ' + sm.count + ' valgt' : '');
    ui.badge.classList.toggle('kvr-on', active > 0);
    renderGroupSums(chosen);
    renderChips();
    ui.pantLine.style.display = sm.count ? '' : 'none';
    renderScanState();
    ui.footPng.disabled = sm.count === 0 || scanning;
    ui.footCmp.style.display = sm.count === 2 ? '' : 'none';
    ui.footCsv.textContent = sm.count ? 'CSV (' + sm.count + ')' : 'CSV';
    ui.footPng.textContent = sm.count ? 'PNG (' + sm.count + ')' : 'PNG';
  }


  function chipDefs() {
    var f = filters, out = [];
    var add = function (label, clear, state) { out.push({ label: label, clear: clear, state: !!state }); };
    var rng = function (a, b) { return (a || '…') + ' → ' + (b || '…'); };
    if (f.stores.length) add('Butikk: ' + f.stores.map(sLabel).join(', '), function () { f.stores = []; });
    if (f.workstations.length) add('Kasse: ' + f.workstations.join(', '), function () { f.workstations = []; });
    if (f.cashiers.length) add('Kasserer: ' + f.cashiers.join(', '), function () { f.cashiers = []; });
    if (f.types.length) add('Type: ' + f.types.map(L.typeLabel).join(', '), function () { f.types = []; });
    if (f.dateFrom || f.dateTo) add('Dato ' + rng(f.dateFrom, f.dateTo), function () { f.dateFrom = ''; f.dateTo = ''; });
    if (f.timeFrom || f.timeTo) add('Tid ' + rng(f.timeFrom, f.timeTo), function () { f.timeFrom = ''; f.timeTo = ''; });
    if (f.sumMin !== '' || f.sumMax !== '') add('Sum ' + rng(f.sumMin, f.sumMax), function () { f.sumMin = ''; f.sumMax = ''; });
    if (f.onlyNegative) add('Negativ sum', function () { f.onlyNegative = false; });
    if (f.member) add('Medlem: ' + f.member, function () { f.member = ''; });
    if (f.onlyMember) add('Kun medlem', function () { f.onlyMember = false; });
    if (f.onlyDup) add('Duplikater', function () { f.onlyDup = false; });
    if (f.onlyAnom) add('Kun avvik', function () { f.onlyAnom = false; });
    if (f.bong) add('Bong: ' + f.bong, function () { f.bong = ''; });
    if (f.item) add('Vare: ' + f.item, function () { f.item = ''; });
    if (f.text) add('Søk: ' + f.text, function () { f.text = ''; });
    if (f.pay) add('Betaling: ' + f.pay, function () { f.pay = ''; });
    if (f.disc) add('Rabatt: ' + (({ any: 'har rabatt', noreason: 'uten årsak', reason: 'med årsak', coupon: 'har kupong' }[f.disc] || (f.disc.indexOf('r:') === 0 ? 'årsak ' + f.disc.slice(2) : f.disc))), function () { f.disc = ''; });
    if (f.discFrom || f.discTo) add('Rabatt % ' + rng(f.discFrom, f.discTo), function () { f.discFrom = ''; f.discTo = ''; });
    if (f.special) add('Spesial: ' + (f.special === '*' ? 'alle ord' : f.special), function () { f.special = ''; });
    if (f.pant) add('Pant: ' + ({ any: 'pant/retur', sale: 'salg', 'return': 'retur' }[f.pant] || f.pant), function () { f.pant = ''; });
    if (f.note) add('Notat: ' + ({ any: 'har notat', oppfolging: 'til oppfølging', sjekket: 'sjekket' }[f.note] || f.note), function () { f.note = ''; });
    if (f.groups.length) add('Gruppe: ' + f.groups.join(', '), function () { f.groups = []; });
    if (f.sort && f.sort !== 'none') add('Sortert: ' + ({ sumDesc: 'sum høyest', sumAsc: 'sum lavest', timeDesc: 'nyeste', timeAsc: 'eldste' }[f.sort] || f.sort), function () { f.sort = 'none'; }, true);
    var nsel = Object.keys(selected).length;
    if (nsel) add(nsel + ' valgt', function () { selected = {}; }, true);
    var nan = Object.keys(anomMap).length;
    if (nan) add('Avvik markert (' + nan + ')', function () { anomMap = {}; }, true);
    if (cwActive()) add('CW: ' + cwSummary(), function () { clearCw(); }, true);
    return out;
  }

  function cwActive() {
    return !!(cw.dateFrom || cw.dateTo || cw.members || cw.loyal || cw.free || cw.bong || Object.keys(cw.stores).some(function (k) { return cw.stores[k]; }));
  }

  function cwSummary() {
    var p = [];
    if (cw.dateFrom || cw.dateTo) p.push((cw.dateFrom || '…') + ' → ' + (cw.dateTo || '…'));
    var n = Object.keys(cw.stores).filter(function (k) { return cw.stores[k]; }).length;
    if (n) p.push(n + (n === 1 ? ' butikk' : ' butikker'));
    if (cw.members) p.push('medlem');
    if (cw.loyal) p.push('lojalitets-ID');
    if (cw.free) p.push('vare «' + cw.free + '»');
    if (cw.bong) p.push('bong ' + cw.bong);
    return p.join(' · ');
  }

  function clearCw() {
    cw.dateFrom = cw.dateTo = cw.members = cw.loyal = cw.free = cw.bong = '';
    cw.stores = {};
    [ui.cwFrom, ui.cwTo, ui.cwMem, ui.cwLoy, ui.cwFree, ui.cwBong].forEach(function (n) { if (n) n.value = ''; });
    ui.cwCount.textContent = '0 butikker valgt';
    renderCwStores();
    cwReset();
  }

  // Bare filtrene i pluginen; CW-søket, valg og analysen røres ikke.
  function resetFilters() {
    filters = L.defaultFilters();
    writeForm();
    apply();
  }

  function resetAll() {
    filters = L.defaultFilters();
    selected = {};
    anomMap = {};
    ctlRes = null; checkState.at = null;
    if (cwActive()) clearCw();
    writeForm();
    apply();
    say('Alt er nullstilt.');
  }

  function renderChips() {
    var defs = chipDefs();
    ui.chips.innerHTML = '';
    ui.chips.style.display = defs.length ? 'flex' : 'none';
    defs.forEach(function (d) {
      ui.chips.appendChild(el('button', { type: 'button', class: 'kvr-fchip' + (d.state ? ' kvr-state' : ''), title: d.state ? 'Fjern' : 'Fjern filter', onclick: function () { d.clear(); writeForm(); apply(); } }, [
        el('span', { text: d.label }), el('b', { text: '×' })
      ]));
    });
    if (defs.length > 1) ui.chips.appendChild(el('button', { type: 'button', class: 'kvr-link', text: 'Nullstill alt', title: 'Fjerner alle filtre, valg, sortering, avviksmarkering og CW-søk', onclick: resetAll }));
    var nf = defs.filter(function (d) { return !d.state; }).length;
    ui.tabDot.style.display = nf ? '' : 'none';
    ui.tabDot.textContent = nf ? String(nf) : '';
  }

  function renderGroupSums(chosen) {
    var sums = L.groupSums(chosen.map(function (c) { return c.transactionId; }), scanMap, rules);
    ui.groupSums.innerHTML = '';
    if (!sums.length) { ui.groupSums.appendChild(el('div', { class: 'kvr-hint', text: 'Velg skannede kvitteringer for å se sum per varegruppe.' })); return; }
    var t = el('table', { class: 'kvr-table' }, [el('tr', {}, [el('th', { text: 'Varegruppe' }), el('th', { text: 'Linjer' }), el('th', { text: 'Sum kr' })])]);
    sums.forEach(function (s) {
      t.appendChild(el('tr', {}, [el('td', { text: s.group }), el('td', { text: String(s.lines) }), el('td', { text: fmt(s.sum) })]));
    });
    ui.groupSums.appendChild(t);
  }

  function jumpTo(r) {
    if (curSize === 2) { setSizeMode(1, false); say('Panelet er flyttet til siden så du ser bongen i lista.'); }
    r.tr.style.display = '';
    r.tr.scrollIntoView({ block: 'center' });
    if (grid) grid.select(r.tr);
  }

  function renderDerived() {
    renderCheck();
    if (chartsVisible()) renderCharts();
    renderReport();
    renderSettle();
    renderFocus();
    // avviksliste
    ui.anomList.innerHTML = '';
    var flagged = recs.filter(function (r) { return anomMap[r.item.transactionId]; }).slice(0, 40);
    flagged.forEach(function (r) {
      var it = r.item;
      var row = el('div', { class: 'kvr-li' }, [
        el('b', { text: it.endDateTime + ' · kasse ' + it.workstationNumber + ' · ' + (it.totalAmount === null ? L.typeLabel(it.receiptType) : fmt(it.totalAmount)) }),
        el('span', { text: anomMap[it.transactionId].join(' · ') })
      ]);
      row.appendChild(entsFor(it));
      row.addEventListener('click', function () { jumpTo(r); });
      ui.anomList.appendChild(row);
    });
    // uten gruppe
    ui.unmatched.innerHTML = '';
    var um = L.unmatched(scanMap, rules, 12);
    if (!um.length) { ui.unmatched.appendChild(el('div', { class: 'kvr-hint', text: Object.keys(scanMap).length ? 'Alle skannede varer har gruppe.' : 'Skann kvitteringer for å se varer uten gruppe.' })); return; }
    um.forEach(function (u) {
      var kw = el('input', { type: 'text', value: u.name, title: 'Nøkkelord (rediger for å gjøre det mer generelt)' });
      var gsel = el('select', {}, [el('option', { value: '', text: 'Velg gruppe…' })].concat(groupNames().filter(function (g) { return g !== L.NO_GROUP; }).map(function (g) { return el('option', { value: g, text: g }); }).concat([el('option', { value: '__new', text: '+ ny gruppe…' })])));
      var add = el('button', { type: 'button', class: 'kvr-btn', text: 'Legg til', onclick: function () {
        var g = gsel.value;
        if (!g) { gsel.focus(); return; }
        if (g === '__new') { g = (window.prompt('Navn på ny varegruppe:') || '').trim(); if (!g) return; }
        addKeyword(g, kw.value);
      } });
      ui.unmatched.appendChild(el('div', { class: 'kvr-um' }, [
        el('div', { class: 'kvr-li-head', text: u.name + ' · ' + u.count + ' stk · ' + fmt(u.sum) + ' kr' }),
        el('div', { class: 'kvr-row' }, [kw, gsel, add])
      ]));
    });
  }

  function saveRules() {
    store(K.rules, rules);
    gcache = {};
    optsKey = '';
  }

  function addKeyword(group, kw) {
    kw = String(kw || '').trim().toUpperCase();
    if (!kw) return;
    var r = rules.filter(function (x) { return x.name === group; })[0];
    if (!r) { r = { name: group, include: [], exclude: [] }; rules.push(r); }
    if (r.include.indexOf(kw) === -1) r.include.push(kw);
    saveRules();
    renderRules();
    apply();
  }

  // ---- regelsett-editor -----------------------------------------------------
  function renderRules() {
    ui.rules.innerHTML = '';
    rules.forEach(function (r, i) {
      var name = el('input', { type: 'text', value: r.name });
      var inc = el('textarea', { rows: '2', title: 'Nøkkelord (komma). Vanlig = starten av ord, *ord = inneholder, #kode = varenr/EAN (#7044* = prefiks).' });
      inc.value = r.include.join(', ');
      var exc = el('textarea', { rows: '1', title: 'Ekskluder-ord (komma). Treffer hvor som helst i navnet.' });
      exc.value = r.exclude.join(', ');
      var commit = function () {
        var oldName = r.name;
        r.name = name.value.trim() || oldName;
        r.include = inc.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
        r.exclude = exc.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
        saveRules(); apply();
      };
      [name, inc, exc].forEach(function (n) { n.addEventListener('change', commit); });
      var move = function (d) {
        var j = i + d;
        if (j < 0 || j >= rules.length) return;
        var t = rules[i]; rules[i] = rules[j]; rules[j] = t;
        saveRules(); renderRules(); apply();
      };
      ui.rules.appendChild(el('div', { class: 'kvr-rule' }, [
        el('div', { class: 'kvr-row' }, [name,
          el('button', { type: 'button', class: 'kvr-btn kvr-sm', text: '↑', onclick: function () { move(-1); } }),
          el('button', { type: 'button', class: 'kvr-btn kvr-sm', text: '↓', onclick: function () { move(1); } }),
          el('button', { type: 'button', class: 'kvr-btn kvr-sm', text: '✕', title: 'Slett gruppe', onclick: function () {
            confirmBox('Slett varegruppe', 'Slette varegruppen «' + r.name + '»?', 'Slett', function () { rules.splice(i, 1); saveRules(); renderRules(); apply(); });
          } })]),
        el('span', { class: 'kvr-hint', text: 'Inkluder' }), inc,
        el('span', { class: 'kvr-hint', text: 'Ekskluder' }), exc
      ]));
    });
  }


  // ---- PNG av hel kvittering --------------------------------------------------
  var PNG_CSS = '*{box-sizing:border-box}html,body{margin:0;background:#fff}' +
    'body{font-family:"Segoe UI",Arial,Helvetica,sans-serif;color:#111}' +
    '.kvr-page{background:#eceeed;padding:24px}' +
    '.kvr-page.a4{background:#fff;padding:56px 0;min-height:1123px}' +
    '.kvr-sheet{background:#fff;margin:0 auto;padding:22px 24px 26px;border:1px solid #d5d9d7;box-shadow:0 1px 4px rgba(0,0,0,.12)}' +
    '.kvr-page.a4 .kvr-sheet{box-shadow:none;border:1px solid #cfd4d1}' +
    'table{width:100%;border-collapse:collapse;margin:6px 0}' +
    '.ReceiptTable{background:transparent}' +
    'td,th{padding:5px 4px;font-size:13px;line-height:1.35;vertical-align:top;text-align:left;border-bottom:1px dotted #c8cdca;word-break:break-word}' +
    'th{font-size:11px;color:#555;text-transform:uppercase;letter-spacing:.03em;border-bottom:1px solid #999}' +
    'td:last-child,th:last-child,td:nth-last-child(2),th:nth-last-child(2){text-align:right;white-space:nowrap}' +
    'td:first-child,th:first-child{text-align:left;white-space:normal}' +
    '.Subtotal{font-size:17px;font-weight:700;padding:9px 4px;border-top:2px solid #111;border-bottom:2px solid #111;background:#f6f8f7}' +
    '.Report,.report{white-space:pre;font-family:Consolas,Courier,monospace;font-size:12px}' +
    'div[align="center"]{text-align:center}p{margin:6px 0}' +
    '.kvr-h{margin-bottom:12px;padding-bottom:10px;border-bottom:2px dashed #888;font-size:12px;color:#444;line-height:1.55}' +
    '.kvr-h strong{display:block;font-size:16px;color:#111;margin-bottom:2px}';

  var PNG_LAYOUTS = { bong: { w: 450, sheet: 402, scale: 3, cls: '' }, a4: { w: 794, sheet: 470, scale: 2, cls: ' a4' } };

  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function pngHeader(it, member) {
    var lines = ['Kasse ' + it.workstationNumber + ' · Kasserer ' + it.cashierNumber, 'Bongnr: ' + it.bongnr, it.endDateTime];
    if (member && it.memberNumber) lines.push('Medlem: ' + it.memberNumber);
    return '<div class="kvr-h"><strong>' + esc(sLabel(it.storeNumber)) + '</strong>' + lines.map(esc).join('<br>') + '</div>';
  }

  function htmlToPng(full, W, scale) {
    return new Promise(function (resolve, reject) {
      var f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-same-origin');
      f.style.cssText = 'position:fixed;top:-10000px;left:-10000px;width:' + W + 'px;height:2000px;border:none;visibility:hidden;';
      var fail = function (e) { f.remove(); reject(e); };
      f.onload = function () {
        setTimeout(function () {
          try {
            var b = f.contentDocument.body;
            var h = b.scrollHeight || 800;
            f.style.height = (h + 40) + 'px';
            window.html2canvas(b, { scale: scale, logging: false, allowTaint: true, useCORS: false, backgroundColor: '#ffffff', width: W, height: h, windowWidth: W, windowHeight: h })
              .then(function (c) { f.remove(); c.toBlob(function (bl) { if (bl) resolve(bl); else reject(new Error('toBlob')); }, 'image/png'); })
              .catch(fail);
          } catch (e) { fail(e); }
        }, 300);
      };
      f.srcdoc = full;
      document.body.appendChild(f);
    });
  }

  async function receiptHtml(r) {
    if (!r.tr) return null;
    var rows = await loadViaDom(r);
    var d = iframeDoc();
    return rows && d ? d.body.innerHTML : null;
  }

  // Tegner én kvittering som PNG. o: { layout, header, member }
  async function renderPngFor(rec, o) {
    var html = await receiptHtml(rec);
    if (!html) throw new Error('ingen kvittering');
    var clean = html.replace(/xmlns[^=]*="[^"]*"/g, '').replace(/<link[^>]*>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
    var lay = PNG_LAYOUTS[o.layout] || PNG_LAYOUTS.bong;
    var full = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' + PNG_CSS + '</style></head><body><div class="kvr-page' + lay.cls + '"><div class="kvr-sheet" style="width:' + lay.sheet + 'px">' +
      (o.header ? pngHeader(rec.item, o.member) : '') + clean + '</div></div></body></html>';
    return htmlToPng(full, lay.w, lay.scale);
  }

  async function exportPng(list) {
    if (scanning) return;
    if (!window.html2canvas || !window.JSZip) { say('Biblioteker (html2canvas/JSZip) er ikke lastet.'); return; }
    if (!list.length) { say('Velg kvitteringer først.'); return; }
    scanning = true; cancelScan = false;
    ui.scanBtn.disabled = true; ui.anomBtn.disabled = true; ui.stopBtn.disabled = false; ui.stopTop.style.display = ''; ui.retryBtn.disabled = true; if (ui.retryBtn2) ui.retryBtn2.disabled = true;
    var prev = grid.select();
    var prevTr = prev && prev[0];
    var files = [], failed = [], t0 = Date.now();
    for (var i = 0; i < list.length && !cancelScan; i++) {
      progress(i, list.length, t0, 'PNG', failed.length);
      try {
        var blob = await renderPngFor(list[i], { layout: ui.pngLayout.value, header: ui.pngHeaderOn.checked, member: ui.pngMember.checked });
        var it = list[i].item;
        files.push({ name: it.endDateTime.replace(/[^0-9]/g, '') + '_' + String(it.bongnr).replace(/[^A-Za-z0-9_-]/g, '-') + '.png', blob: blob });
      } catch (e) { failed.push(list[i]); }
    }
    if (prevTr) grid.select(prevTr); else if (typeof grid.clearSelection === 'function') grid.clearSelection();
    setProgress(0);
    if (files.length === 1) download(files[0].blob, files[0].name);
    else if (files.length > 1) {
      var zip = new window.JSZip();
      files.forEach(function (f) { zip.file(f.name, f.blob); });
      var zb = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      download(zb, 'kvitteringer_' + new Date().toISOString().slice(0, 10) + '.zip');
    }
    failedRecs = failed;
    lastRetry = failed.length ? function () { return exportPng(failedRecs.slice()); } : null;
    scanning = false;
    ui.scanBtn.disabled = false; ui.anomBtn.disabled = false; ui.stopBtn.disabled = true;
    syncRetry();
    say((cancelScan ? 'Stoppet. ' : 'Ferdig. ') + files.length + ' PNG' + (failed.length ? ', feilet ' + failed.length : '') + '.');
  }

  function selectedRecs() {
    return Object.keys(selected).map(function (id) { return recById(id) || { item: selected[id], tr: null }; });
  }


  // ---- dagsrapport og kassaoppgjør ----------------------------------------------
  var HEAD_TITLES = {
    'Ant': 'Antall salg', 'Retur': 'Salg med negativ sum (antall / kr)', 'Pant +': 'Pantesalg i kr (kun skannede)',
    'Pant −': 'Utbetalt panteretur i kr (kun skannede)', 'Avvik': 'Antall flaggede kvitteringer', 'Diff': 'Kassadifferanse fra kassaoppgjør',
    'Returandel': 'Andel salg med negativ sum', 'Snitt kr': 'Gjennomsnittsbeløp på salg', 'Pantelapp/salg': 'Pantelapper per skannet salg',
    'Korr./salg': 'Negative varelinjer (utenom pant) per skannet salg', 'Forventet': 'Kontant minus kontant tilbake fra skannede salg',
    'Telt': 'Telt kontant i kassaoppgjør', 'Tilbake': 'Kontant tilbake til kunder', 'Bank/kort': 'Betalt med bank eller kort',
    'Pantelapper ut': 'Utbetalte pantelapper i kr', 'Pant salg': 'Pantesalg i kr', 'Salg': 'Antall salg'
  };
  function cell(tag, v) {
    var n = el(tag, { text: String(v) });
    if (tag === 'th' && HEAD_TITLES[v]) n.title = HEAD_TITLES[v];
    return n;
  }

  function currentReport() {
    var items = recs.filter(function (r) { return r.show; }).map(function (r) { return r.item; });
    return L.report(items, scanMap, anomMap, { by: ui.repBy.value, byDay: ui.repDay.checked });
  }

  function renderReport() {
    if (!ui.repTable) return;
    var res = currentReport();
    ui.repTable.innerHTML = '';
    if (!res.rows.length) { ui.repTable.appendChild(el('div', { class: 'kvr-hint', text: 'Ingen synlige kvitteringer.' })); ui.repNote.textContent = ''; return; }
    var t = el('table', { class: 'kvr-table kvr-small' }, [el('tr', {}, ['Gruppe', 'Ant', 'Sum', 'Retur', 'Pant +', 'Pant −', 'Avvik', 'Diff'].map(function (h) { return cell('th', h); }))]);
    var line = function (r, cls) {
      t.appendChild(el('tr', cls ? { class: cls } : {}, [
        (cls ? cell('td', r.label) : el('td', {}, [entLink(ui.repBy.value, r.id, (r.day ? r.day + ' · ' : '') + r.label)])), cell('td', r.count), cell('td', fmt(r.sum)),
        cell('td', r.retCount ? r.retCount + ' / ' + fmt(r.retSum) : '–'),
        cell('td', r.scanned ? fmt(r.pantSale) : '–'), cell('td', r.scanned ? fmt(r.pantRet) : '–'),
        cell('td', r.anom || '–'), cell('td', r.settleCount ? fmt(r.settleDiff) : '–')
      ]));
    };
    line(res.total, 'kvr-tot');
    res.rows.forEach(function (r) { line(r); });
    ui.repTable.appendChild(t);
    ui.repNote.textContent = 'Pant og avvik teller bare skannede kvitteringer (' + res.total.scanned + ' av ' + res.total.count + ' salg). Diff = kassadifferanse fra skannede kassaoppgjør.';
  }

  function exportReportCsv() {
    var res = currentReport();
    var n = function (v) { return String(v).replace('.', ','); };
    var rows = [['Dag', 'Gruppe', 'Antall salg', 'Sum', 'Antall retur', 'Sum retur', 'Pant salg', 'Pant retur', 'Skannet', 'Avvik', 'Kassaoppgjør', 'Kassadifferanse']];
    [res.total].concat(res.rows).forEach(function (r) {
      rows.push([r.day, r.label, r.count, n(r.sum), r.retCount, n(r.retSum), n(r.pantSale), n(r.pantRet), r.scanned, r.anom, r.settleCount, n(r.settleDiff)]);
    });
    download(new Blob([L.toCsv(rows)], { type: 'text/csv;charset=utf-8' }), 'dagsrapport.csv');
    say('Rapport eksportert (' + (rows.length - 1) + ' rader).');
  }

  function renderSettle() {
    if (!ui.settleList) return;
    ui.settleList.innerHTML = '';
    var list = recs.filter(function (r) { return r.show && r.item.receiptType === 2; });
    if (!list.length) {
      ui.settleNote.textContent = '';
      ui.settleList.appendChild(el('div', { class: 'kvr-hint', text: 'Ingen kassaoppgjør blant synlige kvitteringer. Velg «2 – Kassaoppgjør» under Filter → Type.' }));
      return;
    }
    var thr = hasNumber(anomCfg.settleDiff) ? Number(anomCfg.settleDiff) : 1;
    var unscanned = list.filter(function (r) { return !scanMap[r.item.transactionId]; }).length;
    ui.settleNote.textContent = list.length + ' kassaoppgjør' + (unscanned ? ' · ' + unscanned + ' ikke skannet (bruk Skann innhold)' : '') + '.';
    list.forEach(function (r) {
      var it = r.item, st = scanMap[it.transactionId] && scanMap[it.transactionId].settle;
      var diff = st ? st.diff.sum || 0 : 0;
      var cls = !st ? ' kvr-na' : (diff !== 0 && Math.abs(diff) >= thr ? '' : ' kvr-ok');
      var row = el('div', { class: 'kvr-li' + cls, title: st ? 'Kontant ' + fmt(st.telt.kontant || 0) + ' · Sjekk ' + fmt(st.telt.sjekk || 0) + ' · Kreditt ' + fmt(st.telt.kreditt || 0) : '' }, [
        el('b', { text: it.endDateTime + ' · kasse ' + it.workstationNumber + ' · kasserer ' + it.cashierNumber }),
        el('span', { text: st ? 'Telt ' + fmt(st.telt.sum || 0) + ' · Differanse ' + (diff > 0 ? '+' : '') + fmt(diff) + ' · Pose ' + (st.pose || '–') + ' · Sendt bank ' + fmt(st.bank || 0) : 'Ikke skannet' })
      ]);
      row.appendChild(entsFor(it));
      row.addEventListener('click', function () { jumpTo(r); });
      ui.settleList.appendChild(row);
    });
  }

  function hasNumber(v) { return v !== '' && v !== null && v !== undefined && !isNaN(Number(v)); }

  // ---- egne avviksregler ---------------------------------------------------------
  function saveCustom() { store(K.arules, customRules); }

  function uniqueRuleName(base, except) {
    var name = base, n = 2;
    while (customRules.some(function (r) { return r !== except && r.name === name; })) name = base + ' ' + n++;
    return name;
  }

  function renderCustom() {
    ui.crules.innerHTML = '';
    if (!customRules.length) ui.crules.appendChild(el('div', { class: 'kvr-hint', text: 'Ingen egne regler ennå. Trykk «Ny regel» eller «Eksempel».' }));
    customRules.forEach(function (r, ri) {
      var en = el('input', { type: 'checkbox', title: 'Aktiv', style: 'flex:0 0 auto' });
      en.checked = r.enabled !== false;
      en.addEventListener('change', function () { r.enabled = en.checked; saveCustom(); });
      var nm = el('input', { type: 'text', value: r.name, placeholder: 'Navn på regel' });
      nm.addEventListener('change', function () { r.name = uniqueRuleName(nm.value.trim() || r.name, r); nm.value = r.name; saveCustom(); });
      var del = btn('✕', function () {
        confirmBox('Slett regel', 'Slette regelen «' + r.name + '»?', 'Slett', function () { customRules.splice(ri, 1); saveCustom(); renderCustom(); });
      }, 'kvr-sm');
      var box = el('div', { class: 'kvr-rule' }, [el('div', { class: 'kvr-row' }, [en, nm, del])]);
      r.conds.forEach(function (c, ci) {
        var fs = el('select', {}, Object.keys(L.RULE_FIELDS).map(function (k) { return el('option', { value: k, text: L.RULE_FIELDS[k].label + (L.RULE_FIELDS[k].scan ? ' *' : '') }); }));
        fs.value = c.f;
        var os = el('select', {}, L.RULE_OPS.map(function (o) { return el('option', { value: o, text: o }); }));
        os.value = c.op;
        var vi = el('input', { type: 'text', value: c.v, placeholder: 'verdi' });
        [fs, os, vi].forEach(function (n) { n.addEventListener('change', function () { c.f = fs.value; c.op = os.value; c.v = vi.value; saveCustom(); }); });
        box.appendChild(el('div', { class: 'kvr-cond' }, [fs, os, vi, btn('✕', function () { r.conds.splice(ci, 1); saveCustom(); renderCustom(); }, 'kvr-sm')]));
      });
      box.appendChild(btn('+ Vilkår', function () { r.conds.push({ f: 'sum', op: '>=', v: '' }); saveCustom(); renderCustom(); }, 'kvr-sm'));
      ui.crules.appendChild(box);
    });
  }


  // ---- kontroller, oppfølging, oppgaver --------------------------------------------
  var BUILTIN_TASKS = [{ id: 'morgen', name: 'Morgenkontroll (i går)', cwRel: 'yesterday', filters: null, scan: true, checks: true, tab: 'check', summary: true, builtin: true }];
  var REL_LABEL = { none: 'Behold datoer', yesterday: 'I går', today: 'I dag', last7: 'Siste 7 dager', lastweek: 'Forrige uke' };

  function opt(v, t) { return el('option', { value: v, text: t }); }

  function waitFor(fn, ms) {
    return new Promise(function (res) {
      var t0 = Date.now();
      (function tick() { if (fn() || Date.now() - t0 > ms) return res(); setTimeout(tick, 100); })();
    });
  }

  function visibleItems() { return recs.filter(function (r) { return r.show; }).map(function (r) { return r.item; }); }

  function addFlag(id, reason) {
    var a = anomMap[id] || (anomMap[id] = []);
    if (a.indexOf(reason) === -1) a.push(reason);
  }

  function pct(x) { return (x * 100).toFixed(0) + ' %'; }

  function tbl(heads, rows) {
    var t = el('table', { class: 'kvr-table kvr-small' }, [el('tr', {}, heads.map(function (h) { return cell('th', h); }))]);
    rows.forEach(function (r) {
      t.appendChild(el('tr', {}, r.map(function (c) {
        var o = c !== null && typeof c === 'object' ? c : { t: c };
        var td = o.node ? el('td', {}, [o.node]) : cell('td', o.t);
        if (o.bad) td.className = 'kvr-bad';
        return td;
      })));
    });
    return el('div', { class: 'kvr-tablewrap' }, [t]);
  }

  function hintEl(t) { return el('div', { class: 'kvr-hint', text: t }); }

  // Øyeblikksbilde av det analysen brukte, slik at rapporten viser det som faktisk ble analysert,
  // også om listen, innstillinger eller skanninger endres etterpå.
  function analysisSnapshot(res, mode, items, pop) {
    var scanSnap = {}, anomSnap = {}, labels = {}, ids = {};
    items.concat(pop).forEach(function (it) {
      var id = it.transactionId;
      if (scanMap[id]) scanSnap[id] = scanMap[id];
      labels[it.storeNumber] = sLabel(it.storeNumber);
    });
    items.forEach(function (it) { ids[it.transactionId] = true; if (anomMap[it.transactionId]) anomSnap[it.transactionId] = anomMap[it.transactionId].slice(); });
    var per = function (a, b) { return (a || '…') + ' → ' + (b || '…'); };
    return {
      at: res.at.getTime(), mode: mode, items: items, pop: pop, scan: scanSnap, anom: anomSnap, storeLabels: labels,
      ctl: JSON.parse(JSON.stringify(ctlCfg)), anomCfg: JSON.parse(JSON.stringify(anomCfg)), timeShift: timeShift,
      scopeText: mode === 'scope' ? scopeSummary() : 'synlige kvitteringer i listen',
      scopeObj: mode === 'scope' ? JSON.parse(JSON.stringify(scope)) : null,
      compare: mode === 'scope' && scope.compare.on ? { a: per(scope.dateFrom, scope.dateTo), b: per(scope.compare.from, scope.compare.to) } : null,
      filters: mode === 'visible' ? chipDefs().filter(function (c) { return !c.state; }).map(function (c) { return c.label; }) : [],
      coverageText: mode === 'scope' && scopeCoverage().missing ? scopeCoverage().text : '',
      cwxRun: cwx && cwx.runs[0] ? JSON.parse(JSON.stringify(cwx.runs[0])) : null,
      archInfo: (function () { var d = Object.keys(arch.days).sort(); return d.length ? { n: archCount(), from: d[0], to: d[d.length - 1], cut: d.filter(function (x) { return arch.days[x].cut; }) } : null; })()
    };
  }

  async function runChecks(mode) {
    mode = mode === 'visible' ? 'visible' : 'scope';
    if (scanning || cwRun || bulk || !grid) return;
    lastMode = mode;
    await runAnom(mode);
    var items = analysisItems(mode);
    var scopeIds = {}, scopeCash = {};
    items.forEach(function (i) { scopeIds[i.transactionId] = true; scopeCash[String(i.cashierNumber)] = true; });
    // grunnlag for tester som trenger hele bildet: alle innlastede bonger i valgte butikker
    var pop = mode === 'visible' ? items : allRecs().filter(function (r) { return storeOK(r.item); }).map(function (r) { return r.item; });
    // bongkopier («Bong kopi») er ikke nye kjøp: bare hendelsesord ser dem, de andre testene får dem ikke
    var allItems = items, allPop = pop, cs = L.splitCopies(items, scanMap);
    items = cs.items; pop = L.splitCopies(pop, scanMap).items;
    // svinn og internt forbruk (type 11 og 13) er ikke salg: de får egne tester, men teller med i bongnummer per kasse
    var seqItems = items, seqPop = pop, shrinkItems = items.filter(L.isShrink), shrinkPop = pop.filter(L.isShrink);
    items = items.filter(function (i) { return !L.isShrink(i); }); pop = pop.filter(function (i) { return !L.isShrink(i); });
    var keep = function (f) { return f.ids.length ? f.ids.some(function (id) { return scopeIds[id]; }) : (f.cashier ? !!scopeCash[f.cashier] : true); };
    var ask = L.askPrice(items, pop, scanMap, ctlCfg), manual = L.manualReceipts(items, pop, scanMap, ctlCfg), covered = {};
    ask.findings.concat(manual.findings).forEach(function (f) { if (f.flag) f.ids.forEach(function (id) { covered[id] = true; }); });
    // tilleggsdata fra CW for butikkene og dagene i grunnlaget
    var days = {}, stores = {};
    allPop.forEach(function (i) { days[L.parseDT(i.endDateTime).date] = true; stores[String(i.storeNumber)] = true; });
    var cwxS = cwx ? { tags: cwx.tags, copies: cwx.copies, sys: cwx.sys.filter(function (r) { return stores[String(r.storeNumber)] && days[L.parseDT(r.endDateTime).date]; }) } : null;
    var prof = L.profiles(items, scanMap, ctlCfg);
    var res = {
      at: new Date(), n: allItems.length, copies: cs.copies.length, mode: mode,
      profile: prof,
      cw: L.cwChecks(items, cwxS, ctlCfg, prof.mainCh),
      shift: L.shiftChecks(items, cwxS && cwxS.sys, scanMap, cwxS, ctlCfg),
      copy: L.copyChecks(items, pop, cwxS && cwxS.sys, cwxS && cwxS.copies, scanMap, ctlCfg),
      shrink: L.shrinkChecks(shrinkItems, pop, scanMap, ctlCfg),
      patterns: L.patterns(items, scanMap, ctlCfg),
      pant: L.pantCheck(items, scanMap, ctlCfg),
      seq: L.sequence(seqItems, ctlCfg),
      recon: L.reconcile(items, scanMap, ctlCfg),
      falseRet: L.falseReturns(items, pop, scanMap, ctlCfg),
      after: L.afterSettlement(items, pop, ctlCfg),
      deleted: L.deletedReceipts(seqPop, ctlCfg),
      diff: L.diffTrend(items, scanMap, ctlCfg),
      numbers: L.numbers(items, scanMap, ctlCfg),
      disc: L.discounts(items, scanMap, ctlCfg, pop, campDec),
      member: L.memberChecks(items, pop, ctlCfg),
      price: L.priceDeviation(items, pop, scanMap, ctlCfg),
      ku: L.kuChecks(items, pop, scanMap, ctlCfg),
      ev: L.eventWords(allItems, scanMap, ctlCfg, covered),
      ledger: L.ledger(items, pop, scanMap, ctlCfg),
      corr: L.retDiffCorr(items, scanMap, ctlCfg),
      lapp: L.lappChecks(items, pop, scanMap, ctlCfg),
      voids: L.voidChecks(items, pop, scanMap, ctlCfg),
      special: L.specialChecks(items, scanMap, ctlCfg),
      ask: ask,
      card: L.cardChecks(items, pop, scanMap, ctlCfg),
      manual: manual,
      tempo: L.tempoChecks(items, ctlCfg),
      watch: L.watchItems(items, pop, scanMap, ctlCfg),
      retEan: L.itemReturns(items, pop, scanMap, ctlCfg),
      retR: L.returnReasons(items, scanMap, ctlCfg),
      hdr: L.headerChecks(items, pop, scanMap, ctlCfg)
    };
    res.findings = res.patterns.concat(res.pant.findings, res.seq.findings, res.falseRet.findings, res.after,
      res.deleted.findings.filter(keep), res.diff.findings.filter(keep), res.numbers.findings.filter(keep), res.disc.findings,
      res.member.findings, res.price.findings, res.ku.findings, res.ev.findings, res.ledger.findings, res.corr.findings.filter(keep),
      res.lapp.findings.filter(keep), res.voids.findings.filter(keep), res.special.findings, res.ask.findings.filter(keep), res.card.findings.filter(keep), res.manual.findings.filter(keep),
      res.tempo.findings.filter(keep), res.watch.findings.filter(keep), res.retEan.findings.filter(keep), res.retR.findings.filter(keep), res.hdr.findings.filter(keep),
      res.cw.findings.filter(keep), res.shift.findings.filter(keep), res.copy.findings.filter(keep), res.shrink.findings.filter(keep));
    res.cashierExtra = {};
    res.findings.forEach(function (f) {
      if (f.flag) f.ids.forEach(function (id) { if (scopeIds[id]) addFlag(id, f.title); });
      else if (f.cashier) {
        var e = res.cashierExtra[f.cashier] || (res.cashierExtra[f.cashier] = { points: 0, notes: [] });
        e.points += L.reasonWeight(f.title, weights);
        e.notes.push(f.title.toLowerCase());
      }
    });
    res.snap = analysisSnapshot(res, mode, allItems, allPop);
    ctlRes = res;
    apply();
    renderControl();
    settingsStale = false; renderStale();
    say('Kontroller ferdig: ' + res.findings.length + ' funn, ' + Object.keys(anomMap).length + ' flaggede kvitteringer.');
  }

  // ---- mulig sentral kampanje: spør brukeren ------------------------------------------------
  // Svaret gjelder varen (alle rabattprosenter) på alle bonger i datagrunnlaget, så alle flaggede bonger med varen oppdateres.
  async function setCamp(key, status, n) {
    if (status) campDec[key] = status; else delete campDec[key];
    store(K.camp, campDec);
    var before = Object.keys(anomMap).length;
    if (ctlRes) { await runChecks(lastMode); if (checkState.at) renderCheck(); }
    if (document.querySelector('.kvr-camp-dlg')) openCampDialog();
    var bongs = n ? ' Gjelder alle ' + n + ' bongene med varen' + (before !== Object.keys(anomMap).length ? ' (' + before + ' → ' + Object.keys(anomMap).length + ' flaggede bonger)' : '') + '.' : '';
    say(status === 'kampanje' ? 'Merket som sentral kampanje, uansett rabattprosent. Rabatten flagges ikke lenger.' + bongs : status === 'ikke' ? 'Merket som ikke kampanje.' + bongs : 'Svaret er angret.');
  }

  function campText(c) { return '«' + c.name + '» med ' + c.rateText + ' rabatt'; }

  // Spørsmålet under en flagget bong: kan det være en sentral kampanje?
  function campQuestion(c) {
    return el('div', { class: 'kvr-camp' }, [
      el('span', { text: 'Kan være sentral kampanje: ' + campText(c) + ' er på ' + c.n + ' bonger hos ' + c.cashiers + ' kasserere. Stemmer det?' }),
      el('div', { class: 'kvr-row' }, [btn('Ja, kampanje', function () { setCamp(c.key, 'kampanje', c.n); }, 'kvr-sm kvr-primary'), btn('Nei, ikke kampanje', function () { setCamp(c.key, 'ikke', c.n); }, 'kvr-sm')]),
      el('span', { class: 'kvr-hint', text: 'Svaret gjelder varen, uansett rabattprosent, og oppdaterer alle flaggede bonger med den.' })
    ]);
  }

  function campTable(list) {
    return tbl(['Vare', 'Rabatt', 'Bonger', 'Kasserere', 'Butikker', 'Dager', 'Svar'], list.map(function (c) {
      var ans = !c.status ? el('span', { class: 'kvr-row' }, [btn('Ja', function () { setCamp(c.key, 'kampanje', c.n); }, 'kvr-sm kvr-primary'), btn('Nei', function () { setCamp(c.key, 'ikke', c.n); }, 'kvr-sm')])
        : c.status === 'auto' ? el('span', {}, [document.createTextNode('Kampanjevare (automatisk) '), btn('Ikke kampanje', function () { setCamp(c.key, 'ikke', c.n); }, 'kvr-sm')])
        : el('span', {}, [document.createTextNode((c.status === 'kampanje' ? 'Kampanje ' : 'Ikke kampanje ')), btn('Angre', function () { setCamp(c.key, '', c.n); }, 'kvr-sm')]);
      return [{ node: el('span', { title: 'EAN ' + c.c }, [document.createTextNode(c.name || c.c)]) }, c.rateText || '–', c.n, c.cashierN, c.storeN, c.dayN, { node: ans }];
    }));
  }

  function openCampDialog() {
    var D = ctlRes && ctlRes.disc;
    var list = D && D.camp ? D.camp.items : [];
    var body = el('div', { class: 'kvr-camp-dlg kvr-secbody' }, [
      hintEl('Samme vare med rabatt på flere bonger hos flere kasserere kan bety en kampanje fra sentralt hold. Bongene er tatt med i analysen. Svaret gjelder varen, uansett rabattprosent, og oppdaterer alle flaggede bonger med den. Svarer du Ja, flagges rabatten ikke lenger. Svarer du Nei, flagges den som vanlig, uten notat. Svarene huskes og er med i revisjonsrapporten.')
    ]);
    if (!list.length) body.appendChild(hintEl('Ingen mulige kampanjer akkurat nå.'));
    else body.appendChild(campTable(list));
    openModal('Mulige sentrale kampanjer', body, [btn('Lukk', closeModal)]);
  }

  function renderDiscCard(D) {
    var box = ui.ctlDisc;
    if (!D || !D.scanned) { box.appendChild(hintEl('Ingen skannede salg med rabattdata i omfanget. Skann på nytt (eldre skanninger mangler rabattdata) og kjør analysen igjen.')); return; }
    var T = D.total;
    box.appendChild(hintEl('Rabattdata for ' + D.scanned + ' av ' + D.sales + ' salg. ' + T.withDisc + ' bonger har rabattlinje (' + fmt(T.disc) + ' kr), ' + T.withNR + ' av dem uten årsak (' + fmt(T.nr) + ' kr). ' + T.withCpn + ' bonger har kupong/kampanje (' + T.cpn + ' kuponger).'));
    var rows = D.rows.map(function (r) {
      return [{ node: entLink('kasserer', r.id) }, r.n, r.withDisc, fmt(r.disc), { t: r.withNR, bad: r.flag }, fmt(r.nr), { t: pct(r.share), bad: r.flag }, { t: r.withW, bad: r.flagW }, r.withCpn, r.cpn];
    });
    rows.push(['Butikk', T.n, T.withDisc, fmt(T.disc), T.withNR, fmt(T.nr), pct(T.share), T.withW, T.withCpn, T.cpn]);
    box.appendChild(tbl(['Kasserer', 'Bonger', 'Med rabatt', 'Rabatt kr', 'Uten årsak', 'Uten årsak kr', 'Andel', 'Overvåket', 'Med kupong', 'Kuponger'], rows));
    box.appendChild(hintEl(D.watch.length ? 'Overvåkede årsaker: ' + D.watch.join(', ') + '. Bongen flagges ved rabatt på minst ' + ctlCfg.discWatchPct + ' % og ' + ctlCfg.discWatchKr + ' kr; kassereren markeres ved minst ' + (ctlCfg.discWatchN || '–') + ' bonger. Endres under Terskler.' : 'Overvåking av rabattårsaker er av (tom liste under Terskler).'));
    if (D.reasons.length) {
      var pick = function (name) { return name === 'Uten årsak' ? 'noreason' : L.DISC_REASONS.indexOf(name) !== -1 ? 'r:' + name : null; };
      box.appendChild(el('b', { class: 'kvr-subh', text: 'Rabatt per årsak' }));
      box.appendChild(tbl(['Årsak', 'Linjer', 'Bonger', 'Rabatt kr', 'Snitt %', 'Overvåket'], D.reasons.map(function (r) {
        var v = pick(r.name);
        var nm = v ? { node: btn(r.name, function () { filters.disc = v; writeForm(); apply(); say('Viser kvitteringer med årsak «' + r.name + '».'); }, 'kvr-ent') } : r.name + ' (ukjent)';
        return [nm, r.lines, r.bongs, fmt(r.sum), r.avgPct === null ? '–' : String(r.avgPct).replace('.', ','), D.watch.indexOf(r.name) !== -1 ? 'ja' : ''];
      })));
      box.appendChild(el('b', { class: 'kvr-subh', text: 'Kasserer × årsak (antall rabattlinjer)' }));
      var mx = D.reasons.map(function (r) { return r.name; });
      box.appendChild(tbl(['Kasserer'].concat(mx), D.matrix.rows.map(function (r) {
        return [{ node: entLink('kasserer', r.id) }].concat(mx.map(function (n) { return r.counts[n] || '·'; }));
      })));
    }
    if (D.campaigns.length) {
      box.appendChild(el('b', { class: 'kvr-subh', text: 'Kuponger (flest først)' }));
      box.appendChild(tbl(['Kupong-id', 'Navn', 'Bonger', 'Sum kr'], D.campaigns.slice(0, 10).map(function (c) { return [c.id, c.name, c.n, fmt(c.sum)]; })));
    }
    if (D.camp) {
      box.appendChild(el('b', { class: 'kvr-subh', text: ctlCfg.campAuto ? 'Kampanjevarer' : 'Mulige sentrale kampanjer' }));
      if (D.camp.pending) box.appendChild(el('div', { class: 'kvr-notice' }, [el('span', { text: D.camp.pending + (D.camp.pending === 1 ? ' vare venter' : ' varer venter') + ' på svar: er det en kampanje fra sentralt hold?' }), btn('Svar nå', openCampDialog, 'kvr-sm kvr-primary')]));
      if (D.camp.items.length) box.appendChild(campTable(D.camp.items.slice(0, 30)));
      if (D.camp.days.length) box.appendChild(tbl(['Kampanjedag', 'Butikk', 'Dag', 'Andel', 'Bonger'], D.camp.days.slice(0, 8).map(function (d) { return ['Mange bonger med rabatt', sLabel(d.store), d.day, pct(d.share), d.withDisc + ' av ' + d.n]; })));
      if (ctlCfg.campAuto) box.appendChild(hintEl(D.camp.auto + ' varer er klassifisert som kampanjevare: minst ' + ctlCfg.campCashiers + ' kasserere har solgt varen med rabatt, på minst ' + (ctlCfg.campBongs || '–') + ' bonger til sammen (én bong hos hver av to kasserere er nok). Rabatten på dem flagges ikke. Trykk «Ikke kampanje» for å flagge som vanlig. Slå av under Innstillinger → Rabatt for å bli spurt i stedet.'));
      var S = D.camp.scan, popTodo = popScanTodo();
      box.appendChild(hintEl('Kampanjesjekken ser ' + S.scanned + ' av ' + S.sales + ' salg i grunnlaget (' + S.cashiers + ' av ' + S.cashiersAll + ' kasserere har skannede bonger). En vare blir bare kampanjevare når de skannede bongene viser den hos flere kasserere.' +
        (ctlCfg.campCoupon ? ' ' + D.camp.coupon + ' rabattlinjer står i en kupong på samme bong og regnes som kampanje.' : '') +
        (ctlCfg.campMulti ? ' ' + D.camp.multi + ' rabattlinjer er like varer med samme rabatt på samme bong (multipakk) og regnes som kampanje.' : '')));
      if (popTodo.length) box.appendChild(el('div', { class: 'kvr-row' }, [btn('Skann hele grunnlaget (' + popTodo.length + ')', scanPopulation, 'kvr-sm')]));
      if (D.camp.others.length) {
        box.appendChild(el('b', { class: 'kvr-subh', text: 'Rabatt uten årsak på varer som ikke er kampanjevare' }));
        var whyText = function (c) {
          return c.why === 'bonger' ? 'bare ' + plur(c.n, 'bong', 'bonger') + ' (grense ' + ctlCfg.campBongs + ')'
            : c.why === 'kasserere' ? 'bare ' + plur(c.cashierN, 'kasserer', 'kasserere') + ' (grense ' + ctlCfg.campCashiers + ')' : c.why === 'av' ? 'kampanjesjekken er av' : '';
        };
        box.appendChild(tbl(['Vare', 'Rabatt', 'Bonger', 'Uten årsak', 'Kasserere', 'Hvorfor ikke', ''], D.camp.others.map(function (c) {
          return [{ node: el('span', { title: (L.isCampCode(c.c) && c.c.length < 8 ? 'PLU ' : 'EAN ') + c.c }, [document.createTextNode(c.name || c.c)]) }, c.rateText, c.n, c.nr, c.cashierN,
            whyText(c), { node: btn('Kampanjevare', function () { setCamp(c.key, 'kampanje', c.n); }, 'kvr-sm') }];
        })));
        box.appendChild(hintEl((D.camp.otherN > D.camp.others.length ? 'Viser ' + D.camp.others.length + ' av ' + D.camp.otherN + ' varer, flest bonger uten årsak først. ' : '') + '«Kampanjevare» merker varen som kampanje uansett rabattprosent, og rabatten på den flagges ikke lenger. Valget huskes og kan angres i tabellen over.'));
      }
      box.appendChild(hintEl('Samme vare med rabatt på minst ' + (ctlCfg.campBongs || '–') + ' bonger hos minst ' + ctlCfg.campCashiers + ' kasserere (over alle dager og butikker) kan være en kampanje fra sentralt hold. Uten automatisk kampanjevare tas bongene med i analysen med et notat, og du blir spurt. Svaret gjelder varen, uansett rabattprosent. Svar Ja: rabatten flagges ikke lenger og telles ikke mot kassereren (' + D.camp.confirmed + ' bekreftet). Svar Nei: flagges som vanlig (' + D.camp.denied + ' avvist). En dag der minst ' + (ctlCfg.campDay || '–') + ' % av minst 30 salg har rabatt får bare notat.'));
    }
    box.appendChild(hintEl('Rabatt = linjen «Rabatt: Kr x (y %)» på en vare med årsak 1 Datovare, 2 Feil pris, 3 Prisløfte, 4 Reserveløsning kupong, 5 Annen rabattårsak eller 6 Best før (tom = ingen årsak valgt). Klikk en årsak for å filtrere listen. Kupong = linjen «Kupong (id - navn)», antatt lagt inn sentralt (CN/VPI); beløpet er ofte 0,00, så den viser at kampanjen er knyttet til bongen, ikke at den er innløst. Rødt = andel bonger med rabatt uten årsak er minst ' + ctlCfg.profFactor + '× butikkens (minst ' + ctlCfg.profMin + ' bonger). Funn «Rabatt uten årsak» krever minst ' + (ctlCfg.discPct || '–') + ' % rabatt. «Høy rabattprosent» flagger ' + (ctlCfg.discHiFrom ? ctlCfg.discHiFrom + '–' + ctlCfg.discHiTo + ' %' : 'ingenting (av)') + '. «Rabatt uten treff» krever minst ' + (ctlCfg.discMatchPct || '–') + ' % og at ingen andre bonger samme dag har varen med samme rabatt. Søk på rabatt-prosent under Skann.'));
  }

  function renderMemberCard(M) {
    var box = ui.ctlMember;
    if (!M || !M.members) { box.appendChild(hintEl('Ingen bonger med medlemsnr blant de innlastede bongene i valgte butikker.')); return; }
    box.appendChild(hintEl(M.members + ' ulike medlemsnr på ' + M.sales + ' salg i valgte butikker. Viser de ' + Math.min(15, M.rows.length) + ' med flest funn og bruk (d = dager, b = butikker, kasserer med andel av bongene). Trenger ikke skanning.'));
    var short = { 'flere butikker': 'butikker', 'samme dag': 'dag', 'mye brukt': 'mye', 'én kasserer': 'kasserer', 'eget nummer': 'eget', 'ansatt': 'ansatt' };
    box.appendChild(tbl(['Medlemsnr', 'Bonger', 'Kasserer', 'Funn'], M.rows.slice(0, 15).map(function (r) {
      var bad = r.flags.length > 0;
      return [{ node: btn(r.id, function () { filters.member = r.id; writeForm(); apply(); say('Viser kvitteringer med medlemsnr ' + r.id + '.'); }, 'kvr-ent') }, { t: r.n + ' (' + r.days + ' d, ' + r.stores + ' b)', bad: bad },
        { node: el('span', {}, [entLink('kasserer', r.cashier, r.cashier), document.createTextNode(' (' + pct(r.share) + ')')]), bad: r.flags.indexOf('én kasserer') !== -1 }, { t: r.flags.map(function (f) { return short[f] || f; }).join(', ') || '–', bad: bad }];
    })));
    box.appendChild(hintEl('Funn: to butikker innen ' + (ctlCfg.memberStoreMin || '–') + ' min, minst ' + (ctlCfg.memberDayN || '–') + ' bonger samme dag, totalt ' + (ctlCfg.memberN || '–') + ', og nesten bare hos én kasserer (minst ' + (ctlCfg.memberCashN || '–') + ' bonger, over ' + ctlCfg.memberCashShare + ' % og minst ' + ctlCfg.profFactor + '× kassererens vanlige andel). ' +
      (ctlCfg.empMembers ? 'Ansattliste er på.' : 'Legg inn ansattes medlemsnr under Innstillinger for å fange eget nummer direkte.') + ' Mange bruk av ett nummer kan være en trofast kunde: vurder sammen med hvem som taster det.'));
  }

  function renderMiscCard(R) {
    var box = ui.ctlMisc, P = R.price, K = R.ku, E = R.ev;
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Pris per vare' }));
    box.appendChild(hintEl(P.scanned + ' av ' + P.sales + ' salg har enhetspris (ny skanning), ' + P.lines + ' varelinjer. ' + P.groups + ' vare/butikk/dag-grupper har klar vanlig pris. ' + P.deviating + ' varelinjer i omfanget avviker minst ' + (ctlCfg.priceDevPct || '–') + ' %.' + (P.coverage < 1 ? ' Eldre skanninger mangler enhetspris: skann på nytt for full dekning.' : '')));
    if (P.rows.length) box.appendChild(tbl(['Kasserer', 'Avvikende linjer'], P.rows.map(function (r) { return [{ node: entLink('kasserer', r.id) }, r.n]; })));
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Kjøpeutbytte' }));
    box.appendChild(hintEl(K.members + ' medlemssalg, ' + K.scanned + ' skannet med ny skanning, ' + K.withTable + ' med Kjøpeutbytte-tabell. ' +
      (K.applicable ? 'Tabellen finnes på de fleste medlemsbonger, så fravær regnes som avvik.' : 'Tabellen finnes ikke på nok medlemsbonger (eller for få er skannet) til at fravær regnes som avvik.') +
      (K.ratio !== null ? ' Vanlig forhold grunnlag/varesum: ' + Math.round(K.ratio * 100) + ' %.' : '')));
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Hendelsesord' }));
    box.appendChild(hintEl(E.hits + ' av ' + E.scanned + ' skannede bonger har ord som annullert, parkert, manuell eller spør pris. Slike hendelser er ikke observert i ekte data ennå.' + (E.covered ? ' ' + E.covered + ' av dem har bare ord som allerede har egne tester (spør pris, manuell kvittering) og flagges der.' : '') +
      (R.copies ? ' ' + R.copies + ' bongkopier («Bong kopi») flagges bare her og er holdt utenfor de andre testene.' : '')));
    box.appendChild(el('div', { class: 'kvr-row' }, [btn('Diagnostikk: ukjente linjer…', openDiag)]));
  }

  // Aldri «100 %» hvis noe ikke stemmer: rundes ned til én desimal.
  function pctOf(a, b) {
    if (!b) return '–';
    if (a === b) return '100 %';
    var v = Math.min(99.9, Math.floor(a / b * 1000) / 10);
    return (v % 1 === 0 ? String(v) : v.toFixed(1).replace('.', ',')) + ' %';
  }

  function calText(name, c, tol) {
    return name + ': ' + c.n + ' bonger vurdert, ' + pctOf(c.ok, c.n) + ' stemmer. ' +
      (c.applicable ? 'Kontrollen er aktiv.' : 'Kontrollen er ikke aktiv: færre enn 10 bonger, eller under 80 % stemmer, så regnskapsmåten på bongen er ikke bevist og avvik regnes ikke som funn.');
  }

  function oldScans() {
    return recs.filter(function (r) { var sc = scanMap[r.item.transactionId]; return r.base && r.item.receiptType === 1 && sc && !L.hasV7(sc); });
  }

  function rescanOld() {
    var todo = oldScans();
    if (!todo.length || scanning) return;
    var sec = Math.round(todo.length * 1.1), est = sec >= 60 ? Math.round(sec / 60) + ' min' : sec + ' s';
    confirmBox('Skann på nytt', todo.length + ' bonger har eldre skanning uten topptekst, bunn, kortdata, Totalt, MVA og betalingsreferanse. Skanner dem på nytt (ca. ' + est + '). Hver bong åpnes i CWs visningsfelt, ett oppslag per bong.', 'Skann på nytt', function () {
      scanList(todo).then(function () { apply(); });
    });
  }

  // Kampanjesjekken trenger skannede bonger fra alle kasserere, ikke bare omfanget.
  function popScanTodo() { return todoFor(recs.filter(function (r) { return storeOK(r.item) && r.item.receiptType === 1; })); }
  function scanPopulation() {
    var todo = popScanTodo();
    if (!todo.length || scanning) return;
    confirmBox('Skann hele grunnlaget', todo.length + ' salg i valgte butikker er ikke skannet. Kampanjesjekken ser da bare kassererne i omfanget. Skanner dem (ca. ' + Math.max(1, Math.round(todo.length * 1.1)) + ' s) og kjører analysen på nytt.', 'Skann', async function () {
      await scanList(todo);
      if (ctlRes) { await runChecks(lastMode); if (checkState.at) renderCheck(); }
      apply();
    });
  }

  function rescanReturns() {
    var todo = recs.filter(function (r) { return r.base && r.item.receiptType === 1 && L.maybeReturn(scanMap[r.item.transactionId]); });
    if (!todo.length || scanning) return;
    confirmBox('Skann returbonger på nytt', todo.length + ' bonger med retur er skannet med en eldre versjon som ikke leser returårsaken. Skanner bare dem på nytt (ca. ' + Math.max(1, Math.round(todo.length * 1.1)) + ' s). Kjør analysen på nytt etterpå.', 'Skann', function () {
      scanList(todo).then(function () { apply(); });
    });
  }

  function plur(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function renderLappCard(R) {
    var box = ui.ctlLapp, P = R.lapp;
    if (!P.scanned) { box.appendChild(hintEl('Ingen skannede salg i valgte butikker. Skann og kjør analysen på nytt.')); return; }
    box.appendChild(hintEl(P.scanned + ' av ' + P.sales + ' salg er skannet. Pantemaskin (kode 399): ' + P.mach.n + ' pantelapper, ' + fmt(P.mach.sum) + ' kr. Manuelt innlagt (kode 99): ' + P.man.n + ' pantelapper, ' + fmt(P.man.sum) + ' kr. Slettet: ' + P.del + '. Gjenbrukt: ' + P.reuse + '.'));
    var rows = P.rows.filter(function (r) { return r.bongs || r.del || r.reuse; }).map(function (r) {
      return [{ node: entLink('kasserer', r.id) }, r.bongs, r.mach.n + ' · ' + fmt(r.mach.sum), { t: r.man.n + ' · ' + fmt(r.man.sum), bad: r.flag }, { t: pct(r.share), bad: r.flag }, r.del, r.reuse];
    });
    if (rows.length) {
      box.appendChild(tbl(['Kasserer', 'Bonger', 'Maskin 399', 'Manuell 99', 'Andel manuell', 'Slettet', 'Gjenbruk'], rows));
      box.appendChild(hintEl('Maskin og manuell vises som antall · kr. Maskin = «399 PANTELAPP», lest fra pantemaskinen. Manuell = «99 PANTELAPP», lagt inn for hånd. Rødt = minst ' + (ctlCfg.lappManualN || '–') + ' bonger med manuell pantelapp og andel over butikkens (' + pct(P.storeShare) + ') × ' + ctlCfg.profFactor + '. Slettet = en pantelapp og en motlinje med samme beløp på samme bong. Gjenbruk = samme sum (minst ' + ctlCfg.pantMin + ' kr) på ulike bonger innen ' + (ctlCfg.lappReuseMin || '–') + ' min, eller samme lappnummer hvis bongen viser det. Flaskepant fra andre butikker gir noen tilfeldige treff.'));
    } else box.appendChild(hintEl('Ingen pantelapper i omfanget.'));
  }

  function renderLinesCard(R) {
    var box = ui.ctlLines, V = R.voids, S = R.special, A = R.ask, C = R.card, M = R.manual;
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Slettede og makulerte linjer' }));
    box.appendChild(hintEl(V.scanned + ' av ' + V.sales + ' salg skannet. ' + plur(V.voided, 'varelinje', 'varelinjer') + ' slettet på ' + plur(V.bongs, 'bong', 'bonger') + ', ' + V.combos + ' av dem med pant og kontant tilbake. ' +
      (V.applicable ? 'Makulerte EAN-varer: ' + V.resold + ' solgt på nytt innen ' + (ctlCfg.voidResaleMin || '–') + ' min, ' + V.unresolved + ' ikke.' : 'Gjensalg vurderes ikke: under 80 % av salgene er skannet.')));
    var vrows = V.rows.filter(function (r) { return r.lines; }).map(function (r) { return [{ node: entLink('kasserer', r.id) }, r.sales, { t: r.lines, bad: r.flag }, r.unresolved, r.combos]; });
    if (vrows.length) box.appendChild(tbl(['Kasserer', 'Salg', 'Slettet', 'Uten gjensalg', 'Pant+kontant'], vrows));
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Spesialbetalinger' }));
    if (!S.words.length) box.appendChild(hintEl('Av: ordlisten er tom under Innstillinger.'));
    else {
      box.appendChild(hintEl(S.hits + ' av ' + S.scanned + ' skannede bonger har ett av ordene: ' + S.words.join(', ') + '.'));
      var wr = Object.keys(S.byWord).map(function (w) { return [{ node: btn(w.charAt(0).toUpperCase() + w.slice(1), function () { filters.special = w; writeForm(); apply(); say('Viser kvitteringer med «' + w + '».'); }, 'kvr-ent') }, S.byWord[w].bongs, fmt(S.byWord[w].sum)]; });
      if (wr.length) box.appendChild(tbl(['Ord', 'Bonger', 'Beløp kr'], wr));
      if (S.rows.length) box.appendChild(tbl(['Kasserer', 'Bonger'], S.rows.map(function (r) { return [{ node: entLink('kasserer', r.id) }, { t: r.n, bad: r.flag }]; })));
    }
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Spør pris' }));
    box.appendChild(hintEl('Spør pris: ' + plur(A.lines, 'linje', 'linjer') + ' funnet (' + A.noRef + ' uten sammenligningsgrunnlag samme dag), ' + A.deviating + ' avviker minst ' + (ctlCfg.askDevPct || '–') + ' % fra dagens salg. ' + A.evOnly + ' bonger har ordet «spør pris» uten at linjen er identifisert. Formatet er ikke bekreftet i ekte data.'));
    if (A.rows.length) box.appendChild(tbl(['Kasserer', 'Bonger', 'Avvikende'], A.rows.map(function (r) { return [{ node: entLink('kasserer', r.id) }, { t: r.n, bad: r.flag }, r.dev]; })));
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Returer på samme kort' }));
    if (!C.scanned) box.appendChild(hintEl('Ingen salg med kortdata. Kortnummer leses først i skanning versjon 6: bruk «Skann på nytt» under Bongregnskap.'));
    else {
      box.appendChild(hintEl(C.returns + ' returer blant ' + C.scanned + ' skannede salg, ' + C.withCard + ' med kort på bongen. Samme kort = samme leverandør og samme kortnummer slik det er trykt (siste fire siffer, eventuelt utsteder). Formatet er ikke bekreftet i ekte data.'));
      var cr = C.rows.filter(function (r) { return r.n > 1; }).slice(0, 10).map(function (r) { return [r.label, { t: r.n, bad: r.flag }, r.best, fmt(r.sum), Object.keys(r.cashiers).map(function (k) { return k + ' ×' + r.cashiers[k]; }).join(', ')]; });
      if (cr.length) box.appendChild(tbl(['Kort', 'Returer', 'Innen ' + ctlCfg.cardRetDays + ' d', 'Sum kr', 'Kasserer'], cr));
    }
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Manuell kvittering og til gode-lapp' }));
    box.appendChild(hintEl(M.words.length ? M.manual + ' bonger med ordene «' + M.words.join('», «') + '» blant ' + M.scanned + ' skannede; ' + M.findings.length + ' har samme beløp som en annen bong innen ' + ctlCfg.manualDays + ' dager. Ordene er ikke bekreftet i ekte data; se Diagnostikk.' : 'Av: ordlisten er tom under Innstillinger.'));
    renderTempo(box, R.tempo);
    renderWatch(box, R.watch);
    renderRetReason(box, R.retR);
    renderRetEan(box, R.retEan);
    box.appendChild(hintEl('Kortdata krever ny skanning: bruk «Skann på nytt» under Bongregnskap og referanser. Ukjente linjer og ord finner du i Diagnostikk under Pris, kjøpeutbytte og hendelser.'));
  }

  function renderTempo(box, T) {
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Tempo: tid mellom bonger' }));
    if (!T.sales) { box.appendChild(hintEl('Ingen salg med klokkeslett i omfanget.')); return; }
    var how = T.secOK
      ? 'Listen viser sekunder (' + pct(T.secShare) + ' av bongene). ' + (T.gapOn ? T.series + ' serier på ' + T.inSeries + ' bonger: minst ' + ctlCfg.paceN + ' bonger på samme kasse med høyst ' + ctlCfg.paceSec + ' s mellom.' : 'Serietesten er av.') + (T.minGap !== null ? ' Kortest tid mellom to bonger: ' + T.minGap + ' s.' : '')
      : 'Listen viser bare hele minutter (' + pct(T.secShare) + ' har sekunder). ' + (T.gapOn ? T.series + ' minutter med minst ' + ctlCfg.paceMinuteN + ' bonger på samme kasse.' : 'Testen er av.');
    box.appendChild(hintEl(T.sales + ' salg. ' + how + ' ' + T.zero + ' bonger har sum 0,00 kr.'));
    if (T.rows.length) box.appendChild(tbl(['Kasserer', 'Serier', 'Bonger i serie', '0-kr-bonger'], T.rows.map(function (r) { return [{ node: entLink('kasserer', r.id) }, r.series, r.inSeries, { t: r.zero, bad: r.zeroFlag }]; })));
    box.appendChild(hintEl('Raske serier kan være kø med få varer, selvbetjening eller opprydding etter en feil. Se bongene før du konkluderer. Rødt = minst ' + (ctlCfg.zeroN || '–') + ' bonger på 0,00 kr.'));
  }

  function renderWatch(box, W) {
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Overvåkede varer' }));
    if (!W.terms.length) { box.appendChild(hintEl('Av: legg inn EAN eller del av navn under Innstillinger → Overvåkede varer (for eksempel tobakk, gavekort, energidrikk).')); return; }
    box.appendChild(hintEl(W.bongs + ' av ' + W.scanned + ' skannede salg har varene: ' + W.terms.join(', ') + '.'));
    var tr = Object.keys(W.byTerm).map(function (t) {
      var b = W.byTerm[t];
      return [{ node: btn(t, function () { filters.item = t; writeForm(); apply(); say('Viser kvitteringer med «' + t + '».'); }, 'kvr-ent') }, b.bongs, b.lines, fmt(b.sale), fmt(b.ret), fmt(b.del)];
    });
    if (tr.length) box.appendChild(tbl(['Treff', 'Bonger', 'Linjer', 'Salg kr', 'Retur kr', 'Slettet kr'], tr));
    if (W.rows.length) box.appendChild(tbl(['Kasserer', 'Salg', 'Med vare', 'Andel', 'Butikk', 'Retur', 'Slettet'], W.rows.map(function (r) {
      return [{ node: entLink('kasserer', r.id) }, r.sales, { t: r.n, bad: r.flag }, { t: pct(r.share), bad: r.flag }, pct(r.storeShare), r.ret, r.del];
    })));
    box.appendChild(hintEl('Siffer i listen matcher starten på EAN, tekst matcher del av varenavnet. Retur = negativ linje uten motlinje; slettet = linje og motlinje med samme beløp. Rødt = minst ' + (ctlCfg.watchN || '–') + ' bonger og over butikkens andel med ' + ctlCfg.profFactor + '×.'));
  }

  function renderRetReason(box, E) {
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Retur per årsak' }));
    var oldTxt = E.old ? ' ' + E.old + ' bonger med mulig retur er skannet med en eldre versjon som ikke leser årsaken.' : '';
    if (E.old) box.appendChild(el('div', { class: 'kvr-row' }, [btn('Skann returbonger på nytt (' + E.old + ')', rescanReturns)]));
    if (!E.bongs) { box.appendChild(hintEl('Ingen returer av varer (utenom pant) blant ' + E.scanned + ' skannede salg.' + oldTxt)); return; }
    box.appendChild(hintEl(E.bongs + ' bonger med ' + E.lines + ' returlinjer (' + fmt(E.sum) + ' kr) blant ' + E.scanned + ' skannede salg. ' +
      (E.words.length ? E.watched + ' bonger har overvåket årsak (' + E.words.join(', ') + ').' : 'Ingen overvåkede årsaker.') + oldTxt));
    box.appendChild(tbl(['Årsak', 'Bonger', 'Linjer', 'Kr', 'Kasserere'], E.reasons.slice(0, 15).map(function (r) {
      var name = r.name === L.NO_RET_REASON ? { t: r.name } : { node: btn(r.name + (r.known ? '' : ' (ukjent årsak)'), function () { filters.text = r.name; writeForm(); apply(); say('Viser kvitteringer med «' + r.name + '».'); }, 'kvr-ent') };
      if (r.watched) name.bad = true;
      return [name, r.bongs, r.lines, fmt(r.sum), r.cashiers.slice(0, 4).map(function (c) { return c.id + ' ×' + c.n; }).join(', ') + (r.cashiers.length > 4 ? ' …' : '')];
    })));
    if (E.words.length && E.rows.length) box.appendChild(tbl(['Kasserer', 'Salg', 'Med retur', 'Overvåket årsak', 'Andel', 'De andre'], E.rows.map(function (r) {
      return [{ node: entLink('kasserer', r.id) }, r.n, r.ret, { t: r.withW, bad: r.flag }, { t: pct(r.share), bad: r.flag }, r.others === null ? '–' : pct(r.others)];
    })));
    box.appendChild(hintEl('Årsaken står på linjen «RETUR VARE» over varen. Klikk en årsak for å vise bongene i listen. Rødt = overvåket årsak, eller kasserer med minst ' + (ctlCfg.retWatchN || '–') + ' slike bonger og minst ' + (ctlCfg.profFactor || '–') + ' ganger andelen hos de andre. Mange returer med matvaregaranti kan være helt i orden; se på bongene, tidspunkt og betaling før du konkluderer.'));
  }

  function renderRetEan(box, E) {
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Retur av vare uten kjøp' }));
    if (!E.on) { box.appendChild(hintEl('Av: se Innstillinger → Retur av vare uten kjøp.')); return; }
    if (!E.applicable) { box.appendChild(hintEl('Ikke vurdert: bare ' + pct(E.coverage) + ' av salgene er skannet (krever minst 80 %). Skann alle salgene og kjør analysen på nytt.')); return; }
    box.appendChild(hintEl(E.returns + ' returer med ' + E.lines + ' vare-linjer vurdert. ' + E.flagged + ' uten kjøp av samme vare (kort ' + E.byCard + ', medlem ' + E.byMember + ', samme dag ' + E.byDay + '). ' + E.short + ' ikke vurdert fordi mindre enn ' + (ctlCfg.retEanDays || '–') + ' dager er lastet før returen, ' + E.unlinked + ' uten kjøp å sammenligne med.'));
    if (E.rows.length) box.appendChild(tbl(['Når', 'Kasserer', 'Grunnlag', 'Linjer', 'Beløp kr'], E.rows.slice(0, 12).map(function (r) { return [r.when, { node: entLink('kasserer', r.cashier) }, r.basis, r.n, fmt(r.amt)]; })));
    box.appendChild(hintEl('Kortet eller medlemmet har andre kjøp i perioden, men ikke denne varen (EAN). Kunden kan ha kjøpt varen før perioden, kontant eller i en annen butikk, så dette er en indikasjon, ikke bevis.'));
  }

  function renderAcctCard(R) {
    var box = ui.ctlAcct, G = R.ledger;
    box.appendChild(hintEl(G.scanned + ' av ' + G.sales + ' salg har ny skanning (' + G.withTot + ' med Totalt). Eldre skanninger mangler Totalt, MVA og betalingsreferanse.'));
    box.appendChild(hintEl(calText('Linjer mot Totalt', G.lines)));
    box.appendChild(hintEl(calText('Betaling mot Totalt', G.pay)));
    box.appendChild(hintEl(calText('MVA-tabell (' + G.vat.tables + ' tabeller)', G.vat) + ' Ugyldig sats flagges uansett.'));
    box.appendChild(hintEl(G.refs.n + ' betalingsreferanser lest, ' + G.refs.dup + ' brukt på flere bonger.'));
    var H = R.hdr;
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Topptekst og bunn' }));
    if (!H.scanned) box.appendChild(hintEl('Ingen salg med topptekst og bunn. Bruk «Skann på nytt» (versjon 7).'));
    else {
      box.appendChild(hintEl(H.withHdr + ' av ' + H.scanned + ' skannede salg har lest topptekst (' + Object.keys(H.fields).map(function (k) {
        var f = H.fields[k];
        return f.name + ': ' + (f.n ? f.ok + ' av ' + f.n + ' stemmer med listen (' + pct(f.rate) + ')' + (f.trusted ? '' : ', ikke kalibrert') : 'ingen lest');
      }).join('; ') + '). ' + H.withFt + ' har tekst fra kortterminalen, ' + H.withAuth + ' med autorisasjonskode, ' + H.auth + ' koder brukt på flere bonger.'));
      box.appendChild(hintEl('Feltet kontrolleres bare når minst 90 % av minst 10 bonger stemmer fra før. Formatet er ikke bekreftet i ekte data: se Diagnostikk for linjene som ikke gjenkjennes.'));
    }
    var old = oldScans().length;
    if (old) box.appendChild(el('div', { class: 'kvr-row' }, [btn('Skann på nytt (' + old + ' eldre)', rescanOld)]));
  }

  // Tilleggsdata fra CW og svinn: innhold per kasserer, innlogging, bongkopi og svinn/internt forbruk.
  function renderCwxCard(R) {
    var box = ui.ctlCwx, C = R.cw, S = R.shift, P = R.copy, W = R.shrink;
    var getBtn = function () { return el('div', { class: 'kvr-row' }, [btn('Hent tilleggsdata fra CW', function () { fetchCwExtra(); }), btn('Til Hent', function () { ui.go('cw'); }, 'kvr-sm')]); };
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Innhold og betaling ifølge CWs filtre' }));
    if (!C.on) { box.appendChild(hintEl('Ikke hentet. «Hent tilleggsdata fra CW» bruker CWs egne filtre på søket i listen og merker bongene med innhold og betaling. Kjør analysen på nytt etterpå.')); box.appendChild(getBtn()); }
    else {
      box.appendChild(hintEl(C.tagged + ' av ' + C.sales + ' salg er merket av CWs filtre. ' + C.combos + ' bonger har en kombinasjon som flagges.' + (cwx && cwx.runs[0] && cwx.runs[0].cut ? ' Søket var kuttet ved 1000 bonger; tallene gjelder bongene i listen.' : '')));
      if (C.tags.length) box.appendChild(tbl(['Innhold', 'Bonger', 'Andel av salg'], C.tags.map(function (t) { return [t.tag.replace(/^Betaling: /, 'Betaling: '), t.n, pct(C.sales ? t.n / C.sales : 0)]; })));
      var cols = C.tags.filter(function (t) { return t.rate; }).slice(0, 6).map(function (t) { return t.tag; });
      var rows = C.rows.filter(function (r) { return cols.some(function (t) { return r.cells[t].n; }); });
      if (cols.length && rows.length) box.appendChild(tbl(['Kasserer', 'Salg'].concat(cols.map(function (t) { return t.replace(/^Betaling: /, ''); })), rows.map(function (r) {
        return [{ node: entLink('kasserer', r.id) }, r.sales].concat(cols.map(function (t) { var e = r.cells[t]; return e.n ? { t: e.n + ' (' + pct(e.rate) + ')', bad: e.flag } : '–'; }));
      })));
      box.appendChild(hintEl('Rødt = minst ' + (ctlCfg.cwRateN || '–') + ' bonger og minst ' + ctlCfg.profFactor + '× andelen hos de andre kassererne i samme kanal (eller i butikken). Kontant, kreditt, finansiering og skannet pant sammenlignes ikke. Merkingen er CWs egen; se bongene før du konkluderer.'));
    }
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Innlogging og utlogging' }));
    if (!S.hasLogins) box.appendChild(hintEl('Ingen innlogginger i grunnlaget. De hentes med «Hent tilleggsdata fra CW».' + (S.dual ? ' ' + S.dual + ' kasserere har salg på to betjente kasser om hverandre (se funn).' : '')));
    else {
      box.appendChild(hintEl(S.logins + ' innlogginger og ' + S.logouts + ' utlogginger gir ' + S.sessions.length + ' økter. ' + S.short + ' korte innlogginger med retur eller sletting, ' + S.dual + ' kasserere med salg på to betjente kasser om hverandre.'));
      if (S.rows.length) box.appendChild(tbl(['Kasserer', 'Økter', 'Tid innlogget', 'Korteste', 'Kasser', 'Kort med retur/sletting'], S.rows.map(function (r) {
        return [{ node: entLink('kasserer', r.id) }, r.sessions, (r.minutes / 60).toFixed(1).replace('.', ',') + ' t', r.shortest === null ? '–' : r.shortest + ' min', r.kasser.join(', '), { t: r.short, bad: r.short > 0 }];
      })));
      box.appendChild(hintEl('En økt varer fra innlogging til utlogging eller neste innlogging på samme kasse. Kort = høyst ' + (ctlCfg.shortMin || '–') + ' min med høyst ' + ctlCfg.shortSales + ' salg.'));
    }
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Bongkopier' }));
    if (!P.n) box.appendChild(hintEl('Ingen bongkopier i grunnlaget. De hentes med «Hent tilleggsdata fra CW».'));
    else {
      box.appendChild(hintEl(P.n + ' bongkopier. ' + P.found + ' av de opprinnelige bongene står i listen. ' + P.ret + ' kopier er fulgt av en retur.'));
      box.appendChild(tbl(['Når', 'Kasse', 'Kasserer', 'Kopi av bong', 'Opprinnelig', 'Retur etterpå'], P.copies.slice(0, 15).map(function (x) {
        var o = x.orig;
        return [x.copy.endDateTime.slice(5), x.copy.workstationNumber, { node: entLink('kasserer', x.copy.cashierNumber) }, x.ref || '–',
          o ? o.endDateTime.slice(5) + ' · kasserer ' + o.cashierNumber + ' · ' + fmt(o.totalAmount) : 'ikke i listen',
          x.ret ? { t: x.ret.endDateTime.slice(11) + ' · ' + fmt(x.ret.totalAmount), bad: true } : '–'];
      })));
    }
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Synlig svinn og internt forbruk' }));
    if (!W.n) box.appendChild(hintEl('Ingen bonger med synlig svinn eller internt forbruk i omfanget. I CW hører de til bongtypen Varetransaksjoner.'));
    else {
      box.appendChild(hintEl(W.n + ' registreringer, til sammen ' + fmt(W.kr) + ' kr (' + Object.keys(W.byType).map(function (k) { return k.toLowerCase() + ' ' + W.byType[k].n + ' · ' + fmt(W.byType[k].kr) + ' kr'; }).join(', ') + '). ' + W.scanned + ' av ' + W.n + ' er skannet; varene leses bare fra skannede bonger.'));
      box.appendChild(tbl(['Registrert av', 'Bonger', 'Kr', 'Varelinjer', 'Flagget'], W.rows.map(function (r) { return [{ node: entLink('kasserer', r.id) }, r.n, fmt(r.kr), r.lines, { t: r.flags, bad: r.flags > 0 }]; })));
      if (W.items.length) box.appendChild(tbl(['Vare', 'EAN', 'Linjer', 'Kr'], W.items.slice(0, 10).map(function (e) { return [e.n, e.c, e.lines, fmt(e.kr)]; })));
      box.appendChild(hintEl('Svinn er ofte helt i orden (utgått dato, knust vare). Se etter mønstre: overvåkede varer, samme vare som er returnert samme dag, store beløp og registreringer utenom åpningstid.'));
    }
  }

  function renderAuditCards(R) {
    var D = R.diff;
    if (!D || !D.rows.length) ui.ctlDiff.appendChild(hintEl('Ingen skannede kassaoppgjør i omfanget. Skann og kjør analysen på nytt.'));
    else {
      ui.ctlDiff.appendChild(tbl(['Enhet', 'Oppgjør', 'Minus', 'Pluss', 'Sum minus', 'Netto', 'Siste differanser'], D.rows.map(function (e) {
        return [{ node: entLink(e.kind, e.id) }, e.n, { t: e.minus, bad: e.flag }, e.plus, { t: fmt(e.sumMinus), bad: e.flag }, fmt(e.net),
          e.list.slice(-5).map(function (x) { return (x.diff > 0 ? '+' : '') + String(x.diff).replace('.', ','); }).join(' · ')];
      })));
      ui.ctlDiff.appendChild(hintEl('Rødt = minst ' + ctlCfg.diffRepeatN + ' oppgjør med minus fordelt på flere dager, eller minus totalt over ' + ctlCfg.diffTotal + ' kr. Differanser under ' + ctlCfg.diffMin + ' kr telles ikke.'));
    }
    if (R.corr && R.corr.rows.length) {
      ui.ctlDiff.appendChild(el('b', { class: 'kvr-subh', text: 'Retur mot kassadifferanse per kasserer' }));
      ui.ctlDiff.appendChild(tbl(['Kasserer', 'Dager', 'ρ', 'Differanse', 'Returandel'], R.corr.rows.map(function (r) {
        return [{ node: entLink('kasserer', r.id) }, r.days, { t: r.rho === null ? '–' : r.rho.toFixed(2).replace('.', ','), bad: r.flag }, { t: fmt(r.diff), bad: r.flag }, pct(r.retShare)];
      })));
      ui.ctlDiff.appendChild(hintEl('ρ = Spearman-korrelasjon over dager (minst ' + ctlCfg.corrDays + ', med minst 5 salg og et kassaoppgjør) mellom returandel og kassadifferanse. Negativ ρ betyr at dager med flere returer har mer minus. Rødt = ρ under −' + (ctlCfg.corrRho || '–') + ', samlet minus og returandel over butikkens.'));
    }
    var N = R.numbers, o = N.overall;
    ui.ctlNum.appendChild(hintEl('Benford (første siffer i totalbeløp): ' + o.n + ' bonger · MAD ' + o.mad.toFixed(3) + ' · ' + o.verdict + (o.enough ? '' : ' (for få bonger til en sikker konklusjon; minst ' + ctlCfg.benfordMin + ')') + '. Hele kroner: ' + Math.round(N.storeRound * 100) + ' % av totalene.'));
    if (N.cashiers.length) {
      ui.ctlNum.appendChild(tbl(['Kasserer', 'Bonger', 'MAD', 'Vurdering', 'Hele kroner', 'Siste siffer (p)'], N.cashiers.map(function (c) {
        return [{ node: entLink('kasserer', c.id) }, c.n, { t: c.mad.toFixed(3), bad: c.flagBenford }, c.verdict, { t: pct(c.roundShare), bad: c.flagRound },
          { t: c.digitP === null ? '–' : (c.digitP < 0.0001 ? '< 0,0001' : c.digitP.toFixed(4).replace('.', ',')), bad: c.flagDigit }];
      })));
    }
    renderDiscCard(R.disc);
    renderMemberCard(R.member);
    renderMiscCard(R);
    renderLappCard(R);
    renderLinesCard(R);
    renderAcctCard(R);
    renderCwxCard(R);
    ui.ctlNum.appendChild(hintEl('MAD under 0,006 er nær Benford, 0,006–0,012 akseptabel, 0,012–0,015 marginal, over 0,015 avvikende (Nigrini). Avvik er en indikasjon som må forklares, ikke et bevis. Kasserere med færre enn ' + ctlCfg.benfordCashMin + ' bonger vurderes ikke.'));
  }

  function renderControl() {
    if (!ui.ctlProfile) return;
    var R = ctlRes;
    ui.ctlInfo.textContent = R ? 'Sist kjørt ' + R.at.toLocaleTimeString('nb-NO') + ' på ' + R.n + (R.mode === 'visible' ? ' synlige' : ' kvitteringer i omfanget') + '.' : 'Ikke kjørt ennå. Filtrer listen først, og trykk «Kjør alle kontroller».';
    [ui.ctlProfile, ui.ctlFindings, ui.ctlPant, ui.ctlRecon, ui.ctlDiff, ui.ctlNum, ui.ctlDisc, ui.ctlMember, ui.ctlMisc, ui.ctlLapp, ui.ctlLines, ui.ctlAcct, ui.ctlCwx].forEach(function (n) { n.innerHTML = ''; });
    ui.ctlResults.style.display = R ? '' : 'none';
    ui.ctlSumCard.style.display = R ? '' : 'none';
    if (!R) return;
    var profFlag = R.profile.rows.filter(function (r) { return r.flagged; }).length;
    var reconFlag = R.recon.filter(function (r) { return r.flag; }).length;
    var pantFlag = R.pant.balance.filter(function (b) { return b.flag; }).length;
    ui.ctlSum.textContent = R.findings.length + ' funn · ' + Object.keys(anomMap).length + ' flaggede bonger · ' + profFlag + ' kasserere avviker · ' + reconFlag + ' avstemmingsavvik · ' + pantFlag + ' pantavvik' + (R.disc && R.disc.camp && R.disc.camp.pending ? ' · ' + R.disc.camp.pending + ' kampanjer å bekrefte' : '');
    // kassererprofil
    if (!R.profile.rows.length) ui.ctlProfile.appendChild(hintEl('Ingen salg blant synlige kvitteringer.'));
    else {
      var st = R.profile.store, chs = R.profile.channels || [], multi = chs.length > 1;
      var avgRow = function (name, m, last) { return [name, m.count, pct(m.retShare), fmt(m.avg), m.scanned ? m.lapperPer.toFixed(2) : '–', m.scanned ? m.negPer.toFixed(2) : '–'].concat(multi ? [last] : []); };
      var rows = R.profile.rows.map(function (r) {
        return [{ node: entLink('kasserer', r.id) }, r.count, { t: pct(r.retShare), bad: r.flags.retShare }, { t: fmt(r.avg), bad: r.flags.avg },
          r.scanned ? { t: r.lapperPer.toFixed(2), bad: r.flags.lapperPer } : '–', r.scanned ? { t: r.negPer.toFixed(2), bad: r.flags.negPer } : '–'].concat(multi ? [L.channelLabel(r.ch) + (r.refCh === null ? ' (mot butikk)' : '')] : []);
      });
      if (multi) chs.forEach(function (c) { rows.push(avgRow('Snitt ' + c.label.toLowerCase(), c, plur(c.cashiers, 'kasserer', 'kasserere'))); });
      rows.push(avgRow('Butikksnitt', st, ''));
      ui.ctlProfile.appendChild(tbl(['Kasserer', 'Salg', 'Returandel', 'Snitt kr', 'Manuell pant/salg', 'Korr./salg'].concat(multi ? ['Kanal'] : []), rows));
      var refTxt = multi && ctlCfg.profChannel ? 'snittet i kassererens kanal (der hen har flest salg; kanal med én kasserer: butikksnittet)' : 'butikksnittet';
      ui.ctlProfile.appendChild(hintEl('Rødt = minst ' + ctlCfg.profFactor + '× ' + refTxt + ' (snitt også under 1/' + ctlCfg.profFactor + '). Returandel = salg med negativ sum, uten rene pantereturer. Manuell pant = pantelapper med kode 99. Den og korrigeringer (negative varelinjer utenom pant, og linjer merket slettet) krever skanning. Kasserere med færre enn ' + ctlCfg.profMin + ' bonger vurderes ikke.' + (ctlCfg.profShrink ? ' Tallene krympes mot snittet (som ' + ctlCfg.profShrink + ' bonger), så få bonger gir små utslag.' : '')));
    }
    // funn
    if (!R.findings.length) ui.ctlFindings.appendChild(hintEl('Ingen funn med gjeldende terskler.'));
    R.findings.forEach(function (f) {
      var row = el('div', { class: 'kvr-li kvr-fl' + (f.flag ? '' : ' kvr-na') }, [el('div', { class: 'kvr-fl-t' }, [el('b', { text: f.kind + ': ' + f.title }), el('span', { text: f.detail })])]);
      var people = {}, desks = {};
      if (f.cashier) people[f.cashier] = true;
      f.ids.forEach(function (id) { var rr = recById(id); if (rr) { people[rr.item.cashierNumber] = true; desks[rr.item.workstationNumber] = true; } });
      var ents = el('div', { class: 'kvr-ents' });
      Object.keys(people).slice(0, 3).forEach(function (k) { ents.appendChild(entLink('kasserer', k)); });
      Object.keys(desks).slice(0, 3).forEach(function (k) { ents.appendChild(entLink('kasse', k)); });
      row.firstChild.appendChild(ents);
      row.addEventListener('click', function () { var r = f.ids.map(recById).filter(Boolean)[0]; if (r) jumpTo(r); else say('Kvitteringen er ikke i gjeldende liste.'); });
      row.appendChild(btn('Velg', function (e) {
        e.stopPropagation();
        f.ids.forEach(function (id) { var r = recById(id); if (r) selected[id] = r.item; });
        apply();
      }, 'kvr-sm'));
      ui.ctlFindings.appendChild(row);
    });
    ui.ctlFindings.appendChild(hintEl('Funn merket som avvik får rød markering og vises under «Kun avvik».'));
    // pantebalanse
    if (!R.pant.balance.length) ui.ctlPant.appendChild(hintEl('Ingen skannede salg.'));
    else {
      ui.ctlPant.appendChild(tbl(['Dag', 'Butikk', 'Pant salg', 'Pantelapper ut', 'Diff'], R.pant.balance.map(function (b) {
        return [b.day, L.storeShort(b.store), fmt(b.sale), { t: fmt(b.ret), bad: b.flag }, fmt(b.diff)];
      })));
      ui.ctlPant.appendChild(hintEl('Rødt = utbetalt panteretur er over ' + ctlCfg.pantRatio + '× pantesalget samme dag. Pantelapper kan stamme fra flasker kjøpt andre steder, så vurder over flere dager.'));
    }
    // dagsavstemming
    if (!R.recon.length) ui.ctlRecon.appendChild(hintEl('Ingen skannede salg eller kassaoppgjør.'));
    else {
      ui.ctlRecon.appendChild(tbl(['Dag', 'Kasse', 'Kontant', 'Tilbake', 'Bank/kort', 'Forventet', 'Telt', 'Diff'], R.recon.map(function (r) {
        return [r.day, { node: entLink('kasse', r.kasse, String(r.kasse)) }, fmt(r.pay['Kontant'] || 0), fmt(r.pay['Kontant tilbake'] || 0), fmt(r.pay['Bank'] || 0), fmt(r.expected),
          r.settleCount ? fmt(r.telt) : '–', r.diff === null ? 'ingen oppgjør' : { t: fmt(r.diff) + (r.complete ? '' : ' *'), bad: r.flag }];
      })));
      ui.ctlRecon.appendChild(hintEl('Forventet = kontant − kontant tilbake fra skannede salg. Telt = telt kontant i kassaoppgjør samme dag og kasse. Diff = telt − forventet. * = ikke alle salg er skannet. Oppgjør etter midnatt eller samlet over flere dager gir falske avvik. Rapport-fanens «Diff» er oppgjørets egen differanse.'));
    }
    renderAuditCards(R);
  }

  // ---- modal ------------------------------------------------------------------
  function closeModal() { var m = document.querySelector('.kvr-modal'); if (m) m.remove(); }

  function openModal(title, bodyNode, actions) {
    closeModal();
    var m = el('div', { class: 'kvr-modal' }, [el('div', { class: 'kvr-dlg', role: 'dialog' }, [
      el('div', { class: 'kvr-dlg-h' }, [el('b', { text: title }), btn('✕', closeModal, 'kvr-sm')]),
      el('div', { class: 'kvr-dlg-b' }, [bodyNode]),
      el('div', { class: 'kvr-dlg-f' }, actions || [])
    ])]);
    m.addEventListener('click', function (e) { if (e.target === m) closeModal(); });
    document.body.appendChild(m);
    return m;
  }

  function copyText(t) {
    var fallback = function () {
      var ta = el('textarea', { style: 'position:fixed;left:-999px' });
      ta.value = t; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) { /* ignorer */ }
      ta.remove();
    };
    try { navigator.clipboard.writeText(t).then(function () { say('Kopiert.'); }, fallback); } catch (e) { fallback(); }
  }

  // Ukjente linjer og hendelsesord fra skanningene. Brukes til å lære hva CW faktisk viser (annullert, parkert, manuell pris, spør pris).
  function timeText(TC) {
    if (!TC.n) return 'Ingen skannede bonger har dato og tid i topptekst (skann på nytt, eller formatet er ukjent).';
    return TC.n + ' bonger sammenlignet: ' + TC.same + ' har samme klokkeslett i listen og på bongen (±5 min). Typisk avvik (bong minus liste): ' + TC.median + ' min. Forskyvning i bruk: ' + timeShift + ' min.' +
      (TC.sample && Math.abs(TC.sample.diff) > 5 ? ' Størst avvik: bong ' + TC.sample.id + ', liste «' + TC.sample.list + '», bong «' + TC.sample.bong + '», rådata «' + TC.sample.raw + '».' : '');
  }

  function setTimeShift(min) {
    timeShift = Number(min) || 0;
    store(K.tshift, timeShift);
    if (ui.tshift) ui.tshift.value = String(timeShift);
    apply();
    markStale();
  }

  // Betalingsmåter i CW-filteret (hvis kontrollen finnes på siden). Leser bare det som allerede er lastet.
  function readCwPayMethods() {
    var out = [], $ = jq();
    try {
      var node = document.querySelector('#paymentMethods, [id*="paymentMethods"], [ng-model*="paymentMethods"], [name*="paymentMethods"]');
      if (!node) return out;
      var add = function (t) { t = String(t === undefined || t === null ? '' : t).replace(/\s+/g, ' ').trim(); if (t && out.indexOf(t) === -1 && out.length < 60) out.push(t); };
      if ($) ['kendoMultiSelect', 'kendoDropDownList', 'kendoComboBox'].forEach(function (w) {
        var ins = $(node).data(w);
        if (!ins || !ins.dataSource) return;
        var tf = (ins.options && ins.options.dataTextField) || 'text', d = ins.dataSource.data();
        for (var i = 0; i < d.length && i < 100; i++) add(d[i] && d[i].get ? d[i].get(tf) : d[i] && d[i][tf]);
      });
      if (node.options) Array.prototype.forEach.call(node.options, function (o) { add(o.text); });
    } catch (e) { /* kontrollen kan ha en annen form */ }
    return out;
  }

  function payInfo() {
    var cw = readCwPayMethods(), P = L.payStats(recs.map(function (r) { return r.item; }), scanMap, cw);
    return { P: P, head: ['Betalingsmåte', 'Bonger', 'Sum kr', 'Kasserere', 'I CW-listen'], rows: P.rows.map(function (r) { return [r.label, r.bongs, fmt(r.sum), r.cashiers, r.inCw]; }),
      cwTxt: cw.length ? 'Betalingsmåter i CW-filteret: ' + cw.join(', ') + '.' : 'Fant ikke listen over betalingsmåter i CW-filteret (kontrollen «paymentMethods» er ikke lastet eller har en annen form).' };
  }

  function channelInfo() {
    var CS = L.channelStats(recs.map(function (r) { return r.item; }));
    var rawTxt = CS.raw.n ? 'Rådata for tid: ' + CS.raw.type + ', ' + CS.raw.distinct + ' ulike verdier på ' + CS.raw.n + ' rader, eksempel «' + CS.raw.sample + '».' : 'Ingen rådata for tid i listen.';
    var head = ['Kanal', 'Bonger', 'Typer', 'Butikker', 'Kasserere', 'Kasser', 'Kassenr', 'Snitt kr', 'Medlem %', 'Returer'];
    var rows = CS.rows.map(function (c) { return [c.k, c.n, c.types, c.stores, c.cashiers, c.ws, c.wsList, c.avg, c.member, c.ret]; });
    return { CS: CS, rawTxt: rawTxt, head: head, rows: rows };
  }

  function diagText(D) {
    var CI = channelInfo();
    var out = ['Kvitteringshenter diagnostikk', 'Skannede bonger: ' + D.total + ' (ny skanning: ' + D.v4 + ')', 'Løpenummer i topptekst: ' + seqProof.ok + ' stemte, ' + seqProof.bad + ' avvek',  'Kjøpeutbytte-tabell: ' + D.ku.with + ' med, ' + D.ku.without + ' uten', 'Klokkeslett: ' + timeText(L.timeCheck(recs.map(function (r) { return r.item; }), scanMap)), '', 'Kanal (saleChannel) i listen; kolonner: ' + CI.head.join(' | ')];
    CI.rows.forEach(function (r) { out.push('  ' + r.join(' | ')); });
    var PI = payInfo();
    out.push(CI.rawTxt, '', 'Betalingsmåter; kolonner: ' + PI.head.join(' | '));
    PI.rows.forEach(function (r) { out.push('  ' + r.join(' | ')); });
    out.push(PI.cwTxt, '', 'Topptekst og bunn (versjon 7): ' + D.v7 + ' bonger, topptekst lest på ' + D.hdr + ', terminal ' + D.ft.term + ', autorisasjon ' + D.ft.auth + ', inngangsmåter: ' + (Object.keys(D.ft.modes).map(function (m) { return m + ' ' + D.ft.modes[m]; }).join(', ') || 'ingen'), 'Ukjente linjer utenfor tabellene (tall byttet med #, antall, eksempelbong):');
    if (!D.bu.length) out.push('  ingen');
    D.bu.forEach(function (u) { out.push('  ' + u.t + '\t' + u.n + '\t' + u.id); });
    out.push('', 'Hendelsesord (ord, antall, tekst, eksempelbong):');
    if (!D.ev.length) out.push('  ingen');
    D.ev.forEach(function (e) { out.push('  ' + e.k + '\t' + e.n + '\t' + e.t + '\t' + e.id); });
    out.push('', 'Ukjente linjer (tekst med tall som #, antall, eksempelbong):');
    if (!D.unk.length) out.push('  ingen');
    D.unk.forEach(function (u) { out.push('  ' + u.t + '\t' + u.n + '\t' + u.id); });
    return out.join('\n');
  }

  function openDiag() {
    var D = L.diagnostics(scanMap, L.wordList(ctlCfg.evWords));
    var body = el('div', { class: 'kvr-secbody' });
    var TC = L.timeCheck(recs.map(function (r) { return r.item; }), scanMap);
    body.appendChild(el('b', { class: 'kvr-subh', text: 'Klokkeslett: liste mot bong' }));
    body.appendChild(hintEl(timeText(TC)));
    if (TC.suggest !== null) {
      body.appendChild(hintEl('Listen ligger konsekvent ' + Math.abs(TC.suggest) + ' min ' + (TC.suggest > 0 ? 'bak' : 'foran') + ' bongen. Det tyder på tidssone eller en fast forskyvning i dataene.'));
      body.appendChild(btn('Flytt listetid ' + (TC.suggest > 0 ? '+' : '') + TC.suggest + ' min', function () { setTimeShift(timeShift + TC.suggest); closeModal(); say('Listetid flyttet ' + (TC.suggest > 0 ? '+' : '') + TC.suggest + ' min. Kjør analysen på nytt.'); }, 'kvr-primary'));
    }
    var CI = channelInfo();
    body.appendChild(el('b', { class: 'kvr-subh', text: 'Kanal (saleChannel) og rådata for tid' }));
    body.appendChild(CI.rows.length ? tbl(CI.head, CI.rows) : hintEl('Ingen rader i listen.'));
    body.appendChild(hintEl(CI.rawTxt + ' Betydningen av kanalkodene er ikke bekreftet: tabellen viser bare antall og snitt, uten kasserer- eller medlemsnumre. «Kasser» er antall ulike kasser, «Kassenr» de første nummerne.'));
    var PI = payInfo();
    body.appendChild(el('b', { class: 'kvr-subh', text: 'Betalingsmåter' }));
    body.appendChild(PI.rows.length ? tbl(PI.head, PI.rows) : hintEl('Ingen skannede bonger med betalingslinjer.'));
    body.appendChild(hintEl(PI.cwTxt + ' «I CW-listen» sammenligner etiketten på bongen (teksten før kolon) med navnene i filteret; ulik skrivemåte gir «nei».'));
    body.appendChild(el('b', { class: 'kvr-subh', text: 'Topptekst og bunn (versjon 7)' }));
    body.appendChild(hintEl(D.v7 + ' av ' + D.total + ' skannede bonger har topptekst/bunn lest. Topptekst (butikk, kasse, kasserer, medlem) på ' + D.hdr + '; terminal-ID på ' + D.ft.term + '; autorisasjonskode på ' + D.ft.auth + '. Inngangsmåter: ' + (Object.keys(D.ft.modes).map(function (m) { return m + ' ' + D.ft.modes[m]; }).join(', ') || 'ingen funnet') + '.'));
    body.appendChild(D.bu.length ? tbl(['Linje utenfor tabell', 'Antall', 'Eksempelbong'], D.bu.slice(0, 30).map(function (u) { return [u.t, u.n, u.id]; })) : hintEl('Ingen ukjente linjer utenfor tabellene.'));
    body.appendChild(hintEl('Løpenummer i topptekst mot valgt rad: ' + seqProof.ok + ' stemte, ' + seqProof.bad + ' avvek' + (seqProof.ok >= 3 ? ' (kontrollen er aktiv: bonger med feil nummer avvises)' : ' (kontrollen aktiveres etter 3 treff)') + '.'));
    body.appendChild(hintEl(D.v4 ? D.v4 + ' av ' + D.total + ' skannede bonger har ny skanningsdata (eldre må skannes på nytt). Dette er linjer pluginen ikke kjenner igjen, og ord som tyder på annullert, parkert, manuell pris eller spør pris. Del listen for å få testene utvidet.' : 'Ingen skanninger med ny data ennå. Skann kvitteringer først (Skann → Skann innhold).'));
    if (D.v4) {
      body.appendChild(el('b', { class: 'kvr-subh', text: 'Hendelsesord' }));
      body.appendChild(D.ev.length ? tbl(['Ord', 'Antall', 'Linje', 'Eksempelbong'], D.ev.slice(0, 30).map(function (e) { return [e.k, e.n, e.t, e.id]; })) : hintEl('Ingen funnet.'));
      body.appendChild(el('b', { class: 'kvr-subh', text: 'Ukjente linjer' }));
      body.appendChild(D.unk.length ? tbl(['Linje', 'Antall', 'Eksempelbong'], D.unk.slice(0, 40).map(function (u) { return [u.t, u.n, u.id]; })) : hintEl('Ingen funnet.'));
      body.appendChild(hintEl('Tall er byttet med #. Listen inneholder ingen varenavn eller beløp, men bongnummer. Kjøpeutbytte-tabell: ' + D.ku.with + ' med, ' + D.ku.without + ' uten.'));
    }
    openModal('Diagnostikk', body, [btn('Kopier som tekst', function () { copyText(diagText(D)); }), btn('Lukk', closeModal, 'kvr-primary')]);
  }

  // ---- notater og oppfølging ----------------------------------------------------
  // Notatlogg: hver endring av notat eller status legges til som en hendelse i en kjede (append-only).
  var NLOG_MAX = 20000, nlog = null, notesShadow = {};

  function noteState(n) { return n ? { s: n.status || '', n: String(n.note || '').slice(0, 2000), b: String(n.bong || '') } : null; }

  function loadNoteLog() {
    var v = store(K.nlog);
    nlog = v && Array.isArray(v.list) ? v : { base: '', list: [] };
    notesShadow = {};
    Object.keys(notes).forEach(function (id) { notesShadow[id] = noteState(notes[id]); });
    if (!nlog.list.length) {
      Object.keys(notes).forEach(function (id) { var st = notesShadow[id]; KvReport.logAppend(nlog, { t: Date.now(), id: id, bong: st.b, op: 'start', s: st.s, n: st.n }); });
      if (nlog.list.length) store(K.nlog, nlog);
    }
  }

  function logNoteChanges() {
    if (!nlog) loadNoteLog();
    var ids = {}, changed = false;
    Object.keys(notes).concat(Object.keys(notesShadow)).forEach(function (id) { ids[id] = true; });
    Object.keys(ids).forEach(function (id) {
      var now = noteState(notes[id]), was = notesShadow[id] || null;
      if (!now && !was) return;
      if (now && was && now.s === was.s && now.n === was.n) return;
      var e = { t: Date.now(), id: id, bong: (now || was).b, op: !was ? 'ny' : !now ? 'slettet' : 'endret' };
      if (now) { e.s = now.s; e.n = now.n; }
      if (was) { e.ps = was.s; e.pn = was.n; }
      KvReport.logAppend(nlog, e);
      changed = true;
      if (now) notesShadow[id] = now; else delete notesShadow[id];
    });
    if (changed) { KvReport.logTrim(nlog, NLOG_MAX); store(K.nlog, nlog); }
  }

  function saveNotes() { logNoteChanges(); store(K.notes, notes); }

  function exportNoteLog() {
    if (!nlog) loadNoteLog();
    download(new Blob([KvReport.stable({ base: nlog.base || '', list: nlog.list }) + '\n'], { type: 'application/json' }), 'notatlogg.json');
  }

  function openNoteLog() {
    if (!nlog) loadNoteLog();
    var v = KvReport.logVerify(nlog), body = el('div', { class: 'kvr-secbody' });
    body.appendChild(hintEl(v.n + ' hendelser. ' + (v.ok ? 'Kjeden er ubrutt' + (v.n ? '; hodekontrollsum ' + v.head.slice(0, 16) + '…' : '') + '.' : 'KJEDEN ER BRUTT ved hendelse ' + (v.at + 1) + ': noe er endret eller fjernet i lagringen.') +
      ' Hver endring av et notat eller en status lagres som en ny hendelse, og de gamle blir stående. Loggen avslører utilsiktet endring, men er ikke bevis mot den som har full tilgang til nettleseren. Noter kontrollsummen i saken, eller lag en revisjonsrapport.'));
    if (v.n) body.appendChild(tbl(['Tid', 'Bong', 'Handling', 'Status', 'Notat'], nlog.list.slice(-40).reverse().map(function (e) {
      return [new Date(e.t).toLocaleString('nb-NO'), e.bong || e.id, e.op, e.s !== undefined ? e.s : (e.ps || ''), String(e.n !== undefined ? e.n : (e.pn || '')).slice(0, 80)];
    })));
    openModal('Notatlogg', body, [btn('Eksporter logg (JSON)', exportNoteLog), btn('Lukk', closeModal, 'kvr-primary')]);
  }

  function openNote(rec) {
    if (!rec) return;
    var it = rec.item, id = it.transactionId, cur = notes[id] || { status: '', note: '' };
    var st = el('select', {}, [opt('', 'Ingen status'), opt('oppfolging', 'Til oppfølging'), opt('sjekket', 'Sjekket')]);
    st.value = cur.status || '';
    var ta = el('textarea', { rows: '4', placeholder: 'Notat…' });
    ta.value = cur.note || '';
    var body = el('div', { class: 'kvr-secbody' }, [
      hintEl(it.endDateTime + ' · kasse ' + it.workstationNumber + ' · kasserer ' + it.cashierNumber + ' · bong ' + it.bongnr + ' · ' + (it.totalAmount === null ? '–' : fmt(it.totalAmount)) + ' kr'),
      field('Status', st), field('Notat', ta)
    ]);
    openModal('Notat og status', body, [
      btn('Slett', function () { delete notes[id]; saveNotes(); closeModal(); apply(); renderNotes(); }),
      btn('Lagre', function () {
        var note = ta.value.trim();
        if (!st.value && !note) delete notes[id];
        else notes[id] = { status: st.value, note: note, t: Date.now(), tid: it.endDateTime, kasse: it.workstationNumber, kasserer: it.cashierNumber, bong: it.bongnr, sum: it.totalAmount };
        saveNotes(); closeModal(); apply(); renderNotes();
      }, 'kvr-primary')
    ]);
    ta.focus();
  }

  function renderNotes() {
    if (!ui.noteList) return;
    ui.noteList.innerHTML = '';
    var list = Object.keys(notes).map(function (id) { return { id: id, n: notes[id] }; });
    list.sort(function (a, b) { return (a.n.status === 'oppfolging' ? 0 : 1) - (b.n.status === 'oppfolging' ? 0 : 1) || (b.n.t || 0) - (a.n.t || 0); });
    ui.noteCount.textContent = list.length + ' notater · ' + list.filter(function (x) { return x.n.status === 'oppfolging'; }).length + ' til oppfølging';
    if (!list.length) { ui.noteList.appendChild(hintEl('Ingen notater ennå. Velg en bong i listen og trykk N, eller bruk «Notat» under.')); return; }
    list.slice(0, 60).forEach(function (x) {
      var n = x.n;
      var row = el('div', { class: 'kvr-li ' + (n.status === 'sjekket' ? 'kvr-ok' : n.status === 'oppfolging' ? '' : 'kvr-na') }, [
        el('b', { text: (n.tid || '') + ' · kasse ' + (n.kasse === undefined ? '–' : n.kasse) + ' · ' + (typeof n.sum === 'number' ? fmt(n.sum) : '–') + ' kr' }),
        el('span', { text: (n.status === 'oppfolging' ? 'Til oppfølging' : n.status === 'sjekket' ? 'Sjekket' : 'Notat') + (n.note ? ': ' + n.note : '') })
      ]);
      row.addEventListener('click', function () { var r = recById(x.id); if (r) jumpTo(r); else say('Kvitteringen er ikke i gjeldende liste. Bongnr: ' + (n.bong || x.id)); });
      ui.noteList.appendChild(row);
    });
  }

  function exportNotes() {
    var rows = [['Tid', 'Kasse', 'Kasserer', 'Bongnr', 'Sum', 'Status', 'Notat']];
    Object.keys(notes).forEach(function (id) {
      var n = notes[id];
      rows.push([n.tid, n.kasse, n.kasserer, n.bong || id, typeof n.sum === 'number' ? String(n.sum).replace('.', ',') : '', n.status === 'oppfolging' ? 'Til oppfølging' : n.status === 'sjekket' ? 'Sjekket' : '', n.note]);
    });
    download(new Blob([L.toCsv(rows)], { type: 'text/csv;charset=utf-8' }), 'notater.csv');
    say('Eksporterte ' + (rows.length - 1) + ' notater.');
  }

  function currentRec() {
    var sel = grid && grid.select();
    var tr = sel && sel[0];
    for (var i = 0; i < recs.length; i++) if (recs[i].tr === tr) return recs[i];
    return null;
  }

  function stepRow(d) {
    var rows = Array.prototype.slice.call(grid.tbody[0].children).filter(function (tr) { return tr.tagName === 'TR' && tr.style.display !== 'none'; });
    if (!rows.length) return;
    var cur = currentRec();
    var i = cur ? rows.indexOf(cur.tr) : -1;
    var next = rows[Math.min(rows.length - 1, Math.max(0, i + d))];
    grid.select(next);
    next.scrollIntoView({ block: 'nearest' });
  }

  function installKeys() {
    document.addEventListener('keydown', function (e) {
      if (!keyNav || !grid || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      if (e.key === 'Escape') { if (document.querySelector('.kvr-modal')) { closeModal(); e.preventDefault(); } return; }
      if (document.querySelector('.kvr-modal')) return;
      var t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName) || t.isContentEditable)) return;
      if (t && t !== document.body && !(grid.element && grid.element[0] && grid.element[0].contains(t))) return;
      var k = e.key;
      if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); stepRow(k === 'ArrowDown' ? 1 : -1); }
      else if (k === 'n' || k === 'N') { var r = currentRec(); if (r) { e.preventDefault(); openNote(r); } }
      else if (k === 'm' || k === 'M') {
        var c = currentRec();
        if (c) {
          e.preventDefault();
          var id = c.item.transactionId;
          if (selected[id]) delete selected[id]; else selected[id] = c.item;
          apply();
        }
      }
    }, true);
  }

  // ---- sammenlign to bonger ------------------------------------------------------
  async function compareSelected() {
    var list = selectedRecs();
    if (list.length !== 2) { say('Velg nøyaktig to kvitteringer for å sammenligne.'); return; }
    var need = list.filter(function (r) { return !scanMap[r.item.transactionId]; });
    if (need.length) { await scanList(need); apply(); }
    var sc = list.map(function (r) { return scanMap[r.item.transactionId]; });
    if (!sc[0] || !sc[1]) { say('Kunne ikke lese begge kvitteringene.'); return; }
    var key = function (i) { return i.c + '|' + i.a; };
    var count = function (items) { var m = {}; items.forEach(function (i) { m[key(i)] = (m[key(i)] || 0) + 1; }); return m; };
    var cnt = [count(sc[0].items), count(sc[1].items)];
    var only = [0, 0], same = 0;
    var cols = [0, 1].map(function (side) {
      var seen = {};
      var rowsEl = sc[side].items.map(function (i) {
        var k = key(i);
        seen[k] = (seen[k] || 0) + 1;
        var shared = seen[k] <= (cnt[1 - side][k] || 0);
        if (shared) { if (side === 0) same++; } else only[side]++;
        return el('div', { class: 'kvr-cmprow' + (shared ? '' : ' kvr-only') }, [
          el('span', { text: i.n + (i.q ? ' (' + i.q + ' stk)' : '') }), el('b', { text: fmt(i.a) })
        ]);
      });
      var it = list[side].item;
      var pay = Object.keys(sc[side].pay).map(function (l) { return l + ' ' + fmt(sc[side].pay[l]); }).join(' · ');
      return el('div', { class: 'kvr-cmpcol' }, [
        el('div', { class: 'kvr-cmphead' }, [el('b', { text: it.endDateTime }), el('span', { text: 'Kasse ' + it.workstationNumber + ' · Kasserer ' + it.cashierNumber + ' · Bong ' + it.bongnr }),
          el('span', { text: 'Sum ' + (it.totalAmount === null ? '–' : fmt(it.totalAmount)) + ' kr' })])
      ].concat(rowsEl, [el('div', { class: 'kvr-hint', text: pay })]));
    });
    var body = el('div', {}, [el('div', { class: 'kvr-hint', text: same + ' like linjer · ' + only[0] + ' bare i venstre · ' + only[1] + ' bare i høyre. Markerte linjer finnes ikke på den andre bongen.' }), el('div', { class: 'kvr-cmp' }, cols)]);
    openModal('Sammenlign bonger', body, [btn('Lukk', closeModal, 'kvr-primary')]);
  }

  // ---- sammendrag (morgenkontroll) ---------------------------------------------------
  function summarySections() {
    var items = analysisItems(lastMode);
    var sales = items.filter(function (i) { return i.receiptType === 1 && typeof i.totalAmount === 'number'; });
    var rets = sales.filter(function (i) { return i.totalAmount < 0; });
    var sum = function (a) { return a.reduce(function (x, i) { return x + i.totalAmount; }, 0); };
    var days = items.map(function (i) { return L.parseDT(i.endDateTime).date; }).filter(Boolean).sort();
    var secs = [];
    secs.push({ h: 'Oversikt', li: [
      'Periode: ' + (days.length ? days[0] + (days[days.length - 1] !== days[0] ? ' – ' + days[days.length - 1] : '') : '–'),
      'Salg: ' + sales.length + ' bonger, ' + fmt(sum(sales)) + ' kr',
      'Returer (negativ sum): ' + rets.length + ' bonger, ' + fmt(sum(rets)) + ' kr',
      'Kassaoppgjør: ' + items.filter(function (i) { return i.receiptType === 2; }).length
    ] });
    var flagged = items.filter(function (i) { return anomMap[i.transactionId]; });
    var reasons = {};
    flagged.forEach(function (i) { anomMap[i.transactionId].forEach(function (r) { var b = r.replace(/\s*\(.*$/, ''); reasons[b] = (reasons[b] || 0) + 1; }); });
    var rk = Object.keys(reasons).sort(function (a, b) { return reasons[b] - reasons[a]; }).slice(0, 10);
    secs.push({ h: 'Avvik (' + flagged.length + ' bonger)', li: rk.length ? rk.map(function (r) { return r + ': ' + reasons[r]; }) : ['Ingen avvik flagget (kjør kontroller først).'] });
    if (ctlRes) {
      var fc = {};
      ctlRes.findings.forEach(function (f) { fc[f.title] = (fc[f.title] || 0) + 1; });
      secs.push({ h: 'Funn på tvers av bonger', li: Object.keys(fc).length ? Object.keys(fc).map(function (t) { return t + ': ' + fc[t]; }) : ['Ingen funn.'] });
      var pf = ctlRes.profile.rows.filter(function (r) { return r.flagged; });
      secs.push({ h: 'Kassererprofil', li: pf.length ? pf.map(function (r) {
        return 'Kasserer ' + r.id + ': ' + Object.keys(r.flags).filter(function (k) { return r.flags[k]; }).map(function (k) { return { retShare: 'returandel ' + pct(r.retShare), avg: 'snitt ' + fmt(r.avg), lapperPer: 'manuelle pantelapper/salg ' + r.lapperPer.toFixed(2), negPer: 'korrigeringer/salg ' + r.negPer.toFixed(2) }[k]; }).join(', ');
      }) : ['Ingen avvik fra butikksnittet.'] });
      var rc = ctlRes.recon.filter(function (r) { return r.flag; });
      secs.push({ h: 'Dagsavstemming', li: rc.length ? rc.map(function (r) { return r.day + ' kasse ' + r.kasse + ': diff ' + fmt(r.diff) + ' kr'; }) : ['Ingen avvik.'] });
      var pb = ctlRes.pant.balance.filter(function (b) { return b.flag; });
      secs.push({ h: 'Pantebalanse', li: pb.length ? pb.map(function (b) { return b.day + ' butikk ' + L.storeShort(b.store) + ': salg ' + fmt(b.sale) + ', utbetalt ' + fmt(b.ret); }) : ['Ingen avvik.'] });
    }
    var open = Object.keys(notes).filter(function (id) { return notes[id].status === 'oppfolging'; }).length;
    secs.push({ h: 'Oppfølging', li: [open + ' bonger er merket «til oppfølging».'] });
    return secs;
  }

  function showSummary() {
    var secs = summarySections();
    var body = el('div', { class: 'kvr-sum' });
    secs.forEach(function (s) {
      body.appendChild(el('h5', { text: s.h }));
      body.appendChild(el('ul', {}, s.li.map(function (t) { return el('li', { text: t }); })));
    });
    var text = 'Morgenkontroll ' + new Date().toLocaleDateString('nb-NO') + '\n\n' + secs.map(function (s) { return s.h + '\n' + s.li.map(function (t) { return '- ' + t; }).join('\n'); }).join('\n\n');
    openModal('Sammendrag', body, [btn('Kopier som tekst', function () { copyText(text); }), btn('Lukk', closeModal, 'kvr-primary')]);
  }

  // ---- arbeidsoppgaver ----------------------------------------------------------------
  function allTasks() { return BUILTIN_TASKS.concat(tasksCustom); }

  function renderTasks() {
    if (!ui.taskSel) return;
    var cur = ui.taskSel.value;
    ui.taskSel.innerHTML = '';
    allTasks().forEach(function (t) { ui.taskSel.appendChild(opt(t.id, t.name)); });
    if (cur) ui.taskSel.value = cur;
  }

  async function runTask() {
    var t = allTasks().filter(function (x) { return x.id === ui.taskSel.value; })[0];
    if (!t || scanning) return;
    if (t.cwRel && t.cwRel !== 'none') {
      var r = L.relativeRange(t.cwRel);
      cw.dateFrom = r.dateFrom; cw.dateTo = r.dateTo;
      ui.cwFrom.value = r.dateFrom; ui.cwTo.value = r.dateTo;
      var before = boundCount;
      say('Henter ' + REL_LABEL[t.cwRel].toLowerCase() + ' fra CW…');
      cwSearch();
      await waitFor(function () { return boundCount > before; }, 20000);
      await wait(300);
    }
    filters = t.filters ? L.sanitizeFilters(t.filters) : L.defaultFilters();
    scope = defaultScope();
    if (t.cwRel && t.cwRel !== 'none') { var rr = L.relativeRange(t.cwRel); scope.dateFrom = rr.dateFrom; scope.dateTo = rr.dateTo; }
    scope.useFilters = !!t.filters;
    store(K.scope, scope);
    writeScope();
    writeForm(); apply();
    if (t.checks) await runAnalysis(); else if (t.scan) await scanVisible();
    ui.go(t.tab || 'check');
    if (t.summary) showSummary();
  }

  function saveTask() {
    var name = ui.taskName.value.trim();
    if (!name) { ui.taskName.focus(); return; }
    readForm();
    var t = { id: 't' + Date.now(), name: name, cwRel: ui.taskRel.value, filters: JSON.parse(JSON.stringify(filters)), scan: ui.taskScan.checked, checks: ui.taskChecks.checked, summary: ui.taskSummary.checked, tab: ui.taskChecks.checked ? 'check' : 'content' };
    tasksCustom = tasksCustom.filter(function (x) { return x.name !== name; }).concat([t]);
    store(K.tasks, tasksCustom);
    renderTasks();
    ui.taskSel.value = t.id;
    ui.taskName.value = '';
    say('Oppgaven «' + name + '» er lagret.');
  }

  function deleteTask() {
    var t = tasksCustom.filter(function (x) { return x.id === ui.taskSel.value; })[0];
    if (!t) { say('Innebygde oppgaver kan ikke slettes.'); return; }
    confirmBox('Slett oppgave', 'Slette oppgaven «' + t.name + '»?', 'Slett', function () {
      tasksCustom = tasksCustom.filter(function (x) { return x !== t; });
      store(K.tasks, tasksCustom);
      renderTasks();
    });
  }


  // ---- fokus: alt om én kasserer eller kasse ---------------------------------------
  function focusInfo() {
    if (filters.cashiers.length === 1) return { kind: 'kasserer', id: filters.cashiers[0] };
    if (filters.workstations.length === 1) return { kind: 'kasse', id: filters.workstations[0] };
    return null;
  }

  function setFocus(kind, id) {
    filters.cashiers = kind === 'kasserer' ? [String(id)] : [];
    filters.workstations = kind === 'kasse' ? [String(id)] : [];
    writeForm();
    apply();
    ui.go('focus');
  }

  function entLink(kind, id, text) {
    var b = el('button', { type: 'button', class: 'kvr-ent', title: 'Se alt om ' + (kind === 'kasserer' ? 'kasserer ' : 'kasse ') + id, text: text || ((kind === 'kasserer' ? 'Kasserer ' : 'Kasse ') + id) });
    b.addEventListener('click', function (e) { e.stopPropagation(); setFocus(kind, String(id)); });
    return b;
  }

  function entsFor(item) {
    return el('div', { class: 'kvr-ents' }, [entLink('kasserer', item.cashierNumber), entLink('kasse', item.workstationNumber)]);
  }

  function colIndexes() {
    var hdr = document.querySelector('.k-grid-header table');
    var out = {};
    if (!hdr) return out;
    Array.prototype.forEach.call(hdr.querySelectorAll('thead th'), function (th, i) {
      var t = th.textContent.trim().toUpperCase();
      if (t === 'KASSERER') out.kasserer = i;
      if (t === 'KASSE') out.kasse = i;
    });
    return out;
  }

  function installGridClicks() {
    var host = (grid.element && grid.element[0]) || grid.tbody[0].closest('table');
    host.addEventListener('click', function (e) {
      if (!e.altKey) return;
      var td = e.target.closest && e.target.closest('td');
      if (!td) return;
      var rec = recs.filter(function (r) { return r.tr === td.parentNode; })[0];
      if (!rec) return;
      var f = td.getAttribute('data-field');
      var idx = Array.prototype.indexOf.call(td.parentNode.children, td);
      var ci = colIndexes();
      var kind = f === 'cashierNumber' || idx === ci.kasserer ? 'kasserer' : f === 'workstationNumber' || idx === ci.kasse ? 'kasse' : null;
      if (!kind) return;
      e.preventDefault();
      e.stopPropagation();
      setFocus(kind, String(kind === 'kasserer' ? rec.item.cashierNumber : rec.item.workstationNumber));
    }, true);
  }

  function hoursChart(hours) {
    var max = Math.max.apply(null, hours.concat([1]));
    var box = el('div', { class: 'kvr-hours' });
    hours.forEach(function (n, h) {
      box.appendChild(el('div', { class: 'kvr-hcol', title: (h < 10 ? '0' : '') + h + ':00 – ' + n + ' kvitteringer' }, [
        el('div', { class: 'kvr-hbar', style: 'height:' + Math.round(n / max * 100) + '%' }),
        el('span', { text: h % 3 === 0 ? String(h) : '' })
      ]));
    });
    return box;
  }

  function kvRows(pairs) {
    var t = el('table', { class: 'kvr-table kvr-small' });
    pairs.forEach(function (p) { t.appendChild(el('tr', {}, [cell('td', p[0]), cell('td', p[1])])); });
    return el('div', { class: 'kvr-tablewrap' }, [t]);
  }

  function renderFocus() {
    if (!ui.focusBody) return;
    var F = focusInfo();
    ui.focusBody.innerHTML = '';
    if (!F) {
      ui.focusBody.appendChild(el('div', { class: 'kvr-card' }, [el('h4', { text: 'Fokus' }),
        hintEl('Klikk på en kasserer eller kasse for å se alt som gjelder den: nøkkeltall, avvik, pant, varegrupper, betaling og aktivitet.'),
        hintEl('Velg under, eller bruk lenkene i rapporter og lister, pillene under «Filtrer», eller Alt+klikk på KASSERER eller KASSE i selve listen.')]));
      var uniq = function (f) { var o = {}; recs.forEach(function (r) { o[String(f(r.item))] = true; }); return Object.keys(o).sort(function (a, b) { return a.localeCompare(b, 'nb', { numeric: true }); }); };
      var picks = function (kind, label, list) {
        if (!list.length) return null;
        var box = el('div', { class: 'kvr-ents' }, list.slice(0, 40).map(function (id) { return entLink(kind, id); }));
        return el('div', { class: 'kvr-card' }, [el('h4', { text: label }), box]);
      };
      [picks('kasserer', 'Kasserere i listen', uniq(function (i) { return i.cashierNumber; })), picks('kasse', 'Kasser i listen', uniq(function (i) { return i.workstationNumber; }))].forEach(function (c) { if (c) ui.focusBody.appendChild(c); });
      return;
    }
    var isK = F.kind === 'kasserer';
    var title = (isK ? 'Kasserer ' : 'Kasse ') + F.id;
    var mine = recs.filter(function (r) { return String(isK ? r.item.cashierNumber : r.item.workstationNumber) === F.id; });
    var ids = {};
    mine.forEach(function (r) { ids[r.item.transactionId] = true; });
    var items = mine.map(function (r) { return r.item; });
    var st = L.focusStats(items, scanMap);
    var add = function (card) { ui.focusBody.appendChild(card); };

    // topp
    var tiles = el('div', { class: 'kvr-ftiles' });
    [['Kvitteringer', st.all], ['Salg', st.sales], ['Sum kr', fmt(st.sum)], ['Snitt kr', fmt(st.avg)], ['Returer', st.rets + ' · ' + fmt(st.retSum)], ['Tidsrom', !st.first ? '–' : st.first.slice(0, 10) === st.last.slice(0, 10) ? st.first.slice(11) + '–' + st.last.slice(11) : st.first.slice(5, 10) + '–' + st.last.slice(5, 10)]].forEach(function (x) {
      tiles.appendChild(el('div', { class: 'kvr-tile' }, [el('b', { text: String(x[1]) }), el('span', { text: x[0] })]));
    });
    var head = [tiles, el('div', { class: 'kvr-row' }, [
      btn('Velg alle (' + st.all + ')', function () { mine.forEach(function (r) { selected[r.item.transactionId] = r.item; }); apply(); }),
      btn('CSV', function () { exportCsv(false, mine); }),
      btn('Fjern fokus', function () { filters.cashiers = []; filters.workstations = []; writeForm(); apply(); })
    ])];
    if (st.scanned < st.scannable) {
      head.push(el('div', { class: 'kvr-scanwarn' }, [el('span', { text: (st.scannable - st.scanned) + ' av ' + st.scannable + ' er ikke skannet. Pant, varegrupper, betaling og avvik er ufullstendige.' }), btn('Skann nå', scanVisible, 'kvr-sm')]));
    }
    add(section('f-top', title, head));

    // brukt sammen med
    var links = el('div', { class: 'kvr-ents' });
    var other = isK ? st.kasse : st.kasserer;
    Object.keys(other).sort(function (a, b) { return other[b] - other[a]; }).forEach(function (k) {
      links.appendChild(entLink(isK ? 'kasse' : 'kasserer', k, (isK ? 'Kasse ' : 'Kasserer ') + k + ' (' + other[k] + ')'));
    });
    add(section('f-with', isK ? 'Brukte kasser' : 'Kasserere på kassen', [links]));

    // mot butikksnitt (kasserer)
    if (isK) {
      var prof = L.profiles(recs.map(function (r) { return r.item; }), scanMap, ctlCfg);
      var mineP = prof.rows.filter(function (r) { return r.id === F.id; })[0];
      if (mineP) {
        var sa = prof.store;
        add(section('f-prof', 'Mot butikksnitt', [tbl(['', 'Salg', 'Returandel', 'Snitt kr', 'Manuell pant/salg', 'Korr./salg'], [
          ['Denne kassereren', mineP.count, { t: pct(mineP.retShare), bad: mineP.flags.retShare }, { t: fmt(mineP.avg), bad: mineP.flags.avg }, mineP.scanned ? { t: mineP.lapperPer.toFixed(2), bad: mineP.flags.lapperPer } : '–', mineP.scanned ? { t: mineP.negPer.toFixed(2), bad: mineP.flags.negPer } : '–'],
          ['Butikksnitt', sa.count, pct(sa.retShare), fmt(sa.avg), sa.scanned ? sa.lapperPer.toFixed(2) : '–', sa.scanned ? sa.negPer.toFixed(2) : '–']
        ])]));
      }
    }

    // pant og betaling
    var payRows = Object.keys(st.pay).map(function (k) { return [k, fmt(st.pay[k])]; });
    add(section('f-pay', 'Pant og betaling', [
      kvRows([['Pantesalg', fmt(st.pantSale) + ' kr'], ['Panteretur', fmt(st.pantRet) + ' kr'], ['Pantelapper', String(st.lapper)], ['Korrigeringer (negative varelinjer)', String(st.neg)]].concat(payRows)),
      hintEl(st.scanned ? 'Basert på ' + st.scanned + ' skannede kvitteringer.' : 'Skann for å se pant og betaling.')
    ]));
    add(section('f-disc', 'Rabatter og kuponger', [
      st.discScanned ? kvRows([['Rabatt (kr)', fmt(st.disc)], ['Rabattlinjer', String(st.discN)], ['Uten årsak', String(st.discNR)], ['Kuponger/kampanjer', String(st.cpn)]]) : hintEl('Skann (på nytt) for å se rabatter og kuponger.'),
      hintEl(st.discScanned ? 'Basert på ' + st.discScanned + ' skannede salg med rabattdata.' : '')
    ]));

    // varegrupper
    var gs = L.groupSums(Object.keys(ids), scanMap, rules);
    add(section('f-groups', 'Varegrupper', [gs.length ? tbl(['Varegruppe', 'Linjer', 'Sum kr'], gs.map(function (g) { return [g.group, g.lines, fmt(g.sum)]; })) : hintEl('Skann for å se varegrupper.')]));

    // avvik og funn
    var flagged = mine.filter(function (r) { return anomMap[r.item.transactionId]; });
    var fl = [];
    flagged.slice(0, 30).forEach(function (r) {
      var row = el('div', { class: 'kvr-li' }, [el('b', { text: r.item.endDateTime + ' · kasse ' + r.item.workstationNumber + ' · ' + (r.item.totalAmount === null ? L.typeLabel(r.item.receiptType) : fmt(r.item.totalAmount)) }), el('span', { text: anomMap[r.item.transactionId].join(' · ') })]);
      row.addEventListener('click', function () { jumpTo(r); });
      fl.push(row);
    });
    var findings = (ctlRes ? ctlRes.findings : []).filter(function (f) { return f.ids.some(function (id) { return ids[id]; }); });
    findings.forEach(function (f) { fl.push(el('div', { class: 'kvr-li kvr-na' }, [el('b', { text: f.kind + ': ' + f.title }), el('span', { text: f.detail })])); });
    if (!fl.length) fl.push(hintEl(Object.keys(anomMap).length || ctlRes ? 'Ingen avvik eller funn for ' + title.toLowerCase() + '.' : 'Kjør avviksjekk eller kontroller (Analyse) for å se avvik.'));
    add(section('f-anom', 'Avvik og funn (' + (flagged.length + findings.length) + ')', [el('div', { class: 'kvr-list' }, fl)]));

    // kassaoppgjør
    var settles = mine.filter(function (r) { return r.item.receiptType === 2; });
    if (settles.length) {
      add(section('f-settle', 'Kassaoppgjør', [el('div', { class: 'kvr-list' }, settles.map(function (r) {
        var sc = scanMap[r.item.transactionId], sv = sc && sc.settle;
        var d = sv ? sv.diff.sum || 0 : 0;
        var row = el('div', { class: 'kvr-li ' + (!sv ? 'kvr-na' : d !== 0 ? '' : 'kvr-ok') }, [el('b', { text: r.item.endDateTime + ' · kasse ' + r.item.workstationNumber }), el('span', { text: sv ? 'Telt ' + fmt(sv.telt.sum || 0) + ' · Differanse ' + (d > 0 ? '+' : '') + fmt(d) : 'Ikke skannet' })]);
        row.addEventListener('click', function () { jumpTo(r); });
        return row;
      }))]));
    }

    // notater
    var nts = Object.keys(notes).filter(function (id) { return ids[id]; });
    if (nts.length) {
      add(section('f-notes', 'Notater (' + nts.length + ')', [el('div', { class: 'kvr-list' }, nts.map(function (id) {
        var n = notes[id], r = recById(id);
        var row = el('div', { class: 'kvr-li ' + (n.status === 'sjekket' ? 'kvr-ok' : n.status === 'oppfolging' ? '' : 'kvr-na') }, [el('b', { text: (n.tid || '') + (typeof n.sum === 'number' ? ' · ' + fmt(n.sum) + ' kr' : '') }), el('span', { text: (n.status === 'oppfolging' ? 'Til oppfølging' : n.status === 'sjekket' ? 'Sjekket' : 'Notat') + (n.note ? ': ' + n.note : '') })]);
        row.addEventListener('click', function () { if (r) jumpTo(r); });
        return row;
      }))]));
    }

    // aktivitet
    add(section('f-hours', 'Aktivitet per time', [hoursChart(st.hours), hintEl('Antall kvitteringer per klokketime.')]));
  }


  // ---- Sjekk først: prioritert liste med forklaring og handlinger -----------------------
  function makeCtx() {
    return { dupIds: ui.dup ? ui.dup.ids : {}, scan: scanMap, groupsOf: groupsOf, anom: anomMap, notes: notes, specialWords: ctlCfg.specialWords };
  }

  function setStatus(rec, status) {
    var it = rec.item, id = it.transactionId, cur = notes[id] || { note: '' };
    if (!status && !cur.note) delete notes[id];
    else notes[id] = { status: status, note: cur.note || '', t: Date.now(), tid: it.endDateTime, kasse: it.workstationNumber, kasserer: it.cashierNumber, bong: it.bongnr, sum: it.totalAmount };
    saveNotes();
    apply();
    renderNotes();
  }

  async function runAnalysis() {
    if (scanning || !grid) return;
    var prev = store(K.lastrun);
    if (scopeCoverage().missing) await fetchScopeData();
    await runChecks('scope');
    var ids = analysisItems('scope').filter(function (i) { return anomMap[i.transactionId]; }).map(function (i) { return i.transactionId; });
    var prevSet = {};
    if (prev && prev.ids) prev.ids.forEach(function (id) { prevSet[id] = true; });
    checkState.newIds = {};
    if (prev) ids.forEach(function (id) { if (!prevSet[id]) checkState.newIds[id] = true; });
    checkState.at = Date.now();
    checkState.shown = 15;
    store(K.lastrun, { at: checkState.at, ids: ids });
    renderCheck();
    ui.go('check');
  }

  function levelClass(score) { return { 'høy': 'kvr-hi', middels: 'kvr-mid', lav: 'kvr-lo' }[L.riskLevel(score)]; }

  function riskBadge(score) {
    var lvl = L.riskLevel(score);
    return el('span', { class: 'kvr-risk ' + levelClass(score), title: 'Risikoscore ' + score + ' poeng = RRS ' + L.rrs(score) + ' av 100', text: lvl.charAt(0).toUpperCase() + lvl.slice(1) + ' ' + score + ' (RRS ' + L.rrs(score) + ')' });
  }

  // Bongen vist som en kvittering: topptekst, varelinjer med antall og rabatt, Totalt, betaling og bunn.
  // Slettede linjer (linje og motlinje) er overstreket, og det testene reagerer på er markert.
  function receiptView(it, sc) {
    var box = el('div', { class: 'kvr-rcpt', role: 'group', 'aria-label': 'Kvittering' });
    var tag = function (t) { return el('span', { class: 'kvr-rc-tag', text: t }); };
    var row = function (l, r, cls, tags, title) {
      var left = el('span', { class: 'kvr-rc-l', text: l, title: title || l });
      var n = el('div', { class: 'kvr-rc-row' + (cls ? ' ' + cls : '') }, [el('span', { class: 'kvr-rc-lw' }, [left].concat(tags || [])), el('span', { class: 'kvr-rc-r', text: r === null || r === undefined ? '' : r })]);
      box.appendChild(n);
      return n;
    };
    var sub = function (t, r, cls) { row('  ' + t, r, 'kvr-rc-sub' + (cls ? ' ' + cls : '')); };
    var sep = function () { box.appendChild(el('div', { class: 'kvr-rc-sep' })); };
    box.appendChild(el('div', { class: 'kvr-rc-store', text: sLabel(it.storeNumber) }));
    box.appendChild(el('div', { class: 'kvr-rc-meta', text: 'Kasse ' + it.workstationNumber + ' · Kasserer ' + it.cashierNumber }));
    box.appendChild(el('div', { class: 'kvr-rc-meta', text: 'Bong ' + (it.bongnr || it.transactionId) + ' · ' + it.endDateTime }));
    if (L.memberKey(it)) box.appendChild(el('div', { class: 'kvr-rc-meta', text: 'Medlemsnr. ' + L.memberKey(it) }));
    sep();
    // linje og motlinje med samme kode og beløp er slettet; de k første positive og negative linjene per nøkkel merkes
    var camp = {};
    ((ctlRes && ctlRes.disc && ctlRes.disc.camp && ctlRes.disc.camp.items) || []).forEach(function (e) { if (e.status === 'kampanje' || e.status === 'auto') camp[e.key] = true; });
    var pos = {}, neg = {}, cx = L.cancelled(sc), retWords = L.wordList(ctlCfg && ctlCfg.retWatch);
    cx.items.concat(cx.pant).forEach(function (c) { var k = c.c + '|' + Math.round(c.a * 100); pos[k] = c.k; neg[k] = c.k; });
    (sc.items || []).forEach(function (l) {
      var k = l.c + '|' + Math.round(Math.abs(l.a) * 100), del = false;
      if (l.a > 0 && pos[k] > 0) { pos[k]--; del = true; } else if (l.a < 0 && neg[k] > 0) { neg[k]--; del = true; }
      var kind = L.lappKind(l), tags = [], cls = '';
      if (del) { cls = 'kvr-rc-del'; tags.push(tag('slettet')); if (kind === 'mach' && l.a < 0) cls += ' kvr-rc-hit'; }
      if (kind === 'man' && l.a < 0) { cls += ' kvr-rc-hit'; tags.push(tag('manuell 99')); }
      if (l.rv) row('RETUR VARE' + (l.rr ? ' ' + l.rr : ''), '', 'kvr-rc-sub' + (l.rr && L.wordHit(l.rr, retWords) ? ' kvr-rc-hit' : ''));
      if (!del && l.a < 0 && !kind && !/PANT/i.test(l.n)) tags.push(tag('retur'));
      // hvorfor rabatten regnes som kampanje: kampanjevare, kupong på bongen eller multipakk (ikke når brukeren har sagt «ikke kampanje»)
      var cw = !l.d || campDec[L.campKey(l.c)] === 'ikke' ? '' : camp[L.campKey(l.c)] ? 'kampanjevare' : ctlCfg.campCoupon && L.couponFor(sc, l) ? 'kupong' : ctlCfg.campMulti && L.multiBuy(sc, l) ? 'multipakk' : '';
      if (cw) tags.push(tag(cw));
      row(l.n, fmt(l.a), cls.trim(), tags, l.c + ' ' + l.n);
      if (typeof l.q === 'number' && typeof l.p === 'number') sub(String(l.q).replace('.', ',') + ' à ' + fmt(l.p), '');
      if (l.d) {
        sub('Rabatt' + (typeof l.dp === 'number' ? ' ' + String(l.dp).replace('.', ',') + ' %' : ''), '−' + fmt(l.d));
        sub(l.dr ? 'Årsak: ' + L.reasonName(l.dr) : cw ? 'Kampanje (' + cw + ')' : 'Uten årsak', '', l.dr || cw ? '' : 'kvr-rc-hit');
      }
    });
    // linjer CW har merket «(SLETTET)»: beløpet er ikke med i Totalt
    L.delLines(sc).forEach(function (l) { row(l.n, fmt(l.a), 'kvr-rc-del' + (L.lappKind(l) === 'mach' ? ' kvr-rc-hit' : ''), [tag('slettet')], l.c + ' ' + l.n + ' (SLETTET)'); });
    if (sc.trunc) box.appendChild(el('div', { class: 'kvr-rc-meta', text: '… ' + sc.trunc + ' linjer til er ikke lest' }));
    sep();
    if (typeof sc.rnd === 'number' && sc.rnd) row('Øreavrunding', fmt(sc.rnd));
    row('TOTALT', fmt(typeof sc.tot === 'number' ? sc.tot : it.totalAmount), 'kvr-rc-tot');
    Object.keys(sc.pay || {}).forEach(function (k) { row(k, fmt(sc.pay[k]), /tilbake/i.test(k) ? 'kvr-rc-back' : ''); });
    (sc.coupons || []).forEach(function (c) { sub('Kupong ' + c.n, c.a ? fmt(c.a) : ''); });
    (sc.cd || []).forEach(function (c) { sub((c.s ? c.s.toUpperCase() + ' ' : 'Kort ') + (c.f ? c.f + '…' : '…') + c.n, ''); });
    (sc.rf || []).forEach(function (r) { sub((r.indexOf('T:') === 0 ? 'TransId ' : 'Referanse ') + r.slice(2), ''); });
    if (sc.mv && sc.mv.length) {
      sep();
      sc.mv.forEach(function (v) { sub('MVA ' + (v.r === null ? '?' : String(v.r).replace('.', ',')) + ' % av ' + fmt(v.g), v.m === null ? '' : fmt(v.m)); });
    }
    if (sc.ku) sub('Kjøpeutbytte-grunnlag ' + fmt(sc.ku.g), fmt(sc.ku.k));
    if (sc.ft && (sc.ft.t || sc.ft.a || sc.ft.e)) {
      sep();
      if (sc.ft.t) sub('Terminal ' + sc.ft.t, '');
      if (sc.ft.a) sub('Autorisasjon ' + sc.ft.a, '');
      if (sc.ft.e) sub(sc.ft.e.join(', '), '');
    }
    L.eventHits(sc, L.wordList(ctlCfg.evWords)).forEach(function (e) { sub(e.t, '', 'kvr-rc-hit'); });
    return box;
  }

  function checkRow(rk, first) {
    var it = rk.item, live = recById(rk.id), rec = live || { item: it, tr: null }, id = rk.id, n = notes[id];
    var open = expanded[id] !== undefined ? expanded[id] : first;
    var head = el('button', { type: 'button', class: 'kvr-ck-h', 'aria-expanded': String(open) }, [
      riskBadge(rk.score),
      el('span', { class: 'kvr-ck-t', text: it.endDateTime.slice(5) + ' · kasse ' + it.workstationNumber + ' · ' + (it.totalAmount === null ? L.typeLabel(it.receiptType) : fmt(it.totalAmount) + ' kr') }),
      checkState.newIds[id] ? el('span', { class: 'kvr-new', text: 'Ny' }) : null,
      n && n.status ? el('span', { class: 'kvr-st', text: n.status === 'sjekket' ? 'Sjekket' : 'Til oppfølging' }) : null
    ].filter(Boolean));
    head.addEventListener('click', function () { expanded[id] = !open; renderCheck(); });
    var card = el('div', { class: 'kvr-ck' + (open ? ' kvr-open' : '') }, [head,
      el('div', { class: 'kvr-reasons' }, L.scoreBreakdown(rk.reasons, weights).map(function (x) {
        return el('span', { class: 'kvr-reason' + (x.counts ? '' : ' kvr-cov'), text: L.reasonBase(x.reason), title: x.counts ? '' : 'Teller ikke: samme forhold er dekket av «' + L.reasonBase(x.by) + '»' });
      }))]);
    if (!open) return card;

    var body = el('div', { class: 'kvr-ck-b' });
    var bd = L.scoreBreakdown(rk.reasons, weights), asks = L.campAsk(bd, ctlRes ? ctlRes.findings : [], id);
    var why = el('ul', { class: 'kvr-why' }, bd.map(function (x, bi) {
      var r = x.reason, gid = L.groupForReason(r);
      return el('li', { class: x.counts ? '' : 'kvr-cov' }, [el('span', { text: L.explainReason(r, { id: id, cfg: anomCfg, ctl: ctlCfg, findings: ctlRes ? ctlRes.findings : [], rules: customRules }) + (x.counts ? '' : ' (Teller ikke: dekket av «' + L.reasonBase(x.by) + '».)') }),
        gid ? el('button', { type: 'button', class: 'kvr-ent kvr-adj', text: 'Juster', title: 'Åpne terskler og poeng for denne testen', onclick: function () { openSettings(gid); } }) : null]
        .concat(asks[bi].map(campQuestion)).filter(Boolean));
    }));
    body.appendChild(el('div', { class: 'kvr-hint', text: 'Hvorfor flagget?' }));
    body.appendChild(why);
    var sc = scanMap[id];
    body.appendChild(el('div', { class: 'kvr-hint', text: sc && sc.settle ? 'Kassaoppgjør' : 'Kvittering' }));
    if (sc && sc.settle) {
      var sd = sc.settle;
      body.appendChild(tbl(['Post', 'Beløp'], [['Telt kontant', fmt(sd.telt.kontant || 0)], ['Telt sum', fmt(sd.telt.sum || 0)], ['Differanse', { t: (sd.diff.sum > 0 ? '+' : '') + fmt(sd.diff.sum || 0), bad: !!sd.diff.sum }], ['Sendt bank', fmt(sd.bank || 0)], ['Pose', sd.pose || '–']]));
    } else if (sc && sc.items) {
      body.appendChild(receiptView(it, sc));
    } else {
      body.appendChild(el('div', { class: 'kvr-scanwarn' }, [el('span', { text: 'Ikke skannet, så linjene mangler.' }), btn('Skann nå', scanVisible, 'kvr-sm')]));
    }
    var acts = [];
    if (n && n.status === 'sjekket') acts.push(btn('Angre sjekket', function () { setStatus(rec, ''); }));
    else acts.push(btn('Sjekket', function () { setStatus(rec, 'sjekket'); }, 'kvr-primary'));
    acts.push(btn('Til oppfølging', function () { setStatus(rec, 'oppfolging'); }));
    acts.push(btn('Notat…', function () { openNote(rec); }));
    acts.push(btn(selected[id] ? 'Fjern valg' : 'Velg', function () { if (selected[id]) delete selected[id]; else selected[id] = it; apply(); }));
    acts.push(btn(live ? 'Vis i listen' : 'Hent i CW', function () { showInList(it); }, live ? '' : 'kvr-primary'));
    body.appendChild(el('div', { class: 'kvr-acts' }, acts));
    body.appendChild(entsFor(it));
    card.appendChild(body);
    return card;
  }


  function renderCompare(body, items) {
    if (!scope.compare.on) return;
    var okA = scope.dateFrom || scope.dateTo, okB = scope.compare.from || scope.compare.to;
    if (!okA || !okB) { body.appendChild(section('chk-cmp', 'Periode A mot B', [hintEl('Sett datoer for både periode A og periode B under «Omfang for analysen».')])); return; }
    var iA = items.filter(function (it) { return inRange(it, scope.dateFrom, scope.dateTo); });
    var iB = items.filter(function (it) { return inRange(it, scope.compare.from, scope.compare.to); });
    var c = L.comparePeriods(iA, iB, scanMap, anomMap, weights, ctlCfg);
    var line = function (label, r, bold) {
      return [label, r.A.count, r.B.count, pct(r.A.retShare) + ' → ' + pct(r.B.retShare), fmt(r.A.avg) + ' → ' + fmt(r.B.avg), r.A.score + ' → ' + r.B.score,
        bold ? '' : { t: r.flags.join(', ') || '–', bad: r.flagged }];
    };
    var rows = [line('Alle', { A: c.total.A, B: c.total.B, flags: [], flagged: false }, true)];
    c.rows.slice().sort(function (a, b) { return (b.flagged - a.flagged) || (b.dScore - a.dScore); }).forEach(function (r) {
      rows.push(line({ node: entLink('kasserer', r.id) }, r, false));
    });
    var per = function (a, b) { return (a || '…') + ' → ' + (b || '…'); };
    var kids = [hintEl('A: ' + per(scope.dateFrom, scope.dateTo) + ' · B: ' + per(scope.compare.from, scope.compare.to) + '. Rødt = endring som overstiger tersklene (returandel +10 poeng, snittbeløp ' + ctlCfg.profFactor + '× opp eller ned, eller risikoscore +5).'),
      tbl(['Enhet', 'Salg A', 'Salg B', 'Returandel', 'Snitt kr', 'Risikoscore', 'Endring'], rows)];
    if (iA.length && iB.some(function (it) { return inRange(it, scope.dateFrom, scope.dateTo); })) kids.push(hintEl('Periodene overlapper, så noen bonger teller i begge.'));
    body.appendChild(section('chk-cmp', 'Periode A mot B', kids));
  }

  function scopeSummary() {
    var p = [], per = function (a, b) { return (a || '…') + ' → ' + (b || '…'); };
    if (scope.compare.on) p.push('A ' + per(scope.dateFrom, scope.dateTo) + ' mot B ' + per(scope.compare.from, scope.compare.to));
    else if (scope.dateFrom || scope.dateTo) p.push(per(scope.dateFrom, scope.dateTo));
    if (scope.stores.length) p.push(scope.stores.length === 1 ? sLabel(scope.stores[0]) : scope.stores.length + ' butikker');
    if (scope.cashiers.length) p.push('kasserer ' + scope.cashiers.join(', '));
    if (scope.workstations.length) p.push('kasse ' + scope.workstations.join(', '));
    if (scope.useFilters) p.push('+ filtrene i listen');
    return p.length ? p.join(' · ') : 'hele listen';
  }

  function renderScopeInfo() {
    if (!ui.scopeInfo) return;
    ui.scopeBrief.textContent = scopeSummary() + ' · ' + analysisRecs('scope').length + ' bonger';
    var all = allRecs().length;
    ui.scopeInfo.textContent = 'Omfang: ' + scopeSummary() + ' → ' + analysisRecs('scope').length + ' av ' + all + ' kvitteringer ' + (all > recs.length ? '(listen og samlet grunnlag).' : 'i listen.');
    var cov = scopeCoverage();
    ui.scopeWarn.style.display = cov.missing ? 'flex' : 'none';
    ui.scopeWarnTxt.textContent = 'Omfanget går utenfor det som er hentet fra CW (' + cov.text + '). «Kjør analyse» henter det som mangler.';
  }

  function writeScope() {
    ui.scFrom.value = scope.dateFrom; ui.scTo.value = scope.dateTo;
    ui.scBFrom.value = scope.compare.from; ui.scBTo.value = scope.compare.to;
    ui.scCompare.checked = scope.compare.on; ui.scUseFilters.checked = scope.useFilters;
    ui.scB.style.display = scope.compare.on ? '' : 'none';
    ui.scALabelFrom.textContent = scope.compare.on ? 'Periode A fra' : 'Periode fra';
    ui.scALabelTo.textContent = scope.compare.on ? 'Periode A til' : 'Periode til';
    optsKey = '';
    refreshOptions();
  }

  // Etter en analyse vises resultatet fra øyeblikksbildet, ikke fra CW-listen som står der akkurat nå.
  // Søk eller ny periode i CW bytter listen, men skal ikke fjerne det analysen har funnet.
  function checkSource() {
    if (ctlRes && ctlRes.snap) return { items: ctlRes.snap.items, frozen: true };
    return { items: analysisItems(lastMode), frozen: false };
  }

  // Henter dagen og butikken til en bong inn i CW-listen igjen, uten å røre analysen.
  async function fetchBong(it) {
    if (scanning || !grid) return null;
    var d = L.parseDT(it.endDateTime).date;
    if (!d) return null;
    cw.dateFrom = d; cw.dateTo = d;
    ui.cwFrom.value = d; ui.cwTo.value = d;
    cw.members = cw.loyal = cw.free = cw.bong = '';
    [ui.cwMem, ui.cwLoy, ui.cwFree, ui.cwBong].forEach(function (n) { if (n) n.value = ''; });
    cw.stores = {}; cw.stores[String(it.storeNumber)] = true;
    renderCwStores();
    ui.cwCount.textContent = '1 butikk valgt';
    var before = boundCount;
    say('Henter ' + d + ' for ' + sLabel(it.storeNumber) + ' fra CW…');
    cwSearch();
    await waitFor(function () { return boundCount > before; }, 30000);
    await wait(400);
    apply();
    return recById(it.transactionId);
  }

  async function showInList(it) {
    var r = recById(it.transactionId) || await fetchBong(it);
    if (r) jumpTo(r); else say('Fant ikke bongen i CW-listen. Sjekk at dag og butikk finnes i CW.');
  }

  function renderCheck() {
    if (!ui.checkBody) return;
    var body = ui.checkBody;
    body.innerHTML = '';
    ui.checkTop.innerHTML = '';
    renderScopeInfo();
    var src = checkSource(), items = src.items;
    var all = L.rankReceipts(items, anomMap, weights);
    var checked = all.filter(function (r) { return notes[r.id] && notes[r.id].status === 'sjekket'; }).length;
    var vis = all.filter(function (r) { return checkState.showChecked || !(notes[r.id] && notes[r.id].status === 'sjekket'); });
    var high = vis.filter(function (r) { return L.riskLevel(r.score) === 'høy'; }).length;
    var nNew = vis.filter(function (r) { return checkState.newIds[r.id]; }).length;
    var base = items.filter(function (it) { return it.receiptType === 1 || it.receiptType === 2; });
    var done = base.filter(function (it) { return scanMap[it.transactionId]; }).length;

    var top = [
      el('div', { class: 'kvr-scoperow' }, [el('span', { text: 'Omfang: ' + scopeSummary() + ' · ' + items.length + ' bonger' }), btn('Endre', function () { ui.scopeCard.open = true; ui.scopeCard.scrollIntoView({ block: 'nearest' }); }, 'kvr-sm')]),
      hintEl('Skannet ' + done + ' av ' + base.length + (checkState.at ? ' · sist kjørt ' + new Date(checkState.at).toLocaleTimeString('nb-NO') : '')),
      btn('Kjør analyse', runAnalysis, 'kvr-primary')
    ];
    if (checkState.at && ctlRes && ctlRes.snap) top.push(btn('Lag revisjonsrapport…', openReportDialog));
    if (settingsStale && checkState.at) top.push(el('div', { class: 'kvr-notice', role: 'status' }, [el('span', { text: 'Innstillingene er endret siden sist. Kjør analysen på nytt for å bruke dem.' }), btn('Innstillinger', function () { openSettings(); }, 'kvr-sm')]));
    var pend = ctlRes && ctlRes.disc && ctlRes.disc.camp ? ctlRes.disc.camp.pending : 0;
    if (checkState.at && pend) top.push(el('div', { class: 'kvr-notice', role: 'status' }, [el('span', { text: pend + (pend === 1 ? ' mulig sentral kampanje venter' : ' mulige sentrale kampanjer venter') + ' på svar.' }), btn('Svar nå', openCampDialog, 'kvr-sm kvr-primary')]));
    if (src.frozen) {
      var live = {}, outside = 0;
      recs.forEach(function (r) { live[r.item.transactionId] = true; });
      items.forEach(function (it) { if (!live[it.transactionId]) outside++; });
      if (outside) top.push(el('div', { class: 'kvr-notice', role: 'status' }, [el('span', { text: 'Resultatet står fast fra analysen ' + new Date(checkState.at || ctlRes.at).toLocaleTimeString('nb-NO') + ' selv om CW-listen er endret: ' + outside + ' av ' + items.length + ' analyserte bonger ligger ikke i listen nå. «Hent i CW» på en bong henter den fram uten å røre analysen.' })]));
      if (ctlRes.snap.mode === 'scope' && ctlRes.snap.scopeText !== scopeSummary()) top.push(el('div', { class: 'kvr-notice', role: 'status' }, [el('span', { text: 'Omfanget er endret siden analysen (' + ctlRes.snap.scopeText + '). Kjør analysen på nytt for å bruke det nye omfanget.' })]));
    }
    if (vis.length) top.push(el('div', { class: 'kvr-ctlsum', text: vis.length + ' å sjekke · ' + high + ' høy risiko' + (nNew ? ' · ' + nNew + ' nye siden sist' : '') }));
    else if (checkState.at) top.push(el('div', { class: 'kvr-ctlsum', text: all.length ? 'Alt er sjekket.' : 'Ingen avvik funnet i dette utvalget.' }));
    else top.push(hintEl('Analysen skanner det som mangler, kjører avvik og kontroller, og lager en prioritert liste. Under kan du velge omfang: periode, butikk, kasserer, kasse eller periode mot periode.'));
    ui.checkTop.appendChild(section('chk-top', 'Analyse', top));
    if (!all.length) return;

    var cash = L.rankCashiers(items, anomMap, weights, ctlRes ? ctlRes.profile : null, ctlRes ? ctlRes.cashierExtra : null).slice(0, 5);
    if (cash.length) {
      body.appendChild(section('chk-cash', 'Kasserere å se nærmere på', [el('div', { class: 'kvr-list' }, cash.map(function (c) {
        var row = el('div', { class: 'kvr-li kvr-fl' }, [el('div', { class: 'kvr-fl-t' }, [
          el('b', { text: 'Kasserer ' + c.id }),
          el('span', { text: c.flagged + ' flaggede bonger' + (c.profile.length ? ' · ' + c.profile.join(', ') : '') })]),
          riskBadge(c.score)]);
        row.addEventListener('click', function () { setFocus('kasserer', c.id); });
        return row;
      }))]));
    }

    renderCompare(body, items);
    var listKids = [];
    vis.slice(0, checkState.shown).forEach(function (rk, i) { listKids.push(checkRow(rk, i === 0)); });
    if (vis.length > checkState.shown) listKids.push(btn('Vis flere (' + (vis.length - checkState.shown) + ')', function () { checkState.shown += 15; renderCheck(); }));
    if (checked || checkState.showChecked) {
      var sc = check('Vis sjekkede (' + checked + ')', function () { checkState.showChecked = sc.box.checked; renderCheck(); });
      sc.box.checked = checkState.showChecked;
      listKids.push(sc.node);
    }
    body.appendChild(section('chk-list', 'Sjekk først (' + vis.length + ')', listKids));
  }

  // ---- diagrammer -------------------------------------------------------------------
  var NS = 'http://www.w3.org/2000/svg';
  var CH = { bar: '#00704a', barOn: '#004d33', blue: '#2a78d6', orange: '#eb6834', grid: '#e3e9e6', axis: '#9aa8a1', text: '#1b2a24', text2: '#5f6f68', empty: '#f1f4f2' };
  var RAMP = ['#d9eee4', '#a8d5c0', '#6bb394', '#2f8c66', '#00704a'];

  function sv(tag, attrs, kids) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  function tipShow(e, text) {
    var panel = document.getElementById('kvr-panel');
    if (!panel || !ui.tip) return;
    ui.tip.textContent = text;
    ui.tip.style.display = 'block';
    var pr = panel.getBoundingClientRect();
    var x = e.clientX - pr.left + 12, y = e.clientY - pr.top + 14;
    ui.tip.style.left = Math.max(4, Math.min(x, pr.width - ui.tip.offsetWidth - 6)) + 'px';
    ui.tip.style.top = Math.max(4, Math.min(y, pr.height - ui.tip.offsetHeight - 6)) + 'px';
  }

  function attachTip(node, text, onClick) {
    var hide = function () { if (ui.tip) ui.tip.style.display = 'none'; };
    node.addEventListener('mousemove', function (e) { tipShow(e, text); });
    node.addEventListener('mouseenter', function (e) { tipShow(e, text); });
    node.addEventListener('mouseleave', hide);
    node.addEventListener('blur', hide);
    node.addEventListener('focus', function () { var r = node.getBoundingClientRect(); tipShow({ clientX: r.left + r.width / 2, clientY: r.top }, text); });
    if (onClick) {
      node.addEventListener('click', onClick);
      node.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } });
    }
  }

  function fmtTick(v) { return v >= 1000 ? Math.round(v).toLocaleString('nb-NO') : String(Math.round(v * 10) / 10).replace('.', ','); }

  function topRounded(x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
  }

  function axes(svg, W, H, ml, mr, mt, mb, maxV) {
    var plotH = H - mt - mb;
    [0, 0.5, 1].forEach(function (f) {
      var y = mt + plotH - f * plotH;
      svg.appendChild(sv('line', { x1: ml, x2: W - mr, y1: y, y2: y, stroke: f === 0 ? CH.axis : CH.grid, 'stroke-width': 1 }));
      svg.appendChild(sv('text', { x: ml - 5, y: y + 3, 'text-anchor': 'end', fill: CH.text2, 'font-size': 10, text: fmtTick(maxV * f) }));
    });
  }

  function colChart(o) {
    var W = o.W, H = o.H || 140, ml = 40, mr = 6, mt = 16, mb = 20, n = o.data.length;
    var plotW = W - ml - mr, plotH = H - mt - mb;
    var maxV = L.niceMax(Math.max.apply(null, o.data.map(function (d) { return d.value; }).concat([0])));
    var svg = sv('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': o.aria, class: 'kvr-svg' });
    axes(svg, W, H, ml, mr, mt, mb, maxV);
    var slot = plotW / n, bw = Math.min(24, slot * 0.7), peak = 0;
    o.data.forEach(function (d, i) { if (d.value > o.data[peak].value) peak = i; });
    o.data.forEach(function (d, i) {
      var x = ml + i * slot + (slot - bw) / 2, h = Math.max(0, d.value) / maxV * plotH, y = mt + plotH - h;
      if (h > 0) svg.appendChild(sv('path', { d: topRounded(x, y, bw, h, 4), fill: d.on ? CH.barOn : CH.bar }));
      if (o.labelEvery && i % o.labelEvery === 0) svg.appendChild(sv('text', { x: ml + i * slot + slot / 2, y: H - 6, 'text-anchor': 'middle', fill: CH.text2, 'font-size': 10, text: d.label }));
      var hit = sv('rect', { x: ml + i * slot, y: mt, width: slot, height: plotH, fill: 'transparent', tabindex: '0', role: 'button', 'aria-label': d.tip, class: 'kvr-hit' });
      attachTip(hit, d.tip, d.click);
      svg.appendChild(hit);
    });
    if (o.data[peak] && o.data[peak].value > 0) {
      var ph = o.data[peak].value / maxV * plotH;
      svg.appendChild(sv('text', { x: ml + peak * slot + slot / 2, y: Math.max(10, mt + plotH - ph - 4), 'text-anchor': 'middle', fill: CH.text, 'font-size': 10, 'font-weight': 600, text: o.peakText ? o.peakText(o.data[peak]) : fmtTick(o.data[peak].value) }));
    }
    return svg;
  }

  function pairChart(o) {
    var W = o.W, H = o.H || 150, ml = 40, mr = 6, mt = 16, mb = 20, n = o.data.length;
    var plotW = W - ml - mr, plotH = H - mt - mb;
    var maxV = L.niceMax(Math.max.apply(null, o.data.map(function (d) { return Math.max(d.a, d.b); }).concat([0])));
    var svg = sv('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': o.aria, class: 'kvr-svg' });
    axes(svg, W, H, ml, mr, mt, mb, maxV);
    var slot = plotW / n, bw = Math.min(18, (slot * 0.8 - 2) / 2);
    o.data.forEach(function (d, i) {
      var cx = ml + i * slot + slot / 2;
      [[d.a, CH.blue, cx - bw - 1], [d.b, CH.orange, cx + 1]].forEach(function (b) {
        var h = Math.max(0, b[0]) / maxV * plotH;
        if (h > 0) svg.appendChild(sv('path', { d: topRounded(b[2], mt + plotH - h, bw, h, 4), fill: b[1] }));
      });
      svg.appendChild(sv('text', { x: cx, y: H - 6, 'text-anchor': 'middle', fill: CH.text2, 'font-size': 10, text: d.label }));
      var hit = sv('rect', { x: ml + i * slot, y: mt, width: slot, height: plotH, fill: 'transparent', tabindex: '0', role: 'button', 'aria-label': d.tip, class: 'kvr-hit' });
      attachTip(hit, d.tip, d.click);
      svg.appendChild(hit);
    });
    return svg;
  }

  function chartCard(id, title, sub, node, table) {
    var tv = tbl(table.heads, table.rows);
    tv.style.display = 'none';
    var tgl = btn('Tabell', function () {
      var on = tv.style.display === 'none';
      tv.style.display = on ? '' : 'none';
      node.style.display = on ? 'none' : '';
      tgl.textContent = on ? 'Diagram' : 'Tabell';
    }, 'kvr-sm');
    return el('div', { class: 'kvr-card', 'data-sec': id }, [el('div', { class: 'kvr-chart-h' }, [el('h4', { text: title }), tgl]), sub ? hintEl(sub) : el('span'), node, tv]);
  }

  function legend(items) {
    return el('div', { class: 'kvr-legend' }, items.map(function (i) { return el('span', {}, [el('i', { style: 'background:' + i[0] }), document.createTextNode(i[1])]); }));
  }

  function scopedItems(reset) {
    var f = Object.assign({}, filters, reset), ctx = makeCtx();
    return recs.filter(function (r) { return L.matches(r.item, f, ctx); }).map(function (r) { return r.item; });
  }

  function chartsVisible() {
    var panel = document.getElementById('kvr-panel');
    return !!(ui.panes && ui.panes.analyse && ui.panes.analyse.style.display !== 'none' && ui.subPanes && ui.subPanes.charts && ui.subPanes.charts.style.display !== 'none' && panel && !panel.classList.contains('kvr-collapsed'));
  }

  function renderChartsIfVisible() { if (chartsVisible()) renderCharts(); }

  function two(n) { return (n < 10 ? '0' : '') + n; }

  function renderCharts() {
    if (!ui.chartsBody) return;
    var body = ui.chartsBody;
    body.innerHTML = '';
    var W = Math.max(260, (body.clientWidth || 380) - 24);
    if (!recs.length) { body.appendChild(el('div', { class: 'kvr-card' }, [hintEl('Ingen kvitteringer i listen.')])); return; }
    var scopeNote = 'Diagrammene ser bort fra filteret de selv styrer, så de ikke krymper når du klikker.';
    var setTime = function (h) { filters.timeFrom = two(h) + ':00'; filters.timeTo = two(h) + ':59'; writeForm(); apply(); };
    var setDay = function (d) { filters.dateFrom = d; filters.dateTo = d; writeForm(); apply(); };

    // salg per time
    var hd = L.chartData(scopedItems({ timeFrom: '', timeTo: '' }), scanMap).hours;
    var hours = hd.count.map(function (n, h) {
      return { label: String(h), value: n, on: filters.timeFrom === two(h) + ':00' && filters.timeTo === two(h) + ':59',
        tip: two(h) + ':00–' + two(h) + ':59 · ' + n + ' salg · ' + fmt(hd.sum[h]) + ' kr', click: function () { setTime(h); } };
    });
    body.appendChild(chartCard('ch-hours', 'Salg per time', 'Antall salg. Klikk en søyle for å filtrere på timen. ' + scopeNote,
      colChart({ W: W, data: hours, labelEvery: 3, aria: 'Søylediagram: antall salg per time', peakText: function (d) { return String(d.value); } }),
      { heads: ['Time', 'Salg', 'Sum kr'], rows: hd.count.map(function (n, h) { return [two(h) + ':00', n, fmt(hd.sum[h])]; }) }));

    // salg per dag
    var dd = L.chartData(scopedItems({ dateFrom: '', dateTo: '' }), scanMap).days;
    if (dd.length >= 2) {
      var days = dd.map(function (d) {
        return { label: d.day.slice(5), value: d.sum, on: filters.dateFrom === d.day && filters.dateTo === d.day,
          tip: d.day + ' · ' + d.count + ' salg · ' + fmt(d.sum) + ' kr', click: function () { setDay(d.day); } };
      });
      body.appendChild(chartCard('ch-days', 'Salg per dag', 'Sum i kr. Klikk en søyle for å filtrere på dagen.',
        colChart({ W: W, data: days, labelEvery: Math.ceil(days.length / 6), aria: 'Søylediagram: salg per dag', peakText: function (d) { return fmtTick(d.value); } }),
        { heads: ['Dag', 'Salg', 'Sum kr'], rows: dd.map(function (d) { return [d.day, d.count, fmt(d.sum)]; }) }));
    }

    // returandel per kasserer
    var cd = L.chartData(scopedItems({ cashiers: [], workstations: [] }), scanMap);
    if (cd.cashiers.length) {
      var factor = Number(ctlCfg.profFactor) || 1.5, minN = Number(ctlCfg.profMin) || 5;
      var axisMax = L.niceMax(Math.max(cd.cashiers[0].share, cd.storeShare, 0.1));
      var list = el('div', { class: 'kvr-hbars' });
      var rowsT = [];
      cd.cashiers.slice(0, 12).forEach(function (c) {
        var flag = c.count >= minN && cd.storeShare > 0 && c.share >= cd.storeShare * factor;
        var tip = 'Kasserer ' + c.id + ' · ' + c.ret + ' av ' + c.count + ' salg er returer (' + pct(c.share) + ')' + (flag ? ' · minst ' + factor + '× snittet' : '');
        var link = entLink('kasserer', c.id, 'Kasserer ' + c.id + ' (' + c.count + ')');
        var bar = el('div', { class: 'kvr-hb-bar' + (flag ? ' kvr-flag' : ''), style: 'width:' + Math.max(c.share > 0 ? 1 : 0, c.share / axisMax * 100) + '%' });
        var track = el('div', { class: 'kvr-hb-track' }, [bar, el('div', { class: 'kvr-hb-ref', style: 'left:' + (cd.storeShare / axisMax * 100) + '%' })]);
        var val = el('span', { class: 'kvr-hb-v', text: pct(c.share) + (flag ? ' ▲' : '') });
        var row = el('div', { class: 'kvr-hb', title: tip }, [link, track, val]);
        list.appendChild(row);
        rowsT.push(['Kasserer ' + c.id, c.count, c.ret, pct(c.share) + (flag ? ' (høy)' : '')]);
      });
      body.appendChild(chartCard('ch-cash', 'Returandel per kasserer', 'Andel salg med negativ sum. Den tynne streken er butikksnittet (' + pct(cd.storeShare) + '). Oransje ▲ = minst ' + factor + '× snittet. Klikk et navn for å se alt om kassereren.',
        el('div', {}, [list, legend([[CH.bar, 'Returandel'], [CH.orange, 'Høy mot snitt']])]),
        { heads: ['Kasserer', 'Salg', 'Returer', 'Andel'], rows: rowsT }));
    }

    // kasse x time
    var hm = L.chartData(scopedItems({ workstations: [], timeFrom: '', timeTo: '' }), scanMap).heat;
    if (hm.rows.length) {
      var grid2 = el('div', { class: 'kvr-heat', style: 'grid-template-columns:62px repeat(24,1fr)' });
      grid2.appendChild(el('span'));
      for (var h = 0; h < 24; h++) grid2.appendChild(el('span', { class: 'kvr-hh', text: h % 3 === 0 ? String(h) : '' }));
      var heatT = [];
      hm.rows.forEach(function (r) {
        grid2.appendChild(entLink('kasse', r.id, 'Kasse ' + r.id));
        r.counts.forEach(function (n, hr) {
          var idx = n === 0 ? -1 : Math.min(4, Math.ceil(n / hm.max * 5) - 1);
          var cellEl = el('button', { type: 'button', class: 'kvr-hc', style: 'background:' + (idx < 0 ? CH.empty : RAMP[idx]), 'aria-label': 'Kasse ' + r.id + ' kl. ' + two(hr) + ': ' + n + ' salg' });
          attachTip(cellEl, 'Kasse ' + r.id + ' · ' + two(hr) + ':00–' + two(hr) + ':59 · ' + n + ' salg', function () { filters.workstations = [r.id]; setTime(hr); });
          grid2.appendChild(cellEl);
        });
        heatT.push(['Kasse ' + r.id].concat([r.counts.reduce(function (a, b) { return a + b; }, 0)]));
      });
      body.appendChild(chartCard('ch-heat', 'Når skjer det? Kasse × time', 'Antall salg per kasse og klokketime. Mørkere = flere. Klikk en rute for å filtrere på kassen og timen.',
        el('div', {}, [grid2, el('div', { class: 'kvr-legend' }, [document.createTextNode('Færre '), el('span', { class: 'kvr-ramp' }, RAMP.map(function (c) { return el('i', { style: 'background:' + c }); })), document.createTextNode(' flere')])]),
        { heads: ['Kasse', 'Salg'], rows: heatT }));
    }

    // benford
    var bn = L.numbers(scopedItems({}), scanMap, ctlCfg).overall;
    if (bn.n > 0) {
      var f1 = function (v) { return Math.round(v * 1000) / 10; };
      var bdata = bn.expected.map(function (e, i) {
        return { label: String(i + 1), a: f1(e), b: f1(bn.actual[i]),
          tip: 'Første siffer ' + (i + 1) + ' · forventet ' + String(f1(e)).replace('.', ',') + ' % · faktisk ' + String(f1(bn.actual[i])).replace('.', ',') + ' % (' + bn.counts[i] + ' bonger)' };
      });
      body.appendChild(chartCard('ch-benford', 'Benford: første siffer i totalbeløp', 'Synlige salg (' + bn.n + ' bonger). MAD ' + bn.mad.toFixed(3) + ': ' + bn.verdict + (bn.n < (Number(ctlCfg.benfordMin) || 100) ? ' (for få bonger til en sikker konklusjon)' : '') + '. Avvik er en indikasjon som må forklares, ikke et bevis.',
        el('div', {}, [legend([[CH.blue, 'Forventet (Benford)'], [CH.orange, 'Faktisk']]), pairChart({ W: W, data: bdata, aria: 'Søylediagram: forventet og faktisk fordeling av første siffer i prosent' })]),
        { heads: ['Siffer', 'Forventet %', 'Faktisk %', 'Bonger'], rows: bdata.map(function (d, i) { return [d.label, String(d.a).replace('.', ','), String(d.b).replace('.', ','), bn.counts[i]]; }) }));
    }

    // pant per dag
    var pd = L.chartData(scopedItems({ dateFrom: '', dateTo: '' }), scanMap).pant;
    var pbase = recs.filter(function (r) { return r.base && r.item.receiptType === 1; });
    var pdone = pbase.filter(function (r) { return scanMap[r.item.transactionId]; }).length;
    if (pd.some(function (d) { return d.sale || d.ret; })) {
      var pdata = pd.map(function (d) { return { label: d.day.slice(5), a: d.sale, b: d.ret, tip: d.day + ' · pantesalg ' + fmt(d.sale) + ' kr · utbetalt panteretur ' + fmt(d.ret) + ' kr', click: function () { setDay(d.day); } }; });
      body.appendChild(chartCard('ch-pant', 'Pant per dag: salg mot utbetalt', 'Kun skannede kvitteringer (' + pdone + ' av ' + pbase.length + '). Klikk en dag for å filtrere.',
        el('div', {}, [legend([[CH.blue, 'Pantesalg'], [CH.orange, 'Utbetalt panteretur']]), pairChart({ W: W, data: pdata, aria: 'Søylediagram: pantesalg og utbetalt panteretur per dag' })]),
        { heads: ['Dag', 'Pantesalg', 'Utbetalt'], rows: pd.map(function (d) { return [d.day, fmt(d.sale), fmt(d.ret)]; }) }));
    } else {
      body.appendChild(el('div', { class: 'kvr-card', 'data-sec': 'ch-pant' }, pd.length
        ? [el('h4', { text: 'Pant per dag' }), hintEl('Ingen pant i de skannede kvitteringene (' + pdone + ' av ' + pbase.length + ').')]
        : [el('h4', { text: 'Pant per dag' }), hintEl('Skann kvitteringene for å se pantesalg mot utbetalt panteretur.'), btn('Skann nå', scanVisible, 'kvr-sm')]));
    }
  }

  // ---- CSV ------------------------------------------------------------------
  function exportCsv(onlySelected, listOverride) {
    var list = listOverride || recs.filter(function (r) { return onlySelected ? selected[r.item.transactionId] : r.show; });
    var rows = [['Tid', 'Butikk', 'Kasse', 'Kasserer', 'Bongnr', 'Type', 'Sum', 'Medlem', 'Pant salg', 'Pant retur', 'Varegrupper', 'Avvik', 'Betaling', 'Rabatt kr', 'Kuponger', 'Betalingsref', 'Totalt på bong']];
    list.forEach(function (r) {
      var it = r.item, sc = scanMap[it.transactionId], gs = groupsOf(it.transactionId);
      rows.push([it.endDateTime, sLabel(it.storeNumber), it.workstationNumber, it.cashierNumber, it.bongnr, L.typeLabel(it.receiptType),
        it.totalAmount === null ? '' : String(it.totalAmount).replace('.', ','), it.memberNumber === null ? '' : it.memberNumber,
        sc ? String(sc.sale).replace('.', ',') : '', sc ? String(sc.ret).replace('.', ',') : '', gs ? gs.join(', ') : '', (anomMap[it.transactionId] || []).join(', '),
        sc && sc.pay ? Object.keys(sc.pay).map(function (k) { return k + ' ' + String(sc.pay[k]).replace('.', ','); }).join('; ') : '', sc && L.hasDisc(sc) ? String(sc.disc).replace('.', ',') : '', sc && L.hasDisc(sc) ? sc.coupons.length : '',
        sc && sc.rf ? sc.rf.map(function (x) { return x.slice(2); }).join('; ') : '', sc && typeof sc.tot === 'number' ? String(sc.tot).replace('.', ',') : '']);
    });
    download(new Blob([L.toCsv(rows)], { type: 'text/csv;charset=utf-8' }), 'kvitteringer.csv');
    say((rows.length - 1) + ' rader eksportert.');
  }

  // ---- skjema ---------------------------------------------------------------
  function readForm() {
    filters.stores = readSelect(ui.stores);
    filters.workstations = readSelect(ui.workstations);
    filters.cashiers = readSelect(ui.cashiers);
    filters.types = readSelect(ui.types);
    filters.groups = readSelect(ui.groups);
    filters.dateFrom = ui.dateFrom.value;
    filters.dateTo = ui.dateTo.value;
    filters.timeFrom = ui.timeFrom.value;
    filters.timeTo = ui.timeTo.value;
    filters.sumMin = ui.sumMin.value;
    filters.sumMax = ui.sumMax.value;
    filters.onlyNegative = ui.onlyNegative.checked;
    filters.member = ui.member.value.trim();
    filters.onlyMember = ui.onlyMember.checked;
    filters.onlyDup = ui.onlyDup.checked;
    filters.onlyAnom = ui.onlyAnom.checked;
    filters.bong = ui.bong.value.trim();
    filters.item = ui.item.value.trim();
    filters.text = ui.text.value.trim();
    filters.pay = ui.pay.value;
    filters.pant = ui.pant.value;
    filters.disc = ui.disc.value;
    filters.discFrom = ui.discFrom.value;
    filters.discTo = ui.discTo.value;
    filters.special = ui.special.value;
    filters.note = ui.note.value;
    filters.sort = ui.sort.value;
  }

  function writeForm() {
    optsKey = '';
    ['dateFrom', 'dateTo', 'timeFrom', 'timeTo', 'sumMin', 'sumMax', 'member', 'bong', 'item', 'text', 'discFrom', 'discTo'].forEach(function (k) { ui[k].value = filters[k]; });
    syncSpecialOpts();
    syncPayOpts();
    ui.pay.value = filters.pay;
    ui.onlyNegative.checked = filters.onlyNegative;
    ui.onlyMember.checked = filters.onlyMember;
    ui.onlyDup.checked = filters.onlyDup;
    ui.onlyAnom.checked = filters.onlyAnom;
    ui.pant.value = filters.pant;
    ui.disc.value = filters.disc;
    ui.special.value = filters.special;
    ui.note.value = filters.note;
    ui.sort.value = filters.sort;
  }

  // Valgene under «Spesialbetaling» følger ordlisten i Innstillinger.
  var specialKey = null;
  function syncSpecialOpts() {
    var words = L.wordList(ctlCfg.specialWords), key = words.join('|');
    if (!ui.special || key === specialKey) return;
    specialKey = key;
    var cur = ui.special.value || filters.special;
    ui.special.innerHTML = '';
    ui.special.appendChild(el('option', { value: '', text: 'Alle' }));
    if (words.length) ui.special.appendChild(el('option', { value: '*', text: 'Alle ordene i listen' }));
    words.forEach(function (w) { ui.special.appendChild(el('option', { value: w, text: w.charAt(0).toUpperCase() + w.slice(1) })); });
    if (cur && cur !== '*' && words.indexOf(cur) === -1) ui.special.appendChild(el('option', { value: cur, text: cur }));
    ui.special.value = cur;
  }

  // Valgene under «Betalingsmåte» er etikettene som finnes på de skannede bongene.
  var payKey = null;
  function syncPayOpts() {
    if (!ui.pay) return;
    var seen = {}, key = Object.keys(scanMap).length + ':' + (filters.pay || '');
    if (key === payKey) return;
    payKey = key;
    Object.keys(scanMap).forEach(function (id) { var sc = scanMap[id]; if (sc && sc.pay && !sc.settle) Object.keys(sc.pay).forEach(function (k) { seen[k] = 1; }); });
    var cur = ui.pay.value || filters.pay, labels = Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, 'nb'); }).slice(0, 40);
    ui.pay.innerHTML = '';
    ui.pay.appendChild(el('option', { value: '', text: 'Alle' }));
    labels.forEach(function (k) { ui.pay.appendChild(el('option', { value: k, text: k })); });
    if (cur && labels.indexOf(cur) === -1) ui.pay.appendChild(el('option', { value: cur, text: cur }));
    ui.pay.value = cur;
  }

  function onChange() { readForm(); apply(); }

  function needsScan() { return el('em', { class: 'kvr-needs', text: 'skanning', title: 'Krever at kvitteringene er skannet' }); }

  function field(label, node, needs) { return el('label', { class: 'kvr-f' }, [el('span', {}, [document.createTextNode(label), needs ? needsScan() : null].filter(Boolean)), node]); }

  function input(type, extra) {
    var n = el('input', Object.assign({ type: type }, extra || {}));
    n.addEventListener('input', onChange);
    n.addEventListener('change', onChange);
    return n;
  }

  function pfield(label, node, needs) { return el('div', { class: 'kvr-f' }, [el('span', {}, [document.createTextNode(label), needs ? needsScan() : null].filter(Boolean)), node]); }

  function check(label, handler) {
    var c = el('input', { type: 'checkbox' });
    c.addEventListener('change', handler || onChange);
    return { box: c, node: el('label', { class: 'kvr-c' }, [c, el('span', { text: label })]) };
  }

  function btn(text, onclick, cls) {
    return el('button', { type: 'button', class: 'kvr-btn' + (cls ? ' ' + cls : ''), text: text, onclick: onclick });
  }

  function renderSaved() {
    var list = store(K.saved) || {};
    ui.saved.innerHTML = '';
    ui.saved.appendChild(el('option', { value: '', text: '— lagrede filtre —' }));
    Object.keys(list).sort().forEach(function (k) { ui.saved.appendChild(el('option', { value: k, text: k })); });
  }

  function renderCwStores() {
    var q = cw.storeQuery.toLowerCase();
    ui.cwStores.innerHTML = '';
    if (!cwStoreList.length) {
      ui.cwStores.appendChild(el('div', { class: 'kvr-hint', text: 'Butikklisten er ikke lastet fra CW ennå…' }));
      return;
    }
    cwStoreList.filter(function (st) {
      return !q || L.storeSearch(st.number, storeMap).indexOf(q) !== -1;
    }).slice(0, 200).forEach(function (st) {
      var cb = el('input', { type: 'checkbox', value: String(st.number) });
      cb.checked = !!cw.stores[st.number];
      cb.addEventListener('change', function () {
        cw.stores[st.number] = cb.checked;
        summary();
        ui.cwCount.textContent = Object.keys(cw.stores).filter(function (k) { return cw.stores[k]; }).length + ' butikker valgt';
      });
      ui.cwStores.appendChild(el('label', { class: 'kvr-chk' }, [cb, el('span', { text: sLabel(st.number) })]));
    });
  }

  // ---- bekreftelse og innstillinger -------------------------------------------------
  function confirmBox(title, text, yesLabel, onYes) {
    var body = el('div', { class: 'kvr-secbody' }, [hintEl(text)]);
    openModal(title, body, [btn('Avbryt', closeModal), btn(yesLabel || 'Bekreft', function () { closeModal(); onYes(); }, 'kvr-primary')]);
  }

  // Gjør et kort sammenfoldbart (klikk på tittelen). Tilstanden huskes.
  var foldCards = [];
  function fold(card, id, startOpen) {
    var h = card.querySelector('h4');
    if (!h) return card;
    var saved = (store(K.sec) || {})[id];
    var set = function (open) { card.classList.toggle('kvr-folded', !open); h.setAttribute('aria-expanded', String(open)); };
    card.classList.add('kvr-fold');
    h.tabIndex = 0;
    h.setAttribute('role', 'button');
    set(saved === undefined ? startOpen : !!saved);
    var flip = function () {
      var open = card.classList.contains('kvr-folded');
      set(open);
      var m = store(K.sec) || {};
      m[id] = open;
      store(K.sec, m);
    };
    h.addEventListener('click', flip);
    h.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
    card.__set = set;
    foldCards.push({ id: id, card: card });
    return card;
  }

  function foldAll(open) {
    var m = {};
    foldCards.forEach(function (f) { f.card.__set(open); m[f.id] = open; });
    store(K.sec, m);
  }

  function openSec(id) {
    var n = document.querySelector('#kvr-panel [data-sec=' + id + ']');
    if (!n) return null;
    if (n.__set) n.__set(true);
    return n;
  }

  function legendRow(sample, text) { return el('div', { class: 'kvr-leg' }, [sample, el('span', { text: text })]); }

  function openHelp() {
    store(K.help, 1);
    if (ui.firstRun) ui.firstRun.style.display = 'none';
    var li = function (t) { return el('li', { text: t }); };
    var body = el('div', { class: 'kvr-secbody kvr-help' }, [
      el('div', { class: 'kvr-hint', text: 'Kvitteringshenter versjon ' + KvReport.VERSION }),
      el('b', { class: 'kvr-subh', text: 'Slik går du frem' }),
      el('ol', {}, [
        li('Hent: søk i hele journalen (CW) etter dato, butikk, medlem, vare eller bong.'),
        li('Filtrer: snevre inn listen. Alle valg vises som piller under tallene og fjernes med ×.'),
        li('Skann: les innholdet i kvitteringene (pant, varer, rabatt). Trengs for vare-, pant- og rabattfilter og for de fleste tester.'),
        li('Analyse → Sjekk først: velg omfang og trykk «Kjør analyse». Åpne en bong for å se hvorfor den ble flagget.'),
        li('Mer: eksport (CSV, PNG) og Innstillinger for terskler og poeng.')
      ]),
      el('b', { class: 'kvr-subh', text: 'Tegnforklaring' }),
      legendRow(el('span', { class: 'kvr-sw kvr-sw-flag', text: '' }), 'Rød kant: bongen er flagget i analysen.'),
      legendRow(el('span', { class: 'kvr-sw kvr-sw-warn' }), 'Gul stripe: noe mangler (skanning eller data). Knappen ved siden av løser det.'),
      legendRow(el('span', { class: 'kvr-sw kvr-sw-hi', text: 'Høy 8' }), 'Risikoscore er summen av poeng for avvikene. Høy fra 8, middels fra 4. RRS 0–100 er samme tall på en skala der 8 poeng = 50.'),
      legendRow(el('span', { class: 'kvr-sw kvr-sw-new', text: 'Ny' }), 'Flagget siden forrige analyse.'),
      legendRow(el('span', { class: 'kvr-sw kvr-sw-ent', text: 'Kasserer 12' }), 'Klikk for å se alt som gjelder kassereren eller kassen (Fokus).'),
      legendRow(el('span', { class: 'kvr-sw kvr-sw-bad', text: '−70,00' }), 'Rødt tall i tabell: over terskelen.'),
      legendRow(el('span', { class: 'kvr-sw kvr-sw-cov', text: 'Test' }), 'Overstrøket årsak: dekket av en høyere test på samme forhold, teller ikke i poengene.'),
      legendRow(el('span', { class: 'kvr-sw kvr-sw-new', text: 'Kampanje?' }), 'Rabatten kan være en sentral kampanje. Svar Ja eller Nei under bongen; svaret gjelder varen på alle flaggede bonger.'),
      legendRow(el('span', { class: 'kvr-sw', text: '⤢' }), 'Panelstørrelse: Vanlig, Stor (dokket til høyre) eller Full.'),
      el('b', { class: 'kvr-subh', text: 'Snarveier' }),
      el('ul', {}, [
        li('Alt+K skjuler og viser panelet. Dra i toppen for å flytte, dobbeltklikk for å nullstille plassering.'),
        li('Alt+klikk på KASSERER eller KASSE i listen åpner Fokus.'),
        li('↑ ↓ bytter bong, N notat, M velg eller fjern valg (utenfor tekstfelt).'),
        li('← → bytter fane når en fane har fokus. Esc lukker dialoger.')
      ])
    ]);
    openModal('Slik bruker du Kvitteringshenter', body, [btn('Innstillinger', function () { closeModal(); openSettings(); }), btn('Lukk', closeModal, 'kvr-primary')]);
  }

  function tabKeys(bar) {
    bar.addEventListener('keydown', function (e) {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(e.key) === -1) return;
      var tabs = Array.prototype.slice.call(bar.querySelectorAll('[role=tab]'));
      var i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      var n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      e.preventDefault();
      tabs[n].click();
      tabs[n].focus();
    });
  }

  function cfgOf(src) { return src === 'anom' ? anomCfg : ctlCfg; }
  function saveCfg(src) { store(src === 'anom' ? K.anom : K.ctl, cfgOf(src)); }
  function defOf(src) { return src === 'anom' ? L.defaultAnom() : L.defaultControl(); }

  // Terskler gjelder fra neste analyse; poeng gjelder med en gang.
  function markStale() {
    settingsStale = true;
    renderStale();
    if (checkState.at) renderCheck();
  }

  function renderStale() {
    var show = settingsStale && !!(checkState.at || ctlRes);
    if (ui.setStale) ui.setStale.style.display = show ? 'flex' : 'none';
  }

  function settingRow(f, refresh) {
    var src = f.src, def = String(defOf(src)[f.k]);
    var cur = function () { return cfgOf(src)[f.k]; };
    var isDef = function () { return String(cur()) === def; };
    var left = el('div', { class: 'kvr-set-lw' }, [el('span', { class: 'kvr-set-l', text: f.label })].concat(f.hint ? [el('span', { class: 'kvr-set-h', text: f.hint })] : []));
    var right = el('div', { class: 'kvr-set-c' });
    var row = el('div', { class: 'kvr-set-row' + (isDef() ? '' : ' kvr-changed') }, [left, right]);
    var put = function (v) { cfgOf(src)[f.k] = v; saveCfg(src); row.classList.toggle('kvr-changed', !isDef()); markStale(); refresh(); };
    if (f.kind === 'words') {
      // ordliste: hvert ord som en brikke med ×, og et felt for å legge til (komma gir flere på en gang)
      row.classList.add('kvr-set-words');
      var wrap = el('div', { class: 'kvr-words' });
      var draw = function () {
        wrap.innerHTML = '';
        var list = L.wordList(cur());
        if (!list.length) wrap.appendChild(el('span', { class: 'kvr-set-h', text: 'Tom liste: testen gir ingen treff.' }));
        list.forEach(function (w, i) {
          wrap.appendChild(el('span', { class: 'kvr-word' }, [document.createTextNode(w), el('button', { type: 'button', class: 'kvr-word-x', 'aria-label': 'Fjern ' + w, title: 'Fjern', text: '×', onclick: function () { var l = L.wordList(cur()); l.splice(i, 1); put(l.join(', ')); draw(); } })]));
        });
        var add = el('input', { type: 'text', 'aria-label': f.label + ': nytt ord', placeholder: 'nytt ord' });
        var doAdd = function () {
          var l = L.wordList(cur());
          L.wordList(add.value).forEach(function (w) { if (l.indexOf(w) === -1) l.push(w); });
          if (l.join(', ').length > L.WORDS_MAX) { add.value = ''; add.placeholder = 'listen er full'; return; }
          put(l.join(', ')); draw();
          var n = wrap.querySelector('input'); if (n) n.focus();
        };
        add.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
        wrap.appendChild(el('span', { class: 'kvr-row' }, [add, btn('Legg til', doAdd, 'kvr-sm')]));
        // kjente verdier som ikke allerede er dekket av listen, kan legges til med ett klikk
        var sug = (f.suggest || []).filter(function (w) { return !L.wordHit(w, L.wordList(cur())); });
        if (sug.length) wrap.appendChild(el('span', { class: 'kvr-words-sug' }, [el('span', { class: 'kvr-set-h', text: 'Kjente:' })].concat(sug.map(function (w) {
          return btn('+ ' + w, function () { var l = L.wordList(cur()); l.push(w.toLowerCase()); put(l.join(', ')); draw(); }, 'kvr-sm');
        }))));
      };
      draw();
      right.appendChild(wrap);
      return row;
    }
    if (f.kind === 'flag') {
      var fb = el('input', { type: 'checkbox' });
      fb.checked = src === 'anom' ? !!cur() : cur() !== '';
      fb.addEventListener('change', function () { put(src === 'anom' ? fb.checked : fb.checked ? (def || '1') : ''); });
      right.appendChild(el('label', { class: 'kvr-c kvr-set-sw' }, [fb, el('span', { text: 'På' })]));
      return row;
    }
    var inp = el('input', { type: f.kind === 'num' ? 'number' : f.kind === 'time' ? 'time' : 'text', step: 'any', 'aria-label': f.label });
    inp.value = String(cur());
    var sw = null;
    if (!f.off) right.appendChild(el('span', { class: 'kvr-set-sw kvr-set-sp' }));
    if (f.off) {
      sw = el('input', { type: 'checkbox', 'aria-label': f.label + ': på' });
      sw.checked = String(cur()) !== '';
      inp.disabled = !sw.checked;
      if (!sw.checked) inp.value = def;
      right.appendChild(el('label', { class: 'kvr-c kvr-set-sw' }, [sw, el('span', { text: 'På' })]));
      sw.addEventListener('change', function () {
        if (sw.checked) { inp.disabled = false; if (!inp.value.trim()) inp.value = def; put(inp.value.trim()); }
        else { inp.disabled = true; put(''); }
      });
    }
    inp.addEventListener('change', function () {
      var v = inp.value.trim();
      if (f.off && v === '') { sw.checked = false; inp.disabled = true; inp.value = def; put(''); return; }
      if (v === '') { inp.value = def; v = def; }
      put(v);
    });
    right.appendChild(inp);
    if (f.unit) right.appendChild(el('span', { class: 'kvr-set-u', text: f.unit }));
    return row;
  }

  function weightRow(title, refresh) {
    var inp = el('input', { type: 'number', step: '1', min: '0', 'aria-label': 'Poeng: ' + title });
    inp.value = weights[title];
    var row = el('div', { class: 'kvr-set-row' + (Number(weights[title]) === L.RISK_WEIGHTS[title] ? '' : ' kvr-changed') }, [
      el('div', { class: 'kvr-set-lw' }, [el('span', { class: 'kvr-set-l', text: title === 'Regel' ? 'Treff på egne regler' : title })]),
      el('div', { class: 'kvr-set-c' }, [inp, el('span', { class: 'kvr-set-u', text: 'poeng' })])]);
    inp.addEventListener('change', function () {
      weights[title] = hasNumber(inp.value) ? Number(inp.value) : L.RISK_WEIGHTS[title];
      inp.value = weights[title];
      store(K.weights, weights);
      row.classList.toggle('kvr-changed', Number(weights[title]) !== L.RISK_WEIGHTS[title]);
      renderCheck();
      refresh();
    });
    return row;
  }

  function resetGroup(g) {
    g.fields.forEach(function (f) { cfgOf(f.src)[f.k] = defOf(f.src)[f.k]; saveCfg(f.src); });
    g.weights.forEach(function (w) { weights[w] = L.RISK_WEIGHTS[w]; });
    store(K.weights, weights);
    if (g.fields.length) markStale();
    renderCheck();
    renderSettings(g.id);
    say('«' + g.title + '» er satt tilbake til standard.');
  }

  function settingGroup(g) {
    var badge = el('span', { class: 'kvr-set-badge' });
    var upd = function () {
      var n = L.groupChanges(g, ctlCfg, anomCfg, weights);
      badge.textContent = n + ' endret';
      badge.style.display = n ? '' : 'none';
    };
    var kids = [el('p', { class: 'kvr-set-t', text: g.text })];
    g.fields.forEach(function (f) { kids.push(settingRow(f, upd)); });
    if (g.weights.length) {
      kids.push(el('div', { class: 'kvr-set-sub', text: 'Poeng i risikoscore (høy fra 8, middels fra 4)' }));
      g.weights.forEach(function (w) { kids.push(weightRow(w, upd)); });
    }
    kids.push(btn('Standard for denne gruppen', function () { resetGroup(g); }, 'kvr-sm'));
    var d = el('details', { class: 'kvr-card kvr-set', 'data-sec': 'set-' + g.id }, [el('summary', {}, [el('b', { text: g.title }), badge]), el('div', { class: 'kvr-secbody' }, kids)]);
    upd();
    return d;
  }

  function settingsText() {
    return JSON.stringify({ app: 'kvitteringshenter', v: 1, ctl: ctlCfg, anom: anomCfg, weights: weights, customRules: customRules, groups: rules, stores: manualStores, camp: campDec, keynav: keyNav }, null, 2) + '\n';
  }

  function exportSettings() {
    download(new Blob([settingsText()], { type: 'application/json' }), FOLDER_FILE);
    say('Innstillingene er lastet ned.');
  }

  // ---- innstillinger i en mappe du velger (File System Access). Pluginen skriver bare filen FOLDER_FILE i den mappen.
  // Chrome krever et klikk for tilgang til mappen etter omstart. Er filen endret etter vår siste lagring (annen PC), skrives den ikke over før brukeren har valgt.
  var FOLDER_FILE = 'kvitteringshenter-innstillinger.json';
  var folder = { handle: null, state: '', at: 0, err: '', newer: 0, ready: false, timer: null };
  function isSettingsKey(k) { return [K.ctl, K.anom, K.weights, K.arules, K.rules, K.stores, K.camp, K.keynav].indexOf(k) !== -1; }
  function folderChanged() {
    if (!folder || !folder.ready || !folder.handle || folder.newer) return;
    clearTimeout(folder.timer);
    folder.timer = setTimeout(writeFolder, 800);
  }
  async function folderPerm(ask) {
    if (!folder.handle) return '';
    try {
      var p = await folder.handle.queryPermission({ mode: 'readwrite' });
      if (p !== 'granted' && ask) p = await folder.handle.requestPermission({ mode: 'readwrite' });
      folder.state = p;
    } catch (e) { folder.state = 'error'; folder.err = e && e.message ? e.message : String(e); }
    return folder.state;
  }
  async function readFolderFile() {
    var fh = await folder.handle.getFileHandle(FOLDER_FILE);
    var f = await fh.getFile();
    return { text: await f.text(), mod: f.lastModified || 0 };
  }
  async function writeFolder() {
    if (!folder.handle) return;
    if (await folderPerm(false) !== 'granted') { renderFolder(); return; }
    try {
      var fh = await folder.handle.getFileHandle(FOLDER_FILE, { create: true });
      var w = await fh.createWritable();
      await w.write(settingsText());
      await w.close();
      folder.at = Date.now(); folder.newer = 0; folder.err = '';
      store(K.folderAt, folder.at);
    } catch (e) { folder.err = 'Kunne ikke skrive til mappen: ' + (e && e.message ? e.message : e); }
    renderFolder();
  }
  // Ved oppstart og når tilgang gis: er filen i mappen endret etter vår siste lagring?
  async function checkFolderNewer() {
    if (await folderPerm(false) !== 'granted') return;
    try {
      var f = await readFolderFile(), last = Number(store(K.folderAt)) || 0;
      folder.newer = f.mod > last + 2000 && f.text !== settingsText() ? f.mod : 0;
    } catch (e) { folder.newer = 0; }
  }
  async function chooseFolder() {
    if (typeof window.showDirectoryPicker !== 'function') { say('Denne nettleseren kan ikke lagre i en mappe. Bruk «Eksporter innstillinger».'); return; }
    var h;
    try { h = await window.showDirectoryPicker({ id: 'kvitteringshenter', mode: 'readwrite' }); } catch (e) { return; }
    folder.handle = h; folder.err = ''; folder.newer = 0; folder.ready = true; mem[K.folder] = h;
    if (!putSafe(K.folder, h)) folder.err = 'Mappevalget huskes ikke etter omlasting; velg mappen på nytt neste gang.';
    if (await folderPerm(true) !== 'granted') { renderFolder(); return; }
    var have = null;
    try { have = await readFolderFile(); } catch (e) { have = null; }
    if (have && have.text !== settingsText()) {
      folder.newer = have.mod || Date.now();
      renderFolder();
      openModal('Mappen har innstillinger fra før', el('div', { class: 'kvr-secbody' }, [hintEl('Filen ' + FOLDER_FILE + ' i mappen «' + h.name + '» har andre innstillinger enn nettleseren. Hvilke skal gjelde?')]),
        [btn('Les inn fra mappen', function () { closeModal(); loadFromFolder(); }, 'kvr-primary'), btn('Skriv mine til mappen', function () { closeModal(); folder.newer = 0; writeFolder(); })]);
      return;
    }
    await writeFolder();
    say('Innstillingene lagres nå automatisk i mappen «' + h.name + '».');
  }
  async function grantFolder() {
    if (await folderPerm(true) !== 'granted') { renderFolder(); return; }
    await checkFolderNewer();
    if (!folder.newer) await writeFolder(); else renderFolder();
  }
  async function loadFromFolder() {
    if (await folderPerm(true) !== 'granted') { renderFolder(); return; }
    var f;
    try { f = await readFolderFile(); } catch (e) { say('Fant ikke ' + FOLDER_FILE + ' i mappen.'); return; }
    folder.newer = 0;
    importSettings(f.text);
    store(K.folderAt, Date.now());
    renderFolder();
  }
  function forgetFolder() {
    folder.handle = null; folder.state = ''; folder.err = ''; folder.newer = 0;
    delete mem[K.folder]; putSafe(K.folder, null);
    renderFolder();
    say('Mappen er glemt. Innstillingene ligger fortsatt i nettleseren.');
  }
  function renderFolder() {
    if (!ui.folderInfo) return;
    var h = folder.handle, t = function (ms) { return new Date(ms).toLocaleString('nb-NO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };
    var txt, btns = [];
    if (!h) { txt = 'Ingen mappe valgt. Innstillingene ligger bare i nettleseren på denne PC-en.'; btns = [btn('Velg mappe…', chooseFolder, 'kvr-primary')]; }
    else if (folder.state !== 'granted') {
      txt = 'Mappen «' + h.name + '» trenger tilgang på nytt (Chrome spør etter omstart). Endringer lagres ikke i mappen før du gir tilgang.';
      btns = [btn('Gi tilgang', grantFolder, 'kvr-primary'), btn('Glem mappen', forgetFolder)];
    } else if (folder.newer) {
      txt = 'Filen i mappen «' + h.name + '» er endret ' + t(folder.newer) + ', etter din siste lagring (for eksempel fra en annen PC). Den skrives ikke over før du har valgt.';
      btns = [btn('Les inn fra mappen', loadFromFolder, 'kvr-primary'), btn('Skriv mine til mappen', function () { folder.newer = 0; writeFolder(); }), btn('Glem mappen', forgetFolder)];
    } else {
      txt = 'Lagrer automatisk til mappen «' + h.name + '» (' + FOLDER_FILE + ').' + (folder.at ? ' Sist lagret ' + t(folder.at) + '.' : '');
      btns = [btn('Les inn fra mappen', loadFromFolder), btn('Bytt mappe…', chooseFolder), btn('Glem mappen', forgetFolder)];
    }
    ui.folderInfo.textContent = txt + (folder.err ? ' ' + folder.err : '');
    ui.folderBtns.innerHTML = '';
    btns.forEach(function (b) { ui.folderBtns.appendChild(b); });
  }

  function importSettings(text) {
    var d;
    try { d = JSON.parse(text); } catch (e) { d = null; }
    if (!d || d.app !== 'kvitteringshenter') { say('Ugyldig innstillingsfil.'); return; }
    ctlCfg = L.sanitizeControl(d.ctl); anomCfg = L.sanitizeAnom(d.anom); weights = L.sanitizeWeights(d.weights);
    store(K.ctl, ctlCfg); store(K.anom, anomCfg); store(K.weights, weights);
    if (Array.isArray(d.customRules)) { customRules = L.sanitizeCustom(d.customRules); saveCustom(); renderCustom(); }
    if (Array.isArray(d.groups)) { rules = L.sanitizeRules(d.groups); saveRules(); renderRules(); }
    if (typeof d.stores === 'string') { manualStores = d.stores; store(K.stores, manualStores); optsKey = ''; }
    if (d.camp) { campDec = L.sanitizeCamp(d.camp); store(K.camp, campDec); }
    keyNav = d.keynav !== false; store(K.keynav, keyNav);
    renderSettings();
    markStale();
    apply();
    say('Innstillingene er lest inn.');
  }

  function resetAllSettings() {
    ctlCfg = L.defaultControl(); anomCfg = L.defaultAnom(); weights = L.sanitizeWeights(null);
    store(K.ctl, ctlCfg); store(K.anom, anomCfg); store(K.weights, weights);
    renderSettings();
    markStale();
    renderCheck();
    say('Terskler og poeng er satt tilbake til standard.');
  }

  function renderSettings(openId) {
    if (!ui.setBody) return;
    var keep = {};
    Array.prototype.forEach.call(ui.setBody.querySelectorAll('details.kvr-set[open]'), function (d) { keep[d.getAttribute('data-sec')] = true; });
    if (openId) keep['set-' + openId] = true;
    ui.setBody.innerHTML = '';
    ui.setBody.appendChild(ui.setStale);
    renderStale();
    ui.setBody.appendChild(hintEl('Alt lagres med en gang. Terskler gjelder neste analyse, poeng gjelder med en gang. Av = testen kjøres ikke.'));
    ui.setBody.appendChild(ui.setGeneral);
    ui.keyNavBox.box.checked = keyNav;
    ui.storeNames.value = manualStores;
    L.SETTING_GROUPS.forEach(function (g) {
      var d = settingGroup(g);
      if (keep['set-' + g.id]) d.open = true;
      ui.setBody.appendChild(d);
    });
  }

  function openSettings(groupId) {
    ui.go('settings');
    var panel = document.getElementById('kvr-panel');
    if (panel && panel.classList.contains('kvr-collapsed')) panel.classList.remove('kvr-collapsed');
    if (groupId) {
      var d = ui.setBody && ui.setBody.querySelector('[data-sec=set-' + groupId + ']');
      if (d) { d.open = true; d.scrollIntoView({ block: 'start' }); }
    }
  }

  // ---- revisjonsrapport ---------------------------------------------------------------------
  var KvReport = window.KvReport;

  function reportLog() { var l = store(K.reports); return Array.isArray(l) ? l : []; }

  function renderReportLog() {
    if (!ui.repLog) return;
    var list = reportLog();
    ui.repLog.innerHTML = '';
    if (!list.length) { ui.repLog.appendChild(hintEl('Ingen rapporter laget ennå.')); return; }
    ui.repLog.appendChild(tbl(['Laget', 'Referanse', 'Flagget', 'Bevis', 'ZIP-kontrollsum'], list.slice().reverse().map(function (r) {
      return [r.at.slice(0, 16).replace('T', ' '), r.ref || '–', r.flagged + ' av ' + r.n, r.evidence, { node: btn(r.hash.slice(0, 12) + '…', function () { copyText(r.hash); }, 'kvr-ent') }];
    })));
    ui.repLog.appendChild(hintEl('Klikk en kontrollsum for å kopiere hele verdien. Loggen ligger bare i denne nettleseren.'));
  }

  function openReportDialog() {
    var R = ctlRes && ctlRes.snap;
    if (!R) {
      openModal('Revisjonsrapport', el('div', { class: 'kvr-secbody' }, [hintEl('Rapporten bygger på en kjørt analyse. Kjør analysen først (Analyse → Sjekk først).')]),
        [btn('Lukk', closeModal), btn('Kjør analyse', function () { closeModal(); ui.go('check'); runAnalysis(); }, 'kvr-primary')]);
      return;
    }
    var o = store(K.repopts) || {};
    var ref = el('input', { type: 'text', placeholder: 'f.eks. saksnr eller kontrolldato' });
    var who = el('input', { type: 'text', placeholder: 'navn' }); who.value = o.author || '';
    var ev = el('input', { type: 'number', min: '0', max: '100', step: '1' }); ev.value = o.evidence === undefined ? 30 : o.evidence;
    var nt = check('Ta med notater og status', function () {}); nt.box.checked = o.notes !== false;
    var ranked = L.rankReceipts(R.items, R.anom, weights);
    var kids = [
      hintEl('Omfang: ' + R.scopeText + ' · ' + R.items.length + ' bonger · ' + ranked.length + ' flaggede · analyse kjørt ' + new Date(R.at).toLocaleString('nb-NO') + '.'),
      field('Referanse / saksnr', ref), field('Utarbeidet av', who),
      field('Bevis-PNG for de høyest rangerte bongene (0 = ingen)', ev), nt.node
    ];
    if (settingsStale) kids.push(el('div', { class: 'kvr-notice' }, [el('span', { text: 'Innstillingene er endret etter analysen. Rapporten bruker verdiene fra analysen.' })]));
    kids.push(hintEl('Pakken er en ZIP med rapport.html, datafiler, innstillinger.json, bevisbilder og KONTROLLSUM.txt (SHA-256). Hvert bevisbilde tar ca. 1 sekund.'));
    openModal('Revisjonsrapport', el('div', { class: 'kvr-secbody' }, kids), [btn('Avbryt', closeModal), btn('Lag rapport (ZIP)', function () {
      var opts = { reference: ref.value.trim(), author: who.value.trim(), evidence: Math.max(0, Math.min(100, parseInt(ev.value, 10) || 0)), notes: nt.box.checked };
      store(K.repopts, { author: opts.author, evidence: opts.evidence, notes: opts.notes });
      closeModal();
      generateReport(opts);
    }, 'kvr-primary')]);
  }

  function compareForReport(R) {
    var sc = R.scopeObj;
    if (!sc || !sc.compare.on) return null;
    var iA = R.items.filter(function (it) { return inRange(it, sc.dateFrom, sc.dateTo); });
    var iB = R.items.filter(function (it) { return inRange(it, sc.compare.from, sc.compare.to); });
    var c = L.comparePeriods(iA, iB, R.scan, R.anom, weights, R.ctl);
    var row = function (label, r, flags) {
      return { label: label, nA: r.A.count, nB: r.B.count, ret: pct(r.A.retShare) + ' → ' + pct(r.B.retShare), avg: fmt(r.A.avg) + ' → ' + fmt(r.B.avg), score: r.A.score + ' → ' + r.B.score, flags: flags };
    };
    return [row('Alle', { A: c.total.A, B: c.total.B }, '')].concat(c.rows.map(function (r) { return row('Kasserer ' + r.id, r, r.flags.join(', ')); }));
  }

  async function generateReport(opts) {
    var C = ctlRes, R = C && C.snap;
    if (!R || scanning) return;
    if (!window.JSZip || (opts.evidence > 0 && !window.html2canvas)) { say('Biblioteker (html2canvas/JSZip) er ikke lastet.'); return; }
    scanning = true; cancelScan = false;
    ui.scanBtn.disabled = true; ui.anomBtn.disabled = true; ui.stopBtn.disabled = false; ui.stopTop.style.display = ''; ui.retryBtn.disabled = true; if (ui.retryBtn2) ui.retryBtn2.disabled = true;
    var prev = grid.select(), prevTr = prev && prev[0];
    try {
      var ranked = L.rankReceipts(R.items, R.anom, weights);
      var pick = ranked.slice(0, opts.evidence), files = [], missing = [], t0 = Date.now();
      for (var i = 0; i < pick.length && !cancelScan; i++) {
        progress(i, pick.length, t0, 'Bevis-PNG', missing.length);
        var rec = recById(pick[i].id);
        try {
          if (!rec) throw new Error('ikke i listen');
          var blob = await renderPngFor(rec, { layout: 'bong', header: true, member: false });
          var bytes = new Uint8Array(await blob.arrayBuffer());
          files.push({ id: pick[i].id, path: 'bevis/' + String(i + 1).padStart(2, '0') + '_' + String(rec.item.bongnr).replace(/[^A-Za-z0-9_-]/g, '-') + '.png', hash: KvReport.sha256Bytes(bytes), blob: blob, src: 'data:image/png;base64,' + base64(bytes) });
        } catch (e) { missing.push(pick[i].id); }
        }
      if (cancelScan) { say('Rapporten er avbrutt.'); return; }
      progress(pick.length ? pick.length - 1 : 0, Math.max(pick.length, 1), t0, 'Pakker rapport', 0);
      var byId = {}, explain = {}, noteSub = {};
      files.forEach(function (f) { byId[f.id] = { path: f.path }; });
      ranked.forEach(function (rk) {
        explain[rk.id] = rk.reasons.map(function (r) { return L.explainReason(r, { id: rk.id, cfg: R.anomCfg, ctl: R.ctl, findings: C.findings, rules: customRules }); });
        var n = notes[rk.id];
        if (opts.notes && n && (n.status || n.note)) noteSub[rk.id] = { status: n.status || '', note: n.note || '' };
      });
      var model = {
        version: KvReport.VERSION, generatedAt: new Date().toISOString(), generatedLocal: new Date().toLocaleString('nb-NO'), analysedAt: new Date(R.at).toISOString(), analysedLocal: new Date(R.at).toLocaleString('nb-NO'),
        reference: opts.reference, author: opts.author, timeShift: R.timeShift || 0, notelog: (function () { if (!nlog) loadNoteLog(); return { base: nlog.base || '', list: nlog.list.slice() }; })(),
        scope: { text: R.scopeText, mode: R.mode, filters: R.filters, coverageText: R.coverageText, compare: R.compare },
        items: R.items, pop: R.pop, scan: R.scan, storeLabels: R.storeLabels,
        settings: { ctl: R.ctl, anom: R.anomCfg, weights: weights, currentDiffers: KvReport.stable([R.ctl, R.anomCfg]) !== KvReport.stable([ctlCfg, anomCfg]) },
        checks: { falseRet: { coverage: C.falseRet.coverage, lineCheck: C.falseRet.lineCheck }, voids: C.voids ? { applicable: C.voids.applicable, coverage: C.voids.coverage } : null, campaign: C.disc && C.disc.camp ? { pending: C.disc.camp.pending, items: C.disc.camp.items.filter(function (e) { return e.status; }).map(function (e) { return { c: e.c, name: e.name, rateText: e.rateText, n: e.n, status: e.status }; }) } : null, numbers: C.numbers, ledger: C.ledger ? { lines: C.ledger.lines, pay: C.ledger.pay, vat: C.ledger.vat, refs: C.ledger.refs } : null },
        findings: C.findings, ranked: ranked, explain: explain, notes: noteSub,
        cashiers: L.rankCashiers(R.items, R.anom, weights, C.profile, C.cashierExtra).slice(0, 10),
        compare: compareForReport(R), failedScans: failedRecs.length, cwxRun: R.cwxRun || null, archInfo: R.archInfo || null,
        evidence: { files: files.map(function (f) { return { id: f.id, path: f.path, hash: f.hash, src: f.src }; }), byId: byId, missing: missing, requested: pick.length, cappedFrom: ranked.length },
        settingsJson: JSON.stringify({ app: 'kvitteringshenter', v: 1, ctl: R.ctl, anom: R.anomCfg, weights: weights, customRules: customRules, groups: rules, stores: manualStores, camp: campDec, keynav: keyNav }, null, 2) + '\n'
      };
      var built = KvReport.build(model);
      var zip = new window.JSZip();
      built.files.forEach(function (f) { zip.file(f.path, f.text, { compression: 'DEFLATE' }); });
      files.forEach(function (f) { zip.file(f.path, f.blob, { compression: 'STORE' }); });
      var zb = await zip.generateAsync({ type: 'blob' });
      var zhash = KvReport.sha256Bytes(new Uint8Array(await zb.arrayBuffer()));
      var now = new Date().toISOString();
      var name = 'revisjonsrapport_' + now.slice(0, 10).replace(/-/g, '') + '_' + now.slice(11, 16).replace(':', '') + '.zip';
      download(zb, name);
      var log = reportLog().concat([{ at: now, ref: opts.reference, author: opts.author, scope: R.scopeText, n: R.items.length, flagged: ranked.length, evidence: files.length, hash: zhash, name: name, version: KvReport.VERSION }]).slice(-30);
      store(K.reports, log);
      renderReportLog();
      var out = el('input', { type: 'text', readonly: 'readonly' }); out.value = zhash;
      out.addEventListener('focus', function () { out.select(); });
      openModal('Rapport laget', el('div', { class: 'kvr-secbody' }, [
        hintEl(name + ' er lastet ned: ' + (built.files.length + files.length) + ' filer, ' + files.length + ' bevis-PNG' + (missing.length ? ' (' + missing.length + ' mangler)' : '') + '.'),
        field('Kontrollsum for ZIP-filen (SHA-256)', out),
        hintEl('Noter kontrollsummen i saken. Den kan ikke ligge i selve filen. Innholdet verifiseres med KONTROLLSUM.txt i pakken.')
      ]), [btn('Kopier kontrollsum', function () { copyText(zhash); }), btn('Lukk', closeModal, 'kvr-primary')]);
      say('Revisjonsrapport laget: ' + name);
    } catch (e) {
      say('Rapporten feilet: ' + (e && e.message ? e.message : e));
    } finally {
      if (prevTr) grid.select(prevTr); else if (typeof grid.clearSelection === 'function') grid.clearSelection();
      setProgress(0);
      scanning = false;
      ui.scanBtn.disabled = false; ui.anomBtn.disabled = false; ui.stopBtn.disabled = true;
      syncRetry();
    }
  }

  // ---- panel ----------------------------------------------------------------
  function section(id, title, kids) {
    return el('div', { class: 'kvr-card', 'data-sec': id }, [el('h4', { text: title }), el('div', { class: 'kvr-secbody' }, kids)]);
  }

  function tile(label) {
    var v = el('b', { text: '–' });
    return { node: el('div', { class: 'kvr-tile' }, [v, el('span', { text: label })]), value: v };
  }

  // Stor/Full gjelder bare når panelet er åpent. Minimert er det en liten knapp med vanlig plassering, uansett størrelse.
  function bigMode(panel) { return curSize > 0 && !panel.classList.contains('kvr-collapsed'); }

  function clamp(panel) {
    if (bigMode(panel)) { if (modePos(curSize)) clampBig(panel); return; }
    var w = panel.offsetWidth, keep = panel.classList.contains('kvr-collapsed') ? 48 : 200;
    var left = Math.min(Math.max(0, parseFloat(panel.style.left) || 0), Math.max(0, window.innerWidth - w));
    var top = Math.min(Math.max(0, parseFloat(panel.style.top) || 0), Math.max(0, window.innerHeight - keep));
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    panel.style.maxHeight = Math.max(160, window.innerHeight - top - 12) + 'px';
  }

  // Stor og Full kan også flyttes. Plasseringen lagres per størrelse (K.pos2 = { 1: {left, top}, 2: {...} }); uten lagret plassering dokkes panelet som før.
  // Inline-stil med !important trengs fordi dokkingen i CSS bruker !important.
  function modePos(mode) { var all = store(K.pos2) || {}; var p = all[mode]; return p && typeof p.left === 'number' && typeof p.top === 'number' ? p : null; }
  function setModePos(mode, pos) {
    var all = Object.assign({}, store(K.pos2) || {});
    if (pos) all[mode] = pos; else delete all[mode];
    store(K.pos2, all);
  }
  function putImportant(panel, left, top) {
    panel.style.setProperty('left', left + 'px', 'important');
    panel.style.setProperty('top', top + 'px', 'important');
    panel.style.setProperty('right', 'auto', 'important');
  }
  function clampBig(panel) {
    var r = panel.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    // minst 260 px synlig til venstre (så tittellinjen kan gripes, ikke bare knappene), minst 120 px til høyre
    var left = Math.min(Math.max(r.left, Math.min(0, 260 - r.width)), vw - 120);
    var top = Math.min(Math.max(r.top, 0), Math.max(0, vh - 48));
    putImportant(panel, left, top);
  }
  function applyModePos(panel) {
    if (!bigMode(panel)) {
      if (panel.style.getPropertyPriority('left') === 'important') ['left', 'top', 'right'].forEach(function (k) { panel.style.removeProperty(k); });
      // minimert i Stor/Full: uten plassering ville knappen havne nederst på siden, utenfor skjermen
      if (curSize > 0) placePanel(panel);
      return;
    }
    ['left', 'top', 'right'].forEach(function (k) { panel.style.removeProperty(k); });
    var p = modePos(curSize);
    if (p) { putImportant(panel, p.left, p.top); clampBig(panel); }
  }

  // Panelstørrelse: 0 vanlig, 1 stor (dokket til høyre, lista i Lindbak er fortsatt synlig til venstre), 2 full (hele skjermen).
  var curSize = 0;
  var SIZE_NAMES = ['Vanlig', 'Stor', 'Full'];

  function sizeMode() {
    var v = store(K.wide);
    return v === true ? 1 : Math.max(0, Math.min(2, Number(v) || 0));
  }

  function paintSizeMode() {
    var panel = document.getElementById('kvr-panel');
    if (!panel) return;
    panel.classList.toggle('kvr-big', curSize === 1);
    panel.classList.toggle('kvr-full', curSize === 2);
    document.documentElement.classList.toggle('kvr-bigui', curSize > 0);
    if (ui.wideBtn) {
      ui.wideBtn.textContent = curSize === 0 ? '⤢' : curSize === 1 ? '⛶' : '⤡';
      ui.wideBtn.title = curSize === 0 ? 'Større panel (dokket til høyre, lista beholdes)' : curSize === 1 ? 'Fullskjerm' : 'Tilbake til vanlig størrelse';
    }
    if (ui.sizeSel) ui.sizeSel.value = String(sizeMode());
  }

  // persist = false: midlertidig bytte (for eksempel for å vise en bong i lista), huskes ikke.
  function setSizeMode(mode, persist) {
    var panel = document.getElementById('kvr-panel');
    if (!panel) return;
    var was = curSize;
    curSize = mode;
    if (persist) store(K.wide, mode);
    if (was > 0 && mode === 0) { panel.style.width = ''; panel.style.height = ''; store(K.size, null); }
    paintSizeMode();
    applyModePos(panel);
    if (mode === 0) placePanel(panel);
    setTimeout(renderChartsIfVisible, 80);
  }

  function placePanel(panel) {
    var pos = store(K.pos);
    var size = store(K.size);
    if (size && size.width) panel.style.width = size.width;
    if (size && size.height) panel.style.height = size.height;
    if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
      panel.style.left = pos.left + 'px';
      panel.style.top = pos.top + 'px';
    } else {
      panel.style.left = Math.max(0, window.innerWidth - (panel.offsetWidth || 352) - 12) + 'px';
      panel.style.top = '70px';
    }
    clamp(panel);
  }

  function enableDrag(panel, head, onTap) {
    var start = null;
    head.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || e.target.closest('button')) return;
      var r0 = panel.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, left: r0.left, top: r0.top, moved: false };
      head.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    head.addEventListener('pointermove', function (e) {
      if (!start) return;
      var dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) start.moved = true;
      if (!start.moved) return;
      panel.classList.add('kvr-dragging');
      if (bigMode(panel)) { putImportant(panel, start.left + dx, start.top + dy); clampBig(panel); return; }
      panel.style.left = (start.left + dx) + 'px';
      panel.style.top = (start.top + dy) + 'px';
      clamp(panel);
    });
    head.addEventListener('pointerup', function () {
      if (!start) return;
      var moved = start.moved;
      start = null;
      panel.classList.remove('kvr-dragging');
      if (moved) { if (bigMode(panel)) setModePos(curSize, { left: parseFloat(panel.style.left), top: parseFloat(panel.style.top) }); else store(K.pos, { left: parseFloat(panel.style.left), top: parseFloat(panel.style.top) }); }
      else onTap();
    });
    head.addEventListener('pointercancel', function () { start = null; panel.classList.remove('kvr-dragging'); });
    head.addEventListener('dblclick', function (e) {
      if (e.target.closest('button')) return;
      if (bigMode(panel)) { setModePos(curSize, null); applyModePos(panel); return; }
      store(K.pos, null);
      store(K.size, null);
      panel.style.width = ''; panel.style.height = '';
      placePanel(panel);
    });
  }

  // Panelet skal alltid kunne nås. Er det utenfor skjermen (lagret plassering fra et annet vindu), fjernet fra siden eller dekket av noe i CW,
  // nullstilles plasseringen eller panelet løftes øverst. Sjekkes hvert 1,5 sekund sammen med gridet.
  var panelEl = null, coverFixes = 0, rescued = 0;
  function ensureVisible() {
    var panel = panelEl, why = '';
    if (!panel) return;
    if (!panel.isConnected) { document.body.appendChild(panel); why = 'fjernet fra siden'; }
    var r = panel.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    var keepH = panel.classList.contains('kvr-collapsed') ? 40 : 120;
    if (r.width < 20 || r.height < 20 || r.right < 120 || r.left > vw - 120 || r.bottom < 60 || r.top > vh - keepH) {
      store(K.pos, null); store(K.size, null);
      panel.style.width = ''; panel.style.height = '';
      if (bigMode(panel)) { setModePos(curSize, null); applyModePos(panel); } else placePanel(panel);
      why = why || 'utenfor skjermen';
    } else if (coverFixes < 3) {
      var hr = (panel.querySelector('.kvr-head') || panel).getBoundingClientRect();
      var hit = document.elementFromPoint(hr.left + hr.width / 2, hr.top + hr.height / 2);
      if (hit && !panel.contains(hit) && !(hit.closest && hit.closest('.kvr-modal'))) {
        coverFixes++;
        (coverFixes === 1 ? document.body : document.documentElement).appendChild(panel);
        why = why || 'dekket av siden';
      }
    }
    if (why && rescued < 5) {
      rescued++;
      try { console.info('[Kvitteringshenter] panelet var ' + why + ' og ble hentet fram.'); } catch (e) { /* ingen konsoll */ }
    }
  }

  function buildPanel() {
    var panel = el('div', { id: 'kvr-panel' });
    panelEl = panel;

    ui.badge = el('span', { class: 'kvr-badge', text: 'ingen filter' });
    var toggle = el('button', { type: 'button', class: 'kvr-icon', title: 'Skjul/vis (Alt+K)', text: '–' });
    ui.wideBtn = el('button', { type: 'button', class: 'kvr-icon', title: 'Større panel', 'aria-label': 'Panelstørrelse', text: '⤢' });
    ui.helpBtn = el('button', { type: 'button', class: 'kvr-icon', title: 'Hjelp og tegnforklaring', 'aria-label': 'Hjelp', text: '?' });
    ui.gearBtn = el('button', { type: 'button', class: 'kvr-icon', title: 'Innstillinger', 'aria-label': 'Innstillinger', text: '⚙' });
    ui.helpBtn.addEventListener('click', openHelp);
    ui.gearBtn.addEventListener('click', function () { openSettings(); });
    var head = el('div', { class: 'kvr-head', title: 'Dra for å flytte · dobbeltklikk for å nullstille plassering og størrelse' }, [
      el('span', { class: 'kvr-grip', text: '⠿' }),
      el('span', { class: 'kvr-title', text: 'Kvitteringshenter' }),
      ui.badge,
      ui.helpBtn,
      ui.gearBtn,
      ui.wideBtn,
      toggle
    ]);

    var t1 = tile('Viser'), t2 = tile('Valgt'), t3 = tile('Sum valgt (kr)'), t4 = tile('Duplikater');
    ui.stVisible = t1.value; ui.stSelected = t2.value; ui.stSum = t3.value; ui.stDup = t4.value;
    ui.pantLine = el('div', { class: 'kvr-pantline', text: '' });
    ui.bar = el('div', { class: 'kvr-bar' });
    ui.barWrap = el('div', { class: 'kvr-barwrap', style: 'display:none' }, [ui.bar]);
    ui.chips = el('div', { class: 'kvr-chipsrow' });
    ui.opText = el('span', { class: 'kvr-optext' });
    ui.stopTop = el('button', { type: 'button', class: 'kvr-btn kvr-sm', text: 'Stopp', style: 'display:none', onclick: function () { cancelScan = true; } });
    ui.opRow = el('div', { class: 'kvr-oprow', 'aria-live': 'polite', style: 'display:none' }, [ui.opText, ui.stopTop]);
    ui.scanTxt = el('span', { class: 'kvr-scantxt' });
    ui.scanNow = btn('Skann nå', scanVisible, 'kvr-sm kvr-primary');
    ui.scanRow = el('div', { class: 'kvr-scanrow', style: 'display:none' }, [ui.scanTxt, ui.scanNow]);
    ui.scanWarnTxt = el('span', {});
    ui.scanWarnBtn = btn('Skann nå', scanVisible, 'kvr-sm');
    ui.scanWarn = el('div', { class: 'kvr-scanwarn', role: 'status', style: 'display:none' }, [ui.scanWarnTxt, ui.scanWarnBtn]);
    ui.firstRun = el('div', { class: 'kvr-notice kvr-first', role: 'status', style: store(K.help) ? 'display:none' : '' }, [
      el('span', { text: 'Første gang? Se kort veiledning og tegnforklaring.' }),
      btn('Åpne', openHelp, 'kvr-sm kvr-primary'),
      btn('✕', function () { store(K.help, 1); ui.firstRun.style.display = 'none'; }, 'kvr-sm')]);
    ui.firstRun.lastChild.title = 'Skjul';
    ui.waitNote = el('div', { class: 'kvr-notice', role: 'status', style: 'display:none' }, [el('span', { text: 'Venter på listen i CW. Hent kvitteringer i Lindbak (Oppdater), så kobles pluginen til listen.' })]);
    ui.hideAllTxt = el('span', {});
    ui.hideAll = el('div', { class: 'kvr-notice', role: 'status', style: 'display:none' }, [ui.hideAllTxt, btn('Vis alle', function () { resetFilters(); say('Filtrene i pluginen er nullstilt. CW-søket er ikke endret.'); }, 'kvr-sm kvr-primary')]);
    var stats = el('div', { class: 'kvr-stats' }, [ui.firstRun, ui.waitNote, ui.hideAll, el('div', { class: 'kvr-tiles' }, [t1.node, t2.node, t3.node, t4.node]), ui.chips, ui.scanRow, ui.scanWarn, ui.pantLine, ui.opRow, ui.barWrap]);

    // --- Søk i CW
    var cwFrom = el('input', { type: 'date' }), cwTo = el('input', { type: 'date' });
    ui.cwFrom = cwFrom; ui.cwTo = cwTo;
    cwFrom.addEventListener('change', function () { cw.dateFrom = cwFrom.value; if (!cwTo.value) { cwTo.value = cwFrom.value; cw.dateTo = cwFrom.value; } summary(); });
    cwTo.addEventListener('change', function () { cw.dateTo = cwTo.value; summary(); });
    var cwQ = el('input', { type: 'text', placeholder: 'søk butikk (navn eller nr)' });
    cwQ.addEventListener('input', function () { cw.storeQuery = cwQ.value; renderCwStores(); });
    ui.cwStores = el('div', { class: 'kvr-checklist', role: 'group', 'aria-label': 'Butikker' });
    ui.cwCount = el('div', { class: 'kvr-hint', text: '0 butikker valgt' });
    var cwMem = el('input', { type: 'text', placeholder: 'medlemsnr, kommaseparert' });
    var cwLoy = el('input', { type: 'text', placeholder: 'lojalitets-ID, kommaseparert' });
    var cwFree = el('input', { type: 'text', placeholder: 'EAN eller varenavn' });
    var cwBong = el('input', { type: 'text', placeholder: 'bongnr' });
    ui.cwMem = cwMem; ui.cwLoy = cwLoy; ui.cwFree = cwFree; ui.cwBong = cwBong;
    cwMem.addEventListener('input', function () { cw.members = cwMem.value.trim(); summary(); });
    cwLoy.addEventListener('input', function () { cw.loyal = cwLoy.value.trim(); summary(); });
    cwFree.addEventListener('input', function () { cw.free = cwFree.value.trim(); summary(); });
    cwBong.addEventListener('input', function () { cw.bong = cwBong.value.trim(); summary(); });
    ui.cwStatus = el('div', { class: 'kvr-note', text: '' });
    ui.cwxBtn = btn('Hent tilleggsdata fra CW', fetchCwExtra);
    ui.cwxStop = btn('Stopp', stopCwExtra);
    ui.cwxStop.disabled = true;
    ui.cwxStatus = el('div', { class: 'kvr-note', role: 'status', text: '' });
    ui.cwxInfo = el('div', {});
    var secCw = section('cw', 'Søk i hele journalen (CW)', [
      el('div', { class: 'kvr-row' }, [field('Dato fra', cwFrom), field('Dato til', cwTo)]),
      field('Butikker (navn som i CW)', cwQ), ui.cwStores, ui.cwCount,
      field('Medlemsnr', cwMem), field('Lojalitets-ID', cwLoy),
      el('div', { class: 'kvr-row' }, [field('Vare (EAN/navn)', cwFree), field('Bongnr', cwBong)]),
      el('div', { class: 'kvr-row' }, [btn('Søk i CW', cwSearch, 'kvr-primary'), btn('Nullstill CW', cwReset)]),
      ui.cwStatus,
      el('b', { class: 'kvr-subh', text: 'Tilleggsdata fra CW' }),
      hintEl('Bruker CWs egne filtre på søket du har i listen: hvert innholdsvalg (slettet vare, manuell rabatt, makulert, manuell pant, retur, parkert, spør pris, Vensafe …), betalingsmåtene kontant, kontant tilbake, kreditt, kupong, tilgodelapp, gavekort og finansiering, og systembongene (innlogging, utlogging, bongkopi, bankavstemming, dagsavslutning). Ett søk om gangen med pause mellom, omtrent 20 søk. Filtrene og søket ditt settes tilbake etterpå. Fritekst brukes ikke.'),
      el('div', { class: 'kvr-row' }, [ui.cwxBtn, ui.cwxStop]),
      ui.cwxStatus, ui.cwxInfo
    ], true);
    renderCwx();

    // --- Hent og skann i deler
    ui.partBtn = btn('Hent og skann i deler', fetchParts, 'kvr-primary');
    ui.partStop = btn('Stopp', stopParts);
    ui.partStop.disabled = true;
    ui.partScan = check('Skann bongene', function () {});
    ui.partScan.box.checked = true;
    ui.partExtra = check('Hent tilleggsdata fra CW for hver dag', function () {});
    ui.partStatus = el('div', { class: 'kvr-note', role: 'status', text: '' });
    ui.partInfo = el('div', {});
    var secParts = section('parts', 'Hent og skann i deler', [
      hintEl('For perioder med mer enn 1000 bonger. Bruker dato, butikker og medlemsnr fra «Søk i hele journalen» over. Pluginen søker én dag om gangen; en dag med 1000 bonger deles på klokkeslett (CWs fra- og til-tid), og en del som fortsatt har 1000 bonger, deles igjen. Hver del skannes mens den står i listen, og radene samles i pluginens egen database. Analysen bruker det samlede grunnlaget sammen med listen. Dager som er hentet før (unntatt i dag), hoppes over, så du kan stoppe og fortsette. Skanning tar 0,6–1 sekund per bong (fartsregulatoren holder igjen når CW er treg); «Rask skanning» under Skann tar bare bonger med funn fra CW.'),
      el('div', { class: 'kvr-row' }, [ui.partScan.node, ui.partExtra.node]),
      el('div', { class: 'kvr-row' }, [ui.partBtn, ui.partStop, btn('Tøm samlet grunnlag', function () {
        confirmBox('Tøm samlet grunnlag', 'Fjerne ' + archCount() + ' bonger fra samlet grunnlag? Skannet innhold beholdes.', 'Tøm', function () { clearArchive(); apply(); renderParts(); partSay('Samlet grunnlag er tømt.'); });
      }, 'kvr-sm')]),
      ui.partStatus, ui.partInfo
    ]);
    renderParts();

    // --- Dato og tid (lokalt)
    var quick = el('div', { class: 'kvr-chips' });
    [['today', 'I dag'], ['yesterday', 'I går'], ['last24h', 'Siste 24 t'], ['night', 'Natt 00–06'], ['day', 'Dag 06–18'], ['evening', 'Kveld 18–24']].forEach(function (q) {
      quick.appendChild(btn(q[1], function () {
        var r = L.quickRange(q[0]);
        if (q[0] === 'night' || q[0] === 'day' || q[0] === 'evening') { filters.timeFrom = r.timeFrom; filters.timeTo = r.timeTo; }
        else { filters.dateFrom = r.dateFrom; filters.dateTo = r.dateTo; filters.timeFrom = ''; filters.timeTo = ''; }
        writeForm(); apply();
      }, 'kvr-chip'));
    });
    ui.dateFrom = input('date'); ui.dateTo = input('date');
    ui.timeFrom = input('time'); ui.timeTo = input('time');
    var secTime = section('time', 'Dato og tid', [
      quick,
      el('div', { class: 'kvr-row' }, [field('Dato fra', ui.dateFrom), field('Dato til', ui.dateTo)]),
      el('div', { class: 'kvr-row' }, [field('Tid fra', ui.timeFrom), field('Tid til', ui.timeTo)])
    ], true);

    ui.stores = storeBox(null, true); ui.workstations = pills(); ui.cashiers = pills(); ui.types = pills();
    var storeNames = el('textarea', { rows: '3', placeholder: '1001=Butikknavn', title: 'Egne butikknavn (nr=navn per linje). Brukes hvis CW-listen ikke finnes.' });
    storeNames.value = manualStores;
    storeNames.addEventListener('change', function () { manualStores = storeNames.value; store(K.stores, manualStores); optsKey = ''; apply(); });
    var secStore = section('store', 'Butikk', [ui.stores]);
    var secWho = section('who', 'Kasse, kasserer og type', [
      pfield('Kasse', ui.workstations), pfield('Kasserer', ui.cashiers), pfield('Type', ui.types)
    ], true);

    ui.sumMin = input('number', { step: '0.01', placeholder: 'min' });
    ui.sumMax = input('number', { step: '0.01', placeholder: 'maks' });
    var neg = check('Negativ sum (retur/panteretur)'); ui.onlyNegative = neg.box;
    ui.member = input('text', { placeholder: 'medlemsnr' });
    var mem = check('Kun med medlem'); ui.onlyMember = mem.box;
    var dp = check('Kun mulige duplikater'); ui.onlyDup = dp.box;
    ui.bong = input('text', { placeholder: 'bongnr, f.eks. 1005-6-123' });
    ui.note = el('select', {}, [opt('', 'Alle'), opt('any', 'Har notat eller status'), opt('oppfolging', 'Til oppfølging'), opt('sjekket', 'Sjekket')]);
    ui.note.addEventListener('change', onChange);
    ui.item = input('text', { placeholder: 'EAN eller varenavn (skannede)' });
    ui.text = input('text', { placeholder: 'ord, EAN, beløp, kortnr, referanse …' });
    ui.pay = el('select', { 'aria-label': 'Betalingsmåte' }, [el('option', { value: '', text: 'Alle' })]);
    ui.pay.addEventListener('change', onChange);
    var secSum = section('sum', 'Sum, medlem og bong', [
      el('div', { class: 'kvr-row' }, [field('Sum fra', ui.sumMin), field('Sum til', ui.sumMax)]),
      neg.node, field('Medlemssøk', ui.member), mem.node, dp.node,
      field('Bongnr', ui.bong), field('Notat/status', ui.note)
    ], true);

    // --- Skanning og pant
    ui.pant = el('select', { 'aria-label': 'Pant' }, [
      el('option', { value: '', text: 'Alle' }),
      el('option', { value: 'any', text: 'Har pant eller panteretur' }),
      el('option', { value: 'sale', text: 'Har pant (salg)' }),
      el('option', { value: 'return', text: 'Har panteretur' })
    ]);
    ui.pant.addEventListener('change', onChange);
    ui.disc = el('select', { 'aria-label': 'Rabatt' }, [
      el('option', { value: '', text: 'Alle' }),
      el('option', { value: 'any', text: 'Har rabatt (rabattlinje)' }),
      el('option', { value: 'noreason', text: 'Rabatt uten årsak' }),
      el('option', { value: 'reason', text: 'Rabatt med årsak' }),
      el('option', { value: 'coupon', text: 'Har kupong (kampanje)' })
    ].concat(L.DISC_REASONS.map(function (r) { return el('option', { value: 'r:' + r, text: 'Årsak: ' + r }); })));
    ui.disc.addEventListener('change', onChange);
    ui.discFrom = input('number', { step: '1', min: '0', placeholder: 'fra %' });
    ui.discTo = input('number', { step: '1', min: '0', placeholder: 'til %' });
    ui.special = el('select', { 'aria-label': 'Spesialbetaling' }, [el('option', { value: '', text: 'Alle' })]);
    ui.special.addEventListener('change', onChange);
    ui.scanBtn = btn('Skann innhold (synlige)', scanVisible, 'kvr-primary');
    ui.stopBtn = btn('Stopp', function () { cancelScan = true; });
    ui.stopBtn.disabled = true;
    ui.retryBtn = btn('Prøv feilede på nytt', function () { if (lastRetry) lastRetry(); });
    ui.retryBtn.disabled = true;
    ui.quickBox = check('Rask skanning: bare bonger med funn fra CW', function () { quickScan = ui.quickBox.box.checked; store(K.quick, quickScan); renderScanState(); if (quickScan && !(cwx && Object.keys(cwx.tags).length)) say('Rask skanning trenger tilleggsdata fra CW (Hent → Tilleggsdata fra CW). Til de er hentet, skannes alle.'); });
    ui.quickBox.box.checked = quickScan;
    var secScan = section('scan', 'Skanning', [
      el('div', { class: 'kvr-row' }, [ui.scanBtn, ui.stopBtn]),
      el('div', { class: 'kvr-row' }, [ui.retryBtn, btn('Tøm cache', function () {
        clearScan(); clearArchive(); anomMap = {}; ctlRes = null; checkState.at = null; failedRecs = []; lastRetry = null; syncRetry(); say('Cache tømt: skannet innhold, tilleggsdata fra CW og samlet grunnlag.'); apply(); renderControl(); renderCwx(); renderParts();
      })]),
      ui.quickBox.node,
      el('div', { class: 'kvr-hint', text: 'Hver kvittering åpnes i CWs visningsfelt og leses derfra. Pluginen sender aldri egne kall mot CWs API. Fartsregulatoren tar høyst én bong per 0,6 s, og senker farten når CW svarer tregere enn normalt (pause ved tre trege svar på rad, stopp når CW ikke svarer på seks bonger på rad). Rask skanning tar bare bonger CWs filtre har merket (Hent → Tilleggsdata fra CW), returer og bonger som ikke er vanlige salg; tester som trenger alle salg, får da lav dekning og står over. Ikke bruk CWs søk eller liste mens skanningen går. Chrome bremser faner som er skjult, så la Lindbak stå i et eget vindu ved siden av det du jobber i.' })
    ], true);

    // --- Varegrupper
    ui.groups = pills();
    ui.groupSums = el('div', {});
    ui.unmatched = el('div', {});
    ui.rules = el('div', {});
    var fileIn = el('input', { type: 'file', accept: 'application/json', style: 'display:none' });
    fileIn.addEventListener('change', function () {
      var f = fileIn.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try { rules = L.sanitizeRules(JSON.parse(fr.result)); saveRules(); renderRules(); apply(); } catch (e) { say('Ugyldig regelfil.'); }
      };
      fr.readAsText(f);
      fileIn.value = '';
    });
    var rulesDetails = el('details', { class: 'kvr-sub' }, [el('summary', { text: 'Regelsett (rekkefølge = prioritet)' }), ui.rules,
      el('div', { class: 'kvr-row' }, [
        btn('Ny gruppe', function () { rules.push({ name: 'Ny gruppe', include: [], exclude: [] }); saveRules(); renderRules(); }),
        btn('Eksporter', function () { download(new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' }), 'varegrupper.json'); }),
        btn('Importer', function () { fileIn.click(); }),
        btn('Standard', function () { confirmBox('Standard varegrupper', 'Tilbakestille varegruppene til standardregler? Egne grupper og opplærte nøkkelord går tapt.', 'Tilbakestill', function () { rules = L.defaultRules(); saveRules(); renderRules(); apply(); }); })
      ]), fileIn]);
    var secContent = section('content', 'Innhold', [
      hintEl('Filtre som leser innholdet på kvitteringene. De krever at kvitteringene er skannet: bruk «Skann nå» øverst, eller fanen Skann.'),
      field('Søk i bongen (alt innhold, flere ord)', ui.text, true),
      field('Vare (EAN eller navn)', ui.item, true),
      field('Betalingsmåte', ui.pay, true),
      pfield('Varegruppe', ui.groups, true),
      el('div', { class: 'kvr-row' }, [field('Pant', ui.pant, true), field('Rabatt', ui.disc, true)]),
      el('div', { class: 'kvr-row' }, [field('Rabatt % fra', ui.discFrom, true), field('Rabatt % til', ui.discTo, true)]),
      field('Spesialbetaling (eget/internt forbruk, utbetaling …)', ui.special, true)
    ], true);
    var secGroups = section('groups', 'Varegrupper', [
      el('div', { class: 'kvr-hint', text: 'Sum per varegruppe for valgte kvitteringer:' }), ui.groupSums,
      el('div', { class: 'kvr-hint kvr-mt', text: 'Varer uten gruppe (mest solgt):' }), ui.unmatched,
      rulesDetails
    ], false);

    // --- Avvik
    var oa = check('Kun avvik'); ui.onlyAnom = oa.box;
    ui.anomBtn = btn('Kjør avviksjekk (synlige)', function () { runAnom('visible'); }, 'kvr-primary');
    ui.anomList = el('div', { class: 'kvr-list' });
    var secAnom = fold(section('anom', 'Avvik per bong', [
      el('div', { class: 'kvr-hint', text: 'Sjekker hver synlige bong mot grensene i Innstillinger. Kjøres kun når du trykker.' }),
      el('div', { class: 'kvr-row' }, [ui.anomBtn, btn('Juster grenser', function () { openSettings('bong'); })]),
      oa.node, ui.anomList
    ], false), 'anom', true);


    // --- Rapport
    ui.repBy = el('select', {}, [el('option', { value: 'kasse', text: 'Per kasse' }), el('option', { value: 'kasserer', text: 'Per kasserer' })]);
    ui.repBy.addEventListener('change', renderReport);
    var repDay = check('Del opp per dag', renderReport); ui.repDay = repDay.box;
    ui.repTable = el('div', { class: 'kvr-tablewrap' });
    ui.repNote = el('div', { class: 'kvr-hint' });
    var secReport = section('report', 'Dagsrapport (synlige kvitteringer)', [
      el('div', { class: 'kvr-row' }, [ui.repBy, repDay.node]),
      ui.repTable, ui.repNote,
      el('div', { class: 'kvr-row' }, [btn('Eksporter rapport (CSV)', exportReportCsv), btn('Skann innhold nå', scanVisible, 'kvr-primary')])
    ]);
    ui.settleNote = el('div', { class: 'kvr-hint' });
    ui.settleList = el('div', { class: 'kvr-list' });
    var secSettle = section('settle', 'Kassaoppgjør', [ui.settleNote, ui.settleList]);

    // --- Egne avviksregler
    ui.crules = el('div', {});
    var secCustom = fold(section('custom', 'Egne avviksregler', [
      el('div', { class: 'kvr-hint', text: 'Alle vilkår i en regel må stemme (OG). Felt merket * krever skanning. Klokkeslett skrives HH:MM. Tomt medlemsnr: «Medlemsnr = (tomt)».' }),
      ui.crules,
      el('div', { class: 'kvr-row' }, [btn('Ny regel', function () {
        customRules.push({ id: 'r' + Date.now(), name: uniqueRuleName('Ny regel'), enabled: true, conds: [{ f: 'sum', op: '<=', v: '' }] }); saveCustom(); renderCustom();
      }), btn('Eksempel', function () {
        customRules.push({ id: 'r' + Date.now(), name: uniqueRuleName('Stor retur om kvelden'), enabled: true, conds: [{ f: 'sum', op: '<=', v: '-200' }, { f: 'tid', op: '>=', v: '20:00' }] }); saveCustom(); renderCustom();
      })])
    ]), 'custom', true);


    // --- Kontroll
    ui.taskSel = el('select', {});
    ui.taskName = el('input', { type: 'text', placeholder: 'navn, f.eks. Mandagens kontroll' });
    ui.taskRel = el('select', {}, Object.keys(REL_LABEL).map(function (k) { return opt(k, REL_LABEL[k]); }));
    var tScan = check('Skann', function () {}); ui.taskScan = tScan.box; tScan.box.checked = true;
    var tChk = check('Kontroller', function () {}); ui.taskChecks = tChk.box; tChk.box.checked = true;
    var tSum = check('Sammendrag', function () {}); ui.taskSummary = tSum.box; tSum.box.checked = true;
    var secTasks = fold(section('tasks', 'Arbeidsoppgaver', [
      hintEl('En oppgave husker gjeldende filter, datovalg, skanning og kontroller, og kjøres med én knapp. Den bruker butikk, medlem og andre valg fra Søk-fanen. Lagrede filtre (Filter-fanen) setter bare filter.'),
      el('div', { class: 'kvr-row' }, [ui.taskSel, btn('Kjør', runTask, 'kvr-primary')]),
      el('div', { class: 'kvr-row' }, [ui.taskName, ui.taskRel]),
      el('div', { class: 'kvr-row' }, [tScan.node, tChk.node, tSum.node]),
      el('div', { class: 'kvr-row' }, [btn('Lagre som oppgave', saveTask), btn('Slett valgt', deleteTask)])
    ]), 'tasks', true);

    ui.ctlInfo = hintEl('');
    var secChecks = section('checks', 'Kontroller', [
      hintEl('Kjører først avviksjekken per kvittering, så kontroller på tvers av bonger. Funn legges i samme avviksliste. Terskler og poeng justeres under Innstillinger.'),
      el('div', { class: 'kvr-row' }, [btn('Kjør alle kontroller (synlige)', function () { runChecks('visible'); }, 'kvr-primary'), btn('Juster terskler', function () { openSettings(); })]),
      ui.ctlInfo
    ]);
    ui.ctlProfile = el('div', {}); ui.ctlFindings = el('div', { class: 'kvr-list' }); ui.ctlPant = el('div', {}); ui.ctlRecon = el('div', {});
    var secProfile = fold(section('profile', 'Kassererprofil mot butikksnitt', [ui.ctlProfile]), 'profile', true);
    secProfile.classList.add('kvr-span');
    var secFindings = fold(section('findings', 'Mønstre og funn', [ui.ctlFindings]), 'findings', true);
    var secPantBal = fold(section('pantbal', 'Pantelapp-sjekk: balanse per dag', [ui.ctlPant]), 'pantbal', false);
    var secRecon = fold(section('recon', 'Dagsavstemming per kasse', [ui.ctlRecon]), 'recon', false);
    secRecon.classList.add('kvr-span');
    ui.ctlDiff = el('div', {}); ui.ctlNum = el('div', {}); ui.ctlDisc = el('div', {}); ui.ctlMember = el('div', {}); ui.ctlMisc = el('div', {}); ui.ctlLapp = el('div', {}); ui.ctlLines = el('div', {}); ui.ctlAcct = el('div', {});
    var secDiff = fold(section('diff', 'Kassadifferanse over tid', [ui.ctlDiff]), 'diff', true);
    secDiff.classList.add('kvr-span');
    var secNum = fold(section('numbers', 'Tallanalyse: Benford og runde beløp', [ui.ctlNum]), 'numbers', false);
    var secDisc = fold(section('disc', 'Rabatter og kuponger', [ui.ctlDisc]), 'disc', true);
    secDisc.classList.add('kvr-span');
    var secMember = fold(section('member', 'Medlemsnummer', [ui.ctlMember]), 'member', true);
    var secMisc = fold(section('misc', 'Pris, kjøpeutbytte og hendelser', [ui.ctlMisc]), 'misc', false);
    var secLapp = fold(section('lapp', 'Pantelapper: manuell og maskin', [ui.ctlLapp]), 'lapp', true);
    secLapp.classList.add('kvr-span');
    var secLines = fold(section('lines', 'Linjer, kort og spesialbetaling', [ui.ctlLines]), 'lines', false);
    var secAcct = fold(section('acct', 'Bongregnskap og referanser', [ui.ctlAcct]), 'acct', false);
    ui.ctlCwx = el('div', {});
    var secCwx = fold(section('cwx', 'Fra CW: innhold, innlogging, bongkopi og svinn', [ui.ctlCwx]), 'cwx', true);
    secCwx.classList.add('kvr-span');
    ui.ctlSum = el('div', { class: 'kvr-ctlsum' });
    ui.ctlJump = el('div', { class: 'kvr-chips' });
    [['profile', 'Profil'], ['findings', 'Funn'], ['pantbal', 'Pant'], ['recon', 'Avstemming'], ['diff', 'Differanse'], ['numbers', 'Tall'], ['disc', 'Rabatt'], ['member', 'Medlem'], ['misc', 'Pris m.m.'], ['lapp', 'Pantelapper'], ['lines', 'Linjer m.m.'], ['acct', 'Regnskap'], ['cwx', 'Fra CW']].forEach(function (j) {
      ui.ctlJump.appendChild(btn(j[1], function () {
        var n = openSec(j[0]);
        if (n) n.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }, 'kvr-chip'));
    });
    ui.ctlSumCard = section('ctlsum', 'Resultat', [ui.ctlSum, ui.ctlJump,
      el('div', { class: 'kvr-row' }, [btn('Fold sammen alle', function () { foldAll(false); }, 'kvr-sm'), btn('Åpne alle', function () { foldAll(true); }, 'kvr-sm'), btn('⤢ Større', function () { ui.wideBtn.click(); }, 'kvr-sm')]),
      hintEl('Tabellene har mange kolonner. «Større» (⤢ i tittelfeltet) gir plass til alle: Stor dokker panelet til høyre og beholder lista i Lindbak, Full bruker hele skjermen.')]);
    ui.ctlResults = el('div', { class: 'kvr-pane' }, [secProfile, secFindings, secCwx, secPantBal, secRecon, secDiff, secNum, secDisc, secMember, secMisc, secLapp, secLines, secAcct]);
    ui.noteList = el('div', { class: 'kvr-list' });
    ui.noteCount = hintEl('');
    var kn = check('Tastaturflyt: ↑ ↓ bytter bong, N notat, M velg/fjern', function () { keyNav = kn.box.checked; store(K.keynav, keyNav); });
    kn.box.checked = keyNav;
    ui.keyNavBox = kn;
    var secNotes = fold(section('notes', 'Oppfølging og tastatur', [
      ui.noteCount, ui.noteList,
      el('div', { class: 'kvr-row' }, [btn('Notat på valgt rad', function () { openNote(currentRec()); }), btn('Eksporter notater', exportNotes), btn('Notatlogg…', openNoteLog)]),
      btn('Fjern «sjekket»', function () {
        confirmBox('Fjern sjekkede', 'Fjerne alle notater med status «sjekket»?', 'Fjern', function () {
          Object.keys(notes).forEach(function (id) { if (notes[id].status === 'sjekket') delete notes[id]; });
          saveNotes(); apply(); renderNotes();
        });
      }),
      hintEl('Tastaturflyt (↑ ↓ bytter bong, N notat, M velg/fjern) slås av og på under Mer → Innstillinger.')
    ]), 'notes', true);

    // --- Sortering
    ui.sort = el('select', {}, [
      el('option', { value: 'none', text: 'Standard' }),
      el('option', { value: 'sumDesc', text: 'Sum høyest først' }),
      el('option', { value: 'sumAsc', text: 'Sum lavest først' }),
      el('option', { value: 'timeDesc', text: 'Nyeste først' }),
      el('option', { value: 'timeAsc', text: 'Eldste først' })
    ]);
    ui.sort.addEventListener('change', onChange);
    // --- Sortering og lagrede filtre
    ui.name = el('input', { type: 'text', placeholder: 'navn på filter' });
    ui.saved = el('select', {});
    var secSaved = section('sort', 'Sortering og lagrede filtre', [
      field('Sortering', ui.sort),
      el('b', { class: 'kvr-subh', text: 'Lagrede filtre' }),
      el('div', { class: 'kvr-row' }, [ui.name, btn('Lagre', function () {
        var n = ui.name.value.trim();
        if (!n) return;
        var list = store(K.saved) || {};
        readForm();
        list[n] = filters;
        store(K.saved, list);
        renderSaved();
        ui.saved.value = n;
      })]),
      el('div', { class: 'kvr-row' }, [ui.saved, btn('Last', function () {
        var list = store(K.saved) || {};
        if (!list[ui.saved.value]) return;
        filters = L.sanitizeFilters(list[ui.saved.value]);
        writeForm(); apply();
      }), btn('Slett', function () {
        var list = store(K.saved) || {};
        delete list[ui.saved.value];
        store(K.saved, list);
        renderSaved();
      })])
    ], true);

    // --- Eksport
    var pH = check('PNG: legg på topptekst (butikk, kasse, kasserer, bongnr, tid)', function () {}); ui.pngHeaderOn = pH.box; pH.box.checked = true;
    var pM = check('PNG: ta med medlemsnr i topptekst', function () {}); ui.pngMember = pM.box;
    ui.pngLayout = el('select', {}, [el('option', { value: 'bong', text: 'Bong (smal, som papirkvittering)' }), el('option', { value: 'a4', text: 'A4-ark med bongen i midten' })]);
    ui.pngLayout.value = store(K.layout) || 'bong';
    ui.pngLayout.addEventListener('change', function () { store(K.layout, ui.pngLayout.value); });
    var secExport = section('export', 'Eksport', [
      el('div', { class: 'kvr-row' }, [btn('CSV: synlige', function () { exportCsv(false); }), btn('CSV: valgte', function () { exportCsv(true); })]),
      el('div', { class: 'kvr-row' }, [btn('PNG: valgte (ZIP)', function () { exportPng(selectedRecs()); }), ui.retryBtn2 = btn('Prøv feilede på nytt', function () { if (lastRetry) lastRetry(); })]),
      field('PNG-format', ui.pngLayout), pH.node, pM.node,
      el('div', { class: 'kvr-hint', text: 'Semikolon-separert, åpnes direkte i Excel. Varegrupper og pant tas med for skannede kvitteringer.' })
    ], false);

    ui.storeNames = storeNames;
    var setFile = el('input', { type: 'file', accept: 'application/json', style: 'display:none' });
    setFile.addEventListener('change', function () {
      var f = setFile.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () { importSettings(String(fr.result)); };
      fr.readAsText(f);
      setFile.value = '';
    });
    ui.setStale = el('div', { class: 'kvr-notice', role: 'status', style: 'display:none' }, [el('span', { text: 'Innstillingene er endret siden siste analyse.' }), btn('Kjør analyse', function () { ui.go('check'); runAnalysis(); }, 'kvr-sm')]);
    ui.sizeSel = el('select', { 'aria-label': 'Panelstørrelse' }, [opt('0', 'Vanlig (flyttbart)'), opt('1', 'Stor (dokket til høyre, lista beholdes)'), opt('2', 'Full (hele skjermen)')]);
    ui.sizeSel.value = String(sizeMode());
    ui.sizeSel.addEventListener('change', function () { setSizeMode(Number(ui.sizeSel.value), true); });
    ui.tshift = el('input', { type: 'number', step: '1', 'aria-label': 'Tidsforskyvning for listen (min)' });
    ui.tshift.value = String(timeShift);
    ui.tshift.addEventListener('change', function () { var v = Math.round(Number(ui.tshift.value)); setTimeShift(isFinite(v) ? v : 0); });
    ui.setGeneral = section('set-general', 'Generelt', [
      field('Egne butikknavn (valgfritt, nr=navn per linje)', storeNames),
      field('Panelstørrelse', ui.sizeSel),
      field('Tidsforskyvning for listen (min)', ui.tshift),
      hintEl('Normalt 0. Brukes bare hvis klokkeslettet i listen avviker fast fra bongen; Diagnostikk foreslår verdien.'),
      kn.node,
      el('div', { class: 'kvr-row' }, [btn('Eksporter innstillinger', exportSettings), btn('Importer…', function () { setFile.click(); }), btn('Diagnostikk…', openDiag)]), setFile,
      el('div', { class: 'kvr-row' }, [
        btn('Tilbakestill plassering', function () {
          store(K.pos, null); store(K.size, null);
          panel.style.width = ''; panel.style.height = '';
          placePanel(panel);
          say('Plassering og størrelse er tilbakestilt.');
        }),
        btn('Alt til standard', function () {
          confirmBox('Alt til standard', 'Sette alle terskler, avviksgrenser og poeng tilbake til standard? Egne regler, varegrupper og butikknavn beholdes.', 'Tilbakestill', resetAllSettings);
        })
      ]),
      hintEl('Eksport tar med terskler, poeng, egne regler, varegrupper og butikknavn. Skannede kvitteringer og notater tas ikke med.'),
      el('b', { class: 'kvr-subh', text: 'Lagre i mappe' }),
      (ui.folderInfo = hintEl('')),
      (ui.folderBtns = el('div', { class: 'kvr-row' })),
      hintEl('Velg en mappe (for eksempel på en fellesdisk), så skrives innstillingene til ' + FOLDER_FILE + ' der ved hver endring. Samme fil kan leses inn på en annen PC. Skannede kvitteringer og notater blir i nettleseren.')
    ]);
    ui.setBody = el('div', { class: 'kvr-pane' });

    ui.repLog = el('div', {});
    var secAudit = section('auditrep', 'Revisjonsrapport', [
      hintEl('Én ZIP med omfang, terskler, funn, dekningsgrad, bevis-PNG og kontrollsummer (SHA-256). Bygger på siste analyse.'),
      btn('Lag revisjonsrapport…', openReportDialog, 'kvr-primary'),
      el('b', { class: 'kvr-subh', text: 'Tidligere rapporter' }), ui.repLog
    ]);

    ui.focusBody = el('div', { class: 'kvr-pane' });

    // --- Omfang for analysen
    var scChange = function () { store(K.scope, scope); ui.scALabelFrom.textContent = scope.compare.on ? 'Periode A fra' : 'Periode fra'; ui.scALabelTo.textContent = scope.compare.on ? 'Periode A til' : 'Periode til'; renderCheck(); };
    ui.scFrom = el('input', { type: 'date' }); ui.scTo = el('input', { type: 'date' });
    ui.scBFrom = el('input', { type: 'date' }); ui.scBTo = el('input', { type: 'date' });
    ui.scFrom.addEventListener('change', function () { scope.dateFrom = ui.scFrom.value; scChange(); });
    ui.scTo.addEventListener('change', function () { scope.dateTo = ui.scTo.value; scChange(); });
    ui.scBFrom.addEventListener('change', function () { scope.compare.from = ui.scBFrom.value; scChange(); });
    ui.scBTo.addEventListener('change', function () { scope.compare.to = ui.scBTo.value; scChange(); });
    ui.scStores = storeBox(function () { scope.stores = readSelect(ui.scStores); scChange(); });
    ui.scCashiers = pills(function () { scope.cashiers = readSelect(ui.scCashiers); scChange(); });
    ui.scKasser = pills(function () { scope.workstations = readSelect(ui.scKasser); scChange(); });
    var scCmp = check('Sammenlign med en annen periode (A mot B)', function () { scope.compare.on = scCmp.box.checked; ui.scB.style.display = scope.compare.on ? '' : 'none'; scChange(); });
    var scUf = check('Bruk også filtrene i listen', function () { scope.useFilters = scUf.box.checked; scChange(); });
    ui.scCompare = scCmp.box; ui.scUseFilters = scUf.box;
    ui.scALabelFrom = el('span', { text: 'Periode fra' }); ui.scALabelTo = el('span', { text: 'Periode til' });
    ui.scB = el('div', { class: 'kvr-row', style: 'display:none' }, [
      el('label', { class: 'kvr-f' }, [el('span', { text: 'Periode B fra' }), ui.scBFrom]), el('label', { class: 'kvr-f' }, [el('span', { text: 'Periode B til' }), ui.scBTo])]);
    var scPresets = el('div', { class: 'kvr-chips' });
    [['Hele listen', 'all'], ['I går', 'yesterday'], ['Siste 7 dager', 'last7'], ['Forrige uke', 'lastweek'], ['Denne måneden', 'thismonth'], ['Forrige måned', 'lastmonth']].forEach(function (q) {
      scPresets.appendChild(btn(q[0], function () {
        var r = q[1] === 'all' ? { dateFrom: '', dateTo: '' } : L.relativeRange(q[1]);
        scope.dateFrom = r.dateFrom; scope.dateTo = r.dateTo;
        ui.scFrom.value = r.dateFrom; ui.scTo.value = r.dateTo;
        scChange();
      }, 'kvr-chip'));
    });
    ui.scopeInfo = hintEl('');
    ui.scopeWarnTxt = el('span', {});
    ui.scopeWarn = el('div', { class: 'kvr-scanwarn', role: 'status', style: 'display:none' }, [ui.scopeWarnTxt, btn('Hent fra CW', fetchScopeData, 'kvr-sm')]);
    ui.scopeBrief = el('span', { class: 'kvr-scope-brief' });
    ui.scopeCard = el('details', { class: 'kvr-card kvr-scope', 'data-sec': 'scope' }, [el('summary', { class: 'kvr-scope-h' }, [el('b', { text: 'Velg omfang' }), ui.scopeBrief]), el('div', { class: 'kvr-secbody' }, [
      scPresets,
      el('div', { class: 'kvr-row' }, [el('label', { class: 'kvr-f' }, [ui.scALabelFrom, ui.scFrom]), el('label', { class: 'kvr-f' }, [ui.scALabelTo, ui.scTo])]),
      ui.scB,
      scCmp.node,
      pfield('Butikk (tom = alle)', ui.scStores), pfield('Kasserer (tom = alle)', ui.scCashiers), pfield('Kasse (tom = alle)', ui.scKasser),
      scUf.node, ui.scopeInfo, ui.scopeWarn,
      btn('Nullstill omfang', function () { scope = defaultScope(); store(K.scope, scope); writeScope(); renderCheck(); })
    ])]);
    ui.checkTop = el('div', { class: 'kvr-pane' });
    ui.checkBody = el('div', { class: 'kvr-pane' });
    ui.chartsBody = el('div', { class: 'kvr-pane' });
    var subDefs = [
      ['check', 'Sjekk først', [ui.checkTop, ui.scopeCard, ui.checkBody]],
      ['charts', 'Diagram', [ui.chartsBody]],
      ['report', 'Rapport', [secReport, secSettle]],
      ['focus', 'Fokus', [ui.focusBody]],
      ['details', 'Detaljer', [ui.ctlSumCard, secChecks, ui.ctlResults, secAnom, secCustom, secTasks, secNotes]]
    ];
    ui.subBtns = {}; ui.subPanes = {};
    var subNav = el('div', { class: 'kvr-subnav', role: 'tablist' });
    var subHost = el('div', { class: 'kvr-host' });
    function showSub(id) {
      Object.keys(ui.subPanes).forEach(function (k) {
        ui.subPanes[k].style.display = k === id ? '' : 'none';
        ui.subBtns[k].classList.toggle('kvr-active', k === id);
        ui.subBtns[k].setAttribute('aria-selected', k === id ? 'true' : 'false');
        ui.subBtns[k].tabIndex = k === id ? 0 : -1;
      });
      store(K.sub, id);
      if (id === 'charts') renderCharts();
    }
    subDefs.forEach(function (t) {
      var b = el('button', { type: 'button', class: 'kvr-sub', role: 'tab', text: t[1] });
      b.addEventListener('click', function () { showSub(t[0]); });
      ui.subBtns[t[0]] = b;
      subNav.appendChild(b);
      ui.subPanes[t[0]] = el('div', { class: 'kvr-pane', role: 'tabpanel' }, t[2]);
      subHost.appendChild(ui.subPanes[t[0]]);
    });

    var moreDefs = [['export', 'Eksport', [secAudit, secExport]], ['settings', 'Innstillinger', [ui.setBody]]];
    ui.moreBtns = {}; ui.morePanes = {};
    var moreNav = el('div', { class: 'kvr-subnav', role: 'tablist', 'aria-label': 'Mer' });
    var moreHost = el('div', { class: 'kvr-host' });
    function showMore(id) {
      Object.keys(ui.morePanes).forEach(function (k) {
        ui.morePanes[k].style.display = k === id ? '' : 'none';
        ui.moreBtns[k].classList.toggle('kvr-active', k === id);
        ui.moreBtns[k].setAttribute('aria-selected', k === id ? 'true' : 'false');
        ui.moreBtns[k].tabIndex = k === id ? 0 : -1;
      });
      store(K.sub2, id);
      if (id === 'settings') renderSettings();
    }
    moreDefs.forEach(function (t) {
      var b = el('button', { type: 'button', class: 'kvr-sub', role: 'tab', text: t[1] });
      b.addEventListener('click', function () { showMore(t[0]); });
      ui.moreBtns[t[0]] = b;
      moreNav.appendChild(b);
      ui.morePanes[t[0]] = el('div', { class: 'kvr-pane', role: 'tabpanel' }, t[2]);
      moreHost.appendChild(ui.morePanes[t[0]]);
    });
    tabKeys(moreNav);
    tabKeys(subNav);

    var tabDefs = [
      ['cw', 'Hent', [hintEl('Henter nye kvitteringer fra Lindbak (hele journalen). Resultatet kan så filtreres under «Filtrer».'), secCw, secParts]],
      ['filter', 'Filtrer', [hintEl('Filtrerer kvitteringene som allerede er listet. Ingenting hentes på nytt.'), secStore, secTime, secWho, secSum, secContent, secSaved]],
      ['content', 'Skann', [el('p', { class: 'kvr-intro', text: 'Skann leser innholdet i kvitteringene: varer, pant, rabatt og betaling. Filtrer listen først, så skanner du bare det som er synlig. Filtrene som bruker innholdet ligger under «Filtrer» → Innhold.' }), secScan, secGroups]],
      ['analyse', 'Analyse', [subNav, subHost]],
      ['more', 'Mer', [moreNav, moreHost]]
    ];
    ui.tabBtns = {}; ui.panes = {};
    var tabBar = el('div', { class: 'kvr-tabs', role: 'tablist' });
    var scroll = el('div', { class: 'kvr-scroll' });
    function showTab(id) {
      Object.keys(ui.panes).forEach(function (k) {
        ui.panes[k].style.display = k === id ? '' : 'none';
        ui.tabBtns[k].classList.toggle('kvr-active', k === id);
        ui.tabBtns[k].setAttribute('aria-selected', k === id ? 'true' : 'false');
        ui.tabBtns[k].tabIndex = k === id ? 0 : -1;
      });
      store(K.tab, id);
      scroll.scrollTop = 0;
      if (id === 'analyse') renderChartsIfVisible();
    }
    tabDefs.forEach(function (t) {
      var b = el('button', { type: 'button', class: 'kvr-tab', role: 'tab', text: t[1] });
      b.addEventListener('click', function () { showTab(t[0]); });
      ui.tabBtns[t[0]] = b;
      tabBar.appendChild(b);
      ui.panes[t[0]] = el('div', { class: 'kvr-pane', role: 'tabpanel' }, t[2]);
      scroll.appendChild(ui.panes[t[0]]);
    });
    ui.showTab = showTab;
    ui.go = function (name) {
      var map = { cw: ['cw'], filter: ['filter'], content: ['content'], check: ['analyse', 'check'], charts: ['analyse', 'charts'], report: ['analyse', 'report'], anom: ['analyse', 'details'], control: ['analyse', 'details'], details: ['analyse', 'details'], focus: ['analyse', 'focus'], export: ['more', 'export'], settings: ['more', 'settings'] };
      var m = map[name] || [name];
      showTab(m[0]);
      if (m[0] === 'more') showMore(m[1] || 'export');
      else if (m[1]) showSub(m[1]);
    };
    tabKeys(tabBar);
    ui.tabDot = el('i', { class: 'kvr-dot', style: 'display:none' });
    ui.tabBtns.filter.appendChild(ui.tabDot);

    ui.footPng = btn('PNG', function () { exportPng(selectedRecs()); }, 'kvr-primary');
    ui.footPng.title = 'Last ned valgte kvitteringer som PNG (ZIP ved flere)';
    ui.footCmp = btn('Sammenlign', compareSelected);
    ui.footCmp.style.display = 'none';
    ui.footCmp.title = 'Sammenlign de to valgte bongene side om side';
    ui.footCsv = btn('CSV', function () { exportCsv(Object.keys(selected).length > 0); });
    ui.footCsv.title = 'Eksporter valgte (eller synlige hvis ingen er valgt) til CSV';
    var foot = el('div', { class: 'kvr-foot' }, [
      btn('Velg alle', function () {
        recs.forEach(function (r) { if (r.show) selected[r.item.transactionId] = r.item; });
        apply();
      }),
      btn('Fjern valg', function () { selected = {}; apply(); }),
      ui.footCmp,
      ui.footCsv,
      ui.footPng
    ]);

    panel.appendChild(head);
    panel.appendChild(el('div', { class: 'kvr-main' }, [stats, tabBar, scroll, foot]));
    document.body.appendChild(panel);
    ui.tip = el('div', { class: 'kvr-tip', role: 'tooltip', style: 'display:none' });
    panel.appendChild(ui.tip);
    showTab(ui.panes[store(K.tab)] ? store(K.tab) : 'filter');
    showSub(ui.subPanes[store(K.sub)] ? store(K.sub) : 'check');
    showMore(ui.morePanes[store(K.sub2)] ? store(K.sub2) : 'export');
    writeScope();

    function setCollapsed(c) {
      panel.classList.toggle('kvr-collapsed', c);
      toggle.textContent = c ? '+' : '–';
      store(K.collapsed, c);
      applyModePos(panel);
      clamp(panel);
    }
    function flip() { setCollapsed(!panel.classList.contains('kvr-collapsed')); }
    toggle.addEventListener('click', flip);
    // størrelsesknappen åpner også et minimert panel, ellers ser det ut som ingenting skjer
    ui.wideBtn.addEventListener('click', function () { if (panel.classList.contains('kvr-collapsed')) setCollapsed(false); setSizeMode((sizeMode() + 1) % 3, true); });
    enableDrag(panel, head, function () { if (panel.classList.contains('kvr-collapsed')) flip(); });
    document.addEventListener('keydown', function (e) {
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); flip(); }
    });
    document.addEventListener('mouseup', function () {
      if (panel.classList.contains('kvr-collapsed') || sizeMode() > 0) return;
      if (panel.style.width || panel.style.height) { store(K.size, { width: panel.style.width, height: panel.style.height }); renderChartsIfVisible(); }
    });
    window.addEventListener('resize', function () { clamp(panel); });

    curSize = sizeMode();
    placePanel(panel);
    paintSizeMode();
    applyModePos(panel);
    if (store(K.collapsed)) setCollapsed(true);
    renderSaved();
    renderRules();
    renderCwStores();
    renderCustom();
    renderTasks();
    renderControl();
    renderNotes();
    renderReportLog();
    renderFolder();
    installKeys();
    setTimeout(ensureVisible, 300);
    window.addEventListener('load', function () { setTimeout(ensureVisible, 300); });
  }

  function attach() {
    try { attachGrid(); } catch (e) { showBootError(e); }
  }

  function attachGrid() {
    ensureVisible();
    var g = getGrid();
    if (!g) {
      // Panelet kommer med en gang på journalsidene; det kobles til listen når CW viser den
      if (/\/Journal/i.test(location.pathname) && !document.getElementById('kvr-panel')) buildPanel();
      if (ui.waitNote) ui.waitNote.style.display = 'flex';
      showWaiting();
      return;
    }
    if (ui.waitNote) ui.waitNote.style.display = 'none';
    if (g.__kvBound) {
      if (refreshStoreMap()) { optsKey = ''; renderCwStores(); }
      var tb = g.tbody && g.tbody[0];
      if (tb && !scanning && !cwRun && tb.querySelectorAll(':scope > tr').length !== tb.querySelectorAll(':scope > tr > td.kvr-cb-cell').length) apply();
      return;
    }
    grid = g;
    if (!document.getElementById('kvr-panel')) buildPanel();
    g.__kvBound = true;
    var wb = document.getElementById('kvr-boot');
    if (wb && !bootShown) wb.remove();
    installGridClicks();
    g.bind('dataBound', function () { boundCount++; if (!cwRun) setTimeout(apply, 0); });   // mens tilleggsdata hentes, viser listen CWs filtrerte søk
    apply();
    renderCwStores();
  }

  openDb().then(async function (d) {
    try {
      db = d;
      if (db) {
        mem = await readAll(db, 'kv');
        var raw = await readAll(db, 'scan');
        Object.keys(raw).forEach(function (k) { if (raw[k] && (raw[k].v >= 2 && raw[k].v <= 9)) scanMap[k] = L.splitDeleted(L.cleanPay(raw[k])); });   // «(SLETTET)»-linjer i eldre skanninger
      }
      migrateLocal();
      rules = L.sanitizeRules(store(K.rules));
      anomCfg = L.sanitizeAnom(store(K.anom));
      manualStores = store(K.stores) || '';
      campDec = L.sanitizeCamp(store(K.camp));
      customRules = L.sanitizeCustom(store(K.arules));
      notes = store(K.notes) || {};
      loadNoteLog();
      tasksCustom = Array.isArray(store(K.tasks)) ? store(K.tasks) : [];
      ctlCfg = L.sanitizeControl(store(K.ctl));
      if (!store(K.pantmig)) {
        // 3.23.0: pant gir bare reaksjon på manuell pantelapp (99) og slettet pantelapp fra maskinen (399). Eldre lagrede innstillinger legges om én gang.
        anomCfg.bigReturn = ''; anomCfg.manyLapper = ''; anomCfg.cashNoSale = false;
        ctlCfg.cashNoSaleN = ''; ctlCfg.lappReuseMin = ''; ctlCfg.voidCashOn = '';
        if (store(K.anom)) store(K.anom, anomCfg);
        if (store(K.ctl)) store(K.ctl, ctlCfg);
        store(K.pantmig, 1);
      }
      if (!store(K.campmig)) {
        // 3.29.0: kampanjevare = samme vare med rabatt hos to kasserere, én bong hver er nok. Gammel standard (3 bonger) legges om én gang.
        if (ctlCfg.campBongs === '3') { ctlCfg.campBongs = '2'; if (store(K.ctl)) store(K.ctl, ctlCfg); }
        store(K.campmig, 1);
      }
      keyNav = store(K.keynav) !== false;
      timeShift = Number(store(K.tshift)) || 0;
      weights = L.sanitizeWeights(store(K.weights));
      if (!store(K.evmig)) {
        // 3.34.0: «bong kopi» er hendelsesord. Legges til i lagret ordliste én gang.
        if (!L.wordHit('bong kopi', L.wordList(ctlCfg.evWords))) { ctlCfg.evWords = (String(ctlCfg.evWords || '').trim() ? ctlCfg.evWords + ', ' : '') + 'bong kopi'; if (store(K.ctl)) store(K.ctl, ctlCfg); }
        store(K.evmig, 1);
      }
      if (!store(K.discmig)) {
        // 3.33.0: «Rabatt uten årsak» gir ikke poeng. Lagret gammel standard (3) legges om én gang; egne verdier beholdes.
        var sw = store(K.weights);
        if (sw && sw['Rabatt uten årsak'] === 3) { weights['Rabatt uten årsak'] = 0; store(K.weights, weights); }
        store(K.discmig, 1);
      }
      scope = sanitizeScope(store(K.scope));
      cwx = sanitizeCwx(store(K.cwx));
      loadArchive();
      quickScan = store(K.quick) === true;
      folder.handle = store(K.folder);
      if (!folder.handle || typeof folder.handle.queryPermission !== 'function') folder.handle = null;
      folder.at = Number(store(K.folderAt)) || 0;
      (folder.handle ? checkFolderNewer() : Promise.resolve()).then(function () { folder.ready = true; renderFolder(); });
      setInterval(attach, 1500);
      attach();
    } catch (e) { showBootError(e); }
  });
})();
