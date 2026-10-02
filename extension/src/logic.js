(function (root) {
  'use strict';

  var TYPE_LABELS = { 1: 'Salg', 2: 'Kassaoppgjør', 11: 'PDA-operasjon (uavklart)' };

  function typeLabel(t) {
    return TYPE_LABELS[t] || 'Type ' + t;
  }

  function parseDT(s) {
    var m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(String(s || ''));
    return m ? { date: m[1], time: m[2] } : { date: '', time: '' };
  }

  function defaultFilters() {
    return {
      stores: [],
      workstations: [],
      cashiers: [],
      types: [],
      dateFrom: '',
      dateTo: '',
      timeFrom: '',
      timeTo: '',
      sumMin: '',
      sumMax: '',
      onlyNegative: false,
      member: '',
      onlyMember: false,
      onlyDup: false,
      pant: '',
      disc: '',
      bong: '',
      item: '',
      groups: [],
      onlyAnom: false,
      note: '',
      sort: 'none'
    };
  }

  function inList(list, value) {
    return !list || !list.length || list.indexOf(String(value)) !== -1;
  }

  function hasNum(v) {
    return v !== '' && v !== null && v !== undefined && !isNaN(Number(v));
  }

  function inTime(time, from, to) {
    if (!from && !to) return true;
    if (!time) return false;
    if (from && to && from > to) return time >= from || time <= to;
    if (from && time < from) return false;
    if (to && time > to) return false;
    return true;
  }

  function hasMember(item) {
    var m = item.memberNumber;
    return m !== null && m !== undefined && m !== '';
  }

  function matches(item, f, ctx) {
    var dt = parseDT(item.endDateTime);
    var sum = item.totalAmount;
    if (!inList(f.stores, item.storeNumber)) return false;
    if (!inList(f.workstations, item.workstationNumber)) return false;
    if (!inList(f.cashiers, item.cashierNumber)) return false;
    if (!inList(f.types, item.receiptType)) return false;
    if (f.dateFrom && dt.date < f.dateFrom) return false;
    if (f.dateTo && dt.date > f.dateTo) return false;
    if (!inTime(dt.time, f.timeFrom, f.timeTo)) return false;
    if (hasNum(f.sumMin) || hasNum(f.sumMax) || f.onlyNegative) {
      if (sum === null || sum === undefined) return false;
      if (hasNum(f.sumMin) && sum < Number(f.sumMin)) return false;
      if (hasNum(f.sumMax) && sum > Number(f.sumMax)) return false;
      if (f.onlyNegative && !(sum < 0)) return false;
    }
    if (f.onlyMember && !hasMember(item)) return false;
    if (f.member) {
      if (!hasMember(item)) return false;
      if (String(item.memberNumber).toLowerCase().indexOf(String(f.member).toLowerCase()) === -1) return false;
    }
    if (f.onlyDup && !(ctx && ctx.dupIds && ctx.dupIds[item.transactionId])) return false;
    if (f.bong) {
      if (String(item.bongnr || item.transactionId || '').toLowerCase().indexOf(String(f.bong).toLowerCase()) === -1) return false;
    }
    if (f.item) {
      var sc = ctx && ctx.scan && ctx.scan[item.transactionId];
      if (!sc) return false;
      var q = String(f.item).toUpperCase();
      var hit = sc.items.some(function (i) { return String(i.c).indexOf(q) !== -1 || String(i.n).toUpperCase().indexOf(q) !== -1; });
      if (!hit) return false;
    }
    if (f.groups && f.groups.length) {
      var gs = ctx && ctx.groupsOf && ctx.groupsOf(item.transactionId);
      if (!gs || !gs.some(function (g) { return f.groups.indexOf(g) !== -1; })) return false;
    }
    if (f.note) {
      var nt = ctx && ctx.notes && ctx.notes[item.transactionId];
      if (f.note === 'any') { if (!nt || (!nt.note && !nt.status)) return false; }
      else if (!nt || nt.status !== f.note) return false;
    }
    if (f.onlyAnom && !(ctx && ctx.anom && ctx.anom[item.transactionId] && ctx.anom[item.transactionId].length)) return false;
    if (f.pant) {
      var info = ctx && ctx.scan && ctx.scan[item.transactionId];
      if (!info) return false;
      if (f.pant === 'any' && !(info.sale !== 0 || info.ret !== 0)) return false;
      if (f.pant === 'sale' && !(info.sale > 0)) return false;
      if (f.pant === 'return' && !(info.ret < 0)) return false;
    }
    if (f.disc) {
      var ds = ctx && ctx.scan && ctx.scan[item.transactionId];
      if (!ds || !(ds.v >= 3)) return false;
      if (f.disc === 'any' && !(ds.discN > 0)) return false;
      if (f.disc === 'noreason' && !(ds.discNR > 0)) return false;
      if (f.disc === 'reason' && !(ds.discN > ds.discNR)) return false;
      if (f.disc === 'coupon' && !(ds.coupons && ds.coupons.length)) return false;
      if (f.disc.indexOf('r:') === 0) {
        var rn = f.disc.slice(2);
        if (!ds.items.some(function (l) { return l.d && reasonName(l.dr) === rn; })) return false;
      }
    }
    return true;
  }

  function sortValue(item, kind) {
    if (kind === 'sumAsc' || kind === 'sumDesc') return item.totalAmount;
    return item.endDateTime || '';
  }

  function compare(a, b, kind) {
    if (kind === 'none') return 0;
    var va = sortValue(a, kind);
    var vb = sortValue(b, kind);
    var an = va === null || va === undefined;
    var bn = vb === null || vb === undefined;
    if (an || bn) return an && bn ? 0 : an ? 1 : -1;
    var dir = kind === 'sumDesc' || kind === 'timeDesc' ? -1 : 1;
    return va < vb ? -dir : va > vb ? dir : 0;
  }

  function findDuplicates(items) {
    var groups = {};
    items.forEach(function (it) {
      if (it.totalAmount === null || it.totalAmount === undefined) return;
      var key = [it.totalAmount, it.storeNumber, it.workstationNumber, parseDT(it.endDateTime).date + ' ' + parseDT(it.endDateTime).time].join('|');
      (groups[key] = groups[key] || []).push(it.transactionId);
    });
    var ids = {};
    var list = [];
    Object.keys(groups).forEach(function (k) {
      if (groups[k].length > 1) {
        list.push({ key: k, ids: groups[k] });
        groups[k].forEach(function (id) { ids[id] = true; });
      }
    });
    return { groups: list, ids: ids };
  }

  function sumSelected(items) {
    var sum = 0;
    items.forEach(function (it) { if (typeof it.totalAmount === 'number') sum += it.totalAmount; });
    return { count: items.length, sum: Math.round(sum * 100) / 100 };
  }

  function parseAmount(text) {
    var t = String(text || '').replace(/[\s\u00a0]/g, '').replace(',', '.').replace(/^\+/, '');
    return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
  }

  var PANT_LINE = /^\s*\d{1,4}\s+PANT(ELAPP)?\b/i;
  var ITEM_ROW = /^\s*(\d{1,14})\s+(.+)$/;
  var QTY_ROW = /^Antall:\s*([\d.,]+)\s*\S*\s*à\s*Kr\s*([\d.,]+)/i;

  function round2(n) { return Math.round(n * 100) / 100; }

  function lastAmount(cells) {
    for (var i = cells.length - 1; i > 0; i--) {
      var a = parseAmount(cells[i]);
      if (a !== null) return a;
    }
    return null;
  }

  var RABATT_ROW = /^Rabatt:\s*Kr\s*([\d.,]+)(?:\s*\(\s*([\d.,]+)\s*%\s*\))?/i;
  var ARSAK_ROW = /^Rabatt\s*[åa]rsak:\s*(.*)$/i;
  var KUPONG_ROW = /^Kupong\s*\(\s*(\S+)\s+-\s+(.*)\)\s*$/i;

  // v3: rabattlinjer (Rabatt: Kr x (y %) + Rabatt årsak) på varelinjen og Kupong-linjer (kampanjer) på bongen.
  function parseReceipt(rows) {
    var items = [], pay = {}, last = null, coupons = [];
    var sale = 0, ret = 0, saleLines = 0, retLines = 0, np = 0, neg = 0;
    (rows || []).forEach(function (cells) {
      if (!cells || !cells.length) return;
      var c0 = String(cells[0] || '').trim();
      var q = QTY_ROW.exec(c0);
      if (q) { if (last) last.q = parseAmount(q[1].replace(',', '.')); return; }
      var rb = RABATT_ROW.exec(c0);
      if (rb) {
        if (last) { last.d = round2((last.d || 0) + (parseAmount(rb[1].replace(',', '.')) || 0)); if (rb[2]) last.dp = parseAmount(rb[2].replace(',', '.')); }
        return;
      }
      var ar = ARSAK_ROW.exec(c0);
      if (ar) {
        if (last && last.d) last.dr = (ar[1] + ' ' + cells.slice(1).join(' ')).replace(/\s+/g, ' ').trim();
        return;
      }
      var kp = KUPONG_ROW.exec(c0.replace(/:\s*$/, ''));
      if (kp) {
        if (coupons.length < 30) coupons.push({ i: kp[1], n: kp[2].trim().slice(0, 60), a: lastAmount(cells) || 0 });
        last = null;
        return;
      }
      if (cells.length < 2) return;
      if (parseAmount(c0) !== null) return;
      var amount = lastAmount(cells);
      if (amount === null) return;
      if (/:\s*$/.test(c0)) {
        var label = c0.replace(/:\s*$/, '');
        pay[label] = round2((pay[label] || 0) + amount);
        last = null;
        return;
      }
      var m = ITEM_ROW.exec(c0);
      if (!m) return;
      last = { c: m[1], n: m[2].trim(), a: amount };
      items.push(last);
      if (PANT_LINE.test(c0)) {
        if (amount < 0) { ret += amount; retLines++; } else { sale += amount; saleLines++; }
      } else { np++; if (amount < 0) neg++; }
    });
    var disc = 0, discN = 0, discNR = 0, discNRsum = 0;
    items.forEach(function (it) {
      if (!it.d) return;
      disc += it.d; discN++;
      if (!it.dr) { discNR++; discNRsum += it.d; }
    });
    return { v: 3, items: items, pay: pay, np: np, neg: neg, sale: round2(sale), ret: round2(ret), saleLines: saleLines, retLines: retLines,
      disc: round2(disc), discN: discN, discNR: discNR, discNRsum: round2(discNRsum), coupons: coupons };
  }

  // Rabattårsaker i Lindbak (tekstnr 1–6). Kvitteringen kan vise nummer eller tekst.
  var DISC_REASONS = ['Datovare', 'Feil pris', 'Prisløfte', 'Reserveløsning kupong', 'Annen rabattårsak', 'Best før'];
  var NO_REASON = 'Uten årsak';

  function reasonName(raw) {
    var t = String(raw || '').trim();
    if (!t) return NO_REASON;
    if (/^\d+$/.test(t)) return DISC_REASONS[Number(t) - 1] || t;
    var low = t.toLowerCase();
    for (var i = 0; i < DISC_REASONS.length; i++) if (low.indexOf(DISC_REASONS[i].toLowerCase()) !== -1) return DISC_REASONS[i];
    return t;
  }

  // Rabattdata finnes først fra v3; eldre skanninger må skannes på nytt.
  function hasDisc(sc) { return !!sc && sc.v >= 3; }
  function couponSum(sc) { return round2(((sc && sc.coupons) || []).reduce(function (a, c) { return a + (c.a || 0); }, 0)); }

  function sumPant(items, scanMap) {
    var sale = 0, ret = 0, scanned = 0;
    items.forEach(function (it) {
      var p = scanMap && scanMap[it.transactionId];
      if (!p) return;
      scanned++; sale += p.sale; ret += p.ret;
    });
    return { sale: round2(sale), ret: round2(ret), net: round2(sale + ret), scanned: scanned, total: items.length };
  }


  // ---- kassaoppgjør (receiptType 2) -------------------------------------------
  function parseSettlement(rows) {
    var st = { telt: {}, diff: {}, tilg: {}, pose: '', bank: null, valor: {} };
    var mode = 'telt';
    (rows || []).forEach(function (cells) {
      if (!cells || !cells.length) return;
      var c0 = String(cells[0] || '').trim();
      var a = lastAmount(cells);
      var pose = /^Pose:\s*(.+)$/i.exec(c0);
      if (pose) { st.pose = pose[1].trim(); return; }
      if (/^Differanse/i.test(c0)) { mode = 'diff'; return; }
      if (/^Sendt bank/i.test(c0)) { mode = 'bank'; return; }
      if (/^Tilgodelapp$/i.test(c0)) { mode = 'tilg'; return; }
      if (/^Val[øo]r$/i.test(c0)) { mode = 'valor'; return; }
      if (mode === 'bank') { if (a !== null) st.bank = a; return; }
      if (mode === 'valor') { if (parseAmount(c0) !== null && a !== null) st.valor[c0] = a; return; }
      if (mode === 'tilg') {
        var t = /^(egne|fremmede|utlevert|sum):?$/i.exec(c0);
        if (t && a !== null) st.tilg[t[1].toLowerCase()] = a;
        return;
      }
      var m = /^(Kontant|Sjekk|Kreditt|Tilgodelapp|Sum):?$/i.exec(c0);
      if (m && a !== null) (mode === 'diff' ? st.diff : st.telt)[m[1].toLowerCase()] = a;
    });
    return { v: 2, kind: 'settle', items: [], pay: {}, np: 0, sale: 0, ret: 0, saleLines: 0, retLines: 0, settle: st };
  }

  // ---- dagsrapport ----------------------------------------------------------------
  function report(items, scanMap, anomMap, opts) {
    opts = opts || {};
    var by = opts.by === 'kasserer' ? 'kasserer' : 'kasse';
    var acc = {};
    items.forEach(function (it) {
      var day = opts.byDay ? parseDT(it.endDateTime).date : '';
      var id = by === 'kasse' ? it.workstationNumber : it.cashierNumber;
      var key = day + '|' + id;
      var e = acc[key] || (acc[key] = { day: day, id: id, label: (by === 'kasse' ? 'Kasse ' : 'Kasserer ') + id, count: 0, sum: 0, retCount: 0, retSum: 0, pantSale: 0, pantRet: 0, scanned: 0, anom: 0, settleCount: 0, settleDiff: 0 });
      var sc = scanMap && scanMap[it.transactionId];
      if (anomMap && anomMap[it.transactionId] && anomMap[it.transactionId].length) e.anom++;
      if (it.receiptType === 2) {
        e.settleCount++;
        if (sc && sc.settle) e.settleDiff += sc.settle.diff.sum || 0;
        return;
      }
      if (it.receiptType !== 1 || typeof it.totalAmount !== 'number') return;
      e.count++; e.sum += it.totalAmount;
      if (it.totalAmount < 0) { e.retCount++; e.retSum += it.totalAmount; }
      if (sc) { e.scanned++; e.pantSale += sc.sale; e.pantRet += sc.ret; }
    });
    var rows = Object.keys(acc).map(function (k) { return acc[k]; }).sort(function (a, b) {
      return a.day < b.day ? -1 : a.day > b.day ? 1 : String(a.id).localeCompare(String(b.id), 'nb', { numeric: true });
    });
    var total = { day: '', id: '', label: 'Totalt', count: 0, sum: 0, retCount: 0, retSum: 0, pantSale: 0, pantRet: 0, scanned: 0, anom: 0, settleCount: 0, settleDiff: 0 };
    rows.forEach(function (r) {
      Object.keys(total).forEach(function (k) { if (typeof total[k] === 'number') total[k] += r[k]; });
    });
    [total].concat(rows).forEach(function (r) {
      ['sum', 'retSum', 'pantSale', 'pantRet', 'settleDiff'].forEach(function (k) { r[k] = round2(r[k]); });
    });
    return { rows: rows, total: total };
  }

  // ---- egne avviksregler ------------------------------------------------------------
  var RULE_FIELDS = {
    sum: { label: 'Sum (kr)', scan: false },
    abssum: { label: 'Sum uten fortegn (kr)', scan: false },
    tid: { label: 'Klokkeslett (HH:MM)', scan: false },
    kasse: { label: 'Kasse', scan: false },
    kasserer: { label: 'Kasserer', scan: false },
    butikk: { label: 'Butikk', scan: false },
    type: { label: 'Kvitteringstype', scan: false },
    medlem: { label: 'Medlemsnr (tomt = ingen)', scan: false },
    panteretur: { label: 'Panteretur (kr, uten fortegn)', scan: true },
    pantsalg: { label: 'Pantsalg (kr)', scan: true },
    pantelapper: { label: 'Antall pantelapper', scan: true },
    linjer: { label: 'Antall varelinjer', scan: true },
    kontanttilbake: { label: 'Kontant tilbake (kr)', scan: true },
    rabatt: { label: 'Rabatt på bongen (kr)', scan: true },
    rabattpst: { label: 'Høyeste rabatt (%)', scan: true },
    rabattuten: { label: 'Rabattlinjer uten årsak (antall)', scan: true },
    rabattarsak: { label: 'Rabattårsak', scan: true, multi: true },
    kuponger: { label: 'Kuponger/kampanjer (antall)', scan: true },
    kupong: { label: 'Kupong (id/navn)', scan: true, multi: true },
    kassadiff: { label: 'Kassadifferanse (kr, uten fortegn)', scan: true },
    vare: { label: 'Vare (EAN/navn)', scan: true, multi: true },
    gruppe: { label: 'Varegruppe', scan: true, multi: true },
    betaling: { label: 'Betalingsmåte', scan: true, multi: true }
  };
  var RULE_OPS = ['>=', '<=', '>', '<', '=', '≠', 'inneholder'];

  function fieldValue(f, item, scan, groups) {
    switch (f) {
      case 'sum': return typeof item.totalAmount === 'number' ? item.totalAmount : null;
      case 'abssum': return typeof item.totalAmount === 'number' ? Math.abs(item.totalAmount) : null;
      case 'tid': return parseDT(item.endDateTime).time;
      case 'kasse': return item.workstationNumber;
      case 'kasserer': return item.cashierNumber;
      case 'butikk': return item.storeNumber;
      case 'type': return item.receiptType;
      case 'medlem': return hasMember(item) ? String(item.memberNumber) : '';
      default: break;
    }
    if (!scan) return undefined;
    switch (f) {
      case 'panteretur': return Math.abs(scan.ret);
      case 'pantsalg': return scan.sale;
      case 'pantelapper': return scan.retLines;
      case 'linjer': return scan.items.length;
      case 'kontanttilbake': return scan.pay['Kontant tilbake'] || 0;
      case 'rabatt': return hasDisc(scan) ? scan.disc : undefined;
      case 'rabattpst': return hasDisc(scan) ? scan.items.reduce(function (a, i) { return Math.max(a, i.dp || 0); }, 0) : undefined;
      case 'rabattarsak': return hasDisc(scan) ? scan.items.filter(function (i) { return i.d; }).map(function (i) { return reasonName(i.dr); }) : undefined;
      case 'rabattuten': return hasDisc(scan) ? scan.discNR : undefined;
      case 'kuponger': return hasDisc(scan) ? scan.coupons.length : undefined;
      case 'kupong': return hasDisc(scan) ? scan.coupons.reduce(function (a, c) { a.push(c.i, c.n); return a; }, []) : undefined;
      case 'kassadiff': return scan.settle ? Math.abs(scan.settle.diff.sum || 0) : undefined;
      case 'vare': return scan.items.reduce(function (a, i) { a.push(i.c, i.n); return a; }, []);
      case 'gruppe': return groups || [];
      case 'betaling': return Object.keys(scan.pay);
      default: return undefined;
    }
  }

  function cmp(a, op, b) {
    var na = Number(a), nb = Number(b);
    var num = a !== '' && a !== null && b !== '' && b !== null && !isNaN(na) && !isNaN(nb);
    var x = num ? na : String(a).toLowerCase(), y = num ? nb : String(b).toLowerCase();
    switch (op) {
      case '>=': return x >= y;
      case '<=': return x <= y;
      case '>': return x > y;
      case '<': return x < y;
      case '=': return x === y;
      case '≠': return x !== y;
      case 'inneholder': return String(a).toLowerCase().indexOf(String(b).toLowerCase()) !== -1;
      default: return false;
    }
  }

  function condTrue(c, item, scan, groups) {
    var def = RULE_FIELDS[c.f];
    if (!def) return false;
    var v = fieldValue(c.f, item, scan, groups);
    if (v === undefined || v === null) return false;
    if (def.multi) {
      var want = String(c.v).toLowerCase();
      var list = v.map(function (x) { return String(x).toLowerCase(); });
      if (c.op === '=') return list.some(function (x) { return x === want; });
      if (c.op === 'inneholder') return list.some(function (x) { return x.indexOf(want) !== -1; });
      if (c.op === '≠') return !list.some(function (x) { return x.indexOf(want) !== -1; });
      return false;
    }
    return cmp(v, c.op, c.v);
  }

  function evalRule(rule, item, scan, groups) {
    if (!rule || rule.enabled === false || !rule.conds || !rule.conds.length) return false;
    return rule.conds.every(function (c) { return condTrue(c, item, scan, groups); });
  }

  function sanitizeCustom(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (r) { return r && typeof r.name === 'string'; }).map(function (r, i) {
      return {
        id: String(r.id || 'r' + i), name: r.name.trim() || 'Regel ' + (i + 1), enabled: r.enabled !== false,
        conds: (Array.isArray(r.conds) ? r.conds : []).filter(function (c) { return c && RULE_FIELDS[c.f] && RULE_OPS.indexOf(c.op) !== -1; })
          .map(function (c) { return { f: c.f, op: c.op, v: String(c.v === undefined ? '' : c.v) }; })
      };
    });
  }

  // ---- varegrupper -------------------------------------------------------
  function esc(t) { return String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  var reCache = {};
  function kwTest(code, name, kw) {
    kw = String(kw || '').trim();
    if (!kw) return false;
    if (kw.charAt(0) === '#') {
      var c = kw.slice(1);
      return c.slice(-1) === '*' ? String(code).indexOf(c.slice(0, -1)) === 0 : String(code) === c;
    }
    var key = kw.toUpperCase();
    var re = reCache[key];
    if (!re) {
      re = key.charAt(0) === '*'
        ? new RegExp(esc(key.slice(1)))
        : new RegExp('(^|[^A-ZÆØÅ0-9])' + esc(key));
      reCache[key] = re;
    }
    return re.test(String(name).toUpperCase());
  }

  function classify(item, rules) {
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      var ex = (r.exclude || []).some(function (k) {
        k = String(k || '').trim();
        return kwTest(item.c, item.n, k.charAt(0) === '#' || k.charAt(0) === '*' ? k : '*' + k);
      });
      if (ex) continue;
      if ((r.include || []).some(function (k) { return kwTest(item.c, item.n, k); })) return r.name;
    }
    return null;
  }

  var NO_GROUP = 'Uten gruppe';

  function groupsOfScan(scan, rules) {
    var seen = {}, out = [];
    scan.items.forEach(function (it) {
      var g = classify(it, rules) || NO_GROUP;
      if (!seen[g]) { seen[g] = true; out.push(g); }
    });
    return out;
  }

  function groupSums(chosenIds, scanMap, rules) {
    var acc = {};
    chosenIds.forEach(function (id) {
      var sc = scanMap[id];
      if (!sc) return;
      sc.items.forEach(function (it) {
        var g = classify(it, rules) || NO_GROUP;
        var e = acc[g] || (acc[g] = { group: g, lines: 0, sum: 0 });
        e.lines++; e.sum += it.a;
      });
    });
    return Object.keys(acc).map(function (k) { acc[k].sum = round2(acc[k].sum); return acc[k]; })
      .sort(function (a, b) { return Math.abs(b.sum) - Math.abs(a.sum); });
  }

  function unmatched(scanMap, rules, limit) {
    var acc = {};
    Object.keys(scanMap).forEach(function (id) {
      scanMap[id].items.forEach(function (it) {
        if (classify(it, rules)) return;
        var k = it.n.toUpperCase();
        var e = acc[k] || (acc[k] = { name: k, code: it.c, count: 0, sum: 0 });
        e.count++; e.sum += it.a;
      });
    });
    return Object.keys(acc).map(function (k) { acc[k].sum = round2(acc[k].sum); return acc[k]; })
      .sort(function (a, b) { return b.count - a.count || Math.abs(b.sum) - Math.abs(a.sum); })
      .slice(0, limit || 15);
  }

  function defaultRules() {
    return [
      { name: 'Pant', include: ['#220', '#399'], exclude: [] },
      { name: 'Tobakk', include: ['SKRUF', 'PRINCE', 'MARLBORO', 'CAMEL', 'WINSTON', 'LD', 'FIFTY FIVE', 'GENERAL', 'SNUS', 'ZYN', 'VELO', 'SIGARETT', 'LUCKY STRIKE'], exclude: [] },
      { name: 'Brus', include: ['PEPSI', 'COCA-COLA', 'COLA', 'FANTA', 'SPRITE', 'SOLO', '7UP', 'MIRINDA', 'MOUNTAIN DEW', 'BRUS'], exclude: [] },
      { name: 'Energidrikk', include: ['MONSTER', 'RED BULL', 'NOCCO', 'BURN'], exclude: [] },
      { name: 'Frukt', include: ['BANAN', 'EPLE', 'APPELSIN', 'CLEMENTIN', 'PÆRE', 'DRUER', 'SITRON', 'LIME', 'MANGO', 'AVOKADO', 'KIWI', 'MELON', 'JORDBÆR', 'BLÅBÆR'], exclude: ['YOGHURT', 'BIOLA', 'KNUTE', 'SYLTE', 'SAFT', 'BOLLE'] },
      { name: 'Grønt', include: ['AGURK', 'TOMAT', 'PAPRIKA', 'SALAT', 'GULROT', 'LØK', 'POTET', 'BROKKOLI', 'BLOMKÅL', 'KÅL', 'SOPP', 'SPINAT', 'PURRE', 'SELLERI'], exclude: ['CHIPS', 'SAUS', 'SUPPE', 'PIZZA', 'FERDIG'] },
      { name: 'Bakeri', include: ['*BRØD', 'CROISSANT', 'DONUT', '*KNUTE', '*BOLLE', 'BAGUETTE', 'TOAST'], exclude: [] },
      { name: 'Meieri', include: ['MELK', 'YOGHURT', 'BIOLA', 'SMØR', 'OST', 'FLØTE', '*EGG'], exclude: [] },
      { name: 'Kjøtt og pålegg', include: ['KYLLING', 'KJØTTDEIG', 'PØLSE', 'BACON', 'SKINKE'], exclude: [] },
      { name: 'Ferdigmat', include: ['BOWL', 'PIZZA', 'LASAGNE', 'TORO'], exclude: [] },
      { name: 'Snacks og godteri', include: ['*CHIPS', '*SJOKOLADE', 'GODTERI'], exclude: [] },
      { name: 'Kaffe og te', include: ['NESCAFE', 'KAFFE'], exclude: [] }
    ];
  }

  function sanitizeRules(raw) {
    if (!Array.isArray(raw)) return defaultRules();
    var out = raw.filter(function (r) { return r && typeof r.name === 'string' && r.name.trim(); }).map(function (r) {
      var list = function (v) { return Array.isArray(v) ? v.map(String).map(function (x) { return x.trim(); }).filter(Boolean) : []; };
      return { name: r.name.trim(), include: list(r.include), exclude: list(r.exclude) };
    });
    return out.length ? out : defaultRules();
  }

  // ---- avvik -------------------------------------------------------------
  function defaultAnom() {
    return { bigReturn: '300', manyLapper: '8', roundMin: '500', settleDiff: '1', cashNoSale: true };
  }

  function sanitizeAnom(raw) {
    var d = defaultAnom();
    if (!raw || typeof raw !== 'object') return d;
    ['bigReturn', 'manyLapper', 'roundMin', 'settleDiff'].forEach(function (k) { if (k in raw) d[k] = String(raw[k]); });
    if ('cashNoSale' in raw) d.cashNoSale = !!raw.cashNoSale;
    return d;
  }

  function anomalies(item, scan, cfg, custom, groups) {
    var out = [];
    if (hasNum(cfg.roundMin) && typeof item.totalAmount === 'number') {
      var cents = Math.round(Math.abs(item.totalAmount) * 100);
      if (cents >= Number(cfg.roundMin) * 100 && cents % 10000 === 0) out.push('Rundt beløp');
    }
    if (scan) {
      if (hasNum(cfg.bigReturn) && Math.abs(scan.ret) >= Number(cfg.bigReturn)) out.push('Stor panteretur (' + Math.abs(scan.ret) + ' kr)');
      if (hasNum(cfg.manyLapper) && scan.retLines >= Number(cfg.manyLapper)) out.push('Mange pantelapper (' + scan.retLines + ')');
      if (cfg.cashNoSale && scan.np === 0 && scan.retLines > 0 && (scan.pay['Kontant tilbake'] || 0) > 0) out.push('Kontant tilbake uten salg');
      if (scan.settle && hasNum(cfg.settleDiff) && Math.abs(scan.settle.diff.sum || 0) >= Number(cfg.settleDiff) && Math.abs(scan.settle.diff.sum || 0) > 0) {
        var d = scan.settle.diff.sum;
        out.push('Kassadifferanse (' + (d > 0 ? '+' : '') + d + ' kr)');
      }
    }
    (custom || []).forEach(function (r) { if (evalRule(r, item, scan, groups)) out.push('Regel: ' + r.name); });
    return out;
  }

  // ---- butikknavn ----------------------------------------------------------
  function storeLabel(num, map) {
    var n = map && map[String(num)];
    if (!n) return String(num);
    return /^\s*\d+\s*[-–]/.test(n) ? n : num + ' – ' + n;
  }

  function parseStoreText(text) {
    var out = {};
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var m = /^\s*(\d{2,6})\s*[=\-–:]\s*(.+?)\s*$/.exec(line);
      if (m) out[m[1]] = m[2];
    });
    return out;
  }

  // ---- CSV ------------------------------------------------------------------
  function toCsv(rows) {
    var q = function (v) {
      v = v === null || v === undefined ? '' : String(v);
      return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    return '﻿' + rows.map(function (r) { return r.map(q).join(';'); }).join('\r\n');
  }


  // ---- kontroller på tvers av kvitteringer ----------------------------------------
  function mins(t) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }
  function cnum(v, d) { return hasNum(v) ? Number(v) : d; }
  function dayOf(it) { return parseDT(it.endDateTime).date; }
  function timeOf(it) { return mins(parseDT(it.endDateTime).time); }
  function seqNum(tid) {
    var n = parseInt(String(tid).substr(String(tid).lastIndexOf('-') + 1), 10);
    return isNaN(n) ? null : n;
  }
  function numCmp(a, b) { return String(a).localeCompare(String(b), 'nb', { numeric: true }); }

  var CONTROL_FIELDS = [
    ['closeTime', 'Stengetid (HH:MM)', '22:00'], ['closeWindow', 'Minutter før stenging', '60'],
    ['smallReturn', 'Liten retur ≤ kr', '100'], ['smallReturnN', 'Små returer ≥ antall', '3'],
    ['cashNoSaleN', 'Kontant tilbake uten salg ≥ antall', '3'], ['repeatN', 'Samme beløp ≥ antall', '3'],
    ['repeatMin', 'Gjentatt beløp ≥ kr', '50'], ['pantRepeatN', 'Samme pantebeløp ≥ antall', '2'],
    ['pantMin', 'Pantebeløp ≥ kr', '20'], ['pantRatio', 'Panteretur > salg ×', '1'],
    ['openFrom', 'Åpner (HH:MM)', '06:00'], ['openTo', 'Stenger (HH:MM)', '23:00'],
    ['maxGap', 'Maks hull i bongnr', '50'], ['profFactor', 'Avvik fra snitt ×', '1.5'],
    ['profMin', 'Minst antall for profil', '5'], ['reconTol', 'Avstemt toleranse kr', '1'],
    ['falseRet', 'Falsk retur-test (tom = av)', '1'], ['saleReturnMin', 'Salg og retur av samme beløp innen min', '60'],
    ['settleGraceMin', 'Salg etter oppgjør, frist min', '5'], ['diffRepeatN', 'Kassadiff. minus ≥ antall oppgjør', '3'],
    ['diffMin', 'Kassadifferanse teller fra kr', '1'], ['diffTotal', 'Kassadiff. minus totalt ≥ kr', '100'],
    ['benfordMin', 'Benford: minst antall bonger', '100'], ['benfordCashMin', 'Benford: minst per kasserer', '50'],
    ['benfordMad', 'Benford: avvik (MAD) over', '0.015'], ['roundShare', 'Runde beløp: andel % over', '5'], ['roundMinN', 'Runde beløp: minst antall', '20'],
    ['discPct', 'Rabatt uten årsak ≥ % (tom = av)', '30'], ['discCash', 'Rabatt: sammenlign kasserere (tom = av)', '1']
  ];

  function defaultControl() {
    var o = {};
    CONTROL_FIELDS.forEach(function (f) { o[f[0]] = f[2]; });
    return o;
  }

  function sanitizeControl(raw) {
    var d = defaultControl();
    if (!raw || typeof raw !== 'object') return d;
    Object.keys(d).forEach(function (k) { if (k in raw) d[k] = String(raw[k]); });
    return d;
  }

  function isSale(it) { return it.receiptType === 1 && typeof it.totalAmount === 'number'; }

  // Kassererprofil: forholdstall per kasserer mot butikksnittet.
  function profiles(items, scanMap, cfg) {
    var f = cnum(cfg.profFactor, 1.5), minN = cnum(cfg.profMin, 5);
    var acc = {}, tot = null;
    var fresh = function () { return { count: 0, ret: 0, pos: 0, posSum: 0, scanned: 0, lapper: 0, neg: 0 }; };
    tot = fresh();
    items.forEach(function (it) {
      if (!isSale(it)) return;
      var a = acc[it.cashierNumber] || (acc[it.cashierNumber] = fresh());
      var sc = scanMap && scanMap[it.transactionId];
      [a, tot].forEach(function (x) {
        x.count++;
        if (it.totalAmount < 0) x.ret++;
        if (it.totalAmount > 0) { x.pos++; x.posSum += it.totalAmount; }
        if (sc) { x.scanned++; x.lapper += sc.retLines || 0; x.neg += sc.neg || 0; }
      });
    });
    var met = function (x) {
      return {
        count: x.count, retShare: x.count ? x.ret / x.count : 0, avg: x.pos ? x.posSum / x.pos : 0,
        scanned: x.scanned, lapper: x.lapper, lapperPer: x.scanned ? x.lapper / x.scanned : 0,
        neg: x.neg, negPer: x.scanned ? x.neg / x.scanned : 0
      };
    };
    var store = met(tot);
    var rows = Object.keys(acc).sort(numCmp).map(function (id) {
      var m = met(acc[id]);
      m.id = id;
      m.flags = {};
      if (m.count >= minN) {
        m.flags.retShare = store.retShare > 0 && m.retShare >= store.retShare * f;
        m.flags.avg = store.avg > 0 && (m.avg >= store.avg * f || (m.avg > 0 && m.avg <= store.avg / f));
      }
      if (m.scanned >= minN) {
        m.flags.lapperPer = store.lapperPer > 0 && m.lapperPer >= store.lapperPer * f;
        m.flags.negPer = store.negPer > 0 && m.negPer >= store.negPer * f;
      }
      m.flagged = Object.keys(m.flags).some(function (k) { return m.flags[k]; });
      return m;
    });
    return { rows: rows, store: store };
  }

  function groupInto(map, key, it) { (map[key] = map[key] || []).push(it); }

  // Mønstre: små returer før stenging, kontant tilbake uten salg flere ganger, samme beløp gjentatt.
  function patterns(items, scanMap, cfg) {
    var out = [];
    var scanOf = function (it) { return scanMap && scanMap[it.transactionId]; };
    var close = mins(cfg.closeTime);
    if (close === 0) close = 1440;
    if (close !== null && hasNum(cfg.smallReturnN)) {
      var win = cnum(cfg.closeWindow, 60), small = cnum(cfg.smallReturn, 100), g = {};
      items.forEach(function (it) {
        if (!isSale(it)) return;
        var sc = scanOf(it);
        if (!(it.totalAmount < 0 || (sc && sc.retLines > 0))) return;
        if (Math.abs(it.totalAmount) > small) return;
        var m = timeOf(it);
        if (m === null || m < close - win || m > close) return;
        groupInto(g, dayOf(it) + '|' + it.workstationNumber, it);
      });
      Object.keys(g).forEach(function (k) {
        if (g[k].length < Number(cfg.smallReturnN)) return;
        var p = k.split('|');
        out.push({ kind: 'Mønster', code: 'smallReturns', title: 'Små returer før stenging', flag: true,
          detail: 'Kasse ' + p[1] + ' ' + p[0] + ': ' + g[k].length + ' returer ≤ ' + small + ' kr de siste ' + win + ' min før ' + cfg.closeTime,
          ids: g[k].map(function (x) { return x.transactionId; }) });
      });
    }
    if (hasNum(cfg.cashNoSaleN)) {
      var g2 = {};
      items.forEach(function (it) {
        var sc = scanOf(it);
        if (!sc || sc.np !== 0 || !(sc.retLines > 0) || !((sc.pay['Kontant tilbake'] || 0) > 0)) return;
        groupInto(g2, String(it.workstationNumber), it);
      });
      Object.keys(g2).forEach(function (k) {
        if (g2[k].length < Number(cfg.cashNoSaleN)) return;
        var sum = round2(g2[k].reduce(function (a, it) { return a + (scanOf(it).pay['Kontant tilbake'] || 0); }, 0));
        out.push({ kind: 'Mønster', code: 'cashNoSale', title: 'Kontant tilbake uten salg flere ganger', flag: true,
          detail: 'Kasse ' + k + ': ' + g2[k].length + ' ganger, totalt ' + sum + ' kr',
          ids: g2[k].map(function (x) { return x.transactionId; }) });
      });
    }
    if (hasNum(cfg.repeatN)) {
      var g3 = {}, min = cnum(cfg.repeatMin, 50);
      items.forEach(function (it) {
        if (!isSale(it) || Math.abs(it.totalAmount) < min) return;
        groupInto(g3, dayOf(it) + '|' + it.cashierNumber + '|' + it.totalAmount, it);
      });
      Object.keys(g3).forEach(function (k) {
        if (g3[k].length < Number(cfg.repeatN)) return;
        var p = k.split('|');
        out.push({ kind: 'Mønster', code: 'repeatAmount', title: 'Samme beløp gjentatt', flag: true,
          detail: 'Kasserer ' + p[1] + ' ' + p[0] + ': ' + p[2] + ' kr × ' + g3[k].length,
          ids: g3[k].map(function (x) { return x.transactionId; }) });
      });
    }
    return out;
  }

  // Pantelapp-sjekk: samme pantebeløp utbetalt flere ganger, og pantebalanse (salg mot retur) per dag og butikk.
  function pantCheck(items, scanMap, cfg) {
    var findings = [], bal = {}, g = {};
    var min = cnum(cfg.pantMin, 20);
    items.forEach(function (it) {
      if (it.receiptType !== 1) return;
      var sc = scanMap && scanMap[it.transactionId];
      if (!sc) return;
      var key = dayOf(it) + '|' + it.storeNumber;
      var b = bal[key] || (bal[key] = { day: dayOf(it), store: it.storeNumber, sale: 0, ret: 0, n: 0 });
      b.sale += sc.sale; b.ret += Math.abs(sc.ret); b.n++;
      if (sc.ret < 0 && Math.abs(sc.ret) >= min) groupInto(g, dayOf(it) + '|' + it.workstationNumber + '|' + Math.abs(sc.ret), it);
    });
    if (hasNum(cfg.pantRepeatN)) {
      Object.keys(g).forEach(function (k) {
        if (g[k].length < Number(cfg.pantRepeatN)) return;
        var p = k.split('|');
        findings.push({ kind: 'Pant', code: 'pantRepeat', title: 'Samme pantebeløp utbetalt flere ganger', flag: true,
          detail: 'Kasse ' + p[1] + ' ' + p[0] + ': ' + p[2] + ' kr × ' + g[k].length,
          ids: g[k].map(function (x) { return x.transactionId; }) });
      });
    }
    var ratio = cnum(cfg.pantRatio, null);
    var rows = Object.keys(bal).map(function (k) {
      var b = bal[k];
      b.sale = round2(b.sale); b.ret = round2(b.ret); b.diff = round2(b.sale - b.ret);
      b.flag = ratio !== null && b.ret > 0 && b.ret > b.sale * ratio;
      return b;
    }).sort(function (a, b) { return a.day < b.day ? -1 : a.day > b.day ? 1 : numCmp(a.store, b.store); });
    return { findings: findings, balance: rows };
  }

  // Sekvens: hull i bongnummer per kasse, og bonger utenfor åpningstid.
  function sequence(items, cfg) {
    var findings = [], byK = {}, skipped = 0;
    var maxGap = cnum(cfg.maxGap, 50);
    items.forEach(function (it) {
      var n = seqNum(it.transactionId);
      if (n === null) return;
      groupInto(byK, it.storeNumber + '|' + it.workstationNumber, { n: n, it: it });
    });
    Object.keys(byK).forEach(function (k) {
      var arr = byK[k].sort(function (a, b) { return a.n - b.n; });
      var uniq = [];
      arr.forEach(function (x) { if (!uniq.length || uniq[uniq.length - 1].n !== x.n) uniq.push(x); });
      for (var i = 1; i < uniq.length; i++) {
        var gap = uniq[i].n - uniq[i - 1].n - 1;
        if (gap > maxGap) { skipped++; continue; }
        if (gap > 0) {
          findings.push({ kind: 'Sekvens', code: 'gap', title: 'Hull i bongnummer', flag: false,
            detail: 'Kasse ' + k.split('|')[1] + ': mangler ' + (uniq[i - 1].n + 1) + (gap > 1 ? '–' + (uniq[i].n - 1) : '') + ' (' + gap + ')',
            ids: [uniq[i - 1].it.transactionId, uniq[i].it.transactionId] });
        }
      }
    });
    var from = mins(cfg.openFrom), to = mins(cfg.openTo);
    if (from !== null && to !== null) {
      var g = {};
      items.forEach(function (it) {
        if (!isSale(it)) return;
        var m = timeOf(it);
        if (m !== null && (m < from || m > to)) groupInto(g, dayOf(it) + '|' + it.workstationNumber, it);
      });
      Object.keys(g).forEach(function (k) {
        var p = k.split('|');
        var times = g[k].map(function (x) { return parseDT(x.endDateTime).time; }).sort();
        findings.push({ kind: 'Sekvens', code: 'hours', title: 'Bonger utenfor åpningstid', flag: true,
          detail: 'Kasse ' + p[1] + ' ' + p[0] + ': ' + g[k].length + ' bonger (' + times[0] + (times.length > 1 ? '–' + times[times.length - 1] : '') + ', åpent ' + cfg.openFrom + '–' + cfg.openTo + ')',
          ids: g[k].map(function (x) { return x.transactionId; }) });
      });
    }
    return { findings: findings, skippedGaps: skipped };
  }

  // Dagsavstemming: salg per betalingsmåte mot kassaoppgjør (telt kontant, sendt bank) per kasse og dag.
  function reconcile(items, scanMap, cfg) {
    var rows = {}, tol = cnum(cfg.reconTol, 1);
    items.forEach(function (it) {
      var sc = scanMap && scanMap[it.transactionId];
      var k = dayOf(it) + '|' + it.workstationNumber;
      var r = rows[k] || (rows[k] = { day: dayOf(it), kasse: it.workstationNumber, pay: {}, salgTotal: 0, salgScanned: 0, settleCount: 0, telt: 0, bank: 0 });
      if (isSale(it)) {
        r.salgTotal++;
        if (sc) {
          r.salgScanned++;
          Object.keys(sc.pay).forEach(function (l) { r.pay[l] = round2((r.pay[l] || 0) + sc.pay[l]); });
        }
      } else if (it.receiptType === 2 && sc && sc.settle) {
        r.settleCount++;
        r.telt += sc.settle.telt.kontant || 0;
        r.bank += sc.settle.bank || 0;
      }
    });
    var out = Object.keys(rows).map(function (k) { return rows[k]; })
      .filter(function (r) { return r.salgScanned > 0 || r.settleCount > 0; })
      .map(function (r) {
        r.expected = round2((r.pay['Kontant'] || 0) - (r.pay['Kontant tilbake'] || 0));
        r.telt = round2(r.telt); r.bank = round2(r.bank);
        r.diff = r.settleCount ? round2(r.telt - r.expected) : null;
        r.flag = r.diff !== null && Math.abs(r.diff) >= tol && r.diff !== 0;
        r.complete = r.salgScanned === r.salgTotal;
        return r;
      })
      .sort(function (a, b) { return a.day < b.day ? -1 : a.day > b.day ? 1 : numCmp(a.kasse, b.kasse); });
    return out;
  }


  // ---- fokus: alt om én kasserer eller kasse ------------------------------------
  function focusStats(items, scanMap) {
    var st = { all: items.length, sales: 0, sum: 0, avg: 0, rets: 0, retSum: 0, first: null, last: null,
      kasse: {}, kasserer: {}, hours: [], pantSale: 0, pantRet: 0, lapper: 0, neg: 0, scanned: 0, scannable: 0,
      pay: {}, settle: 0, settleDiff: 0, posN: 0, posSum: 0, disc: 0, discN: 0, discNR: 0, cpn: 0, discScanned: 0 };
    for (var h = 0; h < 24; h++) st.hours.push(0);
    items.forEach(function (it) {
      var dt = parseDT(it.endDateTime);
      if (dt.time) {
        if (!st.first || it.endDateTime < st.first) st.first = it.endDateTime;
        if (!st.last || it.endDateTime > st.last) st.last = it.endDateTime;
        st.hours[Math.floor(mins(dt.time) / 60)]++;
      }
      st.kasse[it.workstationNumber] = (st.kasse[it.workstationNumber] || 0) + 1;
      st.kasserer[it.cashierNumber] = (st.kasserer[it.cashierNumber] || 0) + 1;
      var sc = scanMap && scanMap[it.transactionId];
      if (it.receiptType === 1 || it.receiptType === 2) st.scannable++;
      if (sc) st.scanned++;
      if (it.receiptType === 2) {
        st.settle++;
        if (sc && sc.settle) st.settleDiff += sc.settle.diff.sum || 0;
        return;
      }
      if (!isSale(it)) return;
      st.sales++; st.sum += it.totalAmount;
      if (it.totalAmount < 0) { st.rets++; st.retSum += it.totalAmount; }
      if (it.totalAmount > 0) { st.posN++; st.posSum += it.totalAmount; }
      if (sc) {
        st.pantSale += sc.sale; st.pantRet += sc.ret; st.lapper += sc.retLines || 0; st.neg += sc.neg || 0;
        Object.keys(sc.pay).forEach(function (l) { st.pay[l] = round2((st.pay[l] || 0) + sc.pay[l]); });
        if (hasDisc(sc)) { st.discScanned++; st.disc += sc.disc; st.discN += sc.discN; st.discNR += sc.discNR; st.cpn += sc.coupons.length; }
      }
    });
    st.avg = st.posN ? round2(st.posSum / st.posN) : 0;
    ['sum', 'retSum', 'pantSale', 'pantRet', 'settleDiff', 'disc'].forEach(function (k) { st[k] = round2(st[k]); });
    return st;
  }


  // ---- risikoscore og forklaring --------------------------------------------------
  var RISK_WEIGHTS = {
    'Stor panteretur': 3, 'Mange pantelapper': 3, 'Kontant tilbake uten salg': 4, 'Rundt beløp': 1, 'Kassadifferanse': 5,
    'Små returer før stenging': 4, 'Kontant tilbake uten salg flere ganger': 5, 'Samme beløp gjentatt': 3,
    'Samme pantebeløp utbetalt flere ganger': 4, 'Bonger utenfor åpningstid': 2, 'Regel': 3,
    'Retur uten salg': 3, 'Kortkjøp refundert kontant': 5, 'Salg og retur av samme beløp': 4, 'Salg etter kassaoppgjør': 4,
    'Hull i bongnummer': 3, 'Bongnummer og tid stemmer ikke': 4, 'Dobbelt bongnummer': 3, 'Gjentatte kassadifferanser': 4,
    'Avvikende sifferfordeling': 2, 'Mange runde beløp': 2, 'Rabatt uten årsak': 3, 'Mange rabatter uten årsak': 2
  };

  function sanitizeWeights(raw) {
    var out = {};
    Object.keys(RISK_WEIGHTS).forEach(function (k) {
      out[k] = raw && typeof raw === 'object' && hasNum(raw[k]) ? Number(raw[k]) : RISK_WEIGHTS[k];
    });
    return out;
  }

  function reasonBase(r) { return String(r).replace(/\s*\(.*$/, ''); }

  function reasonWeight(r, weights) {
    var w = weights || RISK_WEIGHTS, b = reasonBase(r);
    if (/^Regel:/.test(b)) return cnum(w['Regel'], 3);
    return b in w ? cnum(w[b], 2) : 2;
  }

  function riskScore(reasons, weights) {
    return round2((reasons || []).reduce(function (a, r) { return a + reasonWeight(r, weights); }, 0));
  }

  function riskLevel(score) { return score >= 8 ? 'høy' : score >= 4 ? 'middels' : 'lav'; }

  function rankReceipts(items, anomMap, weights) {
    var out = [];
    items.forEach(function (it) {
      var r = anomMap && anomMap[it.transactionId];
      if (!r || !r.length) return;
      out.push({ id: it.transactionId, item: it, reasons: r, score: riskScore(r, weights) });
    });
    return out.sort(function (a, b) { return b.score - a.score || (a.item.endDateTime < b.item.endDateTime ? 1 : -1); });
  }

  function rankCashiers(items, anomMap, weights, profile, extra) {
    var acc = {};
    items.forEach(function (it) {
      var r = anomMap && anomMap[it.transactionId];
      if (!r || !r.length) return;
      var a = acc[it.cashierNumber] || (acc[it.cashierNumber] = { id: String(it.cashierNumber), score: 0, flagged: 0, profile: [] });
      a.score += riskScore(r, weights); a.flagged++;
    });
    var names = { retShare: 'høy returandel', avg: 'avvikende snittbeløp', lapperPer: 'mange pantelapper', negPer: 'mange korrigeringer' };
    ((profile && profile.rows) || []).forEach(function (p) {
      var flags = Object.keys(p.flags || {}).filter(function (k) { return p.flags[k]; });
      if (!flags.length) return;
      var a = acc[p.id] || (acc[p.id] = { id: String(p.id), score: 0, flagged: 0, profile: [] });
      a.score += 2 * flags.length;
      a.profile = flags.map(function (k) { return names[k]; });
    });
    Object.keys(extra || {}).forEach(function (id) {
      var a = acc[id] || (acc[id] = { id: String(id), score: 0, flagged: 0, profile: [] });
      a.score += extra[id].points;
      a.profile = a.profile.concat(extra[id].notes);
    });
    return Object.keys(acc).map(function (k) { acc[k].score = round2(acc[k].score); return acc[k]; })
      .sort(function (a, b) { return b.score - a.score || numCmp(a.id, b.id); });
  }

  function ruleText(rule) {
    return (rule.conds || []).map(function (c) { return (RULE_FIELDS[c.f] ? RULE_FIELDS[c.f].label : c.f) + ' ' + c.op + ' ' + (c.v === '' ? '(tomt)' : c.v); }).join(' OG ');
  }

  // ctx: { id, cfg (avviksterskler), ctl (kontrolltterskler), findings, rules (egne regler) }
  function explainReason(reason, ctx) {
    ctx = ctx || {};
    var cfg = ctx.cfg || defaultAnom(), b = reasonBase(reason), m = /\(([^)]*)\)/.exec(String(reason)), v = m ? m[1] : '';
    switch (b) {
      case 'Stor panteretur': return 'Utbetalt panteretur på bongen er ' + v + '. Grensen er ' + cfg.bigReturn + ' kr.';
      case 'Mange pantelapper': return 'Bongen har ' + v + ' pantelapper. Grensen er ' + cfg.manyLapper + '.';
      case 'Kontant tilbake uten salg': return 'Bongen har bare pantelapper og kontant tilbake, ingen andre varer.';
      case 'Rundt beløp': return 'Totalen er et helt hundre-beløp på minst ' + cfg.roundMin + ' kr.';
      case 'Kassadifferanse': return 'Kassaoppgjøret viser differanse ' + v + '. Grensen er ' + cfg.settleDiff + ' kr.';
      default: break;
    }
    if (/^Regel: /.test(b)) {
      var name = b.slice(7);
      var rule = (ctx.rules || []).filter(function (r) { return r.name === name; })[0];
      return 'Treffer din regel «' + name + '»' + (rule ? ': ' + ruleText(rule) : '') + '.';
    }
    var f = (ctx.findings || []).filter(function (x) { return x.title === b && x.ids.indexOf(ctx.id) !== -1; })[0];
    if (f) return f.detail + '.';
    if (b === 'Bonger utenfor åpningstid') return 'Bongen er tatt utenfor åpningstid' + (ctx.ctl ? ' (' + ctx.ctl.openFrom + '–' + ctx.ctl.openTo + ')' : '') + '.';
    return String(reason);
  }

  // ---- diagramdata --------------------------------------------------------------------
  function chartData(items, scanMap) {
    var hours = { count: [], sum: [] }, days = {}, cash = {}, heat = {}, pant = {}, tot = { n: 0, ret: 0 };
    for (var h = 0; h < 24; h++) { hours.count.push(0); hours.sum.push(0); }
    items.forEach(function (it) {
      if (!isSale(it)) return;
      var dt = parseDT(it.endDateTime), hr = Math.floor((mins(dt.time) || 0) / 60), day = dt.date;
      hours.count[hr]++; hours.sum[hr] = round2(hours.sum[hr] + it.totalAmount);
      var d = days[day] || (days[day] = { day: day, count: 0, sum: 0 });
      d.count++; d.sum = round2(d.sum + it.totalAmount);
      var c = cash[it.cashierNumber] || (cash[it.cashierNumber] = { id: String(it.cashierNumber), count: 0, ret: 0 });
      c.count++; if (it.totalAmount < 0) c.ret++;
      tot.n++; if (it.totalAmount < 0) tot.ret++;
      var hm = heat[it.workstationNumber] || (heat[it.workstationNumber] = { id: String(it.workstationNumber), counts: hours.count.map(function () { return 0; }) });
      hm.counts[hr]++;
      var sc = scanMap && scanMap[it.transactionId];
      if (sc) { var p = pant[day] || (pant[day] = { day: day, sale: 0, ret: 0 }); p.sale = round2(p.sale + sc.sale); p.ret = round2(p.ret + Math.abs(sc.ret)); }
    });
    var heatRows = Object.keys(heat).sort(numCmp).map(function (k) { return heat[k]; });
    var max = 0;
    heatRows.forEach(function (r) { r.counts.forEach(function (n) { if (n > max) max = n; }); });
    return {
      hours: hours,
      days: Object.keys(days).sort().map(function (k) { return days[k]; }),
      cashiers: Object.keys(cash).map(function (k) { var c = cash[k]; c.share = c.count ? c.ret / c.count : 0; return c; })
        .sort(function (a, b) { return b.share - a.share || b.count - a.count || numCmp(a.id, b.id); }),
      storeShare: tot.n ? tot.ret / tot.n : 0,
      heat: { rows: heatRows, max: max },
      pant: Object.keys(pant).sort().map(function (k) { return pant[k]; })
    };
  }

  function niceMax(v) {
    if (!(v > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }


  // ---- revisjonstester ---------------------------------------------------------------
  function tsMin(it) {
    var d = parseDT(it.endDateTime);
    return d.date ? Date.parse(d.date + 'T' + d.time + ':00Z') / 60000 : null;
  }

  function realReturn(it, sc) {
    if (!(typeof it.totalAmount === 'number' && it.totalAmount < 0)) return false;
    if (sc && sc.np === 0 && sc.retLines > 0) return false;
    return true;
  }

  function isPantText(l) { return PANT_LINE.test(l.c + ' ' + l.n); }

  // Falsk retur: retur uten salg, kortkjøp refundert kontant, og salg og retur av samme beløp.
  function falseReturns(items, population, scanMap, cfg) {
    if (!hasNum(cfg.falseRet)) return { findings: [], coverage: null };
    var findings = [], win = cnum(cfg.saleReturnMin, 60);
    var idx = {}, sales = [], scannedSales = 0;
    population.forEach(function (it) {
      if (it.receiptType !== 1 || typeof it.totalAmount !== 'number' || it.totalAmount <= 0) return;
      sales.push(it);
      var sc = scanMap && scanMap[it.transactionId];
      if (!sc) return;
      scannedSales++;
      sc.items.forEach(function (l) {
        if (l.a > 0 && !isPantText(l)) groupInto(idx, it.storeNumber + '|' + l.c + '|' + l.a, it);
      });
    });
    var coverage = sales.length ? scannedSales / sales.length : 1;
    var lineCheck = coverage >= 0.8;
    items.forEach(function (r) {
      var sc = scanMap && scanMap[r.transactionId];
      if (!realReturn(r, sc)) return;
      var rt = tsMin(r);
      // salg og retur av samme beløp, samme kasse, kort tid
      var amt = Math.abs(r.totalAmount);
      var twin = sales.filter(function (x) {
        var t = tsMin(x);
        return x.storeNumber === r.storeNumber && x.workstationNumber === r.workstationNumber && Math.abs(x.totalAmount - amt) < 0.005 && t !== null && rt !== null && t <= rt && rt - t <= win;
      })[0];
      if (twin) {
        findings.push({ kind: 'Falsk retur', code: 'saleThenReturn', title: 'Salg og retur av samme beløp', flag: true,
          detail: 'Kasse ' + r.workstationNumber + ': salg ' + parseDT(twin.endDateTime).time + ' og retur ' + parseDT(r.endDateTime).time + ', begge ' + amt + ' kr (kasserer ' + twin.cashierNumber + (twin.cashierNumber !== r.cashierNumber ? ' og ' + r.cashierNumber : '') + ')',
          ids: [r.transactionId, twin.transactionId] });
      }
      if (!sc) return;
      var neg = sc.items.filter(function (l) { return l.a < 0 && !isPantText(l); });
      if (!neg.length) return;
      var unmatched = [], matched = null;
      neg.forEach(function (l) {
        var cands = (idx[r.storeNumber + '|' + l.c + '|' + (-l.a)] || []).filter(function (x) { return x.endDateTime <= r.endDateTime; });
        if (!cands.length) unmatched.push(l);
        else cands.forEach(function (x) { if (!matched || x.endDateTime > matched.endDateTime) matched = x; });
      });
      if (unmatched.length && lineCheck) {
        findings.push({ kind: 'Falsk retur', code: 'returnNoSale', title: 'Retur uten salg', flag: true,
          detail: 'Kasse ' + r.workstationNumber + ' ' + parseDT(r.endDateTime).time + ': retur av ' + unmatched.map(function (l) { return l.n + ' (' + (-l.a) + ' kr)'; }).join(', ') + ' uten tilsvarende salg i datagrunnlaget',
          ids: [r.transactionId] });
      }
      if (matched) {
        var ssc = scanMap[matched.transactionId];
        if (ssc && (ssc.pay['Bank'] || 0) > 0 && (sc.pay['Kontant tilbake'] || 0) > 0) {
          findings.push({ kind: 'Falsk retur', code: 'cardRefundCash', title: 'Kortkjøp refundert kontant', flag: true,
            detail: 'Kasse ' + r.workstationNumber + ' ' + parseDT(r.endDateTime).time + ': ' + sc.pay['Kontant tilbake'] + ' kr utbetalt kontant for vare betalt med kort (salg ' + parseDT(matched.endDateTime).time + ')',
            ids: [r.transactionId, matched.transactionId] });
        }
      }
    });
    return { findings: findings, coverage: coverage, lineCheck: lineCheck };
  }

  // Salg etter kassaoppgjør: salg på en kasse etter dagens siste kassaoppgjør.
  function afterSettlement(items, population, cfg) {
    if (!hasNum(cfg.settleGraceMin)) return [];
    var grace = cnum(cfg.settleGraceMin, 5), setl = {}, g = {};
    var open = mins(cfg.openFrom);
    population.forEach(function (it) {
      if (it.receiptType !== 2) return;
      // oppgjør før åpningstid (f.eks. 00:05) er forrige dags avslutning, ikke starten på denne dagen
      if (open !== null && timeOf(it) !== null && timeOf(it) < open) return;
      groupInto(setl, it.storeNumber + '|' + it.workstationNumber + '|' + dayOf(it), it);
    });
    items.forEach(function (it) {
      if (!isSale(it)) return;
      var k = it.storeNumber + '|' + it.workstationNumber + '|' + dayOf(it), arr = setl[k];
      if (!arr) return;
      var m = timeOf(it), prev = null, later = false;
      arr.forEach(function (x) {
        var xm = timeOf(x);
        if (xm <= m) { if (!prev || xm > timeOf(prev)) prev = x; } else later = true;
      });
      if (!prev || later || m - timeOf(prev) <= grace) return;
      groupInto(g, k, { it: it, prev: prev });
    });
    return Object.keys(g).map(function (k) {
      var arr = g[k], p = k.split('|'), prev = arr[0].prev;
      var sum = round2(arr.reduce(function (a, x) { return a + x.it.totalAmount; }, 0));
      var who = {};
      arr.forEach(function (x) { who[x.it.cashierNumber] = true; });
      return { kind: 'Kassaoppgjør', code: 'afterSettle', title: 'Salg etter kassaoppgjør', flag: true,
        detail: 'Kasse ' + p[1] + ' ' + p[2] + ': ' + arr.length + ' salg (' + sum + ' kr) etter kassaoppgjør kl ' + parseDT(prev.endDateTime).time + ' (oppgjør av kasserer ' + prev.cashierNumber + '; salg av ' + Object.keys(who).join(', ') + ')',
        ids: arr.map(function (x) { return x.it.transactionId; }) };
    });
  }

  // Slettede bonger: hull i bongnummer, bongnummer og tid som ikke stemmer, og dobbelt bongnummer.
  function deletedReceipts(population, cfg) {
    var findings = [], skipped = 0, byK = {};
    var maxGap = cnum(cfg.maxGap, null);
    population.forEach(function (it) {
      var n = seqNum(it.transactionId);
      if (n !== null) groupInto(byK, it.storeNumber + '|' + it.workstationNumber, { n: n, it: it });
    });
    Object.keys(byK).forEach(function (k) {
      var kasse = k.split('|')[1];
      var arr = byK[k].sort(function (a, b) { return a.n - b.n || (a.it.endDateTime < b.it.endDateTime ? -1 : 1); });
      var seen = {}, uniq = [];
      arr.forEach(function (x) {
        if (seen[x.n]) {
          if (seen[x.n].it.transactionId !== x.it.transactionId) {
            findings.push({ kind: 'Slettede bonger', code: 'dupSeq', title: 'Dobbelt bongnummer', flag: true,
              detail: 'Kasse ' + kasse + ': bongnummer ' + x.n + ' finnes to ganger (' + parseDT(seen[x.n].it.endDateTime).time + ' og ' + parseDT(x.it.endDateTime).time + ')',
              ids: [seen[x.n].it.transactionId, x.it.transactionId] });
          }
          return;
        }
        seen[x.n] = x;
        uniq.push(x);
      });
      for (var i = 1; i < uniq.length; i++) {
        var a = uniq[i - 1], b = uniq[i], gap = b.n - a.n - 1;
        if (b.it.endDateTime < a.it.endDateTime) {
          findings.push({ kind: 'Slettede bonger', code: 'timeInversion', title: 'Bongnummer og tid stemmer ikke', flag: true,
            detail: 'Kasse ' + kasse + ': nr ' + b.n + ' kl ' + parseDT(b.it.endDateTime).time + ' kommer etter nr ' + a.n + ' kl ' + parseDT(a.it.endDateTime).time,
            ids: [a.it.transactionId, b.it.transactionId] });
        }
        if (maxGap === null || gap <= 0) continue;
        if (gap > maxGap) { skipped++; continue; }
        findings.push({ kind: 'Slettede bonger', code: 'gap', title: 'Hull i bongnummer', flag: true,
          detail: 'Kasse ' + kasse + ': mangler ' + (a.n + 1) + (gap > 1 ? '–' + (b.n - 1) : '') + ' (' + gap + ') mellom kl ' + parseDT(a.it.endDateTime).time + ' og ' + parseDT(b.it.endDateTime).time + ' ' + parseDT(b.it.endDateTime).date,
          ids: [a.it.transactionId, b.it.transactionId], missing: gap });
      }
    });
    return { findings: findings, skippedGaps: skipped };
  }

  // Kassadifferanse over tid per kasserer og kasse.
  function diffTrend(items, scanMap, cfg) {
    var min = cnum(cfg.diffMin, 1), repN = cnum(cfg.diffRepeatN, null), total = cnum(cfg.diffTotal, null);
    var acc = {}, findings = [];
    items.forEach(function (it) {
      var sc = scanMap && scanMap[it.transactionId];
      if (it.receiptType !== 2 || !sc || !sc.settle) return;
      var d = sc.settle.diff.sum || 0;
      [['kasserer', it.cashierNumber], ['kasse', it.workstationNumber]].forEach(function (g) {
        var key = g[0] + '|' + g[1];
        var e = acc[key] || (acc[key] = { kind: g[0], id: String(g[1]), n: 0, minus: 0, plus: 0, sumMinus: 0, sumPlus: 0, net: 0, days: {}, list: [], ids: [] });
        e.n++; e.net += d;
        if (d <= -min) { e.minus++; e.sumMinus += d; e.days[dayOf(it)] = true; e.ids.push(it.transactionId); }
        if (d >= min) { e.plus++; e.sumPlus += d; }
        e.list.push({ day: dayOf(it), diff: d });
      });
    });
    var rows = Object.keys(acc).map(function (k) { return acc[k]; }).map(function (e) {
      e.sumMinus = round2(e.sumMinus); e.sumPlus = round2(e.sumPlus); e.net = round2(e.net);
      e.list.sort(function (a, b) { return a.day < b.day ? -1 : 1; });
      e.flag = (repN !== null && e.minus >= repN && Object.keys(e.days).length >= 2) || (total !== null && e.sumMinus <= -total);
      if (e.flag) {
        findings.push({ kind: 'Kassadifferanse', code: 'diffRepeat', title: 'Gjentatte kassadifferanser', flag: true,
          detail: (e.kind === 'kasserer' ? 'Kasserer ' : 'Kasse ') + e.id + ': ' + e.minus + ' av ' + e.n + ' oppgjør med minus, totalt ' + e.sumMinus + ' kr',
          ids: e.ids.slice(), cashier: e.kind === 'kasserer' ? e.id : null });
      }
      return e;
    }).sort(function (a, b) { return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.sumMinus - b.sumMinus || numCmp(a.id, b.id); });
    return { rows: rows, findings: findings };
  }

  // Benford (første siffer) og runde beløp.
  function firstDigit(x) {
    var t = Math.abs(x).toFixed(2).replace('.', '').replace(/^0+/, '');
    return t ? Number(t.charAt(0)) : 0;
  }

  function benfordStats(amounts) {
    var counts = [0, 0, 0, 0, 0, 0, 0, 0, 0], n = 0;
    amounts.forEach(function (x) { var d = firstDigit(x); if (d >= 1) { counts[d - 1]++; n++; } });
    var expected = counts.map(function (_, i) { return Math.log10(1 + 1 / (i + 1)); });
    var actual = counts.map(function (c) { return n ? c / n : 0; });
    var mad = n ? actual.reduce(function (a, v, i) { return a + Math.abs(v - expected[i]); }, 0) / 9 : 0;
    var verdict = mad <= 0.006 ? 'nær Benford' : mad <= 0.012 ? 'akseptabel' : mad <= 0.015 ? 'marginal' : 'avviker';
    return { n: n, counts: counts, actual: actual, expected: expected, mad: mad, verdict: verdict };
  }

  function numbers(items, scanMap, cfg) {
    var minAll = cnum(cfg.benfordMin, 100), minCash = cnum(cfg.benfordCashMin, 50), madLimit = cnum(cfg.benfordMad, 0.015);
    var rShare = cnum(cfg.roundShare, null), rMin = cnum(cfg.roundMinN, 20);
    var sales = items.filter(function (it) { return isSale(it) && it.totalAmount > 0; });
    var overall = benfordStats(sales.map(function (it) { return it.totalAmount; }));
    overall.enough = overall.n >= minAll;
    var by = {};
    sales.forEach(function (it) { groupInto(by, String(it.cashierNumber), it); });
    var round = function (arr) { return arr.length ? arr.filter(function (it) { return Math.round(it.totalAmount * 100) % 100 === 0; }).length / arr.length : 0; };
    var storeRound = round(sales), findings = [];
    var cashiers = Object.keys(by).sort(numCmp).map(function (id) {
      var arr = by[id], b = benfordStats(arr.map(function (it) { return it.totalAmount; }));
      var row = { id: id, n: arr.length, mad: b.mad, verdict: b.verdict, roundShare: round(arr), flagBenford: false, flagRound: false };
      if (b.n >= minCash && b.mad > madLimit) {
        row.flagBenford = true;
        findings.push({ kind: 'Tallanalyse', code: 'benford', title: 'Avvikende sifferfordeling', flag: false, cashier: id, ids: [],
          detail: 'Kasserer ' + id + ': første siffer i totalbeløp avviker fra Benford (MAD ' + b.mad.toFixed(3) + ', ' + b.n + ' bonger)' });
      }
      if (rShare !== null && arr.length >= rMin && row.roundShare * 100 >= rShare && row.roundShare >= 2 * storeRound) {
        row.flagRound = true;
        findings.push({ kind: 'Tallanalyse', code: 'round', title: 'Mange runde beløp', flag: false, cashier: id, ids: [],
          detail: 'Kasserer ' + id + ': ' + Math.round(row.roundShare * 100) + ' % av totalene er hele kroner (butikk ' + Math.round(storeRound * 100) + ' %, ' + arr.length + ' bonger)' });
      }
      return row;
    });
    return { overall: overall, cashiers: cashiers, storeRound: storeRound, findings: findings };
  }

  // Rabatter og kuponger. «Rabatt: Kr x (y %)» på en varelinje er butikkens egen rabatt (årsak er oftest tom);
  // «Kupong (id - navn)» er kampanjer lagt inn sentralt. Bare v3-skanninger har rabattdata.
  function discounts(items, scanMap, cfg) {
    var pctMin = cnum(cfg.discPct, null), cashCmp = hasNum(cfg.discCash), f = cnum(cfg.profFactor, 1.5), minN = cnum(cfg.profMin, 5);
    var fresh = function () { return { n: 0, withDisc: 0, disc: 0, withNR: 0, nr: 0, withCpn: 0, cpn: 0, cpnSum: 0 }; };
    var acc = {}, tot = fresh(), camps = {}, findings = [], scannedSales = 0, sales = 0, reasons = {}, matrix = {};
    items.forEach(function (it) {
      if (!isSale(it)) return;
      sales++;
      var sc = scanMap && scanMap[it.transactionId];
      if (!hasDisc(sc)) return;
      scannedSales++;
      var a = acc[it.cashierNumber] || (acc[it.cashierNumber] = fresh());
      [a, tot].forEach(function (x) {
        x.n++;
        if (sc.discN) { x.withDisc++; x.disc += sc.disc; }
        if (sc.discNR) { x.withNR++; x.nr += sc.discNRsum; }
        if (sc.coupons.length) { x.withCpn++; x.cpn += sc.coupons.length; x.cpnSum += couponSum(sc); }
      });
      sc.items.forEach(function (l) {
        if (!l.d) return;
        var rn = reasonName(l.dr);
        var e = reasons[rn] || (reasons[rn] = { name: rn, lines: 0, bongs: {}, sum: 0, pctSum: 0, pctN: 0 });
        e.lines++; e.bongs[it.transactionId] = true; e.sum = round2(e.sum + l.d);
        if (l.dp) { e.pctSum += l.dp; e.pctN++; }
        var m = matrix[it.cashierNumber] || (matrix[it.cashierNumber] = {});
        m[rn] = (m[rn] || 0) + 1;
      });
      sc.coupons.forEach(function (c) {
        var e = camps[c.i] || (camps[c.i] = { id: c.i, name: c.n, n: 0, sum: 0 });
        e.n++; e.sum = round2(e.sum + (c.a || 0));
      });
      if (pctMin !== null) {
        var hits = sc.items.filter(function (l) { return l.d && !l.dr && (l.dp || 0) >= pctMin; });
        if (hits.length) {
          findings.push({ kind: 'Rabatt', code: 'discNoReason', title: 'Rabatt uten årsak', flag: true,
            detail: 'Kasse ' + it.workstationNumber + ' ' + parseDT(it.endDateTime).time + ' kasserer ' + it.cashierNumber + ': ' +
              hits.map(function (l) { return l.n + ' −' + l.d + ' kr (' + (l.dp || '?') + ' %)'; }).join(', ') + ' uten rabattårsak',
            ids: [it.transactionId] });
        }
      }
    });
    var shareOf = function (x) { return x.n ? x.withNR / x.n : 0; };
    var storeShare = shareOf(tot);
    var rows = Object.keys(acc).sort(numCmp).map(function (id) {
      var x = acc[id];
      var row = { id: id, n: x.n, withDisc: x.withDisc, disc: round2(x.disc), withNR: x.withNR, nr: round2(x.nr), withCpn: x.withCpn, cpn: x.cpn, cpnSum: round2(x.cpnSum),
        share: shareOf(x), flag: false };
      if (cashCmp && x.n >= minN && x.withNR >= 2 && storeShare > 0 && row.share >= storeShare * f) {
        row.flag = true;
        findings.push({ kind: 'Rabatt', code: 'discCash', title: 'Mange rabatter uten årsak', flag: false, cashier: id, ids: [],
          detail: 'Kasserer ' + id + ': ' + Math.round(row.share * 100) + ' % av bongene har rabatt uten årsak (butikk ' + Math.round(storeShare * 100) + ' %, ' + x.n + ' bonger)' });
      }
      return row;
    });
    var order = DISC_REASONS.concat([NO_REASON]);
    var reasonRows = Object.keys(reasons).map(function (k) {
      var e = reasons[k];
      return { name: e.name, lines: e.lines, bongs: Object.keys(e.bongs).length, sum: e.sum, avgPct: e.pctN ? round2(e.pctSum / e.pctN) : null, known: DISC_REASONS.indexOf(e.name) !== -1 };
    }).sort(function (a, b) {
      var ia = order.indexOf(a.name), ib = order.indexOf(b.name);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || b.lines - a.lines;
    });
    var cols = reasonRows.map(function (r) { return r.name; });
    var matrixRows = Object.keys(matrix).sort(numCmp).map(function (id) { return { id: id, counts: matrix[id] }; });
    var campRows = Object.keys(camps).map(function (k) { return camps[k]; }).sort(function (a, b) { return b.n - a.n || String(a.id).localeCompare(String(b.id)); });
    return { rows: rows, total: { n: tot.n, withDisc: tot.withDisc, disc: round2(tot.disc), withNR: tot.withNR, nr: round2(tot.nr), withCpn: tot.withCpn, cpn: tot.cpn, cpnSum: round2(tot.cpnSum), share: storeShare },
      campaigns: campRows, reasons: reasonRows, matrix: { cols: cols, rows: matrixRows }, findings: findings, coverage: sales ? scannedSales / sales : 1, sales: sales, scanned: scannedSales };
  }

  // Periode mot periode.
  function periodStats(items, scanMap, anomMap, weights) {
    var s = { count: 0, sum: 0, ret: 0, pos: 0, posSum: 0, scanned: 0, lapper: 0, score: 0, anom: 0 };
    items.forEach(function (it) {
      var r = anomMap && anomMap[it.transactionId];
      if (r && r.length) { s.anom++; s.score += riskScore(r, weights); }
      if (!isSale(it)) return;
      s.count++; s.sum += it.totalAmount;
      if (it.totalAmount < 0) s.ret++;
      if (it.totalAmount > 0) { s.pos++; s.posSum += it.totalAmount; }
      var sc = scanMap && scanMap[it.transactionId];
      if (sc) { s.scanned++; s.lapper += sc.retLines || 0; }
    });
    return { count: s.count, sum: round2(s.sum), retShare: s.count ? s.ret / s.count : 0, avg: s.pos ? round2(s.posSum / s.pos) : 0,
      lapperPer: s.scanned ? s.lapper / s.scanned : 0, score: round2(s.score), anom: s.anom };
  }

  function comparePeriods(itemsA, itemsB, scanMap, anomMap, weights, cfg) {
    var factor = cnum(cfg.profFactor, 1.5), minN = cnum(cfg.profMin, 5);
    var ids = {};
    itemsA.concat(itemsB).forEach(function (it) { ids[it.cashierNumber] = true; });
    var rows = Object.keys(ids).sort(numCmp).map(function (id) {
      var a = periodStats(itemsA.filter(function (it) { return String(it.cashierNumber) === id; }), scanMap, anomMap, weights);
      var b = periodStats(itemsB.filter(function (it) { return String(it.cashierNumber) === id; }), scanMap, anomMap, weights);
      var dRet = b.retShare - a.retShare, dScore = b.score - a.score;
      var enough = a.count >= minN && b.count >= minN;
      var flags = [];
      if (enough && dRet >= 0.1) flags.push('returandel +' + Math.round(dRet * 100) + ' poeng');
      if (enough && a.avg > 0 && (b.avg >= a.avg * factor || (b.avg > 0 && b.avg <= a.avg / factor))) flags.push('snittbeløp ' + (b.avg > a.avg ? 'opp' : 'ned'));
      if (dScore >= 5) flags.push('risikoscore +' + round2(dScore));
      return { id: id, A: a, B: b, dRet: dRet, dScore: round2(dScore), flags: flags, flagged: flags.length > 0 };
    });
    return { total: { A: periodStats(itemsA, scanMap, anomMap, weights), B: periodStats(itemsB, scanMap, anomMap, weights) }, rows: rows };
  }

  function relativeRange(name, now) {
    var d = now || new Date(), day = 864e5, a = d, b = d;
    if (name === 'yesterday') { a = b = new Date(d.getTime() - day); }
    else if (name === 'last7') { a = new Date(d.getTime() - 7 * day); b = new Date(d.getTime() - day); }
    else if (name === 'thismonth') { a = new Date(d.getFullYear(), d.getMonth(), 1); b = d; }
    else if (name === 'lastmonth') { a = new Date(d.getFullYear(), d.getMonth() - 1, 1); b = new Date(d.getFullYear(), d.getMonth(), 0); }
    else if (name === 'lastweek') {
      var dow = (d.getDay() + 6) % 7;
      var monThis = new Date(d.getTime() - dow * day);
      a = new Date(monThis.getTime() - 7 * day); b = new Date(monThis.getTime() - day);
    }
    return { dateFrom: ymd(a), dateTo: ymd(b) };
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function quickRange(name, now) {
    var d = now || new Date();
    var r = { dateFrom: '', dateTo: '', timeFrom: '', timeTo: '' };
    if (name === 'today') { r.dateFrom = r.dateTo = ymd(d); }
    else if (name === 'yesterday') { var y = new Date(d.getTime() - 864e5); r.dateFrom = r.dateTo = ymd(y); }
    else if (name === 'last24h') {
      var s = new Date(d.getTime() - 864e5);
      r.dateFrom = ymd(s); r.dateTo = ymd(d); r.timeFrom = ''; r.timeTo = '';
    }
    else if (name === 'night') { r.timeFrom = '00:00'; r.timeTo = '05:59'; }
    else if (name === 'day') { r.timeFrom = '06:00'; r.timeTo = '17:59'; }
    else if (name === 'evening') { r.timeFrom = '18:00'; r.timeTo = '23:59'; }
    return r;
  }

  function sanitizeFilters(raw) {
    var base = defaultFilters();
    if (!raw || typeof raw !== 'object') return base;
    Object.keys(base).forEach(function (k) {
      if (!(k in raw)) return;
      if (Array.isArray(base[k])) base[k] = Array.isArray(raw[k]) ? raw[k].map(String) : [];
      else if (typeof base[k] === 'boolean') base[k] = !!raw[k];
      else base[k] = String(raw[k]);
    });
    return base;
  }

  function activeCount(f) {
    var d = defaultFilters();
    return Object.keys(d).filter(function (k) {
      if (k === 'sort') return false;
      return Array.isArray(d[k]) ? f[k].length > 0 : f[k] !== d[k];
    }).length;
  }

  var api = {
    TYPE_LABELS: TYPE_LABELS,
    typeLabel: typeLabel,
    parseDT: parseDT,
    defaultFilters: defaultFilters,
    matches: matches,
    compare: compare,
    findDuplicates: findDuplicates,
    sumSelected: sumSelected,
    parseReceipt: parseReceipt,
    discounts: discounts,
    DISC_REASONS: DISC_REASONS,
    reasonName: reasonName,
    hasDisc: hasDisc,
    couponSum: couponSum,
    CONTROL_FIELDS: CONTROL_FIELDS,
    defaultControl: defaultControl,
    sanitizeControl: sanitizeControl,
    profiles: profiles,
    patterns: patterns,
    pantCheck: pantCheck,
    sequence: sequence,
    reconcile: reconcile,
    relativeRange: relativeRange,
    falseReturns: falseReturns,
    afterSettlement: afterSettlement,
    deletedReceipts: deletedReceipts,
    diffTrend: diffTrend,
    benfordStats: benfordStats,
    firstDigit: firstDigit,
    numbers: numbers,
    comparePeriods: comparePeriods,
    periodStats: periodStats,
    RISK_WEIGHTS: RISK_WEIGHTS,
    sanitizeWeights: sanitizeWeights,
    reasonBase: reasonBase,
    reasonWeight: reasonWeight,
    riskScore: riskScore,
    riskLevel: riskLevel,
    rankReceipts: rankReceipts,
    rankCashiers: rankCashiers,
    explainReason: explainReason,
    ruleText: ruleText,
    chartData: chartData,
    niceMax: niceMax,
    focusStats: focusStats,
    mins: mins,
    parseSettlement: parseSettlement,
    report: report,
    RULE_FIELDS: RULE_FIELDS,
    RULE_OPS: RULE_OPS,
    evalRule: evalRule,
    sanitizeCustom: sanitizeCustom,
    classify: classify,
    groupsOfScan: groupsOfScan,
    groupSums: groupSums,
    unmatched: unmatched,
    defaultRules: defaultRules,
    sanitizeRules: sanitizeRules,
    NO_GROUP: NO_GROUP,
    defaultAnom: defaultAnom,
    sanitizeAnom: sanitizeAnom,
    anomalies: anomalies,
    storeLabel: storeLabel,
    parseStoreText: parseStoreText,
    toCsv: toCsv,
    parseAmount: parseAmount,
    sumPant: sumPant,
    quickRange: quickRange,
    sanitizeFilters: sanitizeFilters,
    activeCount: activeCount
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KvLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
