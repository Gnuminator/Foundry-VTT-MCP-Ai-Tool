---
source: gm/setup-dashboard.md
sourceHash: 3b38abac146e
title: 'Engangsopsætning: dashboardet'
description: Åbn dashboardet på din anden skærm for første gang, log ind gennem Cloudflare, sæt et bogmærke og vælg dit During-layout. Cirka 10 minutter, én gang.
---

# Engangsopsætning: dashboardet

Dashboardet er dit kontrolpanel på en anden skærm. Serveren kører det hele tiden, så der er intet at
installere. Du åbner det, logger ind, sætter et bogmærke og vælger, hvordan During-skærmen ser ud. Alle
paneler er forklaret i [Dashboardet](dashboard.md). Cirka 10 minutter, én gang.

**Du skal bruge:** dashboardets adresse fra den, der byggede værktøjet, og den e-mailadresse, de har givet
Cloudflare til dig.

## Åbn det og log ind

1. Skriv dashboardets adresse i din browser (Edge eller Chrome) på den skærm, spillerne ikke kan se.
2. Cloudflare beder om din e-mailadresse. Skriv den og klik på **Send me a code**.
3. Åbn din e-mail, kopiér den sekscifrede kode, indsæt den på Cloudflare-siden og klik på **Sign in**.
   Cloudflare spørger igen en gang imellem; det er normalt.
4. Sæt et bogmærke på siden (Ctrl + D).

## Se på headeren

Øverst skal knappen **✈ Pre-flight** sige "ready" eller "N to fix", og ingen "Connection lost"-markering
skal vises. Klik én gang på **✈ Pre-flight** for at se listen; at rette den hører til
[Før hver session](before-session.md).

## Vælg dit During-layout

1. Klik på **Advanced ▾** i headeren. I gruppen **During screen** klik på **▦ Try the During layouts**.
   (Ved et første besøg har **Before**-skærmen også et kort **Pick your During layout** med den samme
   prøve; det forsvinder, når et layout er valgt.)
2. De tre layouts vises på den rigtige skærm, ét ad gangen, med en lille guide i hjørnet.
3. Klik på **Next**, til **Auto** vises, og klik så på **Use this one**. **Auto** følger spillet: det ser ud som Cards, til en kamp
   starter, og så vokser Combat order. **Stop** beholder det, du havde.
4. Du kan skifte når som helst med **Layout** øverst på During-skærmen.

## Combat-knapper

Knapperne Damage / Heal, Condition og Clear i combat strip virker, når **GM Actions** er slået til. Et
klik på **Start session** i headeren slår det til for aftenen, så du skal ikke sætte noget nu. Indtil da kan
de være slået fra, og det er normalt.

## Færdig, når det ser sådan ud

Dashboardet åbner fra dit bogmærke, Live Feed og Recent Changes vises, der er ingen "Connection
lost"-markering, og **Layout** øverst på During-skærmen viser det layout, du valgte.

## Hvis det ikke virker

- **Cloudflare siger, at din e-mail ikke er tilladt:** den står ikke på listen. Sig præcis den adresse, du
  brugte, til den, der byggede værktøjet.
- **Der kommer ingen kode:** kig i spam-mappen, og bed så om en ny kode.
- **"Connection lost", eller Pre-flight siger, at Foundry ikke er forbundet:** se
  [Fejlfinding](troubleshooting.md).
- **GM-knapper bliver afvist, selv om dashboardet er forbundet:** browseren har ikke GM-token'et endnu.
  Åbn den adresse, den, der byggede værktøjet, gav dig til GM'en (den ender på `?token=` og en lang
  tekststreng), én gang i den browser, du bruger til dashboardet; browseren husker den for den adresse.
  Brug derefter dit bogmærke. Token'et hører til den https-adresse og den browser, så en anden browser
  eller en ændret adresse kræver linket igen.
- **Kortet "Pick your During layout" er der ikke:** brug **Advanced ▾**, **▦ Try the During layouts** i
  stedet.
