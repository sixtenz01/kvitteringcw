# Kvitteringshenter (ny kjerne)

Chrome MV3-utvidelse for Lindbak Chain Web → Kvitteringsjournal. Leser kun gridets data og DOM; ingen API-kall, ingen sending ut av nettleseren.

## Funksjoner

- Filter: butikk, kasse, kasserer, kvitteringstype, dato/tid (med hurtigvalg), sumintervall, negativ sum, medlem.
- Sortering på sum og tid.
- Valg av flere kvitteringer, sum for valgte.
- Duplikatsjekk: samme beløp, butikk, kasse og minutt.
- Skanning av pant: åpner hver synlige salgskvittering (type 1) i Lindbaks eget visningsfelt, leser linjene `NNN PANT` (salg) og `NNN PANTELAPP` (retur), og cacher beløp lokalt per kvittering. Filter «Pant» og pant-total for valgte. Ca. 0,5–1 s per kvittering; avbrytes med Stopp.
- Lagrede filtre (localStorage på chainweb.coop.no).

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
