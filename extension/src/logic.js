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
    quickRange: quickRange,
    sanitizeFilters: sanitizeFilters,
    activeCount: activeCount
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KvLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
