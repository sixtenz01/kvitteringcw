# Kvitteringshenter (ny kjerne)

Chrome MV3-utvidelse for Lindbak Chain Web → Kvitteringsjournal. Leser kun gridets data og DOM; ingen API-kall, ingen sending ut av nettleseren.

## Funksjoner

- Filter: butikk, kasse, kasserer, kvitteringstype, dato/tid (med hurtigvalg), sumintervall, negativ sum, medlem.
- Sortering på sum og tid.
- Valg av flere kvitteringer, sum for valgte.
- Duplikatsjekk: samme beløp, butikk, kasse og minutt.
- Skanning av pant: åpner hver synlige salgskvittering (type 1) i Lindbaks eget visningsfelt, leser linjene `NNN PANT` (salg) og `NNN PANTELAPP` (retur), og cacher beløp lokalt per kvittering. Filter «Pant» og pant-total for valgte. Ca. 0,5–1 s per kvittering; avbrytes med Stopp.
- Lagrede filtre (egen IndexedDB `kvr-store`, aldri localStorage).

## Funksjoner i v3

- **Søk i CW** (hele journalen): dato, butikker (med navn fra CW), medlem, lojalitets-ID, vare/EAN, bongnr. Fyller CW sine egne felt og trykker OPPDATER.
- **Butikknavn** hentes fra CW sin butikkliste og vises i alle filtre og i CSV.
- **Skanning:** leser varelinjer, betaling og pant fra kvitteringene. Hver kvittering åpnes i CWs visningsfelt og leses derfra (ca. 1 s per bong). Pluginen sender aldri egne kall mot CWs API; `test/noapi.test.js` feiler hvis kildekoden inneholder `fetch`, `XMLHttpRequest`, `$http` eller `/Api/`.
- **Varegrupper** med nøkkelord (`ord` = starten av ord, `*ord` = inneholder, `#kode` = varenr/EAN). Ekskluder-ord treffer hvor som helst. Regelsettet bygges opp fra «Varer uten gruppe», og kan eksporteres/importeres.
- **Avvik** (kun på knapp): stor panteretur, mange pantelapper, kontant tilbake uten salg, rundt beløp.
- **Eksport:** CSV (semikolon, UTF-8 med BOM) for synlige eller valgte kvitteringer.

## Lagring (påvirker ikke Lindbak)

All lagring (innstillinger, lagrede filtre, regler, skannecache) ligger i en egen IndexedDB (`kvr-store`). Ingenting skrives til localStorage eller sessionStorage, så Lindbaks egne data kan ikke bli påvirket. Cachen har hard grense på 10 000 kvitteringer og 25 MB (eldste fjernes), og hver skannede bong har grenser (maks 500 linjer, 80 tegn per varenavn, 20 betalingsmåter). Gamle `kvr.*`-nøkler i localStorage fra tidligere versjoner flyttes og slettes ved oppstart.

## Rapport, kassaoppgjør og egne regler

- **Rapport:** dagsrapport for synlige kvitteringer, per kasse eller kasserer, valgfritt per dag: antall salg, sum, retur, pant (skannede), avvik og kassadifferanse. CSV-eksport.
- **Kassaoppgjør (type 2):** skannes og leses ut: telt kontant/sjekk/kreditt/sum, differanse, pose-nr, sendt bank og valører. Rød markering ved differanse over terskelen (standard 1 kr), som også er en innebygd avviksregel.
- **Egne avviksregler:** bygg regler med flere vilkår (OG) på sum, klokkeslett, kasse, kasserer, butikk, type, medlem, panteretur, pantsalg, antall pantelapper/varelinjer, kontant tilbake, kassadifferanse, vare, varegruppe og betalingsmåte. Regler som bruker innhold (*) krever skanning, og kjøres kun når du trykker «Kjør avviksjekk».

## Revisjon: omfang og analyser

**Omfang for analysen** (Analyse → Sjekk først) velger hva «Kjør analyse» ser på, uavhengig av filtrene i listen: periode (med hurtigvalg), butikk, kasserer, kasse, og alt dette kombinert. «Sammenlign med en annen periode» gir periode A mot B. Valget huskes. Går omfanget utenfor det som er hentet fra CW, vises en advarsel, og «Kjør analyse» henter det som mangler (setter datoer og butikker i CW, og tømmer medlems-, vare- og bongsøk). Tester som trenger hele bildet (hull i bongnummer, salg etter kassaoppgjør, falsk retur) bruker alle innlastede bonger i valgte butikker og viser bare funn som gjelder omfanget.

Nye tester (vekter og terskler justeres under Mer → Innstillinger):

- **Falsk retur:** retur uten salg av varen i datagrunnlaget (krever at minst 80 % av salgene er skannet), kortkjøp refundert kontant, og salg og retur av samme beløp på samme kasse innen 60 minutter. Ren panteretur regnes ikke.
- **Salg etter kassaoppgjør:** salg på en kasse etter dagens siste kassaoppgjør (frist 5 min). Oppgjør før åpningstid regnes som forrige dags avslutning.
- **Slettede bonger:** hull i bongnummer per kasse, bongnummer og klokkeslett som ikke stemmer overens, og dobbelt bongnummer. Forutsetter at alle kvitteringstyper deler nummerserie per kasse.
- **Kassadifferanse over tid:** per kasserer og kasse: minst 3 oppgjør med minus fordelt på flere dager, eller minus totalt over 100 kr.
- **Benford og tallanalyse:** første siffer i totalbeløp mot Benford (MAD, Nigrinis grenser), og andel hele kroner per kasserer mot butikken. Diagram under Analyse → Diagram. Funn per kasserer (ikke per bong) teller i kassererrangeringen.

Analysene er indikatorer som må forklares, ikke bevis.

## Rabatter og kuponger

Skanningen leser nå to ting fra kvitteringen (skannepost v3):

- **Rabatt:** linjen `Rabatt: Kr x (y %)` under en vare, med `Rabatt årsak:` (ofte tom). Varebeløpet på kvitteringen er etter rabatt.
- **Kupong:** linjer `Kupong (id - navn)`, antatt kampanjer lagt inn sentralt (CN/VPI). Beløpet er ofte 0,00; linjen viser at kampanjen er knyttet til bongen, ikke at den er innløst. Kupongene regnes ikke lenger som betalingsmåter.

Bruk:

- **Rabattårsaker** (tekstnr i Lindbak): 1 Datovare, 2 Feil pris, 3 Prisløfte, 4 Reserveløsning kupong, 5 Annen rabattårsak, 6 Best før. Pluginen kjenner igjen både nummer og tekst på kvitteringen; ukjent tekst vises som den står.
- **Filter:** «Rabatt (krever skanning)» under Skann: har rabatt, uten årsak, med årsak, har kupong, eller én bestemt årsak.
- **Analyse → Detaljer → Rabatter og kuponger:** per kasserer antall bonger med rabatt, rabatt i kr, uten årsak, kuponger; butikksum; tabell «Rabatt per årsak» (klikk en årsak for å filtrere listen) og matrisen «Kasserer × årsak»; de vanligste kampanjene. Test «Rabatt uten årsak» flagger rabattlinjer på minst 30 % uten årsak (terskel kan endres, tom = av). «Mange rabatter uten årsak» flagger kasserere som ligger minst 1,5× butikkens andel.
- **Overvåkede rabattårsaker:** test «Rabatt med overvåket årsak» flagger bonger med rabattlinje der årsaken står på en liste (standard 2 Feil pris, 4 Reserveløsning kupong, 5 Annen rabattårsak). Terskler under Mer → Innstillinger → Rabatt: årsaker (tekstnr, komma; tom = av), rabatt minst x % og y kr (standard 0), og «Mange rabatter med overvåket årsak» når en kasserer har minst 3 bonger (tom = av). Egen vekt for begge (standard 3), justerbar under Innstillinger. Kassererfunnet gir poeng på kassereren, ikke på bongene.
- **Egne regler:** felt for rabatt (kr), høyeste rabatt (%), rabattårsak, rabattlinjer uten årsak, antall kuponger og kupong (id/navn).
- **Fokus:** rabatt og kuponger per kasserer eller kasse.

## Medlemsnummer, pris, kjøpeutbytte og hendelsesord (v4)

Skanningen (v4) leser i tillegg enhetspris (`Antall: … à Kr …`), Kjøpeutbytte-tabellen (`Grunnlag | Kjøpeutbytte | MVA bonus`), hendelsesord på tekstlinjer og ukjente linjer. Eldre skanninger tas på nytt ved neste skanning. Alt leses fra iframen; ingen kall mot CWs API (`test/noapi.test.js`).

- **Medlemsnummer** (kun listen fra CW, ingen skanning, alle innlastede bonger i valgte butikker): samme medlemsnr i to butikker innen 30 min, minst 4 bonger samme dag, minst 15 totalt, og nesten bare hos én kasserer (minst 5 bonger, over 80 % og minst «Avviker fra snittet» × kassererens vanlige andel). Ansattliste (Innstillinger → Medlemsnummer): `1234567` flagger alle bonger med nummeret, `12=1234567` flagger i tillegg når kasserer 12 selv har tastet det (høyest poeng). Kort: Analyse → Detaljer → Medlemsnummer (klikk nummer for å filtrere).
- **Pris per vare:** samme vare, samme butikk og dag, enhetspris (rabatt lagt tilbake) som avviker minst 10 % fra vanlig pris (den prisen flest bonger har, minst 60 %, minst 5 salg). Kasserer markeres ved minst 3 avvik.
- **Kjøpeutbytte:** medlemsbong uten tabell, og grunnlag som avviker fra vanlig forhold til varesum (median over minst 10 bonger). Testene kalibrerer seg: finnes tabellen på under 80 % av medlemsbongene, regnes fravær ikke som avvik. Tabellen er ikke bekreftet i ekte data.
- **Hendelsesord:** tekstlinjer (ikke varenavn) med annull, makul, storn, parker, på vent, manuell, spør pris, overstyr, prisendring, kansell eller avbrutt. Annullert, manuell pris, parkert og spør pris er ikke observert ennå.
- **Diagnostikk** (Innstillinger → Generelt, eller kortet «Pris, kjøpeutbytte og hendelser»): hendelsesord og ukjente linjer med antall og eksempelbong; «Kopier som tekst» gir en liste til deling.
- **Klokkeslett:** pluginen bruker tiden som vises i CW-listen (lokal tid). Mangler cellen, brukes rådata, flyttet til norsk tid hvis de har tidssone (`Z`/`+hh:mm`). Skanningen leser også dato og tid i bongens topptekst (`Kvittering: <nr> <dato> <tid>`), og Diagnostikk sammenligner liste og bong. Ligger listen konsekvent bak eller foran (minst 30 min, minst 5 bonger), foreslår Diagnostikk en forskyvning; den kan også settes under Innstillinger → Generelt. Topptekstformatet er ikke bekreftet i ekte data.

## Bongregnskap, notatlogg og statistikk (v5, versjon 3.12.0)

Skanningen (v5) leser i tillegg `Totalt`/`Sum`, `Øreavrunding`, `Referanse`/`TransId` og MVA-tabellen (`MVA-grunnlag | MVA-% | MVA | Sum`). Etter hvert oppslag kontrolleres løpenummeret i topptekst (`Kvittering: <nr>`) mot valgt rad; feil bong avvises etter ett nytt forsøk (aktiv etter tre treff). Skanninger i eldre versjon tas på nytt fra kortet «Bongregnskap og referanser» etter en bekreftelse med antall og omtrentlig tid.

- **Bongen går opp:** linjer (etter rabatt, med/uten øreavrunding) mot Totalt, betalinger minus kontant tilbake mot Totalt, MVA (sats × grunnlag, grunnlag + MVA = sum, sum = Totalt, gyldig sats 0/12/15/25 %) og samme TransId/Referanse på flere bonger. Hver kontroll kalibrerer seg: minst 10 vurderte bonger og 80 % som stemmer, ellers regnes avvik ikke som funn. Egen gruppe under Innstillinger. CSV-eksporten har kolonner for betaling, rabatt, kuponger, betalingsref og Totalt på bong.
- **Notatlogg:** hver endring av notat/status lagres som hendelse med lenket SHA-256 (append-only). «Notatlogg…» under Oppfølging viser kjeden, og `data/notatlogg.json` følger revisjonsrapporten og står i KONTROLLSUM.txt.
- **RRS 0–100:** `100·(1−2^(−poeng/8))` vises ved siden av poengene (4 = 29, 8 = 50, 16 = 75); nivåene er uendret.
- **Krymping i kassererprofilen:** `(n·x + k·snitt)/(n + k)` med k = 10 (innstilling, tom = rå tall).
- **Siste siffer** (χ² mot medianfordelingen blant kassererne), **løpenummer mot tid** (bong utenfor tidene til tre nabonumre på hver side) og **retur mot kassadifferanse** (Spearman ρ over dager).
- **Herding:** CSV-injeksjon (`'` foran tekst som starter med `= + - @`), NFC og skjulte tegn i bongtekst, beløpsparser (U+2212, parentes, etterstilt minus, tusenskille), datovalidering, medlemsnr (`007` = `7`), ingen 0 kr-duplikater, ikke-endelige summer hoppes over, og lengdegrense på innstillinger.

Skanner fra tidligere versjoner (v2) har ikke rabattdata. «Skann synlige» skanner dem på nytt, og filteret skjuler dem til de er skannet (gul stripe viser antallet).

Ikke verifisert: om kvitteringen skriver årsaken som nummer eller tekst (begge håndteres), og hvordan lokale kampanjer ser ut. Dette trenger eksempler fra ekte kvitteringer.

## Kontroll-fanen

- **Arbeidsoppgaver:** lagre filter + datovalg (i går, i dag, siste 7 dager, forrige uke) + skanning + kontroller + sammendrag som én knapp. «Morgenkontroll (i går)» er innebygd: henter gårsdagen fra CW, skanner, kjører alle kontroller og viser et sammendrag som kan kopieres som tekst. Lagrede filtre (Filter-fanen) setter bare filter.
- **Kjør alle kontroller:** kjører først avviksjekken per kvittering (Avvik-fanen) og deretter kontrollene under. Funn som flagger bonger legges i samme avviksliste («Kun avvik»). Tom terskel slår av en sjekk.
- **Kassererprofil:** returandel, snittbeløp, pantelapper per salg og korrigeringer (negative varelinjer utenom pant) per kasserer mot butikksnittet. Rødt = minst 1,5× snittet (innstilling).
- **Mønstre:** små returer rett før stenging, kontant tilbake uten salg flere ganger på samme kasse, samme beløp gjentatt (per kasserer og dag). Dette er kontroller på tvers av bonger; «Mulige duplikater» i Filter-fanen er noe annet (samme beløp, kasse og minutt).
- **Pantelapp-sjekk:** samme pantebeløp utbetalt flere ganger, og pantebalanse (salg mot utbetalt) per dag og butikk.
- **Sekvens:** hull i bongnummer per kasse (kun pålitelig når CW-listen ikke er filtrert på type, kasse eller tid) og bonger utenfor åpningstid.
- **Dagsavstemming:** forventet kontant (kontant − kontant tilbake fra salg) mot telt kontant i kassaoppgjør, per kasse og dag, med bank/kort og sendt bank til info.
- **Oppfølging:** notat og status (sjekket / til oppfølging) per bong, oppfølgingsliste, filter og CSV-eksport. Radene får en prikk.
- **Sammenlign bonger:** velg to bonger, trykk «Sammenlign» nederst. Linjer som ikke finnes på den andre markeres.
- **Tastaturflyt:** ↑/↓ bytter bong, N notat, M velg/fjern, Esc lukker. Kan slås av.

## Brukerveiledning

`docs/brukerveiledning.html` er en frittstående brukerveiledning (norsk, med skjermbilder og diagrammer, søk i innstillingene og mørk drakt). Den forklarer panelet fane for fane, hvordan analysen og poengene virker, alle testene med eksempler, rabatt og kuponger, revisjonsrapporten og verifisering av kontrollsummer, og hver innstilling med standardverdi og tips.

Veiledningen bygges av `docs/manual/`: `manual.src.html` (tekst), `help.js` (forklaring av hver innstilling, test og poengvekt), `diagrams.js` (SVG), `style.css`, `shots.js` (skjermbilder fra pluginen mot oppdiktede data i `fixture.js`) og `build.js`.

```
NODE_PATH=<global node_modules> node docs/manual/shots.js   # ta nye skjermbilder (valgfritt)
node docs/manual/build.js                                  # bygg docs/brukerveiledning.html
NODE_PATH=<global node_modules> node docs/manual/pdf.js     # lag docs/Kvitteringshenter-brukerveiledning.pdf (A4, innholdsfortegnelse med sidetall)
node extension/test/docs.test.js                           # sjekker at alt i pluginen er dokumentert
```

Testen feiler hvis en innstilling, poengvekt, test, fane eller kort mangler i veiledningen, så den holdes à jour når pluginen endres.

## Revisjonsrapport

Mer → Eksport → **Lag revisjonsrapport…** (også som knapp i Sjekk først etter en analyse). Rapporten bygger på den siste analysen og lagres som én ZIP:

- `rapport.html`: forside (referanse, utarbeidet av, tidspunkt, omfang), sammendrag, omfang og datagrunnlag, **dekningsgrad og begrensninger**, metode med alle terskler og poeng (endrede verdier er merket), funn per test, rangerte flaggede bonger med forklaring og notater/status, bevisbilder, kontrollsummer og forbehold. Kan skrives ut til PDF fra nettleseren.
- `bevis/`: PNG av de høyest rangerte bongene (standard 30, 0 = ingen, maks 100). Bevisbildene har topptekst med butikk, kasse, kasserer, bongnr og tid, men aldri medlemsnummer.
- `data/kvitteringer.csv`: alle kvitteringer i datagrunnlaget (også de tester på tvers av bonger brukte utenfor omfanget, merket «I omfang»). `data/innhold.json`: skannet bonginnhold. `data/funn.csv` og `data/flaggede_bonger.csv`.
- `innstillinger.json`: terskler, poeng, egne regler, varegrupper og butikknavn slik de var i analysen. Kan leses inn under Mer → Innstillinger → Importer for å gjenta analysen.
- `KONTROLLSUM.txt`: SHA-256 for alle filer, i formatet `sha256sum -c KONTROLLSUM.txt` forstår. Kontrollsummen for datasettet er SHA-256 av `data/kvitteringer.csv`, og for innholdet SHA-256 av `data/innhold.json` (sortert på bong-ID, uten skannetidspunkt), så den kan kontrolleres uavhengig av pluginen.

Rapporten viser det som gjaldt da analysen ble kjørt (omfang, bonger, skanninnhold, terskler), også om listen eller innstillingene er endret etterpå; en merknad forteller om dette. Kontrollsummen for selve ZIP-filen vises i panelet og lagres i en logg («Tidligere rapporter», bare i denne nettleseren), for å kunne noteres i saken. Kontrollsummer viser at eksporten ikke er endret, ikke at dataene i Lindbak er riktige. Funn er indikasjoner, ikke bevis.

## Innstillinger og hjelp

- **Mer → Innstillinger** (eller ⚙ øverst) samler alle terskler, avviksgrenser og poeng, gruppert per test: Avvik per bong, Mønstre, Falsk retur, Salg etter kassaoppgjør, Slettede bonger, Kassadifferanse over tid, Tallanalyse, Rabatt, Pant, Åpningstider, Kassererprofil og Egne regler. Hver gruppe viser forklaring, enhet, hvor mange verdier som er endret, og «Standard for denne gruppen».
- Tester som kan slås av har en «På»-bryter (avskrudd = tom verdi = testen kjøres ikke). Endrede verdier merkes med gul kant. Alt lagres med en gang.
- Terskler gjelder fra neste analyse (Sjekk først og Innstillinger viser en melding og en knapp for å kjøre på nytt). Poeng gjelder med en gang.
- **Generelt:** egne butikknavn, tastaturflyt, tilbakestilling av plassering, **Eksporter** og **Importer** innstillinger (JSON med terskler, poeng, egne regler, varegrupper og butikknavn) og «Alt til standard».
- «Juster» ved siden av hver forklaring i «Hvorfor flagget?» åpner riktig innstillingsgruppe.
- **?** øverst: kort veiledning, tegnforklaring (rød kant, gul stripe, risikonivå, «Ny», lenker, rødt tall) og snarveier. En ikke-blokkerende melding vises første gang.
- Slettinger og tilbakestillinger bekreftes i panelet, ikke med nettleserdialoger.
- Piltaster (← → Home End) bytter fane når en fane har fokus. Kortene i Detaljer kan foldes sammen, og valget huskes.

## Oppbygging av panelet

**Analyse** har fem delfaner: **Sjekk først** (én prioritert liste med risikoscore, forklaring og handlinger), **Diagram**, **Rapport**, **Fokus** og **Detaljer** (resultater fra kontrollene som sammenfoldbare kort, egne regler, arbeidsoppgaver og notater).

- **Sjekk først:** «Kjør analyse» skanner det som mangler, kjører avvik og kontroller på tvers av bonger, og rangerer kvitteringene etter risikoscore (summen av vekter per avvik, justerbare under Mer → Innstillinger; høy ≥ 8, middels ≥ 4). Over listen står de fem kasserene med høyest score. Hver kvittering kan åpnes: «Hvorfor flagget?» med terskler og tall, bonglinjene (eller kassaoppgjøret), og knappene Sjekket, Til oppfølging, Notat, Velg og Vis i listen. Sjekkede bonger skjules (kan vises igjen), og bonger som ikke var flagget i forrige analyse merkes «Ny».
- **Diagram:** salg per time, salg per dag, returandel per kasserer mot butikksnittet, kasse × time-kart og pant per dag (salg mot utbetalt). Klikk en søyle, rute eller kasserer for å filtrere listen; diagrammene ser bort fra filteret de selv styrer, så de ikke krymper. Hover viser tall, og «Tabell» viser samme data som tabell. Fargene (blå og oransje for to serier, ett grønt hue for størrelse) er validert for fargesyn.

Fem faner: **Hent** (søk i hele journalen via CW), **Filtrer** (butikk som søkbar liste med navn og antall, som under Hent; dato/tid; kasse/kasserer/type som piller; sum, medlem, bong, vare, notat, sortering), **Skann** (skanning, pant, varegrupper), **Analyse** (Rapport, Avvik og Kontroll som delfaner) og **Mer** (delfanene Eksport og Innstillinger).

- **Skannestatus** vises alltid under tallene («Skannet 4 av 5» med «Skann nå»). Filter som krever skanning (pant, vare, varegruppe) viser en gul stripe med hvor mange som mangler. Skanning dekker alle kvitteringer som passerer de andre filtrene, også de som pantfilteret ellers skjuler.
- **Én statuslinje** øverst viser fremdrift og resultat, og forsvinner av seg selv.
- **Nullstilling uten refresh:** alt du har satt vises som chips under tallene: filtre, sortering, valgte kvitteringer, avviksmarkering og CW-søk. Hver chip fjernes med ett klikk, og «Nullstill alt» fjerner alt (også CW-filteret du satt i Hent-fanen).
- **Fokus:** klikk på en kasserer eller kasse (lenker i rapporter, funn og avvikslister, pillene under Filtrer, eller Alt+klikk på KASSERER/KASSE i selve listen) for å filtrere listen og se alt om den: nøkkeltall, hvilke kasser/kasserere den er brukt sammen med, kassererprofil mot butikksnitt, pant og betaling, varegrupper, avvik og funn, kassaoppgjør, notater og aktivitet per time.
- **⤢** bytter panelstørrelse: *Vanlig*, *Stor* (dokket til høyre, Lindbak-lista synlig, to kolonner) og *Full* (hele skjermen, flere kolonner). Valget huskes (`K.wide`: 0/1/2) og kan settes under Innstillinger → Generelt. «Vis i listen» fra Full går midlertidig til Stor. Tabeller har faste overskrifter med forklaring ved hover.
- **Kontroll** viser et resultatkort først («2 funn · 4 flaggede bonger …») med hopplenker til profil, funn, pant og avstemming. Detaljene skjules til kontrollene er kjørt.
- Faste knapper nederst: Velg alle, Fjern valg, Sammenlign (ved to valgte), CSV og PNG.

## Avkrysning, fremdrift og PNG

- Egen avkrysningskolonne (col/th/td, samme teknikk som gamle pluginen) med «velg alle synlige». Settes inn på nytt når gridet tegnes om.
- Skanning og eksport viser fremdriftslinje, prosent og tid igjen. «Prøv feilede på nytt» kjører bare de som feilet.
- PNG: valgte kvitteringer blir hele kvitteringen som PNG (ZIP ved flere), med valgfri topptekst fra listen (butikk med navn, kasse, kasserer, bongnr, tid). Medlemsnr tas bare med hvis du huker av.

## Bruk av panelet

- Dra i toppfeltet for å flytte. Plassering huskes. Dobbeltklikk toppfeltet for å nullstille plassering.
- Panelet kan også dras i hjørnet nede til høyre for å endre størrelse; størrelsen huskes.
- `–`/`+`-knappen, klikk på den lille pillen eller `Alt+K` skjuler og viser panelet.
- Seksjoner kan åpnes og lukkes; valget huskes.
- Panelet holdes innenfor skjermen ved endret vindusstørrelse.

## Installere

`chrome://extensions` → Utviklermodus → Last inn upakket → velg denne mappen. Krever Chrome 111+ (content script kjører i `MAIN` for å nå Kendo-gridet).

## Test

```
node test/logic.test.js
NODE_PATH=<global node_modules> node test/smoke.js   # Playwright, fiktivt grid
NODE_PATH=<global node_modules> node test/audit.js   # revisjonstester og omfang, eget datasett
NODE_PATH=<global node_modules> node test/settings.js # innstillinger, hjelp, bekreftelser, import/eksport, piltaster
node test/report.test.js                              # SHA-256, kontrollsummer og rapportbygger (uten nettleser)
node test/noapi.test.js                               # ingen fetch/XHR/API-kall i kildekoden
NODE_PATH=<global node_modules> node test/medlem.js    # medlemsnr, pris, kjøpeutbytte, hendelsesord og diagnostikk
NODE_PATH=<global node_modules> node test/tid.js       # klokkeslett: liste mot bong, UTC, forskyvning
NODE_PATH=<global node_modules> node test/skann.js     # feil bong i visningsfeltet avvises
NODE_PATH=<global node_modules> node test/regnskap.js  # Totalt, betaling, MVA, referanser, omskanning, CSV
NODE_PATH=<global node_modules> node test/rapport.js  # lager rapport i panelet, pakker ut ZIP og verifiserer alle kontrollsummer
node test/docs.test.js                               # dekning av innstillinger, vekter, faner og kort i brukerveiledningen
NODE_PATH=<global node_modules> node test/stor.js  # panelstørrelse: Vanlig/Stor/Full, dokking, kolonner, husking
TOUR=<mappe> NODE_PATH=<global node_modules> node test/tour.js  # skjermbilder av alle faner (valgfritt)
```

## Ikke verifisert mot ekte side

- Skanning: venter til iframen får innhold etter radvalg (6 s timeout per kvittering). Tidspunktet og om iframen tømmes riktig er kun testet mot fiktivt grid.
- Pant gjenkjennes kun som `NNN PANT` / `NNN PANTELAPP` (1–4 sifre i starten). Andre pantvarer fanges ikke.
- Skjult/omsortert rader via `tr.style.display` og DOM-rekkefølge i Kendo-gridet (testet kun mot et enkelt fiktivt grid).
- Avkrysningsboks plasseres i første celle; sjekk at den ikke kolliderer med Lindbaks egen kolonne.
- `receiptType 11` er uavklart og vises som «PDA-operasjon (uavklart)».
