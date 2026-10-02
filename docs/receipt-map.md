# Receipt map – Lindbak Chain Web (Kvitteringsjournal)

Kartlagt via DevTools-console, 2026-10-02. Ingen persondata er lagret her.

## Plattform

- Side: `https://chainweb.coop.no/LindbakRetail_1/Journal/Viewer`
- Stack: ASP.NET MVC + AngularJS + Kendo UI grid + jQuery. Antiforgery: `__RequestVerificationToken` (hidden input).
- `$http` nås via `angular.element(document.body).injector().get('$http')`.
- Kvitteringen vises i en `iframe` (`about:blank`), fylt via `iframe.contentDocument.body.innerHTML`.
- Fanen Network i DevTools viste ingen kall; jQuery-/XHR-hooks så bare `Account/CheckCookie` (polling). Bruk Angular-`$http` eller hooks i iframens realm.
- Andre kontekster: `about:blank` i Console-dropdown er ikke siden; velg konteksten med Viewer-URL.
- `kv-select-all` (checkbox-id) tilhører trolig eksisterende Kvitteringshenter, ikke Lindbak.

## Gridrad (liste)

Hentes fra `$('[data-role=grid]').first().data('kendoGrid').dataSource.data()`.

| felt | type | merknad |
|---|---|---|
| `endDateTime` | string | |
| `transactionId` | string | suffiks etter siste `-` = `sequenceNum` |
| `storeNumber` | number | |
| `workstationNumber` | number | kasse |
| `cashierNumber` | string | |
| `totalAmount` | number | subtotal |
| `saleChannel` | number | kode, ukjent betydning |
| `receiptType` | number | kode, ukjent betydning |
| `journalSourceName` | string | |
| `memberNumber` | object | trolig null / medlem |

Kolonner i UI: DATO, KASSERER, KASSE, BONGNR, SUBTOTAL, BUTIKK. Filter-felter: `freetextSearchInput`, `fromDatePicker`, `toDatePicker`, `fromTimePicker`, `toTimePicker`, `receiptNumber`, `paymentMethods`.

## Detaljer

Komponent: Angular-komponent med `selectedRow` og `loadReceiptDetails` (bundle `bundles/backoffice/journal`).

`receiptIdentifier` bygges fra raden:

```js
{
  endDateTime:       row.endDateTime,
  journalSourceName: row.journalSourceName,
  retailStoreNum:    row.storeNumber,
  sequenceNum:       parseInt(row.transactionId.substr(row.transactionId.lastIndexOf('-') + 1)),
  workstationNum:    row.workstationNumber
}
```

Valgt rad → 500 ms debounce → `journalApi.getReceiptDetails(receiptIdentifier)`. Svar `{requestSucceeded, data}`, der `data` er rendret HTML som skrives til iframen. Cache: 100 kvitteringer (`detailsCache`, nøkkel = `JSON.stringify(receiptIdentifier)`). Signaturer hentes separat (`fetchSignaturesIfPossible`, `signaturesCache`).

## Kvitterings-HTML (iframe)

Elementer: `STYLE`, `DIV.search-ignore`, `BR`, `TABLE.ReceiptTable`, `TR/TH/TD`, `TD.Subtotal`, `NEWLINE` (egendefinert), `P`.

Rader observert:

- Header: `Beskrivelse | (tom) | Beløp`
- Varelinje: `EAN VARENAVN | (tom) | beløp`; tom kolonne ukjent (antall/rabatt?)
- `Referanse: <nr>`
- Total: `Subtotal`-celler `Totalt | beløp`
- Betaling: `<metode>: | | beløp` (observert: `Bank:`)
- Bunn: dato/tid
- MVA-tabell: `MVA-grunnlag | MVA-% | MVA | Sum`
- Toppteksten (butikk, kasse, kasserer, bongnr) ligger utenfor `<tr>` og er ikke kartlagt.

## Kvitteringstyper og tekstmønstre (observert)

Gridkoder (108 rader, alle `journalSourceName=main`): `receiptType/saleChannel` 1/2 (98), 1/1 (7), 1/3 (1), 2/1 (1), 11/1 (1). Betydning av kanal 1/2/3 er ikke bekreftet.

| type | observasjon | innhold |
|---|---|---|
| 1 | vanlig salg, også med pant og retur | varelinjer, betaling, MVA |
| 2 | kassaoppgjør (ingen `totalAmount`) | `Kontant/Sjekk/Kreditt/Tilgodelapp`, `Sum`, `Pose: <nr>`, `Sendt bank`, `Differanse`, valørtabell `Valør | Beløp` |
| 11 | kasse 77, PDA-operasjoner | linjer med `Operasjon utført av: pda (Antall)`, `Antall: 6.000 stk à Kr 15.90`, totalraden heter `Sum` (ikke `Totalt`), ingen betalingslinje; betydning uavklart |

Mønstre i varelinjer:

- Pant på salg: `220 PANT | | 2.00` (positivt beløp, MVA 0 %). EAN-linjer starter med 13 siffer, interne varenr er kortere (`220`, `399`, `1024`).
- Panteretur: to rader, `RETUR VARE` etterfulgt av `399 PANTELAPP | | -150.00` (negativt beløp). Utbetaling: `Kontant tilbake: | | 556.00`.
- Mengde/pris: ekstra rad `Antall: 6.000 stk à Kr 15.90` under varelinjen.
- Avrunding: `Øreavrunding | -0.30`.
- Betaling: `Bank: | | beløp`, `Kontant: | | beløp`, `Kontant tilbake: | | beløp`; `Referanse: <nr>` på bankbetaling.
- Totalrad: `Subtotal:Totalt` (salg) eller `Subtotal:Sum` (type 11).
- Fallgruve: `(SLETT…` i varenavn er produktstatus, ikke annullering.
- Negativ `totalAmount` i gridet = panteretur/retur (-556, -0.7 observert).

Ikke observert ennå: annullert kvittering, manuell pris, parkert bong, spør pris, lokal kampanje, medlem (`memberNumber != null` forekommer på 11 av 108 rader).

## Rabatt og kupong (observert 2026-10-02, salg type 1)

Toppteksten (utenfor `<tr>`): butikknavn, org.nr, `Butikk: <nr>, Kassenr: <n>, Kasserer: <nr>`, `Kvittering: <seq> <dato> <tid>`, `Medlemsnr.: <nr>`.

```
7071862047727 LINEA GAVEBÅND 20M | | 4.36      (beløp er etter rabatt)
    Rabatt: Kr 4.36 (50.0%)                   (egen rad, én celle)
    Rabatt årsak:                             (tom her)
5712 APPELSIN | | 28.41
    Antall: 0.712 kg à Kr 39.90
Totalt | 72.77
Kupong (1ESD2LJ54XDMBB6F - COOP FROKOSTEGG FRITTG. 12PK L): | | 0.00
Kupong (1ESD2P6DRVPCCJY1 - Gruppe - Coop koppnudler, 65 g): | | 0.00
Coopay: | | 72.77
TransId: DK7TVRW5F2PC5
```

- Rabatt: `Rabatt: Kr <beløp> (<prosent>%)` hører til varelinjen over; `Rabatt årsak:` følger.
- Kupong: `Kupong (<id> - <navn>):` med beløp (0.00 her). Kupongvarene sto ikke på bongen, så linjene viser trolig kampanjer knyttet til bongen, ikke innløsning. Må bekreftes.
- Rabattårsaker (tekstnr i Lindbak): 1 Datovare, 2 Feil pris, 3 Prisløfte, 4 Reserveløsning kupong, 5 Annen Rabattårsak, 6 Best før. Hvordan årsaken skrives på kvitteringen (nummer eller tekst) er ikke sett; pluginen leser begge.
- Tolkning i pluginen (ubekreftet): kupong = sentral kampanje (CN/VPI). Lokale kampanjer er ikke sett.
- Betaling `Coopay:`; kvitteringsbunn har kortterminaltekst og `Kjøpeutbytte`-tabell (`Grunnlag | Kjøpeutbytte | MVA bonus`).

## Ikke i bruk: API-endepunkt

Beslutning: pluginen kaller ikke Lindbaks API. Kun gridets data og iframens DOM leses. Endepunktene er dokumentert for referanse (`JournalUrls.journalApiRoot` + …).

`journalApiRoot` er ikke verifisert; finn den med `$http.post`-hook (se under).

| metode | sti | merknad |
|---|---|---|
| POST | `GetReceiptDetails` | body = `receiptIdentifier`; returnerer HTML |
| POST | `GetReceiptXml` | body = `receiptIdentifier`; strukturert XML, ikke testet |
| POST | `GetReceiptPdf?receiptIdentifierString=…` | svar med `content` / `fileContents` (base64) |
| GET | `GetPDFMode` | |
| POST | `GetReceiptsHeaders/{n}` | liste |
| POST | `GetNextPrevReceiptHeaders/{n}` | navigering |
| GET | `GetStores` | |
| POST | `GetCashiers` | |
| ? | `getPosUnits` (kasser) | |

## Ukjent / neste steg

1. Finn eksempel på annullert, rabatt, manuell pris, parkert bong og medlem.
2. Kartlegg toppteksten (butikk, kasse, kasserer, bongnr, medlemsnr): `iframe.contentDocument.body.innerText`, første linjer.
3. Bekreft `saleChannel` 1/2/3 og `receiptType` 11.
4. Fastlegg robust parsing av iframen (rader, klasser `ReceiptTable`, `Subtotal`).

## Risiko

- Lindbaks DOM og grid-datamodell kan endres uten varsel; isoler parsing i ett lag med tester.
- Kvitteringer kan inneholde persondata; ingenting skal forlate enheten.

## Fra den gamle pluginen (verifisert i produksjon)

- API-rot: `/LindbakRetail_1/Journal/Viewer/Api/`. `POST GetReceiptDetails` med `{endDateTime, journalSourceName:'main', retailStoreNum, sequenceNum, workstationNum}`, headere `Content-Type: application/json`, `X-Requested-With: XMLHttpRequest` og `__RequestVerificationToken` (fra hidden input). Svaret er HTML (ev. JSON-kodet streng).
- Bongnr (kolonne `td[data-field="receiptIdentifier"]`) har formatet `butikk-kasse-sekvens`. Datokolonne: `td[data-field="endDateTime"]`.
- Butikklisten: `jQuery('#storesWrapper div.k-widget.k-multiselect').eq(1).data('kendoMultiSelect')`; `dataSource.data()[i].get('number')` og `.get('text')`. Sette butikker: `ms.value([nr…]); ms.trigger('change')`.
- CW-filter: `#fromDatePicker`, `#toDatePicker` (format `dd.mm.åååå`), `[ng-model="vm.selectedFilters.memberNumber"]`, `[ng-model="vm.selectedFilters.externalLoyaltyNumber"]`, `#freetextSearchInput`, `#receiptNumber`. Oppdater: `[ng-click="vm.applyFilters()"]`, nullstill: `[ng-click="vm.resetFilters()"]`. Verdier settes med native `value`-setter + `input`/`change`/`blur`.
- Gamle pluginen setter inn en egen avkrysningskolonne (`.kv-cb-cell`, `#kv-select-all`) og bruker `#kv-panel`, `.kv-cb`, `.kv-tag`, `.kv-checked`. Den nye bruker prefikset `kvr-` for å unngå kollisjon, men begge bør ikke kjøre samtidig.
