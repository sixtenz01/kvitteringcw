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

## Oppbygging av panelet

Faner: **Søk** (CW-søk), **Filter** (lagrede filtre, dato/tid, butikk/kasse/type, sum/medlem/bong/vare, sortering), **Innhold** (skanning, pant, varegrupper), **Avvik**, **Eksport**. Aktive filtre vises som chips under tallene og fjernes med ett klikk. Faste knapper nederst: Velg alle, Fjern valg, CSV og PNG (viser antall valgte). Fremdrift og Stopp vises øverst uansett fane.

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
