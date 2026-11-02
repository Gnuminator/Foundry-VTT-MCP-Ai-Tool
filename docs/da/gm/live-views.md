---
source: gm/live-views.md
sourceHash: 94bf76eae694
title: Live-visningerne
description: De tre måder at have combat-strippen ved siden af Foundry (Live screen, GM page, Live window), hvor knappen Live views er, og hvornår du bruger hvilken.
---

# Live-visningerne

Under en kamp vil du have combat-rækkefølgen og de hurtige knapper (skade, conditions, party) i
syne, mens du kigger på kortet. Det kan gøres på tre måder. Alle tre ligger det samme sted: knappen
**Live views** øverst på dashboardet.

| Visning                   | Hvad det er                                          | Brug den, når                                                      |
| ------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| **Live screen**           | Én fast dashboard-side med stripen.                  | Du har en ekstra skærm eller en tablet ved siden af Foundry.       |
| **GM page**               | Foundry og stripen side om side i ét vindue.         | Du har én skærm og vil have ét browservindue til det hele.         |
| **Live window** (Foundry) | Et lille vindue inde i Foundry, ved siden af kortet. | Du vil have stripen inde i Foundry og er okay med et smalt vindue. |

## Live screen

Åbn **Live views**, og vælg **Live screen**. Der er ikke mere at sætte op.

## GM page

Åbn **Live views**, og vælg **GM page** (adressen er `/gm` på dashboardet). Foundry kommer frem til
venstre og stripen til højre.

- **Luk din almindelige Foundry-fane først.** En Foundry-bruger kan kun være logget ind én gang, så
  med Foundry åbent i en anden fane er dit navn gråt i listen over brugere inde i siden.
- Log ind inde i siden. Den gule besked "Can't see Foundry here?" øverst over Foundry forsvinder, når
  du er kommet ind.
- Stripen kan højst fylde 28 procent af bredden. Træk i skillelinjen, eller brug piletasterne på den.
  Strip right, Strip left og Foundry alone skifter uden at genindlæse Foundry. Dit valg bliver gemt.
- Hvis Foundry ikke vil åbne inde i siden, tilbyder siden at åbne det i sin egen fane.
- Dashboardet skal kende Foundrys adresse (`DASHBOARD_FOUNDRY_URL`). Gør det ikke det, siger menuen
  Live views det.

## Live window

Live window ligger inde i Foundry. Slå det til dér: **Settings**, **Configure Settings**, kategorien
**Foundry AI Tool**, **AI Tool: Live window**. En knap **Live** kommer så frem i gruppen AI Tool.
Hvis vinduet er tomt, siger det hvorfor og hvad der skal ændres; den sædvanlige årsag er indstillingen
**AI Tool: Live window address**.

Dashboardet kan ikke slå indstillingen til for dig, fordi den ligger i din Foundry-browser.
