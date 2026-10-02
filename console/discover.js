// Lim inn i DevTools-console på Lindbak Chain Web. Last siden på nytt etter paste hvis du vil fange initiale kall.
(() => {
  const W = window;
  const log = (W.__kv = W.__kv || { calls: [], seen: new Set() });

  const walk = (o, path = "", out = [], depth = 0) => {
    if (depth > 8 || o === null) return out;
    if (Array.isArray(o)) {
      out.push({ path: path + "[]", type: `array(${o.length})`, sample: "" });
      if (o.length) walk(o[0], path + "[0]", out, depth + 1);
    } else if (typeof o === "object") {
      for (const k of Object.keys(o)) walk(o[k], path ? `${path}.${k}` : k, out, depth + 1);
    } else out.push({ path, type: typeof o, sample: String(o).slice(0, 60) });
    return out;
  };

  const record = (kind, method, url, status, body, reqBody) => {
    let json = null;
    try { json = typeof body === "string" ? JSON.parse(body) : body; } catch {}
    log.calls.push({ t: Date.now(), kind, method, url, status, reqBody, json, raw: json ? undefined : String(body).slice(0, 500) });
  };

  if (!W.__kvPatched) {
    W.__kvPatched = true;
    const f = W.fetch;
    W.fetch = async function (input, init = {}) {
      const res = await f.apply(this, arguments);
      try {
        const url = typeof input === "string" ? input : input.url;
        res.clone().text().then(b => record("fetch", init.method || "GET", url, res.status, b, init.body));
      } catch {}
      return res;
    };
    const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { this.__kv = { m, u }; return open.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function (b) {
      this.addEventListener("load", () => record("xhr", this.__kv.m, this.__kv.u, this.status, this.responseText, b));
      return send.apply(this, arguments);
    };
  }

  // Nettverk
  W.kvCalls = (filter) => console.table(log.calls.filter(c => !filter || c.url.includes(filter)).map((c, i) => ({ i, kind: c.kind, method: c.method, status: c.status, url: c.url, json: !!c.json })));
  W.kvCall = (i) => log.calls[i];
  // Feltkart for ett kall: sti, type, eksempelverdi
  W.kvSchema = (i) => console.table(walk(log.calls[i].json));
  // Alle unike feltstier på tvers av alle JSON-kall, med kilde-URL
  W.kvAllFields = (filter) => {
    const m = new Map();
    log.calls.filter(c => c.json && (!filter || c.url.includes(filter))).forEach(c =>
      walk(c.json).forEach(f => { const k = f.path; if (!m.has(k)) m.set(k, { path: k, type: f.type, sample: f.sample, source: c.url.split("?")[0] }); }));
    console.table([...m.values()]);
    return [...m.values()];
  };
  // Søk i alle responser etter verdi (f.eks. kvitteringsnummer, beløp)
  W.kvFind = (needle) => {
    const hits = [];
    log.calls.forEach((c, i) => c.json && walk(c.json).forEach(f => { if (String(f.sample).includes(needle)) hits.push({ call: i, url: c.url.split("?")[0], path: f.path, value: f.sample }); }));
    console.table(hits); return hits;
  };

  // DOM: synlige labels/verdier, tabeller, skjemafelt
  W.kvDom = () => {
    const rows = [...document.querySelectorAll("label, th, dt, [class*=label i]")].map(e => ({ tag: e.tagName, text: e.innerText.trim().slice(0, 60), id: e.id, cls: e.className?.toString().slice(0, 60), forId: e.htmlFor || "" })).filter(r => r.text);
    console.table(rows); return rows;
  };
  W.kvTables = () => [...document.querySelectorAll("table")].map((t, i) => {
    const head = [...t.querySelectorAll("th")].map(h => h.innerText.trim());
    console.log(`table[${i}]`, t.id || t.className, head); return { i, head, rows: t.rows.length };
  });
  W.kvInputs = () => console.table([...document.querySelectorAll("input,select,textarea")].map(e => ({ name: e.name, id: e.id, type: e.type, value: (e.value || "").slice(0, 40), ng: e.getAttribute("ng-model") || e.getAttribute("formcontrolname") || "" })));
  W.kvAttrs = () => { const s = new Set(); document.querySelectorAll("*").forEach(e => [...e.attributes].forEach(a => /^(data-|ng-|aria-label)/.test(a.name) && s.add(a.name)));
    console.log([...s].sort()); return [...s]; };

  // Klient-lagring og globale objekter
  W.kvStorage = () => { console.table(Object.keys(localStorage).map(k => ({ store: "local", key: k, size: localStorage[k].length, head: localStorage[k].slice(0, 60) })));
    console.table(Object.keys(sessionStorage).map(k => ({ store: "session", key: k, size: sessionStorage[k].length, head: sessionStorage[k].slice(0, 60) })));
    console.log("cookies:", document.cookie.split(";").map(c => c.split("=")[0].trim())); };
  W.kvGlobals = () => { const std = new Set(Object.getOwnPropertyNames(document.createElement("iframe").contentWindow || {}));
    const g = Object.keys(W).filter(k => !std.has(k) && !k.startsWith("kv") && !k.startsWith("__kv")); console.log(g); return g; };

  // Last ned alt som JSON
  W.kvExport = () => { const blob = new Blob([JSON.stringify(log.calls, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "kv-capture.json"; a.click(); };

  console.log("kv klar: kvCalls(filter) kvCall(i) kvSchema(i) kvAllFields(filter) kvFind(tekst) kvDom() kvTables() kvInputs() kvAttrs() kvStorage() kvGlobals() kvExport()");
})();
