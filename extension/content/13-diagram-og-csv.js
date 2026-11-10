  // ---- diagrammer -------------------------------------------------------------------
  var NS = 'http://www.w3.org/2000/svg';
  var CH = { bar: '#00704a', barOn: '#004d33', blue: '#2a78d6', orange: '#eb6834', grid: '#e3e9e6', axis: '#9aa8a1', text: '#1b2a24', text2: '#5f6f68', empty: '#f1f4f2' };
  var RAMP = ['#d9eee4', '#a8d5c0', '#6bb394', '#2f8c66', '#00704a'];

  function sv(tag, attrs, kids) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  function tipShow(e, text) {
    var panel = document.getElementById('kvr-panel');
    if (!panel || !ui.tip) return;
    ui.tip.textContent = text;
    ui.tip.style.display = 'block';
    var pr = panel.getBoundingClientRect();
    var x = e.clientX - pr.left + 12, y = e.clientY - pr.top + 14;
    ui.tip.style.left = Math.max(4, Math.min(x, pr.width - ui.tip.offsetWidth - 6)) + 'px';
    ui.tip.style.top = Math.max(4, Math.min(y, pr.height - ui.tip.offsetHeight - 6)) + 'px';
  }

  function attachTip(node, text, onClick) {
    var hide = function () { if (ui.tip) ui.tip.style.display = 'none'; };
    node.addEventListener('mousemove', function (e) { tipShow(e, text); });
    node.addEventListener('mouseenter', function (e) { tipShow(e, text); });
    node.addEventListener('mouseleave', hide);
    node.addEventListener('blur', hide);
    node.addEventListener('focus', function () { var r = node.getBoundingClientRect(); tipShow({ clientX: r.left + r.width / 2, clientY: r.top }, text); });
    if (onClick) {
      node.addEventListener('click', onClick);
      node.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } });
    }
  }

  function fmtTick(v) { return v >= 1000 ? Math.round(v).toLocaleString('nb-NO') : String(Math.round(v * 10) / 10).replace('.', ','); }

  function topRounded(x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
  }

  function axes(svg, W, H, ml, mr, mt, mb, maxV) {
    var plotH = H - mt - mb;
    [0, 0.5, 1].forEach(function (f) {
      var y = mt + plotH - f * plotH;
      svg.appendChild(sv('line', { x1: ml, x2: W - mr, y1: y, y2: y, stroke: f === 0 ? CH.axis : CH.grid, 'stroke-width': 1 }));
      svg.appendChild(sv('text', { x: ml - 5, y: y + 3, 'text-anchor': 'end', fill: CH.text2, 'font-size': 10, text: fmtTick(maxV * f) }));
    });
  }

  function colChart(o) {
    var W = o.W, H = o.H || 140, ml = 40, mr = 6, mt = 16, mb = 20, n = o.data.length;
    var plotW = W - ml - mr, plotH = H - mt - mb;
    var maxV = L.niceMax(Math.max.apply(null, o.data.map(function (d) { return d.value; }).concat([0])));
    var svg = sv('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': o.aria, class: 'kvr-svg' });
    axes(svg, W, H, ml, mr, mt, mb, maxV);
    var slot = plotW / n, bw = Math.min(24, slot * 0.7), peak = 0;
    o.data.forEach(function (d, i) { if (d.value > o.data[peak].value) peak = i; });
    o.data.forEach(function (d, i) {
      var x = ml + i * slot + (slot - bw) / 2, h = Math.max(0, d.value) / maxV * plotH, y = mt + plotH - h;
      if (h > 0) svg.appendChild(sv('path', { d: topRounded(x, y, bw, h, 4), fill: d.on ? CH.barOn : CH.bar }));
      if (o.labelEvery && i % o.labelEvery === 0) svg.appendChild(sv('text', { x: ml + i * slot + slot / 2, y: H - 6, 'text-anchor': 'middle', fill: CH.text2, 'font-size': 10, text: d.label }));
      var hit = sv('rect', { x: ml + i * slot, y: mt, width: slot, height: plotH, fill: 'transparent', tabindex: '0', role: 'button', 'aria-label': d.tip, class: 'kvr-hit' });
      attachTip(hit, d.tip, d.click);
      svg.appendChild(hit);
    });
    if (o.data[peak] && o.data[peak].value > 0) {
      var ph = o.data[peak].value / maxV * plotH;
      svg.appendChild(sv('text', { x: ml + peak * slot + slot / 2, y: Math.max(10, mt + plotH - ph - 4), 'text-anchor': 'middle', fill: CH.text, 'font-size': 10, 'font-weight': 600, text: o.peakText ? o.peakText(o.data[peak]) : fmtTick(o.data[peak].value) }));
    }
    return svg;
  }

  function pairChart(o) {
    var W = o.W, H = o.H || 150, ml = 40, mr = 6, mt = 16, mb = 20, n = o.data.length;
    var plotW = W - ml - mr, plotH = H - mt - mb;
    var maxV = L.niceMax(Math.max.apply(null, o.data.map(function (d) { return Math.max(d.a, d.b); }).concat([0])));
    var svg = sv('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': o.aria, class: 'kvr-svg' });
    axes(svg, W, H, ml, mr, mt, mb, maxV);
    var slot = plotW / n, bw = Math.min(18, (slot * 0.8 - 2) / 2);
    o.data.forEach(function (d, i) {
      var cx = ml + i * slot + slot / 2;
      [[d.a, CH.blue, cx - bw - 1], [d.b, CH.orange, cx + 1]].forEach(function (b) {
        var h = Math.max(0, b[0]) / maxV * plotH;
        if (h > 0) svg.appendChild(sv('path', { d: topRounded(b[2], mt + plotH - h, bw, h, 4), fill: b[1] }));
      });
      svg.appendChild(sv('text', { x: cx, y: H - 6, 'text-anchor': 'middle', fill: CH.text2, 'font-size': 10, text: d.label }));
      var hit = sv('rect', { x: ml + i * slot, y: mt, width: slot, height: plotH, fill: 'transparent', tabindex: '0', role: 'button', 'aria-label': d.tip, class: 'kvr-hit' });
      attachTip(hit, d.tip, d.click);
      svg.appendChild(hit);
    });
    return svg;
  }

  function chartCard(id, title, sub, node, table) {
    var tv = tbl(table.heads, table.rows);
    tv.style.display = 'none';
    var tgl = btn('Tabell', function () {
      var on = tv.style.display === 'none';
      tv.style.display = on ? '' : 'none';
      node.style.display = on ? 'none' : '';
      tgl.textContent = on ? 'Diagram' : 'Tabell';
    }, 'kvr-sm');
    return el('div', { class: 'kvr-card', 'data-sec': id }, [el('div', { class: 'kvr-chart-h' }, [el('h4', { text: title }), tgl]), sub ? hintEl(sub) : el('span'), node, tv]);
  }

  function legend(items) {
    return el('div', { class: 'kvr-legend' }, items.map(function (i) { return el('span', {}, [el('i', { style: 'background:' + i[0] }), document.createTextNode(i[1])]); }));
  }

  function scopedItems(reset) {
    var f = Object.assign({}, filters, reset), ctx = makeCtx();
    return recs.filter(function (r) { return L.matches(r.item, f, ctx); }).map(function (r) { return r.item; });
  }

  function chartsVisible() {
    var panel = document.getElementById('kvr-panel');
    return !!(ui.panes && ui.panes.analyse && ui.panes.analyse.style.display !== 'none' && ui.subPanes && ui.subPanes.charts && ui.subPanes.charts.style.display !== 'none' && panel && !panel.classList.contains('kvr-collapsed'));
  }

  function renderChartsIfVisible() { if (chartsVisible()) renderCharts(); }

  function two(n) { return (n < 10 ? '0' : '') + n; }

  function renderCharts() {
    if (!ui.chartsBody) return;
    var body = ui.chartsBody;
    body.innerHTML = '';
    var W = Math.max(260, (body.clientWidth || 380) - 24);
    if (!recs.length) { body.appendChild(el('div', { class: 'kvr-card' }, [hintEl('Ingen kvitteringer i listen.')])); return; }
    var setTime = function (h) { filters.timeFrom = two(h) + ':00'; filters.timeTo = two(h) + ':59'; writeForm(); apply(); };
    var setDay = function (d) { filters.dateFrom = d; filters.dateTo = d; writeForm(); apply(); };

    // salg per time
    var hd = L.chartData(scopedItems({ timeFrom: '', timeTo: '' }), scanMap).hours;
    var hours = hd.count.map(function (n, h) {
      return { label: String(h), value: n, on: filters.timeFrom === two(h) + ':00' && filters.timeTo === two(h) + ':59',
        tip: two(h) + ':00–' + two(h) + ':59 · ' + n + ' salg · ' + fmt(hd.sum[h]) + ' kr', click: function () { setTime(h); } };
    });
    body.appendChild(chartCard('ch-hours', 'Salg per time', 'Antall salg. Klikk en søyle for å filtrere på timen.',
      colChart({ W: W, data: hours, labelEvery: 3, aria: 'Søylediagram: antall salg per time', peakText: function (d) { return String(d.value); } }),
      { heads: ['Time', 'Salg', 'Sum kr'], rows: hd.count.map(function (n, h) { return [two(h) + ':00', n, fmt(hd.sum[h])]; }) }));

    // salg per dag
    var dd = L.chartData(scopedItems({ dateFrom: '', dateTo: '' }), scanMap).days;
    if (dd.length >= 2) {
      var days = dd.map(function (d) {
        return { label: d.day.slice(5), value: d.sum, on: filters.dateFrom === d.day && filters.dateTo === d.day,
          tip: d.day + ' · ' + d.count + ' salg · ' + fmt(d.sum) + ' kr', click: function () { setDay(d.day); } };
      });
      body.appendChild(chartCard('ch-days', 'Salg per dag', 'Sum i kr. Klikk en søyle for å filtrere på dagen.',
        colChart({ W: W, data: days, labelEvery: Math.ceil(days.length / 6), aria: 'Søylediagram: salg per dag', peakText: function (d) { return fmtTick(d.value); } }),
        { heads: ['Dag', 'Salg', 'Sum kr'], rows: dd.map(function (d) { return [d.day, d.count, fmt(d.sum)]; }) }));
    }

    // returandel per kasserer
    var cd = L.chartData(scopedItems({ cashiers: [], workstations: [] }), scanMap);
    if (cd.cashiers.length) {
      var factor = Number(ctlCfg.profFactor) || 1.5, minN = Number(ctlCfg.profMin) || 5;
      var axisMax = L.niceMax(Math.max(cd.cashiers[0].share, cd.storeShare, 0.1));
      var list = el('div', { class: 'kvr-hbars' });
      var rowsT = [];
      cd.cashiers.slice(0, 12).forEach(function (c) {
        var flag = c.count >= minN && cd.storeShare > 0 && c.share >= cd.storeShare * factor;
        var tip = 'Kasserer ' + c.id + ' · ' + c.ret + ' av ' + c.count + ' salg er returer (' + pct(c.share) + ')' + (flag ? ' · minst ' + factor + '× snittet' : '');
        var link = entLink('kasserer', c.id, 'Kasserer ' + c.id + ' (' + c.count + ')');
        var bar = el('div', { class: 'kvr-hb-bar' + (flag ? ' kvr-flag' : ''), style: 'width:' + Math.max(c.share > 0 ? 1 : 0, c.share / axisMax * 100) + '%' });
        var track = el('div', { class: 'kvr-hb-track' }, [bar, el('div', { class: 'kvr-hb-ref', style: 'left:' + (cd.storeShare / axisMax * 100) + '%' })]);
        var val = el('span', { class: 'kvr-hb-v', text: pct(c.share) + (flag ? ' ▲' : '') });
        var row = el('div', { class: 'kvr-hb', title: tip }, [link, track, val]);
        list.appendChild(row);
        rowsT.push(['Kasserer ' + c.id, c.count, c.ret, pct(c.share) + (flag ? ' (høy)' : '')]);
      });
      body.appendChild(chartCard('ch-cash', 'Returandel per kasserer', 'Andel salg med negativ sum. Den tynne streken er butikksnittet (' + pct(cd.storeShare) + '). Oransje ▲ = minst ' + factor + '× snittet. Klikk et navn for å se alt om kassereren.',
        el('div', {}, [list, legend([[CH.bar, 'Returandel'], [CH.orange, 'Høy mot snitt']])]),
        { heads: ['Kasserer', 'Salg', 'Returer', 'Andel'], rows: rowsT }));
    }

    // kasse x time
    var hm = L.chartData(scopedItems({ workstations: [], timeFrom: '', timeTo: '' }), scanMap).heat;
    if (hm.rows.length) {
      var grid2 = el('div', { class: 'kvr-heat', style: 'grid-template-columns:62px repeat(24,1fr)' });
      grid2.appendChild(el('span'));
      for (var h = 0; h < 24; h++) grid2.appendChild(el('span', { class: 'kvr-hh', text: h % 3 === 0 ? String(h) : '' }));
      var heatT = [];
      hm.rows.forEach(function (r) {
        grid2.appendChild(entLink('kasse', r.id, 'Kasse ' + r.id));
        r.counts.forEach(function (n, hr) {
          var idx = n === 0 ? -1 : Math.min(4, Math.ceil(n / hm.max * 5) - 1);
          var cellEl = el('button', { type: 'button', class: 'kvr-hc', style: 'background:' + (idx < 0 ? CH.empty : RAMP[idx]), 'aria-label': 'Kasse ' + r.id + ' kl. ' + two(hr) + ': ' + n + ' salg' });
          attachTip(cellEl, 'Kasse ' + r.id + ' · ' + two(hr) + ':00–' + two(hr) + ':59 · ' + n + ' salg', function () { filters.workstations = [r.id]; setTime(hr); });
          grid2.appendChild(cellEl);
        });
        heatT.push(['Kasse ' + r.id].concat([r.counts.reduce(function (a, b) { return a + b; }, 0)]));
      });
      body.appendChild(chartCard('ch-heat', 'Når skjer det? Kasse × time', 'Antall salg per kasse og klokketime. Mørkere = flere. Klikk en rute for å filtrere på kassen og timen.',
        el('div', {}, [grid2, el('div', { class: 'kvr-legend' }, [document.createTextNode('Færre '), el('span', { class: 'kvr-ramp' }, RAMP.map(function (c) { return el('i', { style: 'background:' + c }); })), document.createTextNode(' flere')])]),
        { heads: ['Kasse', 'Salg'], rows: heatT }));
    }

    // pant per dag
    var pd = L.chartData(scopedItems({ dateFrom: '', dateTo: '' }), scanMap).pant;
    var pbase = recs.filter(function (r) { return r.base && r.item.receiptType === 1; });
    var pdone = pbase.filter(function (r) { return scanMap[r.item.transactionId]; }).length;
    if (pd.some(function (d) { return d.sale || d.ret; })) {
      var pdata = pd.map(function (d) { return { label: d.day.slice(5), a: d.sale, b: d.ret, tip: d.day + ' · pantesalg ' + fmt(d.sale) + ' kr · utbetalt panteretur ' + fmt(d.ret) + ' kr', click: function () { setDay(d.day); } }; });
      body.appendChild(chartCard('ch-pant', 'Pant per dag: salg mot utbetalt', 'Kun skannede kvitteringer (' + pdone + ' av ' + pbase.length + '). Klikk en dag for å filtrere.',
        el('div', {}, [legend([[CH.blue, 'Pantesalg'], [CH.orange, 'Utbetalt panteretur']]), pairChart({ W: W, data: pdata, aria: 'Søylediagram: pantesalg og utbetalt panteretur per dag' })]),
        { heads: ['Dag', 'Pantesalg', 'Utbetalt'], rows: pd.map(function (d) { return [d.day, fmt(d.sale), fmt(d.ret)]; }) }));
    }
  }

  // ---- CSV ------------------------------------------------------------------
  function exportCsv(onlySelected, listOverride) {
    var list = listOverride || recs.filter(function (r) { return onlySelected ? selected[r.item.transactionId] : r.show; });
    var rows = [['Tid', 'Butikk', 'Kasse', 'Kasserer', 'Bongnr', 'Type', 'Sum', 'Medlem', 'Pant salg', 'Pant retur', 'Varegrupper', 'Avvik', 'Betaling', 'Rabatt kr', 'Kuponger', 'Betalingsref', 'Totalt på bong']];
    list.forEach(function (r) {
      var it = r.item, sc = scanMap[it.transactionId], gs = groupsOf(it.transactionId);
      rows.push([it.endDateTime, sLabel(it.storeNumber), it.workstationNumber, it.cashierNumber, it.bongnr, L.typeLabel(it.receiptType),
        it.totalAmount === null ? '' : String(it.totalAmount).replace('.', ','), it.memberNumber === null ? '' : it.memberNumber,
        sc ? String(sc.sale).replace('.', ',') : '', sc ? String(sc.ret).replace('.', ',') : '', gs ? gs.join(', ') : '', (anomMap[it.transactionId] || []).join(', '),
        sc && sc.pay ? Object.keys(sc.pay).map(function (k) { return k + ' ' + String(sc.pay[k]).replace('.', ','); }).join('; ') : '', sc && L.hasDisc(sc) ? String(sc.disc).replace('.', ',') : '', sc && L.hasDisc(sc) ? sc.coupons.length : '',
        sc && sc.rf ? sc.rf.map(function (x) { return x.slice(2); }).join('; ') : '', sc && typeof sc.tot === 'number' ? String(sc.tot).replace('.', ',') : '']);
    });
    download(new Blob([L.toCsv(rows)], { type: 'text/csv;charset=utf-8' }), 'kvitteringer.csv');
    say((rows.length - 1) + ' rader eksportert.');
  }

