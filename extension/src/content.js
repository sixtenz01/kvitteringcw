(function () {
  'use strict';
  if (window.__kvRewamp) return;
  window.__kvRewamp = true;

  var L = window.KvLogic;
  var K = {
    saved: 'kvr.saved.v1', collapsed: 'kvr.collapsed.v1', scan: 'kvr.scan.v2', pos: 'kvr.pos.v1',
    size: 'kvr.size.v1', sec: 'kvr.sec.v1', rules: 'kvr.rules.v1', anom: 'kvr.anom.v1',
    stores: 'kvr.stores.v1', fast: 'kvr.fast.v1', tab: 'kvr.tab.v1', layout: 'kvr.layout.v1', arules: 'kvr.arules.v1', notes: 'kvr.notes.v1', tasks: 'kvr.tasks.v1', ctl: 'kvr.ctl.v1', keynav: 'kvr.keynav.v1', wide: 'kvr.wide.v1', sub: 'kvr.sub.v1', weights: 'kvr.weights.v1', lastrun: 'kvr.lastrun.v1', scope: 'kvr.scope.v1', help: 'kvr.help.v1', sub2: 'kvr.sub2.v1', reports: 'kvr.reports.v1', repopts: 'kvr.repopts.v1'
  };
  var sayTimer = null;
  var failedRecs = [];
  var lastRetry = null;
  var API_ROOT = '/LindbakRetail_1/Journal/Viewer/Api/';
  var SCAN_TIMEOUT = 6000;
  var SCAN_LIMIT = 2000;

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
  var storeMap = {};

  // Lagring: kun egen IndexedDB ('kvr-store'). Ingenting skrives til localStorage/sessionStorage,
  // slik at Lindbaks egne data aldri påvirkes. Hard grense på antall cachede kvitteringer.
  var mem = {};
  var scanMap = {};
  var dirty = {};
  var db = null;
  var rules, anomCfg, manualStores, fastScan, customRules = [];
  var scope = null, lastMode = 'scope', fetched = null;
  var weights = null, checkState = { newIds: {}, at: null, shown: 15, showChecked: false }, expanded = {};
  var notes = {}, ctlRes = null, ctlCfg = null, tasksCustom = [], boundCount = 0, keyNav = true, settingsStale = false;

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
  }

  function saveScan() {
    var keys = Object.keys(scanMap).sort(function (a, b) { return (scanMap[a].t || 0) - (scanMap[b].t || 0); });
    if (keys.length > SCAN_LIMIT) {
      keys.slice(0, keys.length - SCAN_LIMIT).forEach(function (k) { delete scanMap[k]; delete dirty[k]; put('scan', k, null); });
    }
    Object.keys(dirty).forEach(function (k) { if (scanMap[k]) put('scan', k, scanMap[k]); });
    dirty = {};
  }

  function clearScan() {
    scanMap = {}; dirty = {}; gcache = {};
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

  // ---- grid ---------------------------------------------------------------
  function getGrid() {
    var node = document.querySelector('[data-role=grid]');
    var $ = jq();
    if (!node || !$) return null;
    return $(node).data('kendoGrid') || null;
  }

  function plain(item) { return item && item.toJSON ? item.toJSON() : item; }

  function seqOf(tid) { return parseInt(String(tid).substr(String(tid).lastIndexOf('-') + 1), 10); }

  function collect() {
    var tbody = grid.tbody && grid.tbody[0];
    if (!tbody) return [];
    var view = grid.dataSource.view();
    var out = [];
    Array.prototype.forEach.call(tbody.children, function (tr) {
      if (tr.tagName !== 'TR') return;
      var di = grid.dataItem(tr);
      if (!di) return;
      var item = plain(di);
      var cell = tr.querySelector('td[data-field="receiptIdentifier"]');
      item.bongnr = cell && cell.textContent.trim() ? cell.textContent.trim() : [item.storeNumber, item.workstationNumber, seqOf(item.transactionId)].join('-');
      var orig = 0;
      for (var i = 0; i < view.length; i++) { if (view[i] === di || (view[i].uid && view[i].uid === di.uid)) { orig = i; break; } }
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
      for (var i = 0; i < data.length; i++) {
        var d = data[i];
        var num = d.get ? d.get('number') : d.number;
        var name = d.get ? d.get('text') : d.text;
        if (num !== undefined && num !== null && name) list.push({ number: num, name: name });
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
    cwStoreList.forEach(function (s) { map[String(s.number)] = s.name; });
    var manual = L.parseStoreText(manualStores);
    Object.keys(manual).forEach(function (k) { map[k] = manual[k]; });
    if (JSON.stringify(map) !== JSON.stringify(storeMap)) { storeMap = map; changed = true; }
    return changed;
  }

  function sLabel(n) { return L.storeLabel(n, storeMap); }

  // ---- CW-søk (samme kontrollene som den gamle pluginen) ---------------------
  function setInputValue(node, value) {
    if (!node) return;
    var d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (d && d.set) d.set.call(node, value); else node.value = value;
    ['input', 'change', 'blur'].forEach(function (ev) { node.dispatchEvent(new Event(ev, { bubbles: true })); });
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

  function cwSearch() {
    var q = function (sel) { return document.querySelector(sel); };
    if (cw.dateFrom) setInputValue(q('#fromDatePicker'), noDate(cw.dateFrom));
    if (cw.dateTo) setInputValue(q('#toDatePicker'), noDate(cw.dateTo));
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

  // ---- skanning -------------------------------------------------------------
  function iframeDoc() {
    var f = document.querySelector('iframe');
    var d = null;
    try { d = f && f.contentDocument; } catch (e) { d = null; }
    return d && d.body ? d : null;
  }

  function rowsFrom(doc) {
    return Array.prototype.map.call(doc.querySelectorAll('tr'), function (tr) {
      return Array.prototype.map.call(tr.children, function (c) { return c.textContent.replace(/\s+/g, ' ').trim(); });
    });
  }

  async function loadViaDom(r) {
    var sel = grid.select();
    var already = sel && sel[0] === r.tr;
    var d = iframeDoc();
    if (!d) return null;
    if (!already) { d.body.innerHTML = ''; grid.select(r.tr); }
    var waited = 0;
    while (waited < SCAN_TIMEOUT) {
      d = iframeDoc();
      if (d && d.body.innerHTML.length > 0 && (d.querySelector('tr') || d.querySelector('.no-details'))) {
        await wait(150);
        return rowsFrom(iframeDoc());
      }
      await wait(100);
      waited += 100;
    }
    return null;
  }

  async function loadViaApi(r) {
    var tokenEl = document.querySelector('input[name="__RequestVerificationToken"]');
    var it = r.item;
    var resp = await fetch(API_ROOT + 'GetReceiptDetails', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': tokenEl ? tokenEl.value : '' },
      body: JSON.stringify({ endDateTime: it.endDateTime, journalSourceName: it.journalSourceName || 'main', retailStoreNum: it.storeNumber, sequenceNum: seqOf(it.transactionId), workstationNum: it.workstationNumber })
    });
    if (!resp.ok) return null;
    var text = await resp.text();
    try { text = JSON.parse(text); } catch (e) { /* allerede HTML */ }
    if (typeof text !== 'string') return null;
    return rowsFrom(new DOMParser().parseFromString(text, 'text/html'));
  }

  async function scanList(todo) {
    if (scanning || !todo.length) return { done: 0, failed: 0 };
    scanning = true; cancelScan = false;
    ui.scanBtn.disabled = true; ui.anomBtn.disabled = true; ui.stopBtn.disabled = false; ui.stopTop.style.display = ''; ui.retryBtn.disabled = true; if (ui.retryBtn2) ui.retryBtn2.disabled = true;
    var prev = grid.select();
    var prevTr = prev && prev[0];
    var done = 0, failed = 0, t0 = Date.now();
    failedRecs = [];
    for (var i = 0; i < todo.length && !cancelScan; i++) {
      progress(i, todo.length, t0, 'Skanner', failed);
      var rows = null;
      try { rows = fastScan ? await loadViaApi(todo[i]) : await loadViaDom(todo[i]); } catch (e) { rows = null; }
      if (rows) {
        var id = todo[i].item.transactionId;
        scanMap[id] = todo[i].item.receiptType === 2 ? L.parseSettlement(rows) : L.parseReceipt(rows);
        scanMap[id].t = Date.now();
        dirty[id] = true;
        done++;
      } else { failed++; failedRecs.push(todo[i]); }
      if (fastScan) await wait(120);
    }
    saveScan();
    setProgress(0);
    lastRetry = failedRecs.length ? retryScan : null;
    syncRetry();
    gcache = {};
    if (!fastScan) {
      if (prevTr) grid.select(prevTr); else if (typeof grid.clearSelection === 'function') grid.clearSelection();
    }
    scanning = false;
    ui.scanBtn.disabled = false; ui.anomBtn.disabled = false; ui.stopBtn.disabled = true;
    say((cancelScan ? 'Stoppet. ' : 'Ferdig. ') + 'Skannet ' + done + (failed ? ', feilet ' + failed : '') + '.');
    return { done: done, failed: failed };
  }

  function todoVisible() { return todoFor(recs.filter(function (r) { return r.base; })); }

  function etaText(sec) {
    if (!(sec > 0)) return '';
    return ' ≈ ' + (sec >= 60 ? Math.floor(sec / 60) + 'm ' + (sec % 60) + 's' : sec + 's') + ' igjen';
  }

  function progress(i, total, t0, label, failed) {
    var elapsed = (Date.now() - t0) / 1000;
    var rem = i > 0 ? Math.round(elapsed / i * (total - i)) : 0;
    var pct = Math.round(i / total * 100);
    setProgress(Math.max(pct, 2));
    var msg = label + ' ' + (i + 1) + ' av ' + total + ' (' + pct + '%)' + etaText(rem) + (failed ? ' · feilet: ' + failed : '');
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
    return recs.filter(function (r) { return scopeMatches(r.item) && (!scope.useFilters || r.show); });
  }

  function analysisItems(mode) { return analysisRecs(mode).map(function (r) { return r.item; }); }

  function todoFor(list) {
    return list.filter(function (r) {
      var sc = scanMap[r.item.transactionId];
      return (r.item.receiptType === 1 || r.item.receiptType === 2) && (!sc || (r.item.receiptType === 1 && !L.hasDisc(sc)));
    });
  }

  function loadedRange() {
    var min = '', max = '';
    recs.forEach(function (r) {
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
    recs.forEach(function (r) { haveStores[String(r.item.storeNumber)] = true; });
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
    if (scanning) return;
    var list = analysisRecs(mode);
    await scanList(todoFor(list));
    anomMap = {};
    var n = 0;
    list.forEach(function (r) {
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
    recs.forEach(function (r) { var v = r.item[key]; if (v !== null && v !== undefined) seen[v] = true; });
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

  function storeBox(cb) {
    var box = el('div', { class: 'kvr-storebox' });
    box.cb = cb;
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
    return box;
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
    return box.values.filter(function (v) { return !q || sLabel(v).toLowerCase().indexOf(q) !== -1; });
  }

  function renderStoreBox(box) {
    box.list.innerHTML = '';
    var shown = shownStores(box);
    if (!box.values.length) box.list.appendChild(el('div', { class: 'kvr-hint', text: 'Ingen butikker i listen ennå.' }));
    else if (!shown.length) box.list.appendChild(el('div', { class: 'kvr-hint', text: 'Ingen treff.' }));
    shown.forEach(function (v) {
      var key = String(v), cb = el('input', { type: 'checkbox', value: key });
      cb.checked = !!box.sel[key];
      cb.addEventListener('change', function () { box.sel[key] = cb.checked; renderStoreInfo(box); (box.cb || onChange)(); });
      box.list.appendChild(el('label', { class: 'kvr-chk' }, [cb, el('span', { text: sLabel(v) }), el('em', { class: 'kvr-cnt', text: String(box.counts[key] || 0) })]));
    });
    renderStoreInfo(box);
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
    var key = [distinct('storeNumber'), distinct('workstationNumber'), distinct('cashierNumber'), distinct('receiptType'), JSON.stringify(storeMap), groupNames(), recs.length, cwStoreList.length].join('|');
    if (key === optsKey) return;
    optsKey = key;
    var storeVals = distinct('storeNumber'), sc = {};
    recs.forEach(function (r) { sc[r.item.storeNumber] = (sc[r.item.storeNumber] || 0) + 1; });
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
    var items = recs.map(function (r) { return r.item; });
    var dup = L.findDuplicates(items);
    var bf = Object.assign({}, filters, { pant: '', disc: '', item: '', groups: [] });
    var ctx = { dupIds: dup.ids, scan: scanMap, groupsOf: groupsOf, anom: anomMap, notes: notes };
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
    reorder();
    syncChecks();
    ui.dup = dup;
    ui.visible = visible;
    refreshOptions();
    renderDerived();
    summary();
  }

  function reorder() {
    var tbody = grid.tbody[0];
    var sorted = recs.slice().sort(function (a, b) {
      return L.compare(a.item, b.item, filters.sort) || a.orig - b.orig;
    });
    sorted.forEach(function (r) { tbody.appendChild(r.tr); });
  }

  function chosenItems() {
    return Object.keys(selected).map(function (k) { return selected[k]; });
  }

  function renderScanState() {
    if (!ui.scanRow) return;
    var base = recs.filter(function (r) { return r.base && (r.item.receiptType === 1 || r.item.receiptType === 2); });
    var none = base.filter(function (r) { return !scanMap[r.item.transactionId]; }).length;
    var stale = todoFor(base).length - none;
    var missing = none + stale;
    ui.scanRow.style.display = base.length ? 'flex' : 'none';
    ui.scanTxt.textContent = 'Skannet ' + (base.length - none) + ' av ' + base.length + (stale ? ' (' + stale + ' uten rabattdata)' : '');
    ui.scanNow.style.display = missing > 0 ? '' : 'none';
    ui.scanNow.disabled = scanning;
    var hide = filters.pant || filters.item || filters.groups.length ? none : 0;
    if (filters.disc) hide = none + stale;
    ui.scanWarn.style.display = hide > 0 ? '' : 'none';
    ui.scanWarnTxt.textContent = hide + ' kvitteringer ' + (filters.disc && stale ? 'mangler skanning eller rabattdata' : 'er ikke skannet') + ' og skjules av dette filteret.';
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
    if (f.disc) add('Rabatt: ' + (({ any: 'har rabatt', noreason: 'uten årsak', reason: 'med årsak', coupon: 'har kupong' }[f.disc] || (f.disc.indexOf('r:') === 0 ? 'årsak ' + f.disc.slice(2) : f.disc))), function () { f.disc = ''; });
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

  function resetAll() {
    filters = L.defaultFilters();
    selected = {};
    anomMap = {};
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
    r.tr.style.display = '';
    r.tr.scrollIntoView({ block: 'center' });
    if (grid && !fastScan) grid.select(r.tr);
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
    if (fastScan) {
      var tokenEl = document.querySelector('input[name="__RequestVerificationToken"]');
      var it = r.item;
      var resp = await fetch(API_ROOT + 'GetReceiptDetails', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': tokenEl ? tokenEl.value : '' },
        body: JSON.stringify({ endDateTime: it.endDateTime, journalSourceName: it.journalSourceName || 'main', retailStoreNum: it.storeNumber, sequenceNum: seqOf(it.transactionId), workstationNum: it.workstationNumber })
      });
      if (!resp.ok) return null;
      var text = await resp.text();
      try { text = JSON.parse(text); } catch (e) { /* allerede HTML */ }
      return typeof text === 'string' && text ? text : null;
    }
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
      if (fastScan) await wait(120);
    }
    if (!fastScan) {
      if (prevTr) grid.select(prevTr); else if (typeof grid.clearSelection === 'function') grid.clearSelection();
    }
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
      ctl: JSON.parse(JSON.stringify(ctlCfg)), anomCfg: JSON.parse(JSON.stringify(anomCfg)),
      scopeText: mode === 'scope' ? scopeSummary() : 'synlige kvitteringer i listen',
      scopeObj: mode === 'scope' ? JSON.parse(JSON.stringify(scope)) : null,
      compare: mode === 'scope' && scope.compare.on ? { a: per(scope.dateFrom, scope.dateTo), b: per(scope.compare.from, scope.compare.to) } : null,
      filters: mode === 'visible' ? chipDefs().filter(function (c) { return !c.state; }).map(function (c) { return c.label; }) : [],
      coverageText: mode === 'scope' && scopeCoverage().missing ? scopeCoverage().text : ''
    };
  }

  async function runChecks(mode) {
    mode = mode === 'visible' ? 'visible' : 'scope';
    if (scanning || !grid) return;
    lastMode = mode;
    await runAnom(mode);
    var items = analysisItems(mode);
    var scopeIds = {}, scopeCash = {};
    items.forEach(function (i) { scopeIds[i.transactionId] = true; scopeCash[String(i.cashierNumber)] = true; });
    // grunnlag for tester som trenger hele bildet: alle innlastede bonger i valgte butikker
    var pop = mode === 'visible' ? items : recs.filter(function (r) { return storeOK(r.item); }).map(function (r) { return r.item; });
    var keep = function (f) { return f.ids.length ? f.ids.some(function (id) { return scopeIds[id]; }) : (f.cashier ? !!scopeCash[f.cashier] : true); };
    var res = {
      at: new Date(), n: items.length, mode: mode,
      profile: L.profiles(items, scanMap, ctlCfg),
      patterns: L.patterns(items, scanMap, ctlCfg),
      pant: L.pantCheck(items, scanMap, ctlCfg),
      seq: L.sequence(items, ctlCfg),
      recon: L.reconcile(items, scanMap, ctlCfg),
      falseRet: L.falseReturns(items, pop, scanMap, ctlCfg),
      after: L.afterSettlement(items, pop, ctlCfg),
      deleted: L.deletedReceipts(pop, ctlCfg),
      diff: L.diffTrend(items, scanMap, ctlCfg),
      numbers: L.numbers(items, scanMap, ctlCfg),
      disc: L.discounts(items, scanMap, ctlCfg)
    };
    res.seq.findings = res.seq.findings.filter(function (f) { return f.code === 'hours'; });
    res.seq.skippedGaps = res.deleted.skippedGaps;
    res.findings = res.patterns.concat(res.pant.findings, res.seq.findings, res.falseRet.findings, res.after,
      res.deleted.findings.filter(keep), res.diff.findings.filter(keep), res.numbers.findings.filter(keep), res.disc.findings);
    res.cashierExtra = {};
    res.findings.forEach(function (f) {
      if (f.flag) f.ids.forEach(function (id) { if (scopeIds[id]) addFlag(id, f.title); });
      else if (f.cashier) {
        var e = res.cashierExtra[f.cashier] || (res.cashierExtra[f.cashier] = { points: 0, notes: [] });
        e.points += L.reasonWeight(f.title, weights);
        e.notes.push(f.title.toLowerCase());
      }
    });
    res.snap = analysisSnapshot(res, mode, items, pop);
    ctlRes = res;
    apply();
    renderControl();
    settingsStale = false; renderStale();
    say('Kontroller ferdig: ' + res.findings.length + ' funn, ' + Object.keys(anomMap).length + ' flaggede kvitteringer.');
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
      box.appendChild(el('b', { class: 'kvr-subh', text: 'Kuponger/kampanjer (flest først)' }));
      box.appendChild(tbl(['Kupong-id', 'Navn', 'Bonger', 'Sum kr'], D.campaigns.slice(0, 10).map(function (c) { return [c.id, c.name, c.n, fmt(c.sum)]; })));
    }
    box.appendChild(hintEl('Rabatt = linjen «Rabatt: Kr x (y %)» på en vare med årsak 1 Datovare, 2 Feil pris, 3 Prisløfte, 4 Reserveløsning kupong, 5 Annen rabattårsak eller 6 Best før (tom = ingen årsak valgt). Klikk en årsak for å filtrere listen. Kupong = linjen «Kupong (id - navn)», antatt lagt inn sentralt (CN/VPI); beløpet er ofte 0,00, så den viser at kampanjen er knyttet til bongen, ikke at den er innløst. Rødt = andel bonger med rabatt uten årsak er minst ' + ctlCfg.profFactor + '× butikkens (minst ' + ctlCfg.profMin + ' bonger). Funn «Rabatt uten årsak» krever minst ' + (ctlCfg.discPct || '–') + ' % rabatt.'));
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
    var N = R.numbers, o = N.overall;
    ui.ctlNum.appendChild(hintEl('Benford (første siffer i totalbeløp): ' + o.n + ' bonger · MAD ' + o.mad.toFixed(3) + ' · ' + o.verdict + (o.enough ? '' : ' (for få bonger til en sikker konklusjon; minst ' + ctlCfg.benfordMin + ')') + '. Hele kroner: ' + Math.round(N.storeRound * 100) + ' % av totalene.'));
    if (N.cashiers.length) {
      ui.ctlNum.appendChild(tbl(['Kasserer', 'Bonger', 'MAD', 'Vurdering', 'Hele kroner'], N.cashiers.map(function (c) {
        return [{ node: entLink('kasserer', c.id) }, c.n, { t: c.mad.toFixed(3), bad: c.flagBenford }, c.verdict, { t: pct(c.roundShare), bad: c.flagRound }];
      })));
    }
    renderDiscCard(R.disc);
    ui.ctlNum.appendChild(hintEl('MAD under 0,006 er nær Benford, 0,006–0,012 akseptabel, 0,012–0,015 marginal, over 0,015 avvikende (Nigrini). Avvik er en indikasjon som må forklares, ikke et bevis. Kasserere med færre enn ' + ctlCfg.benfordCashMin + ' bonger vurderes ikke.'));
  }

  function renderControl() {
    if (!ui.ctlProfile) return;
    var R = ctlRes;
    ui.ctlInfo.textContent = R ? 'Sist kjørt ' + R.at.toLocaleTimeString('nb-NO') + ' på ' + R.n + (R.mode === 'visible' ? ' synlige' : ' kvitteringer i omfanget') + '.' : 'Ikke kjørt ennå. Filtrer listen først, og trykk «Kjør alle kontroller».';
    [ui.ctlProfile, ui.ctlFindings, ui.ctlPant, ui.ctlRecon, ui.ctlDiff, ui.ctlNum, ui.ctlDisc].forEach(function (n) { n.innerHTML = ''; });
    ui.ctlResults.style.display = R ? '' : 'none';
    ui.ctlSumCard.style.display = R ? '' : 'none';
    if (!R) return;
    var profFlag = R.profile.rows.filter(function (r) { return r.flagged; }).length;
    var reconFlag = R.recon.filter(function (r) { return r.flag; }).length;
    var pantFlag = R.pant.balance.filter(function (b) { return b.flag; }).length;
    ui.ctlSum.textContent = R.findings.length + ' funn · ' + Object.keys(anomMap).length + ' flaggede bonger · ' + profFlag + ' kasserere avviker · ' + reconFlag + ' avstemmingsavvik · ' + pantFlag + ' pantavvik';
    // kassererprofil
    if (!R.profile.rows.length) ui.ctlProfile.appendChild(hintEl('Ingen salg blant synlige kvitteringer.'));
    else {
      var st = R.profile.store;
      var rows = R.profile.rows.map(function (r) {
        return [{ node: entLink('kasserer', r.id) }, r.count, { t: pct(r.retShare), bad: r.flags.retShare }, { t: fmt(r.avg), bad: r.flags.avg },
          r.scanned ? { t: r.lapperPer.toFixed(2), bad: r.flags.lapperPer } : '–', r.scanned ? { t: r.negPer.toFixed(2), bad: r.flags.negPer } : '–'];
      });
      rows.push(['Butikksnitt', st.count, pct(st.retShare), fmt(st.avg), st.scanned ? st.lapperPer.toFixed(2) : '–', st.scanned ? st.negPer.toFixed(2) : '–']);
      ui.ctlProfile.appendChild(tbl(['Kasserer', 'Salg', 'Returandel', 'Snitt kr', 'Pantelapp/salg', 'Korr./salg'], rows));
      ui.ctlProfile.appendChild(hintEl('Rødt = minst ' + ctlCfg.profFactor + '× butikksnittet (snitt også under 1/' + ctlCfg.profFactor + '). Returandel = salg med negativ sum. Pantelapper og korrigeringer (negative varelinjer utenom pant) krever skanning. Kasserere med færre enn ' + ctlCfg.profMin + ' bonger vurderes ikke.'));
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
    if (R.seq.skippedGaps) ui.ctlFindings.appendChild(hintEl(R.seq.skippedGaps + ' store hull i bongnummer er hoppet over (over ' + ctlCfg.maxGap + ' bonger, trolig fordi listen er filtrert).'));
    ui.ctlFindings.appendChild(hintEl('Hull i bongnummer gjelder bare hvis CW-listen ikke er filtrert på type, kasse eller tid. Funn merket som avvik får rød markering og vises under «Kun avvik».'));
    // pantebalanse
    if (!R.pant.balance.length) ui.ctlPant.appendChild(hintEl('Ingen skannede salg.'));
    else {
      ui.ctlPant.appendChild(tbl(['Dag', 'Butikk', 'Pant salg', 'Pantelapper ut', 'Diff'], R.pant.balance.map(function (b) {
        return [b.day, b.store, fmt(b.sale), { t: fmt(b.ret), bad: b.flag }, fmt(b.diff)];
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

  // ---- notater og oppfølging ----------------------------------------------------
  function saveNotes() { store(K.notes, notes); }

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
        return 'Kasserer ' + r.id + ': ' + Object.keys(r.flags).filter(function (k) { return r.flags[k]; }).map(function (k) { return { retShare: 'returandel ' + pct(r.retShare), avg: 'snitt ' + fmt(r.avg), lapperPer: 'pantelapper/salg ' + r.lapperPer.toFixed(2), negPer: 'korrigeringer/salg ' + r.negPer.toFixed(2) }[k]; }).join(', ');
      }) : ['Ingen avvik fra butikksnittet.'] });
      var rc = ctlRes.recon.filter(function (r) { return r.flag; });
      secs.push({ h: 'Dagsavstemming', li: rc.length ? rc.map(function (r) { return r.day + ' kasse ' + r.kasse + ': diff ' + fmt(r.diff) + ' kr'; }) : ['Ingen avvik.'] });
      var pb = ctlRes.pant.balance.filter(function (b) { return b.flag; });
      secs.push({ h: 'Pantebalanse', li: pb.length ? pb.map(function (b) { return b.day + ' butikk ' + b.store + ': salg ' + fmt(b.sale) + ', utbetalt ' + fmt(b.ret); }) : ['Ingen avvik.'] });
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
        add(section('f-prof', 'Mot butikksnitt', [tbl(['', 'Salg', 'Returandel', 'Snitt kr', 'Pantelapp/salg', 'Korr./salg'], [
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
    return { dupIds: ui.dup ? ui.dup.ids : {}, scan: scanMap, groupsOf: groupsOf, anom: anomMap, notes: notes };
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
    return el('span', { class: 'kvr-risk ' + levelClass(score), title: 'Risikoscore ' + score, text: lvl.charAt(0).toUpperCase() + lvl.slice(1) + ' ' + score });
  }

  function checkRow(rk, first) {
    var it = rk.item, rec = recById(rk.id), id = rk.id, n = notes[id];
    var open = expanded[id] !== undefined ? expanded[id] : first;
    var head = el('button', { type: 'button', class: 'kvr-ck-h', 'aria-expanded': String(open) }, [
      riskBadge(rk.score),
      el('span', { class: 'kvr-ck-t', text: it.endDateTime.slice(5) + ' · kasse ' + it.workstationNumber + ' · ' + (it.totalAmount === null ? L.typeLabel(it.receiptType) : fmt(it.totalAmount) + ' kr') }),
      checkState.newIds[id] ? el('span', { class: 'kvr-new', text: 'Ny' }) : null,
      n && n.status ? el('span', { class: 'kvr-st', text: n.status === 'sjekket' ? 'Sjekket' : 'Til oppfølging' }) : null
    ].filter(Boolean));
    head.addEventListener('click', function () { expanded[id] = !open; renderCheck(); });
    var card = el('div', { class: 'kvr-ck' + (open ? ' kvr-open' : '') }, [head,
      el('div', { class: 'kvr-reasons' }, rk.reasons.map(function (r) { return el('span', { class: 'kvr-reason', text: L.reasonBase(r) }); }))]);
    if (!open) return card;

    var body = el('div', { class: 'kvr-ck-b' });
    var why = el('ul', { class: 'kvr-why' }, rk.reasons.map(function (r) {
      var gid = L.groupForReason(r);
      return el('li', {}, [el('span', { text: L.explainReason(r, { id: id, cfg: anomCfg, ctl: ctlCfg, findings: ctlRes ? ctlRes.findings : [], rules: customRules }) }),
        gid ? el('button', { type: 'button', class: 'kvr-ent kvr-adj', text: 'Juster', title: 'Åpne terskler og poeng for denne testen', onclick: function () { openSettings(gid); } }) : null].filter(Boolean));
    }));
    body.appendChild(el('div', { class: 'kvr-hint', text: 'Hvorfor flagget?' }));
    body.appendChild(why);
    var sc = scanMap[id];
    body.appendChild(el('div', { class: 'kvr-hint', text: sc && sc.settle ? 'Kassaoppgjør' : 'Bonglinjer' }));
    if (sc && sc.settle) {
      var sd = sc.settle;
      body.appendChild(tbl(['Post', 'Beløp'], [['Telt kontant', fmt(sd.telt.kontant || 0)], ['Telt sum', fmt(sd.telt.sum || 0)], ['Differanse', { t: (sd.diff.sum > 0 ? '+' : '') + fmt(sd.diff.sum || 0), bad: !!sd.diff.sum }], ['Sendt bank', fmt(sd.bank || 0)], ['Pose', sd.pose || '–']]));
    } else if (sc && sc.items) {
      var lines = sc.items.slice(0, 12).map(function (i) { return [i.n + (i.q ? ' (' + i.q + ' stk)' : ''), fmt(i.a)]; });
      Object.keys(sc.pay || {}).forEach(function (k) { lines.push([k + ':', fmt(sc.pay[k])]); });
      body.appendChild(tbl(['Linje', 'Beløp'], lines));
      if (sc.items.length > 12) body.appendChild(hintEl('… og ' + (sc.items.length - 12) + ' flere linjer. Åpne bongen i listen for alt.'));
    } else {
      body.appendChild(el('div', { class: 'kvr-scanwarn' }, [el('span', { text: 'Ikke skannet, så linjene mangler.' }), btn('Skann nå', scanVisible, 'kvr-sm')]));
    }
    var acts = [];
    if (n && n.status === 'sjekket') acts.push(btn('Angre sjekket', function () { setStatus(rec, ''); }));
    else acts.push(btn('Sjekket', function () { setStatus(rec, 'sjekket'); }, 'kvr-primary'));
    acts.push(btn('Til oppfølging', function () { setStatus(rec, 'oppfolging'); }));
    acts.push(btn('Notat…', function () { openNote(rec); }));
    acts.push(btn(selected[id] ? 'Fjern valg' : 'Velg', function () { if (selected[id]) delete selected[id]; else selected[id] = it; apply(); }));
    acts.push(btn('Vis i listen', function () { jumpTo(rec); }));
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
    ui.scopeInfo.textContent = 'Omfang: ' + scopeSummary() + ' → ' + analysisRecs('scope').length + ' av ' + recs.length + ' kvitteringer i listen.';
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

  function renderCheck() {
    if (!ui.checkBody) return;
    var body = ui.checkBody;
    body.innerHTML = '';
    ui.checkTop.innerHTML = '';
    renderScopeInfo();
    var items = analysisItems(lastMode);
    var all = L.rankReceipts(items, anomMap, weights);
    var checked = all.filter(function (r) { return notes[r.id] && notes[r.id].status === 'sjekket'; }).length;
    var vis = all.filter(function (r) { return checkState.showChecked || !(notes[r.id] && notes[r.id].status === 'sjekket'); });
    var high = vis.filter(function (r) { return L.riskLevel(r.score) === 'høy'; }).length;
    var nNew = vis.filter(function (r) { return checkState.newIds[r.id]; }).length;
    var base = analysisRecs(lastMode).filter(function (r) { return r.item.receiptType === 1 || r.item.receiptType === 2; });
    var done = base.filter(function (r) { return scanMap[r.item.transactionId]; }).length;

    var top = [
      el('div', { class: 'kvr-scoperow' }, [el('span', { text: 'Omfang: ' + scopeSummary() + ' · ' + items.length + ' bonger' }), btn('Endre', function () { ui.scopeCard.open = true; ui.scopeCard.scrollIntoView({ block: 'nearest' }); }, 'kvr-sm')]),
      hintEl('Skannet ' + done + ' av ' + base.length + (checkState.at ? ' · sist kjørt ' + new Date(checkState.at).toLocaleTimeString('nb-NO') : '')),
      btn('Kjør analyse', runAnalysis, 'kvr-primary')
    ];
    if (checkState.at && ctlRes && ctlRes.snap) top.push(btn('Lag revisjonsrapport…', openReportDialog));
    if (settingsStale && checkState.at) top.push(el('div', { class: 'kvr-notice', role: 'status' }, [el('span', { text: 'Innstillingene er endret siden sist. Kjør analysen på nytt for å bruke dem.' }), btn('Innstillinger', function () { openSettings(); }, 'kvr-sm')]));
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
    var rows = [['Tid', 'Butikk', 'Kasse', 'Kasserer', 'Bongnr', 'Type', 'Sum', 'Medlem', 'Pant salg', 'Pant retur', 'Varegrupper', 'Avvik']];
    list.forEach(function (r) {
      var it = r.item, sc = scanMap[it.transactionId], gs = groupsOf(it.transactionId);
      rows.push([it.endDateTime, sLabel(it.storeNumber), it.workstationNumber, it.cashierNumber, it.bongnr, L.typeLabel(it.receiptType),
        it.totalAmount === null ? '' : String(it.totalAmount).replace('.', ','), it.memberNumber === null ? '' : it.memberNumber,
        sc ? String(sc.sale).replace('.', ',') : '', sc ? String(sc.ret).replace('.', ',') : '', gs ? gs.join(', ') : '', (anomMap[it.transactionId] || []).join(', ')]);
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
    filters.pant = ui.pant.value;
    filters.disc = ui.disc.value;
    filters.note = ui.note.value;
    filters.sort = ui.sort.value;
  }

  function writeForm() {
    optsKey = '';
    ['dateFrom', 'dateTo', 'timeFrom', 'timeTo', 'sumMin', 'sumMax', 'member', 'bong', 'item'].forEach(function (k) { ui[k].value = filters[k]; });
    ui.onlyNegative.checked = filters.onlyNegative;
    ui.onlyMember.checked = filters.onlyMember;
    ui.onlyDup.checked = filters.onlyDup;
    ui.onlyAnom.checked = filters.onlyAnom;
    ui.pant.value = filters.pant;
    ui.disc.value = filters.disc;
    ui.note.value = filters.note;
    ui.sort.value = filters.sort;
  }

  function onChange() { readForm(); apply(); }

  function field(label, node) { return el('label', { class: 'kvr-f' }, [el('span', { text: label }), node]); }

  function input(type, extra) {
    var n = el('input', Object.assign({ type: type }, extra || {}));
    n.addEventListener('input', onChange);
    n.addEventListener('change', onChange);
    return n;
  }

  function pfield(label, node) { return el('div', { class: 'kvr-f' }, [el('span', { text: label }), node]); }

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
      return !q || String(st.number).indexOf(q) !== -1 || String(st.name).toLowerCase().indexOf(q) !== -1;
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
      legendRow(el('span', { class: 'kvr-sw kvr-sw-hi', text: 'Høy 8' }), 'Risikoscore er summen av poeng for avvikene. Høy fra 8, middels fra 4.'),
      legendRow(el('span', { class: 'kvr-sw kvr-sw-new', text: 'Ny' }), 'Flagget siden forrige analyse.'),
      legendRow(el('span', { class: 'kvr-sw kvr-sw-ent', text: 'Kasserer 12' }), 'Klikk for å se alt som gjelder kassereren eller kassen (Fokus).'),
      legendRow(el('span', { class: 'kvr-sw kvr-sw-bad', text: '−70,00' }), 'Rødt tall i tabell: over terskelen.'),
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

  function exportSettings() {
    var data = { app: 'kvitteringshenter', v: 1, ctl: ctlCfg, anom: anomCfg, weights: weights, customRules: customRules, groups: rules, stores: manualStores, keynav: keyNav };
    download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'kvitteringshenter-innstillinger.json');
    say('Innstillingene er lastet ned.');
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
          files.push({ id: pick[i].id, path: 'bevis/' + String(i + 1).padStart(2, '0') + '_' + String(rec.item.bongnr).replace(/[^A-Za-z0-9_-]/g, '-') + '.png', hash: KvReport.sha256Bytes(bytes), blob: blob });
        } catch (e) { missing.push(pick[i].id); }
        if (fastScan) await wait(120);
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
        reference: opts.reference, author: opts.author,
        scope: { text: R.scopeText, mode: R.mode, filters: R.filters, coverageText: R.coverageText, compare: R.compare },
        items: R.items, pop: R.pop, scan: R.scan, storeLabels: R.storeLabels,
        settings: { ctl: R.ctl, anom: R.anomCfg, weights: weights, currentDiffers: KvReport.stable([R.ctl, R.anomCfg]) !== KvReport.stable([ctlCfg, anomCfg]) },
        checks: { falseRet: { coverage: C.falseRet.coverage, lineCheck: C.falseRet.lineCheck }, skippedGaps: C.seq.skippedGaps || 0, numbers: C.numbers },
        findings: C.findings, ranked: ranked, explain: explain, notes: noteSub,
        cashiers: L.rankCashiers(R.items, R.anom, weights, C.profile, C.cashierExtra).slice(0, 10),
        compare: compareForReport(R), failedScans: failedRecs.length,
        evidence: { files: files.map(function (f) { return { id: f.id, path: f.path, hash: f.hash }; }), byId: byId, missing: missing, requested: pick.length, cappedFrom: ranked.length },
        settingsJson: JSON.stringify({ app: 'kvitteringshenter', v: 1, ctl: R.ctl, anom: R.anomCfg, weights: weights, customRules: customRules, groups: rules, stores: manualStores, keynav: keyNav }, null, 2) + '\n'
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
      if (!fastScan) { if (prevTr) grid.select(prevTr); else if (typeof grid.clearSelection === 'function') grid.clearSelection(); }
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

  function clamp(panel) {
    var w = panel.offsetWidth;
    var left = Math.min(Math.max(0, parseFloat(panel.style.left) || 0), Math.max(0, window.innerWidth - w));
    var top = Math.min(Math.max(0, parseFloat(panel.style.top) || 0), Math.max(0, window.innerHeight - 40));
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    panel.style.maxHeight = Math.max(160, window.innerHeight - top - 12) + 'px';
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
      start = { x: e.clientX, y: e.clientY, left: parseFloat(panel.style.left) || 0, top: parseFloat(panel.style.top) || 0, moved: false };
      head.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    head.addEventListener('pointermove', function (e) {
      if (!start) return;
      var dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) start.moved = true;
      if (!start.moved) return;
      panel.style.left = (start.left + dx) + 'px';
      panel.style.top = (start.top + dy) + 'px';
      panel.classList.add('kvr-dragging');
      clamp(panel);
    });
    head.addEventListener('pointerup', function () {
      if (!start) return;
      var moved = start.moved;
      start = null;
      panel.classList.remove('kvr-dragging');
      if (moved) store(K.pos, { left: parseFloat(panel.style.left), top: parseFloat(panel.style.top) });
      else onTap();
    });
    head.addEventListener('pointercancel', function () { start = null; panel.classList.remove('kvr-dragging'); });
    head.addEventListener('dblclick', function (e) {
      if (e.target.closest('button')) return;
      store(K.pos, null);
      store(K.size, null);
      panel.style.width = ''; panel.style.height = '';
      placePanel(panel);
    });
  }

  function buildPanel() {
    var panel = el('div', { id: 'kvr-panel' });

    ui.badge = el('span', { class: 'kvr-badge', text: 'ingen filter' });
    var toggle = el('button', { type: 'button', class: 'kvr-icon', title: 'Skjul/vis (Alt+K)', text: '–' });
    ui.wideBtn = el('button', { type: 'button', class: 'kvr-icon', title: 'Utvid eller forminsk panelet (for rapporter)', text: '⤢' });
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
    var stats = el('div', { class: 'kvr-stats' }, [ui.firstRun, el('div', { class: 'kvr-tiles' }, [t1.node, t2.node, t3.node, t4.node]), ui.chips, ui.scanRow, ui.scanWarn, ui.pantLine, ui.opRow, ui.barWrap]);

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
    var secCw = section('cw', 'Søk i hele journalen (CW)', [
      el('div', { class: 'kvr-row' }, [field('Dato fra', cwFrom), field('Dato til', cwTo)]),
      field('Butikker (navn som i CW)', cwQ), ui.cwStores, ui.cwCount,
      field('Medlemsnr', cwMem), field('Lojalitets-ID', cwLoy),
      el('div', { class: 'kvr-row' }, [field('Vare (EAN/navn)', cwFree), field('Bongnr', cwBong)]),
      el('div', { class: 'kvr-row' }, [btn('Søk i CW', cwSearch, 'kvr-primary'), btn('Nullstill CW', cwReset)]),
      ui.cwStatus
    ], true);

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

    ui.stores = storeBox(); ui.workstations = pills(); ui.cashiers = pills(); ui.types = pills();
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
    var secSum = section('sum', 'Sum, medlem, bong og vare', [
      el('div', { class: 'kvr-row' }, [field('Sum fra', ui.sumMin), field('Sum til', ui.sumMax)]),
      neg.node, field('Medlemssøk', ui.member), mem.node, dp.node,
      field('Bongnr', ui.bong), field('Vare (krever skanning)', ui.item), field('Notat/status', ui.note)
    ], true);

    // --- Skanning og pant
    ui.pant = el('select', {}, [
      el('option', { value: '', text: 'Alle' }),
      el('option', { value: 'any', text: 'Har pant eller panteretur' }),
      el('option', { value: 'sale', text: 'Har pant (salg)' }),
      el('option', { value: 'return', text: 'Har panteretur' })
    ]);
    ui.pant.addEventListener('change', onChange);
    ui.disc = el('select', {}, [
      el('option', { value: '', text: 'Alle' }),
      el('option', { value: 'any', text: 'Har rabatt (rabattlinje)' }),
      el('option', { value: 'noreason', text: 'Rabatt uten årsak' }),
      el('option', { value: 'reason', text: 'Rabatt med årsak' }),
      el('option', { value: 'coupon', text: 'Har kupong (kampanje)' })
    ].concat(L.DISC_REASONS.map(function (r) { return el('option', { value: 'r:' + r, text: 'Årsak: ' + r }); })));
    ui.disc.addEventListener('change', onChange);
    ui.scanBtn = btn('Skann innhold (synlige)', scanVisible, 'kvr-primary');
    ui.stopBtn = btn('Stopp', function () { cancelScan = true; });
    ui.stopBtn.disabled = true;
    ui.retryBtn = btn('Prøv feilede på nytt', function () { if (lastRetry) lastRetry(); });
    ui.retryBtn.disabled = true;
    var fast = check('Rask skanning (henter direkte fra CW)', function () { fastScan = fast.box.checked; store(K.fast, fastScan); });
    fast.box.checked = fastScan;
    var secScan = section('scan', 'Skanning og pant', [
      field('Pant (krever skanning)', ui.pant),
      field('Rabatt (krever skanning)', ui.disc),
      el('div', { class: 'kvr-row' }, [ui.scanBtn, ui.stopBtn]),
      el('div', { class: 'kvr-row' }, [ui.retryBtn, btn('Tøm cache', function () {
        clearScan(); anomMap = {}; failedRecs = []; lastRetry = null; syncRetry(); say('Cache tømt.'); apply();
      })]),
      fast.node,
      el('div', { class: 'kvr-hint', text: 'Standard åpner hver kvittering i visningsfeltet (ca. 1 s). Rask skanning henter kvitteringene direkte fra CW.' })
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
    var secGroups = section('groups', 'Varegrupper', [
      pfield('Filter: varegruppe (krever skanning)', ui.groups),
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
    var secFindings = fold(section('findings', 'Mønstre og funn', [ui.ctlFindings]), 'findings', true);
    var secPantBal = fold(section('pantbal', 'Pantelapp-sjekk: balanse per dag', [ui.ctlPant]), 'pantbal', false);
    var secRecon = fold(section('recon', 'Dagsavstemming per kasse', [ui.ctlRecon]), 'recon', false);
    ui.ctlDiff = el('div', {}); ui.ctlNum = el('div', {}); ui.ctlDisc = el('div', {});
    var secDiff = fold(section('diff', 'Kassadifferanse over tid', [ui.ctlDiff]), 'diff', true);
    var secNum = fold(section('numbers', 'Tallanalyse: Benford og runde beløp', [ui.ctlNum]), 'numbers', false);
    var secDisc = fold(section('disc', 'Rabatter og kuponger', [ui.ctlDisc]), 'disc', true);
    ui.ctlSum = el('div', { class: 'kvr-ctlsum' });
    ui.ctlJump = el('div', { class: 'kvr-chips' });
    [['profile', 'Profil'], ['findings', 'Funn'], ['pantbal', 'Pant'], ['recon', 'Avstemming'], ['diff', 'Differanse'], ['numbers', 'Tall'], ['disc', 'Rabatt']].forEach(function (j) {
      ui.ctlJump.appendChild(btn(j[1], function () {
        var n = openSec(j[0]);
        if (n) n.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }, 'kvr-chip'));
    });
    ui.ctlSumCard = section('ctlsum', 'Resultat', [ui.ctlSum, ui.ctlJump,
      el('div', { class: 'kvr-row' }, [btn('Fold sammen alle', function () { foldAll(false); }, 'kvr-sm'), btn('Åpne alle', function () { foldAll(true); }, 'kvr-sm'), btn('⤢ Bredere', function () { ui.wideBtn.click(); }, 'kvr-sm')]),
      hintEl('Tabellene har mange kolonner. «Bredere» gir plass til alle.')]);
    ui.ctlResults = el('div', { class: 'kvr-pane' }, [secProfile, secFindings, secPantBal, secRecon, secDiff, secNum, secDisc]);
    ui.noteList = el('div', { class: 'kvr-list' });
    ui.noteCount = hintEl('');
    var kn = check('Tastaturflyt: ↑ ↓ bytter bong, N notat, M velg/fjern', function () { keyNav = kn.box.checked; store(K.keynav, keyNav); });
    kn.box.checked = keyNav;
    ui.keyNavBox = kn;
    var secNotes = fold(section('notes', 'Oppfølging og tastatur', [
      ui.noteCount, ui.noteList,
      el('div', { class: 'kvr-row' }, [btn('Notat på valgt rad', function () { openNote(currentRec()); }), btn('Eksporter notater', exportNotes)]),
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
    var secSort = section('sort', 'Sortering', [field('Sortering', ui.sort)], true);

    // --- Lagrede filtre
    ui.name = el('input', { type: 'text', placeholder: 'navn på filter' });
    ui.saved = el('select', {});
    var secSaved = section('saved', 'Lagrede filtre', [
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
    ], false);

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
    ui.setGeneral = section('set-general', 'Generelt', [
      field('Egne butikknavn (valgfritt, nr=navn per linje)', storeNames),
      kn.node,
      el('div', { class: 'kvr-row' }, [btn('Eksporter innstillinger', exportSettings), btn('Importer…', function () { setFile.click(); })]), setFile,
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
      hintEl('Eksport tar med terskler, poeng, egne regler, varegrupper og butikknavn. Skannede kvitteringer og notater tas ikke med.')
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
    var subHost = el('div', {});
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
    var moreHost = el('div', {});
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
      ['cw', 'Hent', [hintEl('Henter nye kvitteringer fra Lindbak (hele journalen). Resultatet kan så filtreres under «Filtrer».'), secCw]],
      ['filter', 'Filtrer', [hintEl('Filtrerer kvitteringene som allerede er listet. Ingenting hentes på nytt.'), secStore, secTime, secWho, secSum, secSort, secSaved]],
      ['content', 'Skann', [el('p', { class: 'kvr-intro', text: 'Skann kvitteringene for å finne pant, varegrupper og varer. Filtrer listen først, så skanner du bare det som er synlig.' }), secScan, secGroups]],
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
      clamp(panel);
    }
    function flip() { setCollapsed(!panel.classList.contains('kvr-collapsed')); }
    toggle.addEventListener('click', flip);
    ui.wideBtn.addEventListener('click', function () {
      var w = panel.classList.toggle('kvr-wide');
      panel.style.width = ''; panel.style.height = '';
      store(K.size, null); store(K.wide, w);
      clamp(panel);
      setTimeout(renderChartsIfVisible, 60);
    });
    enableDrag(panel, head, function () { if (panel.classList.contains('kvr-collapsed')) flip(); });
    document.addEventListener('keydown', function (e) {
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); flip(); }
    });
    document.addEventListener('mouseup', function () {
      if (panel.classList.contains('kvr-collapsed')) return;
      if (panel.style.width || panel.style.height) { store(K.size, { width: panel.style.width, height: panel.style.height }); renderChartsIfVisible(); }
    });
    window.addEventListener('resize', function () { clamp(panel); });

    if (store(K.wide)) panel.classList.add('kvr-wide');
    placePanel(panel);
    if (store(K.collapsed)) setCollapsed(true);
    renderSaved();
    renderRules();
    renderCwStores();
    renderCustom();
    renderTasks();
    renderControl();
    renderNotes();
    renderReportLog();
    installKeys();
  }

  function attach() {
    var g = getGrid();
    if (!g) return;
    if (g.__kvBound) {
      if (refreshStoreMap()) { optsKey = ''; renderCwStores(); }
      var tb = g.tbody && g.tbody[0];
      if (tb && !scanning && tb.querySelectorAll(':scope > tr').length !== tb.querySelectorAll(':scope > tr > td.kvr-cb-cell').length) apply();
      return;
    }
    grid = g;
    g.__kvBound = true;
    if (!document.getElementById('kvr-panel')) buildPanel();
    installGridClicks();
    g.bind('dataBound', function () { boundCount++; setTimeout(apply, 0); });
    apply();
    renderCwStores();
  }

  openDb().then(async function (d) {
    db = d;
    if (db) {
      mem = await readAll(db, 'kv');
      var raw = await readAll(db, 'scan');
      Object.keys(raw).forEach(function (k) { if (raw[k] && (raw[k].v === 2 || raw[k].v === 3)) scanMap[k] = raw[k]; });
    }
    migrateLocal();
    rules = L.sanitizeRules(store(K.rules));
    anomCfg = L.sanitizeAnom(store(K.anom));
    manualStores = store(K.stores) || '';
    fastScan = !!store(K.fast);
    customRules = L.sanitizeCustom(store(K.arules));
    notes = store(K.notes) || {};
    tasksCustom = Array.isArray(store(K.tasks)) ? store(K.tasks) : [];
    ctlCfg = L.sanitizeControl(store(K.ctl));
    keyNav = store(K.keynav) !== false;
    weights = L.sanitizeWeights(store(K.weights));
    scope = sanitizeScope(store(K.scope));
    setInterval(attach, 1500);
    attach();
  });
})();
