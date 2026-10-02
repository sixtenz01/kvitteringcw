# Mål for Kvitteringshenter-rewamp

Begrensning: ingen API-kall mot Lindbak. Kun gridets data og iframens DOM leses (se `receipt-map.md`).

## Kjernefunksjoner

| # | Funksjon | Kilde | Status |
|---|---|---|---|
| 1 | Finn kvitteringer med pant | linjer `220 PANT` (salg) og `399 PANTELAPP` (retur) | mønster kartlagt |
| 2 | Finn annullerte kvitteringer (f.eks. med pant) | detaljer / `receiptType` | trenger eksempel + kodeliste |
| 3 | Filter på varegrupper | ukjent kilde | risiko: varegruppe vises kanskje ikke på kvitteringen |
| 4 | Butikkfilter | `storeNumber` | lett |
| 5 | Medlemssøk | `memberNumber` | lett, format ikke bekreftet |
| 6 | Valg av flere kvitteringer | grid | lett |
| 7 | Eksport som PNG, hel kvittering | iframe → bilde | mulig, må rendre full høyde |
| 8 | Sortering på summer | `totalAmount` | lett |

## Tillegg

- Lagre filtre, og hurtigvalg for dato og tidspunkt.
- Duplikatsjekk: samme beløp, kasse og tid.
- Flagge returer, manuelle priser, rabatter og negative beløp.
- Filter på kasserer, kasse, betalingsmåte og kvitteringstype (retur, annullert, parkert).
- Summer for valgte kvitteringer, og pant-total.

## Åpne forutsetninger

- Innholdsfilter (pant, annullert, rabatt, manuell pris, betalingsmåte) krever skanning av detaljene: velg rad, vent ca. 500 ms, les iframe. Cache lokalt per sesjon, med fremdriftsvisning.
- Trenger eksempelkvitteringer: pant, annullert, retur, rabatt, manuell pris.
- Kodeliste for `saleChannel` og `receiptType`.
- Kilde for varegrupper.
- Pluginkoden finnes ikke i repoet.
