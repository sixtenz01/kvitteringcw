'use strict';
// Rendrer en annonse-HTML bilde for bilde (30 b/s) til PNG.
// Bruk: node render.js <html> <utmappe> <antall bilder> [fra] [til)   (fra/til lar flere prosesser dele jobben)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const [html, out, n, from, to] = process.argv.slice(2);
const N = Number(n), a = Number(from || 0), b = Number(to || N);
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('file://' + path.resolve(__dirname, html));
  await page.evaluate(() => document.fonts.ready.then(() => Promise.all([...document.images].map((i) => i.decode()))));
  for (let i = a; i < b; i++) {
    await page.evaluate((t) => render(t), i / 30);
    await page.screenshot({ path: path.join(out, String(i).padStart(4, '0') + '.png') });
    if (i % 60 === 0) console.log('frame', i);
  }
  await browser.close();
})();
