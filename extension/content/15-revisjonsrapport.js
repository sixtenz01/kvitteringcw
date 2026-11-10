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
    var ranked = L.reportView(R.items, R.anom, ctlRes.findings, weights).ranked;
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
      var RV = L.reportView(R.items, R.anom, C.findings, weights), ranked = RV.ranked;
      var pick = ranked.slice(0, opts.evidence), files = [], missing = [], t0 = Date.now();
      for (var i = 0; i < pick.length && !cancelScan; i++) {
        progress(i, pick.length, t0, 'Bevis-PNG', missing.length);
        var rec = recById(pick[i].id);
        try {
          if (!rec) throw new Error('ikke i listen');
          var blob = await renderPngFor(rec, { layout: 'bong', header: true, member: false });
          var bytes = new Uint8Array(await blob.arrayBuffer());
          files.push({ id: pick[i].id, path: 'bevis/' + String(i + 1).padStart(2, '0') + '_' + String(rec.item.bongnr).replace(/[^A-Za-z0-9_-]/g, '-') + '.png', hash: KvReport.sha256Bytes(bytes), blob: blob, src: 'data:image/png;base64,' + base64(bytes) });
        } catch (e) { missing.push(pick[i].id); }
        }
      if (cancelScan) { say('Rapporten er avbrutt.'); return; }
      progress(pick.length ? pick.length - 1 : 0, Math.max(pick.length, 1), t0, 'Pakker rapport', 0);
      var byId = {}, explain = {}, noteSub = {};
      files.forEach(function (f) { byId[f.id] = { path: f.path }; });
      ranked.forEach(function (rk) {
        explain[rk.id] = rk.reasons.map(function (r) { return L.explainReason(r, { id: rk.id, cfg: R.anomCfg, ctl: R.ctl, findings: RV.findings, rules: customRules }); });
        var n = notes[rk.id];
        if (opts.notes && n && (n.status || n.note)) noteSub[rk.id] = { status: n.status || '', note: n.note || '' };
      });
      var model = {
        version: KvReport.VERSION, generatedAt: new Date().toISOString(), generatedLocal: new Date().toLocaleString('nb-NO'), analysedAt: new Date(R.at).toISOString(), analysedLocal: new Date(R.at).toLocaleString('nb-NO'),
        reference: opts.reference, author: opts.author, timeShift: R.timeShift || 0, notelog: (function () { if (!nlog) loadNoteLog(); return { base: nlog.base || '', list: nlog.list.slice() }; })(),
        scope: { text: R.scopeText, mode: R.mode, filters: R.filters, coverageText: R.coverageText, compare: R.compare },
        items: R.items, pop: R.pop, scan: R.scan, storeLabels: R.storeLabels,
        settings: { ctl: R.ctl, anom: R.anomCfg, weights: weights, currentDiffers: KvReport.stable([R.ctl, R.anomCfg]) !== KvReport.stable([ctlCfg, anomCfg]) },
        checks: { falseRet: { coverage: C.falseRet.coverage, lineCheck: C.falseRet.lineCheck }, voids: C.voids ? { applicable: C.voids.applicable, coverage: C.voids.coverage } : null, campaign: C.disc && C.disc.camp ? { pending: C.disc.camp.pending, items: C.disc.camp.items.filter(function (e) { return e.status; }).map(function (e) { return { c: e.c, name: e.name, rateText: e.rateText, n: e.n, status: e.status }; }) } : null, numbers: C.numbers, ledger: C.ledger ? { lines: C.ledger.lines, pay: C.ledger.pay, vat: C.ledger.vat, refs: C.ledger.refs } : null },
        findings: RV.findings, ranked: ranked, explain: explain, notes: noteSub,
        cashiers: L.rankCashiers(RV.items, RV.anom, weights, C.profile, RV.extra).slice(0, 10),
        compare: compareForReport(R), failedScans: failedRecs.length, cwxRun: R.cwxRun || null, archInfo: R.archInfo || null,
        evidence: { files: files.map(function (f) { return { id: f.id, path: f.path, hash: f.hash, src: f.src }; }), byId: byId, missing: missing, requested: pick.length, cappedFrom: ranked.length },
        settingsJson: JSON.stringify({ app: 'kvitteringshenter', v: 1, ctl: R.ctl, anom: R.anomCfg, weights: weights, customRules: customRules, groups: rules, stores: manualStores, camp: campDec, keynav: keyNav }, null, 2) + '\n'
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
      if (prevTr) grid.select(prevTr); else if (typeof grid.clearSelection === 'function') grid.clearSelection();
      setProgress(0);
      scanning = false;
      ui.scanBtn.disabled = false; ui.anomBtn.disabled = false; ui.stopBtn.disabled = true;
      syncRetry();
    }
  }

