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

