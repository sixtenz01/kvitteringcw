(function () {
  'use strict';
  if (window.__kvRewamp) return;
  window.__kvRewamp = true;

  var L = window.KvLogic;
  var SAVED_KEY = 'kvr.saved.v1';
  var COLLAPSE_KEY = 'kvr.collapsed.v1';
  var PANT_KEY = 'kvr.pant.v1';
  var SCAN_TIMEOUT = 6000;

  var filters = L.defaultFilters();
  var selected = {};
  var pantMap = store(PANT_KEY) || {};
  var scanning = false;
  var cancelScan = false;
  var recs = [];
  var grid = null;
  var ui = {};

  function store(key, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { return null; }
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

  function getGrid() {
    var node = document.querySelector('[data-role=grid]');
    var jq = window.jQuery || window.$;
    if (!node || !jq) return null;
    return jq(node).data('kendoGrid') || null;
  }

  function plain(item) {
    return item && item.toJSON ? item.toJSON() : item;
  }

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
      var orig = 0;
      for (var i = 0; i < view.length; i++) { if (view[i] === di || (view[i].uid && view[i].uid === di.uid)) { orig = i; break; } }
      out.push({ tr: tr, item: item, orig: orig });
    });
    return out;
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

  function ensureCheckbox(r) {
    var td = r.tr.children[0];
    if (!td) return;
    var cb = td.querySelector('input.kv-cb');
    var id = r.item.transactionId;
    if (!cb) {
      cb = el('input', { type: 'checkbox', class: 'kv-cb', title: 'Velg kvittering' });
      cb.addEventListener('click', function (e) { e.stopPropagation(); });
      cb.addEventListener('change', function () {
        if (cb.checked) selected[id] = r.item; else delete selected[id];
        summary();
      });
      td.insertBefore(cb, td.firstChild);
    }
    cb.checked = !!selected[id];
  }

  function apply() {
    if (!grid) return;
    recs = collect();
    var items = recs.map(function (r) { return r.item; });
    var dup = L.findDuplicates(items);
    var ctx = { dupIds: dup.ids, pant: pantMap };
    var visible = 0;
    recs.forEach(function (r) {
      var show = L.matches(r.item, filters, ctx);
      r.show = show;
      r.tr.style.display = show ? '' : 'none';
      r.tr.classList.toggle('kv-dup', !!dup.ids[r.item.transactionId]);
      if (dup.ids[r.item.transactionId]) r.tr.title = 'Mulig duplikat: samme beløp, butikk, kasse og tid';
      ensureCheckbox(r);
      if (show) visible++;
    });
    reorder();
    ui.dup = dup;
    ui.visible = visible;
    summary();
    refreshOptions();
  }

  function reorder() {
    var tbody = grid.tbody[0];
    var sorted = recs.slice().sort(function (a, b) {
      return L.compare(a.item, b.item, filters.sort) || a.orig - b.orig;
    });
    sorted.forEach(function (r) { tbody.appendChild(r.tr); });
  }

  function summary() {
    if (!ui.summary) return;
    var chosen = Object.keys(selected).map(function (k) { return selected[k]; });
    var s = L.sumSelected(chosen);
    var dupGroups = ui.dup ? ui.dup.groups.length : 0;
    var p = L.sumPant(chosen, pantMap);
    ui.summary.textContent = 'Viser ' + (ui.visible || 0) + ' av ' + recs.length +
      ' · Valgt: ' + s.count + ' · Sum valgt: ' + fmt(s.sum) + ' kr · Duplikatgrupper: ' + dupGroups +
      ' · Pant valgte: salg ' + fmt(p.sale) + ', retur ' + fmt(p.ret) + ', netto ' + fmt(p.net) +
      ' kr (' + p.scanned + ' av ' + p.total + ' skannet)';
    ui.active.textContent = L.activeCount(filters) ? L.activeCount(filters) + ' filter aktive' : 'Ingen filter';
  }

  var optsKey = '';
  function refreshOptions() {
    var key = [distinct('storeNumber'), distinct('workstationNumber'), distinct('cashierNumber'), distinct('receiptType')].join('|');
    if (key === optsKey) return;
    optsKey = key;
    fillSelect(ui.stores, distinct('storeNumber'), null, filters.stores);
    fillSelect(ui.workstations, distinct('workstationNumber'), null, filters.workstations);
    fillSelect(ui.cashiers, distinct('cashierNumber'), null, filters.cashiers);
    fillSelect(ui.types, distinct('receiptType'), function (v) { return v + ' – ' + L.typeLabel(v); }, filters.types);
  }

  function readForm() {
    filters.stores = readSelect(ui.stores);
    filters.workstations = readSelect(ui.workstations);
    filters.cashiers = readSelect(ui.cashiers);
    filters.types = readSelect(ui.types);
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
    filters.pant = ui.pant.value;
    filters.sort = ui.sort.value;
  }

  function writeForm() {
    optsKey = '';
    ['dateFrom', 'dateTo', 'timeFrom', 'timeTo', 'sumMin', 'sumMax', 'member'].forEach(function (k) { ui[k].value = filters[k]; });
    ui.onlyNegative.checked = filters.onlyNegative;
    ui.onlyMember.checked = filters.onlyMember;
    ui.onlyDup.checked = filters.onlyDup;
    ui.pant.value = filters.pant;
    ui.sort.value = filters.sort;
  }

  function onChange() { readForm(); apply(); }

  function field(label, node) {
    return el('label', { class: 'kv-f' }, [el('span', { text: label }), node]);
  }

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

  function check(label) {
    var c = input('checkbox');
    return { box: c, node: el('label', { class: 'kv-c' }, [c, el('span', { text: label })]) };
  }


  function wait(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

  function iframeDoc() {
    var f = document.querySelector('iframe');
    var d = null;
    try { d = f && f.contentDocument; } catch (e) { d = null; }
    return d && d.body ? d : null;
  }

  function readReceiptRows() {
    var d = iframeDoc();
    if (!d) return null;
    return Array.prototype.map.call(d.querySelectorAll('tr'), function (tr) {
      return Array.prototype.map.call(tr.children, function (c) { return c.textContent.replace(/\s+/g, ' ').trim(); });
    });
  }

  async function loadReceipt(r) {
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
        return readReceiptRows();
      }
      await wait(100);
      waited += 100;
    }
    return null;
  }

  async function scanPant() {
    if (scanning || !grid) return;
    var todo = recs.filter(function (r) {
      return r.show && r.item.receiptType === 1 && !pantMap[r.item.transactionId];
    });
    if (!todo.length) { ui.scanStatus.textContent = 'Ingenting å skanne (alt er skannet eller ingen synlige salg).'; return; }
    scanning = true; cancelScan = false;
    ui.scanBtn.disabled = true; ui.stopBtn.disabled = false;
    var prev = grid.select();
    var prevTr = prev && prev[0];
    var done = 0, failed = 0;
    for (var i = 0; i < todo.length && !cancelScan; i++) {
      ui.scanStatus.textContent = 'Skanner ' + (i + 1) + ' av ' + todo.length + (failed ? ' · feilet: ' + failed : '');
      var rows = await loadReceipt(todo[i]);
      if (rows) {
        pantMap[todo[i].item.transactionId] = L.parseReceipt(rows);
        done++;
      } else failed++;
    }
    store(PANT_KEY, pantMap);
    if (prevTr) grid.select(prevTr); else if (typeof grid.clearSelection === 'function') grid.clearSelection();
    scanning = false;
    ui.scanBtn.disabled = false; ui.stopBtn.disabled = true;
    ui.scanStatus.textContent = (cancelScan ? 'Stoppet. ' : 'Ferdig. ') + 'Skannet ' + done + (failed ? ', feilet ' + failed : '') + '.';
    apply();
  }

  function renderSaved() {
    var list = store(SAVED_KEY) || {};
    ui.saved.innerHTML = '';
    ui.saved.appendChild(el('option', { value: '', text: '— lagrede filtre —' }));
    Object.keys(list).sort().forEach(function (k) { ui.saved.appendChild(el('option', { value: k, text: k })); });
  }

  function buildPanel() {
    var panel = el('div', { id: 'kv-panel' });
    var head = el('div', { class: 'kv-head' });
    ui.active = el('span', { class: 'kv-badge', text: 'Ingen filter' });
    var toggle = el('button', { type: 'button', class: 'kv-btn', text: '–' });
    head.appendChild(el('strong', { text: 'Kvitteringshenter' }));
    head.appendChild(ui.active);
    head.appendChild(toggle);
    var body = el('div', { class: 'kv-body' });

    ui.summary = el('div', { class: 'kv-summary', text: '' });
    body.appendChild(ui.summary);

    var quick = el('div', { class: 'kv-quick' });
    [['today', 'I dag'], ['yesterday', 'I går'], ['last24h', 'Siste 24 t'], ['night', 'Natt 00–06'], ['day', 'Dag 06–18'], ['evening', 'Kveld 18–24']].forEach(function (q) {
      quick.appendChild(el('button', {
        type: 'button', class: 'kv-btn', text: q[1],
        onclick: function () {
          var r = L.quickRange(q[0]);
          if (q[0] === 'night' || q[0] === 'day' || q[0] === 'evening') { filters.timeFrom = r.timeFrom; filters.timeTo = r.timeTo; }
          else { filters.dateFrom = r.dateFrom; filters.dateTo = r.dateTo; filters.timeFrom = ''; filters.timeTo = ''; }
          writeForm(); apply();
        }
      }));
    });
    body.appendChild(quick);

    ui.dateFrom = input('date'); ui.dateTo = input('date');
    ui.timeFrom = input('time'); ui.timeTo = input('time');
    body.appendChild(el('div', { class: 'kv-row' }, [field('Dato fra', ui.dateFrom), field('Dato til', ui.dateTo)]));
    body.appendChild(el('div', { class: 'kv-row' }, [field('Tid fra', ui.timeFrom), field('Tid til', ui.timeTo)]));

    ui.stores = multi(3); ui.workstations = multi(4); ui.cashiers = multi(4); ui.types = multi(3);
    body.appendChild(el('div', { class: 'kv-row' }, [field('Butikk', ui.stores), field('Kasse', ui.workstations)]));
    body.appendChild(el('div', { class: 'kv-row' }, [field('Kasserer', ui.cashiers), field('Type', ui.types)]));

    ui.sumMin = input('number', { step: '0.01', placeholder: 'min' });
    ui.sumMax = input('number', { step: '0.01', placeholder: 'maks' });
    body.appendChild(el('div', { class: 'kv-row' }, [field('Sum fra', ui.sumMin), field('Sum til', ui.sumMax)]));

    var neg = check('Negativ sum (retur/panteretur)'); ui.onlyNegative = neg.box;
    ui.member = input('text', { placeholder: 'medlemsnr' });
    var mem = check('Kun med medlem'); ui.onlyMember = mem.box;
    var dp = check('Kun mulige duplikater'); ui.onlyDup = dp.box;
    body.appendChild(neg.node);
    body.appendChild(field('Medlemssøk', ui.member));
    body.appendChild(mem.node);
    body.appendChild(dp.node);


    ui.pant = el('select', {}, [
      el('option', { value: '', text: 'Alle' }),
      el('option', { value: 'any', text: 'Har pant eller panteretur' }),
      el('option', { value: 'sale', text: 'Har pant (salg)' }),
      el('option', { value: 'return', text: 'Har panteretur' })
    ]);
    ui.pant.addEventListener('change', onChange);
    body.appendChild(field('Pant (krever skanning)', ui.pant));
    ui.scanBtn = el('button', { type: 'button', class: 'kv-btn', text: 'Skann pant (synlige)', onclick: scanPant });
    ui.stopBtn = el('button', { type: 'button', class: 'kv-btn', text: 'Stopp', disabled: 'disabled', onclick: function () { cancelScan = true; } });
    body.appendChild(el('div', { class: 'kv-row' }, [ui.scanBtn, ui.stopBtn,
      el('button', { type: 'button', class: 'kv-btn', text: 'Tøm pant-cache', onclick: function () {
        pantMap = {}; store(PANT_KEY, pantMap); ui.scanStatus.textContent = 'Cache tømt.'; apply();
      } })]));
    ui.scanStatus = el('div', { class: 'kv-summary', text: '' });
    body.appendChild(ui.scanStatus);

    ui.sort = el('select', {}, [
      el('option', { value: 'none', text: 'Standard' }),
      el('option', { value: 'sumDesc', text: 'Sum høyest først' }),
      el('option', { value: 'sumAsc', text: 'Sum lavest først' }),
      el('option', { value: 'timeDesc', text: 'Nyeste først' }),
      el('option', { value: 'timeAsc', text: 'Eldste først' })
    ]);
    ui.sort.addEventListener('change', onChange);
    body.appendChild(field('Sortering', ui.sort));

    body.appendChild(el('div', { class: 'kv-row' }, [
      el('button', { type: 'button', class: 'kv-btn', text: 'Velg synlige', onclick: function () {
        recs.forEach(function (r) { if (r.show) selected[r.item.transactionId] = r.item; });
        apply();
      } }),
      el('button', { type: 'button', class: 'kv-btn', text: 'Fjern valg', onclick: function () { selected = {}; apply(); } }),
      el('button', { type: 'button', class: 'kv-btn', text: 'Nullstill', onclick: function () { filters = L.defaultFilters(); writeForm(); apply(); } })
    ]));

    ui.name = el('input', { type: 'text', placeholder: 'navn på filter' });
    ui.saved = el('select', {});
    body.appendChild(el('div', { class: 'kv-row' }, [
      ui.name,
      el('button', { type: 'button', class: 'kv-btn', text: 'Lagre', onclick: function () {
        var n = ui.name.value.trim();
        if (!n) return;
        var list = store(SAVED_KEY) || {};
        readForm();
        list[n] = filters;
        store(SAVED_KEY, list);
        renderSaved();
        ui.saved.value = n;
      } })
    ]));
    body.appendChild(el('div', { class: 'kv-row' }, [
      ui.saved,
      el('button', { type: 'button', class: 'kv-btn', text: 'Last', onclick: function () {
        var list = store(SAVED_KEY) || {};
        if (!list[ui.saved.value]) return;
        filters = L.sanitizeFilters(list[ui.saved.value]);
        writeForm(); apply();
        optsKey = ''; refreshOptions();
      } }),
      el('button', { type: 'button', class: 'kv-btn', text: 'Slett', onclick: function () {
        var list = store(SAVED_KEY) || {};
        delete list[ui.saved.value];
        store(SAVED_KEY, list);
        renderSaved();
      } })
    ]));

    toggle.addEventListener('click', function () {
      var c = panel.classList.toggle('kv-collapsed');
      toggle.textContent = c ? '+' : '–';
      store(COLLAPSE_KEY, c);
    });
    if (store(COLLAPSE_KEY)) { panel.classList.add('kv-collapsed'); toggle.textContent = '+'; }

    panel.appendChild(head);
    panel.appendChild(body);
    document.body.appendChild(panel);
    renderSaved();
  }

  function attach() {
    var g = getGrid();
    if (!g || g.__kvBound) return;
    grid = g;
    g.__kvBound = true;
    if (!document.getElementById('kv-panel')) buildPanel();
    g.bind('dataBound', function () { setTimeout(apply, 0); });
    apply();
  }

  setInterval(attach, 1500);
  attach();
})();
