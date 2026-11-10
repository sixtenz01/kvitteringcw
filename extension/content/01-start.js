(function () {
  'use strict';
  if (window.__kvRewamp) return;
  window.__kvRewamp = true;

  // Feil i pluginen skal synes på siden, ikke bare i Console: en liten boks nederst til venstre sier hva som gikk galt.
  window.addEventListener('error', function (ev) { if (ev && /\/src\/(content|logic|report)\.js/.test(ev.filename || '')) showBootError(ev.error || ev.message); });
  window.addEventListener('unhandledrejection', function (ev) { var r = ev && ev.reason; if (r && /\/src\/(content|logic|report)\.js/.test(String(r.stack || ''))) showBootError(r); });

  var L = window.KvLogic;
  var K = {
    showall: 'kvr.showall.v1', saved: 'kvr.saved.v1', collapsed: 'kvr.collapsed.v1', scan: 'kvr.scan.v2', pos: 'kvr.pos.v1',
    size: 'kvr.size.v1', sec: 'kvr.sec.v1', rules: 'kvr.rules.v1', anom: 'kvr.anom.v1',
    stores: 'kvr.stores.v1', tab: 'kvr.tab.v1', layout: 'kvr.layout.v1', arules: 'kvr.arules.v1', notes: 'kvr.notes.v1', tasks: 'kvr.tasks.v1', ctl: 'kvr.ctl.v1', keynav: 'kvr.keynav.v1', tshift: 'kvr.tshift.v1', nlog: 'kvr.nlog.v1', wide: 'kvr.wide.v1', sub: 'kvr.sub.v1', weights: 'kvr.weights.v1', camp: 'kvr.camp.v1', lastrun: 'kvr.lastrun.v1', scope: 'kvr.scope.v1', help: 'kvr.help.v1', sub2: 'kvr.sub2.v1', reports: 'kvr.reports.v1', repopts: 'kvr.repopts.v1', pantmig: 'kvr.pantmig.v1', pos2: 'kvr.pos2.v1', campmig: 'kvr.campmig.v1', discmig: 'kvr.discmig.v1', evmig: 'kvr.evmig.v1', folder: 'kvr.folder.v1', folderAt: 'kvr.folderat.v1', cwx: 'kvr.cwx.v1', arch: 'kvr.arch.v1', quick: 'kvr.quick.v1'
  };
  var sayTimer = null;
  var failedRecs = [];
  var lastRetry = null;
  var SCAN_TIMEOUT = 6000;
  var SCAN_LIMIT = 10000, SCAN_BYTES = 25 * 1024 * 1024;
  var SCAN_TYPES = [1, 2, 11, 13];   // salg, kassaoppgjør, synlig svinn og internt forbruk
  var SCAN_MIN_MS = 600;   // fartsregulator: høyst én bong per 0,6 s, saktere når CW svarer tregere enn normalt
  var seqProof = { ok: 0, bad: 0 };

  var filters = L.defaultFilters();
  var selected = {};
  var recs = [];
  var grid = null;
  var ui = {};
  var scanning = false;
  var cancelScan = false;
  var optsKey = '';
  var gcache = {};
  var anomMap = {};
  var cw = { dateFrom: '', dateTo: '', stores: {}, members: '', loyal: '', free: '', bong: '', storeQuery: '' };
  var cwStoreList = [];
  var campDec = {};   // brukerens svar om sentral kampanje: «ean|prosent» → 'kampanje' | 'ikke'
  var gridStores = {};   // butikknavn lest fra gridets BUTIKK-kolonne (lavest prioritet)
  var storeMap = {};

  // Lagring: kun egen IndexedDB ('kvr-store'). Ingenting skrives til localStorage/sessionStorage,
  // slik at Lindbaks egne data aldri påvirkes. Hard grense på antall cachede kvitteringer.
  var mem = {};
  var scanMap = {};
  var dirty = {};
  var db = null;
  var rules, anomCfg, manualStores, customRules = [];
  var scope = null, lastMode = 'scope', fetched = null;
  var weights = null, checkState = { newIds: {}, at: null, shown: 15, showChecked: false }, expanded = {};
  var notes = {}, ctlRes = null, ctlCfg = null, tasksCustom = [], boundCount = 0, keyNav = true, settingsStale = false, timeShift = 0, showAll = false;
  var cwx = null, cwRun = null;   // tilleggsdata fra CWs filtre, og kjøringen som pågår
  var lastLoadMs = 0, lastSearchMs = 0, quickScan = false;   // svartid for siste bong og søk; målrettet skanning
  // samlet grunnlag fra «Hent og skann i deler»: listerader fra mange CW-søk. Medlemsnummer bare i minnet (archMem).
  var arch = { days: {} }, archMem = {}, archVer = 0, allCache = null, bulk = null;
  var ARCH_LIMIT = 30000, ARCH_DAYS = 92, PART_PAUSE = 1500;

  function openDb() {
    return new Promise(function (res) {
      try {
        var rq = indexedDB.open('kvr-store', 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore('kv'); rq.result.createObjectStore('scan'); };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = rq.onblocked = function () { res(null); };
      } catch (e) { res(null); }
    });
  }

  function readAll(d, name) {
    return new Promise(function (res) {
      var out = {};
      try {
        var rq = d.transaction(name).objectStore(name).openCursor();
        rq.onsuccess = function () { var c = rq.result; if (c) { out[c.key] = c.value; c.continue(); } else res(out); };
        rq.onerror = function () { res(out); };
      } catch (e) { res(out); }
    });
  }

  function put(name, key, val) {
    if (!db) return;
    try {
      var tx = db.transaction(name, 'readwrite');
      if (val === null || val === undefined) tx.objectStore(name).delete(key); else tx.objectStore(name).put(val, key);
      tx.onabort = tx.onerror = function () { db = null; };
    } catch (e) { db = null; }
  }

  function store(key, value) {
    if (value === undefined) return mem[key] === undefined ? null : mem[key];
    if (value === null) delete mem[key]; else mem[key] = value;
    put('kv', key, value);
    if (isSettingsKey(key)) folderChanged();
  }

  // Som put, men en verdi som ikke kan lagres (for eksempel et mappevalg nettleseren ikke tillater) slår ikke av databasen.
  function putSafe(key, val) {
    if (!db) return false;
    try {
      var tx = db.transaction('kv', 'readwrite');
      if (val === null || val === undefined) tx.objectStore('kv').delete(key); else tx.objectStore('kv').put(val, key);
      return true;
    } catch (e) { return false; }
  }

  // Skannecachen har hard grense både i antall og byte. Eldste skanninger går først.
  var sizes = new WeakMap();
  function recBytes(r) {
    var n = sizes.get(r);
    if (n === undefined) { try { n = JSON.stringify(r).length; } catch (e) { n = 2000; } sizes.set(r, n); }
    return n;
  }

  function saveScan() {
    var keys = Object.keys(scanMap).sort(function (a, b) { return (scanMap[a].t || 0) - (scanMap[b].t || 0); });
    var total = keys.reduce(function (a, k) { return a + recBytes(scanMap[k]); }, 0), drop = 0;
    while (drop < keys.length - 1 && (keys.length - drop > SCAN_LIMIT || total > SCAN_BYTES)) { total -= recBytes(scanMap[keys[drop]]); drop++; }
    keys.slice(0, drop).forEach(function (k) { delete scanMap[k]; delete dirty[k]; put('scan', k, null); });
    Object.keys(dirty).forEach(function (k) { if (scanMap[k]) put('scan', k, scanMap[k]); });
    dirty = {};
  }

  function clearScan() {
    scanMap = {}; dirty = {}; gcache = {};
    cwx = null; store(K.cwx, null);
    if (db) { try { db.transaction('scan', 'readwrite').objectStore('scan').clear(); } catch (e) { db = null; } }
  }

  // Rydd bort evt. gamle kvr.*-nøkler i localStorage fra tidligere versjoner (flytter innstillinger til IndexedDB).
  function migrateLocal() {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf('kvr.') === 0) keys.push(k); }
      keys.forEach(function (k) {
        if (k !== 'kvr.scan.v2' && k !== 'kvr.pant.v1' && mem[k] === undefined) {
          try { mem[k] = JSON.parse(localStorage.getItem(k)); put('kv', k, mem[k]); } catch (e) { /* ignorer */ }
        }
        localStorage.removeItem(k);
      });
    } catch (e) { /* ignorer */ }
  }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  function fmt(n) {
    return n.toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function jq() { return window.jQuery || window.$; }
  function wait(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

  function download(blob, name) {
    var a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---- oppstart: feil og venting vises på siden ------------------------------
  var bootShown = '', waitSince = Date.now();
  function bootBox(text, isError) {
    var b = document.getElementById('kvr-boot');
    if (!b) {
      b = document.createElement('div');
      b.id = 'kvr-boot';
      b.setAttribute('role', isError ? 'alert' : 'status');
      b.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;max-width:560px;background:#fff;color:#1b2a24;border:2px solid #00704a;border-radius:10px;padding:10px 12px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25)';
      (document.body || document.documentElement).appendChild(b);
    }
    b.style.borderColor = isError ? '#d93025' : '#00704a';
    b.innerHTML = '';
    var t = document.createElement('div'); t.textContent = text; t.style.marginBottom = '6px'; b.appendChild(t);
    var mk = function (label, fn) { var x = document.createElement('button'); x.type = 'button'; x.textContent = label; x.style.cssText = 'margin-right:6px;font:12px system-ui;padding:3px 8px;border:1px solid #bccac3;border-radius:6px;background:#f0faf5;cursor:pointer'; x.addEventListener('click', fn); b.appendChild(x); };
    if (isError) mk('Kopier feilen', function () { try { navigator.clipboard.writeText(text); } catch (e) { /* ingen utklippstavle */ } });
    mk('Nullstill visning', resetLayout);
    mk('Lukk', function () { b.remove(); });
  }
  // Plassering, størrelse, faner og sammenfolding nullstilles; skanninger, notater og innstillinger beholdes. Siden lastes på nytt.
  function resetLayout() {
    [K.pos, K.pos2, K.size, K.wide, K.collapsed, K.tab, K.sub, K.sub2, K.sec, K.layout].forEach(function (k) { try { store(k, null); } catch (e) { /* lagring utilgjengelig */ } });
    setTimeout(function () { location.reload(); }, 300);
  }
  function showBootError(e) {
    var msg = (e && e.message) || String(e), at = String((e && e.stack) || '').split('\n').slice(1, 3).map(function (x) { return x.trim(); }).join(' ');
    var txt = 'Kvitteringshenter ' + ((window.KvReport && window.KvReport.VERSION) || '') + ' fikk en feil: ' + msg + (at ? ' (' + at + ')' : '') + '. Last siden på nytt (F5). Hjelper ikke det, kopier feilen og send den.';
    window.__kvBootErr = txt;
    try { console.error('[Kvitteringshenter]', e); } catch (x) { /* ingen konsoll */ }
    if (bootShown === msg) return;
    bootShown = msg;
    bootBox(txt, true);
  }
  // Ingen liste ennå: vis hvorfor panelet ikke er der, etter en stund.
  function showWaiting() {
    if (bootShown || document.getElementById('kvr-panel') || Date.now() - waitSince < (window.__kvrWait || 15000)) return;
    var why = !document.querySelector('[data-role=grid]') ? 'venter på listen i CW. Hent kvitteringer (Oppdater i Lindbak), så kommer panelet.'
      : !jq() ? 'finner ikke jQuery på siden, så gridet kan ikke leses.' : 'finner listen, men ikke Kendo-gridet bak den.';
    if (document.getElementById('kvr-boot')) return;
    bootBox('Kvitteringshenter ' + ((window.KvReport && window.KvReport.VERSION) || '') + ' er lastet og ' + why, false);
  }

