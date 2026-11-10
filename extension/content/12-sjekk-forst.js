  // ---- Sjekk først: prioritert liste med forklaring og handlinger -----------------------
  function makeCtx() {
    return { dupIds: ui.dup ? ui.dup.ids : {}, scan: scanMap, groupsOf: groupsOf, anom: anomMap, notes: notes, specialWords: ctlCfg.specialWords };
  }

  function setStatus(rec, status) {
    var it = rec.item, id = it.transactionId, cur = notes[id] || { note: '' };
    if (!status && !cur.note) delete notes[id];
    else notes[id] = { status: status, note: cur.note || '', t: Date.now(), tid: it.endDateTime, kasse: it.workstationNumber, kasserer: it.cashierNumber, bong: it.bongnr, sum: it.totalAmount, flag: cur.flag && status === 'oppfolging' ? 1 : 0 };
    syncManual(id);
    saveNotes();
    apply();
    renderNotes();
  }

  // «Flagg som avvik»: valgte bonger får status «Til oppfølging» og avviket «Flagget av deg» (høy risiko), så de står i
  // Sjekk først og rapporten, og maskinlæringen bruker dem som sikre funn. Er alle valgte flagget fra før, fjernes flagget.
  function manualFlagged(id) { var n = notes[id]; return !!(n && n.flag && n.status === 'oppfolging'); }
  function syncManual(id) {
    if (manualFlagged(id)) { addFlag(id, L.MANUAL_FLAG); return; }
    var a = anomMap[id];
    if (!a) return;
    a = a.filter(function (r) { return r !== L.MANUAL_FLAG; });
    if (a.length) anomMap[id] = a; else delete anomMap[id];
  }
  function flagSelected() {
    var ids = Object.keys(selected);
    if (!ids.length) return;
    var off = ids.every(manualFlagged);
    ids.forEach(function (id) {
      var it = selected[id], cur = notes[id] || { note: '' };
      if (off) {
        if (cur.note) notes[id] = Object.assign({}, cur, { status: '', flag: 0, t: Date.now() }); else delete notes[id];
      } else notes[id] = { status: 'oppfolging', flag: 1, note: cur.note || '', t: Date.now(), tid: it.endDateTime, kasse: it.workstationNumber, kasserer: it.cashierNumber, bong: it.bongnr, sum: it.totalAmount };
      syncManual(id);
    });
    saveNotes();
    apply();
    renderNotes();
    if (checkState.at) renderCheck();
    say(off ? 'Flagget er fjernet fra ' + plur(ids.length, 'bong', 'bonger') + '.' :
      plur(ids.length, 'bong', 'bonger') + ' flagget som avvik («Flagget av deg», Til oppfølging). De står i Sjekk først, og maskinlæringen lærer av dem ved neste analyse.');
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
    checkState.review = null;
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
      n && n.status ? el('span', { class: 'kvr-st', text: n.status === 'sjekket' ? 'Sjekket' : 'Til oppfølging' }) : null,
      (function () { var LN = mlLearnNow(), p = LN.trained ? LN.p[id] : undefined; return typeof p === 'number' ? el('span', { class: 'kvr-ml' + (p >= 0.5 ? ' kvr-ml-hi' : ''), text: 'Lært ' + Math.round(p * 100) + ' %', title: 'Sannsynlighet for «Til oppfølging», lært av vurderingene dine' + (LN.why[id] && LN.why[id].length ? ': ligner på grunn av ' + LN.why[id].join(' og ') : '') }) : null; })()
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
    var all = L.rankReceipts(items, anomMap, weights), LN = mlLearnNow();
    // sortert etter vurderingene dine (lært): sannsynlighet først, så poeng
    if (LN.trained && checkState.learnSort) all = all.slice().sort(function (a, b) { return (LN.p[b.id] || 0) - (LN.p[a.id] || 0) || b.score - a.score; });
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
    if (all.length && LN.trained) {
      var ls = check('Sorter etter vurderingene dine (maskinlæring' + (LN.auc !== null ? ', AUC ' + String(Math.round(LN.auc * 100) / 100).replace('.', ',') : '') + ')', function () { checkState.learnSort = ls.box.checked; renderCheck(); });
      ls.box.checked = !!checkState.learnSort;
      top.push(ls.node);
    } else if (all.length && LN.on && (LN.pos || LN.neg)) top.push(hintEl('Maskinlæring: merk minst ' + LN.minL + ' bonger «Til oppfølging» og ' + LN.minL + ' «Sjekket» (nå ' + LN.pos + ' og ' + LN.neg + '), så kan listen sorteres etter vurderingene dine.'));
    if (checkState.at && ctlRes && !checkState.review) top.push(btn('Vurder disse neste', startReview));
    ui.checkTop.appendChild(section('chk-top', 'Analyse', top));
    if (checkState.review) { renderReview(items); return; }
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

  // «Vurder disse neste»: ti bonger modellen lærer mest av (den er mest usikker på dem), høyst tre per kasserer.
  // Uten modell: bongene med høyest poeng, til det finnes nok vurderinger.
  function startReview() {
    var src = checkSource(), LN = mlLearnNow(), SF = ctlRes && ctlRes.self, raw = (ctlRes && ctlRes.ml && ctlRes.ml.raw) || {};
    var pm = LN.trained ? LN.p : SF && SF.trained ? SF.p : null;
    var rows = src.items.filter(function (it) { var id = it.transactionId; return (anomMap[id] || raw[id]) && !(notes[id] && notes[id].status); })
      .map(function (it) { var id = it.transactionId; return { id: id, cashier: it.cashierNumber, p: pm ? pm[id] : undefined, score: L.riskScore(anomMap[id] || [], weights) }; });
    var pick = L.reviewNext(rows, 10, 3);
    checkState.review = { ids: pick.ids, model: pick.mode === 'poeng' ? '' : LN.trained ? 'lært' : 'selv' };
    renderCheck();
    if (!pick.ids.length) say('Ingen bonger å vurdere: alle er vurdert, eller ingen er skannet.');
  }

  function renderReview(items) {
    var R0 = checkState.review, byId = {};
    items.forEach(function (it) { byId[it.transactionId] = it; });
    var ids = R0.ids.filter(function (id) { return byId[id]; });
    var done = ids.filter(function (id) { return notes[id] && notes[id].status; }).length;
    var next = ids.filter(function (id) { return !(notes[id] && notes[id].status); })[0];
    var why = R0.model === 'lært' ? 'Valgt fordi modellen som lærer av vurderingene dine, er mest usikker på dem.' :
      R0.model === 'selv' ? 'Valgt fordi modellen som er trent på sikre funn, er mest usikker på dem.' :
      'Valgt blant bongene med høyest poeng, til modellen har nok å lære av.';
    var kids = [hintEl(why + ' Åpne hver bong og trykk «Sjekket» (i orden) eller «Til oppfølging». Modellen lærer av hver vurdering.')];
    ids.forEach(function (id) {
      var r = anomMap[id] || [];
      kids.push(checkRow({ id: id, item: byId[id], reasons: r, score: L.riskScore(r, weights) }, id === next));
    });
    if (!ids.length) kids.push(hintEl('Ingen bonger å vurdere.'));
    kids.push(el('div', { class: 'kvr-row' }, [btn('Neste 10', startReview, done === ids.length ? 'kvr-primary' : ''), btn('Tilbake til listen', function () { checkState.review = null; renderCheck(); })]));
    ui.checkBody.appendChild(section('chk-review', 'Vurder disse (' + done + ' av ' + ids.length + ' vurdert)', kids));
  }

