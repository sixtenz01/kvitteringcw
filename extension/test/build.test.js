// src/content.js settes sammen av delene i content/ (node build.js). Testen stopper hvis de er ute av takt,
// for eksempel fordi src/content.js er redigert direkte, eller en del er endret uten at filen er bygd på nytt.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const B = require('../build.js');

const names = B.parts();
assert.ok(names.length >= 10, 'delene finnes: ' + names.length);
assert.deepStrictEqual(fs.readdirSync(B.PARTS).filter((f) => names.indexOf(f) === -1), [], 'bare nummererte deler i content/');
names.forEach((f, i) => assert.strictEqual(Number(f.slice(0, 2)), i + 1, 'delene er nummerert fortløpende: ' + f));

const built = B.assemble(), onDisk = fs.readFileSync(B.OUT, 'utf8');
assert.ok(built === onDisk, 'src/content.js er ikke satt sammen av delene i content/. Rediger delene og kjør: node build.js');

// hver del slutter med linjeskift og begynner på en seksjon, så delene kan leses hver for seg
names.forEach((f, i) => {
  const t = fs.readFileSync(path.join(B.PARTS, f), 'utf8');
  assert.ok(t.endsWith('\n'), f + ' slutter med linjeskift');
  if (i > 0) assert.ok(/^  \/\/ ---- /.test(t), f + ' begynner med en seksjonsoverskrift');
  assert.ok(t.split('\n').length < 1200, f + ' er under 1200 linjer');
});
// den sammensatte filen er gyldig JavaScript (kompileres, kjøres ikke)
new vm.Script(built, { filename: 'content.js' });
console.log('build: ok (' + names.length + ' deler)');
