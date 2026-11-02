---
source: gm/tv-table-viewer.md
sourceHash: 50779223cd7d
title: Tv'et ved bordet
description: Vis kortet på et tv ved en session, hvor I sidder i samme rum. Tv'et logger ind én gang som en spiller ved navn Table og bliver logget ind.
---

# Tv'et ved bordet

Til en session, hvor alle sidder i samme rum: et tv (eller en ekstra skærm) viser kortet for hele
bordet. Det kommer ind i spillet som sin egen spiller ved navn **Table**. Den er ikke GM og ejer ingen
karakterer. Den ser den scene, du viser, og skjulte ting virker som for enhver anden spiller. Intet fra
dashboardet eller dine noter er på den.

Du sætter det op én gang. Derefter åbner tv'et på kortet af sig selv, også efter en genstart.

**Hvad du skal bruge:** en Windows-pc ved tv'et med PowerShell 7 (`pwsh`), Edge eller Chrome og en kopi
af værktøjets mappe (den indeholder filerne i `scripts\tv`). Bed tool-adminen sætte det op.

## Én gang: lav Table-spilleren

1. Åbn Claude med **Admin**-tools slået til (**+** i chatfeltet, **Connectors**, slå **foundry-mcp-admin** til).
2. Spørg: "Plan a Table user for the TV." Claude viser en plan: én ny spiller ved navn Table, ingen
   adgangskode.
3. Læs den og bekræft den. Den står i **Recent Changes**, med en **Undo**, hvis du fortryder.

Hvis der allerede findes en bruger ved navn Table (en spiller eller en GM), eller Claude ikke kan læse
brugerlisten, siger den det og planlægger ingenting. Table-spilleren er markeret som tv'et, så handout-kvitteringerne, spillertallet og sessionens fremmøde
udelader den. (En Table-spiller lavet med en ældre version er ikke markeret: fortryd dens plan i Recent Changes og planlæg den igen, ellers bliver den ved med at blive talt med.)

**Hvis kortet er mørkt på tv'et:** på en scene med token vision slået til ser en spiller kun det, som hendes
egne karakterer kan se, og Table har ingen. Giv Table samme udsyn som partyet: bed Claude
"Give Table Observer on the party characters." (Claude planlægger det med ownership-tool'et, du
bekræfter.) Tjek det én gang på dit rigtige kort før sessionen, med tv'et forbundet.

## Én gang: log tv'et ind

Du skal bruge et tastatur på tv'ets computer, men kun til dette trin. Bed først tool-adminen om tv'ets
e-mailadresse: koden, der beviser "det her er tv'et", bliver sendt dertil.

1. På tv'ets computer åbner du PowerShell i værktøjets mappe og kører (brug spillets adresse):

   ```powershell
   pwsh scripts\tv\start-table-viewer.ps1 -Url https://your-game-address -Setup
   ```

2. Et almindeligt browservindue åbner. Skriv tv'ets e-mailadresse og derefter koden, der kommer dertil.
3. Foundrys join-side følger, og scriptet kommer ind som **Table** for dig. Kortet dukker op.
4. Luk vinduet.

## Hver gang bagefter

Kør den samme linje uden `-Setup`:

```powershell
pwsh scripts\tv\start-table-viewer.ps1 -Url https://your-game-address
```

Browseren åbner i fuld skærm på kortet. Foundrys eget login varer kun 24 timer, så på en
ny dag ser scriptet Foundrys join-side og kommer ind som Table igen af sig selv. Det gør det kun
på dit spils join-side, aldrig på en anden side. Lad scriptets vindue stå åbent (det må gerne være
minimeret). Lukker du tv'ets browser, stopper scriptet. For at få alt det til at ske, når tv'ets computer
starter, lægger du en genvej i Windows' Startup-mappe (tryk **Win + R**, skriv `shell:startup`)
med dette mål: `pwsh -NoExit -WindowStyle Minimized -File "C:\full\path\to\scripts\tv\start-table-viewer.ps1" -Url https://your-game-address`.
`-NoExit` holder vinduet åbent efter en advarsel, så du kan læse den. Hvis der står, at tv-browseren
allerede kører, så luk den browser (for eksempel vinduet fra opsætningstrinnet) og kør
scriptet igen.

Hvis dit spil ligger bag en reverse proxy på en understi, for eksempel `https://host/foundry`, så giv den
adresse (`-Url https://host/foundry`). Scriptet leder så efter join-siden på
`https://host/foundry/join`.

Mens tv'et kører, åbner browseren en kontrolport, som kun denne computer kan nå. Alle,
der er logget ind på denne Windows-konto, kan bruge den, så brug en tv-pc, som kun bordet bruger.

E-mailkoden fra Cloudflare bliver først spurgt om igen, når Access-sessionen slutter (uger).
Når tv'et viser Cloudflares loginside, gør du "log tv'et ind" ovenfor en gang til.

## Under sessionen

- Vis spillerne den scene, du vil have på tv'et, med **Activate** på den scene. Tv'et følger
  den aktive scene.
- For at forlade fuld skærm trykker du **Alt + F4** på tv'ets tastatur.

## Hvad tv'et aldrig kan vise

- Dashboardet, dine noter, GM'ens chat eller en GM-side. Table-spilleren er en
  almindelig spiller og kan ikke åbne dem.
- Alt, der er skjult på kortet. Vil du ikke have, at bordet ser noget, så hold det skjult i
  Foundry, som du ville for enhver anden spiller.

For at tage tv'et ud af spillet sletter du Table-spilleren i Foundry (**Esc**, **User Management**)
eller beder Claude fortryde planen i Recent Changes, og sletter tv'ets profilmappe
(`%LOCALAPPDATA%\FoundryAiTool\table-viewer-profile`).
