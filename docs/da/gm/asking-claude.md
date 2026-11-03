---
source: gm/asking-claude.md
sourceHash: b21633be1692
title: Spørg Claude
description: Sådan bruger du Claude Desktop med værktøjet, gode forespørgsler, de færdige prompts, hvordan Claudes ændringer godkendes, og hvad Claude ikke kan.
---

# Spørg Claude

I Claude Desktop taler du med Claude om dit spil. Gennem bridgen kan Claude læse din Foundry-world og,
når du beder om det, ændre den. Det virker med dit Claude-abonnement; du skal ikke bruge en API key.

## Før du spørger

- Claude Desktop kører og er forbundet til bridgen (på Pi'en ved bordet, på udviklerens PC under test).
- Foundry er åben i din browser, og du er logget ind som GM. Uden en GM i Foundry kan Claude ikke nå
  spillet.
- Dashboardets panel **✈ Pre-flight** viser "Foundry connected", og der er ingen "Connection lost".

Claude holder ikke selv øje med spillet. Den læser det, den skal bruge, i det øjeblik du spørger.

## Hvad Claude kan nå

- Karakterer og NPC'er: sheets, HP, spell slots, items, effects, conditions.
- Combat tracker, den aktuelle scene, tokens og deres placering.
- Journals i din world (Claude kan søge i deres tekst) og compendium-opslag som monsters, spells og
  items (Claude finder dem på navn).
- Chat, session log og play stats (pr. PC en spiller ejer: damage, healing, downs, rolls, spells,
  resources, loot, XP).
- Tarokka-læsningen og listen over afslørede handouts (kun GM).

Claude kan også handle: slå for NPC'er, give damage eller healing, flytte tokens, sætte conditions,
tilføje NPC'er fra compendiums, skrive journals, sende chatbeskeder og mere. Dashboardets tool runner
viser alle de værktøjer, Claude har.

## Gode forespørgsler

Sig præcis, hvad du vil have, kald tingene det, Foundry kalder dem, og sig, om Claude kun skal
foreslå eller også handle.

- "Hvilke PC'er har under halvdelen af deres HP, og hvem har spell slots tilbage?"
- "Hvad skete der sidste session? Brug session loggen og play stats."
- "Find tre undead med CR 1 til 3 i mine compendiums til fire karakterer på level 3."
- "Hvordan virker grappling i 2024-reglerne? Fortæl mig, hvor i mine Foundry-bøger du fandt det."
- "Slå initiative for NPC'erne i den aktuelle combat."
- "Træk en ny Tarokka-læsning med det indbyggede roll. Vis mig planen først."
- "Lav en plan for at vise siden 'Old letter' i journalen 'Handouts' for spillerne."

Flere færdige forespørgsler, sorteret efter før, under og efter en session:
[Cookbook](cookbook.md).

Forespørgsler der går galt:

- "Dræb ulven." Hvilken ulv? Flere tokens kan have samme navn. Sig "Wolf 2" eller vælg tokenet.
- "Gør det næste combat federe." For vagt. Sig, hvad du vil have: hårdere, kortere, mere terræn.
- "Ret alt fra i går aftes." Claude kan ikke fortryde direkte handlinger; se nedenfor.

## Tool sets: hvilke kontakter du skal tænde

Claude Desktop viser værktøjet som fem punkter, ét pr. tool set, hver med sin egen kontakt i
**+**-menuen under beskedfeltet, så **Connectors** (det præcise sted kan flytte sig mellem versioner
af Claude Desktop). Claude læser alle værktøjer, der er tændt, når en chat starter, så færre kontakter
giver mere plads til din samtale og færre forkerte valg. Kontakterne bliver, som du lod dem, i nye
chats.

| Punkt               | Set   | Tænd den, når du vil                                                               |
| ------------------- | ----- | ---------------------------------------------------------------------------------- |
| `foundry-mcp`       | core  | Altid. Slå ting op, og se, apply eller undo Claudes planlagte ændringer.           |
| `foundry-mcp-prep`  | prep  | Forberede en session, skrive et recap, arbejde med quests, Tarokka eller handouts. |
| `foundry-mcp-build` | build | Lave eller ændre NPC'er, monsters og items.                                        |
| `foundry-mcp-play`  | play  | Lade Claude køre tingene ved bordet: tokens, combat, rolls, damage, chat.          |
| `foundry-mcp-admin` | admin | Tjekke modules og fejl, ændre hvem der ejer en actor, Obsidian mirror.             |

En god standard: core og prep tændt, resten slukket. Hvis du beder om noget, der kræver et set, som er
slukket, siger Claude, hvilket du skal tænde.

## Færdige prompts

Værktøjet kommer med prompts til de almindelige opgaver. Claude Desktop viser en forbundet servers
prompts i beskedfeltet (led efter værktøjets punkter, som `foundry-mcp` og `foundry-mcp-prep`, under
beskedfeltets **+**-menu; det præcise sted kan flytte sig mellem versioner af Claude Desktop). Vælg
en, udfyld felterne, send. En prompt vises kun, mens dens set er tændt: `rules-question` og
`npc-improv` ligger i core, `paper-sync-photos` i play, de andre fire i prep.

| Prompt              | Felter                                                                | Hvad den bruges til                                                                                                                       |
| ------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `prep-next-session` | `focus` (valgfri)                                                     | Samler, hvad der skete sidste session, og hvad der stadig er åbent, og hjælper dig med at forberede den næste.                            |
| `rules-question`    | `question` (påkrævet)                                                 | Svarer på et regelspørgsmål ud fra bøgerne i dine Foundry-compendiums og journals, siger hvor svaret kom fra, 2024-reglerne først.        |
| `session-recap`     | `audience` (`gm` eller `players`, standard `gm`), `session` (valgfri) | Et recap fra play loggen. Spillerversionen bruger kun data, der er sikre for spillerne.                                                   |
| `npc-improv`        | `npc` (påkrævet)                                                      | Et hurtigt improv-kort kun til GM'en for en NPC: stemme, manerer, ønske, hemmelighed.                                                     |
| `encounter-check`   | `scene` (valgfri)                                                     | Tjekker en encounters balance mod partyet.                                                                                                |
| `reveal-handout`    | `page` (påkrævet)                                                     | Laver en plan for at vise en journalside for spillerne, viser dig planen og apply'er den først, når du har bekræftet.                     |
| `paper-sync-photos` | `characters` (valgfri)                                                | Læser fotos af karakterark på papir efter en papiraften, laver planer for ændringerne og lister først hver aflæsning, den var usikker på. |

`paper-sync-photos` er til en aften spillet på papir: vedhæft ét foto pr. ark (eller flere til et ark
i to dele), vælg prompten og send. Claude læser tallene, sammenligner dem med Foundry, laver én plan
pr. karakter og viser hver plan med værdien på arket ved siden af værdien i Foundry. Hver aflæsning,
den var usikker på, er markeret CHECK og står samlet under "Check these before you apply", så et 8-tal
læst som 3 bliver fanget, før noget ændres. Den rører aldrig XP, level, class eller maximum hit
points, og kontakten **AI Tool: Paper sync (writes)** skal være tændt. Planer apply'es kun efter dit
ja, og hver af dem kan fortrydes.

`npc-improv`-kortet indeholder hemmeligheder. Hold det væk fra delte skærme. Læs et spillerrecap selv,
før du sender det videre.

## Hvordan Claudes ændringer godkendes

Der er to slags ændringer.

**Guarded changes** (damage, healing, conditions, spell slots og andre resources, flytning, ændring og
sletning af tokens, templates, mørke og lys, map notes, loot, hvem der ejer en actor, party-panelet,
Tarokka-læsningen, handouts, indstillingerne for Obsidian mirror):

1. Claude laver en plan. Der ændres intet endnu.
2. Claude viser dig planen: et resumé og listen over, hvad der ændres.
3. Du siger ja i chatten, eller du apply'er planen selv i dashboardet (se
   [Anvend en plan, Claude lavede](dashboard.md#anvend-en-plan-claude-lavede)). Claude er bedt om at
   vente på dit ja, før den apply'er en plan. Hvis du skriver "kør" i forespørgslen ("Giv 12 fire
   damage til Wolf 2, kør"), er det dit ja, så Claude planlægger og apply'er i ét hug.
4. Ændringen bliver registreret. Den vises i dashboardets **Recent Changes**, hvor du kan undo'e den.

En guarded change bliver afvist, og intet bliver skrevet, hvis dens funktionskontakt er slukket, hvis
planen er mere end 15 minutter gammel, eller hvis det samme er ændret i Foundry siden planen blev
lavet. Deletes samt Tarokka-reveals og -hides tæller som destruktive og kræver også dit udtrykkelige
ja. At vise en handout-side for spillerne er en almindelig ændring med en Undo, så ét ja er nok.

I et langt combat bliver confirm-trinnet trættende. Indstillingen **AI Tool: Live play, apply
without confirming** (Game Settings, kategorien **Foundry AI Tool**; slukket som standard) springer
det over for damage, healing, conditions og resources, som Claude planlægger. Hver ændring havner
stadig i Recent Changes med **Undo**. Dashboardets party- og Tarokka-knapper har aldrig brug for den:
de apply'er med det samme med en **Undo**-besked. Dens Damage / Heal-formular apply'er også med det
samme på samme måde; dens Condition-knap går gennem tool runneren og viser altid confirm-vinduet (se
[dashboard-guiden](dashboard.md#confirm-vinduet)).

### Funktionskontakter

Alle ligger i **Game Settings**, kategorien **Foundry AI Tool**. De stopper dashboardets ændringer
lige så vel som Claudes.

| Indstilling                                  | Standard | Lader Claude og dashboardet                                                                                                                                                  |
| -------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Allow Write Operations                       | Til      | Ændre overhovedet noget. Slukket gør hele værktøjet skrivebeskyttet (se nedenfor).                                                                                           |
| AI Tool: Live play (writes)                  | Til      | Give damage, healing, temporary hit points, conditions og resources; flytte, ændre eller slette tokens; placere templates, sætte mørke og lys, tilføje map notes, give loot. |
| AI Tool: Live play, apply without confirming | Fra      | Springe confirm-trinnet over for damage, healing, conditions og resources, som Claude planlægger.                                                                            |
| AI Tool: Ownership (writes)                  | Til      | Ændre hvilke spillere der ejer eller kan se en actor.                                                                                                                        |
| AI Tool: Party (writes)                      | Fra      | Ændre partyets rejsetempo, placere partyet på kortet, tilføje det til combat, sende en rest-anmodning.                                                                       |
| AI Tool: Handouts (writes)                   | Fra      | Vise eller skjule journalsider for spillerne.                                                                                                                                |
| AI Tool: Tarokka (writes)                    | Fra      | Gemme Tarokka-læsningen, linke kort til journals, udgive reveal-sider.                                                                                                       |
| AI Tool: Obsidian mirror (writes)            | Fra      | Ændre hvilke Foundry-dokumenter der spejles ind i dit Obsidian vault.                                                                                                        |
| AI Tool: Obsidian import (writes)            | Fra      | Lave en quest-journal kun til GM'en ud fra en quest-note i din Obsidian `Prep`-mappe. Startes i Obsidian, bekræftes i dashboardet; Claude har intet værktøj til det.         |
| AI Tool: Session notes (writes)              | Fra      | Lægge noterne fra en optaget session ind i en journal kun til GM'en af sig selv, uden at spørge (se nedenfor).                                                               |

Andre kontakter i samme kategori: table viewer, "Undo for everything" og GM-vinduerne starter tændt;
scene mood og musik, room setup, scene restore, NPC turn assistant og paper sync starter slukket, og
det samme gør "AI Tool: Who would notice" (en række med passive scores i party-skuffen, kun læsning)
og "AI Tool: Rules check". [Funktioner og hvornår du slår dem til](features.md) siger, hvad hver af dem
gør.

**Session notes går ind uden at spørge.** Med "AI Tool: Session notes (writes)" tændt lægger bridgen
noterne fra en optaget session (siderne Recap, GM summary og Scenes, dansk først og engelsk under) ind
i en journal kun til GM'en i mappen "Session notes", så snart Foundry er åben med writes tændt. Den
spørger ikke først. Hver af dem står i Recent Changes med en Undo, som afvises, når Recap er blevet
afsløret, eller du har redigeret en side. Spillerne ser kun Recap, og kun når du afslører den: den
venter i reveal-køen. "Turn on for tonight" tænder ikke denne kontakt.

**Direkte handlinger** (rolls, nye NPC'er, journals, chatbeskeder og andet) sker, så snart Claude
bruger værktøjet. De står ikke i Recent Changes, og værktøjet kan ikke undo'e dem; du retter dem i
hånden i Foundry. Så:

- Bed Claude fortælle dig, hvad den vil gøre, før den gør det: "Fortæl mig planen, og vent så på
  mit OK."
- Claude Desktop kan bede om dit OK, før Claude bruger et værktøj. Vi foreslår **Always allow** for
  begge grupper på hver Foundry-connector (**Customize**, **Connectors**, connectoren, **Tool
  permissions**: **Read-only tools** og **Write/delete tools**), fordi ændringer gennem
  `apply-planned-change` allerede viser dig planen og venter på din confirm, og du kan undo'e dem. De
  direkte handlinger nedenfor gør ikke, så med **Always allow** på writes stopper Claude Desktop heller
  ikke for dem. For at blive spurgt før hver ændring skal du sætte **Write/delete tools** til **Needs
  approval**. Trin for trin i [Forbind Claude Desktop til serveren](connect-claude-desktop.md).
- Når Claude bruger et item eller en spell, åbner Foundry brugsdialogen på din skærm, og du gør den
  færdig dér.

Indstillingen "Allow Write Operations" (Game Settings, kategorien **Foundry AI Tool**; tændt som
standard) er værktøjets skrivebeskyttelse. Når den er slukket, ændrer værktøjet intet: ingen nye
actors eller items, ingen ændringer af tokens, scener, combat, damage eller conditions, ingen
ændringer af ejerskab, ingen journal-writes, ingen chat- eller roll-beskeder, ingen guarded changes
(heller ikke dem, der kun rører værktøjets eget lager, som en Tarokka-læsning eller indstillingerne
for Obsidian mirror) og ingen Undo. Læsning virker stadig. Den stopper også dashboardets handlinger,
ikke kun Claudes.

Dashboardets **GM Actions**-kontakt beskytter kun dashboardet. Den stopper ikke Claude Desktop.

## Hvad Claude ikke kan

- **Arbejde uden en GM i Foundry.** Modulet kører i en GM's Foundry-browserfane, og bridgen når kun
  spillet gennem den.
- **Se skærmen.** Den læser spildata, ikke billedet af kortet.
- **Komme udenom en funktionskontakt.** Er en funktion slukket, kan ingen plan for den apply'es.
- **Undo'e direkte handlinger.** Kun guarded changes har Undo.
- **Læse bøger, du ikke har i Foundry.** Værktøjet indeholder ingen bog- eller eventyrtekst. Claude
  læser reglerne og eventyret fra compendiums og journals i din world, i det øjeblik du spørger. Er en
  bog ikke installeret i Foundry, kan Claude ikke citere den.
- **Følge spillet mellem dine beskeder.** Den læser, når du spørger. Til historien indtil nu skal du
  bede den læse session loggen, play stats eller en journal.
- **Have altid ret.** Tjek regelsvar mod den side, den nævner, og læs hver plan, før du godkender den.

## Spoilers og privatliv

Claude ser alt, en GM ser: sande navne, skjulte tokens, GM-noter, Tarokka-kortene. Hold Claude Desktop
væk fra alle skærme, spillerne kan se, og del aldrig dets vindue i Discord eller et videoopkald. Det,
Claude læser, går til Anthropic under din Claude-konto, når du spørger; se [spillersiden](../player/README.md)
for, hvad det betyder for spillerne.
