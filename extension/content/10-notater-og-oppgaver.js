  // ---- modal ------------------------------------------------------------------
  function closeModal() { var m = document.querySelector('.kvr-modal'); if (m) m.remove(); }

  function openModal(title, bodyNode, actions) {
    closeModal();
    var m = el('div', { class: 'kvr-modal' }, [el('div', { class: 'kvr-dlg', role: 'dialog' }, [
      el('div', { class: 'kvr-dlg-h' }, [el('b', { text: title }), btn('✕', closeModal, 'kvr-sm')]),
      el('div', { class: 'kvr-dlg-b' }, [bodyNode]),
      el('div', { class: 'kvr-dlg-f' }, actions || [])
    ])]);
    m.addEventListener('click', function (e) { if (e.target === m) closeModal(); });
    document.body.appendChild(m);
    return m;
  }

  function copyText(t) {
    var fallback = function () {
      var ta = el('textarea', { style: 'position:fixed;left:-999px' });
      ta.value = t; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) { /* ignorer */ }
      ta.remove();
    };
    try { navigator.clipboard.writeText(t).then(function () { say('Kopiert.'); }, fallback); } catch (e) { fallback(); }
  }

  // Ukjente linjer og hendelsesord fra skanningene. Brukes til å lære hva CW faktisk viser (annullert, parkert, manuell pris, spør pris).
  function timeText(TC) {
    if (!TC.n) return 'Ingen skannede bonger har dato og tid i topptekst (skann på nytt, eller formatet er ukjent).';
    return TC.n + ' bonger sammenlignet: ' + TC.same + ' har samme klokkeslett i listen og på bongen (±5 min). Typisk avvik (bong minus liste): ' + TC.median + ' min. Forskyvning i bruk: ' + timeShift + ' min.' +
      (TC.sample && Math.abs(TC.sample.diff) > 5 ? ' Størst avvik: bong ' + TC.sample.id + ', liste «' + TC.sample.list + '», bong «' + TC.sample.bong + '», rådata «' + TC.sample.raw + '».' : '');
  }

  function setTimeShift(min) {
    timeShift = Number(min) || 0;
    store(K.tshift, timeShift);
    if (ui.tshift) ui.tshift.value = String(timeShift);
    apply();
    markStale();
  }

  // Betalingsmåter i CW-filteret (hvis kontrollen finnes på siden). Leser bare det som allerede er lastet.
  function readCwPayMethods() {
    var out = [], $ = jq();
    try {
      var node = document.querySelector('#paymentMethods, [id*="paymentMethods"], [ng-model*="paymentMethods"], [name*="paymentMethods"]');
      if (!node) return out;
      var add = function (t) { t = String(t === undefined || t === null ? '' : t).replace(/\s+/g, ' ').trim(); if (t && out.indexOf(t) === -1 && out.length < 60) out.push(t); };
      if ($) ['kendoMultiSelect', 'kendoDropDownList', 'kendoComboBox'].forEach(function (w) {
        var ins = $(node).data(w);
        if (!ins || !ins.dataSource) return;
        var tf = (ins.options && ins.options.dataTextField) || 'text', d = ins.dataSource.data();
        for (var i = 0; i < d.length && i < 100; i++) add(d[i] && d[i].get ? d[i].get(tf) : d[i] && d[i][tf]);
      });
      if (node.options) Array.prototype.forEach.call(node.options, function (o) { add(o.text); });
    } catch (e) { /* kontrollen kan ha en annen form */ }
    return out;
  }

  function payInfo() {
    var cw = readCwPayMethods(), P = L.payStats(recs.map(function (r) { return r.item; }), scanMap, cw);
    return { P: P, head: ['Betalingsmåte', 'Bonger', 'Sum kr', 'Kasserere', 'I CW-listen'], rows: P.rows.map(function (r) { return [r.label, r.bongs, fmt(r.sum), r.cashiers, r.inCw]; }),
      cwTxt: cw.length ? 'Betalingsmåter i CW-filteret: ' + cw.join(', ') + '.' : 'Fant ikke listen over betalingsmåter i CW-filteret (kontrollen «paymentMethods» er ikke lastet eller har en annen form).' };
  }

  function channelInfo() {
    var CS = L.channelStats(recs.map(function (r) { return r.item; }));
    var rawTxt = CS.raw.n ? 'Rådata for tid: ' + CS.raw.type + ', ' + CS.raw.distinct + ' ulike verdier på ' + CS.raw.n + ' rader, eksempel «' + CS.raw.sample + '».' : 'Ingen rådata for tid i listen.';
    var head = ['Kanal', 'Bonger', 'Typer', 'Butikker', 'Kasserere', 'Kasser', 'Kassenr', 'Snitt kr', 'Medlem %', 'Returer'];
    var rows = CS.rows.map(function (c) { return [c.k, c.n, c.types, c.stores, c.cashiers, c.ws, c.wsList, c.avg, c.member, c.ret]; });
    return { CS: CS, rawTxt: rawTxt, head: head, rows: rows };
  }

  function diagText(D) {
    var CI = channelInfo();
    var out = ['Kvitteringshenter diagnostikk', 'Skannede bonger: ' + D.total + ' (ny skanning: ' + D.v4 + ')', 'Løpenummer i topptekst: ' + seqProof.ok + ' stemte, ' + seqProof.bad + ' avvek',  'Kjøpeutbytte-tabell: ' + D.ku.with + ' med, ' + D.ku.without + ' uten', 'Klokkeslett: ' + timeText(L.timeCheck(recs.map(function (r) { return r.item; }), scanMap)), '', 'Kanal (saleChannel) i listen; kolonner: ' + CI.head.join(' | ')];
    CI.rows.forEach(function (r) { out.push('  ' + r.join(' | ')); });
    var PI = payInfo();
    out.push(CI.rawTxt, '', 'Betalingsmåter; kolonner: ' + PI.head.join(' | '));
    PI.rows.forEach(function (r) { out.push('  ' + r.join(' | ')); });
    out.push(PI.cwTxt, '', 'Topptekst og bunn (versjon 7): ' + D.v7 + ' bonger, topptekst lest på ' + D.hdr + ', terminal ' + D.ft.term + ', autorisasjon ' + D.ft.auth + ', inngangsmåter: ' + (Object.keys(D.ft.modes).map(function (m) { return m + ' ' + D.ft.modes[m]; }).join(', ') || 'ingen'), 'Ukjente linjer utenfor tabellene (tall byttet med #, antall, eksempelbong):');
    if (!D.bu.length) out.push('  ingen');
    D.bu.forEach(function (u) { out.push('  ' + u.t + '\t' + u.n + '\t' + u.id); });
    out.push('', 'Hendelsesord (ord, antall, tekst, eksempelbong):');
    if (!D.ev.length) out.push('  ingen');
    D.ev.forEach(function (e) { out.push('  ' + e.k + '\t' + e.n + '\t' + e.t + '\t' + e.id); });
    out.push('', 'Ukjente linjer (tekst med tall som #, antall, eksempelbong):');
    if (!D.unk.length) out.push('  ingen');
    D.unk.forEach(function (u) { out.push('  ' + u.t + '\t' + u.n + '\t' + u.id); });
    return out.join('\n');
  }

  function openDiag() {
    var D = L.diagnostics(scanMap, L.wordList(ctlCfg.evWords));
    var body = el('div', { class: 'kvr-secbody' });
    var TC = L.timeCheck(recs.map(function (r) { return r.item; }), scanMap);
    body.appendChild(el('b', { class: 'kvr-subh', text: 'Klokkeslett: liste mot bong' }));
    body.appendChild(hintEl(timeText(TC)));
    if (TC.suggest !== null) {
      body.appendChild(hintEl('Listen ligger konsekvent ' + Math.abs(TC.suggest) + ' min ' + (TC.suggest > 0 ? 'bak' : 'foran') + ' bongen. Det tyder på tidssone eller en fast forskyvning i dataene.'));
      body.appendChild(btn('Flytt listetid ' + (TC.suggest > 0 ? '+' : '') + TC.suggest + ' min', function () { setTimeShift(timeShift + TC.suggest); closeModal(); say('Listetid flyttet ' + (TC.suggest > 0 ? '+' : '') + TC.suggest + ' min. Kjør analysen på nytt.'); }, 'kvr-primary'));
    }
    var CI = channelInfo();
    body.appendChild(el('b', { class: 'kvr-subh', text: 'Kanal (saleChannel) og rådata for tid' }));
    body.appendChild(CI.rows.length ? tbl(CI.head, CI.rows) : hintEl('Ingen rader i listen.'));
    body.appendChild(hintEl(CI.rawTxt + ' Betydningen av kanalkodene er ikke bekreftet: tabellen viser bare antall og snitt, uten kasserer- eller medlemsnumre. «Kasser» er antall ulike kasser, «Kassenr» de første nummerne.'));
    var PI = payInfo();
    body.appendChild(el('b', { class: 'kvr-subh', text: 'Betalingsmåter' }));
    body.appendChild(PI.rows.length ? tbl(PI.head, PI.rows) : hintEl('Ingen skannede bonger med betalingslinjer.'));
    body.appendChild(hintEl(PI.cwTxt + ' «I CW-listen» sammenligner etiketten på bongen (teksten før kolon) med navnene i filteret; ulik skrivemåte gir «nei».'));
    body.appendChild(el('b', { class: 'kvr-subh', text: 'Topptekst og bunn (versjon 7)' }));
    body.appendChild(hintEl(D.v7 + ' av ' + D.total + ' skannede bonger har topptekst/bunn lest. Topptekst (butikk, kasse, kasserer, medlem) på ' + D.hdr + '; terminal-ID på ' + D.ft.term + '; autorisasjonskode på ' + D.ft.auth + '. Inngangsmåter: ' + (Object.keys(D.ft.modes).map(function (m) { return m + ' ' + D.ft.modes[m]; }).join(', ') || 'ingen funnet') + '.'));
    body.appendChild(D.bu.length ? tbl(['Linje utenfor tabell', 'Antall', 'Eksempelbong'], D.bu.slice(0, 30).map(function (u) { return [u.t, u.n, u.id]; })) : hintEl('Ingen ukjente linjer utenfor tabellene.'));
    body.appendChild(hintEl('Løpenummer i topptekst mot valgt rad: ' + seqProof.ok + ' stemte, ' + seqProof.bad + ' avvek' + (seqProof.ok >= 3 ? ' (kontrollen er aktiv: bonger med feil nummer avvises)' : ' (kontrollen aktiveres etter 3 treff)') + '.'));
    body.appendChild(hintEl(D.v4 ? D.v4 + ' av ' + D.total + ' skannede bonger har ny skanningsdata (eldre må skannes på nytt). Dette er linjer pluginen ikke kjenner igjen, og ord som tyder på annullert, parkert, manuell pris eller spør pris. Del listen for å få testene utvidet.' : 'Ingen skanninger med ny data ennå. Skann kvitteringer først (Skann → Skann innhold).'));
    if (D.v4) {
      body.appendChild(el('b', { class: 'kvr-subh', text: 'Hendelsesord' }));
      body.appendChild(D.ev.length ? tbl(['Ord', 'Antall', 'Linje', 'Eksempelbong'], D.ev.slice(0, 30).map(function (e) { return [e.k, e.n, e.t, e.id]; })) : hintEl('Ingen funnet.'));
      body.appendChild(el('b', { class: 'kvr-subh', text: 'Ukjente linjer' }));
      body.appendChild(D.unk.length ? tbl(['Linje', 'Antall', 'Eksempelbong'], D.unk.slice(0, 40).map(function (u) { return [u.t, u.n, u.id]; })) : hintEl('Ingen funnet.'));
      body.appendChild(hintEl('Tall er byttet med #. Listen inneholder ingen varenavn eller beløp, men bongnummer. Kjøpeutbytte-tabell: ' + D.ku.with + ' med, ' + D.ku.without + ' uten.'));
    }
    openModal('Diagnostikk', body, [btn('Kopier som tekst', function () { copyText(diagText(D)); }), btn('Lukk', closeModal, 'kvr-primary')]);
  }

  // ---- notater og oppfølging ----------------------------------------------------
  // Notatlogg: hver endring av notat eller status legges til som en hendelse i en kjede (append-only).
  var NLOG_MAX = 20000, nlog = null, notesShadow = {};

  function noteState(n) { return n ? { s: n.status || '', n: String(n.note || '').slice(0, 2000), b: String(n.bong || '') } : null; }

  function loadNoteLog() {
    var v = store(K.nlog);
    nlog = v && Array.isArray(v.list) ? v : { base: '', list: [] };
    notesShadow = {};
    Object.keys(notes).forEach(function (id) { notesShadow[id] = noteState(notes[id]); });
    if (!nlog.list.length) {
      Object.keys(notes).forEach(function (id) { var st = notesShadow[id]; KvReport.logAppend(nlog, { t: Date.now(), id: id, bong: st.b, op: 'start', s: st.s, n: st.n }); });
      if (nlog.list.length) store(K.nlog, nlog);
    }
  }

  function logNoteChanges() {
    if (!nlog) loadNoteLog();
    var ids = {}, changed = false;
    Object.keys(notes).concat(Object.keys(notesShadow)).forEach(function (id) { ids[id] = true; });
    Object.keys(ids).forEach(function (id) {
      var now = noteState(notes[id]), was = notesShadow[id] || null;
      if (!now && !was) return;
      if (now && was && now.s === was.s && now.n === was.n) return;
      var e = { t: Date.now(), id: id, bong: (now || was).b, op: !was ? 'ny' : !now ? 'slettet' : 'endret' };
      if (now) { e.s = now.s; e.n = now.n; }
      if (was) { e.ps = was.s; e.pn = was.n; }
      KvReport.logAppend(nlog, e);
      changed = true;
      if (now) notesShadow[id] = now; else delete notesShadow[id];
    });
    if (changed) { KvReport.logTrim(nlog, NLOG_MAX); store(K.nlog, nlog); }
  }

  function saveNotes() { logNoteChanges(); store(K.notes, notes); }

  function exportNoteLog() {
    if (!nlog) loadNoteLog();
    download(new Blob([KvReport.stable({ base: nlog.base || '', list: nlog.list }) + '\n'], { type: 'application/json' }), 'notatlogg.json');
  }

  function openNoteLog() {
    if (!nlog) loadNoteLog();
    var v = KvReport.logVerify(nlog), body = el('div', { class: 'kvr-secbody' });
    body.appendChild(hintEl(v.n + ' hendelser. ' + (v.ok ? 'Kjeden er ubrutt' + (v.n ? '; hodekontrollsum ' + v.head.slice(0, 16) + '…' : '') + '.' : 'KJEDEN ER BRUTT ved hendelse ' + (v.at + 1) + ': noe er endret eller fjernet i lagringen.') +
      ' Hver endring av et notat eller en status lagres som en ny hendelse, og de gamle blir stående. Loggen avslører utilsiktet endring, men er ikke bevis mot den som har full tilgang til nettleseren. Noter kontrollsummen i saken, eller lag en revisjonsrapport.'));
    if (v.n) body.appendChild(tbl(['Tid', 'Bong', 'Handling', 'Status', 'Notat'], nlog.list.slice(-40).reverse().map(function (e) {
      return [new Date(e.t).toLocaleString('nb-NO'), e.bong || e.id, e.op, e.s !== undefined ? e.s : (e.ps || ''), String(e.n !== undefined ? e.n : (e.pn || '')).slice(0, 80)];
    })));
    openModal('Notatlogg', body, [btn('Eksporter logg (JSON)', exportNoteLog), btn('Lukk', closeModal, 'kvr-primary')]);
  }

  function openNote(rec) {
    if (!rec) return;
    var it = rec.item, id = it.transactionId, cur = notes[id] || { status: '', note: '' };
    var st = el('select', {}, [opt('', 'Ingen status'), opt('oppfolging', 'Til oppfølging'), opt('sjekket', 'Sjekket')]);
    st.value = cur.status || '';
    var ta = el('textarea', { rows: '4', placeholder: 'Notat…' });
    ta.value = cur.note || '';
    var body = el('div', { class: 'kvr-secbody' }, [
      hintEl(it.endDateTime + ' · kasse ' + it.workstationNumber + ' · kasserer ' + it.cashierNumber + ' · bong ' + it.bongnr + ' · ' + (it.totalAmount === null ? '–' : fmt(it.totalAmount)) + ' kr'),
      field('Status', st), field('Notat', ta)
    ]);
    openModal('Notat og status', body, [
      btn('Slett', function () { delete notes[id]; syncManual(id); saveNotes(); closeModal(); apply(); renderNotes(); }),
      btn('Lagre', function () {
        var note = ta.value.trim();
        if (!st.value && !note) delete notes[id];
        else notes[id] = { status: st.value, note: note, t: Date.now(), tid: it.endDateTime, kasse: it.workstationNumber, kasserer: it.cashierNumber, bong: it.bongnr, sum: it.totalAmount, flag: cur.flag && st.value === 'oppfolging' ? 1 : 0 };
        syncManual(id);
        saveNotes(); closeModal(); apply(); renderNotes();
      }, 'kvr-primary')
    ]);
    ta.focus();
  }

  function renderNotes() {
    if (!ui.noteList) return;
    ui.noteList.innerHTML = '';
    var list = Object.keys(notes).map(function (id) { return { id: id, n: notes[id] }; });
    list.sort(function (a, b) { return (a.n.status === 'oppfolging' ? 0 : 1) - (b.n.status === 'oppfolging' ? 0 : 1) || (b.n.t || 0) - (a.n.t || 0); });
    ui.noteCount.textContent = list.length + ' notater · ' + list.filter(function (x) { return x.n.status === 'oppfolging'; }).length + ' til oppfølging';
    if (!list.length) { ui.noteList.appendChild(hintEl('Ingen notater ennå. Velg en bong i listen og trykk N, eller bruk «Notat» under.')); return; }
    list.slice(0, 60).forEach(function (x) {
      var n = x.n;
      var row = el('div', { class: 'kvr-li ' + (n.status === 'sjekket' ? 'kvr-ok' : n.status === 'oppfolging' ? '' : 'kvr-na') }, [
        el('b', { text: (n.tid || '') + ' · kasse ' + (n.kasse === undefined ? '–' : n.kasse) + ' · ' + (typeof n.sum === 'number' ? fmt(n.sum) : '–') + ' kr' }),
        el('span', { text: (n.status === 'oppfolging' ? 'Til oppfølging' : n.status === 'sjekket' ? 'Sjekket' : 'Notat') + (n.note ? ': ' + n.note : '') })
      ]);
      row.addEventListener('click', function () { var r = recById(x.id); if (r) jumpTo(r); else say('Kvitteringen er ikke i gjeldende liste. Bongnr: ' + (n.bong || x.id)); });
      ui.noteList.appendChild(row);
    });
  }

  function exportNotes() {
    var rows = [['Tid', 'Kasse', 'Kasserer', 'Bongnr', 'Sum', 'Status', 'Notat']];
    Object.keys(notes).forEach(function (id) {
      var n = notes[id];
      rows.push([n.tid, n.kasse, n.kasserer, n.bong || id, typeof n.sum === 'number' ? String(n.sum).replace('.', ',') : '', n.status === 'oppfolging' ? 'Til oppfølging' : n.status === 'sjekket' ? 'Sjekket' : '', n.note]);
    });
    download(new Blob([L.toCsv(rows)], { type: 'text/csv;charset=utf-8' }), 'notater.csv');
    say('Eksporterte ' + (rows.length - 1) + ' notater.');
  }

  function currentRec() {
    var sel = grid && grid.select();
    var tr = sel && sel[0];
    for (var i = 0; i < recs.length; i++) if (recs[i].tr === tr) return recs[i];
    return null;
  }

  function stepRow(d) {
    var rows = Array.prototype.slice.call(grid.tbody[0].children).filter(function (tr) { return tr.tagName === 'TR' && tr.style.display !== 'none'; });
    if (!rows.length) return;
    var cur = currentRec();
    var i = cur ? rows.indexOf(cur.tr) : -1;
    var next = rows[Math.min(rows.length - 1, Math.max(0, i + d))];
    grid.select(next);
    next.scrollIntoView({ block: 'nearest' });
  }

  function installKeys() {
    document.addEventListener('keydown', function (e) {
      if (!keyNav || !grid || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      if (e.key === 'Escape') { if (document.querySelector('.kvr-modal')) { closeModal(); e.preventDefault(); } return; }
      if (document.querySelector('.kvr-modal')) return;
      var t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName) || t.isContentEditable)) return;
      if (t && t !== document.body && !(grid.element && grid.element[0] && grid.element[0].contains(t))) return;
      var k = e.key;
      if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); stepRow(k === 'ArrowDown' ? 1 : -1); }
      else if (k === 'n' || k === 'N') { var r = currentRec(); if (r) { e.preventDefault(); openNote(r); } }
      else if (k === 'm' || k === 'M') {
        var c = currentRec();
        if (c) {
          e.preventDefault();
          var id = c.item.transactionId;
          if (selected[id]) delete selected[id]; else selected[id] = c.item;
          apply();
        }
      }
    }, true);
  }

  // ---- sammenlign to bonger ------------------------------------------------------
  async function compareSelected() {
    var list = selectedRecs();
    if (list.length !== 2) { say('Velg nøyaktig to kvitteringer for å sammenligne.'); return; }
    var need = list.filter(function (r) { return !scanMap[r.item.transactionId]; });
    if (need.length) { await scanList(need); apply(); }
    var sc = list.map(function (r) { return scanMap[r.item.transactionId]; });
    if (!sc[0] || !sc[1]) { say('Kunne ikke lese begge kvitteringene.'); return; }
    var key = function (i) { return i.c + '|' + i.a; };
    var count = function (items) { var m = {}; items.forEach(function (i) { m[key(i)] = (m[key(i)] || 0) + 1; }); return m; };
    var cnt = [count(sc[0].items), count(sc[1].items)];
    var only = [0, 0], same = 0;
    var cols = [0, 1].map(function (side) {
      var seen = {};
      var rowsEl = sc[side].items.map(function (i) {
        var k = key(i);
        seen[k] = (seen[k] || 0) + 1;
        var shared = seen[k] <= (cnt[1 - side][k] || 0);
        if (shared) { if (side === 0) same++; } else only[side]++;
        return el('div', { class: 'kvr-cmprow' + (shared ? '' : ' kvr-only') }, [
          el('span', { text: i.n + (i.q ? ' (' + i.q + ' stk)' : '') }), el('b', { text: fmt(i.a) })
        ]);
      });
      var it = list[side].item;
      var pay = Object.keys(sc[side].pay).map(function (l) { return l + ' ' + fmt(sc[side].pay[l]); }).join(' · ');
      return el('div', { class: 'kvr-cmpcol' }, [
        el('div', { class: 'kvr-cmphead' }, [el('b', { text: it.endDateTime }), el('span', { text: 'Kasse ' + it.workstationNumber + ' · Kasserer ' + it.cashierNumber + ' · Bong ' + it.bongnr }),
          el('span', { text: 'Sum ' + (it.totalAmount === null ? '–' : fmt(it.totalAmount)) + ' kr' })])
      ].concat(rowsEl, [el('div', { class: 'kvr-hint', text: pay })]));
    });
    var body = el('div', {}, [el('div', { class: 'kvr-hint', text: same + ' like linjer · ' + only[0] + ' bare i venstre · ' + only[1] + ' bare i høyre. Markerte linjer finnes ikke på den andre bongen.' }), el('div', { class: 'kvr-cmp' }, cols)]);
    openModal('Sammenlign bonger', body, [btn('Lukk', closeModal, 'kvr-primary')]);
  }

  // ---- sammendrag (morgenkontroll) ---------------------------------------------------
  function summarySections() {
    var items = analysisItems(lastMode);
    var sales = items.filter(function (i) { return i.receiptType === 1 && typeof i.totalAmount === 'number'; });
    var rets = sales.filter(function (i) { return i.totalAmount < 0; });
    var sum = function (a) { return a.reduce(function (x, i) { return x + i.totalAmount; }, 0); };
    var days = items.map(function (i) { return L.parseDT(i.endDateTime).date; }).filter(Boolean).sort();
    var secs = [];
    secs.push({ h: 'Oversikt', li: [
      'Periode: ' + (days.length ? days[0] + (days[days.length - 1] !== days[0] ? ' – ' + days[days.length - 1] : '') : '–'),
      'Salg: ' + sales.length + ' bonger, ' + fmt(sum(sales)) + ' kr',
      'Returer (negativ sum): ' + rets.length + ' bonger, ' + fmt(sum(rets)) + ' kr',
      'Kassaoppgjør: ' + items.filter(function (i) { return i.receiptType === 2; }).length
    ] });
    var flagged = items.filter(function (i) { return anomMap[i.transactionId]; });
    var reasons = {};
    flagged.forEach(function (i) { anomMap[i.transactionId].forEach(function (r) { var b = r.replace(/\s*\(.*$/, ''); reasons[b] = (reasons[b] || 0) + 1; }); });
    var rk = Object.keys(reasons).sort(function (a, b) { return reasons[b] - reasons[a]; }).slice(0, 10);
    secs.push({ h: 'Avvik (' + flagged.length + ' bonger)', li: rk.length ? rk.map(function (r) { return r + ': ' + reasons[r]; }) : ['Ingen avvik flagget (kjør kontroller først).'] });
    if (ctlRes) {
      var fc = {};
      ctlRes.findings.forEach(function (f) { fc[f.title] = (fc[f.title] || 0) + 1; });
      secs.push({ h: 'Funn på tvers av bonger', li: Object.keys(fc).length ? Object.keys(fc).map(function (t) { return t + ': ' + fc[t]; }) : ['Ingen funn.'] });
      var pf = ctlRes.profile.rows.filter(function (r) { return r.flagged; });
      secs.push({ h: 'Kassererprofil', li: pf.length ? pf.map(function (r) {
        return 'Kasserer ' + r.id + ': ' + Object.keys(r.flags).filter(function (k) { return r.flags[k]; }).map(function (k) { return { retShare: 'returandel ' + pct(r.retShare), avg: 'snitt ' + fmt(r.avg), lapperPer: 'manuelle pantelapper/salg ' + r.lapperPer.toFixed(2), negPer: 'korrigeringer/salg ' + r.negPer.toFixed(2) }[k]; }).join(', ');
      }) : ['Ingen avvik fra butikksnittet.'] });
      var rc = ctlRes.recon.filter(function (r) { return r.flag; });
      secs.push({ h: 'Dagsavstemming', li: rc.length ? rc.map(function (r) { return r.day + ' kasse ' + r.kasse + ': diff ' + fmt(r.diff) + ' kr'; }) : ['Ingen avvik.'] });
      var pb = ctlRes.pant.balance.filter(function (b) { return b.flag; });
      secs.push({ h: 'Pantebalanse', li: pb.length ? pb.map(function (b) { return b.day + ' butikk ' + L.storeShort(b.store) + ': salg ' + fmt(b.sale) + ', utbetalt ' + fmt(b.ret); }) : ['Ingen avvik.'] });
    }
    var open = Object.keys(notes).filter(function (id) { return notes[id].status === 'oppfolging'; }).length;
    secs.push({ h: 'Oppfølging', li: [open + ' bonger er merket «til oppfølging».'] });
    return secs;
  }

  function showSummary() {
    var secs = summarySections();
    var body = el('div', { class: 'kvr-sum' });
    secs.forEach(function (s) {
      body.appendChild(el('h5', { text: s.h }));
      body.appendChild(el('ul', {}, s.li.map(function (t) { return el('li', { text: t }); })));
    });
    var text = 'Morgenkontroll ' + new Date().toLocaleDateString('nb-NO') + '\n\n' + secs.map(function (s) { return s.h + '\n' + s.li.map(function (t) { return '- ' + t; }).join('\n'); }).join('\n\n');
    openModal('Sammendrag', body, [btn('Kopier som tekst', function () { copyText(text); }), btn('Lukk', closeModal, 'kvr-primary')]);
  }

  // ---- arbeidsoppgaver ----------------------------------------------------------------
  function allTasks() { return BUILTIN_TASKS.concat(tasksCustom); }

  function renderTasks() {
    if (!ui.taskSel) return;
    var cur = ui.taskSel.value;
    ui.taskSel.innerHTML = '';
    allTasks().forEach(function (t) { ui.taskSel.appendChild(opt(t.id, t.name)); });
    if (cur) ui.taskSel.value = cur;
  }

  async function runTask() {
    var t = allTasks().filter(function (x) { return x.id === ui.taskSel.value; })[0];
    if (!t || scanning) return;
    if (t.cwRel && t.cwRel !== 'none') {
      var r = L.relativeRange(t.cwRel);
      cw.dateFrom = r.dateFrom; cw.dateTo = r.dateTo;
      ui.cwFrom.value = r.dateFrom; ui.cwTo.value = r.dateTo;
      var before = boundCount;
      say('Henter ' + REL_LABEL[t.cwRel].toLowerCase() + ' fra CW…');
      cwSearch();
      await waitFor(function () { return boundCount > before; }, 20000);
      await wait(300);
    }
    filters = t.filters ? L.sanitizeFilters(t.filters) : L.defaultFilters();
    scope = defaultScope();
    if (t.cwRel && t.cwRel !== 'none') { var rr = L.relativeRange(t.cwRel); scope.dateFrom = rr.dateFrom; scope.dateTo = rr.dateTo; }
    scope.useFilters = !!t.filters;
    store(K.scope, scope);
    writeScope();
    writeForm(); apply();
    if (t.checks) await runAnalysis(); else if (t.scan) await scanVisible();
    ui.go(t.tab || 'check');
    if (t.summary) showSummary();
  }

  function saveTask() {
    var name = ui.taskName.value.trim();
    if (!name) { ui.taskName.focus(); return; }
    readForm();
    var t = { id: 't' + Date.now(), name: name, cwRel: ui.taskRel.value, filters: JSON.parse(JSON.stringify(filters)), scan: ui.taskScan.checked, checks: ui.taskChecks.checked, summary: ui.taskSummary.checked, tab: ui.taskChecks.checked ? 'check' : 'content' };
    tasksCustom = tasksCustom.filter(function (x) { return x.name !== name; }).concat([t]);
    store(K.tasks, tasksCustom);
    renderTasks();
    ui.taskSel.value = t.id;
    ui.taskName.value = '';
    say('Oppgaven «' + name + '» er lagret.');
  }

  function deleteTask() {
    var t = tasksCustom.filter(function (x) { return x.id === ui.taskSel.value; })[0];
    if (!t) { say('Innebygde oppgaver kan ikke slettes.'); return; }
    confirmBox('Slett oppgave', 'Slette oppgaven «' + t.name + '»?', 'Slett', function () {
      tasksCustom = tasksCustom.filter(function (x) { return x !== t; });
      store(K.tasks, tasksCustom);
      renderTasks();
    });
  }


