---
source: gm/before-session-quest.md
sourceHash: cc94433bdcff
title: 'Quest: før en session'
description: De 15 minutter før spil som en kort quest, fire trin med tider, der slutter, når sessionsloggen kører.
---

# Quest: før en session

Det her er [Før hver session](before-session.md) som en liste, du kan sætte flueben ved, cirka 15
minutter før spillerne kommer. Tjeklistesiden har alle trinene og løsningerne; her får du rækkefølgen
og tiderne. De sjældne tilfælde bliver på tjeklistesiden: den mailede loginkode, Dice So Nices
tematiske terninger (én gang, før session 1) og skabningsnavne på tokens, der allerede ligger på
kortet.

:::note
Der er intet at starte på en PC og ingen terminal at åbne: dashboardet kører på bordets hjemmeserver.
Du skal bruge spillets adresse og dashboardets adresse fra værktøjets administrator.
:::

**Fremdrift:** fire trin, der slutter med, at sessionsloggen kører.

## Trin 1 af 4: Start det hele (4 minutter)

- [ ] Start **Claude Desktop**.
- [ ] Åbn Foundry i din browser, start verdenen og log ind som din GM-bruger.
- [ ] Åbn dashboardets adresse på din anden skærm.
- [ ] Se på headeren: **✈ Pre-flight** siger "ready" eller "N to fix", og der vises intet
      "Connection lost"-mærke.

**Du er færdig, når** headeren ser rolig ud. Hvis den ikke gør det, så se [Fejlfinding](troubleshooting.md).

## Trin 2 af 4: Pre-flight og kontakter (3 minutter)

- [ ] Klik på **✈ Pre-flight**. Ret alt, der er markeret med ✗, og se på hver **!**.
- [ ] Klik på **Turn on for tonight** i Pre-flight-panelet.
- [ ] Tjek, at [GM-vinduerne](gm-windows.md) er slået til: fanen **Settings**, **Game Settings**,
      kategorien **Foundry AI Tool**, **AI Tool: GM windows** har flueben.

**Du er færdig, når** chipsene under knappen viser kontakterne som slået til.

:::tip
**End session** slår det fra igen, som **Turn on for tonight** slog til, så du ikke behøver at
huske det bagefter.
:::

## Trin 3 af 4: Hvad spillerne kommer til at se (6 minutter)

- [ ] Scenen, du starter på, har et **Navigation Name**, hvis dens rigtige navn er en spoiler.
- [ ] Skabninger, spillerne allerede kender, har **Display Name** sat til **Hovered by Anyone**.
- [ ] Tokens, spillerne ikke skal vide om, er skjulte.
- [ ] Åbn spillersiden i en ny fane (dashboardets adresse med `/player` til sidst), og tjek, at
      der ikke står noget hemmeligt.
- [ ] Hver side i din handouts-journal står på **None**, medmindre du har vist den.
- [ ] I Tarokka-skuffen er **Show cards** ikke sat flueben ved.

**Du er færdig, når** spillersiden ikke viser noget, du vil holde tilbage.

## Trin 4 af 4: Forbered og begynd (2 minutter)

- [ ] Kør prompten `prep-next-session` i Claude Desktop.
- [ ] Læs sidste sessions note i Obsidian.
- [ ] Læg Claude Desktop, dashboardet og Obsidian på den skærm, spillerne ikke kan se, og del
      aldrig de vinduer i Discord eller et videoopkald.
- [ ] Når spillet begynder, så klik på **Start session** i dashboardets header, eller på **Start
      the session log** i Pre-flight-panelet.

**Du er færdig, når** headeren siger "Session since" og klokkeslættet.

## Questen er klaret

Spil. Hold [runbooken til spilaftenen](game-night-runbook.md) åben. Bagefter: [efter hver
session](after-session.md).
