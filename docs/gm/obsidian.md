---
title: Your Obsidian vault
description: The GM's Obsidian vault on your own PC, what to edit in it, and how to connect the AI Tool plugin to the dashboard on the server.
---

# Your Obsidian vault

The tool writes your world into an Obsidian vault on the server, and Syncthing copies it to your
PC. You read it in Obsidian like any notes. It is the GM's vault: it has the secrets and the book
text, so it stays on your PC. The players get vaults of their own without the secrets.

## What is in it

- **The AI Tool folder:** notes the tool writes. Characters, NPCs, scenes, journals, quests, the
  Library (monsters, spells, rules), session notes and stats. The tool rewrites these, so don't
  plan your game in them. A note you did edit stays where it is and is listed in `_status.md`.
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
turn, or had a visible token on the active scene when you activated it or a player joined. A
hidden token, a whispered or blind roll and a scene you only previewed do not count. The
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

A template's grey line between %% marks is a hint for you; Claude skips it. To use the templates
for notes you start yourself, point Obsidian's Templates (or Templater) template folder at
Prep/Templates. Edit the templates as you like: the tool writes them only when the folder is
missing.

Changes you make in Obsidian never reach Foundry by themselves. Things that change the game
(revealing a handout, for example) are planned from Obsidian and confirmed in the dashboard.

## Connect the plugin (once)

The AI Tool plugin adds **Open in Foundry**, the reveal status of handouts and the shared theme. It
talks only to the dashboard. When the dashboard runs on the server, Cloudflare guards it, and the
plugin needs three values to get through. The builder gives them to you through a password
manager, never in chat or in a note.

1. In Obsidian: Settings, Community plugins, **Foundry AI Tool**, the gear icon.
2. **Dashboard address:** the dashboard's https address.
3. **GM token:** click it, create a secret, paste the dashboard's GM token.
4. **Cloudflare Access Client ID:** create a secret, paste the Client ID.
5. **Cloudflare Access Client Secret:** create another secret, paste the Client Secret.

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
