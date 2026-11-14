---
source: player/dnd-helper.md
sourceHash: dc1e806fff39
title: D&D-hjælperen til spillere
description: Installer Claude Desktop og din Foundry-spillerconnector, og lav, level op og tjek så din egen karakter og slå regler op, trin for trin.
---

# D&D-hjælperen til spillere

Denne guide fører dig fra ingenting til en fungerende D&D-hjælper: en Claude-chat på din egen
computer, som kan læse **din** karakter i Foundry og slå ting op i de bøger, vores bord bruger. Den
er skrevet til en, der aldrig har åbnet Claude Desktop, så tag det roligt og gør tingene i
rækkefølge. Sæt cirka en halv time af første gang.

Hjælperen er **valgfri**. Alt, den kan, kan du også gøre i hånden i Foundry, og spillet fungerer
på samme måde uden den.

## Hvad det er, på et minut

Claude er en AI-assistent fra Anthropic. Claude Desktop er den app, du chatter med den i. Som
udgangspunkt ved Claude ikke noget om vores spil. To små dele ændrer det:

- **Extension** (en fil, der hedder `foundry-player.mcpb`) er et stik, der lader Claude Desktop
  spørge vores Foundry om et par ting. Det kaldes **spillerconnectoren**. Den bærer også
  hjælperens instrukser, som lærer Claude at hjælpe med D&D ved vores bord: hvordan man planlægger
  en karakter, hvordan man guider dig gennem et level-up, hvordan man tjekker dit ark, og hvordan
  man svarer på et regelspørgsmål. Der er ikke noget ekstra at installere eller slå til for det.
- **Dine to værdier** (et Client ID og en Client Secret) er din personlige nøgle til det stik. De
  fortæller serveren, hvem du er, så du ser din egen karakter og ingen andres. I filen, du henter
  fra din side, ligger de allerede inde i.

Det, den **gør**: læser dine egne karakterer, læser de bøger, som bordet lader spillere læse, og
snakker valgene igennem med dig.

Det, den **aldrig gør**: ændrer noget. Den kan ikke redigere dit ark, rulle terninger, flytte en
token eller sende en besked i spillet. Du laver selv alle ændringer ved at klikke i Foundry, og
Claude fortæller dig, hvad du skal klikke på. Det er med vilje.

## Før du går i gang

Du skal bruge:

- En Windows-computer (den, du spiller Foundry på, er fin).
- En e-mailadresse til din **egen** Claude-konto. Lån ikke en andens: dine chats er dine, og bordet
  betaler ikke for dit forbrug.
- Dit **Client ID** og din **Client Secret**, to lange strenge af bogstaver og tal. Den, der kører
  værktøjet, sender dem til dig privat, og du kan også se dem på din egen **My character**-side under
  **Your Claude connector** (der er kopiér-knapper ved hver af dem). Behandl secret'en som en
  adgangskode: læg den ikke i Discord, og put den ikke i et screenshot.
- Én fil, som du henter i trin 2. Du behøver ikke have Claude Desktop installeret endnu: det gør
  trin 1.

## Trin 1: installer Claude Desktop og log ind

1. Gå til <https://claude.com/download> og hent Claude til Windows.
2. Kør installationsprogrammet og åbn appen.
3. Log ind med din egen konto. Har du ikke en, så opret en med din e-mailadresse. En gratis konto kan
   være nok til at prøve hjælperen. Hvis et trin nedenfor nævner en menu, du ikke har (fx
   Extensions eller Skills), kan din plan mangle den: sig til den, der kører værktøjet, hvilken.
4. Åbn en chat og send "hej" for at se, om den svarer. Gør den det, virker appen.

Anthropic ændrer menuerne en gang imellem. Hvis en knap ikke står, hvor guiden siger, så led efter
det samme ord i nærheden, eller brug søgefeltet i Settings.

## Trin 2: hent din hjælper

1. Åbn din **My character**-side (det private link, du fik), åbn **Your Claude connector** og tryk
   på **Download my helper**. Din browser gemmer `foundry-player.mcpb` i din **Downloads**-mappe.
   Filen er lavet til dig og indeholder dit eget login, så del den ikke, og slet den gerne efter
   trin 3.

Spørger din browser, om den skal beholde en fil, den ikke kender, så vælg **Keep**.

## Trin 3: tilføj extension

1. Dobbeltklik på `foundry-player.mcpb` i din Downloads-mappe. Claude Desktop åbner med et
   installationsvindue. (Du kan også trække filen ind i **Settings**, **Desktop**,
   **Extensions**.)
2. Klik på **Install**. Claude advarer måske om, at extensions kører på din computer. Denne her
   taler kun med vores spilserver og kan ikke ændre noget. Der er intet at indsætte: dine værdier
   ligger allerede i filen. Den vises som **Foundry (dit navn)**.
3. Sørg for, at extension er slået **til** (en kontakt ved siden af navnet i Settings, Desktop,
   Extensions).
4. Luk Claude Desktop helt (højreklik på dets ikon ved uret og vælg Quit, det er ikke nok at lukke
   vinduet) og åbn det igen.

**Virker den hentede fil ikke**, så brug den generiske fil og indsæt dine to værdier selv: hent
[foundry-player.mcpb](https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool/releases/latest/download/foundry-player.mcpb),
installér den på samme måde, og når en formular spørger, så indsæt dit **Client ID** i det første
felt og din **Client Secret** i det andet (**My character**-siden har begge med kopiér-knapper).

For at tjekke, at det virker, så åbn en ny chat og klik på **+** eller værktøjsikonet ved
beskedfeltet. Du skulle gerne se **Foundry** (eller **foundry-player**) med seks tools (de fem
bordtools og **get-helper-guide**). Gør du det, sidder stikket i. Hjælperens instrukser følger med
extension, så du skulle ikke behøve at tilføje en skill eller slå Code execution til. Følger Claude
ikke hjælperens trin, så se Fejlfinding.

## Trin 4: dit første spørgsmål

Start en ny chat og spørg:

> Hvilke karakterer har jeg i Foundry? Giv mig et kort resumé af hver.

Claude beder om lov til at bruge et tool første gang. Klik på **Allow** (eller **Always allow** for
dette tool, som du foretrækker). Du skulle gerne få et kort resumé af din karakter eller dine
karakterer.

Får du det, er du færdig med opsætningen. Resten nedenfor handler om, hvad du kan spørge om.

## Hvad du kan spørge om: de fire forløb

Claude er ikke en formular. Spørg med dine egne ord, på dit eget sprog. Eksemplerne er kun
startpunkter.

### 1. Lav en ny karakter

Godt, når du har et koncept, eller slet ingen idé.

> Jeg vil lave en ny karakter. Jeg kan lide ideen om en snigende problemløser, der er god til at
> tale med folk. Hvilke muligheder har jeg?

Det sker: Claude stiller dig to-tre korte spørgsmål (hvordan du vil spille, hvordan ability scores
vælges ved vores bord, om du er ny til D&D eller ej), slår klasser, species og backgrounds op i
bøgerne, foreslår to-tre kombinationer og skriver dig så et **build card**: en kort liste, der
følger fanerne i Foundrys karakterbygger, **Actor Studio**, i rækkefølge. Vores bord starter på
**level 3**, så kortet har en del til level 1 og så de to level-ups, med subclass på level 3.

Du klikker dig gennem Actor Studio med kortet (guiden [Lav din karakter](make-a-character.md)
viser hver fane med billeder). Sig så "Jeg er færdig", og Claude læser dit ark og tjekker det mod
kortet (det er forløb 4 nedenfor).

Flere ting at spørge om:

- "Giv mig tre forskellige karakteridéer til et bord, der kan lide roleplay."
- "Jeg valgte Rogue. Hvilke backgrounds passer, og hvad giver de mig?"
- "Lav mig et build card til en level 3 Cleric."

### 2. Level op

> Jeg har lige fået XP nok til næste level. Hvad får jeg, og hvad skal jeg vælge?

Claude læser dit ark og det, det næste level giver, slår hver feature op i bøgerne og svarer i to
dele: hvad du får automatisk, og hvad du vælger, med to-tre muligheder til **din** build og en
anbefaling. For hit points fortæller den dig gennemsnittet og resultatet af terningkastet for din
hit die, og gennemsnittet er det sikre valg. Derefter fortæller den dig, hvad du skal klikke på i
Foundrys level-up-vindue.

To fælder, den kender, så lyt efter, når den nævner dem: på level 3 skal du klikke på **Complete**
i det andet vindue, der viser dine subclass-features, ellers bliver subclass'en stille og roligt
ikke tilføjet; og en spellcasters level-up spørger ikke, hvilke spells du lærer, dem tilføjer du på
Spells-fanen.

Flere ting at spørge om:

- "Hvilket feat skal jeg tage på level 4? Jeg kæmper mest fra bagsiden."
- "Kan jeg bytte en spell, når jeg går level op?"
- "Jeg overvejer at tage et level Fighter i stedet for mit næste Wizard-level. Hvad koster det mig?"
  (den siger også, at du skal bekræfte multiclassing med din GM)

Når du har besluttet noget for senere levels, så sig "Skriv det ned som en plan for min karakter",
og Claude skriver en plannote, du kan indsætte et sikkert sted, så den næste chat kan samle tråden
op.

### 3. Stil et regelspørgsmål

> Hvordan virker grappling? Hvad er forskellen på Dodge og Disengage?

Claude søger i bøgerne, læser indlægget og svarer i denne form: svaret først, et par punkter om,
hvordan det virker, og så **Source** (bog, indlæggets navn og regelversion). Den omskriver og
indsætter ikke sider. Dækker bøgerne det ikke, siger den det og mærker alt ekstra "not from the
books".

Afgør reglerne ikke et spørgsmål, giver den dig to måder at afgøre det på og en anbefaling. GM'en
har det sidste ord ved bordet.

### 4. Tjek mit ark

> Tjek mit karakterark. Ser noget forkert ud?

Claude læser dit ark og gennemgår det: level, klasse og subclass, ability scores, hit points,
saving throws, skills, spells, udstyr, navn. Den melder hver linje som OK eller som "Wrong:
... klik her for at rette det". Brug det lige efter, du har lavet en karakter, og efter hvert
level-up. Et valg, der er sprunget over i et Foundry-vindue, er let at overse og let at fange på
den her måde.

### "Hvad er bedst?"

Bøgerne lister muligheder, de rangerer dem ikke. Spørger du "hvad er den stærkeste Fighter
subclass", giver Claude sin egen begrundelse til din build og siger klart, at det er **mening**.
Den peger måske også på Dungeon Mister 2024-guiderne, <https://dungeonmister.com/dnd-5e-2024/>, som
én holdningspræget kilde fra fællesskabet. Det er én skribents syn, ikke reglerne og ikke bordets.
Claude linker kun til den (og åbner den måske, hvis websøgning er slået til i din chat), den kopierer
ikke siden.

## Hvad hjælperen ikke kan se

Det er med vilje, og det beskytter også historien.

- **Kun dine karakterer.** Ikke andre spilleres karakterer, ikke monsters, ikke GM'ens noter.
- **Kun de bøger, bordet lader spillere se.** Ikke eventyret, ikke GM'ens bøger. Spørger du om
  historien, et sted, en NPC eller det, GM'en har planlagt, siger den, at den ikke kan se det.
  Spørg GM'en.
- **Korte uddrag.** En søgning giver et par korte uddrag, og et enkelt indlæg er begrænset i
  længde. Ved en lang regel fortæller Claude dig, hvor du kan læse det hele i Foundry.
- **Ingen ændringer.** Den kan ikke redigere noget. Den kan heller ikke rulle terninger for dig.
- **Ikke live.** Den læser dit ark, når den spørger. Ændrer du noget i Foundry, så sig det og bed
  den kigge igen.

Nogle gange finder en søgning mindre, end du havde ventet. Det er normalt: noget tekst holdes
tilbage med vilje, uden en note om det. Prøv ikke at komme uden om det, spørg bare GM'en.

Husk også, at dine chats med Claude går til Anthropic under din egen konto, som enhver anden chat.
Intet, du siger til hjælperen, bliver sendt til de andre spillere.

## Fejlfinding

**Claude nævner slet ikke Foundry, eller siger, at den ikke har et tool til det.**
Åbn Settings, Desktop, Extensions og tjek, at Foundry-extension er slået til. Luk så Claude
Desktop helt og åbn det igen. Start en **ny** chat: en gammel chat opfanger ikke nye tools.

**Den siger "not found" om min karakter.**
Tjek, hvordan navnet er stavet på dit ark, og spørg igen med det præcise navn. Har du ingen karakter
endnu, er det korrekt: lav en først. Er navnet rigtigt, kan dine værdier være forkerte (se næste
punkt), eller karakteren er måske ikke tildelt dig i Foundry. Bed din GM tjekke, at du ejer den.

**En fejl, "unauthorized", "forbidden" eller "could not connect".**
Næsten altid de to værdier. Åbn Settings, Desktop, Extensions, Foundry-extension og tjek, at
Client ID og Client Secret er indsat hele, uden mellemrum i starten eller enden og uden noget, der
mangler.
Indsæt dem igen fra din **My character**-side med kopiér-knapperne. Er de rigtige, kan spilserveren
være nede. Spørg den, der kører værktøjet.

**Den svarer fra hukommelsen og nævner ingen bog.**
Spørg: "Slå det op i bøgerne først og nævn indlægget." Fejler opslaget, skal den sige det og mærke
resten som almen viden. Gør den aldrig det, så sig det til den, der kører værktøjet.

**Den siger, at den ikke kan finde noget, jeg ved står i bogen.**
Bordet lader måske ikke spillere se den bog, eller indlæggets navn er anderledes. Prøv et andet ord
("grapple" og "grappled"), eller bed om en søgning efter, hvad tingen gør.

**Den følger ikke hjælperens trin (et build card, et arktjek).**
Skriv: "Læs Foundry-hjælperguiden først, og svar så." Så åbner Claude guiden gennem tool'et
**get-helper-guide**. Gør den det stadig ikke, kan din extension være en gammel version: hent din
hjælper igen fra din **My character**-side og installer den oven på den gamle.

**Jeg installerede den gamle skill-zip tidligere.**
Den virker stadig, men du har ikke brug for den mere. Du kan fjerne den i Settings, Customize,
Skills.

**Den påstår, at den har ændret min karakter.**
Det kan den ikke, og det skal den aldrig sige. Tjek dit ark i Foundry, og sig det så til den, der
kører værktøjet. Hjælperen læser kun.

**Claude Desktop vil ikke åbne `.mcpb`-filen.**
Opdater Claude Desktop (der skal bruges en nyere version), og træk så filen ind i Settings,
Desktop, Extensions.

**Jeg vil starte forfra.**
Fjern extension i Settings, Desktop, Extensions, og installer den igen fra filen (hent den igen fra
trin 2, hvis den er væk: tryk på **Download my helper** igen).

## Få nye værdier

Du skal bruge nye værdier, når du mister dem, når du tror, nogen har set din secret, eller når den,
der kører værktøjet, fortæller dig, at de er nulstillet.

1. Åbn din **My character**-side (det private link, du fik sendt) og se på **Your Claude
   connector**. Viser kortet et nyt par, så brug kopiér-knapperne.
2. Gør det ikke det, så skriv til den, der kører værktøjet, og bed om nye værdier. Sig, hvilken
   karakter der er din. De sender dem privat.
3. Åbn Settings, Desktop, Extensions, Foundry-extension i Claude Desktop og skift Client ID og
   Client Secret ud. Luk Claude Desktop og åbn det igen.
4. Spørg, om dine gamle værdier stadig virker. Har du bare mistet hemmeligheden, gør det ikke
   noget. Har en anden set den, så bed om, at de gamle værdier også bliver slukket.

Send aldrig din secret i en offentlig kanal. Har du gjort det, så bed om nye værdier.

## Hurtig oversigt

| Jeg vil...                  | Spørg...                                                       |
| --------------------------- | -------------------------------------------------------------- |
| Se, hvad hjælperen kan læse | "Hvilke karakterer har jeg i Foundry?"                         |
| Planlægge en ny karakter    | "Jeg vil lave en ny karakter."                                 |
| Gå level op                 | "Hvad får jeg på mit næste level, og hvad vælger jeg?"         |
| Tjekke mit ark              | "Tjek mit karakterark."                                        |
| Slå en regel op             | "Hvordan virker X?"                                            |
| Få en mening                | "Hvilken X er bedst til min build?" (den siger, det er mening) |
| Starte forfra               | Ny chat, samme spørgsmål                                       |

Er noget her forkert eller forældet, så sig det til den, der kører værktøjet, så guiden bliver
rettet for alle.
