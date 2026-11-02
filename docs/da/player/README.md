---
source: player/README.md
sourceHash: 30aac08eabc4
title: Spillerguide
description: Hvad spillere kan se, hvad værktøjet optager under spillet, hvilke dele der når en AI, og hvordan du får dine data slettet.
---

# Spillerguide

Hej! Din GM bruger Foundry AI Tool ved siden af Foundry. For dig virker Foundry præcis som
altid. Denne side forklarer de ekstra ting: hvad du kan se, hvad der bliver optaget, og hvad en AI
læser. Korte how-tos står i [spillerens kogebog](cookbook.md).

Er du ny ved bordet? Start med [Kom med i spillet](join.md) (adressen, login, Discord), og derefter
[Lav din karakter](make-a-character.md).

## Det kan du se

**Player page.** En skrivebeskyttet webside. Den kører live på bordets hjemmeserver, bag den samme
slags login med e-mailkode som selve spillet (Cloudflare Access), så kun adresser på GM'ens liste
kommer ind. GM'en sender dig adressen. Under en session viser den kampen først. Mellem sessioner
starter den med det seneste recap, handouts og quests. Overskriften nævner scenen, med tidspunkt på
dagen og vejr, hvis scenen har dem. Den har disse dele:

- **Combat order:** hvem der handler hvornår, den aktuelle tur og runden. Spillerkarakterer har en
  HP-bar. Monstre og NPC'er viser ingen HP-tal og intet helbredsord (den, der kører værktøjet, kan
  slå et groft ord til: healthy, bloodied, critical eller down), kun almindelige conditions (som
  prone eller frightened), og de står under det navn, du kender dem under, eller som "Unknown
  creature".
- **Session feed:** offentlige rolls og det, dine karakterer kunne se ske, for eksempel "Mira
  took 7 damage." eller "Wolf 1 was hit." Private, blinde og GM-rolls vises aldrig her, og intet
  om en skabning, hvis navn du ikke kan se, vises heller.
- **Handouts:** journal-sider, som GM'en har vist dig, for eksempel et brev eller en kortnote. En
  handout, der er vist, siden sessionen startede (eller, mellem sessioner, siden den sidste
  sluttede), får et "New"-mærke.
- **Last recap og Quests:** den nyeste viste side med "recap" i titlen og viste sider med "quest" i
  titlen, hver i sin egen boks.
- **You:** hvis du har åbnet dit private link (se My character nedenfor), står der øverst på siden
  "Your turn" eller "You are up next". Den viser hver af dine karakterer med HP og conditions og
  minder dig om Constitution saving throw, når din karakter, der koncentrerer sig, tager skade.
- **Roll buttons:** når GM'en beder dig om et roll, vises det som en knap på denne side (og på My
  character), hvis du har åbnet dit private link. Tryk på den, så går dit roll til bordet. Du ser
  kun anmodninger, der er til dig.

Siden er bygget alene af det, spillere må se. Skjulte skabninger, sande navne, du ikke har lært,
fjendens HP, GM-noter og hemmeligheder når aldrig frem til den.

**My character.** Dit eget karakterark på din telefon eller laptop, skrivebeskyttet og opdateret under
spillet. Din GM sender dig et privat link. Åbn det én gang, så husker siden det på den enhed
(lav et bogmærke eller læg det på din startskærm). Hold linket for dig selv: alle, der har det, kan
læse dit ark. Det viser kun de karakterer, som din Foundry-bruger ejer. Vælg en visning øverst:
**At the table** (HP, AC, slots, conditions og ressourcer med et blik), **Paper 2024** eller
**Paper 2014** (det trykte arks rækkefølge, til at kopiere eller printe), eller **Paper night** (et
ark til at printe og skrive på, når bordet spiller på papir). Ligesom player page er den live
bag login med e-mailkode.

**Handouts i Foundry.** Når GM'en viser en handout, kan du også åbne den side i Foundrys
Journal tab.

**Dine noter i Obsidian (valgfrit).** Hvis du holder noter i Obsidian, kan serveren holde en
skrivebeskyttet mappe med dine handouts, recaps, din karakter, dine tal og session-loggen opdateret
på din computer. Intet du gør dér går tilbage. Springer du over, installerer du ikke noget. Se
[Dine noter i Obsidian](obsidian.md).

## Hvad værktøjet optager under spillet

Mens du spiller, fører værktøjet en **play log** hos GM'en. Hver post bærer Foundry-brugernavnet på
den, der udløste den, når Foundry oplyser hvem. Den optager:

- terningeslag, med terninger og bonusser;
- ændringer i HP (og hvilket roll der forårsagede dem, når den kan se det), temporary HP og death
  saves;
- spells, features og items, der er brugt, spell slots, ressourcer, hit dice og items, der er
  vundet eller mistet;
- conditions og effekter;
- short og long rests;
- kamp: start, ture og slut;
- roll-anmodninger (hvem der blev bedt om hvad);
- token-flytninger, scene-skift, XP, level og valuta;
- hvem der kom ind i og forlod spillet;
- chatbeskeder med deres tekst, også in-character, out-of-character og whispers.

GM'en bruger den til session notes og statistik (for eksempel skade givet og helbredelse modtaget
pr. karakter). Play log bliver på den maskine, der kører værktøjet. De session notes og den
statistik, der laves ud fra den, ligger i GM'ens Obsidian-noter. Intet af det gemmes i Foundry-worlden.

## Hvad der når en AI

- **Claude, når GM'en spørger.** GM'en taler med Claude (en AI fra Anthropic) i Claude
  Desktop-appen. Claude læser så det, den har brug for, fra spillet gennem værktøjet:
  karakterark, chat, session loggen eller play-statistikken. Det går til Anthropic under GM'ens
  Claude-konto. Der sendes intet, når ingen spørger.
- **Dashboard-kommentarer, kun hvis en API key er sat.** GM'ens dashboard kan kommentere spillet
  af sig selv, men kun med en separat betalt API key. Så går de seneste hændelser i spillet og
  kampens tilstand automatisk til Anthropic. Det er slået fra, medmindre GM'en slår det til.
- **Sessionsoptagelser, kun med dit ja, og kun når de er startet.** Se
  [Optagelse og dit samtykke](#optagelse-og-dit-samtykke) nedenfor. En session bliver kun optaget,
  når nogen skriver `/record start` i Discord. Botten kommer så ind i voice-kanalen og skriver en
  besked om det, og den stopper ved `/record stop`. Den optager ét lydspor pr. person, og kun mens
  din mikrofon sender lyd: når du er muted, bliver intet af dit optaget.
  - Lyden går gennem Discord og bordets hjemmeserver (Orange Pi-serveren), som sletter sin kopi
    7 dage efter, at PC'en har kopieret den. Den gemmes på PC'en hos den spiller, der kører
    værktøjet. At gøre den til tekst (speech to text) sker på den PC, ikke i skyen.
  - Teksten går derefter til Claude, under Claude-kontoen hos den, der kører note-trinnet, for at
    skrive et ryddet transcript, noter pr. scene og et kort recap, på dansk og engelsk.
  - Noterne kommer derefter ind i en Foundry-journal, som kun GM'en kan åbne, og i GM'ens noter
    (et Obsidian vault), som også når GM'ens egen PC. Recappet til spillerne er et udkast, indtil
    GM'en har læst det og vist det: så dukker det op sammen med de andre handouts. Ting, GM'en
    siger, som kun er til GM'en, holdes ude af det.

## Optagelse og dit samtykke

Før den første optagede session skriver den spiller, der kører værktøjet, en besked i Discord, der
siger præcis, hvad der optages, og hver spiller svarer ja eller nej skriftligt. Intet svar tæller
som nej. Kort sagt: dit eget lydspor optages. Det går gennem Discord og Pi-serveren (slettet der 7 dage
efter, at PC'en kopierer det) og gemmes på den spillers PC. Transcripts og noter kommer ind i
GM'ens noter, som også når GM'ens PC. Optagelserne gemmes for at træne og teste bordets egne
tale-værktøjer, indtil du beder om, at din bliver slettet. Du kan sige nej: så bliver dit spor
slettet efter hver session, før noget gøres til tekst, og noterne skrives uden dig. Du kan også
skifte mening senere: dine spor bliver slettet, og transcripts og noter skrives igen uden dig.

## Hvor længe det gemmes

Kampagnen igennem. Når kampagnen slutter, bestemmer GM'en, hvad der bliver gemt. Optaget lyd gemmes,
indtil du beder om, at din bliver slettet (se [Optagelse og dit samtykke](#optagelse-og-dit-samtykke)).
Transcriptet og noterne bliver hos resten af kampagnens noter.

## Få dine data slettet

Spørg GM'en når som helst, for eksempel om den chat, du har skrevet, eller alt, der er optaget under
dit brugernavn. GM'en giver det videre til den, der kører værktøjet, og én kommando fjerner det fra
play log. Session notes bliver så bygget op igen uden det. Ved en optaget session kan GM'en slette dit
lydspor og få transcriptet og noterne skrevet igen uden det. Det, Claude allerede har læst, da GM'en
spurgte den om noget, er gået til Anthropic og kan ikke trækkes tilbage af GM'en.
