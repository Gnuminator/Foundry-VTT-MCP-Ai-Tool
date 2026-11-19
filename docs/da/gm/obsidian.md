---
source: gm/obsidian.md
sourceHash: d0908a431b35
title: Din Obsidian-vault
description: GM'ens Obsidian-vault på din egen pc, hvad du kan redigere i den, og hvordan du forbinder AI Tool-pluginet til dashboardet på serveren.
---

# Din Obsidian-vault

Værktøjet skriver din world ind i en Obsidian-vault på serveren, og Syncthing kopierer den over på
din pc ([Engangsopsætning: din vault på din pc](setup-obsidian-sync.md)). Du læser den i Obsidian som alle andre noter. Det er GM'ens vault: den har hemmelighederne
og bogteksten, så den bliver på din pc. Spillerne får deres egne vaults uden hemmelighederne.

## Hvad der er i den

- **Home:** din startside til kampagnen, `Home.md` i worldens mappe. Den er sorteret efter, hvad
  du laver (før, under og efter en session) med links og levende tabeller til NPC'er, scenes,
  quests, story items og session notes. Værktøjet laver den én gang og omskriver den aldrig, efter
  du har redigeret den. Knappen 📓 ved siden af Start session i dashboardet åbner den.
- **AI Tool-mappen:** noter, værktøjet skriver. Karakterer, NPC'er, scenes, journals, quests,
  Library (monsters, spells, regler), session notes og statistik, og under `Everyone` én note pr.
  dag med hver ændring, som spillerne, du og AI'en lavede i Foundry (hvem, hvornår, hvad. Fortryd i
  dashboardet, ikke her). Værktøjet omskriver disse, så planlæg ikke dit spil i dem. En note, du
  har redigeret, bliver liggende og står i `_status.md`. En redigeret dagsnote under `Everyone`
  står ikke der, den holder bare op med at blive opdateret.
- **Prep-mappen:** din. Værktøjet ændrer aldrig dine noter dér. Dine sessionsplaner og noter om
  NPC'er, steder og quests hører hjemme her, og Claude læser dem, når du forbereder en session (se
  [cookbook](cookbook.md), "Tip for Obsidian"). Prep/Templates har en skabelon til en NPC, et
  sted, en quest og en sessionsplan.

> **Usikker? Spørg Claude.** Spørg GM coach: "Hvad bruger jeg Obsidian til i mit spil, og hvilke noter skal jeg selv skrive?" ([sådan tilføjer du GM coach](gm-coach.md))

## Seen in

En NPC-note og en scene-note har en **Seen in**-liste: de sessioner, hvor den NPC eller scene
dukkede op, nyeste først, hver et link til sessionsnoten. Den kommer fra det, Foundry registrerede
ved bordet, så den kræver ingen opsætning og gætter aldrig ud fra navne. Kun det, spillerne så,
tæller: der bliver intet listet, mens ingen spiller er forbundet (din forberedelse, at lave NPC'er
og at placere tokens tæller aldrig). En NPC tæller, når den rullede, talte, brugte noget, blev
ramt eller helbredt, tog sin turn i combat, eller havde en synlig token på den aktive scene, da du
aktiverede den, eller en spiller kom ind. Hvad der sker med en skjult token (damage, conditions,
dens turn i combat), et hvisket eller blindt roll og en scene, du kun forhåndsviste, tæller ikke. Et
offentligt roll fra en skjult NPC gør, fordi spillerne læser det i chatten. Spillere, der kom ind,
før du markerede sessionens start, tæller stadig. Egenskaben `last_seen` har datoen for den nyeste
session, til at sortere efter i en Base. En spillerkarakter har ingen liste, fordi dens stats-note
siger det hele.

## Lav en prep-note

På en NPC-, scene- eller quest-journal-note åbner du notens filmenu (de tre prikker) og klikker
**New prep note for this**, eller kører kommandoen med samme navn. Vælg slags (den sandsynlige er
først). Pluginet laver en note i Prep (for eksempel Prep/NPCs/Ismark.md) ud fra skabelonen, binder
den til tingen i Foundry og linker tilbage til den. Udfyld, hvad du har brug for, og lad resten
stå tomt. Findes den note allerede, åbner den i stedet, også hvis du har flyttet eller omdøbt den
inde i Prep. En sessionsplan er ny hver gang og får dagens dato som navn (for eksempel
Prep/Session plans/Session 2026-11-29.md), og Claude læser den nyeste. Dens date-egenskab er også
i dag: ret den til spilaftenen, når du planlægger i forvejen. Det virker uden dashboardet.

For at holde en prep-note væk fra Claude åbner du den og kører **Toggle: Claude may read this prep
note**. Den sætter egenskaben `ai_context` til false (eller tilbage til true).

En skabelons grå linje mellem %%-mærker er et vink til dig. Claude springer den over. For at bruge
skabelonerne til noter, du selv starter, peger du Obsidians Templates (eller Templater) skabelonmappe
på Prep/Templates. Ret skabelonerne, som du vil: værktøjet skriver dem kun, når mappen mangler.

Ændringer, du laver i Obsidian, når aldrig Foundry af sig selv. Ting, der ændrer spillet (for
eksempel at afsløre et handout), bliver planlagt fra Obsidian og bekræftet i dashboardet.

**En quest fra Obsidian ind i Foundry:** en quest-note i din `Prep`-mappe med egenskaben `type` sat
til `quest-prep` og et tomt `fvtt_uuid` kan blive til en quest-journal kun for GM. Åbn noten og kør
**Import this quest prep note into Foundry (confirm in the dashboard)**, og bekræft så planen i
dashboardet. Den kræver knappen "AI Tool: Obsidian import (writes)" (slået fra, til du slår den til
i Foundrys Game Settings, kategorien **Foundry AI Tool**). **Undo** i Recent Changes fjerner
journalen, og den samme note kan ikke importeres to gange, før du gør det. En note med `ai_context`
sat til false bliver afvist.

**En encounter-idé til Claude:** en kodeblok markeret `encounter` (Initiative Tracker-blokken) i en
prep-note, for eksempel en med `type` sat til `encounter-prep` eller i en sessionsplan, dukker op
for Claude som et foreslået encounter, så du kan spørge "what do I have prepared for the goblins?"
Claude læser den kun, intet bliver lavet i Foundry. Skriv blokken sådan her:

````markdown
```encounter
name: Goblin ambush
creatures:
  - 2: Goblin
  - Bugbear
```
````

En linje er `name`, `count: name` eller `name, hit points, armor class` (tallene efter navnet bliver
ignoreret). Claude læser op til 3 blokke pr. note, 12 skabninger pr. blok og 5 noter. En note med
`ai_context` sat til false bliver sprunget over, og kun blokkens navn og skabninger bliver givet
videre, aldrig resten af noten.

> **Usikker? Spørg Claude.** Spørg GM coach: "Hvordan laver jeg en prep-note til en NPC og holder Claude fra at læse den?"

## Campaign Atlas

Ved siden af Tarokka-spreadet har vaulten to canvases, tavler du kan læse som et kort:

- `AI Tool/Atlas/Quests.canvas`: dine quest-journals, med de NPC'er og scener, hver enkelt linker til.
- `AI Tool/Atlas/Places.canvas`: dine scener, én gruppe pr. Foundry-mappe, med pile for linkene mellem
  dem.

Klik på et kort for at åbne dets note. Kort, du flytter, og kort og pile, du tilføjer, bliver, hvor du
satte dem, når canvases bygges om ved næste eksport. Atlas'et beholder også kortfarver og pilenes
tekst. Tarokka-spreadet bygger sin korttekst og farve om hver gang, så skriv dine egne noter på dine
egne kort. For at overtage et canvas helt skal du slette markørkortet på det.

## Må jeg omdøbe ting?

- **I Foundry, ja, frit.** Omdøb scenes, journals, actors og resten, som du vil, for
  eksempel for at give et kort et tydeligere navn. Værktøjet finder hver note på et id inde i den
  (`fvtt_uuid`), aldrig på navn eller placering, så vaulten følger med af sig selv. Når du omdøber
  en scene eller en journal, beholder dens note sit filnavn, men egenskaben `name`, den første
  overskrift og aliaset inde i den skifter til det nye navn inden for et minut. Når et dokument
  flyttes til en anden Foundry-mappe, flytter dens note til den tilsvarende mappe og får det
  nuværende navn som filnavn.
- **I AI Tool-mappen skal du ikke omdøbe, flytte eller redigere noget.** Den mappe er værktøjets. En
  note, du redigerer, holder op med at blive opdateret og står i `_status.md`.
- **Prep og Home er dine.** Omdøb, flyt og redigér dem, som du vil.

> **Usikker? Spørg Claude.** Spørg GM coach: "Kan jeg omdøbe eller flytte ting uden at ødelægge min vault?"

## Grafen

Hvert eventyr får én hub-note, og grafen viser det som sin egen klynge. Journals, scenes og NPC'er,
der ikke ligger i nogen eventyrmappe i Foundry, står under **Without an adventure**, så ingen af
dem flyder løst. Hver dags ændringer er også linket fra kampagnens Home.

For at farve eventyrene trykker du Ctrl+P og kører **Apply AI Tool graph colours**. Hvis Library
(spells, monsters, items, bøger) fylder for meget i grafen, så kør **Hide the Library in the graph**.
**Show the Library in the graph** sætter den tilbage. Begge knapper er også i pluginets
indstillinger. De ændrer kun grafens farvegrupper og ét søgeudtryk, og dine egne grupper og din
egen søgetekst bliver stående.

## Forbind pluginet (én gang)

AI Tool-pluginet tilføjer **Open in Foundry** og handouts' afsløringsstatus. At installere det og forbinde det
til dashboardet står på sin egen side: [Engangsopsætning: Obsidian-pluginet](setup-obsidian-plugin.md).
De tre værdier, det skal bruge, ligger aldrig i vaulten, så Syncthing kopierer dem aldrig.

## Når det ikke virker

| Besked                                          | Hvad du gør                                                                 |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| "...did not come from the dashboard"            | Cloudflare Client ID eller Secret er forkert eller udløbet: spørg byggeren. |
| "...Check the GM token in the plugin settings." | GM token er forkert: indsæt den igen.                                       |
| "The dashboard at ... did not answer"           | Adressen er forkert, eller serveren er nede: tjek dashboardet i en browser. |

Cloudflare-tokenet gælder i et år. Cloudflare sender en mail til byggeren, før den udløber.
