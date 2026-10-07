'use strict';
// Tar opp reklamen bilde for bilde (deterministisk: alt er en funksjon av tid).
//   node render-frames.js <utmappe> <fps> <fra> <til>        – flere prosesser kan dele på bildene
//   node render-frames.js --cues <fil.json>                   – skriver lyd-hendelsene (cues) og total varighet
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const a = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('file://' + path.join(__dirname, 'index.html') + '?render');
  await page.evaluate(() => document.fonts.ready);
  if (a[0] === '--cues') {
    const d = await page.evaluate(() => ({ total: KH.total, scenes: KH.scenes, cues: KH.cues() }));
    fs.writeFileSync(a[1], JSON.stringify(d, null, 1)); console.log('cues:', d.cues.length, 'varighet:', d.total.toFixed(2)); await browser.close(); return;
  }
  const [out, fps, from, to] = [a[0], Number(a[1]), Number(a[2]), Number(a[3])];
  fs.mkdirSync(out, { recursive: true });
  for (let i = from; i < to; i++) {
    await page.evaluate(t => __render(t), i / fps);
    await page.screenshot({ path: path.join(out, String(i).padStart(5, '0') + '.png') });
    if (i % 120 === 0) console.log('bilde', i);
  }
  await browser.close();
})();
