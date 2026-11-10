  // ---- kontroller, oppfølging, oppgaver --------------------------------------------
  var BUILTIN_TASKS = [{ id: 'morgen', name: 'Morgenkontroll (i går)', cwRel: 'yesterday', filters: null, scan: true, checks: true, tab: 'check', summary: true, builtin: true }];
  var REL_LABEL = { none: 'Behold datoer', yesterday: 'I går', today: 'I dag', last7: 'Siste 7 dager', lastweek: 'Forrige uke' };

  function opt(v, t) { return el('option', { value: v, text: t }); }
  // Valgene i en nedtrekksliste i alfabetisk rekkefølge. «Alle» ('' og '*') står først.
  function sortSelect(sel) {
    var all = Array.prototype.slice.call(sel.options), fixed = all.filter(function (o) { return o.value === '' || o.value === '*'; });
    var rest = all.filter(function (o) { return fixed.indexOf(o) === -1; }).sort(function (a, b) { return a.text.localeCompare(b.text, 'nb', { numeric: true, sensitivity: 'base' }); });
    var cur = sel.value;
    fixed.concat(rest).forEach(function (o) { sel.appendChild(o); });
    sel.value = cur;
    return sel;
  }

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
  // Dekning og status (hvor mange som er skannet, at en test er av o.l.): vises bare med «Vis alt».
  function metaEl(t) { return el('div', { class: 'kvr-hint kvr-meta', text: t }); }

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
      ml: L.mlAnomaly(items, pop, scanMap, ctlCfg),
      net: L.netChecks(items, pop, scanMap, ctlCfg),
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
      res.cw.findings.filter(keep), res.shift.findings.filter(keep), res.copy.findings.filter(keep), res.shrink.findings.filter(keep), res.ml.findings, res.net.findings);
    res.cashierExtra = {};
    res.findings.forEach(function (f) {
      if (f.flag) f.ids.forEach(function (id) { if (scopeIds[id]) addFlag(id, f.title); });
      else if (f.cashier) {
        var e = res.cashierExtra[f.cashier] || (res.cashierExtra[f.cashier] = { points: 0, notes: [] });
        e.points += L.reasonWeight(f.title, weights);
        e.notes.push(f.title.toLowerCase());
      }
    });
    // selvtrening: lærer av reglenes sikre funn (og vurderingene dine) og flagger bonger som ligner
    res.self = L.mlSelf(items, anomMap, notes, res.ml, weights, ctlCfg);
    res.self.findings.forEach(function (f) { f.ids.forEach(function (id) { if (scopeIds[id]) addFlag(id, f.title); }); });
    res.findings = res.findings.concat(res.self.findings);
    res.snap = analysisSnapshot(res, mode, allItems, allPop);
    ctlRes = res;
    apply();
    renderControl();
    settingsStale = false; renderStale();
    say('Kontroller ferdig: ' + res.findings.length + ' funn, ' + Object.keys(anomMap).length + ' flaggede kvitteringer.');
  }

