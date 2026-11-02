---
source: gm/prepare-session-0-quest.md
sourceHash: 4b8eea8772db
title: 'Quest: forbered session 0'
description: Opsætningen til session 0 som en liste med opgaver at sætte flueben ved, i fem trin fra indsamling af e-mails til en prøvekørsel som spiller.
---

# Quest: forbered session 0

Det her er [Forbered session 0](prepare-session-0.md) som en liste, du kan sætte flueben ved. Den side har
billederne og begrundelserne; denne har kun rækkefølgen. Gør det en uge eller deromkring før session 0. Det
tager ca. 30 minutter, plus prøvekørslen. Hvis du ændrer en indstilling, mens spillerne har spillet
åbent, så bed dem genindlæse (F5), før de åbner builderen. Lad usage tracking være slået fra; det er
den allerede.

:::note
Tag trinene i rækkefølge. Trin 3 er det, der oftest er halvt gjort på forhånd, og det, en
spiller lægger mærke til først, hvis det ikke er.
:::

**Fremgang:** fem trin. De to første handler om spillerne, de næste to om worlden, det
sidste er en generalprøve.

## Trin 1 af 5: E-mails (5 minutter)

- [ ] Bed hver spiller i Discord om den e-mailadresse, de vil bruge til at komme ind.
- [ ] Send listen til værktøjets admin. En adresse, der ikke står på adminens liste, får aldrig en
      login-kode og får heller ingen fejl.
- [ ] Sig til spillerne, at de skal bruge præcis den adresse, de har givet dig.

**Du er færdig, når** adminen har sagt, at listen er lagt ind.

## Trin 2 af 5: Én bruger til hver spiller (5 minutter)

- [ ] Tryk på **Esc** og vælg **User Management**.
- [ ] For hver spiller klikker du på **Create Additional User**, skriver deres navn i **User Name**, lader
      **Password** stå tomt og beholder rollen **Player**.
- [ ] Klik på **Save and Return**.
- [ ] Send hver spiller deres brugernavn i en direkte besked på Discord, sammen med linket til
      [Kom ind i spillet](../player/join.md).

**Du er færdig, når** hver spiller har en bruger og kender sit eget brugernavn.

## Trin 3 af 5: Karakterer (15 minutter)

I **Game Settings**, kategorien **Core**, knappen **User Permissions**:

- [ ] I rækken **Create Actors** er kolonnen **Player** afkrydset. Klik på **Save Configuration**,
      hvis du har ændret den.

I **Game Settings**, kategorien **[Aardvark Games] Actor Studio (AI Tool fork)**:

- [ ] **Compendium Sources**, **Select sources**: fjern flueben ved **Show Selected Only**, sæt flueben ved
      Player's Handbook-packs i hver række og fjern flueben ved D&D 5e-systemets egne packs. Tabellen står i
      [Forbered session 0](prepare-session-0.md). Klik på **Save**, derefter **Yes** for at genindlæse.
- [ ] **Configure ability scores**: sæt flueben ved den ene metode, du og spillerne er blevet enige om.
- [ ] **Configure equipment & gold**: **Enable Equipment Selection** er afkrydset.
- [ ] **Configure spells**: sæt flueben ved **Enable Spell Selection**.
- [ ] **Configure progression**, under **Leveling Options**: sæt flueben ved **Enable Level Up** og
      **Milestone Levelling**. Uden den indstilling ser ingen en **Level Up**-knap, før de har
      nok experience points.

:::tip
På vores server har scriptet allerede sat **Create Actors**, udstyret og Player's Handbook som kilde
til udstyr. Tjek de tre, og sæt resten selv.
:::

**Du er færdig, når** species-listen kun viser 2024-species, en Cleric får en **Spells**-fane, og en ny karakters ark har en **Level Up**-knap.

## Trin 4 af 5: Tilmeldingssiden (5 minutter)

Valgfrit.

- [ ] I **Game Settings**, kategorien **Foundry AI Tool**, klik på **Choose join page look**.
- [ ] Behold eller ret **The lamplit line**, og klik derefter på **Apply The Veil**.

**Du er færdig, når** tilmeldingssiden viser slottet i tågen, eller du har valgt at beholde Foundrys
udseende.

## Trin 5 af 5: Prøv det som spiller (30 minutter)

- [ ] I User Management laver du en bruger, der hedder **Test Player**, med rollen Player.
- [ ] Åbn spillet i et privat browservindue og log ind som Test Player.
- [ ] Følg [Lav din karakter](../player/make-a-character.md) til ende.
- [ ] Som GM tjekker du arket med tjeklisten i trin 10 på den side.
- [ ] Slet karakteren og brugeren Test Player.

**Du er færdig, når** en karakter på level 3 er blevet lavet rigtigt, fra det første klik til tjeklisten.

## Quest klaret

På aftenen: læg linket til [Lav din karakter](../player/make-a-character.md) op i Discord,
bliv i voice, og gå tjeklisten igennem med hver spiller, når de er færdige. Selve aftenen
står i [Forbered session 0](prepare-session-0.md#på-aftenen) og dagsordenen i
[Forberedelse og forventninger](prep-and-expectations.md#en-dagsorden-til-session-0-du-kan-ændre).
