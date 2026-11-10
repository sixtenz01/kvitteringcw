  // ---- skjema ---------------------------------------------------------------
  function readForm() {
    filters.stores = readSelect(ui.stores);
    filters.workstations = readSelect(ui.workstations);
    filters.cashiers = readSelect(ui.cashiers);
    filters.types = readSelect(ui.types);
    filters.groups = readSelect(ui.groups);
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
    filters.onlyAnom = ui.onlyAnom.checked;
    filters.bong = ui.bong.value.trim();
    filters.item = ui.item.value.trim();
    filters.text = ui.text.value.trim();
    filters.pay = ui.pay.value;
    filters.pant = ui.pant.value;
    filters.disc = ui.disc.value;
    filters.discFrom = ui.discFrom.value;
    filters.discTo = ui.discTo.value;
    filters.special = ui.special.value;
    filters.cardRet = ui.cardRet.value;
    filters.note = ui.note.value;
    filters.sort = ui.sort.value;
  }

  function writeForm() {
    optsKey = '';
    ['dateFrom', 'dateTo', 'timeFrom', 'timeTo', 'sumMin', 'sumMax', 'member', 'bong', 'item', 'text', 'discFrom', 'discTo'].forEach(function (k) { ui[k].value = filters[k]; });
    syncSpecialOpts();
    syncPayOpts();
    ui.pay.value = filters.pay;
    ui.onlyNegative.checked = filters.onlyNegative;
    ui.onlyMember.checked = filters.onlyMember;
    ui.onlyDup.checked = filters.onlyDup;
    ui.onlyAnom.checked = filters.onlyAnom;
    ui.pant.value = filters.pant;
    ui.disc.value = filters.disc;
    ui.special.value = filters.special;
    ui.cardRet.value = filters.cardRet || '';
    ui.note.value = filters.note;
    ui.sort.value = filters.sort;
  }

  // Valgene under «Spesialbetaling» følger ordlisten i Innstillinger.
  var specialKey = null;
  function syncSpecialOpts() {
    var words = L.wordList(ctlCfg.specialWords), key = words.join('|');
    if (!ui.special || key === specialKey) return;
    specialKey = key;
    var cur = ui.special.value || filters.special;
    ui.special.innerHTML = '';
    ui.special.appendChild(el('option', { value: '', text: 'Alle' }));
    if (words.length) ui.special.appendChild(el('option', { value: '*', text: 'Alle ordene i listen' }));
    words.forEach(function (w) { ui.special.appendChild(el('option', { value: w, text: w.charAt(0).toUpperCase() + w.slice(1) })); });
    if (cur && cur !== '*' && words.indexOf(cur) === -1) ui.special.appendChild(el('option', { value: cur, text: cur }));
    sortSelect(ui.special);
    ui.special.value = cur;
  }

  // Valgene under «Betalingsmåte» er etikettene som finnes på de skannede bongene.
  var payKey = null;
  function syncPayOpts() {
    if (!ui.pay) return;
    var seen = {}, key = Object.keys(scanMap).length + ':' + (filters.pay || '');
    if (key === payKey) return;
    payKey = key;
    Object.keys(scanMap).forEach(function (id) { var sc = scanMap[id]; if (sc && sc.pay && !sc.settle) Object.keys(sc.pay).forEach(function (k) { seen[k] = 1; }); });
    var cur = ui.pay.value || filters.pay, labels = Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, 'nb'); }).slice(0, 40);
    ui.pay.innerHTML = '';
    ui.pay.appendChild(el('option', { value: '', text: 'Alle' }));
    labels.forEach(function (k) { ui.pay.appendChild(el('option', { value: k, text: k })); });
    if (cur && labels.indexOf(cur) === -1) ui.pay.appendChild(el('option', { value: cur, text: cur }));
    ui.pay.value = cur;
  }

  function onChange() { readForm(); apply(); }

  function needsScan() { return el('em', { class: 'kvr-needs', text: 'skanning', title: 'Krever at kvitteringene er skannet' }); }

  function field(label, node, needs) { return el('label', { class: 'kvr-f' }, [el('span', {}, [document.createTextNode(label), needs ? needsScan() : null].filter(Boolean)), node]); }

  function input(type, extra) {
    var n = el('input', Object.assign({ type: type }, extra || {}));
    n.addEventListener('input', onChange);
    n.addEventListener('change', onChange);
    return n;
  }

  function pfield(label, node, needs) { return el('div', { class: 'kvr-f' }, [el('span', {}, [document.createTextNode(label), needs ? needsScan() : null].filter(Boolean)), node]); }

  function check(label, handler) {
    var c = el('input', { type: 'checkbox' });
    c.addEventListener('change', handler || onChange);
    return { box: c, node: el('label', { class: 'kvr-c' }, [c, el('span', { text: label })]) };
  }

  function btn(text, onclick, cls) {
    return el('button', { type: 'button', class: 'kvr-btn' + (cls ? ' ' + cls : ''), text: text, onclick: onclick });
  }

  function renderSaved() {
    var list = store(K.saved) || {};
    ui.saved.innerHTML = '';
    ui.saved.appendChild(el('option', { value: '', text: '— lagrede filtre —' }));
    Object.keys(list).sort().forEach(function (k) { ui.saved.appendChild(el('option', { value: k, text: k })); });
  }

  function renderCwStores() {
    var q = cw.storeQuery.toLowerCase();
    ui.cwStores.innerHTML = '';
    if (!cwStoreList.length) {
      ui.cwStores.appendChild(el('div', { class: 'kvr-hint', text: 'Butikklisten er ikke lastet fra CW ennå…' }));
      return;
    }
    cwStoreList.filter(function (st) {
      return !q || L.storeSearch(st.number, storeMap).indexOf(q) !== -1;
    }).slice(0, 200).forEach(function (st) {
      var cb = el('input', { type: 'checkbox', value: String(st.number) });
      cb.checked = !!cw.stores[st.number];
      cb.addEventListener('change', function () {
        cw.stores[st.number] = cb.checked;
        summary();
        ui.cwCount.textContent = Object.keys(cw.stores).filter(function (k) { return cw.stores[k]; }).length + ' butikker valgt';
      });
      ui.cwStores.appendChild(el('label', { class: 'kvr-chk' }, [cb, el('span', { text: sLabel(st.number) })]));
    });
  }

  // ---- bekreftelse og innstillinger -------------------------------------------------
  function confirmBox(title, text, yesLabel, onYes) {
    var body = el('div', { class: 'kvr-secbody' }, [hintEl(text)]);
    openModal(title, body, [btn('Avbryt', closeModal), btn(yesLabel || 'Bekreft', function () { closeModal(); onYes(); }, 'kvr-primary')]);
  }

  // Gjør et kort sammenfoldbart (klikk på tittelen). Tilstanden huskes.
  var foldCards = [];
  function fold(card, id, startOpen) {
    var h = card.querySelector('h4');
    if (!h) return card;
    var saved = (store(K.sec) || {})[id];
    var set = function (open) { card.classList.toggle('kvr-folded', !open); h.setAttribute('aria-expanded', String(open)); };
    card.classList.add('kvr-fold');
    h.tabIndex = 0;
    h.setAttribute('role', 'button');
    set(saved === undefined ? startOpen : !!saved);
    var flip = function () {
      var open = card.classList.contains('kvr-folded');
      set(open);
      var m = store(K.sec) || {};
      m[id] = open;
      store(K.sec, m);
    };
    h.addEventListener('click', flip);
    h.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
    card.__set = set;
    foldCards.push({ id: id, card: card });
    return card;
  }

  function foldAll(open) {
    var m = {};
    foldCards.forEach(function (f) { f.card.__set(open); m[f.id] = open; });
    store(K.sec, m);
  }

  function openSec(id) {
    var n = document.querySelector('#kvr-panel [data-sec=' + id + ']');
    if (!n) return null;
    if (n.__set) n.__set(true);
    return n;
  }

  function legendRow(sample, text) { return el('div', { class: 'kvr-leg' }, [sample, el('span', { text: text })]); }

  function openHelp() {
    store(K.help, 1);
    if (ui.firstRun) ui.firstRun.style.display = 'none';
    var li = function (t) { return el('li', { text: t }); };
    var body = el('div', { class: 'kvr-secbody kvr-help' }, [
      el('div', { class: 'kvr-hint', text: 'Kvitteringshenter versjon ' + KvReport.VERSION }),
      el('b', { class: 'kvr-subh', text: 'Slik går du frem' }),
      el('ol', {}, [
        li('Hent: søk i hele journalen (CW) etter dato, butikk, medlem, vare eller bong.'),
        li('Filtrer: snevre inn listen. Alle valg vises som piller under tallene og fjernes med ×.'),
        li('Skann: les innholdet i kvitteringene (pant, varer, rabatt). Trengs for vare-, pant- og rabattfilter og for de fleste tester.'),
        li('Analyse → Sjekk først: velg omfang og trykk «Kjør analyse». Åpne en bong for å se hvorfor den ble flagget.'),
        li('Mer: eksport (CSV, PNG) og Innstillinger for terskler og poeng.')
      ]),
      el('b', { class: 'kvr-subh', text: 'Tegnforklaring' }),
      legendRow(el('span', { class: 'kvr-sw kvr-sw-flag', text: '' }), 'Rød kant: bongen er flagget i analysen.'),
      legendRow(el('span', { class: 'kvr-sw kvr-sw-warn' }), 'Gul stripe: noe mangler (skanning eller data). Knappen ved siden av løser det.'),
      legendRow(el('span', { class: 'kvr-sw kvr-sw-hi', text: 'Høy 8' }), 'Risikoscore er summen av poeng for avvikene. Høy fra 8, middels fra 4. RRS 0–100 er samme tall på en skala der 8 poeng = 50.'),
      legendRow(el('span', { class: 'kvr-sw kvr-sw-new', text: 'Ny' }), 'Flagget siden forrige analyse.'),
      legendRow(el('span', { class: 'kvr-sw kvr-sw-ent', text: 'Kasserer 12' }), 'Klikk for å se alt som gjelder kassereren eller kassen (Fokus).'),
      legendRow(el('span', { class: 'kvr-sw kvr-sw-bad', text: '−70,00' }), 'Rødt tall i tabell: over terskelen.'),
      legendRow(el('span', { class: 'kvr-sw kvr-sw-cov', text: 'Test' }), 'Overstrøket årsak: dekket av en høyere test på samme forhold, teller ikke i poengene.'),
      legendRow(el('span', { class: 'kvr-sw kvr-sw-new', text: 'Kampanje?' }), 'Rabatten kan være en sentral kampanje. Svar Ja eller Nei under bongen; svaret gjelder varen på alle flaggede bonger.'),
      legendRow(el('span', { class: 'kvr-sw', text: '⤢' }), 'Panelstørrelse: Vanlig, Stor (dokket til høyre) eller Full.'),
      el('b', { class: 'kvr-subh', text: 'Snarveier' }),
      el('ul', {}, [
        li('Alt+K skjuler og viser panelet. Dra i toppen for å flytte, dobbeltklikk for å nullstille plassering.'),
        li('Alt+klikk på KASSERER eller KASSE i listen åpner Fokus.'),
        li('↑ ↓ bytter bong, N notat, M velg eller fjern valg (utenfor tekstfelt).'),
        li('← → bytter fane når en fane har fokus. Esc lukker dialoger.')
      ])
    ]);
    openModal('Slik bruker du Kvitteringshenter', body, [btn('Innstillinger', function () { closeModal(); openSettings(); }), btn('Lukk', closeModal, 'kvr-primary')]);
  }

  function tabKeys(bar) {
    bar.addEventListener('keydown', function (e) {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(e.key) === -1) return;
      var tabs = Array.prototype.slice.call(bar.querySelectorAll('[role=tab]'));
      var i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      var n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      e.preventDefault();
      tabs[n].click();
      tabs[n].focus();
    });
  }

  function cfgOf(src) { return src === 'anom' ? anomCfg : ctlCfg; }
  function saveCfg(src) { store(src === 'anom' ? K.anom : K.ctl, cfgOf(src)); }
  function defOf(src) { return src === 'anom' ? L.defaultAnom() : L.defaultControl(); }

  // Terskler gjelder fra neste analyse; poeng gjelder med en gang.
  function markStale() {
    settingsStale = true;
    renderStale();
    if (checkState.at) renderCheck();
  }

  function renderStale() {
    var show = settingsStale && !!(checkState.at || ctlRes);
    if (ui.setStale) ui.setStale.style.display = show ? 'flex' : 'none';
  }

  function settingRow(f, refresh) {
    var src = f.src, def = String(defOf(src)[f.k]);
    var cur = function () { return cfgOf(src)[f.k]; };
    var isDef = function () { return String(cur()) === def; };
    var left = el('div', { class: 'kvr-set-lw' }, [el('span', { class: 'kvr-set-l', text: f.label })].concat(f.hint ? [el('span', { class: 'kvr-set-h', text: f.hint })] : []));
    var right = el('div', { class: 'kvr-set-c' });
    var row = el('div', { class: 'kvr-set-row' + (isDef() ? '' : ' kvr-changed') }, [left, right]);
    var put = function (v) { cfgOf(src)[f.k] = v; saveCfg(src); row.classList.toggle('kvr-changed', !isDef()); markStale(); refresh(); };
    if (f.kind === 'words') {
      // ordliste: hvert ord som en brikke med ×, og et felt for å legge til (komma gir flere på en gang)
      row.classList.add('kvr-set-words');
      var wrap = el('div', { class: 'kvr-words' });
      var draw = function () {
        wrap.innerHTML = '';
        var list = L.wordList(cur());
        if (!list.length) wrap.appendChild(el('span', { class: 'kvr-set-h', text: 'Tom liste: testen gir ingen treff.' }));
        list.forEach(function (w, i) {
          wrap.appendChild(el('span', { class: 'kvr-word' }, [document.createTextNode(w), el('button', { type: 'button', class: 'kvr-word-x', 'aria-label': 'Fjern ' + w, title: 'Fjern', text: '×', onclick: function () { var l = L.wordList(cur()); l.splice(i, 1); put(l.join(', ')); draw(); } })]));
        });
        var add = el('input', { type: 'text', 'aria-label': f.label + ': nytt ord', placeholder: 'nytt ord' });
        var doAdd = function () {
          var l = L.wordList(cur());
          L.wordList(add.value).forEach(function (w) { if (l.indexOf(w) === -1) l.push(w); });
          if (l.join(', ').length > L.WORDS_MAX) { add.value = ''; add.placeholder = 'listen er full'; return; }
          put(l.join(', ')); draw();
          var n = wrap.querySelector('input'); if (n) n.focus();
        };
        add.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
        wrap.appendChild(el('span', { class: 'kvr-row' }, [add, btn('Legg til', doAdd, 'kvr-sm')]));
        // kjente verdier som ikke allerede er dekket av listen, kan legges til med ett klikk
        var sug = (f.suggest || []).filter(function (w) { return !L.wordHit(w, L.wordList(cur())); });
        if (sug.length) wrap.appendChild(el('span', { class: 'kvr-words-sug' }, [el('span', { class: 'kvr-set-h', text: 'Kjente:' })].concat(sug.map(function (w) {
          return btn('+ ' + w, function () { var l = L.wordList(cur()); l.push(w.toLowerCase()); put(l.join(', ')); draw(); }, 'kvr-sm');
        }))));
      };
      draw();
      right.appendChild(wrap);
      return row;
    }
    if (f.kind === 'flag') {
      var fb = el('input', { type: 'checkbox' });
      fb.checked = src === 'anom' ? !!cur() : cur() !== '';
      fb.addEventListener('change', function () { put(src === 'anom' ? fb.checked : fb.checked ? (def || '1') : ''); });
      right.appendChild(el('label', { class: 'kvr-c kvr-set-sw' }, [fb, el('span', { text: 'På' })]));
      return row;
    }
    var inp = el('input', { type: f.kind === 'num' ? 'number' : f.kind === 'time' ? 'time' : 'text', step: 'any', 'aria-label': f.label });
    inp.value = String(cur());
    var sw = null;
    if (!f.off) right.appendChild(el('span', { class: 'kvr-set-sw kvr-set-sp' }));
    if (f.off) {
      sw = el('input', { type: 'checkbox', 'aria-label': f.label + ': på' });
      sw.checked = String(cur()) !== '';
      inp.disabled = !sw.checked;
      if (!sw.checked) inp.value = def;
      right.appendChild(el('label', { class: 'kvr-c kvr-set-sw' }, [sw, el('span', { text: 'På' })]));
      sw.addEventListener('change', function () {
        if (sw.checked) { inp.disabled = false; if (!inp.value.trim()) inp.value = def; put(inp.value.trim()); }
        else { inp.disabled = true; put(''); }
      });
    }
    inp.addEventListener('change', function () {
      var v = inp.value.trim();
      if (f.off && v === '') { sw.checked = false; inp.disabled = true; inp.value = def; put(''); return; }
      if (v === '') { inp.value = def; v = def; }
      put(v);
    });
    right.appendChild(inp);
    if (f.unit) right.appendChild(el('span', { class: 'kvr-set-u', text: f.unit }));
    return row;
  }

  function weightRow(title, refresh) {
    var inp = el('input', { type: 'number', step: '1', min: '0', 'aria-label': 'Poeng: ' + title });
    inp.value = weights[title];
    var row = el('div', { class: 'kvr-set-row' + (Number(weights[title]) === L.RISK_WEIGHTS[title] ? '' : ' kvr-changed') }, [
      el('div', { class: 'kvr-set-lw' }, [el('span', { class: 'kvr-set-l', text: title === 'Regel' ? 'Treff på egne regler' : title })]),
      el('div', { class: 'kvr-set-c' }, [inp, el('span', { class: 'kvr-set-u', text: 'poeng' })])]);
    inp.addEventListener('change', function () {
      weights[title] = hasNumber(inp.value) ? Number(inp.value) : L.RISK_WEIGHTS[title];
      inp.value = weights[title];
      store(K.weights, weights);
      row.classList.toggle('kvr-changed', Number(weights[title]) !== L.RISK_WEIGHTS[title]);
      renderCheck();
      refresh();
    });
    return row;
  }

  function resetGroup(g) {
    g.fields.forEach(function (f) { cfgOf(f.src)[f.k] = defOf(f.src)[f.k]; saveCfg(f.src); });
    g.weights.forEach(function (w) { weights[w] = L.RISK_WEIGHTS[w]; });
    store(K.weights, weights);
    if (g.fields.length) markStale();
    renderCheck();
    renderSettings(g.id);
    say('«' + g.title + '» er satt tilbake til standard.');
  }

  function settingGroup(g) {
    var badge = el('span', { class: 'kvr-set-badge' });
    var upd = function () {
      var n = L.groupChanges(g, ctlCfg, anomCfg, weights);
      badge.textContent = n + ' endret';
      badge.style.display = n ? '' : 'none';
    };
    var kids = [el('p', { class: 'kvr-set-t', text: g.text })];
    g.fields.forEach(function (f) { kids.push(settingRow(f, upd)); });
    if (g.weights.length) {
      kids.push(el('div', { class: 'kvr-set-sub', text: 'Poeng i risikoscore (høy fra 8, middels fra 4)' }));
      g.weights.forEach(function (w) { kids.push(weightRow(w, upd)); });
    }
    kids.push(btn('Standard for denne gruppen', function () { resetGroup(g); }, 'kvr-sm'));
    var d = el('details', { class: 'kvr-card kvr-set', 'data-sec': 'set-' + g.id }, [el('summary', {}, [el('b', { text: g.title }), badge]), el('div', { class: 'kvr-secbody' }, kids)]);
    upd();
    return d;
  }

  function settingsText() {
    return JSON.stringify({ app: 'kvitteringshenter', v: 1, ctl: ctlCfg, anom: anomCfg, weights: weights, customRules: customRules, groups: rules, stores: manualStores, camp: campDec, keynav: keyNav }, null, 2) + '\n';
  }

  function exportSettings() {
    download(new Blob([settingsText()], { type: 'application/json' }), FOLDER_FILE);
    say('Innstillingene er lastet ned.');
  }

  // ---- innstillinger i en mappe du velger (File System Access). Pluginen skriver bare filen FOLDER_FILE i den mappen.
  // Chrome krever et klikk for tilgang til mappen etter omstart. Er filen endret etter vår siste lagring (annen PC), skrives den ikke over før brukeren har valgt.
  var FOLDER_FILE = 'kvitteringshenter-innstillinger.json';
  var folder = { handle: null, state: '', at: 0, err: '', newer: 0, ready: false, timer: null };
  function isSettingsKey(k) { return [K.ctl, K.anom, K.weights, K.arules, K.rules, K.stores, K.camp, K.keynav].indexOf(k) !== -1; }
  function folderChanged() {
    if (!folder || !folder.ready || !folder.handle || folder.newer) return;
    clearTimeout(folder.timer);
    folder.timer = setTimeout(writeFolder, 800);
  }
  async function folderPerm(ask) {
    if (!folder.handle) return '';
    try {
      var p = await folder.handle.queryPermission({ mode: 'readwrite' });
      if (p !== 'granted' && ask) p = await folder.handle.requestPermission({ mode: 'readwrite' });
      folder.state = p;
    } catch (e) { folder.state = 'error'; folder.err = e && e.message ? e.message : String(e); }
    return folder.state;
  }
  async function readFolderFile() {
    var fh = await folder.handle.getFileHandle(FOLDER_FILE);
    var f = await fh.getFile();
    return { text: await f.text(), mod: f.lastModified || 0 };
  }
  async function writeFolder() {
    if (!folder.handle) return;
    if (await folderPerm(false) !== 'granted') { renderFolder(); return; }
    try {
      var fh = await folder.handle.getFileHandle(FOLDER_FILE, { create: true });
      var w = await fh.createWritable();
      await w.write(settingsText());
      await w.close();
      folder.at = Date.now(); folder.newer = 0; folder.err = '';
      store(K.folderAt, folder.at);
    } catch (e) { folder.err = 'Kunne ikke skrive til mappen: ' + (e && e.message ? e.message : e); }
    renderFolder();
  }
  // Ved oppstart og når tilgang gis: er filen i mappen endret etter vår siste lagring?
  async function checkFolderNewer() {
    if (await folderPerm(false) !== 'granted') return;
    try {
      var f = await readFolderFile(), last = Number(store(K.folderAt)) || 0;
      folder.newer = f.mod > last + 2000 && f.text !== settingsText() ? f.mod : 0;
    } catch (e) { folder.newer = 0; }
  }
  async function chooseFolder() {
    if (typeof window.showDirectoryPicker !== 'function') { say('Denne nettleseren kan ikke lagre i en mappe. Bruk «Eksporter innstillinger».'); return; }
    var h;
    try { h = await window.showDirectoryPicker({ id: 'kvitteringshenter', mode: 'readwrite' }); } catch (e) { return; }
    folder.handle = h; folder.err = ''; folder.newer = 0; folder.ready = true; mem[K.folder] = h;
    if (!putSafe(K.folder, h)) folder.err = 'Mappevalget huskes ikke etter omlasting; velg mappen på nytt neste gang.';
    if (await folderPerm(true) !== 'granted') { renderFolder(); return; }
    var have = null;
    try { have = await readFolderFile(); } catch (e) { have = null; }
    if (have && have.text !== settingsText()) {
      folder.newer = have.mod || Date.now();
      renderFolder();
      openModal('Mappen har innstillinger fra før', el('div', { class: 'kvr-secbody' }, [hintEl('Filen ' + FOLDER_FILE + ' i mappen «' + h.name + '» har andre innstillinger enn nettleseren. Hvilke skal gjelde?')]),
        [btn('Les inn fra mappen', function () { closeModal(); loadFromFolder(); }, 'kvr-primary'), btn('Skriv mine til mappen', function () { closeModal(); folder.newer = 0; writeFolder(); })]);
      return;
    }
    await writeFolder();
    say('Innstillingene lagres nå automatisk i mappen «' + h.name + '».');
  }
  async function grantFolder() {
    if (await folderPerm(true) !== 'granted') { renderFolder(); return; }
    await checkFolderNewer();
    if (!folder.newer) await writeFolder(); else renderFolder();
  }
  async function loadFromFolder() {
    if (await folderPerm(true) !== 'granted') { renderFolder(); return; }
    var f;
    try { f = await readFolderFile(); } catch (e) { say('Fant ikke ' + FOLDER_FILE + ' i mappen.'); return; }
    folder.newer = 0;
    importSettings(f.text);
    store(K.folderAt, Date.now());
    renderFolder();
  }
  function forgetFolder() {
    folder.handle = null; folder.state = ''; folder.err = ''; folder.newer = 0;
    delete mem[K.folder]; putSafe(K.folder, null);
    renderFolder();
    say('Mappen er glemt. Innstillingene ligger fortsatt i nettleseren.');
  }
  function renderFolder() {
    if (!ui.folderInfo) return;
    var h = folder.handle, t = function (ms) { return new Date(ms).toLocaleString('nb-NO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };
    var txt, btns = [];
    if (!h) { txt = 'Ingen mappe valgt. Innstillingene ligger bare i nettleseren på denne PC-en.'; btns = [btn('Velg mappe…', chooseFolder, 'kvr-primary')]; }
    else if (folder.state !== 'granted') {
      txt = 'Mappen «' + h.name + '» trenger tilgang på nytt (Chrome spør etter omstart). Endringer lagres ikke i mappen før du gir tilgang.';
      btns = [btn('Gi tilgang', grantFolder, 'kvr-primary'), btn('Glem mappen', forgetFolder)];
    } else if (folder.newer) {
      txt = 'Filen i mappen «' + h.name + '» er endret ' + t(folder.newer) + ', etter din siste lagring (for eksempel fra en annen PC). Den skrives ikke over før du har valgt.';
      btns = [btn('Les inn fra mappen', loadFromFolder, 'kvr-primary'), btn('Skriv mine til mappen', function () { folder.newer = 0; writeFolder(); }), btn('Glem mappen', forgetFolder)];
    } else {
      txt = 'Lagrer automatisk til mappen «' + h.name + '» (' + FOLDER_FILE + ').' + (folder.at ? ' Sist lagret ' + t(folder.at) + '.' : '');
      btns = [btn('Les inn fra mappen', loadFromFolder), btn('Bytt mappe…', chooseFolder), btn('Glem mappen', forgetFolder)];
    }
    ui.folderInfo.textContent = txt + (folder.err ? ' ' + folder.err : '');
    ui.folderBtns.innerHTML = '';
    btns.forEach(function (b) { ui.folderBtns.appendChild(b); });
  }

  function importSettings(text) {
    var d;
    try { d = JSON.parse(text); } catch (e) { d = null; }
    if (!d || d.app !== 'kvitteringshenter') { say('Ugyldig innstillingsfil.'); return; }
    ctlCfg = L.sanitizeControl(d.ctl); anomCfg = L.sanitizeAnom(d.anom); weights = L.sanitizeWeights(d.weights);
    store(K.ctl, ctlCfg); store(K.anom, anomCfg); store(K.weights, weights);
    if (Array.isArray(d.customRules)) { customRules = L.sanitizeCustom(d.customRules); saveCustom(); renderCustom(); }
    if (Array.isArray(d.groups)) { rules = L.sanitizeRules(d.groups); saveRules(); renderRules(); }
    if (typeof d.stores === 'string') { manualStores = d.stores; store(K.stores, manualStores); optsKey = ''; }
    if (d.camp) { campDec = L.sanitizeCamp(d.camp); store(K.camp, campDec); }
    keyNav = d.keynav !== false; store(K.keynav, keyNav);
    renderSettings();
    markStale();
    apply();
    say('Innstillingene er lest inn.');
  }

  function resetAllSettings() {
    ctlCfg = L.defaultControl(); anomCfg = L.defaultAnom(); weights = L.sanitizeWeights(null);
    store(K.ctl, ctlCfg); store(K.anom, anomCfg); store(K.weights, weights);
    renderSettings();
    markStale();
    renderCheck();
    say('Terskler og poeng er satt tilbake til standard.');
  }

  function renderSettings(openId) {
    if (!ui.setBody) return;
    var keep = {};
    Array.prototype.forEach.call(ui.setBody.querySelectorAll('details.kvr-set[open]'), function (d) { keep[d.getAttribute('data-sec')] = true; });
    if (openId) keep['set-' + openId] = true;
    ui.setBody.innerHTML = '';
    ui.setBody.appendChild(ui.setStale);
    renderStale();
    ui.setBody.appendChild(hintEl('Alt lagres med en gang. Terskler gjelder neste analyse, poeng gjelder med en gang. Av = testen kjøres ikke.'));
    ui.setBody.appendChild(ui.setGeneral);
    ui.keyNavBox.box.checked = keyNav;
    ui.storeNames.value = manualStores;
    L.SETTING_GROUPS.forEach(function (g) {
      var d = settingGroup(g);
      if (keep['set-' + g.id]) d.open = true;
      ui.setBody.appendChild(d);
    });
  }

  function openSettings(groupId) {
    ui.go('settings');
    var panel = document.getElementById('kvr-panel');
    if (panel && panel.classList.contains('kvr-collapsed')) panel.classList.remove('kvr-collapsed');
    if (groupId) {
      var d = ui.setBody && ui.setBody.querySelector('[data-sec=set-' + groupId + ']');
      if (d) { d.open = true; d.scrollIntoView({ block: 'start' }); }
    }
  }

