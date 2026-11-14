---
source: gm/dashboard-header.md
sourceHash: 47dc64b0aa16
title: 'Dashboardet: visninger og header'
description: 'De tre visninger og headeren: forbindelsesmærke, Pre-flight, theme, session-knapper, GM Actions og Advanced-menuen.'
---

# Dashboardet: visninger og header

Part of [Dashboardet](dashboard.md).

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

### Table at a glance

**Live views ▾** og så **Table at a glance** åbner en skrivebeskyttet side til en telefon eller en
tablet ved bordet. Tre paneler: **Party** (hver karakters HP og tilstande), **Fight** (rækkefølgen
med den aktuelle tur markeret) og **Scene** (den scene, du er på). Hvert panel viser, hvor frisk
det er ("updated 12 s ago"); et panel, der er over 45 sekunder gammelt, siger "Old". Siden
opdaterer sig selv, cirka hvert 15. sekund for Party og Scene og med det samme for kampen, og
kræver ingen Claude-connector. Den læser kun: intet på den ændrer spillet.

Den er kun til dig. Den viser præcis HP, også fjendernes, så hold den væk fra alle skærme, som
spillerne kan se. Spillere får ikke denne side: en spiller, der skriver dens adresse, havner på
spillersiden, som kun viser det, en spiller allerede kan se.

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

- i Foundrys module-indstillinger: "AI Tool: Allow Write Operations", "AI Tool: Handouts (writes)", "AI Tool:
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
