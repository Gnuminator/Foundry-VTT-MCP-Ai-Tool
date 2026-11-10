---
source: gm/getting-started.md
sourceHash: b45bf2fa60b8
title: Kom i gang
description: Hvad Foundry AI Tool er, dets dele i almindeligt sprog, hvordan de hænger sammen og hvordan det sættes op.
---

# Kom i gang

Den her side er til en GM, der er ny i Foundry VTT og i dette værktøj. Læs den én gang fra top til bund.
De andre GM-sider bygger videre på den.

## Hvad værktøjet er

Foundry AI Tool lader Claude (en AI) læse dit Foundry-spil og ændre i det. Det giver dig også et
kontrolpanel i browseren, dashboardet, der viser bordet live.

Du bestemmer stadig selv, men kend de to slags ændringer:

- **Guarded changes.** Damage, healing, conditions, spell slots, flytning og redigering af tokens, og
  værktøjets egne funktioner (party, Tarokka, handouts, Obsidian mirror): Claude laver en plan, du
  godkender den, og hver sådan ændring kan fortrydes.
- **Direct actions.** Mange af Claudes andre værktøjer (rolls, nye NPC'er, journals, chat
  og mere) virker, så snart Claude bruger dem, og værktøjet kan ikke fortryde dem. [Spørg Claude](asking-claude.md)
  viser hvilke, og hvordan du får Claude Desktop til at spørge først, hvis du vil have det.

Spillerne får deres egen side. Den er bygget til at udelade det, kun GM'en skal se.

## Delene

| Del                | Hvad det er                                                                 | Hvad du bruger det til                                                        |
| ------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Foundry VTT**    | Det virtuelle bord. Du og spillerne er med i det i en browser.              | At køre spillet: kort, tokens, karakterark, terninger, chat.                  |
| **Modulet**        | "Foundry AI Tool", et tilføjelsesmodul i Foundry.                           | Det lader bridgen læse og ændre din world. Du rører sjældent ved det.         |
| **Bridgen**        | Et lille program på hjemmeserveren (Orange Pi).                             | Det forbinder Foundry, Claude Desktop, dashboardet og Obsidian.               |
| **Claude Desktop** | Anthropics Claude-app på din computer. En lille klient når bridgen for den. | At spørge Claude om spillet, forberedelse, regler og planlagte ændringer.     |
| **Dashboardet**    | En webside på din anden skærm.                                              | Dit kontrolpanel: Live Feed, combat, godkende og fortryde ændringer.          |
| **Spillersiden**   | En skrivebeskyttet side i dashboardet på `/player`.                         | Det, spillerne må se: combat order, et sikkert feed, handouts, recaps.        |
| **Obsidian**       | En notesapp. Værktøjet skriver noter ind i en Obsidian-vault.               | Læsning og forberedelse: session notes, ændringshistorik, stats, world-noter. |
| **Orange Pi**      | En lille hjemmeserver, der altid er tændt.                                  | Kører Foundry, bridgen og dashboardet hele tiden.                             |

## Hvordan de hænger sammen

- **Foundry er der, hvor spillet foregår.** Kort, tokens, ark, terninger og chat bor alle der.
- **Dashboardet er dit kontrolpanel.** Åbn det på en anden skærm. Det viser Live Feed og
  combat. Før det ændrer noget, beder det dig bekræfte. Ved en planlagt ændring lister det, hvad
  der vil ændre sig. Hver guarded change, uanset om den kom fra dashboardet eller fra Claude, står
  der med Undo.
- **Claude Desktop er der, hvor du taler med Claude.** Claude læser spillet gennem bridgen. Til
  de guarded funktioner laver den en plan, viser den til dig og venter på dit ja, før den
  apply'er den. Du kan også selv apply'e dens plan i dashboardet.
- **Obsidian er til læsning og forberedelse.** Værktøjet skriver noter dér, efter at der er sket noget. Intet,
  du skriver i Obsidian, løber tilbage til Foundry af sig selv. Den ene undtagelse er en quest-note i
  din `Prep`-mappe: du kan importere den som en quest-journal kun til GM'en, efter du har bekræftet en plan (se
  [Funktioner og hvornår du slår dem til](features.md#obsidian-import)).
- **Bridgen forbinder dem.** Modulet inde i Foundry taler med bridgen. Claude Desktop og
  dashboardet taler også med bridgen.

```text
  Claude Desktop ──┐
                   ├──► bridge ◄──► module in the server's Foundry browser ──► your game
  dashboard ───────┘      │
                          └──► Obsidian notes (one way)
```

To ting, du skal vide fra start:

- Modulet kører inde i en Foundry-browser på serveren, logget ind som en hjælper-GM kaldet
  Assistant GM. Det holder forbindelsen til bridgen, så værktøjet virker, selv når ingen menneskelig GM er logget
  ind, og din egen browser kører aldrig bridgen. Går det ned, så fortæl det til værktøjets admin.
- Spillere bruger aldrig bridgen. De ser Foundry som sædvanligt. De kan også åbne spillersiden. Den
  ligger bag den samme login med e-mailkode som spillet.

## Hvad der er særligt ved Curse of Strahd

- **Tarokka-læsning.** Træk en læsning med værktøjets indbyggede roll, eller vælg de
  fem kort selv. Kortene er kun for GM'en og ligger uden for Foundry. Du kan koble hvert kort til en
  journal-side, en scene eller en actor. Du afslører et kort ved at skrive den tekst, spillerne må læse.
- **En spoilersikker spillerside.** Den viser navne, som spillerne kender dem ("Unknown creature"
  ellers), ingen HP-tal på fjender, kun offentlige rolls og kun de handouts, du afslører.
- **Handouts.** Afslør en journal-side for spillerne. Den vises på spillersiden, og de kan
  åbne den i Foundry.

Tarokka- og handout-funktionerne er slået fra, indtil du slår dem til i Game Settings (se
[turen rundt i dashboardet](dashboard.md)).

Ordlisten med Foundry-ordene og værktøjsordene i guiderne ligger på siden [Ordliste](glossary.md).

## Sådan er det sat op

Til kampagnen kører Foundry, bridgen, dashboardet og Assistant GM-browseren alle på
hjemmeserveren Orange Pi, og du starter ikke noget dér selv. Din egen del er lille: installér
forbindelsen til Claude Desktop én gang ([Forbind Claude Desktop til serveren](connect-claude-desktop.md)),
og brug så [tjeklisten før session](before-session.md). Du når Foundry og dashboardet
gennem Cloudflare, som af og til beder om en kode på e-mail.

### Opsætning på adminens egen PC (Windows)

> **Note: denne del er til værktøjets admins egen Windows-PC** (og som nødplan, hvis serveren
> fejler på spilaftenen). Du gør den ikke. Serverens opsætning står i
> [docs/dev/PI-SETUP.md](../../dev/PI-SETUP.md).

På adminens egen PC kører alt på én Windows-PC: Claude Desktop, bridgen, dashboardet
og den browser, hvor du er logget ind i Foundry som GM.

1. **Foundry 14 med dnd5e-systemet.** Værktøjet understøtter Foundry 14 med dnd5e 6.
2. **Installér modulet.** På Foundrys setup-skærm: **Add-on Modules**, **Install Module**, indsæt
   manifest-URL'en fra [README](../../../README.md#installation) i **Manifest URL**,
   **Install**.
3. **Slå modulet til i din world.** I worlden: Settings tab (tandhjulet), **Module
   Management**, sæt kryds ved **Foundry AI Tool**, gem.

Trin 4 til 6 gøres én gang, af den, der satte værktøjet op til dig. De kræver Node.js, git, en kopi af
værktøjet bygget én gang og en terminal. [README](../../../README.md#installation) har kommandoerne.

4. **Forbind Claude Desktop.** Bridgen tilføjes til Claude Desktops konfigurationsfil
   (`claude_desktop_config.json`; Store-versionen af Claude Desktop har den i
   `%LOCALAPPDATA%\Claude-Data\claude_<pakke-id>\`, ældre versioner i `%APPDATA%\Claude\`;
   installeren finder den rigtige og skriver, hvilken den ændrede), som fem poster: `foundry-mcp` (core) og `foundry-mcp-play`,
   `-prep`, `-build`, `-admin`. Afslut og genstart Claude Desktop. Herefter starter Claude Desktop
   bridgen, når det selv starter. Vælg så, hvilke værktøjssæt der er slået til: se
   [Spørg Claude](asking-claude.md#tool-sets-hvilke-kontakter-du-skal-tænde).
5. **Dashboardet.** Det startes i hånden: åbn en terminal i værktøjets mappe og kør
   `npm run dev:cogm`. Lad vinduet stå åbent, for lukker du det, stopper dashboardet. Åbn så
   `http://localhost:3000` i din browser.
6. **Obsidian (valgfrit).** Bridgen skriver noter ind i en Obsidian-vault, når den ved, hvor
   vaulten er: `FOUNDRY_AI_OBSIDIAN_DIR` i `env`-delen af hver `foundry-mcp`-post i Claude
   Desktops konfiguration. Til dashboardets 📓-links skal du også sætte `OBSIDIAN_VAULT_NAME` (eller
   `FOUNDRY_AI_OBSIDIAN_DIR`) i `packages/cogm-dashboard/.env`.

### Monsters, spells og regler i Obsidian (Library)

Når Foundry-mirroret er slået til, viser NPC-noter hele stat blocken og portrættet, scene-noter
viser kortet, og journal-sider beholder deres tabeller og billeder. Bed Claude tilføje compendiums til
mirrorets Library (`plan-obsidian-mirror` med `libraryPacks`, for eksempel dine monsters,
spells, classes og feats), og værktøjet skriver en note for hver post i `AI Tool/Library/`:
monsters med stat blocks, spells, items, classes med deres features efter level, subclasses,
species, backgrounds og feats. Billeder kopieres til `AI Tool/Attachments/`.

Library er sorteret efter slags og så efter bog: `AI Tool/Library/Monsters/Monster Manual (2024)/`,
`AI Tool/Library/Spells/Player's Handbook (2024)/` og så videre. Poster uden bog kommer i
`Other`. Noter har egenskaberne `book` og `page`, når compendiet angiver dem, og
`AI Tool/Library/Books/` har én note pr. bog, der lister alt fra den bog. Hver
Library-note linker til sin bogs note, så hver bog bliver et knudepunkt i Obsidians graph view. Noterne
om din world følger Foundrys egne mapper på samme måde: en journal i Foundrys mappe "Act 1"
ligger i `AI Tool/Foundry/Journals/Act 1/`. Når noget flytter sig i Foundry, flytter dets note med.
En note, du har redigeret, bliver, hvor den er, og `_status.md` lister den.

Hvert eventyr får også en hub-note i `AI Tool/Foundry/Adventures/`: en Foundry-mappe på øverste niveau
med journals og scenes i (med samme mappenavn til hver, som en adventure-import laver dem)
tæller som et eventyr. Huben linker til hvert kapitel, hver scene, NPC og item-note i den og til
bogens note i Library. For at farvelægge grafen efter eventyr skal du køre **Apply AI Tool graph colours**
i Obsidian (kommandopaletten, eller knappen i AI Tool-pluginets indstillinger): hvert eventyr får
en farve, og Library bliver grå. Dine egne farvegrupper bliver, foran vores.

Det er bogindhold, du har købt, så det bliver på din computer:

- Værktøjet skriver en `.gitignore`, der holder `Library/` og `Attachments/` ude af git.
- Ligger din vault i et git-repository, der ville samle de andre mirror-noter op, udelader værktøjet
  stat blocks, sidetekst og billeder dér, og `AI Tool/Foundry/_status.md` siger,
  hvordan du retter det.
- Kører bridgen på en anden computer end Foundry, så sæt `FOUNDRY_AI_FOUNDRY_URL` til
  Foundrys adresse, så billederne kan hentes.

Hver gang du spiller, er rækkefølgen enkel: start Claude Desktop, åbn Foundry og join som
GM, åbn dashboardet i din browser. [Tjeklisten før session](before-session.md) har
detaljerne. (På adminens egen PC startes dashboardet også i hånden, med
`npm run dev:cogm`.)

## Næste

- [Dashboardet](dashboard.md)
- [Spørg Claude](asking-claude.md)
- [Før hver session](before-session.md)
