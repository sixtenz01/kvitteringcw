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
- **Butikknavn** hentes fra CW sin butikkliste (ellers fra BUTIKK-kolonnen), kan overstyres med egne navn, og vises i alle filtre og i CSV. Nummer over fire siffer vises som avdeling og nivå.
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

**Omfang for analysen** (Analyse → Sjekk først) velger hva «Kjør analyse» ser på, uavhengig av filtrene i listen: periode (med hurtigvalg), butikk, kasserer, kasse, og alt dette kombinert. «Sammenlign med en annen periode» gir periode A mot B. Valget huskes. Går omfanget utenfor det som er hentet fra CW, vises en advarsel, og «Kjør analyse» henter det som mangler (setter datoer og butikker i CW, og tømmer medlems-, vare- og bongsøk). Tester som trenger hele bildet (dobbelt bongnummer, salg etter kassaoppgjør, falsk retur) bruker alle innlastede bonger i valgte butikker og viser bare funn som gjelder omfanget.

Nye tester (vekter og terskler justeres under Mer → Innstillinger):

- **Falsk retur:** retur uten salg av varen i datagrunnlaget (krever at minst 80 % av salgene er skannet), kortkjøp refundert kontant, og salg og retur av samme beløp på samme kasse innen 60 minutter. Ren panteretur regnes ikke.
- **Salg etter kassaoppgjør:** salg på en kasse etter dagens siste kassaoppgjør (frist 5 min). Oppgjør før åpningstid regnes som forrige dags avslutning.
- **Slettede bonger:** bongnummer og klokkeslett som ikke stemmer overens, og dobbelt bongnummer. Forutsetter at alle kvitteringstyper deler nummerserie per kasse.
- **Kassadifferanse over tid:** per kasserer og kasse: minst 3 oppgjør med minus fordelt på flere dager, eller minus totalt over 100 kr.
- **Benford og tallanalyse:** første siffer i totalbeløp mot Benford (MAD, Nigrinis grenser), og andel hele kroner per kasserer mot butikken. Diagram under Analyse → Diagram. Funn per kasserer (ikke per bong) teller i kassererrangeringen.

Analysene er indikatorer som må forklares, ikke bevis.

## Rabatter og kuponger

Skanningen leser nå to ting fra kvitteringen (skannepost v3):

- **Rabatt:** linjen `Rabatt: Kr x (y %)` under en vare, med `Rabatt årsak:` (ofte tom). Varebeløpet på kvitteringen er etter rabatt.
- **Kupong:** linjer `Kupong (id - navn)`, antatt kampanjer lagt inn sentralt (CN/VPI). Beløpet er ofte 0,00; linjen viser at kampanjen er knyttet til bongen, ikke at den er innløst. Kupongene regnes ikke lenger som betalingsmåter.

Bruk:

- **Rabattårsaker** (tekstnr i Lindbak): 1 Datovare, 2 Feil pris, 3 Prisløfte, 4 Reserveløsning kupong, 5 Annen rabattårsak, 6 Best før. Pluginen kjenner igjen både nummer og tekst på kvitteringen; ukjent tekst vises som den står.
- **Filter:** «Rabatt» under Filtrer → Innhold (krever skanning): har rabatt, uten årsak, med årsak, har kupong, eller én bestemt årsak.
- **Analyse → Detaljer → Rabatter og kuponger:** per kasserer antall bonger med rabatt, rabatt i kr, uten årsak, kuponger; butikksum; tabell «Rabatt per årsak» (klikk en årsak for å filtrere listen) og matrisen «Kasserer × årsak»; de vanligste kampanjene. Test «Rabatt uten årsak» flagger rabattlinjer på minst 30 % uten årsak (terskel kan endres, tom = av). «Mange rabatter uten årsak» flagger kasserere som ligger minst 1,5× butikkens andel.
- **Overvåkede rabattårsaker:** test «Rabatt med overvåket årsak» flagger bonger med rabattlinje der årsaken står på en liste (standard 2 Feil pris, 4 Reserveløsning kupong, 5 Annen rabattårsak). Terskler under Mer → Innstillinger → Rabatt: årsaker (tekstnr, komma; tom = av), rabatt minst x % og y kr (standard 0), og «Mange rabatter med overvåket årsak» når en kasserer har minst 3 bonger (tom = av). Egen vekt for begge (standard 3), justerbar under Innstillinger. Kassererfunnet gir poeng på kassereren, ikke på bongene.
- **Egne regler:** felt for rabatt (kr), høyeste rabatt (%), rabattårsak, rabattlinjer uten årsak, antall kuponger og kupong (id/navn).
- **Fokus:** rabatt og kuponger per kasserer eller kasse.

## Medlemsnummer, pris, kjøpeutbytte og hendelsesord (v4)

Skanningen (v4) leser i tillegg enhetspris (`Antall: … à Kr …`), Kjøpeutbytte-tabellen (`Grunnlag | Kjøpeutbytte | MVA bonus`), hendelsesord på tekstlinjer og ukjente linjer. Eldre skanninger tas på nytt ved neste skanning. Alt leses fra iframen; ingen kall mot CWs API (`test/noapi.test.js`).

- **Medlemsnummer** (kun listen fra CW, ingen skanning, alle innlastede bonger i valgte butikker): samme medlemsnr i to butikker innen 30 min, minst 4 bonger samme dag, minst 15 totalt, og nesten bare hos én kasserer (minst 5 bonger, over 80 % og minst «Avviker fra snittet» × kassererens vanlige andel). Ansattliste (Innstillinger → Medlemsnummer): `1234567` flagger alle bonger med nummeret, `12=1234567` flagger i tillegg når kasserer 12 selv har tastet det (høyest poeng). Kort: Analyse → Detaljer → Medlemsnummer (klikk nummer for å filtrere).
- **Pris per vare:** samme vare, samme butikk og dag, enhetspris (rabatt lagt tilbake) som avviker minst 10 % fra vanlig pris (den prisen flest bonger har, minst 60 %, minst 5 salg). Kasserer markeres ved minst 3 avvik.
- **Kjøpeutbytte:** medlemsbong uten tabell, og grunnlag som avviker fra vanlig forhold til varesum (median over minst 10 bonger). Testene kalibrerer seg: finnes tabellen på under 80 % av medlemsbongene, regnes fravær ikke som avvik. Tabellen er ikke bekreftet i ekte data.
- **Hendelsesord:** tekstlinjer (ikke varenavn), betalingslinjer, topptekst og bunn med et ord fra ordlisten `evWords` (standard `DEFAULT_EV`: anull, makul, makulert, storn, parker, på vent, manuell, spør pris, overstyr, prisendring, kansell, kanseller, avbrutt). Ordlisten redigeres i Innstillinger → Hendelsesord (× fjerner, Enter/«Legg til» legger til, maks `WORDS_MAX` tegn). Treff på starten av et ord etter `evNorm` (små bokstaver, æ→ae, ø→o, å→a, uten aksenter, doble bokstaver slått sammen), så «anull» treffer «Annullert». Ett treff per linje (`eventHits`). Skanning v8 lagrer tekstlinjene i `tx` (maks 15 × 80 tegn); eldre skanninger bruker hendelses- og ukjente linjer. Annullert, manuell pris, parkert og spør pris er ikke observert ennå.
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

## Mulig sentral kampanje: notat og spørsmål (versjon 3.18.0)

- Samme vare (EAN) med rabatt (hvilken som helst prosent) på minst `campBongs` (2, før 3.29.0: 3) bonger hos minst `campCashiers` (2) kasserere, over alle innlastede dager og butikker, regnes som **mulig sentral kampanje** (`campaigns()` i `logic.js`). Én kassereres gjentakelser er ikke kampanje. Den gamle regelen (10 bonger samme dag og butikk, som skjulte rabatten) er fjernet.
- **Bongen tas med**: «Rabatt uten årsak», «Høy rabattprosent» og «Rabatt uten treff» flagges som før, men får notatet «Kan være sentral kampanje: … Bekreft eller avvis.» (`finding.camp`). En kampanjedag (≥ 40 % av minst 30 salg har rabatt) gir bare notat.
- **Brukeren spørres**: *Ja, kampanje* / *Nei, ikke kampanje* under bongen i Sjekk først, i Rabatt-kortet (tabell med Angre) og i dialogen «Mulige sentrale kampanjer» (varsel i Analyse-kortet). Ja: rabatten flagges ikke og telles ikke mot kassereren. Nei: flagges som vanlig, uten notat.
- **Svaret gjelder varen, uansett rabattprosent**, så alle flaggede bonger med varen oppdateres (statuslinjen viser «6 → 0 flaggede bonger»). Eldre svar med `ean|prosent` gjelder nå varen.
- **Automatisk kampanjevare (3.25.0, standard på, `campAuto`):** når grensene over er nådd (minst to kasserere og to bonger med rabatt på varen; én bong hver er nok), får varen status `auto` og behandles som bekreftet kampanje uten spørsmål. Tabellen «Kampanjevarer» viser «Kampanjevare (automatisk)» med «Ikke kampanje» (lagres som `ikke`). Kvitteringsvisningen merker linjen «kampanjevare». `campAuto: ''` gir spørsmålsflyten under.
- Svarene (`kvr.camp.v1`, nøkkel `ean`) lagres i IndexedDB, følger Eksporter/Importer innstillinger, og står i revisjonsrapporten (bekreftet, avvist og ikke avklart).

## Samlet utseende og butikknavn (versjon 3.16.0)

- **Alle filter under Filtrer.** Innholdsfiltrene (vare, varegruppe, pant, rabatt, rabatt-%, spesialbetaling) ligger i kortet «Innhold» og er merket *skanning*. Skann har bare skanning (knapper og cache) og varegrupper. Sortering og lagrede filtre er ett kort.
- **Nivå og avdeling:** butikknummer med mer enn fire siffer er nivå + avdelingsnummer (`1311003` = nivå `131` + avdeling `1003`, `storeParts` i `logic.js`). Etiketten er «1003 – navn (nivå 131)», listen grupperes etter nivå med «Velg»/«Fjern» per nivå, søket treffer hele nummeret, avdeling, nivå og navn, og nivåer kan få navn (`131=Coop Øst`). Navnelesingen fra CW bruker feltnavnene widgeten selv oppgir (`dataValueField`/`dataTextField`).
- **Butikknavn og nummer overalt** («1005 – Coop Mega Kolbotn»). Navn hentes fra CWs butikkliste, ellers fra BUTIKK-kolonnen i listen (`storeNameFromCell`), og egne navn overstyrer. Butikker uten navn får «Gi butikken navn» direkte under butikklisten.
- **Felles design:** alle farger, radier og kontrollhøyder kommer fra tokens i `panel.css` (`--kv-*`) og brukes likt i panel og dialoger. Samme overskriftsstil på kort og innstillingsgrupper, ett utseende på varsler, like høye felt og knapper.

## Pantelapper, slettede linjer, spesialbetaling, rabatt og kort (versjon 3.14.0)

Alt bygger på skannet innhold og lager funn i samme avviksliste, med innstillinger og poeng per test. Skanning versjon 6 leser i tillegg kortlinjer (`cd`: kortleverandør, siste fire siffer, evt. utstedernr).

Versjon 3.21.0 legger til: **Tempo** (serier av bonger med høyst N sekunder mellom på samme kasse; uten sekunder i listen telles bonger i samme minutt; kasserere med mange 0-kr-bonger), **Overvåkede varer** (EAN eller del av navn; retur, sletting og kassererandel), **Retur av vare uten kjøp** (EAN som kortet eller medlemmet ikke har kjøpt innen N dager, valgfritt samme dag), **Topptekst og bunn** (skanning versjon 7: kasserer, kasse og medlem i toppteksten mot listen, terminal-ID, autorisasjonskode og inngangsmåte; felt kontrolleres bare når minst 90 % av minst ti bonger stemmer fra før), **Betalingsmåter** (tabell i Diagnostikk mot CWs filterliste, og filter i Filtrer) og **Søk i bongen** (fulltekst over det skannede innholdet). Alt leser bare listen og visningsfeltet, ingen kall mot API.

- **Ingen dobbelttelling (3.15.0):** tester som måler samme forhold teller bare det høyeste poenget per bong (`FAMILIES` i `logic.js`: pant og kontant tilbake, rabatt, regnskap, pris, kassadifferanse). Årsaker som ikke teller vises overstrøket i Sjekk først. «Samme pantebeløp utbetalt flere ganger» er slått sammen med «Pantelapp innløst flere ganger» (samme kasse samme dag, eller innen tidsrommet på tvers av kasser, og bongsum for bonger med flere pantelapper). Prisavviks-testen hopper over spør pris-linjer, og Hendelsesord utelater «manuell» og «spør pris» på bonger som allerede er flagget av de egne testene.
- **Pantelapper:** `99 PANTELAPP` er manuell, `399 PANTELAPP` kommer fra pantemaskinen. Funn: manuell pantelapp over beløpsgrensen, kasserer med mange manuelle (andel mot butikken), pantelapp slettet (linje + motlinje med samme beløp), og samme pantelapp innløst flere ganger (lappnr hvis bongen viser det, ellers samme sum innen 60 min eller på samme kasse samme dag). Kortet «Pantelapper: manuell og maskin».
- **Slettede linjer:** en linje og en motlinje (samme kode, motsatt beløp) regnes som slettet. «Kontant tilbake uten salg» bruker nå varelinjer etter sletting. Nytt funn når varelinjer er slettet og bare pant og kontant tilbake står igjen. Makulert vare (EAN) som ikke er solgt på ny i butikken innen 120 min (krever 80 % skannet).
- **Spesialbetaling:** ordlisten (eget forbruk, internt forbruk, utbetaling, finansiering, sjekk) leses i betalingsmåter, linjenavn og tekstlinjer, som funn og som søk under Filtrer → Innhold.
- **Rabatt:** høy rabattprosent (standard 70–100 %), rabatt uten treff på andre salg (samme vare og rabatt samme dag i butikken, standard ≥ 30 % og bare uten årsak), mulig kampanje (samme vare og rabatt hos flere kasserere: notat og spørsmål), og søk på rabatt-% under Skann.
- **Spør pris:** linjen under «SPØR PRIS» sammenlignes med medianprisen for samme EAN samme dag.
- **Kort:** tre returer på samme kort (leverandør + kortnr) innen 30 dager.
- **Manuell kvittering / til gode-lapp:** ordliste; flagges når en annen bong i butikken har samme beløp innen 3 dager.
- Ikke bekreftet i ekte data: hvordan slettede linjer, spør pris, kortlinje, manuell kvittering og spesialbetaling står på bongen. Testene bruker motlinjer, ord og maskerte kortnumre; Diagnostikk samler det som ikke kjennes igjen.

## Kontroll-fanen

- **Arbeidsoppgaver:** lagre filter + datovalg (i går, i dag, siste 7 dager, forrige uke) + skanning + kontroller + sammendrag som én knapp. «Morgenkontroll (i går)» er innebygd: henter gårsdagen fra CW, skanner, kjører alle kontroller og viser et sammendrag som kan kopieres som tekst. Lagrede filtre (Filter-fanen) setter bare filter.
- **Kjør alle kontroller:** kjører først avviksjekken per kvittering (Avvik-fanen) og deretter kontrollene under. Funn som flagger bonger legges i samme avviksliste («Kun avvik»). Tom terskel slår av en sjekk.
- **Kassererprofil:** returandel, snittbeløp, pantelapper per salg og korrigeringer (negative varelinjer utenom pant) per kasserer mot butikksnittet. Rødt = minst 1,5× snittet (innstilling).
- **Mønstre:** små returer rett før stenging, kontant tilbake uten salg flere ganger på samme kasse, samme beløp gjentatt (per kasserer og dag). Dette er kontroller på tvers av bonger; «Mulige duplikater» i Filter-fanen er noe annet (samme beløp, kasse og minutt).
- **Pantelapp-sjekk:** pantebalanse (salg mot utbetalt) per dag og butikk. Gjentatte pantebeløp ligger under «Pantelapp innløst flere ganger».
- **Sekvens:** bonger utenfor åpningstid.
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
- `bevis/`: PNG av de høyest rangerte bongene (standard 30, 0 = ingen, maks 100). Fra 3.31.0 ligger bildene også inne i `rapport.html` som data-URI (bare gyldig base64-PNG godtas), så de vises når rapporten åpnes rett fra ZIP-filen; «Se bilde N» i tabellen hopper til bildet. Bevisbildene har topptekst med butikk, kasse, kasserer, bongnr og tid, men aldri medlemsnummer.
- `data/kvitteringer.csv`: alle kvitteringer i datagrunnlaget (også de tester på tvers av bonger brukte utenfor omfanget, merket «I omfang»). `data/innhold.json`: skannet bonginnhold. `data/funn.csv` og `data/flaggede_bonger.csv`.
- `innstillinger.json`: terskler, poeng, egne regler, varegrupper, butikknavn og kampanjesvar slik de var i analysen. Kan leses inn under Mer → Innstillinger → Importer for å gjenta analysen.
- `KONTROLLSUM.txt`: SHA-256 for alle filer, i formatet `sha256sum -c KONTROLLSUM.txt` forstår. Kontrollsummen for datasettet er SHA-256 av `data/kvitteringer.csv`, og for innholdet SHA-256 av `data/innhold.json` (sortert på bong-ID, uten skannetidspunkt), så den kan kontrolleres uavhengig av pluginen.

Rapporten viser det som gjaldt da analysen ble kjørt (omfang, bonger, skanninnhold, terskler), også om listen eller innstillingene er endret etterpå; en merknad forteller om dette. Kontrollsummen for selve ZIP-filen vises i panelet og lagres i en logg («Tidligere rapporter», bare i denne nettleseren), for å kunne noteres i saken. Kontrollsummer viser at eksporten ikke er endret, ikke at dataene i Lindbak er riktige. Funn er indikasjoner, ikke bevis.

## Innstillinger og hjelp

- **Mer → Innstillinger** (eller ⚙ øverst) samler alle terskler, avviksgrenser og poeng, gruppert per test: Avvik per bong, Mønstre, Falsk retur, Salg etter kassaoppgjør, Slettede bonger, Kassadifferanse over tid, Tallanalyse, Rabatt, Pant, Åpningstider, Kassererprofil og Egne regler. Hver gruppe viser forklaring, enhet, hvor mange verdier som er endret, og «Standard for denne gruppen».
- Tester som kan slås av har en «På»-bryter (avskrudd = tom verdi = testen kjøres ikke). Endrede verdier merkes med gul kant. Alt lagres med en gang.
- Terskler gjelder fra neste analyse (Sjekk først og Innstillinger viser en melding og en knapp for å kjøre på nytt). Poeng gjelder med en gang.
- **Generelt:** egne butikknavn, tastaturflyt, tilbakestilling av plassering, **Eksporter** og **Importer** innstillinger (JSON med terskler, poeng, egne regler, varegrupper, butikknavn og kampanjesvar) og «Alt til standard».
- «Juster» ved siden av hver forklaring i «Hvorfor flagget?» åpner riktig innstillingsgruppe.
- **?** øverst: kort veiledning, tegnforklaring (rød kant, gul stripe, risikonivå, «Ny», lenker, rødt tall, overstrøket årsak, kampanjespørsmål, panelstørrelse) og snarveier. En ikke-blokkerende melding vises første gang.
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
node test/linjer.test.js                              # pantelapper, slettede linjer, spesialbetaling, rabatt, spør pris, kort, manuell kvittering
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
NODE_PATH=<global node_modules> node test/kampanje.js   # kampanjevare automatisk og Ikke kampanje; uten automatikk: notat, spørsmål, Ja/Nei/Angre, husket svar
NODE_PATH=<global node_modules> node test/avdeling.js  # butikknummer = nivå + avdeling: gruppert liste, søk, valg av nivå, navn
NODE_PATH=<global node_modules> node test/butikk.js    # butikknavn fra BUTIKK-kolonnen, redigering, filter samlet under Filtrer
NODE_PATH=<global node_modules> node test/linjer.js    # samme funn i panelet: kort, søk på spesialbetaling og rabatt-%
node test/pant.test.js                                 # pant: bare 99 og slettet 399, makulert linje, hendelsesord i topp/bunn
node test/innhold.test.js                              # tempo, overvåkede varer, retur uten kjøp, topptekst/bunn (v7), betalingsmåter, fulltekstsøk
node test/cwdata.test.js                               # «(SLETTET)», bongtyper, kanal, innhold fra CW, innlogging, bongkopi, svinn
NODE_PATH=<global node_modules> node test/cwhent.js     # «Hent tilleggsdata fra CW» mot falsk CW-side: filtre ett om gangen, tilbakestilling, feil og tidsavbrudd
NODE_PATH=<global node_modules> node test/deler.js      # «Hent og skann i deler»: dag for dag, deling på klokkeslett, skanning, samlet grunnlag, fortsett, feil
NODE_PATH=<global node_modules> node test/fart.js       # fartsregulator: minsteintervall, pause ved trege svar, stopp uten svar, rask skanning
NODE_PATH=<global node_modules> node test/oppstart.js   # boks når panelet ikke kommer: venter på listen, feil ved oppstart, nytt forsøk
NODE_PATH=<global node_modules> node test/analyse.js    # analysen står fast når listen byttes, Hent i CW, skanning tåler listebytte
NODE_PATH=<global node_modules> node test/synlig.js     # panelet er alltid synlig: lagret plassering utenfor skjermen, fjernet fra siden, dekket
NODE_PATH=<global node_modules> node test/innhold.js    # samme i panelet: skanning av topptekst/bunn, funn, kort, Diagnostikk, søk og betalingsfilter
NODE_PATH=<global node_modules> node test/stor.js  # panelstørrelse: Vanlig/Stor/Full, dokking, kolonner, husking
TOUR=<mappe> NODE_PATH=<global node_modules> node test/tour.js  # skjermbilder av alle faner (valgfritt)
```

## Ikke verifisert mot ekte side

- Skanning: venter til iframen får innhold etter radvalg (6 s timeout per kvittering). Tidspunktet og om iframen tømmes riktig er kun testet mot fiktivt grid.
- Pant gjenkjennes kun som `NNN PANT` / `NNN PANTELAPP` (1–4 sifre i starten). Andre pantvarer fanges ikke.
- Skjult/omsortert rader via `tr.style.display` og DOM-rekkefølge i Kendo-gridet (testet kun mot et enkelt fiktivt grid).
- Avkrysningsboks plasseres i første celle; sjekk at den ikke kolliderer med Lindbaks egen kolonne.
- Bongtypene er kartlagt med CWs bongtypefilter: 6 bankavstemming, 7 dagsavslutning, 8 innlogging, 9 utlogging, 11 synlig svinn (Brekasje i filteret), 13 internt forbruk, 19 bongkopi. Kanal: 2 betjent (Lindbak POS), 3 Shop&Go, 1 system og PDA.
- «Hent tilleggsdata fra CW» er testet mot en falsk CW-side (`test/cwhent.js`). Avkrysning med klikk i innholdsfilteret er prøvd i ekte CW (Kendo 2017.3) med konsollinjer, ikke selve knappen.

Versjon 3.21.1: panelet hentes fram av seg selv hvis det ligger utenfor skjermen (lagret plassering fra et annet vindu eller med verktøylinjer åpne), er fjernet fra siden eller er dekket av noe i CW. Det må alltid være minst 200 px av høyden synlig (48 px når det er sammenfoldet), og z-index er satt til høyeste verdi. Test: `test/synlig.js`.

Versjon 3.22.0: **analysen står fast når CW-listen byttes.** Etter en analyse vises Sjekk først, kasserere og periodesammenligning fra et øyeblikksbilde (`ctlRes.snap`), ikke fra listen i CW. En melding forteller hvor mange analyserte bonger som ikke ligger i listen, «Hent i CW» henter dag og butikk for én bong uten å røre analysen, og notat/status virker på bonger utenfor listen. Endret omfang etter analysen gir en melding. «Tøm cache» og «Nullstill alt» fjerner analysen. Skanningen hopper over bonger som forsvinner fra listen (i stedet for å vente på tidsavbrudd) og advarer når fanen er skjult. Test: `test/analyse.js`.

Versjon 3.23.0: **panelet kan flyttes i alle størrelser** (Stor og Full får egen lagret plassering, dobbeltklikk legger dem tilbake), **bongen vises som en kvittering** i Sjekk først (slettede linjer overstreket, det testene reagerer på markert), **makulert linje på bong** flagges alltid (også sammen med rundt beløp, og når hele bongen er makulert), hendelsesord leses også i betalingslinjer og topp/bunn, og **pant gir bare reaksjon på manuell pantelapp (99) og slettet pantelapp fra maskinen (399)**. De andre pant-testene er av som standard, rene pantereturer teller ikke som retur, rundt beløp eller gjentatt beløp, og lagrede innstillinger legges om én gang (`kvr.pantmig.v1`). Tester: `test/pant.test.js`, `test/stor.js`, `test/analyse.js`.

Versjon 3.23.1: pluginen sier fra på siden når panelet ikke kommer: en boks nederst til venstre (`#kvr-boot`) viser at den venter på listen, ikke finner jQuery/Kendo-gridet, eller fikk en feil (med «Kopier feilen», også i `window.__kvBootErr`). Feil ved oppstart og i `attach` fanges, og gridet merkes først som bundet når panelet er bygget, så en feil prøves på nytt i stedet for å stoppe pluginen for godt. Test: `test/oppstart.js`.

Versjon 3.24.0: **panelet kommer med en gang på journalsidene**, også før CW har en liste («Venter på listen i CW»), og kobles til listen når den kommer, også når CW bytter ut hele gridet etter et nytt søk. Innholdsskriptet kjører på `LindbakRetail_1/Journal*` (også uten skråstrek eller med spørrestreng). **Melding når pluginens filtre skjuler alle radene** i CW-listen, med «Vis alle» som bare nullstiller pluginens filtre. **CWs egne nedtrekk, kalendere og dialoger** (Kendo-popup) ligger over panelet. Boksen ved feil har **«Nullstill visning»**, som fjerner plassering, størrelse og faner og laster på nytt, uten å røre skanninger, notater og innstillinger.

Versjon 3.25.0: **ordliste for hendelsesord** i Innstillinger → Hendelsesord (legg til og fjern ord; standard anull, makul, makulert, storn, parker, på vent, manuell, spør pris, overstyr, prisendring, kansell, kanseller, avbrutt). Treff på starten av et ord uavhengig av store/små bokstaver, æøå og doble bokstaver. **Kampanjevare:** selger flere enn én kasserer samme vare med rabatt på flere enn to ulike bonger, klassifiseres varen automatisk som kampanjevare (rabatten flagges ikke; «Ikke kampanje» overstyrer). Skanning v8 lagrer bongens tekstlinjer. Tester: `test/logic.test.js`, `test/linjer.test.js`, `test/settings.js`, `test/kampanje.js`.

Versjon 3.26.0: **returårsak.** Linjen `RETUR VARE` står over hver returnert vare, ofte med årsak (`RETUR VARE Coop Matvaregaranti`). Parseren (skanning v9) merker linjen under med `rv: 1` og årsaken i `rr` (maks 40 tegn); linjen regnes ikke som ukjent, og årsaken er med i fulltekstsøket og i forklaringen til «Retur av vare uten kjøp». `returnReasons()` samler varereturer (ikke pant) per årsak og kasserer: tabell «Retur per årsak» i Detaljer (klikk filtrerer listen), og kasserer markeres («Mange returer med overvåket årsak», 3 poeng) når bonger med overvåket årsak (`retWatch`, standard `matvaregaranti`, ordliste med samme treffregler som hendelsesord) ≥ `retWatchN` (3) og andelen ≥ `profFactor` × andelen hos de andre kassererne. `retWatchFlag` (av) flagger hver bong («Retur med overvåket årsak», 2 poeng). Kvitteringsvisningen viser linjen «RETUR VARE …», rød når årsaken er overvåket. Eldre skanninger (før v9) med negative varelinjer kan tas på nytt med «Skann returbonger på nytt» uten å skanne alt (`maybeReturn`). Tester: `test/innhold.test.js`, `test/innhold.js`.

Versjon 3.27.0: **«Hull i bongnummer» er fjernet** (test, innstillingen `maxGap`, poengvekt, rapporttekst, hjelp, diagram og veiledning). Lagret `maxGap` og poengvekt forsvinner ved neste lesing (`sanitizeControl`/`sanitizeWeights`). «Dobbelt bongnummer», «Bongnummer og tid stemmer ikke» og «Løpenummer avviker fra tid» er beholdt.

Versjon 3.28.0: **færre falske «Rabatt uten årsak».** (1) Kampanjesjekken tar med PLU-koder (4–14 siffer, `isCampCode`), ikke bare EAN; kampanjesvar lagres også for PLU. (2) Rabatt på en vare som står i en `Kupong (id - navn)`-linje på samme bong regnes som kampanje (`campCoupon`, på; `couponFor`: like navn eller ≥ 2 ord på 3+ bokstaver og ≥ 60 % av kupongens ord; «Gruppe - » og «GRUPPE 240 - » fjernes). «Ikke kampanje» overstyrer. (3) Rabattkortet viser hvor mange salg og kasserere i grunnlaget som er skannet (`camp.scan`), og «Skann hele grunnlaget» skanner resten av valgte butikker (analysen skanner ellers bare omfanget, så et omfang på én kasserer gir aldri kampanjevare). (4) Tabellen «Rabatt uten årsak på varer som ikke er kampanjevare» (`camp.others`, maks 30) viser hvorfor (for få bonger/kasserere) og har knappen «Kampanjevare» (lagres som `kampanje`). Tester: `test/linjer.test.js`, `test/kampanje.js`.

Versjon 3.29.0: **kampanjevare = samme vare med rabatt hos to kasserere, én bong hver er nok.** Standard `campBongs` er 2 (var 3). Lagret `campBongs: '3'` (gammel standard) legges om til `'2'` én gang (`kvr.campmig.v1`); andre verdier beholdes.

Versjon 3.30.0: **multipakk er kampanje.** Minst to salgslinjer av samme vare med samme rabattprosent (hele prosent) på samme bong regnes som kampanje (`campMulti`, på; `multiBuy`), også hos én kasserer. «Ikke kampanje» overstyrer. Linjer dekket av kupong eller multipakk telles ikke i «Rabatt uten årsak på varer som ikke er kampanjevare». Kvitteringsvisningen merker rabatten med kampanjevare, kupong eller multipakk. En linje med «Antall: 2» telles ikke som to.

Versjon 3.31.0: **bevisbildene vises i rapporten.** Bildene ligger inne i `rapport.html` (data-URI), i tillegg til filene i `bevis/` med kontrollsum. Tabellen over flaggede kvitteringer har «Se bilde N» som hopper til bildet. Rapporten blir større (omtrent 1,3 × summen av PNG-filene).

Versjon 3.31.1: panelet forsvant når det ble minimert og så satt til Stor eller Full (eller minimert i Stor/Full). Stor/Full gjelder nå bare åpent panel (`bigMode`); minimert er det en liten knapp med vanlig plassering, og åpnes det igjen, kommer Stor/Full tilbake. Test: `test/stor.js` (lang side, minimer, bytt størrelse, last på nytt).

Versjon 3.32.0: **lagre innstillinger i en mappe.** Mer → Innstillinger → Generelt → «Velg mappe…» (File System Access, `showDirectoryPicker`). Mappevalget lagres i egen IndexedDB (`kvr.folder.v1`, skrevet med `putSafe` så en verdi som ikke kan lagres ikke slår av databasen). Ved hver endring av `ctl`, `anom`, `weights`, egne regler, varegrupper, butikknavn, kampanjesvar og tastaturvalg skrives `kvitteringshenter-innstillinger.json` (samme format som eksport) etter 0,8 s. Uten tilgang (Chrome spør etter omstart) skrives ingenting før «Gi tilgang». Er filen endret etter siste lagring (`kvr.folderat.v1`, for eksempel fra en annen PC), skrives den ikke over før brukeren velger «Les inn fra mappen» eller «Skriv mine til mappen». Pluginen skriver bare denne ene filen i den valgte mappen. Test: `test/mappe.js` (mappen etterlignes i minnet).

Versjon 3.32.1: størrelsesknappen (⤢) åpner et minimert panel og går til neste størrelse; før ble det liggende som en liten knapp, og det så ut som ingenting skjedde. Test: `test/stor.js`.

Versjon 3.33.0: **«Rabatt uten årsak» gir 0 poeng** som standard (`RISK_WEIGHTS`). Funnet vises fortsatt, men teller ikke i risikoscoren; i rabattfamilien teller da «Rabatt uten treff» og de andre. Lagret poeng med gammel standard (3) legges om til 0 én gang (`kvr.discmig.v1`); egne verdier beholdes. «Mange rabatter uten årsak» (kasserer, 2 poeng) er uendret.

Versjon 3.34.0: **kjente returårsaker og bongkopi.** `RET_REASONS` (Coop Matvaregaranti, Annen returårsak, Angrerett, Gevinst, Feilslag, Prisløfte, Datovare) og `retReasonName` gir lik skrivemåte; ukjente vises med «(ukjent årsak)». Ordliste-feltet for overvåkede returårsaker har knapper for kjente årsaker (`suggest`). «bong kopi» er lagt til i `DEFAULT_EV` (og i lagret ordliste én gang, `kvr.evmig.v1`). Bonger med «Bong kopi»/«Bongkopi» (`COPY_WORDS`, `isCopy`, `splitCopies`) flagges bare som hendelsesord: de holdes utenfor de andre testene, avviksreglene og duplikatmarkeringen. Tester: `test/innhold.test.js`, `test/innhold.js`, `test/settings.js`.

Versjon 3.35.0: **tilleggsdata fra CWs egne filtre, slettede linjer og nye analyser.** (1) Linjer CW merker «(SLETTET)» (beløpet står, men er ikke med i Totalt) flyttes til `sc.del` (`splitDeleted`, også for lagrede skanninger ved oppstart) og trekkes fra tellerne; de teller som makulert linje, slettet overvåket vare og slettet pantelapp, vises overstreket i kvitteringen og finnes av fulltekstsøket. Før ga de falsk «Linjer stemmer ikke med totalen». (2) Bongtypene (`TYPE_LABELS`) og kanalene (`CHANNEL_LABELS`) er kartlagt med CWs filtre. Kassererprofilen sammenligner hver kasserer med snittet i egen kanal (`profChannel`, på). (3) **Hent → Hent tilleggsdata fra CW** (`fetchCwExtra`): huker av ett valg om gangen i CWs innholdsfilter (11 valg), betalingsfilter (kontant, kontant tilbake, kreditt, kupong, tilgodelapp, gavekort, finansiering) og bongtypen Systemtransaksjoner, trykker Oppdater og noterer bongene. Pause mellom søkene (1,5 s), stopp ved første søk som ikke svarer innen 60 s, kontroll av at CW faktisk brukte filteret, og filtrene og søket settes tilbake. Fritekstsøk brukes aldri (ga 504 hos CW i testene). Bongkopier leses fra visningsfeltet (`BONGKOPI (nr)`). Lagres i egen IndexedDB (`kvr.cwx.v1`, høyst 30 000 bonger og 5 000 systembonger, uten medlemsnummer); «Tøm cache» sletter. (4) Nye tester (`cwChecks`, `shiftChecks`, `copyChecks`, `shrinkChecks`) og kortet «Fra CW: innhold, innlogging, bongkopi og svinn»: mye av ett innhold hos kasserer (mot andre i kanalen), kombinasjon av innhold på bong (Vensafe + slettet vare m.fl.), kort innlogging med retur eller sletting, salg på to betjente kasser samtidig, bongkopi fulgt av retur, mange bongkopier, og for synlig svinn (11) og internt forbruk (13): overvåket vare, vare returnert samme dag, stort beløp og utenom åpningstid. Svinnbonger skannes og holdes utenfor testene for salg. Rapporten sier om og når tilleggsdata ble hentet. Tester: `test/cwdata.test.js`, `test/cwhent.js`, `test/settings.js`.

Versjon 3.36.0: **Hent og skann i deler.** CW gir høyst 1000 bonger per søk og kutter de eldste. Hent → «Hent og skann i deler» (`fetchParts`) søker én dag om gangen med dato, butikker og medlemsnr fra «Søk i hele journalen». En dag med 1000 bonger deles på beløp (`sumMin`/`sumMax`, `L.splitSum`: under 0, 0–100, 100–300, over 300 kr, og videre i to; hvert vindu starter 0,01 kr under forrige slutt, dobbelttreff fjernes på transactionId). Hver del skannes mens den står i listen, og radene lagres i et samlet grunnlag i egen IndexedDB (`kvr.arch.v1` per dag, høyst 30 000 rader og 92 dager, eldste dager først, uten medlemsnummer; medlemsnummer bare i minnet). Analysen bruker `allRecs()` (listen pluss samlet grunnlag) for omfang og datagrunnlag; rader uten listerad skannes ikke og markeres ikke. Pause 1,5 s mellom søkene, stopp ved første søk uten svar (60 s), kontroll av at CW brukte beløpsfeltene (ellers kuttes dagen og det står i panelet), fritekst brukes aldri, og søket ditt settes tilbake. Dager som er hentet (unntatt i dag) hoppes over, så kjøringen kan fortsettes. Valgfritt: tilleggsdata fra CW for hver dag. «Tøm samlet grunnlag» og «Tøm cache» sletter. Test: `test/deler.js`.

Versjon 3.37.0: **Hent og skann i deler deler på klokkeslett, ikke beløp.** En dag med 1000 bonger halveres på CWs fra- og til-tid (`#fromTimePicker`/`#toTimePicker`, via Kendo-widgeten når den finnes; `L.splitTime`: 00:00–11:59 og 11:58–23:59, og videre i to; andre halvdel starter ett minutt før første slutter). Har butikken 1000 bonger før kl. 12, deles formiddagen videre, så hele dagen kommer med; bonger uten beløp (kassaoppgjør) er også med. Beløpsfeltene tømmes under kjøringen og settes tilbake. Kontroll: kommer det bonger utenfor klokkeslettene som ble søkt på (ett minutts slingring, tidsforskyvningen tatt med), har CW ikke brukt tidsfeltene, og dagen kuttes ved 1000 med beskjed. `splitSum`/`sumText` er fjernet. Tester: `test/deler.js`, `test/cwdata.test.js`.

Versjon 3.38.0: **raskere skanning med fartsregulator.** (1) Bongen leses i det den er ferdig tegnet: sjekk hvert 25. ms og les når innholdet har stått stille i 60 ms (høyst 600 ms etter at det kom), i stedet for sjekk hvert 100. ms og fast venting på 150 ms. (2) Fartsregulator (`L.pacer`, `L.paceNext`): høyst én bong per 0,6 s; normal svartid er 25 %-kvantilen av de siste 30 svarene; svar over dobbel normal (og over 0,8 s) øker intervallet ×1,5 (høyst 5 s), normale svar senker det ×0,9; tre svar på rad over tre ganger normal (og over 1 s) gir 60 s pause; svarer CW ikke på tre bonger på rad, blir det pause, og etter seks stopper skanningen (også «Hent og skann i deler»). Gjelder også lesing av bongkopier. Søkene venter minst like lenge som forrige søk tok. Statuslinjen viser svartiden og når farten er senket. (3) «Rask skanning: bare bonger med funn fra CW» (Skann, husket i `kvr.quick.v1`): bare salg med merking fra tilleggsdata, returer og bonger som ikke er vanlige salg. Test: `test/fart.js`, `test/cwdata.test.js`.

Versjon 3.38.1: **«MVA stemmer ikke» på bonger med pantelapp.** Pantelapper står ikke i MVA-tabellen, men er trukket fra i Totalt (for eksempel 23,94 i tabellen, −20,00 i pantelapper og 0,06 i øreavrunding gir Totalt 4,00). Tabellens sum sammenlignes nå med Totalt, Totalt uten pantelapper og Totalt uten all pant. Test: `test/cwdata.test.js`.

Versjon 3.38.2: **«Hent og skann i deler» venter på at CW har lastet.** Datoen settes nå i CWs datovelger (Kendo-widgeten), ikke bare i tekstfeltet, slik klokkeslettene allerede ble. Etter Oppdater regnes svaret som ferdig først når CW har begynt å laste (dataBound eller lastesymbol), lastesymbolet er borte, listen har stått stille, og bongene er fra dagen og klokkeslettene det ble søkt på. En liste som er uendret fra før søket, eller som ikke passer, brukes først etter lengre stillhet. Viser listen en annen dag, stopper kjøringen uten å lagre, med beskjed om hvilken dag listen viste. Hvert søk (dag, vindu, bonger, sekunder) står under «Søkene mot CW». Test: `test/deler.js` (falsk CW som tømmer listen og viser lastesymbol før svaret, og som følger datovelgerens verdi).

Versjon 3.38.3: **«Hent og skann i deler» stoppet opp i CW.** (1) Kontrollen av dato og klokkeslett brukte rådata fra CW, som kan være i en annen tidssone enn listen viser; da passet ingen deler, og hvert søk ventet 15 s ekstra. Nå brukes tiden slik listen viser den, som ellers i pluginen. (2) Når tidsfeltene var tomme før kjøringen, ga tilbakestillingen CW tom tid, og CWs egen kode feilet («Cannot read properties of null (reading 'valueOf')» i onFromTimeChange), slik at siste klokkeslett kunne bli hengende i søket. Tomme tidsfelt settes nå til 00:00 og 23:59. (3) Et lastesymbol som blir stående, holder ikke søket i gang: listen brukes når den er ny, passer og har stått stille i 2 s (eller symbolet har stått i 20 s). Symboler inne i listens rader og små elementer telles ikke. Test: `test/deler.js` (rådata i UTC, CW som feiler på tom tid, lastesymbol som blir stående).

Versjon 3.38.4: **«Dato fra» kunne bli tom ved neste dag.** Pluginen satte «Dato fra» før «Dato til». Ved overgang fra en dag til den neste var fra et øyeblikk etter til, og CWs datofelt (Kendo med min/max) tømmer da verdien; CW kunne dermed søke i hele historikken fram til dagen. Fra og til (dato og klokkeslett) settes nå i en rekkefølge der fra aldri er etter til, og feltene leses tilbake før hvert søk; avviker de etter to forsøk, stopper kjøringen før søket med hva feltene viste. Mens et søk pågår, viser statuslinjen hva pluginen venter på, og «Søkene mot CW» viser ventegrunn og lastesymbol for søk over 5 s. Test: `test/deler.js` (datofelt som tømmes når fra er etter til).

Versjon 3.38.5: **«CW godtok ikke … (Til-tid viser 00:00)».** CWs onFromTimeChange setter en nedre grense på til-tiden ut fra fra-tiden, med dagens dato. Pluginen satte klokkeslettene med datoen 1.1.2000, så til-tiden lå «før» grensen, og CW satte den lik fra-tiden. Klokkeslett settes nå med dagens dato, som når Kendo tolker et klokkeslett du skriver. Godtas de likevel ikke, prøves søkedagen og deretter en fast dato. Når til-feltet er tomt, settes til-tiden før fra-tiden, så onFromTimeChange ikke leser en tom til-tid («Cannot read properties of null (reading 'valueOf')»). Feilmeldingen viser grensene CW har satt på feltene som ikke godtok verdien. Test: `test/deler.js` (falsk CW som setter grensen og flytter til-tiden slik CW gjør).

Versjon 3.38.6: **CW søkte med forrige klokkeslett.** CW leser klokkeslettet når feltet mister fokus (ng-blur="vm.onFromTimeChange()"), men sin egen kopi av verdien (k-ng-model) oppdateres litt etter at widgeten er endret. Pluginen sendte blur med en gang, så CW brukte forrige klokkeslett (første gang tomt: «Cannot read properties of null (reading 'valueOf')»). Delene ble da kuttet ved 1000, og en hel dag kunne bli hentet med forrige dels klokkeslett og mangle bonger uten feilmelding. Nå settes ett felt om gangen; blur sendes når CWs kopi har verdien (lest via Angular når det går, ellers etter 250 ms), og kopien kontrolleres før søket. Passer listen ikke med dagen og klokkeslettet, søkes det én gang til før dagen kuttes («søkt to ganger» i søkeloggen). Dager hentet med eldre versjon merkes og hentes på nytt neste gang (radene slås sammen). Test: `test/deler.js` (falsk CW med forsinket kopi, onFromTimeChange på blur, med og uten lesbar Angular-scope).

Versjon 3.38.7: **Telefon- og kundenummer ble lest som betaling.** Linjer som «Tlf.: 95 871 903» og «Kundenr.: 99 999» endte i betalingsmåtene (vist som 95 871 903,00) og ga falsk «Betaling stemmer ikke med totalen» og feil i betalingsstatistikken. Linjer med slike merkelapper (Tlf, Telefon, Mobil, Kundenr, Medlemsnr, Org.nr, Ordrenr, Bongnr, Kassenr, Terminal m.fl.), og heltall på fem sifre eller mer uten øre, regnes nå som opplysninger, ikke betaling; teksten er fortsatt med i fulltekstsøket. Lagrede skanninger ryddes ved oppstart. Test: `test/cwdata.test.js`.

Versjon 3.38.8: **Klokkeslettene ble ikke satt riktig tilbake etter «Hent og skann i deler».** Tilbakestillingen satte den lagrede verdien fra widgeten direkte. Hadde den en gammel dato, avviste CW verdien («Cannot read properties of null (reading 'valueOf')» fra restoreTime), og CWs søk kunne bli stående med feil klokkeslett, for eksempel til-tid lik fra-tid, uten melding. Klokkeslettene settes nå tilbake som under hentingen (dagens dato, ett felt om gangen) og kontrolleres i feltet og i CWs kopi; stemmer de ikke, står det i panelet. Blur sendes ikke når CWs kopi fortsatt er tom (CW ville bare feile). Test: `test/deler.js` (søk med klokkeslett og gammel dato i widgeten).

Versjon 3.38.9: **«CW godtok ikke … (Til-tid viser 00:00)» ved neste dag.** Første dag gikk, men når fra-tiden ble satt først ved neste dag, satte CW til-tiden til 00:00. Til-tiden settes nå først (unntatt når ny til-tid er før nåværende fra-tid), og godtar ikke CW verdiene, prøves motsatt rekkefølge før kjøringen stopper; det samme gjelder tilbakestillingen. Feilmeldingen viser ikke lenger Kendos standardgrenser (lik min og maks betyr ingen grense). Test: `test/deler.js` (CW som krever motsatt rekkefølge).

Versjon 3.39.0: **Datoene får samme behandling som klokkeslettene.** CWs datofelt har også ng-blur (vm.onFromDateChange()/vm.onToDateChange()) og leser sin kopi (k-ng-model vm.fromDate/vm.toDate), som oppdateres etter widgeten. Pluginen sendte blur med en gang, så CW kunne søke med forrige dato. Nå settes datoene via datovelgeren, ett felt om gangen, og blur sendes når CWs kopi har datoen; kopien kontrolleres før søket. CW kjører uten Angulars debug-info, så kopien leses via kontrolleren (angular.element(felt).controller()), ikke scope(). Gjelder «Hent og skann i deler», tilbakestillingen og «Søk i hele journalen». Test: `test/deler.js` (falsk CW med forsinket datokopi og bare controller()).

Versjon 3.39.1: **CWs kopi leses via Kendo-widgeten.** I CW gir verken angular.element(felt).scope() eller .controller() noe. Kendo-widgeten som Angular har laget (kendo-time-picker="vm.fromTimePicker" osv.), har scopet sitt i $angular_scope; pluginen leser nå CWs kopi derfra først. Finnes det ikke, brukes fast pause (250 ms) som før, og listen kontrolleres mot dag og klokkeslett. Test: `test/deler.js` (falsk CW der bare widgetens $angular_scope gir kopien).

Versjon 3.39.2: **Dato og klokkeslett satt slik CWs kode forventer.** CWs kode (journal-bundlen) viser at søket bruker vm.selectedFilters.fromDate/toDate (dato + klokkeslett), som bare oppdateres i vm.onFromDateChange/onToDateChange/onFromTimeChange/onToTimeChange (ng-blur). Funksjonene leser CWs kopier av alle fire feltene, sammenligner hele tidspunkter fra mot til og «retter» den andre siden når fra er etter til; onFromTimeChange/onToTimeChange feiler når den andre tiden er tom («Cannot read properties of null (reading 'valueOf')»). Pluginen setter nå alle fire verdiene først (klokkeslett med samme dato), venter til CWs kopier har dem (lest via Kendo-widgetens $angular_scope) og forlater så feltene ett om gangen; da er fra aldri etter til når CW sammenligner. Før hvert søk kontrolleres feltene, kopiene og selectedFilters. Tilbakestillingen og «Søk i hele journalen» bruker samme vei. Dager hentet med 3.39.1 eller eldre hentes på nytt. Test: `test/deler.js` (falsk CW med CWs fire funksjoner nesten ordrett; med 3.39.1 ga den konsollfeilen og en dag med 0 bonger).

Versjon 3.40.0: **Retur til kort per kortleverandør, og åpen retur (Mastercard).** Nytt filter under Filtrer → Innhold: «Retur til kort», med alle leverandører eller én (Visa, Mastercard, Maestro, BankAxept, American Express, Diners, JCB, UnionPay, ukjent). En retur til kort er en bong med Totalt under null og kort på bongen; leverandøren leses fra kortlinjen eller fra betalingsmåten (for eksempel «Mastercard: −59,00»). Ny test under Kort: returer: hver retur til en leverandør med åpen retur flagges som «Retur til kort med åpen retur» (vekt 3); listen er en innstilling, standard Mastercard, fordi pengene kan settes inn på et annet kort enn det som ble brukt ved kjøpet. Analysen viser returer til kort per leverandør med knapp som filtrerer listen. Krever skanning versjon 6 (kortdata). Test: `test/linjer.test.js`.

Versjon 3.41.0: **Rapport, rabatt, medlemsnr, samme beløp og slettede varer.**
- **Rapportutskriften** har ikke lenger «Dekningsgrad og begrensninger», tallanalyse (Benford, runde beløp, siste siffer) eller kassaoppgjør (kassadifferanse, salg etter kassaoppgjør, bonger av typen kassaoppgjør). Bongene rangeres og kassererne får poeng uten disse testene, så rapporten henger sammen; analysen i panelet er uendret. Seksjonene er nummerert om (1–8).
- **Rabatt flagges bare med årsak**; en kampanjevare kan ha rabatt uten årsak. «Rabatt uten årsak», «Mange rabatter uten årsak» og «Rabatt uten treff på andre salg» er av som standard, og bare rabatt uten årsak kan bli kampanjevare. Overvåket: alle seks årsaker, spenn med fra og til (standard 41–69 %, så vanlig datovare på 40 % ikke flagges). Høy rabatt: bare med årsak, standard 71–100 %. Ny test «Rabatt med årsak, varen solgt av én kasserer» (vekt 3): flagger når færre enn 2 kasserere har solgt varen (EAN) i butikken den dagen; står over dager med under 80 % skannet. Filteret: «Rabatt med årsak» sammen med «Rabatt % fra/til» krever at samme linje har årsak og prosent i spennet; knappene «Vis overvåket» og «Vis høy rabatt» i rabattkortet fyller det inn.
- **Medlemsnummer: vurdering.** Hvert medlemsfunn får «sterk indikasjon på misbruk», «mulig misbruk, bør sjekkes» eller «trolig fast kunde eller felles husstand», med begrunnelse (eget nummer, nesten bare én kasserer, bonger på samme kasse med under 15 min mellom, mange på én dag, to butikker, mot mange kasserere og jevn bruk over mange dager). «Trolig uskyldig» vises uten poeng; eget nummer flagges alltid. Kolonne «Vurdering» i medlemskortet.
- **Samme beløp gjentatt** sammenligner beløpet betalt med bank (kort) på skannede bonger; innstillingen «bare bankbetaling» av gir bongsum som før.
- **Makulert vare ikke solgt på ny** sjekker salg i butikken samme dag (standard; av = minuttene). Funnet sier om varen er registrert som svinn eller internt forbruk samme dag; begge flagges.
Tester: `test/linjer.test.js`, `test/logic.test.js`, `test/report.test.js`, `test/rapport.js`, `test/audit.js`, `test/linjer.js`, `test/kampanje.js`, `test/medlem.js`.
