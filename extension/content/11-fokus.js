  // ---- fokus: alt om én kasserer eller kasse ---------------------------------------
  function focusInfo() {
    if (filters.cashiers.length === 1) return { kind: 'kasserer', id: filters.cashiers[0] };
    if (filters.workstations.length === 1) return { kind: 'kasse', id: filters.workstations[0] };
    return null;
  }

  function setFocus(kind, id) {
    filters.cashiers = kind === 'kasserer' ? [String(id)] : [];
    filters.workstations = kind === 'kasse' ? [String(id)] : [];
    writeForm();
    apply();
    ui.go('focus');
  }

  function entLink(kind, id, text) {
    var b = el('button', { type: 'button', class: 'kvr-ent', title: 'Se alt om ' + (kind === 'kasserer' ? 'kasserer ' : 'kasse ') + id, text: text || ((kind === 'kasserer' ? 'Kasserer ' : 'Kasse ') + id) });
    b.addEventListener('click', function (e) { e.stopPropagation(); setFocus(kind, String(id)); });
    return b;
  }

  function entsFor(item) {
    return el('div', { class: 'kvr-ents' }, [entLink('kasserer', item.cashierNumber), entLink('kasse', item.workstationNumber)]);
  }

  function colIndexes() {
    var hdr = document.querySelector('.k-grid-header table');
    var out = {};
    if (!hdr) return out;
    Array.prototype.forEach.call(hdr.querySelectorAll('thead th'), function (th, i) {
      var t = th.textContent.trim().toUpperCase();
      if (t === 'KASSERER') out.kasserer = i;
      if (t === 'KASSE') out.kasse = i;
    });
    return out;
  }

  function installGridClicks() {
    var host = (grid.element && grid.element[0]) || grid.tbody[0].closest('table');
    host.addEventListener('click', function (e) {
      if (!e.altKey) return;
      var td = e.target.closest && e.target.closest('td');
      if (!td) return;
      var rec = recs.filter(function (r) { return r.tr === td.parentNode; })[0];
      if (!rec) return;
      var f = td.getAttribute('data-field');
      var idx = Array.prototype.indexOf.call(td.parentNode.children, td);
      var ci = colIndexes();
      var kind = f === 'cashierNumber' || idx === ci.kasserer ? 'kasserer' : f === 'workstationNumber' || idx === ci.kasse ? 'kasse' : null;
      if (!kind) return;
      e.preventDefault();
      e.stopPropagation();
      setFocus(kind, String(kind === 'kasserer' ? rec.item.cashierNumber : rec.item.workstationNumber));
    }, true);
  }

  function hoursChart(hours) {
    var max = Math.max.apply(null, hours.concat([1]));
    var box = el('div', { class: 'kvr-hours' });
    hours.forEach(function (n, h) {
      box.appendChild(el('div', { class: 'kvr-hcol', title: (h < 10 ? '0' : '') + h + ':00 – ' + n + ' kvitteringer' }, [
        el('div', { class: 'kvr-hbar', style: 'height:' + Math.round(n / max * 100) + '%' }),
        el('span', { text: h % 3 === 0 ? String(h) : '' })
      ]));
    });
    return box;
  }

  function kvRows(pairs) {
    var t = el('table', { class: 'kvr-table kvr-small' });
    pairs.forEach(function (p) { t.appendChild(el('tr', {}, [cell('td', p[0]), cell('td', p[1])])); });
    return el('div', { class: 'kvr-tablewrap' }, [t]);
  }

  function renderFocus() {
    if (!ui.focusBody) return;
    var F = focusInfo();
    ui.focusBody.innerHTML = '';
    if (!F) {
      ui.focusBody.appendChild(el('div', { class: 'kvr-card' }, [el('h4', { text: 'Fokus' }),
        hintEl('Klikk på en kasserer eller kasse for å se alt som gjelder den: nøkkeltall, avvik, pant, varegrupper, betaling og aktivitet.'),
        hintEl('Velg under, eller bruk lenkene i rapporter og lister, pillene under «Filtrer», eller Alt+klikk på KASSERER eller KASSE i selve listen.')]));
      var uniq = function (f) { var o = {}; recs.forEach(function (r) { o[String(f(r.item))] = true; }); return Object.keys(o).sort(function (a, b) { return a.localeCompare(b, 'nb', { numeric: true }); }); };
      var picks = function (kind, label, list) {
        if (!list.length) return null;
        var box = el('div', { class: 'kvr-ents' }, list.slice(0, 40).map(function (id) { return entLink(kind, id); }));
        return el('div', { class: 'kvr-card' }, [el('h4', { text: label }), box]);
      };
      [picks('kasserer', 'Kasserere i listen', uniq(function (i) { return i.cashierNumber; })), picks('kasse', 'Kasser i listen', uniq(function (i) { return i.workstationNumber; }))].forEach(function (c) { if (c) ui.focusBody.appendChild(c); });
      return;
    }
    var isK = F.kind === 'kasserer';
    var title = (isK ? 'Kasserer ' : 'Kasse ') + F.id;
    var mine = recs.filter(function (r) { return String(isK ? r.item.cashierNumber : r.item.workstationNumber) === F.id; });
    var ids = {};
    mine.forEach(function (r) { ids[r.item.transactionId] = true; });
    var items = mine.map(function (r) { return r.item; });
    var st = L.focusStats(items, scanMap);
    var add = function (card) { ui.focusBody.appendChild(card); };

    // topp
    var tiles = el('div', { class: 'kvr-ftiles' });
    [['Kvitteringer', st.all], ['Salg', st.sales], ['Sum kr', fmt(st.sum)], ['Snitt kr', fmt(st.avg)], ['Returer', st.rets + ' · ' + fmt(st.retSum)], ['Tidsrom', !st.first ? '–' : st.first.slice(0, 10) === st.last.slice(0, 10) ? st.first.slice(11) + '–' + st.last.slice(11) : st.first.slice(5, 10) + '–' + st.last.slice(5, 10)]].forEach(function (x) {
      tiles.appendChild(el('div', { class: 'kvr-tile' }, [el('b', { text: String(x[1]) }), el('span', { text: x[0] })]));
    });
    var head = [tiles, el('div', { class: 'kvr-row' }, [
      btn('Velg alle (' + st.all + ')', function () { mine.forEach(function (r) { selected[r.item.transactionId] = r.item; }); apply(); }),
      btn('CSV', function () { exportCsv(false, mine); }),
      btn('Fjern fokus', function () { filters.cashiers = []; filters.workstations = []; writeForm(); apply(); })
    ])];
    if (st.scanned < st.scannable) {
      head.push(el('div', { class: 'kvr-scanwarn' }, [el('span', { text: (st.scannable - st.scanned) + ' av ' + st.scannable + ' er ikke skannet. Pant, varegrupper, betaling og avvik er ufullstendige.' }), btn('Skann nå', scanVisible, 'kvr-sm')]));
    }
    add(section('f-top', title, head));

    // brukt sammen med
    var links = el('div', { class: 'kvr-ents' });
    var other = isK ? st.kasse : st.kasserer;
    Object.keys(other).sort(function (a, b) { return other[b] - other[a]; }).forEach(function (k) {
      links.appendChild(entLink(isK ? 'kasse' : 'kasserer', k, (isK ? 'Kasse ' : 'Kasserer ') + k + ' (' + other[k] + ')'));
    });
    add(section('f-with', isK ? 'Brukte kasser' : 'Kasserere på kassen', [links]));

    // mot butikksnitt (kasserer)
    if (isK) {
      var prof = L.profiles(recs.map(function (r) { return r.item; }), scanMap, ctlCfg);
      var mineP = prof.rows.filter(function (r) { return r.id === F.id; })[0];
      if (mineP) {
        var sa = prof.store;
        add(section('f-prof', 'Mot butikksnitt', [tbl(['', 'Salg', 'Returandel', 'Snitt kr', 'Manuell pant/salg', 'Korr./salg'], [
          ['Denne kassereren', mineP.count, { t: pct(mineP.retShare), bad: mineP.flags.retShare }, { t: fmt(mineP.avg), bad: mineP.flags.avg }, mineP.scanned ? { t: mineP.lapperPer.toFixed(2), bad: mineP.flags.lapperPer } : '–', mineP.scanned ? { t: mineP.negPer.toFixed(2), bad: mineP.flags.negPer } : '–'],
          ['Butikksnitt', sa.count, pct(sa.retShare), fmt(sa.avg), sa.scanned ? sa.lapperPer.toFixed(2) : '–', sa.scanned ? sa.negPer.toFixed(2) : '–']
        ])]));
      }
    }

    // pant og betaling
    var payRows = Object.keys(st.pay).map(function (k) { return [k, fmt(st.pay[k])]; });
    add(section('f-pay', 'Pant og betaling', [
      kvRows([['Pantesalg', fmt(st.pantSale) + ' kr'], ['Panteretur', fmt(st.pantRet) + ' kr'], ['Pantelapper', String(st.lapper)], ['Korrigeringer (negative varelinjer)', String(st.neg)]].concat(payRows)),
      hintEl(st.scanned ? 'Basert på ' + st.scanned + ' skannede kvitteringer.' : 'Skann for å se pant og betaling.')
    ]));
    add(section('f-disc', 'Rabatter og kuponger', [
      st.discScanned ? kvRows([['Rabatt (kr)', fmt(st.disc)], ['Rabattlinjer', String(st.discN)], ['Uten årsak', String(st.discNR)], ['Kuponger/kampanjer', String(st.cpn)]]) : hintEl('Skann (på nytt) for å se rabatter og kuponger.'),
      hintEl(st.discScanned ? 'Basert på ' + st.discScanned + ' skannede salg med rabattdata.' : '')
    ]));

    // varegrupper
    var gs = L.groupSums(Object.keys(ids), scanMap, rules);
    add(section('f-groups', 'Varegrupper', [gs.length ? tbl(['Varegruppe', 'Linjer', 'Sum kr'], gs.map(function (g) { return [g.group, g.lines, fmt(g.sum)]; })) : hintEl('Skann for å se varegrupper.')]));

    // avvik og funn
    var flagged = mine.filter(function (r) { return anomMap[r.item.transactionId]; });
    var fl = [];
    flagged.slice(0, 30).forEach(function (r) {
      var row = el('div', { class: 'kvr-li' }, [el('b', { text: r.item.endDateTime + ' · kasse ' + r.item.workstationNumber + ' · ' + (r.item.totalAmount === null ? L.typeLabel(r.item.receiptType) : fmt(r.item.totalAmount)) }), el('span', { text: anomMap[r.item.transactionId].join(' · ') })]);
      row.addEventListener('click', function () { jumpTo(r); });
      fl.push(row);
    });
    var findings = (ctlRes ? ctlRes.findings : []).filter(function (f) { return f.ids.some(function (id) { return ids[id]; }); });
    findings.forEach(function (f) { fl.push(el('div', { class: 'kvr-li kvr-na' }, [el('b', { text: f.kind + ': ' + f.title }), el('span', { text: f.detail })])); });
    if (!fl.length) fl.push(hintEl(Object.keys(anomMap).length || ctlRes ? 'Ingen avvik eller funn for ' + title.toLowerCase() + '.' : 'Kjør avviksjekk eller kontroller (Analyse) for å se avvik.'));
    add(section('f-anom', 'Avvik og funn (' + (flagged.length + findings.length) + ')', [el('div', { class: 'kvr-list' }, fl)]));

    // kassaoppgjør
    var settles = mine.filter(function (r) { return r.item.receiptType === 2; });
    if (settles.length) {
      add(section('f-settle', 'Kassaoppgjør', [el('div', { class: 'kvr-list' }, settles.map(function (r) {
        var sc = scanMap[r.item.transactionId], sv = sc && sc.settle;
        var d = sv ? sv.diff.sum || 0 : 0;
        var row = el('div', { class: 'kvr-li ' + (!sv ? 'kvr-na' : d !== 0 ? '' : 'kvr-ok') }, [el('b', { text: r.item.endDateTime + ' · kasse ' + r.item.workstationNumber }), el('span', { text: sv ? 'Telt ' + fmt(sv.telt.sum || 0) + ' · Differanse ' + (d > 0 ? '+' : '') + fmt(d) : 'Ikke skannet' })]);
        row.addEventListener('click', function () { jumpTo(r); });
        return row;
      }))]));
    }

    // notater
    var nts = Object.keys(notes).filter(function (id) { return ids[id]; });
    if (nts.length) {
      add(section('f-notes', 'Notater (' + nts.length + ')', [el('div', { class: 'kvr-list' }, nts.map(function (id) {
        var n = notes[id], r = recById(id);
        var row = el('div', { class: 'kvr-li ' + (n.status === 'sjekket' ? 'kvr-ok' : n.status === 'oppfolging' ? '' : 'kvr-na') }, [el('b', { text: (n.tid || '') + (typeof n.sum === 'number' ? ' · ' + fmt(n.sum) + ' kr' : '') }), el('span', { text: (n.status === 'oppfolging' ? 'Til oppfølging' : n.status === 'sjekket' ? 'Sjekket' : 'Notat') + (n.note ? ': ' + n.note : '') })]);
        row.addEventListener('click', function () { if (r) jumpTo(r); });
        return row;
      }))]));
    }

    // aktivitet
    add(section('f-hours', 'Aktivitet per time', [hoursChart(st.hours), hintEl('Antall kvitteringer per klokketime.')]));
  }


