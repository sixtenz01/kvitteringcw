(function (root) {
  'use strict';

  var L = typeof module !== 'undefined' && module.exports ? require('./logic.js') : root.KvLogic;
  var VERSION = '3.11.1';

  // ---- SHA-256 (ren JS, så rapporten ikke avhenger av crypto.subtle) -------------------
  var K256 = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var s = unescape(encodeURIComponent(str)), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  function sha256Bytes(data) {
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var len = data.length, hi = Math.floor(len / 0x20000000), lo = (len << 3) >>> 0;
    var padLen = ((len + 9 + 63) >> 6) << 6;
    var buf = new Uint8Array(padLen);
    buf.set(data);
    buf[len] = 0x80;
    buf[padLen - 8] = hi >>> 24; buf[padLen - 7] = (hi >>> 16) & 255; buf[padLen - 6] = (hi >>> 8) & 255; buf[padLen - 5] = hi & 255;
    buf[padLen - 4] = lo >>> 24; buf[padLen - 3] = (lo >>> 16) & 255; buf[padLen - 2] = (lo >>> 8) & 255; buf[padLen - 1] = lo & 255;
    var w = new Uint32Array(64), i;
    for (var off = 0; off < padLen; off += 64) {
      for (i = 0; i < 16; i++) w[i] = (buf[off + 4 * i] << 24) | (buf[off + 4 * i + 1] << 16) | (buf[off + 4 * i + 2] << 8) | buf[off + 4 * i + 3];
      for (i = 16; i < 64; i++) {
        var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) | 0;
        var t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  }

  function sha256(x) { return sha256Bytes(typeof x === 'string' ? utf8(x) : x); }

  // ---- stabil serialisering -------------------------------------------------------------
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }

  function esc(t) { return String(t === null || t === undefined ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function byId(a, b) { return a.transactionId < b.transactionId ? -1 : a.transactionId > b.transactionId ? 1 : 0; }

  function fmtNum(n) {
    if (typeof n !== 'number' || isNaN(n)) return '';
    var p = Math.abs(n).toFixed(2).split('.');
    return (n < 0 ? '−' : '') + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + p[1];
  }

  function pctText(x) { return Math.round(x * 100) + ' %'; }

  // ---- datafiler (kontrollsummene regnes over nøyaktig disse filene) -------------------
  function receiptsCsv(pop, inScope) {
    var rows = [['Bong-ID', 'Bongnr', 'Tidspunkt', 'Butikk', 'Kasse', 'Kasserer', 'Type', 'Sum', 'Medlem', 'I omfang']];
    pop.slice().sort(byId).forEach(function (it) {
      rows.push([it.transactionId, it.bongnr || '', it.endDateTime, it.storeNumber, it.workstationNumber, it.cashierNumber, L.typeLabel(it.receiptType),
        typeof it.totalAmount === 'number' ? String(it.totalAmount).replace('.', ',') : '', it.memberNumber ? 'ja' : 'nei', inScope[it.transactionId] ? 'ja' : 'nei']);
    });
    return L.toCsv(rows);
  }

  function contentJson(pop, scan) {
    var ids = pop.slice().sort(byId).map(function (it) { return it.transactionId; }).filter(function (id) { return scan[id]; });
    var lines = ids.map(function (id) {
      var e = {};
      Object.keys(scan[id]).forEach(function (k) { if (k !== 't') e[k] = scan[id][k]; });
      return '  ' + JSON.stringify(id) + ': ' + stable(e);
    });
    return '{\n' + lines.join(',\n') + '\n}\n';
  }

  // ---- innstillinger som tabell ---------------------------------------------------------
  function settingsTable(ctl, anom, weights) {
    var dc = L.defaultControl(), da = L.defaultAnom();
    return L.SETTING_GROUPS.map(function (g) {
      var rows = g.fields.map(function (f) {
        var cur = (f.src === 'anom' ? anom : ctl)[f.k], def = (f.src === 'anom' ? da : dc)[f.k];
        var off = f.kind === 'flag' ? !(f.src === 'anom' ? cur : cur !== '') : (f.off && String(cur) === '');
        return { label: f.label, value: off ? 'av' : f.kind === 'flag' ? 'på' : String(cur) + (f.unit && f.kind !== 'time' ? ' ' + f.unit : ''), off: off, changed: String(cur) !== String(def) };
      });
      var ws = g.weights.map(function (w) { var v = Number((weights || {})[w]); return { title: w === 'Regel' ? 'Treff på egne regler' : w, value: v, changed: v !== L.RISK_WEIGHTS[w] }; });
      var changed = rows.filter(function (r) { return r.changed; }).length + ws.filter(function (r) { return r.changed; }).length;
      return { id: g.id, title: g.title, text: g.text, rows: rows, weights: ws, changed: changed };
    });
  }

  // ---- dekning og begrensninger ---------------------------------------------------------
  function coverageOf(m) {
    var sales = m.items.filter(function (it) { return it.receiptType === 1 && typeof it.totalAmount === 'number'; });
    var settle = m.items.filter(function (it) { return it.receiptType === 2; });
    var has = function (it) { return !!m.scan[it.transactionId]; };
    return {
      sales: sales.length, salesScanned: sales.filter(has).length,
      salesDisc: sales.filter(function (it) { return L.hasDisc(m.scan[it.transactionId]); }).length,
      salesV4: sales.filter(function (it) { return L.hasV4(m.scan[it.transactionId]); }).length,
      salesV5: sales.filter(function (it) { return L.hasV5(m.scan[it.transactionId]); }).length,
      settle: settle.length, settleScanned: settle.filter(has).length,
      other: m.items.length - sales.length - settle.length
    };
  }

  function limitations(m, cov) {
    var out = [], pc = function (a, b) { return b ? pctText(a / b) : '–'; };
    out.push('Skannet innhold: ' + cov.salesScanned + ' av ' + cov.sales + ' salg (' + pc(cov.salesScanned, cov.sales) + '). Tester som leser bonginnholdet (pant, retur uten salg, rabatt) dekker bare de skannede.');
    if (cov.settle) out.push('Kassaoppgjør lest: ' + cov.settleScanned + ' av ' + cov.settle + '. Kassadifferanse over tid bygger bare på de leste.');
    var fr = m.checks && m.checks.falseRet;
    if (fr && fr.coverage !== null && fr.coverage !== undefined && fr.lineCheck === false) out.push('«Retur uten salg» ble ikke vurdert: bare ' + pctText(fr.coverage) + ' av salgene i datagrunnlaget er skannet (minst 80 % kreves).');
    if (cov.sales && cov.salesDisc < cov.sales) out.push('Rabattanalysen dekker ' + cov.salesDisc + ' av ' + cov.sales + ' salg (eldre skanninger mangler rabattdata).');
    if (cov.sales && cov.salesV4 < cov.sales) out.push('Pris per vare, kjøpeutbytte og hendelsesord dekker ' + cov.salesV4 + ' av ' + cov.sales + ' salg (eldre skanninger mangler enhetspris, kjøpeutbytte og hendelsesord).');
    if (cov.sales && cov.salesV5 < cov.sales) out.push('Bongregnskap (Totalt, MVA, betalingsreferanse) dekker ' + cov.salesV5 + ' av ' + cov.sales + ' salg (eldre skanninger mangler disse feltene).');
    var lg = m.checks && m.checks.ledger;
    if (lg) [['lines', 'Linjer mot Totalt'], ['pay', 'Betaling mot Totalt'], ['vat', 'MVA-tabell']].forEach(function (x) {
      if (lg[x[0]] && !lg[x[0]].applicable && cov.salesV5) out.push(x[1] + ' ble ikke vurdert: ' + lg[x[0]].n + ' bonger lest, ' + (lg[x[0]].n ? pctText(lg[x[0]].ok / lg[x[0]].n) : '–') + ' stemte (minst 10 bonger og 80 % kreves for at avvik regnes som funn).');
    });
    out.push('Medlemsnummertestene bruker alle innlastede bonger i valgte butikker. Mange bruk av ett nummer kan være en trofast kunde; resultatet avhenger av hvor lang periode som er lastet.');
    out.push('Annullert, manuell pris, parkert bong og spør pris er ikke observert i ekte data. «Hendelsesord» leter etter slike ord på tekstlinjer, men det er ikke bekreftet at CW viser dem på bongen. Kjøpeutbytte-tabellen er heller ikke bekreftet; testene kalibrerer seg mot det som finnes.');
    if (m.checks && m.checks.skippedGaps) out.push(m.checks.skippedGaps + ' store hull i bongnummer er ikke tolket som slettede bonger (over grensen for maks hull).');
    out.push('«Hull i bongnummer» forutsetter at listen ikke er filtrert på type, kasse eller tid, og at kvitteringstypene deler nummerserie per kasse (ikke bekreftet i ekte data).');
    var nb = m.checks && m.checks.numbers;
    if (nb && nb.overall && nb.overall.enough === false) out.push('Benford: bare ' + nb.overall.n + ' bonger i omfanget, for få til en sikker konklusjon.');
    out.push('Klokkeslett er som vist i CW-listen (lokal tid)' + (m.timeShift ? ', flyttet ' + (m.timeShift > 0 ? '+' : '') + m.timeShift + ' min etter innstillingen «Tidsforskyvning for listen»' : '') + '. Bongens topptekst kan vise starttid mens listen har sluttid.');
    if (m.failedScans) out.push(m.failedScans + ' kvitteringer kunne ikke skannes og er ikke med i innholdstestene.');
    if (m.scope.coverageText) out.push('Omfanget går utenfor det som er hentet fra CW (' + m.scope.coverageText + ').');
    if (m.settings.currentDiffers) out.push('Innstillingene er endret etter analysen. Rapporten viser verdiene som ble brukt i analysen.');
    var ev = m.evidence;
    if (ev && ev.cappedFrom > ev.requested) out.push('Bevis-PNG er begrenset til de ' + ev.requested + ' høyest rangerte av ' + ev.cappedFrom + ' flaggede bonger.');
    if (ev && ev.missing && ev.missing.length) out.push('Bevis-PNG mangler for ' + ev.missing.length + ' bonger (ikke i listen, eller tegningen feilet).');
    return out;
  }

  // ---- HTML -------------------------------------------------------------------------------
  var CSS = 'body{font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1b2a24;margin:0;background:#f4f7f5}' +
    '.page{max-width:980px;margin:0 auto;background:#fff;padding:28px 36px 40px}' +
    'h1{font-size:24px;margin:0 0 4px;color:#00704a}h2{font-size:16px;margin:26px 0 8px;padding-bottom:4px;border-bottom:2px solid #00704a;color:#00704a}h3{font-size:13px;margin:14px 0 4px}' +
    'table{border-collapse:collapse;width:100%;margin:6px 0 10px}th,td{border:1px solid #dde5e1;padding:4px 7px;text-align:left;vertical-align:top;font-size:12px}th{background:#f0faf5;color:#35493f}' +
    'td.n,th.n{text-align:right;white-space:nowrap}.meta td:first-child{width:200px;color:#5f6f68}.hint{color:#5f6f68;font-size:12px}' +
    '.badge{display:inline-block;padding:1px 8px;border-radius:999px;font-weight:650;font-size:11px;white-space:nowrap}.flag td:nth-child(-n+3){white-space:nowrap}.cfg div{padding:1px 0}.cfg .chg{margin:1px 0;padding:1px 4px;border-radius:3px}.hi{background:#fde7e5;color:#a1170c}.mid{background:#fff3cd;color:#664d03}.lo{background:#e9f3ee;color:#00704a}' +
    '.chg{background:#fff8e1}.off{color:#8a9a93}.hash{font-family:Consolas,Menlo,monospace;font-size:11px;word-break:break-all}' +
    '.warn{background:#fff8e1;border:1px solid #f0c75e;border-radius:6px;padding:6px 10px;margin:4px 0}.ev{display:inline-block;margin:6px 10px 6px 0;vertical-align:top;width:230px}' +
    '.ev img{width:230px;border:1px solid #cfd4d1}.ev div{font-size:11px;color:#5f6f68}ul{margin:4px 0 8px;padding-left:20px}' +
    '@media print{body{background:#fff}.page{padding:0;max-width:none}h2{break-after:avoid}tr,.ev{break-inside:avoid}}';

  function levelOf(score) { return L.riskLevel(score); }
  function levelCls(score) { return { 'høy': 'hi', middels: 'mid', lav: 'lo' }[levelOf(score)]; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function renderHtml(m, h, cov, lim, settingsTbl) {
    var itemOf = {};
    unionOf(m.pop, m.items).forEach(function (it) { itemOf[it.transactionId] = it; });
    var bong = function (id) { var it = itemOf[id]; return it ? (it.bongnr || id) : id; };
    var out = [];
    var P = function (s) { out.push(s); };
    var table = function (heads, rows, cls) {
      return '<table' + (cls ? ' class="' + cls + '"' : '') + '><tr>' + heads.map(function (x) { return '<th' + (x.n ? ' class="n"' : '') + '>' + esc(x.t === undefined ? x : x.t) + '</th>'; }).join('') + '</tr>' +
        rows.map(function (r) { return '<tr' + (r.cls ? ' class="' + r.cls + '"' : '') + '>' + r.cells.map(function (c, i) { var o = c !== null && typeof c === 'object' ? c : { t: c }; return '<td' + (o.n || (heads[i] && heads[i].n) ? ' class="n"' : '') + '>' + (o.html !== undefined ? o.html : esc(o.t)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>';
    };
    var ranked = m.ranked, high = ranked.filter(function (r) { return levelOf(r.score) === 'høy'; }).length, mid = ranked.filter(function (r) { return levelOf(r.score) === 'middels'; }).length;

    P('<!DOCTYPE html><html lang="nb"><head><meta charset="UTF-8"><title>Revisjonsrapport – Kvitteringsjournal</title><style>' + CSS + '</style></head><body><div class="page">');
    var times0 = m.items.map(function (it) { return it.endDateTime; }).filter(Boolean).sort();
    P('<h1>Revisjonsrapport – Kvitteringsjournal</h1>');
    P('<div class="hint">Generert av Kvitteringshenter ' + esc(m.version) + '</div>');
    P(table(['', ''], [
      { cells: ['Referanse / saksnr', m.reference || '–'] }, { cells: ['Utarbeidet av', m.author || '–'] },
      { cells: ['Rapport generert', (m.generatedLocal ? m.generatedLocal + ' (lokal tid) · ' : '') + m.generatedAt] },
      { cells: ['Analyse kjørt', (m.analysedLocal ? m.analysedLocal + ' (lokal tid) · ' : '') + m.analysedAt] },
      { cells: ['Omfang', m.scope.text + (times0.length ? ' · ' + times0[0].slice(0, 10) + ' → ' + times0[times0.length - 1].slice(0, 10) : '')] }
    ], 'meta').replace('<tr><th></th><th></th></tr>', ''));

    P('<h2>1. Sammendrag</h2>');
    P('<p>' + m.items.length + ' kvitteringer i omfanget. ' + m.findings.length + ' funn, ' + ranked.length + ' flaggede kvitteringer (' + high + ' høy risiko, ' + mid + ' middels, ' + (ranked.length - high - mid) + ' lav).</p>');
    var perTest = {};
    m.findings.forEach(function (f) { var k = f.kind + ': ' + f.title; perTest[k] = (perTest[k] || 0) + 1; });
    if (Object.keys(perTest).length) P(table(['Test', { t: 'Funn', n: true }], Object.keys(perTest).sort().map(function (k) { return { cells: [k, { t: perTest[k], n: true }] }; })));
    if (m.cashiers.length) P('<h3>Kasserere å se nærmere på</h3>' + table(['Kasserer', { t: 'Poeng', n: true }, { t: 'Flaggede bonger', n: true }, 'Merknad'], m.cashiers.map(function (c) { return { cells: ['Kasserer ' + c.id, { t: c.score, n: true }, { t: c.flagged, n: true }, (c.profile || []).join(', ')] }; })));

    P('<h2>2. Omfang og datagrunnlag</h2>');
    var types = {};
    m.items.forEach(function (it) { var k = L.typeLabel(it.receiptType); types[k] = (types[k] || 0) + 1; });
    var times = m.items.map(function (it) { return it.endDateTime; }).sort();
    var uniq = function (f) { var o = {}; m.items.forEach(function (it) { o[String(f(it))] = true; }); return Object.keys(o).sort(function (a, b) { return a.localeCompare(b, 'nb', { numeric: true }); }); };
    P(table(['', ''], [
      { cells: ['Omfang', m.scope.text] },
      { cells: ['Modus', m.scope.mode === 'visible' ? 'Synlige kvitteringer i listen (filtre: ' + (m.scope.filters.length ? m.scope.filters.join('; ') : 'ingen') + ')' : 'Valgt omfang (periode, butikk, kasserer, kasse)'] },
      { cells: ['Kvitteringer i omfanget', m.items.length + ' (' + Object.keys(types).map(function (k) { return k + ' ' + types[k]; }).join(', ') + ')'] },
      { cells: ['Datagrunnlag for tester på tvers av bonger', m.pop.length + ' kvitteringer (alle innlastede i valgte butikker)'] },
      { cells: ['Tidsrom i omfanget', times.length ? times[0] + ' → ' + times[times.length - 1] : '–'] },
      { cells: ['Butikker', uniq(function (it) { return it.storeNumber; }).map(function (s) { return m.storeLabels[s] || s; }).join(', ')] },
      { cells: ['Kasserere', uniq(function (it) { return it.cashierNumber; }).join(', ')] },
      { cells: ['Kasser', uniq(function (it) { return it.workstationNumber; }).join(', ')] }
    ], 'meta').replace('<tr><th></th><th></th></tr>', ''));

    P('<h2>3. Dekningsgrad og begrensninger</h2>');
    P(table(['Datagrunnlag', { t: 'Dekket', n: true }, { t: 'Totalt', n: true }, { t: 'Andel', n: true }], [
      { cells: ['Salg med skannet innhold', { t: cov.salesScanned, n: true }, { t: cov.sales, n: true }, { t: cov.sales ? pctText(cov.salesScanned / cov.sales) : '–', n: true }] },
      { cells: ['Salg med rabattdata', { t: cov.salesDisc, n: true }, { t: cov.sales, n: true }, { t: cov.sales ? pctText(cov.salesDisc / cov.sales) : '–', n: true }] },
      { cells: ['Salg med Totalt, MVA og betalingsreferanse (ny skanning)', { t: cov.salesV5, n: true }, { t: cov.sales, n: true }, { t: cov.sales ? pctText(cov.salesV5 / cov.sales) : '–', n: true }] },
      { cells: ['Salg med enhetspris og kjøpeutbytte (ny skanning)', { t: cov.salesV4, n: true }, { t: cov.sales, n: true }, { t: cov.sales ? pctText(cov.salesV4 / cov.sales) : '–', n: true }] },
      { cells: ['Kassaoppgjør lest', { t: cov.settleScanned, n: true }, { t: cov.settle, n: true }, { t: cov.settle ? pctText(cov.settleScanned / cov.settle) : '–', n: true }] }
    ]));
    P('<ul>' + lim.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>');

    P('<h2>4. Metode: tester, terskler og poeng</h2>');
    P('<p class="hint">Verdiene er de som gjaldt da analysen ble kjørt. Gule rader er endret fra standard. «av» betyr at testen ikke ble kjørt. Samme verdier ligger i innstillinger.json og kan leses inn under Mer → Innstillinger → Importer.</p>');
    var cfgLine = function (label, value, changed, off) { return '<div' + (changed ? ' class="chg"' : '') + '>' + esc(label) + ': <b>' + (off ? '<span class="off">av</span>' : esc(value)) + '</b></div>'; };
    P(table(['Test', 'Terskler', 'Poeng'], settingsTbl.map(function (g) {
      return { cells: [
        { html: '<b>' + esc(g.title) + '</b>' + (g.changed ? '<div class="hint">' + g.changed + ' endret</div>' : '') },
        { html: g.rows.length ? g.rows.map(function (r) { return cfgLine(r.label, r.value, r.changed, r.off); }).join('') : '<span class="off">–</span>' },
        { html: g.weights.length ? g.weights.map(function (w) { return cfgLine(w.title, String(w.value), w.changed, false); }).join('') : '<span class="off">–</span>' }
      ] };
    }), 'cfg'));
    P('<p class="hint">Risikonivå: høy fra 8 poeng, middels fra 4. Risikoscore er summen av poeng for avvikene på en kvittering.</p>');

    P('<h2>5. Funn</h2>');
    if (!m.findings.length) P('<p>Ingen funn med gjeldende terskler.</p>');
    else {
      var grouped = {};
      m.findings.forEach(function (f) { (grouped[f.kind + ': ' + f.title] = grouped[f.kind + ': ' + f.title] || []).push(f); });
      Object.keys(grouped).sort().forEach(function (k) {
        P('<h3>' + esc(k) + ' (' + grouped[k].length + ')</h3>' + table(['Detalj', 'Bonger'], grouped[k].map(function (f) {
          return { cells: [f.detail + (f.flag ? '' : ' (kassererfunn, gir poeng på kassereren)'), f.ids.map(bong).slice(0, 12).join(', ') + (f.ids.length > 12 ? ' … (+' + (f.ids.length - 12) + ')' : '')] };
        })));
      });
    }

    if (m.compare && m.compare.length) {
      P('<h2>Periode A mot B</h2><p class="hint">A: ' + esc(m.scope.compare.a) + ' · B: ' + esc(m.scope.compare.b) + '</p>' +
        table(['Enhet', { t: 'Salg A', n: true }, { t: 'Salg B', n: true }, 'Returandel', 'Snitt kr', 'Risikoscore', 'Endring'], m.compare.map(function (r) { return { cells: [r.label, { t: r.nA, n: true }, { t: r.nB, n: true }, r.ret, r.avg, r.score, r.flags] }; })));
    }

    P('<h2>6. Flaggede kvitteringer (rangert)</h2>');
    if (!ranked.length) P('<p>Ingen flaggede kvitteringer.</p>');
    else {
      P(table(['Risiko', 'Bongnr', 'Tidspunkt', 'Kasse', 'Kasserer', { t: 'Sum', n: true }, 'Avvik og forklaring', 'Status / notat', 'Bevis'], ranked.map(function (r) {
        var it = itemOf[r.id] || {}, n = m.notes[r.id], ev = m.evidence.byId[r.id];
        return { cells: [
          { html: '<span class="badge ' + levelCls(r.score) + '">' + esc(cap(levelOf(r.score))) + ' ' + r.score + '</span>', },
          it.bongnr || r.id, it.endDateTime || '', it.workstationNumber, it.cashierNumber, { t: typeof it.totalAmount === 'number' ? fmtNum(it.totalAmount) : '–', n: true },
          { html: '<ul>' + (m.explain[r.id] || r.reasons).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' },
          n ? (n.status === 'sjekket' ? 'Sjekket' : n.status === 'oppfolging' ? 'Til oppfølging' : '') + (n.note ? ': ' + n.note : '') : '',
          ev ? { html: '<a href="' + esc(ev.path) + '">' + esc(ev.path.replace('bevis/', '')) + '</a>' } : '–'
        ] };
      }), 'flag'));
    }

    P('<h2>7. Bevis (bong-PNG)</h2>');
    var evs = m.evidence.files;
    if (!evs.length) P('<p>Ingen bevis-PNG er tatt med.</p>');
    else {
      P('<p class="hint">Bildene er tegnet fra kvitteringsteksten i Lindbak ved eksport. Kontrollsum (SHA-256) står under hvert bilde og i KONTROLLSUM.txt.</p>');
      evs.forEach(function (e) { P('<div class="ev"><a href="' + esc(e.path) + '"><img src="' + esc(e.path) + '" alt="' + esc(e.path) + '"></a><div>' + esc(bong(e.id)) + '<br><span class="hash">' + esc(e.hash) + '</span></div></div>'); });
    }

    P('<h2>8. Kontrollsummer og verifisering</h2>');
    P(table(['Fil', 'SHA-256'], [
      { cells: ['data/kvitteringer.csv (alle kvitteringer i datagrunnlaget, sortert på bong-ID)', { html: '<span class="hash">' + h.receipts + '</span>' }] },
      { cells: ['data/innhold.json (skannet bonginnhold, sortert på bong-ID)', { html: '<span class="hash">' + h.content + '</span>' }] },
      { cells: ['innstillinger.json (terskler og poeng)', { html: '<span class="hash">' + h.settings + '</span>' }] },
      { cells: ['data/funn.csv', { html: '<span class="hash">' + h.findings + '</span>' }] },
      { cells: ['data/flaggede_bonger.csv', { html: '<span class="hash">' + h.flagged + '</span>' }] }
    ]));
    P('<p><b>Slik verifiserer du:</b> pakk ut ZIP-filen og kjør <span class="hash">sha256sum -c KONTROLLSUM.txt</span> (Windows: <span class="hash">certutil -hashfile fil SHA256</span>). Alle filer skal gi OK. Kontrollsummen for selve ZIP-filen vises i panelet ved eksport og kan noteres i saken.</p>');
    P('<p><b>Slik gjentar du analysen:</b> les inn innstillinger.json (Mer → Innstillinger → Importer), hent samme omfang i CW, skann og kjør analysen. Samme data gir samme kvitteringer.csv og samme funn.</p>');
    P('<h2>9. Forbehold</h2><ul><li>Funn er indikasjoner som må vurderes og forklares, ikke bevis for misligheter.</li><li>Kontrollsummene viser at innholdet i denne eksporten ikke er endret etter at den ble laget. De sier ikke at dataene i Lindbak er riktige.</li><li>Rapporten inneholder kasserernumre og bildet av kvitteringer. Medlemsnummer er ikke med i bevisbildene eller i datafilene (bare om kvitteringen hadde medlem).</li><li>Kvitteringsdata er lest ut fra visningen i Lindbak Chain Web; endringer i Lindbaks oppsett kan påvirke tolkningen.</li></ul>');
    P('</div></body></html>');
    return out.join('\n');
  }

  // ---- hele pakken ---------------------------------------------------------------------------
  function unionOf(a, b) {
    var seen = {}, out = [];
    a.concat(b).forEach(function (it) { if (!seen[it.transactionId]) { seen[it.transactionId] = true; out.push(it); } });
    return out;
  }

  function build(m) {
    var inScope = {};
    m.items.forEach(function (it) { inScope[it.transactionId] = true; });
    var all = unionOf(m.pop, m.items), itemOf = {};
    all.forEach(function (it) { itemOf[it.transactionId] = it; });
    var bongOf = function (id) { return itemOf[id] ? (itemOf[id].bongnr || id) : id; };

    var files = [];
    var add = function (path, text) { files.push({ path: path, text: text, hash: sha256(text) }); return files[files.length - 1].hash; };
    var h = {};
    h.receipts = add('data/kvitteringer.csv', receiptsCsv(all, inScope));
    h.content = add('data/innhold.json', contentJson(all, m.scan));
    h.findings = add('data/funn.csv', L.toCsv([['Test', 'Tittel', 'Detalj', 'Bonger', 'Kasserer', 'Flagger bong']].concat(m.findings.map(function (f) {
      return [f.kind, f.title, f.detail, f.ids.map(bongOf).join('; '), f.cashier || '', f.flag ? 'ja' : 'nei'];
    }))));
    h.flagged = add('data/flaggede_bonger.csv', L.toCsv([['Rang', 'Risiko', 'Poeng', 'Bongnr', 'Tidspunkt', 'Butikk', 'Kasse', 'Kasserer', 'Sum', 'Avvik', 'Status', 'Notat', 'Bevis']].concat(m.ranked.map(function (r, i) {
      var it = itemOf[r.id] || {}, n = m.notes[r.id] || {}, ev = m.evidence.byId[r.id];
      return [i + 1, cap(levelOf(r.score)), r.score, it.bongnr || r.id, it.endDateTime || '', it.storeNumber, it.workstationNumber, it.cashierNumber,
        typeof it.totalAmount === 'number' ? String(it.totalAmount).replace('.', ',') : '', r.reasons.join('; '), n.status || '', n.note || '', ev ? ev.path : ''];
    }))));
    h.settings = add('innstillinger.json', m.settingsJson);

    var cov = coverageOf(m), lim = limitations(m, cov), tbl = settingsTable(m.settings.ctl, m.settings.anom, m.settings.weights);
    var html = renderHtml(m, h, cov, lim, tbl);
    h.report = add('rapport.html', html);

    var lines = files.map(function (f) { return f.hash + '  ' + f.path; }).concat(m.evidence.files.map(function (e) { return e.hash + '  ' + e.path; }));
    lines.sort(function (a, b) { var pa = a.slice(66), pb = b.slice(66); return pa < pb ? -1 : pa > pb ? 1 : 0; });
    files.push({ path: 'KONTROLLSUM.txt', text: lines.join('\n') + '\n' });
    return { files: files, hashes: h, coverage: cov, limitations: lim };
  }

  var api = { VERSION: VERSION, sha256: sha256, sha256Bytes: sha256Bytes, utf8: utf8, stable: stable, fmtNum: fmtNum, receiptsCsv: receiptsCsv, contentJson: contentJson, settingsTable: settingsTable, coverageOf: coverageOf, limitations: limitations, build: build };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KvReport = api;
})(typeof window !== 'undefined' ? window : globalThis);
