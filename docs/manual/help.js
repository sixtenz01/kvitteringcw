'use strict';
// Forklaringer til hver innstilling, test og poengvekt i brukerveiledningen.
// Nøkler følger SETTING_GROUPS i extension/src/logic.js. Testen test/docs.test.js sørger for at alt er dekket.

const fields = {
  // ---- Avvik per bong
  'anom:bigReturn': { what: 'Flagger en bong når utbetalt panteretur (summen av alle pantelapp-linjene) er like høy som grensen eller høyere.', tip: 'Senk grensen i butikker med lite pant. Øk den hvis pantemaskinen gir mange store, normale bonger.', ex: '300 kr: en bong med 8 pantelapper à 40 kr (320 kr) flagges.' },
  'anom:manyLapper': { what: 'Flagger en bong med like mange pantelapper (linjene «399 PANTELAPP») som grensen eller flere.', tip: 'Én kunde kan ha mange flasker. Bruk grensen sammen med beløpsgrensen over for å se de mest uvanlige.', ex: '8: en bong med 9 pantelapper flagges.' },
  'anom:roundMin': { what: 'Flagger bonger der totalbeløpet er et helt hundre-beløp (500,00, 1 200,00 …) og minst så stort som grensen. Vanlig salg gir sjelden så jevne summer.', tip: 'Lav vekt (1 poeng) fordi runde beløp ofte er helt normale, for eksempel gavekort. Trenger ikke skanning.', ex: '500 kr: 500,00 og 1 200,00 flagges, 520,00 gjør det ikke.' },
  'anom:settleDiff': { what: 'Flagger et kassaoppgjør der differansen (telt minus forventet) er minst så stor som grensen, uansett om den er pluss eller minus.', tip: 'Sett til 1 for å se alle differanser, eller høyere hvis små avvik er vanlig. Oppgjøret må være skannet.', ex: '1 kr: −1,00 og +5,00 flagges, 0,50 gjør det ikke.' },
  'anom:cashNoSale': { what: 'Flagger bonger som bare består av pantelapper og der kunden fikk kontanter tilbake, uten at noe annet ble kjøpt. Varelinjer som er slettet med motlinje regnes som ikke kjøpt.', tip: 'Én slik bong er helt vanlig. Se heller på mønsteret «Kontant tilbake uten salg flere ganger» under Mønstre.', ex: 'En bong med fire pantelapper og kontant tilbake 156,00.' },

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

  // ---- Medlemsnummer
  memberStoreMin: { what: 'Flagger bonger med samme medlemsnr i to ulike butikker når det er så få minutter mellom dem at det er usannsynlig at samme person handlet begge steder.', tip: 'Tom = av. Bruker bare listen fra CW, ikke skanning. Medlemsnr kan også deles i en husstand, så sjekk tidspunktene.', ex: '30 min: butikk 1005 kl 10:00 og butikk 1010 kl 10:15 flagges.' },
  memberDayN: { what: 'Flagger alle bongene til et medlemsnr som har minst så mange bonger samme dag.', tip: 'Tom = av. Flere handleturer samme dag er sjeldent, men en ansatt som taster sitt eget nummer på kunders kjøp gir ofte mange bonger.', ex: '4: fire bonger med samme medlemsnr 7. oktober flagges.' },
  memberN: { what: 'Flagger alle bongene til et medlemsnr som har minst så mange bonger i alt blant de innlastede.', tip: 'Tom = av. Avhenger av hvor lang periode du har lastet: en trofast kunde kan ha mange bonger på en måned. Sett grensen høyt for lange perioder.', ex: '15: et nummer med 18 bonger flagges.' },
  memberCashN: { what: 'Minste antall bonger et medlemsnr må ha hos én og samme kasserer før konsentrasjonen vurderes.', tip: 'Tom = av. Se også andelsgrensen under, og «Avviker fra snittet fra» som kassererens vanlige andel må overstige.', ex: '5: et nummer med seks bonger hos kasserer 12 vurderes.' },
  memberCashShare: { what: 'Andelen av medlemsnummerets bonger som må ligge hos samme kasserer. I tillegg må andelen være minst «Avviker fra snittet» ganger kassererens vanlige andel av butikkens bonger.', tip: 'Den siste betingelsen hindrer at en kasserer som har de fleste bongene i butikken flagges uten grunn.', ex: '80 %: seks av sju bonger (86 %) hos kasserer 12, som ellers har 25 % av bongene.' },
  empMembers: { what: 'Ansattes medlemsnr, adskilt med komma. «1234567» flagger alle bonger med nummeret. «12=1234567» (kasserer=medlemsnr) flagger i tillegg bonger der kasserer 12 selv har tastet nummeret.', tip: 'Tom = av. Listen lagres bare i din egen nettleser og tas med i innstillingseksport og rapport.', ex: '12=1234567, 1234568.' },

  // ---- Pris per vare
  priceDevPct: { what: 'Flagger en varelinje når enhetsprisen avviker så mange prosent eller mer fra den vanlige prisen på varen samme dag i samme butikk. Vanlig pris er den prisen flest bonger har, og den må ha minst 60 % av salgene.', tip: 'Tom = av. Kan tyde på manuell pris, spør pris eller feil pris. Kampanjer og flerkjøp kan gi falske treff. Rabatt legges tilbake i prisen, så vanlig rabatt flagges ikke her. Krever skanning (ny skanning har enhetspris).', ex: '10 %: melk til 8,00 mot vanlig 12,90 (−38 %) flagges.' },
  priceMinN: { what: 'Minste antall salg av samme vare i samme butikk samme dag før en vanlig pris regnes ut.', tip: 'Øk for å unngå tilfeldigheter på varer som selger sjelden.', ex: '5.' },
  priceCashN: { what: 'Markerer en kasserer som har minst så mange varelinjer med avvikende pris i omfanget.', tip: 'Tom = av. Gir poeng til kassereren (3 som standard).', ex: '3: tre avvikende varelinjer markerer kassereren.' },

  // ---- Kjøpeutbytte
  kuMissing: { what: 'Flagger en medlemsbong som mangler Kjøpeutbytte-tabellen, men bare når minst 80 % av medlemsbongene (og minst 10) har den.', tip: 'Tabellen er ikke bekreftet i ekte data. Testen kalibrerer seg selv: finnes tabellen sjelden, regnes fraværet ikke som avvik. Krever skanning.', ex: '16 av 17 medlemsbonger har tabellen: den ene uten flagges.' },
  kuDiffPct: { what: 'Flagger en medlemsbong der Kjøpeutbytte-grunnlaget avviker så mange prosent eller mer fra det vanlige forholdet mellom grunnlag og varesum.', tip: 'Tom = av. Vanlig forhold er medianen over alle medlemsbonger (minst 10). Varer som ikke gir utbytte kan gi falske treff.', ex: '25 %: vanlig forhold 95 %, en bong med 30 % flagges.' },
  kuDiffKr: { what: 'Avviket i grunnlaget må også være minst så mange kroner for å flagge.', tip: 'Hindrer treff på små bonger der prosenten svinger mye.', ex: '20 kr.' },

  // ---- Hendelsesord
  evOn: { what: 'Slår testen for hendelsesord på eller av. Testen flagger bonger med tekstlinjer som inneholder annull, makul, storn, parker, på vent, manuell, spør pris, overstyr, prisendring, kansell eller avbrutt.', tip: 'Slike hendelser er ikke observert i ekte data ennå, så testen er en felle som fanger dem når de dukker opp. Varenavn regnes ikke med. Se Diagnostikk for alle ukjente linjer.', ex: 'På.' },

  // ---- Bongen går opp, MVA og betalingsreferanse
  lineTol: { what: 'Summen av varelinjene (etter rabatt) skal være lik Totalt på bongen, med eller uten øreavrunding. Avviket får ikke være større enn toleransen.', tip: 'Tom = av. Kontrollen kalibrerer seg: stemmer under 80 % av minst 10 skannede bonger, antas en annen regnskapsmåte, og avvik regnes ikke som funn. Krever ny skanning.', ex: '0,10 kr: linjer 232,00 og Totalt 250,00 flagges.' },
  payTol: { what: 'Betalinger minus kontant tilbake skal være lik Totalt (med eller uten øreavrunding), innenfor toleransen.', tip: 'Tom = av. Fanger bonger som er underbetalt eller overbetalt, og linjer som mangler. Kalibrerer seg som linjekontrollen.', ex: '0,10 kr: betalt 100,00 mot Totalt 120,00 flagges.' },
  vatOn: { what: 'Slår MVA-kontrollen på eller av. Den sjekker at MVA = grunnlag × sats, at grunnlag + MVA = sum, at MVA-tabellens sum stemmer med Totalt, og at satsen er gyldig.', tip: 'Ugyldig sats flagges alltid når kontrollen er på. De andre delene kalibrerer seg mot de skannede bongene.', ex: 'På.' },
  vatTol: { what: 'Største avvik i kroner som godtas i MVA-regnestykkene (avrunding per linje gir små avvik).', tip: 'Øk hvis du får treff på øre-avrunding.', ex: '0,10 kr.' },
  vatRates: { what: 'Hvilke MVA-satser (prosent) som er gyldige, adskilt med komma.', tip: 'Standard for Norge er 0, 12, 15 og 25. Legg til satser hvis butikken selger varer med andre satser.', ex: '0,12,15,25.' },
  refDup: { what: 'Flagger bonger som har samme betalingsreferanse. TransId gjelder alle kasser; Referanse gjelder bare samme kasse og dag, og tall kortere enn fire tegn teller ikke.', tip: 'Samme betaling registrert på to bonger kan være en dobbeltregistrering. Referansene kan også brukes til avstemming mot bankoppgjør (CSV har kolonnen Betalingsref).', ex: 'TransId DK7TV5W2F på kasse 1 kl 11:00 og kasse 2 kl 11:20.' },

  // ---- Tallanalyse: siste siffer
  digitMin: { what: 'Minste antall bonger en kasserer må ha for at siste siffer i totalbeløpet (ører) sammenlignes med de andre kassererne.', tip: 'Øk for å unngå utslag fra få bonger. Testen krever minst tre kasserere med nok bonger.', ex: '50.' },
  digitP: { what: 'Flagger en kasserer når fordelingen av siste siffer i totalbeløpet er svært forskjellig fra normalfordelingen (median av kassererne), målt med χ²-test. Verdien er p-grensen.', tip: 'Tom = av. Lavere p gir færre og sikrere treff. Oppdiktede eller rundede beløp gir ofte for mange nuller eller femmere. Gir poeng til kassereren, ikke til bongene.', ex: '0,001: p under 0,001 flagges.' },

  // ---- Slettede bonger: løpenummer mot tid
  seqRegMin: { what: 'Flagger en bong når tidspunktet ligger så mange minutter utenfor tidene til de tre nabonumrene på hver side på samme kasse.', tip: 'Tom = av. Fanger innsatte bonger og bonger med feil klokkeslett, og peker ut hvilken bong det gjelder. Døgnskifte gir ikke treff.', ex: '90 min: nr 2377 kl 09:03 mellom bonger kl 14:00–14:10 flagges.' },

  // ---- Kassadifferanse: retur mot differanse
  corrRho: { what: 'Flagger en kasserer når returandelen per dag og kassadifferansen per dag henger sammen: dager med flere returer har mer minus (Spearman ρ under −grensen), samlet minus og returandel over butikkens.', tip: 'Tom = av. Fanger misbruk som ikke utløser noen enkeltregel. Krever mange dager.', ex: '0,5: ρ = −0,71 flagges.' },
  corrDays: { what: 'Minste antall dager (med minst 5 salg og et kassaoppgjør) som trengs for å beregne ρ for en kasserer.', tip: 'Øk for å unngå tilfeldige treff. Lave tall gir ustabil korrelasjon.', ex: '8 dager.' },

  // ---- Profil: krymping
  profShrink: { what: 'Butikksnittet teller som så mange bonger i hver kassereres tall før sammenligningen: (n·x + k·snitt) / (n + k). Kasserere med få bonger trekkes mot snittet.', tip: 'Tom = rå tall. Høyere verdi gir færre treff hos kasserere med få bonger, og endrer lite for de med mange.', ex: '10: en kasserer med 5 bonger og 20 % retur vurderes som ca. 13 %.' },

  // ---- Pant
  pantMin: { what: 'Bare pantebeløp fra og med denne grensen teller i testen «Pantelapp innløst flere ganger» (under Pantelapper).', tip: 'Små pantebeløp er vanlige og gir støy.', ex: '20 kr.' },
  pantRatio: { what: 'I Pantelapp-sjekk markeres rødt når utbetalt panteretur en dag er mer enn dette tallet ganger pantesalget samme dag i butikken.', tip: 'Tom = av. Gir bare rød markering i tabellen, ikke poeng. Pantelapper kan komme fra flasker kjøpt andre steder.', ex: '1: retur over pantesalget gir rød rad.' },

  // ---- Åpningstider
  openFrom: { what: 'Når butikken åpner (TT:MM). Salg før dette flagges som «utenfor åpningstid». Kassaoppgjør før dette regnes som forrige dags avslutning.', tip: 'Sett til faktisk åpningstid. Viktig for at oppgjør etter midnatt ikke gir falske «salg etter oppgjør».', ex: '06:00.' },
  openTo: { what: 'Når butikken stenger (TT:MM). Salg etter dette flagges som «utenfor åpningstid».', tip: 'Sett litt over stengetid hvis salgene ofte går noen minutter over.', ex: '23:00.' },

  // ---- Profil og avstemming
  profFactor: { what: 'Hvor mange ganger høyere enn butikkens snitt en kasserers returandel, snittbeløp, pantelapper eller korrigeringer må være for å markeres. Snittbeløp markeres også når det er under snittet delt på tallet.', tip: 'Brukes også i Periode A mot B og i sammenligning av rabatter. Lavere tall gir flere markeringer.', ex: '1,5: returandel 17 % mot butikkens 4 % markeres.' },
  profMin: { what: 'Minste antall bonger en kasserer må ha for å vurderes mot butikksnittet.', tip: 'Øk for å unngå tilfeldigheter hos kasserere med få bonger.', ex: '5.' },
  reconTol: { what: 'Toleranse i dagsavstemmingen: avvik mellom forventet og telt kontant som er mindre enn dette, markeres ikke.', tip: 'Brukes bare til rød markering i Dagsavstemming.', ex: '1 kr.' },
  lappManualMin: { what: 'Flagger en bong når summen av manuelt innlagte pantelapper (linjene «99 PANTELAPP») er like høy som grensen eller høyere. Pantelapper fra pantemaskinen («399 PANTELAPP») teller ikke.', tip: 'Tom = av. Manuell pantelapp betyr at kassereren har tastet beløpet selv. Sett grensen lavt hvis pantemaskinen vanligvis fungerer.', ex: '50 kr: en bong med 60 kr i kode 99 flagges.' },
  lappManualN: { what: 'Markerer en kasserer når minst så mange pantebonger har manuell pantelapp og andelen er høyere enn butikkens andel ganger «Avviker fra snittet».', tip: 'Tom = av. Gir poeng til kassereren, ikke til bongene. En kasserer som alltid taster pant for hånd skiller seg dermed ut.', ex: '5: fem bonger med kode 99 og minst 1,5 ganger butikkens andel markeres.' },
  lappDel: { what: 'Flagger en bong der en pantelapp er slettet: samme pantelapp står både som minus og pluss, med samme kode og beløp.', tip: 'Tom = av. En slettet pantelapp er ikke nødvendigvis galt (feilskanning), men gjentatt sletting hos samme kasserer er verdt å se på.', ex: '1 (på).' },
  lappReuseMin: { what: 'Flagger bonger der samme pantelapp-sum er innløst på ulike bonger i samme butikk: innen så mange minutter, eller på samme kasse samme dag. Viser bongen et lappnummer (minst seks siffer), sammenlignes det i stedet, uten tidsgrense. Bonger med flere pantelapper sammenlignes også på bongsummen.', tip: 'Tom = av. En pantelapp skal bare innløses én gang. Samme sum er bare en indikasjon, så beløp under «Pantebeløp er minst» hoppes over. Erstatter den gamle testen «Samme pantebeløp utbetalt flere ganger».', ex: '60 min: to lapper à 45,00 kr på ulike kasser innen en time flagges, og to à 150,00 kr på samme kasse samme dag flagges.' },
  voidCashOn: { what: 'Flagger en bong der varelinjer er slettet (linje og motlinje med samme beløp), og det bare står igjen pant og kontant tilbake.', tip: 'Tom = av. Fanger tilfellet der en kunde handler for 150 kr, betaler med pantelapp for 150 kr, og kassereren etterpå sletter varelinjene slik at pantelappen utbetales kontant.', ex: '1 (på).' },
  voidResaleMin: { what: 'En varelinje (EAN) som er slettet fra en bong sjekkes mot salg av samme vare på andre bonger i butikken, så mange minutter før eller etter. Er varen ikke solgt på nytt, flagges bongen.', tip: 'Tom = av. Krever at minst 80 % av salgene er skannet. At en kunde angrer er helt vanlig, så vurder sammen med antallet hos kassereren.', ex: '120 min (2 timer).' },
  voidCashN: { what: 'Markerer en kasserer med minst så mange slettede varelinjer i omfanget.', tip: 'Tom = av. Gir poeng til kassereren.', ex: '5 linjer.' },
  specialWords: { what: 'Ord som leter i betalingsmåter, linjenavn og tekstlinjer: eget forbruk, internt forbruk, utbetaling, finansiering og sjekk. Hele ord, uavhengig av store og små bokstaver.', tip: 'Tom = av. Du kan legge til flere ord. De samme ordene vises som valg under Filtrer → Innhold, slik at du kan søke etter dem i listen.', ex: 'eget forbruk, sjekk.' },
  specialN: { what: 'Markerer en kasserer med minst så mange bonger med spesialord.', tip: 'Tom = av. Gir poeng til kassereren.', ex: '3 bonger.' },
  discHiFrom: { what: 'Flagger rabattlinjer der rabatten i prosent ligger mellom denne grensen og «Høy rabatt: overvåk til». Gjelder både med og uten rabattårsak.', tip: 'Tom = av. Sett fra 70 for å overvåke svært høye rabatter. Sentrale kampanjer flagges ikke.', ex: '70 %: en rabatt på 80 % flagges.' },
  discHiTo: { what: 'Øvre grense for overvåkingen av høy rabatt. 100 betyr at gratis varer også tas med.', tip: 'Sett lavere hvis du bare vil se et bestemt intervall.', ex: '100 %.' },
  discMatchPct: { what: 'Flagger en rabattlinje på minst så mange prosent når ingen andre bonger i butikken samme dag har samme vare (EAN) med samme rabatt. Samme rabatt på andre dager står i forklaringen.', tip: 'Tom = av. Fanger rabatter som ikke passer med noen kampanje og kan være feil eller underslag. Datovare og andre manuelle rabatter gir naturlig enkelttreff, derfor gjelder testen som standard bare rabatt uten årsak.', ex: '30 %: en vare med 40 % rabatt uten likesinnede samme dag flagges.' },
  discMatchNR: { what: 'På: treff-testen gjelder bare rabattlinjer uten rabattårsak. Av: den gjelder alle rabatter.', tip: 'Behold på med mindre du vil se alle enkeltrabatter.', ex: '1 (på).' },
  campBongs: { what: 'Hvor mange bonger som må ha samme vare (EAN) med samme rabatt (avrundet prosent), over alle innlastede dager og butikker, før det regnes som en mulig sentral kampanje. Bongene tas med i analysen, men får et notat, og du blir spurt om det stemmer.', tip: 'Tom = ingen kampanjegjenkjenning. Svarer du Ja, flagges ikke rabatten lenger. Svarer du Nei, flagges den som vanlig, uten notat. Svarene huskes.', ex: '3: samme vare med 40 % rabatt på tre bonger.' },
  campCashiers: { what: 'Hvor mange ulike kasserere som må ha gitt samme rabatt på samme vare. Én person som gjentar det samme er mistenkelig, mens flere kasserere tyder på en kampanje fra sentralt hold.', tip: 'Sett til 1 for å regne også gjentakelser hos én kasserer som mulig kampanje (anbefales ikke).', ex: '2: bonger fra to kasserere.' },
  campDay: { what: 'En dag og butikk regnes som kampanjedag når minst så stor andel av salgene har rabatt (minst 30 salg den dagen). Rabatter den dagen får et notat om mulig kampanjedag; de flagges fortsatt.', tip: 'Tom = av. Mange rabatter samme dag tyder på sentral kampanje, ikke på enkeltkasserere.', ex: '40 %.' },
  askDevPct: { what: 'Flagger en vare lagt inn med «spør pris» når prisen avviker fra medianprisen for samme vare (EAN) samme dag i butikken med minst så mange prosent.', tip: 'Tom = av. Formatet for «spør pris» er ikke bekreftet på bongen; se Diagnostikk. Linjen under «SPØR PRIS» leses som varen.', ex: '5 %: spør pris 12 kr mot vanlig 20 kr flagges.' },
  askMinN: { what: 'Minste antall andre salg av varen samme dag og butikk som trengs for å sammenligne prisen.', tip: 'Øk for å unngå sammenligning mot tilfeldige enkeltsalg.', ex: '3 salg.' },
  askN: { what: 'Markerer en kasserer med minst så mange bonger med spør pris.', tip: 'Tom = av. Gir poeng til kassereren.', ex: '5 bonger.' },
  cardRetN: { what: 'Flagger returer der samme kort (samme leverandør og samme kortnummer slik det er trykt på bongen) går igjen minst så mange ganger innenfor tidsrommet.', tip: 'Tom = av. Krever skanning versjon 6. Bare siste fire siffer (og utstedernummer hvis det er trykt) leses, og to kort kan ha like siste siffer, så vurder sammen med beløp og kasserer.', ex: '3: tre returer på samme Visa innen 30 dager flagges.' },
  cardRetDays: { what: 'Tidsrommet, i dager, der returene på samme kort telles.', tip: 'Øk hvis du har lastet en lang periode.', ex: '30 dager.' },
  manualWords: { what: 'Ord som markerer en manuell kvittering eller til gode-lapp i linjer, betalingsmåter og tekstlinjer.', tip: 'Tom = av. Ordene er ikke bekreftet i ekte data. Legg til de ordene CW faktisk viser, for eksempel fra Diagnostikk.', ex: 'manuell kvittering, til gode.' },
  manualDays: { what: 'En manuell kvittering sammenlignes med andre bonger i samme butikk med samme beløp (også med motsatt fortegn) innenfor så mange dager.', tip: 'Øk for å fange til gode-lapper som brukes senere.', ex: '3 dager.' }
};

// ---- Tester: forklaring per innstillingsgruppe
const groups = {
  bong: { how: 'Sjekker hver kvittering for seg, uten å sammenligne med andre. Enkelt og raskt, men gir flest falske treff hvis grensene er lave.', flags: ['Stor utbetaling av panteretur på én bong', 'Mange pantelapper på én bong', 'Bong med bare pantelapper og kontant tilbake', 'Rundt hundre-beløp', 'Kassaoppgjør med differanse'], harmless: 'Kunder med mange flasker, firmakunder, gavekort, og oppgjør der en feil allerede er rettet.', needs: 'Pant og kontant tilbake krever skannet bong. Rundt beløp trenger ikke skanning. Kassadifferanse krever skannet oppgjør.' },
  patterns: { how: 'Ser etter gjentakelser blant flere bonger. Én retur sier lite, men tre like rett før stenging på samme kasse er et mønster.', flags: ['Flere små returer rett før stenging', 'Kontant tilbake uten salg flere ganger på samme kasse', 'Samme beløp gjentatt hos samme kasserer samme dag'], harmless: 'Rolige kvelder med få bonger, populære enhetspriser, og kunder som leverer tilbake flere varer.', needs: 'Små returer og samme beløp trenger bare listen. Kontant tilbake uten salg krever skannet innhold.' },
  falseRet: { how: 'Leter etter returer som ikke henger sammen med et salg. Bruker alle innlastede bonger i valgte butikker som grunnlag, ikke bare omfanget.', flags: ['Retur uten salg: varen er returnert, men ingen bong i datagrunnlaget har solgt den', 'Kortkjøp refundert kontant: salget var betalt med kort, men pengene betales tilbake som kontanter', 'Salg og retur av samme beløp på samme kasse innen kort tid'], harmless: 'Retur av varer kjøpt før perioden eller i en annen butikk, og vanlige angrer rett etter kjøp.', needs: 'Skannet innhold. «Retur uten salg» vurderes bare når minst 80 % av salgene i datagrunnlaget er skannet.' },
  afterSettle: { how: 'Et kassaoppgjør skal avslutte dagen på kassen. Testen flagger salg på samme kasse etter dagens siste oppgjør. Oppgjør før åpningstid regnes som forrige dags avslutning.', flags: ['Salg som kommer etter siste kassaoppgjør på kassen samme dag'], harmless: 'Kassen brukt etter et feilaktig tidlig oppgjør, eller oppgjør gjort midt på dagen ved skiftbytte.', needs: 'Bare listen (type og tidspunkt). Datagrunnlag i valgte butikker.' },
  deleted: { how: 'Bongnummer går opp med én for hver kvittering på en kasse. Hull, dobbelte nummer og feil rekkefølge kan tyde på slettede eller endrede bonger.', flags: ['Hull i bongnummer', 'Bongnummer og klokkeslett som ikke stemmer (nummer kommer i feil tidsrekkefølge)', 'Dobbelt bongnummer på samme kasse', 'Bong der løpenummer og tid ikke passer med naboene'], harmless: 'Filtrerte lister (en annen kvitteringstype mangler), bonger hentet i flere omganger, og kassaoppgjør som har egen nummerserie. Forutsetter at kvitteringstypene deler nummerserie per kasse, noe som ikke er bekreftet i ekte data.', needs: 'Bare listen. Gjelder bare hvis CW-listen ikke er filtrert på type, kasse eller tid.' },
  diff: { how: 'Følger kassadifferanser fra kassaoppgjør over tid for hver kasserer og kasse. En enkelt differanse har mange uskyldige årsaker. Gjentakelse er det interessante.', flags: ['Minus i flere kassaoppgjør fordelt på flere dager', 'Stort samlet minus', 'Kasserer der dager med flere returer har mer minus i kassen'], harmless: 'Kassen delt mellom flere kasserere, vekslepenger, rettelser dagen etter.', needs: 'Skannede kassaoppgjør.' },
  numbers: { how: 'Benfords lov sier at første siffer i naturlig forekommende beløp følger en bestemt fordeling (1 er vanligst med ca. 30 %). Tilpassede eller konstruerte beløp avviker ofte. I tillegg måles andelen hele kroner.', flags: ['Avvikende sifferfordeling hos en kasserer', 'Uvanlig høy andel hele kroner hos en kasserer', 'Kasserer med avvikende fordeling av siste siffer i totalbeløpet'], harmless: 'Butikker med mange enhetspriser, kontantsalg med avrunding, få bonger.', needs: 'Bare listen. Trenger mange bonger (standard minst 100 samlet og 50 per kasserer). Gir poeng til kassereren, ikke til bongene. En indikasjon, ikke bevis.' },
  disc: { how: 'Leser rabattlinjene og rabattårsakene på bongene. Rabatt uten årsak flagges over en prosentgrense, skjønnsmessige årsaker kan overvåkes, svært høye rabatter og rabatter uten treff på andre salg flagges, og mulige sentrale kampanjer får notat og et spørsmål til deg.', flags: ['Rabattlinje uten årsak over prosentgrensen', 'Rabatt med en overvåket årsak', 'Kasserer med uvanlig mange bonger med rabatt uten årsak, eller med overvåket årsak', 'Rabatt i prosentintervallet som overvåkes (standard 70–100 %)', 'Rabatt på en vare uten like rabatter på andre bonger samme dag'], harmless: 'Butikker som rutinemessig gir rabatt uten å velge årsak, og datovarer som er rabattert etter instruks.', needs: 'Skannet innhold med rabattdata (skanning fra versjon 3). Eldre skanninger må tas på nytt.' },
  member: { how: 'Leter etter misbruk av medlemsnummer, for eksempel at en ansatt taster sitt eget nummer på kunders kjøp. Bruker bare listen fra CW, så skanning trengs ikke, og alle innlastede bonger i valgte butikker er grunnlaget.', flags: ['Samme medlemsnr i to butikker så tett i tid at det er usannsynlig', 'Samme medlemsnr mange ganger samme dag', 'Samme medlemsnr svært mange ganger totalt', 'Medlemsnr som nesten bare brukes hos én kasserer', 'Ansattes nummer, og kasserer som taster eget nummer'], harmless: 'Trofaste kunder med mange handleturer, familier som deler nummer og små butikker med få kasserere.', needs: 'Bare listen fra CW. Lengre innlastet periode gir flere treff på «totalt».' },
  price: { how: 'Sammenligner enhetsprisen på samme vare i samme butikk samme dag. En pris som avviker mye fra den vanlige kan være manuell pris, spør pris eller feil pris.', flags: ['Varelinje med pris langt fra vanlig pris samme dag', 'Kasserer med mange slike linjer'], harmless: 'Kampanjer som starter midt på dagen, flerkjøp og vekt-varer med varierende pris.', needs: 'Skannet innhold fra versjon 4 (enhetspris). Eldre skanninger må tas på nytt.' },
  ku: { how: 'Kontrollerer Kjøpeutbytte-tabellen på bonger med medlemsnr: at den finnes, og at grunnlaget står i vanlig forhold til varesummen. Testene kalibrerer seg mot det som faktisk finnes i dataene.', flags: ['Medlemsbong uten Kjøpeutbytte-tabell', 'Grunnlag som avviker fra vanlig forhold til varesum'], harmless: 'Varer som ikke gir kjøpeutbytte, bonger med bare pant, og medlemmer uten utbytterett.', needs: 'Skannet innhold fra versjon 4. Tabellen er ikke bekreftet i ekte data ennå.' },
  events: { how: 'Leter etter ord på tekstlinjer som tyder på annullert, makulert, parkert, manuell eller spør pris. Slike hendelser er ikke observert i ekte data ennå; testen er en felle.', flags: ['Bong med tekstlinje med ett av hendelsesordene'], harmless: 'Tekstlinjer med tilfeldige ord, og kampanjetekster.', needs: 'Skannet innhold fra versjon 4. Diagnostikk viser alle ukjente linjer.' },
  ledger: { how: 'Kontrollerer regnskapet på hver bong: linjene mot Totalt, betalingene mot Totalt, MVA-tabellen og betalingsreferansen. Hver kontroll kalibrerer seg mot de skannede bongene, siden regnskapsmåten på bongen ikke er bekreftet i ekte data.', flags: ['Linjer som ikke summerer til Totalt', 'Betaling som ikke stemmer med Totalt', 'MVA som ikke stemmer eller ugyldig sats', 'Samme betalingsreferanse på flere bonger'], harmless: 'Pant, gavekort og rabatter som ikke står som egen linje, kontant avrunding, og bonger der Totalt er definert annerledes enn vi antar.', needs: 'Skannet innhold fra versjon 5 (Totalt, øreavrunding, MVA-tabell og betalingsreferanse). Eldre skanninger kan tas på nytt fra kortet «Bongregnskap og referanser».' },
  pant: { how: 'Pantelapp-sjekk: balansen mellom pantesalg og utbetalt panteretur per dag og butikk. Gjentatte pantebeløp sjekkes i gruppen Pantelapper.', flags: ['Utbetalt panteretur over pantesalget (rød rad i Pantelapp-sjekk)'], harmless: 'Pantelapper fra flasker kjøpt andre steder, og kampanjer som gir mye retur.', needs: 'Skannet innhold. Pant leses fra linjene «220 PANT» (salg) og «399 PANTELAPP» (retur).' },
  hours: { how: 'Åpnings- og stengetid brukes til å flagge salg utenfor åpningstid og til å avgjøre hvilken dag et kassaoppgjør hører til.', flags: ['Salg utenfor åpningstid (per kasse og dag)'], harmless: 'Forlenget åpningstid, rydding og testbonger. Sett riktige tider for å unngå støy.', needs: 'Bare listen (tidspunkt og type), ingen skanning.' },
  profile: { how: 'Kassererprofil sammenligner hver kasserer mot butikkens snitt: returandel, snittbeløp, pantelapper per salg og korrigeringer per salg. Dagsavstemming sammenligner forventet og telt kontant per kasse og dag.', flags: ['Kasserer som ligger uvanlig høyt eller lavt mot snittet', 'Avstemming med avvik mellom forventet og telt kontant'], harmless: 'Ulike skift og arbeidsoppgaver (en kasserer på pantekassen får høy returandel).', needs: 'Returandel og snittbeløp trenger bare listen. Pantelapper og korrigeringer krever skanning. Hver profilmarkering gir 2 poeng til kassereren.' },
  rules: { how: 'Egne avviksregler bygger du under Analyse → Detaljer → Egne avviksregler. Hver regel kan kombinere flere vilkår, og treff gir like mange poeng som angitt her.', flags: ['Bonger som oppfyller alle vilkårene i en av reglene dine'], harmless: 'Avhenger av reglene du lager.', needs: 'Regler som bruker innhold (merket *) krever skannet bong.' },
  lapp: { how: 'Skiller pantelapper på kode: 99 er lagt inn manuelt, 399 kommer fra pantemaskinen. Ser etter manuelle pantelapper, slettede pantelapper og samme pantelapp innløst flere ganger.', flags: ['Manuell pantelapp (kode 99) over beløpsgrensen', 'Kasserer med uvanlig mange bonger med manuell pantelapp', 'Pantelapp slettet med motlinje på samme bong', 'Samme pantelapp (nummer eller sum) innløst på flere bonger, også samme bongsum på samme kasse samme dag'], harmless: 'Pantemaskin som er ute av drift, lapper som ikke lar seg lese, kunder med flasker fra flere butikker og tilfeldig like beløp.', needs: 'Skannet innhold. Koden leses fra pantelinjen; lappnummer brukes bare hvis bongen viser et.' },
  voids: { how: 'Leser varelinjer som er slettet med en motlinje på samme bong. Sjekker om pant betales ut kontant etter at varene er slettet, og om makulerte varer (EAN) selges på nytt innen kort tid.', flags: ['Varelinjer slettet slik at bare pant og kontant tilbake står igjen', 'Makulert vare som ikke er solgt på nytt innen tidsrommet', 'Kasserer med mange slettede varelinjer'], harmless: 'Kunder som angrer, feilskanninger som rettes med en gang og varer som legges tilbake i hylla.', needs: 'Skannet innhold. Gjensalg vurderes bare når minst 80 % av salgene er skannet.' },
  special: { how: 'Leter etter ord som eget forbruk, internt forbruk, utbetaling, finansiering og sjekk i betalingsmåter, linjenavn og tekstlinjer. Samme ord kan søkes på under Filtrer → Innhold.', flags: ['Bong med ett av spesialordene', 'Kasserer med mange bonger med spesialord'], harmless: 'Rutinemessig internt forbruk, kontantuttak og andre tillatte spesialbetalinger i butikken.', needs: 'Skannet innhold. Ordene er ikke bekreftet i ekte data; Diagnostikk viser ukjente linjer.' },
  ask: { how: 'Sammenligner varer lagt inn med «spør pris» med dagens øvrige salg av samme vare (EAN) i butikken. Linjen under «SPØR PRIS» leses som varen.', flags: ['Spør pris-vare med pris som avviker fra dagens salg', 'Kasserer med mange bonger med spør pris'], harmless: 'Varer uten pris i systemet, nye varer og kampanjer som starter midt på dagen.', needs: 'Skannet innhold fra versjon 4 (enhetspris). Formatet er ikke bekreftet i ekte data.' },
  card: { how: 'Leter etter returer der samme kort (samme leverandør og samme kortnummer slik det er trykt) går igjen. Bruker bare det som står på bongen.', flags: ['Tre eller flere returer på samme kort innen tidsrommet'], harmless: 'Kunder som ofte handler og returnerer, og kort med like siste fire siffer.', needs: 'Skanning versjon 6 (kortdata). Formatet på kortlinjen er ikke bekreftet i ekte data.' },
  manual: { how: 'Leter etter manuelle kvitteringer og til gode-lapper, og sjekker om det finnes en annen bong i butikken med samme beløp innen få dager.', flags: ['Manuell kvittering eller til gode-lapp med samme beløp som en annen bong'], harmless: 'Reservekvitteringer skrevet inn etterpå og til gode-lapper som løses inn riktig.', needs: 'Skannet innhold. Ordene er ikke bekreftet i ekte data; legg til de som CW viser.' }
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
  'Bonger utenfor åpningstid': 'Bongen er tatt utenfor åpningstid.',
  'Medlem i flere butikker samtidig': 'Bongen er en av flere med samme medlemsnr i ulike butikker tett i tid.',
  'Medlemsnr flere ganger samme dag': 'Bongen er en av flere med samme medlemsnr samme dag.',
  'Medlemsnr brukt svært mye': 'Bongen har et medlemsnr som er brukt svært mange ganger.',
  'Medlemsnr nesten bare hos én kasserer': 'Bongen har et medlemsnr som nesten bare brukes hos denne kassereren.',
  'Ansatt-medlemsnr brukt': 'Bongen har et medlemsnr fra ansattlisten.',
  'Kasserer bruker eget medlemsnr': 'Kassereren har tastet sitt eget medlemsnr fra ansattlisten.',
  'Avvikende pris på vare': 'En varelinje har pris langt fra vanlig pris samme dag.',
  'Mange avvikende priser': 'Kasserer har mange varelinjer med avvikende pris (poeng til kassereren).',
  'Medlem uten kjøpeutbytte': 'Medlemsbongen mangler Kjøpeutbytte-tabellen.',
  'Kjøpeutbytte avviker fra varesum': 'Grunnlaget i Kjøpeutbytte avviker fra vanlig forhold til varesummen.',
  'Hendelsesord på bong': 'Bongen har en tekstlinje med ord som annullert, parkert, manuell eller spør pris. Bonger som allerede er flagget av «spør pris» eller «manuell kvittering» får ikke poeng to ganger.',
  'Linjer stemmer ikke med totalen': 'Linjene på bongen summerer ikke til Totalt.',
  'Betaling stemmer ikke med totalen': 'Betalingene på bongen stemmer ikke med Totalt.',
  'MVA stemmer ikke': 'MVA-tabellen på bongen går ikke opp.',
  'Ugyldig MVA-sats': 'MVA-tabellen har en sats som ikke står på listen over gyldige satser.',
  'Samme betalingsreferanse på flere bonger': 'Bongen deler betalingsreferanse med en annen bong.',
  'Avvikende siste siffer': 'Kasserer har avvikende fordeling av siste siffer i totalbeløpet (poeng til kassereren).',
  'Løpenummer avviker fra tid': 'Bongens tidspunkt passer ikke med nabonumrene på kassen.',
  'Retur og kassadifferanse henger sammen': 'Kasserer har mer minus i kassen på dager med mange returer (poeng til kassereren).',
  'Manuell pantelapp': 'Bongen har manuelt innlagt pantelapp (kode 99) over beløpsgrensen.',
  'Mange manuelle pantelapper': 'Kasserer har uvanlig mange bonger med manuell pantelapp (poeng til kassereren).',
  'Pantelapp slettet': 'Bongen har en pantelapp som er slettet med motlinje.',
  'Pantelapp innløst flere ganger': 'Bongen er en av flere med samme pantelapp (nummer eller sum) innen tidsrommet eller på samme kasse samme dag.',
  'Varelinjer slettet, pant utbetalt kontant': 'Varelinjene er slettet og bare pant og kontant tilbake står igjen.',
  'Makulert vare ikke solgt på ny': 'En slettet vare er ikke solgt på nytt i butikken innen tidsrommet.',
  'Mange makulerte varelinjer': 'Kasserer har mange slettede varelinjer (poeng til kassereren).',
  'Spesialbetaling på bong': 'Bongen har eget forbruk, internt forbruk, utbetaling, finansiering eller sjekk.',
  'Mange spesialbetalinger': 'Kasserer har mange bonger med spesialord (poeng til kassereren).',
  'Høy rabattprosent': 'En rabattlinje ligger i prosentintervallet som overvåkes.',
  'Rabatt uten treff på andre salg': 'Rabatten har ingen like på samme vare i butikken samme dag.',
  'Spør pris avviker fra dagens salg': 'Spør pris-varen har pris som avviker fra dagens salg av samme vare.',
  'Mange spør pris': 'Kasserer har mange bonger med spør pris (poeng til kassereren).',
  'Gjentatte returer på samme kort': 'Bongen er en av flere returer på samme kort.',
  'Manuell kvittering matcher annen bong': 'Manuell kvittering eller til gode-lapp har samme beløp som en annen bong.',
  'Regel': 'Bongen treffer en av dine egne avviksregler.'
};

module.exports = { fields, groups, weights };
