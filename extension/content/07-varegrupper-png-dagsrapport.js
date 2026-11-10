  // ---- regelsett-editor -----------------------------------------------------
  function renderRules() {
    ui.rules.innerHTML = '';
    rules.forEach(function (r, i) {
      var name = el('input', { type: 'text', value: r.name });
      var inc = el('textarea', { rows: '2', title: 'Nøkkelord (komma). Vanlig = starten av ord, *ord = inneholder, #kode = varenr/EAN (#7044* = prefiks).' });
      inc.value = r.include.join(', ');
      var exc = el('textarea', { rows: '1', title: 'Ekskluder-ord (komma). Treffer hvor som helst i navnet.' });
      exc.value = r.exclude.join(', ');
      var commit = function () {
        var oldName = r.name;
        r.name = name.value.trim() || oldName;
        r.include = inc.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
        r.exclude = exc.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
        saveRules(); apply();
      };
      [name, inc, exc].forEach(function (n) { n.addEventListener('change', commit); });
      var move = function (d) {
        var j = i + d;
        if (j < 0 || j >= rules.length) return;
        var t = rules[i]; rules[i] = rules[j]; rules[j] = t;
        saveRules(); renderRules(); apply();
      };
      ui.rules.appendChild(el('div', { class: 'kvr-rule' }, [
        el('div', { class: 'kvr-row' }, [name,
          el('button', { type: 'button', class: 'kvr-btn kvr-sm', text: '↑', onclick: function () { move(-1); } }),
          el('button', { type: 'button', class: 'kvr-btn kvr-sm', text: '↓', onclick: function () { move(1); } }),
          el('button', { type: 'button', class: 'kvr-btn kvr-sm', text: '✕', title: 'Slett gruppe', onclick: function () {
            confirmBox('Slett varegruppe', 'Slette varegruppen «' + r.name + '»?', 'Slett', function () { rules.splice(i, 1); saveRules(); renderRules(); apply(); });
          } })]),
        el('span', { class: 'kvr-hint', text: 'Inkluder' }), inc,
        el('span', { class: 'kvr-hint', text: 'Ekskluder' }), exc
      ]));
    });
  }


  // ---- PNG av hel kvittering --------------------------------------------------
  var PNG_CSS = '*{box-sizing:border-box}html,body{margin:0;background:#fff}' +
    'body{font-family:"Segoe UI",Arial,Helvetica,sans-serif;color:#111}' +
    '.kvr-page{background:#eceeed;padding:24px}' +
    '.kvr-page.a4{background:#fff;padding:56px 0;min-height:1123px}' +
    '.kvr-sheet{background:#fff;margin:0 auto;padding:22px 24px 26px;border:1px solid #d5d9d7;box-shadow:0 1px 4px rgba(0,0,0,.12)}' +
    '.kvr-page.a4 .kvr-sheet{box-shadow:none;border:1px solid #cfd4d1}' +
    'table{width:100%;border-collapse:collapse;margin:6px 0}' +
    '.ReceiptTable{background:transparent}' +
    'td,th{padding:5px 4px;font-size:13px;line-height:1.35;vertical-align:top;text-align:left;border-bottom:1px dotted #c8cdca;word-break:break-word}' +
    'th{font-size:11px;color:#555;text-transform:uppercase;letter-spacing:.03em;border-bottom:1px solid #999}' +
    'td:last-child,th:last-child,td:nth-last-child(2),th:nth-last-child(2){text-align:right;white-space:nowrap}' +
    'td:first-child,th:first-child{text-align:left;white-space:normal}' +
    '.Subtotal{font-size:17px;font-weight:700;padding:9px 4px;border-top:2px solid #111;border-bottom:2px solid #111;background:#f6f8f7}' +
    '.Report,.report{white-space:pre;font-family:Consolas,Courier,monospace;font-size:12px}' +
    'div[align="center"]{text-align:center}p{margin:6px 0}' +
    '.kvr-h{margin-bottom:12px;padding-bottom:10px;border-bottom:2px dashed #888;font-size:12px;color:#444;line-height:1.55}' +
    '.kvr-h strong{display:block;font-size:16px;color:#111;margin-bottom:2px}';

  var PNG_LAYOUTS = { bong: { w: 450, sheet: 402, scale: 3, cls: '' }, a4: { w: 794, sheet: 470, scale: 2, cls: ' a4' } };

  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function pngHeader(it, member) {
    var lines = ['Kasse ' + it.workstationNumber + ' · Kasserer ' + it.cashierNumber, 'Bongnr: ' + it.bongnr, it.endDateTime];
    if (member && it.memberNumber) lines.push('Medlem: ' + it.memberNumber);
    return '<div class="kvr-h"><strong>' + esc(sLabel(it.storeNumber)) + '</strong>' + lines.map(esc).join('<br>') + '</div>';
  }

  function htmlToPng(full, W, scale) {
    return new Promise(function (resolve, reject) {
      var f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-same-origin');
      f.style.cssText = 'position:fixed;top:-10000px;left:-10000px;width:' + W + 'px;height:2000px;border:none;visibility:hidden;';
      var fail = function (e) { f.remove(); reject(e); };
      f.onload = function () {
        setTimeout(function () {
          try {
            var b = f.contentDocument.body;
            var h = b.scrollHeight || 800;
            f.style.height = (h + 40) + 'px';
            window.html2canvas(b, { scale: scale, logging: false, allowTaint: true, useCORS: false, backgroundColor: '#ffffff', width: W, height: h, windowWidth: W, windowHeight: h })
              .then(function (c) { f.remove(); c.toBlob(function (bl) { if (bl) resolve(bl); else reject(new Error('toBlob')); }, 'image/png'); })
              .catch(fail);
          } catch (e) { fail(e); }
        }, 300);
      };
      f.srcdoc = full;
      document.body.appendChild(f);
    });
  }

  async function receiptHtml(r) {
    if (!r.tr) return null;
    var rows = await loadViaDom(r);
    var d = iframeDoc();
    return rows && d ? d.body.innerHTML : null;
  }

  // Tegner én kvittering som PNG. o: { layout, header, member }
  async function renderPngFor(rec, o) {
    var html = await receiptHtml(rec);
    if (!html) throw new Error('ingen kvittering');
    var clean = html.replace(/xmlns[^=]*="[^"]*"/g, '').replace(/<link[^>]*>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
    var lay = PNG_LAYOUTS[o.layout] || PNG_LAYOUTS.bong;
    var full = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' + PNG_CSS + '</style></head><body><div class="kvr-page' + lay.cls + '"><div class="kvr-sheet" style="width:' + lay.sheet + 'px">' +
      (o.header ? pngHeader(rec.item, o.member) : '') + clean + '</div></div></body></html>';
    return htmlToPng(full, lay.w, lay.scale);
  }

  async function exportPng(list) {
    if (scanning) return;
    if (!window.html2canvas || !window.JSZip) { say('Biblioteker (html2canvas/JSZip) er ikke lastet.'); return; }
    if (!list.length) { say('Velg kvitteringer først.'); return; }
    scanning = true; cancelScan = false;
    ui.scanBtn.disabled = true; ui.anomBtn.disabled = true; ui.stopBtn.disabled = false; ui.stopTop.style.display = ''; ui.retryBtn.disabled = true; if (ui.retryBtn2) ui.retryBtn2.disabled = true;
    var prev = grid.select();
    var prevTr = prev && prev[0];
    var files = [], failed = [], t0 = Date.now();
    for (var i = 0; i < list.length && !cancelScan; i++) {
      progress(i, list.length, t0, 'PNG', failed.length);
      try {
        var blob = await renderPngFor(list[i], { layout: ui.pngLayout.value, header: ui.pngHeaderOn.checked, member: ui.pngMember.checked });
        var it = list[i].item;
        files.push({ name: it.endDateTime.replace(/[^0-9]/g, '') + '_' + String(it.bongnr).replace(/[^A-Za-z0-9_-]/g, '-') + '.png', blob: blob });
      } catch (e) { failed.push(list[i]); }
    }
    if (prevTr) grid.select(prevTr); else if (typeof grid.clearSelection === 'function') grid.clearSelection();
    setProgress(0);
    if (files.length === 1) download(files[0].blob, files[0].name);
    else if (files.length > 1) {
      var zip = new window.JSZip();
      files.forEach(function (f) { zip.file(f.name, f.blob); });
      var zb = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      download(zb, 'kvitteringer_' + new Date().toISOString().slice(0, 10) + '.zip');
    }
    failedRecs = failed;
    lastRetry = failed.length ? function () { return exportPng(failedRecs.slice()); } : null;
    scanning = false;
    ui.scanBtn.disabled = false; ui.anomBtn.disabled = false; ui.stopBtn.disabled = true;
    syncRetry();
    say((cancelScan ? 'Stoppet. ' : 'Ferdig. ') + files.length + ' PNG' + (failed.length ? ', feilet ' + failed.length : '') + '.');
  }

  function selectedRecs() {
    return Object.keys(selected).map(function (id) { return recById(id) || { item: selected[id], tr: null }; });
  }


  // ---- dagsrapport og kassaoppgjør ----------------------------------------------
  var HEAD_TITLES = {
    'Ant': 'Antall salg', 'Retur': 'Salg med negativ sum (antall / kr)', 'Pant +': 'Pantesalg i kr (kun skannede)',
    'Pant −': 'Utbetalt panteretur i kr (kun skannede)', 'Avvik': 'Antall flaggede kvitteringer', 'Diff': 'Kassadifferanse fra kassaoppgjør',
    'Returandel': 'Andel salg med negativ sum', 'Snitt kr': 'Gjennomsnittsbeløp på salg', 'Pantelapp/salg': 'Pantelapper per skannet salg',
    'Korr./salg': 'Negative varelinjer (utenom pant) per skannet salg', 'Forventet': 'Kontant minus kontant tilbake fra skannede salg',
    'Telt': 'Telt kontant i kassaoppgjør', 'Tilbake': 'Kontant tilbake til kunder', 'Bank/kort': 'Betalt med bank eller kort',
    'Pantelapper ut': 'Utbetalte pantelapper i kr', 'Pant salg': 'Pantesalg i kr', 'Salg': 'Antall salg'
  };
  function cell(tag, v) {
    var n = el(tag, { text: String(v) });
    if (tag === 'th' && HEAD_TITLES[v]) n.title = HEAD_TITLES[v];
    return n;
  }

  function currentReport() {
    var items = recs.filter(function (r) { return r.show; }).map(function (r) { return r.item; });
    return L.report(items, scanMap, anomMap, { by: ui.repBy.value, byDay: ui.repDay.checked });
  }

  function renderReport() {
    if (!ui.repTable) return;
    var res = currentReport();
    ui.repTable.innerHTML = '';
    if (!res.rows.length) { ui.repTable.appendChild(el('div', { class: 'kvr-hint', text: 'Ingen synlige kvitteringer.' })); ui.repNote.textContent = ''; return; }
    var t = el('table', { class: 'kvr-table kvr-small' }, [el('tr', {}, ['Gruppe', 'Ant', 'Sum', 'Retur', 'Pant +', 'Pant −', 'Avvik', 'Diff'].map(function (h) { return cell('th', h); }))]);
    var line = function (r, cls) {
      t.appendChild(el('tr', cls ? { class: cls } : {}, [
        (cls ? cell('td', r.label) : el('td', {}, [entLink(ui.repBy.value, r.id, (r.day ? r.day + ' · ' : '') + r.label)])), cell('td', r.count), cell('td', fmt(r.sum)),
        cell('td', r.retCount ? r.retCount + ' / ' + fmt(r.retSum) : '–'),
        cell('td', r.scanned ? fmt(r.pantSale) : '–'), cell('td', r.scanned ? fmt(r.pantRet) : '–'),
        cell('td', r.anom || '–'), cell('td', r.settleCount ? fmt(r.settleDiff) : '–')
      ]));
    };
    line(res.total, 'kvr-tot');
    res.rows.forEach(function (r) { line(r); });
    ui.repTable.appendChild(t);
    ui.repNote.textContent = 'Pant og avvik teller bare skannede kvitteringer (' + res.total.scanned + ' av ' + res.total.count + ' salg). Diff = kassadifferanse fra skannede kassaoppgjør.';
  }

  function exportReportCsv() {
    var res = currentReport();
    var n = function (v) { return String(v).replace('.', ','); };
    var rows = [['Dag', 'Gruppe', 'Antall salg', 'Sum', 'Antall retur', 'Sum retur', 'Pant salg', 'Pant retur', 'Skannet', 'Avvik', 'Kassaoppgjør', 'Kassadifferanse']];
    [res.total].concat(res.rows).forEach(function (r) {
      rows.push([r.day, r.label, r.count, n(r.sum), r.retCount, n(r.retSum), n(r.pantSale), n(r.pantRet), r.scanned, r.anom, r.settleCount, n(r.settleDiff)]);
    });
    download(new Blob([L.toCsv(rows)], { type: 'text/csv;charset=utf-8' }), 'dagsrapport.csv');
    say('Rapport eksportert (' + (rows.length - 1) + ' rader).');
  }

  function renderSettle() {
    if (!ui.settleList) return;
    ui.settleList.innerHTML = '';
    var list = recs.filter(function (r) { return r.show && r.item.receiptType === 2; });
    if (!list.length) {
      ui.settleNote.textContent = '';
      ui.settleList.appendChild(el('div', { class: 'kvr-hint', text: 'Ingen kassaoppgjør blant synlige kvitteringer. Velg «2 – Kassaoppgjør» under Filter → Type.' }));
      return;
    }
    var thr = hasNumber(anomCfg.settleDiff) ? Number(anomCfg.settleDiff) : 1;
    var unscanned = list.filter(function (r) { return !scanMap[r.item.transactionId]; }).length;
    ui.settleNote.textContent = list.length + ' kassaoppgjør' + (unscanned ? ' · ' + unscanned + ' ikke skannet (bruk Skann innhold)' : '') + '.';
    list.forEach(function (r) {
      var it = r.item, st = scanMap[it.transactionId] && scanMap[it.transactionId].settle;
      var diff = st ? st.diff.sum || 0 : 0;
      var cls = !st ? ' kvr-na' : (diff !== 0 && Math.abs(diff) >= thr ? '' : ' kvr-ok');
      var row = el('div', { class: 'kvr-li' + cls, title: st ? 'Kontant ' + fmt(st.telt.kontant || 0) + ' · Sjekk ' + fmt(st.telt.sjekk || 0) + ' · Kreditt ' + fmt(st.telt.kreditt || 0) : '' }, [
        el('b', { text: it.endDateTime + ' · kasse ' + it.workstationNumber + ' · kasserer ' + it.cashierNumber }),
        el('span', { text: st ? 'Telt ' + fmt(st.telt.sum || 0) + ' · Differanse ' + (diff > 0 ? '+' : '') + fmt(diff) + ' · Pose ' + (st.pose || '–') + ' · Sendt bank ' + fmt(st.bank || 0) : 'Ikke skannet' })
      ]);
      row.appendChild(entsFor(it));
      row.addEventListener('click', function () { jumpTo(r); });
      ui.settleList.appendChild(row);
    });
  }

  function hasNumber(v) { return v !== '' && v !== null && v !== undefined && !isNaN(Number(v)); }

  // ---- egne avviksregler ---------------------------------------------------------
  function saveCustom() { store(K.arules, customRules); }

  function uniqueRuleName(base, except) {
    var name = base, n = 2;
    while (customRules.some(function (r) { return r !== except && r.name === name; })) name = base + ' ' + n++;
    return name;
  }

  function renderCustom() {
    ui.crules.innerHTML = '';
    if (!customRules.length) ui.crules.appendChild(el('div', { class: 'kvr-hint', text: 'Ingen egne regler ennå. Trykk «Ny regel» eller «Eksempel».' }));
    customRules.forEach(function (r, ri) {
      var en = el('input', { type: 'checkbox', title: 'Aktiv', style: 'flex:0 0 auto' });
      en.checked = r.enabled !== false;
      en.addEventListener('change', function () { r.enabled = en.checked; saveCustom(); });
      var nm = el('input', { type: 'text', value: r.name, placeholder: 'Navn på regel' });
      nm.addEventListener('change', function () { r.name = uniqueRuleName(nm.value.trim() || r.name, r); nm.value = r.name; saveCustom(); });
      var del = btn('✕', function () {
        confirmBox('Slett regel', 'Slette regelen «' + r.name + '»?', 'Slett', function () { customRules.splice(ri, 1); saveCustom(); renderCustom(); });
      }, 'kvr-sm');
      var box = el('div', { class: 'kvr-rule' }, [el('div', { class: 'kvr-row' }, [en, nm, del])]);
      r.conds.forEach(function (c, ci) {
        var fs = el('select', {}, Object.keys(L.RULE_FIELDS).map(function (k) { return el('option', { value: k, text: L.RULE_FIELDS[k].label + (L.RULE_FIELDS[k].scan ? ' *' : '') }); }));
        fs.value = c.f;
        var os = el('select', {}, L.RULE_OPS.map(function (o) { return el('option', { value: o, text: o }); }));
        os.value = c.op;
        var vi = el('input', { type: 'text', value: c.v, placeholder: 'verdi' });
        [fs, os, vi].forEach(function (n) { n.addEventListener('change', function () { c.f = fs.value; c.op = os.value; c.v = vi.value; saveCustom(); }); });
        box.appendChild(el('div', { class: 'kvr-cond' }, [fs, os, vi, btn('✕', function () { r.conds.splice(ci, 1); saveCustom(); renderCustom(); }, 'kvr-sm')]));
      });
      box.appendChild(btn('+ Vilkår', function () { r.conds.push({ f: 'sum', op: '>=', v: '' }); saveCustom(); renderCustom(); }, 'kvr-sm'));
      ui.crules.appendChild(box);
    });
  }


