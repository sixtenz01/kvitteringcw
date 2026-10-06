'use strict';
// Bygger brukerveiledningen til én frittstående HTML-fil (bilder innebygd som data-URI).
//   node docs/manual/build.js            -> docs/brukerveiledning.html
//   node docs/manual/build.js --artifact  -> <mappe>/brukerveiledning.artifact.html (uten dokumentskall, for publisering)
const fs = require('fs');
const path = require('path');
const L = require('../../extension/src/logic.js');
const R = require('../../extension/src/report.js');
const H = require('./help.js');
const D = require('./diagrams.js');

const IMG_DIR = path.join(__dirname, 'img');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---- bilder: alt-tekst og bildetekst
const IMG = {
  oversikt: ['Panelet med elleve markører', 'Panelets deler. Tallene forklares i listen.'],
  hent: ['Hent-fanen', 'Hent: søk i hele journalen.'],
  hjelp: ['Hjelpen i panelet', 'Hjelpen under «?»: veiledning, tegnforklaring og snarveier.'],
  'filtrer-a': ['Filtrer, øverste del', 'Filtrer: butikk, dato og tid, og kasse, kasserer og type.'],
  'filtrer-b': ['Filtrer, nederste del', 'Filtrer: sum, medlem, bong og vare, sortering og lagrede filtre.'],
  'skann-for': ['Skann-fanen med pantefilter', 'Skann: filtre for pant og rabatt, og knappene for skanning.'],
  skanner: ['Skanning pågår', 'Mens skanningen pågår ser du fremdrift og tid igjen. Du kan stoppe når som helst.'],
  'skann-etter': ['Skann etter ferdig skanning', 'Etter skanning: «Skannet N av N» (alle skannet).'],
  'skann-grupper': ['Varegrupper', 'Varegrupper med sum per gruppe og varer uten gruppe.'],
  'sjekk-for': ['Sjekk først før analysen', 'Før analysen: Analyse-kortet og omfanget.'],
  'sjekk-etter': ['Sjekk først etter analysen', 'Etter analysen: rangerte kasserere og flaggede bonger.'],
  'sjekk-omfang': ['Velg omfang åpnet', 'Velg omfang: periode, sammenligning, butikk, kasserer og kasse.'],
  'sjekk-kort': ['Åpnet kort for flagget bong med markører', 'Et åpnet kort i «Sjekk først».'],
  'ch-hours': ['Salg per time', 'Salg per time.'], 'ch-days': ['Salg per dag', 'Salg per dag.'], 'ch-cash': ['Returandel per kasserer', 'Returandel per kasserer.'],
  'ch-heat': ['Kasse mot time', 'Kasse × time.'], 'ch-benford': ['Benford', 'Benford: første siffer i totalbeløp.'], 'ch-pant': ['Pant per dag', 'Pant per dag.'],
  rapport: ['Dagsrapport', 'Rapport-fanen: dagsrapport per kasse.'],
  'fokus-start': ['Fokus uten valg', 'Fokus uten valg: velg kasserer eller kasse.'], 'fokus-a': ['Fokus for en kasserer', 'Fokus for kasserer 4103.'],
  'detaljer-topp': ['Detaljer, øverste del', 'Detaljer: resultat og kontroller, deretter kortene.'],
  'd-profile': ['Kassererprofil', 'Kassererprofil mot butikksnitt.'], 'd-findings': ['Mønstre og funn', 'Mønstre og funn.'], 'd-pantbal': ['Pantelapp-sjekk', 'Pantelapp-sjekk.'],
  'd-recon': ['Dagsavstemming', 'Dagsavstemming per kasse.'], 'd-diff': ['Kassadifferanse over tid', 'Kassadifferanse over tid.'], 'd-numbers': ['Tallanalyse', 'Tallanalyse: Benford og runde beløp.'],
  'd-disc': ['Rabatter og kuponger', 'Rabatter og kuponger: tabell per kasserer, per årsak og kasserer × årsak.'],
  'd-member': ['Medlemsnummer', 'Medlemsnummer: nummer med flest bonger og funn, med kasserer og andel.'],
  'd-acct': ['Bongregnskap og referanser', 'Bongregnskap og referanser: dekning og treff for linjer, betaling, MVA og betalingsreferanse.'],
  'd-lapp': ['Pantelapper: manuell og maskin', 'Pantelapper: manuell (kode 99) mot maskin (kode 399), slettede og gjenbrukte lapper per kasserer.'],
  'd-lines': ['Linjer, kort og spesialbetaling', 'Slettede og makulerte linjer, spesialbetalinger, spør pris, returer på samme kort og manuell kvittering.'],
  'd-misc': ['Pris, kjøpeutbytte og hendelser', 'Pris, kjøpeutbytte og hendelser: dekning, avvik og knappen Diagnostikk.'],
  'stor-dokket': ['Stor: panelet dokket til høyre', 'Stor: panelet dokkes til høyre, og Lindbak-lista står synlig til venstre.'], 'stor-full': ['Full: panelet over hele skjermen', 'Full: hele skjermen, med kortene i kolonner og brede tabeller.'],
  'd-custom': ['Egne avviksregler', 'Egne avviksregler.'], 'd-tasks': ['Arbeidsoppgaver', 'Arbeidsoppgaver.'], 'd-notes': ['Oppfølging og tastatur', 'Oppfølging og tastatur.'],
  eksport: ['Eksport', 'Mer → Eksport: CSV og PNG.'], 'eksport-revisjon': ['Revisjonsrapport-kortet', 'Mer → Eksport: Revisjonsrapport og loggen.'],
  'innstillinger-lukket': ['Innstillinger med lukkede grupper', 'Innstillinger: Generelt og én gruppe per test. Alle gruppene er lukket.'],
  'innstillinger-rad': ['Åpnet gruppe med markører', 'Én gruppe åpnet. Verdien for «Stor panteretur fra» er endret til 250.'],
  'innstillinger-generelt': ['Generelt-kortet', 'Generelt: butikknavn, tastaturflyt, eksport og import.'],
  'revisjon-dialog': ['Dialogen for revisjonsrapport', 'Dialogen: referanse, utarbeidet av og antall bevisbilder.'], 'revisjon-ferdig': ['Rapport laget', 'Når rapporten er laget, viser panelet kontrollsummen for ZIP-filen.'],
  'rapport-forside': ['Rapportens forside og sammendrag', 'Rapportens forside og sammendrag.'], 'rapport-dekning': ['Dekningsgrad og begrensninger', 'Dekningsgrad og begrensninger.'],
  'rapport-funn': ['Funn og flaggede kvitteringer', 'Funn og flaggede kvitteringer med forklaring.'], 'rapport-bevis': ['Bevis og kontrollsummer', 'Bevisbilder og kontrollsummer.'],
  bevis: ['Bevisbilde av en bong', 'Et bevisbilde.']
};
const LEGENDS = {
  oversikt: ['<b>Tittelfeltet.</b> Dra for å flytte panelet, dobbeltklikk for å sette det tilbake.', '<b>?</b> åpner hjelp, tegnforklaring og snarveier.', '<b>⚙</b> åpner Innstillinger.', '<b>⤢</b> bytter panelstørrelse: Vanlig, Stor (dokket til høyre) og Full (hele skjermen).', '<b>–</b> skjuler panelet. Samme som <kbd>Alt</kbd>+<kbd>K</kbd>.', '<b>Filterstatus:</b> antall aktive filter og antall valgte bonger.', '<b>Fire tall:</b> bonger du ser av alle (Viser), antall valgte, sum av valgte og mulige duplikater.', '<b>Aktive filter</b> som piller. ✕ fjerner ett, «Nullstill alt» fjerner alle.', '<b>Skannestatus:</b> hvor mange bonger som er skannet, med knapp for å skanne resten.', '<b>De fem fanene:</b> Hent, Filtrer, Skann, Analyse og Mer.', '<b>Snarveier</b> for det du har valgt: Velg alle, Fjern valg, CSV og PNG.'],
  'sjekk-kort': ['<b>Risikoscore og nivå</b> for bongen (her høy, 10 poeng).', '<b>Testene som utløste</b> flagget, én pille per test. Overstrøket pille teller ikke: samme forhold er allerede dekket av en høyere test.', '<b>Hvorfor flagget?</b> Forklaring med tall og grense for hver test.', '<b>Juster</b> åpner innstillingen for den testen.', '<b>Bonglinjer</b> fra skannet innhold. For kassaoppgjør vises telt kontant og differanse.', '<b>Handlinger:</b> Sjekket, Til oppfølging, Notat, Velg og Vis i listen.', '<b>Lenker</b> til alt om kassereren og kassen.'],
  'innstillinger-rad': ['<b>Endret-teller</b> for gruppen. Verdier du har endret fra standard får gul kant.', '<b>På-bryter.</b> Avskrudd betyr at testen ikke kjøres.', '<b>Selve grensen,</b> med enhet ved siden av.', '<b>Poengene</b> for testene i gruppen. Endres de, oppdateres rangeringen med en gang.', '<b>Standard for denne gruppen</b> setter gruppen tilbake.']
};

const mime = (f) => (f.endsWith('.png') ? 'image/png' : 'image/jpeg');
function imgSrc(name) {
  const f = ['jpg', 'png'].map((e) => path.join(IMG_DIR, name + '.' + e)).filter((p) => fs.existsSync(p))[0];
  if (!f) throw new Error('mangler bilde ' + name);
  return 'data:' + mime(f) + ';base64,' + fs.readFileSync(f).toString('base64');
}
const imgTag = (name) => `<img src="${imgSrc(name)}" alt="${esc(IMG[name][0])}" loading="lazy" decoding="async">`;
const figure = (name, cls) => `<figure class="shot ${cls}">${imgTag(name)}<figcaption>${esc(IMG[name][1])}</figcaption></figure>`;

// ---- innstillinger og tester
const dc = L.defaultControl(), da = L.defaultAnom();
const defOf = (f) => (f.src === 'anom' ? da : dc)[f.k];
function defText(f) {
  const v = defOf(f);
  if (f.kind === 'flag') return v === false || v === '' ? 'Av' : 'På';
  if (v === '') return 'Av';
  return String(v) + (f.unit && f.kind !== 'time' ? ' ' + f.unit : '');
}
const fieldHelp = (f) => H.fields[f.src === 'anom' ? 'anom:' + f.k : f.k];
const ul = (a) => '<ul>' + a.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>';

function settingsHtml() {
  return L.SETTING_GROUPS.map((g) => {
    const gh = H.groups[g.id];
    const rows = g.fields.map((f) => {
      const h = fieldHelp(f);
      const tag = f.kind === 'flag' ? '<span class="tag">på/av</span>' : f.off ? '<span class="tag">kan slås av</span>' : '';
      const key = (f.label + ' ' + h.what + ' ' + h.tip + ' ' + h.ex).toLowerCase();
      return `<tr data-t="${esc(key)}"><td data-l="Innstilling"><strong>${esc(f.label)}</strong>${f.unit && f.kind !== 'flag' ? ' <small>' + esc(f.unit) + '</small>' : ''}</td><td data-l="Hva den gjør">${esc(h.what)}<small>Eksempel: ${esc(h.ex)}</small></td><td data-l="Standard" class="nw"><span class="def">${esc(defText(f))}</span> ${tag}</td><td data-l="Tips">${esc(h.tip)}</td></tr>`;
    }).join('');
    const wrows = g.weights.map((w) => {
      const label = w === 'Regel' ? 'Treff på egne regler' : w;
      return `<tr data-t="${esc((label + ' ' + H.weights[w]).toLowerCase())} poeng"><td data-l="Test"><strong>${esc(label)}</strong></td><td data-l="Utløses når">${esc(H.weights[w])}</td><td data-l="Standard" class="nw"><span class="def">${L.RISK_WEIGHTS[w]} poeng</span></td></tr>`;
    }).join('');
    const search = (g.title + ' ' + g.text + ' ' + gh.how + ' ' + gh.flags.join(' ')).toLowerCase();
    return `<section class="grp" id="set-${g.id}" data-t="${esc(search)}"><h3>${esc(g.title)}</h3><p>${esc(g.text)}</p>
<div class="meta"><div><b>Slik virker den</b>${esc(gh.how)}</div><div><b>Fanger</b>${gh.flags.map(esc).join('; ')}.</div><div><b>Vanlige uskyldige årsaker</b>${esc(gh.harmless)}</div><div><b>Krever</b>${esc(gh.needs)}</div></div>
${rows ? `<div class="tw"><table class="ref"><thead><tr><th>Innstilling</th><th>Hva den gjør</th><th>Standard</th><th>Tips</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
${wrows ? `<h4>Poeng i risikoscore</h4><div class="tw"><table class="ref"><thead><tr><th>Test</th><th>Utløses når</th><th>Standard</th></tr></thead><tbody>${wrows}</tbody></table></div>` : ''}</section>`;
  }).join('\n');
}

const DIA = { patterns: ['tSmall'], falseRet: ['tFalse', 'tFalse2'], afterSettle: ['tAfter'], deleted: ['tGap'], diff: ['tDiff'], numbers: ['tBenford'], pant: ['tPant'] };
const SCOPE_OF = { bong: ['Delvis', 'Bong'], patterns: ['Delvis', 'Bong'], falseRet: ['Ja', 'Bong'], afterSettle: ['Nei', 'Bong'], deleted: ['Nei', 'Bong'], diff: ['Ja (oppgjør)', 'Bong (oppgjør)'], numbers: ['Nei', 'Kasserer'], disc: ['Ja', 'Bong og kasserer'], pant: ['Ja', 'Bong'], hours: ['Nei', 'Bong'], profile: ['Delvis', 'Kasserer'], rules: ['Delvis', 'Bong'], ledger: ['Ja', 'Bong'], lapp: ['Ja', 'Bong og kasserer'], voids: ['Ja', 'Bong og kasserer'], special: ['Ja', 'Bong og kasserer'], ask: ['Ja', 'Bong og kasserer'], card: ['Ja (versjon 6)', 'Bong'], manual: ['Ja', 'Bong'], member: ['Nei', 'Bong'], price: ['Ja', 'Bong og kasserer'], ku: ['Ja', 'Bong'], events: ['Ja', 'Bong'] };

function testsHtml() {
  const overview = `<div class="tw"><table><thead><tr><th>Test</th><th>Finner</th><th>Krever skanning</th><th>Poeng til</th></tr></thead><tbody>${L.SETTING_GROUPS.map((g) => `<tr><td><a href="#test-${g.id}">${esc(g.title)}</a></td><td>${esc(H.groups[g.id].flags.join('; '))}</td><td>${SCOPE_OF[g.id][0]}</td><td>${SCOPE_OF[g.id][1]}</td></tr>`).join('')}</tbody></table></div>`;
  const each = L.SETTING_GROUPS.map((g) => {
    const gh = H.groups[g.id];
    return `<section id="test-${g.id}"><h4>${esc(g.title)}</h4><p>${esc(gh.how)}</p>${(DIA[g.id] || []).map((d) => D[d]()).join('')}<div class="tw"><table><tbody><tr><td class="nw"><strong>Fanger</strong></td><td>${gh.flags.map(esc).join('; ')}.</td></tr><tr><td class="nw"><strong>Vanlige uskyldige årsaker</strong></td><td>${esc(gh.harmless)}</td></tr><tr><td class="nw"><strong>Krever</strong></td><td>${esc(gh.needs)}</td></tr><tr><td class="nw"><strong>Innstillinger</strong></td><td><a href="#set-${g.id}">Alle innstillingene for denne testen</a></td></tr></tbody></table></div></section>`;
  }).join('\n');
  return overview + '\n' + each;
}

function ruleFieldsHtml() {
  const rows = Object.keys(L.RULE_FIELDS).map((k) => { const f = L.RULE_FIELDS[k]; return `<tr><td>${esc(f.label)}</td><td>${f.scan ? 'Ja' : 'Nei'}</td><td>${f.multi ? 'Liste: = betyr én av, inneholder, ≠ betyr ingen av' : 'Tall eller tekst'}</td></tr>`; }).join('');
  return `<div class="tw"><table><thead><tr><th>Felt</th><th>Krever skanning</th><th>Verdi</th></tr></thead><tbody>${rows}</tbody></table></div><p>Sammenligninger: ${L.RULE_OPS.map((o) => '<code>' + esc(o) + '</code>').join(' ')}.</p>`;
}

// ---- sett sammen
function body(src) {
  const date = new Date().toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' });
  return src
    .replace(/\{\{version\}\}/g, R.VERSION)
    .replace(/\{\{date\}\}/g, date)
    .replace(/\{\{annotated:([\w-]+)\}\}/g, (m, n) => `<div class="side">${figure(n, 'panel')}<div><h4>Forklaring</h4><ol class="legend">${LEGENDS[n].map((t) => '<li><span>' + t + '</span></li>').join('')}</ol></div></div>`)
    .replace(/\{\{shotm:([\w-]+)\}\}/g, (m, n) => figure(n, 'mid'))
    .replace(/\{\{shotw:([\w-]+)\}\}/g, (m, n) => figure(n, 'wide'))
    .replace(/\{\{shot:([\w-]+)\}\}/g, (m, n) => figure(n, 'panel'))
    .replace(/\{\{shots:([\w,-]+)\}\}/g, (m, l) => `<div class="shots">${l.split(',').map((n) => figure(n, 'panel')).join('')}</div>`)
    .replace(/\{\{fig:([\w-]+)\}\}/g, (m, n) => figure(n, 'wide'))
    .replace(/\{\{dia:(\w+)\}\}/g, (m, n) => { if (!D[n]) throw new Error('mangler diagram ' + n); return D[n](); })
    .replace(/\{\{tests\}\}/g, testsHtml)
    .replace(/\{\{settings\}\}/g, settingsHtml)
    .replace(/\{\{rulefields\}\}/g, ruleFieldsHtml);
}

const SCRIPT = `(function(){
  var q=document.getElementById('q'),n=document.getElementById('qn');
  if(q){q.addEventListener('input',function(){
    var t=q.value.trim().toLowerCase(),hits=0,groups=document.querySelectorAll('.grp');
    groups.forEach(function(g){
      var any=false,gm=!t||g.getAttribute('data-t').indexOf(t)!==-1;
      g.querySelectorAll('tbody tr').forEach(function(r){var m=!t||gm||r.getAttribute('data-t').indexOf(t)!==-1;r.hidden=!m;if(m)any=true;});
      g.hidden=!!t&&!any&&!gm;if(!g.hidden)hits++;
    });
    n.textContent=t?hits+' av '+groups.length+' grupper':'';
  });}
  var links=[].slice.call(document.querySelectorAll('.toc a')),hs=links.map(function(a){return document.getElementById(a.getAttribute('href').slice(1));});
  function spy(){var y=window.scrollY+120,cur=0;hs.forEach(function(h,i){if(h&&h.offsetTop<=y)cur=i;});links.forEach(function(a,i){a.classList.toggle('on',i===cur);});}
  if(links.length){window.addEventListener('scroll',spy,{passive:true});spy();}
})();`;

function page(artifact) {
  const src = fs.readFileSync(path.join(__dirname, 'manual.src.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
  const main = body(src);
  const toc = [];
  src.replace(/<h2 id="([\w-]+)"><span class="n">(\d+)<\/span>([^<]+)<\/h2>/g, (m, id, n, t) => { toc.push([id, n, t]); return m; });
  const tocHtml = toc.map((t) => `<li><a href="#${t[0]}"><span class="n">${t[1]}</span><span>${esc(t[2])}</span></a></li>`).join('');
  const inner = `<div class="wrap"><nav class="toc" aria-label="Innhold"><p class="brand">Kvitteringshenter</p><p class="ver">Brukerveiledning ${R.VERSION}</p><ol>${tocHtml}</ol></nav><main><details class="toc-m"><summary>Innhold</summary><ol>${tocHtml}</ol></details>${main}</main></div><script>${SCRIPT}</script>`;
  const title = 'Kvitteringshenter brukerveiledning';
  if (artifact) return `<title>${title}</title>\n<style>${css}</style>\n${inner}`;
  return `<!doctype html><html lang="nb"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${title}</title><style>${css}</style></head><body>${inner}</body></html>`;
}

// ---- PDF-variant: forside, innholdsfortegnelse med sidetall, ett kapittel per side
function pdfPage(pages) {
  pages = pages || {};
  const src = fs.readFileSync(path.join(__dirname, 'manual.src.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'pdf.css'), 'utf8');
  let main = body(src).replace(/ loading="lazy"/g, '').replace(/<details class="faq">/g, '<details class="faq" open>');
  const cut = main.indexOf('<h2 id="');
  const hero = main.slice(0, cut), rest = main.slice(cut);
  const toc = [];
  src.replace(/<h2 id="([\w-]+)"><span class="n">(\d+)<\/span>([^<]+)<\/h2>/g, (m, id, n, t) => { toc.push([id, n, t]); return m; });
  const subs = { 'kom-i-gang': 'Installere, oppdatere og første gang', panelet: 'Oversikt, arbeidsflyt og hva skanning er', faner: 'Hent, Filtrer, Skann, Analyse og Mer', analysen: 'Poeng, risikonivå, omfang og alle testene', rabatt: 'Rabattlinjer, årsaker og kuponger', revisjon: 'Lag, les og verifiser en revisjonsrapport', innstillinger: 'Alle innstillinger og poengvekter med standardverdier', verktoy: 'Egne regler, arbeidsoppgaver, notater og tastatur' };
  const tocHtml = `<section class="pdf-toc"><h2>Innhold</h2><ol>${toc.map((t) => `<li><a href="#${t[0]}"><span class="n">${t[1]}</span><span class="t">${esc(t[2])}</span><span class="dots"></span><span class="p">${pages[t[0]] || '00'}</span></a>${subs[t[0]] ? `<p class="sub">${esc(subs[t[0]])}</p>` : ''}</li>`).join('')}</ol></section>`;
  return `<!doctype html><html lang="nb"><head><meta charset="utf-8"><title>Kvitteringshenter brukerveiledning ${R.VERSION}</title><style>${css}</style></head><body class="pdf"><div class="cover"><div class="brandline"></div>${hero}<p class="coverdate">Laget ${new Date().toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' })}</p></div>${tocHtml}<div class="wrap"><main>${rest}</main></div></body></html>`;
}

if (require.main === module) {
  const artifact = process.argv.indexOf('--artifact') !== -1;
  const out = artifact ? process.argv[process.argv.indexOf('--artifact') + 1] : path.join(__dirname, '..', 'brukerveiledning.html');
  const html = page(artifact);
  fs.writeFileSync(out, html);
  console.log('skrev ' + out + ' (' + (html.length / 1048576).toFixed(1) + ' MB)');
}
module.exports = { page, pdfPage, IMG, LEGENDS };
