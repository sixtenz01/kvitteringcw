# Kvitteringshenter (ny kjerne)

Chrome MV3-utvidelse for Lindbak Chain Web → Kvitteringsjournal. Leser kun gridets data og DOM; ingen API-kall, ingen sending ut av nettleseren.

## Funksjoner

- Filter: butikk, kasse, kasserer, kvitteringstype, dato/tid (med hurtigvalg), sumintervall, negativ sum, medlem.
- Sortering på sum og tid.
- Valg av flere kvitteringer, sum for valgte.
- Duplikatsjekk: samme beløp, butikk, kasse og minutt.
- Skanning av pant: åpner hver synlige salgskvittering (type 1) i Lindbaks eget visningsfelt, leser linjene `NNN PANT` (salg) og `NNN PANTELAPP` (retur), og cacher beløp lokalt per kvittering. Filter «Pant» og pant-total for valgte. Ca. 0,5–1 s per kvittering; avbrytes med Stopp.
- Lagrede filtre (localStorage på chainweb.coop.no).

## Funksjoner i v3

- **Søk i CW** (hele journalen): dato, butikker (med navn fra CW), medlem, lojalitets-ID, vare/EAN, bongnr. Fyller CW sine egne felt og trykker OPPDATER.
- **Butikknavn** hentes fra CW sin butikkliste og vises i alle filtre og i CSV.
- **Skanning:** leser varelinjer, betaling og pant fra kvitteringene. Standard åpner hver kvittering i visningsfeltet; «Rask skanning» henter direkte via `GetReceiptDetails` (samme kall som gamle pluginen).
- **Varegrupper** med nøkkelord (`ord` = starten av ord, `*ord` = inneholder, `#kode` = varenr/EAN). Ekskluder-ord treffer hvor som helst. Regelsettet bygges opp fra «Varer uten gruppe», og kan eksporteres/importeres.
- **Avvik** (kun på knapp): stor panteretur, mange pantelapper, kontant tilbake uten salg, rundt beløp.
- **Eksport:** CSV (semikolon, UTF-8 med BOM) for synlige eller valgte kvitteringer.

## Lagring (påvirker ikke Lindbak)

All lagring (innstillinger, lagrede filtre, regler, skannecache) ligger i en egen IndexedDB (`kvr-store`). Ingenting skrives til localStorage eller sessionStorage, så Lindbaks egne data kan ikke bli påvirket. Cachen er begrenset til 2000 kvitteringer (eldste fjernes). Gamle `kvr.*`-nøkler i localStorage fra tidligere versjoner flyttes og slettes ved oppstart.

## Rapport, kassaoppgjør og egne regler

- **Rapport:** dagsrapport for synlige kvitteringer, per kasse eller kasserer, valgfritt per dag: antall salg, sum, retur, pant (skannede), avvik og kassadifferanse. CSV-eksport.
- **Kassaoppgjør (type 2):** skannes og leses ut: telt kontant/sjekk/kreditt/sum, differanse, pose-nr, sendt bank og valører. Rød markering ved differanse over terskelen (standard 1 kr), som også er en innebygd avviksregel.
- **Egne avviksregler:** bygg regler med flere vilkår (OG) på sum, klokkeslett, kasse, kasserer, butikk, type, medlem, panteretur, pantsalg, antall pantelapper/varelinjer, kontant tilbake, kassadifferanse, vare, varegruppe og betalingsmåte. Regler som bruker innhold (*) krever skanning, og kjøres kun når du trykker «Kjør avviksjekk».

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

## Oppbygging av panelet

Fem faner: **Hent** (søk i hele journalen via CW), **Filtrer** (lagrede filtre, dato/tid, butikk/kasse/kasserer/type som piller, sum, medlem, bong, vare, notat, sortering), **Skann** (skanning, pant, varegrupper), **Analyse** (Rapport, Avvik og Kontroll som delfaner) og **Mer** (eksport og innstillinger).

- **Skannestatus** vises alltid under tallene («Skannet 4 av 5» med «Skann nå»). Filter som krever skanning (pant, vare, varegruppe) viser en gul stripe med hvor mange som mangler. Skanning dekker alle kvitteringer som passerer de andre filtrene, også de som pantfilteret ellers skjuler.
- **Én statuslinje** øverst viser fremdrift og resultat, og forsvinner av seg selv.
- **Nullstilling uten refresh:** alt du har satt vises som chips under tallene: filtre, sortering, valgte kvitteringer, avviksmarkering og CW-søk. Hver chip fjernes med ett klikk, og «Nullstill alt» fjerner alt (også CW-filteret du satt i Hent-fanen).
- **Fokus:** klikk på en kasserer eller kasse (lenker i rapporter, funn og avvikslister, pillene under Filtrer, eller Alt+klikk på KASSERER/KASSE i selve listen) for å filtrere listen og se alt om den: nøkkeltall, hvilke kasser/kasserere den er brukt sammen med, kassererprofil mot butikksnitt, pant og betaling, varegrupper, avvik og funn, kassaoppgjør, notater og aktivitet per time.
- **⤢** gjør panelet bredt (for rapporter og tabeller). Tabeller har faste overskrifter med forklaring ved hover.
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
```

## Ikke verifisert mot ekte side

- Skanning: venter til iframen får innhold etter radvalg (6 s timeout per kvittering). Tidspunktet og om iframen tømmes riktig er kun testet mot fiktivt grid.
- Pant gjenkjennes kun som `NNN PANT` / `NNN PANTELAPP` (1–4 sifre i starten). Andre pantvarer fanges ikke.
- Skjult/omsortert rader via `tr.style.display` og DOM-rekkefølge i Kendo-gridet (testet kun mot et enkelt fiktivt grid).
- Avkrysningsboks plasseres i første celle; sjekk at den ikke kolliderer med Lindbaks egen kolonne.
- `receiptType 11` er uavklart og vises som «PDA-operasjon (uavklart)».
