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
      bong: '',
      item: '',
      groups: [],
      onlyAnom: false,
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
    if (f.onlyAnom && !(ctx && ctx.anom && ctx.anom[item.transactionId] && ctx.anom[item.transactionId].length)) return false;
    if (f.pant) {
      var info = ctx && ctx.scan && ctx.scan[item.transactionId];
      if (!info) return false;
      if (f.pant === 'any' && !(info.sale !== 0 || info.ret !== 0)) return false;
      if (f.pant === 'sale' && !(info.sale > 0)) return false;
      if (f.pant === 'return' && !(info.ret < 0)) return false;
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
    var t = String(text || '').replace(/[\s\u00a0]/g, '').replace(',', '.');
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

  function parseReceipt(rows) {
    var items = [], pay = {}, last = null;
    var sale = 0, ret = 0, saleLines = 0, retLines = 0, np = 0;
    (rows || []).forEach(function (cells) {
      if (!cells || !cells.length) return;
      var c0 = String(cells[0] || '').trim();
      var q = QTY_ROW.exec(c0);
      if (q) { if (last) last.q = parseAmount(q[1].replace(',', '.')); return; }
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
      } else np++;
    });
    return { v: 2, items: items, pay: pay, np: np, sale: round2(sale), ret: round2(ret), saleLines: saleLines, retLines: retLines };
  }

  function sumPant(items, scanMap) {
    var sale = 0, ret = 0, scanned = 0;
    items.forEach(function (it) {
      var p = scanMap && scanMap[it.transactionId];
      if (!p) return;
      scanned++; sale += p.sale; ret += p.ret;
    });
    return { sale: round2(sale), ret: round2(ret), net: round2(sale + ret), scanned: scanned, total: items.length };
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
    return { bigReturn: '300', manyLapper: '8', roundMin: '500', cashNoSale: true };
  }

  function sanitizeAnom(raw) {
    var d = defaultAnom();
    if (!raw || typeof raw !== 'object') return d;
    ['bigReturn', 'manyLapper', 'roundMin'].forEach(function (k) { if (k in raw) d[k] = String(raw[k]); });
    if ('cashNoSale' in raw) d.cashNoSale = !!raw.cashNoSale;
    return d;
  }

  function anomalies(item, scan, cfg) {
    var out = [];
    if (hasNum(cfg.roundMin) && typeof item.totalAmount === 'number') {
      var cents = Math.round(Math.abs(item.totalAmount) * 100);
      if (cents >= Number(cfg.roundMin) * 100 && cents % 10000 === 0) out.push('Rundt beløp');
    }
    if (scan) {
      if (hasNum(cfg.bigReturn) && Math.abs(scan.ret) >= Number(cfg.bigReturn)) out.push('Stor panteretur (' + Math.abs(scan.ret) + ' kr)');
      if (hasNum(cfg.manyLapper) && scan.retLines >= Number(cfg.manyLapper)) out.push('Mange pantelapper (' + scan.retLines + ')');
      if (cfg.cashNoSale && scan.np === 0 && scan.retLines > 0 && (scan.pay['Kontant tilbake'] || 0) > 0) out.push('Kontant tilbake uten salg');
    }
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
