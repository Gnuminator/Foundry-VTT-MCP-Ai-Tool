---
source: gm/claude-plans.md
sourceHash: bd3e8407e01e
title: Claude Free eller Pro
description: Hvad der virker med den gratis Claude-plan, og hvad Claude Pro giver dig, når du kører et spil med Foundry AI Tool, med kilder og datoer.
---

# Claude Free eller Pro

Du kan køre spillet med den gratis Claude-plan. Her står, hvad der virker på Free, hvor du kommer til
at mærke grænsen, og hvad Pro giver dig, så du senere kan afgøre, om Pro er det værd for dig.

Tjekket den 2026-10-08 på Anthropics egne sider (de står nederst). Planer ændrer sig; hvis noget her
ser forkert ud, så tjek de sider.

## Hvad der virker på Free

| Hvad                                                                     | På Free                                                                                                               |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Claude Desktop-appen                                                     | Ja.                                                                                                                   |
| At spørge Claude om regler, forberedelse og dine noter                   | Ja.                                                                                                                   |
| Claude, der læser og ændrer spillet (værktøjets forbindelse til Foundry) | Forventes at virke, men mangler stadig at blive bekræftet på din PC (se [Ikke afklaret endnu](#ikke-afklaret-endnu)). |
| Skills, inklusive **Foundry GM coach**-skillen, der er lavet til dig     | Ja. Du lægger dine egne skills ind under **Customize**, **Skills**.                                                   |
| Projects (et chatrum med dine egne filer og instruktioner)               | Op til 5.                                                                                                             |
| Modeller                                                                 | Sonnet og Haiku. Ikke Opus.                                                                                           |
| Claude Code (udviklerværktøjet)                                          | Nej. Du behøver det ikke: session notes bliver lavet på værktøjsadministratorens PC.                                  |

Til skills skal én indstilling være slået til: **Settings**, **Capabilities**, **Code execution and
file creation**. Hvis du ikke kan se en måde at uploade en skill på, så tjek den først.

## Hvor du kommer til at mærke grænsen

- **En grænse pr. fem timer.** Free har en brugsgrænse, der nulstilles hver femte time. Anthropic
  oplyser ikke et fast antal beskeder: lange chats, filer og værktøjer æder den hurtigere op. Når du
  rammer den, siger Claude det og fortæller, hvornår den nulstilles. På Free kan du ikke købe ekstra
  brug.
- **Værktøjer er dyre.** Hvert værktøjssæt, der er slået til, koster brug i hver besked, også når
  Claude ikke bruger det. Slå kun de sæt til, du skal bruge, på spilaftenen (core og play), og slå
  resten fra under **+**, **Connectors**. Se
  [Asking Claude](asking-claude.md#tool-sets-hvilke-kontakter-du-skal-tænde).
- **Start nye chats.** En lang chat koster mere for hver besked. Start en ny chat til hver
  forberedelsesopgave og til hver spilaften.
- **Grænsen deles.** Claude på nettet, i desktop-appen og på telefonen tæller alle med i den
  samme grænse.

Så på Free skal du forberede dig med Claude mellem sessionerne og bruge den let ved bordet. Hvis
en spilaften løber tør, så spil videre uden den: alt kan gøres i hånden i Foundry
([Runbook til spilaftenen](game-night-runbook.md)).

## Hvad Pro giver

| Hvad                  | Pro                                                                         |
| --------------------- | --------------------------------------------------------------------------- |
| Brug                  | Mindst fem gange Free-brugen pr. fem-timers session.                        |
| At løbe tør           | Du kan slå betalte brugskreditter til for at fortsætte efter grænsen.       |
| Modeller              | Også Opus, den stærkeste model, til svær forberedelse og regelspørgsmål.    |
| Projects              | Ingen grænse på fem.                                                        |
| Research, Claude Code | Med. Bruges ikke til dette værktøj.                                         |
| Pris                  | 20 USD om måneden eller 200 USD om året (priser i andre valutaer varierer). |

Skills, desktop extensions (den lokale slags forbindelse, værktøjet bruger), desktop-appen og
memory er ens på begge planer. Custom connectors (eksterne, via webadresse) er begrænset til én
på Free; værktøjet bruger dem ikke.

**Hvornår Pro er det værd:** når du rammer grænsen under forberedelse eller på spilaftenen oftere end
nu og da, eller når du vil have Claude ved bordet hele aftenen. Prøv Free først.

## Ikke afklaret endnu

- **Værktøjets forbindelse på Free.** Claude Desktop forbinder til spillet gennem et lokalt program
  (en lokal MCP-server). Anthropic opfører desktop extensions som inkluderet på Free, men deres
  hjælpesider siger ikke pr. plan, om servere sat op i Claude Desktops konfigurationsfil virker. Det
  har virket på Free før. Vi tester det på din PC før session 0.
- **Den præcise grænse.** Anthropic offentliggør ikke tal for Free; den afhænger af, hvor meget hver
  chat bruger.

## Kilder

- Planer og priser: <https://claude.com/pricing>
- Skills: <https://support.claude.com/en/articles/12512180-use-skills-in-claude>
- Projects: <https://support.claude.com/en/articles/9517075-what-are-projects>
- Brugsgrænser: <https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work>
- Lokale MCP-servere i Claude Desktop:
  <https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop>
- Custom connectors (eksterne, via webadresse; Free får én, værktøjet bruger dem ikke):
  <https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp>
