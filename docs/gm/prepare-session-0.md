---
title: Prepare session 0
description: The world setup before players make their characters at session 0, a check run as a player, and what to do on the night.
---

# Prepare session 0

At session 0 each player makes a level-1 character in Foundry from home, with the builder
**Actor Studio** (the player side is in [Make your character](../player/make-a-character.md)).
Out of the box players can't do that: they may not create characters, and Actor Studio reads the
older free rules instead of the 2024 Player's Handbook. This page fixes both, once, a week or so
before session 0. It takes about 30 minutes.

All of it is normal Foundry settings, done as Gamemaster in your browser. Nothing here needs the
command line or Claude.

## 1. One user per player

1. Press **Esc** and choose **User Management** (or Settings tab, **User Management**).
2. For each player, click **Create Additional User**, type their name in **User Name**, a
   password in **Password**, and keep the role **Player**.
3. Click **Save and Return**.

Send each player their user name and password privately (a Discord direct message), with the link
to [Join the game](../player/join.md).

## 2. Let players create characters

1. Settings tab, **Game Settings**, category **Core**, the **User Permissions** button.
2. In the row **Create Actors**, tick the **Player** column.
3. Click **Save Configuration**.

Without this, Actor Studio tells a player "User requires the 'Create New Actors' permission".

## 3. Point Actor Studio at the 2024 Player's Handbook

Settings tab, **Game Settings**, the **Actor Studio** category.

1. **Compendium Sources**, **Select sources**. Tick only the packs of the Player's Handbook module:

   | Row                                           | Tick                              |
   | --------------------------------------------- | --------------------------------- |
   | Species Compendia, Species Features Compendia | Character Origins (PHB)           |
   | Background Compendia                          | Character Origins (PHB)           |
   | Class Compendia, Subclass Compendia           | Character Classes (PHB)           |
   | Spell Compendia                               | Spells (PHB)                      |
   | Feat Compendia                                | Feats and Character Origins (PHB) |
   | Equipment Compendia                           | Equipment (PHB)                   |

   Untick the D&D 5e system's own packs (the older free rules), or every list shows each choice
   twice. Click **Save**.

2. **Configure ability scores**: tick the methods you allow (**Allow standard array**, **Allow
   point buy**, **Allow rolling**, **Allow manual input**). Manual input lets a player type any
   number; leave it off unless you want that.
3. **Configure equipment & gold**: tick **Enable Equipment Selection**.
4. **Configure spells**: tick **Enable Spell Selection**.

Leave usage tracking off: our copy of Actor Studio has it off for everyone.

If you allow options beyond the Player's Handbook (for example older species in our own content
module), tick those packs too and tell the players.

## 4. Try it as a player

Make one character yourself as a player, so you know what they see and it works before the night.

1. In User Management, make a user called **Test Player** (role Player).
2. Open the game in a private browser window and log in as Test Player.
3. Follow [Make your character](../player/make-a-character.md) to the end.
4. As GM, look at the character's sheet with the checklist in step 10 of that page, then delete
   the character and the Test Player user.

## On the night

- Post the link to [Make your character](../player/make-a-character.md) in Discord, plus your
  answers: which ability score method, which options are allowed, anything about the campaign.
- Players build at the same time; it takes them about 45 minutes. Stay in voice for questions.
- When a player says they are done, open their sheet and go through the checklist in step 10 with
  them. The most common miss: a choice skipped with **Next** (a missing skill or spell). Fix it by
  hand, or delete the character and let them redo it.
- Check each player picked their character in **User Configuration** (the Players list shows
  `Name [Character]`).
- Add portraits: players can't upload pictures, so they send them to you. Open the sheet, click
  the portrait and pick the image.

## Afterwards

You can untick **Create Actors** for players again; nobody needs it until a character dies. When
one does, see [When a character dies](death-and-new-characters.md).
