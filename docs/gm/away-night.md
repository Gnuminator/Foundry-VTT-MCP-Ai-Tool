---
title: A night at someone else's place
description: The day-before check and the pack list for playing in person away from home, with the TV, a strange network and a plan if the network fails.
---

# A night at someone else's place

For a session where you play in one room that is not yours: a friend's home, with your laptop and a
TV. The day before, run one check on the laptop that goes. It reads the network, the screens and
the game's address, and prints the pack list. It changes nothing. About 10 minutes.

You need the TV set up once already ([The TV at the table](setup-tv-table.md)) and the game's
address.

## The day before

1. **Pack** with the list below.
2. **Sign in once at home** on the laptop: open the game's address and enter the email code, so
   the laptop is already known when you arrive.
3. **Run the check on the host's network.** If you can, do it there. Otherwise do it on the phone
   hotspot, which is your second network anyway. Open PowerShell in the tool's folder (the tool
   admin gives you a copy) and run, with the game's address:

   ```powershell
   pwsh scripts\away\away-preflight.ps1 -Url https://your-game-address
   ```

4. Read the lines. **OK** is fine. **WARN** is worth fixing but the night can go on. **FAIL** must
   be fixed first. If a network fails, run the same line on the phone hotspot.

What it checks:

| Line         | What it tells you                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| Game address | The game answers from this network. A sign-in page is the right answer before you sign in. Slow warns. |
| Discord      | discord.com is not blocked here (voice and the table's bot).                                           |
| TV           | A second screen is connected. If not, plug in the HDMI cable and press the Windows key and P.          |
| Browser      | Edge or Chrome is installed, for the game and the TV viewer.                                           |
| Power        | On a laptop: mains or battery, so you remember the charger.                                            |

## Pack list

- [ ] Laptop and charger, signed in to the game once
- [ ] HDMI cable, plus an adapter if the laptop needs one
- [ ] Headset or speaker for sound and Discord voice
- [ ] Phone with a hotspot, data plan checked, as the second network
- [ ] Extension cord with several sockets
- [ ] The [Game night runbook](game-night-runbook.md) and the Plan B address saved or printed

## On the night

Start the TV viewer first, then open the game on your own screen. If the network fails, switch the
laptop to the phone hotspot and reload (F5). If the game is down for everyone, follow
[The server is down](game-night-runbook.md#the-server-is-down). The recording plan for an in-person
table is not part of this check.
