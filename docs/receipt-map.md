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

## Endepunkt (`JournalUrls.journalApiRoot` + …)

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

## Ukjent / neste steg

1. `journalApiRoot` – hook `$http.post`:
   ```js
   var h=angular.element(document.body).injector().get('$http'),p=h.post;window.__kvp=[];
   h.post=function(u,d,c){window.__kvp.push({u:u,d:d});return p.apply(this,arguments)}
   ```
   Åpne en ikke-cachet kvittering, les `__kvp[0].u`.
2. Test `GetReceiptXml` med `__kvh.post(root+'GetReceiptXml', id)`; kartlegg elementnavn.
3. Kartlegg tom kolonne i varelinjer: bruk kvittering med flere varer, rabatt og retur.
4. Kartlegg `saleChannel`- og `receiptType`-koder.
5. Kartlegg toppteksten (butikk, kasse, kasserer, bongnr, medlemsnr).

## Risiko

- Intern API og DOM kan endres uten varsel.
- Bulk-henting kan gi rate limiting; begrens samtidighet.
- Kvitteringer kan inneholde persondata; ingenting skal forlate enheten.
