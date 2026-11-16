---
source: gm/before-session-quest.md
sourceHash: e9fa1dff2a2c
title: 'Quest: før en session'
description: De 15 minutter før spil som en kort quest, fire trin med tider, der slutter, når sessionsloggen kører.
---

# Quest: før en session

Det her er [Før hver session](before-session.md) som en liste, du kan sætte flueben ved, cirka 15
minutter før spillerne kommer. Hvert trin linker til sin del af tjeklistesiden, som har den fulde
ordlyd og løsningerne; her får du rækkefølgen og tiderne. De sjældne tilfælde bliver på
tjeklistesiden: den mailede loginkode, Dice So Nices tematiske terninger (én gang, før session 1) og
skabningsnavne på tokens, der allerede ligger på kortet.

:::note
Der er intet at starte på en PC og ingen terminal at åbne: dashboardet kører på bordets hjemmeserver.
Du skal bruge spillets adresse og dashboardets adresse fra værktøjets administrator.
:::

**Fremdrift:** fire trin, der slutter med, at sessionsloggen kører.

## Trin 1 af 4: Start det hele (4 minutter)

Se tjeklisten: [Start det hele](before-session.md#start-det-hele).

- [ ] Claude Desktop kører.
- [ ] Foundry er åben, verdenen er startet, og du er inde som GM.
- [ ] Dashboardet er åbent på din anden skærm.
- [ ] Headeren ser rolig ud: **✈ Pre-flight** viser "ready" eller et antal at rette, og der er intet
      "Connection lost"-mærke.

**Du er færdig, når** headeren ser rolig ud. Hvis den ikke gør det, så se [Fejlfinding](troubleshooting.md).

## Trin 2 af 4: Pre-flight og kontakter (3 minutter)

Se tjeklisten: [Kør pre-flight-tjekket](before-session.md#kør-pre-flight-tjekket) og
[Slå til, hvad aftenen kræver](before-session.md#slå-til-hvad-aftenen-kræver).

- [ ] Klik på **✈ Pre-flight**. Ret alt, der er markeret med ✗, og se på hver **!**.
- [ ] Klik på **Turn on for tonight**.
- [ ] Indstillingen for [GM-vinduerne](gm-windows.md) er slået til.

**Du er færdig, når** chipsene under knappen viser kontakterne som slået til.

:::tip
**End session** slår kontakterne fra igen, så du ikke behøver at huske det bagefter.
:::

## Trin 3 af 4: Hvad spillerne kommer til at se (6 minutter)

Se tjeklisten: [Tjek, hvad spillerne kommer til at se](before-session.md#tjek-hvad-spillerne-kommer-til-at-se).

- [ ] Startscenen har et **Navigation Name**, når dens rigtige navn ville afsløre noget.
- [ ] Skabninger, spillerne allerede kender, har **Display Name** sat til **Hovered by Anyone**.
- [ ] Tokens, spillerne ikke skal vide om, er skjulte.
- [ ] Spillersiden (dashboardets adresse plus `/player`, i en ny fane) viser intet, der er
      hemmeligt.
- [ ] Hver side i din handouts-journal står på **None**, medmindre du har vist den.
- [ ] I Tarokka-skuffen er **Show cards** ikke sat flueben ved.

**Du er færdig, når** spillersiden ikke viser noget, du vil holde tilbage.

## Trin 4 af 4: Forbered og begynd (2 minutter)

Se tjeklisten: [Forbered](before-session.md#forbered) og [Når spillet begynder](before-session.md#når-spillet-begynder).

- [ ] Kør prompten `prep-next-session` i Claude Desktop.
- [ ] Læs sidste sessions note i Obsidian.
- [ ] Claude Desktop, dashboardet og Obsidian ligger på den skærm, spillerne ikke kan se, og deles aldrig i Discord eller et videoopkald.
- [ ] Når spillet begynder, så start sessionsloggen fra dashboardets header.

**Du er færdig, når** headeren siger "Session since" og klokkeslættet.

## Questen er klaret

Spil. Hold [runbooken til spilaftenen](game-night-runbook.md) åben. Bagefter: [efter hver
session](after-session.md).
