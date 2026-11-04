---
source: gm/cookbook.md
sourceHash: 8885ca2877f1
title: Cookbook
description: Færdige forespørgsler og klik til GM'en, grupperet efter det øjeblik du har brug for dem (før, under og efter en session), med hvad der sker og ét tip til hver.
---

# Cookbook

Korte opskrifter på ting, du får lyst til at gøre. Hver opskrift siger, hvad du skal skrive (i en
Claude Desktop-chat) eller klikke på (i dashboardet), hvad der sker, og ét tip. Kopiér ordene i
citationstegn og skift navnene ud med dine egne.

Før og efter sessionen vil du have **core** og **prep** tændt i Claude Desktop-chatten; ved bordet
**core** og **play** (se
[Spørg Claude](asking-claude.md#tool-sets-hvilke-kontakter-du-skal-tænde)). En opskrift, der kræver et
andet set, siger det.

## Fire vaner der gør hver forespørgsel bedre

1. **Nævn den præcise ting.** "Wolf 2", "siden 'Old letter' i journalen 'Handouts'", "Thorin
   Ironfoot". Flere tokens kan have samme navn; Foundrys navne er det, Claude søger efter.
2. **Sig, hvad du vil have tilbage.** "En liste med tre", "ét afsnit, jeg kan læse højt", "en tabel
   med HP og AC".
3. **Bed om en plan før ændringer.** "Vis mig planen først og vent på mit OK." Guarded changes venter
   altid; det får også de direkte til at vente.
4. **Sig, hvilke bøger der gælder for regler.** "Brug kun bøgerne i mine Foundry-compendiums, og
   fortæl mig, hvor du fandt det."

## Før sessionen

### Gør klar til næste session

- **Klik:** **📋 Prep** (under **Advanced ▾**, Panels, eller dokket i Before-visningen) for fakta uden
  AI: sidste session (scener, combats, hvem der gik ned, hvad der skete), åbne quests og dele af
  kampagnen, dine noter, de handouts du satte i kø, bosserne på dine scener og pre-flight-resultatet.
- **Eller sig:** brug den færdige prompt `prep-next-session` (i beskedfeltets **+**-menu). Tilføj et
  focus, hvis du har et, for eksempel "Vallaki-festivalen".
- **Hvad der sker:** Claude læser de samme fakta i ét hug (`get-prep-digest`) og hjælper dig med at
  planlægge næste session.
- **Tip:** hold dine forberedelsesnoter i en journal, der hedder "Next session", og som kun du kan se.
  Prep-skuffen og Claude læser den begge. Bed om en kort liste over løse tråde til sidst: "Slut med de
  fem åbne tråde, én linje til hver."
- **Tip til Obsidian:** Claude læser også dine egne forberedelsesnoter i Obsidian vault (ikke
  Prep-skuffen): din nyeste session-plan og noterne knyttet til den scene, partyet er på, en creature
  på den eller en åben quest. Giv en note egenskaben "type" sat til "session-plan" (eller "npc-prep",
  "location-prep", "quest-prep" og så videre). For at knytte den til noget i Foundry skal du sætte
  "fvtt_uuid" til dens UUID: pas-ikonet i arkets titellinje kopierer den. Et indsat link virker også,
  og det samme gør en liste af UUID'er til en note om flere ting. En note lavet ud fra ét goblin-token
  dækker alle goblin-tokens. UUID'er fra et compendium passer ikke: kopiér UUID'en fra actoren i din
  world. "Nyeste" session-plan betyder den seneste "date"-egenskab (ellers den senest gemte fil), så en
  plan dateret to sessioner frem vinder over næste uges. Sæt "ai_context" til false for at holde en
  note væk fra Claude. Claude ser omkring 12 linjer pr. note (egenskaberne først), så læg hovedpunkterne
  øverst. Den nemme måde: **New prep note for this** på NPC-, scene- eller quest-noten sætter alt det
  her for dig (se [Din Obsidian-vault](obsidian.md), "Make a prep note").

### Tjek at alt er klar

- **Klik:** **✈ Pre-flight** i dashboardets header, eller **sig:** "Kør pre-flight-tjekket og fortæl
  mig, hvad jeg skal rette, det vigtigste først."
- **Hvad der sker:** værktøjet tjekker Foundry-linket, versionerne, kontakterne, hemmeligheder i
  world-indstillinger, navne spillerne kan se og module-konflikter (`get-preflight`). Dashboardet
  tjekker også GM Actions, spillersiden og Tarokka-kortene.
- **Tip:** Pre-flight-panelet har også håndtjekkene; kryds dem af undervejs.

### Tjek en encounter

- **Sig:** brug prompten `encounter-check`, eller "Er combaten på scenen 'Old Bonegrinder' fair for
  partyet? Foreslå én ændring, hvis det er for hårdt."
- **Hvad der sker:** Claude sammenligner creatures med partyet (`suggest-balanced-encounter`).
- **Tip:** sig, hvilken slags combat du vil have: "kort og skræmmende", "en rigtig trussel", "en
  opvarmning".

### Find monsters til en scene

- **Sig:** "Find tre undead med CR 1 til 3 i mine compendiums til fire karakterer på level 3. En tabel
  med navn, CR og hvorfor den passer."
- **Hvad der sker:** Claude søger i dine compendiums (`search-compendium` er altid slået til, `list-creatures-by-criteria`
  er i **build**-settet).
- **Tip:** for at lægge ét i worlden skal du tænde **build** og spørge: "Tilføj en Ghoul fra
  compendiet til worlden. Vis mig det først."

### Et hurtigt NPC-kort

- **Sig:** brug prompten `npc-improv` med NPC'ens navn.
- **Hvad der sker:** et kort med stemme, manerer, ønske og hemmelighed.
- **Tip:** det indeholder hemmeligheder. Hold det væk fra delte skærme.

### Beskriv en scene fra eventyret

- **Sig:** "Find journalsiden om Old Bonegrinder og læs den. Beskriv, hvad partyet ser, når de
  ankommer i skumringen: tre sætninger, jeg kan læse højt, i samme tone, og intet de ikke kan se
  endnu."
- **Hvad der sker:** Claude finder siden (`search-journals`), læser den (`list-journals`) og skriver
  beskrivelsen i chatten. Der ændres intet i Foundry.
- **Tip:** Claude læser journals i din world, så eventyret skal være importeret dér (dets journals i
  Journal-sidebaren, for eksempel fra det officielle module eller DDB-Importer). Dine egne sider
  virker på samme måde, så dine egne quests og steder får den samme hjælp. Nævn den stemning, du vil
  have: "uhyggelig og stille", "forhastet", "trist".

### Skriv et brev eller en invitation fra en skurk

- **Sig:** "Skriv et udkast til et brev fra Strahd til partyet, i hans stemme, ud fra disse punkter:
  inviterer dem til middag, nævner Thorin ved navn, høfligt men truende. Omkring 120 ord. Ren tekst."
- **Hvad der sker:** Claude skriver udkastet i chatten. Der ændres intet i Foundry.
- **Tip:** indsæt den endelige tekst på en side i en journal kun til GM'en, og afslør den så som en
  handout (næste opskrift). Før det: bed om "Tjek denne tekst for hemmelige ord" (`check-secret-terms`).

### Gør handouts klar til sessionen

- **Sig:** "Sæt siden 'Letter from Strahd' i journalen 'Handouts' i kø til scenen 'Barovia Village'."
  Tilføj "kun til Anna" for at afsløre den for én spiller.
- **Hvad der sker:** siden kommer i handout-køen (`plan-page-reveal` med handlingen queue). Der ændres
  intet i Foundry, og spillerne ser ikke noget endnu.
- **Tip:** åbn **📜 Handouts** (under **Advanced ▾**) i dashboardet for at se køen i rækkefølge.
  **Remove** tager én af.

### Træk Tarokka-læsningen

- **Sig:** "Træk en ny Tarokka-læsning med det indbyggede roll. Vis mig planen først."
- **Hvad der sker:** en plan (`plan-tarokka-import`); apply'es efter dit ja, og ligger så i **🃏 Tarokka**
  (under **Advanced ▾**).
- **Tip:** lad **Show cards** stå uden hak i dashboardet, mens spillerne kan se din skærm.

### Brug en Tarokka-læsning, du selv har valgt

- **Sig:** "Gem denne Tarokka-læsning: tome er `swords-7` (Seven of Swords), holy symbol `glyphs-master` (Master of Glyphs), sunsword `coins-1` (One of Coins), ally `raven` og Strahds placering `donjon`."
  Eller åbn **🃏 Tarokka**, sæt hak i **Show cards** (valgene er på skærmen), tryk **Choose the cards**, vælg de fem kort og tryk **Store this reading**.
- **Kort-id'er:** værktøjet tager id'er, ikke navne: en suit og en værdi (`swords-7`, `glyphs-master`, `coins-1`) for det almindelige dæk,
  eller ét ord for det høje dæk (`raven`, `donjon`, `broken-one`). Et navn giver en fejl, der viser formatet.
- **Hvad der sker:** der trækkes intet. Hvert kort skal komme fra det rigtige dæk
  (det almindelige til de første tre, det høje til de sidste to), og ingen må gentages. Den forrige læsning arkiveres, og Undo bringer den tilbage.
- **Afslør så ét kort ad gangen:** i **🃏 Tarokka** trykker du på **Reveal to players** ved én position og skriver, hvad spillerne må læse.
  Intet når spillerne, før du gør det, og de andre fire forbliver skjulte.

## Under sessionen

### Besvar et regelspørgsmål

- **Sig:** brug prompten `rules-question`, eller "Hvordan virker grappling i 2024-reglerne? Brug kun
  mine Foundry-bøger og fortæl mig, hvor du fandt det."
- **Hvad der sker:** Claude søger i dine compendiums og journals og nævner den side, den brugte.
- **Tip:** læs den side, den nævner, hvis svaret betyder noget i et stort øjeblik.

### Hvem er i knibe?

- **Sig:** "Hvilke PC'er har under halvdelen af deres HP, og hvem har stadig spell slots?"
- **Hvad der sker:** Claude læser karaktererne og combat (`get-combat-state`, `list-characters`).
- **Tip:** dashboardets combat tracker viser HP-bjælker, uden at du spørger.

### Start og slut en combat

- **I Foundry:** vælg de tokens, der kæmper (vælg dem på kortet, eller træk en boks rundt om dem),
  højreklik på ét og klik på de krydsede sværd (**Enter Combat**) i dets token-menu. Det tilføjer alle
  de valgte tokens til en ny combat. Åbn fanen **Combat Encounters** og klik **Roll All** (eller
  **Roll NPCs**) for initiative, så **Start Combat**. Når combaten er slut, klik **End Combat**
  nederst i fanen og bekræft.
- **I dashboardet:** med **GM Actions** tændt (**Turn on for tonight** gør det) klik **Start combat**
  i Combat Tracker. Den lister tokens på scenen, sætter hak ved spillerkaraktererne og de fjendtlige,
  og starter combaten i round 1 med en Undo. **End combat** vises, når en combat kører. Se
  [Combat Tracker](dashboard.md#combat-tracker).
- **Tip:** knapperne Damage / Heal og Condition på en combatant samt Start og End combat kræver alle,
  at live play er tændt. Hvis en knap er grået ud, siger den hvorfor og har en **Turn on** ved siden af;
  headeren skal sige "Live play on: all set".

### Kør et bossfight

- **Klik:** **👑 Boss prompts** i combat trackerens øverste linje for at tænde den (den vises, når en
  creature med legendary actions eller en lair er med i combaten, og starter slukket).
- **Hvad der sker:** pips for legendary actions og resistances, en påmindelse, når lairen handler, og
  et **R**-mærke pr. creature for dens reaction i denne round.
- **Tip:** sæt hak ved "in lair" på creaturens sheet i Foundry, så lair-påmindelsen og den ekstra
  legendary-brug tæller med.

### Afslør den næste handout

- **Klik:** **Reveal next** i **📜 Handouts**, eller **sig:** "Afslør den næste handout i køen for
  denne scene."
- **Hvad der sker:** confirm-vinduet viser planen; efter dit OK når siden spillersiden og Foundry.
  Skuffen sætter hak ved hver spiller, der har åbnet den. Sæt hak ved **Show it now** først, hvis du
  også vil have siden til at poppe op på deres skærme; Undo kan ikke lukke den popup.
- **Tip:** en fejl er ét klik at rette: **Undo** i **Recent Changes** skjuler den igen og lægger den
  tilbage i køen.

### Lad Claude tage rolls og damage

Det kræver, at **play**-settet er tændt.

- **Sig:** "Slå en Dexterity save DC 14 for Wolf 1, Wolf 2 og Wolf 3." (`roll-saving-throws`)
- **Sig:** "Slå initiative for NPC'erne." (`roll-initiative-for-npcs`)
- **Sig:** "Giv 12 fire damage til Wolf 2, kør." (`plan-actor-change`)
- **Hvad der sker:** Claude planlægger damage, viser hvad hvert mål tager efter resistances ("Wolf 2:
  12 fire damage, 6 taget, HP 11 til 5") og apply'er det. "Kør" er dit ja; uden det spørger Claude
  først. Healing, temp HP, conditions ("Gør Test Hero prone") og spell slots virker på samme måde.
- **Tip:** en fejl er ét klik at rette: **Undo** i **Recent Changes**. Rolls sker med det samme og kan
  ikke undo'es.

### Flyt, tænd lys på eller fjern tokens

- **Sig:** "Flyt Wolf 2 to felter til venstre, kør." eller "Giv Test Hero en fakkel." eller "Skjul
  Wolf 3." (`plan-token-change`)
- **Hvad der sker:** Claude planlægger det og viser, hvor hvert token ender ("Wolf 2: (9,7) til (7,7),
  10 ft") eller hvad der ændres. "Kør" er dit ja.
- **Tip:** at slette et token spørger to gange. Dets plads i encounteren forsvinder med det, og
  **Undo** i **Recent Changes** bringer begge tilbage, initiative med.

### Få tokens til at passe til et by- eller oversigtskort

- **Sig:** "Tilpas tokens til dette korts skala." eller "Gør partyet mindre, så det passer til kortet."
  (`plan-token-change`)
- **Hvad der sker:** by- og oversigtskort har ofte felter på 20 til 200 ft, så et almindeligt token
  ser ud som et hus. Claude ændrer størrelsen på hvert token (eller kun dem, du nævner), så en creature
  dækker sit rigtige fodaftryk i den skala, men aldrig mindre end et kvart felt, så du stadig kan se
  den. Et almindeligt 5 ft slagkort bliver, som det er.
- **Tip:** **Undo** i **Recent Changes** sætter de gamle størrelser tilbage.

### En karakter døde

- **Sig** (play-settet tændt): "Markér Kasimir som død, kør." (`plan-actor-change`) Eller klik på
  kraniet (**Mark Defeated**) på hans række i Foundrys Combat Tracker.
- **Hvad der sker:** karakteren får status **Dead**. Værktøjet følger 0 HP og death saves, men
  bestemmer aldrig, at nogen er død; det er dit valg.
- **Tip:** behold actoren; slet den aldrig. Resten (Observer-adgang til spilleren, dødslog, en ny
  karakter) står på [Når en karakter dør](death-and-new-characters.md).

### Optag sessionen i Discord

- **Skriv** (eller bed den, der kører værktøjet, om at skrive) i Discords tekstkanal: `/record start`,
  når spillet begynder, `/record stop`, når det slutter.
- **Hvad der sker:** optagelsesbotten optager hver taler. Foreløbig starter udvikleren botten før
  sessionen.
- **Tip:** fortæl spillerne i starten, at sessionen bliver optaget.

## Efter sessionen

### Et recap

- **Sig:** brug prompten `session-recap`. Vælg **players** for et spoilerfrit recap til deling, eller
  **gm** til dine egne noter.
- **Hvad der sker:** Claude skriver recappet ud fra play loggen.
- **Tip:** læs et spillerrecap selv, før du sender det videre.

### Stats pr. karakter

- **Sig:** "Hvem gav mest damage sidste session, og hvem gik ned?"
- **Hvad der sker:** Claude læser play stats (`get-play-stats`).
- **Tip:** de samme tal står i din Obsidian-sessionsnote.

### Hvem har set hvilken handout

- **Klik:** **📜 Handouts** i dashboardet, eller **sig:** "Hvilke afslørede handouts har ingen åbnet
  endnu?" (`list-revealed-pages`)
- **Hvad der sker:** hver handout med et hak for hver spiller, der åbnede den på spillersiden.
- **Tip:** en handout, ingen har åbnet, er en god krog at nævne næste session.

### Session notes og spillerrecappet

- **Gør:** ingenting. Efter `/record stop` bliver optagelsen lavet om til tekst på bordets PC, og
  Claude skriver noterne. Foreløbig starter udvikleren det; fra den første kampagnesession kører det af
  sig selv hver time. Hvis det ikke kørte, så bed udvikleren køre det.
- **Hvad der sker:** i sessionens mappe, under `notes`, på dansk og engelsk: det rensede transcript,
  noter pr. scene (hvad der skete, NPC'er, loot, åbne tråde, en "GM only"-del), et resumé til dig og et
  udkast til recap til spillerne. Med kontakten "AI Tool: Session notes (writes)" tændt går de så ind i
  Foundry af sig selv: en journal kun til GM'en i mappen "Session notes" med siderne Recap, GM summary
  og Scenes (dansk først, engelsk under). Det sker, så snart Foundry er åben med writes tændt, så noter
  lavet natten over lander, næste gang du trykker "Turn on for tonight". Live Feed og Recent Changes
  viser det, med en Undo.
- **Tip:** læs Recap-siden, før andre gør det. Den venter i reveal-køen; tryk **Reveal next**, når den
  er i orden, og spillerne ser den som "Last recap" på spillersiden. Når du afslører den, eller
  trykker **Approve without revealing** i dashboardet, bliver sessionen markeret som godkendt. Den
  optagede lyd bliver på PC'en (D-097); den slettes kun, hvis en spiller beder om at få sin slettet.

## Når en opskrift går galt

- **"Switch on the play set"** (eller et andet set): Claude mangler et værktøj, der er slukket. Tænd
  det i **+**-menuen, **Connectors**, og spørg igen.
- **Claude vælger det forkerte token:** nævn det præcist ("Wolf 2") eller vælg det i tool runneren.
- **En plan bliver afvist:** dens funktionskontakt er slukket, planen er mere end 15 minutter gammel,
  eller tingen er ændret i Foundry siden. Bed om en ny plan.
- **Alt andet:** [Fejlfinding](troubleshooting.md).
