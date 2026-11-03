---
source: gm/death-and-new-characters.md
sourceHash: dafd85413e87
title: Når en karakter dør
description: Hvad du gør, når en spillerkarakter dør, hvordan du fører optegnelser over de faldne, og hvordan du får en ny karakter ind, med hvad værktøjet kan og ikke kan hjælpe med i hvert trin.
---

# Når en karakter dør

Curse of Strahd slår karakterer ihjel. Planlæg det før session 1, så en død ved bordet tager fem
minutter og ikke resten af aftenen. Siden her dækker selve øjeblikket, en optegnelse over de
faldne og at få en ny karakter ind.

Kort fortalt:

1. Markér karakteren som død i Foundry. Behold actoren, slet den ikke.
2. Lad spilleren kunne se det gamle ark (Observer).
3. Skriv en linje i din dødslog.
4. Få den nye karakter ind: ownership, user, party, token, ét handout.

## Før session 1: to ting at sætte op

- **En "Next characters"-journal (kun GM).** Bed hver spiller i session 0 om en reserveidé: et navn,
  en klasse og én sætning om, hvem de er. Skriv hver af dem ned med en krog, der bringer dem ind i
  Barovia eller ind i gruppen (se [Kroge til en ny karakter](#kroge-til-en-ny-karakter)). En død
  koster så spilleren en kort build og ikke en lang aften med idéer.
- **En "Fallen"-journal (kun GM).** Én side pr. død karakter, se [Dødsloggen](#dødsloggen).

Lav begge i Foundrys **Journal**-fane, og lad ownership stå på None for spillerne. Journals kun for
GM dukker også op i din GM-Obsidian-vault, når mirror er slået til.

## Hvad værktøjet ser, og hvad det ikke ser

Værktøjet følger hit points, ikke liv og død:

- **At falde til 0 HP** bliver logget. Din **Live Feed** siger "Kasimir is down: 0 HP, unconscious,
  death saves begin" (en NPC: "Goblin Archer is down (0 HP)"). Spillernes side formulerer det til
  spillerne: "Kasimir dropped to 0 HP." for en karakter, "went down" for en NPC. At komme op over 0
  igen bliver også logget: "recovered above 0 HP" i din Live Feed, "is back up" på spillernes side.
- **Death saving throws** vises i Foundrys Combat Tracker, i dashboardets turn-order strip og i
  **🛡 Party**-skuffen, mens en karakter er på 0 HP ("Death saves: 1 saved, 2 failed"). De bliver
  skrevet i play log.
- **Selve døden bliver ikke opdaget.** Tre mislykkede death saves, massive damage eller en
  disintegrate ser ud som enhver anden 0 HP for værktøjet. Om en karakter er død, er din
  afgørelse, og du markerer det (næste afsnit).
- **📋 Prep-skuffen viser, hvem der gik ned sidste session**: spillerkarakterer og NPC'er hver for
  sig. Det betyder, at de faldt til 0 HP, så en karakter, der kom op igen, står der også.
- **Værktøjet sletter ingenting.** Intet værktøj sletter en actor.

## Ved bordet: dødsøjeblikket

1. **Tag afgørelsen.** Tjek death saves på arket eller i Combat Tracker. Regelafgørelsen er din.
   Claude kan slå reglen op ("What happens on a third failed death save? Use only my books."), men
   afgør den ikke.
2. **Markér karakteren som død.** I en combat klikker du på kraniet (**Mark Defeated**) på
   karakterens række i Foundrys Combat Tracker: det dæmper rækken og giver karakteren statussen
   **Dead**. Uden for en combat højreklikker du på tokenet og vælger **Dead** blandt status-ikonerne.
   Med **play**-sættet slået til i Claude Desktop kan du også sige: "Mark Kasimir as dead, go
   ahead." (`plan-actor-change`, en condition-ændring. **Undo** i **Recent Changes** tager den
   tilbage, hvis du var for hurtig).
3. **Spil scenen færdig.** Spilleren bliver ved bordet. Lad dem gerne tale for en allieret eller en
   NPC resten af combaten. Foundry springer kun besejrede rækker over, når **Skip Defeated** er slået
   til i Combat Trackers indstillinger. Ellers klikker du forbi turnen.
4. **Lad tokenet ligge**, til scenen er slut. Liget kan få betydning (plyndring, en begravelse, et
   forsøg på genoplivning).

Slet ikke actoren. Play stats, session notes i Obsidian og dødsloggen peger alle på den, og en
senere genoplivning kræver arket, som det var.

## Efter sessionen: ryd op

- **Flyt actoren** til en mappe, der hedder "Fallen", i **Actors**-fanen, så den er af vejen men
  bevaret.
- **Ændr spillerens adgang til Observer**, så de stadig kan læse det gamle ark, men ikke ændre det.
  Højreklik på actoren i **Actors**-fanen, **Configure Ownership**, sæt spilleren til Observer.
  Eller, med **admin**-sættet slået til i Claude Desktop: "Set Anna to Observer on Kasimir."
  (`plan-ownership-change`. Du bekræfter, og **Undo** i **Recent Changes** tager den tilbage). "Who
  owns Kasimir?" viser den nuværende adgang (`list-actor-ownership`). Ændringer af ownership kræver
  knappen "AI Tool: Ownership (writes)" slået til (den er til som standard, se
  [Feature switches](asking-claude.md#funktionskontakter)).
- **Items, som partiet tager fra liget,** flytter du i hånden, fra ark til ark.

## Dødsloggen

Én side pr. faldet karakter i din "Fallen"-journal. Hold den kort:

- **Hvem:** navn, klasse og level, spillerens navn.
- **Hvornår og hvor:** sessionsnummer, dato, scenen.
- **Hvordan:** hvad der dræbte dem, i en eller to linjer.
- **Sidste ord eller sidste handling,** hvis der var en.
- **Hvad der blev efterladt:** items, uafsluttede sager, hvem der sørger.

Claude kan skrive et udkast ud fra session log. Med **prep** slået til: "Write a short death log
entry for Kasimir from last session: how he went down, who was there, what he carried. Plain text I
can paste." Læs det, ret det, og indsæt det selv på journal-siden. Spillerne ser aldrig denne
journal, medmindre du afslører en side.

## Den nye karakter ind

Gør det mellem sessionerne, hvis du kan. Ved bordet tager det omkring fem minutter, når karakteren
er bygget.

1. **Spilleren bygger karakteren** på samme måde, som bordet byggede de andre, på det level, du
   vælger (som regel partiets level). Værktøjet har ingen karakterbygger. Dets NPC-værktøjer laver
   monsters og NPC'er, ikke spillerkarakterer.
2. **Giv spilleren ownership.** Højreklik på den nye actor i **Actors**-fanen, **Configure
   Ownership**, sæt spilleren til Owner. Eller, med **admin** slået til: "Make Anna the owner of
   Vasil." (`plan-ownership-change`).
3. **Gør den til spillerens karakter.** I **Players**-listen (nederst til venstre) højreklikker du
   på spilleren, **User Configuration**, og vælger den nye karakter. Værktøjet gør ikke det trin.
4. **Partiet tager den af sig selv.** Når en spiller ejer den nye karakter, lægger Foundry den ind
   i det primære party (se Recent Changes), og **🛡 Party**-skuffen og `get-party` tager
   den med. Intet at gøre, med mindre "AI Tool: Add player characters to the party" er slået fra:
   så åbn partiets group-actor og træk den nye actor over på det.
5. **Placér tokenet.** Træk actoren fra **Actors**-fanen over på scenen. Vil du flytte det bagefter,
   virker "Move Vasil next to Kasimir's token, go ahead." med **play** slået til
   (`plan-token-change`).
6. **Giv spilleren ét handout.** En kort side til den nye karakter: hvad de ved om partiet og
   Barovia, hvorfor de er her, én ting de vil have. Skriv den som en side i din handouts-journal, og
   afslør den kun for den spiller: "Reveal the page 'Vasil' in 'Handouts' to Anna."
   (`plan-page-reveal`, prep-sættet). Hold hemmeligheder ude af den. Spilleren læser hvert ord.

## Kroge til en ny karakter

Barovia er lukket af fra omverdenen, så en ny karakter må komme indefra eller ankomme på samme måde
som partiet. Kroge, der passer (skriv din egen version ind i "Next characters"-journalen):

- **En lokal** fra den nærmeste landsby, der har en grund til at slutte sig til: en gæld, en
  forsvundet slægtning, et nag mod slottet.
- **En anden rejsende** fanget af tågen, fundet faret vild på vejen eller gemt i en ruin.
- **En fange,** partiet befrier, eller en fanget, de finder undervejs.
- **Nogen, der kendte den døde karakter:** en søskende, en rival, en trosfælle, der kommer og
  spørger, hvad der skete.
- **En hireling eller følger,** partiet allerede har mødt, der træder frem.

Hold det hurtigt. Krogen skal bare sætte karakteren ind i scenen. Historien kan forklare mere
senere.

## Forespørgsler at have ved hånden

| Øjeblik                   | Sig til Claude                                                 | Sæt   |
| ------------------------- | -------------------------------------------------------------- | ----- |
| En karakter er ved at dø  | "Show the death saves of everyone at 0 HP."                    | play  |
| Du tager afgørelsen       | "Mark Kasimir as dead, go ahead."                              | play  |
| Efter sessionen           | "Who went down last session, and how?"                         | prep  |
| Dødsloggen                | "Write a short death log entry for Kasimir from last session." | prep  |
| Gammelt ark: kun læsning  | "Set Anna to Observer on Kasimir."                             | admin |
| Ny karakter               | "Make Anna the owner of Vasil."                                | admin |
| Den nye karakters handout | "Reveal the page 'Vasil' in 'Handouts' to Anna."               | prep  |

Flere opskrifter: [Cookbook](cookbook.md). At slå værktøjssæt til: [Asking Claude](asking-claude.md#tool-sets-hvilke-kontakter-du-skal-tænde).
