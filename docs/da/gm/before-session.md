---
source: gm/before-session.md
sourceHash: 5411ab47c0b8
title: Før hver session
description: En kort tjekliste til GM'en, før en spilsession starter.
---

# Før hver session

Gør det her i rækkefølge, cirka 15 minutter før spillerne kommer. Hvert punkt er én handling.
Dashboardet kører på bordets hjemmeserver (Orange Pi), så der er intet at starte og ingen terminal
at åbne. Du skal bruge to adresser fra værktøjets administrator: spillets og dashboardets.

:::tip
**Tag det som en quest.** [Quest: før en session](before-session-quest.md) er den her tjekliste
som fire trin med tider.
:::

## Start det hele

- [ ] Start **Claude Desktop**. Den forbinder til bridgen på Pi'en.
- [ ] Åbn Foundry i din browser, start worlden og log ind som din GM-bruger.
- [ ] Åbn dashboardets adresse på din anden skærm. Cloudflare kan først bede om en kode på mail,
      ligesom når du går ind i spillet.
- [ ] Se på dashboardets header: knappen **✈ Pre-flight** skal sige "ready" eller "N to fix", og der
      må ikke vises noget "Connection lost"-mærke. Hvis det vises, eller hvis Pre-flights første linje
      siger, at Foundry ikke er forbundet, så se [Fejlfinding](troubleshooting.md).

## Kør pre-flight-tjekket

- [ ] Klik på **✈ Pre-flight** i dashboardets header (i Before-visningen ligger panelet allerede
      på siden). Ret alt, der er markeret med ✗, og se på hver **!**. Det meste af resten af denne
      side står også i Pre-flight-panelets liste "Check by hand" (ikke tjekket af GM-vinduerne).

## Slå til, hvad aftenen kræver

- [ ] Klik på **Turn on for tonight** i Pre-flight-panelet. Ét klik slår "Allow Write Operations",
      "AI Tool: Handouts (writes)", "AI Tool: Live play (writes)", "AI Tool: Party (writes)",
      "AI Tool: Tarokka (writes)" og **GM Actions** til. Chipsene under knappen viser hver
      kontakt, og en besked siger, hvad der blev slået til. **End session** slår det fra igen, som
      Turn on for tonight slog til, og **GM Actions**.

- [ ] Tjek, at [GM-vinduerne](gm-windows.md) er slået til: åbn fanen **Settings** i Foundry, **Game
      Settings**, kategorien **Foundry AI Tool**, og sæt flueben ved **AI Tool: GM windows**, hvis
      det ikke er sat, og klik så på **Save Changes**. Knapperne Combat, Party, Session, Scene og Loot
      vises så i AI Tool-gruppen i scene controls. En world, der blev gemt tidligere, kan have den
      slået fra.

- [ ] Én gang, før session 1 (kun med modulet Dice So Nice): vælg bordets terninger, **AI
      Tool: The Veil** eller **AI Tool: Neutral**, i Dice So Nices **Configure Dice Roles**,
      rækken **Basic**, kolonnen **Theme**. Se [Themed dice](features.md#themed-dice).

## Tjek, hvad spillerne kommer til at se

- [ ] Fanen Scenes (kortikonet): klik på scenen, du starter på, fanen **Basics**: giv den et
      **Navigation Name**, hvis dens rigtige navn er en spoiler. Klik på **Save Changes**.
- [ ] Skabningsnavne: Foundry skjuler som standard en skabnings navn for spillerne, så
      spillersiden viser "Unknown creature". For hver skabning, hvis navn spillerne allerede kender:
      åbn actoren (fanen Actors), klik på **Prototype Token** i arkets header, fanen **Identity**,
      sæt **Display Name** til **Hovered by Anyone**, og gem. Tokens, der allerede ligger på
      kortet, beholder deres gamle indstilling: højreklik på hver enkelt, klik på tandhjulet
      (tooltip **Open Configuration**), og sæt den dér også.
- [ ] Skjul tokens, spillerne ikke skal vide om endnu: højreklik på tokenet, klik på øjeknappen
      (tooltip **Hide**).
- [ ] Åbn spillersiden i en ny fane (dashboardets adresse med `/player` til sidst), og tjek, at
      combat-rækkefølgen, feedet og handouts ikke viser noget, du vil holde hemmeligt.
- [ ] Handouts: tjek, at hver side i din handouts-journal står på **None**, medmindre du har
      vist den (åbn journalen, højreklik på en side, **Configure Ownership**). Trinene står i
      [Afslør et handout](dashboard.md#afslør-et-handout).
- [ ] I Tarokka-skuffen (🃏 **Tarokka**, under **Advanced ▾**): sørg for, at **Show cards** ikke er sat flueben ved.

## Forbered

- [ ] Kør prompten `prep-next-session` i Claude Desktop (tilføj en `focus`, hvis du har en).
- [ ] Læs sidste sessions note i Obsidian (mappen `Campaigns/<world id>/AI Tool/Sessions/`).
- [ ] Læg Claude Desktop, dashboardet og Obsidian på den skærm, spillerne ikke kan se, og del
      aldrig de vinduer i Discord eller et videoopkald.

## Når spillet begynder

- [ ] Klik på **Start the session log and live play** (i Pre-flight-panelet) eller **Start session** i
      dashboardets header. Der skulle nu stå "Session since" og klokkeslættet.

Næste: [efter hver session](after-session.md).
