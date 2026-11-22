---
source: gm/setup-gm-coach.md
sourceHash: ed9658b179cd
title: 'Engangsopsætning: GM-coachen'
description: Læg Foundry GM coach-skillen ind på din egen Claude-konto, med et Claude Project som nødplan. Cirka 5 minutter, én gang.
---

# Engangsopsætning: GM-coachen

GM-coachen er en skill på din egen Claude-konto, der svarer på spørgsmål om Foundry og dette værktøj.
Den virker på den gratis Claude-plan. Hvad den kan, og hvordan du spørger den, står i
[Din GM-coach i Claude](gm-coach.md). Cirka 5 minutter, én gang.

**Du skal bruge:** en Claude-konto (desktop-appen eller claude.ai) med Foundry-connectoren slået til
i dine chats (tilføjet med Windows-klienten eller [med webadresse](connect-claude-web.md)). På en Pro- eller Max-plan tilføjer du coachen som plugin (første afsnit nedenfor). På
en gratis plan bruger du filen `foundry-gm-coach.zip` fra den, der byggede værktøjet.

<!-- wiki:coach-download -->

## Læg den ind som plugin (Pro og Max)

1. Åbn **Settings** i Claude Desktop, derefter **Plugins**. Filtrene øverst er **All**,
   **Connectors** og **Skills**.
2. Klik på **Add**-menuen ved siden af **Search** og tilføj en marketplace: skriv
   `Gnuminator/foundry-ai-tool-plugins`. (Under **Find more plugins** er der også et **Plugins**-link,
   der gør det samme.)
3. Under **Discover** viser marketplacen tre kort: **Foundry dnd helper**, **Foundry gm coach** og
   **Foundry player helper**. Installer **Foundry gm coach**.
4. Har du uploadet coachen som zip tidligere (den står som **By you** under **Skills**), så fjern den
   kopi nu, så Claude ikke har coachen to gange.
5. Start en ny chat. Senere ændringer af coachen når nye chats af sig selv; du opdaterer ingenting.

## Læg den ind fra zip-filen (gratis plan)

1. Åbn **Settings**, **Capabilities** i Claude, og slå **Code execution and file creation** til. Skills
   kræver det.
2. Åbn **Settings**, derefter **Plugins**, og vælg filteret **Skills**.
3. Tilføj en skill og upload `foundry-gm-coach.zip`. Pak den ikke ud først.
4. Sørg for, at skillen er slået til i listen.

## Færdig, når det ser sådan ud

Start en ny chat og skriv: _GM coach: how do I start combat?_ Claude svarer med Foundry-trin og siger, at
den bruger GM coach-siderne.

## Hvis det ikke virker

- **Der er ingen Skills-side, eller uploaden afvises:** din konto har måske ikke skills. Brug nødplanen med
  et Project nedenfor.
- **Claude svarer ud fra almen viden og nævner ikke coachen:** tjek, at skillen er slået til, og start så
  spørgsmålet med "GM coach:".
- **Den beskriver en knap, du ikke kan finde:** zip-filen er ældre end funktionen. Bed den, der byggede
  værktøjet, om en ny zip, fjern den gamle skill og upload den nye.

## Valgfrit: D&D-hjælperen som skill

D&D-hjælperen bygger karakterer, rådgiver om level-up og svarer på regelspørgsmål ud fra bøgerne i
Foundry. Den læser kun; du ændrer spillet ved at klikke i Foundry. Den bruger samme Foundry-connector
som coachen.

- **Pro og Max (plugin):** installer **Foundry dnd helper** (under **Discover**) fra den samme marketplace,
  `Gnuminator/foundry-ai-tool-plugins`, ved siden af coachen. Fjern en tidligere zip-kopi (**By you**)
  først. Start en ny chat. Senere ændringer når nye chats af sig selv.
- **Gratis plan (zip):** tilføj en skill under **Settings**, **Plugins**, **Skills**, og upload
  `foundry-dnd-helper.zip` fra den, der byggede værktøjet. Pak den ikke ud først.

## Nødplan: et Claude Project

Et Project lægger alle sine filer ind i hver besked, så på den gratis plan bruger det din grænse hurtigere.
Upload kun nogle få sider.

1. Pak `foundry-gm-coach.zip` ud.
2. Åbn **Projects** i Claude og lav et project, der hedder "Foundry GM coach".
3. Åbn `SKILL.md` i Notesblok, kopiér alt under den anden `---`-linje og indsæt det i projectets
   instruktioner.
4. Upload to eller tre sider fra mappen `references` som projectets viden, for eksempel
   `references/foundry/in-world-layout.md`, `references/foundry/combat-tracker.md` og
   `references/gm/game-night-runbook.md`.
