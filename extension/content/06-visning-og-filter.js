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

  // alfabetisk for visning; «Uten gruppe» sist. Rekkefølgen i regelsettet (prioritet) er uendret.
  function groupNames() {
    return rules.map(function (r) { return r.name; }).sort(function (a, b) { return a.localeCompare(b, 'nb', { numeric: true, sensitivity: 'base' }); }).concat([L.NO_GROUP]);
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
    var bf = Object.assign({}, filters, { pant: '', disc: '', discFrom: '', discTo: '', special: '', cardRet: '', item: '', groups: [] });
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
    var hide = filters.pant || filters.item || filters.text || filters.pay || filters.special || filters.cardRet || filters.groups.length ? none : 0;
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
    // tellere som står på 0 sier ingenting: Valgt og Sum valgt vises når noe er valgt, Duplikater når det finnes
    ui.tSel.forEach(function (n) { n.style.display = sm.count ? '' : 'none'; });
    ui.tDup.style.display = ui.dup && ui.dup.groups.length ? '' : 'none';
    if (ui.footClear) ui.footClear.style.display = sm.count ? '' : 'none';
    ui.footPng.style.display = sm.count ? '' : 'none';
    if (ui.footFlag) {
      ui.footFlag.style.display = sm.count ? '' : 'none';
      ui.footFlag.textContent = (sm.count && Object.keys(selected).every(manualFlagged) ? 'Fjern flagg' : 'Flagg som avvik') + (sm.count ? ' (' + sm.count + ')' : '');
    }
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
    if (f.cardRet) add('Retur til kort' + (f.cardRet === '*' ? '' : ': ' + (f.cardRet === '?' ? 'ukjent leverandør' : L.schemeLabel(f.cardRet))), function () { f.cardRet = ''; });
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

