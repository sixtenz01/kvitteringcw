# Kvitteringshenter – reklame (HTML, CSS og JavaScript)

Åpne `index.html` direkte i nettleseren. Ingen bygging, ingen eksterne biblioteker. Reklamen er ca. 40 sekunder, starter av seg selv og kan spilles, spoles og restartes.

| Fil | Innhold |
|---|---|
| `index.html` | Skall: scene-flate (1920×1080, skaleres til vinduet), start- og sluttknapper, demo, utviklerlinje |
| `style.css` | Visuell identitet (Coop-lignende grønn på mørk bakgrunn), panel, kort, diagrammer |
| `script.js` | Tidslinjemotor, 14 scener, komponenter, interaktiv demo, lyd-bus |
| `inter.woff2` | Skrift (Inter, SIL OFL) |
| `render-frames.js`, `lyd-reklame.py` | Valgfritt: opptak til MP4 (bilde for bilde) og lydspor |

## Hvordan det virker

- **Scene-system.** `scene(id, varighet, (root) => ({ update(lt) }), cues)`. Hver scene bygger DOM ved start, tegner seg som en ren funksjon av lokal tid (`update(lt)`) og fjernes når den er ferdig. Det finnes ingen `setTimeout`-kjeder.
- **Motor.** `Engine` eier den globale tiden, spiller med `requestAnimationFrame`, og kan `seek(t)`, `pause()`, `restart()` og hoppe mellom scener. Scenene overlapper 0,3 s, og hver har en tempofaktor (`PACE`).
- **Bevegelse.** Kun `transform`, `opacity`, `filter` og `clip-path`, ellers canvas for datastrøm og prikkfelt. Ingen layout-animasjon.
- **Deterministisk.** Tilfeldighet er seedet, så hver visning og hvert opptak blir likt.
- **Hjelpefunksjoner** (som i manus): `animateCounter`, `typeText`, `generateTransactions`, `highlightAnomaly`, `animateRiskScore`, `showReceipt`, `createChart`, `reveal` (tekst inn/ut).

## Kontroller

| | |
|---|---|
| Mellomrom | pause / fortsett |
| `R` | start på nytt |
| `[` `]` eller `1`–`9`, `0` | forrige / neste scene, hopp til scene |
| `←` `→` | spol ±2 s |
| `?dev` i adressen | spolebar og scenelinje |
| `#t=12.5` i adressen | start på 12,5 s |
| Etter reklamen | «Spill igjen» og «Utforsk demo» (Hent, Filtrer, Skann, Analyse, Rapport) |

Stående mobil: flaten dreies 90° slik at 16:9-reklamen fyller skjermen. Med `prefers-reduced-motion` starter ikke reklamen av seg selv, datastrømmen står stille og uskarphet er slått av.

## Lyd

Ingen lyd er påkrevd. Scenene sender hendelser: `scan-tick`, `count-tick`, `analysis-start`, `risk-detection`, `scene-transition`, `click`, `report-complete`. Koble på egne lyder:

```js
KH.onSound((navn, data) => { /* spill av lyd */ });
```

Knappen «Lyd» nede til høyre slår på en enkel innebygd syntetisk lyd. `KH.cues()` gir alle hendelser med tidspunkt.

## Opptak til video

```bash
node render-frames.js --cues cues.json                  # lyd-hendelser og varighet
node render-frames.js bilder 60 0 2385                  # bilde 0–2385 ved 60 b/s (kan deles på flere prosesser)
python3 lyd-reklame.py cues.json lyd.wav
ffmpeg -framerate 60 -i bilder/%05d.png -i lyd.wav -c:v libx264 -crf 19 -pix_fmt yuv420p -c:a aac -shortest reklame.mp4
```

(`render-frames.js` bruker Playwright. Siden åpnes med `?render`, og `__render(t)` tegner tidspunkt `t`.)

## Innhold og forbehold

All data er fiktiv (bonger, kasserere, beløp). Risikoscore og RRS bruker samme formel som produktet: `RRS = 100 · (1 − 2^(−poeng/8))`. Funn vises som indikasjoner som må vurderes og forklares, og reklamen sier det til slutt.
