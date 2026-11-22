---
source: gm/game-night-runbook.md
sourceHash: dfe40f023bcb
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

**Hvem du ringer til:** den, der har sat værktøjet op (administratoren i det følgende), står på standby på
spilaftenen, ved bordet eller i Discord-voice. Ring i voice eller skriv en direkte besked på Discord.
Du skal ikke selv løse tekniske problemer.

## Før du starter (15 minutter før)

Cirka to timer før kan administratoren få en enkelt linje, **game-day brief**, på sin egen pc eller telefon
(pre-flight-resultat og hvad du skal åbne først) og siger til, hvis noget er rødt. Den læser kun, og den er en
forvarsel: pre-flight-tjekket herunder er stadig det rigtige.

- [ ] Åbn spillets adresse og kom ind som din GM-bruger. Tjek spillerlisten nederst til venstre.
- [ ] Gå checklisten [Før hver session](before-session.md) igennem (pre-flight, Turn on for tonight).
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

## Foundry kører langsomt for alle

1. Bed alle genindlæse (F5). Luk tunge scenes og stop animationer eller musik, du ikke har brug for.
2. Hvis det bliver ved med at køre langsomt i mere end ti minutter, så råb om hjælp i næste pause.

## Claude svarer ikke, eller dens tools fejler

Bliv ved med at spille: lav ændringen i hånden i Foundry.

- **Beskeden "Usage limit":** den gratis plan har en grænse pr. fem timer. Den nulstilles af sig
  selv. Indtil da spiller du uden Claude. Se [Claude Free eller Pro](claude-plans.md).
- **Claude siger, at et tool set er slået fra:** slå det til i Claude Desktops **+**-menu,
  så **Plugins** (se [Spørg Claude](asking-claude.md#tool-sets-hvilke-kontakter-du-skal-tænde)).
- **En connector tilføjet med webadresse siger, at den ikke er forbundet:** åbn **Settings**,
  **Plugins**, vælg den og tryk **Connect** for at logge ind med din e-mail igen. Virker det stadig
  ikke, se [Forbind Claude med webadresse](connect-claude-web.md#hvis-noget-ikke-virker).
- **En ændring viser en fejl, men kan være gået igennem:** efter lang ventetid kan Claude vise en fejl
  (en 524), selv om ændringen landede. Åbn **Recent Changes** på dashboardet, før du spørger igen.
- **Hvert værktøjskald fejler:** Claude har mistet forbindelsen til spillet. I pausen lukker du Claude
  Desktop helt og starter det igen. Hjælper det ikke, så råb om hjælp efter sessionen.

> **Usikker? Spørg Claude.** Spørg GM coach: "Claude holdt op med at svare under spillet. Hvad kan jeg stadig gøre, og hvad gør jeg ved det i pausen?" ([sådan tilføjer du GM coach](gm-coach.md)) Coachen har kun brug for Claude selv, ikke for spillet. Hvis dens tools fejler, har den stadig denne runbook og fejlfindingssiden indbygget og siger det.

## Dashboardet vil ikke indlæse eller mister forbindelsen

Bliv ved med at spille i Foundry. I pausen genindlæser du dashboardsiden. Hvis der stadig står
"Connection lost, reconnecting…" eller "Connection closed: reload the page", så råb om hjælp efter sessionen. Ændringer, der blev lavet
imens, kan stadig fortrydes senere fra **Recent Changes**.

## Optagelsesbotten forsvandt eller stoppede

Skriv `/record status` på Discord. Optager den ikke, så skriv `/record start` igen. Et hul i
optagelsen betyder bare, at noterne mangler den del. Det er ikke værd at stoppe spillet for.

## Serveren er nede

**Du ser:** ingen kan åbne spillets adresse, eller Foundry stopper for alle på én gang og
kommer ikke tilbage efter en genindlæsning.

Det er plan B: administratoren starter Foundry på sin egen PC fra sidste aftens backup og
giver dig en ny adresse.

1. Sig til spillerne på Discord: "Serveren er nede, vi holder en pause på 15 minutter."
2. Ring til administratoren med det samme. Vedkommende starter plan B.
3. Når administratoren skriver den nye adresse, åbner alle den og logger ind som sædvanligt: samme
   brugernavne. Første besøg kan bede om en e-mailkode igen, som den første aften.
4. Alt, der skete i aften før nedbruddet, er ikke i sidste aftens backup. Tjek
   hit points, spell slots og items med spillerne og sæt dem i hånden. Din chatlog og
   spillernes hukommelse er det, du har at gå efter.
5. Hvis plan B ikke virker inden for ca. 30 minutter, så spil videre på Discord med rigtige
   terninger, eller afslut aftenen tidligt.

På en plan B-aften når din egen Claude og dashboardet ikke spillet: spil i hånden i
Foundry. Dine ændringer bliver gemt, og administratoren flytter worlden tilbage til hjemmeserveren før
næste session. Administratorens trin står i [Plan B](../../dev/PLAN-B.md).

> **Usikker? Spørg Claude.** Spørg GM coach: "Serveren er nede midt i spillet. Hvad siger jeg til spillerne, og hvad tjekker jeg, når vi er tilbage?" Når serveren er nede, kan coachen ikke hente sine fulde sider. Den svarer ud fra denne runbook og fejlfindingssiden, som følger med, og siger til, når den går på almen viden i stedet. Den kan ikke se eller ændre dit spil.

## Hvornår du råber om hjælp

- Med det samme: serveren er nede, ingen kan logge ind, eller Foundry viser en fejl om worlden
  eller databasen.
- I næste pause: en spiller kan stadig ikke forbinde efter trinene ovenfor, eller Foundry bliver ved med at køre langsomt.
- Efter sessionen: Claude eller dashboardet virkede ikke, eller noget, du rettede i hånden, som du
  vil have tjekket.

## Efter sessionen

- [ ] Gå checklisten [Efter hver session](after-session.md) igennem.
- [ ] Skriv på Discord, hvad der gik i stykker og hvornår, også selv om du fik det rettet. Det
      hjælper administratoren med at finde årsagen.
