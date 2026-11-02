---
source: gm/gm-coach.md
sourceHash: 351656dd1183
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
med Foundry-connectorerne slået til ([Spørg Claude](asking-claude.md)). Guarded changes
(damage, conditions, token-flytninger og lignende) bliver planlagt først, vist for dig, udført efter dit
ja og gemt i Recent Changes med en Undo. Nogle af Claudes andre tools virker med det samme og kan ikke
fortrydes. Coachen kan forklare begge dele.

Den kender hver side i disse guides, så du kan også spørge den om dashboardet, GM-vinduerne,
feature switches, checklisterne før og efter en session, spilaftenens runbook og
tv'et ved bordet. På spilaftenen giver den dig runbook'ens trin først.

Den svarer først ud fra sine sider og siger det. Når siderne ikke dækker noget, kan den svare
ud fra almen viden, men siger det til dig, fordi mange guides på nettet beskriver ældre Foundry-versioner.
Den søger aldrig på nettet, og den har ingen bog- eller kampagnetekst.

## Læg den ind (én gang, ca. 5 minutter)

Du skal bruge filen `foundry-gm-coach.zip` fra tool-adminen.

<!-- wiki:coach-download -->

1. Åbn **Settings**, **Capabilities** i Claude (desktop-appen eller claude.ai), og slå
   **Code execution and file creation** til. Skills har brug for den.
2. Åbn **Customize**, **Skills**.
3. Tilføj en skill og upload `foundry-gm-coach.zip`. Pak den ikke ud først.
4. Sørg for, at skillen er slået til på listen.

## Spørg den

Start en ny chat og spørg som normalt. Claude vælger selv skillen, når spørgsmålet handler om
Foundry. For at være sikker kan du begynde med "GM coach:".

- "GM coach: en spiller kan ikke se kortet, hvad tjekker jeg?"
- "GM coach: hvordan giver jeg spillerne et handout?"
- "GM coach: guide mig igennem at starte en combat og rulle initiative."
- "GM coach: hvad tjekker jeg i de 15 minutter, før vi spiller?"
- "GM coach: Claude siger, at et tool set er slået fra. Hvor slår jeg det til?"
- "GM coach: dashboardet mistede forbindelsen midt i en kamp. Hvad nu?"
- "GM coach: hjælp mig med at planlægge session 0. Stil mig spørgsmål først."

Når du planlægger med den, stiller den et par spørgsmål og foreslår muligheder. Valgene er dine. Du kan
spørge på dansk.

Tjek dens svar mod skærmen. Hvis den nævner en knap, du ikke kan finde, så sig det: så fortæller den dig,
om den del er blevet tjekket i et live spil.

## Hvis skills ikke virker på din konto: et Claude Project

Et Project er et chatrum med dine egne filer. Det virker også, men det indlæser alle sine filer i hver
besked, så på den gratis plan æder det din grænse meget hurtigere. Upload kun de sider, du har brug for.

1. Pak `foundry-gm-coach.zip` ud.
2. I Claude: **Projects**, opret et projekt med navnet "Foundry GM coach".
3. Åbn `SKILL.md` i Notesblok, kopiér alt under den anden `---`-linje, og indsæt det i
   projektets instruktioner.
4. Upload to eller tre sider fra mappen `references` som projektets viden, for eksempel
   `references/foundry/in-world-layout.md`, `references/foundry/combat-tracker.md` og
   `references/gm/game-night-runbook.md`. Skift dem ud, når dine spørgsmål ændrer sig.

## At holde den opdateret

Tool-adminen bygger en ny zip, når siderne ændrer sig (`npm run gm-coach`). Siderne inde i
zip-filen er en kopi fra den dag, den blev bygget, så en feature, der kom senere, står ikke i dem.
Hvis coachen beskriver en knap, der ikke findes, eller ikke kender en ny, så bed tool-adminen om en frisk zip.
For at opdatere fjerner du den gamle skill og uploader den nye zip.
