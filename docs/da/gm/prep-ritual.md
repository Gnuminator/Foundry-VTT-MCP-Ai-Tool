---
source: gm/prep-ritual.md
sourceHash: 34b4ca7404e7
title: Lad os forberede, forberedelsen på 30 minutter
description: Én sætning, der fører dig gennem forberedelsen af næste session i fem trin og slutter med pre-flight-tjekket.
---

# Lad os forberede: 30 minutter, fem trin

**Foundry prep ritual** er en skill til din egen Claude-konto. Du siger "let's prep", og Claude fører
dig gennem de samme fem trin hver gang, ét spørgsmål ad gangen, så intet bliver glemt. Claude læser
kun dit spil og kommer med forslag. Du bestemmer historien, og intet ændres i Foundry uden dit ja.

## Læg den ind

Skillen er filen `foundry-prep-ritual.zip`, der ligger ved hver release-download. Tilføj den som [GM-coachen](setup-gm-coach.md):
Claude Desktop, Settings, Plugins, og tilføj filen. Start derefter en ny chat og slå Foundry-connectorerne **foundry-mcp** og
**foundry-mcp-prep** til i **+**-menuen, så **Plugins**.

## De fem trin

1. **Sidste session på én skærm.** Et kort "Previously on" fra din optagede session. Du siger til,
   hvis noget mangler.
2. **Løse tråde.** Op til fem åbne tråde: quests, løfter, spørgsmål gruppen lod hænge. Du vælger
   de to eller tre, du vil røre ved.
3. **Aftenens scener.** Du vælger to til fire scener fra din verden og siger, hvad du vil have der
   sker i hver.
4. **Encounter-budget.** For hver kamp henter Claude XP-budgettet for din gruppe, sammenligner
   creatures på scenen med det og siger, om kampen ser ud til at være under, nær eller over. Det er
   et overslag, og Claude foreslår én ændring, hvis den er skæv.
5. **Handouts i kø.** Du vælger, hvilke handouts der skal være klar. Intet vises for spillerne under
   forberedelsen.

## Slutningen: klar-tjekliste

Claude kører pre-flight-tjekket (`get-preflight`) og giver dig en kort tjekliste: scener, tråde,
kampe, handouts og det, der stadig er rødt, det vigtigste først. Viser pre-flight fejl, siger Claude,
hvad der skal rettes, før forberedelsen kaldes færdig.

## Tips

- Sig "skip step 4", hvis der ikke er nogen kamp. Det kommer på slutlisten, så du husker det.
- Du kan svare på dansk. Claude beholder de engelske spiltermer.
- Vil du se de samme fakta uden Claude, så åbn **Prep**-skuffen i dashboardet
  ([Gør klar til næste session](cookbook.md#gør-klar-til-næste-session)).
