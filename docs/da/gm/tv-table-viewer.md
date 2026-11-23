---
source: gm/tv-table-viewer.md
sourceHash: 2a89447e0438
title: TV'et ved bordet
description: Vis kortet på et tv ved en session, hvor I sidder i samme rum. Tv'et logger ind én gang som en spiller ved navn Table og bliver logget ind.
---

# TV'et ved bordet

Til en session, hvor alle sidder i samme rum: et tv (eller en ekstra skærm) viser kortet for hele
bordet. Det kommer ind i spillet som sin egen spiller ved navn **Table**. Den er ikke GM og ejer ingen
karakterer. Den ser den scene, du viser, og skjulte ting virker som for enhver anden spiller. Intet fra
dashboardet eller dine noter er på den.

Du sætter det op én gang. Derefter åbner tv'et på kortet af sig selv, også efter en genstart.

**Hvad du skal bruge:** en Windows-PC ved tv'et med PowerShell 7 (`pwsh`), Edge eller Chrome og en kopi
af værktøjets mappe (den indeholder filerne i `scripts\tv`). Bed værktøjets administrator sætte det op.

## Én gang

At lave Table-spilleren og logge tv'et ind står på sin egen side: [Engangsopsætning: tv'et ved
bordet](setup-tv-table.md). Rettelserne til et mørkt kort og til Cloudflares loginside står også dér.

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

E-mailkoden fra Cloudflare bliver først bedt om igen, når Access-sessionen slutter (uger).
Når tv'et viser Cloudflares loginside, gør du login-trinnet på [opsætningssiden](setup-tv-table.md) en gang til.

> **Usikker? Spørg Claude.** Spørg GM coach: "Hvordan får jeg tv'et til at åbne på kortet af sig selv, når dets PC starter?" ([sådan tilføjer du GM coach](gm-coach.md))

## Under sessionen

- Vis spillerne den scene, du vil have på tv'et, med **Activate** på den scene. Tv'et følger
  den aktive scene.
- For at forlade fuld skærm trykker du **Alt + F4** på tv'ets tastatur.

## Blink ved natural 20 og natural 1

Når en natural 20 eller en natural 1 lander på et attack eller et saving throw, blinker tv'et i 2
sekunder med **CRITICAL!** (guld) eller **FUMBLE!** (rød) og figurens navn. Det vises kun på tv'et,
højst én gang hvert 20. sekund, og aldrig for et hvisket eller blindt slag. I Foundrys
modulindstillinger kan **Table TV stingers** slå det fra eller begrænse det til natural 20.

## Hvad tv'et aldrig kan vise

- Dashboardet, dine noter, GM'ens chat eller en GM-side. Table-spilleren er en
  almindelig spiller og kan ikke åbne dem.
- Alt, der er skjult på kortet. Vil du ikke have, at bordet ser noget, så hold det skjult i
  Foundry, som du ville for enhver anden spiller.

For at tage tv'et ud af spillet sletter du Table-spilleren i Foundry (**Esc**, **User Management**)
eller beder Claude fortryde planen i Recent Changes, og sletter tv'ets profilmappe
(`%LOCALAPPDATA%\FoundryAiTool\table-viewer-profile`).

> **Usikker? Spørg Claude.** Spørg GM coach: "Hvordan sikrer jeg, at spillerne ved bordet ikke kan se noget på tv'et, de ikke må?"
