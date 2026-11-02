---
source: gm/features.md
sourceHash: 8c8a3b6813e9
title: Funktioner og hvornår du slår dem til
description: De funktionsknapper i Foundry AI Tool, du bruger ved bordet, hvad hver af dem gør, og hvornår du skal slå dem til.
---

# Funktioner og hvornår du slår dem til

Værktøjet starter småt. Nogle få funktioner er slået til fra start, resten er slået fra, til du får
brug for dem. Så gør en ny world aldrig mere, end du forventer. Siden her gennemgår dem én for én:
hvad de gør, om de starter slået til, og **hvornår du skal slå dem til**.

De fleste knapper er Foundry-indstillinger: fanen **Settings** (tandhjulet i sidebaren), **Game
Settings**, kategorien **Foundry AI Tool**. Sæt eller fjern flueben, og tryk **Save Changes**. De
stopper dashboardets ændringer lige så vel som Claudes.

"AI Tool" kan betyde tre ting, så her er forskellen. **Modulet** er tilføjelsen inde i Foundry
(Module Management viser det som **Foundry AI Tool**). Alle knapperne på siden her er indstillinger
i det, og næsten alle hedder "AI Tool: ..." (Allow Write Operations er undtagelsen). **Dashboardet**
er websiden ved siden af Foundry, som du åbner i en anden fane. **GM-vinduerne** er små vinduer inde
i Foundry. De har deres egen knap, "AI Tool: GM windows", som er slået fra, til du slår den til (se
[GM-vinduerne](gm-windows.md)). Modulets knapper ligger alle samme sted: scroll til overskriften
**Foundry AI Tool** i Game Settings.

**Turn on for tonight** (Pre-flight-panelet i dashboardets Before-visning) slår med ét klik til,
hvad en aften ved bordet kræver: Allow Write Operations, Handouts, Live play, Party, Tarokka og
GM Actions. **End session** slår det fra igen, som den slog til. Se
[Turn on for tonight](dashboard.md#turn-on-for-tonight).

## Allow Write Operations

- **Hvad den gør:** værktøjets hovedkontakt. Er den slået fra, kan værktøjet kun læse: intet ændrer
  sig i Foundry, hverken fra Claude eller fra dashboardet, og der er ingen Undo.
- **Starter:** slået til.
- **Slå den fra, når:** værktøjet kun skal kigge med, for eksempel mens du viser en ny spiller
  rundt. Turn on for tonight slår den til igen.

## Live play

- **Hvad den gør:** damage, healing, temporary hit points, conditions og resources (spell slots,
  klasseressourcer, brug af items) på en eller flere skabninger, regnet ud af dnd5e med resistances.
  Dertil at flytte, ændre eller slette tokens og at klæde en scene på (area templates, mørke og lys,
  map notes, loot til en karakter). Fra dashboardets turn-order strip eller ved at bede Claude.
  Hver ændring kan fortrydes i Recent Changes.
- **Starter:** slået til. Indstillingen "AI Tool: Live play (writes)".
- **Slå den til, når:** den er det allerede. Lad den stå.
- **Mere:** [Combat Tracker](dashboard.md#combat-tracker).

## Live play without confirming

- **Hvad den gør:** damage, healing, conditions og resources, som **Claude** laver en plan for,
  bliver udført med det samme, uden confirm-vinduet. Hver af dem viser stadig en Undo og står i
  Recent Changes. Dashboardets egne knapper ændrer den ikke: Condition viser altid confirm-vinduet,
  og Damage / Heal udfører med det samme fra sin lille formular, med Undo.
- **Starter:** slået fra. Indstillingen "AI Tool: Live play, apply without confirming".
- **Slå den til, når:** du lader Claude klare damage i lange kampe, og det bliver trættende at
  bekræfte hvert slag. Lad den stå fra, mens du stadig lærer, hvad Claude gør.
- **Mere:** [Asking Claude](asking-claude.md#funktionskontakter).

## Handouts

- **Hvad den gør:** viser eller skjuler journal-sider for spillerne, sætter sider i kø, så de kan
  vises én efter én, og viser, hvem der har set hver af dem.
- **Starter:** slået fra. Indstillingen "AI Tool: Handouts (writes)". Turn on for tonight slår den
  til.
- **Slå den til, når:** før den første session med et handout (et brev, et kort, et billede).
- **Mere:** [The handout drawer](dashboard.md#handout-skuffen--handouts).

## Party

- **Hvad den gør:** party-panelet: partiets rejsetempo, at placere partiets tokens på den scene, du
  kigger på, at tilføje partiet til combat og en rest-forespørgsel, som hver spiller kan svare på
  fra sin egen karakter.
- **Starter:** slået fra. Indstillingen "AI Tool: Party (writes)". Turn on for tonight slår den til.
- **Slå den til, når:** partiet rejser eller hviler for første gang. Den kræver en Group-actor, der
  er sat som primært party i Foundry.
- **Mere:** [The party drawer](dashboard.md#party-skuffen--party).

## Who would notice

- **Hvad den gør:** tilføjer en række til party-skuffen. Skriv en DC, og hver karakter får en chip
  for passive Perception, Investigation og Insight, med et flueben eller et kryds. Den læser kun:
  intet bliver rullet, og spillerne ser det aldrig.
- **Starter:** slået fra. Indstillingen "AI Tool: Who would notice". Den er ikke med i Turn on for
  tonight.
- **Slå den til, når:** du vil vide, hvem der opdager noget skjult, uden at bede om slag.
- **Mere:** [The party drawer](dashboard.md#party-skuffen--party).

## Tarokka

- **Hvad den gør:** gemmer en kortlægning, kobler kort til journals og udgiver afsløringssider til
  spillerne.
- **Starter:** slået fra. Indstillingen "AI Tool: Tarokka (writes)". Turn on for tonight slår den
  til.
- **Slå den til, når:** før den første kortlægning.
- **Ved bordet:** i Foundry har **AI Tool** i værktøjslinjen til venstre en knap, **Tarokka table**
  (kun GM). **Place** lægger det næste kort med bagsiden opad, **Flip** vender et kort, **Show to
  players** åbner bordet på alle spilleres skærm, **Stop showing** lukker det. Spillerne ser
  bagsiden af de kort, du har lagt, og forsiden af dem, du har vendt, ikke andet (ingen positionsnavne,
  ingen noter). **Picture** giver et kort et billede fra worldens filer. At vende et kort er en
  afsløring: det kræver, at denne knap er slået til, og det markerer også kortet som afsløret i
  skuffen og lægger en side til spillerne i afsløringsjournalen. Bordet kræver, at kortlægningen
  findes først (lagt eller valgt i skuffen, eller af Claude), og at bridgen er forbundet.
- **Mere:** [The Tarokka drawer](dashboard.md#tarokka-skuffen--tarokka).

## Ownership

- **Hvad den gør:** ændrer, hvilke spillere der ejer en actor eller kan se den.
- **Starter:** slået til. Indstillingen "AI Tool: Ownership (writes)".
- **Slå den til, når:** den er det allerede. Du bruger den, når en spiller får en ny karakter, en
  familiar eller en hireling.
- **Mere:** [When a character dies](death-and-new-characters.md).

## Obsidian mirror

- **Hvad den gør:** lader værktøjet ændre, hvilke Foundry-dokumenter det spejler ind i din
  Obsidian-vault (spejlindstillingerne). Session notes og statistik bliver skrevet uanset.
- **Starter:** slået fra. Indstillingen "AI Tool: Obsidian mirror (writes)".
- **Slå den til, når:** du vil have actors, scener eller journals fra Foundry som noter i Obsidian,
  og beder Claude sætte det op.
- **Mere:** [Open in Obsidian](dashboard.md#open-in-obsidian-).

## Obsidian import

- **Hvad den gør:** laver en quest-note fra din `Prep`-mappe i Obsidian om til en quest-journal kun
  for GM i Foundry, når du har bekræftet planen. Noten skal have `type: quest-prep` og et tomt
  `fvtt_uuid`. Dens stakes og tekst bliver kopieret. Egenskaberne `secret` og `ai_context` bliver
  aldrig kopieret, og en note med `ai_context: false` bliver afvist (en journal i Foundry holdes
  ikke væk fra Claude). Journalen er kun for GM, til du afslører den, og **Undo** i Recent Changes
  fjerner den. Den samme note kan ikke importeres igen, før du har fortrudt den første import eller
  slettet journalen.
- **Starter:** slået fra. Indstillingen "AI Tool: Obsidian import (writes)".
- **Slå den til, når:** du har skrevet en quest i Obsidian og vil have den over i Foundry. Kør
  "Import this quest prep note into Foundry" i Obsidian, og bekræft planen i dashboardet.
- **Mere:** [Open in Obsidian](dashboard.md#open-in-obsidian-).

## Session notes

- **Hvad den gør:** efter en optaget session skriver værktøjet noterne (en Recap til spillerne, et
  GM-resumé og scenerne) og **lægger dem ind i Foundry af sig selv, uden at spørge**: en journal
  kun for GM, "Session notes", med ét indlæg pr. session. Ændringen står i Recent Changes med
  **Undo**. Recap'en havner også i Handouts-køen, så spillerne først ser den, når du afslører den.
  Dashboardets **After**-visning viser, hvor noterne er, med **Read**, **Approve without
  revealing** og **Undo**.
- **Starter:** slået fra. Indstillingen "AI Tool: Session notes (writes)". Turn on for tonight slår
  den ikke til, fordi noterne kommer efter sessionen.
- **Slå den til, når:** du optager dine sessioner og vil have noterne i Foundry uden at gøre
  noget. Mens den er slået fra, venter noterne og kommer ind af sig selv, når du slår den til.
- **Mere:** [Session notes (After)](dashboard.md#session-notes-after).

## Boss prompts

- **Hvad den gør:** i turn-order strip'en vises pips for legendary actions og resistance, en
  påmindelse om lair actions og reaktionsmærker for skabningerne i kampen. Intet ændrer sig i
  Foundry.
- **Starter:** slået fra. En knap i dashboardets Combat Tracker, som huskes i denne browser.
- **Slå den til, når:** før den første bosskamp.
- **Mere:** [Combat Tracker](dashboard.md#combat-tracker).

## Themed dice

- **Hvad den gør:** når modulet **Dice So Nice** er installeret og slået til, passer to terningesæt
  til dashboardets temaer: **AI Tool: The Veil** (røgfarvet gråt-grønt glas med drivende tåge,
  tallene i lampeguld) og **AI Tool: Neutral** (dyb marineblå med blå-hvide tal). Kun de 3D-terningers
  udseende ændrer sig. Slag og play log forbliver de samme.
- **Starter:** sættene findes, så snart Dice So Nice gør, men ingen bruger dem, før de vælger dem.
- **Slå den til, når:** før session 1. Vil du gøre et af dem til bordets standard, så åbn **Game
  Settings**, **Dice So Nice**, klik på **Configure Dice Roles**, og vælg **AI Tool: The Veil**
  (eller **AI Tool: Neutral**) i kolonnen **Theme** i rækken **Basic**. Hver spiller kan stadig
  vælge sine egne terninger under **3D Dice Settings**.
- **Mere:** [tjeklisten før sessionen](before-session.md#slå-til-det-aftenen-kræver).

## GM windows

- **Hvad den gør:** tilføjer knapperne Combat, Party, Session, Scene og Loot til AI Tool-gruppen i
  scene controls (kun GM). Hver åbner et lille vindue ved siden af kortet, så du kan køre en scene
  fra én skærm uden dashboard-fanen. Kun Combat-knapperne til tur og Session-knapperne start og
  slut ændrer noget, og intet her spørger Claude.
- **Starter:** slået til (en world, hvor indstillingerne er gemt tidligere, kan have den slået
  fra). Indstillingen "AI Tool: GM windows".
- **Slå den fra, når:** du ikke vil have de ekstra knapper i scene controls.
- **Mere:** [GM-vinduerne](gm-windows.md).

## GM Actions

- **Hvad den gør:** dashboardets egen knap til at ændre spillet fra dashboardet. Den stopper ikke
  Claude.
- **Starter:** slået fra hver gang dashboardet starter. Turn on for tonight slår den til, End
  session slår den fra.
- **Slå den til, når:** du handler fra dashboardet. Turn on for tonight gør det for dig.
- **Mere:** [GM Actions](dashboard.md#live-play-on-all-set).

## De andre knapper

De ligger i samme kategori i Game Settings. Undtagen den sidste bliver en ændring, de tillader, kun
udført, når du har bekræftet en plan, og den står i Recent Changes med Undo.
[Asking Claude](asking-claude.md#funktionskontakter) gennemgår dem sammen med de andre.

- **Table viewer** ("AI Tool: Table viewer (writes)"): lader Claude oprette den **Table**-spiller,
  som tv'et ved bordet logger ind som. Starter slået til. Du bruger den én gang, se
  [TV'et ved bordet](tv-table-viewer.md).
- **Undo for everything** ("AI Tool: Undo for everything"): lader værktøjet fortryde og gentage
  alles ændringer (spillernes, dine og Claudes) fra Changes-listen, én ændring ad gangen eller alt
  siden på det samme. Starter slået til.
- **Scene mood and music** ("AI Tool: Scene mood and music (writes)"): en scenes mørke, lys og
  vejr, gemte mood presets og at starte, stoppe eller skifte playlists. Starter slået fra. Slå den
  til, når du vil have Claude til at sætte stemningen i en scene.
- **NPC turn assistant** ("AI Tool: NPC turn assistant (writes)"): flytter et monster på dets tur
  og trækker hit points fra de skabninger, det rammer. Attacks og saves bliver rullet først, hver
  for sig. Starter slået fra. Slå den til, når du vil have Claude til at hjælpe med et monsters tur.
- **Room setup** ("AI Tool: Room setup (writes)"): tilføjer teleport regions og fylder et rum med
  tokens. Starter slået fra. Slå den til, mens du forbereder et kort.
- **Scene restore** ("AI Tool: Scene restore (writes)"): sætter en scenes vægge, lys, tiles og
  tokens tilbage fra en backupkopi af world'en. Starter slået fra. Slå den til, når et kort er
  blevet ødelagt i hånden.
- **Paper sync** ("AI Tool: Paper sync (writes)"): skriver tallene fra et papirark tilbage på en
  karakter efter en aften spillet på papir. XP, level og klasse bliver aldrig ændret. Starter
  slået fra. Slå den til efter en papiraften.
- **Rules check** ("AI Tool: Rules check"): lader Claude sige, om en attack, en spell eller et item
  ser lovligt ud lige nu, og hvorfor. Den læser kun og ændrer intet. Starter slået fra.
