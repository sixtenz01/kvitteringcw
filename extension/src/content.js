(function () {
  'use strict';
  if (window.__kvRewamp) return;
  window.__kvRewamp = true;

  var L = window.KvLogic;
  var K = {
    saved: 'kvr.saved.v1', collapsed: 'kvr.collapsed.v1', scan: 'kvr.scan.v2', pos: 'kvr.pos.v1',
    size: 'kvr.size.v1', sec: 'kvr.sec.v1', rules: 'kvr.rules.v1', anom: 'kvr.anom.v1',
    stores: 'kvr.stores.v1', fast: 'kvr.fast.v1', tab: 'kvr.tab.v1', layout: 'kvr.layout.v1'
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
  var rules, anomCfg, manualStores, fastScan;

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
        scanMap[id] = L.parseReceipt(rows);
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

  function todoVisible() {
    return recs.filter(function (r) { return r.show && r.item.receiptType === 1 && !scanMap[r.item.transactionId]; });
  }

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
    ui.scanStatus.textContent = msg;
    ui.exportStatus.textContent = msg;
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
    if (!todo.length) { ui.scanStatus.textContent = 'Ingenting å skanne (alt er skannet, eller ingen synlige salg).'; return; }
    await scanList(todo);
    apply();
  }

  async function runAnom() {
    if (scanning) return;
    await scanList(todoVisible());
    anomMap = {};
    var n = 0;
    recs.forEach(function (r) {
      if (!r.show) return;
      var reasons = L.anomalies(r.item, scanMap[r.item.transactionId], anomCfg);
      if (reasons.length) { anomMap[r.item.transactionId] = reasons; n++; }
    });
    ui.anomStatus.textContent = 'Avviksjekk ferdig: ' + n + ' kvitteringer flagget.';
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

  function fillSelect(sel, values, labelFn, chosen) {
    sel.innerHTML = '';
    values.forEach(function (v) {
      var o = el('option', { value: v, text: labelFn ? labelFn(v) : v });
      if (chosen.indexOf(String(v)) !== -1) o.selected = true;
      sel.appendChild(o);
    });
  }

  function readSelect(sel) {
    return Array.prototype.filter.call(sel.options, function (o) { return o.selected; }).map(function (o) { return o.value; });
  }

  function groupNames() {
    return rules.map(function (r) { return r.name; }).concat([L.NO_GROUP]);
  }

  function refreshOptions() {
    var key = [distinct('storeNumber'), distinct('workstationNumber'), distinct('cashierNumber'), distinct('receiptType'), JSON.stringify(storeMap), groupNames()].join('|');
    if (key === optsKey) return;
    optsKey = key;
    fillSelect(ui.stores, distinct('storeNumber'), sLabel, filters.stores);
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
    var ctx = { dupIds: dup.ids, scan: scanMap, groupsOf: groupsOf, anom: anomMap };
    var visible = 0;
    ensureColumn();
    recs.forEach(function (r) {
      var id = r.item.transactionId;
      var show = L.matches(r.item, filters, ctx);
      r.show = show;
      r.tr.style.display = show ? '' : 'none';
      r.tr.classList.toggle('kvr-dup', !!dup.ids[id]);
      r.tr.classList.toggle('kvr-flag', !!(anomMap[id] && anomMap[id].length));
      var tips = [];
      if (dup.ids[id]) tips.push('Mulig duplikat: samme beløp, butikk, kasse og tid');
      if (anomMap[id]) tips.push('Avvik: ' + anomMap[id].join(', '));
      var gs = groupsOf(id);
      if (gs) tips.push('Varegrupper: ' + gs.join(', '));
      if (tips.length) r.tr.title = tips.join('\n'); else r.tr.removeAttribute('title');
      ensureCell(r);
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
    ui.footPng.disabled = sm.count === 0 || scanning;
    ui.footCsv.textContent = sm.count ? 'CSV (' + sm.count + ')' : 'CSV';
    ui.footPng.textContent = sm.count ? 'PNG (' + sm.count + ')' : 'PNG';
  }


  function chipDefs() {
    var f = filters, out = [];
    var add = function (label, clear) { out.push({ label: label, clear: clear }); };
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
    if (f.pant) add('Pant: ' + ({ any: 'pant/retur', sale: 'salg', 'return': 'retur' }[f.pant] || f.pant), function () { f.pant = ''; });
    if (f.groups.length) add('Gruppe: ' + f.groups.join(', '), function () { f.groups = []; });
    return out;
  }

  function renderChips() {
    var defs = chipDefs();
    ui.chips.innerHTML = '';
    ui.chips.style.display = defs.length ? 'flex' : 'none';
    defs.forEach(function (d) {
      ui.chips.appendChild(el('button', { type: 'button', class: 'kvr-fchip', title: 'Fjern filter', onclick: function () { d.clear(); writeForm(); apply(); } }, [
        el('span', { text: d.label }), el('b', { text: '×' })
      ]));
    });
    if (defs.length > 1) ui.chips.appendChild(el('button', { type: 'button', class: 'kvr-link', text: 'Nullstill alle', onclick: function () { filters = L.defaultFilters(); writeForm(); apply(); } }));
    ui.tabDot.style.display = defs.length ? '' : 'none';
    ui.tabDot.textContent = defs.length ? String(defs.length) : '';
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
    // avviksliste
    ui.anomList.innerHTML = '';
    var flagged = recs.filter(function (r) { return anomMap[r.item.transactionId]; }).slice(0, 40);
    flagged.forEach(function (r) {
      var it = r.item;
      var row = el('div', { class: 'kvr-li' }, [
        el('b', { text: it.endDateTime + ' · kasse ' + it.workstationNumber + ' · ' + (it.totalAmount === null ? '–' : fmt(it.totalAmount)) }),
        el('span', { text: anomMap[it.transactionId].join(' · ') })
      ]);
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
            if (!window.confirm('Slette varegruppen «' + r.name + '»?')) return;
            rules.splice(i, 1); saveRules(); renderRules(); apply();
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

  function pngHeader(it) {
    var lines = ['Kasse ' + it.workstationNumber + ' · Kasserer ' + it.cashierNumber, 'Bongnr: ' + it.bongnr, it.endDateTime];
    if (ui.pngMember.checked && it.memberNumber) lines.push('Medlem: ' + it.memberNumber);
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

  async function exportPng(list) {
    if (scanning) return;
    if (!window.html2canvas || !window.JSZip) { ui.exportStatus.textContent = 'Biblioteker (html2canvas/JSZip) er ikke lastet.'; return; }
    if (!list.length) { ui.exportStatus.textContent = 'Velg kvitteringer først.'; return; }
    scanning = true; cancelScan = false;
    ui.scanBtn.disabled = true; ui.anomBtn.disabled = true; ui.stopBtn.disabled = false; ui.stopTop.style.display = ''; ui.retryBtn.disabled = true; if (ui.retryBtn2) ui.retryBtn2.disabled = true;
    var prev = grid.select();
    var prevTr = prev && prev[0];
    var files = [], failed = [], t0 = Date.now();
    for (var i = 0; i < list.length && !cancelScan; i++) {
      progress(i, list.length, t0, 'PNG', failed.length);
      try {
        var html = await receiptHtml(list[i]);
        if (!html) throw new Error('ingen kvittering');
        var clean = html.replace(/xmlns[^=]*="[^"]*"/g, '').replace(/<link[^>]*>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
        var lay = PNG_LAYOUTS[ui.pngLayout.value] || PNG_LAYOUTS.bong;
        var full = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' + PNG_CSS + '</style></head><body><div class="kvr-page' + lay.cls + '"><div class="kvr-sheet" style="width:' + lay.sheet + 'px">' +
          (ui.pngHeaderOn.checked ? pngHeader(list[i].item) : '') + clean + '</div></div></body></html>';
        var blob = await htmlToPng(full, lay.w, lay.scale);
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

  // ---- CSV ------------------------------------------------------------------
  function exportCsv(onlySelected) {
    var list = recs.filter(function (r) { return onlySelected ? selected[r.item.transactionId] : r.show; });
    var rows = [['Tid', 'Butikk', 'Kasse', 'Kasserer', 'Bongnr', 'Type', 'Sum', 'Medlem', 'Pant salg', 'Pant retur', 'Varegrupper', 'Avvik']];
    list.forEach(function (r) {
      var it = r.item, sc = scanMap[it.transactionId], gs = groupsOf(it.transactionId);
      rows.push([it.endDateTime, sLabel(it.storeNumber), it.workstationNumber, it.cashierNumber, it.bongnr, L.typeLabel(it.receiptType),
        it.totalAmount === null ? '' : String(it.totalAmount).replace('.', ','), it.memberNumber === null ? '' : it.memberNumber,
        sc ? String(sc.sale).replace('.', ',') : '', sc ? String(sc.ret).replace('.', ',') : '', gs ? gs.join(', ') : '', (anomMap[it.transactionId] || []).join(', ')]);
    });
    download(new Blob([L.toCsv(rows)], { type: 'text/csv;charset=utf-8' }), 'kvitteringer.csv');
    ui.exportStatus.textContent = (rows.length - 1) + ' rader eksportert.';
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

  function multi(rows) {
    var s = el('select', { multiple: 'multiple', size: String(rows || 4) });
    s.addEventListener('change', onChange);
    return s;
  }

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
      ui.cwStores.appendChild(el('option', { value: '', text: 'Butikkliste ikke lastet fra CW ennå…', disabled: 'disabled' }));
      return;
    }
    cwStoreList.filter(function (s) {
      return !q || String(s.number).indexOf(q) !== -1 || String(s.name).toLowerCase().indexOf(q) !== -1;
    }).slice(0, 200).forEach(function (s) {
      var o = el('option', { value: s.number, text: sLabel(s.number) });
      if (cw.stores[s.number]) o.selected = true;
      ui.cwStores.appendChild(o);
    });
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
    var head = el('div', { class: 'kvr-head', title: 'Dra for å flytte · dobbeltklikk for å nullstille plassering og størrelse' }, [
      el('span', { class: 'kvr-grip', text: '⠿' }),
      el('span', { class: 'kvr-title', text: 'Kvitteringshenter' }),
      ui.badge,
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
    ui.opRow = el('div', { class: 'kvr-oprow', style: 'display:none' }, [ui.opText, ui.stopTop]);
    var stats = el('div', { class: 'kvr-stats' }, [el('div', { class: 'kvr-tiles' }, [t1.node, t2.node, t3.node, t4.node]), ui.chips, ui.pantLine, ui.opRow, ui.barWrap]);

    // --- Søk i CW
    var cwFrom = el('input', { type: 'date' }), cwTo = el('input', { type: 'date' });
    cwFrom.addEventListener('change', function () { cw.dateFrom = cwFrom.value; if (!cwTo.value) { cwTo.value = cwFrom.value; cw.dateTo = cwFrom.value; } });
    cwTo.addEventListener('change', function () { cw.dateTo = cwTo.value; });
    var cwQ = el('input', { type: 'text', placeholder: 'søk butikk (navn eller nr)' });
    cwQ.addEventListener('input', function () { cw.storeQuery = cwQ.value; renderCwStores(); });
    ui.cwStores = el('select', { multiple: 'multiple', size: '6' });
    ui.cwStores.addEventListener('change', function () {
      Array.prototype.forEach.call(ui.cwStores.options, function (o) { if (o.value) cw.stores[o.value] = o.selected; });
      ui.cwCount.textContent = Object.keys(cw.stores).filter(function (k) { return cw.stores[k]; }).length + ' butikker valgt';
    });
    ui.cwCount = el('div', { class: 'kvr-hint', text: '0 butikker valgt' });
    var cwMem = el('input', { type: 'text', placeholder: 'medlemsnr, kommaseparert' });
    var cwLoy = el('input', { type: 'text', placeholder: 'lojalitets-ID, kommaseparert' });
    var cwFree = el('input', { type: 'text', placeholder: 'EAN eller varenavn' });
    var cwBong = el('input', { type: 'text', placeholder: 'bongnr' });
    cwMem.addEventListener('input', function () { cw.members = cwMem.value.trim(); });
    cwLoy.addEventListener('input', function () { cw.loyal = cwLoy.value.trim(); });
    cwFree.addEventListener('input', function () { cw.free = cwFree.value.trim(); });
    cwBong.addEventListener('input', function () { cw.bong = cwBong.value.trim(); });
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

    ui.stores = multi(3); ui.workstations = multi(4); ui.cashiers = multi(4); ui.types = multi(3);
    var storeNames = el('textarea', { rows: '3', placeholder: '1005=Coop Mega Kolbotn', title: 'Egne butikknavn (nr=navn per linje). Brukes hvis CW-listen ikke finnes.' });
    storeNames.value = manualStores;
    storeNames.addEventListener('change', function () { manualStores = storeNames.value; store(K.stores, manualStores); optsKey = ''; apply(); });
    var secWho = section('who', 'Butikk, kasse og type', [
      el('div', { class: 'kvr-row' }, [field('Butikk', ui.stores), field('Kasse', ui.workstations)]),
      el('div', { class: 'kvr-row' }, [field('Kasserer', ui.cashiers), field('Type', ui.types)]),
      el('div', { class: 'kvr-hint', text: 'Hold Ctrl for flere valg.' }),
      field('Egne butikknavn (valgfritt)', storeNames)
    ], true);

    ui.sumMin = input('number', { step: '0.01', placeholder: 'min' });
    ui.sumMax = input('number', { step: '0.01', placeholder: 'maks' });
    var neg = check('Negativ sum (retur/panteretur)'); ui.onlyNegative = neg.box;
    ui.member = input('text', { placeholder: 'medlemsnr' });
    var mem = check('Kun med medlem'); ui.onlyMember = mem.box;
    var dp = check('Kun mulige duplikater'); ui.onlyDup = dp.box;
    ui.bong = input('text', { placeholder: 'bongnr, f.eks. 1005-6-123' });
    ui.item = input('text', { placeholder: 'EAN eller varenavn (skannede)' });
    var secSum = section('sum', 'Sum, medlem, bong og vare', [
      el('div', { class: 'kvr-row' }, [field('Sum fra', ui.sumMin), field('Sum til', ui.sumMax)]),
      neg.node, field('Medlemssøk', ui.member), mem.node, dp.node,
      field('Bongnr', ui.bong), field('Vare (krever skanning)', ui.item)
    ], true);

    // --- Skanning og pant
    ui.pant = el('select', {}, [
      el('option', { value: '', text: 'Alle' }),
      el('option', { value: 'any', text: 'Har pant eller panteretur' }),
      el('option', { value: 'sale', text: 'Har pant (salg)' }),
      el('option', { value: 'return', text: 'Har panteretur' })
    ]);
    ui.pant.addEventListener('change', onChange);
    ui.scanBtn = btn('Skann innhold (synlige)', scanVisible, 'kvr-primary');
    ui.stopBtn = btn('Stopp', function () { cancelScan = true; });
    ui.stopBtn.disabled = true;
    ui.retryBtn = btn('Prøv feilede på nytt', function () { if (lastRetry) lastRetry(); });
    ui.retryBtn.disabled = true;
    ui.scanStatus = el('div', { class: 'kvr-note', text: '' });
    var fast = check('Rask skanning via CW-API (som gamle pluginen)', function () { fastScan = fast.box.checked; store(K.fast, fastScan); });
    fast.box.checked = fastScan;
    var secScan = section('scan', 'Skanning og pant', [
      field('Pant (krever skanning)', ui.pant),
      el('div', { class: 'kvr-row' }, [ui.scanBtn, ui.stopBtn]),
      el('div', { class: 'kvr-row' }, [ui.retryBtn, btn('Tøm cache', function () {
        clearScan(); anomMap = {}; failedRecs = []; lastRetry = null; syncRetry(); ui.scanStatus.textContent = 'Cache tømt.'; apply();
      })]),
      fast.node,
      el('div', { class: 'kvr-hint', text: 'Standard åpner hver kvittering i visningsfeltet (ca. 1 s). Rask skanning henter kvitteringene direkte fra CW.' }),
      ui.scanStatus
    ], true);

    // --- Varegrupper
    ui.groups = multi(5);
    ui.groupSums = el('div', {});
    ui.unmatched = el('div', {});
    ui.rules = el('div', {});
    var fileIn = el('input', { type: 'file', accept: 'application/json', style: 'display:none' });
    fileIn.addEventListener('change', function () {
      var f = fileIn.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try { rules = L.sanitizeRules(JSON.parse(fr.result)); saveRules(); renderRules(); apply(); } catch (e) { window.alert('Ugyldig regelfil.'); }
      };
      fr.readAsText(f);
      fileIn.value = '';
    });
    var rulesDetails = el('details', { class: 'kvr-sub' }, [el('summary', { text: 'Regelsett (rekkefølge = prioritet)' }), ui.rules,
      el('div', { class: 'kvr-row' }, [
        btn('Ny gruppe', function () { rules.push({ name: 'Ny gruppe', include: [], exclude: [] }); saveRules(); renderRules(); }),
        btn('Eksporter', function () { download(new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' }), 'varegrupper.json'); }),
        btn('Importer', function () { fileIn.click(); }),
        btn('Standard', function () { if (window.confirm('Tilbakestille til standardregler?')) { rules = L.defaultRules(); saveRules(); renderRules(); apply(); } })
      ]), fileIn]);
    var secGroups = section('groups', 'Varegrupper', [
      field('Filter: varegruppe (krever skanning)', ui.groups),
      el('div', { class: 'kvr-hint', text: 'Sum per varegruppe for valgte kvitteringer:' }), ui.groupSums,
      el('div', { class: 'kvr-hint kvr-mt', text: 'Varer uten gruppe (mest solgt):' }), ui.unmatched,
      rulesDetails
    ], false);

    // --- Avvik
    var cfgFields = {};
    function cfgInput(key, label, ph) {
      var n = el('input', { type: 'number', step: '1', placeholder: ph });
      n.value = anomCfg[key];
      n.addEventListener('change', function () { anomCfg[key] = n.value; store(K.anom, anomCfg); });
      cfgFields[key] = n;
      return field(label, n);
    }
    var cashNo = check('Kontant tilbake uten salg', function () { anomCfg.cashNoSale = cashNo.box.checked; store(K.anom, anomCfg); });
    cashNo.box.checked = anomCfg.cashNoSale;
    var oa = check('Kun avvik'); ui.onlyAnom = oa.box;
    ui.anomBtn = btn('Kjør avviksjekk (synlige)', runAnom, 'kvr-primary');
    ui.anomStatus = el('div', { class: 'kvr-note', text: '' });
    ui.anomList = el('div', { class: 'kvr-list' });
    var secAnom = section('anom', 'Avvik', [
      el('div', { class: 'kvr-hint', text: 'Kjøres kun når du trykker. Tom verdi = sjekken er av.' }),
      el('div', { class: 'kvr-row' }, [cfgInput('bigReturn', 'Stor panteretur ≥ kr', '300'), cfgInput('manyLapper', 'Pantelapper ≥ antall', '8')]),
      el('div', { class: 'kvr-row' }, [cfgInput('roundMin', 'Rundt beløp ≥ kr', '500')]),
      cashNo.node, oa.node, ui.anomBtn, ui.anomStatus, ui.anomList
    ], false);

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
    ui.exportStatus = el('div', { class: 'kvr-note', text: '' });
    var secExport = section('export', 'Eksport', [
      el('div', { class: 'kvr-row' }, [btn('CSV: synlige', function () { exportCsv(false); }), btn('CSV: valgte', function () { exportCsv(true); })]),
      el('div', { class: 'kvr-row' }, [btn('PNG: valgte (ZIP)', function () { exportPng(selectedRecs()); }), ui.retryBtn2 = btn('Prøv feilede på nytt', function () { if (lastRetry) lastRetry(); })]),
      field('PNG-format', ui.pngLayout), pH.node, pM.node,
      el('div', { class: 'kvr-hint', text: 'Semikolon-separert, åpnes direkte i Excel. Varegrupper og pant tas med for skannede kvitteringer.' }),
      ui.exportStatus
    ], false);

    var tabDefs = [
      ['cw', 'Søk', [secCw]],
      ['filter', 'Filter', [secSaved, secTime, secWho, secSum, secSort]],
      ['content', 'Innhold', [el('p', { class: 'kvr-intro', text: 'Skann kvitteringene for å finne pant, varegrupper og varer. Filtrer listen først, så skanner du bare det som er synlig.' }), secScan, secGroups]],
      ['anom', 'Avvik', [secAnom]],
      ['export', 'Eksport', [secExport]]
    ];
    ui.tabBtns = {}; ui.panes = {};
    var tabBar = el('div', { class: 'kvr-tabs', role: 'tablist' });
    var scroll = el('div', { class: 'kvr-scroll' });
    function showTab(id) {
      Object.keys(ui.panes).forEach(function (k) {
        ui.panes[k].style.display = k === id ? '' : 'none';
        ui.tabBtns[k].classList.toggle('kvr-active', k === id);
        ui.tabBtns[k].setAttribute('aria-selected', k === id ? 'true' : 'false');
      });
      store(K.tab, id);
      scroll.scrollTop = 0;
    }
    tabDefs.forEach(function (t) {
      var b = el('button', { type: 'button', class: 'kvr-tab', role: 'tab', text: t[1] });
      b.addEventListener('click', function () { showTab(t[0]); });
      ui.tabBtns[t[0]] = b;
      tabBar.appendChild(b);
      ui.panes[t[0]] = el('div', { class: 'kvr-pane', role: 'tabpanel' }, t[2]);
      scroll.appendChild(ui.panes[t[0]]);
    });
    ui.tabDot = el('i', { class: 'kvr-dot', style: 'display:none' });
    ui.tabBtns.filter.appendChild(ui.tabDot);

    ui.footPng = btn('PNG', function () { exportPng(selectedRecs()); }, 'kvr-primary');
    ui.footPng.title = 'Last ned valgte kvitteringer som PNG (ZIP ved flere)';
    ui.footCsv = btn('CSV', function () { exportCsv(Object.keys(selected).length > 0); });
    ui.footCsv.title = 'Eksporter valgte (eller synlige hvis ingen er valgt) til CSV';
    var foot = el('div', { class: 'kvr-foot' }, [
      btn('Velg alle', function () {
        recs.forEach(function (r) { if (r.show) selected[r.item.transactionId] = r.item; });
        apply();
      }),
      btn('Fjern valg', function () { selected = {}; apply(); }),
      ui.footCsv,
      ui.footPng
    ]);

    panel.appendChild(head);
    panel.appendChild(el('div', { class: 'kvr-main' }, [stats, tabBar, scroll, foot]));
    document.body.appendChild(panel);
    showTab(ui.panes[store(K.tab)] ? store(K.tab) : 'filter');

    function setCollapsed(c) {
      panel.classList.toggle('kvr-collapsed', c);
      toggle.textContent = c ? '+' : '–';
      store(K.collapsed, c);
      clamp(panel);
    }
    function flip() { setCollapsed(!panel.classList.contains('kvr-collapsed')); }
    toggle.addEventListener('click', flip);
    enableDrag(panel, head, function () { if (panel.classList.contains('kvr-collapsed')) flip(); });
    document.addEventListener('keydown', function (e) {
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); flip(); }
    });
    document.addEventListener('mouseup', function () {
      if (panel.classList.contains('kvr-collapsed')) return;
      if (panel.style.width || panel.style.height) store(K.size, { width: panel.style.width, height: panel.style.height });
    });
    window.addEventListener('resize', function () { clamp(panel); });

    placePanel(panel);
    if (store(K.collapsed)) setCollapsed(true);
    renderSaved();
    renderRules();
    renderCwStores();
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
    g.bind('dataBound', function () { setTimeout(apply, 0); });
    apply();
    renderCwStores();
  }

  openDb().then(async function (d) {
    db = d;
    if (db) {
      mem = await readAll(db, 'kv');
      var raw = await readAll(db, 'scan');
      Object.keys(raw).forEach(function (k) { if (raw[k] && raw[k].v === 2) scanMap[k] = raw[k]; });
    }
    migrateLocal();
    rules = L.sanitizeRules(store(K.rules));
    anomCfg = L.sanitizeAnom(store(K.anom));
    manualStores = store(K.stores) || '';
    fastScan = !!store(K.fast);
    setInterval(attach, 1500);
    attach();
  });
})();
