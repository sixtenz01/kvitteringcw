// Setter sammen src/content.js av delene i content/ (i navnerekkefølge, uten å endre et tegn).
// Chrome laster bare src/content.js. Rediger delene, ikke src/content.js, og kjør så:
//   node build.js          skriver src/content.js
//   node build.js --check  feiler hvis src/content.js ikke er satt sammen av delene
const fs = require('fs');
const path = require('path');

const PARTS = path.join(__dirname, 'content');
const OUT = path.join(__dirname, 'src', 'content.js');

function parts() {
  return fs.readdirSync(PARTS).filter((f) => /^\d\d-[a-z0-9-]+\.js$/.test(f)).sort();
}

function assemble() {
  return parts().map((f) => fs.readFileSync(path.join(PARTS, f), 'utf8')).join('');
}

if (require.main === module) {
  const built = assemble();
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(OUT, 'utf8') !== built) { console.error('src/content.js er ikke satt sammen av delene i content/. Kjør: node build.js'); process.exit(1); }
    console.log('build: i takt (' + parts().length + ' deler)');
  } else {
    fs.writeFileSync(OUT, built);
    console.log('build: skrev src/content.js av ' + parts().length + ' deler, ' + built.split('\n').length + ' linjer');
  }
}

module.exports = { assemble, parts, OUT, PARTS };
