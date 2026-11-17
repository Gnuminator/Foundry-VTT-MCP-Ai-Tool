---
source: gm/setup-obsidian-plugin.md
sourceHash: de014cd476ef
title: 'Engangsopsætning: Obsidian-pluginet'
description: Installer Foundry AI Tool-pluginet i din vault og forbind det til dashboardet, så Open in Foundry virker fra en note.
---

# Engangsopsætning: Obsidian-pluginet

Pluginet lægger **Open in Foundry** på dine noter og viser, om et handout er afsløret. Du skal kun bruge
det, hvis du vil have det. Gør først [din vault på din pc](setup-obsidian-sync.md). Cirka 10 minutter,
én gang.

Går du i stå? Spørg først Claude: åbn en chat med GM coach slået til og skriv, hvor du er.

**Du skal bruge:** vaulten åben i Obsidian, dashboardets adresse og tre værdier fra den, der byggede
værktøjet (GM-token, Cloudflare Client ID og Cloudflare Client Secret). De giver dig dem privat; indsæt
dem aldrig i en chat eller en note.

- **GM-token:** en adgangskode, værktøjet bruger i stedet for et brugernavn. Den, der byggede værktøjet,
  sender den til dig privat, og du kan ikke gøre trin 3 nedenfor, før du har den.
- **Cloudflare Client ID:** den, der slutter på `.access`.
- **Cloudflare Client Secret:** den, der starter med `cfast_`.

Dette Cloudflare-par er det, der er lavet til Obsidian. Det er ikke det par, du brugte til Claude Desktop.

## Installer pluginet

**Den nemme måde:** serveren lægger pluginet i din vault af sig selv. Når Syncthing viser **Up to
Date**, så åbn `Documents\Obsidian\Foundry GM vault\.obsidian\plugins`: hvis der er en mappe
`foundry-ai-tool` med `main.js` i, så hop til trin 5. Samme vej holder det opdateret bagefter: efter
en ny release skriver serveren de nye filer, Syncthing bringer dem over, og du genstarter Obsidian.
Dine egne indstillinger (forbindelsesværdierne nedenfor) bliver aldrig rørt. Hvis mappen ikke er der,
så spørg den, der byggede værktøjet, eller installer det i hånden:

1. Gå til projektets releases-side (<https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool/releases>),
   åbn den nyeste release og hent `foundry-ai-tool-obsidian.zip`.
2. Pak den ud. Du får en mappe, der hedder `foundry-ai-tool` (og en mappe `snippets`, du kan ignorere).
3. Åbn `Documents\Obsidian\Foundry GM vault` i Stifinder. Klik på **View**, **Show**, **Hidden
   items**, og åbn så `.obsidian`. Hvis der ikke er en mappe `plugins`, så lav en.
4. Kopiér mappen `foundry-ai-tool` ind i `plugins`. Dens `main.js` skal ende i
   `.obsidian\plugins\foundry-ai-tool\main.js`, ikke en mappe dybere.
5. I Obsidian klik på tandhjulet (nederst til venstre), **Community plugins**. Hvis der står Restricted
   mode, klik på **Turn on community plugins**. Under **Installed plugins** slå **Foundry AI Tool** til.

## Forbind det

1. Klik på tandhjulet ved siden af **Foundry AI Tool** i pluginlisten.
2. **Dashboard address:** skriv dashboardets https-adresse. Brug https: pluginet sender de to
   Cloudflare-værdier kun til en https-adresse, aldrig til en almindelig http-adresse (så
   `http://localhost` kommer ikke igennem Cloudflare-loginet). GM-token'et følger med hvert kald.
3. Læg GM-token'et ind:
   1. Klik på feltet **GM token**.
   2. Klik på **Add secret**.
   3. I **ID** skriv `foundry-gm-token`.
   4. I **Secret** indsæt kun selve token'et.
   5. Klik på **Save**.
   6. Vælg `foundry-gm-token` i listen.
4. Gør det samme for **Cloudflare Access Client ID** (ID `cf-access-client-id`) og **Cloudflare Access
   Client Secret** (ID `cf-access-client-secret`).

De tre værdier bliver i Obsidian på din pc. De ligger ikke i vaulten, så Syncthing kopierer dem aldrig.

## Færdig, når det ser sådan ud

Åbn en NPC-note og brug så en af disse. Arket åbner på din Foundry-skærm. (Første gang kan en lille
dashboard-side bede dig klikke **Open**.)

- Højreklik på noten i fillisten og klik på **Open in Foundry**.
- Eller tryk Ctrl+P, skriv **Open in Foundry** og tryk Enter.
- Eller klik på den lille tekst nederst til højre i Obsidian-vinduet. Der står **Foundry: npc**
  (notens type), eller **Players: ...** på en journalside. Den vises kun, mens en Foundry-note er åben.

Linket **Open in Foundry** inde i selve notens tekst bruger serverens adresse, og den virker måske ikke
på din pc endnu. Hvis det ikke gør noget, så brug en af de tre måder ovenfor.

## Hvis det ikke virker

- **"...did not come from the dashboard":** Cloudflare Client ID eller Secret er forkert eller udløbet. Bed
  den, der byggede værktøjet, om nye.
- **"...Check the GM token in the plugin settings.":** indsæt GM-token'et igen.
- **"The dashboard at ... did not answer":** adressen er forkert, eller serveren er nede. Åbn dashboardets
  adresse i en browser for at se.
- **Pluginet er ikke i listen:** mappen skal være `.obsidian\plugins\foundry-ai-tool` med `main.js`
  direkte i. Genstart Obsidian.
