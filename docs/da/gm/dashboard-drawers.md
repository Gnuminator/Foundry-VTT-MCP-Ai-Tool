---
source: gm/dashboard-drawers.md
sourceHash: 0e4692bac75b
title: 'Dashboardet: confirm-vindue, Tool Runner og skuffer'
description: 'Confirm-vinduet, Tool Runner og skufferne Tarokka, Handouts, Prep og Party.'
---

# Dashboardet: confirm-vindue, Tool Runner og skuffer

Part of [Dashboardet](dashboard.md).

## Confirm-vinduet

Dashboardets egne knapper, der laver en planlagt ændring (gruppens tempo og rest-anmodning,
Tarokka-links og -importer), anvender den med det samme, når du klikker: dit klik er bekræftelsen. En
besked siger, hvad der ændrede sig, med **Undo** i nogle sekunder; Recent Changes gemmer hele
historikken.

Confirm-vinduet åbner først ved:

- **Destruktive ændringer**: sletninger, Tarokka-reveals og -hides og handout-hides (spillerne ser en
  reveal med det samme, så Undo kan ikke tage den tilbage fra deres øjne). En handout-reveal har en
  fungerende Undo og spørger i én linje, uden kryds. **End combat** er også en sletning, men
  spørger i én linje uden kryds, på begge strips: Undo bringer kampen tilbage.
- **Planer, du ikke lavede på dashboardet**: en plan, Claude lavede. Plan, confirm og undo gælder for
  hver AI-ændring.
- **Enhver plan lavet i Tool Runner**, så du ser, hvilke mål den rammer, før den anvendes.
  (Strimlens formular Damage / Heal anvendes med det samme, med Undo; dens Condition-chips og End
  combat spørger i én linje.)
- **Ældre værktøjer uden plan** (fra Tool Runner), som ikke har nogen Undo.

I confirm-vinduet:

- For en planlagt ændring viser det planens opsummering og listen over, hvad der ændres. Læs den.
- For andre værktøjer viser det værktøjets navn og de værdier, det kører med.
- **Cancel** (eller Escape, eller et klik udenfor) kører ingenting.
- **Destructive action**: sletninger, Tarokka-reveals, hides og hver Undo kræver et ekstra trin. Sæt
  kryds ved "I understand this changes the live game and may be hard to undo.", og klik derefter på
  **Run destructive action**. Undtagelsen er **End combat** på strips: den spørger i én linje uden
  kryds, og Undo bringer kampen tilbage.

## Tool Runner (🛠 Tool Runner)

En skuffe i siden med hvert værktøj, bridgen har, de samme værktøjer som Claude bruger. Brug den, når
du selv vil gøre én helt bestemt ting, eller for at anvende en plan, Claude lavede.

1. Skriv i **Search tools…** eller scroll. Værktøjerne er grupperet efter kategori (Combat, Tokens &
   Scene, Actors, Journals & Quests, Guarded changes og flere). Hvert har et mærke: `read`, `write`
   eller `destructive`.
2. Klik på et værktøj. Du ser dets beskrivelse og en formular. Felter markeret med **\*** er
   obligatoriske.
3. Udfyld formularen og klik på **Run** (en læsning) eller **Plan and confirm** (en ændring, som åbner
   confirm-vinduet).
4. Svaret vises under formularen som **Result** eller **Error**. **‹ All tools** går tilbage.

Når GM Actions er slået fra, siger en advarselsbjælke øverst det, med en knap **Enable GM Actions**.
Læsninger virker stadig.

### Knappen Pick from list

Hvert felt, der navngiver noget (en actor, et token, en scene, en journalside, en deltager, en
compendium-post, en plan, en ændring), har en **Pick from list**-knap. Den viser, hvad der findes lige nu; klik
på en for at udfylde feltet. Du kan stadig skrive i hånden.

- Listen har et filterfelt. For compendium-poster og dokumenter skal du skrive mindst 2 bogstaver for
  at søge.
- "hidden" ved siden af et token betyder, at spillerne ikke kan se det.
- Et rødt "same name ×N" betyder, at flere ting har det navn, og at værktøjet vælger efter navn. Døb
  en af dem om i Foundry først, ellers kan du ramme den forkerte.
- "More exist: type to narrow the list." betyder, at listen blev afkortet.
- For et felt, der tager flere værdier, klik på flere poster; hver bliver afkrydset.

### Anvend en plan, Claude lavede

Når Claude planlægger en ændring i Claude Desktop, kan du anvende den fra dashboardet:

1. Slå **GM Actions** til.
2. Åbn **🛠 Tool Runner**, søg efter `apply-planned-change`.
3. Klik på **Pick from list** ved siden af `planId` og vælg planen.
4. Klik på **Plan and confirm**. Confirm-vinduet viser planens opsummering og hvad der ændres.
5. Bekræft. Ændringen dukker op i **Recent Changes** med **Undo**.

`get-planned-change` uden `planId` viser hver plan, der stadig venter. Planer udløber efter 15
minutter, og en genstart af bridgen fjerner dem. Hvis en plan er udløbet, så bed Claude planlægge den
igen.

## Tarokka-skuffen (🃏 Tarokka)

Kun for GM. Læsningen ligger i bridge-vaulten, uden for Foundry, så spillernes browsere aldrig modtager
den. At ændre noget kræver kontakten "AI Tool: Tarokka (writes)" (Game Settings, kategorien **Foundry
AI Tool**) og at GM Actions er slået til.

Øverste række:

- **↻ Refresh**: genindlæser læsningen.
- **New reading (built-in roll)**: lægger en ny læsning med værktøjets eget roll. Den forrige læsning
  gemmes i et arkiv.
- **Choose the cards**: til en læsning, du trak i hånden. Vælg de fem kort (de første tre fra det
  almindelige dæk, de sidste to fra det høje dæk, ingen to gange) og tryk på **Store this reading**.
  Intet bliver lagt. Den forrige læsning gemmes i et arkiv, og Undo bringer den tilbage. Den viser
  kortnavne, så den kun åbner, mens **Show cards** er afkrydset, og fjerner du krydset, skjules den
  igen.
- **📓 Obsidian**: åbner den aktuelle læsnings note i Obsidian.
- **Show cards**: kortnavnene vises som "Hidden card", til du sætter kryds her. Fjern krydset, før
  nogen kigger på din skærm.

Hver af de fem positioner viser:

- positionen og dens kort ("Hidden card", medmindre **Show cards** er afkrydset), og din note, når
  kortene vises;
- links: **Open Journal**, **Open Scene** eller **Open Actor** åbner det sammenkædede dokument på din
  Foundry-skærm (intet ændres); "not linked", når der ikke er et;
- "hidden from players" eller "revealed" (med **Open page** til reveal-siden);
- **Add a link**: søg i din worlds journals, sider, scener og actors, og klik derefter på **Link** ved
  den rigtige;
- **Reveal to players**: skriv en valgfri sidetitel og præcis det, spillerne må læse, og derefter **Plan
  reveal**. Spillerne får kun din tekst, aldrig kortets navn. Sæt kryds ved **Show it now** for at få
  siden til at poppe op på spillernes skærme, så snart du anvender revealen. Det er fra hver gang, med
  mindre du sætter kryds, og Undo tager revealen tilbage, men kan ikke lukke popuppen.

Import, ny læsning og link anvendes med ét klik, med en **Undo**-besked. En reveal åbner
confirm-vinduet med listen over, hvad der ændres, og det destruktive trin, fordi bordet ikke kan
glemme, hvad det har set. Hver af dem dukker op i Recent Changes og kan fortrydes der.

## Handout-skuffen (📜 Handouts)

Sæt handouts i kø under forberedelsen, og afslør dem derefter med ét klik ved bordet. Kun sider i kø
eller afslørede vises her: en ny journal (en, Claude lige har lavet, for eksempel) står ikke på
listen, før du trykker på **+ Queue a page** for den. Skuffen viser:

- **Queue**: de sider, du satte klar, med deres scene og hvem de er til. Brug **↑** og **↓** til at
  ændre rækkefølgen: den første side er den, **Reveal next** afslører. **Remove** tager en af køen.
  At sætte i kø ændrer intet i Foundry.
- **Reveal next: `<title>`**: planlægger revealen af den næste side i køen for den scene, der er aktiv
  nu (eller en side i kø til enhver scene). Et énlinjes vindue spørger `Show "<title>" to <players>?`
  (ingen afkrydsningsboks; revealen har en fungerende Undo). Når den anvendes, tages siden også af
  køen. Undo i Recent Changes skjuler den igen og sætter den tilbage i køen (en spiller kan allerede
  have læst den). Hvis køen er ændret, siden skuffen blev indlæst, viser vinduet planen i fuld
  længde. Sæt kryds ved **Show it now** ved siden af for også at få siden til at poppe op på skærmene
  hos de spillere, den er til (alle, når den er til alle spillere). Det er fra hver gang, med mindre
  du sætter kryds, og Undo kan ikke lukke popuppen.
- **+ Queue a page**: åbner Tool Runner på `plan-page-reveal` med `action` queue. Vælg siden,
  eventuelt en scene og de spillere, den er til, og kør den.
- **Revealed**: hvert handout, hvem det er til, og et flueben for hver spiller, der har åbnet det på
  spillersiden (hold musen over for tidspunktet).

Et handout til udvalgte spillere kan kun læses i Foundry af dem, og spillersiden viser det kun til en
spiller, der valgte det navn ("Playing as ...") øverst på siden.

## Prep-skuffen (📋 Prep)

Fakta til at forberede din næste session, ét sted og uden AI. **Refresh** genindlæser dem.

- **Last session**: dens dato og længde, scenerne i den rækkefølge, du besøgte dem, combats og rounds,
  spillerkaraktererne og de NPC'er, der gik ned til 0 HP (ikke hvem der døde: værktøjet ved aldrig
  det), de handouts, du afslørede (og hvem der har åbnet dem), og **Beats**, en kort liste over, hvad
  der skete. **All beats** henter hele listen, når den korte er afkortet.
- **Open threads**: quests, hvis Status ikke er done, og kampagnedele, der ikke er afsluttet eller
  sprunget over. **Open** viser journalen i Foundry.
- **Next session notes**: teksten i din journal med navnet "Next session". Hold den kun for GM;
  skuffen advarer dig, hvis spillerne kan se den. Uden den journal fortæller skuffen, hvordan du
  laver en.
- **Ready**: handout-køen pr. scene, bosserne på dine scener (legendary actions, legendary
  resistances, lair) og pre-flight-resultatet, med en knap til pre-flight-skuffen.
- **Recent changes**: hvor mange guarded changes der blev lavet, og de seneste.

Claude læser de samme fakta med `get-prep-digest`, som prompten `prep-next-session` bruger først.
Uden Foundry forbundet viser skuffen stadig last session og siger, hvad der mangler.

**Previously on.** `get-prep-digest` (ikke skuffen endnu) starter med et kort "Previously on":
GM-resuméet fra den nyeste optagede session, der har et. Den læser kun
`<sessions-mappe>/<dato>-discord/notes/summary.en.md` (eller `summary.da.md`, når kun det danske
er skrevet), aldrig spillernes recap-kladde eller en transskription. Sessions-mappen er
`FVTT_SESSIONS_DIR`, ellers `Documents\FoundrySessions` i din brugermappe, på den computer,
bridgen kører på. Hvis ingen session har et resumé endnu, eller bridgen ikke kan se mappen (den
kører på en anden computer), siger Claude det i én linje.

## Party-skuffen (🛡 Party)

Gruppen med et blik, fra dnd5e Group-actoren. Foundry laver gruppen af sig selv: AI Tool holder et
primært party (en Group-actor, der hedder "Party") og lægger hver karakter, en spiller ejer, ind i
det, så der er intet at sætte op. NPC'er og actors, ingen spiller ejer, bliver udenfor. Hvert
parti tilføjelser står i Recent Changes med Undo; vil du have en ældre karakter ud, så fjern den på
party-arket (den bliver udenfor dette party). Et party, du sletter, bliver lavet igen, næste gang en karakter tilføjes, eller verdenen indlæses. Vil du styre gruppen selv, så slå "AI Tool: Add player
characters to the party" fra i modulets indstillinger. Med mere end én Group-actor vælger en liste
øverst, hvilken.

- **Members**: hver karakters HP, AC, passive Perception, hit dice tilbage, conditions og
  exhaustion, death saves ved 0 HP, og om tokenet er på scenen og i encounteret. **Open** viser
  karakterarket i Foundry.
- **Who would notice**: med module-indstillingen **AI Tool: Who would notice** slået til, skriv en DC,
  og hver karakter viser chips for passive Perception, Investigation og Insight, med et flueben for en
  score på eller over DC'en og et kryds under. Scorerne er dnd5es egne, så conditions og exhaustion
  allerede er talt med. **Skill** viser alle tre eller kun én af dem. Kun du ser det; intet bliver rullet eller sendt til spillerne.
- **Travel pace**: Slow, Normal eller Fast. Hvis et medlem er slowed, siger skuffen, at gruppen
  alligevel bevæger sig i langsomt tempo.
- **Combat**: tilføjer gruppens tokens på den aktuelle scene til encounteret, eller starter et
  encounter med dem, når der ikke er et.
- **Place the party here**: scroll først Foundrys kort til stedet. Knappen sætter hvert medlem uden
  token på den scene, du kigger på, ved siden af hinanden på de nærmeste frie felter, omkring midten
  af dit udsnit (hvert token i sin egen størrelse, aldrig oven på et andet token, ikke bag en væg).
  Medlemmer, der allerede er på scenen, bliver, hvor de er. Undo fjerner de nye tokens igen, også
  efter du har flyttet dem; hvis du allerede har slettet et af dem i hånden, afviser Undo, så slet
  også de andre i hånden. Claude kan også placere dem ved et token, en map note eller et felt ("put
  the party at the inn door").
- **Rest**: sender dnd5es short rest- eller long rest-kort til chatten. Hver spiller klikker på det
  for at hvile sin egen karakter, det samme kort som Foundrys party sheet sender.
- **Ask for a roll**: vælg en check, save eller skill, en DC og privat eller offentlig, og klik derefter
  på **Ask the whole party**, eller **Ask roll** på ét medlem. Det sender roll-anmodningen til
  spillerens chat og play log (med GM Actions slået til). Det har intet confirm-vindue og ingen Undo,
  da det kun sender et roll-kort.

Hver af de andre knapper anvendes med ét klik, med en **Undo**-besked. Handlingerne kræver, at GM
Actions er slået til, og at module-indstillingen **AI Tool: Party (writes)** er slået til. Hver
ændring havner i Recent Changes med Undo; et rest-kort kan kun fortrydes, mens ingen har hvilet fra
det (derefter skal du slette kortet i Foundrys chat). Claude bruger de samme handlinger med
`get-party` og `plan-party-change`.
