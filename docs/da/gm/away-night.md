---
source: gm/away-night.md
sourceHash: 005b38e17cfb
title: En aften hos en anden
description: Tjekket dagen før og pakkelisten til at spille i samme rum væk hjemmefra, med tv, et fremmed netværk og en plan, hvis netværket svigter.
---

# En aften hos en anden

Til en session, hvor I spiller i ét rum, der ikke er dit: hos en ven, med din laptop og et tv. Dagen før
kører du ét tjek på den laptop, der skal med. Det læser netværket, skærmene og spillets adresse og
udskriver pakkelisten. Det ændrer ingenting. Cirka 10 minutter.

Du skal allerede have sat tv'et op én gang ([Tv'et ved bordet](setup-tv-table.md)) og have spillets
adresse.

## Dagen før

1. **Pak** efter listen herunder.
2. **Log ind én gang hjemme** på laptoppen: åbn spillets adresse og skriv e-mailkoden, så laptoppen
   allerede er kendt, når du kommer frem.
3. **Kør tjekket på værtens netværk.** Kan du, så gør det der. Ellers kør det på telefonens hotspot,
   som under alle omstændigheder er dit andet netværk. Åbn PowerShell i værktøjets mappe (administratoren
   giver dig en kopi) og kør, med spillets adresse:

   ```powershell
   pwsh scripts\away\away-preflight.ps1 -Url https://your-game-address
   ```

4. Læs linjerne. **OK** er fint. **WARN** er værd at ordne, men aftenen kan gå videre. **FAIL** skal
   rettes først. Svigter et netværk, så kør samme linje på telefonens hotspot.

Hvad den tjekker:

| Linje        | Hvad den fortæller dig                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| Game address | Spillet svarer fra dette netværk. En login-side er det rigtige svar, før du er logget ind. Langsomt giver WARN. |
| Discord      | discord.com er ikke blokeret her (voice og bordets bot).                                                        |
| TV           | En ekstra skærm er tilsluttet. Hvis ikke, sæt HDMI-kablet i og tryk på Windows-tasten og P.                     |
| Browser      | Edge eller Chrome er installeret, til spillet og tv-vieweren.                                                   |
| Power        | På en laptop: strøm eller batteri, så du husker opladeren.                                                      |

## Pakkeliste

- [ ] Laptop og oplader, logget ind i spillet én gang
- [ ] HDMI-kabel, plus en adapter, hvis laptoppen har brug for en
- [ ] Headset eller højttaler til lyd og Discord-voice
- [ ] Telefon med hotspot, dataabonnement tjekket, som andet netværk
- [ ] Forlængerledning med flere stik
- [ ] [Spilaftenens runbook](game-night-runbook.md) og Plan B-adressen gemt eller printet

## På aftenen

Start tv-vieweren først, og åbn derefter spillet på din egen skærm. Svigter netværket, så skift laptoppen
til telefonens hotspot og genindlæs (F5). Er spillet nede for alle, så følg
[Serveren er nede](game-night-runbook.md#serveren-er-nede). Optageplanen for et bord i samme rum er ikke
en del af dette tjek.
