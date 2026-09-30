---
title: After each session
description: A short checklist for the GM after a play session ends.
---

# After each session

Do these right after the players leave, while Foundry and the dashboard are still open. Each item
is one action.

## Close the session

- [ ] In the dashboard header, click **End session**. It should now say "No session".
- [ ] Look through **Recent Changes** in the dashboard. If a change should not stay, click its
      **Undo** (GM Actions must be on for that).
- [ ] If the dashboard header says **⚔ GM Actions: on**, click it so it says **off**.
- [ ] In the Tarokka drawer (🃏 **Tarokka**), untick **Show cards** if it is ticked.

## Switch features off

- [ ] In Foundry: Settings tab (gear icon), **Game Settings**, category **Foundry AI Tool**. Switch
      off the "AI Tool: … (writes)" features you do not need until next time. Click **Save
      Changes**. Undo still works with a feature off.

## Recap and notes

- [ ] In Claude Desktop, run the prompt `session-recap` (`audience` gm) for your own summary.
- [ ] If you share a recap with the players, run `session-recap` with `audience` players, and read
      it before you send it on.
- [ ] In Obsidian, open this session's note (`Campaigns/<world id>/AI Tool/Sessions/`) and check it
      has the evening's events and stats.
- [ ] Write your own notes in your own files (for example in `Campaigns/<world id>/Prep/`), not in
      the notes the tool generated. A generated note you edit stops updating.

## Before you shut down

- [ ] Leave Foundry (Settings tab, **Log Out**) or close the Foundry tab.
- [ ] Stop the dashboard: in its terminal window press Ctrl+C, or close the window.
- [ ] Quit Claude Desktop if you are done. The bridge stops with it.

## If a player asks for their data to be removed

One command removes a player's records from the bridge vault: every roll, change and chat message
under their Foundry user name, and the dashboard usage records. It is not an AI tool on purpose:
Claude cannot delete anyone's data.

1. Quit Claude Desktop (the bridge keeps writing these logs while it runs; the command refuses
   until it has stopped).
2. Open a terminal in the tool's folder. Find the world id with `npm run vault -- worlds`.
3. See what would go, without changing anything:
   `npm run vault -- forget-user <world id> <user name> --dry-run`
4. Remove it: the same command without `--dry-run`. To remove only the chat they wrote and keep
   their rolls in the stats, add `--chat-only`.
5. Rebuild the Obsidian notes: `npm run obsidian -- export`. Notes that are no longer produced move
   to Obsidian's `.trash` folder; empty it. A note you edited by hand is kept as it is: check it.

The user name is the Foundry user name, not the character name (`Player`, not `Test Hero`); the
Foundry user id works too. What Claude already read when you asked it something has gone to
Anthropic and cannot be pulled back.

Next time: [before each session](before-session.md).
