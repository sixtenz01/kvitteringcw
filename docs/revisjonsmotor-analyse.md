# Kvitteringshenter: analyse og forslag til avansert avviksdeteksjon

Dato 2026-10-16. Status: **forslag. Ingen filer i repoet er endret, ingen kode skrevet.**

## 0. Konklusjon

- Pluginen er langt forbi oppdragets startpunkt: 68 vektede avviksårsaker, 92 kontrollterskler pluss 5 bongterskler i 27 innstillingsgrupper, kalibrerende regnskapskontroller, revisjonsrapport med SHA-256 og hash-kjedet notatlogg. Mange av temaene A–H er allerede dekket (se 2.3). Jeg foreslår derfor ikke de samme kontrollene på nytt.
- Premiss som ikke stemmer: IndexedDB lagrer **skannede bonger og innstillinger, ikke listeradene** (kasserer, kasse, beløp, tid, medlem). Listen leses fra Kendo-gridet hver gang og ligger bare i minnet. Det finnes derfor ingen historikk å sammenligne mot utover det som er lastet nå. Det er det største hullet.
- Fire strukturelle hull, i prioritert rekkefølge: (1) ingen persistent historikk, (2) ingen felles statistikkmotor (ca. 10 separate «kasserer ved ≥ antall»-terskler, ingen volum-, time- eller kassejustering, ingen median/MAD, p-verdi eller FDR-kontroll), (3) kassaoppgjør brukes ikke som ankerpunkt (avstemming er visning, ikke funn; valør og pose leses men brukes ikke), (4) dekning og sekvensmodell antas, ikke testes.
- Verifisert feil (kjørt mot uttrukket kopi): `tempoChecks` tror alltid at listen har sekunder. `parseCellDT` fyller inn `:00`, så `secOK` blir sann selv når CW bare viser minutter. Fallbacken «bonger i samme minutt» aktiveres aldri. Detaljer i S1.
- 54 nye eller vesentlig forbedrede kontroller i kapittel 3. Rangering av de 15 mest verdifulle i kapittel 4. Arkitektur i 7, faseplan i 8.
- **Runde 2 (kapittel 12):** 25 flere kontroller og en ny verifisert defekt (S17): kasserer-ID brukes uten butikk som nøkkel, og «butikksnittet» i profilen er snittet over alle innlastede butikker. Totalt 79 kontroller.
- Ingenting er testet mot ekte CW-data. Alle presisjonsvurderinger er kvalitative. Formater som README selv markerer «ikke bekreftet» er behandlet som ubekreftet.

## 1. Grunnlag

- Koden som er gjennomgått ligger på grenen `claude/focused-hopper-vexc0j`, commit `0101561`, versjon 3.21.0. `main` og arbeidsgrenen for denne økten inneholder bare «Terms of Service». Pluginkoden er altså ikke i main.
- Lest: `extension/src/logic.js` (3508 linjer), `content.js` (4099), `report.js` (381), `extension/README.md`, `docs/receipt-map.md`, `docs/qa-revisjon.md`, `docs/plugin-goals.md`, testfilene.
- Kjørt på en uttrukket kopi i scratchpad: `logic`, `linjer`, `report`, `noapi` og `innhold` (node-testene), alle ok. Playwright-testene er ikke kjørt.
- Eneste ekte observasjonsgrunnlag i dokumentasjonen: 108 gridrader. Kodefordeling `receiptType/saleChannel`: 1/2 (98), 1/1 (7), 1/3 (1), 2/1 (1), 11/1 (1). Medlemsnr på 11 av 108.
- Ytelse er ikke målt.

Forkortelser: **G** = griddata alene (ingen åpning av bong). **K** = krever skannet kvittering. **O** = krever kassaoppgjør (type 2, skannet). **Klasse**: **A** kan bygges nå, **B** krever historikk (persistert tx-lager og baselines), **C** krever mer detaljert kvitteringsdata eller bekreftet format, **D** kan ikke bygges med dagens datatilgang.

## 2. Dagens funksjoner

### 2.1 Arkitektur og dataflyt

| Lag | Hva det gjør | Sted |
|---|---|---|
| Innhenting | Leser Kendo-gridet (`collect()`), butikknavn fra CWs butikkliste, søk i CW ved å fylle CWs egne felt og trykke OPPDATER. Ingen API-kall (`noapi.test.js` feiler på `fetch`, XHR, `$http`, `/Api/`). | content.js:157–181 |
| Skanning | Velger rad, venter på iframen, `rowsFrom` → `parseReceipt` (v7) eller `parseSettlement`. Løpenr i topptekst kontrolleres mot valgt rad. Ca. 1 s per bong. | content.js:326–400, logic.js:347, 527 |
| Lagring | IndexedDB `kvr-store` v1 med to stores: `kv` (innstillinger, notater, notatlogg, kampanjesvar, sist kjørt) og `scan` (skannepost per transactionId, tak 10 000 poster / 25 MB). **Listeradene lagres ikke.** | content.js:16, 49–50, 85–97 |
| Analyse | `runChecks` kjører 27 funksjoner i logic.js → `findings` + `anomMap` → `riskScore` (sum av vekter, bare høyeste per familie) → RRS 0–100 = 100·(1−2^(−p/8)). Nivå: høy ≥ 8, middels ≥ 4. | content.js:1385–1437, logic.js:1405–1475 |
| Visning | Sjekk først, Diagram, Rapport, Fokus, Detaljer, Kontroll, Innstillinger, Diagnostikk. | content.js |
| Eksport | CSV, PNG, ZIP med `rapport.html`, `bevis/`, `data/*.csv/json`, `innstillinger.json`, `KONTROLLSUM.txt`. Notatlogg med lenket SHA-256. | report.js |
| Tester | ca. 712 linjer med assert i tre node-suiter, Playwright-e2e, `docs.test.js` krever at alle innstillinger og vekter er dokumentert. | extension/test |

Skannepost (v7): `items{c,n,a,q,p,d,dp,dr}`, `pay{etikett:sum}`, `np,neg,sale,ret,saleLines,retLines`, `disc*`, `coupons[]`, `tot`, `rnd`, `rf[]`, `cd[]{f,n,s}`, `mv[]`, `ku`, `ev[]`, `unk[]`, `hdr{s,w,c,m}`, `ft{t,a,e}`, `bu[]`, `hd`, `t`, `v`. Oppgjør: `settle{telt,diff,tilg,pose,bank,valor}`. Skanneposten har **ikke** butikk, kasse, kasserer, beløp, tid eller medlem fra listen.

### 2.2 Kontrollkatalog (det som finnes)

| Gruppe | Kontroller (vekt) | Kilde | Kjerneterskler |
|---|---|---|---|
| Per bong | Stor panteretur (3), Mange pantelapper (3), Kontant tilbake uten salg (4), Rundt beløp (1), Kassadifferanse (5) | G, K, O | ≥300 kr, ≥8, ≥500 kr hele hundre, ≥1 kr |
| Mønstre | Små returer før stenging (4), Kontant tilbake uten salg flere ganger (5), Samme beløp gjentatt (3) | G, K | ≥3 returer ≤100 kr siste 60 min før 22:00; ≥3; ≥3 per kasserer/dag og ≥50 kr |
| Falsk retur | Retur uten salg (3), Kortkjøp refundert kontant (5), Salg og retur av samme beløp (4) | K, G | krever ≥80 % skannede salg; 60 min |
| Salg etter kassaoppgjør (4) | | G | frist 5 min |
| Bongnummer | Hull (3), Nr/tid stemmer ikke (4), Dobbelt nr (3), Løpenr avviker fra tid (3) | G | hull ≤50; ±90 min mot 3 naboer hver side |
| Kassadifferanse | Gjentatte (4), Retur og differanse henger sammen (4) | O | ≥3 minus på ≥2 dager eller >100 kr; Spearman ρ ≤ −0,5 over ≥8 dager |
| Tallanalyse | Benford (2), Mange runde beløp (2), Avvikende siste siffer (2) | G | MAD >0,015; ≥5 % og 2× butikk; χ² p<0,001 |
| Rabatt | Uten årsak (3), Overvåket årsak (3), Høy % (3), Uten treff på andre salg (4), Mange uten årsak (2), kampanje-logikk med brukersvar | K | ≥30 %; årsak 2,4,5; 70–100 %; ≥30 % |
| Medlem | To butikker samtidig (4), Samme dag (2), Totalt (2), Én kasserer (3), Ansatt (2), Eget nr (5) | G | 30 min; ≥4; ≥15; ≥5 bonger, >80 % |
| Pris | Avvikende pris (3), Spør pris (3) | K | ≥10 % fra dagens modalpris (≥5 salg, ≥60 % modal) |
| Kjøpeutbytte | Mangler tabell (2), Grunnlag avviker (2) | K | kalibrerende |
| Regnskap | Linjer=Totalt (4), Betaling=Totalt (4), MVA (3), Ugyldig sats (4), Samme referanse (4) | K | 0,10 kr; kalibrerer: ≥10 bonger og ≥80 % stemmer |
| Pantelapper | Manuell (3), Mange manuelle (3), Slettet (4), Innløst flere ganger (4) | K | kode 99 mot 399; 60 min |
| Slettede/makulerte | Varelinjer slettet + pant kontant (5), Makulert ikke solgt på ny (3), Mange (3) | K | 120 min |
| Betaling/tekst | Spesialbetaling (3,3), Manuell kvittering (4), Gjentatte returer på kort (4), Hendelsesord (2) | K | ≥3 / 30 dager |
| Tempo | Rask rekkefølge (2), Mange 0-kr-bonger (2) | G | ≥4 bonger ≤25 s; ≥5 |
| Varer | Overvåkede varer (3,3,2), Retur av vare uten kjøp (4,3,1) | K | egen liste; 7 dager |
| Topptekst/bunn | Mot listen (3), Samme autorisasjonskode (3) | K | felt kontrolleres når ≥90 % stemmer fra før |
| Åpningstid | Bonger utenfor 06:00–23:00 (2) | G | én global verdi |
| Profil | Returandel, snittbeløp, pantelapper/bong, korrigeringer mot butikk | G, K | ×1,5, krymping k=10 |
| Visning uten funn | Dagsavstemming, pantbalanse, periode A/B, kanaltabell, mulige duplikater (filter) | | |

### 2.3 Dekning av temaene i oppdraget

✓ finnes · ◐ delvis (hva som mangler) · ○ finnes ikke (foreslått ID)

**A. Kassereratferd**

| Tema | Status |
|---|---|
| Unormalt mange returer | ◐ profil ×1,5 med krymping, uten p-verdi, time- eller kassejustering → KAS-01, KAS-02 |
| Uforholdsmessig store returer | ◐ bare pant (`bigReturn`) og snittbeløp → KAS-02, RET-04 |
| Uvanlig mange rabatter | ◐ kun «uten årsak»-andel → KAS-01 |
| Gjentatte identiske beløp | ✓ `repeatAmount` |
| Høy kontantandel | ○ → BET-02 |
| Mistenkelige sekvenser | ◐ saleThenReturn, cashNoSale → SEK-02, OPP-04, RET-03 |
| Unormalt raske transaksjoner | ◐ `tempoChecks`, men feil (S1) → KAS-05 |
| Atypiske tidspunkt | ◐ global åpningstid → TID-04, KAS-06 |
| Forskjeller mellom kasserere | ◐ fire metrikker → KAS-02 |
| Gjentatte kjøp samme medlem | ✓ memberDay/memberN/memberCash |
| Konsentrasjon av hendelser | ◐ ca. 10 enkelttester med absolutt antall → KAS-01 |

**B. Returer**

| Tema | Status |
|---|---|
| Flere returer på kort tid | ◐ bare før stenging → OPP-04, SEK-02 |
| Like beløp | ◐ `repeatAmount` (per dag, ikke vindu) → SEK-03 |
| Avvikende returer | ◐ falseReturns → RET-01, RET-03, RET-04 |
| Nær stenging | ✓ `smallReturns` (global stengetid, ≤100 kr) → forbedres av OPP-04 |
| Samme betalingsreferanse | ◐ `refDup` (alle bonger) |
| Uvanlige varekombinasjoner | ○ → LIN-01, LIN-02 |
| Gjentatte per kasserer/medlem | ◐ kasserer via profil, kort via `cardChecks`; medlem ○ → RET-05 |
| Mangler forventede data | ○ → RET-02 |
| Skille retur/pant/negativt | ◐ `realReturn`, `cancelled`, `isPantText` hver for seg → RET-01 |

**C. Rabatt og pris**

| Tema | Status |
|---|---|
| Høye rabatter, gjentatt årsak, kassereres mønster | ✓ |
| Pris mot historikk på EAN | ◐ bare samme dag og butikk → RAB-01 |
| Rabatt × betalingsmåte | ○ → RAB-05 |
| Rabatt rett før stenging | ○ → RAB-04 |
| Avvikende enhetspris | ✓ `priceDev` (krever ≥5 salg/dag/butikk, dekker lavvolum dårlig) |
| Kuponger | ◐ tellinger → RAB-08 |
| Negativ margin | D (ingen kost) |

**D. Medlem**

| Tema | Status |
|---|---|
| Svært mange bonger samme nr | ✓ |
| Samme medlem på flere kasser samtidig | ◐ kun ulike butikker → MED-01 |
| Kassererens konsentrasjon av medlemsnr | ◐ per medlem, ikke per kasserer → KAS-04 |
| Små gjentatte kjøp | ◐ → MED-02 |
| Retur/rabatt/medlem-samspill | ○ → RET-05, C02 |
| Registrering som avviker fra butikkens mønster | ○ → KAS-04, MED-03 |

**E. Kassaoppgjør**

| Tema | Status |
|---|---|
| Gjentatte differanser, høye absolutte | ✓ |
| Normalisert mot kontantvolum | ○ → OPP-02 |
| Samme retning | ◐ bare minus telles → OPP-03 |
| Unormale intervaller | ○ → OPP-07 |
| Kontanttransaksjoner mot oppgjør | ◐ `reconcile` vises, er ikke funn → OPP-01 |
| Kontantreturer mot negativ differanse | ◐ bruker returandel, ikke kontantsum → OPP-08 |
| Valørfordeling | ○ parses (`valor`), brukes ikke → OPP-05 |
| Identiske differanser | ○ → OPP-03 |

**F. Sekvenser**

| Tema | Status |
|---|---|
| Hull, dubletter, rekkefølge | ✓ (forutsetter delt serie, testes ikke → ENG-02) |
| Intervaller, tempo | ◐ → KAS-05, SEK-04 |
| Gjentatte beløp i korte intervaller | ◐ → SEK-03 |
| Retur rett etter salg | ◐ bare samme sum → RET-03 |
| Mønstre før oppgjør | ○ → OPP-04 |

**G. Betaling**

| Tema | Status |
|---|---|
| Kontant/kort-fordeling | ○ (`payStats` er beskrivende) → BET-02 |
| Kontanter tilbake | ◐ bare uten salg → BET-01 |
| Betaling mot Totalt | ✓ `ledger` (men hopper over når betalingslinjer mangler → RET-02) |
| Split-betalinger | ○ → BET-06 |
| Like kortbeløp, samme kort | ◐ kort bare på retur → BET-03 |
| Betalingsmåter per kasse | ○ → BET-02 |

**H. Varelinje**

| Tema | Status |
|---|---|
| Like varer, antall/mengder | ○ → RAB-06, LIN-01 |
| Ekstreme enhetspriser | ◐ → RAB-01 |
| Identiske handlekurver | ○ → LIN-01 |
| Varer × rabatter | ◐ kampanje/overvåking → LIN-02 |
| Prisendringer på EAN | ○ → RAB-01 |
| Pantlinjer | ◐ → LIN-03 |
| MVA, linjesummer | ✓ `ledger`; q×pris ○ → RAB-02 |

### 2.4 Svakheter, overlapp og hull

| # | Funn | Bevis | Konsekvens |
|---|---|---|---|
| S1 | **Tempo tror alltid listen har sekunder.** `parseCellDT` setter `:00` når cellen bare har minutter (logic.js:67–73). `tsSec().sec` blir da alltid sann (2888–2891), `secOK` = true og `secShare` = 1 (2907–2908). Minuttfallbacken `paceMinuteN` kjøres aldri. Kjørt: fem bonger i minutter 10:00/10:00/10:00/10:00/10:01 ga `secOK:true, secShare:1, minGap:0`. `collect()` foretrekker cellen framfor rådata (content.js:~175), så sekunder i rådata brukes ikke. | Testen virker som «≥4 bonger i samme minutt», og går glipp av serier som krysser minuttgrensen. Diagnostikken viser feil oppløsning. |
| S2 | **Ingen persistent historikk.** `recs` bygges fra gridet (`collect()`, content.js:157). `scan`-storen har ikke kasserer/kasse/beløp/tid/medlem. | «Historiske sammenligninger» er begrenset til det som er lastet. Ingen egen baseline per kasserer/EAN/kasse. |
| S3 | **Ingen felles statistikkmotor.** Absolutte antall i ca. 10 innstillinger (`discWatchN`, `priceCashN`, `lappManualN`, `voidCashN`, `specialN`, `askN`, `zeroN`, `watchN`, `memberCashN`, …). Profil bruker fast ×1,5. Ingen median/MAD (treff på «MAD» er Benford), ingen p-verdi/FDR bortsett fra siste siffer. | Volumavhengig: stor kasserer flagges oftere enn liten. Mange samtidige tester uten flertestkorreksjon. |
| S4 | **Åpningstid er én global verdi** (`openFrom/openTo`, `closeTime`). Ingen ukedag, butikk eller helligdag (0 treff på søndag/helligdag/påske i koden). | Søndagssalg og butikkspesifikke avvik fanges ikke. |
| S5 | **Sekvensmodellen antas.** README: «Forutsetter at alle kvitteringstyper deler nummerserie per kasse». Ingen test for nullstilling, deling mellom kasser eller dokumenttypers påvirkning. Hull rapporteres per hull, ikke aggregert per kasserer. | Falske positive ved annen nummerering; ingen konsentrasjonsanalyse. |
| S6 | **Avstemming er visning.** `reconcile` har `flag` og `complete`, men resultatet legges ikke i `res.findings` og gir ingen poeng (content.js:1430–1437). | Kontantavvik mellom salg og oppgjør er synlig, men uten score og dekningsport. |
| S7 | **Kassadifferanse:** ingen normalisering mot kontantvolum, bare minus telles, ingen test på identiske beløp. | Små og store kasser sammenlignes i kroner. Systematisk like differanser oppdages ikke. |
| S8 | **Prisavvik** krever ≥5 salg av samme EAN samme dag og butikk og ≥60 % modal pris (logic.js:2269–2300). | Lavvolum-varer og alle varer i små butikker dekkes ikke. Ingen historikk. |
| S9 | **Lest, men ikke brukt i kontroller:** `q` (mengde), `ft.e` (inngangsmåte), `ft.t` (terminal, bare i auth-nøkkel), `cd` (kort, bare på retur), `settle.valor`, `settle.pose`, `settle.bank` (bare visning), `settle.telt.kreditt/sjekk`, `settle.tilg`, `rf` (bare duplikat), `saleChannel` (bare beskrivende tabell), `rnd` (bare toleranse), betalingslinjenes antall og rekkefølge (slås sammen per etikett). | Se 2.5. |
| S10 | **Titler som nøkler.** Vekter, familier og innstillingsgrupper er nøklet på norske visningstekster (`RISK_WEIGHTS`, `FAMILIES`, `SETTING_GROUPS[].weights`). `code` finnes på funn, men brukes ikke som identitet. Ingen kontrollversjon. | Omdøping bryter lagrede innstillinger. Ikke mulig å si hvilken regelversjon som ga et funn. |
| S11 | **Ingen stabil funnidentitet mellom kjøringer.** Dedup skjer bare innen bong (`FAMILIES`). «Ny» baseres på liste over bong-ID-er fra forrige kjøring (`lastrun`). | Samme hendelse kan dukke opp som nytt funn når omfanget endres. |
| S12 | **Poeng er additive og håndvalgte.** «Sjekket» og «Til oppfølging» sier ikke om funnet var et treff. | Ingen læring om hvilke kontroller som gir falske positive. |
| S13 | **Skalering:** `falseReturns` filtrerer alle salg for hver retur (O(R·S)), logic.js:1615. Ikke målt. | Risiko ved flere ukers data. |
| S14 | **Åpne punkter fra egen QA:** F5 (sommertid gir to like lokale tider) og F13 (cache-visning, «Tøm cache») er ikke rettet. | |
| S15 | **Mange kontroller hviler på ubekreftede formater:** spør pris, kortlinje, slettede linjer, manuell kvittering, spesialbetaling, Kjøpeutbytte, topptekst/bunn. Noen kalibrerer seg (ledger, topptekst, KU), andre har ingen kalibrering (hendelsesord, spesialbetaling). | |
| S16 | **Duplikatsjekken** (`findDuplicates`, samme beløp/kasse/minutt) er filter, ikke scoret kontroll. | |

### 2.5 Uutnyttede datafelter

| Felt | Status i dag | Muligheter |
|---|---|---|
| `saleChannel` | beskrivende tabell (`channelStats`) | Stratifiseringsvariabel for jevnaldrende (uten å anta betydning). Kontroll av at kasse↔kanal er stabil. |
| `journalSourceName` | ubrukt (alltid `main`) | Datakvalitetsvakt: ny verdi gir varsel om endret kilde. |
| Rå `endDateTime` | brukes bare om cellen mangler | Sekunder når rådata har dem og minuttet stemmer med cellen (S1). |
| Topptekst-tid `hd` | bare tidsforskyvning i Diagnostikk | Hvis tidspunktet er starttid: **varighet** = endDateTime − hd, grunnlag for «unormalt raske» bonger. Må bekreftes (differansen skal øke med antall linjer). |
| `memberNumber` (grid) | medlemstester per nummer | Kasserernivå: andel, mangfold, HHI (KAS-04). |
| Type 2-rader | bare «salg etter oppgjør» | Tidsanker for aktivitetsklynger, rytme, kasserer-bytte (OPP-04, OPP-07). |
| `settle.valor/pose/bank/telt.kreditt` | visning | Integritet og rytme (OPP-05/06, OPP-01). |
| `q`, enhet, `p` | q vises, p brukes i prisavvik | q×p−d=a (RAB-02), mengdeavvik (RAB-06). Enhet («stk», «kg») droppes i parseren (QTY_ROW, logic.js:307). |
| `ft.e`, `ft.t`, `ft.a` | funnet i parsing, ikke i kontroller (unntatt auth-duplikat) | BET-04, BET-05. |
| `cd` | tre returer på samme kort | BET-03, RET-06. |
| `rf` | duplikat | Referanse mot retur, sekvens per terminal (ubekreftet). |
| `rnd` | toleranse | BET-07. |
| `pay`-linjer | summert per etikett | Antall linjer og rekkefølge (BET-06) krever parserendring. |
| Rabatt kr og % | begge lagres | Konsistens (RAB-02). |
| Kupong `a` | tall på kuponger | Innløst beløp, gjentak per medlem (RAB-08). |
| Type 11 | uavklart | Kun beskrivende statistikk; ingen kontroll uten semantikk (D). |
| `unk`, `bu` | Diagnostikk | Grunnlag for å lære nye formater; ikke automatisert. |
| Notatstatus | «sjekket»/«oppfølging» | Utfallsdata om det utvides (7.9). |

## 3. Nye eller vesentlig forbedrede kontroller

Presisjon er kvalitativ. «Feilkilder» angir hva som gir falske positive. Alle foreslåtte funn skal vises som indikasjon med normale forklaringer, ikke som konklusjon om person eller forsett.

### 3.1 Motor og porter

| ID | Kontroll | Risiko | Kilde | Algoritme og implementering | Krav | Presisjon og feilkilder | Kompl. | Prio | Klasse |
|---|---|---|---|---|---|---|---|---|---|
| ENG-01 | Dekningsmotor | Feilkonklusjoner når grunnlaget er ufullstendig | G, K, O | Per (butikk, kasse, dag): komplett = distinkte løpenr / (maks − min + 1). Skannedekning per kontrolls krav. Tidsdekning mot butikkens envelope (TID-04). Hver kontroll får `coverage` og returnerer «ikke vurdert» under eget minimum (i dag hardkodet 80 % i flere funksjoner). | Ingen nye data. Bruker ENG-02. | Høy som port. Løpenr-spenn undervurderer dekning hvis serien deles. | Middels | P1 | A |
| ENG-02 | Sekvensmodell-validering | Hull- og rekkefølgefunn bygger på ubeviste forutsetninger | G | Per (butikk, kasse): inversjonsandel mot tid; nullstilling = fall i nr uten tidsbrudd → epoker; deling = overlappende nummermengder mellom kasser; dokumenttype-effekt = andel hull inntil type 2/11-rad. Gir `seqModel{epoker, pålitelig}`. Hulltesten kjøres per epoke og bare når pålitelig, ellers «ikke vurdert». | Ingen nye data | Høy. Korte utsnitt gir lav styrke. | Middels | P1 | A |

### 3.2 Kassereratferd, statistikk og tid

| ID | Kontroll | Risiko | Kilde | Algoritme og implementering | Krav | Presisjon og feilkilder | Kompl. | Prio | Klasse |
|---|---|---|---|---|---|---|---|---|---|
| KAS-01 | Hendelseskonsentrasjon (EB + test + FDR) | Kasserer med unormal rate av retur, 0-kr, kontantutbetaling, rabatt uten årsak, makulering, manuell lapp, hull-nærhet m.m. | G, K | For hendelse e: forventet E_c = Σ_h n_c,h · μ_h (μ_h = butikkens rate time h uten kasserer c, strata på kasse/kanal). Observert k_c. p = Poisson/binomial-hale. EB-rate (k + m·μ)/(n + m) (samme idé som dagens `profShrink`). Benjamini–Hochberg over kasserer × hendelse. Funn krever FDR < q, k ≥ k_min og effekt ≥ f·μ. Erstatter ca. 10 enkelttester. | n per time (G). Hendelsesflagg per bong (K for K-hendelser). | Middels–høy. Feilkilder: små n, felles hendelser (kampanje, kø), spesialkasse (stratifiser). | Middels | P1 | A |
| KAS-02 | Kassererradar (robust z) | Store forskjeller mellom kasserere i samme butikk | G, K | ca. 12 metrikker per kasserer (returandel, snittbeløp, linjer/bong, 0-kr, kontantandel, medlemsandel, rabattandel, kontant-tilbake-andel, bonger/time, makulerte linjer, manuell lapp, korreksjoner). Modifisert z = 0,6745·(x − median)/MAD blant jevnaldrende (samme butikk og kanal); |z| ≥ 3,5 etter EB-krymping; MAD=0 → IQR. Vis percentil og Wilson-intervall. Flere samtidige avvik samles på én rad, ikke poeng per metrikk. | ≥5 jevnaldrende | Middels. Avhenger av vaktmiks og kasse-type. | Middels | P1 | A |
| KAS-03 | Kasserer samtidig på flere kasser/butikker | Delt innlogging, utlånt ID, feilregistrert kasserer | G | Per kasserer, sortert på tid: (a) to butikker innen T min (T ≈ 5–10), (b) samme butikk, kasse A→B→A innen få minutter ≥ k ganger (interleaving), (c) overlappende intervaller når varighet er kjent (KAS-05). Rapporter dager og andel av kassererens bonger. | Kun grid | (a) høy, men forutsetter kjedeunik kasserer-ID (se S17 i 12.1), (b) middels (avløsning, flytting mellom kasser), krever gjentak. | Lav | P1 | A |
| KAS-04 | Medlemsandel og -mangfold per kasserer | Bonusmisbruk, tastet medlemsnr, kasserer som «samler» på få nummer | G | attach = medlemsbonger/bonger. Mangfold = distinkte nr / medlemsbonger. HHI = Σp_i². Entropi. Test mot jevnaldrende (KAS-02), time-justert. Flagg lavt mangfold + høy attach. | Kun grid | Middels. Stamkunder, ansattkasse, kampanjeperioder (stratifiser). | Lav | P1 | A |
| KAS-05 | Tempo med riktig oppløsning, og varighet | Unormalt raske bonger, pre-tastede salg | G, K | (1) Retting av S1: bruk rådata med sekunder når de finnes og minuttet stemmer med cellen; ellers marker `sec=false` og bruk minuttfallback. (2) Varighet = endDateTime − topptekst-tid (hvis tiden er start). (3) Linjer per minutt per kasserer, robust z mot jevnaldrende. | Bekreftet tidssemantikk | Middels. | Lav–middels | P2 | C |
| KAS-06 | Kassererens tidsprofil | Atypiske tidspunkt per kasserer/kasse | G | Normalisert histogram time × ukedag for kasserer p mot referanse q (butikk, senere egen historikk). Jensen–Shannon-avstand + permutasjonstest. Flagg når over egen p95 og over jevnaldrende. | Peers nå, egen historikk krever lager | Lav–middels. Vaktskifter og ferie. | Middels | P2 | B |
| KAS-07 | Ny/sjelden kasserer-ID | Test-ID, delt ID | G | ID ikke sett i baseline, eller få bonger og uvanlig beløpsandel. Kontekst, ikke poeng. | Historikk | Lav (nyansatte). | Lav | P3 | B |
| TID-01 | Endringspunkt (EWMA/CUSUM/PELT) | Systematiske endringer over tid | G, K | Daglig/ukentlig rate per kasserer og butikk. EWMA z_t = λx_t + (1−λ)z_t−1 med grenser μ ± L·σ·√(λ/(2−λ)). CUSUM S_t = max(0, S_t−1 + x_t − μ − k), alarm S_t > h. Nivåskifte med PELT (BIC-straff). Sesongjustert med TID-02. | Historikk ≥ 8 uker | Middels. Krever stabil baseline. | Middels | P2 | B |
| TID-02 | Ukedag × time-baseline | Sesongjustering for alle rate-kontroller | G | Median per (butikk, ukedag, time) av bonger og hendelsesrater, krympet mot butikk. Brukes av KAS-01, KAS-06, TID-01, TID-04. | Historikk ≥ 4 uker | Middels. | Middels | P2 | B |
| TID-03 | Periodesammenligning med test | Erstatter faste «+10 prosentpoeng» i A/B | G, K | To-proporsjons-z eller Fisher per kasserer og metrikk, BH. Vis konfidensintervall. Dagens `comparePeriods` bruker faste terskler uten utvalgsfeil. | Kun grid | Middels–høy. | Lav | P2 | A |
| TID-04 | Åpningstid-envelope per butikk × ukedag, og helligdag | Salg utenfor lovlig/typisk åpningstid, søndags-/helligdagssalg | G | Lær envelope per (butikk, ukedag) = [P0,5; P99,5] av bongtid (eller median ± k·MAD). Kalender med norske helligdager (påskeberegning, 1.1, 1.5, 17.5, Kristi himmelfart, pinse, 25.–26.12) som sekundær informasjon. Funn: bonger utenfor envelope, eller på dag der butikken ellers er stengt. Erstatter global 06:00–23:00. | Envelope fra innlastet periode (A); stabil envelope krever historikk (B). | Høy for helligdag/søndag der butikken ellers er stengt. Middels for envelope. Hovedregelen etter helligdags- og åpningstidslovgivningen har unntak (små butikker, enkelte bensinstasjoner, turistsoner); verifiser per butikk. | Lav–middels | P1 | A |

### 3.3 Returer og refusjoner

| ID | Kontroll | Risiko | Kilde | Algoritme og implementering | Krav | Presisjon og feilkilder | Kompl. | Prio | Klasse |
|---|---|---|---|---|---|---|---|---|---|
| RET-01 | Negativ-hendelse-klassifisering | Skiller retur, panteretur, sletting, korreksjon og annet. Fjerner falske positive i alle retur-/slette-/kontantkontroller. | K | Hver negativ bong/linje klassifiseres én gang: PANT (kun pantlinjer), SLETT (linje + motlinje på samme bong), KORR (negativ linje + positiv erstatning), RETUR (negativ EAN-linje uten motlinje), JUST (rabatt/kupong), UKJENT. Lagres som `evt` på skanneposten og brukes av alle kontroller i stedet for dagens separate heuristikker (`realReturn`, `cancelled`, `isPantText`, `netNp`). | v5-skanning | Middels–høy. Avhenger av hvordan CW viser sletting (ubekreftet). | Middels | P1 | C |
| RET-02 | Strukturbrudd: uten betaling, tom bong, retur uten utbetaling | Bong som ikke går opp strukturelt | K | Type 1 med total ≠ 0: ingen betalingslinjer → funn. Ingen varelinjer (utenom pant) og total ≠ 0 → funn. Total < 0 uten kontant tilbake eller kortrefusjon → funn. Dagens `ledger` hopper over alle tre når `pay`/`items` er tom (payOK/lineOK = null). Kalibrering som ledger (≥10 bonger, ≥80 % normale). | v5 | Høy (deterministisk). Utelat type 11. | Lav | P1 | A |
| RET-03 | Retur rett etter salg (linjenivå) | Salg angret via retur, «kjøp og returner» for å flytte kontanter | K | Indekser salgs- og returlinjer per (butikk, kasse). Sekvens salg → retur med ≥1 felles EAN, Δt ≤ T (standard 10 min), uansett beløp og kasserer. Vekt opp ved kontantutbetaling og samme kasserer. Dagens test krever identisk totalbeløp og 60 min. | K | Middels. Angrende kunder er legitimt → konsentrasjon via KAS-01. | Middels | P2 | A |
| RET-04 | Returpris over salgs-/baselinepris | Refusjon høyere enn solgt pris | K | Enhetspris på returlinje mot (a) matchende salg (samme EAN, nyeste før) eller (b) EAN-baseline (RAB-01). Flagg > baseline + toleranse, rabatt tatt hensyn til. | K (matchet salg) ; B for baseline | Middels. Prisendring/kampanje mellom salg og retur. | Middels | P2 | A |
| RET-05 | Medlem med mange returer | Retur knyttet til medlem | G | Per medlem (pseudonymisert): returer/bonger i perioden, EB-krympet, binomial mot butikk, BH. Fordeling på kasserere. | Kun grid | Lav–middels. Medlem finnes bare på deler av bongene. | Lav | P2 | A |
| RET-06 | Refusjon til annet kort enn originalen | Returmisbruk via annet kort | K | Koble retur til salg via EAN + beløp (som `falseReturns`), sammenlign kortnøkkel (skjema + BIN + siste 4). Ulik = funn. | v6; kortlinje på retur må bekreftes | Middels når BIN finnes. Siste 4 alene er ikke unik. | Middels | P2 | C |

### 3.4 Rabatt og pris

| ID | Kontroll | Risiko | Kilde | Algoritme og implementering | Krav | Presisjon og feilkilder | Kompl. | Prio | Klasse |
|---|---|---|---|---|---|---|---|---|---|
| RAB-01 | EAN-prisbaseline over tid | Prisavvik mot historikk, manuell/feil pris, lavvolum-EAN | K | Persistent indeks `price[ean]`: median, MAD og antall per butikk og kjede, glidende. Nivåskifte som varer ≥ k bonger/≥ 2 dager = prisendring (endringspunkt), ikke avvik. Funn: enkeltlinjer med |p − median| > max(x·MAD, y %) utenfor kjent skifte. Bruker enhetspris (rabatt lagt tilbake). | K + historikk | Middels–høy for hyppige varer. Kampanje, flerkjøp, vektvarer gir støy. | Middels | P1 | B |
| RAB-02 | Linjeregnskap: antall × pris − rabatt | Manuell overstyring av linjebeløp, tastefeil | K | For linjer med `Antall: q à p`: forventet = round(q·p) − d. Flagg |a − forventet| > 0,05 + avrundingsslakk. Rabatt: |d − dp% · (a + d)| > toleranse. Aggreger per kasserer via KAS-01. | v4 (q, p, d, dp finnes) | Høy (deterministisk). Feilkilder: avrundingsregler per vare, flerkjøpstilbud. | Lav | P1 | A |
| RAB-03 | Rabatt-strukturbrudd | Rabattmisbruk | K | Deterministisk: d > 0 på pantlinje; d ≥ a + d (≥100 %) med a > 0; d > 0 på negativ linje. | v3 | Høy. | Lav | P2 | A |
| RAB-04 | Rabatt-tidsprofil | Store rabatter rett før stenging, årsaksspesifikke tidsmønstre | G, K | Rabattlinjer per time og minutter til stenging (TID-04) og årsak. χ²/JS kasserer mot butikk. Andel i siste 30/60 min. «Datovare»/«Best før» får egen forventet profil lært fra butikken. | v3 + G | Middels. Nedmerking sent på dagen er legitimt. | Middels | P2 | A |
| RAB-05 | Rabatt × betalingsmåte | Rabatt knyttet til kontant | K | 2×2 (rabatt uten årsak ja/nei × kontant ja/nei) per kasserer, stratifisert på time (Mantel–Haenszel), oddsrate med konfidensintervall, BH. | v3 + v5 | Lav–middels. | Middels | P2 | A |
| RAB-06 | Mengdeavvik per EAN | Uvanlig antall, tastefeil | K | log(q) > median + k·MAD per EAN. Brøkantall på stk-varer (krever at parseren beholder enhet). Ekstremt linjebeløp > P99,9 per EAN. Null/negative mengder. | v4; enhet krever parserendring | Middels. Vektvarer, storhandel. | Middels | P2 | C |
| RAB-07 | Ugyldig GTIN-kontrollsiffer | Manuelt tastet eller konstruert EAN | K | GTIN-8/13/14 sjekksum (vekt 3/1 fra høyre). Andel ugyldige per kasserer mot butikk (KAS-01). Interne koder utenfor 8/12–14 siffer holdes utenfor. | v4 | Høy for sjekksummen; tolkning «manuell inntasting» middels. | Lav | P2 | A |
| RAB-08 | Kupongbruk | Uvanlig kupongbruk | K | `a` ≠ 0 (innløst), kupong-ID × medlem gjentatt, kuponger per bong over p99, kasserer-andel. Aktiveres først når Diagnostikk viser at ID er per kunde, ikke kampanje-ID. | v3; format må bekreftes | Lav inntil format er kjent. | Lav | P3 | C |

### 3.5 Medlem

| ID | Kontroll | Risiko | Kilde | Algoritme og implementering | Krav | Presisjon og feilkilder | Kompl. | Prio | Klasse |
|---|---|---|---|---|---|---|---|---|---|
| MED-01 | Samme medlem på flere kasser samtidig (samme butikk) | Delt kort, kasserer taster nr på parallelle salg | G | Per medlem og butikk: bonger på ulike kasser med |Δt| ≤ T (standard 2 min). Tell episoder. Dagens test ser bare ulike butikker. | Kun grid | Middels–lav. Familier i parallelle køer. | Lav | P1 | A |
| MED-02 | Små gjentatte kjøp | Bonusfarming | G | Per medlem og dag: antall bonger med beløp ≤ P25 av butikkens bonger og Δt ≤ 30 min. Score = antall × (1 − beløpspercentil). Utvider dagens «≥4 samme dag». | Kun grid | Middels. | Lav | P3 | A |
| MED-03 | Medlemsnr-format og dummynummer | Standard-/testnummer, tastefeil | G | Modal lengde/mønster per butikk. Flagg repeterende siffer, trappetrinn, nummer brukt av ≥3 kasserere med lav bongverdi. Frekvensfordeling: toppnummer mot stamkunde. | Kun grid; formatet er ikke bekreftet | Lav–middels. | Lav | P2 | A |

### 3.6 Kassaoppgjør

| ID | Kontroll | Risiko | Kilde | Algoritme og implementering | Krav | Presisjon og feilkilder | Kompl. | Prio | Klasse |
|---|---|---|---|---|---|---|---|---|---|
| OPP-01 | Avstemming som funn | Kontantavvik mellom salg og oppgjør | K, O | Løft `reconcile` fra visning til funn: avvik = telt kontant − (Σ Kontant − Σ Kontant tilbake) per kasse og dag. Port: ENG-01 komplett (alle salg skannet, løpenr komplett) og ett oppgjør per kasse/dag. Også kort: Σ Bank/kort mot oppgjørets «Kreditt». Ellers «ikke vurdert» med årsak. | v5 + oppgjør | Middels–høy under porten. Feilkilder: vekselkasse, uttak/innskudd, døgnskifte. | Middels | P1 | A |
| OPP-02 | Differanse mot kontantvolum | Små differanser på store volum vs store på små | K, O | rel = diff / telt kontant (eller Σ kontantomsetning). Robust z mot kassens og butikkens historikk. Vis kr og promille. | Oppgjør + salg | Middels. Trenger ≥ n oppgjør. | Lav–middels | P1 | A |
| OPP-03 | Identiske og retningsbundne differanser | Systematisk uttak, avrunding, «jevne» beløp | O | (a) Modus: samme diff ≠ 0 ≥ 3 ganger per kasserer/kasse. (b) Fortegn: Wald–Wolfowitz runs test eller binomial på andel minus. (c) diff mod 50/100 = 0 oftere enn tilfeldig. Dagens test teller bare minus, ikke verdier. | Oppgjør | (a) middels–høy. | Lav | P1 | A |
| OPP-04 | Aktivitetsklynge før oppgjør | «Rydde opp» før telling: retur, sletting, kontantutbetaling, 0-kr, manuell lapp | G, K, O | For hvert oppgjør: vindu W (standard 30 min) før. Tell hendelser e i W mot kassens rate resten av dagen (Poisson-test + effektstørrelse). Aggreger per kasserer over dager (binomial på «dager med klynge»). Erstatter dagens «Små returer før stenging» som bruker butikkens stengetid. | G (retur, 0-kr), K (kontant, sletting), O (tid) | Middels. Stengetid gir naturlig opphopning → sammenlign mot samme vindu på dager uten avvik. | Middels | P1 | A |
| OPP-05 | Valør-integritet og -fordeling | Tellefeil, avvikende kontantsammensetning | O | (a) Σ valør = telt kontant (±0,01). (b) Hver linje mod valørverdi = 0, ellers tolk som antall (adaptivt). (c) Andel store sedler per kasse mot kassens historikk (χ²). | Oppgjør; hva «Beløp» betyr må bekreftes | (a), (b) høy. (c) lav–middels. | Lav | P1 | C |
| OPP-06 | Posenummer og sendt bank | Dublett/kjede i pose, avvikende vekselbeholdning | O | Samme posenr på to oppgjør i butikken. Hull/ikke-monoton sekvens. float = telt kontant − sendt bank, robust nivå per kasse (median/MAD), flagg ved skifte. | Oppgjør | Høy for dublett. Middels for float. | Lav | P1 | A |
| OPP-07 | Oppgjørsrytme og -intervaller | Uvanlig antall oppgjør, tomme oppgjør, kasserer-bytte | G | Per kasse/dag: antall type 2, intervall mellom, tid mot envelope (TID-04), oppgjør uten salg siden forrige, oppgjør av annen kasserer enn siste salgs. z mot kassens historikk/peers. | Kun grid | Middels. | Lav | P2 | A |
| OPP-08 | Kontantutbetaling mot differanse | Dekke manko med kontantretur | K, O | Daglig per kasse: Σ kontantutbetalinger (Kontant tilbake på negative bonger) mot diff. Theil–Sen/Spearman på dagsserier. Erstatter «returandel» som proxy i dagens `retDiffCorr`. | ≥8–10 dager | Middels. | Middels | P2 | B |
| OPP-09 | Differanse-forklaring | Utredningsstøtte: hvilken bong forklarer differansen? | K, O | For oppgjør med |diff| ≥ T: søk 1–2 bonger (kontantbeløp, pant, retur) med sum ≈ |diff| siden forrige oppgjør. Rangér på eksakthet og få kandidater. Vises som hint, ikke funn. | K + O | Lav–middels (tilfeldige treff ved mange bonger). | Middels | P3 | A |

### 3.7 Sekvenser

| ID | Kontroll | Risiko | Kilde | Algoritme og implementering | Krav | Presisjon og feilkilder | Kompl. | Prio | Klasse |
|---|---|---|---|---|---|---|---|---|---|
| SEK-01 | Hull-konsentrasjon | Bongnr forsvinner rundt bestemte kasserere/tidspunkt | G | Bruk ENG-02. Tilordne hull til nabobong(er). Per kasserer: hull-nærhet mot forventet (binomial), nærhet til oppgjør (< W min). BH over kasserere. | Kun grid; ENG-01/02 som port | Middels. Filtrert grid og delt serie gir støy. | Lav–middels | P1 | A |
| SEK-02 | Hendelsesgrammatikk (n-gram) | Uvanlige kjeder: S→R→S, R→R→R, 0-kr→kontant, R→oppgjør | G, K | Kod hver bong til symbol (S, R, P, Z, K, O) per (kasse, dag). Tell bi-/trigram per kasserer. G² = 2ΣO·ln(O/E) mot butikken med baseratejustering. Støttekrav og BH. Forhåndsdefinerte sekvenser + eksplorativ liste til analytiker. | G; K for P, K, Z | Forhåndsdefinerte: middels. Eksplorativ: lav. | Middels | P2 | A |
| SEK-03 | Samme beløp i vindu | Duplikater, test, splittede salg | G | Glidende vindu (±5 min) på (beløp ± 0,5 kr, kasse/kasserer). count ≥ k. Lift = observert/forventet mot butikkens frekvens for beløpet. | Kun grid | Middels. Populære beløp (lift demper). | Lav | P3 | A |
| SEK-04 | Intervall-regularitet og pauser | Maskinelle sekvenser, uforklarlige pauser | G | CV av inter-arrival per kasse/dag. Lang pause mens andre kasser er aktive. Kun ved reell sekundoppløsning. | Sekunder | Lav. | Lav | P3 | C |

### 3.8 Betaling

| ID | Kontroll | Risiko | Kilde | Algoritme og implementering | Krav | Presisjon og feilkilder | Kompl. | Prio | Klasse |
|---|---|---|---|---|---|---|---|---|---|
| BET-01 | Kontantuttak mot kort | Kontant ut mot kort uten reelt kjøp, gjentatte uttak | K | Salg med Bank/kort-betaling > Totalt og Kontant tilbake > 0: uttak = betalt − Totalt. Per kasserer og kortnøkkel: frekvens, sum, andel av bonger. Stor sum, samme kort gjentatt, lav varesum med høyt uttak. | v5 (v6 for kort). Hvordan uttak vises må bekreftes i Diagnostikk. | Middels–høy for deteksjon. Tolkning avhenger av butikkens uttaksregler. | Lav | P1 | A |
| BET-02 | Betalingsmiks per kasserer/kasse | Høy kontantandel, avvikende bruk på bestemte kasser | K | Fraksjon per betalingsmåte (antall og kr) per kasserer/kasse. χ² mot butikk stratifisert på time. EB, BH. «Kontant tilbake»-frekvens separat. | v5 | Middels. Kundemiks og kassetype (saleChannel som strata). | Middels | P2 | A |
| BET-03 | Kortidentifikator-styrke og gjentakelser | Samme kort på mange bonger/kasserere, like beløp, splitting | K | Identitetsstyrke s = f(BIN til stede, utsteder, skjema). Sannsynlighet for tilfeldig sammenfall ≈ antall kort/10^k i butikk/dag. Funn bare når s høy, eller (siste 4 + skjema + likt beløp + Δt ≤ T + samme kasserer). Kort × kasserer-konsentrasjon. | v6; format ubekreftet | Lav (siste 4 alene) → middels (BIN + 4). | Middels | P2 | C |
| BET-04 | Manuelt tastet kort | Kort-ikke-til-stede ved disk, retur til tastet kort | K | `ft.e` = manuelt tastet per kasserer/terminal/kasse, særlig på retur. Andel mot butikk (KAS-01). Retur + tastet rangeres høyest. | v7; felt ikke sett i ekte data | Middels hvis feltet finnes. | Lav | P2 | C |
| BET-05 | Terminal ↔ kasse, kort uten autorisasjon | Terminal brukt på feil kasse, kortbetaling uten autorisasjonskode | K | Lær kasse → terminal (modus), avvik flagges. Kortbetaling uten `ft.a` når ≥90 % har. Auth-kode med uvanlig mønster. | v7; ubekreftet | Middels (kalibrerende). | Lav | P2 | C |
| BET-06 | Delt betaling / mange betalingslinjer | Splitting for å unngå grenser | K | Parseren lagrer antall linjer per etikett og rekkefølge (`payN`). Funn: ≥2 kortlinjer, ≥3 metoder, kontantdel som liten rest. EB per kasserer. | Parserendring (v8) | Lav–middels. | Middels | P3 | C |
| BET-07 | Øreavrunding | Misbruk av avrundingslinje | K | |rnd| ≤ 0,50. rnd ≠ 0 bare ved kontantbetaling. Σ rnd per kasserer/dag mot 0, fortegnsskjevhet (binomial). | v5 | Middels–høy, kalibrerende. | Lav | P2 | A |
| BET-08 | Liste-subtotal mot bong-Totalt | Avvik mellom journalliste og kvittering | G, K | |totalAmount − sc.tot| > toleranse per bong. Kalibrering som ledger. Aggreger per kasserer. Ingen slik sammenligning finnes i dag. | v5 | Høy hvis semantikken er lik. «Subtotal» kan være før avrunding. | Lav | P1 | A |

### 3.9 Varelinje og kombinasjon av felt

| ID | Kontroll | Risiko | Kilde | Algoritme og implementering | Krav | Presisjon og feilkilder | Kompl. | Prio | Klasse |
|---|---|---|---|---|---|---|---|---|---|
| LIN-01 | Identiske handlekurver | Kopi/duplikat, testbonger, mønster | K | Kurv-hash = sortert (EAN, q). Funn: identisk kurv ≥ k ganger innen dag/kasserer/medlem/kort, lift mot butikkens frekvens. Enkeltvarekurver utelates. | v4 | Middels. Små kurver er vanlige. | Lav | P2 | A |
| LIN-02 | Kasserer × vare-konsentrasjon (auto-oppdagelse) | Uventede par kasserer × EAN med retur/sletting/rabatt | K | Kontingenstabell per EAN-hendelse (retur, slett, rabatt): kasserer mot andre. Fisher exact eller G-test, BH. Supplerer manuell overvåkingsliste. | v3/v4 | Middels. Mange tester → FDR er avgjørende. | Middels | P2 | A |
| LIN-03 | Pant-/MVA-0 %-konsistens | Unormale pantlinjer | K | (a) Frekvens av distinkte pantebeløp per kjede; sjeldne = funn. (b) 0 %-grunnlag − Σ pantsalg = residual på bonger uten kjente 0 %-varer; robust z. | v5 | Lav–middels. Kjente 0 %-varer må læres. | Middels | P3 | C |

## 4. De 15 mest verdifulle kontrollene

Rangering er et skjønn (økonomisk betydning, hull mot dagens dekning, gjennomførbarhet nå, forventet falsk-positiv-risiko). Den er ikke målt mot ekte data.

| Rang | ID | Kontroll | Hvorfor høyt | Klasse |
|---|---|---|---|---|
| 1 | OPP-04 | Aktivitetsklynge før oppgjør | Klassisk «dekke manko»-mønster, direkte kontantrisiko. Dagens test bruker stengetid, ikke oppgjørstid. | A |
| 2 | OPP-01 | Avstemming som funn | Dataene finnes og vises. Mangler score og dekningsport. | A |
| 3 | OPP-03 | Identiske og retningsbundne differanser | Systematikk er mer informativt enn størrelse. Billig. | A |
| 4 | OPP-02 | Differanse mot kontantvolum | Gjør kasser sammenlignbare. | A |
| 5 | KAS-01 | Hendelseskonsentrasjon (EB + FDR) | Erstatter ca. 10 volumblinde terskler. Grunnmur for flere kontroller. | A |
| 6 | KAS-03 | Kasserer samtidig på flere kasser/butikker | Ren griddata, sterk indikator på delt innlogging. | A |
| 7 | BET-01 | Kontantuttak mot kort | Direkte kontantstrøm, ikke dekket. | A |
| 8 | SEK-01 | Hull-konsentrasjon per kasserer (med ENG-02) | Gjør dagens hulltest handlingsrettet og mer pålitelig. | A |
| 9 | TID-04 | Åpningstid-envelope og helligdag | Deterministisk, ren griddata. | A |
| 10 | RAB-02 | Linjeregnskap q×pris−rabatt | Fanger manuell overstyring, deterministisk. | A |
| 11 | RET-02 | Strukturbrudd (uten betaling, tom bong) | Lukker hull i `ledger`. | A |
| 12 | BET-08 | Liste-subtotal mot bong-Totalt | Ingen slik avstemming finnes. Billig. | A |
| 13 | RAB-01 | EAN-prisbaseline over tid | Dekker lavvolum og historikk. Størst gevinst for prisavvik. | B |
| 14 | KAS-04 | Medlemsandel og -mangfold per kasserer | Fanger bonusmisbruk som per-medlem-testene ikke ser. | A |
| 15 | OPP-05 / OPP-06 | Valør-integritet og posenr-dublett | Deterministiske kontroller på data som i dag ikke brukes. Valør krever avklaring av «Beløp». | A/C |

Hvorfor ikke høyere: RET-01 (klassifisering) og ENG-01/02 er forutsetninger, ikke kontroller, og er derfor i arkitekturplanen.

### Normale forklaringer og videre kontroll (topp 15)

| ID | Mulige normale forklaringer | Videre kontroll |
|---|---|---|
| OPP-04 | Stengetid gir naturlig retur-opphopning. Kunde kom tilbake like før oppgjør. | Sammenlign samme vindu andre dager. Åpne bongene. Se kasserer og mengde kontantutbetaling. |
| OPP-01 | Vekselkasse, uttak/innskudd, oppgjør på tvers av døgnskifte, uskannede bonger. | Kontroller dekning (alle bonger skannet, løpenr komplett), tell fysisk. |
| OPP-03 | Fast avrunding i telling, kjent vekselfeil. | Se tellerutine, kasserer på tvers av dager. |
| OPP-02 | Svingninger i kontantomsetning, få oppgjør. | Se historikk for kassen. |
| KAS-01 | Kasserer på spesialkasse, kampanje, kø, få bonger. | Sjekk strata, åpne topp-bongene, sammenlign med kollega samme tid. |
| KAS-03 | Avløsning mellom kasser, delt kassepunkt, feil i CW-ID. | Kontroller vaktliste og pålogging i CW. |
| BET-01 | Butikken tillater kontantuttak. | Kontroller policy, gjentak per kort, varesum mot uttak. |
| SEK-01 | Filtrert liste, delt nummerserie, andre dokumenttyper. | Kontroller ENG-02-resultat, hent manglende nummer. |
| TID-04 | Unntak fra åpningstidsregler, bevilling, kjøp før stenging registrert etter midnatt. | Kontroller butikkens åpningstider og unntak. |
| RAB-02 | Avrundingsregel, flerkjøpstilbud. | Åpne bongen, sammenlign med pris i butikken. |
| RET-02 | Bongtype uten betalingslinje (ikke type 1). | Åpne bongen. |
| BET-08 | «Subtotal» før avrunding, annen definisjon. | Sjekk kalibrering (andel bonger som stemmer). |
| RAB-01 | Prisendring, kampanje, flerkjøp, vektvare. | Se prishistorikk, kampanjeliste. |
| KAS-04 | Stamkunder, ansattkasse, kampanjer. | Se fordeling per time og medlem, sammenlign med kolleger. |
| OPP-05/06 | Telleprosedyre (antall i stedet for beløp), pose gjenbrukt av rutine. | Bekreft kolonnenes mening, sjekk pose-logg. |

## 5. Avansert statistisk og regelbasert deteksjon

### 5.1 Felles oppskrift for rate-kontroller

1. Definer hendelse e og mulighetsmengde n (bonger, salg, oppgjør, linjer).
2. Stratifiser: butikk, kasse/kanal, time (TID-02). Bruk jevnaldrende uten kasserer c (leave-one-out).
3. Forventet E_c = Σ n_c,s · μ_s (indirekte standardisering). Observert k_c.
4. EB-rate (k + m·μ)/(n + m). Prior-styrke m er dagens `profShrink`.
5. p = eksakt Poisson- eller binomial-hale. Wilson-intervall for visning.
6. Benjamini–Hochberg over alle kasserere og hendelser i kjøringen: største i med p_(i) ≤ q·i/M. q standard 0,10.
7. Funn krever FDR < q, k ≥ k_min og effekt ≥ f × μ. Effekt og antall vises, ikke bare p.
8. Dekning (ENG-01) under minimum → «ikke vurdert».

### 5.2 Verktøykasse

| Tema | Metode | Bruk |
|---|---|---|
| Robuste avviksmål | Modifisert z = 0,6745·(x − median)/MAD, grense 3,5 (Iglewicz–Hoaglin). IQR når MAD = 0. Percentiler P1/P99. | KAS-02, RAB-01/06, OPP-02 |
| Volumjustering | Indirekte standardisering, EB-krymping, eksakt test | KAS-01, RET-05, BET-02 |
| Tidsserier | EWMA, CUSUM, PELT. Ukedag × time-baseline. | TID-01/02 |
| Endringspunkt for pris | Nivåskifte (≥k bonger, ≥2 dager) | RAB-01 |
| Fordelingsavvik | Jensen–Shannon, χ² (med samling av små celler som i dagens `lastDigitTest`), permutasjonstest | KAS-06, RAB-04, OPP-05 |
| Sekvens | n-gram G² (log-likelihood ratio), runs test, Theil–Sen | SEK-02, OPP-03, OPP-08 |
| Relasjon | Kontingenstabell (Fisher/G), Mantel–Haenszel, HHI/entropi, par- og trippelkonsentrasjon | KAS-04, LIN-02, RAB-05 |
| Peer-grupper | Butikk × kanal (`saleChannel` som strata, ingen antatt betydning) × time | alle |
| Flertestkorreksjon | Benjamini–Hochberg | alle gruppe-/kasserer-kontroller |

### 5.3 Deterministiske regler (ingen statistikk, høy presisjon)

RET-02, RAB-02, RAB-03, RAB-07, BET-07 (regeldelen), BET-08, OPP-05 (a,b), OPP-06 (dublett), TID-04 (helligdag), ENG-02. Disse bør tas først fordi de ikke krever kalibrering mot ekte volumer, bare mot formatbekreftelse.

### 5.4 AI-assistert analyse (lokalt)

README og notatlogg forutsetter at ingenting forlater nettleseren. «AI» foreslås derfor som lokal beregning, ikke LLM-kall.

| Oppgave | Lokal metode | Garanti |
|---|---|---|
| Oppdage uventede mønstre | Isolation Forest på kasserer-dag-vektor (ca. 15 egenskaper: retur-, rabatt-, kontant-, 0-kr-, medlems-, tempoandel, bonger/time, hull-nærhet, kontantutbetaling, differanse). Score + bidrag per egenskap (robust z). | Vises som «uvanlig kombinasjon», aldri som årsak. |
| Forklare statistiske avvik | Malbasert tekst fra KAS-01/02: observert mot forventet, jevnaldrende, Wilson-intervall. «Mulige normale forklaringer» fra kontrolldefinisjonen. | Ingen fritekstgenerering om personer. |
| Foreslå nye regler | Etter ≥50 vurderte funn: beslutningsstubber og hyppige elementsett på bonger med utfall «bekreftet». | Vises som forslag; aktiveres aldri automatisk. |
| Gruppere relaterte funn | Union-find/sammenhengende komponenter på delt kasserer, kasse, medlem, kortnøkkel, tidsvindu og bong. | Gruppe får egen rad i Sjekk først. |
| Prioritere | Forventet eksponering = P(treff | kontroll) × beløp. P kalibreres (isotonisk) når utfall finnes, ellers rent ordinal rangering. | Rangering, ikke vurdering. |

AI skal ikke fastslå misligheter eller peke ut ansvarlige. Språk i alle funn: «indikasjon», aldri «svindel» eller navn. Hvis virksomheten ønsker LLM-støtte, bør det skje manuelt via anonymisert «Kopier som tekst» (finnes i dag for Diagnostikk), etter intern godkjenning.

## 6. Hvordan kontrollene implementeres

Felles mal for hver kontroll (detaljene per kontroll står i tabellene i kapittel 3):

1. Ren funksjon `run(ctx, params) → findings[]` uten DOM- eller lagringstilgang. `ctx` gir ferdige indekser (se 7.2).
2. Parametre med standardverdi, enhet, «av»-mulighet og hjelpetekst (som `SETTING_GROUPS` i dag).
3. Dekningskrav deklareres (`needs`), og motoren kaller `run` bare når kravet er oppfylt.
4. Hvert funn bærer observasjoner, forventet verdi, baseline og dekning. Forklaring og normale forklaringer kommer fra kontrolldefinisjonen.
5. Test: fixture med injisert avvik, fixture uten avvik (negativ kontroll), kantfall (tomt, ett element, MAD = 0), dekning under minimum.
6. Dokumentasjon genereres fra definisjonen (utvider `docs.test.js`).

Rekkefølge innen hver kontroll: definer hendelse og mulighetsmengde, bygg indeks, beregn forventet/observert, test, filtrer på effekt og antall, bygg funn.

## 7. Arkitektur

### 7.1 Prinsipper

- Additivt. Dagens funksjoner, innstillinger og eksport beholdes. Eksisterende `KvLogic`-API stabilt.
- Ingen API-kall (`noapi.test.js` forblir).
- Datainnhenting (collect, skanning, parser) endres ikke, bortsett fra S1 og eventuell parser v8 (enhet, `payN`) etter egen godkjenning.
- Ingen bygg-steg: scripts lastes i rekkefølge i `manifest.json` som i dag. Nye filer legges til før `content.js`.

### 7.2 Moduler

| Modul | Innhold |
|---|---|
| `engine/registry.js` | Kontrolldefinisjoner (7.3). Oversettelse tittel → kontroll-ID for eksisterende 68 årsaker (migreringsshim). |
| `engine/context.js` | Bygger indekser én gang per kjøring: bonger per (butikk, kasse, dag) sortert, per kasserer, per medlem (pseudonym), per kortnøkkel, per EAN; oppgjør per (butikk, kasse, dag); hendelsesflagg per bong (RET-01). Fjerner O(R·S)-oppslag. |
| `engine/stats.js` | Median/MAD, modifisert z, percentil, Wilson, EB, Poisson/binomial-hale, BH, JS, G², runs-test, EWMA/CUSUM, Theil–Sen. |
| `engine/coverage.js` | ENG-01, ENG-02. |
| `engine/score.js` | Poeng (uendret), familiededuplisering, eksponering i kr, kalibrert sannsynlighet når utfall finnes. RRS beholdes. |
| `engine/explain.js` | Mal-baserte forklaringer. |
| `store/db.js` | IndexedDB v2 (7.5), additiv oppgradering. |
| `controls/*.js` | Kontrollene gruppert som i kapittel 3. |

### 7.3 Kontrolldefinisjon

| Felt | Innhold |
|---|---|
| `id`, `version` | f.eks. `OPP-04`, `1.0.0`. Endres ved algoritme- eller standardendring. |
| `title`, `group`, `family` | `family` brukes til dedup av samme forhold. |
| `needs` | `{grid, scan: minVersjon, settle, history: dager, coverage: minimum}` |
| `params` | liste av `{key, label, unit, default, off, hint}` |
| `weight` | standardpoeng |
| `run(ctx, params)` | returnerer funn |
| `explain(f)` | forklaring |
| `normalExplanations[]`, `nextSteps[]` | vises i hvert funn |
| `docs` | tekst til brukerveiledningen |

### 7.4 Funnskjema

| Felt | Innhold |
|---|---|
| `key` | stabil nøkkel = hash(kontrollId, versjon, enhetsnøkkel, tidsvindu) |
| `controlId`, `controlVersion`, `runId` | |
| `store`, `workstation`, `cashier` (valgfri) | |
| `receiptIds[]`, `timeFirst`, `timeLast` | |
| `type` | avvikstype |
| `level`, `points`, `rrs` | risikonivå |
| `rationale` | konkret begrunnelse |
| `observations{}` | dokumenterte observasjoner: observert, forventet, baseline, jevnaldrende, p, FDR, effekt, antall |
| `quality{}` | dekningsgrad, skannet andel, løpenr-komplett, tidsoppløsning, parserversjon |
| `exposureNok` | beløp som er berørt |
| `normalExplanations[]`, `nextSteps[]` | |
| `firstSeen`, `lastSeen`, `occurrences` | |
| `status`, `outcome` | 7.9 |

### 7.5 IndexedDB v2 (additiv)

| Store | Nøkkel | Innhold | Oppbevaring |
|---|---|---|---|
| `kv`, `scan` | uendret | uendret | uendret |
| `tx` | transactionId | store, ws, kasserer, tid (med sekunder om finnes), total, type, kanal, medlem (pseudonym), kilde | standard 90 dager, justerbart |
| `base` | scope + uke | aggregerte rater og tellere per (butikk, kasserer, time, ukedag). Ingen medlem/kort. | 26 uker |
| `price` | ean + butikk | median, MAD, n, sist sett, skiftdato | 180 dager |
| `findings` | stabil nøkkel | funn (7.4) | til slettet |
| `outcomes` | funn-nøkkel + tid | utfall (7.9) | til slettet |
| `runs` | runId | tidspunkt, ruleset-hash (kontroll-IDer, versjoner, parametre), omfang, dekning | til slettet |

Oppgradering: `onupgradeneeded` med versjon 2 oppretter nye stores. Eksisterende data berøres ikke. Eksisterende innstillingseksport leses fortsatt.

### 7.6 Kjøremodell

- Automatisk kjøring etter hver CW-henting og etter skanning, med debounce. Kun nye eller endrede bonger beregnes på nytt (inkrementelt der kontrollen tillater det).
- Tunge kontroller deles i biter med `requestIdleCallback`. Web Worker er ikke verifisert i MAIN-world-konteksten (CSP, blob-URL), så ikke forutsatt.
- **Skyggemodus**: nye kontroller kjører og logges, men teller ikke i score før alarmrate er målt på en ren periode og de er godkjent.
- Kjøringen logger dekning og hvilke kontroller som ble hoppet over og hvorfor.

### 7.7 Risikoscore

- Beholder poeng, familier og RRS (kompatibelt).
- Legger til `exposureNok` og sortering på forventet eksponering.
- Når ≥50 utfall finnes: kalibrert P(treff | kontroll) vises ved siden av poeng. Vektene endres ikke automatisk; det gis forslag.
- Flere svake indikatorer: kombinasjonsregler i kapittel 10 bruker noisy-OR eller log-odds på **uavhengige familier**, ikke sum av alt.

### 7.8 Deduplicering

Stabil nøkkel (7.4) slår sammen funn mellom kjøringer. Ved ny kjøring: samme nøkkel → oppdater `lastSeen` og `occurrences`. Vurderte funn (forklart/falsk alarm) skjules til observasjonene endres vesentlig. Gjør «Ny» presist.

### 7.9 Manuell verifisering og revisjonslogg

- Utfall per funn: *bekreftet avvik*, *forklart*, *falsk alarm*, *trenger mer data*. Med årsakskode og kommentar. Dagens «Sjekket» og «Til oppfølging» beholdes.
- Utfallene mater treffsikkerhetslogg per kontroll og versjon (andel bekreftet, forklart, falsk alarm).
- Revisjonsloggen utvides: eksisterende SHA-256-kjede får hendelser for kjøringer, regel- og parameterendringer og utfall. Fortsatt append-only.

### 7.10 Eksport

I tillegg til dagens ZIP: `data/funn.jsonl` (full funnstruktur), `kontroller.json` (id, versjon, parametre), `dekning.csv`, `utfall.csv`. Alle med i `KONTROLLSUM.txt`. Pseudonymer som standard, original medlemsvisning kun ved eksplisitt valg.

### 7.11 Personvern

- Medlemsnr: HMAC med nøkkel per installasjon (lagret i IndexedDB) i nye stores. Ingen komplette kortnumre (dagens `cd` har bare BIN og siste 4). `base` har ingen medlems- eller kortdata.
- Standard oppbevaringstid, «Slett alt» i Innstillinger.
- Medlemsanalyser (KAS-04, MED-*, RET-05) viser aggregater først, enkeltnumre bak ett klikk, og teksten «indikasjon, ikke bevis».

### 7.12 Test og kalibrering

- Per kontroll: positiv, negativ og kantfall (6).
- **Injeksjonsbenchmark**: legg kjente avvik inn i demodata, mål andel som fanges. **Alarmrate** måles på ren periode. Slik får man tall for presisjon uten å finne på dem.
- Egenskapstester for `stats.js` (BH, EB, MAD).
- `docs.test.js` utvides til registeret.
- Playwright-e2e beholdes. `noapi.test.js` kjøres uendret.

## 8. Plan for implementering

Innsats er relativ (S/M/L). Hver fase har en port: tester grønne, skyggemodus-resultater vurdert, ingen regresjon i eksisterende funn.

| Fase | Innhold | Avhengigheter | Akseptanse | Innsats |
|---|---|---|---|---|
| **F0 Avklaringer og hurtigrettinger** | Kjør Diagnostikk på ekte data og avklar punktene i vedlegg A. Rett S1 (sekunder), vurder F5. Rene funksjoner uten arkitekturendring: RET-02, RAB-02, RAB-03, RAB-07, BET-07, BET-08, OPP-03, OPP-06 (dublett), OPP-05 a/b, MED-01, KAS-03 (a), BET-01, TID-03. | Godkjenning | Hver med fixture og negativ kontroll. Alle eksisterende tester grønne. | M |
| **F1 Fundament** | IndexedDB v2 (`tx`, `base`, `price`, `findings`, `outcomes`, `runs`). ENG-01, ENG-02. Registry med migreringsshim som pakker inn de 27 eksisterende funksjonene uendret. Stabile funnnøkler. Utfallsregistrering og revisjonslogg. | F0 | Eksisterende funn og score identiske før og etter (regresjonstest). | L |
| **F2 Statistikkmotor** | `stats.js`, `context.js`. KAS-01, KAS-02, KAS-04, OPP-01, OPP-02, OPP-04, SEK-01, RET-01, TID-04 (envelope fra innlastet periode). Skyggekjør KAS-01 mot de gamle «kasserer ved ≥ n»-testene. | F1 | Ny kontroll fanger minst det den erstatter, i skyggemodus. | L |
| **F3 Historikk** | RAB-01, TID-02, TID-01, KAS-06, KAS-07, OPP-08, RET-04, stabil envelope. | F1 + minst 4–8 uker lagret historikk | Alarmrate målt på ren periode. | L |
| **F4 Relasjon, sekvens og kombinasjon** | SEK-02, LIN-01, LIN-02, RET-03, RAB-04/05/06, MED-02/03, OPP-05 c, OPP-07, OPP-09. Format-avhengige: BET-03 til BET-06, RET-06, RAB-08, LIN-03 etter bekreftelse. Kombinasjonskontroller (kap. 10), lokal Isolation Forest, funngruppering, automatisk kjøring. | F2, F3 | Per kontroll: injeksjonsrecall og alarmrate dokumentert. | L |
| **F5 Kalibrering og opprydding** | Sett standardterskler fra ekte data. Slå sammen eller pensjoner gamle tester som er dekket. Dokumentasjon fra registeret. Ytelsesmåling. | F2–F4 | Gamle tester fjernes først etter skyggemodus viser dekning. | M |

Forslag til rekkefølge hvis tid er knapp: F0 → ENG-01/02 → OPP-01/02/03/04 → KAS-01. Det gir mest verdi per innsats uten at historikk er på plass.

## 9. Bedre presisjon og færre falske positive

1. **Dekningsport** på alle kontroller (ENG-01). I dag finnes den bare i enkeltkontroller.
2. **Sekvensmodell** før hulltest (ENG-02).
3. **Stratifisering**: butikk, kasse/kanal, time, ukedag. Ikke sammenlign selvbetjent med betjent uten å vite det.
4. **Flertestkorreksjon** (BH) i stedet for mange uavhengige terskler.
5. **Effektstørrelse og minimumsantall** i tillegg til p-verdi.
6. **Krymping** (EB) for små kasserere. Utvides fra dagens fire profilmetrikker.
7. **Én klassifisering av negative hendelser** (RET-01) i stedet for flere heuristikker.
8. **Kalibrering av ubekreftede formater**: ingen kontroll slås på før andelen bonger som matcher formatet er målt (som `ledger`, topptekst og KU gjør i dag). Utvides til hendelsesord, spesialbetaling, kort, inngangsmåte.
9. **Normale forklaringer automatisk sjekket** der mulig: kampanje (finnes), kampanjedag (finnes), helligdag, kø (bonger/time), nyansatt (KAS-07), kjent prisendring (RAB-01).
10. **Familiededuplisering** utvidet til nye kontroller, og stabil nøkkel mellom kjøringer.
11. **Utfallsdata**: treffsikkerhet per kontroll og versjon, forslag om å dempe kontroller som aldri gir treff.
12. **Skyggemodus** for alle nye kontroller.
13. **Effekt på score**: ett kasserernivåfunn (KAS-01) gir poeng på kasserer, ikke på hver bong (som i dag for kassererfunn).

## 10. Kombinasjoner av flere felt

Kombinasjonene bruker uavhengige signalfamilier. Score = noisy-OR over familier: 100·(1 − Π(1 − g_j/100)), med tak per familie. Hver kombinasjon viser hvilke signaler som traff, og hva som mangler for et sterkere funn.

| ID | Navn | Signaler | Regel | Normal forklaring | Klasse |
|---|---|---|---|---|---|
| C01 | Dekke manko | OPP-04 klynge, OPP-02/03 negativ eller identisk differanse, kontantutbetaling (BET-01/OPP-08), samme kasserer | Minst to uavhengige familier innen samme kasse/dag(er) | Stengeopphopning, telleprosedyre | A |
| C02 | Bonusfarming | KAS-04 lavt mangfold og høy attach, MED-01/02, MED-03, samme kasserer | KAS-04 + minst ett MED-signal | Stamkunder, kampanjer | A |
| C03 | Vennepris | Rabatt uten årsak (finnes), RAB-05 kontant, LIN-02 kasserer × vare, kort/medlem-gjentak hos samme kasserer (BET-03) | Rabatt + minst to av de andre | Kampanje, nedmerking | A/C |
| C04 | Returring | Retur uten kjøp (finnes), RET-06 annet kort, BET-04 tastet kort, TID-04 utenfor envelope, RET-03 retur rett etter salg | Retur uten kjøp + ett eller flere av de andre | Kundeservice, sesongbytter | C |
| C05 | Skyggeinnlogging | KAS-03 samtidig bruk, TID-04 helligdag/utenfor åpningstid, topptekst-avvik (finnes) | KAS-03 + ett annet | Avløsning, feil i ID | A |
| C06 | Journalmanipulasjon | SEK-01 hullkonsentrasjon, BET-08 liste mot bong, RET-02 strukturbrudd, ledger-avvik (finnes) | Minst to | Filtrert liste, dokumenttyper | A |
| C07 | Pantuttak | Manuell pantelapp (finnes), pantelapp innløst flere ganger (finnes), OPP-04, BET-01 | Minst to | Pantemaskin ute av drift | A |

## 11. Hva kan bygges når

| Klasse | Betydning | Kontroller |
|---|---|---|
| **A** Nå | Dagens data og skanneversjon holder | ENG-01, ENG-02, KAS-01, KAS-02, KAS-03, KAS-04, TID-03, TID-04 (envelope fra innlastet periode), RET-02, RET-03, RET-04 (matchet salg), RET-05, RAB-02, RAB-03, RAB-04, RAB-05, RAB-07, MED-01, MED-02, MED-03, OPP-01, OPP-02, OPP-03, OPP-04, OPP-06, OPP-07, OPP-09, SEK-01, SEK-02, SEK-03, BET-01, BET-02, BET-07, BET-08, LIN-01, LIN-02 |
| **B** Historikk | Krever persistert `tx`/`base`/`price` og uker med data | RAB-01, KAS-06, KAS-07, TID-01, TID-02, OPP-08, stabil TID-04, egen historikk i OPP-02 |
| **C** Mer kvitteringsdata eller bekreftet format | Parserendring eller formatavklaring | RET-01, RET-06, KAS-05, RAB-06 (enhet), RAB-08, OPP-05, SEK-04, BET-03, BET-04, BET-05, BET-06, LIN-03 |
| **D** Ikke mulig | Mangler data i CW-grensesnittet eller er utenfor rammen | Se under |

**Klasse D**

| Ønske | Hvorfor ikke |
|---|---|
| Negativ margin | Kostpris finnes ikke i CW-grensesnittet. Kan bare gjøres med bruker-importert lokal fil (EAN → kost), som er en separat beslutning. |
| Umulig reise mellom butikker | Butikkoordinater finnes ikke. Forenklet tidsregel finnes (30 min) og dekkes av KAS-03(a). |
| Vakt-/fraværskryss | HR-data finnes ikke. |
| Fasit for pris og kampanje | Bare observert pris finnes. |
| Full kontantstrøm | Vekselkasse, uttak, innskudd og bankmottak finnes ikke. Kun avstemming mot oppgjør. |
| Betydning av `saleChannel`, `receiptType 11` | Ikke bekreftet. Brukes kun som strata og beskrivelse. |
| Bilde, OCR, signatur, PDF | Krever API. Ikke tillatt. |
| Identifisere ansvarlige personer | Ikke mulig fra data, og skal ikke være mål. |
| Lagerdifferanser/svinn mot varetelling | Journalen har ikke varetelling. |

## 12. Runde 2: flere nye metoder (25 kontroller + 1 ny defekt)

Samme kolonner som kapittel 3. Alt her er i tillegg til de 54. Totalt blir det 79.

### 12.1 Ny defekt: kasserer-ID og «butikksnitt» (S17)

`profiles()`, `repeatAmount`, `discounts`, `tempoChecks`, `memberChecks` og `rankCashiers` bruker `cashierNumber` alene som nøkkel, uten butikk. «Butikksnittet» i profilen er snittet over **alle innlastede butikker**, ikke den enkelte butikken. Kjørt mot uttrukket kopi: kasserer 12 i butikk 1005 (40 % retur, 20 bonger) og kasserer 12 i butikk 2002 (0 %, 20 bonger) ble **én rad** (`12 n=40 ret=0,20`), og snittet ble regnet over 60 bonger i begge butikker. `repeatAmount` gruppert på samme måte.

Om kasserer-ID er kjedeunik eller butikklokal vet jeg ikke. Er den butikklokal, blandes ulike personer ved flerbutikk-omfang. Er den kjedeunik, er det riktig å se dem som én, men «butikksnitt» er da feil betegnelse.

Konsekvens for forslagene:
- Alle kasserer-nøkler bør være `butikk|kasserer`, med innstilling for «kasserer-ID er kjedeunik».
- **ID-unikhetstest** (autodeteksjon): finnes samme ID i ≥2 butikker samme dag i overlappende tid, er IDen enten delt eller butikklokal. KAS-03(a) (to butikker samtidig) og KAS-07 gir bare mening hvis IDen er kjedeunik, så de slås av når testen sier at IDen er lokal.
- Profil og KAS-01/02 regner jevnaldrende **innen butikk**, ikke over alle innlastede.

### 12.2 Nye kontroller

| ID | Kontroll | Risiko | Kilde | Algoritme og implementering | Krav | Presisjon og feilkilder | Kompl. | Prio | Klasse |
|---|---|---|---|---|---|---|---|---|---|
| STR-01 | Struktursignatur-sjeldenhet | Ukjente ukjente: bonger bygget på en måte ingen regel kjenner | K | Signatur = sortert multiset av linjetyper uten beløp og EAN: vare, antall-rad, rabatt, rabattårsak, kupong, pantsalg, pantlapp, negativ vare, betaling:etikett, avrunding, referanse, KU, antall MVA-satser, ukjente linjemaler (`unk`). Frekvens f per butikk/kjede (glattet). Sjeldenhet = −ln f. Funn når f < 1/N_min. Forklaring: hvilken linjetype gjør signaturen sjelden. Andel sjeldne signaturer per kasserer går inn i KAS-01. Alt kan avledes av lagret skannepost, ingen parserendring. | v4+ | Lav–middels. Brukes som støttesignal med lav vekt og som utforskningsliste. | Middels | P2 | A |
| STR-02 | Formatdrift-vakt | CW endrer kvitterings-HTML eller tekst, og alle kontroller kan stille feil uten at noen ser det | K | Mål per skannebatch og per dag: andel bonger med ≥1 ukjent linje, uten `tot`, uten MVA-tabell, uten betalingslinje, med nye betalingsetiketter, nye linjemaler, parser-feilrate (rowsFrom gir null). Sammenlign mot egen 30-dagers median/P95, i en enkelt økt mot første halvdel. CUSUM for gradvis skifte. Utfall: banner «formatet ser ut til å ha endret seg», og berørte kontroller settes til «ikke vurdert» via ENG-01. README peker selv på dette som risiko. | Skanninger over tid (trend krever historikk) | Høy for plutselige skift, middels for gradvise. | Middels | P1 | A/B |
| KAS-08 | Kasse-typeklynging | Feil peer-grupper (selvbetjent mot betjent, spesialkasse) gir falske positive | G (+K) | Per kasse: antall ulike kasserer-ID per dag, snittbeløp, linjer/bong, medlemsandel, returandel, kanalkode. Robust standardisering, hierarkisk eller k-means, k valgt med silhouette. Klynge-ID brukes som strata i KAS-01/02. Ingen antakelse om hva klyngene betyr. | Kun grid | Støttefunksjon. Ustabil ved få kasser. | Middels | P2 | A |
| KAS-09 | Hendelsesklumping (burstiness) | Hendelser som kommer i byger, ikke jevnt | G, K | For kasserer/kasse og hendelse e: Fano-faktor (varians/gjennomsnitt) på antall per 15-min-bin mot ikke-homogen Poisson (timeprofil fra TID-02). KS-test på tid mellom hendelser. | Kun grid for retur/0-kr | Lav–middels. Køer gir byger. | Middels | P3 | A |
| OPP-10 | For jevne oppgjør | Differansen «ordnes» slik at den alltid er 0 | O (+K) | Andel oppgjør med diff = 0,00 (eller |diff| < 0,50) per kasserer/kasse. Forventet andel fra logistisk modell P(diff=0) ~ log(kontantomsetning), estimert på jevnaldrende. Binomialtest og BH. Typisk kontantkasse har sjelden eksakt null over mange oppgjør. | Oppgjør, helst kontantomsetning fra skannede salg | Middels. Lite kontant, automatisk telling som kopierer forventet verdi, eller policy om justering gir 0. | Lav | P1 | A |
| OPP-11 | Differanse-attribusjon (regresjon) | Hvilke kasserer deler kasse når differansen oppstår | O, K | Mellom to oppgjør: kontantomsetning u per kasserer. diff_s = Σ β_c·u_c,s + ε. Ikke-negativ kortslutning (NNLS) eller ridge, bootstrap-intervall for β_c. Kun når ≥30 oppgjør og ≥3 kasserere deler kasser. Vises som aggregert indikasjon, navn skjult som standard. | ≥30 oppgjør med flere kasserere per kasse | Lav–middels. Krever variasjon i hvem som deler kasse. Skal aldri fastslå ansvar. | Høy | P3 | B |
| OPP-12 | Tilgodelapp-avstemming | Tilgodelapper utstedt uten motpost | O, K | Oppgjørets `tilg{egne, fremmede, utlevert, sum}` per kasse/dag mot bonger med betalingsetikett «Tilgodelapp» (innløst) og utstedelse. Balanse per butikk og kumulativt (CUSUM). | Betydning av feltene må bekreftes | Ukjent før formatet er sett. | Middels | P2 | C |
| OPP-13 | Dagsstart- og sluttmønster | Første bong er 0-kr, retur eller kontant tilbake; siste bong før oppgjør | G, K | Første/siste bong per kasse/dag: andel som er retur/0-kr/kontant tilbake mot samme andel resten av dagen (Fisher). Per kasserer over dager (binomial). | Kun grid for retur/0-kr | Lav–middels. Skuff åpnet for veksel, testbong. | Lav | P3 | A |
| RET-07 | Retur og omslag til lavere pris | Prisendring via «retur og ny registrering» | K | Sekvens salg(EAN x, pris p1) → retur(x) → salg(x, p2) der p2 < p1·(1 − t), innen T min, samme kasse, uten rabattårsak. Vekt opp ved samme kasserer og kontant. | v4 (enhetspris) | Middels. Kunde fant feil pris i hylla. | Middels | P2 | A |
| RET-08 | Retur av vare uten salgshistorikk | Retur av vare som aldri er solgt her (eller noe sted) | K | Slå opp retur-EAN i salgsindeks per butikk og kjede (samme indeks som RAB-01). Aldri solgt i kjeden = sterkere. Ikke solgt i denne butikken = kan være kjedevare. | Historikk ≥ 30 dager | Middels. Nye varer og sesongvarer. | Lav | P2 | B |
| RET-09 | Retur av gammelt kjøp | Retur utenfor returfrist | K | Matchet salg (EAN + beløp + kort/medlem) eldre enn frist (parameter, f.eks. 14 eller 30 dager). | `tx` + historikk | Lav–middels. Kulanse, garanti. | Lav | P3 | B |
| SEK-05 | Oppsplitting av kjøp | Et kjøp delt for å holde seg under en grense, eller for å få medlemsfordel to ganger | G, K | Samme kasse og kasserer, påfølgende bongnr (eller ≤ 3 min), samme kortnøkkel eller samme medlem. Hver bong under terskel T (parameter), sum over. Lift mot butikkens normalfrekvens. | Medlem fra grid, kort fra v6 | Lav–middels. Kunde betaler i to omganger. | Middels | P2 | A |
| SEK-06 | Terskel-bunching | Beløp som legger seg like under en godkjennings- eller rapporteringsgrense | G, K | For retur-, kontantutbetaling-, rabatt- og kontantbeløp: kandidatterskel T (runde tall + innstilte grenser). r = N[0,9T, T) / N[T, 1,1T). Poisson/binomialtest. Testes **per kasserer mot butikk**, ikke absolutt (prispunkter som 99/199 gir naturlig bunching). Terskel for store kontantbetalinger settes av virksomheten. | Kun grid for sum, K for utbetaling | Middels. | Middels | P2 | A |
| RAB-09 | Rund rabattprosent som manuell-indikator | Manuelle rabatter skilles fra automatiske | K | Automatiske kampanjer gir prisavledede, ujevne prosenter. Manuelle gir ofte runde (5, 10, 20, 50) eller runde kr-beløp. Andel runde per kasserer mot butikk (EB, binomial). Bekreftede kampanjer (`campDec`) holdes utenfor. | v3 | Middels. Kampanjer med runde prosenter maskerer. | Lav | P2 | A |
| RAB-10 | Kupong–vare-kobling og dobbel fordel | Manuell rabatt på vare som også har kampanjekupong | K | Tokenmatch av kupongnavn mot varelinjer på samme bong. Treff + manuell rabatt uten årsak på samme linje = dobbel fordel. Kupong uten matchende vare vises som egen kategori. README nevner koblingen som ikke gjort. | Kupongformat må bekreftes | Lav inntil format er sett. | Middels | P3 | C |
| LIN-04 | Regulerte varer utenfor tillatt salgstid | Brudd på salgstidsregler (f.eks. alkohol) | K, G | Bruker definerer varegruppe (finnes: nøkkelord eller `#EAN`), tidsvindu per ukedag og stengte dager (helligdagskalender fra TID-04). Funn: positive linjer i gruppen på bong utenfor vindu, med tolerance for at bongtid er sluttid. Kasserer-konsentrasjon via KAS-01. Tidsvinduet settes som parameter; lovens og kommunal bevillings grenser varierer, ikke verifisert her. | Brukerliste over EAN/ord | Høy gitt riktig liste og vindu. Feilkilder: bongtid er sluttid, klokkefeil. Dette er etterlevelse, ikke svinn. | Lav | P1 | A |
| MED-04 | Kort ↔ medlem-koblingsstabilitet | Medlemsnr tastet på bonger der kunden ikke brukte eget kort | K | Graf kortnøkkel (BIN + siste 4 + skjema) ↔ medlem. For kortnøkler med ≥ k bonger: modalt medlem og andel. Bonger der medlemsnr ≠ modalt = uvanlig kobling. Også medlem med mange kortnøkler. Per kasserer: andel uvanlige koblinger (KAS-01). | v6; BIN på kortlinjen | Lav–middels. Husholdning med flere kort. Siste 4 alene kolliderer, krev BIN. | Middels | P2 | C |
| MED-05 | Kasserer-nettverk via delte medlemmer/kort | Samarbeid, felles bruk av nummer | G, K | Todelt graf kasserer–medlem (og kort). Jaccard på mengden lavvolum-medlemmer som har hendelser (rabatt uten årsak, retur). Sammenhengende komponenter over terskel. Vises som gruppe i Sjekk først. | Kun grid for medlem | Lav; sterkest som støtte for andre funn. | Middels | P3 | A |
| MED-06 | Medlem × hendelsesandel | Medlem som nesten bare har rabatt uten årsak, retur eller 0-kr | G, K | Per medlem (pseudonym): hendelsesandel mot butikk, EB og binomial. Minst 5 bonger. | Kun grid for retur/0-kr | Lav–middels. | Lav | P3 | A |
| ENG-04 | Transaksjons-ID-konsistens | Datakvalitet og manipulasjon | G | `transactionId` = `butikk-kasse-løpenr` må stemme med kolonnene `storeNumber` og `workstationNumber`. Format utenfor forventet mønster. Samme ID i flere rader. Ikke-numerisk løpenr. | Kun grid | Høy (deterministisk), sjelden. | Lav | P2 | A |
| ENG-05 | Tidsstempel-hygiene | Klokkefeil, importerte eller manuelle poster | G, K | Tid i fremtiden (> nå + 5 min). Andel nøyaktig 00:00:00 mot baseline. Dato utenfor hentet periode. Ulike kasser med identisk sekundstempel og beløp (kopi). Dato i topptekst ≠ dato i liste. | Kun grid | Høy for fremtid og dato. | Lav | P2 | A |
| REV-01 | Revisjonsutvalg (risikovektet stikkprøve) | Gir objektivt tall på hva verktøyet **ikke** fanger | G, K | Utvalg: 100 % av høyeste risiko, pengevektet (MUS) på |beløp|, og tilfeldig lavrisiko-prøve. Seed lagres og hashes i rapporten, så utvalget kan reproduseres. Utfallene (7.9) gir feilrate med Clopper–Pearson-intervall og øvre grense, og et anslag på hvor mange avvik som ligger under flagget. Gir presisjonstall fra egne data uten å finne på dem. | Utfall registrert | Metodisk solid. Krever manuelt arbeid. | Middels | P2 | A |
| REV-02 | Stille kontroller og regelhelse | Kontroller som har sluttet å virke uten at noen merker det | G, K | Per kontroll: antall kjøringer «ikke vurdert», funn siste N kjøringer, dekning. Flagg kontroller som alltid er «ikke vurdert», eller har 0 funn selv om dekningen er god (kan være friske, vises som informasjon). Selvtest-knapp: kjør alle kontroller mot innebygd syntetisk datasett med injiserte avvik og vis at hver slår ut. | Historikk for trend; selvtest kan gjøres nå | Høy for selvtest. | Middels | P2 | A/B |
| TID-05 | Butikkprofil mot kjede | Butikker som avviker fra resten | G, K | Som KAS-02, men over butikker (≥5): retur, rabatt uten årsak, kontantandel, differanse per kontantkrone, 0-kr, hull-rate, manuell lapp. Robust z, time- og ukedagsjustert. | Flere butikker lastet | Middels. Størrelse, beliggenhet. | Middels | P2 | A |
| TAL-01 | Benford og siste siffer på delpopulasjoner | Tallmønstre i rabatt-kr, returbeløp, pantelapp, kontantutbetaling | K | Som dagens `numbers`, men på delpopulasjonene per kasserer. Krever n nok. | v3 | Lav. | Lav | P3 | A |

Tillegg til eksisterende forslag, uten egen ID: KAS-01 kan også estimeres som Poisson-regresjon (GLM) med kovariater (time, ukedag, kasse-klynge) og standardiserte residualer, i stedet for indirekte standardisering. Samme resultat når kovariatene er få, men skalerer bedre.

### 12.3 De åtte mest verdifulle av de nye

| Rang | ID | Hvorfor |
|---|---|---|
| 1 | STR-02 | Alle kontroller hviler på parseren. En stille formatendring gjør hele verktøyet misvisende. README nevner selv risikoen. |
| 2 | OPP-10 | Det motsatte av dagens differansetester: fanger kasser som «alltid går opp». Billig, bare oppgjør. |
| 3 | S17 / ID-unikhetstest | Retter en feil som kan blande personer og butikker. Påvirker KAS-01/02/03. |
| 4 | LIN-04 | Deterministisk etterlevelseskontroll på data som finnes (varer + tid). Bruker eksisterende varegruppe-mekanikk. |
| 5 | RET-07 | Dekker prisendring via retur, som verken `falseReturns` eller `priceDeviation` ser. |
| 6 | SEK-06 | Fanger bevisst tilpasning til godkjenningsgrenser. Testes mot butikk, så prispunkter ikke gir støy. |
| 7 | REV-01 | Gir et faktisk tall på hva som går under radaren, og et revisjonsmessig forsvarlig utvalg. |
| 8 | MED-04 | Treffer tastet medlemsnr direkte, forutsatt at kortlinjen har BIN. |

### 12.4 Klassifisering av runde 2

| Klasse | Kontroller |
|---|---|
| A (nå) | STR-01, KAS-08, KAS-09, OPP-10, OPP-13, RET-07, SEK-05, SEK-06, RAB-09, LIN-04, MED-05, MED-06, ENG-04, ENG-05, REV-01, TID-05, TAL-01 |
| A/B | STR-02, REV-02 |
| B (historikk) | OPP-11, RET-08, RET-09 |
| C (format) | OPP-12, RAB-10, MED-04 |
| D | ingen nye |

## Vedlegg A: Avklaringer som må gjøres før enkelte kontroller slås på

1. Har listens rådata `endDateTime` sekunder? Viser cellen dem? (S1, KAS-05, SEK-04)
2. Er topptekstens tid start- eller sluttid? Test: øker differansen mot listens tid med antall linjer? (KAS-05)
3. Hva er «Beløp» i valørtabellen: kroner eller antall? (OPP-05)
4. Er kupong-ID per kunde eller per kampanje? (RAB-08)
5. Hvordan vises kontantuttak mot kort (Bank > Totalt + Kontant tilbake)? (BET-01)
6. Står BIN/utstedernummer på kortlinjen, også på retur? (BET-03, RET-06)
7. Hvordan vises sletting av linje (motlinje eller egen tekst)? (RET-01)
8. Gir CW-listen alle rader (paginering, maks rader)? (ENG-01)
9. Er `totalAmount` (subtotal) lik «Totalt» på bongen? (BET-08)
10. Hvilke verdier har `saleChannel` per kasse, og er mappingen stabil? (strata)
11. Deler kasser samme nummerserie, og nullstilles den? (ENG-02 svarer selv)
12. Butikkenes åpningstider og unntak. (TID-04)
13. Er kasserer-ID kjedeunik eller butikklokal? Styrer nøkkelen `butikk|kasserer`, KAS-03(a), KAS-07 og alle jevnaldrende-sammenligninger. (S17)
14. Hvilke varer er regulert, og hvilket salgstidsvindu gjelder per butikk/kommune? Brukeren må levere listen. (LIN-04)
15. Hvilke godkjenningsgrenser gjelder for retur, kontantutbetaling og rabatt? (SEK-06, SEK-05)
16. Hva betyr feltene i oppgjørets Tilgodelapp-blokk (egne, fremmede, utlevert)? (OPP-12)

## Vedlegg B: Det jeg ikke har gjort

- Ikke endret filer i repoet. Ikke skrevet produksjonskode.
- Ikke testet noe mot ekte CW-data eller Playwright-e2e.
- Ikke målt ytelse.
- Presisjonsvurderingene er kvalitative resonnementer fra koden og dokumentasjonen. De er ikke målt.
- Tolkningen av lovverk (åpningstid/helligdag) er en hovedregel, ikke juridisk vurdering.
