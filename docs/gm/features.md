---
title: Features and when to turn them on
description: Every feature switch of Foundry AI Tool, what it does, and the moment to turn it on.
---

# Features and when to turn them on

The tool starts small. A few features are on from the start; the rest are off until you need them,
so a new world never does more than you expect. This page lists each one: what it does, whether it
starts on, and **when to turn it on**. The dashboard shows the same list as cards in the **Before**
view, each with a link back here.

Most switches are Foundry settings: **Game Settings** (the gear icon in the sidebar), **Configure
Settings**, category **Foundry AI Tool**. Tick or untick, then **Save Changes**. They stop the
dashboard's changes as well as Claude's.

**Ready for session** (the Pre-flight panel in the dashboard's Before view) turns on, in one click,
what an evening at the table needs: Allow Write Operations, Handouts, Live play, Party, Tarokka and
GM Actions. **End session** turns off again what it turned on. See
[Ready for session](dashboard.md#ready-for-session).

## Allow Write Operations

- **What it does:** the tool's master switch. Off, the tool only reads: nothing changes in
  Foundry, from Claude or from the dashboard, and there is no Undo.
- **Starts:** on.
- **Turn it off when:** you want the tool to watch only, for example while you show a new player
  around. Ready for session turns it back on.

## Live play

- **What it does:** damage, healing, temporary hit points, conditions and resources (spell slots,
  class resources, item uses) on one or several creatures, worked out by dnd5e with resistances;
  moving, changing or deleting tokens. From the dashboard's turn-order strip or by asking Claude.
  Every change can be undone in Recent Changes.
- **Starts:** on. Setting "AI Tool: Live play (writes)".
- **Turn it on when:** it is on already. Leave it on.
- **More:** [Combat Tracker](dashboard.md#combat-tracker).

## Live play without confirming

- **What it does:** damage, healing, conditions and resources that **Claude** plans apply at once,
  without the confirm window. Each one still shows an Undo and is listed in Recent Changes. Your
  own clicks on the dashboard apply at once anyway.
- **Starts:** off. Setting "AI Tool: Live play, apply without confirming".
- **Turn it on when:** you let Claude handle damage in long fights and confirming every hit gets
  tiring. Leave it off while you are still getting to know what Claude does.
- **More:** [Asking Claude](asking-claude.md#feature-switches).

## Handouts

- **What it does:** reveals or hides journal pages for the players, queues pages to reveal one
  after another, and shows who has seen each one.
- **Starts:** off. Setting "AI Tool: Handouts (writes)". Ready for session turns it on.
- **Turn it on when:** before the first session with a handout (a letter, a map, a picture).
- **More:** [The handout drawer](dashboard.md#the-handout-drawer--handouts).

## Party

- **What it does:** the party panel: the party's travel pace, adding the party to combat, and a
  rest request every player can answer from their own character.
- **Starts:** off. Setting "AI Tool: Party (writes)". Ready for session turns it on.
- **Turn it on when:** the party travels or rests for the first time. It needs a Group actor set
  as the primary party in Foundry.
- **More:** [The party drawer](dashboard.md#the-party-drawer--party).

## Tarokka

- **What it does:** saves a card reading, links cards to journals, and publishes reveal pages to
  the players.
- **Starts:** off. Setting "AI Tool: Tarokka (writes)". Ready for session turns it on.
- **Turn it on when:** before the first card reading.
- **More:** [The Tarokka drawer](dashboard.md#the-tarokka-drawer--tarokka).

## Ownership

- **What it does:** changes which players own or can see an actor.
- **Starts:** on. Setting "AI Tool: Ownership (writes)".
- **Turn it on when:** it is on already. You use it when a player gets a new character, a
  familiar or a hireling.
- **More:** [When a character dies](death-and-new-characters.md).

## Obsidian mirror

- **What it does:** lets the tool change which Foundry documents it mirrors into your Obsidian
  vault (the mirror settings). The session notes and stats are written either way.
- **Starts:** off. Setting "AI Tool: Obsidian mirror (writes)".
- **Turn it on when:** you want actors, scenes or journals from Foundry as notes in Obsidian, and
  ask Claude to set that up.
- **More:** [Open in Obsidian](dashboard.md#open-in-obsidian-).

## Boss prompts

- **What it does:** in the turn-order strip, legendary action and resistance pips, a lair action
  reminder and reaction marks for the creatures in the fight. Nothing changes in Foundry.
- **Starts:** off. A switch in the dashboard's Combat Tracker, remembered in this browser.
- **Turn it on when:** before the first boss fight.
- **More:** [Combat Tracker](dashboard.md#combat-tracker).

## GM Actions

- **What it does:** the dashboard's own switch for changing the game from the dashboard. It does
  not stop Claude.
- **Starts:** off every time the dashboard starts. Ready for session turns it on, End session turns
  it off.
- **Turn it on when:** you act from the dashboard. Ready for session does it for you.
- **More:** [GM Actions](dashboard.md#-gm-actions-off--on).
