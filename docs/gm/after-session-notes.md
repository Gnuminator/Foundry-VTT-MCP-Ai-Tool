---
title: 'After a session: notes'
description: What happens to the Discord recording after a session, where the notes land in Foundry, what you check and approve, and how the player recap reaches the players.
---

# After a session: notes

When the evening was recorded on Discord, the tool writes notes from the recording: a cleaned
transcript, a summary for you, notes per scene and a draft recap for the players. This page is the
whole path from recording to the players reading the recap. You do three things: read, approve and
give the players the recap. Nothing reaches a player until you say so.

## The path in six steps

1. **Record.** The Discord recorder on the home server records the voice channel by itself.
   Nobody is transcribed or written about unless every speaker has said yes to the recording.
   Nothing for you to do.
2. **Run.** Gnuminator runs one command on his PC after the session
   (`session.ps1`). It fetches the recording from the home server, turns speech into text on his PC,
   lets Claude write the notes (in Danish, with English next to it) and hands them to the tool.
   It takes a few hours. If it stops (for example Claude's usage limit is reached), he runs the same
   command again later. Nothing for you to do.
3. **Publish.** The last thing the command does is hand the notes to the tool, which puts them
   into a journal in your Foundry by itself, see "Where it lands" below. Nothing for you to do
   except having Foundry open as a GM at some point.
4. **Review.** You read the pages and fix what is wrong.
5. **Approve.** You approve the notes by revealing the Recap or by clicking **Approve without
   revealing**.
6. **Give the players the recap.** You reveal the Recap page from the Handouts queue. Until you do,
   no player sees any of it.

## Where it lands

The notes go into one journal for the session, in the folder **Session notes** in Foundry's Journal
tab. The journal is named with the date and the title, for example "2026-11-22: Session 0 and ...". It
is for GMs only: no player can see the folder, the journal or any page.

| Page           | What is in it                                                                                                                                                 | Who sees it                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Recap**      | The draft recap for the players, Danish first, then English under the heading English. Queued in the Handouts queue for you.                                  | You. The players only after you reveal it. |
| **GM summary** | The summary of the evening, **What changed**, **Characters** (who each character is and what they did) and **Worth remembering**, Danish first, then English. | You only                                   |
| **Scenes**     | One section per scene with time, summary and lists of events, decisions, NPCs, loot and losses, open threads, dice, quotes and a **GM only** list.            | You only                                   |

The cleaned transcript, the raw text, the in-depth notes and the index are **not** put into
Foundry. They stay as files on Gnuminator's PC together with the recording, and are never shared
with players or in the repository.

The notes arrive on their own when three things are true: a GM is in Foundry, **AI Tool: Allow Write
Operations** is on, and the switch **AI Tool: Session notes (writes)** is on. If one is missing the
dashboard card says which, and the notes go in as soon as it is fixed. Everything the tool puts in
is logged in **Recent Changes** with **Undo**. Undo does not work once you have revealed the Recap
to the players or edited a page in Foundry.

Obsidian: your day note for the evening (`AI Tool/Sessions/`) gets a line under **Session notes**
that names the journal. The pages themselves show up in your vault under `AI Tool/Foundry/Journals/Session notes/`
only when you have switched the [Obsidian mirror](obsidian.md) on.

## Review

Open the journal and read the pages. In the dashboard, the **Session notes** card under tonight's
stats (After view) has a **Read** button that shows all pages in the side panel.

Look for:

- **Names and places spelled wrong.** Fix them in Foundry; the page is yours to edit. (After you edit
  a page, **Undo** for the whole journal stops working. That is fine.)
- **Things in the Recap the players should not know yet.** The Recap is what the players read. Cut
  anything that gives away a secret, an NPC's plan or a rule you kept to yourself. The GM summary and
  the Scenes pages never go to the players, so write what you like there.
- **Something the AI got wrong.** The notes are a draft written from speech. If a scene is marked
  as raw text, Claude could not write it up; read the transcript on Gnuminator's PC or ask him.

## Approve

The notes count as approved when you do one of these in Foundry or in the dashboard:

- **Reveal the Recap** to the players (next section). This approves the notes in the same click.
- Click **Approve without revealing** on the dashboard card, when you want the notes approved but the
  recap held back for now.

The card then says **Approved**. If you take the notes out again with Undo, the approval stays, and
the card offers **Put in Foundry** to put them back.

## Give the players the recap

The tool does not post the recap anywhere on its own: not to Discord, not to the player page. You
reveal it, as you reveal any handout. The Recap page is already waiting for you in the Handouts
queue.

1. In Foundry, in the toolbar group **AI Tool** (map controls), click **Handouts**. (The dashboard's
   handout drawer shows the same queue.) The recap page is in the **Queue**, oldest first, so reveal
   or **Remove** the older entries before it.
2. Click **Reveal next**. It takes the oldest entry meant for the scene you have open (or for no
   particular scene), so entries for other scenes wait. A window shows exactly what will change.
   Read it and confirm. This needs the switch **AI Tool: Handouts (writes)** to be on; the window says so if it is not.
3. Tick **Show it now** next to **Reveal next** if you want the recap to pop up on the players'
   screens right away. Leave it unticked and they find it themselves.

What the players see: the recap is copied into a journal called **Handouts** that every player can
read. On the player page it shows as **Last recap**, because its title says "recap". If you use the
players' own Obsidian vaults, it also lands in their `Recaps/` folder. The GM summary and the Scenes
pages never go there, and neither does the journal in the Session notes folder.
In Discord, a player can type `/recap` to get the latest recap you shared; it shows only what you
revealed.

If you reveal it by mistake, **Changes** in the AI Tool group hides the page again and puts it back
in the queue (a popup you chose to show cannot be closed that way).

> **Not sure? Ask Claude.** Ask the GM coach: "What happens to the session notes after a recorded session, and how do I get the Recap to my players?" ([how to add the GM coach](gm-coach.md))

## If nothing arrives

| What you see                                            | Likely cause and what to do                                                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| No journal in **Session notes** a day after the session | Gnuminator has not run the command yet, or it paused. Ask him.                                                                              |
| The card says **Waiting** and names a switch            | Turn that switch on in Foundry (Settings, Game Settings, **Foundry AI Tool**) and open Foundry as a GM. The notes go in by themselves.      |
| The Recap is not in the Handouts queue                  | It was queued when the notes went in. If you took the notes out with Undo, click **Put in Foundry** on the card; the Recap is queued again. |
| **Reveal next** says the handouts switch is off         | Turn on **AI Tool: Handouts (writes)** in Game Settings.                                                                                    |
| You do not want the notes for a session at all          | Say so to Gnuminator before he runs the command. Without everyone's yes nothing is written.                                                 |

Back to [after each session](after-session.md).
