---
source: gm/claude-plans.md
sourceHash: c9f0d4bff3c9
title: Claude Free eller Pro
description: Hvad der virker med den gratis Claude-plan, og hvad Claude Pro giver dig, når du kører et spil med Foundry AI Tool, med kilder og datoer.
---

# Claude Free eller Pro

Du kan køre spillet med den gratis Claude-plan. Her står, hvad der virker på Free, hvor du kommer til
at mærke grænsen, og hvad Pro giver dig, så du senere kan afgøre, om Pro er det værd for dig.

Tjekket den 2026-11-21 på Anthropics egne sider (de står nederst). Planer ændrer sig; hvis noget her
ser forkert ud, så tjek de sider.

## Hvad der virker på Free

| Hvad                                                                     | På Free                                                                                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Claude Desktop-appen                                                     | Ja.                                                                                                     |
| At spørge Claude om regler, forberedelse og dine noter                   | Ja.                                                                                                     |
| Claude, der læser og ændrer spillet (værktøjets forbindelse til Foundry) | Forventes at virke; Anthropic nævner ingen plangrænse (se [Ikke afklaret endnu](#ikke-afklaret-endnu)). |
| Skills, inklusive **Foundry GM coach**-skillen, der er lavet til dig     | Ja. Du lægger dine egne skills ind under **Settings**, **Plugins**, **Skills**.                         |
| Projects (et chatrum med dine egne filer og instruktioner)               | Op til 5.                                                                                               |
| Modeller                                                                 | Sonnet og Haiku. Ikke Opus.                                                                             |
| Claude Code (udviklerværktøjet)                                          | Nej. Du behøver det ikke: session notes bliver lavet på værktøjsadministratorens PC.                    |

Til skills skal én indstilling være slået til: **Settings**, **Capabilities**, **Code execution and
file creation** (nyere versioner af appen kalder den **Create and edit files**). Hvis du ikke kan se en
måde at uploade en skill på, så tjek den først.

## Hvor du kommer til at mærke grænsen

- **En grænse pr. fem timer og en pr. uge.** Free har en brugsgrænse, der nulstilles hver femte time,
  og en ugentlig. Anthropic oplyser ikke et fast antal beskeder: lange chats, filer og værktøjer æder
  den hurtigere op. Når du rammer en, siger Claude det og fortæller, hvornår den nulstilles. På Free kan du ikke købe ekstra
  brug.
- **Værktøjer er dyre.** Hvert værktøjssæt, der er slået til, koster brug i hver besked, også når
  Claude ikke bruger det. Slå kun de sæt til, du skal bruge, på spilaftenen (core og play), og slå
  resten fra i **+**-menuen, så **Plugins**. Se
  [Asking Claude](asking-claude.md#tool-sets-hvilke-kontakter-du-skal-tænde).
- **Start nye chats.** En lang chat koster mere for hver besked. Start en ny chat til hver
  forberedelsesopgave og til hver spilaften.
- **Grænsen deles.** Claude på nettet, i desktop-appen og på telefonen tæller alle med i den
  samme grænse.

Så på Free skal du forberede dig med Claude mellem sessionerne og bruge den let ved bordet. Hvis
en spilaften løber tør, så spil videre uden den: alt kan gøres i hånden i Foundry
([Runbook til spilaftenen](game-night-runbook.md)).

> **Usikker? Spørg Claude.** Spørg GM coach: "Hvordan får jeg mit Claude-forbrug til at holde gennem en spilaften på gratisplanen?" ([sådan tilføjer du GM coach](gm-coach.md))

## Hvad Pro giver

| Hvad                  | Pro                                                                          |
| --------------------- | ---------------------------------------------------------------------------- |
| Brug                  | Mere end Free, pr. femtimersperiode og pr. uge.                              |
| At løbe tør           | Du kan slå betalte brugskreditter til for at fortsætte efter grænsen.        |
| Modeller              | Også Opus, den stærkeste model, til svær forberedelse og regelspørgsmål.     |
| Projects              | Ingen grænse på fem.                                                         |
| Research, Claude Code | Inkluderet. Bruges ikke til dette værktøj.                                   |
| Pris                  | 20 USD om måneden eller 200 USD om året (17 USD om måneden ved årsbetaling). |

Skills, desktop extensions (lokale forbindelser som dem, GM'ens fem Foundry-connectors bruger),
desktop-appen og memory er ens på begge planer. Custom connectors (eksterne, via webadresse) er
begrænset til én på Free. En spiller bruger netop den til
[D&D-hjælperen](../player/dnd-helper.md#den-enkle-vej-tilføj-connectoren-med-dens-webadresse), så en
spiller på Free bør gemme den til hjælperen.

**Hvornår Pro er det værd:** når du rammer grænsen under forberedelse eller på spilaftenen oftere end
nu og da, eller når du vil have Claude ved bordet hele aftenen. Prøv Free først.

> **Usikker? Spørg Claude.** Spørg GM coach: "Hvad er grænserne på den gratis plan, og hvad ville få mig til at ramme dem?"

## Ikke afklaret endnu

- **Værktøjets forbindelse på Free, på din PC.** Claude Desktop forbinder til spillet gennem lokale
  programmer (lokale MCP-servere). Anthropic anfører desktop extensions som inkluderet på Free, og
  guiden til lokale servere nævner ingen plangrænse, men ingen side siger pr. plan, at servere
  tilføjet i Claude Desktops konfigurationsfil virker. Det har virket på Free før. Vi tester det på
  din PC før session 0.
- **Den præcise grænse.** Anthropic offentliggør ikke tal for Free; de skriver kun "limited", pr. fem
  timer og pr. uge, og det afhænger af, hvor meget hver chat bruger.

## Kilder

- Planer og priser: <https://claude.com/pricing>
- Skills: <https://support.claude.com/en/articles/12512180-use-skills-in-claude>
- Projects: <https://support.claude.com/en/articles/9517075-what-are-projects>
- Brugsgrænser: <https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work>
- Lokale MCP-servere i Claude Desktop:
  <https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop>
- Custom connectors (eksterne, via webadresse; Free får én, spillerhjælperen bruger den):
  <https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp>
