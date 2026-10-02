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

1. Kartlegg toppteksten (butikk, kasse, kasserer, bongnr, medlemsnr): `iframe.contentDocument.body.innerText`, første linjer.
2. Kartlegg tom kolonne i varelinjer: bruk kvittering med flere varer, rabatt og retur.
3. Kartlegg `saleChannel`- og `receiptType`-koder.
4. Fastlegg robust parsing av iframen (rader, klasser `ReceiptTable`, `Subtotal`).

## Risiko

- Lindbaks DOM og grid-datamodell kan endres uten varsel; isoler parsing i ett lag med tester.
- Kvitteringer kan inneholde persondata; ingenting skal forlate enheten.
