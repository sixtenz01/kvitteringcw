'use strict';
// Lager PDF-en «Slik setter du innstillinger». To omganger: første gir sidetallene, andre setter dem inn i innholdsfortegnelsen.
//   NODE_PATH=<mappe med playwright> node docs/manual/innstillinger-pdf.js [utfil.pdf]
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const B = require('./build.js');

const out = process.argv[2] || path.join(__dirname, '..', 'Kvitteringshenter-innstillinger.pdf');
const E = B.settingsEntries();
const entries = E.chapters.map((c) => ({ id: c.id, t: c.t, n: c.n })).concat(E.groups.map((g) => ({ id: g.id, t: g.t, n: '' })));

async function render(browser, pages, file) {
  const page = await browser.newPage();
  await page.emulateMedia({ media: 'print', colorScheme: 'light' });
  await page.setContent(B.settingsPage(pages), { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Array.from(document.images).map((i) => (i.decode ? i.decode().catch(() => {}) : null))));
  await page.pdf({ path: file, format: 'A4', printBackground: true, preferCSSPageSize: true, outline: true, tagged: true });
  await page.close();
}

function pagesOf(file) {
  const txt = execFileSync('pdftotext', ['-layout', file, '-'], { maxBuffer: 1 << 28 }).toString('utf8').split('\f');
  const found = {};
  entries.forEach((c) => {
    const re = new RegExp('^\\s*' + (c.n ? c.n + '\\s+' : '') + c.t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'm');
    for (let i = 2; i < txt.length; i++) if (re.test(txt[i])) { found[c.id] = i + 1; break; }
  });
  return { found, total: txt.filter((t) => t.trim()).length };
}

(async () => {
  const browser = await chromium.launch();
  const tmp = path.join(os.tmpdir(), 'kvr-innst-pass1.pdf');
  await render(browser, {}, tmp);
  const p1 = pagesOf(tmp);
  const missing = entries.filter((c) => !p1.found[c.id]);
  if (missing.length) throw new Error('fant ikke i PDF: ' + missing.map((c) => c.t).join(', '));
  await render(browser, p1.found, out);
  const p2 = pagesOf(out);
  entries.forEach((c) => { if (p1.found[c.id] !== p2.found[c.id]) throw new Error('sidetall endret mellom omgangene for ' + c.t); });
  await browser.close();
  console.log('skrev ' + out + ' (' + p2.total + ' sider, ' + (fs.statSync(out).size / 1048576).toFixed(1) + ' MB)');
  console.log(entries.map((c) => (c.n ? c.n + ' ' : '   ') + c.t + ' s.' + p2.found[c.id]).join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
