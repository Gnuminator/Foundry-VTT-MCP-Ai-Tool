---
title: Your Obsidian vault
description: The GM's Obsidian vault on your own PC, what to edit in it, and how to connect the AI Tool plugin to the dashboard on the server.
---

# Your Obsidian vault

The tool writes your world into an Obsidian vault on the server, and Syncthing copies it to your
PC. You read it in Obsidian like any notes. It is the GM's vault: it has the secrets and the book
text, so it stays on your PC. The players get vaults of their own without the secrets.

## What is in it

- **Home:** your start page for the campaign, `Home.md` in the world's folder. It is sorted by what
  you are doing (before, during and after a session) with links and live tables to NPCs, scenes,
  quests, story items and the session notes. The tool creates it once and never rewrites it after
  you edit it. The 📓 button next to Start session in the dashboard opens it.
- **The AI Tool folder:** notes the tool writes. Characters, NPCs, scenes, journals, quests, the
  Library (monsters, spells, rules), session notes and stats, and under `Everyone` one note per
  day with every change the players, you and the AI made in Foundry (who, when, what; undo it in
  the dashboard, not here). The tool rewrites these, so don't plan your game in them. A note you
  did edit stays where it is and is listed in `_status.md`; an edited day note under `Everyone`
  is not listed there, it just stops being updated.
- **The Prep folder:** yours. The tool never changes your notes there. Your session plans and
  notes on NPCs, places and quests go here, and Claude reads them when you prepare a session (see
  the [cookbook](cookbook.md), "Tip for Obsidian"). Prep/Templates has a template for an NPC, a
  location, a quest and a session plan.

## Seen in

An NPC note and a scene note have a **Seen in** list: the play sessions where that NPC or scene
turned up, newest first, each a link to the session note. It comes from what Foundry recorded at
the table, so it needs no setup and never guesses from names. Only what the players saw counts:
nothing is listed while no player is connected (your prep, making NPCs and placing tokens never
count). An NPC counts when it rolled, spoke, used something, was hit or healed, took its combat
turn, or had a visible token on the active scene when you activated it or a player joined. What
happens to a hidden token (damage, conditions, its combat turn), a whispered or blind roll and a
scene you only previewed do not count; a public roll by a hidden NPC does, because the players
read it in the chat. Players who joined before you marked the session start still count. The
`last_seen` property holds the date of the newest session, for sorting in a Base. A player
character has no list, because its stats note says it all.

## Make a prep note

On an NPC, a scene or a quest journal note, open the note's file menu (the three dots) and click
**New prep note for this**, or run the command of the same name. Pick the kind (the likely one is
first). The plugin makes a note in Prep (for example Prep/NPCs/Ismark.md) from the template,
ties it to the thing in Foundry and links back to it. Fill in what you need, leave the rest empty.
If that note is already there, it opens instead, even after you moved or renamed it inside Prep.
A session plan is new each time, named after today's date (for example Prep/Session plans/Session
2026-11-29.md), and Claude reads the newest one. Its date property is today too: change it to the
game night when you plan ahead. This works without the dashboard.

To keep a prep note away from Claude, open it and run **Toggle: Claude may read this prep note**.
It sets the property `ai_context` to false (or back to true).

A template's grey line between %% marks is a hint for you; Claude skips it. To use the templates
for notes you start yourself, point Obsidian's Templates (or Templater) template folder at
Prep/Templates. Edit the templates as you like: the tool writes them only when the folder is
missing.

Changes you make in Obsidian never reach Foundry by themselves. Things that change the game
(revealing a handout, for example) are planned from Obsidian and confirmed in the dashboard.

**A quest from Obsidian into Foundry:** a quest note in your `Prep` folder with the property
`type` set to `quest-prep` and an empty `fvtt_uuid` can become a GM-only quest journal. Open the
note and run **Import this quest prep note into Foundry (confirm in the dashboard)**, then confirm
the plan in the dashboard. It needs the switch "AI Tool: Obsidian import (writes)" (off until you
turn it on in Foundry's Game Settings, category **Foundry AI Tool**). **Undo** in Recent Changes
removes the journal, and the same note cannot be imported twice until you do. A note with
`ai_context` set to false is refused.

## Connect the plugin (once)

The AI Tool plugin adds **Open in Foundry**, the reveal status of handouts and the shared theme. It
talks only to the dashboard. When the dashboard runs on the server, Cloudflare guards it, and the
plugin needs three values to get through. The builder pastes them in with you during setup, on
your PC; they never go in chat or in a note.

1. In Obsidian: Settings, Community plugins, **Foundry AI Tool**, the gear icon.
2. **Dashboard address:** the dashboard's https address.
3. **GM token:** click it, then **Add secret** (below), and paste the dashboard's GM token.
4. **Cloudflare Access Client ID:** add a secret and paste the Client ID.
5. **Cloudflare Access Client Secret:** add another secret and paste the Client Secret.

**Obsidian's Add secret dialog** has two fields. **ID** is only a name for you to pick the secret by
later, never the value itself; use `foundry-gm-token`, `cf-access-client-id` and
`cf-access-client-secret`. **Secret** is the value. Paste only the value: Cloudflare's copy buttons
copy the header name too (`CF-Access-Client-Id: ...`), and the plugin drops that for you, but
cleaner is better. Back in the plugin's settings, pick each secret by its ID.

**Where the GM token comes from:** it is the `token=` part of the link the dashboard setup script
printed (`http://<name>:3000/?token=<token>`: everything after `token=`), or the builder reads it
from `dashboard-access.env` on the server in their own SSH window.

The three values stay in Obsidian's secret storage on your PC. They are not in the vault, so
Syncthing never copies them anywhere. The Cloudflare values are sent only to https addresses.

**Check it:** open an NPC note and click **Open in Foundry** in the status bar; the sheet opens on
your Foundry screen.

## When it does not work

| Message                                         | What to do                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| "...did not come from the dashboard"            | The Cloudflare Client ID or Secret is wrong or expired: ask the builder.       |
| "...Check the GM token in the plugin settings." | The GM token is wrong: paste it again.                                         |
| "The dashboard at ... did not answer"           | The address is wrong, or the server is down: check the dashboard in a browser. |

The Cloudflare token runs for a year; Cloudflare emails the builder before it expires.
