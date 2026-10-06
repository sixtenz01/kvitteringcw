'use strict';
// Diagrammene i brukerveiledningen. Ren SVG uten script og stil: farger kommer fra klasser i siden (d-*),
// slik at de følger lys og mørk drakt. Hver figur har role="img" og en beskrivelse.

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
let uid = 0;

function svg(w, h, label, inner, id) {
  const m = 'arr' + (id || ++uid);
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}" class="dia"><defs><marker id="${m}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="d-arrow"/></marker></defs>${inner(m)}</svg>`;
}
const fig = (s, caption) => `<figure class="fig">${s}<figcaption>${caption}</figcaption></figure>`;
const text = (x, y, t, o) => { o = o || {}; return `<text x="${x}" y="${y}" class="d-text${o.cls ? ' ' + o.cls : ''}" text-anchor="${o.anchor || 'start'}" font-size="${o.size || 12}"${o.bold ? ' font-weight="700"' : ''}>${esc(t)}</text>`; };
const rect = (x, y, w, h, cls, rx) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx === undefined ? 8 : rx}" class="${cls}"/>`;
const line = (x1, y1, x2, y2, o) => { o = o || {}; return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${o.cls || 'd-line'}"${o.dash ? ' stroke-dasharray="4 3"' : ''}${o.arrow ? ` marker-end="url(#${o.arrow})"` : ''}/>`; };
const lines = (arr) => arr.join('');

// ---- arbeidsflyt -----------------------------------------------------------------
function flow() {
  const steps = [['Hent', 'søk i hele journalen (CW)', 'Hent-fanen'], ['Filtrer', 'snevre inn listen', 'Filtrer-fanen'], ['Skann', 'les innholdet i bongene', 'Skann-fanen'], ['Analyse', 'kjør testene, se funn', 'Analyse-fanen'], ['Rapport', 'dokumenter og eksporter', 'Mer-fanen']];
  return fig(svg(780, 124, 'Arbeidsflyt i fem steg: Hent, Filtrer, Skann, Analyse, Rapport', (m) => {
    let o = '';
    steps.forEach((s, i) => {
      const x = 8 + i * 154;
      o += rect(x, 14, 134, 70, i === 3 ? 'd-acc' : 'd-box');
      o += text(x + 67, 40, s[0], { anchor: 'middle', bold: true, size: 15 });
      o += text(x + 67, 60, s[1], { anchor: 'middle', cls: 'd-muted', size: 11 });
      o += text(x + 67, 106, s[2], { anchor: 'middle', cls: 'd-muted', size: 11 });
      if (i < 4) o += line(x + 136, 49, x + 152, 49, { arrow: m });
    });
    return o;
  }, 'flow'), 'Du kan hoppe over steg. Filtrer og Skann trengs ikke for å kjøre analysen (den skanner det som mangler), men de gir deg kontroll over hva som analyseres.');
}

// ---- hva skanningen leser --------------------------------------------------------
function scan() {
  const rows = [
    [38, '7071862047727 LINEA GAVEBÅND 20M', '4.36'], [56, '   Rabatt: Kr 4.36 (50.0%)', ''], [74, '   Rabatt årsak:', ''], [94, '5712 APPELSIN', '28.41'],
    [114, '220 PANT', '2.00'], [138, 'Totalt', '72.77'], [158, 'Coopay:', '72.77'], [178, 'Kupong (1ESD2P6DRVPCCJY1 - Gruppe - Coop koppnudler):', '0.00']
  ];
  const tags = [[38, 'Varelinje og beløp'], [65, 'Rabatt, prosent og årsak'], [114, 'Pant (220 PANT og 399 PANTELAPP)'], [158, 'Betalingsmåte'], [178, 'Kupong (kampanje)']];
  return fig(svg(780, 220, 'En kvittering med varelinjer, rabatt, pant, betaling og kupong, og hva pluginen leser fra hver linje', (m) => {
    let o = rect(8, 8, 430, 196, 'd-box', 6);
    rows.forEach((r) => { o += text(20, r[0] + 4, r[1], { cls: 'd-mono', size: 11 }); if (r[2]) o += text(426, r[0] + 4, r[2], { anchor: 'end', cls: 'd-mono', size: 11 }); });
    tags.forEach((t, i) => {
      const y = 22 + i * 38;
      o += rect(540, y - 14, 232, 28, 'd-acc', 6) + text(656, y + 5, t[1], { anchor: 'middle', size: 12 });
      o += line(440, t[0], 538, y, { arrow: m });
    });
    return o;
  }, 'scan'), 'Kvitteringen er tekst i Lindbak. Pluginen kjenner igjen disse linjetypene og lagrer dem lokalt. Alt annet (for eksempel MVA-tabellen) hoppes over.');
}

// ---- poeng og risikonivå ---------------------------------------------------------
function scoring() {
  const rs = [['Stor panteretur', 3], ['Mange pantelapper', 3], ['Kontant tilbake uten salg', 4]];
  return fig(svg(780, 232, 'Tre avvik på en bong gir 3 + 3 + 4 = 10 poeng, som er høy risiko', (m) => {
    let o = rect(8, 20, 190, 120, 'd-box') + text(20, 44, 'Bong 1001-2-2371', { bold: true }) + text(20, 64, 'Kasse 2 · kasserer 4103', { cls: 'd-muted', size: 11 }) + text(20, 84, '8 pantelapper à 40,00', { cls: 'd-muted', size: 11 }) + text(20, 104, 'Kontant tilbake 320,00', { cls: 'd-muted', size: 11 }) + text(20, 128, 'Sum −320,00 kr', { bold: true });
    rs.forEach((r, i) => {
      const y = 22 + i * 44;
      o += rect(280, y, 250, 34, 'd-acc') + text(292, y + 22, r[0]) + text(518, y + 22, '+' + r[1], { anchor: 'end', bold: true });
      o += line(200, 80, 278, y + 17, { arrow: m });
      o += line(532, y + 17, 590, 80, { arrow: m });
    });
    o += rect(592, 48, 180, 64, 'd-bad') + text(682, 74, 'Risikoscore 10', { anchor: 'middle', bold: true, size: 15 }) + text(682, 96, 'høy risiko', { anchor: 'middle', size: 12 });
    // skala
    o += text(8, 176, 'Risikonivå', { bold: true, size: 11 });
    const segs = [['Lav 0–3', 0, 4, 'd-ok'], ['Middels 4–7', 4, 8, 'd-warn'], ['Høy 8 og over', 8, 12, 'd-bad']];
    segs.forEach((s) => { o += rect(8 + s[1] * 56, 186, (s[2] - s[1]) * 56, 26, s[3], 0) + text(8 + (s[1] + s[2]) * 28, 204, s[0], { anchor: 'middle', size: 12 }); });
    o += `<polygon points="${8 + 10 * 56},180 ${8 + 10 * 56 - 6},170 ${8 + 10 * 56 + 6},170" class="d-pointer"/>` + text(8 + 10 * 56, 166, '10', { anchor: 'middle', bold: true, size: 11 });
    return o;
  }, 'scoring'), 'Hver test har et antall poeng (du kan endre dem under Innstillinger). En bong får poeng for hver test den utløser. Summen er risikoscoren, og den bestemmer rekkefølgen i «Sjekk først».');
}

// ---- omfang, datagrunnlag og filter ----------------------------------------------
function scope() {
  return fig(svg(780, 262, 'Tre nivåer: hele listen, datagrunnlaget i valgte butikker, og omfanget som analyseres', () => {
    let o = rect(8, 8, 764, 246, 'd-box', 12) + text(24, 32, 'Alle bonger i CW-listen (det du har hentet)', { bold: true });
    o += rect(28, 48, 724, 192, 'd-soft', 10) + text(44, 72, 'Datagrunnlag: alle bonger i valgte butikker', { bold: true });
    o += text(44, 90, 'Brukes av tester som trenger hele bildet: hull i bongnummer, salg etter kassaoppgjør, retur uten salg', { cls: 'd-muted', size: 11 });
    o += rect(48, 106, 460, 120, 'd-acc', 8) + text(64, 130, 'Omfang: det analysen flagger og rapporterer', { bold: true });
    o += text(64, 150, 'Periode, butikk, kasserer og kasse du velger', { size: 12 }) + text(64, 168, 'under «Velg omfang» i Sjekk først', { size: 12 }) + text(64, 196, 'Funn utenfor omfanget vises ikke.', { cls: 'd-muted', size: 11 });
    o += rect(528, 106, 208, 120, 'd-box', 8) + text(542, 130, 'Filter i listen', { bold: true }) + text(542, 150, 'Teller bare med hvis du huker', { size: 11 }) + text(542, 166, '«Bruk også filtrene i listen»', { size: 11 }) + text(542, 196, 'Ellers uavhengig av omfanget.', { cls: 'd-muted', size: 11 });
    return o;
  }, 'scope'), 'Omfanget bestemmer hvilke bonger som kan få funn. Datagrunnlaget er det testene sammenligner mot, slik at et omfang på én kasserer ikke gir falske hull i bongnummer.');
}

// ---- tidslinje --------------------------------------------------------------------
function timeline(o) {
  // o: {w, from, to (minutter), ticks:[min], marks:[{m,label,cls,row}], bands:[{from,to,label,cls}], caption, label}
  const W = o.w || 780, X0 = 30, X1 = W - 30, y = 96;
  const px = (m) => X0 + (m - o.from) / (o.to - o.from) * (X1 - X0);
  return svg(W, 196, o.label, (mk) => {
    let s = '';
    (o.bands || []).forEach((b) => { s += rect(px(b.from), y - 34, px(b.to) - px(b.from), 68, b.cls || 'd-soft', 4) + text((px(b.from) + px(b.to)) / 2, y + 90, b.label, { anchor: 'middle', cls: 'd-muted', size: 11 }) + line(px(b.from), y + 78, px(b.to), y + 78, { cls: 'd-line-thin' }); });
    s += line(X0, y, X1, y);
    (o.ticks || []).forEach((t) => { s += line(px(t), y - 4, px(t), y + 4) + text(px(t), y + 22, String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'), { anchor: 'middle', cls: 'd-muted', size: 11 }); });
    (o.marks || []).forEach((k) => {
      const x = px(k.m), up = k.row === 'up';
      s += `<circle cx="${x}" cy="${y}" r="${k.big ? 7 : 5}" class="${k.cls || 'd-dot'}"/>`;
      s += line(x, up ? y - 8 : y + 28, x, up ? y - 28 : y + 48, { cls: 'd-line-thin' });
      s += text(x, up ? y - 32 : y + 62, k.label, { anchor: 'middle', size: 11, bold: !!k.bold });
    });
    return s;
  }, o.id);
}

const tm = (h, m) => h * 60 + m;
function tSmall() {
  return fig(timeline({ id: 'tsmall', label: 'Tre små returer på kasse 2 mellom 21:22 og 21:51, i timen før stengetid kl 22:00', from: tm(20, 30), to: tm(22, 20), ticks: [tm(21, 0), tm(21, 30), tm(22, 0)], bands: [{ from: tm(21, 0), to: tm(22, 0), label: 'siste 60 min før stenging', cls: 'd-warnsoft' }],
    marks: [{ m: tm(21, 22), label: 'retur −39,90', cls: 'd-baddot', row: 'down' }, { m: tm(21, 38), label: 'retur −31,90', cls: 'd-baddot', row: 'up' }, { m: tm(21, 51), label: 'retur −20,50', cls: 'd-baddot', row: 'down' }, { m: tm(22, 0), label: 'stenger 22:00', cls: 'd-dot', row: 'up', bold: true }] }),
  'Tre returer på hver under 100 kr, alle i timen før stenging på samme kasse. Grensene styres av «Små returer før stenging»-innstillingene.');
}
function tFalse() {
  return fig(timeline({ id: 'tfalse', label: 'Salg på 40 kr kl 10:05 og retur av samme beløp kl 10:25 på samme kasse, innen 60 minutter', from: tm(9, 45), to: tm(11, 30), ticks: [tm(10, 0), tm(10, 30), tm(11, 0)], bands: [{ from: tm(10, 5), to: tm(11, 5), label: 'innen 60 min', cls: 'd-warnsoft' }],
    marks: [{ m: tm(10, 5), label: 'Salg 40,00 · Bank', cls: 'd-dot', row: 'up' }, { m: tm(10, 25), label: 'Retur −40,00 · kontant tilbake', cls: 'd-baddot', row: 'down' }] }),
  'Salg og retur av samme beløp på samme kasse kort tid etter hverandre. Hvis salget var betalt med kort og returen utbetales kontant, flagges «Kortkjøp refundert kontant» i tillegg.');
}
function tAfter() {
  return fig(timeline({ id: 'tafter', label: 'To salg kl 22:12 og 22:20 på en kasse som hadde kassaoppgjør kl 21:58', from: tm(20, 30), to: tm(22, 40), ticks: [tm(21, 0), tm(21, 30), tm(22, 0), tm(22, 30)], bands: [{ from: tm(21, 58), to: tm(22, 40), label: 'etter kassaoppgjør', cls: 'd-badsoft' }],
    marks: [{ m: tm(21, 10), label: 'salg', cls: 'd-dot', row: 'down' }, { m: tm(21, 40), label: 'salg', cls: 'd-dot', row: 'down' }, { m: tm(21, 58), label: 'Kassaoppgjør 21:58', cls: 'd-dot', row: 'up', big: true, bold: true }, { m: tm(22, 12), label: 'salg 89,90', cls: 'd-baddot', row: 'down' }, { m: tm(22, 20), label: 'salg 45,00', cls: 'd-baddot', row: 'up' }] }),
  'Et kassaoppgjør skal avslutte dagen på kassen. Salg etter siste oppgjør (utover fristen) flagges. Oppgjør før åpningstid regnes som forrige dags avslutning.');
}

function tGap() {
  return fig(svg(780, 128, 'Bongnummer 2121 til 2123, så 2130: seks bonger mangler', () => {
    let o = '';
    [['2121', 0], ['2122', 1], ['2123', 2]].forEach((b) => { o += rect(20 + b[1] * 84, 30, 72, 40, 'd-box') + text(56 + b[1] * 84, 56, b[0], { anchor: 'middle', cls: 'd-mono' }); });
    o += rect(280, 30, 270, 40, 'd-badsoft') + text(415, 50, '2124–2129 mangler', { anchor: 'middle', bold: true }) + text(415, 64, '6 bonger', { anchor: 'middle', size: 11, cls: 'd-muted' });
    o += rect(570, 30, 72, 40, 'd-box') + text(606, 56, '2130', { anchor: 'middle', cls: 'd-mono' });
    o += text(20, 102, 'Bongnummer går opp med én for hver kvittering på en kasse. Et hull kan bety slettede bonger, men også at listen er filtrert.', { size: 11, cls: 'd-muted' });
    return o;
  }, 'tgap'), 'Hull opp til grensen «Størst hull som regnes som slettede bonger» flagges. Større hull hoppes over fordi de nesten alltid skyldes filtrering.');
}

function tDiff() {
  const bars = [['29.09', -40], ['30.09', -35], ['01.10', -60], ['—', 0]];
  return fig(svg(780, 220, 'Kassadifferanse per kassaoppgjør for kasserer 4103: minus 40, 35 og 60 kroner på tre dager', () => {
    let o = '';
    const y0 = 70, sc = 1.1;
    o += line(60, y0, 700, y0) + text(52, y0 + 4, '0', { anchor: 'end', cls: 'd-muted', size: 11 }) + text(52, y0 + 60 * sc + 4, '−60', { anchor: 'end', cls: 'd-muted', size: 11 });
    o += line(60, y0 + 40 * sc, 700, y0 + 40 * sc, { dash: true, cls: 'd-line-thin' });
    [['29.09', -40], ['30.09', -35], ['01.10', -60]].forEach((b, i) => {
      const x = 110 + i * 150;
      o += rect(x, y0, 60, -b[1] * sc, 'd-bad', 3) + text(x + 30, y0 + (-b[1]) * sc + 16, '−' + (-b[1]), { anchor: 'middle', bold: true, size: 12 }) + text(x + 30, y0 - 8, b[0], { anchor: 'middle', cls: 'd-muted', size: 11 });
    });
    o += rect(580, 40, 190, 92, 'd-acc') + text(675, 66, '3 oppgjør med minus', { anchor: 'middle', bold: true }) + text(675, 86, 'fordelt på 3 dager', { anchor: 'middle', size: 12 }) + text(675, 108, 'samlet −135 kr', { anchor: 'middle', size: 12 }) + text(675, 124, 'flagges som gjentatt', { anchor: 'middle', size: 11, cls: 'd-muted' });
    o += text(20, 190, 'Flagges ved minst «Minus i minst» oppgjør på minst to dager, eller når samlet minus passerer «Eller minus totalt over».', { size: 11, cls: 'd-muted' });
    return o;
  }, 'tdiff'), 'Enkeltdifferanser kan ha mange uskyldige årsaker. Gjentatte minus for samme kasserer eller kasse over flere dager er det testen leter etter.');
}

function tBenford() {
  const exp = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => Math.log10(1 + 1 / d));
  const act = [0.12, 0.08, 0.1, 0.09, 0.18, 0.17, 0.14, 0.07, 0.05];
  return fig(svg(780, 232, 'Første siffer i totalbeløp: forventet fordeling etter Benfords lov mot en avvikende fordeling', () => {
    let o = '';
    const x0 = 56, y0 = 180, H = 130, sc = H / 0.35;
    [0, 0.1, 0.2, 0.3].forEach((v) => { o += line(x0, y0 - v * sc, 700, y0 - v * sc, { cls: 'd-grid' }) + text(x0 - 6, y0 - v * sc + 4, Math.round(v * 100) + ' %', { anchor: 'end', cls: 'd-muted', size: 10 }); });
    exp.forEach((e, i) => {
      const x = x0 + 14 + i * 70;
      o += rect(x, y0 - e * sc, 22, e * sc, 'd-bar-exp', 2) + rect(x + 24, y0 - act[i] * sc, 22, act[i] * sc, 'd-bar-act', 2) + text(x + 23, y0 + 16, String(i + 1), { anchor: 'middle', size: 12 });
    });
    o += rect(560, 20, 14, 10, 'd-bar-exp', 2) + text(580, 29, 'forventet (Benford)', { size: 11 }) + rect(560, 38, 14, 10, 'd-bar-act', 2) + text(580, 47, 'faktisk', { size: 11 });
    return o;
  }, 'tbenford'), 'I naturlige beløp er 1 det vanligste første sifferet (30 %). Hvis for eksempel 5, 6 og 7 dominerer, kan det skyldes konstruerte eller tilpassede beløp. Avviket måles som MAD, og testen trenger mange bonger for å si noe.');
}

function tDisc() {
  return fig(svg(780, 236, 'Rabattlinje uten årsak, rabattlinje med årsak og kupong på en kvittering', () => {
    let o = rect(8, 8, 410, 214, 'd-box', 6);
    const rows = [[34, '7071862047727 LINEA GAVEBÅND 20M', '4.36'], [54, '   Rabatt: Kr 4.36 (50.0%)', ''], [74, '   Rabatt årsak:', ''], [102, '7044610877488 PEPSI MAX 0.5L', '26.32'], [122, '   Rabatt: Kr 6.58 (20.0%)', ''], [142, '   Rabatt årsak: Datovare', ''], [172, 'Kupong (1ESD2P6D… - Gruppe - Coop koppnudler):', '0.00']];
    rows.forEach((r) => { o += text(20, r[0] + 4, r[1], { cls: 'd-mono', size: 11 }) + (r[2] ? text(406, r[0] + 4, r[2], { anchor: 'end', cls: 'd-mono', size: 11 }) : ''); });
    const tags = [[64, 'Rabatt uten årsak (50 %)', 'd-badsoft'], [132, 'Rabatt med årsak: Datovare', 'd-acc'], [172, 'Kupong: kampanje knyttet til bongen', 'd-box']];
    tags.forEach((t) => { o += rect(498, t[0] - 15, 270, 30, t[2], 6) + text(633, t[0] + 5, t[1], { anchor: 'middle', size: 12 }) + line(420, t[0], 496, t[0], { cls: 'd-line-thin' }); });
    o += text(498, 214, 'Beløpet på varelinjen er etter rabatt.', { size: 11, cls: 'd-muted' });
    return o;
  }, 'tdisc'), 'Rabatt uten årsak betyr at ingen rabattårsak ble valgt. Kupong-linjer har ofte beløp 0,00, så de viser at en kampanje er knyttet til bongen, ikke nødvendigvis at den ble innløst.');
}

function tFalse2() {
  return fig(svg(780, 190, 'Retur uten salg: varen returneres, men ingen bong i datagrunnlaget har solgt den', () => {
    let o = rect(8, 12, 330, 150, 'd-box') + text(24, 36, 'Salg i datagrunnlaget', { bold: true });
    ['COOP FROKOSTEGG 6PK', 'PEPSI MAX 0.5L', 'KAFFE 500G', 'BIOLA JORDBÆR 1000G'].forEach((t, i) => { o += text(24, 62 + i * 24, '• ' + t, { size: 12 }); });
    o += rect(430, 40, 340, 80, 'd-badsoft') + text(446, 66, 'Retur: UKJENT VARE −50,00', { bold: true }) + text(446, 88, 'finnes ikke blant salgene', { size: 12 }) + text(446, 106, '→ «Retur uten salg»', { size: 12, bold: true });
    o += line(340, 80, 428, 80, { dash: true, cls: 'd-line-thin' }) + text(384, 72, '?', { anchor: 'middle', bold: true, size: 16 });
    return o;
  }, 'tfalse2'), 'Testen vurderes bare når minst 80 % av salgene i datagrunnlaget er skannet. Ellers ville retur av varer kjøpt før perioden gitt falske treff.');
}

function tPant() {
  return fig(svg(780, 176, 'Fire bonger med bare pantelapper og kontant tilbake på samme kasse, to av dem med samme beløp samme dag', () => {
    let o = '';
    [['29.09', '150,00', false], ['30.09', '150,00', true], ['30.09', '150,00', true], ['01.10', '320,00', false]].forEach((b, i) => {
      const x = 8 + i * 190;
      o += rect(x, 14, 176, 100, b[2] ? 'd-badsoft' : 'd-box') + text(x + 12, 38, b[0] + ' · kasse 2', { bold: true, size: 12 }) + text(x + 12, 58, 'bare pantelapper', { size: 11, cls: 'd-muted' }) + text(x + 12, 78, 'Kontant tilbake', { size: 11, cls: 'd-muted' }) + text(x + 12, 100, b[1], { bold: true, size: 14 });
    });
    o += text(8, 146, 'Fire slike bonger på én kasse: «Kontant tilbake uten salg flere ganger». Samme beløp to ganger samme dag på kassen: «Pantelapp innløst flere ganger».', { size: 11, cls: 'd-muted' });
    return o;
  }, 'tpant'), 'Pantelapper kan stamme fra flasker kjøpt andre steder, så en enkelt retur er normal. Det er gjentakelsen som er mønsteret.');
}

// ---- rapportpakken ---------------------------------------------------------------
function zip() {
  const files = [['rapport.html', 'rapporten du leser og skriver ut'], ['KONTROLLSUM.txt', 'SHA-256 for hver fil'], ['innstillinger.json', 'terskler og poeng som ble brukt'], ['data/kvitteringer.csv', 'alle bonger i datagrunnlaget'], ['data/innhold.json', 'skannet bonginnhold'], ['data/funn.csv', 'alle funn'], ['data/flaggede_bonger.csv', 'rangerte bonger'], ['bevis/01_….png', 'bilde av hver høyt rangert bong']];
  return fig(svg(780, 290, 'Innholdet i revisjonsrapportens ZIP-fil og hvordan kontrollsummene brukes', (m) => {
    let o = rect(8, 8, 410, 270, 'd-box', 8) + text(24, 32, 'revisjonsrapport_20261002_1409.zip', { bold: true, cls: 'd-mono', size: 12 });
    files.forEach((f, i) => { o += text(32, 62 + i * 26, f[0], { cls: 'd-mono', size: 12 }) + text(230, 62 + i * 26, f[1], { cls: 'd-muted', size: 11 }); });
    o += rect(470, 20, 300, 64, 'd-acc') + text(620, 46, 'sha256sum -c KONTROLLSUM.txt', { anchor: 'middle', cls: 'd-mono', size: 12 }) + text(620, 68, 'alle filer skal gi OK', { anchor: 'middle', size: 12 });
    o += line(420, 70, 468, 52, { arrow: m });
    o += rect(470, 112, 300, 64, 'd-box') + text(620, 138, 'Kontrollsum for ZIP-filen', { anchor: 'middle', bold: true }) + text(620, 158, 'vises i panelet og lagres i loggen', { anchor: 'middle', size: 12 });
    o += rect(470, 204, 300, 64, 'd-box') + text(620, 230, 'Noter den i saken', { anchor: 'middle', bold: true }) + text(620, 250, 'kan ikke ligge i selve filen', { anchor: 'middle', size: 12 });
    o += line(620, 178, 620, 202, { arrow: m });
    return o;
  }, 'zip'), 'Kontrollsummene viser at innholdet i eksporten ikke er endret etter at den ble laget. De sier ikke at dataene i Lindbak er riktige.');
}

// ---- innstillinger: hva som gjelder når -------------------------------------------
function settingsFlow() {
  return fig(svg(780, 190, 'Endrer du en terskel, gjelder den neste analyse. Endrer du poeng, oppdateres rangeringen med en gang.', (m) => {
    let o = '';
    o += rect(8, 14, 180, 56, 'd-box') + text(98, 38, 'Du endrer en terskel', { anchor: 'middle', bold: true }) + text(98, 56, 'f.eks. «Stor panteretur fra»', { anchor: 'middle', size: 11, cls: 'd-muted' });
    o += line(190, 42, 250, 42, { arrow: m }) + rect(252, 14, 230, 56, 'd-box') + text(367, 38, 'Lagres med en gang', { anchor: 'middle', bold: true }) + text(367, 56, 'i pluginens egen database', { anchor: 'middle', size: 11, cls: 'd-muted' });
    o += line(484, 42, 544, 42, { arrow: m }) + rect(546, 14, 226, 56, 'd-warnsoft') + text(659, 36, 'Gjelder neste analyse', { anchor: 'middle', bold: true }) + text(659, 54, 'gul melding: «Kjør analysen på nytt»', { anchor: 'middle', size: 11 });
    o += rect(8, 110, 180, 56, 'd-box') + text(98, 134, 'Du endrer poeng', { anchor: 'middle', bold: true }) + text(98, 152, 'f.eks. «Rundt beløp: 1 poeng»', { anchor: 'middle', size: 11, cls: 'd-muted' });
    o += line(190, 138, 250, 138, { arrow: m }) + rect(252, 110, 230, 56, 'd-box') + text(367, 134, 'Lagres med en gang', { anchor: 'middle', bold: true }) + text(367, 152, 'ingen ny analyse nødvendig', { anchor: 'middle', size: 11, cls: 'd-muted' });
    o += line(484, 138, 544, 138, { arrow: m }) + rect(546, 110, 226, 56, 'd-acc') + text(659, 132, 'Rangeringen oppdateres', { anchor: 'middle', bold: true }) + text(659, 150, 'i Sjekk først straks', { anchor: 'middle', size: 11 });
    return o;
  }, 'sflow'), 'Terskler avgjør hva som flagges, og flagging skjer når analysen kjøres. Poeng avgjør bare hvor høyt det flaggede rangeres, og kan regnes om uten ny analyse.');
}

// ---- lagring -----------------------------------------------------------------------
function storage() {
  return fig(svg(780, 190, 'Pluginen lagrer bare i sin egen database og skriver aldri til Lindbaks lagring', (m) => {
    let o = rect(8, 14, 330, 160, 'd-box') + text(24, 40, 'Lindbak Chain Web', { bold: true }) + text(24, 62, 'localStorage og sessionStorage', { cls: 'd-mono', size: 12 }) + text(24, 84, 'Pluginen skriver aldri hit.', { size: 12 }) + text(24, 104, 'En stor cache her kunne fått Lindbak', { size: 11, cls: 'd-muted' }) + text(24, 120, 'til å feile ved lagring.', { size: 11, cls: 'd-muted' });
    o += rect(442, 14, 330, 160, 'd-acc') + text(458, 40, 'Kvitteringshenter', { bold: true }) + text(458, 62, 'egen database: kvr-store', { cls: 'd-mono', size: 12 }) + text(458, 84, '• innstillinger og lagrede filtre', { size: 12 }) + text(458, 104, '• skannet bonginnhold (maks 2000)', { size: 12 }) + text(458, 124, '• notater, regler, rapportlogg', { size: 12 }) + text(458, 150, 'Ingenting forlater maskinen.', { size: 11, cls: 'd-muted' });
    o += line(442, 94, 340, 94, { cls: 'd-line-bad', dash: true }) + text(391, 84, '✕', { anchor: 'middle', bold: true, size: 18, cls: 'd-bad-text' });
    return o;
  }, 'storage'), 'Cachen er hardt begrenset og kan tømmes under Skann → Tøm cache. Panelets egne data deles ikke med Lindbak.');
}

module.exports = { flow, scan, scoring, scope, tSmall, tFalse, tFalse2, tAfter, tGap, tDiff, tBenford, tDisc, tPant, zip, settingsFlow, storage };
