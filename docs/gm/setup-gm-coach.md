---
title: 'One-time setup: the GM coach'
description: Add the Foundry GM coach skill to your own Claude account, with the Claude Project fallback. About 5 minutes, once.
---

# One-time setup: the GM coach

The GM coach is a skill in your own Claude account that answers questions about Foundry and this
tool. It works on the free Claude plan. What it can do and how to ask it is in
[Your GM coach in Claude](gm-coach.md). About 5 minutes, once.

**You need:** a Claude account (the desktop app or claude.ai) and the file `foundry-gm-coach.zip`
from the person who built the tool.

<!-- wiki:coach-download -->

## Add it

1. In Claude open **Settings**, **Capabilities**, and switch on **Code execution and file creation**.
   Skills need it.
2. Open **Customize**, then **Skills**.
3. Add a skill and upload `foundry-gm-coach.zip`. Do not unpack it first.
4. Make sure the skill is switched on in the list.

## Done when it looks like this

Start a new chat and type: _GM coach: how do I start combat?_ Claude answers with Foundry steps and
says it is using the GM coach pages.

## If it does not work

- **There is no Skills page, or the upload is refused:** your account may not have skills. Use the
  Project fallback below.
- **Claude answers from general knowledge and does not mention the coach:** check that the skill is
  switched on, then start the question with "GM coach:".
- **It describes a button you cannot find:** the zip is older than the feature. Ask the person who
  built the tool for a fresh zip, remove the old skill and upload the new one.

## Fallback: a Claude Project

A Project loads all its files into every message, so on the free plan it uses your limit faster.
Upload only a few pages.

1. Unpack `foundry-gm-coach.zip`.
2. In Claude open **Projects** and create a project called "Foundry GM coach".
3. Open `SKILL.md` in Notepad, copy everything below the second `---` line and paste it into the
   project's instructions.
4. Upload two or three pages from the `references` folder as project knowledge, for example
   `references/foundry/in-world-layout.md`, `references/foundry/combat-tracker.md` and
   `references/gm/game-night-runbook.md`.
