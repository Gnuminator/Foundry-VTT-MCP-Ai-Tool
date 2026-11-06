---
source: gm/prepare-session-0-quest.md
sourceHash: 4f115f61ee67
title: 'Quest: forbered session 0'
description: Opsætningen til session 0 som en liste med opgaver at sætte flueben ved, i fem trin fra indsamling af e-mails til en prøvekørsel som spiller.
---

# Quest: forbered session 0

Det her er [Forbered session 0](prepare-session-0.md) som en liste, du kan sætte flueben ved. Den side har
billederne og begrundelserne, og hvert trin herunder linker til sin del af den; denne har kun rækkefølgen.
Gør det cirka en uge før session 0; det tager en halv time, plus prøvekørslen. Spillere, der allerede
har spillet åbent, skal genindlæse (F5) efter en ændret indstilling, før de åbner builderen. Lad usage
tracking være slået fra; det er den allerede.

<!-- quest-skips: bagefter -->

:::note
Tag trinene i rækkefølge. Trin 3 er det, der oftest er halvt gjort på forhånd, og det, en
spiller lægger mærke til først, hvis det ikke er.
:::

**Fremgang:** fem trin. De to første handler om spillerne, de næste to om worlden, det
sidste er en generalprøve.

## Trin 1 af 5: E-mails (5 minutter)

Se tjeklisten: [Indsaml spillernes e-mails](prepare-session-0.md#0-indsaml-spillernes-e-mails).

- [ ] Hver spiller har sagt i Discord, hvilken adresse de kommer ind med.
- [ ] Listen er hos værktøjets admin. En adresse, der mangler på den, får ingen login-kode og ingen fejl.
- [ ] Spillerne ved, at de skal skrive den adresse og ingen anden.

**Du er færdig, når** adminen har sagt, at listen er lagt ind.

## Trin 2 af 5: Én bruger til hver spiller (5 minutter)

Se tjeklisten: [Én bruger til hver spiller](prepare-session-0.md#1-én-bruger-til-hver-spiller).

- [ ] Tryk på **Esc** og vælg **User Management**.
- [ ] Hver spiller har en bruger med sit navn, uden password og med rollen **Player**: brug **Create
      Additional User** og derefter **Save and Return**.
- [ ] Hver spiller har sit brugernavn på Discord-DM og linket til
      [Kom ind i spillet](../player/join.md).

**Du er færdig, når** hver spiller har en bruger og kender sit eget brugernavn.

## Trin 3 af 5: Karakterer (15 minutter)

Se tjeklisten: [Lad spillerne oprette karakterer](prepare-session-0.md#2-lad-spillerne-oprette-karakterer-et-tjek-på-vores-server)
og [Peg Actor Studio på 2024 Player's Handbook](prepare-session-0.md#3-peg-actor-studio-på-2024-players-handbook-delvist-gjort-på-vores-server).

I **Game Settings**, kategorien **Core**, knappen **User Permissions**:

- [ ] I rækken **Create Actors** er kolonnen **Player** afkrydset. Klik på **Save Configuration**,
      hvis du har ændret den.

I **Game Settings**, kategorien **[Aardvark Games] Actor Studio (AI Tool fork)**:

- [ ] **Compendium Sources**, **Select sources**: Player's Handbook-packs har flueben i hver række, og
      systemets egne packs har ikke (tabellen står på tjeklistesiden). **Save**, derefter **Yes** for at
      genindlæse.
- [ ] **Configure ability scores**: én metode har flueben, den du og spillerne er blevet enige om.
- [ ] **Configure equipment & gold**: **Enable Equipment Selection** er afkrydset.
- [ ] **Configure spells**: **Enable Spell Selection** har flueben.
- [ ] **Configure progression**, **Level Up Options**: **Enable Level Up** og **Milestone Levelling**
      har flueben. Uden dem ser ingen en **Level Up**-knap, før de har nok experience points.

:::tip
På vores server har scriptet allerede sat **Create Actors**, udstyret og Player's Handbook som kilde
til udstyr. Tjek de tre, og sæt resten selv.
:::

**Du er færdig, når** kun 2024-species tilbydes, en ny Cleric har en **Spells**-fane, og et nyt ark viser **Level Up**.

## Trin 4 af 5: Tilmeldingssiden (5 minutter)

Valgfrit. Se tjeklisten: [Giv tilmeldingssiden kampagnens udseende](prepare-session-0.md#4-giv-tilmeldingssiden-kampagnens-udseende-valgfrit).

- [ ] I **Game Settings**, kategorien **Foundry AI Tool**, klik på **Choose join page look**.
- [ ] Behold eller ret **The lamplit line**, og klik derefter på **Apply The Veil**.

**Du er færdig, når** tilmeldingssiden viser slottet i tågen, eller du har valgt at beholde Foundrys
udseende.

## Trin 5 af 5: Prøv det som spiller (30 minutter)

Se tjeklisten: [Prøv det som spiller](prepare-session-0.md#5-prøv-det-som-spiller).

- [ ] En bruger, der hedder **Test Player**, med rollen Player findes.
- [ ] Du er logget ind som Test Player i et privat browservindue.
- [ ] Du fulgte [Lav din karakter](../player/make-a-character.md) til ende.
- [ ] Som GM tjekkede du det færdige ark mod tjeklisten i bunden af den side.
- [ ] Karakteren og brugeren Test Player er slettet igen.

**Du er færdig, når** en karakter på level 3 er blevet lavet rigtigt, fra det første klik til tjeklisten.

## Quest klaret

På aftenen: del [Lav din karakter](../player/make-a-character.md) i Discord, bliv i voice, og tjek
hver spillers ark, når de er færdige. Selve aftenen står i [Forbered session
0](prepare-session-0.md#på-aftenen) og dagsordenen i
[Forberedelse og forventninger](prep-and-expectations.md#en-dagsorden-til-session-0-du-kan-ændre).
