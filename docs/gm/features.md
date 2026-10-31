---
title: Features and when to turn them on
description: The feature switches of Foundry AI Tool you use at the table, what each does, and the moment to turn it on.
---

# Features and when to turn them on

The tool starts small. A few features are on from the start; the rest are off until you need them,
so a new world never does more than you expect. This page lists each one: what it does, whether it
starts on, and **when to turn it on**.

Most switches are Foundry settings: the **Settings** tab (the gear icon in the sidebar), **Game
Settings**, category **Foundry AI Tool**. Tick or untick, then **Save Changes**. They stop the
dashboard's changes as well as Claude's.

"AI Tool" names three things, so here is which is which. The **module** is the add-on inside
Foundry (Module Management lists it as **Foundry AI Tool**); every switch on this page is one of
its settings, and nearly all of them are named "AI Tool: ..." (Allow Write Operations is the
exception). The **dashboard** is the web page next to Foundry that
you open in another tab. The **GM windows** are small windows inside Foundry; they have their own
switch, "AI Tool: GM windows", which is off until you turn it on (see
[The GM windows](gm-windows.md)). The module's switches are all in one place: scroll to the heading
**Foundry AI Tool** in Game Settings.

**Turn on for tonight** (the Pre-flight panel in the dashboard's Before view) turns on, in one click,
what an evening at the table needs: Allow Write Operations, Handouts, Live play, Party, Tarokka and
GM Actions. **End session** turns off again what it turned on. See
[Turn on for tonight](dashboard.md#turn-on-for-tonight).

## Allow Write Operations

- **What it does:** the tool's master switch. Off, the tool only reads: nothing changes in
  Foundry, from Claude or from the dashboard, and there is no Undo.
- **Starts:** on.
- **Turn it off when:** you want the tool to watch only, for example while you show a new player
  around. Turn on for tonight turns it back on.

## Live play

- **What it does:** damage, healing, temporary hit points, conditions and resources (spell slots,
  class resources, item uses) on one or several creatures, worked out by dnd5e with resistances;
  moving, changing or deleting tokens; and scene dressing (area templates, darkness and light, map
  notes, loot for a character). From the dashboard's turn-order strip or by asking Claude. Every
  change can be undone in Recent Changes.
- **Starts:** on. Setting "AI Tool: Live play (writes)".
- **Turn it on when:** it is on already. Leave it on.
- **More:** [Combat Tracker](dashboard.md#combat-tracker).

## Live play without confirming

- **What it does:** damage, healing, conditions and resources that **Claude** plans apply at once,
  without the confirm window. Each one still shows an Undo and is listed in Recent Changes. It
  does not change the dashboard's own buttons: Condition always shows the confirm window, and
  Damage / Heal applies at once from its small form, with Undo.
- **Starts:** off. Setting "AI Tool: Live play, apply without confirming".
- **Turn it on when:** you let Claude handle damage in long fights and confirming every hit gets
  tiring. Leave it off while you are still getting to know what Claude does.
- **More:** [Asking Claude](asking-claude.md#feature-switches).

## Handouts

- **What it does:** reveals or hides journal pages for the players, queues pages to reveal one
  after another, and shows who has seen each one.
- **Starts:** off. Setting "AI Tool: Handouts (writes)". Turn on for tonight turns it on.
- **Turn it on when:** before the first session with a handout (a letter, a map, a picture).
- **More:** [The handout drawer](dashboard.md#the-handout-drawer--handouts).

## Party

- **What it does:** the party panel: the party's travel pace, placing the party's tokens on the
  scene you are looking at, adding the party to combat, and a rest request every player can
  answer from their own character.
- **Starts:** off. Setting "AI Tool: Party (writes)". Turn on for tonight turns it on.
- **Turn it on when:** the party travels or rests for the first time. It needs a Group actor set
  as the primary party in Foundry.
- **More:** [The party drawer](dashboard.md#the-party-drawer--party).

## Who would notice

- **What it does:** adds a row to the party drawer. Type a DC and every character shows a chip for
  passive Perception, Investigation and Insight, with a tick or a cross. It only reads: nothing is
  rolled and players never see it.
- **Starts:** off. Setting "AI Tool: Who would notice". It is not part of Turn on for tonight.
- **Turn it on when:** you want to know who spots something hidden without asking for rolls.
- **More:** [The party drawer](dashboard.md#the-party-drawer--party).

## Tarokka

- **What it does:** saves a card reading, links cards to journals, and publishes reveal pages to
  the players.
- **Starts:** off. Setting "AI Tool: Tarokka (writes)". Turn on for tonight turns it on.
- **Turn it on when:** before the first card reading.
- **At the table:** in Foundry, **AI Tool** in the left toolbar has a **Tarokka table** button
  (GM only). **Place** puts the next card face down, **Flip** turns one over, **Show to players**
  opens the table on every player's screen, **Stop showing** closes it. The players see the backs
  of the cards you placed and the faces of the ones you flipped, nothing else (no position names,
  no notes). **Picture** gives a card a picture from the world's files. A flip is a reveal: it
  needs this switch on, and it also marks the card revealed in the drawer and puts a page for
  the players in the reveal journal. The table needs the reading to exist first (dealt or chosen in
  the drawer, or by Claude), and the bridge to be connected.
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

## Obsidian import

- **What it does:** turns a quest note from your `Prep` folder in Obsidian into a GM-only quest
  journal in Foundry, after you confirm the plan. The note needs `type: quest-prep` and an empty
  `fvtt_uuid`. Its stakes and text are copied; the `secret` and `ai_context` properties never are, and a note with `ai_context: false` is refused (a journal in Foundry is not kept from Claude). The journal is
  GM-only until you reveal it, and **Undo** in Recent Changes removes it. Importing the same note
  again is refused until you undo the first import or delete the journal.
- **Starts:** off. Setting "AI Tool: Obsidian import (writes)".
- **Turn it on when:** you wrote a quest in Obsidian and want it in Foundry. In Obsidian run
  "Import this quest prep note into Foundry" and confirm the plan in the dashboard.
- **More:** [Open in Obsidian](dashboard.md#open-in-obsidian-).

## Session notes

- **What it does:** after a recorded session, the tool writes the notes (a Recap for the players,
  a GM summary and the scenes) and **puts them into Foundry by itself, without asking**: a GM-only
  journal "Session notes", one entry per session. The change is logged in Recent Changes with
  **Undo**. The Recap also lands in the Handouts queue, so the players see it only when you reveal
  it. The dashboard's **After** view shows where the notes are, with **Read**, **Approve without
  revealing** and **Undo**.
- **Starts:** off. Setting "AI Tool: Session notes (writes)". Turn on for tonight does not turn it
  on, because the notes arrive after the session.
- **Turn it on when:** you record your sessions and want the notes in Foundry without doing
  anything. While it is off, the notes wait and go in by themselves once you turn it on.
- **More:** [Session notes (After)](dashboard.md#session-notes-after).

## Boss prompts

- **What it does:** in the turn-order strip, legendary action and resistance pips, a lair action
  reminder and reaction marks for the creatures in the fight. Nothing changes in Foundry.
- **Starts:** off. A switch in the dashboard's Combat Tracker, remembered in this browser.
- **Turn it on when:** before the first boss fight.
- **More:** [Combat Tracker](dashboard.md#combat-tracker).

## Themed dice

- **What it does:** with the module **Dice So Nice** installed and enabled, two dice colour sets
  match the dashboard's themes: **AI Tool: The Veil** (smoky grey-green glass with drifting mist, the
  numbers in lamp gold) and **AI Tool: Neutral** (deep navy with blue-white numbers). Only the
  look of the 3D dice changes; rolls and the play log stay the same.
- **Starts:** the sets are there as soon as Dice So Nice is; nobody uses them until they pick them.
- **Turn it on when:** before session 1. To make one the table's default, open **Game Settings**,
  **Dice So Nice**, click **Configure Dice Roles**, and in the **Basic** row
  pick **AI Tool: The Veil** (or **AI Tool: Neutral**) in the **Theme** column. Each player can
  still choose their own dice under **3D Dice Settings**.
- **More:** the [before-session checklist](before-session.md#turn-on-what-tonight-needs).

## GM windows

- **What it does:** adds Combat, Party, Session, Scene and Loot buttons to the AI Tool group in the scene
  controls (GM only). Each opens a small window next to the map, so you can run a scene from one
  screen without the dashboard tab. Only the Combat turn buttons and the Session start and end
  change anything, and nothing here asks Claude.
- **Starts:** on (a world where the settings were saved earlier may have it off). Setting "AI Tool: GM windows".
- **Turn it off when:** you do not want the extra buttons in the scene controls.
- **More:** [The GM windows](gm-windows.md).

## GM Actions

- **What it does:** the dashboard's own switch for changing the game from the dashboard. It does
  not stop Claude.
- **Starts:** off every time the dashboard starts. Turn on for tonight turns it on, End session turns
  it off.
- **Turn it on when:** you act from the dashboard. Turn on for tonight does it for you.
- **More:** [GM Actions](dashboard.md#live-play-on-all-set).

## The other switches

These sit in the same category in Game Settings. Except the last one, a change they allow is made
only after you confirm a plan, and it shows in Recent Changes with Undo.
[Asking Claude](asking-claude.md#feature-switches) lists them with the others.

- **Table viewer** ("AI Tool: Table viewer (writes)"): lets Claude create the **Table** player that
  the TV at the table signs in as. Starts on. You use it once; see
  [The TV at the table](tv-table-viewer.md).
- **Undo for everything** ("AI Tool: Undo for everything"): lets the tool undo and redo anyone's
  changes (players', yours and Claude's) from the Changes list, one change or everything since on
  the same thing. Starts on.
- **Scene mood and music** ("AI Tool: Scene mood and music (writes)"): a scene's darkness, light and
  weather, saved mood presets, and starting, stopping or switching playlists. Starts off. Turn it
  on when you want Claude to set the mood of a scene.
- **NPC turn assistant** ("AI Tool: NPC turn assistant (writes)"): moves a monster on its turn and
  takes hit points off the creatures it hits. The attacks and saves are rolled first, separately.
  Starts off. Turn it on when you want Claude to help run a monster's turn.
- **Room setup** ("AI Tool: Room setup (writes)"): adds teleport regions and fills a room with
  tokens. Starts off. Turn it on while you prepare a map.
- **Scene restore** ("AI Tool: Scene restore (writes)"): puts a scene's walls, lights, tiles and
  tokens back from a backup copy of the world. Starts off. Turn it on when a map was broken by hand.
- **Paper sync** ("AI Tool: Paper sync (writes)"): writes the numbers from a paper sheet back into
  a character after a night played on paper. XP, level and class are never changed. Starts off.
  Turn it on after a paper night.
- **Rules check** ("AI Tool: Rules check"): lets Claude say whether an attack, spell or item looks
  legal right now and why. It only reads and changes nothing. Starts off.
