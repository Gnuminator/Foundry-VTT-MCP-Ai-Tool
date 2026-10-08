---
title: Game night runbook
description: One page for the night itself, what to do when Foundry, a player, Claude, the dashboard or the home server fails, and when to call for help.
---

# Game night runbook

Keep this page open on game night. Each problem has what to do in the first two minutes and when
to call for help. The longer explanations are in [Troubleshooting](troubleshooting.md).

**The rule for every problem: the game is Foundry.** If Claude, the dashboard, the notes or the
recording stop working, keep playing in Foundry and fix it at the break or after the session.
Nothing the table needs depends on them: you can do every change by hand in Foundry, and the
dashboard's change history still has its Undo when it comes back.

**Who to call:** the person who set up the tool (the tool admin below) is on standby on game
night, at the table or in Discord voice. Call them in voice or with a Discord direct message. You don't need to
solve technical problems yourself.

## Before you start (15 minutes before)

- [ ] Open the game's address and join as your GM user. Check the player list at the bottom left.
- [ ] Do the [Before each session](before-session.md) checklist (pre-flight, Ready for session).
- [ ] Join Discord voice. Start the recording with `/record start` only if every player has said
      yes to recording (or their track is taken out afterwards).

## Foundry does not load for you

1. Reload the page (F5). Then try another browser, or a private window.
2. Ask in Discord whether the players get in. If they do, the problem is your computer or browser:
   try another device. If nobody gets in, see [The server is down](#the-server-is-down).

## One player cannot connect

1. Send them [Join the game](../player/join.md); its table at the bottom covers most cases (no
   email code, wrong user name, small screen).
2. Wrong password: press **Esc**, **User Management**, type a new password in their row, **Save
   and Return**, and tell them in a direct message.
3. Their email never gets a code: their address is not on the access list. Call for help; that
   list lives in Cloudflare, not in Foundry.
4. While they wait, the others play on. The player can follow in voice and roll real dice; you
   enter their results by hand.

## Foundry is slow for everyone

1. Ask everyone to reload (F5). Close heavy scenes and stop animations or music you don't need.
2. If it stays slow for more than ten minutes, call for help at the next pause.

## Claude does not answer, or its tools fail

Keep playing: do the change by hand in Foundry.

- **"Usage limit" message:** the free plan has a limit per five hours. It resets by itself; until
  then, play without Claude. See [Claude Free or Pro](claude-plans.md).
- **Claude says a tool set is off:** switch it on in Claude Desktop's **Search and tools** menu
  (see [Asking Claude](asking-claude.md#tool-sets-which-switches-to-turn-on)).
- **Every tool call fails:** Claude has lost its link to the game. At the break, quit Claude Desktop
  fully and start it again. If that doesn't help, call for help after the session.

## The dashboard does not load or says disconnected

Keep playing in Foundry. At the break, reload the dashboard page. If it still says
**disconnected**, call for help after the session. Changes made meanwhile can still be undone
later from **Recent Changes**.

## The recording bot left or stopped

Type `/record status` in Discord. If it is not recording, type `/record start` again. A gap in the
recording only means the notes miss that part. Not worth stopping the game for.

## The server is down

**You see:** nobody can open the game's address, or Foundry stops for everyone at once and does
not come back after a reload.

This is plan B: the tool admin starts Foundry on their own PC from last night's backup and
gives you a new address.

1. Tell the players in Discord: "The server is down, we take a 15-minute break."
2. Call the tool admin right away. They start plan B.
3. When the tool admin posts the new address, everyone opens it and logs in as usual: same user
   names, same passwords.
4. Anything that happened tonight before the crash is not in last night's backup. Check
   hit points, spell slots and items with the players and set them by hand. Your chat log and
   the players' memories are the record.
5. If plan B does not work within about 30 minutes, play on in Discord with real dice, or end the
   night early.

The tool admin's technical steps for plan B are not written yet. They come with the plan B
rehearsal before the first online night (D-097, decision 6).

## When to call for help

- Right away: the server is down; nobody can log in; Foundry shows an error about the world or the
  database.
- At the next break: a player still cannot connect after the steps above; Foundry stays slow.
- After the session: Claude or the dashboard did not work; anything you fixed by hand that you
  want checked.

## After the session

- [ ] Do the [After each session](after-session.md) checklist.
- [ ] Write in Discord what broke and when, even if you fixed it. It helps the tool admin find the
      cause.
