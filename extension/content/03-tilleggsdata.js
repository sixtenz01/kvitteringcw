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
    if (!r) { ui.cwxInfo.appendChild(metaEl('Ikke hentet ennå.')); return; }
    var when = new Date(r.at).toLocaleString('nb-NO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    ui.cwxInfo.appendChild(hintEl('Sist hentet ' + when + ' for ' + r.n + ' bonger (' + (r.from === r.to ? r.from : r.from + ' – ' + r.to) + '), ' + r.searches + ' søk.' +
      (r.cut ? ' Søket ditt hadde 1000 bonger, så CW har trolig kuttet det; velg kortere periode for at tallene skal være hele.' : '')));
    if (r.log.length) ui.cwxInfo.appendChild(hintEl(r.log.map(function (x) { return x.tag + ': ' + x.n + (r.cutTags.indexOf(x.tag) !== -1 ? ' (kuttet)' : ''); }).join(' · ')));
    r.errors.forEach(function (e) { ui.cwxInfo.appendChild(el('div', { class: 'kvr-hint kvr-cwx-err', text: e })); });
  }

  function stopCwExtra() { if (cwRun) { cwRun.stop = true; cwxSay('Stopper etter søket som pågår, og setter filtrene tilbake…'); } }

