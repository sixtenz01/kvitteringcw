(function () {
  'use strict';
  if (window.__kvRewamp) return;
  window.__kvRewamp = true;

  var L = window.KvLogic;
  var K = {
    saved: 'kvr.saved.v1', collapsed: 'kvr.collapsed.v1', scan: 'kvr.scan.v2', pos: 'kvr.pos.v1',
    size: 'kvr.size.v1', sec: 'kvr.sec.v1', rules: 'kvr.rules.v1', anom: 'kvr.anom.v1',
    stores: 'kvr.stores.v1', fast: 'kvr.fast.v1'
  };
  var API_ROOT = '/LindbakRetail_1/Journal/Viewer/Api/';
  var SCAN_TIMEOUT = 6000;
  var SCAN_LIMIT = 3000;

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

  function store(key, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { return null; }
  }

  var scanMap = (function () {
    var raw = store(K.scan) || {};
    var out = {};
    Object.keys(raw).forEach(function (k) { if (raw[k] && raw[k].v === 2) out[k] = raw[k]; });
    return out;
  })();
  var rules = L.sanitizeRules(store(K.rules));
  var anomCfg = L.sanitizeAnom(store(K.anom));
  var manualStores = store(K.stores) || '';
  var fastScan = !!store(K.fast);

  function saveScan() {
    var keys = Object.keys(scanMap);
    if (keys.length > SCAN_LIMIT) keys.slice(0, keys.length - SCAN_LIMIT).forEach(function (k) { delete scanMap[k]; });
    store(K.scan, scanMap);
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
    ui.scanBtn.disabled = true; ui.anomBtn.disabled = true; ui.stopBtn.disabled = false;
    var prev = grid.select();
    var prevTr = prev && prev[0];
    var done = 0, failed = 0;
    for (var i = 0; i < todo.length && !cancelScan; i++) {
      ui.scanStatus.textContent = 'Skanner ' + (i + 1) + ' av ' + todo.length + (failed ? ' · feilet: ' + failed : '');
      var rows = null;
      try { rows = fastScan ? await loadViaApi(todo[i]) : await loadViaDom(todo[i]); } catch (e) { rows = null; }
      if (rows) { scanMap[todo[i].item.transactionId] = L.parseReceipt(rows); done++; } else failed++;
      if (fastScan) await wait(120);
    }
    saveScan();
    gcache = {};
    if (!fastScan) {
      if (prevTr) grid.select(prevTr); else if (typeof grid.clearSelection === 'function') grid.clearSelection();
    }
    scanning = false;
    ui.scanBtn.disabled = false; ui.anomBtn.disabled = false; ui.stopBtn.disabled = true;
    ui.scanStatus.textContent = (cancelScan ? 'Stoppet. ' : 'Ferdig. ') + 'Skannet ' + done + (failed ? ', feilet ' + failed : '') + '.';
    return { done: done, failed: failed };
  }

  function todoVisible() {
    return recs.filter(function (r) { return r.show && r.item.receiptType === 1 && !scanMap[r.item.transactionId]; });
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

  function ensureCheckbox(r) {
    var td = r.tr.children[0];
    if (!td) return;
    var cb = td.querySelector('input.kvr-cb');
    var id = r.item.transactionId;
    if (!cb) {
      cb = el('input', { type: 'checkbox', class: 'kvr-cb', title: 'Velg kvittering' });
      cb.addEventListener('click', function (e) { e.stopPropagation(); });
      cb.addEventListener('change', function () {
        if (cb.checked) selected[id] = r.item; else delete selected[id];
        summary();
      });
      td.insertBefore(cb, td.firstChild);
    }
    cb.checked = !!selected[id];
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
      ensureCheckbox(r);
      if (show) visible++;
    });
    reorder();
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
  function section(id, title, kids, open) {
    var body = el('div', { class: 'kvr-secbody' }, kids);
    var d = el('details', { class: 'kvr-sec' }, [el('summary', { text: title }), body]);
    var st = store(K.sec) || {};
    d.open = id in st ? !!st[id] : open;
    d.addEventListener('toggle', function () {
      var m = store(K.sec) || {};
      m[id] = d.open;
      store(K.sec, m);
    });
    return d;
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
    var stats = el('div', { class: 'kvr-stats' }, [el('div', { class: 'kvr-tiles' }, [t1.node, t2.node, t3.node, t4.node]), ui.pantLine]);

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
    var secCw = section('cw', 'Søk i CW (hele journalen)', [
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
    var secTime = section('time', 'Filtrer listen: dato og tid', [
      quick,
      el('div', { class: 'kvr-row' }, [field('Dato fra', ui.dateFrom), field('Dato til', ui.dateTo)]),
      el('div', { class: 'kvr-row' }, [field('Tid fra', ui.timeFrom), field('Tid til', ui.timeTo)])
    ], true);

    ui.stores = multi(3); ui.workstations = multi(4); ui.cashiers = multi(4); ui.types = multi(3);
    var storeNames = el('textarea', { rows: '3', placeholder: '1005=Coop Mega Kolbotn', title: 'Egne butikknavn (nr=navn per linje). Brukes hvis CW-listen ikke finnes.' });
    storeNames.value = manualStores;
    storeNames.addEventListener('change', function () { manualStores = storeNames.value; store(K.stores, manualStores); optsKey = ''; apply(); });
    var secWho = section('who', 'Filtrer listen: butikk, kasse og type', [
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
    var secSum = section('sum', 'Filtrer listen: sum, medlem, bong og vare', [
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
    ui.scanStatus = el('div', { class: 'kvr-note', text: '' });
    var fast = check('Rask skanning via CW-API (som gamle pluginen)', function () { fastScan = fast.box.checked; store(K.fast, fastScan); });
    fast.box.checked = fastScan;
    var secScan = section('scan', 'Skanning og pant', [
      field('Pant (krever skanning)', ui.pant),
      el('div', { class: 'kvr-row' }, [ui.scanBtn, ui.stopBtn, btn('Tøm cache', function () {
        scanMap = {}; gcache = {}; anomMap = {}; store(K.scan, scanMap); ui.scanStatus.textContent = 'Cache tømt.'; apply();
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
    ui.exportStatus = el('div', { class: 'kvr-note', text: '' });
    var secExport = section('export', 'Eksport', [
      el('div', { class: 'kvr-row' }, [btn('CSV: synlige', function () { exportCsv(false); }), btn('CSV: valgte', function () { exportCsv(true); })]),
      el('div', { class: 'kvr-hint', text: 'Semikolon-separert, åpnes direkte i Excel. Varegrupper og pant tas med for skannede kvitteringer.' }),
      ui.exportStatus
    ], false);

    var scroll = el('div', { class: 'kvr-scroll' }, [secCw, secTime, secWho, secSum, secScan, secGroups, secAnom, secSort, secSaved, secExport]);
    var foot = el('div', { class: 'kvr-foot' }, [
      btn('Nullstill', function () { filters = L.defaultFilters(); writeForm(); apply(); }),
      btn('Velg synlige', function () {
        recs.forEach(function (r) { if (r.show) selected[r.item.transactionId] = r.item; });
        apply();
      }),
      btn('Fjern valg', function () { selected = {}; apply(); })
    ]);

    panel.appendChild(head);
    panel.appendChild(el('div', { class: 'kvr-main' }, [stats, scroll, foot]));
    document.body.appendChild(panel);

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
      return;
    }
    grid = g;
    g.__kvBound = true;
    if (!document.getElementById('kvr-panel')) buildPanel();
    g.bind('dataBound', function () { setTimeout(apply, 0); });
    apply();
    renderCwStores();
  }

  setInterval(attach, 1500);
  attach();
})();
