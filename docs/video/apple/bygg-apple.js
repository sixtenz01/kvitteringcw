'use strict';
// Bygger én frittstående HTML-fil (skrift, bilder og lyd innebygd) som spiller annonsen i nettleseren.
//   node bygg-apple.js <lyd.mp3> <ut.html>
const fs = require('fs');
const path = require('path');
const [mp3, out] = process.argv.slice(2);
const b64 = (f, mime) => 'data:' + mime + ';base64,' + fs.readFileSync(f).toString('base64');
let h = fs.readFileSync(path.join(__dirname, 'apple.src.html'), 'utf8');
h = h.replace('url(inter.woff2)', 'url(' + b64(path.join(__dirname, 'inter.woff2'), 'font/woff2') + ')');
h = h.replace(/src="\.\.\/ui-bilder\/([a-z0-9-]+\.jpg)"/g, (m, f) => 'src="' + b64(path.join(__dirname, '../ui-bilder', f), 'image/jpeg') + '"');
h = h.replace('src="apple.mp3"', 'src="' + b64(mp3, 'audio/mpeg') + '"');
fs.writeFileSync(out, h);
console.log('skrev', out, (fs.statSync(out).size / 1048576).toFixed(1) + ' MB');
