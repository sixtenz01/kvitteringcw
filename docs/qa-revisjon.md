# QA-, data- og produktrevisjon: kvitteringsportal

Revisjon av Kvitteringshenter v3.11.1 og av en generell kvitteringsportal. Dato 2026-10-03. Forespørselen var avkuttet i eksempelet på risikoscoren («+20 samme beløp og butikk innen …»); scoremodellen i kapittel 5 er fullført uten den delen.

## 0. Grunnlag og forbehold

To flater er vurdert, og hver kontroll er merket:

- **CW** = journalbonger i Lindbak Chain Web, slik Kvitteringshenter ser dem: gridrader og kvitteringstekst i iframen. Ingen API-kall, ingen bilder, ingen OCR, ingen godkjenningsflyt.
- **PORTAL** = generell utleggsportal med opplasting av bilder/PDF, OCR, brukerregistrering, godkjenning og utbetaling. Finnes ikke i prosjektet; kontrollene er forslag.

Statussymbol mot Kvitteringshenter: ✓ finnes · ◐ delvis · ○ kan bygges med grid + iframe uten API · ✕ krever data vi ikke har.

F1–F9 og F12 i kapittel 1 er **kjørt og verifisert** (fuzz mot logic.js, 2026-10-03). F10, F11 og F13 er kodegjennomgang. Resten er vurderinger. Ingenting er prøvd mot ekte CW-data.

## 1. Verifiserte funn i Kvitteringshenter v3.11.1

| # | Funn | Bevis | Alvor | Anbefalt retting |
|---|---|---|---|---|
| F1 | **CSV-injeksjon.** Tekstceller som starter med `=`, `+`, `@` eller tab skrives uendret til CSV (varenavn, notater, bongnr). Excel kjører dem som formel. | `toCsv([['=HYPERLINK(...)','+1+1','@SUM(1)','\t=1']])` ga uendret tekst. | Medium | Prefiks `'` på tekstceller som starter med `= + - @ \t \r`. Ikke på rene tall. |
| F2 | **Skjulte tegn og Unicode-normalisering i etiketter.** ZWSP eller NBSP i `Bank:` gir en egen betalingsmetode («Bank​», «Bank »). Rabattårsak med oppløst å (a + ring) mister årsaken, og bongen telles som «rabatt uten årsak». | `Bank​:` ga `pay {"Bank​":10}`. `Rabatt årsak: Datovare` ga ingen `dr`. | Høy | Normaliser celletekst: NFC, fjern `​-‏⁠﻿`, NBSP til mellomrom, trim, før parsing. |
| F3 | **Beløpsparser slipper linjer stille.** Unicode-minus (−), tankestrek (–), `5.00-`, `(5.00)`, `1.234,56` og `1,000.50` gir `null`; linjen havner ikke i varelinjene. Den vises bare i Diagnostikk. | `parseAmount` ga `null` for alle seks. | Medium | Støtt U+2212/U+2013, etterstilt minus, parentes; avgjør tusenskille/desimal ut fra siste skilletegn. Tell droppede beløpslinjer og vis dem som dekningsfeil. |
| F4 | **Ingen grense på størrelsen til én skannepost.** 200 000 linjer og 100 000 tegn varenavn lagres uavkortet i IndexedDB og i `innhold.json`. Brudd på «hard grense» for egen lagring. | 200 000 linjer: 600 ms, alle lagret. Varenavn 100 000 tegn lagret. | Medium | Maks 80 tegn per navn, maks 500 linjer per bong (flagg `trunc`), og byte-basert cache-tak i tillegg til antall. |
| F5 | **Sommertid: to tidspunkt blir samme lokale tid.** Rådata med tidssone: `00:30Z` og `01:30Z` natt til 25.10. gir begge `02:30`. Gir falske duplikater og falsk «bongnummer og tid stemmer ikke». | `localDT` ga lik streng. | Lav–Medium | Behold UTC-minutt (`ts`) ved siden av lokal streng; bruk `ts` til sortering og duplikat. |
| F6 | **Ugyldige datoer og klokkeslett godtas.** `31.02.2026 10:00`, `25:99` og `24:00` passerer og forurenser tidstester. | `parseCellDT`, `parseDT`. | Lav | Valider felt (måned 1–12, dag mot måned, tid 00:00–23:59). Ugyldig = tom. |
| F7 | **Medlemsnr normaliseres ikke.** `007`, `7`, `7 ` (NBSP) og `m1`/`M1` regnes som ulike nummer. Fire bonger med «samme» nr ga ingen dagstreff. | `memberChecks`: tom funnliste. | Medium | Fjern ikke-alfanumeriske tegn, store bokstaver, fjern ledende nuller for rent numeriske. |
| F8 | **Duplikattesten flagger 0 kr.** To bonger på 0,00 på samme kasse samme minutt blir «mulig duplikat». | `findDuplicates` ga 1 gruppe. | Lav | Ekskluder beløp 0 og null. |
| F9 | **NaN/Infinity i totalsum.** `sumSelected` gir `null` (vises som «NaN») hvis ett beløp er NaN eller uendelig. | Verifisert. | Lav | Hopp over ikke-endelige tall og tell dem. |
| F10 | **Skannerace (kodeslutning, ikke testet).** Skanningen leser iframen når den har innhold. Kommer et sent svar for en tidligere bong (etter 6 s tidsavbrudd) mens neste bong venter, tilordnes feil innhold til feil bong. | `loadViaDom`, `SCAN_TIMEOUT`. | Medium | Les `Kvittering: <nr>` i topptekst og avvis innhold der løpenummer ≠ valgt rad. Vi leser allerede topptekstens dato og tid. |
| F11 | **Notater uten historikk.** `notes[id] = {…}` overskriver status og tekst; sletting er mulig; ingen logg. For en revisjonsløsning er endring av historikk mulig. | Kodegjennomgang. | Medium | Append-only notatlogg med tidsstempel, og med i revisjonsrapportens kontrollsum. |
| F12 | **Innstillingsstrenger uten lengdegrense.** `sanitizeControl` godtok 1 000 000 tegn; havner i innstillingseksport og rapport. | Verifisert. | Lav | Maks 200 tegn per verdi. |
| F13 | **Cache er antallsbasert (2000), «Tøm cache» uten bekreftelse, sidedeling ikke verifisert.** Kjent fra tidligere gjennomgang. | Kodegjennomgang. | Medium | Byte-tak, bekreftelse, «viser N av M». |

Ingen funn om HTML-injeksjon: rapportens HTML escapes, og panelet bruker ikke `innerHTML` med ekstern tekst.

## 2. Dekning av kravlisten

### 2.1 Duplikater og samme kjøp

| Område | Kontroll | Data | Flate | Status |
|---|---|---|---|---|
| Duplikat med annet filnavn, format, komprimering, beskjæring, små bildeendringer, ulik OCR | Tre lag: (1) SHA-256 på filbytes, (2) perseptuell hash (pHash/dHash/wHash 64 bit, Hamming ≤ 8) og SSIM etter normalisering (grå, 600 px, auto-beskjær), (3) **kvitteringsfingeravtrykk** fra felt: (org.nr, dato, tid ±2 min, total, kortref) med fuzzy leverandørnavn. Resultater klynges med union-find. | Fil, OCR-felt | PORTAL | ✕ |
| Samme kjøp registrert av flere ansatte | Nøkkel (butikk, tid ±5 min, beløp ±1 kr, kortref/siste 4) på tvers av brukere. | Bruker, felt | BEGGE | ◐ (`findDuplicates` samme kasse og minutt) |
| Identisk/nesten identisk beløp, tid, butikk, org.nr, kortreferanse | Blokking på org.nr + dato, deretter fuzzy: Levenshtein/Jaro-Winkler på navn, ±1 kr, ±5 min. | Felt | BEGGE | ◐ |

### 2.2 Tid, sted, frekvens og grenser

| Område | Kontroll | Data | Flate | Status |
|---|---|---|---|---|
| Ulogiske kombinasjoner dato/tid/sted/bruker | Regelmotor: åpningstid, reisetid mellom steder, fravær, arbeidssted. | Felt, HR, geokoder | BEGGE | ◐ (utenfor åpningstid ✓) |
| Registrert før kjøp eller langt etter | `registrert − kjøpt < 0` (kritisk) eller `> 30 d` (flagg), per bruker mot kollegaer. | To tidsstempler | PORTAL | ✕ |
| Uvanlig frekvens | Glidende tellere per bruker/butikk/kategori, robust z mot kollegaer. | Historikk | BEGGE | ◐ (kassererprofil) |
| Mange kjøp rett under godkjenningsgrense | Tetthetsdiskontinuitet rett under grenser (McCrary-lignende), og antall i [90 %, 100 %) av grensen per bruker. | Beløp, regler | PORTAL | ✕ |
| Oppsplitting av større kjøp | Samme bruker + leverandør + dag, hver under grensen, sum over. Utvid til ±1 dag og samme kort. | Felt | BEGGE | ◐ (`memberDay` for medlem) |

### 2.3 Beløp, MVA og valuta

| Område | Kontroll | Data | Flate | Status |
|---|---|---|---|---|
| Beløp endret mellom OCR, registrering og godkjenning | Versjonshistorikk per felt; flagg endring over 1 % eller 50 kr og hvem som endret. | Feltversjoner | PORTAL | ✕ |
| MVA: feil sats, manglende MVA, total ≠ netto + MVA | Sats mot kategori (25/15/12/0 %), `netto + MVA = total ± 0,02`, sum av MVA-linjer. | Linjer, MVA-tabell | BEGGE | ○ (MVA-tabell står på bongen, ikke parset) |
| Valuta og avrunding | Kurs mot Norges Banks dagskurs (±2 %), dobbeltkonvertering, ørerunding bare ved kontant. | Valuta, kurs | BEGGE | ○ (`Øreavrunding`-linje, ikke parset) |

### 2.4 Retur, kort og leverandør

| Område | Kontroll | Data | Flate | Status |
|---|---|---|---|---|
| Kreditnota/refusjon uten kobling til kjøp | Match på (leverandør, vare, beløp, tid ≤ N d). Ukoblede flagges. | Linjer | BEGGE | ✓ (retur uten salg) |
| Retur der både kjøp og refusjon utbetales | Nettoberegn per kjede; utbetalt > 0 etter fullstendig retur. | Utbetalinger | BEGGE | ◐ (kortkjøp refundert kontant) |
| Samme kort brukt av flere brukere | Kortreferanse/siste 4/hash ↔ brukere; flagg > 1 bruker uten avtalt delt kort. | Kort-ID | BEGGE | ○ (`Referanse`/`TransId` ikke parset) |
| Leverandør som ikke passer rolle eller arbeidssted | Rolle × leverandørkategori-matrise; avstand arbeidssted–butikk; avvik fra kollegaer. | Rolle, geo | PORTAL | ✕ |
| Uvanlige tider, helligdager, steder | Norsk kalender (inkl. påskeberegning), nattvindu, geofence. | Tid, geo | BEGGE | ◐ |

### 2.5 Bilde, OCR og manipulasjon

| Område | Kontroll | Data | Flate | Status |
|---|---|---|---|---|
| OCR avviker fra kvitteringen | OCR-confidence per felt, to motorer med ordvis avstand, aritmetiske invarianter (linjer = total). | Bilde, OCR | PORTAL | ✕ |
| Manipulerte, redigerte eller syntetiske bilder | Metadata, ELA, dobbelkvantisering, glyph-konsistens, malavvik, gen-AI-klassifisering. | Bilde | PORTAL | ✕ |

### 2.6 Nummerserier

| Område | Kontroll | Data | Flate | Status |
|---|---|---|---|---|
| Manglende/ulogiske serienr, kvitteringsnr, transaksjons-ID | Format per leverandør (regex, kontrollsiffer), duplikat, ikke-monoton. | ID | BEGGE | ✓ (dobbelt/feil rekkefølge) |
| Sekvenser som tyder på manglende eller gjentatte transaksjoner | Delta-analyse, Poisson-gap per butikk/dag, regresjon nummer ~ tid. | ID, tid | BEGGE | ✓ (hull) / ○ (regresjon) |

### 2.7 Brukere, godkjenning, logg og samtidighet

| Område | Kontroll | Data | Flate | Status |
|---|---|---|---|---|
| Mønstre mellom brukere, avdelinger, butikker, godkjennere | Graf (bruker–kort–leverandør–godkjenner), peer-sammenligning. | Relasjoner | PORTAL | ✕ (CW: kasserer–medlem–butikk ◐) |
| Godkjenner som godkjenner det andre avviser | Avvisningsrate per godkjenner innenfor samme risikobånd; Cohen's kappa mot øvrige. | Beslutninger | PORTAL | ✕ |
| Endring etter godkjenning | `approved_hash` av innhold; avvik gir ny godkjenning. | Hash | PORTAL | ✕ |
| Manglende audit-logg, mulig historikkendring | Append-only med hash-kjede, ingen UPDATE/DELETE-rett, sekvens uten hull. | Logg | PORTAL | ◐ (rapport har SHA-256; notater ikke, F11) |
| Race conditions (innsending, godkjenning, refusjon, sletting) | Idempotensnøkkel, unik indeks (hash, bruker, beløp, dato), optimistisk låsing (ETag/If-Match), refusjon ≤ opprinnelig under radlås. Test: 50 parallelle POST med samme innhold skal gi 1 godkjent; godkjenn og slett samtidig; to refusjoner samtidig. | Konkurransetest | PORTAL | ✕ |

### 2.8 Tid, tegn og ekstremverdier (testmatrise)

| Tilfelle | Forventet | Plugin-resultat |
|---|---|---|
| Rådata UTC (`Z`), sommer og vinter | Norsk lokal tid, riktig forskyvning | OK (test `tid.js`), men F5 |
| Natt til siste søndag i oktober (to like timer) | Ulik instans beholdes | Feil, F5 |
| Natt til siste søndag i mars (time finnes ikke) | Ingen kvittering på 02:xx lokal | OK |
| Desimalskille `,` og `.`, tusenskille mellomrom/NBSP/punktum | Samme tall | Delvis, F3 |
| Unicode-minus, tankestrek, parentes | Negativt beløp | Feil, F3 |
| NFC mot NFD (å), ZWSP, NBSP, RTL-overstyring, kyrillisk «а» | Samme tekst/ID eller flagget | Feil, F2 (kyrillisk i varenr havner i Diagnostikk) |
| Store/små bokstaver i ID og navn | Samme enhet | Feil for medlemsnr, F7 |
| 0 kr | Ikke duplikat, ikke Benford | Duplikat feil, F8 |
| Negative beløp | Retur | OK |
| Ekstremt stort (1e12) | Håndteres, flagges | OK; 1e21 droppes (F3) |
| NaN/Infinity | Hoppes over | Feil, F9 |
| Svært lange felt | Avkortes | Feil, F4 |
| Mange varelinjer (200 000) | Tar under 1 s, avkortes | 600 ms; ikke avkortet, F4 |
| Store vedlegg (PORTAL) | Grense, virusskan, tidsavbrudd | n/a |

## 3. 38 nye analyseideer

Ideene bruker teknikkene fra listen, men er konkrete kontroller som ikke står der. Hver idé har: hva den gjør, hva den finner, data, implementasjon, eksempel, falske positiver, risiko og kjøring. «Flate» og «Status» viser om den passer CW og Kvitteringshenter (✓ ◐ ○ ✕).

### Tid og rytme

#### 1. Kjøpsrytme-fingeravtrykk · Medium · nattlig + dashboard · PORTAL ◐ / CW ○
- **Gjør:** Bygger en profil per bruker (ukedag × time, 7 × 24) og måler avvik for hver ny uke mot egen 90-dagers historikk.
- **Finner:** Kontoovertakelse, delt innlogging, uvanlig atferd etter oppsigelse eller konflikt.
- **Data:** Kjøpstid, bruker. CW: bongtid per kasserer.
- **Implementasjon:** Normalisert histogram `p` (historikk) og `q` (uke); Jensen-Shannon-avstand `d`. Flagg ved `d` over 95. persentil av brukerens egne uker og over 90. persentil blant kollegaer. Minst 20 kjøp i historikken.
- **Eksempel:** Bruker handler alltid man–fre 11–13. Uke 41 har 9 kjøp lørdag 02–04. `d` = 0,61 mot egen p95 på 0,22.
- **Falske positiver:** Middels: ferie, reiser, prosjektperioder. Dempes av fraværskalender og krav om minst to uker.
- **Risiko · kjøring:** Medium · nattlig analyse, vises i dashboard, varsel først ved Høy.

#### 2. Registreringsforsinkelse og -bølger · Medium · nattlig + dashboard · PORTAL ✕
- **Gjør:** Måler tiden fra kjøp til registrering per bruker, og antall registreringer per time/dag samlet.
- **Finner:** Etterregistrering rett før frist, batch-innsending (script, makro), «hamstring» ved månedsslutt og kvartalsslutt, bølger etter varsel om revisjon.
- **Data:** Kjøpstid, registreringstid, bruker.
- **Implementasjon:** Per bruker median og p95 av forsinkelse. Flagg `registrert − kjøpt > 30 d`, eller > 10 registreringer innen 10 min med mindre enn 20 s mellom (CV av intervaller < 0,15). Dagsserie med CUSUM.
- **Eksempel:** 34 kvitteringer fra 3 måneder registrert 30.09. mellom 16:02 og 16:21.
- **Falske positiver:** Middels: reisende som samler kvitteringer. Dempes ved å se på innsendingstakt, ikke bare forsinkelse.
- **Risiko · kjøring:** Medium · nattlig analyse + dashboard.

#### 3. Umulig reise (geografisk hastighet) · Høy · sanntid + varsel · PORTAL ✕ / CW ◐
- **Gjør:** Beregner nødvendig hastighet mellom to kjøp med samme bruker eller samme kort.
- **Finner:** Kortbruk av flere personer, falske kvitteringer, kasserer registrert på to steder.
- **Data:** Tid, butikk-koordinater (geokoding), bruker/kort. CW: butikknr og tid per kasserer.
- **Implementasjon:** Haversine eller kjøretid; flagg hvis `km / timer > 130` eller reisetid > tidsforskjell + 10 min. Samme kort i to byer innen 60 min er kritisk.
- **Eksempel:** Kort ****4411: Oslo 10:12, Bergen 10:50.
- **Falske positiver:** Lav ved nettbutikk (ingen sted); utelukk nett, flyplasser tolkes med flytid.
- **Risiko · kjøring:** Høy · sanntid ved registrering + varsel.

#### 4. Fravær- og vaktplan-kryss · Høy · nattlig + varsel · PORTAL ✕ / CW ○
- **Gjør:** Krysser kjøpstid mot HR-fravær (ferie, permisjon, sykmelding) og mot vaktplan.
- **Finner:** Kjøp på vegne av andre, misbruk av kort under fravær, kasserer registrert uten vakt.
- **Data:** Fraværskalender, vaktliste, bruker. CW: kassererliste og vakter fra butikken.
- **Implementasjon:** Intervall-join `kjøp ∈ fravær`; unntak for kjente delegater. CW: kasserer på bong utenfor planlagt skift.
- **Eksempel:** Utlegg på lunsj 14.07. mens bruker er registrert på ferie 03.–28.07.
- **Falske positiver:** Lav–Middels: korte reiser i ferien, feil i HR. Krever manuell kontroll.
- **Risiko · kjøring:** Høy · nattlig + varsel til leder.

#### 5. Løpenummer mot klokke (regresjon) · Medium · nattlig · CW ○ / PORTAL ○
- **Gjør:** Tilpasser `nummer ~ tid` per kasse/dag og ser på residualer.
- **Finner:** Innsatte eller slettede bonger, klokke som er stilt, gjenbrukte nummer, bong registrert med feil tid.
- **Data:** Løpenummer, tid per kasse (CW: transactionId + endDateTime).
- **Implementasjon:** Robust regresjon (Theil-Sen); flagg `|residual| > 4 × MAD` og brudd i monotoni. Utfyller dagens hull-test, som bare ser på naboer.
- **Eksempel:** Nr 2371–2380 ligger på 14:00–14:20; nr 2377 har tid 09:03.
- **Falske positiver:** Lav; økes ved filtrerte lister, så krever helt uten filter.
- **Risiko · kjøring:** Medium · nattlig analyse.

#### 6. Mikrotid-klynger · Høy · nattlig + varsel · PORTAL ✕
- **Gjør:** Ser på sekund- og millisekundnivå i registreringstid og i bildets metadata.
- **Finner:** Automatisert innsending, gjenbrukte maler, bilder laget i samme økt.
- **Data:** Tidsstempler med sekund/ms, filens opprettelsestid.
- **Implementasjon:** Antall kvitteringer med identisk sekund per bruker og time; flagg ≥ 5 av ≥ 8. Samme `created_at` i metadata for «ulike» kjøp.
- **Eksempel:** 12 kvitteringer fra «forskjellige» dager med filtid 2026-09-30 16:02:11.
- **Falske positiver:** Lav; batch-opplasting fra skanner kan se likt ut, så sjekk mot innsendingskanal.
- **Risiko · kjøring:** Høy · nattlig + varsel.

### Beløp og struktur

#### 7. Siffer-preferanse per bruker · Medium · nattlig + dashboard · CW ◐ / PORTAL ○
- **Gjør:** Tester siste siffer, andre siffer (Benford) og andelen hele kroner mot populasjonen med χ².
- **Finner:** Oppdiktede eller rundede beløp.
- **Data:** Beløp, bruker. CW: totalbeløp per kasserer (Benford og runde beløp finnes).
- **Implementasjon:** χ² på siste-siffer-fordelingen (9 frihetsgrader) mot uniform, og mot avdelingens fordeling. Krever ≥ 50 bonger. Utvid med andre siffer.
- **Eksempel:** 41 % av en brukers beløp ender på 0, mot 12 % blant kollegaer.
- **Falske positiver:** Middels: kontant og faste priser. Skill kort og kontant.
- **Risiko · kjøring:** Medium · nattlig + dashboard.

#### 8. Robust prisavvik per leverandør og kategori · Medium · nattlig · PORTAL ○ / CW ✓ (enhetspris)
- **Gjør:** Sammenligner beløp mot medianen for samme leverandør og kategori (MAD), og beløp per deltaker.
- **Finner:** Oppblåste beløp, feil kategori, falske totaler.
- **Data:** Beløp, leverandør, kategori, antall deltakere. CW: enhetspris per EAN (finnes).
- **Implementasjon:** `z = (x − median) / (1,4826 × MAD)`; flagg `z > 3,5`. Per-capita: `beløp / deltakere` mot policy.
- **Eksempel:** Lunsj hos samme kafé: median 145 kr, MAD 25, kvittering 980 kr (z = 22).
- **Falske positiver:** Middels: store møter og kampanjer. Krever minst 10 observasjoner per gruppe.
- **Risiko · kjøring:** Medium · nattlig analyse.

#### 9. Kumulativ rammeunngåelse · Høy · nattlig + varsel · PORTAL ✕
- **Gjør:** Ser på glidende 7- og 30-dagerssummer per bruker og leverandør mot rammegrenser, ikke enkeltkjøp.
- **Finner:** Unngåelse av periodebaserte grenser (månedsramme, leverandørgrense, innkjøpsavtale).
- **Data:** Beløp, tid, bruker, leverandør, grenser.
- **Implementasjon:** `rolling_sum(30 d)` mot `limit`; flagg ved 90–100 % med ≥ 3 kjøp, og når summen krysser grensen kun fordi kjøpet er splittet.
- **Eksempel:** 5 kjøp à 9 800 kr hos samme leverandør på 6 dager mot 50 000 kr-grensen.
- **Falske positiver:** Lav–Middels: faste leveranser.
- **Risiko · kjøring:** Høy · nattlig + varsel.

#### 10. Linjeregnskap («bongen går opp») · Høy · sanntid · CW ○ / PORTAL ○
- **Gjør:** Kontrollerer at `sum varelinjer + avrunding = total = betalinger − kontant tilbake (+ tips)`.
- **Finner:** Redigerte totaler, avkortede bonger, parserhull, OCR-feil på total.
- **Data:** Varelinjer, `Totalt`/`Sum`, `Øreavrunding`, betalinger. CW: alle står på bongen.
- **Implementasjon:** Toleranse 0,05 kr. Skill «linjer mangler» (sum for lav) fra «total manipulert» (linjer stemmer, total ikke).
- **Eksempel:** Linjer 268,40, total 286,40 (to sifre byttet), betalt 286,40.
- **Falske positiver:** Lav; økes av pant, gavekort og rabatter som ikke vises som linje.
- **Risiko · kjøring:** Høy · sanntid (ved skanning).

#### 11. Restriksjonsvarer og blandet kurv · Høy · sanntid + varsel · CW ○ / PORTAL ○
- **Gjør:** Matcher varelinjer mot blokkliste (alkohol, tobakk, gavekort, lotteri) og mot kombinasjoner som er uvanlige.
- **Finner:** Ikke-refunderbare varer skjult i en ellers lovlig kvittering.
- **Data:** EAN/varenavn, kategorikart. CW: EAN-linjer.
- **Implementasjon:** EAN-prefiks og nøkkelord; flagg også når andelen restriksjonsvarer er liten, men på kvittering merket «kontorrekvisita».
- **Eksempel:** Kvittering fra dagligvare med 1 flaske vin gjemt blant 14 linjer.
- **Falske positiver:** Middels: feil EAN-kategori. Kategorikartet må vedlikeholdes.
- **Risiko · kjøring:** Høy · sanntid + varsel.

#### 12. Gavekort- og tilgodelapp-kjeder · Høy · nattlig · CW ○ / PORTAL ○
- **Gjør:** Kobler kjøp og innløsning av gavekort/tilgodelapper via ID.
- **Finner:** Gavekort som brukes flere ganger, kjøpt og innløst av samme ansatt (penger tilbake til lommen), tilgodelapper uten opprinnelse.
- **Data:** Gavekort-ID, linjer, betalingsmåte. CW: tilgodelapp vises i kassaoppgjør.
- **Implementasjon:** Graf `kjøp → innløsning` per ID; flagg `innløst > kjøpt`, innløsning før kjøp, samme bruker begge steder.
- **Eksempel:** Gavekort 1002-77 kjøpt for 1 000 kr, innløst to ganger (700 + 600).
- **Falske positiver:** Lav; data fra flere kjeder kan mangle.
- **Risiko · kjøring:** Høy · nattlig analyse.

#### 13. Mengdeanomali per varelinje · Medium · sanntid · CW ◐ / PORTAL ○
- **Gjør:** Ser på `Antall` mot normal kurvstørrelse for varen og avdelingen.
- **Finner:** Feiltastet antall, innkjøp på vegne av andre, hamstring.
- **Data:** Antall, enhetspris, vare. CW: `Antall: … à Kr …` leses allerede.
- **Implementasjon:** Robust z på `log(antall)` per vare; flagg `z > 4` og beløp over terskel.
- **Eksempel:** `Antall: 600 stk à Kr 15,90` for en vare som vanligvis kjøpes 1–3.
- **Falske positiver:** Middels: bedriftskunder.
- **Risiko · kjøring:** Medium · sanntid.

### Graf og nettverk

#### 14. Bruker–kort–leverandør-graf med fellesskap · Høy · nattlig + dashboard · PORTAL ✕ / CW ◐
- **Gjør:** Bygger en bipartitt graf (bruker–kort–leverandør–godkjenner) og finner tette undergrafer (Louvain, tilkoblede komponenter).
- **Finner:** Ringer: flere ansatte som deler kort og leverandør, kollusjon med leverandør, selvgodkjenning i krets.
- **Data:** Bruker, kort-hash, leverandør, godkjenner. CW: kasserer–medlem–butikk (finnes delvis).
- **Implementasjon:** Kantvekt = antall og sum; flagg komponenter med > 2 brukere som deler > 1 kort, og modularitet over 0,6.
- **Eksempel:** 4 brukere, 1 kort, 1 leverandør (ny), samme godkjenner: 38 kvitteringer på 5 uker.
- **Falske positiver:** Middels: team som handler hos samme kafé med felles kort.
- **Risiko · kjøring:** Høy · nattlig analyse + dashboard (grafvisning).

#### 15. Gjensidig godkjenning og sykluser · Høy · nattlig + varsel · PORTAL ✕
- **Gjør:** Ser på godkjenningsgrafen (hvem godkjenner hvem).
- **Finner:** A godkjenner B og B godkjenner A (gjensidighet), sykluser A→B→C→A, godkjenner med ≥ 95 % godkjenningsrate på et nettverk på 2–3 personer.
- **Data:** Innsender, godkjenner, beslutning, tid.
- **Implementasjon:** Rettet graf; reciprocity-rate og sykluser av lengde ≤ 4; sammenlign mot avdelingsgjennomsnitt.
- **Eksempel:** To kolleger godkjenner 100 % av hverandres 61 utlegg, mot avdelingens 82 %.
- **Falske positiver:** Middels: små team der to personer er hverandres eneste vikar.
- **Risiko · kjøring:** Høy · nattlig + varsel.

#### 16. Leverandørkonsentrasjon og «ny leverandør, stort beløp» · Medium · nattlig · PORTAL ✕
- **Gjør:** Beregner Herfindahl-indeks per bruker og flagger første kjøp hos en leverandør med høyt beløp.
- **Finner:** Fiktive leverandører, kjøpsring mot én leverandør, plutselig endring i leverandørbilde.
- **Data:** Leverandør (normalisert), beløp, historikk.
- **Implementasjon:** `HHI = Σ andel²`; flagg `HHI > 0,6` med ≥ 10 kjøp, og `første kjøp > p95 av nye leverandører`.
- **Eksempel:** 92 % av en brukers utlegg siste kvartal hos «Nordic Tools AS» (ny).
- **Falske positiver:** Middels: roller med én faste leverandør.
- **Risiko · kjøring:** Medium · nattlig analyse.

#### 17. Leverandørnormalisering og org.nr-validering · Høy · sanntid · PORTAL ✕
- **Gjør:** Normaliserer navn (fjern AS, store/små, diakritiske tegn) og validerer org.nr.
- **Finner:** Ugyldig eller avviklet org.nr, organisasjonsnummer som ikke passer navnet, samme leverandør i flere stavemåter for å skjule frekvens, mod-11-feil.
- **Data:** Org.nr, navn, bankkonto, snapshot fra Enhetsregisteret.
- **Implementasjon:** Modulus 11 (vekter 3,2,7,6,5,4,3,2); oppslag mot lokal kopi av registeret (konkurs, slettet, stiftet < 6 mnd); Jaro-Winkler ≥ 0,92 på navn grupperer varianter.
- **Eksempel:** «Rema1000 AS» og «REMA 1000 Norge» med ulike org.nr, ett er ugyldig.
- **Falske positiver:** Lav; utenlandske leverandører har andre ID-formater.
- **Risiko · kjøring:** Høy · sanntid ved registrering.

#### 18. Kort ↔ bruker ↔ medlemsnr-kobling · Høy · nattlig + varsel · PORTAL ✕ / CW ◐
- **Gjør:** Måler 1:N- og N:1-relasjoner mellom kort-token, bruker og medlemsnr.
- **Finner:** Delte kort, ett medlemsnr brukt av mange, kort som skifter eier.
- **Data:** Kort-hash/siste 4, medlemsnr, bruker. CW: medlemsnr fra grid (finnes), kortreferanse ikke ennå.
- **Implementasjon:** Tilkoblede komponenter; flagg komponenter med > 2 brukere eller > 3 kort per medlem.
- **Eksempel:** Medlemsnr 751000111 på 10 bonger hos kasserer 4102, tre ulike kortreferanser.
- **Falske positiver:** Middels: familie og felles bedriftskort.
- **Risiko · kjøring:** Høy · nattlig + varsel.

### Statistikk og maskinlæring

#### 19. Isolation Forest på bruker-uke-vektor · Medium · nattlig + dashboard · BEGGE ○
- **Gjør:** Lager en vektor per bruker og uke og lar en modell rangere de mest uvanlige.
- **Finner:** Kombinasjoner som ingen enkeltregel dekker (mange små signaler).
- **Data:** Antall, sum, snitt, andel kontant, nattandel, antall leverandører, returandel, rabattandel. CW: samme per kasserer og dag.
- **Implementasjon:** Isolation Forest (300 trær) eller robust Mahalanobis. Skår normaliseres til persentil og vises sammen med de tre mest bidragende feature-ene.
- **Eksempel:** Uke 41: 7× vanlig antall, 0 returer, 80 % kontant: persentil 99,7.
- **Falske positiver:** Høy uten forklaring; derfor kreves bidragsforklaring og manuell vurdering.
- **Risiko · kjøring:** Medium · nattlig analyse + dashboard.

#### 20. Kollegasammenligning med krymping · Medium · nattlig · BEGGE ✓/◐
- **Gjør:** Måler hver person mot peer-gruppe (rolle, avdeling, butikk) med empirical-Bayes-krymping.
- **Finner:** Systematiske avvik uten å flagge nyansatte med få observasjoner.
- **Data:** Samme metrikker som profilen. CW: kassererprofil finnes (rå forhold ≥ 1,5 ×).
- **Implementasjon:** `θ̂ = λ·x̄ + (1−λ)·μ`, `λ = n/(n+k)`; z mot peer-spredning; vis konfidensintervall.
- **Eksempel:** Kasserer med 6 bonger og 2 returer (33 %) krympes til 14 % mot snitt 10 % og flagges ikke.
- **Falske positiver:** Lav; det er hovedformålet.
- **Risiko · kjøring:** Medium · nattlig analyse.

#### 21. Brudd i tidsserie (CUSUM/PELT) · Medium · nattlig + varsel · BEGGE ○
- **Gjør:** Finner når en bruker, kasse eller butikk skifter nivå i en serie.
- **Finner:** Regimeskifte etter ny leder, ny policy, ny kasserer, endret leverandør eller start på misbruk.
- **Data:** Daglige/ukentlige metrikker.
- **Implementasjon:** CUSUM eller PELT med minste segment 5 punkter; rapporter dato, retning og størrelse.
- **Eksempel:** Rabatt uten årsak går fra 3 % til 14 % av bongene fra 12.09.
- **Falske positiver:** Middels: kampanjer og sesong.
- **Risiko · kjøring:** Medium · nattlig + varsel.

#### 22. Sesongjustert forventning per butikk · Medium · nattlig + dashboard · CW ○
- **Gjør:** Bygger forventet nivå (STL eller ukedag × time) og flagger butikker som avviker.
- **Finner:** Butikk med unormal returandel, rabatt, kassadifferanse eller antall bonger i forhold til forventning.
- **Data:** Daglige verdier per butikk og kasse (CW: lastede bonger over uker).
- **Implementasjon:** STL eller ukedagsprofil; residual z over 3. Krever minst 8 uker.
- **Eksempel:** Butikk 1002 har 17 % returandel torsdager, forventet 6 %.
- **Falske positiver:** Middels uten nok historikk; bruk glidende vindu.
- **Risiko · kjøring:** Medium · nattlig + dashboard.

#### 23. Adaptiv unngåelse etter avvisning · Høy · nattlig + varsel · PORTAL ✕
- **Gjør:** Ser på hva som skjer rett etter at et utlegg er avvist.
- **Finner:** Brukere som «lærer» grensen: nytt kjøp litt under avvist beløp, splittet i to, eller registrert hos annen kostnadssted.
- **Data:** Avvisninger, beløp, tid, bruker.
- **Implementasjon:** Etter avvisning med beløp `X`: flagg nye innsendinger innen 7 d med `X·(0,6–0,99)` eller to som summerer til `X ± 5 %`.
- **Eksempel:** 4 200 kr avvist mandag; to kjøp à 2 100 kr tirsdag.
- **Falske positiver:** Lav–Middels: legitim retting etter avvisning.
- **Risiko · kjøring:** Høy · nattlig + varsel.

### Bilde, OCR og metadata

#### 24. Metadatarettsmedisin · Høy · sanntid + varsel · PORTAL ✕
- **Gjør:** Leser EXIF/XMP/PDF-metadata og sammenligner med påstått kjøp.
- **Finner:** Redigeringsprogram (Photoshop, Canva, Word, Pages), opprettet etter kjøpstid, GPS langt fra butikk, samme kameramodell og serie på «ulike brukeres» kvitteringer, fjernet metadata hos én bruker.
- **Data:** Metadata, kjøpstid, butikkposisjon.
- **Implementasjon:** Regelsett: `Software ∈ {…}`, `created > purchase + 1 d`, `distance(GPS, butikk) > 2 km`; samme `Make+Model+SerialNumber` for ≥ 3 brukere.
- **Eksempel:** PDF «Produced by Canva», opprettet 2 dager etter datoen på kvitteringen.
- **Falske positiver:** Middels: skannere og PDF-programmer legger inn programvarenavn.
- **Risiko · kjøring:** Høy · sanntid + varsel.

#### 25. Lokal redigering i bildet · Kritisk · sanntid + manuell kontroll · PORTAL ✕
- **Gjør:** ELA, dobbelkvantisering av JPEG og støyresidual, og glyph-konsistens i beløpsfeltet.
- **Finner:** Endrede sifre, innsatte linjer, kopiert og limt tall.
- **Data:** Bildepiksler, OCR-bokser.
- **Implementasjon:** ELA-forskjell > terskel lokalt rundt beløpsboks; DCT-histogramperiodisitet; sammenlign font-metrics (høyde, baseline, strekbredde) mellom sifre i samme felt; gi lokal score og vis varmekart.
- **Eksempel:** Ett «8» i totalen har annen kompresjonshistorikk og 1,3 px høyere baseline enn øvrige sifre.
- **Falske positiver:** Middels–Høy ved kraftig kompresjon og mobilkamera; krever menneskelig vurdering.
- **Risiko · kjøring:** Kritisk når utløst · sanntid + manuell kontroll.

#### 26. OCR-avstemming og forvekslingsbare tall · Høy · sanntid · PORTAL ✕
- **Gjør:** Kjører to OCR-motorer og sammenligner beløp, dato, org.nr, og tester om en vanlig forveksling gir et mer konsistent tall.
- **Finner:** Feilleste beløp (5/6/8, 1/7, 0/6, komma/punktum), og tilsiktet ulesbar tekst.
- **Data:** To OCR-resultater, confidence per tegn, linjesummer.
- **Implementasjon:** Ordvis edit-avstand på felt; ved avvik prøv forvekslingskart og velg tolkning som gir `linjer = total` og gyldig MVA. Confidence < 0,80 på beløp gir manuell kontroll.
- **Eksempel:** OCR leser 1 785,00; motor 2 leser 1 735,00; linjene summerer til 1 735,00.
- **Falske positiver:** Lav; i praksis forbedrer den datakvaliteten.
- **Risiko · kjøring:** Høy · sanntid.

#### 27. Syntetisk kvittering og mal-fingeravtrykk · Kritisk · sanntid + manuell kontroll · PORTAL ✕
- **Gjør:** Sammenligner bildets mal (layout, fonter, kolonnebredder, logo, linjeavstand) med leverandørens kjente maler og kjører en klassifikator for generert bilde.
- **Finner:** Kvitteringer laget i tegneprogram eller av bildegeneratorer, og kopier av kjente maler med endrede tall.
- **Data:** Bilder, leverandørmaler (samles over tid), klassifikatorskår.
- **Implementasjon:** Layoutembedding (f.eks. linjeposisjoner + fontfeatures) mot leverandørens klynge; avstand over terskel gir flagg. Gen-AI-klassifikator brukes bare som ett signal.
- **Eksempel:** «Kiwi»-kvittering med fonter og tegnavstand som aldri er sett hos Kiwi, perfekt støyfri bakgrunn.
- **Falske positiver:** Høy for nye maler og for skjermbilder av e-kvitteringer.
- **Risiko · kjøring:** Kritisk når utløst · sanntid + manuell kontroll.

#### 28. QR, kassasystemkode og signatur · Kritisk · sanntid · PORTAL ✕
- **Gjør:** Leser QR/strekkode/signatur på kvitteringen og verifiserer mot utsteder.
- **Finner:** Falske kvitteringer, endret total (payload ≠ OCR), gjenbrukte koder.
- **Data:** QR-payload, utstederens verifiseringstjeneste eller nøkkel.
- **Implementasjon:** Dekod, verifiser signatur, sammenlign payload (beløp, tid, org.nr) med OCR; gi negativ score (−10) ved verifisert, kritisk ved mismatch.
- **Eksempel:** QR sier 249,00; OCR/registrert beløp er 2 490,00.
- **Falske positiver:** Lav; mangler QR gir bare nøytral score.
- **Risiko · kjøring:** Kritisk ved mismatch · sanntid.

#### 29. Unicode-hygiene · Høy · sanntid · BEGGE ◐ (funn F2, F7)
- **Gjør:** Oppdager homoglyfer, skjulte tegn, blandet skript, NFC/NFD-forskjeller og RTL-overstyring i navn, ID-er og linjer.
- **Finner:** Forsøk på å omgå duplikat- og leverandørkontroll («Rеma» med kyrillisk е), og OCR-forurensning.
- **Data:** Alle tekstfelt.
- **Implementasjon:** Normaliser (NFKC + fjern kontrolltegn), lagre original og normalisert, flagg ved forskjell; skriptmiks per ord (Latin + Kyrillisk) og tegn i `​-‏‪-‮⁠﻿`.
- **Eksempel:** Leverandør «Rеma 1000» (kyrillisk е) vises ikke som duplikat av «Rema 1000».
- **Falske positiver:** Lav; tillat norske tegn og vanlige symboler.
- **Risiko · kjøring:** Høy · sanntid ved registrering.

### Prosess og kontroll

#### 30. Four-eyes- og delegasjonsbrudd · Kritisk · sanntid · PORTAL ✕
- **Gjør:** Kontrollerer at godkjenner er uavhengig av innsender.
- **Finner:** Selvgodkjenning, godkjenning av egen underordnede som også er godkjennerens vikar, delegering til samme krets, godkjenning med utløpt fullmakt.
- **Data:** Organisasjonskart, fullmakter, innsender, godkjenner.
- **Implementasjon:** Regler: `godkjenner ≠ innsender`, `godkjenner ∉ krets(innsender)` (leder, vikar, samme kostnadssted-eier for beløp over grense), fullmakt gyldig på tidspunkt.
- **Eksempel:** Avdelingsleder godkjenner utlegg fra sin egen vikar som godkjente hans forrige uke.
- **Falske positiver:** Lav–Middels; kan kreve unntak ved små team.
- **Risiko · kjøring:** Kritisk · sanntid (blokker).

#### 31. Rubber-stamp-profil per godkjenner · Høy · nattlig + dashboard · PORTAL ✕
- **Gjør:** Måler hvordan godkjenneren jobber.
- **Finner:** Godkjenning uten å åpne vedlegg, mange godkjenninger på sekunder, bulk, godkjenning ved høy risikoscore.
- **Data:** Visningslogg, tid fra åpning til godkjenning, risikoscore, beslutning.
- **Implementasjon:** Median visningstid; andel godkjent < 5 s; andel godkjent uten vedleggsvisning; andel godkjent i band `RRS ≥ 50`. Sammenlign med kollegaer.
- **Eksempel:** 61 % av godkjenningene på under 3 sekunder og 0 vedleggsvisninger.
- **Falske positiver:** Middels: godkjenner som har sett bildet i e-post.
- **Risiko · kjøring:** Høy · nattlig + dashboard.

#### 32. Utbetalingsintegritet · Kritisk · sanntid + nattlig · PORTAL ✕
- **Gjør:** Avstemmer godkjente utlegg mot utbetalingsfil og bankbevegelser, og vokter IBAN.
- **Finner:** Dobbel utbetaling ved retry, utbetaling uten godkjenning, endret IBAN rett før utbetaling, avvik mellom godkjent og utbetalt sum.
- **Data:** Godkjenninger, utbetalingsbatcher, bankfil, IBAN-historikk.
- **Implementasjon:** Idempotensnøkkel per utbetaling, unik indeks; `Σ godkjent = Σ utbetalt` per batch; IBAN endret < 7 d før utbetaling gir stopp og manuell kontroll (call-back).
- **Eksempel:** Samme utlegg betalt 2 ganger etter nettverksfeil i batch 2026-09-30.
- **Falske positiver:** Lav.
- **Risiko · kjøring:** Kritisk · sanntid på IBAN, nattlig på avstemming.

#### 33. Audit-logg-integritet · Kritisk · nattlig + varsel · PORTAL ◐ / plugin notater ✕
- **Gjør:** Kontrollerer at loggen er komplett og ikke endret.
- **Finner:** Slettede eller endrede rader, hull i logg-ID, tidsstempler i fremtiden eller før forrige rad, admin-endringer utenfor arbeidstid, direkte databaseendring.
- **Data:** Logg med hash-kjede, DB-endringslogg.
- **Implementasjon:** `hash_n = H(hash_{n-1} ‖ rad)`; nattlig verifisering; sekvens uten hull; alarm ved brudd. Rapportpakken i Kvitteringshenter har allerede SHA-256 over datasett og innhold; utvid til notater (F11).
- **Eksempel:** Rad 18 442 mangler; hash for rad 18 443 stemmer ikke med forrige.
- **Falske positiver:** Svært lav.
- **Risiko · kjøring:** Kritisk · nattlig + varsel.

#### 34. Kontroll-selvtest og regel-helse · Medium · nattlig + dashboard · BEGGE ○
- **Gjør:** Tester at kontrollene selv virker, og overvåker regelenes treffrate.
- **Finner:** Døde regler, plutselig fall i treff (kilden endret), regresjon etter endring, parser som slipper data.
- **Data:** Golden set med kjente avvik, treff per regel per dag.
- **Implementasjon:** Kjør golden set nattlig og krev 100 % gjenkjenning; canary-kvitteringer sendt gjennom pipelinen; alarm hvis treff faller > 70 % mot 4-ukers snitt, eller droppede linjer (F3) øker.
- **Eksempel:** Treff på «Kontant tilbake uten salg» går fra 12/dag til 0 etter endring i kvitteringsformat.
- **Falske positiver:** Lav.
- **Risiko · kjøring:** Medium · nattlig + dashboard.

#### 35. Honeypot-entiteter · Høy · sanntid + varsel · PORTAL ✕
- **Gjør:** Legger ut lokkemat som ingen skal bruke: fiktiv leverandør, kortnummer, kostnadssted, ansatt-ID, kvitteringsmal.
- **Finner:** Insider-misbruk, datalekkasje, automatisert utnyttelse av systemet.
- **Data:** Liste over honeypots.
- **Implementasjon:** Enhver registrering mot en honeypot gir umiddelbar høy score og varsel til sikkerhet; rotér jevnlig.
- **Eksempel:** Utlegg mot «Nordlys Kontor AS» som kun finnes i honeypot-listen.
- **Falske positiver:** Svært lav.
- **Risiko · kjøring:** Høy · sanntid + varsel.

#### 36. Kategori- og kostnadssted-integritet · Medium · nattlig · PORTAL ✕
- **Gjør:** Sammenligner valgt kategori og kostnadssted med det varelinjer, leverandør og MCC tilsier.
- **Finner:** Feil kategori for å slippe policy, delt kjøp på flere kostnadssteder, kostnadssted uten tilknytning til brukerens avdeling.
- **Data:** Kategori, MCC, linjer, kostnadssted, organisasjon.
- **Implementasjon:** Klassifisering fra linjer (nøkkelord/ML) mot valgt; mismatch med konfidens > 0,8 flagges. Samme kjøp splittet på ≥ 2 kostnadssteder uten sum = original.
- **Eksempel:** «Kontorrekvisita» med 11 av 13 linjer som alkohol.
- **Falske positiver:** Middels.
- **Risiko · kjøring:** Medium · nattlig analyse.

#### 37. Per-capita- og gjestetest · Medium · sanntid + manuell kontroll · PORTAL ✕
- **Gjør:** Beregner beløp per deltaker og sammenligner med policy og med kalender.
- **Finner:** Oppgitt antall deltakere som ikke stemmer, representasjon uten deltakerliste, samme deltakere på flere kvitteringer samme kveld.
- **Data:** Beløp, deltakere, kalender, policy.
- **Implementasjon:** `beløp / deltakere > grense`; deltakere ⊄ kalendermøte; overlapp på tvers av kvitteringer samme tid.
- **Eksempel:** 4 800 kr middag for «6 deltakere» der kalenderen viser 3.
- **Falske positiver:** Middels.
- **Risiko · kjøring:** Medium · sanntid + manuell kontroll.

#### 38. Korrelasjon mellom kassadifferanse, retur og rabatt · Høy · nattlig + dashboard · CW ○
- **Gjør:** Kombinerer flere små signaler per kasserer og kasse: kassadifferanse, returandel, rabatt uten årsak, kontant tilbake.
- **Finner:** Misbruk som ikke utløser noen enkeltregel, men som gir konsistent minus og uvanlig mønster over tid.
- **Data:** Kassaoppgjør, bonger, rabatt og retur (finnes i Kvitteringshenter).
- **Implementasjon:** Spearman-korrelasjon over uker mellom kasserers returandel og kassadifferanse; flagg `ρ < −0,5` (flere returer sammen med mer minus) og at begge ligger over peer-snitt. Vis som ett kassererfunn.
- **Eksempel:** Kasserer 4103: returandel 3× snitt og sum minus −170 kr over 3 oppgjør, ρ = −0,71 på 9 uker.
- **Falske positiver:** Middels: få observasjoner; krev ≥ 8 uker.
- **Risiko · kjøring:** Høy · nattlig + dashboard.

## 4. Samtidighet, rekkefølge og dataintegritet (PORTAL)

| Risiko | Hva går galt | Forebygging | Test |
|---|---|---|---|
| Dobbelt innsending | Samme utlegg lagres to ganger ved dobbeltklikk eller retry | Idempotensnøkkel per skjema, unik indeks (innholdshash, bruker, dato, beløp) | 50 parallelle POST med samme payload skal gi 1 rad |
| Godkjenn mot endre | Bruker endrer beløp etter at godkjenner trykket «godkjenn», men før lagring | `approved_hash` av innholdet, godkjenning feiler hvis hash endret | Endre og godkjenn samtidig; forvent avvisning |
| Godkjenn mot slett | Utlegg slettes mens utbetaling startes | Statusmaskin, radlås, soft delete med årsak | Slett og betal samtidig |
| Dobbel refusjon | To refusjoner mot samme kjøp | `Σ refusjon ≤ opprinnelig` under radlås/serializable | To refusjoner samtidig |
| Utdatert visning | Godkjenner ser gammel versjon | ETag og `If-Match` | Åpne to faner, endre i én, godkjenn i den andre |
| Rekkefølge | Hendelser registreres ute av rekkefølge | Serverside tidsstempel + sekvens, ikke klientklokke | Send med feil klientklokke |

## 5. Receipt Risk Score (RRS) 0–100

### Prinsipper

1. **Sannsynlighet og eksponering skilles.** RRS er sannsynlighet for at kvitteringen er feil eller misbrukt. Prioriteringskø = `RRS/100 × beløp` (forventet tap).
2. **Signaler grupperes, hver gruppe har tak.** Det hindrer at samme årsak telles flere ganger (eksempel: bildehash og identisk beløp er begge «duplikat»).
3. **Grupper kombineres med noisy-OR.** `RRS = 100 × (1 − Π(1 − g_j/100))`. Gir naturlig metning under 100, og flere uavhengige gruppesignaler løfter scoren mer enn flere signaler i samme gruppe.
4. **Hvert signal har konfidens 0–1.** Poeng = vekt × konfidens (OCR-confidence, likhetsmål, krymping for få observasjoner).
5. **Hardstopp.** Bekreftet duplikat med utbetaling, honeypot-treff, brudd i hash-kjeden og QR-mismatch gir minimum 90.
6. **Negative signaler.** Verifisert QR/signatur, ren historikk og forhåndsgodkjent leverandør trekkes fra sluttscoren (maks −15 samlet, aldri under 0). Hardstopp trekkes ikke ned.
7. **Forklarbar.** Hver score viser de fem største bidragene med kode, verdi og terskel.
8. **Kalibreres.** Mot bekreftede utfall (isotonisk eller Platt), mål precision@k og kapasitet (f.eks. 2 % manuell kontroll).

### Grupper og tak

| Gruppe | Tak | Signaler |
|---|---|---|
| Duplikat | 45 | bilde, fingeravtrykk, flere brukere, kortref |
| Beløp og regnskap | 35 | MVA, linjeregnskap, OCR-endring, avrunding, valuta |
| Tid, sted, bruker | 30 | registreringsforsinkelse, uvanlig tid, umulig reise, fravær, geografi |
| Beløpsstruktur | 25 | rett under grense, oppsplitting, kumulativ ramme, prisavvik |
| Bilde og OCR | 40 | metadata, redigering, syntetisk, OCR-confidence, mal |
| Prosess | 25 | godkjenner-profil, four-eyes, endring etter godkjenning |
| Atferd og nettverk | 25 | peer-avvik, rytme, graf, leverandør ny/ugyldig |

### Signalpoeng (utkast, fullført fra eksempelet)

| Poeng | Signal |
|---|---|
| +25 | Nesten identisk bilde (pHash ≤ 6 bit eller SSIM ≥ 0,95) med tidligere kvittering |
| +20 | Samme beløp og butikk innen 24 t (+5 hvis annen bruker) |
| +15 | Samme kortreferanse eller siste 4 + beløp ±1 kr, annen bruker |
| +15 | Beløp endret mellom OCR og godkjenning (> 1 % eller > 50 kr) |
| +12 | Total ≠ netto + MVA (> 1 kr) |
| +12 | Linjer + avrunding ≠ total (> 0,05 kr) |
| +10 | Registrert > 30 dager etter, eller før, kjøpstid |
| +10 | Beløp 90–99,9 % av grensen, ≥ 3 siste 30 d |
| +10 | Metadata: Photoshop/Canva eller opprettet etter kjøp |
| +10 | Ugyldig eller avviklet org.nr |
| +8 | OCR-confidence < 0,80 på beløpsfelt |
| +8 | Uvanlig tid (natt, helligdag) uten vakt |
| +8 | Medlemsnr/kort delt av flere brukere |
| +6 | Peer-avvik (z > 3 etter krymping) |
| +5 | Godkjent av godkjenner med høy rubber-stamp-profil |
| −10 | Verifisert QR/signatur |
| −5 | Ren historikk siste 12 mnd |
| −5 | Forhåndsgodkjent leverandør og beløp under vanlig |

### Regneeksempel

Signaler: bilde (+25) og samme beløp/butikk (+20) → Duplikat 45 (tak 45). Total ≠ netto + MVA (+12) og OCR-endring (+15) → Beløp 27. Registrert 40 dager etter (+10) → Tid 10. Godkjenner med rubber-stamp (+5) → Prosess 5.

`RRS = 100 × (1 − 0,55 × 0,73 × 0,90 × 0,95) = 100 × (1 − 0,3433) = 66`

Nivå **Høy** (50–74): manuell kontroll før utbetaling. Med verifisert QR (−10) ville scoren blitt 56, fortsatt Høy.

### Nivåer og handling

| RRS | Nivå | Handling |
|---|---|---|
| 0–24 | Lav | Automatisk, inngår i stikkprøve (2 %) |
| 25–49 | Medium | Godkjenner ser forklaringen; stikkprøve 20 % |
| 50–74 | Høy | Manuell kontroll før utbetaling |
| 75–100 | Kritisk | Stopp utbetaling, varsel til revisjon, lås kvitteringen |

### Mapping til dagens Kvitteringshenter

Plugin bruker poengsum (summerte vekter; høy ≥ 8, middels ≥ 4). Den kan vises på 0–100 uten å endre vekter: `RRS = 100 × (1 − 2^(−poeng/8))`. Dette gir 4 poeng = 29, 8 = 50, 16 = 75. Det samsvarer med dagens nivåer (middels ≥ 25, høy ≥ 50) og kan innføres som visning først, uten å endre testene.

## 6. Anbefalt rekkefølge for Kvitteringshenter

Kan bygges nå, uten API (grid + iframe):

1. **Rettinger fra kapittel 1:** F1 (CSV-injeksjon), F2 (tegn og normalisering), F3 (beløpsparser), F10 (verifiser løpenummer mot valgt rad), F4 (grenser på størrelse), F6, F7, F8, F9.
2. **Linjeregnskap (idé 10)** og parsing av `Referanse`/`TransId` (kortreferanse, grunnlag for idé 18 og dobbel kortbetaling).
3. **MVA-tabell** (sats og sum) og `Øreavrunding`.
4. **Notatlogg (F11)** som append-only og med i rapportens kontrollsum.
5. **RRS 0–100 som visning**, og peer-krymping (idé 20) i kassererprofilen.
6. **Siffer-preferanse (7), regresjon nummer mot tid (5), korrelasjonsfunn (38).**

Krever data vi ikke har (portal, bilder, OCR, HR, godkjenning): idé 1–4, 6, 9, 14–17, 23–37. Disse hører til en portal med slike data og er beskrevet slik at de kan bygges der.

## 7. Status (2026-10-03)

Bygget i versjon 3.12.0, med tester (`logic.test.js`, `report.test.js`, `skann.js`, `regnskap.js`, `smoke.js`).

| Funn / punkt | Status |
|---|---|
| F1 CSV-injeksjon | Rettet (`toCsv`) |
| F2 skjulte tegn og normalisering | Rettet (NFC, fjerner skjulte tegn og NBSP i all bongtekst) |
| F3 beløpsparser | Rettet (U+2212, parentes, etterstilt minus, tusenskille) |
| F4 størrelsesgrenser | Rettet (500 linjer, 80 tegn, 20 betalingsmåter, byte-tak 25 MB / 10 000 bonger) |
| F5 sommertid | Ikke rettet |
| F6 datovalidering | Rettet |
| F7 medlemsnr | Rettet (`normMember`) |
| F8 0 kr-duplikat | Rettet |
| F9 NaN/Infinity i sum | Rettet |
| F10 skannerace | Rettet: løpenummer i topptekst mot valgt rad, ett nytt forsøk, deretter feilet. Aktiveres etter tre treff |
| F11 notater uten historikk | Rettet: append-only notatlogg med hash-kjede, med i rapporten |
| F12 innstillingsstrenger | Rettet (200 tegn) |
| F13 «Tøm cache» uten bekreftelse, «viser N av M» | Ikke rettet |
| Idé 10 linjeregnskap + betaling | Bygget (kalibrerende) |
| MVA-tabell, Øreavrunding, Referanse/TransId | Bygget (parser v5, MVA-kontroll, dobbel referanse) |
| RRS 0–100 som visning | Bygget |
| Idé 20 krymping i kassererprofil | Bygget (k = 10) |
| Idé 7 siste siffer, idé 5 løpenummer mot tid, idé 38 retur mot kassadifferanse | Bygget |

Fortsatt ikke bygget: F5, F13 og idéene som krever bilder, OCR, HR-data eller godkjenningsflyt.

## 8. Ønskeliste fra butikk (versjon 3.14.0)

| Ønske | Status |
|---|---|
| `99 PANTELAPP` manuell, `399 PANTELAPP` maskin | Bygget: egne tellere per kasserer, test på manuell pantelapp og kasserer med høy andel manuell |
| Pantelapp som blir slettet | Bygget: linje og motlinje med samme beløp på samme bong. Forutsetter at CW viser slettingen som motlinje |
| Pantelapp brukt igjen, samme sum | Bygget: samme sum innen 60 min på ulike bonger, eller samme lappnummer hvis bongen viser det. Indikasjon, ikke bevis |
| Kontant tilbake etter at varelinjer er slettet | Bygget: «Kontant tilbake uten salg» bruker varelinjer etter sletting, og nytt funn «Varelinjer slettet, pant utbetalt kontant» |
| Eget forbruk, internt forbruk, utbetaling, finansiering, sjekk (må søkes på) | Bygget som søk under Skann og som test. Leter i betalingsmåter, linjenavn og tekstlinjer. Hvis CW viser dem som egen kvitteringstype (som kassaoppgjør), må de søkes på i Hent |
| Rabatt med årsakskode | Fantes fra før (filter og overvåking per årsak) |
| Rabattovervåking mellom 70 og 100 % (innstilling) | Bygget: «Høy rabattprosent» |
| Rabatt (for eksempel 40 %) som ikke matcher andre varer, samme dag og over tid | Bygget: søk på rabatt-% under Skann, og «Rabatt uten treff på andre salg» |
| Spør pris og EAN mot dagens salg | Bygget: sammenligner med medianpris for samme EAN samme dag. Formatet på bongen er ikke bekreftet |
| EAN makulert fra bong: solgt innen 2 timer (innstilling) | Bygget: «Makulert vare ikke solgt på ny», 120 min som standard |
| Gjentatte returer på kort (kortnr og leverandør) | Bygget, krever skanning versjon 6. Formatet på kortlinjen er ikke bekreftet |
| Manuell kvittering mot andre kvitteringer og til gode-lapp | Bygget, ordbasert. Ordene er ikke bekreftet |
| Mange rabatter tyder på sentral kampanje | Bygget: kampanjevare og kampanjedag undertrykker rabattflagg |

Felles forbehold: slettede linjer, «spør pris», kortlinje, manuell kvittering og spesialbetaling er ikke sett i ekte data. Testene er skrevet etter beste gjetning om hvordan de står på bongen, og kan gi falske positive. Diagnostikk samler linjer pluginen ikke kjenner igjen, slik at ordlistene kan tilpasses.

## 9. Dobbelttelling fjernet (versjon 3.15.0)

Kontroll mot alle 237 demobonger viste at samme forhold ofte ga poeng flere ganger. Rettet slik:

| Dobbelt opp | Tiltak |
|---|---|
| Pant og kontant tilbake (stor panteretur, mange pantelapper, kontant tilbake uten salg, flere ganger, varelinjer slettet) | Én gruppe: bare høyeste poeng teller |
| Rabatt (uten årsak, overvåket årsak, høy prosent, uten treff) | Én gruppe |
| Linjer, betaling, MVA og ugyldig sats | Én gruppe |
| Avvikende pris og spør pris | Én gruppe |
| Kassadifferanse og gjentatte kassadifferanser | Én gruppe |
| Samme pantebeløp utbetalt flere ganger og pantelapp innløst flere ganger | Slått sammen til én test (gammel test og innstilling `pantRepeatN` fjernet) |
| Avvikende pris og spør pris på samme linje | Prisavviks-testen hopper over spør pris-linjer |
| Hendelsesord og spør pris / manuell kvittering | Hendelsesord utelater «manuell» og «spør pris» på bonger som egne tester allerede har flagget |
| Felles kode og knapper | Én `isEan` og `unitPrice`, én Diagnostikk-knapp, én «Skann på nytt», kupongtabellen heter «Kuponger» |

Overlapp med ulike signaler er beholdt (for eksempel medlemsnr flere ganger samme dag og nesten bare hos én kasserer).

## 10. Sentral kampanje: notat og spørsmål (versjon 3.18.0)

| Punkt | Tiltak |
|---|---|
| Rabatt uten årsak kan skyldes sentral kampanje | Samme vare og rabatt hos minst 2 kasserere på minst 3 bonger (alle dager og butikker) gir notat «Kan være sentral kampanje». Bongen tas fortsatt med |
| Brukeren avgjør | Ja/Nei/Angre i Sjekk først, Rabatt-kortet og en dialog. Ja: ikke flagget og ikke talt mot kassereren. Nei: flagges som vanlig |
| Gammel regel kunne skjule feil | Den fjernet rabatten fra flagg når 10 bonger samme dag og butikk delte vare og prosent, også hos én kasserer. Erstattet av regelen over, som krever flere kasserere og aldri skjuler uten svar |
| Etterprøvbarhet | Svarene lagres, eksporteres og står i revisjonsrapporten |

Ikke gjort: kobling mellom kupongnavn og varenavn på bongen. Det trenger en ekte bong der kampanjerabatt og kupong står sammen.
