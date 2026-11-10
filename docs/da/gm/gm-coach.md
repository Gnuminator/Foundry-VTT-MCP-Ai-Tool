---
source: gm/gm-coach.md
sourceHash: b36b7709b623
title: Din GM coach i Claude
description: Læg Foundry GM coach-skillen ind på din egen Claude-konto, hvordan du spørger den, og Claude Project som nødløsning.
---

# Din GM coach i Claude

**Foundry GM coach** er en skill til din egen Claude-konto: en samling sider om Foundry 14,
D&D 5e-systemet og dette værktøj, plus instruktioner til Claude om at svare ud fra dem. Spørg den om
ting som "hvor giver jeg en spiller tilladelse til at åbne døre?" eller "hvordan starter jeg combat?". Den
hjælper dig også med at planlægge: hvad du skal forberede til en session, samtalen om forventninger med dine spillere og session
0 ([Forberedelse og forventninger](prep-and-expectations.md)). Den virker på den gratis Claude-plan.

Coachen er en hjælper, der kender siderne. Den kan ikke se eller ændre dit spil. Når du vil have Claude
til at kigge på dine karakterer, planlægge en ændring eller forberede noter, er det en helt almindelig Claude Desktop-chat
med Foundry-connectorerne slået til ([Spørg Claude](asking-claude.md)). Beskyttede ændringer
(damage, conditions, token-flytninger og lignende) bliver planlagt først, vist for dig, udført efter dit
ja og gemt i Recent Changes med en Undo. Nogle af Claudes andre værktøjer virker med det samme og kan
ikke fortrydes. Coachen kan forklare begge dele.

Den kender hver side i disse guides, så du kan også spørge den om dashboardet, GM-vinduerne,
funktionskontakterne, checklisterne før og efter en session, spilaftenens runbook og
tv'et ved bordet. På spilaftenen giver den dig runbookens trin først.

Den svarer først ud fra sine sider og siger det. Når siderne ikke dækker noget, kan den svare
ud fra almen viden, men siger det til dig, fordi mange guides på nettet beskriver ældre Foundry-versioner.
Den søger aldrig på nettet, og den har ingen bog- eller kampagnetekst.

## Læg den ind

Én gang, cirka 5 minutter: følg [Engangsopsætning: GM-coachen](setup-gm-coach.md). Den virker på den gratis
Claude-plan.

## Spørg den

Start en ny chat og spørg som normalt. Claude vælger selv skillen, når spørgsmålet handler om
Foundry. For at være sikker kan du begynde med "GM coach:".

- "GM coach: en spiller kan ikke se kortet, hvad tjekker jeg?"
- "GM coach: hvordan giver jeg spillerne et handout?"
- "GM coach: guide mig igennem at starte en combat og rulle initiative."
- "GM coach: hvad tjekker jeg i de 15 minutter, før vi spiller?"
- "GM coach: Claude siger, at et tool set er slået fra. Hvor slår jeg det til?"
- "GM coach: dashboardet mistede forbindelsen midt i en combat. Hvad nu?"
- "GM coach: hjælp mig med at planlægge session 0. Stil mig spørgsmål først."

Når du planlægger med den, stiller den et par spørgsmål og foreslår muligheder. Valgene er dine. Du kan
spørge på dansk.

Tjek dens svar mod skærmen. Hvis den nævner en knap, du ikke kan finde, så sig det: så fortæller den dig,
om den del er blevet tjekket i et rigtigt spil.

## At holde den opdateret

Værktøjets administrator bygger en ny zip, når siderne ændrer sig (`npm run gm-coach`). Siderne inde i
zip-filen er en kopi fra den dag, den blev bygget, så en feature, der kom senere, står ikke i dem.
Hvis coachen beskriver en knap, der ikke findes, eller ikke kender en ny, så bed værktøjets administrator om en frisk zip.
For at opdatere fjerner du den gamle skill og uploader den nye zip.
