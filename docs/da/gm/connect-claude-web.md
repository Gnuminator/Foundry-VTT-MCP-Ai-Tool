---
source: gm/connect-claude-web.md
sourceHash: e0922e99a002
title: Forbind Claude med webadresse (uden installer)
description: Tilføj de fem Foundry-connectors til Claude som custom connectors med en adresse og et login med din e-mail, uden Windows-klienten og uden tunnelnøgle.
---

# Forbind Claude med webadresse (uden installer)

Der er to måder at give Claude Foundry-connectorerne på. Den første er den lille Windows-klient i
[Forbind Claude Desktop til serveren](connect-claude-desktop.md). Den anden er denne side: du tilføjer
hver connector til Claude med dens **webadresse** og logger ind med din e-mail. Der er ikke noget at
installere, og der er ingen tunnelnøgle. Det virker i Claude Desktop og i Claude på nettet, på en
hvilken som helst PC.

Den, der administrerer værktøjet (tool admin), skal først have slået denne vej til. Passer siden
nedenfor ikke med det, du ser, så spørg vedkommende. Installer-vejen virker stadig, og du kan bruge
den i stedet.

Du skal bruge: en Claude-konto og de fem adresser fra tool admin. Cirka 5 minutter.

**Tjek din plan først.** En gratis Claude-plan tillader kun **én** custom connector, og de fem
Foundry-connectors er fem. På Free bruger du Windows-klienten i stedet (se
[Claude Free eller Pro](claude-plans.md)). På Pro kan du tilføje alle fem.

## De fem adresser

Hver connector er ét sæt tools med sin egen adresse, så kontakterne i **+**-menuen virker som med
installeren. Tool admin sender dig adresserne. De begynder ens og slutter med navnet på sættet:

| Connector | Adressen slutter på | Hvad den er til                                  |
| --------- | ------------------- | ------------------------------------------------ |
| Core      | `/mcp/core`         | Slå ting op, gennemse og fortryd ændringer       |
| Play      | `/mcp/play`         | Kør bordet: tokens, kamp, terningkast, chat      |
| Prep      | `/mcp/prep`         | Forbered sessioner, quests, handouts, pre-flight |
| Build     | `/mcp/build`        | Lav og ret NPC'er, monstre og items              |
| Admin     | `/mcp/admin`        | Moduler, indstillinger, ejerskab, Obsidian-spejl |

Core, Play og Prep bruger du mest. Tilføj Build og Admin, når du får brug for dem.

## Tilføj dem

Gør det én gang pr. connector.

1. Åbn **Settings** i Claude, så **Plugins**, og vælg "Add custom connector".
2. Skriv et navn, du kan genkende (for eksempel `Foundry Play`), og indsæt connectorens adresse. Lad
   eventuelle avancerede felter stå tomme. Tryk **Add**, så **Connect**.
3. En Cloudflare-side beder om din e-mail. Brug den e-mail, tool admin har til dig som GM. Cloudflare
   sender dig en kode; skriv den ind. Claude siger så, at den er forbundet.
4. Gentag for de andre connectors. Det går hurtigt efter den første.
5. Åbn en ny chat, klik på **+**, vælg **Plugins** og slå dem til, du vil bruge i den chat, som i
   [Spørg Claude](asking-claude.md#tool-sets-hvilke-kontakter-du-skal-tænde).

Gør også afsnittet [Stop "Allow"-spørgsmålene](connect-claude-desktop.md#stop-allow-spørgsmålene) fra
installer-siden for hver connector: skærmbillederne er de samme.

## Tjek, at det virker

Spørg Claude _"What world is open in Foundry?"_ Et normalt svar med verdenens navn betyder, at du er
forbundet. Med Prep slået til kan du spørge _"Run get-preflight"_ for det fulde tjek.

## Godt at vide

- **Kun GM'er kommer ind.** Cloudflare tjekker din e-mail, og værktøjet tjekker den igen mod listen
  over GM'er. En spillers login åbner aldrig disse adresser.
- **Plan, bekræft og fortryd er det samme.** En ændring planlægges først, vises for dig, udføres efter
  dit ja og gemmes i Recent Changes med en Undo, præcis som med installeren.
- **En langsom ændring kan ligne en fejl.** Hvis en ændring tager mere end halvanden minut, kan Claude
  sige, at kaldet stadig kører, eller vise en fejl (en Cloudflare 524), selv om ændringen gik igennem. Før du prøver igen, så bed Claude
  om at vise de seneste ændringer, eller åbn **Recent Changes** på dashboardet.
- **Hvis tool admin fjerner dig fra listen,** holder connectorerne kort efter op med at virke, næste gang Claude kalder et tool.
- **På en plan B-aften** kan serveren ikke nås, og connectorerne virker ikke, som resten
  ([Game night runbook](game-night-runbook.md#serveren-er-nede)).

## Hvis noget ikke virker

- **Claude siger, at connectoren ikke kunne forbinde:** tjek, at du har indsat hele adressen med
  `/mcp/...`-delen, og at din e-mail er den, tool admin har til dig.
- **Loginsiden siger, at du ikke har adgang:** din e-mail står ikke på GM-listen. Fortæl tool admin,
  hvilken e-mail du brugte.
- **Én connector virker, og en anden siger, at den er slået fra:** slå den til i **+**-menuen, så
  **Plugins**.
- **Det virkede ikke i dag:** åbn spillets adresse. Hvis den ikke indlæses, er serveren nede; se
  [Game night runbook](game-night-runbook.md).

## Fjern en

Settings, **Plugins**, vælg connectoren og fjern den. Der er ikke gemt andet på din PC.
