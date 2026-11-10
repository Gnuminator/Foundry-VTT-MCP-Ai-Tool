---
source: gm/setup-obsidian-plugin.md
sourceHash: 69cc0afea9b8
title: 'Engangsopsætning: Obsidian-pluginet'
description: Installer Foundry AI Tool-pluginet i din vault og forbind det til dashboardet, så Open in Foundry virker fra en note.
---

# Engangsopsætning: Obsidian-pluginet

Pluginet lægger **Open in Foundry** på dine noter og viser, om et handout er afsløret. Du skal kun bruge
det, hvis du vil have det. Gør først [din vault på din pc](setup-obsidian-sync.md). Cirka 10 minutter,
én gang.

**Du skal bruge:** vaulten åben i Obsidian, dashboardets adresse og tre værdier fra den, der byggede
værktøjet (GM-token, Cloudflare Client ID og Cloudflare Client Secret). De giver dig dem privat; indsæt
dem aldrig i en chat eller en note.

## Installer pluginet

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
2. **Dashboard address:** skriv dashboardets https-adresse.
3. Klik på feltet **GM token**, derefter **Add secret**. I **ID** skriv `foundry-gm-token`, i **Secret**
   indsæt kun selve token'et, **Save**. Vælg den i listen.
4. Gør det samme for **Cloudflare Access Client ID** (ID `cf-access-client-id`) og **Cloudflare Access
   Client Secret** (ID `cf-access-client-secret`).

De tre værdier bliver i Obsidian på din pc. De ligger ikke i vaulten, så Syncthing kopierer dem aldrig.

## Færdig, når det ser sådan ud

Åbn en NPC-note og klik på **Open in Foundry** i statuslinjen nederst. Arket åbner på din Foundry-skærm.
(Første gang kan en lille dashboard-side bede dig klikke **Open**.)

## Hvis det ikke virker

- **"...did not come from the dashboard":** Cloudflare Client ID eller Secret er forkert eller udløbet. Bed
  den, der byggede værktøjet, om nye.
- **"...Check the GM token in the plugin settings.":** indsæt GM-token'et igen.
- **"The dashboard at ... did not answer":** adressen er forkert, eller serveren er nede. Åbn dashboardets
  adresse i en browser for at se.
- **Pluginet er ikke i listen:** mappen skal være `.obsidian\plugins\foundry-ai-tool` med `main.js`
  direkte i. Genstart Obsidian.
