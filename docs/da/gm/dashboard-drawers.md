---
source: gm/dashboard-drawers.md
sourceHash: 2c24a2d67963
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

> **Usikker? Spørg Claude.** Spørg GM coach: "Hvornår beder dashboardet mig om at bekræfte en ændring, og hvornår bliver den bare udført?" ([sådan tilføjer du GM coach](gm-coach.md))

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

### Pins og seneste kørsler

Når du har udfyldt en tool-formular, du bruger ofte, så klik **📌 Pin** og giv den et navn. Den vises
så som en knap i rækken **Pinned** på During-baren. En read kører med det samme, og svaret vises under
rækken. En plan eller en write går stadig gennem GM Actions og confirm-vinduet, så en pin ændrer aldrig
noget af sig selv. I Tool Runner kan du omdøbe og fjerne pins. Den viser også dine sidste otte kørsler
(klik på en for at udfylde formularen igen) og de tre kald, du bruger mest, hver med en **Pin**-knap.
Pins gemmes i denne browser, så på en ny computer pinner du igen.

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

> **Usikker? Spørg Claude.** Spørg GM coach: "Hvordan bruger jeg Tool Runner til at udføre en plan, Claude har lavet?"

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

> **Usikker? Spørg Claude.** Spørg GM coach: "Hvordan sætter jeg et handout i kø under forberedelsen og afslører det ved bordet?"

**Handout press.** Vil du have et handout til at ligne et brev på gammelt papir med et vokssegl, en
opslagstavle-seddel eller et kort, så bed Claude om at presse et: giv den teksten, så bruger den
`plan-handout-press` (i Play-connectoren). Den tegner billedet på den computer, dashboardets
backend kører på, med den Edge, Chrome eller Chromium, der allerede er installeret der (Pi har
måske ingen, så bed fra en PC-session) og uden billed-AI. Når planen anvendes,
lægges en skjult billedside i journalen "Handouts". Spillerne ser intet endnu: sæt den i kø og
afslør den som ovenfor. Undo i Recent Changes fjerner siden. Tekst, der nævner et hemmeligt
begreb, afvises.

- **Slå det til:** i Foundry, Game Settings, kategorien **Foundry AI Tool**, sæt kryds ved "AI Tool:
  Handouts (writes)" (den samme kontakt som til at afsløre handouts).
- **Hvad spillerne ser:** kun det færdige billede, når du afslører det.

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
- **Loose ends**: de åbne quests, ingen har opdateret i to sessioner, de NPC'er, der kun handlede i én
  session, og de scener, der ikke er brugt i to sessioner, hver med "last seen session N", plus et
  antal scener, der aldrig er brugt. Det er kun en påmindelse fra play log og session log; intet
  ændres. Claude får den samme liste fra `get-prep-digest`.

Claude læser de samme fakta med `get-prep-digest`, som prompten `prep-next-session` bruger først.
Uden Foundry forbundet viser skuffen stadig last session og siger, hvad der mangler.

**Omens by post.** Mellem sessionerne kan du sende hver spiller en kort privat tekst som hint om,
hvad der kommer. Claude skriver kladderne (bed "Draft an omen for each player"; den bruger
`draft-omens` i Prep-connectoren), men kan hverken godkende eller sende. Skuffens liste **Omens by
post** viser hver kladde med spillerens navn:

- **Approve** eller **Reject** hver enkelt. En tekst, der nævner et hemmeligt begreb (et
  Tarokka-kortnavn, for eksempel), viser en advarsel og beder dig bekræfte, før den tæller som
  godkendt. **Back to draft** tager en godkendt eller afvist tilbage.
- **Discord ids for omens:** en spiller uden Discord-bruger-id endnu viser "no Discord id yet, it cannot be sent". Åbn
  det fold-ud, skriv spillerens Discord-bruger-id (kun cifre) og link det.
- **Slå det til:** den, der kører Discord-botten, sætter `DISCORD_OMENS=1` i botens `.env`. Det er
  slået fra som standard, og med det slået fra bliver en godkendt tekst liggende. Hvis dashboardet
  deler GM- og spiller-token, skal botten også have `FOUNDRY_AI_GM_TOKEN`.
- **Hvad spillerne ser:** én privat Discord-besked hver, sendt én gang inden for få minutter efter
  din godkendelse, kun til den spillers egen konto. Ingen ser en anden spillers tekst, og intet
  vises på player page. En mislykket afsendelse prøves automatisk igen nogle gange; lykkes den stadig ikke, siger listen hvorfor, og du kan godkende den igen.

Du kan altid læse et hint højt eller skrive det i chatten i stedet; det her er et ekstra.

**Downtime fra spillerne.** På My character kan en spiller skrive, hvad karakteren gør mellem
sessionerne (se [My character](dashboard-player-pages.md)). Prep digest viser hver spillers indlæg,
alle markeret "from player": de er ønsker, ikke noget, der er sket. Når du forbereder, så spørg
Claude "What did the players ask to do in their downtime?", så læser den dem med `get-prep-digest`.
Selve skuffen viser dem ikke.

**Previously on.** `get-prep-digest` (ikke skuffen endnu) starter med et kort "Previously on":
GM-resuméet fra den nyeste optagede session, der har et. Den læser kun
`<sessions-mappe>/<dato>-discord/notes/summary.en.md` (eller `summary.da.md`, når kun det danske
er skrevet), aldrig spillernes recap-kladde eller en transskription. Sessions-mappen er
`FVTT_SESSIONS_DIR`, ellers `FoundrySessions` i datamappen (`FVTT_DATA_DIR`) eller i `Documents` i din brugermappe, på den computer,
bridgen kører på. Hvis ingen session har et resumé endnu, eller bridgen ikke kan se mappen (den
kører på en anden computer), siger Claude det i én linje.

## Read-aloud-skuffen (📖 Read-aloud)

Under **Advanced** finder du **📖 Read-aloud**. Den viser den indrammede oplæsningstekst fra de
journal-sider, den aktuelle scene linker til (scenens eget link og dens map pins), i rækkefølge, så du
ikke skal grave i modulet, mens spillerne venter. **Show** åbner én blok i fuld størrelse på en skærm,
spillerne kan se; **Copy** lægger den på udklipsholderen. Teksten læses fra din world, når du åbner
skuffen, og gemmes aldrig. En scene uden indrammet tekst siger det. Claude kan læse den samme tekst
med `get-read-aloud`.

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

> **Usikker? Spørg Claude.** Spørg GM coach: "Hvad kan jeg gøre fra Party-skuffen, og hvad viser Who would notice mig?"
