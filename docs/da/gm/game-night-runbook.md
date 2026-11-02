---
source: gm/game-night-runbook.md
sourceHash: 8f9922284414
title: Spilaftenens runbook
description: Én side til selve aftenen. Hvad du gør, når Foundry, en spiller, Claude, dashboardet eller hjemmeserveren fejler, og hvornår du råber om hjælp.
---

# Spilaftenens runbook

Hold den her side åben på spilaftenen. Hvert problem har, hvad du gør i de første to minutter, og
hvornår du råber om hjælp. De længere forklaringer står i [Fejlfinding](troubleshooting.md).

**Reglen for ethvert problem: spillet er Foundry.** Hvis Claude, dashboardet, noterne eller
optagelsen holder op med at virke, så bliv ved med at spille i Foundry og ret det i pausen eller
efter sessionen. Intet, bordet har brug for, afhænger af dem: du kan lave hver ændring i hånden i
Foundry, og dashboardets ændringshistorik har stadig sin Undo, når det er tilbage.

**Hvem du ringer til:** den, der har sat værktøjet op (tool-adminen nedenfor), står på standby på
spilaftenen, ved bordet eller i Discord-voice. Ring i voice eller skriv en direkte besked på Discord.
Du skal ikke selv løse tekniske problemer.

## Før du starter (15 minutter før)

- [ ] Åbn spillets adresse og kom ind som din GM-bruger. Tjek spillerlisten nederst til venstre.
- [ ] Gå [Før hver session](before-session.md)-checklisten igennem (pre-flight, Turn on for tonight).
- [ ] Kom ind i Discord-voice. Start optagelsen med `/record start` kun hvis alle spillere har sagt
      ja til optagelse (ellers tages deres spor ud bagefter).

## Foundry vil ikke indlæse hos dig

1. Genindlæs siden (F5). Prøv derefter en anden browser eller et privat vindue.
2. Spørg på Discord, om spillerne kommer ind. Hvis de gør, er problemet din computer eller browser:
   prøv en anden enhed. Hvis ingen kommer ind, se [Serveren er nede](#serveren-er-nede).

## Én spiller kan ikke forbinde

1. Send dem [Kom med i spillet](../player/join.md). Tabellen nederst dækker de fleste tilfælde (ingen
   e-mailkode, forkert brugernavn, lille skærm).
2. Bliver de bedt om en adgangskode, har de valgt den forkerte bruger. Player-brugere har ingen
   adgangskode. Bed dem vælge deres eget navn.
3. Deres e-mail får aldrig en kode: deres adresse står ikke på adgangslisten. Råb om hjælp, for den
   liste ligger i Cloudflare, ikke i Foundry.
4. Mens de venter, spiller de andre videre. Spilleren kan følge med i voice og rulle rigtige
   terninger. Du indtaster deres resultater i hånden.

## Foundry er langsomt for alle

1. Bed alle genindlæse (F5). Luk tunge scenes og stop animationer eller musik, du ikke har brug for.
2. Hvis det bliver ved med at være langsomt i mere end ti minutter, så råb om hjælp i næste pause.

## Claude svarer ikke, eller dens tools fejler

Bliv ved med at spille: lav ændringen i hånden i Foundry.

- **Beskeden "Usage limit":** den gratis plan har en grænse pr. fem timer. Den nulstilles af sig
  selv. Indtil da spiller du uden Claude. Se [Claude Free eller Pro](claude-plans.md).
- **Claude siger, at et tool set er slået fra:** slå det til i Claude Desktops **+**-menu,
  **Connectors** (se [Spørg Claude](asking-claude.md#tool-sets-hvilke-kontakter-du-skal-tænde)).
- **Hvert tool-kald fejler:** Claude har mistet forbindelsen til spillet. I pausen lukker du Claude
  Desktop helt og starter det igen. Hjælper det ikke, så råb om hjælp efter sessionen.

## Dashboardet vil ikke indlæse eller mister forbindelsen

Bliv ved med at spille i Foundry. I pausen genindlæser du dashboardsiden. Hvis der stadig står
"Connection lost, reconnecting…" eller "Connection closed: reload the page", så råb om hjælp efter sessionen. Ændringer, der blev lavet imens, kan stadig fortrydes
senere fra **Recent Changes**.

## Optagelsesbotten forsvandt eller stoppede

Skriv `/record status` på Discord. Optager den ikke, så skriv `/record start` igen. Et hul i
optagelsen betyder bare, at noterne mangler den del. Det er ikke værd at stoppe spillet for.

## Serveren er nede

**Du ser:** ingen kan åbne spillets adresse, eller Foundry stopper for alle på én gang og
kommer ikke tilbage efter en genindlæsning.

Det er plan B: tool-adminen starter Foundry på sin egen pc fra gårsdagens backup og
giver dig en ny adresse.

1. Sig til spillerne på Discord: "Serveren er nede, vi holder en pause på 15 minutter."
2. Ring til tool-adminen med det samme. De starter plan B.
3. Når tool-adminen skriver den nye adresse, åbner alle den og logger ind som sædvanligt: samme
   brugernavne. Første besøg kan bede om en e-mailkode igen, som den første aften.
4. Alt, der skete i aften før nedbruddet, er ikke i gårsdagens backup. Tjek
   hit points, spell slots og items med spillerne og sæt dem i hånden. Din chatlog og
   spillernes hukommelse er optegnelsen.
5. Hvis plan B ikke virker inden for ca. 30 minutter, så spil videre på Discord med rigtige
   terninger, eller afslut aftenen tidligt.

På en plan B-aften når din egen Claude og dashboardet ikke spillet: spil i hånden i
Foundry. Dine ændringer bliver gemt, og tool-adminen flytter world'en tilbage til hjemmeserveren før
næste session. Tool-adminens trin står i [Plan B](../../dev/PLAN-B.md).

## Hvornår du råber om hjælp

- Med det samme: serveren er nede, ingen kan logge ind, eller Foundry viser en fejl om world'en
  eller databasen.
- I næste pause: en spiller kan stadig ikke forbinde efter trinene ovenfor, eller Foundry bliver ved med at være langsomt.
- Efter sessionen: Claude eller dashboardet virkede ikke, eller noget, du rettede i hånden, som du
  vil have tjekket.

## Efter sessionen

- [ ] Gå [Efter hver session](after-session.md)-checklisten igennem.
- [ ] Skriv på Discord, hvad der gik i stykker og hvornår, også selvom du fik det rettet. Det hjælper tool-adminen med at finde
      årsagen.
