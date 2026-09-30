---
title: Player guide
description: What players see, what the tool records during play, which parts reach an AI, and how to have your data removed.
---

# Player guide

Hi! Your GM uses Foundry AI Tool next to Foundry. For you, Foundry works exactly as usual. This
page explains the extra bits: what you can see, what gets recorded, and what an AI reads. Short
how-tos are in the [player cookbook](cookbook.md).

## What you see

**The player page.** A read-only web page. It is not available to you yet: today it only opens on
the GM's own PC, and it comes to your computer once the table's home server (an Orange Pi) is set
up. It has three parts:

- **Combat order:** who acts when, the current turn, and the round. Player characters have an HP
  bar. Monsters and NPCs show no HP numbers, only standard conditions (like prone or frightened),
  and appear under the name you know them by, or as "Unknown creature".
- **Session feed:** public rolls and what your characters could see happen, for example "Mira
  took 7 damage." or "Wolf 1 was hit." Private, blind and GM rolls never show here, and neither
  does anything about a creature whose name you cannot see.
- **Handouts:** journal pages the GM revealed to you, such as a letter or a map note.

The page is built only from what players are allowed to see. Hidden creatures, true names you have
not learned, enemy HP, GM notes and secrets never reach it.

**Handouts in Foundry.** When the GM reveals a handout, you can also open that page in Foundry's
Journal tab.

## What the tool records during play

While you play, the tool keeps a **play log** on the GM's side. Entries carry the Foundry user name
of whoever caused them, when Foundry says who. It records:

- dice rolls, with the dice and bonuses;
- HP changes (and which roll caused them, when it can tell), temporary HP and death saves;
- spells, features and items used, spell slots, resources, hit dice, and items gained or lost;
- conditions and effects;
- short and long rests;
- combat: start, turns and end;
- token moves, scene changes, XP, level and currency;
- who joined and left the game;
- chat messages with their text, including in-character, out-of-character and whispers.

The GM uses it for session notes and stats (for example damage dealt and healing received per
character). The play log stays on the machine that runs the tool; the session notes and stats made
from it are in the GM's Obsidian notes. None of it is stored in the Foundry world.

## Which parts reach an AI

- **Claude, when the GM asks.** The GM talks to Claude (an AI by Anthropic) in the Claude Desktop
  app. Claude then reads what it needs from the game through the tool: character sheets, chat,
  the session log or the play stats. That goes to Anthropic under the GM's Claude account. Nothing
  is sent when nobody asks.
- **Dashboard commentary, only if an API key is set.** The GM's dashboard can comment on the game
  by itself, but only with a separate paid API key. Then recent game events and the combat state go
  to Anthropic automatically. It is off unless the GM turns it on.
- **Voice transcription, later.** Planned, not built. It would run locally on the table's own
  machine, not in the cloud. This page will be updated before it is used.

## How long it is kept

For the campaign. When the campaign ends, the GM decides what to keep.

## Having your data removed

Ask the GM at any time, for example for the chat you wrote or everything recorded under your user
name. One command removes it from the play log, and the GM then rebuilds the session notes without
it. What Claude already read when the GM asked it something has gone to Anthropic and cannot be
pulled back by the GM.
