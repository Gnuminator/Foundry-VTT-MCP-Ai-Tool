---
source: gm/dashboard-player-pages.md
sourceHash: 28f541d13e5f
title: 'Dashboardet: spillersider og Obsidian'
description: 'Spillersiden, afsløring af et handout, spillerlinks, My character og Open in Obsidian.'
---

# Dashboardet: spillersider og Obsidian

Part of [Dashboardet](dashboard.md).

## Spillersiden (/player)

Den side, spillerne kigger på: dashboardets adresse med `/player` til sidst. Åbn den selv før en
session for at tjekke, hvad de ser. Den følger aftenen. Mens en session er åben (eller en combat
kører), kommer de levende kort først: Combat order, Live Feed og derefter Handouts. Mellem
sessionerne åbner den med Last recap, Handouts og Quests, og de levende kort rykker ned. Dens dele:

- **Who are you?** Ved en spillers første besøg en liste med navne. Valget afgør kun, hvilke
  handouts "just for you" der vises; headeren siger derefter "Playing as ..." med en **Not you? Change**-knap til at
  vælge igen. **Skip** lader det være uvalgt.
- **You**: øverst, for en spiller, der åbnede sit eget `/me`-link på den enhed: "Your turn" eller "You
  are up next", et lille kort for hver af deres karakterer (HP, conditions, concentration) og en
  concentration-påmindelse, når de tager damage. Deres åbne roll-anmodninger vises her som
  **Roll**-knapper.
- **Open your character sheet**: et link til `/me`. Øverst mellem sessionerne, nederst under en
  session.
- **Combat order**: initiative og navne, som spillerne kender dem. PC'er har en HP-bar; enemies og NPC'er
  har ingen HP-tal og ingen bånd: spillerne spørger dig, hvem der er såret. (Det grove bånd, healthy,
  bloodied, critical, down, er en kontakt for værten: `PLAYER_SHOW_ENEMY_HP_BANDS=true`.) Kun
  almindelige conditions vises. Skjulte væsener udelades, og et væsen, hvis navn spillerne ikke kan se,
  er "Unknown creature".
- **Live Feed**: offentlige rolls og det, spillerne kunne se ske, med væsener navngivet, som
  spillerne kender dem. Private, blinde og GM-rolls vises aldrig. Damage- og healing-beløb vises kun
  for PC'er (andre er bare "was hit").
- **Last recap**: den nyeste afslørede side, hvis titel siger "recap" (eller "opsummering",
  "resume").
- **Handouts**: sider, du afslørede, med hemmelige sektioner, inline rolls og links til uafslørede
  sider fjernet. En side afsløret siden sessionen startede (eller, mellem sessionerne, siden den
  forrige sluttede) har et **New**-mærke. En side til udvalgte spillere siger "just for you".
- **Quests**: afslørede sider, hvis titel siger "quest" (eller "opgave").

Headeren viser worlden, scenens **Navigation Name** (ellers "Current scene", aldrig det rigtige
navn) med dens tid på dagen (kun på scener med global illumination) og vejr, for eksempel "Village
Square (Dusk, Rain)", og en status: "Live", "Foundry is offline. Wait a moment.", "Not connected. Wait a moment." eller
"Connecting…".
Med The Veil-temaet har footeren også et **Mist**-valg, som kun ændrer den enhed.

Spillerne åbner den fra deres egne enheder, bag det samme login med e-mailkode som Foundry.

### Afslør et handout

I Foundry arver sider deres journals ejerskab. Hvis du først giver spillerne Observer på en journal,
kan hver side i den læses med det samme, før nogen reveal. Så gør det i denne rækkefølge:

1. **Lav én journal kun til handouts.** Fanen Journal (bogikonet), **Create Journal Entry**, giv den
   et navn, for eksempel "Handouts". Læg kun handout-sider i den.
2. **Sæt hver side i den til None.** Åbn journalen. I dens sideliste, højreklik på en side,
   **Configure Ownership**, sæt **All Players** til **None** (ikke Inherit), **Save Changes**. Gør
   det for hver side, og for hver side, du tilføjer senere.
3. **Først derefter hæver du journalen.** I fanen Journal, højreklik på journalen, **Configure
   Ownership**, sæt **All Players** til **Observer**, **Save Changes**. Spillerne kan nu åbne
   journalen, men ingen side i den.
4. **Slå featuren til.** Game Settings, kategorien **Foundry AI Tool**, sæt kryds ved "AI Tool:
   Handouts (writes)", **Save Changes**.
5. **Planlæg og anvend revealen.** Bed Claude med prompten `reveal-handout`, eller kør værktøjet
   `plan-page-reveal` med `action` reveal og anvend planen. Confirm-vinduet viser, hvad der ændres.
   For kun at afsløre den for nogle spillere, udfyld `players`. For at forberede reveals i forvejen
   før sessionen, sæt dem i kø i stedet (se "Handout-skuffen").

Siden vises på spillersiden inden for få sekunder, og spillerne kan åbne den i Foundry.
`plan-page-reveal` med `action` hide tager den tilbage. Før en session, åbn spillersiden og tjek, at
listen Handouts kun viser det, du afslørede.

## Spillerlinks og My character (/me)

Hver spiller kan have sin egen karakterside: deres sheet på en telefon eller laptop, skrivebeskyttet,
og opdateret under spillet (HP, spell slots, conditions, resources). Den åbner fra et privat link,
som du laver én gang pr. spiller.

1. **Advanced**, **🔗 Player links**. Panelet viser hver spiller (ikke-GM) i worlden.
2. **Make link** ved siden af en spiller. Linket bliver kopieret; send det til den spiller i en
   direkte besked, ikke i bordets chat. Senere kopierer **Copy link** det igen.
3. Spilleren åbner det én gang. Siden husker det på den enhed, så det bagefter virker fra et bogmærke
   eller hjemmeskærmen.

Siden viser kun de karakterer, som spillerens Foundry-bruger **ejer** (Owner-tilladelse på actoren).
For at give en spiller sin karakter, sæt deres ejerskab i Foundry, som du plejer; andet er ikke
nødvendigt. En spiller, der ikke ejer nogen karakter, ser "Ask your GM".

- **New link** laver et nyt link og slår det gamle fra (til en tabt telefon, eller et link sendt til
  den forkerte).
- **Remove** slår linket fra uden et nyt.

Siden har fire visninger, og hver spiller vælger sin (husket på deres enhed):

- **At the table**: store HP, AC og initiative, conditions, spell slots, resources, attacks og
  prepared spells. Den følger dashboardets tema.
- **Paper 2024** (standard-papirvisningen) og **Paper 2014**: sort på hvidt, i den samme rækkefølge som
  det trykte karakterark i den udgave, så en spiller kan skrive det af på papir eller printe det
  (**Print** nederst).
- **Paper night**: et ark til et bord, der spiller på papir. Hver blok viser værdien, som den var, da
  arket blev printet, og en boks til at skrive den nye i. **Print all party sheets** i panelet Player
  links printer hver karakters paper-night-ark, to sider hver (kun GM).

Det, siden udelader: GM'ens hemmelige sektioner i beskrivelser, de sande navne på uidentificerede
items (den viser, hvad spilleren ser i Foundry) og enhver actor, spilleren ikke ejer. Som
spillersiden er den live på Pi bag login med e-mailkode, så spillerne når den fra deres egne
enheder.

## Open in Obsidian (📓)

📓-linkene åbner noter i Obsidian: kampagnens Home-note (headeren), en måneds ændringshistorik (hver
række i Recent Changes) og den aktuelle Tarokka-læsning (Tarokka-skuffen). De vises kun på GM-siden,
og kun når dashboardet kender navnet på din Obsidian-vault (indstillingen `OBSIDIAN_VAULT_NAME` eller
`FOUNDRY_AI_OBSIDIAN_DIR` i dashboardets egen `.env`-fil; den, der satte værktøjet op, tilføjer den).

Den anden vej har noter fra Foundry-mirroren i Obsidian **Open in Foundry**-links. De åbner en lille
dashboard-side, der beder dig klikke på **Open**; dokumentet åbner derefter på din Foundry-skærm, og
intet i worlden ændres.

### Obsidian-pluginet (valgfrit)

Et lille plugin til Obsidian på din pc gør det til ét trin og viser handout-status på selve noten. Den,
der satte værktøjet op, installerer det med `scripts/install-obsidian-plugin.ps1` (eller pakker
`foundry-ai-tool-obsidian.zip` fra en release ud i vaultens mappe `.obsidian/plugins`); slå derefter
**Foundry AI Tool** til under Settings, Community plugins. I dets indstillinger er dashboard-adressen
den, du åbner i din browser, for eksempel `http://localhost:3000`.

På en note fra Foundry-mirroren:

- **Open in Foundry**: fra command palette (Ctrl+P), notens **...**-menu eller et klik på Foundry-linjen
  i statuslinjen nederst. Den åbner med det samme, ingen ekstra side.
- **Handout status**: på en journalside-note siger statuslinjen, om spillerne kan se siden (not
  revealed, queued, revealed, revealed as a copy), og hvor mange der har åbnet den.
- **Reveal to players** og **Hide from players** (command palette): pluginet laver planen og åbner
  dashboardet, som viser det sædvanlige confirm-vindue. Intet ændres, før du bekræfter der, og
  ændringen får **Undo** i Recent Changes som enhver anden.
- **Add to the handout reveal queue**: sætter siden i handout-skuffens kø, så du kan afsløre den med
  **Reveal next** under sessionen. Spillerne ser endnu intet. **Remove from the handout reveal queue**
  tager den ud igen.

På dine egne prep-noter (se [Din Obsidian-vault](obsidian.md)) har command palette også **New prep
note for this**, **Import this quest prep note into Foundry (confirm in the dashboard)** (kræver
module-kontakten "AI Tool: Obsidian import (writes)"; dashboardet viser det sædvanlige
confirm-vindue, og Undo fjerner journalen) og **Toggle: Claude may read this prep note**.

Pluginet giver også hele vaulten dashboardets udseende, dine egne noter inklusive. Dets
**Theme**-indstilling har **Neutral**, **The Veil** og **Off**. Der er ét tema pr. world: vælg Neutral
eller The Veil der, og dashboardet skifter også, og når du vælger et tema i dashboardet, følger
Obsidian inden for et halvt minut. **Off** slår kun udseendet fra i Obsidian. Temaet giver stat blocks
et kort, viser GM-hemmeligheder med en lås, så du aldrig kommer til at læse en op ved en fejl, og
gør en sessions stats til små kort.

Pluginet taler kun med dashboardet. Når dashboardet ikke kører, siger statuslinjen "dashboard
offline", og intet andet ændres.
