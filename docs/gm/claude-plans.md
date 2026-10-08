---
title: Claude Free or Pro
description: What works with the free Claude plan and what Claude Pro adds for running a game with Foundry AI Tool, with sources and dates.
---

# Claude Free or Pro

You can run the game with the free Claude plan. This page says what works on Free, where you will
notice its limits, and what Pro adds, so you can decide later whether Pro is worth it for you.

Checked on 2026-10-08 on Anthropic's own pages (listed at the bottom). Plans change; if something
here looks wrong, check those pages.

## What works on Free

| What                                                                    | On Free                                                                                   |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| The Claude Desktop app                                                  | Yes.                                                                                      |
| Asking Claude about rules, prep and your notes                          | Yes.                                                                                      |
| Claude reading and changing the game (the tool's connection to Foundry) | Expected to work, still to be confirmed on your PC (see [Not clear yet](#not-clear-yet)). |
| Skills, including the **Foundry GM coach** skill made for you           | Yes. You add your own skills under **Customize**, **Skills**.                             |
| Projects (a chat space with your own files and instructions)            | Up to 5.                                                                                  |
| Models                                                                  | Sonnet and Haiku. Not Opus.                                                               |
| Claude Code (the developer tool)                                        | No. You don't need it: the session notes are made on the tool admin's PC.                 |

For skills, one setting must be on: **Settings**, **Capabilities**, **Code execution and file
creation**. If you don't see a way to upload a skill, check that first.

## Where you will notice the limit

- **A limit per five hours.** Free has a usage limit that resets every five hours. Anthropic gives
  no fixed number of messages: long chats, files and tools use it up faster. When you reach it,
  Claude says so and tells you when it resets. On Free you can't buy extra usage.
- **Tools are expensive.** Every tool set that is switched on costs usage in every message, even
  when Claude doesn't use it. On game night switch on only the sets you need (core and play), and
  switch off the rest in the **Search and tools** menu. See
  [Asking Claude](asking-claude.md#tool-sets-which-switches-to-turn-on).
- **Start new chats.** A long chat costs more with every message. Start a new chat for each prep
  task and for each game night.
- **The limit is shared.** Claude on the web, the desktop app and the phone all count toward the
  same limit.

So on Free, plan to prep with Claude between sessions and use it lightly at the table. If a game
night runs out, play on without it: everything can be done by hand in Foundry
([Game night runbook](game-night-runbook.md)).

## What Pro adds

| What                  | Pro                                                                   |
| --------------------- | --------------------------------------------------------------------- |
| Usage                 | At least five times the Free usage per five-hour session.             |
| Running out           | You can turn on paid usage credits to keep going after the limit.     |
| Models                | Opus as well, the strongest model, for hard prep and rules questions. |
| Projects              | No limit of five.                                                     |
| Research, Claude Code | Included. Not needed for this tool.                                   |
| Price                 | 20 USD a month, or 200 USD a year (prices in other currencies vary).  |

Skills, connectors, the desktop app and memory are the same on both plans.

**When Pro is worth it:** when you hit the limit during prep or on game night more than now and
then, or when you want Claude at the table for the whole evening. Try Free first.

## Not clear yet

- **The tool's connection on Free.** Claude Desktop connects to the game through a local program
  (a local MCP server). Anthropic lists desktop extensions as included on Free, but its help pages
  don't say per plan whether servers set up in Claude Desktop's configuration file work. It has
  worked on Free before. We will test it on your PC before session 0.
- **The exact limit.** Anthropic doesn't publish numbers for Free; it depends on how much each chat
  uses.

## Sources

- Plans and prices: <https://claude.com/pricing>
- Skills: <https://support.claude.com/en/articles/12512180-use-skills-in-claude>
- Projects: <https://support.claude.com/en/articles/9517075-what-are-projects>
- Usage limits: <https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work>
- Local MCP servers in Claude Desktop:
  <https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop>
- Custom connectors (remote, by web address; Free gets one, the tool doesn't use them):
  <https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp>
