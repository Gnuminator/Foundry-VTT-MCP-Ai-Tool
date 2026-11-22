---
source: gm/after-session-notes.md
sourceHash: a2c098b9edf6
title: 'Efter en session: noterne'
description: Hvad der sker med Discord-optagelsen efter en session, hvor noterne lander i Foundry, hvad du tjekker og godkender, og hvordan spillernes recap når frem til spillerne.
---

# Efter en session: noterne

Når aftenen blev optaget på Discord, skriver værktøjet noter ud fra optagelsen: en renset
transskription, et resumé til dig, noter for hver scene og et udkast til spillernes recap. Denne side
er hele vejen fra optagelse til, at spillerne læser recap'en. Du gør tre ting: læser, godkender og
giver spillerne recap'en. Intet når en spiller, før du siger til.

## Vejen i seks trin

1. **Optag.** Discord-optageren på hjemmeserveren optager stemmekanalen af sig selv. Ingen bliver
   transskriberet eller skrevet om, medmindre alle, der taler, har sagt ja til optagelsen. Intet for
   dig at gøre.
2. **Kør.** Gnuminator kører én kommando på sin PC efter sessionen (`session.ps1`). Den henter
   optagelsen fra hjemmeserveren, laver tale om til tekst på hans PC, lader Claude skrive noterne
   (på dansk, med engelsk ved siden af) og giver dem til værktøjet. Det tager nogle timer. Hvis den
   stopper (for eksempel fordi Claudes forbrugsgrænse er nået), kører han den samme kommando igen
   senere. Intet for dig at gøre.
3. **Udgiv.** Det sidste, kommandoen gør, er at give noterne til værktøjet, som lægger dem i en
   journal i din Foundry af sig selv, se "Hvor det lander" nedenfor. Intet for dig at gøre, bortset
   fra at have Foundry åben som GM på et tidspunkt.
4. **Gennemgå.** Du læser siderne og retter det, der er forkert.
5. **Godkend.** Du godkender noterne ved at afsløre Recap eller ved at klikke på **Approve without
   revealing**.
6. **Giv spillerne recap'en.** Du afslører Recap-siden fra Handouts-køen. Indtil du gør det, ser
   ingen spiller noget af det.

## Hvor det lander

Noterne lægges i én journal for sessionen, i mappen **Session notes** i Foundrys Journal-fane.
Journalen hedder dato og titel, for eksempel "2026-11-22: Session 0 og ...". Den er kun for GM'er:
ingen spiller kan se mappen, journalen eller nogen side.

| Side           | Hvad der er i den                                                                                                                                                | Hvem ser den                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Recap**      | Udkastet til spillernes recap, dansk først, så engelsk under overskriften English. Står i Handouts-køen til dig.                                                 | Dig. Spillerne først, når du afslører den. |
| **GM summary** | Resuméet af aftenen, **What changed**, **Characters** (hvem hver karakter er, og hvad de gjorde) og **Worth remembering**, dansk først, så engelsk.              | Kun dig                                    |
| **Scenes**     | Ét afsnit for hver scene med tid, resumé og lister over begivenheder, beslutninger, NPC'er, fund og tab, åbne tråde, terninger, citater og en **GM only**-liste. | Kun dig                                    |

Den rensede transskription, den rå tekst, de dybe noter og indekset lægges **ikke** i Foundry. De
bliver som filer på Gnuminators PC sammen med optagelsen og deles aldrig med spillere eller i
repositoriet.

Noterne kommer af sig selv, når tre ting er sande: en GM er i Foundry, **AI Tool: Allow Write
Operations** er slået til, og kontakten **AI Tool: Session notes (writes)** er slået til. Mangler
en, siger dashboardets kort hvilken, og noterne går ind, så snart det er rettet. Alt, værktøjet
lægger ind, logges i **Recent Changes** med **Undo**. Undo virker ikke, når du har afsløret Recap
for spillerne eller rettet en side i Foundry.

Obsidian: din dagsnote for aftenen (`AI Tool/Sessions/`) får en linje under **Session notes**, der
nævner journalen. Selve siderne dukker først op i din vault under
`AI Tool/Foundry/Journals/Session notes/`, når du har slået [Obsidian-spejlet](obsidian.md) til.

## Gennemgå

Åbn journalen og læs siderne. I dashboardet har kortet **Session notes** under aftenens tal
(After-visningen) en knap **Read**, der viser alle siderne i sidepanelet.

Se efter:

- **Navne og steder, der er stavet forkert.** Ret dem i Foundry; siden er din at redigere. (Når du
  har rettet en side, virker **Undo** for hele journalen ikke mere. Det er fint.)
- **Ting i Recap, som spillerne ikke må vide endnu.** Recap er det, spillerne læser. Skær alt væk,
  der røber en hemmelighed, en NPC's plan eller en regel, du holdt for dig selv. GM summary og
  Scenes går aldrig til spillerne, så skriv, hvad du vil, dér.
- **Noget, AI'en har misforstået.** Noterne er et udkast skrevet ud fra tale. Hvis en scene er
  markeret som rå tekst, kunne Claude ikke skrive den op; læs transskriptionen på Gnuminators PC
  eller spørg ham.

## Godkend

Noterne tæller som godkendt, når du gør en af disse i Foundry eller dashboardet:

- **Afslør Recap** for spillerne (næste afsnit). Det godkender noterne i samme klik.
- Klik på **Approve without revealing** på dashboardets kort, når du vil have noterne godkendt, men
  recap'en holdt tilbage for nu.

Kortet siger så **Approved**. Tager du noterne ud igen med Undo, bliver godkendelsen stående, og
kortet tilbyder **Put in Foundry** for at lægge dem tilbage.

## Giv spillerne recap'en

Værktøjet lægger ikke recap'en nogen steder af sig selv: ikke på Discord, ikke på spillersiden. Du
afslører den, som du afslører et hvilket som helst handout. Recap-siden venter allerede på dig i
Handouts-køen.

1. I Foundry, i værktøjslinjens gruppe **AI Tool** (kortets kontroller), klik **Handouts**.
   (Dashboardets handout-skuffe viser den samme kø.) Recap-siden står i **Queue**, ældste først, så
   afslør eller **Remove** de ældre indlæg før den.
2. Klik **Reveal next**. Et vindue viser præcis, hvad der ændres. Læs det, og bekræft. Det kræver,
   at kontakten **AI Tool: Handouts (writes)** er slået til; vinduet siger det, hvis den ikke er.
3. Sæt kryds ved **Show it now** ved siden af **Reveal next**, hvis recap'en straks skal poppe op på
   spillernes skærme. Lad den være uden kryds, så finder de den selv.

Det spillerne ser: recap'en kopieres ind i en journal, der hedder **Handouts**, som alle spillere kan
læse. På spillersiden vises den som **Last recap**, fordi dens titel indeholder "recap". Bruger du
spillernes egne Obsidian-vaults, lander den også i deres mappe `Recaps/`. GM summary og Scenes
kommer aldrig derhen, og det gør journalen i mappen Session notes heller ikke. På Discord kan en
spiller skrive `/recap` for at få den seneste recap, du har delt; den viser kun det, du har afsløret.

Hvis du afslører den ved en fejl, skjuler **Changes** i AI Tool-gruppen siden igen og sætter den
tilbage i køen (et popup, du valgte at vise, kan ikke lukkes på den måde).

> **Ikke sikker? Spørg Claude.** Spørg GM-coachen: "Hvad sker der med sessionsnoterne efter en optaget session, og hvordan får jeg recap'en til mine spillere?" ([sådan tilføjer du GM-coachen](gm-coach.md))

## Hvis der ikke kommer noget

| Hvad du ser                                               | Sandsynlig årsag og hvad du gør                                                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Ingen journal i **Session notes** et døgn efter sessionen | Gnuminator har ikke kørt kommandoen endnu, eller den holdt pause. Spørg ham.                                                          |
| Kortet siger **Waiting** og nævner en kontakt             | Slå den kontakt til i Foundry (Settings, Game Settings, **Foundry AI Tool**), og åbn Foundry som GM. Noterne går ind af sig selv.     |
| Recap står ikke i Handouts-køen                           | Den blev sat i kø, da noterne gik ind. Hvis du tog noterne ud med Undo, klik **Put in Foundry** på kortet; så sættes Recap i kø igen. |
| **Reveal next** siger, at handouts-kontakten er slået fra | Slå **AI Tool: Handouts (writes)** til i Game Settings.                                                                               |
| Du vil slet ikke have noter for en session                | Sig det til Gnuminator, før han kører kommandoen. Uden alles ja bliver intet skrevet.                                                 |

Tilbage til [efter hver session](after-session.md).
