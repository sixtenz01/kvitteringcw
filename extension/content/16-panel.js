  // ---- panel ----------------------------------------------------------------
  function section(id, title, kids) {
    return el('div', { class: 'kvr-card', 'data-sec': id }, [el('h4', { text: title }), el('div', { class: 'kvr-secbody' }, kids)]);
  }

  function tile(label) {
    var v = el('b', { text: '–' });
    return { node: el('div', { class: 'kvr-tile' }, [v, el('span', { text: label })]), value: v };
  }

  // Stor/Full gjelder bare når panelet er åpent. Minimert er det en liten knapp med vanlig plassering, uansett størrelse.
  function bigMode(panel) { return curSize > 0 && !panel.classList.contains('kvr-collapsed'); }

  function clamp(panel) {
    if (bigMode(panel)) { if (modePos(curSize)) clampBig(panel); return; }
    var w = panel.offsetWidth, keep = panel.classList.contains('kvr-collapsed') ? 48 : 200;
    var left = Math.min(Math.max(0, parseFloat(panel.style.left) || 0), Math.max(0, window.innerWidth - w));
    var top = Math.min(Math.max(0, parseFloat(panel.style.top) || 0), Math.max(0, window.innerHeight - keep));
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    panel.style.maxHeight = Math.max(160, window.innerHeight - top - 12) + 'px';
  }

  // Stor og Full kan også flyttes. Plasseringen lagres per størrelse (K.pos2 = { 1: {left, top}, 2: {...} }); uten lagret plassering dokkes panelet som før.
  // Inline-stil med !important trengs fordi dokkingen i CSS bruker !important.
  function modePos(mode) { var all = store(K.pos2) || {}; var p = all[mode]; return p && typeof p.left === 'number' && typeof p.top === 'number' ? p : null; }
  function setModePos(mode, pos) {
    var all = Object.assign({}, store(K.pos2) || {});
    if (pos) all[mode] = pos; else delete all[mode];
    store(K.pos2, all);
  }
  function putImportant(panel, left, top) {
    panel.style.setProperty('left', left + 'px', 'important');
    panel.style.setProperty('top', top + 'px', 'important');
    panel.style.setProperty('right', 'auto', 'important');
  }
  function clampBig(panel) {
    var r = panel.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    // minst 260 px synlig til venstre (så tittellinjen kan gripes, ikke bare knappene), minst 120 px til høyre
    var left = Math.min(Math.max(r.left, Math.min(0, 260 - r.width)), vw - 120);
    var top = Math.min(Math.max(r.top, 0), Math.max(0, vh - 48));
    putImportant(panel, left, top);
  }
  function applyModePos(panel) {
    if (!bigMode(panel)) {
      if (panel.style.getPropertyPriority('left') === 'important') ['left', 'top', 'right'].forEach(function (k) { panel.style.removeProperty(k); });
      // minimert i Stor/Full: uten plassering ville knappen havne nederst på siden, utenfor skjermen
      if (curSize > 0) placePanel(panel);
      return;
    }
    ['left', 'top', 'right'].forEach(function (k) { panel.style.removeProperty(k); });
    var p = modePos(curSize);
    if (p) { putImportant(panel, p.left, p.top); clampBig(panel); }
  }

  // Panelstørrelse: 0 vanlig, 1 stor (dokket til høyre, lista i Lindbak er fortsatt synlig til venstre), 2 full (hele skjermen).
  var curSize = 0;
  var SIZE_NAMES = ['Vanlig', 'Stor', 'Full'];

  function sizeMode() {
    var v = store(K.wide);
    return v === true ? 1 : Math.max(0, Math.min(2, Number(v) || 0));
  }

  function paintSizeMode() {
    var panel = document.getElementById('kvr-panel');
    if (!panel) return;
    panel.classList.toggle('kvr-big', curSize === 1);
    panel.classList.toggle('kvr-full', curSize === 2);
    document.documentElement.classList.toggle('kvr-bigui', curSize > 0);
    if (ui.wideBtn) {
      ui.wideBtn.textContent = curSize === 0 ? '⤢' : curSize === 1 ? '⛶' : '⤡';
      ui.wideBtn.title = curSize === 0 ? 'Større panel (dokket til høyre, lista beholdes)' : curSize === 1 ? 'Fullskjerm' : 'Tilbake til vanlig størrelse';
    }
    if (ui.sizeSel) ui.sizeSel.value = String(sizeMode());
  }

  // persist = false: midlertidig bytte (for eksempel for å vise en bong i lista), huskes ikke.
  function setSizeMode(mode, persist) {
    var panel = document.getElementById('kvr-panel');
    if (!panel) return;
    var was = curSize;
    curSize = mode;
    if (persist) store(K.wide, mode);
    if (was > 0 && mode === 0) { panel.style.width = ''; panel.style.height = ''; store(K.size, null); }
    paintSizeMode();
    applyModePos(panel);
    if (mode === 0) placePanel(panel);
    setTimeout(renderChartsIfVisible, 80);
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
      var r0 = panel.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, left: r0.left, top: r0.top, moved: false };
      head.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    head.addEventListener('pointermove', function (e) {
      if (!start) return;
      var dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) start.moved = true;
      if (!start.moved) return;
      panel.classList.add('kvr-dragging');
      if (bigMode(panel)) { putImportant(panel, start.left + dx, start.top + dy); clampBig(panel); return; }
      panel.style.left = (start.left + dx) + 'px';
      panel.style.top = (start.top + dy) + 'px';
      clamp(panel);
    });
    head.addEventListener('pointerup', function () {
      if (!start) return;
      var moved = start.moved;
      start = null;
      panel.classList.remove('kvr-dragging');
      if (moved) { if (bigMode(panel)) setModePos(curSize, { left: parseFloat(panel.style.left), top: parseFloat(panel.style.top) }); else store(K.pos, { left: parseFloat(panel.style.left), top: parseFloat(panel.style.top) }); }
      else onTap();
    });
    head.addEventListener('pointercancel', function () { start = null; panel.classList.remove('kvr-dragging'); });
    head.addEventListener('dblclick', function (e) {
      if (e.target.closest('button')) return;
      if (bigMode(panel)) { setModePos(curSize, null); applyModePos(panel); return; }
      store(K.pos, null);
      store(K.size, null);
      panel.style.width = ''; panel.style.height = '';
      placePanel(panel);
    });
  }

  // Panelet skal alltid kunne nås. Er det utenfor skjermen (lagret plassering fra et annet vindu), fjernet fra siden eller dekket av noe i CW,
  // nullstilles plasseringen eller panelet løftes øverst. Sjekkes hvert 1,5 sekund sammen med gridet.
  var panelEl = null, coverFixes = 0, rescued = 0;
  function ensureVisible() {
    var panel = panelEl, why = '';
    if (!panel) return;
    if (!panel.isConnected) { document.body.appendChild(panel); why = 'fjernet fra siden'; }
    var r = panel.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    var keepH = panel.classList.contains('kvr-collapsed') ? 40 : 120;
    if (r.width < 20 || r.height < 20 || r.right < 120 || r.left > vw - 120 || r.bottom < 60 || r.top > vh - keepH) {
      store(K.pos, null); store(K.size, null);
      panel.style.width = ''; panel.style.height = '';
      if (bigMode(panel)) { setModePos(curSize, null); applyModePos(panel); } else placePanel(panel);
      why = why || 'utenfor skjermen';
    } else if (coverFixes < 3) {
      var hr = (panel.querySelector('.kvr-head') || panel).getBoundingClientRect();
      var hit = document.elementFromPoint(hr.left + hr.width / 2, hr.top + hr.height / 2);
      if (hit && !panel.contains(hit) && !(hit.closest && hit.closest('.kvr-modal'))) {
        coverFixes++;
        (coverFixes === 1 ? document.body : document.documentElement).appendChild(panel);
        why = why || 'dekket av siden';
      }
    }
    if (why && rescued < 5) {
      rescued++;
      try { console.info('[Kvitteringshenter] panelet var ' + why + ' og ble hentet fram.'); } catch (e) { /* ingen konsoll */ }
    }
  }

  function buildPanel() {
    var panel = el('div', { id: 'kvr-panel' });
    if (showAll) panel.classList.add('kvr-showall');
    panelEl = panel;

    ui.badge = el('span', { class: 'kvr-badge', text: 'ingen filter' });
    var toggle = el('button', { type: 'button', class: 'kvr-icon', title: 'Skjul/vis (Alt+K)', text: '–' });
    ui.wideBtn = el('button', { type: 'button', class: 'kvr-icon', title: 'Større panel', 'aria-label': 'Panelstørrelse', text: '⤢' });
    ui.helpBtn = el('button', { type: 'button', class: 'kvr-icon', title: 'Hjelp og tegnforklaring', 'aria-label': 'Hjelp', text: '?' });
    ui.gearBtn = el('button', { type: 'button', class: 'kvr-icon', title: 'Innstillinger', 'aria-label': 'Innstillinger', text: '⚙' });
    ui.helpBtn.addEventListener('click', openHelp);
    ui.gearBtn.addEventListener('click', function () { openSettings(); });
    var head = el('div', { class: 'kvr-head', title: 'Dra for å flytte · dobbeltklikk for å nullstille plassering og størrelse' }, [
      el('span', { class: 'kvr-grip', text: '⠿' }),
      el('span', { class: 'kvr-title', text: 'Kvitteringshenter' }),
      ui.badge,
      ui.helpBtn,
      ui.gearBtn,
      ui.wideBtn,
      toggle
    ]);

    var t1 = tile('Viser'), t2 = tile('Valgt'), t3 = tile('Sum valgt (kr)'), t4 = tile('Duplikater');
    ui.stVisible = t1.value; ui.stSelected = t2.value; ui.stSum = t3.value; ui.stDup = t4.value;
    ui.tSel = [t2.node, t3.node]; ui.tDup = t4.node;
    ui.pantLine = el('div', { class: 'kvr-pantline', text: '' });
    ui.bar = el('div', { class: 'kvr-bar' });
    ui.barWrap = el('div', { class: 'kvr-barwrap', style: 'display:none' }, [ui.bar]);
    ui.chips = el('div', { class: 'kvr-chipsrow' });
    ui.opText = el('span', { class: 'kvr-optext' });
    ui.stopTop = el('button', { type: 'button', class: 'kvr-btn kvr-sm', text: 'Stopp', style: 'display:none', onclick: function () { cancelScan = true; } });
    ui.opRow = el('div', { class: 'kvr-oprow', 'aria-live': 'polite', style: 'display:none' }, [ui.opText, ui.stopTop]);
    ui.scanTxt = el('span', { class: 'kvr-scantxt' });
    ui.scanNow = btn('Skann nå', scanVisible, 'kvr-sm kvr-primary');
    ui.scanRow = el('div', { class: 'kvr-scanrow', style: 'display:none' }, [ui.scanTxt, ui.scanNow]);
    ui.scanWarnTxt = el('span', {});
    ui.scanWarnBtn = btn('Skann nå', scanVisible, 'kvr-sm');
    ui.scanWarn = el('div', { class: 'kvr-scanwarn', role: 'status', style: 'display:none' }, [ui.scanWarnTxt, ui.scanWarnBtn]);
    ui.firstRun = el('div', { class: 'kvr-notice kvr-first', role: 'status', style: store(K.help) ? 'display:none' : '' }, [
      el('span', { text: 'Første gang? Se kort veiledning og tegnforklaring.' }),
      btn('Åpne', openHelp, 'kvr-sm kvr-primary'),
      btn('✕', function () { store(K.help, 1); ui.firstRun.style.display = 'none'; }, 'kvr-sm')]);
    ui.firstRun.lastChild.title = 'Skjul';
    ui.waitNote = el('div', { class: 'kvr-notice', role: 'status', style: 'display:none' }, [el('span', { text: 'Venter på listen i CW. Hent kvitteringer i Lindbak (Oppdater), så kobles pluginen til listen.' })]);
    ui.hideAllTxt = el('span', {});
    ui.hideAll = el('div', { class: 'kvr-notice', role: 'status', style: 'display:none' }, [ui.hideAllTxt, btn('Vis alle', function () { resetFilters(); say('Filtrene i pluginen er nullstilt. CW-søket er ikke endret.'); }, 'kvr-sm kvr-primary')]);
    var stats = el('div', { class: 'kvr-stats' }, [ui.firstRun, ui.waitNote, ui.hideAll, el('div', { class: 'kvr-tiles' }, [t1.node, t2.node, t3.node, t4.node]), ui.chips, ui.scanRow, ui.scanWarn, ui.pantLine, ui.opRow, ui.barWrap]);

    // --- Søk i CW
    var cwFrom = el('input', { type: 'date' }), cwTo = el('input', { type: 'date' });
    ui.cwFrom = cwFrom; ui.cwTo = cwTo;
    cwFrom.addEventListener('change', function () { cw.dateFrom = cwFrom.value; if (!cwTo.value) { cwTo.value = cwFrom.value; cw.dateTo = cwFrom.value; } summary(); });
    cwTo.addEventListener('change', function () { cw.dateTo = cwTo.value; summary(); });
    var cwQ = el('input', { type: 'text', placeholder: 'søk butikk (navn eller nr)' });
    cwQ.addEventListener('input', function () { cw.storeQuery = cwQ.value; renderCwStores(); });
    ui.cwStores = el('div', { class: 'kvr-checklist', role: 'group', 'aria-label': 'Butikker' });
    ui.cwCount = el('div', { class: 'kvr-hint', text: '0 butikker valgt' });
    var cwMem = el('input', { type: 'text', placeholder: 'medlemsnr, kommaseparert' });
    var cwLoy = el('input', { type: 'text', placeholder: 'lojalitets-ID, kommaseparert' });
    var cwFree = el('input', { type: 'text', placeholder: 'EAN eller varenavn' });
    var cwBong = el('input', { type: 'text', placeholder: 'bongnr' });
    ui.cwMem = cwMem; ui.cwLoy = cwLoy; ui.cwFree = cwFree; ui.cwBong = cwBong;
    cwMem.addEventListener('input', function () { cw.members = cwMem.value.trim(); summary(); });
    cwLoy.addEventListener('input', function () { cw.loyal = cwLoy.value.trim(); summary(); });
    cwFree.addEventListener('input', function () { cw.free = cwFree.value.trim(); summary(); });
    cwBong.addEventListener('input', function () { cw.bong = cwBong.value.trim(); summary(); });
    ui.cwStatus = el('div', { class: 'kvr-note', text: '' });
    ui.cwxBtn = btn('Hent tilleggsdata fra CW', fetchCwExtra);
    ui.cwxStop = btn('Stopp', stopCwExtra, 'kvr-ifon');
    ui.cwxStop.disabled = true;
    ui.cwxStatus = el('div', { class: 'kvr-note', role: 'status', text: '' });
    ui.cwxInfo = el('div', {});
    var secCw = section('cw', 'Søk i hele journalen (CW)', [
      el('div', { class: 'kvr-row' }, [field('Dato fra', cwFrom), field('Dato til', cwTo)]),
      field('Butikker (navn som i CW)', cwQ), ui.cwStores, ui.cwCount,
      (ui.cwMore = el('details', { class: 'kvr-sub' }, [el('summary', { text: 'Flere søkefelt: medlemsnr, lojalitets-ID, vare, bongnr' }),
        field('Medlemsnr', cwMem), field('Lojalitets-ID', cwLoy),
        el('div', { class: 'kvr-row' }, [field('Vare (EAN/navn)', cwFree), field('Bongnr', cwBong)])])),
      el('div', { class: 'kvr-row' }, [btn('Søk i CW', cwSearch, 'kvr-primary'), btn('Nullstill CW', cwReset, 'kvr-sm')]),
      ui.cwStatus
    ], true);
    var secCwxGet = fold(section('cwxget', 'Tilleggsdata fra CW', [
      hintEl('Merker bongene i listen med innhold og betaling fra CWs egne filtre (ca. 20 søk). Trengs for «Rask skanning» og kortet «Fra CW».'),
      el('div', { class: 'kvr-row' }, [ui.cwxBtn, ui.cwxStop]),
      ui.cwxStatus, ui.cwxInfo
    ]), 'cwxget', false);
    renderCwx();

    // --- Hent og skann i deler
    ui.partBtn = btn('Hent og skann i deler', fetchParts, 'kvr-primary');
    ui.partStop = btn('Stopp', stopParts, 'kvr-ifon');
    ui.partStop.disabled = true;
    ui.partScan = check('Skann bongene', function () {});
    ui.partScan.box.checked = true;
    ui.partExtra = check('Hent tilleggsdata fra CW for hver dag', function () {});
    ui.partStatus = el('div', { class: 'kvr-note', role: 'status', text: '' });
    ui.partInfo = el('div', {});
    var secParts = section('parts', 'Hent og skann i deler', [
      hintEl('For mer enn 1000 bonger: henter og skanner én dag om gangen, med datoene og butikkene over. Du kan stoppe og fortsette senere.'),
      el('div', { class: 'kvr-row' }, [ui.partScan.node, ui.partExtra.node]),
      el('div', { class: 'kvr-row' }, [ui.partBtn, ui.partStop]),
      ui.partStatus, ui.partInfo
    ]);
    renderParts();

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
    var secTime = section('time', 'Dato og tid', [
      quick,
      el('div', { class: 'kvr-row' }, [field('Dato fra', ui.dateFrom), field('Dato til', ui.dateTo)]),
      el('div', { class: 'kvr-row' }, [field('Tid fra', ui.timeFrom), field('Tid til', ui.timeTo)])
    ], true);

    ui.stores = storeBox(null, true); ui.workstations = pills(); ui.cashiers = pills(); ui.types = pills();
    var storeNames = el('textarea', { rows: '3', placeholder: '1001=Butikknavn', title: 'Egne butikknavn (nr=navn per linje). Brukes hvis CW-listen ikke finnes.' });
    storeNames.value = manualStores;
    storeNames.addEventListener('change', function () { manualStores = storeNames.value; store(K.stores, manualStores); optsKey = ''; apply(); });
    var secStore = section('store', 'Butikk', [ui.stores]);
    var secWho = section('who', 'Kasse, kasserer og type', [
      pfield('Kasse', ui.workstations), pfield('Kasserer', ui.cashiers), pfield('Type', ui.types)
    ], true);

    ui.sumMin = input('number', { step: '0.01', placeholder: 'min' });
    ui.sumMax = input('number', { step: '0.01', placeholder: 'maks' });
    var neg = check('Negativ sum (retur/panteretur)'); ui.onlyNegative = neg.box;
    ui.member = input('text', { placeholder: 'medlemsnr' });
    var mem = check('Kun med medlem'); ui.onlyMember = mem.box;
    var dp = check('Kun mulige duplikater'); ui.onlyDup = dp.box;
    ui.bong = input('text', { placeholder: 'bongnr, f.eks. 1005-6-123' });
    ui.note = sortSelect(el('select', {}, [opt('', 'Alle'), opt('any', 'Har notat eller status'), opt('oppfolging', 'Til oppfølging'), opt('sjekket', 'Sjekket')]));
    ui.note.addEventListener('change', onChange);
    ui.item = input('text', { placeholder: 'EAN eller varenavn (skannede)' });
    ui.text = input('text', { placeholder: 'ord, EAN, beløp, kortnr, referanse …' });
    ui.pay = el('select', { 'aria-label': 'Betalingsmåte' }, [el('option', { value: '', text: 'Alle' })]);
    ui.pay.addEventListener('change', onChange);
    // feltene i alfabetisk rekkefølge (fra og til står sammen)
    var secSum = section('sum', 'Sum, medlem og bong', [
      field('Bongnr', ui.bong), mem.node, dp.node, field('Medlemssøk', ui.member), neg.node, field('Notat/status', ui.note),
      el('div', { class: 'kvr-row' }, [field('Sum fra', ui.sumMin), field('Sum til', ui.sumMax)])
    ], true);

    // --- Skanning og pant
    ui.pant = el('select', { 'aria-label': 'Pant' }, [
      el('option', { value: '', text: 'Alle' }),
      el('option', { value: 'any', text: 'Har pant eller panteretur' }),
      el('option', { value: 'sale', text: 'Har pant (salg)' }),
      el('option', { value: 'return', text: 'Har panteretur' })
    ]);
    sortSelect(ui.pant);
    ui.pant.addEventListener('change', onChange);
    ui.disc = el('select', { 'aria-label': 'Rabatt' }, [
      el('option', { value: '', text: 'Alle' }),
      el('option', { value: 'any', text: 'Har rabatt (rabattlinje)' }),
      el('option', { value: 'noreason', text: 'Rabatt uten årsak' }),
      el('option', { value: 'reason', text: 'Rabatt med årsak' }),
      el('option', { value: 'coupon', text: 'Har kupong (kampanje)' })
    ].concat(L.DISC_REASONS.map(function (r) { return el('option', { value: 'r:' + r, text: 'Årsak: ' + r }); })));
    sortSelect(ui.disc);
    ui.disc.addEventListener('change', onChange);
    ui.discFrom = input('number', { step: '1', min: '0', placeholder: 'fra %' });
    ui.discTo = input('number', { step: '1', min: '0', placeholder: 'til %' });
    ui.special = el('select', { 'aria-label': 'Spesialbetaling' }, [el('option', { value: '', text: 'Alle' })]);
    ui.special.addEventListener('change', onChange);
    ui.cardRet = el('select', { 'aria-label': 'Retur til kort' }, [el('option', { value: '', text: 'Alle' }), el('option', { value: '*', text: 'Retur til kort (alle leverandører)' })]
      .concat(Object.keys(L.SCHEME_LABELS).map(function (k) { return el('option', { value: k, text: 'Retur til ' + L.SCHEME_LABELS[k] }); }))
      .concat([el('option', { value: '?', text: 'Retur til kort, ukjent leverandør' })]));
    sortSelect(ui.cardRet);
    ui.cardRet.addEventListener('change', onChange);
    ui.scanBtn = btn('Skann innhold (synlige)', scanVisible, 'kvr-primary');
    ui.stopBtn = btn('Stopp', function () { cancelScan = true; }, 'kvr-ifon');
    ui.stopBtn.disabled = true;
    ui.retryBtn = btn('Prøv feilede på nytt', function () { if (lastRetry) lastRetry(); }, 'kvr-ifon');
    ui.retryBtn.disabled = true;
    ui.quickBox = check('Rask skanning: bare bonger med funn fra CW', function () { quickScan = ui.quickBox.box.checked; store(K.quick, quickScan); renderScanState(); if (quickScan && !(cwx && Object.keys(cwx.tags).length)) say('Rask skanning trenger tilleggsdata fra CW (Hent → Tilleggsdata fra CW). Til de er hentet, skannes alle.'); });
    ui.quickBox.box.checked = quickScan;
    var secScan = section('scan', 'Skanning', [
      el('div', { class: 'kvr-row' }, [ui.scanBtn, ui.stopBtn, ui.retryBtn]),
      ui.quickBox.node,
      hintEl('Omtrent én bong i sekundet. La fanen stå synlig (Chrome bremser skjulte faner), og ikke bruk CW mens den går. Rask skanning tar bare bonger CW har merket (krever tilleggsdata under Hent).')
    ], true);

    // --- Varegrupper
    ui.groups = pills();
    ui.groupSums = el('div', {});
    ui.unmatched = el('div', {});
    ui.rules = el('div', {});
    var fileIn = el('input', { type: 'file', accept: 'application/json', style: 'display:none' });
    fileIn.addEventListener('change', function () {
      var f = fileIn.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try { rules = L.sanitizeRules(JSON.parse(fr.result)); saveRules(); renderRules(); apply(); } catch (e) { say('Ugyldig regelfil.'); }
      };
      fr.readAsText(f);
      fileIn.value = '';
    });
    var rulesDetails = el('details', { class: 'kvr-sub' }, [el('summary', { text: 'Regelsett (rekkefølge = prioritet)' }), ui.rules,
      el('div', { class: 'kvr-row' }, [
        btn('Ny gruppe', function () { rules.push({ name: 'Ny gruppe', include: [], exclude: [] }); saveRules(); renderRules(); }),
        btn('Eksporter', function () { download(new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' }), 'varegrupper.json'); }),
        btn('Importer', function () { fileIn.click(); }),
        btn('Standard', function () { confirmBox('Standard varegrupper', 'Tilbakestille varegruppene til standardregler? Egne grupper og opplærte nøkkelord går tapt.', 'Tilbakestill', function () { rules = L.defaultRules(); saveRules(); renderRules(); apply(); }); })
      ]), fileIn]);
    var secContent = section('content', 'Innhold', [
      hintEl('Filtre som leser innholdet på kvitteringene. De krever at kvitteringene er skannet: bruk «Skann nå» øverst, eller fanen Skann.'),
      field('Betalingsmåte', ui.pay, true),
      el('div', { class: 'kvr-row' }, [field('Pant', ui.pant, true), field('Rabatt', ui.disc, true)]),
      el('div', { class: 'kvr-row' }, [field('Rabatt % fra', ui.discFrom, true), field('Rabatt % til', ui.discTo, true)]),
      field('Retur til kort (kortleverandør)', ui.cardRet, true),
      field('Spesialbetaling (eget/internt forbruk, utbetaling …)', ui.special, true),
      field('Søk i bongen (alt innhold, flere ord)', ui.text, true),
      field('Vare (EAN eller navn)', ui.item, true),
      pfield('Varegruppe', ui.groups, true)
    ], true);
    var secGroups = fold(section('groups', 'Varegrupper', [
      el('div', { class: 'kvr-hint', text: 'Sum per varegruppe for valgte kvitteringer:' }), ui.groupSums,
      el('div', { class: 'kvr-hint kvr-mt', text: 'Varer uten gruppe (mest solgt):' }), ui.unmatched,
      rulesDetails
    ], false), 'groups', false);

    // --- Avvik
    var oa = check('Kun avvik'); ui.onlyAnom = oa.box;
    ui.anomBtn = btn('Kjør avviksjekk (synlige)', function () { runAnom('visible'); }, 'kvr-primary');
    ui.anomList = el('div', { class: 'kvr-list' });
    var secAnom = fold(section('anom', 'Avvik per bong', [
      el('div', { class: 'kvr-hint', text: 'Sjekker hver synlige bong mot grensene i Innstillinger. Kjøres kun når du trykker.' }),
      el('div', { class: 'kvr-row' }, [ui.anomBtn, btn('Juster grenser', function () { openSettings('bong'); })]),
      oa.node, ui.anomList
    ], false), 'anom', true);


    // --- Rapport
    ui.repBy = el('select', {}, [el('option', { value: 'kasse', text: 'Per kasse' }), el('option', { value: 'kasserer', text: 'Per kasserer' })]);
    ui.repBy.addEventListener('change', renderReport);
    var repDay = check('Del opp per dag', renderReport); ui.repDay = repDay.box;
    ui.repTable = el('div', { class: 'kvr-tablewrap' });
    ui.repNote = el('div', { class: 'kvr-hint' });
    var secReport = section('report', 'Dagsrapport (synlige kvitteringer)', [
      el('div', { class: 'kvr-row' }, [ui.repBy, repDay.node]),
      ui.repTable, ui.repNote,
      el('div', { class: 'kvr-row' }, [btn('Eksporter rapport (CSV)', exportReportCsv)])
    ]);
    ui.settleNote = el('div', { class: 'kvr-hint' });
    ui.settleList = el('div', { class: 'kvr-list' });
    var secSettle = section('settle', 'Kassaoppgjør', [ui.settleNote, ui.settleList]);

    // --- Egne avviksregler
    ui.crules = el('div', {});
    var secCustom = fold(section('custom', 'Egne avviksregler', [
      el('div', { class: 'kvr-hint', text: 'Alle vilkår i en regel må stemme (OG). Felt merket * krever skanning. Klokkeslett skrives HH:MM. Tomt medlemsnr: «Medlemsnr = (tomt)».' }),
      ui.crules,
      el('div', { class: 'kvr-row' }, [btn('Ny regel', function () {
        customRules.push({ id: 'r' + Date.now(), name: uniqueRuleName('Ny regel'), enabled: true, conds: [{ f: 'sum', op: '<=', v: '' }] }); saveCustom(); renderCustom();
      }), btn('Eksempel', function () {
        customRules.push({ id: 'r' + Date.now(), name: uniqueRuleName('Stor retur om kvelden'), enabled: true, conds: [{ f: 'sum', op: '<=', v: '-200' }, { f: 'tid', op: '>=', v: '20:00' }] }); saveCustom(); renderCustom();
      })])
    ]), 'custom', true);


    // --- Kontroll
    ui.taskSel = el('select', {});
    ui.taskName = el('input', { type: 'text', placeholder: 'navn, f.eks. Mandagens kontroll' });
    ui.taskRel = el('select', {}, Object.keys(REL_LABEL).map(function (k) { return opt(k, REL_LABEL[k]); }));
    var tScan = check('Skann', function () {}); ui.taskScan = tScan.box; tScan.box.checked = true;
    var tChk = check('Kontroller', function () {}); ui.taskChecks = tChk.box; tChk.box.checked = true;
    var tSum = check('Sammendrag', function () {}); ui.taskSummary = tSum.box; tSum.box.checked = true;
    var secTasks = fold(section('tasks', 'Arbeidsoppgaver', [
      hintEl('En oppgave husker gjeldende filter, datovalg, skanning og kontroller, og kjøres med én knapp. Den bruker butikk, medlem og andre valg fra Søk-fanen. Lagrede filtre (Filter-fanen) setter bare filter.'),
      el('div', { class: 'kvr-row' }, [ui.taskSel, btn('Kjør', runTask, 'kvr-primary')]),
      el('div', { class: 'kvr-row' }, [ui.taskName, ui.taskRel]),
      el('div', { class: 'kvr-row' }, [tScan.node, tChk.node, tSum.node]),
      el('div', { class: 'kvr-row' }, [btn('Lagre som oppgave', saveTask), btn('Slett valgt', deleteTask)])
    ]), 'tasks', true);

    ui.ctlInfo = hintEl('');
    var secChecks = section('checks', 'Kontroller', [
      hintEl('Kjører først avviksjekken per kvittering, så kontroller på tvers av bonger. Funn legges i samme avviksliste. Terskler og poeng justeres under Innstillinger.'),
      el('div', { class: 'kvr-row' }, [btn('Kjør alle kontroller (synlige)', function () { runChecks('visible'); }, 'kvr-primary'), btn('Juster terskler', function () { openSettings(); })]),
      ui.ctlInfo
    ]);
    ui.ctlProfile = el('div', {}); ui.ctlFindings = el('div', { class: 'kvr-list' }); ui.ctlPant = el('div', {}); ui.ctlRecon = el('div', {});
    var secProfile = fold(section('profile', 'Kassererprofil mot butikksnitt', [ui.ctlProfile]), 'profile', true);
    secProfile.classList.add('kvr-span');
    var secFindings = fold(section('findings', 'Mønstre og funn', [ui.ctlFindings]), 'findings', true);
    var secPantBal = fold(section('pantbal', 'Pantelapp-sjekk: balanse per dag', [ui.ctlPant]), 'pantbal', false);
    var secRecon = fold(section('recon', 'Dagsavstemming per kasse', [ui.ctlRecon]), 'recon', false);
    secRecon.classList.add('kvr-span');
    ui.ctlDiff = el('div', {}); ui.ctlNum = el('div', {}); ui.ctlDisc = el('div', {}); ui.ctlMember = el('div', {}); ui.ctlMisc = el('div', {}); ui.ctlLapp = el('div', {}); ui.ctlLines = el('div', {}); ui.ctlAcct = el('div', {});
    var secDiff = fold(section('diff', 'Kassadifferanse over tid', [ui.ctlDiff]), 'diff', true);
    secDiff.classList.add('kvr-span');
    var secNum = fold(section('numbers', 'Tallanalyse: Benford og runde beløp', [ui.ctlNum]), 'numbers', false);
    var secDisc = fold(section('disc', 'Rabatter og kuponger', [ui.ctlDisc]), 'disc', true);
    secDisc.classList.add('kvr-span');
    var secMember = fold(section('member', 'Medlemsnummer', [ui.ctlMember]), 'member', true);
    ui.ctlNet = el('div', {});
    var secNet = fold(section('net', 'Nettverk: kort, medlemsnr og kasserere', [ui.ctlNet]), 'net', true);
    secNet.classList.add('kvr-span');
    var secMisc = fold(section('misc', 'Pris, kjøpeutbytte og hendelser', [ui.ctlMisc]), 'misc', false);
    var secLapp = fold(section('lapp', 'Pantelapper: manuell og maskin', [ui.ctlLapp]), 'lapp', true);
    secLapp.classList.add('kvr-span');
    var secLines = fold(section('lines', 'Linjer, kort og spesialbetaling', [ui.ctlLines]), 'lines', false);
    var secAcct = fold(section('acct', 'Bongregnskap og referanser', [ui.ctlAcct]), 'acct', false);
    ui.ctlCwx = el('div', {});
    var secCwx = fold(section('cwx', 'Fra CW: innhold, innlogging, bongkopi og svinn', [ui.ctlCwx]), 'cwx', true);
    secCwx.classList.add('kvr-span');
    ui.ctlSum = el('div', { class: 'kvr-ctlsum' });
    ui.ctlJump = el('div', { class: 'kvr-chips' });
    ui.ctlClean = hintEl('');
    ui.showAllBtn = btn(showAll ? 'Vis bare funn' : 'Vis alt', function () { setShowAll(!showAll); }, 'kvr-sm');
    ui.ctlSumCard = section('ctlsum', 'Resultat', [ui.ctlSum, ui.ctlJump, ui.ctlClean, el('div', { class: 'kvr-row' }, [ui.showAllBtn])]);
    ui.resCards = [['profile', 'Profil', secProfile, []], ['findings', 'Funn', secFindings, null], ['cwx', 'Fra CW', secCwx, ['Fra CW', 'Innlogging', 'Bongkopi', 'Svinn']],
      ['pantbal', 'Pant', secPantBal, []], ['recon', 'Avstemming', secRecon, []], ['diff', 'Differanse', secDiff, ['Kassadifferanse']], ['numbers', 'Tall', secNum, ['Tallanalyse']],
      ['disc', 'Rabatt', secDisc, ['Rabatt']], ['member', 'Medlem', secMember, ['Medlem']], ['net', 'Nettverk', secNet, ['Nettverk']],
      ['misc', 'Pris m.m.', secMisc, ['Pris', 'Kjøpeutbytte', 'Hendelse', 'Maskinlæring']], ['lapp', 'Pantelapper', secLapp, ['Pantelapp']],
      ['lines', 'Linjer m.m.', secLines, ['Slettede linjer', 'Kort', 'Spesialbetaling', 'Overvåket vare', 'Retur av vare', 'Retur', 'Spør pris', 'Manuell kvittering', 'Tempo']],
      ['acct', 'Regnskap', secAcct, ['Regnskap', 'Topptekst', 'Sekvens']]];
    ui.ctlResults = el('div', { class: 'kvr-pane' }, [secProfile, secFindings, secCwx, secPantBal, secRecon, secDiff, secNum, secDisc, secMember, secNet, secMisc, secLapp, secLines, secAcct]);
    ui.noteList = el('div', { class: 'kvr-list' });
    ui.noteCount = hintEl('');
    var kn = check('Tastaturflyt: ↑ ↓ bytter bong, N notat, M velg/fjern', function () { keyNav = kn.box.checked; store(K.keynav, keyNav); });
    kn.box.checked = keyNav;
    ui.keyNavBox = kn;
    var secNotes = fold(section('notes', 'Oppfølging og tastatur', [
      ui.noteCount, ui.noteList,
      el('div', { class: 'kvr-row' }, [btn('Notat på valgt rad', function () { openNote(currentRec()); }), btn('Eksporter notater', exportNotes), btn('Notatlogg…', openNoteLog)]),
      btn('Fjern «sjekket»', function () {
        confirmBox('Fjern sjekkede', 'Fjerne alle notater med status «sjekket»?', 'Fjern', function () {
          Object.keys(notes).forEach(function (id) { if (notes[id].status === 'sjekket') delete notes[id]; });
          saveNotes(); apply(); renderNotes();
        });
      }),
      hintEl('Tastaturflyt (↑ ↓ bytter bong, N notat, M velg/fjern) slås av og på under Mer → Innstillinger.')
    ]), 'notes', true);

    // --- Sortering
    ui.sort = el('select', {}, [
      el('option', { value: 'none', text: 'Standard' }),
      el('option', { value: 'sumDesc', text: 'Sum høyest først' }),
      el('option', { value: 'sumAsc', text: 'Sum lavest først' }),
      el('option', { value: 'timeDesc', text: 'Nyeste først' }),
      el('option', { value: 'timeAsc', text: 'Eldste først' })
    ]);
    ui.sort.addEventListener('change', onChange);
    // --- Sortering og lagrede filtre
    ui.name = el('input', { type: 'text', placeholder: 'navn på filter' });
    ui.saved = el('select', {});
    var secSaved = section('sort', 'Sortering og lagrede filtre', [
      field('Sortering', ui.sort),
      el('b', { class: 'kvr-subh', text: 'Lagrede filtre' }),
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
    ], true);

    // --- Eksport
    var pH = check('PNG: legg på topptekst (butikk, kasse, kasserer, bongnr, tid)', function () {}); ui.pngHeaderOn = pH.box; pH.box.checked = true;
    var pM = check('PNG: ta med medlemsnr i topptekst', function () {}); ui.pngMember = pM.box;
    ui.pngLayout = el('select', {}, [el('option', { value: 'bong', text: 'Bong (smal, som papirkvittering)' }), el('option', { value: 'a4', text: 'A4-ark med bongen i midten' })]);
    ui.pngLayout.value = store(K.layout) || 'bong';
    ui.pngLayout.addEventListener('change', function () { store(K.layout, ui.pngLayout.value); });
    var secExport = section('export', 'Eksport', [
      hintEl('CSV og PNG lages med knappene nederst: valgte bonger, eller alle synlige når ingen er valgt (CSV). CSV åpnes direkte i Excel.'),
      field('PNG-format', ui.pngLayout), pH.node, pM.node
    ], false);

    ui.storeNames = storeNames;
    var setFile = el('input', { type: 'file', accept: 'application/json', style: 'display:none' });
    setFile.addEventListener('change', function () {
      var f = setFile.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () { importSettings(String(fr.result)); };
      fr.readAsText(f);
      setFile.value = '';
    });
    ui.setStale = el('div', { class: 'kvr-notice', role: 'status', style: 'display:none' }, [el('span', { text: 'Innstillingene er endret siden siste analyse.' }), btn('Kjør analyse', function () { ui.go('check'); runAnalysis(); }, 'kvr-sm')]);
    ui.sizeSel = el('select', { 'aria-label': 'Panelstørrelse' }, [opt('0', 'Vanlig (flyttbart)'), opt('1', 'Stor (dokket til høyre, lista beholdes)'), opt('2', 'Full (hele skjermen)')]);
    ui.sizeSel.value = String(sizeMode());
    ui.sizeSel.addEventListener('change', function () { setSizeMode(Number(ui.sizeSel.value), true); });
    ui.tshift = el('input', { type: 'number', step: '1', 'aria-label': 'Tidsforskyvning for listen (min)' });
    ui.tshift.value = String(timeShift);
    ui.tshift.addEventListener('change', function () { var v = Math.round(Number(ui.tshift.value)); setTimeShift(isFinite(v) ? v : 0); });
    ui.setGeneral = section('set-general', 'Generelt', [
      field('Egne butikknavn (valgfritt, nr=navn per linje)', storeNames),
      field('Panelstørrelse', ui.sizeSel),
      field('Tidsforskyvning for listen (min)', ui.tshift),
      hintEl('Normalt 0. Brukes bare hvis klokkeslettet i listen avviker fast fra bongen; Diagnostikk foreslår verdien.'),
      kn.node,
      el('div', { class: 'kvr-row' }, [btn('Eksporter innstillinger', exportSettings), btn('Importer…', function () { setFile.click(); }), btn('Diagnostikk…', openDiag)]), setFile,
      el('div', { class: 'kvr-row' }, [
        btn('Tilbakestill plassering', function () {
          store(K.pos, null); store(K.size, null);
          panel.style.width = ''; panel.style.height = '';
          placePanel(panel);
          say('Plassering og størrelse er tilbakestilt.');
        }),
        btn('Alt til standard', function () {
          confirmBox('Alt til standard', 'Sette alle terskler, avviksgrenser og poeng tilbake til standard? Egne regler, varegrupper og butikknavn beholdes.', 'Tilbakestill', resetAllSettings);
        })
      ]),
      hintEl('Eksport tar med terskler, poeng, egne regler, varegrupper og butikknavn. Skannede kvitteringer og notater tas ikke med.'),
      el('b', { class: 'kvr-subh', text: 'Lagret data' }),
      el('div', { class: 'kvr-row' }, [btn('Tøm cache', function () {
        confirmBox('Tøm cache', 'Slette skannet innhold, tilleggsdata fra CW og samlet grunnlag? Notater og innstillinger beholdes.', 'Tøm', function () {
          clearScan(); clearArchive(); anomMap = {}; ctlRes = null; checkState.at = null; failedRecs = []; lastRetry = null; syncRetry(); say('Cache tømt: skannet innhold, tilleggsdata fra CW og samlet grunnlag.'); apply(); renderControl(); renderCwx(); renderParts();
        });
      }), btn('Tøm samlet grunnlag', function () {
        confirmBox('Tøm samlet grunnlag', 'Fjerne ' + archCount() + ' bonger fra samlet grunnlag? Skannet innhold beholdes.', 'Tøm', function () { clearArchive(); apply(); renderParts(); partSay('Samlet grunnlag er tømt.'); });
      })]),
      el('b', { class: 'kvr-subh', text: 'Lagre i mappe' }),
      (ui.folderInfo = hintEl('')),
      (ui.folderBtns = el('div', { class: 'kvr-row' })),
      hintEl('Velg en mappe (for eksempel på en fellesdisk), så skrives innstillingene til ' + FOLDER_FILE + ' der ved hver endring. Samme fil kan leses inn på en annen PC. Skannede kvitteringer og notater blir i nettleseren.')
    ]);
    ui.setBody = el('div', { class: 'kvr-pane' });

    ui.repLog = el('div', {});
    var secAudit = section('auditrep', 'Revisjonsrapport', [
      hintEl('Én ZIP med omfang, terskler, funn, dekningsgrad, bevis-PNG og kontrollsummer (SHA-256). Bygger på siste analyse.'),
      btn('Lag revisjonsrapport…', openReportDialog, 'kvr-primary'),
      el('b', { class: 'kvr-subh', text: 'Tidligere rapporter' }), ui.repLog
    ]);

    ui.focusBody = el('div', { class: 'kvr-pane' });

    // --- Omfang for analysen
    var scChange = function () { store(K.scope, scope); ui.scALabelFrom.textContent = scope.compare.on ? 'Periode A fra' : 'Periode fra'; ui.scALabelTo.textContent = scope.compare.on ? 'Periode A til' : 'Periode til'; renderCheck(); };
    ui.scFrom = el('input', { type: 'date' }); ui.scTo = el('input', { type: 'date' });
    ui.scBFrom = el('input', { type: 'date' }); ui.scBTo = el('input', { type: 'date' });
    ui.scFrom.addEventListener('change', function () { scope.dateFrom = ui.scFrom.value; scChange(); });
    ui.scTo.addEventListener('change', function () { scope.dateTo = ui.scTo.value; scChange(); });
    ui.scBFrom.addEventListener('change', function () { scope.compare.from = ui.scBFrom.value; scChange(); });
    ui.scBTo.addEventListener('change', function () { scope.compare.to = ui.scBTo.value; scChange(); });
    ui.scStores = storeBox(function () { scope.stores = readSelect(ui.scStores); scChange(); });
    ui.scCashiers = pills(function () { scope.cashiers = readSelect(ui.scCashiers); scChange(); });
    ui.scKasser = pills(function () { scope.workstations = readSelect(ui.scKasser); scChange(); });
    var scCmp = check('Sammenlign med en annen periode (A mot B)', function () { scope.compare.on = scCmp.box.checked; ui.scB.style.display = scope.compare.on ? '' : 'none'; scChange(); });
    var scUf = check('Bruk også filtrene i listen', function () { scope.useFilters = scUf.box.checked; scChange(); });
    ui.scCompare = scCmp.box; ui.scUseFilters = scUf.box;
    ui.scALabelFrom = el('span', { text: 'Periode fra' }); ui.scALabelTo = el('span', { text: 'Periode til' });
    ui.scB = el('div', { class: 'kvr-row', style: 'display:none' }, [
      el('label', { class: 'kvr-f' }, [el('span', { text: 'Periode B fra' }), ui.scBFrom]), el('label', { class: 'kvr-f' }, [el('span', { text: 'Periode B til' }), ui.scBTo])]);
    var scPresets = el('div', { class: 'kvr-chips' });
    [['Hele listen', 'all'], ['I går', 'yesterday'], ['Siste 7 dager', 'last7'], ['Forrige uke', 'lastweek'], ['Denne måneden', 'thismonth'], ['Forrige måned', 'lastmonth']].forEach(function (q) {
      scPresets.appendChild(btn(q[0], function () {
        var r = q[1] === 'all' ? { dateFrom: '', dateTo: '' } : L.relativeRange(q[1]);
        scope.dateFrom = r.dateFrom; scope.dateTo = r.dateTo;
        ui.scFrom.value = r.dateFrom; ui.scTo.value = r.dateTo;
        scChange();
      }, 'kvr-chip'));
    });
    ui.scopeInfo = hintEl('');
    ui.scopeWarnTxt = el('span', {});
    ui.scopeWarn = el('div', { class: 'kvr-scanwarn', role: 'status', style: 'display:none' }, [ui.scopeWarnTxt, btn('Hent fra CW', fetchScopeData, 'kvr-sm')]);
    ui.scopeBrief = el('span', { class: 'kvr-scope-brief' });
    ui.scopeCard = el('details', { class: 'kvr-card kvr-scope', 'data-sec': 'scope' }, [el('summary', { class: 'kvr-scope-h' }, [el('b', { text: 'Velg omfang' }), ui.scopeBrief]), el('div', { class: 'kvr-secbody' }, [
      scPresets,
      el('div', { class: 'kvr-row' }, [el('label', { class: 'kvr-f' }, [ui.scALabelFrom, ui.scFrom]), el('label', { class: 'kvr-f' }, [ui.scALabelTo, ui.scTo])]),
      ui.scB,
      scCmp.node,
      pfield('Butikk (tom = alle)', ui.scStores), pfield('Kasserer (tom = alle)', ui.scCashiers), pfield('Kasse (tom = alle)', ui.scKasser),
      scUf.node, ui.scopeInfo, ui.scopeWarn,
      btn('Nullstill omfang', function () { scope = defaultScope(); store(K.scope, scope); writeScope(); renderCheck(); })
    ])]);
    ui.checkTop = el('div', { class: 'kvr-pane' });
    ui.checkBody = el('div', { class: 'kvr-pane' });
    ui.chartsBody = el('div', { class: 'kvr-pane' });
    var subDefs = [
      ['check', 'Sjekk først', [ui.checkTop, ui.scopeCard, ui.checkBody]],
      ['charts', 'Diagram', [ui.chartsBody]],
      ['report', 'Rapport', [secReport, secSettle]],
      ['focus', 'Fokus', [ui.focusBody]],
      ['details', 'Detaljer', [ui.ctlSumCard, ui.ctlResults, secChecks, secAnom, secCustom, secTasks, secNotes]]
    ];
    ui.subBtns = {}; ui.subPanes = {};
    var subNav = el('div', { class: 'kvr-subnav', role: 'tablist' });
    var subHost = el('div', { class: 'kvr-host' });
    function showSub(id) {
      Object.keys(ui.subPanes).forEach(function (k) {
        ui.subPanes[k].style.display = k === id ? '' : 'none';
        ui.subBtns[k].classList.toggle('kvr-active', k === id);
        ui.subBtns[k].setAttribute('aria-selected', k === id ? 'true' : 'false');
        ui.subBtns[k].tabIndex = k === id ? 0 : -1;
      });
      store(K.sub, id);
      if (id === 'charts') renderCharts();
    }
    subDefs.forEach(function (t) {
      var b = el('button', { type: 'button', class: 'kvr-sub', role: 'tab', text: t[1] });
      b.addEventListener('click', function () { showSub(t[0]); });
      ui.subBtns[t[0]] = b;
      subNav.appendChild(b);
      ui.subPanes[t[0]] = el('div', { class: 'kvr-pane', role: 'tabpanel' }, t[2]);
      subHost.appendChild(ui.subPanes[t[0]]);
    });

    var moreDefs = [['export', 'Eksport', [secAudit, secExport]], ['settings', 'Innstillinger', [ui.setBody]]];
    ui.moreBtns = {}; ui.morePanes = {};
    var moreNav = el('div', { class: 'kvr-subnav', role: 'tablist', 'aria-label': 'Mer' });
    var moreHost = el('div', { class: 'kvr-host' });
    function showMore(id) {
      Object.keys(ui.morePanes).forEach(function (k) {
        ui.morePanes[k].style.display = k === id ? '' : 'none';
        ui.moreBtns[k].classList.toggle('kvr-active', k === id);
        ui.moreBtns[k].setAttribute('aria-selected', k === id ? 'true' : 'false');
        ui.moreBtns[k].tabIndex = k === id ? 0 : -1;
      });
      store(K.sub2, id);
      if (id === 'settings') renderSettings();
    }
    moreDefs.forEach(function (t) {
      var b = el('button', { type: 'button', class: 'kvr-sub', role: 'tab', text: t[1] });
      b.addEventListener('click', function () { showMore(t[0]); });
      ui.moreBtns[t[0]] = b;
      moreNav.appendChild(b);
      ui.morePanes[t[0]] = el('div', { class: 'kvr-pane', role: 'tabpanel' }, t[2]);
      moreHost.appendChild(ui.morePanes[t[0]]);
    });
    tabKeys(moreNav);
    tabKeys(subNav);

    secChecks.classList.add('kvr-adv'); secAnom.classList.add('kvr-adv');
    var tabDefs = [
      ['cw', 'Hent', [hintEl('Henter kvitteringer fra Lindbak, høyst 1000 per søk.'), secCw, secParts, secCwxGet]],
      ['filter', 'Filtrer', [hintEl('Filtrerer kvitteringene som allerede er listet. Ingenting hentes på nytt.'), secStore, secTime, secContent, secWho, secSum, secSaved]],
      ['content', 'Skann', [el('p', { class: 'kvr-intro', text: 'Skanning leser innholdet i bongene som er synlige i listen: varer, pant, rabatt og betaling.' }), secScan, secGroups]],
      ['analyse', 'Analyse', [subNav, subHost]],
      ['more', 'Mer', [moreNav, moreHost]]
    ];
    ui.tabBtns = {}; ui.panes = {};
    var tabBar = el('div', { class: 'kvr-tabs', role: 'tablist' });
    var scroll = el('div', { class: 'kvr-scroll' });
    function showTab(id) {
      Object.keys(ui.panes).forEach(function (k) {
        ui.panes[k].style.display = k === id ? '' : 'none';
        ui.tabBtns[k].classList.toggle('kvr-active', k === id);
        ui.tabBtns[k].setAttribute('aria-selected', k === id ? 'true' : 'false');
        ui.tabBtns[k].tabIndex = k === id ? 0 : -1;
      });
      store(K.tab, id);
      scroll.scrollTop = 0;
      if (id === 'analyse') renderChartsIfVisible();
    }
    tabDefs.forEach(function (t) {
      var b = el('button', { type: 'button', class: 'kvr-tab', role: 'tab', text: t[1] });
      b.addEventListener('click', function () { showTab(t[0]); });
      ui.tabBtns[t[0]] = b;
      tabBar.appendChild(b);
      ui.panes[t[0]] = el('div', { class: 'kvr-pane', role: 'tabpanel' }, t[2]);
      scroll.appendChild(ui.panes[t[0]]);
    });
    ui.showTab = showTab;
    ui.go = function (name) {
      var map = { cw: ['cw'], filter: ['filter'], content: ['content'], check: ['analyse', 'check'], charts: ['analyse', 'charts'], report: ['analyse', 'report'], anom: ['analyse', 'details'], control: ['analyse', 'details'], details: ['analyse', 'details'], focus: ['analyse', 'focus'], export: ['more', 'export'], settings: ['more', 'settings'] };
      var m = map[name] || [name];
      showTab(m[0]);
      if (m[0] === 'more') showMore(m[1] || 'export');
      else if (m[1]) showSub(m[1]);
    };
    tabKeys(tabBar);
    ui.tabDot = el('i', { class: 'kvr-dot', style: 'display:none' });
    ui.tabBtns.filter.appendChild(ui.tabDot);

    ui.footPng = btn('PNG', function () { exportPng(selectedRecs()); }, 'kvr-primary');
    ui.footPng.title = 'Last ned valgte kvitteringer som PNG (ZIP ved flere)';
    ui.footCmp = btn('Sammenlign', compareSelected);
    ui.footCmp.style.display = 'none';
    ui.footCmp.title = 'Sammenlign de to valgte bongene side om side';
    ui.footFlag = btn('Flagg som avvik', flagSelected);
    ui.footFlag.title = 'Flagg de valgte bongene som avvik: status «Til oppfølging» og høy risiko. Er alle flagget fra før, fjernes flagget.';
    ui.footCsv = btn('CSV', function () { exportCsv(Object.keys(selected).length > 0); });
    ui.footCsv.title = 'Eksporter valgte (eller synlige hvis ingen er valgt) til CSV';
    var foot = el('div', { class: 'kvr-foot' }, [
      btn('Velg alle', function () {
        recs.forEach(function (r) { if (r.show) selected[r.item.transactionId] = r.item; });
        apply();
      }),
      ui.footClear = btn('Fjern valg', function () { selected = {}; apply(); }),
      ui.footCmp,
      ui.footFlag,
      ui.footCsv,
      ui.footPng
    ]);

    panel.appendChild(head);
    panel.appendChild(el('div', { class: 'kvr-main' }, [stats, tabBar, scroll, foot]));
    document.body.appendChild(panel);
    ui.tip = el('div', { class: 'kvr-tip', role: 'tooltip', style: 'display:none' });
    panel.appendChild(ui.tip);
    showTab(ui.panes[store(K.tab)] ? store(K.tab) : 'filter');
    showSub(ui.subPanes[store(K.sub)] ? store(K.sub) : 'check');
    showMore(ui.morePanes[store(K.sub2)] ? store(K.sub2) : 'export');
    writeScope();

    function setCollapsed(c) {
      panel.classList.toggle('kvr-collapsed', c);
      toggle.textContent = c ? '+' : '–';
      store(K.collapsed, c);
      applyModePos(panel);
      clamp(panel);
    }
    function flip() { setCollapsed(!panel.classList.contains('kvr-collapsed')); }
    toggle.addEventListener('click', flip);
    // størrelsesknappen åpner også et minimert panel, ellers ser det ut som ingenting skjer
    ui.wideBtn.addEventListener('click', function () { if (panel.classList.contains('kvr-collapsed')) setCollapsed(false); setSizeMode((sizeMode() + 1) % 3, true); });
    enableDrag(panel, head, function () { if (panel.classList.contains('kvr-collapsed')) flip(); });
    document.addEventListener('keydown', function (e) {
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); flip(); }
    });
    document.addEventListener('mouseup', function () {
      if (panel.classList.contains('kvr-collapsed') || sizeMode() > 0) return;
      if (panel.style.width || panel.style.height) { store(K.size, { width: panel.style.width, height: panel.style.height }); renderChartsIfVisible(); }
    });
    window.addEventListener('resize', function () { clamp(panel); });

    curSize = sizeMode();
    placePanel(panel);
    paintSizeMode();
    applyModePos(panel);
    if (store(K.collapsed)) setCollapsed(true);
    renderSaved();
    renderRules();
    renderCwStores();
    renderCustom();
    renderTasks();
    renderControl();
    renderNotes();
    renderReportLog();
    renderFolder();
    installKeys();
    setTimeout(ensureVisible, 300);
    window.addEventListener('load', function () { setTimeout(ensureVisible, 300); });
  }

  function attach() {
    try { attachGrid(); } catch (e) { showBootError(e); }
  }

  function attachGrid() {
    ensureVisible();
    var g = getGrid();
    if (!g) {
      // Panelet kommer med en gang på journalsidene; det kobles til listen når CW viser den
      if (/\/Journal/i.test(location.pathname) && !document.getElementById('kvr-panel')) buildPanel();
      if (ui.waitNote) ui.waitNote.style.display = 'flex';
      showWaiting();
      return;
    }
    if (ui.waitNote) ui.waitNote.style.display = 'none';
    if (g.__kvBound) {
      if (refreshStoreMap()) { optsKey = ''; renderCwStores(); }
      var tb = g.tbody && g.tbody[0];
      if (tb && !scanning && !cwRun && tb.querySelectorAll(':scope > tr').length !== tb.querySelectorAll(':scope > tr > td.kvr-cb-cell').length) apply();
      return;
    }
    grid = g;
    if (!document.getElementById('kvr-panel')) buildPanel();
    g.__kvBound = true;
    var wb = document.getElementById('kvr-boot');
    if (wb && !bootShown) wb.remove();
    installGridClicks();
    g.bind('dataBound', function () { boundCount++; if (!cwRun) setTimeout(apply, 0); });   // mens tilleggsdata hentes, viser listen CWs filtrerte søk
    apply();
    renderCwStores();
  }

  openDb().then(async function (d) {
    try {
      db = d;
      if (db) {
        mem = await readAll(db, 'kv');
        var raw = await readAll(db, 'scan');
        Object.keys(raw).forEach(function (k) { if (raw[k] && (raw[k].v >= 2 && raw[k].v <= 9)) scanMap[k] = L.splitDeleted(L.cleanPay(raw[k])); });   // «(SLETTET)»-linjer i eldre skanninger
      }
      migrateLocal();
      rules = L.sanitizeRules(store(K.rules));
      anomCfg = L.sanitizeAnom(store(K.anom));
      manualStores = store(K.stores) || '';
      campDec = L.sanitizeCamp(store(K.camp));
      customRules = L.sanitizeCustom(store(K.arules));
      notes = store(K.notes) || {};
      loadNoteLog();
      tasksCustom = Array.isArray(store(K.tasks)) ? store(K.tasks) : [];
      ctlCfg = L.sanitizeControl(store(K.ctl));
      if (!store(K.pantmig)) {
        // 3.23.0: pant gir bare reaksjon på manuell pantelapp (99) og slettet pantelapp fra maskinen (399). Eldre lagrede innstillinger legges om én gang.
        anomCfg.bigReturn = ''; anomCfg.manyLapper = ''; anomCfg.cashNoSale = false;
        ctlCfg.cashNoSaleN = ''; ctlCfg.lappReuseMin = ''; ctlCfg.voidCashOn = '';
        if (store(K.anom)) store(K.anom, anomCfg);
        if (store(K.ctl)) store(K.ctl, ctlCfg);
        store(K.pantmig, 1);
      }
      if (!store(K.campmig)) {
        // 3.29.0: kampanjevare = samme vare med rabatt hos to kasserere, én bong hver er nok. Gammel standard (3 bonger) legges om én gang.
        if (ctlCfg.campBongs === '3') { ctlCfg.campBongs = '2'; if (store(K.ctl)) store(K.ctl, ctlCfg); }
        store(K.campmig, 1);
      }
      keyNav = store(K.keynav) !== false;
      showAll = store(K.showall) === true;
      timeShift = Number(store(K.tshift)) || 0;
      weights = L.sanitizeWeights(store(K.weights));
      if (!store(K.evmig)) {
        // 3.34.0: «bong kopi» er hendelsesord. Legges til i lagret ordliste én gang.
        if (!L.wordHit('bong kopi', L.wordList(ctlCfg.evWords))) { ctlCfg.evWords = (String(ctlCfg.evWords || '').trim() ? ctlCfg.evWords + ', ' : '') + 'bong kopi'; if (store(K.ctl)) store(K.ctl, ctlCfg); }
        store(K.evmig, 1);
      }
      if (!store(K.discmig)) {
        // 3.33.0: «Rabatt uten årsak» gir ikke poeng. Lagret gammel standard (3) legges om én gang; egne verdier beholdes.
        var sw = store(K.weights);
        if (sw && sw['Rabatt uten årsak'] === 3) { weights['Rabatt uten årsak'] = 0; store(K.weights, weights); }
        store(K.discmig, 1);
      }
      scope = sanitizeScope(store(K.scope));
      cwx = sanitizeCwx(store(K.cwx));
      loadArchive();
      quickScan = store(K.quick) === true;
      folder.handle = store(K.folder);
      if (!folder.handle || typeof folder.handle.queryPermission !== 'function') folder.handle = null;
      folder.at = Number(store(K.folderAt)) || 0;
      (folder.handle ? checkFolderNewer() : Promise.resolve()).then(function () { folder.ready = true; renderFolder(); });
      setInterval(attach, 1500);
      attach();
    } catch (e) { showBootError(e); }
  });
})();
