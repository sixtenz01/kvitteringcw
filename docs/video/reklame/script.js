// posisjon i scene-koordinater (1920×1080). Måles uten skalering/rotasjon, så det virker likt i alle vinduer.
function stagePos(node, ax, ay) { const st = $('#stage'), keep = st.style.transform; st.style.transform = 'none'; const r = node.getBoundingClientRect(), s = st.getBoundingClientRect(); st.style.transform = keep; return [r.left - s.left + r.width * (ax == null ? .5 : ax), r.top - s.top + r.height * (ay == null ? .5 : ay)]; }
/* ==========================================================================
   Kvitteringshenter – reklame
   Ett enkelt timeline-/scene-system:

     • Hver scene er en funksjon av LOKAL TID (update(lt)). Ingen setTimeout-kjeder.
     • Scenen bygger DOM-en sin ved mount og fjernes ved unmount (rydder opp etter seg).
     • Motoren (Engine) eier den globale tiden T og kan spille, pause, spole og restarte.
     • Fordi alt er en ren funksjon av tid kan reklamen både spilles live (requestAnimationFrame)
       og tas opp bilde for bilde: window.__render(t).

   Seksjoner:  1 Verktøy · 2 Lyd-bus · 3 Data · 4 Komponenter · 5 Scener · 6 Motor · 7 Demo · 8 Oppstart
   ========================================================================== */
(() => {
'use strict';

/* ===================================================================== 1. VERKTØY */
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in (attrs || {})) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (t, a, b) => clamp((t - a) / (b - a));

// cubic-bezier som i CSS
function bez(x1, y1, x2, y2) {
  return x => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 10; i++) {
      const u = 1 - t, cx = 3 * x1 * t * u * u + 3 * x2 * t * t * u + t ** 3 - x, dx = 3 * x1 * u * u + 6 * (x2 - x1) * t * u + 3 * (1 - x2) * t * t;
      if (Math.abs(cx) < 1e-6 || Math.abs(dx) < 1e-7) break;
      t -= cx / dx;
    }
    t = clamp(t); const u = 1 - t;
    return 3 * y1 * t * u * u + 3 * y2 * t * t * u + t ** 3;
  };
}
const ease = { out: bez(.16, 1, .3, 1), io: bez(.65, 0, .35, 1), in: bez(.7, 0, .84, 0), soft: bez(.25, .1, .25, 1), back: bez(.34, 1.45, .64, 1), lin: x => clamp(x) };

// nøkkelbilder: kf(t, [[tid, verdi], [tid, verdi, easing], ...])  – easingen hører til segmentet som ender i nøkkelen
function kf(t, k) {
  if (t <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) if (t <= k[i][0]) { const a = k[i - 1], b = k[i]; return lerp(a[1], b[1], (b[2] || ease.io)(seg(t, a[0], b[0]))); }
  return k[k.length - 1][1];
}
// deterministisk tilfeldighet (mulberry32), slik at hver visning/opptak blir identisk
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const NB = ' ';
const nb = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NB);
const dec = (n, d = 2) => n.toFixed(d).replace('.', ',');
const money = (n, d = 2) => { const a = Math.abs(n).toFixed(d).split('.'); a[0] = a[0].replace(/\B(?=(\d{3})+(?!\d))/g, NB); return (n < 0 ? '−' : '') + a.join(','); };
const signed = (n, d = 2) => (n < 0 ? '−' : '+') + Math.abs(n).toFixed(d).replace('.', ',');
// skriv bare når verdien endres (billig)
const setText = (n, s) => { if (n._t !== s) { n.textContent = s; n._t = s; } };
// samle transform/opacity/filter i ett kall
function put(n, o) {
  const tr = `translate3d(${(o.x || 0).toFixed(2)}px,${(o.y || 0).toFixed(2)}px,0) scale(${(o.s == null ? 1 : o.s).toFixed(4)})${o.r ? ' rotate(' + o.r.toFixed(2) + 'deg)' : ''}`;
  if (n._tr !== tr) { n.style.transform = tr; n._tr = tr; }
  const op = o.o == null ? 1 : clamp(o.o);
  if (n._op !== op) { n.style.opacity = op; n._op = op; n.style.visibility = op < .004 ? 'hidden' : 'visible'; }
  const f = o.b > .05 ? `blur(${o.b.toFixed(2)}px)` : 'none';
  if (n._f !== f) { n.style.filter = f; n._f = f; }
}
// tekst/element som glir inn og ut: reveal(n, lt, inn, ut, valg)
function reveal(n, lt, a, z, o) {
  o = o || {};
  const p = ease.out(seg(lt, a, a + (o.d || .7))), q = z == null ? 0 : ease.io(seg(lt, z, z + (o.od || .35)));
  put(n, { o: p * (1 - q), x: (1 - p) * (o.dx || 0), y: (1 - p) * (o.dy == null ? 28 : o.dy) - q * (o.dyo == null ? 10 : o.dyo), s: lerp(o.s0 == null ? 1 : o.s0, 1, p) * (1 + q * (o.so || 0)), b: RM ? 0 : (1 - p) * (o.b == null ? 12 : o.b) + q * 6 });
  return p * (1 - q);
}

/* ===================================================================== 2. KONFIG + LYD-BUS */
const Q = new URLSearchParams(location.search);
const RENDER = Q.has('render');                                   // opptaksmodus (ingen kontroller)
const DEV = Q.has('dev');                                         // spolebar og scene-hopp
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches && !Q.has('motion');   // redusert bevegelse

/* Lyd-bus. Scener sender hendelser (cues) – ingenting er koblet til lyd som standard.
   Koble på egne lyder:  KH.onSound((navn) => { ... })   eller trykk «Lyd» for den innebygde syntetiske lyden. */
const Sfx = (() => {
  const subs = []; let ctx = null, on = false, master = null;
  const emit = (name, data) => { subs.forEach(f => { try { f(name, data); } catch (e) { } }); if (on) synth(name); };
  function enable(v) {
    on = v;
    if (v && !ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) { on = false; return; } ctx = new AC(); master = ctx.createGain(); master.gain.value = .5; master.connect(ctx.destination); }
    if (v && ctx && ctx.state === 'suspended') ctx.resume();
  }
  const tone = (f, t0, d, type, g, f2) => { const o = ctx.createOscillator(), v = ctx.createGain(); o.type = type || 'sine'; o.frequency.setValueAtTime(f, t0); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + d); v.gain.setValueAtTime(0, t0); v.gain.linearRampToValueAtTime(g, t0 + .004); v.gain.exponentialRampToValueAtTime(.0001, t0 + d); o.connect(v); v.connect(master); o.start(t0); o.stop(t0 + d + .02); };
  function noise(t0, d, f1, f2, g) { const n = Math.floor(ctx.sampleRate * d), b = ctx.createBuffer(1, n, ctx.sampleRate), c = b.getChannelData(0); for (let i = 0; i < n; i++) c[i] = Math.random() * 2 - 1; const s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), v = ctx.createGain(); s.buffer = b; bp.type = 'bandpass'; bp.frequency.setValueAtTime(f1, t0); bp.frequency.exponentialRampToValueAtTime(f2, t0 + d); v.gain.setValueAtTime(0, t0); v.gain.linearRampToValueAtTime(g, t0 + d * .35); v.gain.linearRampToValueAtTime(0, t0 + d); s.connect(bp); bp.connect(v); v.connect(master); s.start(t0); }
  function synth(name) {
    if (!ctx) return; const t = ctx.currentTime;
    if (name === 'scan-tick') tone(2100, t, .04, 'triangle', .05);
    else if (name === 'scene-transition') noise(t, .5, 300, 2400, .09);
    else if (name === 'analysis-start') { tone(110, t, .7, 'sawtooth', .05, 520); noise(t, .7, 200, 3200, .05); }
    else if (name === 'risk-detection') { tone(880, t, .25, 'sine', .08); tone(1320, t + .09, .3, 'sine', .07); }
    else if (name === 'count-tick') tone(1500, t, .03, 'square', .015);
    else if (name === 'report-complete') [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, t + i * .07, 1.2, 'triangle', .07));
    else if (name === 'click') tone(700, t, .05, 'sine', .06, 420);
  }
  return { on: f => subs.push(f), emit, enable, get enabled() { return on; } };
})();

/* ===================================================================== 3. DATA (alt er fiktivt) */
const ITEMS = [
  ['7071862047727', 'LINEA GAVEBÅND', 8.72], ['7038010002274', 'JORDBÆR 1000G', 39.90], ['7025110196576', 'EGG FRITTGÅENDE 6P', 32.90],
  ['7340191181243', 'VASKEMIDDEL 1000ML', 20.00], ['7044416015367', 'HVETEMEL 1KG', 20.50], ['7330196001042', 'SKRUER NO4 FRESH S4', 101.90],
  ['7035620058783', 'MELK LETT 1L', 21.90], ['7040913336684', 'KAFFE FILTER 500G', 54.90], ['7311041012582', 'POTETCHIPS 200G', 29.90], ['7090039310182', 'FLØTEBOLLER 4PK', 36.50]
];
/* generateTransactions(seed, n): deterministiske, realistisk utseende transaksjonslinjer.
   Hver har tid, kasse, beløp og eventuelt et avviksmerke (tag) som er laget for å drukne i mengden. */
function generateTransactions(seed, n, anomalyEvery) {
  const r = rng(seed), out = []; let s = 10 * 3600 + 41 * 60 + 4;
  const tags = ['RETUR', 'PANT', 'RABATT', 'KONTANT TILBAKE', 'KASSADIFFERANSE'];
  for (let i = 0; i < n; i++) {
    s += 3 + Math.floor(r() * 24);
    const hh = String(Math.floor(s / 3600) % 24).padStart(2, '0'), mm = String(Math.floor(s / 60) % 60).padStart(2, '0'), ss = String(s % 60).padStart(2, '0');
    const k = 1 + Math.floor(r() * 3);
    let amt = Math.round((20 + r() ** 2 * 780) * 10) / 10 + Math.round(r() * 9) / 100, tag = '';
    if (anomalyEvery && i % anomalyEvery === anomalyEvery - 1) {
      tag = tags[Math.floor(r() * tags.length)];
      amt = tag === 'RETUR' ? -(40 + Math.floor(r() * 400)) : tag === 'PANT' ? -40 : tag === 'KONTANT TILBAKE' ? -320 : tag === 'KASSADIFFERANSE' ? -(7 + Math.floor(r() * 18)) : amt * .5;
    } else if (r() < .06) amt = -amt * .2;
    out.push({ time: `${hh}:${mm}:${ss}`, k, amt, tag, text: `${hh}:${mm}:${ss}  Kasse ${k}  ${signed(amt)}` });
  }
  return out;
}
// de fem eksemplene fra manus først, deretter generert strøm
const HERO_ROWS = (() => {
  const base = [['10:41:04', 2, 439.5, ''], ['10:41:17', 1, 87.9, ''], ['10:42:03', 3, -320, 'RETUR'], ['10:42:19', 2, 125.4, ''], ['10:43:01', 1, 699, '']]
    .map(([time, k, amt, tag]) => ({ time, k, amt, tag, text: `${time}  Kasse ${k}  ${signed(amt)}` }));
  return base.concat(generateTransactions(21, 70, 9));
})();

// risikokort (RRS = 100 · (1 − 2^(−poeng/8)) – samme formel som i produktet)
const rrs = p => Math.round(100 * (1 - Math.pow(2, -p / 8)));
const RISK = [
  { id: 'A', lvl: 'hi', score: 10, bong: '1001-2-2371', kasse: 2, kasserer: 4103, tags: ['Stor panteretur', 'Mange pantelapper', 'Kontant tilbake uten salg'] },
  { id: 'B', lvl: 'hi', score: 9, bong: '1001-1-2344', kasse: 1, kasserer: 4101, tags: ['Retur uten salg'] },
  { id: 'C', lvl: 'mid', score: 6, bong: '1001-3-2316', kasse: 3, kasserer: 4101, tags: ['Rabatt uten årsak'] },
  { id: 'D', lvl: 'mid', score: 5, bong: '1002-1-2099', kasse: 1, kasserer: 4201, tags: ['Manuell pantelapp'] },
  { id: 'E', lvl: 'lo', score: 3, bong: '1001-2-2060', kasse: 2, kasserer: 4103, tags: ['Avvikende pris'] }
];
const LVL = { hi: ['HØY RISIKO', '#E5483B'], mid: ['MIDDELS', '#F2A33A'], lo: ['LAV', '#2FBF7A'] };

/* ===================================================================== 4. KOMPONENTER */

/* ---- 4a. Datastrøm på canvas: hundrevis av små kvitteringslinjer ---- */
function TxCanvas(host, opt) {
  opt = opt || {};
  const cv = el('canvas', 'fx'); cv.width = 1920; cv.height = 1080; host.appendChild(cv);
  const ctx = cv.getContext('2d'), rows = generateTransactions(opt.seed || 7, 500, 11), cols = opt.cols || 8, rh = 24, N = rows.length;
  const colW = 1920 / cols, hash = i => { const x = Math.sin(i * 12.9898 + 4.1414) * 43758.5453; return x - Math.floor(x); };
  function draw(t, p) {
    // p: { density 0..1, speed px/s, alpha, hot 0..1 (avvik lyser), clip:[x,y,w,h] }
    ctx.clearRect(0, 0, 1920, 1080);
    ctx.save();
    if (p.clip) { ctx.beginPath(); ctx.rect(p.clip[0], p.clip[1], p.clip[2], p.clip[3]); ctx.clip(); }
    ctx.font = '15px "DejaVu Sans Mono", ui-monospace, monospace'; ctx.textBaseline = 'middle';
    const vis = Math.ceil(1080 / rh) + 2;
    for (let c = 0; c < cols; c++) {
      const sp = (p.speed || 0) * (.6 + hash(c * 3 + 1) * .9), off = RM ? 0 : (t * sp + hash(c) * 9999), base = Math.floor(off / rh), frac = off - base * rh;
      for (let i = 0; i < vis; i++) {
        const idx = ((base + i) * 7 + c * 53) % N, row = rows[idx];
        const h = hash(idx + c * 131);
        if (h > p.density) continue;
        const y = 1080 - (i * rh - frac) + 0, hot = row.tag ? (p.hot || 0) : 0;
        const a = (p.alpha == null ? .2 : p.alpha) * (.45 + hash(idx * 3) * .75);
        ctx.fillStyle = row.tag ? `rgba(${lerp(170, 242, hot)},${lerp(205, 163, hot)},${lerp(190, 58, hot)},${a + hot * .55})` : `rgba(165,205,185,${a})`;
        ctx.fillText(row.text + (row.tag && (p.tags ? true : false) ? '  ' + row.tag : ''), c * colW + 18, y);
      }
    }
    ctx.restore();
  }
  return { cv, draw };
}

/* ---- 4b. Prikkfelt: 1 284 bonger (analysemotoren) ---- */
const DOT = (() => {
  const N = 1284, cols = 66, rows = 20, cell = 24, x0 = (1920 - cols * cell) / 2 + cell / 2, y0 = 350, r = rng(5);
  // rangering = hvor lenge prikken «overlever» når utvalget snevres inn: 0–11 = de 12 først
  const order = Array.from({ length: N }, (_, i) => i); for (let i = N - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const rank = new Array(N); order.forEach((cellIdx, rk) => { rank[cellIdx] = rk; });
  const pos = i => [x0 + (i % cols) * cell, y0 + Math.floor(i / cols) * cell];
  // 12 sluttprikker: 4 høy, 5 middels, 3 lav
  const tier = rk => rk < 4 ? 3 : rk < 9 ? 2 : rk < 12 ? 1 : rk < 32 ? 2 : rk < 86 ? 1 : rk < 291 ? 0 : -1;
  const col = [[84, 150, 118, .35], [226, 170, 70, .7], [242, 163, 58, .95], [229, 72, 59, 1]];
  return { N, cols, rows, cell, x0, y0, rank, pos, tier, col };
})();
function DotField(host) {
  const cv = el('canvas', 'fx'); cv.width = 1920; cv.height = 1080; host.appendChild(cv);
  const ctx = cv.getContext('2d');
  // p: scan 0..1 (stråle), value (antall prikker i live), form 0..1 (samles i rad), glow
  function draw(p) {
    ctx.clearRect(0, 0, 1920, 1080);
    const { N, cols, cell, rank, tier } = DOT, bx = DOT.x0 + p.scan * cols * cell, size = 15;
    for (let i = 0; i < N; i++) {
      const rk = rank[i], alive = p.value == null ? 1 : (rk < 12 && p.value <= 14 ? 1 : clamp((p.value - rk) / 3));
      if (alive <= 0.004) continue;
      let [x, y] = DOT.pos(i);
      const px = x - bx, scanned = clamp((bx - x) / 90 + 1) * (p.scan > 0 ? 1 : 0), fresh = clamp(1 - (bx - x) / 160) * (bx >= x ? 1 : 0);
      const tr = tier(rk); let c = DOT.col[Math.max(0, tr)], a = c[3], s = size, rr = c[0], gg = c[1], bb = c[2];
      if (tr < 0) { rr = 84; gg = 150; bb = 118; a = .22; }
      // ikke skannet ennå: kald, dempet; skannet: får farge etter risiko
      const heat = tr >= 0 ? scanned : scanned * .6;
      const baseA = lerp(.14, a, heat);
      let al = baseA + fresh * .55;
      if (tr < 0) { rr = lerp(120, 47, scanned); gg = lerp(160, 191, scanned); bb = lerp(140, 122, scanned); al = lerp(.16, .3, scanned) + fresh * .5; }
      // samling i rad (de 12 siste)
      if (p.form > 0 && rk < 12) {
        const tx = 960 + (rk - 5.5) * 104, ty = 585;
        x = lerp(x, tx, p.form); y = lerp(y, ty, p.form); s = lerp(size, 64, p.form); al = Math.max(al, .98);
        // sluttfarge: 4 røde, 5 oransje, 3 grønne
        const fc = rk < 4 ? [229, 72, 59] : rk < 9 ? [242, 163, 58] : [47, 191, 122]; rr = lerp(rr, fc[0], p.form); gg = lerp(gg, fc[1], p.form); bb = lerp(bb, fc[2], p.form);
      } else if (p.value != null && p.value < N) {
        s = lerp(size, size * 1.35, 1 - p.value / N);
      }
      ctx.globalAlpha = clamp(al) * alive * (p.dim == null ? 1 : p.dim);
      ctx.fillStyle = `rgb(${rr | 0},${gg | 0},${bb | 0})`;
      const h = s / 2; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x - h, y - h, s, s, Math.max(2, s * .22)); else ctx.rect(x - h, y - h, s, s); ctx.fill();
      if (p.form > .2 && rk < 12) { ctx.globalAlpha = .35 * p.form; ctx.shadowBlur = 38; ctx.shadowColor = ctx.fillStyle; ctx.fill(); ctx.shadowBlur = 0; }
    }
    ctx.globalAlpha = 1;
    // stråle
    if (p.beam > 0) {
      const g = ctx.createLinearGradient(bx - 150, 0, bx + 6, 0); g.addColorStop(0, 'rgba(47,191,122,0)'); g.addColorStop(1, `rgba(120,255,190,${.35 * p.beam})`);
      ctx.fillStyle = g; ctx.fillRect(bx - 150, DOT.y0 - 40, 156, DOT.rows * DOT.cell + 40);
      ctx.fillStyle = `rgba(190,255,220,${.9 * p.beam})`; ctx.fillRect(bx, DOT.y0 - 40, 2, DOT.rows * DOT.cell + 40);
    }
  }
  return { cv, draw };
}

/* ---- 4c. Markør (musepeker) med klikk-ring ---- */
function Cursor(host) {
  const c = el('div', 'cursor', '<svg width="44" height="44" viewBox="0 0 44 44"><path d="M8 4l0 28 8-7 6 13 6-3-6-13h11z" fill="#fff" stroke="#07110D" stroke-width="2.4" stroke-linejoin="round"/></svg><div class="rip"></div>');
  host.appendChild(c); const rip = c.querySelector('.rip');
  return {
    node: c,
    /* path: [[t,x,y],...]  clicks: [t,...] */
    update(lt, path, clicks, vis) {
      const x = kf(lt, path.map(p => [p[0], p[1], ease.io])), y = kf(lt, path.map(p => [p[0], p[2], ease.io]));
      let press = 0, ring = 0; (clicks || []).forEach(ct => { const d = lt - ct; if (d > -.06 && d < .12) press = Math.max(press, 1 - Math.abs(d - .03) / .09); if (d > 0 && d < .5) ring = Math.max(ring, 1 - d / .5); });
      put(c, { x, y, s: 1 - .1 * clamp(press), o: vis == null ? 1 : vis });
      rip.style.opacity = RM ? 0 : ring * .8; rip.style.transform = `scale(${.4 + (1 - ring) * 1.6})`;
      return press;
    }
  };
}

/* ---- 4d. Kvitteringshenter-panel (kompakt analysepanel som ligger over journalen) ---- */
function Panel(host, o) {
  o = o || {};
  const p = el('div', 'kh');
  p.innerHTML = `
  <div class="kh-head"><span class="grip"></span>Kvitteringshenter<span class="chip" data-r="chip">ingen filter</span><span class="ic">?</span><span class="ic">⚙</span></div>
  <div class="kh-tiles"><div class="kh-tile"><b data-r="viser">0</b><span>Viser</span></div><div class="kh-tile"><b data-r="valgt">0</b><span>Valgt</span></div><div class="kh-tile"><b data-r="sum">0,00</b><span>Sum valgt (kr)</span></div><div class="kh-tile"><b data-r="dup">0</b><span>Duplikater</span></div></div>
  <div class="kh-status" data-r="status"></div>
  <div class="kh-tabs"><span data-t="0">Hent</span><span data-t="1">Filtrer</span><span data-t="2">Skann</span><span data-t="3">Analyse</span><span data-t="4">Mer</span><i data-r="ul"></i></div>
  <div class="kh-body" data-r="body"></div>`;
  host.appendChild(p);
  const r = {}; p.querySelectorAll('[data-r]').forEach(n => { r[n.dataset.r] = n; });
  const tabs = [...p.querySelectorAll('.kh-tabs span')];
  const api = {
    el: p, r, tabs,
    /* tab: kan være flytende tall (glir mellom faner) */
    setTab(t) { const i = Math.round(t); tabs.forEach((n, k) => n.classList.toggle('on', k === i)); r.ul.style.transform = `translateX(${t * 100}%)`; },
    tiles(viser, valgt, sum, dup) { setText(r.viser, nb(viser)); setText(r.valgt, nb(valgt)); setText(r.sum, money(sum)); setText(r.dup, nb(dup)); },
    status(html) { if (r.status._h !== html) { r.status.innerHTML = html; r.status._h = html; } },
    chip(t) { setText(r.chip, t); }
  };
  api.setTab(o.tab || 0);
  return api;
}

/* panel-innhold (rene funksjoner av tid) – brukes både i reklamen og i demoen */
const PanelPanes = {
  /* HENT */
  hent(panel, lt, opt) {
    opt = opt || {};
    if (!panel._hent) {
      const d = el('div', 'kh-pane'); d.innerHTML = `
      <div class="kh-card"><div class="kh-h">SØK I HELE JOURNALEN (CW)</div>
        <div class="kh-lbl" style="margin-top:0">Dato</div>
        <div class="kh-chips" data-r="dato"><span>I dag</span><span>I går</span><span>Siste 7 dager</span><span>Denne måneden</span></div>
        <div class="kh-lbl">Butikk</div>
        <div class="kh-list"><div class="kh-row"><i class="kh-cb" data-r="cb1"></i><span>1001 – Eksempel Sentrum</span><em>1${NB}284</em></div><div class="kh-row"><i class="kh-cb"></i><span>1002 – Eksempel Torget</span><em>671</em></div></div>
        <div class="kh-2c"><div><div class="kh-lbl">Medlemsnummer</div><div class="kh-inp">kommaseparert</div></div><div><div class="kh-lbl">Vare</div><div class="kh-inp">EAN eller navn</div></div></div>
        <div class="kh-lbl">Bongnummer</div><div class="kh-inp">for eksempel 1001-2-2371</div>
      </div>
      <div class="kh-btn p" data-r="sok">SØK</div>`;
      panel.r.body.appendChild(d); panel._hent = { d, r: {} }; d.querySelectorAll('[data-r]').forEach(n => { panel._hent.r[n.dataset.r] = n; });
    }
    const h = panel._hent, c = h.r.dato.children;
    c[2].classList.toggle('on', lt >= (opt.tDato || 1));
    h.r.cb1.classList.toggle('on', lt >= (opt.tButikk || 1.4));
    const press = clamp(1 - Math.abs(lt - (opt.tSok || 1.85) - .04) / .09);
    put(h.r.sok, { s: 1 - .03 * press });
    h.r.sok.classList.toggle('dis', lt > (opt.tSok || 1.85));
    return h;
  },
  /* SKANN */
  skann(panel, lt, opt) {
    opt = opt || {};
    if (!panel._skann) {
      const d = el('div', 'kh-pane'); d.innerHTML = `
      <div class="kh-card"><div class="kh-h">SKANNING</div>
        <div class="kh-btn p" data-r="btn">Skann innhold (synlige)</div>
        <div class="kh-bar"><i data-r="bar"></i></div>
        <div class="kh-prog"><span data-r="lbl">Skanner kvitteringer</span><span data-r="cnt">0 / 1${NB}284</span></div>
        <div class="kh-ticks" data-r="ticks"></div>
      </div>
      <div class="kh-card" data-r="done" style="opacity:0"><div class="kh-h">STATUS</div><div class="kh-note"><b style="color:var(--g)">✓</b> Analysegrunnlag klart.</div></div>`;
      panel.r.body.appendChild(d); const r = {}; d.querySelectorAll('[data-r]').forEach(n => { r[n.dataset.r] = n; });
      r.tk = ['Varelinjer', 'Pant', 'Rabatt', 'Betaling', 'Kupong'].map(t => { const k = el('div', 'kh-tick', `<b>✓</b> ${t}`); r.ticks.appendChild(k); return k; });
      r.fl = ['399 PANTELAPP −40,00', 'RABATT 50 %', '220 PANT 2,00', 'Kupong (1ESD2LJ54X)', 'Bank 439,50', '7071862047727 GAVEBÅND', 'Kontant tilbake 320,00', 'RETUR −101,90'].map(t => { const f = el('div', 'kh-float', t); d.appendChild(f); return f; });
      panel._skann = { d, r };
    }
    const s = panel._skann, r = s.r, t0 = opt.t0 || .55, t1 = opt.t1 || 1.95;
    const pr = ease.io(seg(lt, t0, t1)), n = Math.round(1284 * pr);
    r.bar.style.transform = `scaleX(${pr.toFixed(4)})`;
    setText(r.cnt, `${nb(n)} / ${nb(1284)}`);
    r.btn.classList.toggle('dis', lt > t0 - .05); setText(r.btn, lt > t0 - .05 ? (pr >= 1 ? 'Skannet' : 'Skanner …') : 'Skann innhold (synlige)');
    setText(r.lbl, pr >= 1 ? 'Skanning ferdig' : 'Skanner kvitteringer');
    r.tk.forEach((k, i) => { const a = t0 + .15 + i * .28; put(k, { o: seg(lt, a, a + .22), s: lerp(.85, 1, ease.back(seg(lt, a, a + .3))), y: (1 - ease.out(seg(lt, a, a + .3))) * 8 }); });
    // datapunkter som stiger opp fra stolpen mens det skannes
    r.fl.forEach((f, i) => { const a = t0 + .1 + i * .17, q = seg(lt, a, a + .9); put(f, { x: 20 + (i % 4) * 160 + (i > 3 ? 60 : 0), y: lerp(430 + (i % 2) * 40, 262, ease.io(q)), o: Math.sin(Math.PI * q) * (RM ? .0 : 1), s: .96 }); f.style.left = '0'; f.style.top = '0'; });
    put(r.done, { o: seg(lt, t1 + .05, t1 + .35), y: (1 - ease.out(seg(lt, t1 + .05, t1 + .4))) * 12 });
    return { n, pr };
  },
  /* ANALYSE (knapp) */
  analyse(panel, lt, opt) {
    opt = opt || {};
    if (!panel._an) {
      const d = el('div', 'kh-pane'); d.innerHTML = `
      <div class="kh-card"><div class="kh-h">ANALYSE</div><div class="kh-note" style="margin-bottom:14px">Omfang: hele listen · 1${NB}284 bonger</div>
        <div class="kh-btn p" data-r="btn" style="font-size:20px;padding:18px">KJØR ANALYSE</div>
        <div class="kh-bar" style="margin-top:18px"><i data-r="bar"></i></div><div class="kh-prog"><span data-r="lbl">Klar</span><span data-r="pc">0 %</span></div></div>
      <div class="kh-card"><div class="kh-h">KONTROLLER</div><div class="kh-chips"><span>Returer</span><span>Pant</span><span>Rabatter</span><span>Kassadifferanser</span><span>Mønstre</span><span>Kasserere</span><span>Bongsekvenser</span></div></div>`;
      panel.r.body.appendChild(d); const r = {}; d.querySelectorAll('[data-r]').forEach(n => { r[n.dataset.r] = n; }); panel._an = { d, r };
    }
    const r = panel._an.r, t0 = opt.tKlikk || .45, pr = ease.io(seg(lt, t0 + .1, opt.tEnd || 1.9));
    const press = clamp(1 - Math.abs(lt - t0 - .04) / .09); put(r.btn, { s: 1 - .03 * press });
    const run = lt > t0; r.btn.classList.toggle('dis', run); setText(r.btn, run ? 'ANALYSERER …' : 'KJØR ANALYSE');
    r.bar.style.transform = `scaleX(${pr.toFixed(4)})`; setText(r.pc, Math.round(pr * 100) + ' %'); setText(r.lbl, run ? 'Analyserer' : 'Klar');
    return pr;
  }
};

/* ---- 4e. Små diagrammer (SVG) som tegnes gradvis: createChart(type) → { el, update(p, t) } ---- */
const GREEN = '#2FBF7A', RED = '#E5483B', AMB = '#F2A33A', GRID = 'rgba(255,255,255,.09)', TXT = 'rgba(190,215,200,.8)';
function createChart(type) {
  const svg = sv('svg', { viewBox: '0 0 384 226' });
  const txt = (x, y, s, o) => { const t = sv('text', Object.assign({ x, y, fill: TXT, 'font-size': 12, 'font-family': 'Inter,sans-serif', 'font-weight': 600 }, o || {}), svg); t.textContent = s; return t; };
  const line = (x1, y1, x2, y2, c, w, dash) => sv('line', { x1, y1, x2, y2, stroke: c || GRID, 'stroke-width': w || 1, 'stroke-dasharray': dash || '' }, svg);
  const set = (n, a) => { for (const k in a) n.setAttribute(k, a[k]); };
  let update = () => {}, cap = ['', false];

  if (type === 'retur') {                 // RETURANDEL PER KASSERER
    const d = [['4101', 2.4], ['4102', 1.8], ['4103', 8.9], ['4201', 2.0], ['4202', 1.6]], bars = [], vals = [];
    d.forEach((r, i) => { const y = 14 + i * 40; txt(0, y + 16, r[0], { 'font-family': 'DejaVu Sans Mono,monospace' }); bars.push(sv('rect', { x: 62, y, width: 0, height: 22, rx: 6, fill: r[1] > 5 ? RED : GREEN, opacity: r[1] > 5 ? 1 : .75 }, svg)); vals.push(txt(0, y + 16, '', { fill: '#fff', 'font-size': 13, 'font-weight': 800 })); });
    const avg = line(62 + 2.1 * 36, 4, 62 + 2.1 * 36, 214, 'rgba(255,255,255,.55)', 1.5, '4 4'), at = txt(62 + 2.1 * 36 + 6, 222, 'butikksnitt 2,1 %', { 'font-size': 11 });
    update = p => { d.forEach((r, i) => { const q = ease.out(seg(p, i * .09, .5 + i * .09)), w = r[1] * 36 * q; bars[i].setAttribute('width', w); set(vals[i], { x: 62 + w + 8, opacity: q }); vals[i].textContent = dec(r[1] * q, 1) + ' %'; }); const o = seg(p, .7, .9); avg.setAttribute('opacity', o); at.setAttribute('opacity', o); };
    cap = ['Kasserer 4103 skiller seg ut', true];
  }
  else if (type === 'diff') {             // KASSADIFFERANSE OVER TID
    const v = [1, -2, -12, -7, -18, -9, -24, -11], X = i => 14 + i * 50, Y = a => 24 + (6 - a) / 32 * 170;
    line(8, Y(0), 380, Y(0), 'rgba(255,255,255,.3)', 1, '3 4'); txt(8, Y(0) - 6, '0');
    const dpath = v.map((a, i) => (i ? 'L' : 'M') + X(i) + ',' + Y(a)).join(' ');
    const path = sv('path', { d: dpath, fill: 'none', stroke: '#9be6c3', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 1 }, svg);
    const dots = v.map((a, i) => sv('circle', { cx: X(i), cy: Y(a), r: a <= -9 ? 5.5 : 3.5, fill: a <= -9 ? RED : '#9be6c3', opacity: 0 }, svg));
    update = (p, t) => { path.setAttribute('stroke-dashoffset', 1 - ease.io(seg(p, 0, .8))); dots.forEach((c, i) => { const q = seg(p, .08 + i * .09, .2 + i * .09); c.setAttribute('opacity', q); if (v[i] <= -9) c.setAttribute('r', 5.5 + (q >= 1 ? Math.sin((t || 0) * 5 + i) * .8 : 0)); }); };
    cap = ['Gjentakende negativ differanse', true];
  }
  else if (type === 'pant') {             // PANT PER DAG
    const v = [12, 14, 11, 13, 15, 12, 41], days = ['ma', 'ti', 'on', 'to', 'fr', 'lø', 'sø'], bars = [];
    v.forEach((a, i) => { const x = 18 + i * 52; txt(x + 4, 220, days[i], { 'font-size': 12 }); bars.push(sv('rect', { x, y: 200, width: 36, height: 0, rx: 6, fill: a > 30 ? RED : GREEN, opacity: a > 30 ? 1 : .75 }, svg)); });
    line(8, 200, 380, 200, 'rgba(255,255,255,.25)');
    update = p => v.forEach((a, i) => { const q = ease.out(seg(p, i * .07, .5 + i * .07)), h = a / 41 * 168 * q; set(bars[i], { y: 200 - h, height: h }); });
    cap = ['Én dag skiller seg ut', true];
  }
  else if (type === 'heat') {             // KASSE × TIME
    const cells = [], w = 13.2, r = rng(3);
    for (let k = 0; k < 3; k++) { txt(0, 52 + k * 56, 'K' + (k + 1), { 'font-size': 12 }); for (let h = 0; h < 24; h++) { const peak = Math.exp(-((h - 12) ** 2) / 6) + .8 * Math.exp(-((h - 17.5) ** 2) / 7); let v = clamp(peak * (k === 1 ? 1 : .7) + r() * .12); if (k === 1 && h === 21) v = 1.4; cells.push({ v, h, k, n: sv('rect', { x: 26 + h * 14.5, y: 30 + k * 56, width: w, height: 44, rx: 3, fill: 'rgba(255,255,255,.05)' }, svg) }); } }
    [0, 6, 12, 18, 23].forEach(h => txt(26 + h * 14.5, 212, String(h), { 'font-size': 11 }));
    update = p => cells.forEach(c => { const q = ease.out(seg(p, c.h / 24 * .55, c.h / 24 * .55 + .35)); const hot = c.v > 1.2; set(c.n, { fill: hot ? RED : `rgba(47,191,122,${.07 + Math.min(c.v, 1) * .9 * q})`, opacity: hot ? q : 1 }); });
    cap = ['Kasse 2 skiller seg ut sent på kvelden', true];
  }
  else if (type === 'rabatt') {           // RABATTMØNSTRE
    const v = [38, 27, 9, 5, 3, 1, 0, 1], bars = [];
    v.forEach((a, i) => { const x = 14 + i * 46; txt(x + 4, 220, (i + 1) * 10 + '', { 'font-size': 12 }); bars.push(sv('rect', { x, y: 200, width: 34, height: 0, rx: 5, fill: i === 7 ? RED : GREEN, opacity: i === 7 ? 1 : .75 }, svg)); });
    line(8, 200, 380, 200, 'rgba(255,255,255,.25)'); const lb = txt(318, 150, '80 %', { fill: '#ff8a7e', 'font-size': 15, 'font-weight': 800, opacity: 0 });
    update = p => { v.forEach((a, i) => { const q = ease.out(seg(p, i * .06, .5 + i * .06)); let h = Math.max(a, i === 7 ? 6 : 0) / 38 * 150 * q; set(bars[i], { y: 200 - h, height: h }); }); lb.setAttribute('opacity', seg(p, .75, .95)); };
    cap = ['80 % faller utenfor det vanlige', true];
  }
  else if (type === 'bong') {             // BONGNUMMER
    const ticks = []; for (let i = 0; i < 40; i++) { const gap = i >= 24 && i <= 27; ticks.push({ gap, n: sv('rect', { x: 10 + i * 9.3, y: 70, width: 5, height: 60, rx: 2, fill: gap ? RED : GREEN, opacity: 0 }, svg) }); }
    txt(8, 56, '2332', { 'font-size': 12 }); txt(352, 56, '2371', { 'font-size': 12 });
    const gl = txt(10 + 24 * 9.3 - 14, 156, 'hull i rekken', { fill: '#ff8a7e', 'font-weight': 800, opacity: 0 });
    update = (p, t) => { ticks.forEach((c, i) => { const q = seg(p, i / 40 * .6, i / 40 * .6 + .12); set(c.n, { opacity: c.gap ? (q > 0 ? .0 : 0) : q * .8 }); }); const g = seg(p, .72, .9); ticks.forEach(c => { if (c.gap) set(c.n, { opacity: g * (.5 + .5 * Math.sin((t || 0) * 6) ** 2) }); }); gl.setAttribute('opacity', g); };
    cap = ['Manglende bongnumre i sekvensen', true];
  }
  else if (type === 'medlem') {           // MEDLEMSMØNSTRE
    const v = [2, 1, 3, 2, 10, 1], lab = ['75•••021', '75•••044', '75•••067', '75•••082', '75•••111', '75•••190'], bars = [];
    v.forEach((a, i) => { const x = 16 + i * 62; txt(x - 2, 220, lab[i].slice(-3), { 'font-size': 11 }); bars.push(sv('rect', { x, y: 200, width: 44, height: 0, rx: 6, fill: a > 6 ? RED : GREEN, opacity: a > 6 ? 1 : .75 }, svg)); });
    line(8, 200, 380, 200, 'rgba(255,255,255,.25)'); const lb = txt(16 + 4 * 62 - 6, 30, '10 bonger på én dag', { fill: '#ff8a7e', 'font-weight': 800, opacity: 0, 'font-size': 12 });
    update = p => { v.forEach((a, i) => { const q = ease.out(seg(p, i * .08, .5 + i * .08)), h = a / 10 * 150 * q; set(bars[i], { y: 200 - h, height: h }); }); lb.setAttribute('opacity', seg(p, .7, .9)); };
    cap = ['Samme medlemsnummer, mange bonger', true];
  }
  else if (type === 'pris') {             // PRISAVVIK
    const r = rng(9), pts = []; line(8, 90, 380, 90, 'rgba(255,255,255,.35)', 1.2, '4 4'); txt(300, 82, '32,90', { 'font-size': 11 });
    for (let i = 0; i < 34; i++) pts.push({ out: false, n: sv('circle', { cx: 16 + i * 10.6, cy: 90 + (r() - .5) * 12, r: 3.4, fill: GREEN, opacity: 0 }, svg) });
    const o = sv('circle', { cx: 16 + 24 * 10.6, cy: 150, r: 6, fill: RED, opacity: 0 }, svg); const ol = txt(16 + 24 * 10.6 - 34, 178, '24,90', { fill: '#ff8a7e', 'font-weight': 800, opacity: 0 });
    update = (p, t) => { pts.forEach((c, i) => c.n.setAttribute('opacity', seg(p, i / 34 * .6, i / 34 * .6 + .1) * .8)); const q = seg(p, .7, .85); o.setAttribute('opacity', q); o.setAttribute('r', 6 + Math.sin((t || 0) * 6) * 1.2 * q); ol.setAttribute('opacity', q); };
    cap = ['Pris langt fra vanlig pris samme dag', true];
  }
  return { svg, update, cap };
}
const CHARTS = [['retur', 'Returandel per kasserer'], ['diff', 'Kassadifferanse over tid'], ['pant', 'Pant per dag'], ['heat', 'Kasse × time'], ['rabatt', 'Rabattmønstre'], ['bong', 'Bongnummer'], ['medlem', 'Medlemsmønstre'], ['pris', 'Prisavvik']];

/* ---- 4f. Hjelpere fra manus: tall som teller, tekst som skrives, avvik som markeres ---- */
/* animateCounter(node, steps, lt): steps = [[tid, verdi], …] – raske, myke sprang mellom verdiene */
function animateCounter(node, steps, lt, fmt) {
  const v = kf(lt, steps.map(s => [s[0], s[1], ease.out])); setText(node, (fmt || nb)(v)); return v;
}
/* typeText(node, text, lt, start, cps): skriver tekst tegn for tegn som en funksjon av tid */
function typeText(node, text, lt, start, cps) { const n = clamp(Math.floor((lt - start) * (cps || 28)), 0, text.length); setText(node, text.slice(0, n)); return n >= text.length; }
/* highlightAnomaly(node, lt, start): svak, pulserende rød ring rundt et avvik */
function highlightAnomaly(node, lt, start) {
  const q = seg(lt, start, start + .25); if (q <= 0) { node.style.boxShadow = 'none'; return; }
  const pulse = RM ? .5 : .5 + .5 * Math.sin((lt - start) * 7);
  node.style.boxShadow = `0 0 0 ${2 + pulse * 5}px rgba(229,72,59,${(.45 - pulse * .25) * q}), inset 0 0 0 2px rgba(229,72,59,${.75 * q})`;
}
/* animateRiskScore(node, lt, start, dur, to): risikoscore som teller opp */
function animateRiskScore(node, lt, start, dur, to) { const v = Math.round(to * ease.out(seg(lt, start, start + dur))); setText(node, lt < start ? '–' : String(v)); return v; }
/* showReceipt(parent, lines): bonglinjer som kan highlightes; returnerer {rows} */
function showReceipt(parent, lines) {
  const rows = lines.map(l => { const r = el('div', 'lrow' + (l[2] ? ' neg' : ''), `<span>${l[0]}</span><span>${l[1]}</span>`); parent.appendChild(r); return r; });
  return { rows };
}

/* ===================================================================== 5. SCENER
   scene(id, varighet, (root) => ({ update(lt) }), cues)
   Hver scene er en funksjon av lokal tid. Motoren monterer og fjerner scenen; cues sendes til lyd-bussen. */
const SCENES = [];
// scener som tones ut siste overgang (resten har felles bakgrunn/panel og går direkte over i neste)
const FADEOUT = new Set(['problem', 'produkt', 'tolv', 'sjekk', 'monstre', 'funn', 'kasserer', 'rapport', 'foreetter']);
const PACE = { hook: 1.06, problem: 1.09, produkt: 1.1, hent: 1.12, skann: 1.08, analyse: 1.07, tolv: 1.12, sjekk: 1.09, monstre: 1.09, funn: 1.08, kasserer: 1.11, rapport: 1.1, foreetter: 1.11, cta: 1.14 };
// k = tempofaktor: scenens interne tidslinje spilles k ganger raskere (dur/k sekunder i virkeligheten)
const scene = (id, dur, factory, cues) => { const k = PACE[id] || 1; SCENES.push({ id, dur: dur / k, k, factory, cues: cues || [] }); };
const add = (root, cls, html, css) => { const n = el('div', cls, html); if (css) Object.assign(n.style, css); root.appendChild(n); return n; };
const LOGO_SVG = '<svg viewBox="0 0 150 150"><path fill="#fff" d="M44 30a5 5 0 0 1 5-5h52a5 5 0 0 1 5 5v94l-6-6-6 6-6-6-6 6-6-6-6 6-6-6-6 6-6-6-6 6z"/><rect x="58" y="48" width="34" height="6" rx="3" fill="#00693C" opacity=".5"/><rect x="58" y="63" width="34" height="6" rx="3" fill="#00693C" opacity=".5"/><rect x="58" y="78" width="34" height="6" rx="3" fill="#00693C" opacity=".5"/><rect x="58" y="97" width="20" height="8" rx="4" fill="#00693C"/></svg>';
function stagePos(node, ax, ay) { const r = node.getBoundingClientRect(), s = $('#stage').getBoundingClientRect(), k = s.width / 1920; return [(r.left - s.left + r.width * (ax == null ? .5 : ax)) / k, (r.top - s.top + r.height * (ay == null ? .5 : ay)) / k]; }
const ticks = (a, b, step, name) => { const o = []; for (let t = a; t < b; t += step) o.push([+t.toFixed(3), name]); return o; };

// «journalen» bak panelet: svakt, statisk – kvitteringshenter ligger over et eksisterende system
function ghostJournal(root) {
  const g = add(root, 'ghost'); const rows = HERO_ROWS.slice(0, 40);
  rows.forEach((r, i) => g.appendChild(el('div', '', `2026-10-01 ${r.time.slice(0, 5)}  ${4100 + (i % 3) + 1}  ${r.k}  1001-${r.k}-${2060 + i}  ${signed(r.amt)}`)));
  return g;
}
// venstre tekstspalte for panel-scenene
function stepCopy(root, num, label, l1, l2, sub) {
  const e = add(root, 'eyebrow', `${num} · ${label}`, { left: '140px', top: '250px' });
  const h = add(root, 'l', `${l1}<br>${l2}`, { left: '140px', top: '312px', fontSize: '150px' });
  const s = sub ? add(root, 'l mut', sub, { left: '146px', top: '640px', fontSize: '36px', fontWeight: '500', letterSpacing: '-.01em' }) : null;
  return { e, h, s };
}

/* ---------- 1 · HOOK ---------- */
scene('hook', 3.4, root => {
  const rain = TxCanvas(root, { seed: 4, cols: 9 });
  const num = add(root, 'big num', '241', { top: '265px', fontSize: '270px' });
  const lab = add(root, 'big mut', 'kvitteringer.', { top: '575px', fontSize: '112px' });
  const q = add(root, 'big', 'Hvor begynner du?', { top: '420px', fontSize: '150px' });
  const vg = add(root, 'vignette');
  root.insertBefore(vg, num);
  const steps = [[1.1, 241], [1.36, 573], [1.6, 1284], [1.84, 4892], [2.1, 12481]];
  return {
    update(lt) {
      rain.draw(lt, { density: kf(lt, [[.4, 0], [3.3, .9]], ease.in), speed: 60, alpha: .22 });
      vg.style.opacity = seg(lt, 1.9, 2.6);
      const out = ease.io(seg(lt, 2.3, 2.7));
      put(num, { o: ease.out(seg(lt, .2, .8)) * (1 - out), y: (1 - ease.out(seg(lt, .2, 1))) * 34 - out * 40, s: lerp(.94, 1, ease.out(seg(lt, .2, 1))) * lerp(1, 1.08, seg(lt, 1.1, 2.2)), b: RM ? 0 : (1 - ease.out(seg(lt, .2, .8))) * 14 + out * 10 });
      animateCounter(num, [[0, 241], ...steps], lt, nb);
      reveal(lab, lt, .45, 2.3, { d: .8, dy: 26, od: .35 });
      reveal(q, lt, 2.55, 3.1, { d: .9, dy: 36, b: 16, od: .3 });
    }
  };
}, [[0, 'scene-transition'], ...[1.1, 1.36, 1.6, 1.84, 2.1].map(t => [t, 'count-tick'])]);

/* ---------- 2 · PROBLEMET ---------- */
scene('problem', 3.5, root => {
  const rain = TxCanvas(root, { seed: 11, cols: 9 });
  const st = add(root, 'stream'), inn = add(st, 'stream-in');
  HERO_ROWS.forEach(r => inn.appendChild(el('div', 'srow', `<span>${r.time}</span><span>Kasse ${r.k}</span><span>${signed(r.amt)}</span>${r.tag ? `<span class="tg">${r.tag}</span>` : ''}`)));
  const vg = add(root, 'vignette');
  const t1 = add(root, 'big', 'Avvikene finnes i dataene.', { top: '430px', fontSize: '124px' });
  const t2 = add(root, 'big', 'Utfordringen er<br>å finne dem.', { top: '385px', fontSize: '132px' });
  return {
    update(lt) {
      rain.draw(lt, { density: 1, speed: 520, alpha: .3, hot: seg(lt, 2.75, 3.3) * .85, tags: true });
      put(st, { o: kf(lt, [[0, 0], [.2, 1], [1.2, 1], [1.7, 0]], ease.soft) });
      const off = lt < 1.2 ? 40 * lt + 400 * lt * lt : 40 * 1.2 + 400 * 1.44 + (lt - 1.2) * 1030;   // starter rolig (radene kan leses), øker til rask strøm
      inn.style.transform = `translate3d(0,${(340 - off).toFixed(1)}px,0)`;
      vg.style.opacity = kf(lt, [[0, .85], [1.1, .97]]);
      reveal(t1, lt, 1.2, 2.0, { d: .8, dy: 34, od: .35, b: 14 });
      reveal(t2, lt, 2.25, null, { d: .9, dy: 34, b: 14 });
    }
  };
}, [[0, 'scene-transition'], ...ticks(.1, 1.2, .16, 'scan-tick'), [2.7, 'risk-detection']]);

/* ---------- 3 · PRODUKTET ---------- */
scene('produkt', 3.3, root => {
  const grp = add(root, 'abs', '', { left: '0', top: '0', width: '1920px', height: '600px' });
  const logo = add(grp, 'logo-mark', LOGO_SVG, { left: '885px', top: '170px' });
  const wm = add(grp, 'wordmark', '', { top: '362px' });
  const letters = 'KVITTERINGSHENTER'.split('').map(c => { const s = el('span', '', c); wm.appendChild(s); return s; });
  const sub = add(grp, 'big mut', 'Fra kvitteringsjournal til kontrollgrunnlag.', { top: '480px', fontSize: '44px', fontWeight: '500', letterSpacing: '-.01em' });
  const wrow = add(root, 'abs', '', { left: '0', width: '1920px', top: '640px', display: 'flex', justifyContent: 'center', gap: '58px' });
  const words = ['Finn.', 'Analyser.', 'Prioriter.', 'Dokumenter.'].map(w => { const n = el('div', 'l', w.slice(0, -1) + '<span class="g">.</span>'); n.style.cssText = 'position:relative;font-size:88px'; wrow.appendChild(n); return n; });
  return {
    update(lt) {
      const mv = ease.io(seg(lt, 1.55, 2.1));
      put(grp, { y: -mv * 110, s: lerp(1, .86, mv) });
      grp.style.transformOrigin = '50% 30%';
      put(logo, { o: ease.out(seg(lt, .05, .6)), s: lerp(.78, 1, ease.out(seg(lt, .05, .8))), b: RM ? 0 : (1 - ease.out(seg(lt, .05, .6))) * 16 });
      letters.forEach((s, i) => { const a = .3 + i * .03, p = ease.out(seg(lt, a, a + .5)); put(s, { o: p, y: (1 - p) * 26, b: RM ? 0 : (1 - p) * 10 }); });
      reveal(sub, lt, .95, null, { d: .7, dy: 18 });
      words.forEach((w, i) => { const a = 1.85 + i * .34; const p = ease.out(seg(lt, a, a + .5)); put(w, { o: p, y: (1 - p) * 40, b: RM ? 0 : (1 - p) * 14 }); });
    }
  };
}, [[0, 'scene-transition'], [1.85, 'count-tick'], [2.19, 'count-tick'], [2.53, 'count-tick'], [2.87, 'count-tick']]);

/* ---------- 4 · HENT ---------- */
scene('hent', 2.9, root => {
  ghostJournal(root);
  const cp = stepCopy(root, '01', 'HENT', 'Hent', 'bongene.', null);
  const big = add(root, 'l num', '0', { left: '140px', top: '650px', fontSize: '150px', color: '#2FBF7A' });
  const bl = add(root, 'l mut', 'bonger hentet', { left: '146px', top: '815px', fontSize: '38px', fontWeight: '500', letterSpacing: '-.01em' });
  const pw = add(root, 'abs', '', { left: '0', top: '0', width: '1px', height: '1px' });
  const panel = Panel(pw, { tab: 0 }), cur = Cursor(root);
  let tg = null;
  return {
    update(lt) {
      const h = PanelPanes.hent(panel, lt, { tDato: .82, tButikk: 1.24, tSok: 1.68 });
      if (!tg) tg = { chip: stagePos(h.r.dato.children[2]), cb: stagePos(h.r.cb1), sok: stagePos(h.r.sok) };
      put(pw, { o: ease.out(seg(lt, 0, .55)), y: (1 - ease.out(seg(lt, 0, .8))) * 70, s: lerp(.96, 1, ease.out(seg(lt, 0, .8))) });
      pw.style.transformOrigin = '1360px 540px';
      panel.setTab(0);
      // tellere når SØK er trykket
      const st = [[1.72, 0], [1.98, 142], [2.24, 486], [2.5, 921], [2.76, 1284]], v = kf(lt, st.map(s => [s[0], s[1], ease.out]));
      panel.tiles(v, 0, 0, 0); panel.chip(lt > 1.3 ? 'Butikk 1001' : 'ingen filter');
      panel.status(lt > 1.72 ? `<span class="kh-spin"></span> Henter 1${NB}284 bonger …` : '');
      const sp = panel.r.status.querySelector('.kh-spin'); if (sp) sp.style.transform = `rotate(${(lt * 520) % 360}deg)`;
      const xo = 1 - seg(lt, 2.65, 2.9);
      put(big, { o: seg(lt, 1.72, 1.95) * xo, y: (1 - ease.out(seg(lt, 1.72, 2))) * 20 }); setText(big, nb(v));
      put(bl, { o: seg(lt, 1.8, 2.05) * xo });
      reveal(cp.e, lt, .1, 2.65, { od: .25 }); reveal(cp.h, lt, .15, 2.65, { d: .9, dy: 36, b: 14, od: .25 });
      cur.update(lt, [[0, 1500, 1010], [.7, tg.chip[0], tg.chip[1]], [1.15, tg.cb[0], tg.cb[1]], [1.58, tg.sok[0], tg.sok[1]], [2.2, tg.sok[0] + 170, tg.sok[1] + 130]], [.8, 1.22, 1.66], seg(lt, .45, .7) * (1 - seg(lt, 2.1, 2.4)));
    }
  };
}, [[0, 'scene-transition'], [.8, 'click'], [1.22, 'click'], [1.66, 'click'], ...[1.98, 2.24, 2.5, 2.76].map(t => [t, 'count-tick'])]);

/* ---------- 5 · SKANN ---------- */
scene('skann', 2.6, root => {
  ghostJournal(root);
  const cp = stepCopy(root, '02', 'SKANN', 'Les', 'innholdet.', null);
  const cnt = add(root, 'l num', '0 / 1 284', { left: '140px', top: '650px', fontSize: '100px' });
  const cl = add(root, 'l mut', 'Skanner kvitteringer', { left: '146px', top: '780px', fontSize: '38px', fontWeight: '500', letterSpacing: '-.01em' });
  const ok = add(root, 'l', '<span class="g">✓</span> Analysegrunnlag klart.', { left: '140px', top: '860px', fontSize: '58px' });
  const pw = add(root, 'abs', '', { left: '0', top: '0', width: '1px', height: '1px' });
  const panel = Panel(pw, { tab: 0 }); const cur = Cursor(root);
  PanelPanes.hent(panel, 9, { tDato: 0, tButikk: 0, tSok: 0 });
  panel._hent.d.style.opacity = 1;
  let tg = null;
  return {
    update(lt) {
      const sk = PanelPanes.skann(panel, lt, { t0: .6, t1: 1.95 });
      if (!tg) tg = { btn: stagePos(panel._skann.r.btn) };
      const tab = kf(lt, [[0, 0], [.08, 0], [.42, 2, ease.io]]);
      panel.setTab(tab); put(panel._hent.d, { o: 1 - seg(lt, .05, .3) }); put(panel._skann.d, { o: seg(lt, .2, .45) });
      pw.style.transformOrigin = '1360px 540px';
      panel.tiles(1284, 0, 0, 0); panel.chip('Butikk 1001');
      panel.status(sk.pr >= 1 ? `<span class="ok">Skannet 1${NB}284 av 1${NB}284</span>` : `Skannet ${nb(sk.n)} av 1${NB}284`);
      setText(cnt, `${nb(sk.n)} / ${nb(1284)}`);
      setText(cl, sk.pr >= 1 ? 'Skanning ferdig' : 'Skanner kvitteringer');
      const so = 1 - seg(lt, 2.35, 2.6);
      reveal(cp.e, lt, 0, 2.35, { d: .01, dy: 0, od: .25 }); reveal(cp.h, lt, 0, 2.35, { d: .01, dy: 0, b: 0, od: .25 });
      put(cnt, { o: seg(lt, .4, .7) * so, y: (1 - ease.out(seg(lt, .4, .8))) * 18 }); put(cl, { o: seg(lt, .5, .8) * so });
      reveal(ok, lt, 2.0, 2.35, { d: .6, dy: 24, b: 8, od: .25 });
      cur.update(lt, [[0, 1330, 760], [.5, tg.btn[0], tg.btn[1]], [1.1, tg.btn[0] + 150, tg.btn[1] + 120]], [.55], seg(lt, 0, .15) * (1 - seg(lt, .75, 1.0)));
    }
  };
}, [[.55, 'click'], ...ticks(.7, 1.95, .1, 'scan-tick'), [2.0, 'report-complete']]);

/* ---------- 6 · ANALYSEN ---------- */
const EVENTS = ['Analyserer returer…', 'Analyserer pant…', 'Analyserer rabatter…', 'Analyserer kassadifferanser…', 'Analyserer mønstre…', 'Sammenligner kasserere…', 'Kontrollerer bongsekvenser…'];
scene('analyse', 3.1, root => {
  const cpA = stepCopy(root, '03', 'ANALYSE', 'Kjør', 'analysen.', null);
  const pw = add(root, 'abs', '', { left: '0', top: '0', width: '1px', height: '1px' });
  const panel = Panel(pw, { tab: 2 }); const cur = Cursor(root);
  const fld = DotField(root);
  const eb = add(root, 'eyebrow', 'ANALYSE', { left: '140px', top: '98px' });
  const hd = add(root, 'l', 'Analyserer 1&nbsp;284 bonger.', { left: '140px', top: '140px', fontSize: '76px' });
  const statDefs = [['REGLER', 23, 1290], ['MØNSTRE', 9, 1530], ['KONTROLLER', 1284, 1780]];
  const stats = statDefs.map(([l, v, x]) => { const s = add(root, 'stat', `<b>0</b><span>${l}</span>`, { left: (x - 240) + 'px', width: '240px', top: '96px' }); s._b = s.querySelector('b'); return s; });
  const evBig = add(root, 'l', '', { left: '0', width: '1920px', textAlign: 'center', top: '868px', fontSize: '54px', fontFamily: 'var(--mono)', letterSpacing: '-.02em', fontWeight: '600' });
  const chipRow = add(root, 'abs', '', { left: '0', width: '1920px', top: '968px', display: 'flex', justifyContent: 'center', gap: '16px' });
  const chips = EVENTS.map(e => { const c = el('div', 'kh-tick', `<b>✓</b> ${e.replace('Analyserer ', '').replace('Sammenligner ', '').replace('Kontrollerer ', '').replace('…', '')}`); c.style.cssText = 'background:rgba(47,191,122,.12);color:#bfe9d4;font-size:19px'; chipRow.appendChild(c); return c; });
  PanelPanes.skann(panel, 9, { t0: 0, t1: 0 }); panel._skann.d.style.opacity = 1;
  PanelPanes.analyse(panel, 0, {}); panel._an.d.style.opacity = 0;
  let tg = null;
  return {
    update(lt) {
      PanelPanes.analyse(panel, lt, { tKlikk: .62, tEnd: 1.2 });
      if (!tg) tg = { btn: stagePos(panel._an.r.btn) };
      panel.setTab(kf(lt, [[0, 2], [.05, 2], [.38, 3]])); put(panel._skann.d, { o: 1 - seg(lt, .02, .22) }); put(panel._an.d, { o: seg(lt, .15, .4) });
      panel.tiles(1284, 0, 0, 0); panel.chip('Butikk 1001'); panel.status(`Skannet 1${NB}284 av 1${NB}284`);
      pw.style.transformOrigin = '1360px 540px';
      reveal(cpA.e, lt, 0, .95, { d: .01, dy: 0, od: .25 }); reveal(cpA.h, lt, 0, .95, { d: .01, dy: 0, b: 0, od: .25 });
      const ex = ease.io(seg(lt, 1.0, 1.45));
      put(pw, { o: 1 - ex, s: lerp(1, .9, ex), b: RM ? 0 : ex * 10, y: ex * 10 });
      cur.update(lt, [[0, 1380, 820], [.58, tg.btn[0], tg.btn[1]], [1.1, tg.btn[0] + 120, tg.btn[1] + 100]], [.62], seg(lt, 0, .1) * (1 - seg(lt, .8, 1.05)));
      // analysemotor
      const scan = ease.io(seg(lt, 1.1, 2.9)), on = ease.out(seg(lt, .95, 1.4));
      fld.cv.style.opacity = on; fld.draw({ scan, beam: seg(lt, 1.05, 1.2) * (1 - seg(lt, 2.85, 3.05)), dim: 1 });
      const ao = 1 - seg(lt, 2.9, 3.1);
      reveal(eb, lt, 1.0, 2.9, { d: .5, dy: 14, od: .2 }); reveal(hd, lt, 1.05, 2.9, { d: .7, dy: 24, b: 10, od: .2 });
      stats.forEach((s, i) => { reveal(s, lt, 1.1 + i * .08, 2.9, { d: .5, dy: 16, b: 6, od: .2 }); setText(s._b, nb(statDefs[i][1] * scan)); });
      const k = clamp(Math.floor((lt - 1.05) / .25), -1, EVENTS.length - 1);
      const cur_ = lt < 1.05 ? '' : k >= EVENTS.length - 1 && lt > 2.9 ? 'Risikoscore beregnet.' : EVENTS[k];
      evBig.style.opacity = seg(lt, 1.05, 1.25) * ao; setText(evBig, cur_);
      chips.forEach((c, i) => { const a = 1.05 + (i + 1) * .25; const p = seg(lt, a, a + .2); put(c, { o: p * ao, s: lerp(.9, 1, p), y: (1 - p) * 8 }); });
    }
  };
}, [[.62, 'click'], [.66, 'analysis-start'], ...ticks(1.1, 2.9, .25, 'count-tick'), [1.9, 'risk-detection'], [2.4, 'risk-detection']]);

/* ---------- 7 · 1 284 → 12 ---------- */
scene('tolv', 3.7, root => {
  const fld = DotField(root);
  const num = add(root, 'big num', '1 284', { top: '70px', fontSize: '300px', fontWeight: '800', letterSpacing: '-.05em' });
  const t1 = add(root, 'big', '12 bør sjekkes først.', { top: '740px', fontSize: '96px' });
  const t2 = add(root, 'big mut', 'Bruk tiden der den betyr mest.', { top: '880px', fontSize: '44px', fontWeight: '500', letterSpacing: '-.01em' });
  const steps = [[.25, 1284], [.75, 743], [1.1, 291], [1.45, 86], [1.8, 32], [2.15, 12]];
  return {
    update(lt) {
      const v = kf(lt, [[0, 1284], ...steps.map(s => [s[0], s[1], ease.out])]);
      fld.draw({ scan: 1, beam: 0, value: v, form: ease.io(seg(lt, 2.3, 2.95)), dim: lerp(.85, 1, seg(lt, 2.2, 2.6)) });
      put(num, { o: 1, s: lerp(1, 1.04, seg(lt, 0, 2.3)) });
      setText(num, v >= 100 ? nb(v) : String(Math.round(v)));
      const g = seg(v, 120, 12); num.style.color = `rgb(${lerp(242, 47, g) | 0},${lerp(247, 191, g) | 0},${lerp(244, 122, g) | 0})`;
      reveal(t1, lt, 2.7, null, { d: .8, dy: 30, b: 14 }); reveal(t2, lt, 3.1, null, { d: .7, dy: 18 });
    }
  };
}, [[0, 'scene-transition'], ...[.25, .75, 1.1, 1.45, 1.8, 2.15].map(t => [t, 'count-tick']), [2.7, 'risk-detection']]);

/* ---------- 8 · SJEKK FØRST ---------- */
scene('sjekk', 3.5, root => {
  const eb = add(root, 'eyebrow', '04 · SJEKK FØRST', { left: '140px', top: '98px' });
  const hd = add(root, 'l', 'Sjekk først.', { left: '140px', top: '136px', fontSize: '120px' });
  const hdr = add(root, 'abs', '', { left: '1040px', top: '112px', width: '720px', height: '60px', display: 'flex', gap: '14px' });
  const cnts = [['Høy', 4, 'hi'], ['Middels', 5, 'mid'], ['Lav', 3, 'lo']].map(([t, n, k], i) => { const b = add(hdr, 'badge ' + k, `${t} · ${n}`, { fontSize: '19px' }); return b; });
  const init = ['E', 'C', 'A', 'D', 'B'], fin = ['A', 'B', 'C', 'D', 'E'], slot = i => 190 + i * 154;
  const cards = RISK.map(rk => {
    const c = add(root, 'rk', '', { left: '1040px', top: '0' }); c.style.setProperty('--rail', LVL[rk.lvl][1]);
    c.innerHTML = `<div class="a"><span class="badge ${rk.lvl}">${LVL[rk.lvl][0]}</span><span style="font-weight:800;color:#5e7a6c">RRS&nbsp;<i style="font-style:normal" data-r="rrs">–</i></span></div><div class="b">Bong ${rk.bong}</div><div class="c">Kasse ${rk.kasse} · Kasserer ${rk.kasserer}</div><div class="s"><b data-r="sc">–</b><span>RISIKOSCORE</span></div><div class="tg">${rk.tags.slice(0, 2).map(t => `<i>${t}</i>`).join('')}</div>`;
    c._rrs = c.querySelector('[data-r=rrs]'); c._sc = c.querySelector('[data-r=sc]'); c._rk = rk; return c;
  });
  const note = add(root, 'l mut', 'Hver risikoscore forklares.<br>Du vurderer funnet.', { left: '146px', top: '850px', fontSize: '36px', fontWeight: '500', letterSpacing: '-.01em', lineHeight: '1.3' });
  const A = RISK[0];
  const det = add(root, 'detail', `<div class="top"><span class="badge hi">HØY RISIKO</span><span class="rrs">RRS ${rrs(A.score)}</span></div><h4>Bong ${A.bong}</h4><div class="meta">Kasse ${A.kasse} · Kasserer ${A.kasserer}</div>
    <ul><li>Stor panteretur<b>+3</b></li><li>Mange pantelapper<b>+3</b></li><li>Kontant tilbake uten salg<b>+4</b></li></ul>
    <div class="tot"><div><span>RISIKOSCORE</span><b data-r="tot">0</b></div><div class="vis">VIS BONG</div></div>`);
  det._li = [...det.querySelectorAll('li')]; det._tot = det.querySelector('[data-r=tot]'); det._vis = det.querySelector('.vis');
  return {
    update(lt) {
      reveal(eb, lt, 0, null, { d: .4, dy: 10 }); reveal(hd, lt, .05, null, { d: .7, dy: 30, b: 12 });
      cnts.forEach((b, i) => { const p = ease.out(seg(lt, 1.35 + i * .08, 1.7 + i * .08)); put(b, { o: p, y: (1 - p) * 10 }); });
      cards.forEach(c => {
        const rk = c._rk, i0 = init.indexOf(rk.id), i1 = fin.indexOf(rk.id);
        const enter = ease.out(seg(lt, .05 + i0 * .1, .6 + i0 * .1));
        const mv = ease.io(seg(lt, 1.5 + i1 * .07, 2.25 + i1 * .07));
        const y = lerp(slot(i0), slot(i1), mv);
        put(c, { x: (1 - enter) * 90, y, o: enter, s: 1 + Math.sin(Math.PI * mv) * .025 });
        const sc = animateRiskScore(c._sc, lt, .6 + i0 * .12, .6, rk.score); setText(c._rrs, lt < .6 + i0 * .12 ? '–' : String(rrs(sc)));
        c.style.zIndex = Math.round(10 - i1 + mv * 0);
      });
      // detaljkort for den høyeste
      const dp = ease.out(seg(lt, 2.1, 2.75));
      put(det, { o: dp, y: (1 - dp) * 50, s: lerp(.96, 1, dp), b: RM ? 0 : (1 - dp) * 12 });
      det._li.forEach((li, i) => { const a = 2.35 + i * .2; put(li, { o: seg(lt, a, a + .3), y: (1 - ease.out(seg(lt, a, a + .4))) * 14 }); });
      animateRiskScore(det._tot, lt, 2.75, .5, 10); reveal(note, lt, 2.9, null, { d: .6, dy: 16 });
      put(det._vis, { s: 1 + (RM ? 0 : Math.max(0, Math.sin((lt - 3.0) * 6))) * .04 * seg(lt, 2.9, 3.0) });
    }
  };
}, [[0, 'scene-transition'], [1.5, 'risk-detection'], ...ticks(.6, 1.2, .12, 'count-tick'), [2.35, 'click']]);

/* ---------- 9 · MØNSTRE ---------- */
scene('monstre', 3.7, root => {
  const net = sv('svg', { viewBox: '0 0 1920 1080', width: 1920, height: 1080 }); net.setAttribute('style', 'position:absolute;left:0;top:0'); root.appendChild(net);
  const r = rng(17), nodes = [], edges = [];
  for (let i = 0; i < 38; i++) { const cl = i < 14 ? 0 : i < 26 ? 1 : 2, cxy = [[620, 560], [1230, 470], [1010, 800]][cl]; nodes.push({ x: cxy[0] + (r() - .5) * 520, y: cxy[1] + (r() - .5) * 340, cl, rot: (r() - .5) * 14 }); }
  nodes.forEach((a, i) => nodes.forEach((b, j) => { if (j > i && a.cl === b.cl && Math.hypot(a.x - b.x, a.y - b.y) < 215) edges.push([i, j]); }));
  [[3, 18], [8, 27], [12, 30], [20, 33]].forEach(e => edges.push(e));
  const eg = edges.map(e => sv('line', { x1: nodes[e[0]].x, y1: nodes[e[0]].y, x2: nodes[e[1]].x, y2: nodes[e[1]].y, stroke: nodes[e[0]].cl === 0 && nodes[e[1]].cl === 0 ? 'rgba(229,72,59,.6)' : 'rgba(47,191,122,.35)', 'stroke-width': 1.6, opacity: 0 }, net));
  const nd = nodes.map(n => { const g = sv('g', {}, net); sv('rect', { x: -15, y: -20, width: 30, height: 40, rx: 4, fill: n.cl === 0 ? 'rgba(229,72,59,.22)' : 'rgba(255,255,255,.07)', stroke: n.cl === 0 ? '#E5483B' : 'rgba(190,225,206,.5)', 'stroke-width': 1.5 }, g); [-9, -2, 5].forEach(y => sv('line', { x1: -8, y1: y, x2: 8, y2: y, stroke: 'rgba(220,240,230,.55)', 'stroke-width': 1.6 }, g)); return g; });
  const t1 = add(root, 'big', 'Én bong forteller lite.', { top: '110px', fontSize: '112px' });
  const t2 = add(root, 'big', '<span class="g">Mønsteret</span> forteller mer.', { top: '110px', fontSize: '112px' });
  const t3 = add(root, 'big', 'Se mønsteret.', { top: '70px', fontSize: '86px' });
  const tiles = CHARTS.map(([ty, title], i) => {
    const c = createChart(ty), t = add(root, 'tile', `<h5>${title}</h5>`, { left: (66 + (i % 4) * 456) + 'px', top: (214 + Math.floor(i / 4) * 360) + 'px' });
    t.appendChild(c.svg); const cap = add(t, 'cap r', c.cap[0]); return { t, c, cap, i };
  });
  return {
    update(lt) {
      const grow = seg(lt, .1, 1.3), fo = ease.io(seg(lt, 1.75, 2.2));
      eg.forEach((e, i) => e.setAttribute('opacity', seg(grow, i / eg.length * .8, i / eg.length * .8 + .2) * (1 - fo)));
      nd.forEach((g, i) => { const n = nodes[i], p = ease.out(seg(lt, i * .012, .4 + i * .012)); g.setAttribute('transform', `translate(${lerp(960, n.x, p).toFixed(1)},${lerp(540, n.y, p).toFixed(1)}) rotate(${n.rot}) scale(${(p * lerp(1, .5, fo)).toFixed(3)})`); g.setAttribute('opacity', p * (1 - fo)); });
      reveal(t1, lt, .15, 1.15, { d: .7, dy: 28, od: .3 }); reveal(t2, lt, 1.25, 1.95, { d: .7, dy: 28, od: .35 });
      reveal(t3, lt, 1.85, null, { d: .6, dy: 22 });
      tiles.forEach(({ t, c, cap, i }) => { const a = 1.95 + i * .07, p = ease.out(seg(lt, a, a + .5)); put(t, { o: p, y: (1 - p) * 40, s: lerp(.95, 1, p) }); c.update(seg(lt, a + .1, a + .95), lt); put(cap, { o: seg(lt, a + .8, a + 1.05) }); });
    }
  };
}, [[0, 'scene-transition'], [1.25, 'risk-detection'], ...ticks(2.0, 3.0, .12, 'scan-tick')]);

/* ---------- 10 · EKSEMPLER PÅ FUNN ---------- */
scene('funn', 4.1, root => {
  const P = [[90, 150], [1010, 150], [90, 560], [1010, 560]], A = [0, .85, 1.7, 2.55];
  const cards = P.map(p => add(root, 'fcard', '', { left: p[0] + 'px', top: p[1] + 'px' }));
  /* 1 · retur uten salg */
  const c1 = cards[0]; add(c1, 't', 'RETUR UTEN SALG');
  const L1 = [['SALG   10:12   Kasse 2', '439,50'], ['SALG   11:31   Kasse 1', '87,90'], ['SALG   12:14   Kasse 2', '321,00'], ['SALG   13:48   Kasse 3', '125,40'], ['RETUR   15:50   Kasse 2', '−101,90', 1]];
  const rc = showReceipt(c1, L1); rc.rows.forEach((r, i) => { r.style.top = (72 + i * 42) + 'px'; });
  const sweep = add(c1, 'abs', '', { left: '24px', right: '24px', width: '772px', height: '2px', background: 'linear-gradient(90deg,transparent,#9be6c3,transparent)', boxShadow: '0 0 18px #2FBF7A' });
  const res1 = add(c1, 'res', 'Ingen tilsvarende salg funnet');
  /* 2 · pant */
  const c2 = cards[1]; add(c2, 't', 'PANT');
  const tk = []; for (let i = 0; i < 8; i++) tk.push(add(c2, 'tkt', '<b>−40,00</b>399 PANTELAPP', { left: (34 + (i % 4) * 134) + 'px', top: (78 + Math.floor(i / 4) * 78) + 'px' }));
  const sum2 = add(c2, 'abs num', '0', { right: '34px', top: '78px', fontSize: '84px', fontWeight: '800', letterSpacing: '-.04em', textAlign: 'right', width: '240px', lineHeight: '1' });
  const sl2 = add(c2, 'abs mut', 'kr tilbakebetalt', { right: '34px', top: '172px', fontSize: '22px', fontWeight: '600', textAlign: 'right', width: '240px' });
  const res2 = add(c2, 'res', '8 pantelapper · 320 kr tilbakebetalt');
  /* 3 · rabatt */
  const c3 = cards[2]; add(c3, 't', 'RABATT');
  const RV = [10, 20, 10, 20, 10, 20, 10, 80], bars = RV.map((v, i) => { const b = add(c3, 'abs', '', { left: (34 + i * 98) + 'px', width: '62px', bottom: '118px', height: '200px', background: v === 80 ? '#E5483B' : '#2FBF7A', opacity: v === 80 ? 1 : .75, borderRadius: '8px', transformOrigin: '50% 100%', top: 'auto' }); const l = add(c3, 'abs mono', v + ' %', { left: (34 + i * 98) + 'px', width: '62px', textAlign: 'center', bottom: '90px', fontSize: '16px', color: v === 80 ? '#ff8a7e' : '#86A394', fontWeight: v === 80 ? '800' : '500' }); return { b, l, v }; });
  const res3 = add(c3, 'res', '80 % faller utenfor det vanlige');
  /* 4 · kassadifferanse */
  const c4 = cards[3]; add(c4, 't', 'KASSADIFFERANSE');
  const DV = [-12, -7, -18, -9, -24], dn = DV.map((v, i) => add(c4, 'abs mono', money(v, 0), { left: (34 + i * 150) + 'px', top: '92px', fontSize: '66px', fontWeight: '700', color: '#ff8a7e', letterSpacing: '-.04em' }));
  const sp = sv('svg', { viewBox: '0 0 760 90', width: 760, height: 90 }); sp.setAttribute('style', 'position:absolute;left:34px;top:196px;overflow:visible'); c4.appendChild(sp);
  const spath = sv('path', { d: DV.map((v, i) => (i ? 'L' : 'M') + (30 + i * 150) + ',' + (10 - v * 3.2)).join(' '), fill: 'none', stroke: '#ff8a7e', 'stroke-width': 3.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 1 }, sp);
  const res4 = add(c4, 'res', 'Gjentakende negativ differanse');
  return {
    update(lt) {
      cards.forEach((c, i) => { const p = ease.out(seg(lt, A[i], A[i] + .5)); put(c, { o: p, y: (1 - p) * 50, s: lerp(.96, 1, p) }); });
      /* 1 */ { const t = lt - A[0]; rc.rows.forEach((r, i) => { const a = .25 + i * .07; put(r, { o: seg(t, a, a + .2) * (i < 4 ? 1 - .45 * seg(t, .95 + (3 - i) * .12, 1.1 + (3 - i) * .12) : 1) }); });
        const sy = kf(t, [[.7, 72 + 4 * 42 + 20], [1.55, 72 - 6]]); sweep.style.transform = `translateY(${sy.toFixed(1)}px)`; sweep.style.opacity = seg(t, .6, .75) * (1 - seg(t, 1.5, 1.6)); sweep.style.top = '0';
        reveal(res1, t, 1.6, null, { d: .45, dy: 12 }); highlightAnomaly(rc.rows[4], t, 1.65); }
      /* 2 */ { const t = lt - A[1]; tk.forEach((k, i) => { const a = .3 + i * .07; const p = ease.out(seg(t, a, a + .3)); put(k, { o: p, y: (1 - p) * 26, s: lerp(.9, 1, p) }); });
        const v = Math.round(320 * ease.out(seg(t, .35, 1.25))); setText(sum2, v); put(sum2, { o: seg(t, .3, .5) }); put(sl2, { o: seg(t, .5, .8) });
        reveal(res2, t, 1.45, null, { d: .45, dy: 12 }); }
      /* 3 */ { const t = lt - A[2]; bars.forEach((b, i) => { const a = .25 + i * .07 + (b.v === 80 ? .45 : 0); const p = ease.out(seg(t, a, a + .45)); const h = Math.max(2, b.v / 80 * 190) * p; b.b.style.height = h + 'px'; b.b.style.opacity = (b.v === 80 ? 1 : .75) * seg(t, a, a + .1); put(b.l, { o: seg(t, a, a + .3) }); });
        highlightAnomaly(bars[7].b, t, 1.15); reveal(res3, t, 1.35, null, { d: .45, dy: 12 }); }
      /* 4 */ { const t = lt - A[3]; dn.forEach((d, i) => { const a = .25 + i * .16; const p = ease.out(seg(t, a, a + .3)); put(d, { o: p, y: (1 - p) * 18, s: lerp(.9, 1, p) }); });
        spath.setAttribute('stroke-dashoffset', 1 - ease.io(seg(t, .3, 1.2))); reveal(res4, t, 1.3, null, { d: .45, dy: 12 }); }
      [res1, res2, res3, res4].forEach((r, i) => { const t = lt - A[i] - 1.5; r.style.setProperty('--x', 0); });
    }
  };
}, [[0, 'scene-transition'], [1.75, 'risk-detection'], [2.5, 'risk-detection'], [3.1, 'risk-detection'], [3.8, 'risk-detection']]);

/* ---------- 11 · KASSERERPROFIL ---------- */
scene('kasserer', 3.0, root => {
  const h = add(root, 'l', 'Kasserer<br>4103', { left: '140px', top: '150px', fontSize: '150px' });
  const sub = add(root, 'l mut', 'Avvik fra butikksnittet.', { left: '146px', top: '470px', fontSize: '42px', fontWeight: '500', letterSpacing: '-.01em' });
  const t1 = add(root, 'l mut', 'Se enkelttransaksjonen.', { left: '140px', top: '690px', fontSize: '56px' });
  const t2 = add(root, 'l', 'Eller se <span class="g">mønsteret</span> bak.', { left: '140px', top: '775px', fontSize: '56px' });
  const M = [['RETURANDEL', 8.9, 2.1, 10, '%', '8,9 %', '2,1 %', '×4,2'], ['RABATTANDEL', 12.4, 4.2, 14, '%', '12,4 %', '4,2 %', '×3,0'], ['PANTELAPPER PER SALG', .41, .08, .5, '', '0,41', '0,08', '×5,1']];
  const blocks = M.map((m, k) => {
    const b = add(root, 'cmp', `<h6>${m[0]}</h6><div class="lbl"><span>Kasserer 4103</span></div><div class="rowx"><i style="width:100%;background:#E5483B"></i><span>${m[5]}</span></div><div class="lbl" style="margin-top:14px"><span class="mut">Butikksnitt</span></div><div class="rowx"><i style="width:100%;background:#4f7f68"></i><span>${m[6]}</span></div>`, { left: '900px', top: (118 + k * 300) + 'px', width: '900px' });
    const mu = add(root, 'mult', m[7], { left: '1640px', top: (100 + k * 300) + 'px', width: '160px', textAlign: 'right' });
    return { b, mu, bars: b.querySelectorAll('.rowx i'), m };
  });
  return {
    update(lt) {
      reveal(h, lt, 0, null, { d: .8, dy: 36, b: 14 }); reveal(sub, lt, .35, null, { d: .6, dy: 16 });
      blocks.forEach(({ b, mu, bars, m }, k) => { const a = .35 + k * .33; reveal(b, lt, a, null, { d: .5, dy: 30, b: 8 });
        const p = ease.out(seg(lt, a + .2, a + .95)); bars[0].style.transform = `scaleX(${(m[1] / m[3] * p).toFixed(4)})`; bars[1].style.transform = `scaleX(${(m[2] / m[3] * p).toFixed(4)})`;
        reveal(mu, lt, a + .85, null, { d: .45, dy: 14 }); highlightAnomaly(bars[0].parentNode, lt, a + .9); });
      reveal(t1, lt, 1.55, 2.05, { d: .6, dy: 22, od: .3 }); reveal(t2, lt, 2.15, null, { d: .6, dy: 22 });
      // t1 og t2 deler plass: t1 går ut når t2 kommer
      t1.style.top = lt > 2.0 ? '690px' : '690px';
    }
  };
}, [[0, 'scene-transition'], [1.25, 'risk-detection'], [1.58, 'risk-detection'], [1.9, 'risk-detection']]);

/* ---------- 12 · RAPPORT ---------- */
scene('rapport', 3.3, root => {
  const eb = add(root, 'eyebrow', '05 · DOKUMENTER', { left: '140px', top: '100px' });
  const btn = add(root, 'kh-btn p', 'LAG REVISJONSRAPPORT', { position: 'absolute', left: '140px', top: '150px', width: '640px', fontSize: '28px', padding: '30px 20px', borderRadius: '18px', boxShadow: '0 30px 80px rgba(0,134,74,.4)' });
  const CH = ['Omfang', 'Kontroller', 'Funn', 'Kommentarer', 'Dokumentasjon', 'Kontrollsummer'];
  const rows = CH.map((c, i) => add(root, 'chk abs', `<span class="bx"></span><span>${c}</span>`, { left: '140px', top: (300 + i * 76) + 'px' }));
  const pill = add(root, 'pill-ok', '<span>✓</span> REVISJONSRAPPORT KLAR', { left: '140px', top: '815px' });
  const paper = add(root, 'paper', `<h3>Revisjonsrapport</h3><div class="sub">Kvitteringsjournal · siste 7 dager · butikk 1001 · 1&nbsp;284 bonger</div>
    <div data-s="a"><div class="ln" style="width:92%"></div><div class="ln" style="width:78%"></div><div class="ln" style="width:85%"></div></div>
    <table data-s="b"><tr><th>RISIKO</th><th>BONG</th><th>KASSE</th><th>FUNN</th></tr>
    <tr><td><b style="color:#a3281d">Høy 10</b></td><td>1001-2-2371</td><td>2</td><td>Kontant tilbake uten salg</td></tr><tr><td><b style="color:#a3281d">Høy 9</b></td><td>1001-1-2344</td><td>1</td><td>Retur uten salg</td></tr>
    <tr><td><b style="color:#8a5a0c">Middels 6</b></td><td>1001-3-2316</td><td>3</td><td>Rabatt uten årsak</td></tr><tr><td><b style="color:#8a5a0c">Middels 5</b></td><td>1002-1-2099</td><td>1</td><td>Manuell pantelapp</td></tr></table>
    <div data-s="c" style="margin-top:22px"><div class="ln" style="width:70%"></div><div class="ln" style="width:88%"></div><div class="ln" style="width:54%"></div></div>
    <div class="hash" data-s="d">Kontrollsum SHA-256<br>9c4e1f0a7b…b71a · rapport.html</div>`, { left: '1010px', top: '96px' });
  const sec = ['a', 'b', 'c', 'd'].map(k => paper.querySelector(`[data-s=${k}]`));
  const cur = Cursor(root); let tg = null;
  return {
    update(lt) {
      if (!tg) tg = { b: stagePos(btn) };
      reveal(eb, lt, 0, null, { d: .4, dy: 10 }); reveal(btn, lt, .0, null, { d: .6, dy: 24 });
      const press = clamp(1 - Math.abs(lt - .5) / .1); btn.style.transform = `scale(${1 - .03 * press})`; btn.classList.toggle('dis', lt > .5); setText(btn, lt > .5 ? (lt > 2.2 ? 'RAPPORT LAGET' : 'LAGER RAPPORT …') : 'LAG REVISJONSRAPPORT');
      cur.update(lt, [[0, 1250, 900], [.45, tg.b[0] + 200, tg.b[1]], [1.2, tg.b[0] + 330, tg.b[1] + 140]], [.5], seg(lt, 0, .15) * (1 - seg(lt, .9, 1.2)));
      rows.forEach((r, i) => { const a = .75 + i * .24; reveal(r, lt, .2 + i * .04, null, { d: .45, dy: 14 }); r.classList.toggle('done', lt > a + .22); });
      const pp = ease.out(seg(lt, .8, 1.5)); put(paper, { o: pp, y: (1 - pp) * 160, r: lerp(5, 1.4, pp), s: lerp(.94, 1, pp) });
      sec.forEach((s, i) => { s.style.opacity = seg(lt, 1.1 + i * .3, 1.4 + i * .3); });
      reveal(pill, lt, 2.25, null, { d: .5, dy: 20, s0: .9 });
    }
  };
}, [[0, 'scene-transition'], [.5, 'click'], ...[.97, 1.21, 1.45, 1.69, 1.93, 2.17].map(t => [t, 'scan-tick']), [2.3, 'report-complete']]);

/* ---------- 13 · FRA DATA TIL SVAR ---------- */
scene('foreetter', 3.0, root => {
  const chaos = TxCanvas(root, { seed: 23, cols: 5 });
  const lc = add(root, 'l mut', '1&nbsp;284 transaksjoner', { left: '100px', top: '100px', fontSize: '50px' });
  const fa = add(root, 'l', 'Fra data.', { left: '100px', top: '860px', fontSize: '120px' });
  const ord = add(root, 'split', '', { left: '960px', width: '960px', background: 'linear-gradient(135deg,#0B1712,#0E2018)', borderLeft: '1px solid rgba(47,191,122,.35)' });
  const oh = add(ord, 'l', '12 prioriterte funn', { left: '80px', top: '92px', fontSize: '58px' });
  const oc = add(ord, 'abs', ['Risikoscore', 'Forklaring', 'Dokumentasjon'].map(t => `<span class="badge lo" style="margin-right:10px;font-size:17px">${t}</span>`).join(''), { left: '82px', top: '178px' });
  const MR = [['hi', 'Bong 1001-2-2371', 'RRS 58'], ['hi', 'Bong 1001-1-2344', 'RRS 54'], ['mid', 'Bong 1001-3-2316', 'RRS 41'], ['mid', 'Bong 1002-1-2099', 'RRS 35'], ['lo', 'Bong 1001-2-2060', 'RRS 23']];
  const minis = MR.map((m, i) => add(ord, 'mini', `<span class="dot" style="background:${LVL[m[0]][1]}"></span><b>${m[1]}</b><span class="rr">${m[2]}</span>`, { left: '80px', width: '780px', top: (260 + i * 102) + 'px' }));
  const more = add(ord, 'l mut', '+ 7 til', { left: '84px', top: '780px', fontSize: '34px', fontWeight: '600' });
  const til = add(root, 'l', 'Til <span class="g">oversikt.</span>', { left: '1040px', top: '860px', fontSize: '120px' });
  const div = add(root, 'abs', '', { left: '959px', top: '0', width: '2px', height: '1080px', background: 'linear-gradient(180deg,transparent,#2FBF7A,transparent)', boxShadow: '0 0 40px #2FBF7A' });
  return {
    update(lt) {
      chaos.draw(lt, { clip: [0, 0, 960, 1080], density: 1, speed: 260, alpha: .34 * lerp(1, .55, seg(lt, 1.6, 2.4)) });
      reveal(lc, lt, 0, null, { d: .5, dy: 12 }); reveal(fa, lt, .15, null, { d: .6, dy: 30, b: 12 });
      const w = ease.io(seg(lt, .75, 1.45)); ord.style.clipPath = `inset(0 0 0 ${((1 - w) * 100).toFixed(2)}%)`; ord.style.opacity = w > 0 ? 1 : 0;
      put(div, { o: seg(lt, .7, .85) * (1 - seg(lt, 1.6, 1.9) * .5), x: (1 - w) * 960 });
      reveal(oh, lt, 1.0, null, { d: .5, dy: 16 }); reveal(oc, lt, 1.15, null, { d: .5, dy: 12 });
      minis.forEach((m, i) => reveal(m, lt, 1.1 + i * .09, null, { d: .45, dy: 18, dx: 30, b: 6 })); reveal(more, lt, 1.6, null, { d: .4, dy: 8 });
      reveal(til, lt, 1.85, null, { d: .6, dy: 30, b: 12 });
    }
  };
}, [[0, 'scene-transition'], [.75, 'scene-transition'], [1.85, 'report-complete']]);

/* ---------- 14 · CTA ---------- */
scene('cta', 4.8, root => {
  const logo = add(root, 'logo-mark', LOGO_SVG, { left: '900px', top: '120px', width: '120px', height: '120px', borderRadius: '29px' });
  const wm = add(root, 'wordmark', 'KVITTERINGSHENTER', { top: '272px', fontSize: '40px', letterSpacing: '.3em', color: '#86A394' });
  const hd = add(root, 'big', 'Finn det som<br>bør <span class="g">undersøkes.</span>', { top: '350px', fontSize: '150px' });
  const sub = add(root, 'big mut', 'Analyseverktøy for Kvitteringsjournalen.', { top: '680px', fontSize: '44px', fontWeight: '500', letterSpacing: '-.01em' });
  const bw = add(root, 'abs', '<button type="button" class="cta-btn" id="cta" style="position:relative">START ANALYSEN <svg width="30" height="24" viewBox="0 0 30 24"><path d="M2 12h24M17 3l9 9-9 9" stroke="#fff" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>', { left: '0', width: '1920px', textAlign: 'center', top: '800px' });
  const btn = bw.firstChild; btn.addEventListener('click', () => { Sfx.emit('click'); Demo.open(); });
  const fine = add(root, 'fine', 'Funn er indikasjoner og må vurderes og forklares.', { top: '990px' });
  return {
    update(lt) {
      put(logo, { o: ease.out(seg(lt, 0, .5)), s: lerp(.8, 1, ease.out(seg(lt, 0, .7))), b: RM ? 0 : (1 - ease.out(seg(lt, 0, .5))) * 12 });
      reveal(wm, lt, .2, null, { d: .6, dy: 14 }); reveal(hd, lt, .45, null, { d: 1.0, dy: 44, b: 16 }); reveal(sub, lt, 1.2, null, { d: .7, dy: 20 });
      const p = ease.out(seg(lt, 1.7, 2.3)); put(bw, { o: p, y: (1 - p) * 26, s: lerp(.94, 1, p) });
      const pulse = RM ? 0 : (.5 + .5 * Math.sin(lt * 4)) * seg(lt, 2.3, 2.6); btn.style.boxShadow = `0 20px 60px rgba(0,134,74,.5),0 0 0 ${(pulse * 16).toFixed(1)}px rgba(0,134,74,${(.35 - pulse * .3).toFixed(3)})`;
      reveal(fine, lt, 2.4, null, { d: .6, dy: 10 });
    }
  };
}, [[.45, 'scene-transition'], [1.7, 'report-complete']]);

/* ===================================================================== 6. MOTOR (timeline) */
const OV = .3;                                   // sekunder med overlapp mellom scener (kryssoverganger)
const Engine = (() => {
  const stage = $('#stage'), host = $('#scenes'), ambient = $('#ambient');
  let T = 0, total = 0, playing = false, last = 0, raf = 0, onEnd = null, onTime = null, scale = 1;
  function layout() { let t = 0; SCENES.forEach((s, i) => { s.start = t; t += s.dur - (i < SCENES.length - 1 ? OV : 0); }); const L = SCENES[SCENES.length - 1]; total = L.start + L.dur; }
  /* tilpass 16:9-flaten til vinduet. På stående mobil dreies flaten 90° slik at den fyller skjermen (som en videospiller). */
  function fit() {
    const portrait = innerHeight > innerWidth * 1.1;
    scale = portrait ? Math.min(innerHeight / 1920, innerWidth / 1080) : Math.min(innerWidth / 1920, innerHeight / 1080);
    const tf = (portrait ? 'rotate(90deg) ' : '') + `scale(${scale})`;
    stage.style.transform = tf; const d = $('#demo .dstage'); if (d) d.style.transform = tf;
  }
  function mount(s) { s.root = el('section', 'scene s-' + s.id); host.appendChild(s.root); s.inst = s.factory(s.root); }
  function unmount(s) { if (s.root) s.root.remove(); s.root = null; s.inst = null; }
  /* seek: monter scener som overlapper T (og neste scene litt i forkant, så den ikke rykker), oppdater dem, rydd opp resten */
  function seek(t) {
    T = clamp(t, 0, total);
    SCENES.forEach((s, i) => {
      const lt = T - s.start, active = lt >= 0 && lt <= s.dur, warm = lt < 0 && lt > -.8;
      if (active || warm) {
        if (!s.inst) mount(s);
        let op = i === 0 ? 1 : (active ? ease.soft(seg(lt, 0, OV)) : 0);
        if (active && FADEOUT.has(s.id)) op *= 1 - ease.soft(seg(lt, s.dur - OV, s.dur));
        s.root.style.opacity = op; s.root.style.zIndex = i; s.root.style.visibility = op < .003 ? 'hidden' : 'visible';
        s.inst.update(Math.max(0, lt) * s.k);
      } else if (s.inst) unmount(s);
    });
    if (!RM) { ambient.style.transform = `translate(${(Math.sin(T * .22) * 40).toFixed(1)}px,${(Math.cos(T * .17) * 26).toFixed(1)}px)`; }
    if (onTime) onTime(T);
  }
  function fire(a, b) { SCENES.forEach(s => s.cues.forEach(c => { const at = s.start + c[0] / s.k; if (at > a && at <= b) Sfx.emit(c[1], { scene: s.id, t: at }); })); }
  function tick(now) {
    if (!playing) return;
    const dt = Math.min(.1, (now - last) / 1000); last = now;
    const prev = T; let n = T + dt;
    if (n >= total) { n = total; playing = false; }
    fire(prev, n); seek(n);
    if (!playing) { if (onEnd) onEnd(); return; }
    raf = requestAnimationFrame(tick);
  }
  function play(from) {
    if (from != null) seek(from);
    if (T >= total) seek(0);
    playing = true; last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick);
  }
  function pause() { playing = false; cancelAnimationFrame(raf); }
  const api = {
    SCENES, layout, fit, seek, play, pause,
    restart() { pause(); SCENES.forEach(unmount); seek(0); play(0); fire(-1, 0); },
    toggle() { playing ? pause() : play(); },
    scene(i) { i = clamp(i, 0, SCENES.length - 1); seek(SCENES[i].start + .001); },
    current() { for (let i = SCENES.length - 1; i >= 0; i--) if (T >= SCENES[i].start) return i; return 0; },
    get T() { return T; }, get total() { return total; }, get playing() { return playing; }, get scale() { return scale; },
    set onEnd(f) { onEnd = f; }, set onTime(f) { onTime = f; }
  };
  return api;
})();

/* ===================================================================== 7. INTERAKTIV DEMO */
const Demo = (() => {
  let root, panel, tab = 0, t0 = 0, raf = 0, filt = {}, open = false;
  const PILLS = [['Bare returer', .11], ['Kasse 2', .34], ['Kontant tilbake', .03], ['Med rabatt', .17]];
  const TABS = [['Hent', 'Hent riktig utvalg.', 'Søk i hele journalen etter dato, butikk, medlem, vare eller bong.'], ['Filtrer', 'Snevre inn listen.', 'Slå av og på filtre. Tallet øverst viser hvor mange bonger som er igjen.'], ['Skann', 'Les innholdet.', 'Varelinjer, pant, rabatt, betaling og kuponger leses fra hver bong.'], ['Analyse', 'Se hva som skiller seg ut.', 'Regler og mønstre gir en prioritert liste. Funn er indikasjoner.'], ['Rapport', 'Dokumenter funnet.', 'Revisjonsrapport med omfang, funn, kommentarer og kontrollsummer.']];
  function build() {
    root = $('#demo'); root.innerHTML = '';
    const st = el('div', 'dstage'); root.appendChild(st);
    const g = el('div', 'ghost'); HERO_ROWS.slice(0, 40).forEach((r, i) => g.appendChild(el('div', '', `2026-10-01 ${r.time.slice(0, 5)}  ${4100 + (i % 3) + 1}  ${r.k}  1001-${r.k}-${2060 + i}  ${signed(r.amt)}`))); st.appendChild(g);
    const nav = el('div', 'dnav', '<div class="eyebrow" style="position:static;margin-bottom:22px">UTFORSK DEMO</div><h2></h2><p></p>'); st.appendChild(nav);
    panel = Panel(st, { tab: 0 }); panel.tabs[4].textContent = 'Rapport';
    panel.tabs.forEach((n, i) => n.addEventListener('click', () => select(i)));
    const top = el('div', 'dtop', '<button class="btn btn-ghost" id="d-back" type="button">← Til reklamen</button><button class="btn btn-ghost" id="d-replay" type="button">Spill igjen</button>'); root.appendChild(top);
    $('#d-back').onclick = close; $('#d-replay').onclick = () => { close(); Engine.restart(); };
    // filter-fane (interaktive piller)
    const fd = el('div', 'kh-pane'); fd.innerHTML = '<div class="kh-card"><div class="kh-h">FILTRER</div><div class="kh-lbl" style="margin-top:0">Innhold</div><div class="kh-chips" data-r="pills"></div><div class="kh-lbl">Kasse</div><div class="kh-chips"><span class="kh-pill on">Alle</span></div></div><div class="kh-note" data-r="msg" style="padding:6px 4px"></div>';
    panel.r.body.appendChild(fd); panel._fil = { d: fd, pills: fd.querySelector('[data-r=pills]'), msg: fd.querySelector('[data-r=msg]') };
    PILLS.forEach((p, i) => { const b = el('span', 'kh-pill', p[0]); b.onclick = () => { filt[i] = !filt[i]; refilter(); }; panel._fil.pills.appendChild(b); });
    // analyse-resultat + rapport
    const rd = el('div', 'kh-pane'); rd.innerHTML = '<div class="kh-card" style="margin-top:0"><div class="kh-h">SJEKK FØRST</div>' + RISK.slice(0, 4).map(r => `<div class="kh-row" style="gap:10px"><span class="badge ${r.lvl}" style="font-size:12px;padding:4px 10px">${LVL[r.lvl][0]}</span><span style="font-weight:700">${r.bong}</span><em>${r.score}</em></div>`).join('') + '</div>';
    panel.r.body.appendChild(rd); panel._res = rd;
    const rp = el('div', 'kh-pane'); rp.innerHTML = '<div class="kh-card"><div class="kh-h">REVISJONSRAPPORT</div><div class="kh-btn p" data-r="b" style="font-size:17px">LAG REVISJONSRAPPORT</div><div data-r="l" style="margin-top:14px"></div></div><div class="kh-card" data-r="ok" style="opacity:0"><div class="kh-note"><b style="color:var(--g)">✓</b> Revisjonsrapport klar · SHA-256 9c4e…b71a</div></div>';
    panel.r.body.appendChild(rp); const rr = {}; rp.querySelectorAll('[data-r]').forEach(n => { rr[n.dataset.r] = n; });
    rr.items = ['Omfang', 'Kontroller', 'Funn', 'Kommentarer', 'Dokumentasjon', 'Kontrollsummer'].map(c => { const d = el('div', 'kh-row', `<i class="kh-cb"></i><span>${c}</span>`); d.style.padding = '8px 4px'; rr.l.appendChild(d); return d; });
    panel._rap = { d: rp, r: rr };
  }
  function refilter() {
    const pills = panel._fil.pills.children; let f = 1;
    PILLS.forEach((p, i) => { pills[i].classList.toggle('on', !!filt[i]); if (filt[i]) f *= p[1]; });
    const n = Math.max(1, Math.round(1284 * f)); panel.tiles(n, 0, 0, 0);
    panel._fil.msg.textContent = n === 1284 ? 'Ingen filtre aktive. Viser alle bonger.' : `Viser ${nb(n)} av 1${NB}284 bonger.`;
  }
  function select(i) { tab = i; t0 = performance.now(); panel.tabs.forEach((n, k) => n.classList.toggle('on', k === i)); panel.setTab(i); const c = TABS[i]; root.querySelector('.dnav h2').textContent = c[1]; root.querySelector('.dnav p').textContent = c[2]; Sfx.emit('click'); if (i === 1) refilter(); loop(); }
  function loop() { cancelAnimationFrame(raf); const f = () => { if (!open) return; frame((performance.now() - t0) / 1000); raf = requestAnimationFrame(f); }; f(); }
  function frame(lt) {
    const P = panel; [P._hent, P._skann, P._an, P._fil, P._rap].forEach(x => { if (x) x.d.style.display = 'none'; }); if (P._res) P._res.style.display = 'none';
    P.chip('ingen filter'); P.status('');
    if (tab === 0) { const h = PanelPanes.hent(P, lt, { tDato: .3, tButikk: .75, tSok: 1.2 }); h.d.style.display = ''; P.chip(lt > .75 ? 'Butikk 1001' : 'ingen filter'); const v = kf(lt, [[1.25, 0], [3.0, 1284, ease.out]]); P.tiles(v, 0, 0, 0); P.status(lt > 1.25 ? `<span class="kh-spin"></span> ${v >= 1284 ? 'Hentet 1' + NB + '284 bonger' : 'Henter 1' + NB + '284 bonger …'}` : ''); const sp = P.r.status.querySelector('.kh-spin'); if (sp) sp.style.transform = `rotate(${(lt * 520) % 360}deg)`; }
    else if (tab === 1) { P._fil.d.style.display = ''; }
    else if (tab === 2) { P.tiles(1284, 0, 0, 0); const s = PanelPanes.skann(P, lt, { t0: .3, t1: 1.9 }); P._skann.d.style.display = ''; P.status(`Skannet ${nb(s.n)} av 1${NB}284`); }
    else if (tab === 3) { P.tiles(1284, 0, 0, 0); const pr = PanelPanes.analyse(P, lt, { tKlikk: .3, tEnd: 1.8 }); P._an.d.style.display = lt > 2.0 ? 'none' : ''; P._res.style.display = lt > 2.0 ? '' : 'none'; P._res.style.opacity = seg(lt, 2.0, 2.3); P.status(lt > 2.0 ? '<span class="ok">12 å sjekke · 4 høy risiko</span>' : ''); }
    else { P.tiles(1284, 0, 0, 0); const r = P._rap.r; P._rap.d.style.display = ''; r.items.forEach((d, i) => d.firstChild.classList.toggle('on', lt > .6 + i * .22)); r.ok.style.opacity = seg(lt, 2.1, 2.4); r.b.classList.toggle('dis', lt > .3); r.b.textContent = lt > 2.1 ? 'RAPPORT LAGET' : lt > .3 ? 'LAGER RAPPORT …' : 'LAG REVISJONSRAPPORT'; }
  }
  function openDemo() { if (open) return; Engine.pause(); open = true; $('#end').hidden = true; if (!root || !root.firstChild) build(); root.hidden = false; Engine.fit(); select(0); }
  function close() { open = false; cancelAnimationFrame(raf); root.hidden = true; Engine.seek(Engine.total); $('#end').hidden = false; }
  return { open: openDemo, close, get isOpen() { return open; } };
})();

/* ===================================================================== 8. OPPSTART */
function boot() {
  Engine.layout(); Engine.fit(); addEventListener('resize', Engine.fit);
  const gate = $('#gate'), end = $('#end'), dev = $('#dev'), sound = $('#sound');
  Engine.onEnd = () => { if (!RENDER) end.hidden = false; };
  const start = () => { gate.hidden = true; end.hidden = true; Sfx.emit('scene-transition'); Engine.restart(); };

  // offentlig API (brukes også til opptak): KH.seek(t), KH.onSound(fn) …
  window.KH = { seek: t => Engine.seek(t), play: Engine.play, pause: Engine.pause, restart: Engine.restart, scene: Engine.scene, scenes: SCENES.map(s => ({ id: s.id, start: s.start, dur: s.dur })), total: Engine.total, onSound: Sfx.on, demo: Demo.open, cues: () => SCENES.flatMap(s => s.cues.map(c => ({ t: +(s.start + c[0] / s.k).toFixed(3), name: c[1], scene: s.id }))) };
  window.__render = t => Engine.seek(t);
  window.__prep = () => { gate.hidden = true; end.hidden = true; sound.hidden = true; dev.hidden = true; $('#stage').style.transform = 'none'; };

  if (RENDER) { window.__prep(); Engine.seek(0); return; }

  $('#end-replay').onclick = () => { end.hidden = true; Engine.restart(); };
  $('#end-demo').onclick = () => Demo.open();
  $('#gate-play').onclick = start;
  sound.hidden = false;
  sound.onclick = () => { const v = !Sfx.enabled; Sfx.enable(v); sound.textContent = 'Lyd: ' + (v ? 'på' : 'av'); sound.setAttribute('aria-pressed', v); };

  // utviklerverktøy
  if (DEV) {
    dev.hidden = false; const box = $('#dev-scenes'), scrub = $('#dev-scrub'), lab = $('#dev-time');
    Engine.SCENES.forEach((s, i) => { const b = el('button', '', (i + 1) + ' ' + s.id); b.onclick = () => { Engine.pause(); Engine.scene(i); }; box.appendChild(b); });
    scrub.oninput = () => { Engine.pause(); Engine.seek(scrub.value / 1000 * Engine.total); };
    Engine.onTime = t => { scrub.value = Math.round(t / Engine.total * 1000); lab.textContent = dec(t, 1) + ' s'; [...box.children].forEach((b, i) => b.classList.toggle('on', i === Engine.current())); };
  }
  addEventListener('keydown', e => {
    if (Demo.isOpen) { if (e.key === 'Escape') Demo.close(); return; }
    if (e.code === 'Space') { e.preventDefault(); gate.hidden ? Engine.toggle() : start(); }
    else if (e.key === 'r' || e.key === 'R') { gate.hidden = true; Engine.restart(); end.hidden = true; }
    else if (e.key === ']') { Engine.pause(); Engine.scene(Engine.current() + 1); }
    else if (e.key === '[') { Engine.pause(); Engine.scene(Engine.current() - 1); }
    else if (e.key === 'ArrowRight') Engine.seek(Engine.T + 2);
    else if (e.key === 'ArrowLeft') Engine.seek(Engine.T - 2);
    else if (e.key === 'd') $('#dev').hidden = !$('#dev').hidden;
    else if (/^[0-9]$/.test(e.key)) { Engine.pause(); Engine.scene((+e.key || 10) - 1); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) Engine.pause(); });

  const hash = location.hash.match(/t=([\d.]+)/);
  if (hash) { gate.hidden = true; Engine.play(+hash[1]); }
  else if (RM || Q.has('gate')) { Engine.seek(0); gate.hidden = false; $('#gate-note').textContent = 'Kvitteringshenter · reklame · redusert bevegelse er på'; }
  else { gate.hidden = true; Sfx.emit('scene-transition'); Engine.restart(); }
}
boot();
})();
