---
source: gm/dashboard.md
sourceHash: efb128f2fb0a
title: Dashboardet
description: En rundtur i alle paneler og knapper på dashboardet, hvad de gør, og hvornår du bruger dem.
---

# Dashboardet

Dashboardet er dit kontrolpanel. Åbn det i en browser på en ekstra skærm ved siden af
Foundry. Adressen er den, tool-administratoren gav dig (på administratorens egen pc er den
`http://localhost:3000`).

Det er altid sikkert at kigge med. Bortset fra session-markeringerne og at sætte et handout i kø
ændrer intet på dashboardet spillet, før du slår **GM Actions** til og bekræfter.

> Hold dashboardet væk fra alle skærme, som spillerne kan se, og del aldrig dets vindue i Discord eller
> et videoopkald. Det viser de rigtige navne, præcis HP, private rolls og, når du beder om det,
> Tarokka-kort.

## De tre visninger

Fanerne **Before**, **During** og **After** i headeren skifter, hvad siden viser. De følger din
aften, og du kan klikke på hver af dem når som helst.

- **Before**: Pre-flight-tjekket og Prep-panelet, kortet **Pick your During layout** (indtil du
  har valgt et layout).
- **During**: Combat order-strimlen, Live Feed og Handouts, Party og Recent Changes.
- **After**: Tonight's stats og Session notes, med Prep, Handouts og Recent Changes.

Siden vælger en visning for dig: **During**, mens en session er åben, **After** i 12 timer efter
du klikker på **End session**, ellers **Before**. En fane, du klikker på, bliver stående, til en
session starter eller slutter, eller du genindlæser siden.

## Headeren

### Forbindelsesmærket og Pre-flight

Siden på `/` har ingen række af statuslys. To ting fortæller dig om forbindelsen:

- **Forbindelsesmærket.** Ved siden af knapperne dukker et lille mærke kun op, når noget er galt:
  "Connection lost, reconnecting…" betyder, at siden har mistet forbindelsen til dashboard-programmet
  (er dets vindue stadig åbent?). Siden prøver igen af sig selv. "Connection closed: reload the page"
  betyder, at den har givet op; genindlæs siden. Intet mærke betyder, at forbindelsen er i orden.
- **✈ Pre-flight.** Knappen står som "✈ Pre-flight: ready" eller "✈ Pre-flight: N to fix". De første
  linjer siger, om Foundry er forbundet ("Foundry connected"). Hvis ikke, så sig det til
  tool-administratoren: AI Toolets forbindelse til Foundry (en browser på serveren) er nede. Hvert
  panel viser også sin egen besked, når det ikke kan læse spillet.

### Theme

En **Theme**-dropdown i headeren (Neutral eller The Veil) bestemmer udseendet for denne world.
Spillernes side og Obsidian følger med.

### Session: Start session / End session

Markerer start og slut på en spilsession. Værktøjet bruger markeringerne til at skrive én
Obsidian-note pr. session og til at gruppere play log.

- **Start session** er knappen i headeren. Den slår også GM Actions og alle
  **Turn on for tonight**-kontakter til (se "GM Actions on" nedenfor).
- Klik på **Start session**, når spillet begynder. Teksten skifter til "Session since 19:30".
- Klik på **End session**, når spillet er slut. Teksten skifter tilbage til "No session". Den slår
  også det fra igen, som **Turn on for tonight** slog til (se nedenfor), og GM Actions.
- Når en session starter, skrives en linje i værktøjets egen log, og GM Actions slås til, så
  værktøjer, der ændrer spillet, kan køre, når du har bekræftet.
- Hvis du glemmer det, deler noterne stadig sessionerne ved et hul på 3 timer uden hændelser.

Obsidian-knappen ved siden af åbner din kampagnes Home-note i Obsidian (se "Open in Obsidian" nedenfor).

### GM Actions on

**Start session** er den eneste kontakt til GM Actions. Ét klik slår GM Actions og alle
**Turn on for tonight**-kontakter til; **End session** slår dem fra igen. Knappen i headeren
viser tilstanden og åbner listen over kontakter. Når siden ikke kan læse kontakterne, siger
knappen det (og siger stadig til, hvis GM Actions er slået fra).

- **GM Actions on**: værktøjer, der ændrer spillet, kan køre, når du har bekræftet, og Undo
  i Recent Changes virker.
- **Something is off** (knappen siger "GM Actions off: Turn on"; hold musen over den for at se, hvad der er slået fra): de knapper, der skal bruge det,
  bliver stående på skærmen, nedtonede, med årsagen og en **Turn on**-knap ved siden af. Ét klik
  slår alt til, det samme som Start session.
- Det beskytter kun dashboardet. Det stopper ikke Claude Desktop.
- Når dashboardet genstarter, bliver GM Actions slået fra igen.

Headeren har ingen fra-knap. Start session slår GM Actions til; **End session** eller Pre-flights
**Turn them off again** slår det fra.

### 🛠 Tool Runner (Advanced)

Under **Advanced ▾**, **Tool Runner**. Åbner Tool Runner. Se "Tool Runner" nedenfor.

### ✈ Pre-flight

I headeren, ved siden af **Advanced ▾**. Åbner pre-flight-tjekket: kør det, før spillerne kommer
på. Værktøjet sætter selv flueben ved det, det kan tjekke (Foundry connected, module- og
bridge-versioner passer sammen, skrivekontakterne, hemmeligheder i world-indstillinger, navne,
som spillerne kan se, og som afslører en hemmelighed, module-konflikter, Obsidian-noter, play session,
Turn on for tonight, spillersiden, Tarokka-kort skjult). Under det står de ting, du selv skal
tjekke, fra [før hver session](before-session.md); dine flueben bliver i denne browser, til du
klikker på **Clear ticks**. Selve knappen står som **Pre-flight: ready** eller **Pre-flight: 2 to
fix** efter hver Foundry-forbindelse.

En værdi, der ligner en hemmelighed, vises aldrig fuldt ud, kun de første fire tegn og længden. Hvis
module- og bridge-versionerne er forskellige, siger et banner øverst, hvilken af dem du skal
opdatere.

#### Turn on for tonight

Øverst i Pre-flight-panelet. Ét klik slår det til, som en aften ved bordet kræver:

- i Foundrys module-indstillinger: "Allow Write Operations", "AI Tool: Handouts (writes)", "AI Tool:
  Live play (writes)", "AI Tool: Party (writes)" og "AI Tool: Tarokka (writes)";
- på dashboardet: **GM Actions**.

Det slår kun det til, der er slået fra, og husker det i worlden. **End session** (eller **Turn them
off again**) slår præcis dem fra igen, så en kontakt, der allerede var slået til, forbliver slået til.
Chipsene under knappen viser hver kontakt (✓ til, ○ fra). Hvis Foundry ikke tog imod en ændring,
nævner en rød toast kontakten; tjek den i Foundrys module-indstillinger, hvor hver kontakt altid
er synlig.

En afvisnings-toast ("... is switched off") tilbyder det samme klik som en knap, "Turn on (switch
name) and the rest for tonight": den slår alt ovenstående til, ikke kun den nævnte kontakt.

Kun dashboardet kan gøre det, fra GM'ens login. Claude har intet værktøj til det, så Claude kan
aldrig selv slå sine skrivninger til. **Start the session log and GM Actions** ved siden af er det
samme som **Start session** i headeren.

### 📜 Handouts (Advanced)

Under **Advanced ▾**, Panels. Åbner handout-skuffen. Se "Handout-skuffen" nedenfor.

### 📋 Prep (Advanced)

Under **Advanced ▾**, Panels (Prep sidder også fast i visningerne Before og After). Åbner
prep-skuffen. Se "Prep-skuffen" nedenfor.

### 🛡 Party (Advanced)

Under **Advanced ▾**, Panels. Åbner party-skuffen. Se "Party-skuffen" nedenfor.

### 🃏 Tarokka (Advanced)

Under **Advanced ▾**, Panels. Åbner Tarokka-skuffen. Se "Tarokka-skuffen" nedenfor.

### 🔗 Player links (Advanced)

Under **Advanced ▾**, Tools. Hver spillers private link til sin egen karakterside. Se "Spillerlinks
og My character" nedenfor.

### 🩺 Module diagnostics, 📦 Versions og Version tracker (Advanced)

Flere punkter under **Advanced ▾**, Tools:

- **🩺 Module diagnostics** viser eller skjuler panelet Module Diagnostics (se nedenfor).
- **Version tracker: on / off** er slået til som standard. Mens den er til, dukker et punkt
  **📦 Versions** op i samme menu; slå den fra for at skjule det og stoppe opslagene online. Det
  åbner en tabel over, hvad der er installeret (Foundry, spilsystemet og modulerne), ved siden af den
  nyeste udgave, med en status for hver. Den fortæller kun, hvad der er forældet; den opdaterer
  aldrig noget.

### 📝 After a paper night (Advanced)

Under **Advanced ▾**, Panels (der er også et kort til det i visningen **After**). Til et bord, der
spillede på papir: ét kort pr. spillerkarakter, udfyldt ud fra arket i Foundry. Skriv tallene fra
papirarket; **Plan** laver én ændring pr. karakter, med den sædvanlige confirm og Undo. Det kræver
GM Actions og module-kontakten "AI Tool: Paper sync (writes)".

### ▦ Try the During layouts

Ét punkt under **Advanced**, i gruppen **During screen**:

- **▦ Try the During layouts** starter den korte layout-prøve igen (se During layouts nedenfor).

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

**Scene mood** (en knap på During-linjen, når GM Actions, Allow Write Operations og Foundrys
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

- **Waiting**: de kommer ind af sig selv, så snart en GM er i Foundry, "Allow Write Operations" er
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
  allerede er talt med. Kun du ser det; intet bliver rullet eller sendt til spillerne.
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
