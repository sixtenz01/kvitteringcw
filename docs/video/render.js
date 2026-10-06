'use strict';
// Rendrer annonse.html bilde for bilde (30 b/s, 10 s) til PNG. Bruk: node render.js <utmappe>
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('file://' + path.join(__dirname, 'annonse.html'));
  await page.evaluate(() => document.fonts.ready.then(() => document.getElementById('img').decode()));
  const N = 300;
  for (let i = 0; i < N; i++) {
    await page.evaluate((t) => render(t), i / 30);
    await page.screenshot({ path: path.join(out, String(i).padStart(4, '0') + '.png') });
    if (i % 30 === 0) console.log('frame', i);
  }
  await browser.close();
})();
