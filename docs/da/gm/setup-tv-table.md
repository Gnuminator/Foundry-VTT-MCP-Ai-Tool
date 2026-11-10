---
source: gm/setup-tv-table.md
sourceHash: 6863fb4ff443
title: "Engangsopsætning: tv'et ved bordet"
description: Lav Table-spilleren og log tv'ets computer ind, én gang. Kun til sessioner, hvor I sidder i samme rum.
---

# Engangsopsætning: tv'et ved bordet

Kun hvis I spiller i samme rum og vil have kortet på et tv. Tv'et kommer ind i spillet som sin egen
spiller ved navn **Table**. Efter opsætningen åbner det på kortet af sig selv. Hvordan det opfører sig under
spillet, står i [TV'et ved bordet](tv-table-viewer.md). Cirka 15 minutter, én gang.

**Du skal bruge:** en Windows-pc ved tv'et med PowerShell 7 (`pwsh`), Edge eller Chrome og en kopi af
værktøjets mappe (den indeholder `scripts\tv`), et tastatur på den pc, spillets adresse og den e-mailadresse,
Cloudflare bruger til tv'et. Værktøjets admin sætter pc'en og mappen op.

## 1. Lav Table-spilleren

1. Klik på **+** i chatfeltet i Claude Desktop, **Connectors**, og slå **foundry-mcp-admin** til.
2. Spørg: _Plan a Table user for the TV._ Claude viser en plan: én ny spiller ved navn Table, uden password.
3. Læs den, og bekræft så. Den står i **Recent Changes** med en **Undo**.

## 2. Log tv'et ind

1. På tv'ets computer åbn PowerShell i værktøjets mappe og kør (brug spillets adresse):

   ```powershell
   pwsh scripts\tv\start-table-viewer.ps1 -Url https://your-game-address -Setup
   ```

2. Et browservindue åbner. Skriv tv'ets e-mailadresse og derefter koden, der kommer dér.
3. Foundrys join-side følger, og scriptet går ind som **Table** for dig. Kortet vises.
4. Luk vinduet.

## Færdig, når det ser sådan ud

Kør den samme linje uden `-Setup`. Browseren åbner i fuld skærm på kortet. Når du klikker på **Activate** på
en scene i Foundry, følger tv'et med. Tryk **Alt + F4** for at forlade fuld skærm.

## Hvis det ikke virker

- **Claude siger, at en bruger ved navn Table allerede findes, eller at den ikke kan læse brugerne:** den
  planlægger intet. Slet den gamle Table i Foundry (**Esc**, **User Management**) eller spørg den, der
  byggede værktøjet.
- **Kortet er mørkt på tv'et:** Table ejer ingen karakterer, så token vision viser intet. Bed Claude om
  _Give Table Observer on the party characters_ og bekræft planen.
- **Tv'et viser Cloudflares login-side:** gør trin 2 igen.
- **"The TV browser is already running":** luk den browser (for eksempel opsætningsvinduet) og kør linjen
  igen.
