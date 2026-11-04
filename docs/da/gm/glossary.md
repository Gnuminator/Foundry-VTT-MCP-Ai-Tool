---
source: gm/glossary.md
sourceHash: 74447f315c1d
title: Ordliste
description: Foundry-ordene og værktøjsordene i guiderne på almindeligt dansk, samlet ét sted.
---

# Ordliste

Ord, du møder i guiderne. Foundrys egne ord kommer først, så værktøjets.

Foundry-ord:

- **World:** din kampagne i Foundry: dens scenes, actors, journals og indstillinger.
- **Scene:** et kort. Den **active scene** er den, spillerne er på.
- **Navigation Name:** et andet navn til en scene, som spillerne ser i stedet for det rigtige.
- **Actor:** en karakter eller creature med et ark (en PC, en NPC, et monster).
- **Token:** en actors billede på kortet. Dens **Display Name**-indstilling bestemmer, hvem der ser dens navn.
- **Journal:** en bog med sider i Journal tab. En **journal page** er én side i den.
- **Compendium:** et bibliotek med færdigt indhold, for eksempel de officielle bøger, du ejer.
- **Ownership:** hvem der må se eller redigere et dokument: None, Limited, Observer, Owner. Observer betyder
  "kan læse".
- **Game Settings:** Foundrys indstillingsvindue (Settings tab, tandhjulet, så **Game Settings**).
  Værktøjets indstillinger ligger i kategorien **Foundry AI Tool**. Indstillinger og beskeder dér, der siger
  "AI Tool" (for eksempel **AI Tool: Connect to the AI Tool server**), hører til modulet.
- **World id:** din worlds korte id, navnet på dens mappe på Foundry-serveren. Værktøjet bruger
  det som mappenavn i Obsidian (`Campaigns/<world id>/`).

Værktøjsord:

- **MCP:** den måde, Claude Desktop taler med værktøjer på. Værktøjets punkt i Claude Desktop hedder
  `foundry-mcp`, og "MCP Bridge" eller "MCP Server" i Foundrys beskeder betyder dette værktøj.
- **Direct action:** et værktøj, der ændrer spillet, så snart Claude eller dashboardet bruger det. Det står
  ikke i Recent Changes, og værktøjet kan ikke fortryde det. Du retter det i hånden i Foundry.
- **Guarded change:** en ændring, der sker i tre trin: plan, confirm, apply. Den bliver registreret og kan
  fortrydes.
- **Plan:** en foreslået ændring med en liste over, hvad den vil gøre (diffen). Planer udløber efter 15
  minutter.
- **Feature switch:** en indstilling, der lader én funktion lave ændringer, for eksempel "AI Tool: Tarokka
  (writes)". De fleste er slået fra som standard. Nogle få starter slået til (Live play til damage, healing og conditions,
  Ownership, table viewer, GM windows og Undo til alt). [Funktioner og hvornår du slår dem til](features.md) lister hver enkelt.
- **GM Actions:** dashboardets kontakt til at ændre spillet fra dashboardet. Slået fra som standard.
  **Start session** slår den til.
- **GM token:** en adgangskodelignende del af dashboardets GM-adresse (`?token=…`). Værktøjets admin
  giver dig adressen. Åbn den én gang, så husker browseren den.
- **Recent Changes:** dashboardets panel, der lister gennemførte ændringer, hver med Undo, når det er muligt.
- **Bridge vault:** værktøjets eget lager kun til GM'en på bridgens computer: Tarokka-læsningen,
  afslørede handouts, ændringshistorikken og logfilerne. Det er ikke en del af Foundrys world-backup.
- **Play log:** optegnelsen over, hvad der sker under spil (rolls, HP, rests, combat), med hver spillers
  brugernavn. Session notes og stats kommer fra den.
- **Play session:** én aften med spil. Du markerer dens start og slutning i dashboardet.
- **The Veil:** kampagnens udseende: slottet i tågen og en lampelyst linje. Det er ét valg i Theme-indstillingen
  (Neutral, The Veil eller Off), det kan klæde Foundrys join-side på, og det er også navnet på et
  Dice So Nice-tema for terninger, "AI Tool: The Veil".
