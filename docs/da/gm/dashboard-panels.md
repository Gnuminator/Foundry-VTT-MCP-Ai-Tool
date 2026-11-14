---
source: gm/dashboard-panels.md
sourceHash: 01fc8de19e3a
title: 'Dashboardet: panelerne'
description: "During layouts, Combat Tracker, Tonight's stats, Session notes, Live Feed, Module Diagnostics og Recent Changes."
---

# Dashboardet: panelerne

Part of [Dashboardet](dashboard.md).

## Panelerne

### During layouts

Spillet foregår i Foundry; **During**-skærmen står ved siden af og holder øje med tingene. Den
findes i tre layouts. Vælg et med **Layout** øverst på skærmen:

- **Cards**: Live Feed er den store kolonne. Recent Changes, Handouts og Party er kort i siden;
  åbn dem, som du vil, også flere ad gangen. Combat order vises kun, mens en combat kører.
- **Simple/Full**: Simple viser kun Live Feed, Recent Changes og Handouts. **Show everything**
  skifter til Full: Combat order og Party også, alt åbent. **Show less** går tilbage.
- **Auto** (standard): følger spillet. Uden combat ser det ud som Cards. Når combat starter, vokser
  Combat order, og Party åbner i den store kolonne; Live Feed foldes ind i siden.

Knappen **Try layouts** ved siden af **Layout** starter prøven når som helst, med en eksempelkamp, så
du kan se, hvad Auto gør. Indtil en combat starter, ser Auto ud som Cards, og linjen ved siden af
**Layout** siger det.

Klik på **▸** eller et sammenfoldet korts titel for at åbne det, **▾** for at folde det sammen. I et
smalt vindue eller på en tablet bliver hvert layout til én kolonne med Recent Changes tæt på toppen;
på en telefon er Live Feed foldet sammen, til du trykker på det.

**Pick your During layout** (et kort på skærmen **Before**) viser de tre layouts på den rigtige
skærm, efter hinanden, med en lille guide i hjørnet (**Try the layouts** starter den): **Use this
one** beholder et layout, **Stop** beholder det, du havde. I Auto viser den en eksempelkamp (opdigtet,
intet sendes til Foundry). Spring den over, og Cards bliver stående. De første sessioner minder en
stille linje ved siden af **Layout** dig om, at de andre layouts findes; **✕** skjuler den. Layoutet
gemmes for denne world, i enhver browser.

### Combat Tracker

En smal strimmel øverst i visningen **During**. Den viser den aktive combat: initiative, hvis turn
det er (fremhævet), og hver deltagers HP-bar og tal. Hver række er mærket **PC**, **Enemy** eller
**NPC**. Den øverste linje viser rounden og antallet af deltagere. Turns, initiative og saves bliver i
Foundrys eget combat tracker, og damage går normalt gennem dnd5e-chatkortene der.

Over rækkerne er **initiative ribbon**: én strimmel i combat order, der starter med den, der er i gang.
Det væsen står stort med sit navn; de næste to er tydelige, og resten toner ud mod højre. Hver har
en ring i sin sides farve (PC, Enemy eller NPC), sit token-portræt (initialer, hvis det ikke har
noget), sin initiative, en lille HP-bar og sine to første conditions, med **Concentrating** først.
Klik på et portræt for at flytte GM'ens Foundry-visning til det token (den skifter først til
tokenets scene, hvis det er nødvendigt; hvis to GM'er er logget ind, viser den en fejl i stedet).
Portrætter kræver, at dashboardet kender Foundrys adresse: sæt `DASHBOARD_FOUNDRY_URL` til den, din
browser bruger, ellers vises initialerne (den samme indstilling afgør, hvem der må vise dashboardets
live-strimmel i et Foundry-vindue, så den skal passe præcist med den adresse, du skriver for at åbne Foundry).
En **Round**-markering viser, hvor rækkefølgen løber over i næste round, og en **Lair**-markering
viser, hvor en lair action falder, når en boss i combaten har en. Besejrede væsener er nedtonede og
tæller aldrig som næste. Ribbonen ændrer aldrig spillet; klikket flytter kun visningen på den skærm.

Combat i dashboardet er valgfri. Hvis du vil bruge den, kan strimlen give damage, healing og
conditions til flere deltagere på én gang. Mens en combat kører, og GM Actions er slået til (**Start
session** slår det til), klik på deltagernes rækker for at vælge dem (klik igen for at fravælge).
Med en eller flere valgt:

- **Damage / Heal**: åbner en lille formular: Damage eller Heal, ét beløb og chips for damage-type (så
  dnd5e tæller resistances, vulnerabilities og immunities med). Én knap, opkaldt efter hvad den gør
  ("Deal 8 fire damage to ... in Foundry"), anvender det med det samme på hvert valgt token; hver
  får hele beløbet. Toasten har **Undo**, og Recent Changes gemmer ændringen. Der er intet
  confirm-vindue til denne formular.
- **Condition**: åbner en række condition-chips under strimlen. Klik på én (fx **prone**); ét enkelt
  spørgsmål spørger "Set prone on ...?", og **Set prone** sætter den på hvert valgt token. Toasten
  har **Undo**, og Recent Changes gemmer ændringen. Vil du fjerne en condition, så brug chippen på
  live-strimlen eller panelet **Conditions**.
- **Clear**: fravælger alle (og lukker formularen Damage / Heal eller condition-chipsene).
- **Ask for a roll** (under strimlen, med GM Actions slået til): vælg en check, save eller skill, en
  DC og privat eller offentlig, og klik derefter på **Ask the party**, eller **Ask** for de valgte
  spillerkarakterer. Anmodningen går til hver spillers chat og til play log på én gang, uden
  confirm-vindue og uden Undo (den sender kun et roll-kort).

Efter en ændring med Damage / Heal eller Condition viser en besked hvert måls resultat ("Wolf 2: HP
11 to 5") med **Undo** i nogle sekunder; ét klik sætter det tilbage. Senere bruger du **Undo** i
Recent Changes.

**Scene mood** (en knap på During-linjen, når GM Actions, AI Tool: Allow Write Operations og Foundrys
"AI Tool: Scene mood and music (writes)"-kontakt er slået til): én knap for hver mood-preset, der er
gemt på den scene, du ser. Et klik spørger én gang med planens egen opsummering ("Apply mood ... on
..."), og sætter derefter mørke, lys, vejr og musik. **Undo** er på beskeden og i Recent Changes. En
kontakt, der er slået fra, holder knapperne grå og siger hvilken (**Turn on** står ved siden af til
de to første). Presets gemmer du ved at bede Claude gemme scenens udseende som en preset; skifter du
scene, mens panelet er åbent, genindlæser næste klik listen i stedet for at anvende noget.

**Conditions** (en knap på During-linjen, når GM Actions er slået til; den virker både i
en combat og udenfor): afkryds tokens på den scene, du ser, vælg en condition, og klik **Add** eller
**Remove**. Det sker med det samme, med **Undo**, og der er intet confirm-vindue. For Exhaustion
hæver Add med ét niveau, og Remove fjerner dem alle. Et **rules**-link ved hver condition åbner
dnd5e's egen side for den i Foundry.

**Start combat** og **End combat**: når ingen combat kører, og GM Actions er slået til, tilbyder Combat
Tracker **Start combat** (i de fleste During-layouts åbner en lille **Start combat**-knap på
During-bjælken det samme). Den viser tokens på den scene, du ser, med spillerkarakterer og Hostile
tokens afkrydset. Ændr fluebenene, og klik på **Start combat with N**. Combaten starter i round 1, med
**Undo**. Et afkrydsningsfelt, **Ask the player characters to roll initiative**, sender hver afkrydset
spillerkarakter en offentlig rulle-anmodning; når de ruller, står tallet i trackeren. Undo fjerner
combaten, men anmodningerne bliver i chatten. Den, der har turn, viser **Up now**. Ændrer du en initiative
bagefter (værktøjet **set-initiative**), skifter rækkefølgen, men turnen flytter sig ikke.
**End combat** planlægger at afslutte combaten og stiller ét enkelt spørgsmål; du bekræfter, og Undo
(på toasten og i Recent Changes) bringer den tilbage.

**👑 Boss prompts** (i panelets øverste linje, kun mens et væsen med legendary actions eller en lair
er med i combaten; slået fra, til du slår det til, og husket i denne browser). Slå det til før den
første bosskamp. Det viser:

- **Legendary**- og **Resist**-pips på hver boss-række: fyldte for brug tilbage i denne round, som
  dnd5e tæller dem (et væsen i sin lair kan have en mere). Brug dem på væsenets sheet i Foundry;
  pipsene følger med inden for få sekunder.
- En **🏰 Lair action**-påmindelse, når initiative passerer 20 (eller lairens egen
  værdi), for et væsen hvis "in lair"-felt er afkrydset på dets sheet.
- **⚡ legendary actions left** for hver boss, der ikke har sin egen turn.
- En **R**-knap på hver boss, der stadig er i live: klik på den, når væsenet bruger sin reaction.
  Markeringerne nulstilles i næste round. De bliver på dashboardet; intet ændres i Foundry.

Spillersiden viser aldrig noget af dette.

### Hjælp: "?" på hvert panel

De fleste paneler har et lille **?** ved siden af titlen. Det åbner denne guide ved panelets afsnit,
i et sidepanel over dashboardet; links inde i den åbner også de andre guide-sider der. **📖 GM
guides** i menuen **Advanced** åbner listen over guides. Hjælpen er bygget ind i dashboardet, så
den virker uden internet og passer altid til den installerede version. Sidepanelet har et link
øverst, **Open this page on the wiki**. Det åbner den samme side på hjemmesiden (kræver internet),
som er nemmere at læse på en ekstra skærm og har søgning.

### Tonight's stats (After)

Øverst i visningen **After**, for den session, der lige er slut:

- **Rolls**: hvor mange, med de naturlige 20'ere og naturlige 1'ere.
- **Most damage**: den helt, der gjorde mest damage, og over hvor mange combats.
- **Highest roll**: det højeste d20-roll af en helt (attacks, saves, checks, initiative; damage
  tæller ikke), hvem der slog det, og hvad det var. Det kan være et privat eller blind roll, så det
  bliver på din skærm.
- **Went down**: hvilke helte der faldt til 0 HP, og hvor ofte.

Under dem: sessionens længde, **Open the session note** (i Obsidian, når det er sat op) og **Copy
the stats for Discord**, som kopierer de offentlige roll-tal, mest damage og hvem der gik ned til
spillernes kanal, uden det højeste roll. Roll-tallene udelader private og blinde rolls, så de kan
være lavere end tallene på din skærm (en ældre bridge sender ingen offentlige tal, og så udelades
roll-linjen). **↻ Refresh** henter dem igen. Tallene kommer fra værktøjets play log, det samme som
afsnittet Stats i Obsidian-sessionsnoten.

### Session notes (After)

Under tonight's stats, når noterne fra en optaget session findes (session-pipelinen skriver dem efter
sessionen). Værktøjet lægger dem i Foundry **af sig selv, uden at spørge**: en journal kun for GM i mappen
"Session notes" (navngivet med dato og titel), med siderne Recap, GM summary og Scenes, logget i Recent Changes med Undo. Kortet
siger, hvor de er:

- **Waiting**: de kommer ind af sig selv, så snart en GM er i Foundry, "AI Tool: Allow Write Operations" er
  slået til, og kontakten "AI Tool: Session notes (writes)" er slået til; kortet siger, hvilken der
  mangler. Efter en **Undo** bliver de ude, til du klikker på **Put in Foundry**.
- **In Foundry**: Recap venter i Handouts-køen. Afslør den der, eller klik på **Approve without
  revealing**. **Undo** tager journalen ud igen, men ikke når spillerne har Recap, eller en side er
  redigeret i Foundry.
- **Approved**: at afsløre Recap eller godkende markerer sessionen som godkendt. Optagelsens lyd
  gemmes i begge tilfælde (D-097). Godkendelsen bliver stående, selv om du tager noterne ud med Undo
  bagefter; kortet tilbyder så **Put in Foundry** for at lægge dem ind igen.

**Read** viser alle siderne i sidepanelet. Kortet, GM summary og scenerne når aldrig spillernes side;
kun Recap gør, når du afslører den.

### Live Feed

Det, der sker ved bordet, nyeste øverst: damage, healing, hvem der falder til 0 HP, conditions, spell
slots, rolls, scene-skift og mere. Hver linje viser sin type og tidspunktet.

- Du ser hvert rolls fulde regnestykke, for eksempel "Wolf 1, Bite attack: 1d20 (15) +2 STR +2
  proficiency = 19", plus målets AC eller DC og udfaldet, når de kendes.
- Private og blinde rolls viser en **private roll**-chip. Spillerne ser dem aldrig. Roll-anmodninger
  vises som **roll request**, og en, der falder til 0 HP, viser **down**.
- En linje, der begynder med "Applied:" eller "Undid:", dukker op, når en guarded change anvendes
  eller fortrydes. Dens chip nævner, hvad der gjorde det, for eksempel **actor change** eller **page
  reveal**.

### Module Diagnostics

Fejl og advarsler fra Foundry-modulerne, fanget i GM'ens browser. Hold musen over en linje for
detaljer. Nyttigt, når noget i Foundry opfører sig forkert midt i en session. Gamle poster kan blive
stående på listen efter en genindlæsning.

Øverst siger en gul linje, når serverens tjek af lagerplads ikke har kørt i over 3 timer. Der er
ikke noget galt endnu, men ingen holder øje med pladsen: sig det til den, der driver serveren.

Serveren (Orange Pi) tjekker selv sin ledige diskplads hver time: under 20 % ledig er lavt, under 5
% (eller mindre, end en backup skal bruge) er kritisk, og en backup stopper. Advarslen kommer også
som en Discord-besked til den, der driver serveren.

### Recent Changes

Hver guarded change, der blev anvendt, nyeste først, op til 20. Hver række viser:

- en opsummering og **Undo**, når ændringen stadig kan fortrydes;
- dens tilstand: `applied`, `destructive` (en anvendt ændring af den destruktive slags: en sletning,
  en reveal eller en hide), `undone` eller `undo` (selve fortrydelsen);
- featuren (for eksempel `tarokka` eller `handouts`), hvad den ændrede, og hvornår;
- "N line(s)": klik for at se hele listen over, hvad der blev ændret;
- 📓 Obsidian: åbner den måneds ændringshistorik i Obsidian.

**Undo** beder om den anden bekræftelse og kræver, at GM Actions er slået til. Den sætter værdierne
fra før ændringen tilbage. Den afviser og skriver ingenting, hvis det samme er ændret igen siden.
Undo virker, selv når featurens kontakt er slået fra; Redo kræver, at den er slået til. Klik på **↻**
for at genindlæse listen.

Kun guarded changes står her: damage, healing, conditions, resources samt flytning, redigering og
sletning af tokens. Ændringer fra andre værktøjer (rolls, nye actors) står her ikke og kan ikke
fortrydes her.

**De tre faner.** Når AI Tool på serveren er ny nok, har Recent Changes tre faner: **Tool**
(listen ovenfor: de guarded changes, der er gjort gennem AI Tool, altså Claude og dashboardets
knapper, med Undo, hvor den stadig kan bruges), **Game** (hvad spillerne og du selv gjorde direkte i Foundry de sidste 7 dage, som hit points,
items og tokens) og **Everything** (begge dele sammen, nyeste først). Hold musen over en fane for at
se det. Ændringer fra dashboardet, som "Poisoned on Randal ... by GM (dashboard)", står under Tool.
På Game og Everything kan du vælge en person i listen over rækkerne for kun at se vedkommendes
ændringer (Everything har også **Tool** i listen). Dashboardet husker den fane, du valgte, til næste gang. Hver række viser hvem, hvornår, hvad der blev ændret og, under "N line(s)", detaljerne.
En række flytninger af det samme token af den samme person er én række ("moved 6 times"); dens
**Undo** tager kun den seneste flytning tilbage, og Foundrys Changes-vindue viser stadig hver
flytning. **Undo** virker på alles ændringer. Den viser først, hvad den vil sætte tilbage, og du
bekræfter. Hvis det samme er ændret siden, står der "This is not the latest change to ...",
de senere ændringer vises, og du vælger **Just this** (beholder de senere ændringer), **Everything
since** (sætter tingen tilbage til, som den var før denne ændring) eller **Cancel**. Under
**Advanced** (i det første spørgsmål, uanset hvilket det er) fortryder **Rewind the whole table to
here** hver ændring ved bordet siden da; den viser, hvor mange ændringer det er, og spørger to
gange. En fortrudt ændring er markeret "Undone by ...", med **Redo** til at sætte den tilbage, når
det stadig kan lade sig gøre. Når den blev fortrudt sammen med andre ændringer (Everything since
eller et rewind), siger Redo det og bringer alle tilbage. Undo kræver, at GM Actions er slået til,
som alt andet, der ændrer spillet. Den samme liste findes også i Foundry, som vinduet **Changes**
(nedenfor), og, når Obsidian er sat op, i din vault som én note pr. dag under `AI Tool/Everyone/` (til
at læse, ikke til at fortryde fra).

### Den samme liste inde i Foundry

Du behøver ikke have dashboardet åbent for at se eller fortryde, hvad der blev ændret. I Foundrys
venstre værktøjslinje (scene controls) er der en gruppe **AI Tool**, kun vist for GM'er. Det er
**tryllestav-ikonet** (sparkles) nederst i kolonnen, under Tokens, Tiles, Drawings, Walls, Lights,
Sounds, Regions og Journal Notes; hold musen over det for at se "AI Tool". Klik på det, og klik
derefter på **Changes**: et vindue åbner med alt, der blev ændret i den sidste uge, nyeste først, af
spillere, af dig og af AI'en. Hver række viser tidspunktet, hvem der gjorde det ("by Thorin", eller
et **AI**-mærke), hvad der blev ændret, og **Undo**, så længe ændringen stadig kan fortrydes. Klik på
"Changes" på en række for at se de linjer, der blev ændret, og **Show more** for de sidste 100.
**Show:** øverst indsnævrer listen til **All**, **AI** eller én person. **AI** viser kun det, AI'en
ændrede; en person viser, hvad den person ændrede, og de undos, vedkommende kørte fra dette vindue.

**Undo** beder dig bekræfte først og viser, hvad der sættes tilbage, og siger derefter "Undone: ...",
eller fortæller, hvorfor den afviste (for eksempel fordi det samme er ændret igen siden). Hvis
ændringen ikke er den seneste på den ting (for eksempel hvis Thorins HP blev ændret igen bagefter), viser
vinduet de senere ændringer og spørger:

- **Just this**: fortryd kun denne ændring og behold de senere.
- **Everything since**: fortryd denne ændring og hver senere ændring af den samme ting.
- **Cancel**: intet ændres.

Under **Advanced** er der også **Rewind the whole table to here**. Den fortryder hver ændring af alle
ved bordet siden da, så den spørger to gange: først med hele listen og antallet af ændringer, derefter
igen med en knap, der nævner det tal.

En række, der blev fortrudt, siger "undone" (og af hvem, når det er kendt). Den får **Redo**, når
fortrydelsen selv kan tages tilbage; Redo beder dig bekræfte og bringer ændringen tilbage. Listen
opdaterer sig selv, når noget ændres, og **Refresh** genindlæser den i hånden. På en ældre AI
Tool-bridge viser vinduet kun AI'ens ændringer, uden filteret eller Redo, og Undo fortryder bare den
ene ændring.

Hvis vinduet siger, at AI Tool-bridgen ikke er forbundet, kører den browser, der holder forbindelsen
til AI Tool (Assistant GM-browseren på serveren), ikke; spørg den, der driver serveren. Hvis der
står "Update the AI Tool bridge to use this window", er bridgen på serveren ældre end dette module;
bed den, der driver serveren, om at opdatere den. Et klik på AI Tool-gruppen lader kortet være, som
det var: det ændrer kun, hvilke knapper værktøjslinjen viser, og et klik på en anden gruppe (Tokens,
for eksempel) bringer de sædvanlige værktøjer tilbage.

### Handouts inde i Foundry

Den samme gruppe **AI Tool** har en knap **Handouts**. Den åbner et vindue med det, dashboardets
handout-skuffe viser, så du kan afsløre et handout uden at forlade Foundry:

- **Queue**: de sider, du satte klar, ældste først. Hver række siger, hvilken scene den er til (eller
  "any scene") og hvilke spillere (eller "all players"). **Remove** tager en side af køen med det
  samme; intet ændres i Foundry.
- **Reveal next**: afslører den ældste side i køen for den scene, der er aktiv nu. Et vindue viser
  præcis, hvad der ændres, og beder dig bekræfte, fordi en reveal ikke kan tages tilbage ved bordet.
  Cancel, og intet sker. Undo i **Changes** skjuler siden igen og sætter den tilbage i køen.
- **Show it now**: sæt kryds ved siden af **Reveal next** for også at få siden til at poppe op på
  skærmene hos de spillere, den er til. Det er uden kryds, hver gang vinduet åbner, og går tilbage til
  uden kryds efter hver reveal (også efter en cancel), så det er et valg, du tager hver gang.
  Krydset bliver stående, mens du beslutter dig: en opdatering fjerner det ikke. Undo kan ikke lukke
  popuppen.
- **Who has read what**: hvert afsløret handout, hvem det er til, og et flueben ved navnet på hver
  spiller, der har åbnet det på spillersiden (hold musen over for tidspunktet).

Vinduet opdaterer sig selv, når et handout afsløres eller fortrydes, og **Refresh** genindlæser det i
hånden. Hvis noget går galt (for eksempel hvis handout-kontakten er slået fra), står årsagen øverst
i vinduet. Det kræver den samme bridge-forbindelse som Changes-vinduet.

### Tarokka inde i Foundry

Gruppen **AI Tool** har også en knap **Tarokka** (kun for GM'er). Den åbner et vindue med de fem
positioner i den aktuelle læsning, så du kan afsløre et kort uden at forlade Foundry. Læsningen er
den, dashboardets Tarokka-skuffe viser. Den øverste linje siger, hvor den kom fra, hvornår den blev
lagt eller importeret, og hvor mange ældre læsninger der er arkiveret. Hvis der endnu ikke er en
læsning, siger vinduet det: en læsning lægges eller importeres fra dashboardet, eller ved at bede
Claude.

- **Show cards**: kortnavnene og dine noter forbliver skjult ("Card hidden"), til du sætter kryds
  her. Det er uden kryds, hver gang vinduet åbner eller lukker, og en opdatering fjerner det ikke.
  Fjern krydset, før nogen kigger på din skærm.
- Hver position viser sin label, kortet (når Show cards er afkrydset) og din note. **Open Journal**,
  **Open Scene** eller **Open Actor** åbner det sammenkædede dokument på din skærm (intet ændres);
  "not linked", når der ikke er et. En position er enten "hidden from players" eller "revealed", med
  **Open page** til reveal-siden.
- **Reveal...** (positioner, der endnu ikke er afsløret): åbner en lille formular under positionen.
  Skriv præcis det, spillerne må læse (1 til 5000 tegn), og, hvis du vil, en sidetitel. Sæt kryds ved
  **Show it now** for at få siden til at poppe op på spillernes skærme, så snart revealen er anvendt;
  det er uden kryds, hver gang formularen åbner. Klik derefter på **Reveal**: et Foundry-vindue viser
  præcis, hvad der ændres, og beder dig bekræfte, fordi en reveal ikke kan tages tilbage ved bordet.
  Cancel, og intet sker (din tekst bliver i formularen). Undo i **Changes** tager revealen tilbage,
  men kan ikke lukke popuppen. Spillerne får kun din tekst, aldrig kortets navn.

Det, du skriver i en formular, bliver stående, når vinduet opdaterer sig selv (det opdaterer, når en
ændring bliver registreret, og **Refresh** genindlæser det i hånden). At knytte et kort og at lægge
eller importere en læsning er ikke i dette vindue: brug dashboardets Tarokka-skuffe, eller bed
Claude. At ændre noget kræver den samme kontakt "AI Tool: Tarokka (writes)" som skuffen; hvis den er
slået fra, står årsagen øverst i vinduet.
