'use strict';
// Forklaringer til hver innstilling, test og poengvekt i brukerveiledningen.
// Nøkler følger SETTING_GROUPS i extension/src/logic.js. Testen test/docs.test.js sørger for at alt er dekket.

const fields = {
  // ---- Avvik per bong
  'anom:bigReturn': { what: 'Flagger en bong når utbetalt panteretur (summen av alle pantelapp-linjene) er like høy som grensen eller høyere.', tip: 'Senk grensen i butikker med lite pant. Øk den hvis pantemaskinen gir mange store, normale bonger.', ex: '300 kr: en bong med 8 pantelapper à 40 kr (320 kr) flagges.' },
  'anom:manyLapper': { what: 'Flagger en bong med like mange pantelapper (linjene «399 PANTELAPP») som grensen eller flere.', tip: 'Én kunde kan ha mange flasker. Bruk grensen sammen med beløpsgrensen over for å se de mest uvanlige.', ex: '8: en bong med 9 pantelapper flagges.' },
  'anom:roundMin': { what: 'Flagger bonger der totalbeløpet er et helt hundre-beløp (500,00, 1 200,00 …) og minst så stort som grensen. Vanlig salg gir sjelden så jevne summer.', tip: 'Lav vekt (1 poeng) fordi runde beløp ofte er helt normale, for eksempel gavekort. Trenger ikke skanning.', ex: '500 kr: 500,00 og 1 200,00 flagges, 520,00 gjør det ikke.' },
  'anom:settleDiff': { what: 'Flagger et kassaoppgjør der differansen (telt minus forventet) er minst så stor som grensen, uansett om den er pluss eller minus.', tip: 'Sett til 1 for å se alle differanser, eller høyere hvis små avvik er vanlig. Oppgjøret må være skannet.', ex: '1 kr: −1,00 og +5,00 flagges, 0,50 gjør det ikke.' },
  'anom:cashNoSale': { what: 'Flagger bonger som bare består av pantelapper og der kunden fikk kontanter tilbake, uten at noe annet ble kjøpt.', tip: 'Én slik bong er helt vanlig. Se heller på mønsteret «Kontant tilbake uten salg flere ganger» under Mønstre.', ex: 'En bong med fire pantelapper og kontant tilbake 156,00.' },

  // ---- Mønstre
  smallReturnN: { what: 'Hvor mange små returer på samme kasse, samme dag og i tidsrommet før stenging, som må til for å flagge dem.', tip: 'Tom = testen er av. Tre er et fornuftig utgangspunkt. Testen trenger også en stengetid.', ex: '3: tre returer under 100 kr mellom 21:00 og 22:00 flagges alle tre.' },
  smallReturn: { what: 'Det største beløpet en retur kan ha og fortsatt regnes som «liten». Større returer teller ikke med.', tip: 'Senk hvis butikken normalt selger billige varer, øk hvis små returer ofte er dyrere.', ex: '100 kr: en retur på 120 kr telles ikke.' },
  closeTime: { what: 'Klokkeslettet butikken stenger (TT:MM). Brukes bare av testen for små returer før stenging. 00:00 regnes som midnatt.', tip: 'Sett til faktisk stengetid. Tom verdi slår av testen.', ex: '22:00.' },
  closeWindow: { what: 'Hvor mange minutter før stengetid som sjekkes.', tip: 'Lengre tidsrom gir flere treff, kortere gir færre og mer målrettede.', ex: '60 min og stengetid 22:00: sjekker 21:00 til 22:00.' },
  cashNoSaleN: { what: 'Hvor mange bonger med bare pantelapper og kontant tilbake en kasse må ha (innenfor omfanget) før kassen flagges.', tip: 'Tom = av. Telles over hele omfanget, så et langt tidsrom gir flere treff. Pantelapper kan komme fra flasker kjøpt andre steder.', ex: '3: fire slike bonger på kasse 2 flagges alle fire.' },
  repeatN: { what: 'Flagger bonger med nøyaktig samme totalbeløp når en kasserer har minst så mange av dem samme dag.', tip: 'Tom = av. Samme beløp igjen og igjen kan være en gjentatt manuell registrering. Bruk «minst beløp» under for å unngå vanlige småbeløp.', ex: '3: tre bonger på 149,90 fra samme kasserer samme dag flagges.' },
  repeatMin: { what: 'Bare beløp fra og med denne grensen teller i «Samme beløp gjentatt». Små beløp gjentas naturlig (en brus, en avis).', tip: 'Øk hvis du får mange treff på billige varer.', ex: '50 kr: bonger på 29,90 ignoreres.' },

  // ---- Falsk retur
  falseRet: { what: 'Slår hele testen for falsk retur på eller av. Den omfatter tre kontroller: retur uten salg, kortkjøp refundert kontant, og salg og retur av samme beløp.', tip: 'Retur uten salg vurderes bare når minst 80 % av salgene i datagrunnlaget er skannet.', ex: 'På.' },
  saleReturnMin: { what: 'En retur av samme beløp som et salg på samme kasse flagges hvis den kommer innen så mange minutter etter salget.', tip: 'Kortere tid gir færre, men mer sikre treff. Legitime angrer skjer ofte innen noen minutter.', ex: '60 min: salg 10:05 og retur 10:25 av samme beløp flagges.' },

  // ---- Salg etter kassaoppgjør
  settleGraceMin: { what: 'Hvor mange minutter etter dagens siste kassaoppgjør et salg på samme kasse kan komme før det regnes som «etter oppgjør».', tip: 'Tom = testen er av. Gi litt slingringsmonn hvis kassene brukes noen minutter etter oppgjøret.', ex: '5 min: salg 22:03 etter oppgjør 22:00 flagges ikke, salg 22:12 flagges.' },

  // ---- Slettede bonger
  maxGap: { what: 'Det største antallet manglende bongnumre på rad som regnes som mulige slettede bonger. Større hull hoppes over.', tip: 'Tom = hull-testen er av. Store hull skyldes nesten alltid at CW-listen er filtrert, ikke slettinger.', ex: '50: et hull på 6 flagges, et hull på 400 hoppes over.' },

  // ---- Kassadifferanse
  diffMin: { what: 'Differanser mindre enn dette telles hverken som minus eller pluss.', tip: 'Øk hvis kroneavrunding gir mange småavvik.', ex: '1 kr: −0,50 telles ikke.' },
  diffRepeatN: { what: 'Flagger en kasserer eller kasse som har minus i minst så mange kassaoppgjør, fordelt på minst to ulike dager.', tip: 'Tom = av. Gjentakelse over flere dager er mer interessant enn én dårlig dag.', ex: '3: minus på tre oppgjør på tre dager flagges.' },
  diffTotal: { what: 'Flagger også når samlet minus for en kasserer eller kasse passerer dette beløpet, selv om ikke antallet er nådd.', tip: 'Tom = av. Fanger én stor differanse eller mange små.', ex: '100 kr: −135 kr totalt flagges.' },

  // ---- Tallanalyse
  benfordMin: { what: 'Minste antall bonger i omfanget som kreves for å gi en samlet Benford-vurdering.', tip: 'Under grensen vises en merknad om at grunnlaget er for lite. Benford sier lite med få bonger.', ex: '100.' },
  benfordCashMin: { what: 'Minste antall bonger en enkelt kasserer må ha for at fordelingen hennes eller hans vurderes.', tip: 'Øk for å unngå tilfeldige utslag hos kasserere med få bonger.', ex: '50.' },
  benfordMad: { what: 'Hvor stort avviket fra Benfords fordeling (målt som MAD) må være før kassereren flagges.', tip: 'Tommelfinger: under 0,006 er nær Benford, 0,006–0,012 akseptabelt, 0,012–0,015 marginalt, over 0,015 avvikende.', ex: '0,015.' },
  roundShare: { what: 'Flagger en kasserer når minst så stor andel av totalene er hele kroner, og andelen er minst dobbelt så høy som butikkens.', tip: 'Tom = av. Betaling kontant med avrundet pris kan gi mange hele kroner.', ex: '5 %: 8 % hele kroner mot butikkens 3 % flagges.' },
  roundMinN: { what: 'Minste antall bonger en kasserer må ha for at andelen hele kroner vurderes.', tip: 'Øk for å unngå utslag fra få bonger.', ex: '20.' },

  // ---- Rabatt
  discPct: { what: 'Flagger en bong når en rabattlinje uten rabattårsak er minst så høy i prosent som grensen.', tip: 'Tom = av. Hvis butikken ofte gir rabatt uten å velge årsak, bør grensen opp eller testen av.', ex: '30 %: 50 % rabatt uten årsak flagges, 20 % gjør det ikke.' },
  discCash: { what: 'Sammenligner kasserere: de som har andelen bonger med rabatt uten årsak minst 1,5 ganger butikkens andel (og minst to slike bonger) markeres.', tip: 'Bruker samme faktor og minstegrense som Kassererprofil. Gir poeng til kassereren, ikke til bongene.', ex: '4 av 10 bonger mot butikkens 10 %.' },
  discWatch: { what: 'Hvilke rabattårsaker som skal overvåkes, oppgitt som tekstnr med komma (1 Datovare, 2 Feil pris, 3 Prisløfte, 4 Reserveløsning kupong, 5 Annen rabattårsak, 6 Best før).', tip: 'Tom = overvåking av. Standard er de skjønnsmessige: 2, 4 og 5.', ex: '2,4,5.' },
  discWatchPct: { what: 'Minste rabatt i prosent for at en overvåket årsak skal flagge bongen.', tip: '0 betyr at all rabatt med overvåket årsak flagges.', ex: '20 %: 10 % rabatt med årsak «Feil pris» flagges ikke.' },
  discWatchKr: { what: 'Minste rabatt i kroner (per varelinje) for at en overvåket årsak skal flagge bongen.', tip: '0 betyr alle beløp.', ex: '10 kr: en rabatt på 3 kr flagges ikke.' },
  discWatchN: { what: 'Hvor mange bonger med overvåket årsak en kasserer må ha før kassereren markeres.', tip: 'Tom = av. Gir poeng til kassereren (3 som standard).', ex: '3: fire bonger med «Annen rabattårsak» markerer kassereren.' },

  // ---- Pant
  pantRepeatN: { what: 'Flagger bonger når samme pantebeløp er utbetalt så mange ganger på samme kasse samme dag.', tip: 'Tom = av. Samme beløp flere ganger kan være en gjentatt registrering.', ex: '2: to bonger à 150,00 på kasse 2 samme dag flagges.' },
  pantMin: { what: 'Bare pantebeløp fra og med denne grensen teller i testen over.', tip: 'Små pantebeløp er vanlige og gir støy.', ex: '20 kr.' },
  pantRatio: { what: 'I Pantelapp-sjekk markeres rødt når utbetalt panteretur en dag er mer enn dette tallet ganger pantesalget samme dag i butikken.', tip: 'Tom = av. Gir bare rød markering i tabellen, ikke poeng. Pantelapper kan komme fra flasker kjøpt andre steder.', ex: '1: retur over pantesalget gir rød rad.' },

  // ---- Åpningstider
  openFrom: { what: 'Når butikken åpner (TT:MM). Salg før dette flagges som «utenfor åpningstid». Kassaoppgjør før dette regnes som forrige dags avslutning.', tip: 'Sett til faktisk åpningstid. Viktig for at oppgjør etter midnatt ikke gir falske «salg etter oppgjør».', ex: '06:00.' },
  openTo: { what: 'Når butikken stenger (TT:MM). Salg etter dette flagges som «utenfor åpningstid».', tip: 'Sett litt over stengetid hvis salgene ofte går noen minutter over.', ex: '23:00.' },

  // ---- Profil og avstemming
  profFactor: { what: 'Hvor mange ganger høyere enn butikkens snitt en kasserers returandel, snittbeløp, pantelapper eller korrigeringer må være for å markeres. Snittbeløp markeres også når det er under snittet delt på tallet.', tip: 'Brukes også i Periode A mot B og i sammenligning av rabatter. Lavere tall gir flere markeringer.', ex: '1,5: returandel 17 % mot butikkens 4 % markeres.' },
  profMin: { what: 'Minste antall bonger en kasserer må ha for å vurderes mot butikksnittet.', tip: 'Øk for å unngå tilfeldigheter hos kasserere med få bonger.', ex: '5.' },
  reconTol: { what: 'Toleranse i dagsavstemmingen: avvik mellom forventet og telt kontant som er mindre enn dette, markeres ikke.', tip: 'Brukes bare til rød markering i Dagsavstemming.', ex: '1 kr.' }
};

// ---- Tester: forklaring per innstillingsgruppe
const groups = {
  bong: { how: 'Sjekker hver kvittering for seg, uten å sammenligne med andre. Enkelt og raskt, men gir flest falske treff hvis grensene er lave.', flags: ['Stor utbetaling av panteretur på én bong', 'Mange pantelapper på én bong', 'Bong med bare pantelapper og kontant tilbake', 'Rundt hundre-beløp', 'Kassaoppgjør med differanse'], harmless: 'Kunder med mange flasker, firmakunder, gavekort, og oppgjør der en feil allerede er rettet.', needs: 'Pant og kontant tilbake krever skannet bong. Rundt beløp trenger ikke skanning. Kassadifferanse krever skannet oppgjør.' },
  patterns: { how: 'Ser etter gjentakelser blant flere bonger. Én retur sier lite, men tre like rett før stenging på samme kasse er et mønster.', flags: ['Flere små returer rett før stenging', 'Kontant tilbake uten salg flere ganger på samme kasse', 'Samme beløp gjentatt hos samme kasserer samme dag'], harmless: 'Rolige kvelder med få bonger, populære enhetspriser, og kunder som leverer tilbake flere varer.', needs: 'Små returer og samme beløp trenger bare listen. Kontant tilbake uten salg krever skannet innhold.' },
  falseRet: { how: 'Leter etter returer som ikke henger sammen med et salg. Bruker alle innlastede bonger i valgte butikker som grunnlag, ikke bare omfanget.', flags: ['Retur uten salg: varen er returnert, men ingen bong i datagrunnlaget har solgt den', 'Kortkjøp refundert kontant: salget var betalt med kort, men pengene betales tilbake som kontanter', 'Salg og retur av samme beløp på samme kasse innen kort tid'], harmless: 'Retur av varer kjøpt før perioden eller i en annen butikk, og vanlige angrer rett etter kjøp.', needs: 'Skannet innhold. «Retur uten salg» vurderes bare når minst 80 % av salgene i datagrunnlaget er skannet.' },
  afterSettle: { how: 'Et kassaoppgjør skal avslutte dagen på kassen. Testen flagger salg på samme kasse etter dagens siste oppgjør. Oppgjør før åpningstid regnes som forrige dags avslutning.', flags: ['Salg som kommer etter siste kassaoppgjør på kassen samme dag'], harmless: 'Kassen brukt etter et feilaktig tidlig oppgjør, eller oppgjør gjort midt på dagen ved skiftbytte.', needs: 'Bare listen (type og tidspunkt). Datagrunnlag i valgte butikker.' },
  deleted: { how: 'Bongnummer går opp med én for hver kvittering på en kasse. Hull, dobbelte nummer og feil rekkefølge kan tyde på slettede eller endrede bonger.', flags: ['Hull i bongnummer', 'Bongnummer og klokkeslett som ikke stemmer (nummer kommer i feil tidsrekkefølge)', 'Dobbelt bongnummer på samme kasse'], harmless: 'Filtrerte lister (en annen kvitteringstype mangler), bonger hentet i flere omganger, og kassaoppgjør som har egen nummerserie. Forutsetter at kvitteringstypene deler nummerserie per kasse, noe som ikke er bekreftet i ekte data.', needs: 'Bare listen. Gjelder bare hvis CW-listen ikke er filtrert på type, kasse eller tid.' },
  diff: { how: 'Følger kassadifferanser fra kassaoppgjør over tid for hver kasserer og kasse. En enkelt differanse har mange uskyldige årsaker. Gjentakelse er det interessante.', flags: ['Minus i flere kassaoppgjør fordelt på flere dager', 'Stort samlet minus'], harmless: 'Kassen delt mellom flere kasserere, vekslepenger, rettelser dagen etter.', needs: 'Skannede kassaoppgjør.' },
  numbers: { how: 'Benfords lov sier at første siffer i naturlig forekommende beløp følger en bestemt fordeling (1 er vanligst med ca. 30 %). Tilpassede eller konstruerte beløp avviker ofte. I tillegg måles andelen hele kroner.', flags: ['Avvikende sifferfordeling hos en kasserer', 'Uvanlig høy andel hele kroner hos en kasserer'], harmless: 'Butikker med mange enhetspriser, kontantsalg med avrunding, få bonger.', needs: 'Bare listen. Trenger mange bonger (standard minst 100 samlet og 50 per kasserer). Gir poeng til kassereren, ikke til bongene. En indikasjon, ikke bevis.' },
  disc: { how: 'Leser rabattlinjene og rabattårsakene på bongene. Rabatt uten årsak flagges over en prosentgrense, og skjønnsmessige årsaker kan overvåkes.', flags: ['Rabattlinje uten årsak over prosentgrensen', 'Rabatt med en overvåket årsak', 'Kasserer med uvanlig mange bonger med rabatt uten årsak, eller med overvåket årsak'], harmless: 'Butikker som rutinemessig gir rabatt uten å velge årsak, og datovarer som er rabattert etter instruks.', needs: 'Skannet innhold med rabattdata (skanning fra versjon 3). Eldre skanninger må tas på nytt.' },
  pant: { how: 'Pantelapp-sjekk: samme pantebeløp utbetalt flere ganger, og balansen mellom pantesalg og utbetalt panteretur per dag og butikk.', flags: ['Samme pantebeløp utbetalt flere ganger på samme kasse samme dag', 'Utbetalt panteretur over pantesalget (rød rad i Pantelapp-sjekk)'], harmless: 'Pantelapper fra flasker kjøpt andre steder, og kampanjer som gir mye retur.', needs: 'Skannet innhold. Pant leses fra linjene «220 PANT» (salg) og «399 PANTELAPP» (retur).' },
  hours: { how: 'Åpnings- og stengetid brukes til å flagge salg utenfor åpningstid og til å avgjøre hvilken dag et kassaoppgjør hører til.', flags: ['Salg utenfor åpningstid (per kasse og dag)'], harmless: 'Forlenget åpningstid, rydding og testbonger. Sett riktige tider for å unngå støy.', needs: 'Bare listen (tidspunkt og type), ingen skanning.' },
  profile: { how: 'Kassererprofil sammenligner hver kasserer mot butikkens snitt: returandel, snittbeløp, pantelapper per salg og korrigeringer per salg. Dagsavstemming sammenligner forventet og telt kontant per kasse og dag.', flags: ['Kasserer som ligger uvanlig høyt eller lavt mot snittet', 'Avstemming med avvik mellom forventet og telt kontant'], harmless: 'Ulike skift og arbeidsoppgaver (en kasserer på pantekassen får høy returandel).', needs: 'Returandel og snittbeløp trenger bare listen. Pantelapper og korrigeringer krever skanning. Hver profilmarkering gir 2 poeng til kassereren.' },
  rules: { how: 'Egne avviksregler bygger du under Analyse → Detaljer → Egne avviksregler. Hver regel kan kombinere flere vilkår, og treff gir like mange poeng som angitt her.', flags: ['Bonger som oppfyller alle vilkårene i en av reglene dine'], harmless: 'Avhenger av reglene du lager.', needs: 'Regler som bruker innhold (merket *) krever skannet bong.' }
};

// ---- Poengvekter: hva som utløser hver
const weights = {
  'Stor panteretur': 'Bongen har utbetalt panteretur over grensen.',
  'Mange pantelapper': 'Bongen har flere pantelapper enn grensen.',
  'Kontant tilbake uten salg': 'Bongen har bare pantelapper og kontant tilbake.',
  'Rundt beløp': 'Totalen er et helt hundre-beløp over grensen.',
  'Kassadifferanse': 'Kassaoppgjøret har differanse over grensen.',
  'Små returer før stenging': 'Bongen er en av flere små returer rett før stenging.',
  'Kontant tilbake uten salg flere ganger': 'Bongen er en av flere pantebonger med kontant tilbake på samme kasse.',
  'Samme beløp gjentatt': 'Bongen har et beløp som gjentas hos samme kasserer samme dag.',
  'Retur uten salg': 'Varen i returen er ikke solgt i datagrunnlaget.',
  'Kortkjøp refundert kontant': 'Salget var betalt med kort, men refunderes kontant.',
  'Salg og retur av samme beløp': 'Salg og retur av samme beløp på samme kasse innen fristen.',
  'Salg etter kassaoppgjør': 'Salg på kassen etter dagens siste kassaoppgjør.',
  'Hull i bongnummer': 'Bongen ligger ved siden av et hull i nummerserien.',
  'Bongnummer og tid stemmer ikke': 'Bongnummer og klokkeslett kommer i feil rekkefølge.',
  'Dobbelt bongnummer': 'Samme bongnummer finnes to ganger på kassen.',
  'Gjentatte kassadifferanser': 'Bongen er et kassaoppgjør i en serie med minus.',
  'Avvikende sifferfordeling': 'Kasserer har avvikende første-siffer-fordeling (poeng til kassereren).',
  'Mange runde beløp': 'Kasserer har uvanlig høy andel hele kroner (poeng til kassereren).',
  'Rabatt uten årsak': 'Bongen har en rabattlinje uten årsak over prosentgrensen.',
  'Mange rabatter uten årsak': 'Kasserer har uvanlig mange bonger med rabatt uten årsak (poeng til kassereren).',
  'Rabatt med overvåket årsak': 'Bongen har rabatt med en overvåket årsak.',
  'Mange rabatter med overvåket årsak': 'Kasserer har mange bonger med overvåket rabattårsak (poeng til kassereren).',
  'Samme pantebeløp utbetalt flere ganger': 'Bongen er en av flere med samme pantebeløp på kassen samme dag.',
  'Bonger utenfor åpningstid': 'Bongen er tatt utenfor åpningstid.',
  'Regel': 'Bongen treffer en av dine egne avviksregler.'
};

module.exports = { fields, groups, weights };
