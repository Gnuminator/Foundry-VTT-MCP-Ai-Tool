---
source: gm/never-and-only-if.md
sourceHash: cf33a138fa87
title: Gør aldrig det her, gør kun det her hvis
description: Korte regler til GM'en, hver med sin begrundelse på én linje.
---

# Gør aldrig det her, gør kun det her hvis

Korte regler. Hver har sin begrundelse på linjen under.

## Gør aldrig det her

- **Vis aldrig dashboardet, Claude Desktop eller Obsidian på en skærm, spillerne kan se, og
  del aldrig de vinduer i Discord eller et videoopkald.**
  De viser rigtige navne, præcis HP, private roll, GM-noter og Tarokka-kortene.
- **Giv aldrig spillerne dashboardets GM-adresse eller GM-token.**
  GM-siden kan ændre spillet og viser alle hemmeligheder; spillerne får kun `/player`.
- **Send aldrig en whisper, der nævner en hemmelighed.**
  En whispers tekst når frem til alle spilleres browsere; kun visningen er skjult.
- **Anvend aldrig en plan, du ikke har læst.**
  Listen over ændringer i confirm-vinduet er din eneste forhåndsvisning.
- **Slå aldrig "AI Tool: Let players connect it" til.**
  Modulets forbindelse til bridgen er kun bygget til GM'ens browser; det her lader en spillers
  browser oprette den.
- **Omdøb eller flyt aldrig modulets mappe `foundry-mcp-bridge`.**
  Foundry indlæser kun et modul fra en mappe, der er opkaldt efter dets id.
- **Slet aldrig bridge-vaultens mappe.**
  Den holder Tarokka-læsningen, de afslørede handouts, ændringshistorikken og loggene, og
  Foundrys backup af worlden tager den ikke med.
- **Åbn aldrig dashboardet mod dit netværk eller internettet uden et GM-token.**
  Alle, der når GM-siden, kan ændre dit spil.
- **Kør aldrig en anden bridge ved siden af den, der allerede kører.**
  To bridges konkurrerer om de samme porte, og forbindelsen til Foundry kan gå i stykker.

## Gør kun det her hvis

- **Klik kun på Start session, når spillet begynder, og på End session, når det slutter.**
  Start session er den eneste knap til live play: den slår GM Actions og de fem kontakter, en
  aften skal bruge, til (Allow Write Operations, Handouts, Live play, Party og Tarokka). Resten, for
  eksempel Obsidian-spejlet og -importen, session notes, scene mood og room setup, forbliver slået fra,
  til du slår dem til. Med live play slået fra kan et fejlklik ikke ændre
  noget. End session (eller Pre-flights "Turn them off again") slår det hele fra igen.
- **Sæt kun flueben ved "Show cards" i Tarokka-skuffen, hvis ingen andre kan se din skærm.** (Skuffen
  ligger under Advanced ▾.)
  Kortenes navne er kampagnens største hemmelighed.
- **Løft kun en journal til Observer, når hver side i den er sat til None.**
  Sider arver journalens ejerskab, så hver side, der står på Inherit, bliver læsbar med det samme.
  [Dashboard-turen](dashboard.md#afslør-et-handout) har trinene.
- **Fortryd kun en afsløring, hvis du accepterer, at spillerne måske allerede har læst den.**
  Undo skjuler siden igen, men ingen glemmer.
- **Sæt kun en tokens Display Name til "Hovered by Anyone" eller "Always for Everyone", hvis spillerne må
  kende den skabnings navn.**
  Spillersiden viser så dens navn.
- **Lad kun en scene stå uden Navigation Name, hvis dens rigtige navn ikke er en spoiler.**
  Foundrys navigationslinje kan vise spillerne det rigtige navn; et Navigation Name erstatter det.
- **Ret kun en note, værktøjet har lavet, i Obsidian, hvis du vil have den frosset.**
  Værktøjet overskriver aldrig en note, du har rettet, så den holder op med at blive opdateret (den står i
  `AI Tool/_status.md`, eller `AI Tool/Foundry/_status.md` for noter om PC'er, NPC'er, scenes og
  journals).
- **Slå kun "Allow Write Operations" fra, hvis du vil have, at værktøjet ikke ændrer noget.**
  Det stopper alle ændringer fra Claude og fra dashboardet, chatbeskeder og Undo med;
  læsning virker stadig.
- **Vælg kun "Always allow" til de værktøjer, der ændrer spillet, hvis du er tryg ved ikke at blive spurgt
  af Claude Desktop.** Ændringer gennem planen bliver stadig bekræftet og kan fortrydes; direkte
  handlinger (roll, nye NPC'er, journals, chatbeskeder) bliver ikke. Sæt **Write/delete tools** til
  **Needs approval** for at blive spurgt hver gang.
- **Dashboardet kalder aldrig den betalte API.** En nøgle på maskinen gør ingenting der.
