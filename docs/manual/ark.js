'use strict';
// Lager ett A4-ark (liggende): prosessen fra hent til rapport, og hva som plukker ut en kvittering. Bygges fra logic.js og help.js.
//   NODE_PATH=<mappe med playwright> node docs/manual/ark.js [utfil.pdf]
const fs = require('fs');
const path = require('path');
const L = require('../../extension/src/logic.js');
const R = require('../../extension/src/report.js');
const H = require('./help.js');
const B = require('./build.js');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const c = L.defaultControl(), a = L.defaultAnom();
const n = (v) => String(v).replace('.', ',');

// Kort vilkår per test med standardverdiene fra innstillingene. Må dekke alle poengvekter (test/docs.test.js sjekker det).
const SHORT = {
  'Stor panteretur': () => 'panteretur på bongen ≥ ' + a.bigReturn + ' kr',
  'Mange pantelapper': () => '≥ ' + a.manyLapper + ' pantelapper på bongen',
  'Kontant tilbake uten salg': () => 'bare pantelapper og kontant tilbake',
  'Rundt beløp': () => 'hel hundrelapp ≥ ' + a.roundMin + ' kr',
  'Kontant tilbake uten salg flere ganger': () => '≥ ' + c.cashNoSaleN + ' slike samme dag, samme kasse',
  'Retur uten salg': () => 'varen er ikke solgt i datagrunnlaget',
  'Kortkjøp refundert kontant': () => 'betalt med kort, refundert kontant',
  'Salg og retur av samme beløp': () => 'samme kasse, innen ' + c.saleReturnMin + ' min',
  'Salg etter kassaoppgjør': () => 'salg etter siste oppgjør (frist ' + c.settleGraceMin + ' min)',
  'Bongnummer og tid stemmer ikke': () => 'nummer i feil tidsrekkefølge',
  'Dobbelt bongnummer': () => 'samme nummer to ganger på kassen',
  'Løpenummer avviker fra tid': () => '≥ ' + c.seqRegMin + ' min fra naboene',
  'Avvikende sifferfordeling': () => 'første siffer mot Benford, MAD > ' + n(c.benfordMad),
  'Mange runde beløp': () => 'hele kroner ≥ ' + c.roundShare + ' % av totalene',
  'Avvikende siste siffer': () => 'siste siffer avviker fra de andre (p < ' + n(c.digitP) + ')',
  'Rabatt med overvåket årsak': () => 'rabatt med årsak ' + c.discWatch,
  'Mange rabatter med årsakskode': () => 'andel ≥ ' + n(c.profFactor) + '× butikksnittet, ≥ ' + c.discCashN + ' bonger',
  'Høy rabattprosent': () => 'rabatt ' + c.discHiFrom + '–' + c.discHiTo + ' % med årsakskode',
  'Rabatt uten treff på andre salg': () => '≥ ' + c.discMatchPct + ' %, ingen lik rabatt samme dag',
  'Medlem i flere butikker samtidig': () => 'samme medlemsnr innen ' + c.memberStoreMin + ' min',
  'Medlemsnr flere ganger samme dag': () => '≥ ' + c.memberDayN + ' bonger samme dag',
  'Medlemsnr brukt svært mye': () => '≥ ' + c.memberN + ' bonger totalt',
  'Medlemsnr nesten bare hos én kasserer': () => '≥ ' + c.memberCashN + ' bonger, > ' + c.memberCashShare + ' % hos én',
  'Ansatt-medlemsnr brukt': () => 'nummer fra ansattlisten',
  'Kasserer bruker eget medlemsnr': () => 'kassereren selv (ansattlisten)',
  'Avvikende pris på vare': () => '≥ ' + c.priceDevPct + ' % fra vanlig pris samme dag',
  'Mange avvikende priser': () => '≥ ' + c.priceCashN + ' linjer hos kassereren',
  'Hendelsesord på bong': () => 'ord fra din egen liste',
  'Manuell pantelapp': () => 'kode ' + c.lappManualCodes + ', ≥ ' + c.lappManualMin + ' kr',
  'Mange manuelle pantelapper': () => '≥ ' + c.lappManualN + ' bonger, over butikkens andel',
  'Pantelapp slettet': () => 'pantelapp og motlinje på bongen',
  'Pantelapp innløst flere ganger': () => 'samme lapp/sum innen ' + c.lappReuseMin + ' min',
  'Varelinjer slettet, pant utbetalt kontant': () => 'varer slettet, bare pant og kontant igjen',
  'Makulert vare ikke solgt på ny': () => 'ikke solgt igjen innen ' + c.voidResaleMin + ' min',
  'Mange makulerte varelinjer': () => '≥ ' + c.voidCashN + ' slettede linjer',
  'Spør pris avviker fra dagens salg': () => '≥ ' + c.askDevPct + ' % fra medianprisen',
  'Mange spør pris': () => '≥ ' + c.askN + ' bonger',
  'Gjentatte returer på samme kort': () => '≥ ' + c.cardRetN + ' innen ' + c.cardRetDays + ' dager',
  'Manuell kvittering matcher annen bong': () => 'samme beløp innen ' + c.manualDays + ' dager',
  'Bonger i rask rekkefølge': () => '≥ ' + c.paceN + ' bonger, ≤ ' + c.paceSec + ' s mellom',
  'Mange 0-kr-bonger': () => '≥ ' + c.zeroN + ' bonger på 0 kr',
  'Overvåket vare i retur': () => 'vare fra din liste som retur',
  'Overvåket vare slettet': () => 'vare fra din liste slettet',
  'Mange overvåkede varer hos kasserer': () => '≥ ' + c.watchN + ' bonger, over butikkens andel',
  'Retur av vare uten kjøp på kortet': () => 'kortet har ikke kjøpt varen (' + c.retEanDays + ' dager)',
  'Retur av vare uten kjøp av medlemmet': () => 'medlemmet har ikke kjøpt varen',
  'Retur av vare uten salg samme dag': () => 'uten kort/medlem, ikke solgt samme dag (av)',
  'Vare returnert flere ganger': () => 'allerede returnert like mange som kjøpt',
  'Retur over kjøpt antall': () => 'flere stk enn kjøpt på kvitteringen',
  'Retur til høyere pris enn kjøpt': () => 'mer enn betalt, toleranse ' + n(c.retKvTol) + ' kr',
  'Vare ikke på kvitteringen': () => 'varen står ikke på kjøpet',
  'Retur over kjøpt antall på kortet': () => 'kortet, siste ' + c.retKvIdent + ' dager',
  'Retur over kjøpt antall for medlemmet': () => 'medlemmet, siste ' + c.retKvIdent + ' dager',
  'Mange returer mot kvittering med avvik': () => '≥ ' + c.retKvCashN + ' returbonger med avvik',
  'Topptekst stemmer ikke med listen': () => 'kasserer, kasse eller medlem er et annet enn i listen',
  'Samme autorisasjonskode på flere bonger': () => 'samme terminal og kode',
  'Transaksjoner utenfor åpningstid': () => 'før ' + c.openFrom + ' eller etter ' + c.openTo,
  'Retur utenfor åpningstid': () => 'returer før ' + c.openFrom + ' eller etter ' + c.openTo,
  'Regel': () => 'bongen treffer en av dine regler'
};

const STEPS = [
  ['Hent', 'Kvitteringslisten hentes fra Lindbak. Pluginen leser bare siden og gridet; ingen kall mot Lindbaks API.'],
  ['Skann', 'Hver bong åpnes i visningsfeltet og leses: linjer, pant, rabatt, betaling, kort, referanser og topptekst. Lagres bare i nettleseren.'],
  ['Kjør analyse', 'Velg omfang (periode, butikk, kasserer, kasse). Først avvik per bong, så kontroller på tvers av bonger og kasserere.'],
  ['Poeng', 'Hver test som slår til gir poeng. Samme forhold teller bare én gang. Summen er risikoscoren.'],
  ['Sjekk først', 'Rangert liste. Hver bong forklarer hver årsak. «Juster» åpner riktig innstilling, «Velg» tar bongen med videre.'],
  ['Dokumenter', 'Notat og status per bong. Revisjonsrapport (ZIP) med funn, bevis-PNG, innstillinger og kontrollsummer.']
];

function card(g) {
  const gh = H.groups[g.id], scope = B.SCOPE_OF[g.id];
  const rows = g.weights.map((w) => {
    if (!SHORT[w]) throw new Error('mangler kort vilkår for «' + w + '»');
    const k = /poeng til kassereren/.test(H.weights[w] || '');
    return `<div class="r${k ? ' k' : ''}"><span class="t"><b>${esc(w === 'Regel' ? 'Dine egne regler' : w)}</b> <i>${esc(SHORT[w]())}</i></span><span class="p">${L.RISK_WEIGHTS[w]}${k ? '<em>K</em>' : ''}</span></div>`;
  }).join('');
  return `<section class="card"><h3>${esc(g.title)}<small>${scope[0] === 'Nei' ? '' : scope[0] === 'Delvis' ? 'delvis skanning' : 'skanning'}</small></h3>${rows}</section>`;
}

function html(size) {
  const groups = L.SETTING_GROUPS.filter((g) => g.weights.length);
  const steps = STEPS.map((s, i) => `<div class="s"><div class="h"><span>${i + 1}</span>${esc(s[0])}</div><p>${esc(s[1])}</p></div>`).join('<div class="ar">›</div>');
  const css = `
@page{size:A4 landscape;margin:7mm}
*{box-sizing:border-box}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font:${size}pt/1.28 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#17231d}
.top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #00704a;padding-bottom:3px;margin-bottom:5px}
h1{font-size:15pt;margin:0;color:#00704a}.top .v{font-size:7pt;color:#556860;text-align:right}
.flow{display:flex;align-items:stretch;gap:3px;margin-bottom:5px}
.flow .s{flex:1;border:1px solid #9fc2b2;border-radius:5px;background:#f2f8f5;padding:3px 5px}
.flow .h{font-weight:700;font-size:${size + 1}pt;color:#00704a;margin-bottom:1px}.flow .h span{display:inline-block;background:#00704a;color:#fff;border-radius:50%;width:12pt;height:12pt;line-height:12pt;text-align:center;font-size:7pt;margin-right:4px}
.flow p{margin:0;font-size:${size - 0.4}pt}.flow .ar{align-self:center;color:#00704a;font-size:16pt;font-weight:700}
.how{display:grid;grid-template-columns:1.1fr 1fr 1fr 1fr;gap:5px;margin-bottom:5px}
.how div{border:1px solid #d5ddd9;border-radius:5px;padding:3px 5px;background:#fff}.how b{display:block;color:#00704a;margin-bottom:1px}
.how .lv{display:flex;gap:3px;margin:2px 0}.how .lv span{flex:1;text-align:center;border-radius:3px;padding:1px 0;font-weight:700;font-size:${size - 0.3}pt}
.lo{background:#e6f3ec;color:#175b3a}.mi{background:#fff1cc;color:#7a5200}.hi{background:#fbdada;color:#9a1c1c}
.grid{column-count:3;column-gap:6px}
.card{break-inside:avoid;border:1px solid #d5ddd9;border-radius:4px;margin:0 0 4px;padding:2px 4px 3px;background:#fff}
.card h3{margin:0 0 1px;font-size:${size + 0.4}pt;color:#fff;background:#00704a;margin:-2px -4px 2px;padding:1px 4px;border-radius:3px 3px 0 0;display:flex;justify-content:space-between}
.card h3 small{font-weight:400;font-size:${size - 1.2}pt;opacity:.85}
.r{display:flex;justify-content:space-between;gap:4px;border-bottom:1px dotted #d5ddd9;padding:.4px 0}.r:last-child{border-bottom:0}
.r .t i{font-style:normal;color:#556860}.r .p{white-space:nowrap;font-weight:700;color:#00704a}.r .p em{font-style:normal;font-size:${size - 1.4}pt;background:#fff1cc;color:#7a5200;border-radius:2px;padding:0 2px;margin-left:2px}
.foot{margin-top:2px;font-size:${size - 1}pt;color:#556860}`;
  return `<!doctype html><html lang="nb"><head><meta charset="utf-8"><title>Hva plukker ut en kvittering? – Kvitteringshenter ${R.VERSION}</title><style>${css}</style></head><body>
<div class="top"><h1>Hva plukker ut en kvittering?</h1><div class="v">Kvitteringshenter ${R.VERSION} · funn er indikasjoner som må vurderes, ikke bevis</div></div>
<div class="flow">${steps}</div>
<div class="how">
<div><b>En bong plukkes ut når minst én test slår til</b>Tallene under er standardverdiene og poengene (justerbare under Mer → Innstillinger). Tom verdi slår en test av. Tester merket <i>skanning</i> krever at bongen er skannet. Retur uten salg, retur av vare uten kjøp, retur mot kvittering via kort/medlem og makulert vare trenger dessuten minst 80 % av salgene skannet.</div>
<div><b>Poeng og nivå</b>Poengene for alle tester som slår til legges sammen.<div class="lv"><span class="lo">Lav 0–3</span><span class="mi">Middels 4–7</span><span class="hi">Høy fra 8</span></div>RRS 0–100 = 100·(1 − 2<sup>−poeng/8</sup>), så 8 poeng = 50.</div>
<div><b>Samme forhold teller én gang</b>Måler flere tester det samme, teller bare den høyeste: pant og kontant tilbake · rabatt · pris · etter stengetid · retur av vare · sletting · medlemsbruk. De andre vises overstrøket.</div>
<div><b><em style="font-style:normal;background:#fff1cc;color:#7a5200;border-radius:2px;padding:0 3px">K</em> = funn på kassereren</b>Gir poeng til kassereren i rangeringen av kasserere, ikke til bongene. Kassererprofil (returandel, snittbeløp, pantelapper og korrigeringer per salg, ≥ ${n(c.profFactor)}× butikksnittet) gir 2 poeng per avvik.</div>
</div>
<div class="grid">${groups.map(card).join('')}</div>
<div class="foot">Ikke med: rabatt uten årsak, kuponger og bonger under grensene. Bonger som ikke er skannet ses ikke av tester som leser innholdet. «Poeng» = standard; endre under Mer → Innstillinger. Se «Slik setter du innstillinger» for alle innstillingene.</div>
</body></html>`;
}

module.exports = { html, SHORT };

if (require.main === module) {
  const { chromium } = require('playwright');
  const { execFileSync } = require('child_process');
  const out = process.argv[2] || path.join(__dirname, '..', 'Kvitteringshenter-hva-plukkes-ut.pdf');
  (async () => {
    const browser = await chromium.launch();
    let done = false;
    for (const size of [7.4, 7.1, 6.8, 6.5, 6.2, 5.9]) {
      const page = await browser.newPage();
      await page.emulateMedia({ media: 'print', colorScheme: 'light' });
      await page.setContent(html(size), { waitUntil: 'load' });
      await page.pdf({ path: out, format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true });
      await page.close();
      const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [out]).toString())[1]);
      if (pages === 1) { console.log('skrev ' + out + ' (1 side, skrift ' + size + ' pt)'); done = true; break; }
    }
    await browser.close();
    if (!done) throw new Error('fikk ikke plass på ett ark');
  })().catch((e) => { console.error(e); process.exit(1); });
}
