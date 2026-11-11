---
source: gm/setup-obsidian-sync.md
sourceHash: 8b58809de9c8
title: 'Engangsopsætning: din vault på din pc (Obsidian og Syncthing)'
description: Installer Obsidian og Syncthing på din egen pc, par dem med vaulten på hjemmeserveren, og tjek at en note rejser begge veje. Cirka 20 minutter, én gang.
---

# Engangsopsætning: din vault på din pc (Obsidian og Syncthing)

Værktøjet skriver dine kampagnenoter ind i en Obsidian-vault på hjemmeserveren. **Syncthing** holder en
kopi af vaulten på din pc, i begge retninger, og **Obsidian** er den app, du læser den i. Du sætter det op
én gang. Hvad vaulten indeholder, og hvordan du bruger den, står i [Din Obsidian-vault](obsidian.md).

**Du skal bruge:** din Windows-pc, cirka 20 minutter og én besked til den, der byggede værktøjet (dit
Syncthing-ID, trin 3). De tilføjer din pc på serveren; den del kan du ikke gøre selv.

## 1. Installer Obsidian

1. Gå til <https://obsidian.md/download> og hent Windows-installationsprogrammet.
2. Kør det. Åbn ikke en vault endnu.

## 2. Installer og start Syncthing

1. Klik på Start, skriv **PowerShell**, tryk Enter.
2. Skriv `winget install Syncthing.Syncthing` og tryk Enter. Sig ja, hvis den spørger om vilkårene.
3. Luk PowerShell og åbn den igen, skriv så `syncthing` og tryk Enter.
4. Din browser åbner Syncthing-siden (adressen er `http://127.0.0.1:8384`; den virker kun på din egen
   pc). Lad PowerShell-vinduet stå åbent, mens du gør resten. Hvis Syncthing spørger om anonym
   usage reporting, vælg **No**. En advarsel om at sætte et GUI-password kan vente.
5. Klik på **Actions**, **Settings**, **Connections**, fjern fluebenet ved **Enable NAT traversal** (så
   Syncthing aldrig beder din router om at åbne en port) og klik på **Save**.

## 3. Send dit ID

1. På Syncthing-siden klik på **Actions** (øverst til højre), derefter **Show ID**.
2. Klik på **Copy** og indsæt det i en privat besked til den, der byggede værktøjet. Skriv, at det er til
   GM-vaulten.
3. Vent på svaret ("tilføjet"). Det giver dig også de første syv tegn af serverens ID; dem bruger du i
   trin 4. Lad Syncthing-siden stå åben.

## 4. Tag imod serveren og mappen

1. En gul bjælke siger, at **foundry-pi** vil forbinde. Klik på **Add Device**, derefter **Save**.
   (Bjælken kan vise et langt enheds-ID, en række bogstaver og tal i grupper, i stedet for navnet
   **foundry-pi**. Tjek, at de første syv tegn passer med dem i svaret. Tilføj ikke en enhed, du ikke kan
   genkende.) Den første forbindelse går over internettet og kan tage et par minutter: lad siden stå
   åben og vent på bjælken.
2. En ny bjælke tilbyder mappen **Foundry GM vault**. Klik på **Add**.
3. I vinduet, der åbner, sæt **Folder Path** til
   `C:\Users\<dit navn>\Documents\Obsidian\Foundry GM vault` (Syncthing opretter den).
4. Åbn fanen **Ignore Patterns** og indsæt disse linjer:

   ```text
   .obsidian/workspace*.json
   .obsidian/cache
   .obsidian/plugins
   .obsidian/community-plugins.json
   .trash
   ```

   De holder hver pcs egne Obsidian-indstillinger ude af synkroniseringen.

5. Klik på **Save**. Mapperækken viser **Syncing** og derefter **Up to Date** i grønt.

## 5. Åbn vaulten i Obsidian

1. Start Obsidian. På den første skærm klik på **Open** ved siden af **Open folder as vault**, vælg
   `Documents\Obsidian\Foundry GM vault` og bekræft.
2. Hvis Obsidian spørger, om du stoler på vaultens forfatter, vælg **Browse vault in Restricted Mode**.
   Pluginet har sin egen side: [Engangsopsætning: Obsidian-pluginet](setup-obsidian-plugin.md).

## 6. Lad Syncthing starte af sig selv ved login

1. Kør `(Get-Command syncthing).Source` i PowerShell og kopiér den sti, den skriver.
2. Tryk **Win + R**, skriv `shell:startup`, tryk Enter. En mappe åbner.
3. Højreklik på et tomt sted, **New**, **Shortcut**. Som placering skriv den kopierede sti i
   anførselstegn, et mellemrum og så `--no-browser`. Kald den **Syncthing**. Afslut.
4. Højreklik på den nye genvej, **Properties**, sæt **Run** til **Minimized**, **OK**.

Nu kan du lukke PowerShell-vinduet fra trin 2. Næste gang du logger ind i Windows, starter Syncthing af
sig selv.

## Færdig, når det ser sådan ud

- I Syncthing siger mappen **Foundry GM vault** **Up to Date**, og under **Remote Devices** siger
  **foundry-pi** **Up to Date**.
- I Obsidian viser fillisten mapperne `Campaigns` og `Prep`. Din er `Campaigns`, derefter
  `curse-of-strahd`: dens `Home.md` er din startside. De andre mapper under `Campaigns` hører til
  testverdener; lad dem være.
- **En note rejser begge veje.** I Obsidian højreklik på mappen `Prep`, **New note**, kald den
  `Sync test` og skriv en linje. Inden for et minut viser Syncthing ændringen på vej ud, og så siger
  **foundry-pi** **Up to Date** igen: serveren har din note. Den anden vej ligger alt, serveren skrev, før
  du kom med (for eksempel `Campaigns\curse-of-strahd\Home.md`), allerede på din pc. Skriv navnet `Sync test` til den, der byggede
  værktøjet; de bekræfter, at den ligger på serveren. Slet så `Sync test`.

## Godt at vide

- Din pc har nu en fuld kopi af vaulten. Denne kopi er ikke en separat backup: sletter du en
  note i Obsidian, sletter Syncthing den også på serveren. Serveren tager en natlig backup, så en note, du kommer til at slette, kan hentes tilbage: sig til den, der byggede
  værktøjet, hvilken note og cirka hvornår.
- Syncthing synkroniserer kun, mens din pc er tændt og logget ind. Intet går tabt, når den er slukket.

## Hvis det ikke virker

- **Syncthing-siden åbner ikke:** Syncthing kører ikke. Start den fra PowerShell med `syncthing`, og åbn
  så selv `http://127.0.0.1:8384`.
- **foundry-pi siger Disconnected:** den, der byggede værktøjet, har ikke tilføjet dit ID endnu, eller
  serveren er slukket. Send ID'et igen og bed dem tjekke serveren.
- **Ingen gul bjælke for mappen:** vent et minut. Kommer den stadig ikke, så sig det til den, der byggede
  værktøjet, som tilbyder mappen igen.
- **Out of Sync, eller filer med `.sync-conflict` i navnet:** du og serveren ændrede den samme note, før de
  mødtes. Åbn begge filer i Obsidian, behold den tekst, du vil have, i den normale, og slet den anden.
- **Din pc var slukket et stykke tid:** intet er tabt. Start Syncthing og vent på **Up to Date**.
