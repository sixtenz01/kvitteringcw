// Sørger for at brukerveiledningen dekker alt som finnes i pluginen: hver innstilling, hver poengvekt, hver test,
// hver fane og hvert kort, og at bilder og lenker i den bygde veiledningen er hele.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const L = require('../src/logic.js');
const R = require('../src/report.js');
const H = require('../../docs/manual/help.js');
const B = require('../../docs/manual/build.js');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));
assert.strictEqual(R.VERSION, manifest.version);

// ---- forklaringer finnes for alt
const fieldKeys = [];
L.SETTING_GROUPS.forEach((g) => {
  assert.ok(H.groups[g.id], 'mangler gruppe ' + g.id);
  ['how', 'harmless', 'needs'].forEach((k) => assert.ok(H.groups[g.id][k] && H.groups[g.id][k].length > 20, g.id + '.' + k));
  assert.ok(Array.isArray(H.groups[g.id].flags) && H.groups[g.id].flags.length > 0, g.id + '.flags');
  g.fields.forEach((f) => {
    const key = f.src === 'anom' ? 'anom:' + f.k : f.k;
    fieldKeys.push(key);
    const h = H.fields[key];
    assert.ok(h, 'mangler forklaring for ' + key);
    ['what', 'tip'].forEach((k) => assert.ok(h[k] && h[k].length > 8, key + '.' + k));
    assert.ok(h.ex && h.ex.length >= 2, key + '.ex');
  });
});
assert.deepStrictEqual(Object.keys(H.fields).filter((k) => fieldKeys.indexOf(k) === -1), [], 'forklaring uten innstilling');
assert.deepStrictEqual(Object.keys(H.groups).filter((k) => !L.SETTING_GROUPS.some((g) => g.id === k)), [], 'forklaring uten gruppe');
assert.deepStrictEqual(Object.keys(L.RISK_WEIGHTS).filter((k) => !H.weights[k]), [], 'poengvekt uten forklaring');
assert.deepStrictEqual(Object.keys(H.weights).filter((k) => !(k in L.RISK_WEIGHTS)), [], 'forklaring uten poengvekt');

// ---- den bygde veiledningen
const html = B.page(false), art = B.page(true);
assert.ok(!/\{\{/.test(html), 'ubrukt plassholder');
assert.ok(html.startsWith('<!doctype html>') && !art.includes('<!doctype') && !art.includes('<body'), 'skall bare i frittstående fil');
assert.ok(/<title>[^<]{10,}<\/title>/.test(art.slice(0, 300)), 'tittel først i artifact-varianten');
assert.ok(html.includes('versjon ' + manifest.version) && html.includes('Brukerveiledning ' + manifest.version));
const text = html.replace(/<img[^>]*>/g, '').replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
const has = (t) => assert.ok(text.includes(t), 'veiledningen mangler «' + t + '»');
L.SETTING_GROUPS.forEach((g) => {
  has(g.title); has(g.text);
  g.fields.forEach((f) => has(f.label));
  g.weights.forEach((w) => has(w === 'Regel' ? 'Treff på egne regler' : w));
});
// standardverdier står i veiledningen
const dc = L.defaultControl(), da = L.defaultAnom();
L.SETTING_GROUPS.forEach((g) => g.fields.forEach((f) => {
  const v = (f.src === 'anom' ? da : dc)[f.k];
  if (f.kind === 'flag' || v === '' || v === false) return;
  has(String(v) + (f.unit && f.kind !== 'time' ? ' ' + f.unit : ''));
}));
Object.keys(L.RISK_WEIGHTS).forEach((w) => has(L.RISK_WEIGHTS[w] + ' poeng'));
// faner, delfaner og kort
['Hent', 'Filtrer', 'Skann', 'Analyse', 'Mer', 'Sjekk først', 'Diagram', 'Rapport', 'Fokus', 'Detaljer', 'Eksport', 'Innstillinger'].forEach(has);
const content = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8');
const cards = [];
content.replace(/fold\(section\('([\w-]+)', '([^']+)'/g, (m, id, t) => { cards.push(t); return m; });
assert.ok(cards.length >= 9, 'fant kortene i Detaljer');
cards.forEach((t) => has(t.replace('Avvik', 'Avvik')));
['Velg omfang', 'Kjør analyse', 'Lag revisjonsrapport', 'Tøm cache', 'Nullstill alt', 'Standard for denne gruppen', 'Alt til standard', 'Morgenkontroll', 'Skann nå', 'Kasserere å se nærmere på'].forEach(has);
Object.keys(L.RULE_FIELDS).forEach((k) => has(L.RULE_FIELDS[k].label));
L.DISC_REASONS.forEach((r, i) => has(r));
// tast og snarveier som pluginen faktisk har
['Alt+K', 'Alt+klikk'].forEach((t) => assert.ok(html.includes(t.replace('Alt+', '<kbd>Alt</kbd>+').replace('+K', '+<kbd>K</kbd>')) || text.includes(t) || html.includes('<kbd>Alt</kbd>+'), t));

// tegnforklaringen i hjelpen og i veiledningen følger hverandre, og kampanjespørsmålet og butikknavn er forklart
['Overstrøket årsak', 'Kan være sentral kampanje', 'Svar nå', 'Rabatt uten årsak', 'Mulig sentral kampanje', 'Nivå og avdelingsnummer', 'Spesialbetaling', 'Spør pris', 'Samme forhold', 'kampanjesvar', 'Ja, kampanje', 'Nei, ikke kampanje', 'Angre', 'Gi butikken navn'].forEach(has);
['Overstrøket årsak', 'sentral kampanje', 'Panelstørrelse'].forEach((t) => assert.ok(content.includes(t), 'hjelpen i panelet mangler «' + t + '»'));

// ---- lenker og bilder er hele
const ids = {};
html.replace(/\sid="([^"]+)"/g, (m, id) => { ids[id] = true; return m; });
const bad = [];
html.replace(/href="#([^"]+)"/g, (m, id) => { if (!ids[id]) bad.push(id); return m; });
assert.deepStrictEqual(bad, [], 'lenker uten mål');
const imgs = (html.match(/<img /g) || []).length;
assert.ok(imgs >= 40, 'skjermbilder er med (' + imgs + ')');
assert.ok(!/<img[^>]*src="(?!data:)/.test(html), 'bildene er innebygd');
assert.ok((html.match(/<svg /g) || []).length >= 15, 'diagrammer er med');
assert.ok(!/<svg[\s\S]{0,80}<script|<foreignObject/.test(html), 'ingen script i SVG');
const missingAlt = (html.match(/<img(?![^>]*alt="[^"]+")[^>]*>/g) || []).length;
assert.strictEqual(missingAlt, 0, 'alle bilder har alt-tekst');
const noLabel = (html.match(/<svg(?![^>]*aria-label)[^>]*>/g) || []).length;
assert.strictEqual(noLabel, 0, 'alle diagrammer har beskrivelse');
assert.ok(new Set((html.match(/<marker id="([^"]+)"/g) || [])).size === (html.match(/<marker id="/g) || []).length, 'unike pil-id-er');
// markørene i de annoterte bildene har en forklaring hver
assert.deepStrictEqual([B.LEGENDS.oversikt.length, B.LEGENDS['sjekk-kort'].length, B.LEGENDS['innstillinger-rad'].length], [11, 7, 5]);
// PDF-varianten: forside, innholdsfortegnelse med sidetall, åpne spørsmål, ingen late bilder
const pdfHtml = B.pdfPage({ 'kom-i-gang': 3, innstillinger: 46 });
assert.ok(pdfHtml.includes('class="cover"') && pdfHtml.includes('class="pdf-toc"') && !/\{\{/.test(pdfHtml));
assert.ok(!pdfHtml.includes('loading="lazy"') && !/<details class="faq">/.test(pdfHtml), 'PDF: bilder lastes og spørsmål er åpne');
assert.ok(/<span class="p">3<\/span>/.test(pdfHtml) && /<span class="p">46<\/span>/.test(pdfHtml), 'PDF: sidetall i innholdsfortegnelsen');
assert.strictEqual((pdfHtml.match(/<h2 id=/g) || []).length, 13, 'PDF: alle kapitler');
console.log('docs: ok (' + imgs + ' bilder, ' + (html.length / 1048576).toFixed(1) + ' MB)');
