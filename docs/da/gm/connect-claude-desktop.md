---
source: gm/connect-claude-desktop.md
sourceHash: 1320e9b99962
title: Forbind Claude Desktop til serveren
description: Installer den lille Windows-klient, så Claude Desktop på din PC når det Foundry AI Tool, der kører på hjemmeserveren, med en nøgle som kun du har.
---

# Forbind Claude Desktop til serveren

Foundry og værktøjet kører på hjemmeserveren, ikke på din PC. For at Claude Desktop på din PC kan
tale med dem, installerer du et lille program én gang. Det gør to ting: det lægger de fem
Foundry-connectors ind i Claude Desktop, og det holder en privat, låst tunnel åben til serveren. Du
gør det én gang, og du skal bruge din **tunnelnøgle** (to stykker tekst) fra den, der byggede
værktøjet.

Du skal bruge: en Windows-PC, Claude Desktop installeret og logget ind, og tunnelnøglen. Cirka 10 minutter.
Den gratis Claude-plan er nok til at forbinde, men den har en grænse pr. fem timer og en pr. uge; se
[Claude Free eller Pro](claude-plans.md).

Dette er en af [engangsopsætningerne](README.md#engangsopsætning). Ved en ny installation gør du
"Installer", "Tjek, at det virker" og "Stop Allow-spørgsmålene" i den rækkefølge. For at skifte til en nyere
klient (en fil, der hedder `FoundryMCPServer-Setup-vX.Y.Z.exe`) gør du "Opdater klienten".

## Installer

1. **Afslut Claude Desktop helt.** Højreklik på dets ikon i systembakken (nederst til højre, ved
   uret) og vælg **Quit**. Det er ikke nok at lukke vinduet. Installationsprogrammet lukker det ikke
   for dig.
2. Hent `FoundryMCPServer-Setup-vX.Y.Z.exe` (X.Y.Z er det nyeste versionsnummer) under **Assets** nederst i den nyeste
   release på <https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool/releases>, eller brug den kopi, du
   har fået sendt. Kør den.
3. På siden "Bridge address": sæt flueben ved **Use the Cloudflare tunnel**. Skriv det navn, du har
   fået, i **Tunnel name** (det begynder med `mcp.`). Lad adressen og porten stå, som de er.
4. Gå videre. Et lille vindue spørger efter **Client ID** og derefter **secret**. Indsæt hver af dem
   og tryk Enter. Secret er skjult, mens du indsætter; det er normalt. Intet, du indsætter, bliver
   vist eller gemt andre steder end i et låst lager, som kun din Windows-bruger kan åbne.
5. Gør installationen færdig. Start Claude Desktop. Klik på **+** i chatfeltet, vælg **Plugins**, og slå dem til,
   du vil bruge (`foundry-mcp` er Core; Play og Prep er dem, du bruger mest). En connector, der er
   slået fra, er ikke tilgængelig i den chat. Gør derefter afsnittet Stop "Allow"-spørgsmålene nedenfor én
   gang, så Claude ikke spørger "Allow?" ved hvert eneste værktøjskald.

## Opdater klienten

Klienten opdaterer sig ikke selv, medmindre den, der byggede værktøjet, har slået det til på din PC
(se "Automatiske opdateringer" nedenfor). Når den, der byggede værktøjet, sender en ny
`FoundryMCPServer-Setup-vX.Y.Z.exe`, installerer du den oven på den gamle: samme trin som under
"Installer" ovenfor. Siden "Bridge address" er allerede udfyldt, men installationsprogrammet spørger igen
efter Client ID og secret, så hav nøglen klar og indsæt begge.

Gør det, når Claude ser ud til at mangle værktøjer, som vejledningerne nævner. En gammel klient
skjuler nyere værktøjer uden nogen fejl. Sådan tjekker du det: sørg for, at Prep-connectoren er slået til (**+**-menuen, derefter
**Plugins**), og spørg så Claude i en ny chat _"Run get-preflight"_. Rækken **Claude Desktop
connectors are up to date** er grøn, når du er opdateret. En advarsel betyder, at en gammel klient
stadig er forbundet: afslut Claude Desktop fra systembakken (nær uret), kør den nyeste installer,
start Claude Desktop igen og spørg endnu en gang. Siger rækken, at ingen connector er forbundet, er
Claude Desktop ikke forbundet til serveren endnu; det er ikke et opdateringsproblem.

### Automatiske opdateringer (slået fra, til de slås til)

Med Cloudflare-tunnelen kan klienten opdatere sig selv, men først når det er slået til på din PC.
Når det er til, spørger den hver gang du logger ind i Windows, hvilken version bordet kører. Er din
klient ældre, og Claude Desktop er lukket, henter den præcis den udgave fra GitHub, tjekker den mod
udgavens `SHA256SUMS.txt` og installerer den lydløst med din nøgle bevaret. Fejler hentningen
eller tjekket, installeres intet; fejler selve installationen, lægger den de gamle filer tilbage. Er Claude Desktop åben, venter den til næste login. Resultatet er
én linje i `%LOCALAPPDATA%\FoundryMCPServer\tunnel\update.log`; genstart Claude Desktop bagefter for
at indlæse den nye klient. Beskeden "opdatering klar" på dashboardet forsvinder, når din klient
svarer til bordet.

Slå det til eller fra med (PowerShell):

```powershell
& "$env:LOCALAPPDATA\FoundryMCPServer\client-update.ps1" -Action Enable
& "$env:LOCALAPPDATA\FoundryMCPServer\client-update.ps1" -Action Disable
& "$env:LOCALAPPDATA\FoundryMCPServer\client-update.ps1" -Action Status
```

**Uden tunnelen** (direkte forbindelse over Tailscale) sætter installationsprogrammet det samme op
af sig selv og slår det **til** første gang. Det læser bordets version fra den adresse, du gav
installationsprogrammet, og login-opgaven hedder "Foundry AI Tool client update". Filerne ligger i
`%LOCALAPPDATA%\FoundryMCPServer\update`. Starter Claude Desktop med Windows, er det som regel
allerede åbent ved login, så den dags tjek springes over; næste login med Desktop lukket opdaterer.
Vil du opdatere med det samme, så luk Claude Desktop fra bakken og åbn "Update the client now" i
Start-menuen (mappen "Foundry AI Tool Client"); den virker også, selv om automatiske opdateringer er
slået fra. Slå automatiske opdateringer til eller fra med:

```powershell
& "$env:LOCALAPPDATA\FoundryMCPServer\client-update.ps1" -Action Disable -StateDir "$env:LOCALAPPDATA\FoundryMCPServer\update"
& "$env:LOCALAPPDATA\FoundryMCPServer\client-update.ps1" -Action Enable -StateDir "$env:LOCALAPPDATA\FoundryMCPServer\update"
```

En lydløs installation med `/NOAUTOUPDATE` lader det være slået fra.

Dette rører ikke Obsidian-pluginet. Serveren lægger det nyeste plugin i GM-vaulten, og Syncthing
bringer det til din pc (se [Obsidian-synkroniseringsguiden](setup-obsidian-sync.md)); genstart
Obsidian for at indlæse det.

## Tjek, at det virker

Færdig, når det ser sådan ud: spørg Claude _"What world is open in Foundry?"_ Et normalt svar med worldens navn
betyder, at du er forbundet. Sørg så for, at Prep-connectoren er slået til, og spørg _"Run get-preflight"_:
rækken **Claude Desktop connectors are up to date** er grøn. Hvis Claude siger, at den ikke kan nå bridgen, så
gå til listen nedenfor.

## Stop "Allow"-spørgsmålene

Uden det her trin spørger Claude Desktop "Allow?" ved næsten hvert Foundry-værktøjskald i hver ny
chat. Claude Desktop gemmer det valg på din konto, ikke i en fil, så installationsprogrammet kan
ikke sætte det for dig. Du gør det én gang pr. connector.

1. Åbn **Settings** i Claude Desktop, derefter **Plugins**, og vælg filteret **Connectors**.
2. Klik på en af Foundry-connectorerne (`foundry-mcp`, `foundry-mcp-play`, `foundry-mcp-prep`,
   `foundry-mcp-build`, `foundry-mcp-admin`).
3. Under **Tool permissions**: klik på drop-downmenuen til højre for linjen **Read-only tools**
   (den kan sige **Blocked** eller **Needs approval** nu) og vælg **Always allow** (fluebenet).
4. Gør det samme på linjen **Write/delete tools**. Vi foreslår **Always allow** dér også, fordi
   værktøjet allerede viser dig en plan og beder dig bekræfte, før det ændrer noget, så du
   får ét spørgsmål, ikke to. Lad ikke nogen af linjerne stå på **Blocked**: så kan Claude slet
   ikke bruge de værktøjer.
5. Gentag for de andre connectors, du bruger. Ved bordet er det `foundry-mcp` (Core),
   `foundry-mcp-play` og `foundry-mcp-prep`; gør også `foundry-mcp-build` og `foundry-mcp-admin`,
   hvis du slår dem til.

På en ny installation kan hver Foundry-connector vise **Blocked** for begge grupper. Sæt hver
connector, du bruger; en connector, du aldrig sætter, bliver som den er.

Hvert Foundry-værktøj er markeret som læsende eller ændrende, så de to grupper sorterer sig selv. Nogle
få Play-værktøjer handler med det samme uden en plan (terningslag, chatbeskeder, at flytte eller slette
tokens); med **Always allow** på writes stopper Claude Desktop heller ikke for dem. Flere detaljer i
[Asking Claude](asking-claude.md).

**For at gå tilbage:** sæt drop-downmenuen **Write/delete tools** til **Needs approval** (hånden) på
connectorens skærm **Tool permissions**. Gør det samme for **Read-only tools**, hvis du også vil
spørges, når der læses.

## Hvis noget ikke virker

- **"The bridge is not reachable":** tunnelen kan være stoppet. Åbn PowerShell og kør den
  statuslinje, du har fået af den, der byggede værktøjet, eller genstart din PC. Tunnelen starter
  af sig selv ved hver login.
- **De fem connectors mangler:** Claude Desktop kørte stadig og omskrev sine indstillinger, da den
  blev lukket. Afslut den fra systembakken og kør installationsprogrammet igen.
- **Nøglen blev afvist:** Client ID eller secret blev indsat forkert, eller nøglen blev slået fra.
  Kør installationsprogrammet igen og indsæt begge igen, eller bed om en ny nøgle.
- **Alt virkede i går, og intet virker i dag:** åbn spillets adresse først.
  Hvis den ikke indlæses, er serveren nede; se [Runbook til spilaftenen](game-night-runbook.md).

## Fjern det igen

Settings, Apps, **Foundry AI Tool Client**, Uninstall. Det fjerner de fem connectors, tunnelen
og din gemte nøgle. Din nøgle kan også til enhver tid slås fra på serversiden, så en mistet
laptop ikke er et problem: sig det til den, der byggede værktøjet.

## Godt at vide

- Tunnelen bærer kun forbindelsen mellem Claude Desktop og værktøjet. Ingen på internettet
  kan bruge den uden nøglen, og nøglen forlader aldrig din PC.
- Du skal ikke bruge Tailscale eller noget andet program til det her.
- Hvis du skifter til en ny PC, så installer igen dér med samme nøgle, eller bed om en ny og lad
  den gamle blive slået fra.
