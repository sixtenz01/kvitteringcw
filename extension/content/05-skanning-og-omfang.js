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
    list.forEach(function (r) { if (manualFlagged(r.item.transactionId)) syncManual(r.item.transactionId); });
    settingsStale = false; renderStale();
    say('Avviksjekk ferdig: ' + n + ' kvitteringer flagget.');
    apply();
  }

