  // ---- samlet grunnlag og «Hent og skann i deler» ---------------------------------------------
  // CW viser høyst 1000 bonger per søk og kutter de eldste. Perioden hentes derfor dag for dag; en dag med 1000 bonger deles
  // på klokkeslett (CWs fra- og til-tid). Hver del skannes mens den står i listen, og radene lagres i et samlet grunnlag
  // som analysen bruker sammen med listen. Pause mellom søkene, stopp ved første søk uten svar, og søket ditt settes tilbake.
  function archKey(day) { return K.arch + ':' + day; }
  function loadArchive() {
    var idx = store(K.arch);
    arch = { days: {} };
    if (idx && Array.isArray(idx.days)) idx.days.forEach(function (d) {
      if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d.day)) return;
      var v = store(archKey(d.day));
      var rows = v && Array.isArray(v.rows) ? v.rows.map(L.archRow).filter(Boolean) : [];
      arch.days[d.day] = { day: d.day, at: Number(d.at) || 0, done: !!d.done, cut: Number(d.cut) || 0, fv: Number(d.fv) || 1, rows: rows };
    });
    archVer++;
  }
  function archCount() { return Object.keys(arch.days).reduce(function (a, d) { return a + arch.days[d].rows.length; }, 0); }
  function saveArchiveIndex() {
    store(K.arch, { v: 1, days: Object.keys(arch.days).sort().map(function (d) { var x = arch.days[d]; return { day: d, at: x.at, done: x.done, cut: x.cut, fv: x.fv || 1, n: x.rows.length }; }) });
  }
  var ARCH_FETCH = 3;   // hentemåte: 3 = dato og klokkeslett satt slik CWs kode forventer, søket kontrollert (3.39.2)
  function addArchive(day, items) {
    var e = arch.days[day] || (arch.days[day] = { day: day, at: 0, done: false, cut: 0, fv: 1, rows: [] });
    var have = {};
    e.rows.forEach(function (r, i) { have[r.transactionId] = i; });
    items.forEach(function (it) {
      var r = L.archRow(it);
      if (!r) return;
      if (it.memberNumber !== undefined && it.memberNumber !== null && it.memberNumber !== '') archMem[r.transactionId] = it.memberNumber;
      if (have[r.transactionId] !== undefined) e.rows[have[r.transactionId]] = r; else { have[r.transactionId] = e.rows.length; e.rows.push(r); }
    });
    e.at = Date.now();
    // tak: de eldste dagene går først (aldri dagen som hentes nå)
    var days = Object.keys(arch.days).sort();
    while (archCount() > ARCH_LIMIT && days.length > 1) { var old = days.shift(); if (old === day) { days.push(old); continue; } delete arch.days[old]; store(archKey(old), null); }
    store(archKey(day), { rows: e.rows });
    saveArchiveIndex();
    archVer++;
  }
  function clearArchive() {
    Object.keys(arch.days).forEach(function (d) { store(archKey(d), null); });
    arch = { days: {} }; archMem = {}; archVer++;
    store(K.arch, null);
  }
  // Listen i CW pluss raden fra samlet grunnlag som ikke står i listen nå. Slike rader kan analyseres, men ikke skannes eller markeres.
  function allRecs() {
    var days = Object.keys(arch.days);
    if (!days.length) return recs;
    if (allCache && allCache.recs === recs && allCache.ver === archVer) return allCache.out;
    var have = {}, out = recs.slice(), prev = allCache ? allCache.arch : {}, next = {};
    recs.forEach(function (r) { have[r.item.transactionId] = true; });
    days.sort().forEach(function (d) {
      arch.days[d].rows.forEach(function (row) {
        var id = row.transactionId;
        if (have[id]) return;
        have[id] = true;
        var r = prev[id] && prev[id].row === row ? prev[id] : { row: row, item: archMem[id] !== undefined ? Object.assign({}, row, { memberNumber: archMem[id] }) : row, tr: null, show: true, base: true, arch: true };
        next[id] = r;
        out.push(r);
      });
    });
    allCache = { recs: recs, ver: archVer, out: out, arch: next };
    return out;
  }

  function sumInputs() { return { min: document.querySelector('[ng-model="vm.selectedFilters.sumMin"]'), max: document.querySelector('[ng-model="vm.selectedFilters.sumMax"]') }; }
  function timeInputs() { return { from: document.getElementById('fromTimePicker'), to: document.getElementById('toTimePicker') }; }
  function timeWidget(node) { var $ = jq(), w = $ && node ? $(node).data('kendoTimePicker') : null; return w && typeof w.value === 'function' ? w : null; }
  // Klokkeslett i CWs tidsfelt: via Kendo-widgeten når den finnes, og i feltet, som når du skriver selv.
  // Datodelen er dagens dato, som når Kendo tolker et klokkeslett du skriver; CW setter grenser på til-tiden ut fra fra-tiden,
  // og et klokkeslett med en annen dato regnes da som utenfor grensen (CW satte til-tiden lik fra-tiden). «base» velger en annen dato.
  // CW leser klokkeslettet når feltet mister fokus (ng-blur="vm.onFromTimeChange()"), men sin egen kopi av verdien oppdateres litt etter;
  // derfor sendes blur først etter en kort pause, ett felt om gangen, som når du skriver selv. Ellers søkte CW med forrige klokkeslett
  // (eller feilet på tom tid: «Cannot read properties of null (reading 'valueOf')»).
  function settleMs() { var h = window.__kvrSearch || {}; return h.settle >= 0 ? h.settle : 250; }
  // CWs kopi av verdien (k-ng-model="vm.fromTime" osv.), når den kan leses; ellers undefined. CW kjører uten Angulars debug-info,
  // så scope() og controller() gir ingenting; Kendo-widgeten har likevel scopet sitt ($angular_scope) når den er laget av Angular.
  function cwCopy(node) {
    try {
      var ex = node.getAttribute('k-ng-model') || node.getAttribute('ng-model');
      if (!ex) return undefined;
      var $ = jq(), w = $ ? ($(node).data('kendoTimePicker') || $(node).data('kendoDatePicker')) : null;
      var sc = w && w.$angular_scope;
      if (sc && typeof sc.$eval === 'function') return sc.$eval(ex);
      var ng = window.angular, el = ng && ng.element ? ng.element(node) : null;
      sc = el && typeof el.scope === 'function' ? el.scope() : null;
      if (sc && typeof sc.$eval === 'function') return sc.$eval(ex);
      var c = el && typeof el.controller === 'function' ? el.controller() : null, m = /^vm\.(\w+)$/.exec(ex);
      return c && m && m[1] in c ? c[m[1]] : undefined;
    } catch (e) { return undefined; }
  }
  function copyMin(v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getHours() * 60 + v.getMinutes();
    if (v === null || v === '') return null;
    return typeof v === 'string' ? L.mins(v.trim().slice(0, 5)) : undefined;
  }
  function copyDay(v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.getFullYear() + '-' + p2(v.getMonth() + 1) + '-' + p2(v.getDate());
    if (v === null || v === '') return '';
    var m = typeof v === 'string' ? /^(\d{4}-\d{2}-\d{2})|^(\d{2})\.(\d{2})\.(\d{4})/.exec(v.trim()) : null;
    return m ? (m[1] || m[4] + '-' + m[3] + '-' + m[2]) : undefined;
  }
  // Dato og klokkeslett settes slik CWs kode forventer. CW søker på selectedFilters.fromDate/toDate (dato + klokkeslett), som bare
  // oppdateres når et felt forlates (ng-blur: vm.onFromDateChange, onToDateChange, onFromTimeChange, onToTimeChange). Funksjonene leser
  // CWs kopier (k-ng-model) av alle fire feltene, sammenligner fra mot til og «retter» den andre siden når fra er etter til, og
  // onFromTimeChange/onToTimeChange feiler når den andre tiden er tom. Derfor settes alle verdiene først, så ventes det til CWs kopier
  // har dem (eller en fast pause når de ikke kan leses), og først da forlates feltene, ett om gangen. Da er fra aldri etter til når CW
  // sammenligner, og hver side av søket får sin dato og sitt klokkeslett. Klokkeslettene får samme dato (i dag), så CWs sammenligning
  // av hele tidspunkter blir en sammenligning av klokkeslett.
  function fieldValue(f, base) {
    if (f.kind === 't') { var d = new Date(base.getTime()); d.setHours(Math.floor(f.v / 60), f.v % 60, 0, 0); return d; }
    var p = String(f.v).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function fieldIs(f, c) { return f.kind === 't' ? copyMin(c) === f.v : copyDay(c) === f.v; }
  async function setFields(fields, reverse) {
    fields = fields.filter(function (f) { return f.node && f.v !== null && f.v !== undefined && f.v !== ''; });
    var base = new Date();
    base.setHours(0, 0, 0, 0);
    fields.forEach(function (f) {
      var w = f.kind === 't' ? timeWidget(f.node) : dateWidget(f.node);
      if (w) { w.value(fieldValue(f, base)); if (typeof w.trigger === 'function') w.trigger('change'); }
      setInputValue(f.node, f.kind === 't' ? L.hhmm(f.v) : noDate(f.v), true);
    });
    var t0 = Date.now();
    await wait(settleMs());
    while (Date.now() - t0 < 3000 && fields.some(function (f) { var c = cwCopy(f.node); return c !== undefined && !fieldIs(f, c); })) await wait(50);
    var order = reverse ? fields.slice().reverse() : fields;
    for (var i = 0; i < order.length; i++) {
      var c = cwCopy(order[i].node);
      if (c !== undefined && !fieldIs(order[i], c)) continue;   // CW har ikke fått verdien: blur ville bare få CW til å feile eller sette den tilbake
      order[i].node.dispatchEvent(new Event('blur', { bubbles: true }));
      await wait(Math.min(settleMs(), 60));
    }
    await wait(settleMs());
  }
  // Det CW faktisk søker på (vm.selectedFilters.fromDate/toDate), som «ÅÅÅÅ-MM-DD TT:MM»; null når det ikke kan leses.
  function cwFilters() {
    try {
      var $ = jq(), n = document.querySelector('#fromDatePicker'), w = $ && n ? $(n).data('kendoDatePicker') : null, sc = w && w.$angular_scope;
      var f = sc && typeof sc.$eval === 'function' ? sc.$eval('vm.selectedFilters') : null;
      if (!f || typeof f !== 'object') return null;
      var at = function (v) { var m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(String(v || '')); return m ? m[1] + ' ' + m[2] : null; };
      return { from: at(f.fromDate), to: at(f.toDate) };
    } catch (e) { return null; }
  }
  function partSay(t) { if (ui.partStatus) ui.partStatus.textContent = t; say(t); }

  // Lastesymboler som er synlige nå (utenfor panelet og utenfor radene i listen). Brukes for å se når CW begynner og slutter å laste.
  function loaders() {
    return Array.prototype.filter.call(document.querySelectorAll('.k-loading-mask, .k-loading-image, .k-loading, [class*="loading"], [class*="spinner"]'), function (n) {
      if (n.closest('#kvr-panel') || n.closest('tbody')) return false;
      var cs = window.getComputedStyle(n), r = n.getBoundingClientRect();
      return r.width >= 8 && r.height >= 8 && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0;
    });
  }
  function domRows() { var tb = grid && grid.tbody && grid.tbody[0]; return tb ? tb.querySelectorAll(':scope > tr').length : 0; }

  // Søk med CWs Oppdater-knapp. Pausen før er minst like lang som forrige søk tok, så CW aldri jobber mer enn halve tiden for oss.
  // Svaret regnes som ferdig når CW har begynt å laste (dataBound eller et nytt lastesymbol), lastesymbolet er borte,
  // og listen har stått stille en stund etterpå. En liste som er lik den før søket, eller som ikke passer med «expect»
  // (dato og klokkeslett), brukes først etter lengre stillhet. Et lastesymbol som blir stående, holder ikke søket i gang:
  // når listen er ny, passer og har stått stille i 2 s, eller symbolet har stått i 20 s, ses det bort fra det. Uten svar innen timeout: null.
  async function searchNow(pause, timeout, expect, say) {
    var b = document.querySelector('[ng-click="vm.applyFilters()"]');
    if (!b) throw new Error('Fant ikke OPPDATER-knappen i CW.');
    await wait(Math.max(pause, pause > 0 ? lastSearchMs : 0));
    var hook = window.__kvrSearch || {}, opt = function (k, d) { return hook[k] >= 0 ? hook[k] : d; };
    var poll = opt('poll', 150) || 150, quietN = opt('quiet', 600), emptyN = opt('empty', 4000), sameN = opt('same', 6000), misfitN = opt('misfit', 15000), stuckN = opt('stuck', 20000), busyOkN = opt('busyOk', 2000);
    var before = boundCount, key0 = idsKey(gridData()), t0 = Date.now(), old = loaders(), started = false, sawBusy = false, busySince = 0, last = null, since = 0;
    var state = '', said = 0, seen = [];
    var note = function (st) {
      state = st;
      if (say && Date.now() - said >= 1000) { said = Date.now(); say(st + ' (' + Math.round((Date.now() - t0) / 1000) + ' s)'); }
    };
    b.click();
    while (Date.now() - t0 < timeout) {
      await wait(poll);
      var now = Date.now(), fresh = loaders().filter(function (n) { return old.indexOf(n) === -1; }), busy = fresh.length > 0;
      fresh.forEach(function (n) { var c = String(n.className || n.tagName).slice(0, 60); if (seen.length < 3 && seen.indexOf(c) === -1) seen.push(c); });
      if (busy && !busySince) busySince = now;
      if (!busy && busySince) { sawBusy = true; busySince = 0; since = now; }   // stillheten regnes fra lastesymbolet forsvant
      if (busy && now - busySince > stuckN) { old = old.concat(loaders()); busy = false; busySince = 0; }
      if (busy || boundCount > before) started = true;
      if (!started) { note('venter på svar fra CW'); continue; }
      var data = gridData(), ids = idsKey(data), key = ids + '#' + data.length + '#' + domRows();
      if (key !== last) { last = key; since = now; note(busy ? 'CW laster' : 'listen tegnes'); continue; }
      var quiet = now - since;
      if (busy) {
        if (!(boundCount > before && data.length && ids !== key0 && quiet >= busyOkN && (!expect || expect(data)))) { note('CW laster'); continue; }
      } else {
        if (quiet < (data.length ? quietN : emptyN)) { note(data.length ? 'listen tegnes' : 'listen er tom, venter litt'); continue; }
        if (!sawBusy && ids === key0 && quiet < sameN) { note('listen er lik som før søket'); continue; }
        if (expect && quiet < misfitN && !expect(data)) { note('listen viser ikke dagen og klokkeslettet det ble søkt på'); continue; }
      }
      lastSearchMs = since - t0;
      lastSearchInfo = { wait: state, loaders: seen };
      return data;
    }
    lastSearchInfo = { wait: state, loaders: seen };
    return null;
  }
  var lastSearchInfo = { wait: '', loaders: [] };

  // Klokkeslettet slik CW har det (uten pluginens tidsforskyvning) innenfor vinduet, med ett minutts slingring.
  function inWindow(it, w) {
    var t = L.mins(L.parseDT(it.endDateTime).time);
    if (t === null) return true;
    t -= timeShift;
    return t >= w.from - 1 && t <= w.to + 1;
  }

  // Dato i CWs datofelt: via Kendo-widgeten når den finnes, og i feltet (dd.mm.åååå), som når du skriver selv.
  function dateWidget(node) { var $ = jq(), w = $ && node ? $(node).data('kendoDatePicker') : null; return w && typeof w.value === 'function' ? w : null; }
  // Dato og klokkeslett for radene slik CW viser dem (cellen i listen; ellers rådata i norsk tid), uten pluginens tidsforskyvning.
  // Rader uten lesbar tid teller ikke.
  function cwTimes(data) {
    var tb = grid && grid.tbody && grid.tbody[0], byUid = {};
    if (tb) Array.prototype.forEach.call(tb.querySelectorAll(':scope > tr[data-uid]'), function (tr) { byUid[tr.getAttribute('data-uid')] = tr; });
    return data.map(function (d) {
      var tr = d && d.uid ? byUid[d.uid] : null, c = tr && tr.querySelector('td[data-field="endDateTime"]'), shown = c ? L.parseCellDT(c.textContent) : '';
      var p = L.parseDT(shown || L.localDT(plain(d).endDateTime));
      return { date: p.date, min: L.mins(p.time) };
    }).filter(function (x) { return x.date; });
  }
  function onDay(tm, day) { return !tm.length || tm.filter(function (x) { return x.date === day; }).length >= tm.length * 0.9; }
  function fitsWin(tm, win) {
    if (win.from === L.DAY_WINDOW.from && win.to === L.DAY_WINDOW.to) return true;
    return tm.every(function (x) { return x.min === null || (x.min >= win.from - 1 && x.min <= win.to + 1); });
  }

  function p2(n) { return (n < 10 ? '0' : '') + n; }
  // Verdien i CWs dato- og tidsfelt slik widgeten har den (ÅÅÅÅ-MM-DD og minutter); tomt felt gir '' og null.
  function readDate(node) {
    if (!node) return '';
    var w = dateWidget(node), v = w ? w.value() : null, m;
    if (w) return v instanceof Date ? v.getFullYear() + '-' + p2(v.getMonth() + 1) + '-' + p2(v.getDate()) : '';
    return (m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(node.value || '')) ? m[3] + '-' + m[2] + '-' + m[1] : '';
  }
  function readTime(node) {
    if (!node) return null;
    var w = timeWidget(node), v = w ? w.value() : null;
    if (w) return v instanceof Date ? v.getHours() * 60 + v.getMinutes() : null;
    return L.mins(String(node.value || '').trim());
  }
  // Grensene CW har satt på et dato- eller tidsfelt, for feilmeldingen.
  function limits(node) {
    var $ = jq(), w = $ && node ? ($(node).data('kendoTimePicker') || $(node).data('kendoDatePicker')) : null, f = function (d) {
      return d instanceof Date ? d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) : '–';
    };
    if (!w) return '';
    try {
      var mn = typeof w.min === 'function' ? w.min() : w.options && w.options.min, mx = typeof w.max === 'function' ? w.max() : w.options && w.options.max;
      // lik min og maks er Kendos standard (ingen grense)
      if (mn instanceof Date && mx instanceof Date && mn.getHours() === mx.getHours() && mn.getMinutes() === mx.getMinutes()) return '';
      return mn instanceof Date || mx instanceof Date ? f(mn) + ' til ' + f(mx) : '';
    } catch (e) { return ''; }
  }
  function shownVal(v, time) { return v === null || v === '' ? 'tomt' : time ? L.hhmm(v) : v; }
  // Avvik mellom ønsket og faktisk klokkeslett: i feltet, og i CWs egen kopi når den kan leses.
  function timeBad(ti, from, to) {
    var bad = [];
    if (!ti.from || !ti.to) return bad;
    if (readTime(ti.from) !== from) bad.push({ f: 'Fra-tid', n: ti.from, v: shownVal(readTime(ti.from), true), t: 1 });
    if (readTime(ti.to) !== to) bad.push({ f: 'Til-tid', n: ti.to, v: shownVal(readTime(ti.to), true), t: 1 });
    [['Fra-tid i CW', ti.from, from], ['Til-tid i CW', ti.to, to]].forEach(function (x) {
      var c = cwCopy(x[1]), cm = c === undefined ? undefined : copyMin(c);
      if (cm !== undefined && cm !== x[2]) bad.push({ f: x[0], n: x[1], v: shownVal(cm, true), t: 1 });
    });
    return bad;
  }

  async function setRange(day, win, ti) {
    var fd = document.querySelector('#fromDatePicker'), td = document.querySelector('#toDatePicker');
    var fields = [{ node: fd, kind: 'd', v: day }, { node: td, kind: 'd', v: day }];
    if (ti.from && ti.to) fields.push({ node: ti.from, kind: 't', v: win.from }, { node: ti.to, kind: 't', v: win.to });
    var check = function () {
      var bad = [];
      if (fd && readDate(fd) !== day) bad.push({ f: 'Dato fra', n: fd, v: shownVal(readDate(fd)) });
      if (td && readDate(td) !== day) bad.push({ f: 'Dato til', n: td, v: shownVal(readDate(td)) });
      [['Dato fra i CW', fd], ['Dato til i CW', td]].forEach(function (x) {
        var c = x[1] ? cwCopy(x[1]) : undefined, cd = c === undefined ? undefined : copyDay(c);
        if (cd !== undefined && cd !== day) bad.push({ f: x[0], n: x[1], v: shownVal(cd) });
      });
      bad = bad.concat(timeBad(ti, win.from, win.to));
      var sf = cwFilters(), timed = ti.from && ti.to;
      if (sf) {
        var wf = day + ' ' + L.hhmm(win.from), wt = day + ' ' + L.hhmm(win.to);
        if (sf.from !== null && (timed ? sf.from !== wf : sf.from.slice(0, 10) !== day)) bad.push({ f: 'Søket i CW fra', v: sf.from, t: 1 });
        if (sf.to !== null && (timed ? sf.to !== wt : sf.to.slice(0, 10) !== day)) bad.push({ f: 'Søket i CW til', v: sf.to, t: 1 });
      }
      return bad;
    };
    var bad = [];
    for (var k = 0; k < 3; k++) { await setFields(fields, k === 1); bad = check(); if (!bad.length) return; }
    var lim = bad.map(function (b) { var l = b.n ? limits(b.n) : ''; return l ? b.f.toLowerCase() + ' ' + l : ''; }).filter(Boolean);
    throw new Error('CW godtok ikke ' + day + ' ' + L.timeText(win) + ' i søkefeltene (' + bad.map(function (b) { return b.f + ' viser ' + b.v; }).join(', ') +
      (lim.length ? '; grenser i CW: ' + lim.join(', ') : '') + '). Kjøringen ble stoppet; ingenting fra dette søket er lagret.');
  }

  // Passer ikke listen med dagen og klokkeslettet, søkes det én gang til med feltene satt på nytt (CW kan ha brukt verdiene fra forrige søk).
  async function partSearch(day, win, ti) {
    var head = 'Henter ' + day + ' (' + L.timeText(win) + ')', t0 = Date.now(), rows = null, again = 0;
    var fit = function (data) { var tm = cwTimes(data); return onDay(tm, day) && fitsWin(tm, win); };
    for (; again < 2; again++) {
      await setRange(day, win, ti);
      rows = await searchNow(bulk.pause, bulk.timeout, fit, function (t) { partSay(head + (again ? ', nytt forsøk' : '') + ': ' + t); });
      if (rows === null || fit(rows) || bulk.stop) break;
    }
    bulk.log.push({ day: day, win: L.timeText(win), n: rows ? rows.length : null, ms: Date.now() - t0, wait: lastSearchInfo.wait, loaders: lastSearchInfo.loaders.slice(), again: again > 0 });
    if (bulk.log.length > 400) bulk.log.shift();
    return rows;
  }

  function wrongDay(rows, day) {
    var seen = {};
    cwTimes(rows).forEach(function (x) { if (x.date !== day) seen[x.date] = 1; });
    return 'Listen i CW viser ' + (Object.keys(seen).sort().slice(0, 3).join(', ') || 'andre datoer') + ', ikke ' + day + ' som det ble søkt på. Datofeltet i CW ble trolig ikke satt, eller CW var ikke ferdig med å laste. Kjøringen ble stoppet; ingenting fra dette søket er lagret.';
  }

  async function fetchParts() {
    if (bulk || cwRun || scanning || !grid) return;
    var from = cw.dateFrom || (ui.cwFrom && ui.cwFrom.value), to = cw.dateTo || (ui.cwTo && ui.cwTo.value) || from;
    var days = L.dayList(from, to, ARCH_DAYS);
    if (!days.length) { partSay('Velg Dato fra og Dato til under «Søk i hele journalen» først.'); return; }
    if (cw.free) { partSay('Fjern «Vare (EAN/navn)» først: fritekstsøk brukes ikke i deler, fordi det er tungt for CWs server.'); return; }
    var q = function (sel) { return document.querySelector(sel); };
    var si = sumInputs(), ti = timeInputs(), ft = q('#freetextSearchInput'), fd = q('#fromDatePicker'), td = q('#toDatePicker');
    var tw = function (n) { var w = timeWidget(n); return { t: n ? n.value : '', w: w ? w.value() : null }; };
    var dw = function (n) { var w = dateWidget(n); return { t: n ? n.value : '', w: w ? w.value() : null }; };
    var orig = { dFrom: dw(fd), dTo: dw(td), from: fd ? fd.value : '', to: td ? td.value : '', min: si.min ? si.min.value : '', max: si.max ? si.max.value : '', free: ft ? ft.value : '', tFrom: tw(ti.from), tTo: tw(ti.to) };
    var hook = window.__kvrParts || {};
    bulk = { stop: false, pause: hook.pause >= 0 ? hook.pause : PART_PAUSE, timeout: hook.timeout || CWX_TIMEOUT, cut: hook.cut || CWX_CUT, scan: ui.partScan.box.checked, extra: ui.partExtra.box.checked, log: [] };
    var errors = [], log = [], t0 = Date.now(), nRows = 0, nScan = 0, nCut = 0, skipped = 0, parts = 0, today = todayStr();
    if (!ti.from || !ti.to) errors.push('Fant ikke CWs felt for fra- og til-tid. Dager med 1000 bonger kan ikke deles og blir kuttet.');
    ui.partBtn.disabled = true; ui.partStop.disabled = false; ui.cwxBtn.disabled = true;
    var nums = Object.keys(cw.stores).filter(function (k) { return cw.stores[k]; });
    if (nums.length) setCwStores(nums);
    if (ft) setInputValue(ft, '');
    if (si.min) setInputValue(si.min, '');   // beløp brukes ikke: hele dagen skal med
    if (si.max) setInputValue(si.max, '');
    if (cw.members) setInputValue(q('[ng-model="vm.selectedFilters.memberNumber"]'), cw.members);
    if (cw.loyal) setInputValue(q('[ng-model="vm.selectedFilters.externalLoyaltyNumber"]'), cw.loyal);
    try {
      for (var di = 0; di < days.length && !bulk.stop; di++) {
        var day = days[di];
        // dager hentet før 3.38.6 kan mangle bonger (CW søkte med forrige klokkeslett) og hentes på nytt
        if (arch.days[day] && arch.days[day].done && (arch.days[day].fv || 1) >= ARCH_FETCH && day < today) { skipped++; continue; }
        if (bulk.extra) {
          // tilleggsdata for hele dagen først (søk uten klokkeslett, så CWs filtre ett om gangen), så rask skanning vet hvilke bonger som trengs
          var whole = await partSearch(day, L.DAY_WINDOW, ti);
          if (whole === null) { errors.push('CW svarte ikke på søket for ' + day + ' før tilleggsdata. Kjøringen ble stoppet.'); break; }
          if (!onDay(cwTimes(whole), day)) { errors.push(wrongDay(whole, day)); break; }
          bulk.inExtra = true;
          await fetchCwExtra();
          bulk.inExtra = false;
          var rr = cwx && cwx.runs[0];
          if (rr && rr.errors.length) errors.push(day + ', tilleggsdata: ' + rr.errors.join(' '));
          if (bulk.stop) break;
        }
        var queue = [{ win: L.DAY_WINDOW, depth: 0 }], cutHere = 0, dayN = 0;
        while (queue.length && !bulk.stop) {
          var p = queue.shift();
          parts++;
          partSay('Henter ' + day + ' (' + L.timeText(p.win) + ')' + (days.length > 1 ? ', dag ' + (di + 1) + ' av ' + days.length : '') + '…');
          var rows = await partSearch(day, p.win, ti);
          if (rows === null) { errors.push('CW svarte ikke på søket for ' + day + ' (' + L.timeText(p.win) + ') innen ' + Math.round(bulk.timeout / 1000) + ' s. Kjøringen ble stoppet; start igjen senere, så fortsetter den der den slapp.'); bulk.stop = true; break; }
          if (!onDay(cwTimes(rows), day)) { errors.push(wrongDay(rows, day)); bulk.stop = true; break; }
          var got = collect();
          // CW har brukt tidsfeltene når alle bongene ligger i vinduet (ett minutts slingring). Ellers kuttes dagen, og det står hvorfor.
          if (p.depth > 0 && got.some(function (r) { return !inWindow(r.item, p.win); })) {
            errors.push('CW brukte ikke klokkeslett-feltene for ' + day + ' (bonger utenfor ' + L.timeText(p.win) + '). Dagen er kuttet ved 1000 bonger.');
            addArchive(day, got.map(function (r) { return r.item; }));
            queue = []; cutHere++;
            continue;
          }
          if (rows.length >= bulk.cut && ti.from && ti.to) {
            var sub = p.depth < 12 ? L.splitTime(p.win) : [];
            if (sub.length) { addArchive(day, got.map(function (r) { return r.item; })); queue = sub.map(function (w) { return { win: w, depth: p.depth + 1 }; }).concat(queue); continue; }
            cutHere++;
          } else if (rows.length >= bulk.cut) cutHere++;
          addArchive(day, got.map(function (r) { return r.item; }));
          if (bulk.scan) {
            var todo = todoFor(got);
            if (todo.length) {
              var sr = await scanList(todo);
              nScan += sr.done;
              if (sr.stopped) { errors.push('Skanningen ble stoppet fordi CW ikke svarte på flere bonger på rad. Start igjen senere, så fortsetter den der den slapp.'); bulk.stop = true; break; }
            }
            if (cancelScan && bulk.stop) break;
          }
        }
        if (bulk.stop) break;
        var e = arch.days[day];
        dayN = e ? e.rows.length : 0;
        if (e) { e.done = true; e.cut = cutHere; e.fv = ARCH_FETCH; e.at = Date.now(); saveArchiveIndex(); }
        nRows += dayN; nCut += cutHere;
        log.push(day + ': ' + plur(dayN, 'bong', 'bonger') + (cutHere ? ' (kuttet)' : ''));
      }
    } catch (ex) { errors.push(String(ex && ex.message || ex)); }
    var stopped = bulk.stop && !errors.length;
    // tilbake til søket ditt
    try {
      // dato og klokkeslett settes tilbake samme vei som under hentingen og kontrolleres; tomme klokkeslett blir 00:00 og 23:59
      var oDay = function (o) { var v = o.w; return v instanceof Date ? copyDay(v) : copyDay(o.t || '') || ''; };
      var oMin = function (o, empty) { var v = o.w; return v instanceof Date ? v.getHours() * 60 + v.getMinutes() : (L.mins(String(o.t || '').trim()) === null ? empty : L.mins(String(o.t).trim())); };
      var df = oDay(orig.dFrom), dt = oDay(orig.dTo), tf = oMin(orig.tFrom, L.DAY_WINDOW.from), tt = oMin(orig.tTo, L.DAY_WINDOW.to);
      var back3 = [{ node: fd, kind: 'd', v: df }, { node: td, kind: 'd', v: dt }];
      if (ti.from && ti.to) back3.push({ node: ti.from, kind: 't', v: tf }, { node: ti.to, kind: 't', v: tt });
      var restoreBad = function () {
        var b = timeBad(ti, tf, tt), sf = cwFilters();
        if (df && readDate(fd) !== df) b.push({ f: 'Dato fra', v: shownVal(readDate(fd)) });
        if (dt && readDate(td) !== dt) b.push({ f: 'Dato til', v: shownVal(readDate(td)) });
        if (sf && ti.from && ti.to && df && dt) {
          if (sf.from !== null && sf.from !== df + ' ' + L.hhmm(tf)) b.push({ f: 'Søket i CW fra', v: sf.from });
          if (sf.to !== null && sf.to !== dt + ' ' + L.hhmm(tt)) b.push({ f: 'Søket i CW til', v: sf.to });
        }
        return b;
      };
      var tb = [];
      for (var ri = 0; ri < 3; ri++) { await setFields(back3, ri === 1); tb = restoreBad(); if (!tb.length) break; }
      if (tb.length) errors.push('Søket ditt i CW ble ikke satt helt tilbake (' + tb.map(function (b) { return b.f + ' viser ' + b.v; }).join(', ') + '). Sjekk dato og fra- og til-tid i CW før du søker selv.');
      if (si.min) setInputValue(si.min, orig.min);
      if (si.max) setInputValue(si.max, orig.max);
      if (ft && orig.free) setInputValue(ft, orig.free);
      var back = await searchNow(bulk.pause, bulk.timeout);
      if (back === null) errors.push('CW svarte ikke da søket ditt skulle hentes tilbake. Trykk Oppdater i CW.');
    } catch (ex2) { errors.push('Tilbakestilling: ' + (ex2 && ex2.message || ex2)); }
    var searches = bulk.log.slice();
    bulk = null; cancelScan = false;
    ui.partBtn.disabled = false; ui.partStop.disabled = true; ui.cwxBtn.disabled = false;
    setProgress(0);
    archVer++;
    lastParts = { at: Date.now(), days: days.length, skipped: skipped, parts: parts, rows: nRows, scanned: nScan, cut: nCut, log: log, errors: errors, stopped: stopped, sec: Math.round((Date.now() - t0) / 1000), searches: searches };
    apply();
    renderParts();
    partSay((stopped ? 'Stoppet. ' : 'Ferdig. ') + parts + ' søk, ' + plur(nRows, 'bong', 'bonger') + ' hentet' + (nScan ? ', ' + nScan + ' skannet' : '') + (skipped ? ', ' + plur(skipped, 'dag', 'dager') + ' hentet før' : '') + '. Samlet grunnlag: ' + archCount() + ' bonger.' + (errors.length ? ' Merknader: se under.' : ''));
  }
  var lastParts = null;

  function stopParts() { if (bulk) { bulk.stop = true; cancelScan = true; partSay('Stopper etter søket eller bongen som pågår, og setter søket ditt tilbake…'); } }

  function renderParts() {
    if (!ui.partInfo) return;
    ui.partInfo.innerHTML = '';
    var days = Object.keys(arch.days).sort(), n = archCount();
    if (!days.length) ui.partInfo.appendChild(metaEl('Samlet grunnlag er tomt.'));
    else {
      var scanned = 0, cut = days.filter(function (d) { return arch.days[d].cut; });
      days.forEach(function (d) { arch.days[d].rows.forEach(function (r) { if (scanMap[r.transactionId]) scanned++; }); });
      ui.partInfo.appendChild(hintEl('Samlet grunnlag: ' + n + ' bonger fra ' + plur(days.length, 'dag', 'dager') + ' (' + days[0] + (days.length > 1 ? ' – ' + days[days.length - 1] : '') + '), ' + scanned + ' skannet. ' +
        (cut.length ? 'Kuttet ved 1000: ' + cut.join(', ') + '. ' : '') +
        (days.some(function (d) { return arch.days[d].done && (arch.days[d].fv || 1) < ARCH_FETCH; }) ? 'Dager hentet med eldre versjon kan mangle bonger og hentes på nytt neste gang. ' : '') + 'Analysen bruker det sammen med listen. Medlemsnummer for bonger som ikke står i listen, finnes bare til siden lastes på nytt.'));
    }
    if (lastParts) {
      if (lastParts.log.length) ui.partInfo.appendChild(hintEl('Sist: ' + lastParts.log.join(' · ') + ' (' + Math.round(lastParts.sec / 60) + ' min).'));
      lastParts.errors.forEach(function (e) { ui.partInfo.appendChild(el('div', { class: 'kvr-hint kvr-cwx-err', text: e })); });
      if (lastParts.searches.length) {
        var det = el('details', { class: 'kvr-hint' });
        det.appendChild(el('summary', { text: 'Søkene mot CW (' + lastParts.searches.length + ')' }));
        det.appendChild(el('div', { text: lastParts.searches.map(function (x) {
          return x.day + ' ' + x.win + ': ' + (x.n === null ? 'ikke svar' : plur(x.n, 'bong', 'bonger')) + ', ' + (x.ms / 1000).toFixed(1) + ' s' +
            (x.again ? ' (søkt to ganger)' : '') + (x.ms > 5000 && x.wait ? ' (ventet på: ' + x.wait + ')' : '') + (x.loaders && x.loaders.length ? ' [lastesymbol: ' + x.loaders.join(', ') + ']' : '');
        }).join(' · ') }));
        ui.partInfo.appendChild(det);
      }
    }
  }

