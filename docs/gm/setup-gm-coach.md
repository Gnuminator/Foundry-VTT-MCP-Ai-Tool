---
title: 'One-time setup: the GM coach'
description: Add the Foundry GM coach skill to your own Claude account, with the Claude Project fallback. About 5 minutes, once.
---

# One-time setup: the GM coach

The GM coach is a skill in your own Claude account that answers questions about Foundry and this
tool. It works on the free Claude plan. What it can do and how to ask it is in
[Your GM coach in Claude](gm-coach.md). About 5 minutes, once.

**You need:** a Claude account (the desktop app or claude.ai) with the Foundry connector switched
on in your chats (added with the Windows client or [by web address](connect-claude-web.md)). On a Pro or Max plan you add the coach as a plugin (first section below). On a
free plan you use the file `foundry-gm-coach.zip` from the person who built the tool.

<!-- wiki:coach-download -->

## Add it as a plugin (Pro and Max)

1. In Claude Desktop open **Settings**, then **Plugins**. The filters at the top are **All**,
   **Connectors** and **Skills**.
2. Click the **Add** menu next to **Search** and add a marketplace: enter
   `Gnuminator/foundry-ai-tool-plugins`. (Under **Find more plugins** there is also a **Plugins**
   link that does the same.)
3. Under **Discover** the marketplace shows three cards: **Foundry dnd helper**, **Foundry gm
   coach** and **Foundry player helper**. Install **Foundry gm coach**.
4. If you uploaded the coach as a zip earlier (it shows as **By you** under **Skills**), remove that
   copy now, so Claude does not have the coach twice.
5. Start a new chat. Later changes to the coach reach new chats by themselves; you do not update
   anything.

## Add it from the zip (free plan)

1. In Claude open **Settings**, **Capabilities**, and switch on **Code execution and file creation**.
   Skills need it.
2. Open **Settings**, then **Plugins**, and pick the **Skills** filter.
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

## Optional: the D&D helper skill

The D&D helper builds characters, advises level-ups and answers rules questions from the books in
Foundry. It only reads; you change the game by clicking in Foundry. It works through the same
Foundry connector as the coach.

- **Pro and Max (plugin):** in the same marketplace, `Gnuminator/foundry-ai-tool-plugins`, install
  **Foundry dnd helper** (under **Discover**) next to the coach. Remove an earlier zip copy
  (**By you**) first. Start a new chat. Later changes reach new chats by themselves.
- **Free plan (zip):** under **Settings**, **Plugins**, **Skills**, add a skill and upload
  `foundry-dnd-helper.zip` from the person who built the tool. Do not unpack it first.

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
