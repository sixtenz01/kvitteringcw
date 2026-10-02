'use strict';
// Lager skjermbildene til brukerveiledningen ved å kjøre pluginen mot et oppdiktet datasett.
// Bruk: NODE_PATH=<mappe med playwright> node docs/manual/shots.js [scene ...]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { build, pageHtml } = require('./fixture.js');

const EXT = path.join(__dirname, '../../extension');
const OUT = path.join(__dirname, 'img');
const only = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });

const data = build();
const html = pageHtml(data.rows);

async function openSession(width, height) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'nb-NO', viewport: { width, height }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.error('PAGEERROR', e.message); });
  await page.route('https://chainweb.coop.no/**', async (r) => {
    if (r.request().url().endsWith('/Api/GetReceiptDetails')) {
      const b = JSON.parse(r.request().postData());
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify(data.receipts[`${b.retailStoreNum}-${b.workstationNum}-${b.sequenceNum}`] || '') });
    }
    return r.fulfill({ contentType: 'text/html', body: html });
  });
  await page.goto('https://chainweb.coop.no/LindbakRetail_1/Journal/Viewer');
  for (const f of ['lib/html2canvas.min.js', 'lib/jszip.min.js', 'src/logic.js', 'src/report.js']) await page.addScriptTag({ path: path.join(EXT, f) });
  await page.addStyleTag({ path: path.join(EXT, 'src/panel.css') });
  await page.addScriptTag({ path: path.join(EXT, 'src/content.js') });
  await page.waitForSelector('#kvr-panel');
  await page.evaluate(() => { const p = document.getElementById('kvr-panel'); p.style.top = '10px'; p.style.left = '10px'; });
  return { browser, page, errors };
}

// Nummererte markører med strek ut til kanten av bildet (høyre side, eller over panelet for toppknappene).
async function annotate(page, marks) {
  await page.evaluate((marks) => {
    document.querySelectorAll('.kvr-ann').forEach((n) => n.remove());
    const panel = document.getElementById('kvr-panel').getBoundingClientRect();
    const mk = (css) => { const d = document.createElement('div'); d.className = 'kvr-ann'; d.style.cssText = 'position:fixed;pointer-events:none;' + css; document.body.appendChild(d); return d; };
    let lastY = -100;
    const placed = marks.map((m, i) => {
      const el = m.text ? Array.from(document.querySelectorAll(m.sel)).filter((e) => e.textContent.trim() === m.text)[0] : document.querySelector(m.sel);
      if (!el) { console.error('mangler ' + m.sel); return null; }
      return { m: m, n: m.n || i + 1, r: el.getBoundingClientRect() };
    }).filter(Boolean);
    placed.filter((p) => p.m.side !== 'top').sort((a, b) => a.r.top - b.r.top).forEach((p) => {
      let y = p.r.top + Math.min(p.r.height, 28) / 2;
      if (y < lastY + 26) y = lastY + 26;
      lastY = y; p.y = y;
    });
    placed.forEach((p, k) => {
      const r = p.r;
      mk(`z-index:100001;left:${r.left - 2}px;top:${r.top - 2}px;width:${r.width + 4}px;height:${r.height + 4}px;border:2px solid #e8590c;border-radius:6px;`);
      if (p.m.side === 'top') {
        const cx = r.left + r.width / 2, top = panel.top - 26;
        mk(`z-index:100001;left:${cx - 1}px;top:${top + 20}px;width:2px;height:${r.top - top - 20}px;background:#e8590c;`);
        const b = mk(`z-index:100002;left:${cx - 11}px;top:${top}px;width:22px;height:22px;border-radius:50%;background:#e8590c;color:#fff;font:700 12px/22px system-ui;text-align:center;`);
        b.textContent = String(p.n);
      } else {
        const x = panel.right + 8;
        mk(`z-index:100001;left:${r.right + 2}px;top:${p.y - 1}px;width:${x - r.right - 2}px;height:2px;background:#e8590c;`);
        if (Math.abs(p.y - (r.top + r.height / 2)) > 3) mk(`z-index:100001;left:${r.right + 2}px;top:${Math.min(p.y, r.top + r.height / 2)}px;width:2px;height:${Math.abs(p.y - (r.top + r.height / 2))}px;background:#e8590c;`);
        const b = mk(`z-index:100002;left:${x}px;top:${p.y - 11}px;width:22px;height:22px;border-radius:50%;background:#e8590c;color:#fff;font:700 12px/22px system-ui;text-align:center;`);
        b.textContent = String(p.n);
      }
    });
  }, marks);
}
const unannotate = (page) => page.evaluate(() => document.querySelectorAll('.kvr-ann').forEach((n) => n.remove()));

const scenes = {};
const scene = (name, fn) => { scenes[name] = fn; };


async function main() {
  const { browser, page, errors } = await openSession(1100, 900);
  const view = async (h) => { await page.setViewportSize({ width: 1100, height: h }); await page.waitForTimeout(150); };
  const panel = () => page.$('#kvr-panel');
  const save = async (name, target, pad) => {
    await page.waitForTimeout(250);
    const t = target || (await panel());
    if (pad) {
      const b = await t.boundingBox();
      const pr = typeof pad === 'object' ? pad : { l: pad, r: pad, t: pad, b: pad };
      await page.screenshot({ path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 80, clip: { x: Math.max(0, b.x - pr.l), y: Math.max(0, b.y - pr.t), width: b.width + pr.l + pr.r, height: b.height + pr.t + pr.b } });
    } else await t.screenshot({ path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 80 });
    console.log('  ' + name);
  };
  const go = async (main, sub) => { await page.click(`.kvr-tab:has-text("${main}")`); if (sub) await page.click(`.kvr-sub:text-is("${sub}")`); await page.evaluate(() => { document.querySelector('.kvr-scroll').scrollTop = 0; }); };
  const scrollTo = (y) => page.evaluate((y) => { document.querySelector('.kvr-scroll').scrollTop = y; }, y);
  const cardShot = async (name, sel, pad) => { const h = await page.$(sel); await h.scrollIntoViewIfNeeded(); await save(name, h, pad); };
  const unfold = async (id) => { if (await page.$eval(`[data-sec=${id}]`, (n) => n.classList.contains('kvr-folded'))) await page.click(`[data-sec=${id}] > h4`); };
  const c = { page, go, save, scrollTo, cardShot, unfold, view, browser, annotate: (m) => annotate(page, m), un: () => unannotate(page) };
  const want = (n) => !only.length || only.indexOf(n) !== -1;

  // ---- uten skanning
  await view(780);
  await page.click('[data-sec=store] .kvr-chk:has-text("1001") input');
  if (want('oversikt')) {
    await go('Filtrer');
    await page.evaluate(() => { document.getElementById('kvr-panel').style.top = '48px'; });
    await c.annotate([
      { sel: '.kvr-title', n: 1, side: 'top' }, { sel: '.kvr-icon[title="Hjelp og tegnforklaring"]', n: 2, side: 'top' }, { sel: '.kvr-icon[title="Innstillinger"]', n: 3, side: 'top' },
      { sel: '.kvr-icon[title^="Utvid"]', n: 4, side: 'top' }, { sel: '.kvr-icon[title^="Skjul"]', n: 5, side: 'top' }, { sel: '.kvr-badge', n: 6, side: 'top' },
      { sel: '.kvr-tiles', n: 7 }, { sel: '.kvr-chipsrow', n: 8 }, { sel: '.kvr-scanrow', n: 9 }, { sel: '.kvr-tabs', n: 10 }, { sel: '.kvr-foot', n: 11 }
    ]);
    await save('oversikt', null, { l: 8, r: 40, t: 40, b: 8 });
    await c.un();
    await page.evaluate(() => { document.getElementById('kvr-panel').style.top = '10px'; });
  }
  await page.evaluate(() => { const b = document.querySelector('.kvr-first button:last-child'); if (b) b.click(); });
  if (want('hent')) { await go('Hent'); await save('hent'); }
  await go('Filtrer');
  await page.click('.kvr-fchip:has-text("Butikk")');
  await view(900);
  if (want('filtrer')) {
    await save('filtrer-a');
    await scrollTo(760); await save('filtrer-b');
  }
  if (want('skann')) {
    await go('Skann'); await view(900);
    await page.selectOption('.kvr-f:has-text("Pant (krever") select', 'return');
    await save('skann-for');
    await page.selectOption('.kvr-f:has-text("Pant (krever") select', '');
  }

  // ---- skanning (rask skanning, for tempoets skyld)
  await go('Skann');
  await page.click('text=Rask skanning');
  await page.click('text=Skann innhold (synlige)');
  await page.waitForTimeout(2500);
  if (want('skanner')) { await view(520); await save('skanner'); }
  await page.waitForFunction(() => /Ferdig\. Skannet/.test(document.getElementById('kvr-panel').innerText), null, { timeout: 120000 });
  await view(900);
  if (want('skann')) { await go('Skann'); await scrollTo(0); await save('skann-etter'); await scrollTo(500); await save('skann-grupper'); }

  // ---- analyse
  await go('Analyse', 'Sjekk først');
  if (want('sjekk')) { await view(640); await save('sjekk-for'); }
  await page.click('[data-sec=chk-top] button:text-is("Kjør analyse")');
  await page.waitForFunction(() => /Kontroller ferdig/.test(document.getElementById('kvr-panel').innerText), null, { timeout: 60000 });
  await view(1000);
  if (want('sjekk')) {
    await go('Analyse', 'Sjekk først');
    await save('sjekk-etter');
    await page.click('[data-sec=scope] summary');
    await cardShot('sjekk-omfang', '[data-sec=scope]');
    await page.click('[data-sec=scope] summary');
  }
  if (want('kort')) {
    await go('Analyse', 'Sjekk først');
    const first = '[data-sec=chk-list] .kvr-ck:first-child';
    await (await page.$(first)).scrollIntoViewIfNeeded();
    await c.annotate([{ sel: first + ' .kvr-risk', n: 1 }, { sel: first + ' .kvr-reasons', n: 2 }, { sel: first + ' .kvr-why', n: 3 }, { sel: first + ' .kvr-adj', n: 4, at: 'right' }, { sel: first + ' .kvr-table', n: 5 }, { sel: first + ' .kvr-acts', n: 6 }, { sel: first + ' .kvr-ents', n: 7 }]);
    await save('sjekk-kort', await page.$(first), { l: 8, r: 40, t: 8, b: 8 });
    await c.un();
  }
  if (want('diagram')) {
    await go('Analyse', 'Diagram'); await view(1000);
    for (const id of ['ch-hours', 'ch-days', 'ch-cash', 'ch-heat', 'ch-benford', 'ch-pant']) await cardShot(id, `[data-sec=${id}]`);
  }
  if (want('rapport')) { await go('Analyse', 'Rapport'); await view(900); await save('rapport'); }
  if (want('fokus')) {
    await go('Analyse', 'Fokus'); await view(900);
    await save('fokus-start');
    await page.click('.kvr-card:has(h4:text-is("Kasserere i listen")) .kvr-ent:text-is("Kasserer 4103")');
    await page.waitForTimeout(300);
    await scrollTo(0); await save('fokus-a');
    await scrollTo(700); await save('fokus-b');
    await page.click('.kvr-fchip:has-text("Kasserer")').catch(() => {});
  }
  if (want('detaljer')) {
    await go('Analyse', 'Detaljer'); await view(1000);
    await save('detaljer-topp');
    for (const id of ['profile', 'findings', 'pantbal', 'recon', 'diff', 'numbers', 'disc']) { await unfold(id); }
    for (const id of ['profile', 'findings', 'pantbal', 'recon', 'diff', 'numbers', 'disc']) await cardShot('d-' + id, `[data-sec=${id}]`);
    await cardShot('d-anom', '[data-sec=anom]'); await cardShot('d-custom', '[data-sec=custom]'); await cardShot('d-tasks', '[data-sec=tasks]'); await cardShot('d-notes', '[data-sec=notes]');
  }

  // ---- mer
  await view(900);
  if (want('mer')) { await go('Mer', 'Eksport'); await save('eksport'); }
  if (want('innst')) {
    await go('Mer', 'Innstillinger');
    await save('innstillinger-lukket');
    await scrollTo(0); await save('innstillinger-generelt');
  }
  if (want('hjelp')) {
    await page.click('.kvr-icon[title="Hjelp og tegnforklaring"]');
    await save('hjelp', await page.$('.kvr-dlg'));
    await page.click('.kvr-modal button:text-is("Lukk")');
  }

  // ---- revisjonsrapport
  if (want('revisjon')) {
    await go('Mer', 'Eksport');
    await save('eksport-revisjon', await page.$('[data-sec=auditrep]'));
    await page.click('[data-sec=auditrep] button:text-is("Lag revisjonsrapport…")');
    await page.fill('.kvr-modal input[placeholder*="saksnr"]', 'KONTROLL-2026-14');
    await page.fill('.kvr-modal input[placeholder="navn"]', 'Kari Revisor');
    await page.fill('.kvr-modal input[type=number]', '4');
    await save('revisjon-dialog', await page.$('.kvr-dlg'));
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }), page.click('.kvr-modal button:text-is("Lag rapport (ZIP)")')]);
    const file = path.join(os.tmpdir(), 'manual-report.zip');
    await dl.saveAs(file);
    await page.waitForSelector('.kvr-modal:has-text("Rapport laget")', { timeout: 60000 });
    await save('revisjon-ferdig', await page.$('.kvr-dlg'));
    await page.click('.kvr-modal button:text-is("Lukk")');
    const JSZip = require(path.join(EXT, 'lib/jszip.min.js'));
    const zip = await JSZip.loadAsync(fs.readFileSync(file));
    const dir = path.join(os.tmpdir(), 'manual-report');
    fs.rmSync(dir, { recursive: true, force: true });
    for (const n of Object.keys(zip.files)) { if (zip.files[n].dir) continue; const f = path.join(dir, n); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, await zip.file(n).async('nodebuffer')); }
    const png = Object.keys(zip.files).filter((n) => /^bevis\/.*\.png$/.test(n))[0];
    fs.copyFileSync(path.join(dir, png), path.join(OUT, 'bevis.png'));
    fs.writeFileSync(path.join(OUT, 'zip-filer.txt'), Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort().join('\n') + '\n');
    const rp = await browser.newPage({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 1.5 });
    await rp.goto('file://' + path.join(dir, 'rapport.html'));
    const H = await rp.evaluate(() => document.documentElement.scrollHeight);
    const heights = await rp.evaluate(() => Array.from(document.querySelectorAll('h2')).map((h) => [h.textContent, h.getBoundingClientRect().top + window.scrollY]));
    const at = (t) => (heights.filter((h) => h[0].indexOf(t) === 0)[0] || [0, 0])[1];
    const clip = async (name, y0, y1) => { await rp.screenshot({ path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 80, fullPage: true, clip: { x: 0, y: y0, width: 1000, height: Math.min(y1, H) - y0 } }); console.log('  ' + name); };
    await clip('rapport-forside', 0, at('2.') + 0);
    await clip('rapport-dekning', at('3.'), at('4.'));
    await clip('rapport-funn', at('6.'), Math.min(at('6.') + 780, at('7.')));
    await clip('rapport-bevis', at('7.'), at('9.'));
    await rp.close();
  }

  if (want('innstrad')) {
    await go('Mer', 'Innstillinger');
    await page.click('[data-sec=set-bong] summary');
    const inp = page.locator('[data-sec=set-bong] input[aria-label="Stor panteretur fra"]');
    await inp.fill('250'); await inp.press('Tab');
    await view(1500);
    await page.mouse.click(1000, 600);
    const g = '[data-sec=set-bong]';
    await (await page.$(g)).scrollIntoViewIfNeeded();
    await c.annotate([
      { sel: g + ' summary .kvr-set-badge', n: 1 }, { sel: g + ' input[aria-label="Stor panteretur fra: på"]', n: 2 }, { sel: g + ' input[aria-label="Stor panteretur fra"]', n: 3 },
      { sel: g + ' .kvr-set-sub', n: 4 }, { sel: g + ' button', text: 'Standard for denne gruppen', n: 5 }
    ]);
    await save('innstillinger-rad', await page.$(g), { l: 8, r: 40, t: 8, b: 8 });
    await c.un();
    await page.click(g + ' button:text-is("Standard for denne gruppen")');
    await view(900);
  }

  await browser.close();
  if (errors.length) { console.error(errors); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
