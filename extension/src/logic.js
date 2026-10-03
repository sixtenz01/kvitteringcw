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

  var OSLO = null;
  function osloParts(d) {
    try {
      OSLO = OSLO || new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
      return OSLO.format(d);
    } catch (e) { return ''; }
  }

  // Klokkeslett fra CW som lokal tid (Europe/Oslo): «ÅÅÅÅ-MM-DD TT:MM» (med :SS hvis kilden har sekunder).
  // Tekst uten tidssone regnes som lokal tid. Tekst med Z eller +hh:mm (og Date) er et tidspunkt som flyttes til norsk tid.
  function localDT(raw) {
    if (raw instanceof Date) return isNaN(raw.getTime()) ? '' : osloParts(raw);
    var m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(String(raw === null || raw === undefined ? '' : raw).trim());
    if (!m) return raw === null || raw === undefined ? '' : String(raw);
    var plain = m[1] + ' ' + m[2] + ':' + m[3] + (m[4] ? ':' + m[4] : '');
    if (!m[5]) return plain;
    var off = m[5] === 'Z' ? 'Z' : m[5].replace(/^([+-]\d{2}):?(\d{2})$/, '$1:$2');
    var d = new Date(m[1] + 'T' + m[2] + ':' + m[3] + ':' + (m[4] || '00') + off);
    var out = isNaN(d.getTime()) ? '' : osloParts(d);
    return out ? (m[4] ? out : out.slice(0, 16)) : plain;
  }

  // Legger minutter til «ÅÅÅÅ-MM-DD TT:MM[:SS]» uten å bry seg om tidssone.
  function shiftDT(str, minutes) {
    var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(str || ''));
    if (!m || !minutes) return String(str || '');
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5] + Number(minutes), +(m[6] || 0)));
    var iso = d.toISOString();
    return iso.slice(0, 10) + ' ' + iso.slice(11, m[6] ? 19 : 16);
  }

  function dtMin(str) {
    var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(String(str || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000 : null;
  }

  // Dato og klokkeslett slik de vises i CW-listen, for eksempel «02.10.2026 22:04:15» eller «2026-10-02 22:04».
  function parseCellDT(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim(), m;
    if ((m = /(\d{1,2})[.\/](\d{1,2})[.\/](\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(t))) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) + ' ' + ('0' + m[4]).slice(-2) + ':' + m[5] + ':' + (m[6] || '00');
    if ((m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(t))) return m[1] + '-' + m[2] + '-' + m[3] + ' ' + ('0' + m[4]).slice(-2) + ':' + m[5] + ':' + (m[6] || '00');
    return '';
  }

  // Dato og tid i bongens topptekst: «Kvittering: 2371 02.10.2026 22:04:15».
  function headerDT(text) {
    var m = /Kvittering:\s*\d+\s+(\d{1,2}[.\/]\d{1,2}[.\/]\d{4}|\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}(?::\d{2})?)/i.exec(String(text || ''));
    return m ? parseCellDT(m[1] + ' ' + m[2]) : '';
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

  // Medlemsnummer som tekst. Gridet kan gi tekst, tall eller et objekt.
  function memberKey(item) {
    if (!hasMember(item)) return '';
    var m = item.memberNumber;
    if (typeof m === 'object') m = m.number || m.memberNumber || m.id || JSON.stringify(m);
    return String(m).trim();
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
  // Hendelser vi aldri har sett på en bong, men som bør oppdages når de dukker opp (kun tekstlinjer, ikke varenavn).
  var EVENT_WORDS = /(annull|makul|storn|parker|på\s*vent|manuell|sp[øo]r\s*pris|overstyr|prisendring|kansell|avbrut)/i;
  var KNOWN_LABEL = /^(beskrivelse|totalt|sum|subtotal|mva|grunnlag|kj[øo]p|[øo]reavrunding|referanse|transid|retur vare|dato|tid)/i;

  // v4: enhetspris (p) på varelinjer, Kjøpeutbytte-tabell (ku), hendelsesord (ev) og ukjente linjer (unk).
  function parseReceipt(rows) {
    var items = [], pay = {}, last = null, coupons = [], ev = [], unk = [], ku = null, kuCols = null;
    var sale = 0, ret = 0, saleLines = 0, retLines = 0, np = 0, neg = 0;
    var note = function (c0) {
      var t = c0.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
      if (!t || /^[#.:\-\/ ]*$/.test(t) || KNOWN_LABEL.test(t)) return;
      t = t.slice(0, 40);
      if (unk.length < 8 && unk.indexOf(t) === -1) unk.push(t);
    };
    var other = function (c0, cells) {
      var all = cells.join(' ').replace(/\s+/g, ' ').trim();
      var m = EVENT_WORDS.exec(all);
      if (m && ev.length < 6) { var rec = { k: m[1].toLowerCase().replace(/\s+/g, ' '), t: all.slice(0, 80) }; if (!ev.some(function (e) { return e.t === rec.t; })) ev.push(rec); }
      note(c0);
    };
    (rows || []).forEach(function (cells) {
      if (!cells || !cells.length) return;
      var c0 = String(cells[0] || '').trim();
      if (kuCols) {
        var nk = cells.map(function (c) { return parseAmount(c); });
        if (nk.filter(function (n) { return n !== null; }).length >= 2 && nk[0] !== null) {
          if (kuCols.g >= 0 && nk[kuCols.g] !== null) ku.g = round2(ku.g + nk[kuCols.g]);
          if (kuCols.k >= 0 && nk[kuCols.k] !== null) ku.k = round2(ku.k + nk[kuCols.k]);
          if (kuCols.m >= 0 && nk[kuCols.m] !== null) ku.m = round2(ku.m + nk[kuCols.m]);
          return;
        }
        kuCols = null;
      }
      if (/^Grunnlag$/i.test(c0) && cells.some(function (c) { return /kj[øo]p.*utbytte/i.test(c); })) {
        kuCols = { g: 0, k: -1, m: -1 };
        cells.forEach(function (c, i) { if (/kj[øo]p.*utbytte/i.test(c)) kuCols.k = i; else if (/mva/i.test(c)) kuCols.m = i; });
        ku = ku || { g: 0, k: 0, m: 0 };
        return;
      }
      var q = QTY_ROW.exec(c0);
      if (q) { if (last) { last.q = parseAmount(q[1].replace(',', '.')); last.p = parseAmount(q[2].replace(',', '.')); } return; }
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
      if (cells.length < 2) { other(c0, cells); return; }
      if (parseAmount(c0) !== null) return;
      var amount = lastAmount(cells);
      if (amount === null) { other(c0, cells); return; }
      if (/:\s*$/.test(c0)) {
        var label = c0.replace(/:\s*$/, '');
        pay[label] = round2((pay[label] || 0) + amount);
        last = null;
        return;
      }
      var m = ITEM_ROW.exec(c0);
      if (!m) { other(c0, cells); return; }
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
    var out = { v: 4, items: items, pay: pay, np: np, neg: neg, sale: round2(sale), ret: round2(ret), saleLines: saleLines, retLines: retLines,
      disc: round2(disc), discN: discN, discNR: discNR, discNRsum: round2(discNRsum), coupons: coupons };
    if (ku) out.ku = ku;
    if (ev.length) out.ev = ev;
    if (unk.length) out.unk = unk;
    return out;
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

  // Overvåkede rabattårsaker fra terskelfeltet (tekstnr eller tekst, adskilt med komma).
  function watchReasons(cfg) {
    var out = [];
    String((cfg && cfg.discWatch) || '').split(/[,;]+/).forEach(function (t) {
      t = t.trim();
      if (!t) return;
      var n = reasonName(t);
      if (DISC_REASONS.indexOf(n) !== -1 && out.indexOf(n) === -1) out.push(n);
    });
    return out;
  }

  // Rabattdata finnes først fra v3; eldre skanninger må skannes på nytt.
  function hasDisc(sc) { return !!sc && sc.v >= 3; }
  // Enhetspris, Kjøpeutbytte, hendelsesord og ukjente linjer finnes først fra v4.
  function hasV4(sc) { return !!sc && sc.v >= 4 && !sc.settle; }
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
    ['discPct', 'Rabatt uten årsak ≥ % (tom = av)', '30'], ['discCash', 'Rabatt: sammenlign kasserere (tom = av)', '1'],
    ['discWatch', 'Overvåkede rabattårsaker (tekstnr, tom = av)', '2,4,5'], ['discWatchPct', 'Overvåket: rabatt ≥ %', '0'],
    ['discWatchKr', 'Overvåket: rabatt ≥ kr', '0'], ['discWatchN', 'Overvåket: kasserer ved ≥ antall bonger (tom = av)', '3'],
    ['memberStoreMin', 'Medlem i to butikker innen min (tom = av)', '30'], ['memberDayN', 'Samme medlemsnr samme dag ≥ antall (tom = av)', '4'],
    ['memberN', 'Samme medlemsnr totalt ≥ antall (tom = av)', '15'], ['memberCashN', 'Medlemsnr hos én kasserer ≥ antall (tom = av)', '5'],
    ['memberCashShare', 'Medlemsnr hos én kasserer: andel % over', '80'], ['empMembers', 'Ansattes medlemsnr (tom = av)', ''],
    ['priceDevPct', 'Pris avviker fra vanlig pris ≥ % (tom = av)', '10'], ['priceMinN', 'Pris: minst antall salg av varen per butikk og dag', '5'],
    ['priceCashN', 'Pris: kasserer ved ≥ antall avvik (tom = av)', '3'],
    ['kuMissing', 'Medlem uten kjøpeutbytte (tom = av)', '1'], ['kuDiffPct', 'Kjøpeutbytte-grunnlag avviker ≥ % (tom = av)', '25'], ['kuDiffKr', 'Kjøpeutbytte-grunnlag avviker ≥ kr', '20'],
    ['evOn', 'Hendelsesord på bong (tom = av)', '1']
  ];

  // Innstillinger gruppert per test (brukes av Innstillinger-siden).
  // src: 'ctl' (kontrolltersklene) eller 'anom' (avvik per bong). kind: num | time | text | flag.
  // off: tom verdi slår testen av, og vises som av/på.
  function sf(k, src, kind, label, unit, hint, off) { return { k: k, src: src, kind: kind, label: label, unit: unit || '', hint: hint || '', off: !!off }; }

  var SETTING_GROUPS = [
    { id: 'bong', title: 'Avvik per bong', text: 'Sjekkes på hver enkelt kvittering.', fields: [
      sf('bigReturn', 'anom', 'num', 'Stor panteretur fra', 'kr', 'Utbetalt panteretur på én bong.', true),
      sf('manyLapper', 'anom', 'num', 'Mange pantelapper fra', 'stk', 'Antall pantelapper på én bong.', true),
      sf('roundMin', 'anom', 'num', 'Rundt beløp fra', 'kr', 'Totalen er et helt hundre-beløp på minst dette.', true),
      sf('settleDiff', 'anom', 'num', 'Kassadifferanse fra', 'kr', 'Differanse i ett kassaoppgjør.', true),
      sf('cashNoSale', 'anom', 'flag', 'Kontant tilbake uten salg', '', 'Bongen har bare pantelapper og kontant tilbake.')
    ], weights: ['Stor panteretur', 'Mange pantelapper', 'Kontant tilbake uten salg', 'Rundt beløp', 'Kassadifferanse'] },
    { id: 'patterns', title: 'Mønstre på tvers av bonger', text: 'Gjentakelser som er vanlige ved misbruk.', fields: [
      sf('smallReturnN', 'ctl', 'num', 'Små returer før stenging: flagg ved', 'stk', 'Antall små returer på samme kasse rett før stenging.', true),
      sf('smallReturn', 'ctl', 'num', 'Liten retur er opptil', 'kr'),
      sf('closeTime', 'ctl', 'time', 'Stengetid', 'HH:MM'),
      sf('closeWindow', 'ctl', 'num', 'Tidsrom før stenging', 'min'),
      sf('cashNoSaleN', 'ctl', 'num', 'Kontant tilbake uten salg: flagg ved', 'stk', 'Gjentatt samme dag på samme kasse.', true),
      sf('repeatN', 'ctl', 'num', 'Samme beløp gjentatt: flagg ved', 'stk', 'Samme bongsum flere ganger på samme kasse.', true),
      sf('repeatMin', 'ctl', 'num', 'Gjentatt beløp er minst', 'kr')
    ], weights: ['Små returer før stenging', 'Kontant tilbake uten salg flere ganger', 'Samme beløp gjentatt'] },
    { id: 'falseRet', title: 'Falsk retur', text: 'Retur uten salg, kortkjøp refundert kontant og salg og retur av samme beløp.', fields: [
      sf('falseRet', 'ctl', 'flag', 'Test på', '', 'Retur uten salg krever at minst 80 % av salgene er skannet.'),
      sf('saleReturnMin', 'ctl', 'num', 'Salg og retur av samme beløp innen', 'min')
    ], weights: ['Retur uten salg', 'Kortkjøp refundert kontant', 'Salg og retur av samme beløp'] },
    { id: 'afterSettle', title: 'Salg etter kassaoppgjør', text: 'Salg på en kasse etter dagens siste kassaoppgjør. Oppgjør før åpningstid regnes som forrige dag.', fields: [
      sf('settleGraceMin', 'ctl', 'num', 'Frist etter oppgjør', 'min', 'Salg innenfor fristen flagges ikke.', true)
    ], weights: ['Salg etter kassaoppgjør'] },
    { id: 'deleted', title: 'Slettede bonger (bongnummer)', text: 'Hull, dobbelte og feil rekkefølge i bongnummer. Gjelder bare hvis CW-listen ikke er filtrert på type, kasse eller tid.', fields: [
      sf('maxGap', 'ctl', 'num', 'Størst hull som regnes som slettede bonger', 'stk', 'Større hull hoppes over, de skyldes oftest filtrering.', true)
    ], weights: ['Hull i bongnummer', 'Bongnummer og tid stemmer ikke', 'Dobbelt bongnummer'] },
    { id: 'diff', title: 'Kassadifferanse over tid', text: 'Gjentatte minusdifferanser per kasserer og kasse.', fields: [
      sf('diffMin', 'ctl', 'num', 'Differanser telles fra', 'kr'),
      sf('diffRepeatN', 'ctl', 'num', 'Minus i minst', 'oppgjør', 'Fordelt på minst to dager.', true),
      sf('diffTotal', 'ctl', 'num', 'Eller minus totalt over', 'kr', '', true)
    ], weights: ['Gjentatte kassadifferanser'] },
    { id: 'numbers', title: 'Tallanalyse', text: 'Benford (første siffer i totalbeløp) og andel hele kroner. Indikasjon, ikke bevis.', fields: [
      sf('benfordMin', 'ctl', 'num', 'Benford: minst antall bonger', 'stk'),
      sf('benfordCashMin', 'ctl', 'num', 'Benford: minst per kasserer', 'stk'),
      sf('benfordMad', 'ctl', 'num', 'Benford: avvik (MAD) over', '', 'Nigrini: over 0,015 er avvikende.'),
      sf('roundShare', 'ctl', 'num', 'Hele kroner: andel over', '%', '', true),
      sf('roundMinN', 'ctl', 'num', 'Hele kroner: minst antall bonger', 'stk')
    ], weights: ['Avvikende sifferfordeling', 'Mange runde beløp'] },
    { id: 'disc', title: 'Rabatt', text: 'Rabatt uten årsak, overvåkede årsaker (tekstnr 1 Datovare, 2 Feil pris, 3 Prisløfte, 4 Reserveløsning kupong, 5 Annen rabattårsak, 6 Best før) og sammenligning av kasserere.', fields: [
      sf('discPct', 'ctl', 'num', 'Rabatt uten årsak fra', '%', 'Flagger bongen når en rabattlinje uten årsak er minst dette.', true),
      sf('discCash', 'ctl', 'flag', 'Sammenlign kasserere (rabatt uten årsak)', '', 'Markerer kasserere som ligger over butikksnittet (se Kassererprofil).'),
      sf('discWatch', 'ctl', 'text', 'Overvåkede årsaker (tekstnr, komma)', '', 'For eksempel 2,4,5.', true),
      sf('discWatchPct', 'ctl', 'num', 'Overvåket: rabatt minst', '%'),
      sf('discWatchKr', 'ctl', 'num', 'Overvåket: rabatt minst', 'kr'),
      sf('discWatchN', 'ctl', 'num', 'Overvåket: marker kasserer ved', 'bonger', '', true)
    ], weights: ['Rabatt uten årsak', 'Mange rabatter uten årsak', 'Rabatt med overvåket årsak', 'Mange rabatter med overvåket årsak'] },
    { id: 'member', title: 'Medlemsnummer', text: 'Misbruk av medlemsnummer, for eksempel at en ansatt taster sitt eget på kunders kjøp. Bruker bare listen fra CW og trenger ikke skanning. Gjelder alle innlastede bonger i valgte butikker.', fields: [
      sf('memberStoreMin', 'ctl', 'num', 'Samme medlemsnr i to butikker innen', 'min', 'Samme nummer i ulike butikker så tett i tid at det er usannsynlig.', true),
      sf('memberDayN', 'ctl', 'num', 'Samme medlemsnr samme dag: flagg ved', 'bonger', '', true),
      sf('memberN', 'ctl', 'num', 'Samme medlemsnr totalt: flagg ved', 'bonger', 'Avhenger av hvor lang periode du har lastet. Sett høyt for en måned.', true),
      sf('memberCashN', 'ctl', 'num', 'Medlemsnr nesten bare hos én kasserer: flagg ved', 'bonger', 'Minst så mange bonger med nummeret.', true),
      sf('memberCashShare', 'ctl', 'num', 'Andel hos samme kasserer over', '%', 'Må også være minst «Avviker fra snittet» ganger kassererens vanlige andel av bongene.'),
      sf('empMembers', 'ctl', 'text', 'Ansattes medlemsnr', '', 'Komma-separert. «1234567» flagger alle bonger med nummeret; «12=1234567» (kasserer=medlemsnr) flagger når kasserer 12 bruker nummeret.', true)
    ], weights: ['Medlem i flere butikker samtidig', 'Medlemsnr flere ganger samme dag', 'Medlemsnr brukt svært mye', 'Medlemsnr nesten bare hos én kasserer', 'Ansatt-medlemsnr brukt', 'Kasserer bruker eget medlemsnr'] },
    { id: 'price', title: 'Pris per vare', text: 'Samme vare solgt til ulik enhetspris samme dag i samme butikk. Kan tyde på manuell pris, spør pris eller feil pris. Krever skanning.', fields: [
      sf('priceDevPct', 'ctl', 'num', 'Pris avviker fra vanlig pris med minst', '%', 'Vanlig pris = den prisen flest bonger har samme dag (minst 60 %). Kampanjer og flerkjøp kan gi falske treff.', true),
      sf('priceMinN', 'ctl', 'num', 'Minst antall salg av varen', 'stk', 'Per butikk og dag.'),
      sf('priceCashN', 'ctl', 'num', 'Marker kasserer ved', 'avvik', '', true)
    ], weights: ['Avvikende pris på vare', 'Mange avvikende priser'] },
    { id: 'ku', title: 'Kjøpeutbytte', text: 'Kontroll av Kjøpeutbytte-tabellen på bonger med medlemsnr. Tabellen er ikke bekreftet i ekte data ennå; testene kalibrerer seg mot det som faktisk finnes. Krever skanning.', fields: [
      sf('kuMissing', 'ctl', 'flag', 'Medlem uten kjøpeutbytte', '', 'Gjelder bare når minst 80 % av medlemsbongene har tabellen.'),
      sf('kuDiffPct', 'ctl', 'num', 'Grunnlag avviker fra vanlig forhold til varesum med minst', '%', '', true),
      sf('kuDiffKr', 'ctl', 'num', 'og minst', 'kr')
    ], weights: ['Medlem uten kjøpeutbytte', 'Kjøpeutbytte avviker fra varesum'] },
    { id: 'events', title: 'Hendelsesord', text: 'Tekstlinjer på bongen med ord som annullert, makulert, parkert, manuell eller spør pris. Slike hendelser er ikke observert ennå; testen fanger dem når de dukker opp. Se Diagnostikk for ukjente linjer.', fields: [
      sf('evOn', 'ctl', 'flag', 'Test på', '', 'Ord: annull, makul, storn, parker, på vent, manuell, spør pris, overstyr, prisendring, kansell, avbrutt.')
    ], weights: ['Hendelsesord på bong'] },
    { id: 'pant', title: 'Pant', text: 'Pantelapp-sjekk per dag og gjentatte pantebeløp.', fields: [
      sf('pantRepeatN', 'ctl', 'num', 'Samme pantebeløp: flagg ved', 'stk', '', true),
      sf('pantMin', 'ctl', 'num', 'Pantebeløp er minst', 'kr'),
      sf('pantRatio', 'ctl', 'num', 'Panteretur over pantesalg ×', '', 'Rødt i balansen når utbetalt retur er over dette tallet ganger pantesalget.', true)
    ], weights: ['Samme pantebeløp utbetalt flere ganger'] },
    { id: 'hours', title: 'Åpningstider', text: 'Brukes til bonger utenfor åpningstid og til å avgjøre hvilken dag et kassaoppgjør hører til.', fields: [
      sf('openFrom', 'ctl', 'time', 'Åpner', 'HH:MM'),
      sf('openTo', 'ctl', 'time', 'Stenger', 'HH:MM')
    ], weights: ['Bonger utenfor åpningstid'] },
    { id: 'profile', title: 'Kassererprofil og avstemming', text: 'Sammenligning mot butikksnittet og toleranse i dagsavstemmingen.', fields: [
      sf('profFactor', 'ctl', 'num', 'Avviker fra snittet fra', '×'),
      sf('profMin', 'ctl', 'num', 'Minst antall bonger for profil', 'stk'),
      sf('reconTol', 'ctl', 'num', 'Avstemming: toleranse', 'kr')
    ], weights: [] },
    { id: 'rules', title: 'Egne regler', text: 'Reglene bygges under Analyse → Detaljer → Egne avviksregler.', fields: [], weights: ['Regel'] }
  ];

  function groupForReason(reason) {
    var b = reasonBase(reason);
    if (/^Regel:/.test(b)) b = 'Regel';
    for (var i = 0; i < SETTING_GROUPS.length; i++) if (SETTING_GROUPS[i].weights.indexOf(b) !== -1) return SETTING_GROUPS[i].id;
    return null;
  }

  // Antall verdier i en gruppe som avviker fra standard (inkludert vekter).
  function groupChanges(g, ctl, anom, weights) {
    var dc = defaultControl(), da = defaultAnom(), n = 0;
    g.fields.forEach(function (f) {
      var cur = (f.src === 'anom' ? anom : ctl)[f.k], def = (f.src === 'anom' ? da : dc)[f.k];
      if (String(cur) !== String(def)) n++;
    });
    g.weights.forEach(function (w) { if (Number((weights || {})[w]) !== RISK_WEIGHTS[w]) n++; });
    return n;
  }

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
    'Avvikende sifferfordeling': 2, 'Mange runde beløp': 2, 'Rabatt uten årsak': 3, 'Mange rabatter uten årsak': 2, 'Rabatt med overvåket årsak': 3, 'Mange rabatter med overvåket årsak': 3,
    'Medlem i flere butikker samtidig': 4, 'Medlemsnr flere ganger samme dag': 2, 'Medlemsnr brukt svært mye': 2, 'Medlemsnr nesten bare hos én kasserer': 3,
    'Ansatt-medlemsnr brukt': 2, 'Kasserer bruker eget medlemsnr': 5, 'Avvikende pris på vare': 3, 'Mange avvikende priser': 3,
    'Medlem uten kjøpeutbytte': 2, 'Kjøpeutbytte avviker fra varesum': 2, 'Hendelsesord på bong': 2
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
    var watch = watchReasons(cfg), wPct = cnum(cfg.discWatchPct, 0), wKr = cnum(cfg.discWatchKr, 0), wN = cnum(cfg.discWatchN, null);
    var fresh = function () { return { n: 0, withDisc: 0, disc: 0, withNR: 0, nr: 0, withCpn: 0, cpn: 0, cpnSum: 0, withW: 0 }; };
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
      if (watch.length) {
        var wl = sc.items.filter(function (l) { return l.d && watch.indexOf(reasonName(l.dr)) !== -1 && (l.dp === undefined || l.dp >= wPct) && l.d >= wKr; });
        if (wl.length) {
          a.withW++; tot.withW++;
          findings.push({ kind: 'Rabatt', code: 'discWatch', title: 'Rabatt med overvåket årsak', flag: true,
            detail: 'Kasse ' + it.workstationNumber + ' ' + parseDT(it.endDateTime).time + ' kasserer ' + it.cashierNumber + ': ' +
              wl.map(function (l) { return l.n + ' −' + l.d + ' kr (' + (l.dp || '?') + ' %) – årsak ' + reasonName(l.dr); }).join(', '),
            ids: [it.transactionId] });
        }
      }
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
      var row = { id: id, n: x.n, withW: x.withW, flagW: false, withDisc: x.withDisc, disc: round2(x.disc), withNR: x.withNR, nr: round2(x.nr), withCpn: x.withCpn, cpn: x.cpn, cpnSum: round2(x.cpnSum),
        share: shareOf(x), flag: false };
      if (watch.length && wN !== null && x.withW >= wN) {
        row.flagW = true;
        var per = watch.map(function (n) { return n + ' ' + ((matrix[id] && matrix[id][n]) || 0); }).join(', ');
        findings.push({ kind: 'Rabatt', code: 'discWatchCash', title: 'Mange rabatter med overvåket årsak', flag: false, cashier: id, ids: [],
          detail: 'Kasserer ' + id + ': ' + x.withW + ' av ' + x.n + ' bonger med overvåket rabattårsak (' + per + '; grense ' + wN + ')' });
      }
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
    return { rows: rows, total: { n: tot.n, withDisc: tot.withDisc, disc: round2(tot.disc), withW: tot.withW, withNR: tot.withNR, nr: round2(tot.nr), withCpn: tot.withCpn, cpn: tot.cpn, cpnSum: round2(tot.cpnSum), share: storeShare },
      watch: watch, campaigns: campRows, reasons: reasonRows, matrix: { cols: cols, rows: matrixRows }, findings: findings, coverage: sales ? scannedSales / sales : 1, sales: sales, scanned: scannedSales };
  }

  // ---- medlemsnummer, pris per vare, kjøpeutbytte og hendelsesord ----------------------------
  function median(arr) {
    var a = arr.slice().sort(function (x, y) { return x - y; }), n = a.length;
    return n ? (n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : 0;
  }

  function empList(cfg) {
    var members = {}, pairs = {}, any = false;
    String((cfg && cfg.empMembers) || '').split(/[,;\s]+/).forEach(function (t) {
      t = t.trim();
      if (!t) return;
      var m = /^([^=:]+)[=:](.+)$/.exec(t);
      if (m) { pairs[m[1].trim() + '|' + m[2].trim()] = true; members[m[2].trim()] = true; } else members[t] = true;
      any = true;
    });
    return { members: members, pairs: pairs, any: any };
  }

  function whereText(it) { return 'Kasse ' + it.workstationNumber + ' ' + parseDT(it.endDateTime).time + ' kasserer ' + it.cashierNumber; }

  // Misbruk av medlemsnummer, kun fra listen (gridet). pop = alle innlastede bonger i valgte butikker.
  function memberChecks(items, pop, cfg) {
    var findings = [], byM = {}, salesAll = 0, byCashAll = {};
    pop.forEach(function (it) {
      if (it.receiptType !== 1 || typeof it.totalAmount !== 'number') return;
      salesAll++;
      byCashAll[it.cashierNumber] = (byCashAll[it.cashierNumber] || 0) + 1;
      var k = memberKey(it);
      if (k) (byM[k] = byM[k] || []).push(it);
    });
    var stMin = cnum(cfg.memberStoreMin, null), dayN = cnum(cfg.memberDayN, null), totN = cnum(cfg.memberN, null);
    var cN = cnum(cfg.memberCashN, null), cShare = cnum(cfg.memberCashShare, 80) / 100, fac = cnum(cfg.profFactor, 1.5);
    var emp = empList(cfg), rows = [];
    var ids = function (arr) { return arr.map(function (x) { return x.transactionId; }); };
    Object.keys(byM).forEach(function (mk) {
      var arr = byM[mk].slice().sort(function (a, b) { return tsMin(a) - tsMin(b); });
      var days = {}, stores = {}, cash = {};
      arr.forEach(function (it) {
        (days[dayOf(it)] = days[dayOf(it)] || []).push(it);
        stores[it.storeNumber] = true;
        (cash[it.cashierNumber] = cash[it.cashierNumber] || []).push(it);
      });
      var top = Object.keys(cash).sort(function (a, b) { return cash[b].length - cash[a].length; })[0];
      var topShare = cash[top].length / arr.length;
      rows.push({ id: mk, n: arr.length, days: Object.keys(days).length, stores: Object.keys(stores).length, cashier: top, share: topShare, flags: [] });
      var row = rows[rows.length - 1];
      if (stMin !== null) {
        var hit = [], first = '';
        for (var i = 1; i < arr.length; i++) {
          if (arr[i].storeNumber !== arr[i - 1].storeNumber && tsMin(arr[i]) - tsMin(arr[i - 1]) <= stMin) {
            hit.push(arr[i - 1], arr[i]);
            if (!first) first = 'butikk ' + arr[i - 1].storeNumber + ' ' + dayOf(arr[i - 1]) + ' ' + parseDT(arr[i - 1].endDateTime).time + ' og butikk ' + arr[i].storeNumber + ' ' + parseDT(arr[i].endDateTime).time;
          }
        }
        if (hit.length) {
          row.flags.push('flere butikker');
          findings.push({ kind: 'Medlem', code: 'memberStores', title: 'Medlem i flere butikker samtidig', flag: true,
            detail: 'Medlemsnr ' + mk + ': ' + first + ' (innen ' + stMin + ' min)', ids: ids(hit).filter(function (x, i, a) { return a.indexOf(x) === i; }) });
        }
      }
      if (dayN !== null) {
        Object.keys(days).forEach(function (d) {
          if (days[d].length < dayN) return;
          row.flags.push('samme dag');
          findings.push({ kind: 'Medlem', code: 'memberDay', title: 'Medlemsnr flere ganger samme dag', flag: true,
            detail: 'Medlemsnr ' + mk + ': ' + days[d].length + ' bonger ' + d + ' (kasserere ' + Object.keys(days[d].reduce(function (o, x) { o[x.cashierNumber] = 1; return o; }, {})).join(', ') + ')', ids: ids(days[d]) });
        });
      }
      if (totN !== null && arr.length >= totN) {
        row.flags.push('mye brukt');
        findings.push({ kind: 'Medlem', code: 'memberMany', title: 'Medlemsnr brukt svært mye', flag: true,
          detail: 'Medlemsnr ' + mk + ': ' + arr.length + ' bonger på ' + row.days + ' dager i ' + row.stores + ' butikk' + (row.stores === 1 ? '' : 'er') + ' (grense ' + totN + ')', ids: ids(arr) });
      }
      if (cN !== null && cash[top].length >= cN && topShare >= cShare && salesAll && topShare >= fac * (byCashAll[top] / salesAll)) {
        row.flags.push('én kasserer');
        findings.push({ kind: 'Medlem', code: 'memberCash', title: 'Medlemsnr nesten bare hos én kasserer', flag: true,
          detail: 'Medlemsnr ' + mk + ': ' + cash[top].length + ' av ' + arr.length + ' bonger (' + Math.round(topShare * 100) + ' %) hos kasserer ' + top + ', som ellers har ' + Math.round(byCashAll[top] / salesAll * 100) + ' % av bongene', ids: ids(cash[top]) });
      }
      if (emp.any && emp.members[mk]) {
        var mine = arr.filter(function (it) { return emp.pairs[String(it.cashierNumber) + '|' + mk]; });
        var other = arr.filter(function (it) { return !emp.pairs[String(it.cashierNumber) + '|' + mk]; });
        if (mine.length) {
          row.flags.push('eget nummer');
          findings.push({ kind: 'Medlem', code: 'empOwn', title: 'Kasserer bruker eget medlemsnr', flag: true,
            detail: 'Kasserer ' + mine[0].cashierNumber + ' har tastet sitt eget medlemsnr ' + mk + ' på ' + mine.length + ' bonger', ids: ids(mine) });
        }
        if (other.length) {
          row.flags.push('ansatt');
          findings.push({ kind: 'Medlem', code: 'empUse', title: 'Ansatt-medlemsnr brukt', flag: true,
            detail: 'Ansattnummer ' + mk + ' brukt på ' + other.length + ' bonger (kasserere ' + Object.keys(other.reduce(function (o, x) { o[x.cashierNumber] = 1; return o; }, {})).join(', ') + ')', ids: ids(other) });
        }
      }
    });
    rows.sort(function (a, b) { return b.flags.length - a.flags.length || b.n - a.n; });
    return { findings: findings, rows: rows, members: rows.length, sales: salesAll };
  }

  // Samme vare solgt til ulik enhetspris samme dag og butikk. Bare v4-skanninger har enhetspris.
  function priceDeviation(items, pop, scanMap, cfg) {
    var pct = cnum(cfg.priceDevPct, null), minN = cnum(cfg.priceMinN, 5), cashN = cnum(cfg.priceCashN, null);
    var res = { findings: [], lines: 0, groups: 0, deviating: 0, coverage: 1, sales: 0, scanned: 0, rows: [] };
    var scope = {};
    items.forEach(function (it) { scope[it.transactionId] = true; });
    var grp = {};
    pop.forEach(function (it) {
      if (!isSale(it)) return;
      res.sales++;
      var sc = scanMap && scanMap[it.transactionId];
      if (!hasV4(sc)) return;
      res.scanned++;
      sc.items.forEach(function (l) {
        if (!/^(\d{8}|\d{12,14})$/.test(l.c) || l.a <= 0 || PANT_LINE.test(l.c + ' ' + l.n)) return;
        var price = typeof l.p === 'number' ? l.p : round2(l.a + (l.d || 0));
        if (!(price > 0)) return;
        res.lines++;
        var key = it.storeNumber + '|' + dayOf(it) + '|' + l.c;
        (grp[key] = grp[key] || []).push({ it: it, l: l, price: price });
      });
    });
    res.coverage = res.sales ? res.scanned / res.sales : 1;
    if (pct === null) return res;
    var perBong = {}, perCash = {};
    Object.keys(grp).forEach(function (k) {
      var g = grp[k];
      if (g.length < minN) return;
      var cnt = {};
      g.forEach(function (x) { cnt[x.price.toFixed(2)] = (cnt[x.price.toFixed(2)] || 0) + 1; });
      var modeKey = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a] || Number(a) - Number(b); })[0];
      if (cnt[modeKey] / g.length < 0.6) return;
      res.groups++;
      var mode = Number(modeKey);
      g.forEach(function (x) {
        var dev = (x.price - mode) / mode * 100;
        if (Math.abs(dev) < pct || !scope[x.it.transactionId]) return;
        res.deviating++;
        var id = x.it.transactionId;
        (perBong[id] = perBong[id] || { it: x.it, lines: [] }).lines.push(x.l.n + ' kr ' + x.price.toFixed(2) + ' mot vanlig ' + mode.toFixed(2) + ' (' + (dev > 0 ? '+' : '−') + Math.round(Math.abs(dev)) + ' %)');
        perCash[x.it.cashierNumber] = (perCash[x.it.cashierNumber] || 0) + 1;
      });
    });
    Object.keys(perBong).forEach(function (id) {
      var b = perBong[id];
      res.findings.push({ kind: 'Pris', code: 'priceDev', title: 'Avvikende pris på vare', flag: true, detail: whereText(b.it) + ': ' + b.lines.join(', '), ids: [id] });
    });
    Object.keys(perCash).sort(numCmp).forEach(function (c) {
      res.rows.push({ id: c, n: perCash[c] });
      if (cashN !== null && perCash[c] >= cashN) {
        res.findings.push({ kind: 'Pris', code: 'priceCash', title: 'Mange avvikende priser', flag: false, cashier: c, ids: [],
          detail: 'Kasserer ' + c + ': ' + perCash[c] + ' varelinjer med pris som avviker minst ' + pct + ' % fra vanlig pris samme dag (grense ' + cashN + ')' });
      }
    });
    return res;
  }

  // Kjøpeutbytte-tabellen på medlemsbonger. Kalibrerer seg mot det som faktisk finnes i dataene.
  function kuChecks(items, pop, scanMap, cfg) {
    var res = { findings: [], n: 0, withTable: 0, applicable: false, ratio: null, scanned: 0, members: 0 };
    var missing = hasNum(cfg.kuMissing), dPct = cnum(cfg.kuDiffPct, null), dKr = cnum(cfg.kuDiffKr, 20);
    var scope = {};
    items.forEach(function (it) { scope[it.transactionId] = true; });
    var mem = [];
    pop.forEach(function (it) {
      if (!isSale(it) || !hasMember(it)) return;
      res.members++;
      var sc = scanMap && scanMap[it.transactionId];
      if (!hasV4(sc) || !(sc.np > 0)) return;
      res.scanned++;
      var S = round2(sc.items.reduce(function (a, l) { return a + (PANT_LINE.test(l.c + ' ' + l.n) ? 0 : l.a); }, 0));
      mem.push({ it: it, sc: sc, S: S });
    });
    res.n = mem.length;
    res.withTable = mem.filter(function (x) { return x.sc.ku; }).length;
    res.applicable = res.n >= 10 && res.withTable / res.n >= 0.8;
    if (missing && res.applicable) {
      mem.forEach(function (x) {
        if (x.sc.ku || !scope[x.it.transactionId]) return;
        res.findings.push({ kind: 'Kjøpeutbytte', code: 'kuMissing', title: 'Medlem uten kjøpeutbytte', flag: true,
          detail: whereText(x.it) + ': medlemsnr ' + memberKey(x.it) + ' men ingen Kjøpeutbytte-tabell (' + res.withTable + ' av ' + res.n + ' medlemsbonger har den)', ids: [x.it.transactionId] });
      });
    }
    var tab = mem.filter(function (x) { return x.sc.ku && x.sc.ku.g > 0 && x.S > 0; });
    if (tab.length >= 10) {
      res.ratio = median(tab.map(function (x) { return x.sc.ku.g / x.S; }));
      if (dPct !== null && res.ratio > 0) {
        tab.forEach(function (x) {
          if (!scope[x.it.transactionId]) return;
          var r = x.sc.ku.g / x.S, exp = res.ratio * x.S;
          if (Math.abs(r - res.ratio) / res.ratio * 100 >= dPct && Math.abs(x.sc.ku.g - exp) >= dKr) {
            res.findings.push({ kind: 'Kjøpeutbytte', code: 'kuDiff', title: 'Kjøpeutbytte avviker fra varesum', flag: true,
              detail: whereText(x.it) + ': grunnlag ' + x.sc.ku.g.toFixed(2) + ' kr mot varesum ' + x.S.toFixed(2) + ' kr (vanlig forhold ' + Math.round(res.ratio * 100) + ' %, her ' + Math.round(r * 100) + ' %)', ids: [x.it.transactionId] });
          }
        });
      }
    }
    return res;
  }

  // Ord som annullert, makulert, parkert, manuell og spør pris på tekstlinjer. Ikke observert ennå.
  function eventWords(items, scanMap, cfg) {
    var res = { findings: [], scanned: 0, hits: 0 };
    items.forEach(function (it) {
      var sc = scanMap && scanMap[it.transactionId];
      if (!hasV4(sc)) return;
      res.scanned++;
      if (!sc.ev || !sc.ev.length) return;
      res.hits++;
      if (!hasNum(cfg.evOn)) return;
      res.findings.push({ kind: 'Hendelse', code: 'event', title: 'Hendelsesord på bong', flag: true,
        detail: whereText(it) + ': ' + sc.ev.map(function (e) { return '«' + e.t + '»'; }).join(', '), ids: [it.transactionId] });
    });
    return res;
  }

  // Sammenligner klokkeslettet i listen med klokkeslettet i bongens topptekst (lagret som hd i skanningen).
  function timeCheck(items, scanMap) {
    var diffs = [], sample = null;
    items.forEach(function (it) {
      var sc = scanMap && scanMap[it.transactionId];
      if (!sc || !sc.hd) return;
      var a = dtMin(it.endDateTime), b = dtMin(sc.hd);
      if (a === null || b === null) return;
      diffs.push(b - a);
      if (!sample || Math.abs(b - a) > Math.abs(sample.diff)) sample = { id: it.transactionId, list: it.endDateTime, bong: sc.hd, raw: it.rawDT === undefined ? '' : String(it.rawDT), diff: b - a };
    });
    var sorted = diffs.slice().sort(function (x, y) { return x - y; });
    var med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    var near = diffs.filter(function (x) { return Math.abs(x - med) <= 5; }).length;
    var same = diffs.filter(function (x) { return Math.abs(x) <= 5; }).length;
    return { n: diffs.length, same: same, median: med, suggest: diffs.length >= 5 && Math.abs(med) >= 30 && near >= 0.7 * diffs.length ? med : null, sample: sample };
  }

  // Samler ukjente linjer og hendelsesord fra alle skanninger, til diagnostikk-dialogen.
  function diagnostics(scanMap) {
    var d = { total: 0, v4: 0, unk: {}, ev: {}, ku: { with: 0, without: 0 }, types: {} };
    Object.keys(scanMap || {}).forEach(function (id) {
      var sc = scanMap[id];
      d.total++;
      if (!hasV4(sc)) return;
      d.v4++;
      (sc.unk || []).forEach(function (t) { var e = d.unk[t] || (d.unk[t] = { t: t, n: 0, id: id }); e.n++; });
      (sc.ev || []).forEach(function (x) { var e = d.ev[x.t] || (d.ev[x.t] = { k: x.k, t: x.t, n: 0, id: id }); e.n++; });
      if (sc.ku) d.ku.with++; else d.ku.without++;
    });
    var list = function (o) { return Object.keys(o).map(function (k) { return o[k]; }).sort(function (a, b) { return b.n - a.n || String(a.t).localeCompare(String(b.t)); }); };
    return { total: d.total, v4: d.v4, unk: list(d.unk), ev: list(d.ev), ku: d.ku };
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
    localDT: localDT,
    parseCellDT: parseCellDT,
    headerDT: headerDT,
    defaultFilters: defaultFilters,
    matches: matches,
    compare: compare,
    findDuplicates: findDuplicates,
    sumSelected: sumSelected,
    parseReceipt: parseReceipt,
    discounts: discounts,
    memberChecks: memberChecks,
    shiftDT: shiftDT,
    timeCheck: timeCheck,
    priceDeviation: priceDeviation,
    kuChecks: kuChecks,
    eventWords: eventWords,
    diagnostics: diagnostics,
    median: median,
    SETTING_GROUPS: SETTING_GROUPS,
    groupForReason: groupForReason,
    groupChanges: groupChanges,
    DISC_REASONS: DISC_REASONS,
    reasonName: reasonName,
    watchReasons: watchReasons,
    hasDisc: hasDisc,
    hasV4: hasV4,
    memberKey: memberKey,
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
