---
title: Your GM coach in Claude
description: Add the Foundry GM coach skill to your own Claude account, how to ask it, and the Claude Project fallback.
---

# Your GM coach in Claude

The **Foundry GM coach** is a skill for your own Claude account: a set of pages about Foundry 14,
the D&D 5e system and this tool, plus instructions for Claude to answer from them. Ask it things
like "where do I give a player permission to open doors?" or "how do I start combat?". It also
helps you plan: what to prepare for a session, the expectations talk with your players and session
0 ([Prep and expectations](prep-and-expectations.md)). It works on the free Claude plan.

The coach is a helper that knows the pages. It cannot see or change your game. When you want Claude
to look at your characters, plan a change or prepare notes, that is an ordinary Claude Desktop chat
with the Foundry connectors switched on ([Asking Claude](asking-claude.md)). Guarded changes
(damage, conditions, token moves and similar) are planned first, shown to you, applied after your
yes and kept in Recent Changes with an Undo. Some of Claude's other tools act at once and cannot be
undone. The coach can explain both.

It knows every page of these guides, so you can also ask it about the dashboard, the GM windows,
the feature switches, the checklists before and after a session, the game night runbook and the
TV at the table. On game night it gives you the runbook steps first.

It answers from its pages first and says so. When the pages don't cover something, it may answer
from general knowledge but tells you, because many guides online describe older Foundry versions.
It never searches the web, and it has no book or campaign text.

## Add it (once, about 5 minutes)

You need the file `foundry-gm-coach.zip` from the tool admin.

<!-- wiki:coach-download -->

1. In Claude (the desktop app or claude.ai), open **Settings**, **Capabilities**, and switch on
   **Code execution and file creation**. Skills need it.
2. Open **Customize**, **Skills**.
3. Add a skill and upload `foundry-gm-coach.zip`. Don't unpack it first.
4. Make sure the skill is switched on in the list.

## Ask it

Start a new chat and ask normally. Claude picks the skill by itself when the question is about
Foundry; to be sure, start with "GM coach:".

- "GM coach: a player can't see the map, what do I check?"
- "GM coach: how do I give the players a handout?"
- "GM coach: walk me through starting a combat and rolling initiative."
- "GM coach: what do I check in the 15 minutes before we play?"
- "GM coach: Claude says a tool set is off. Where do I switch it on?"
- "GM coach: the dashboard lost its connection in the middle of a fight. What now?"
- "GM coach: help me plan session 0. Ask me questions first."

When you plan with it, it asks a few questions and suggests options; the choices are yours. You can
ask in Danish.

Check its answer against the screen. If it names a button you can't find, say so: it then tells
you whether that part was checked in a live game.

## If skills don't work on your account: a Claude Project

A Project is a chat space with your own files. It works too, but it loads all its files into every
message, so on the free plan it uses up your limit much faster. Upload only the pages you need.

1. Unpack `foundry-gm-coach.zip`.
2. In Claude, **Projects**, create a project called "Foundry GM coach".
3. Open `SKILL.md` in Notepad, copy everything below the second `---` line, and paste it into the
   project's instructions.
4. Upload two or three pages from the `references` folder as project knowledge, for example
   `references/foundry/in-world-layout.md`, `references/foundry/combat-tracker.md` and
   `references/gm/game-night-runbook.md`. Change them when your questions change.

## Keeping it current

The tool admin builds a new zip when the pages change (`npm run gm-coach`). The pages inside the
zip are a copy from the day it was built, so a feature added later is not in them. If the coach
describes a button that is not there, or doesn't know a new one, ask the tool admin for a fresh zip.
To update, remove the old skill and upload the new zip.
