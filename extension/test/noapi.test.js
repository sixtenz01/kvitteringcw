const fs = require('fs');
const path = require('path');
const assert = require('assert');

const dir = path.join(__dirname, '..', 'src');
const BAD = [
  [/\bfetch\s*\(/, 'fetch('],
  [/XMLHttpRequest/, 'XMLHttpRequest'],
  [/\$http\b/, '$http'],
  [/\.ajax\s*\(/, '.ajax('],
  [/\bsendBeacon\b/, 'sendBeacon'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/\bEventSource\b/, 'EventSource'],
  [/\/Api\//, '/Api/'],
  [/GetReceipt(Details|Xml|Pdf)/, 'GetReceipt*']
];

const hits = [];
// src/ er det Chrome laster; content/ er delene src/content.js settes sammen av
[dir, path.join(__dirname, '..', 'content')].forEach((d) => {
  fs.readdirSync(d).filter((f) => f.endsWith('.js')).forEach((f) => {
    fs.readFileSync(path.join(d, f), 'utf8').split('\n').forEach((line, i) => {
      BAD.forEach(([re, name]) => { if (re.test(line)) hits.push(path.basename(d) + '/' + f + ':' + (i + 1) + ' ' + name); });
    });
  });
});
assert.deepStrictEqual(hits, [], 'pluginen skal ikke sende kall mot CW eller andre: ' + hits.join(', '));

const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
assert.ok(!m.background && !m.host_permissions, 'ingen bakgrunnsskript eller verts-tillatelser');
assert.deepStrictEqual(m.permissions || [], [], 'ingen utvidelsestillatelser');
console.log('noapi: ok');
