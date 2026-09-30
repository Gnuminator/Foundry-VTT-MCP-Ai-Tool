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

No tool does this yet; it is done by hand. Pass the request to whoever set up the tool. What can
be removed is what the tool stores: the play log in the bridge vault and the session notes in
Obsidian. What Claude already read when you asked it something cannot be pulled back.

Next time: [before each session](before-session.md).
