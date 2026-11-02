---
source: gm/after-session.md
sourceHash: b54459a76269
title: Efter hver session
description: En kort tjekliste til GM'en, når en spilsession er slut.
---

# Efter hver session

Gør det her lige efter, at spillerne er gået, mens Foundry og dashboardet stadig er åbne. Hvert punkt
er én handling.

## Luk sessionen

- [ ] Gennemgå **Recent Changes** i dashboardet. Hvis en ændring ikke skal blive, så klik på dens
      **Undo** (GM Actions skal være slået til for det, så gør det før næste punkt).
- [ ] Klik på **End session** i dashboardets header. Der skulle nu stå "No session". Det slår også
      det fra, som **Turn on for tonight** slog til, og **GM Actions**. Hvis administratoren har sat
      Discord-opslaget op, lægger botten linket til spillersiden i sin kanal inden for et par minutter.
- [ ] Hvis dashboardets header stadig siger **Live play on: all set**, så klik på **End session** (det slår live play fra).
- [ ] I Tarokka-skuffen (🃏 **Tarokka**, under **Advanced ▾**): fjern fluebenet ved **Show cards**, hvis det er sat.

## Slå funktioner fra

- [ ] I Foundry: fanen Settings (tandhjulet), **Game Settings**, kategorien **Foundry AI Tool**. Slå
      de "AI Tool: … (writes)"-funktioner fra, du ikke har brug for før næste gang. Klik på **Save
      Changes**. Undo virker stadig, selv om en funktion er slået fra.

## Recap og noter

- [ ] I Claude Desktop: kør prompten `session-recap` (`audience` gm) for din egen opsummering.
- [ ] Hvis du deler en recap med spillerne, så kør `session-recap` med `audience` players, og læs
      den igennem, før du sender den videre.
- [ ] Åbn denne sessions note i Obsidian (`Campaigns/<world id>/AI Tool/Sessions/`), og tjek, at den
      har aftenens begivenheder og statistik.
- [ ] Skriv dine egne noter i dine egne filer (for eksempel i `Campaigns/<world id>/Prep/`), ikke i
      de noter, værktøjet har lavet. En genereret note, du redigerer, holder op med at opdatere sig.

## Spillernes egne vaults (valgfrit)

Hver spiller kan have sin egen Obsidian-vault, som kun rummer det, vedkommende må se: de handouts, du
har vist dem, deres egen karakter og den offentlige play log. Dashboardet holder én mappe pr. spiller
opdateret (cirka hvert minut) og omskriver kun en mappe, når der er ændret noget i den. Ændringer,
der laves inde i en spillers mappe, går tabt ved næste opdatering.

- Sæt `FOUNDRY_AI_PLAYER_VAULTS_DIR` til en mappe, før du starter dashboardet, for at slå det til.
  Hver spiller får `<folder>/<player name>/`. Uden den bliver der ikke skrevet noget.
- Hvis du vil give spillerne en recap, så vis den som et handout med "Recap" i titlen. Den havner i
  vaultens mappe `Recaps/`, og spillersiden viser den som "Last recap". Selve journalen med
  session notes kommer aldrig ind i en spillers vault.
- At dele mapperne med spillerne følger med opsætningen på Orange Pi (en delt mappe, der kun kan
  sende, til hver spiller). Indtil da bliver mapperne på den computer, der kører dashboardet.

## Før du lukker ned

- [ ] Forlad Foundry (fanen Settings, **Log Out**), eller luk Foundry-fanen.
- [ ] Luk dashboardfanen. Dashboardet og bridgen kører videre på Pi'en; der er intet at stoppe.
- [ ] Afslut Claude Desktop, hvis du er færdig.

(På bygge-personens egen PC kører dashboardet i et terminalvindue: tryk Ctrl+C dér.)

## Hvis en spiller beder om at få sine data fjernet

Én kommando fjerner en spillers optegnelser fra bridge-vaulten: hvert slag, hver ændring og hver
chatbesked under vedkommendes Foundry-brugernavn samt dashboardets brugsoptegnelser. Det er med
vilje ikke et AI-værktøj: Claude kan ikke slette nogens data.

Du kører den ikke selv: giv anmodningen videre til den, der satte værktøjet op. Der skal bruges en
terminal på den maskine, der kører bridgen (Orange Pi, når spillet er hostet dér). Til dem:

1. Stop bridgen (bridgen skriver de her logs, så længe den kører; kommandoen afviser, indtil den er
   stoppet). På en PC: afslut Claude Desktop. På Pi'en: stop servicen foundry-ai-tool-bridge og
   start den igen efter trin 4.
2. Åbn en terminal i værktøjets mappe. Find world id med `npm run vault -- worlds`.
3. Se, hvad der ville blive fjernet, uden at ændre noget:
   `npm run vault -- forget-user <world id> <user name> --dry-run`
4. Fjern det: samme kommando uden `--dry-run`. Hvis du kun vil fjerne den chat, vedkommende skrev,
   og beholde slagene i statistikken, så tilføj `--chat-only`.
5. Obsidian-noterne indhenter det selv: når bridgen skriver GM-vaulten (altid på Pi'en), renderer
   den dem igen næste gang der sker noget i verdenen. Kør `npm run obsidian -- export` for at
   genopbygge dem med det samme, eller hvis bridgen ikke skriver en vault. Noter, der ikke længere
   bliver lavet, flyttes til Obsidians mappe `.trash`; tøm den. En note, du har redigeret i hånden,
   bliver som den er: tjek den.

Brugernavnet er Foundry-brugernavnet, ikke karakterens navn (`Player`, ikke `Test Hero`); Foundry
user id virker også. Det, Claude allerede har læst, da du spurgte den om noget, er sendt til
Anthropic og kan ikke trækkes tilbage.

Næste gang: [før hver session](before-session.md).
