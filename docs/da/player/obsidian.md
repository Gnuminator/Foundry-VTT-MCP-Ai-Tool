---
title: Dine noter i Obsidian
description: Valgfrit. Få dine handouts, recaps, din karakter og session-loggen som noter i Obsidian på din egen computer, skrivebeskyttet, med Syncthing. Opsætning, indhold og hvordan du stopper.
source: player/obsidian.md
sourceHash: d828d4066b0c
---

# Dine noter i Obsidian

**Det her er valgfrit.** Alt i det står også på [spillersiden](README.md) og under My character i
din browser. Hvis du gerne vil have dine kampagnenoter i [Obsidian](https://obsidian.md) (en gratis
notes-app), kan bordets server holde en lille notemappe til dig opdateret på din computer: de
handouts, GM'en har givet dig, recaps, din karakter, dine tal og session-loggen.

Det går kun én vej. Serveren sender, din computer modtager. Intet du ændrer eller sletter i
mappen går nogensinde tilbage, og den indeholder kun det, du allerede må se i spillet: ingen
hemmeligheder, ingen eventyrtekst GM'en ikke har vist dig, intet om de andre spilleres karakterer.
Hvis du ikke vil have det, så gør ingenting: du installerer ikke noget, og spillersiden virker
som før.

## Det skal du bruge

- En **Windows-, Mac- eller Linux-computer** eller en **Android-telefon**. (Der findes ikke en
  gratis Syncthing til iPhone; brug spillersiden dér.)
- **Obsidian**, gratis til privat brug: [obsidian.md/download](https://obsidian.md/download).
- **Syncthing**, gratis, programmet der kopierer mappen:
  [syncthing.net/downloads](https://syncthing.net/downloads/). På Windows virker både SyncTrayzor og
  den almindelige Syncthing fra winget (`winget install Syncthing.Syncthing`); på Android bruger du
  Syncthing-Fork fra F-Droid eller Google Play.
- Cirka ti minutter, og at GM'en (eller den, der kører værktøjet) tilføjer din enhed på serversiden.

## Sådan sætter du det op

1. **Installér Syncthing og åbn det.** Det åbner en side i din browser (adressen
   `http://127.0.0.1:8384`). Den side ligger på din egen computer, ikke på internettet. Spørger det
   om anonyme brugsrapporter, så sig nej.
2. **Find dit device ID.** Klik på **Actions** i Syncthing og derefter **Show ID**. Det er en lang
   kode med otte grupper af bogstaver og tal. Send den til GM'en sammen med det navn, du spiller
   under i Foundry. (ID'et er ikke en adgangskode; det fortæller bare serveren, hvem den skal tilbyde
   mappen til.)
3. **Vent på at GM'en siger, den er tilføjet.** GM'en får Claude til at tilføje dit ID på serveren.
   Det tager lidt tid og sker, når serveren er rolig, så det kan blive dagen efter.
4. **Godkend serveren.** Syncthing viser en besked om, at en enhed vil forbinde (serverens navn er
   det, den hedder på Pi'en, ofte _dietpi_). Klik **Add Device**. Tjek at device ID'et passer med det,
   GM'en sendte dig. Passer det ikke, så tryk **Ignore** og sig det til GM'en. Ret ikke andre
   indstillinger.
5. **Godkend mappen.** En anden besked siger, at serveren vil dele en mappe, der hedder noget i
   retning af _Foundry vault Mira_. Klik **Add**, vælg hvor den skal ligge på din computer (for
   eksempel `Dokumenter\Foundry vault`), og åbn **Advanced**. Sæt **Folder Type** til **Receive Only**
   og tryk **Save**. Receive Only betyder, at din computer kun kan tage filer ind, aldrig sende dem
   ud.
6. **Åbn den i Obsidian.** Start Obsidian, vælg **Open folder as vault** og peg på mappen fra trin 5. Noterne dukker op inden for et par minutter. Mappen kommer med bordets udseende slået til og
   har ingen plugins.

## Det er der i den

| Mappe eller note | Hvad                                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Handouts`       | De journal-sider, GM'en har vist dig, for eksempel et brev eller en kortnote. En side GM'en kun viser til nogle spillere, kommer kun til dem.       |
| `Recaps`         | Recap af hver session, når GM'en har vist den.                                                                                                      |
| `My character`   | Din karakter: abilities, hit points, spells, items og features, som under My character.                                                             |
| `My stats`       | Dine egne tal for kampagnen: damage du har taget, healing, brugte spell slots, åbne rolls og dit bedste roll. Kun rolls, alle kunne se, tæller med. |
| `Session log`    | En note pr. spilaften: hvad bordet kunne se ske, i korte linjer. Hemmelige rolls og skjulte ting kommer aldrig med.                                 |

Serveren opdaterer noterne cirka en gang i minuttet, mens spillet kører, og så snart din computer er
tændt og Syncthing kører, indhenter den det, den har misset. Handouts og recaps dukker op, efter
GM'en har vist dem, ligesom på spillersiden.

Skriv ikke dine egne noter i den mappe. Den tilhører serveren: en note du lægger der, bliver på din
computer og sendes aldrig nogen steder hen, men en note serveren styrer, bliver overskrevet ved næste
opdatering. Hold dine egne noter i en anden Obsidian-vault.

## Hvis Syncthing siger, at noget er galt

- **"Locally Changed Items" (gul):** du eller Obsidian har ændret noget i mappen. Intet er gået til
  serveren. Tryk **Revert Local Changes** for at få serverens version tilbage. (Det fjerner også alle noter, du selv har lagt der.)
- **Obsidians egne filer:** Obsidian skriver nogle indstillingsfiler ind i vaulten (`workspace.json`
  og lignende). De giver den gule besked. For at stoppe den: åbn mappen i Syncthing, **Edit**,
  **Ignore Patterns**, og indsæt:

  ```text
  .obsidian/workspace*.json
  .obsidian/cache
  .obsidian/plugins
  .trash
  ```

- **Der kommer ikke noget:** serveren kan være slukket, eller du har ikke internet. Syncthing
  prøver selv igen. Spørg GM'en, hvis der er gået dage.

## Sådan stopper du

- **Hos dig:** klik på mappen i Syncthing, **Actions**, **Remove**. Det stopper synkroniseringen og
  beholder de noter, der allerede ligger på din computer; slet selv mappen, hvis du vil af med dem.
  Du kan også afinstallere Syncthing. Så har serveren ingen at sende til.
- **På serveren:** sig det til GM'en, så fjerner Claude din enhed fra delingen. Dine filer på
  serveren bliver hos kampagnen; de kan kun nås fra spillersiden og delingen.

Du kan starte igen senere med et nyt device ID eller det samme.

## Det her gør den ikke

- Du kan ikke rette noget i spillet derfra. Foundry er der, hvor du spiller.
- Den viser ikke andre spilleres karakterer eller noter, eller noget GM'en ikke har vist.
- Den er ikke en backup af din computer eller af dine egne Obsidian-noter.
