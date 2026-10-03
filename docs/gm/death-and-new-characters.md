---
title: When a character dies
description: What to do when a player character dies, how to keep a record of the fallen, and how to bring in a new character, with what the tool can and cannot do for each step.
---

# When a character dies

Curse of Strahd kills characters. Plan for it before session 1, so a death at the table takes five
minutes and not the rest of the evening. This page covers the moment itself, a record of the
fallen, and bringing in a new character.

The short version:

1. Mark the character dead in Foundry. Keep the actor; do not delete it.
2. Let the player keep watching the old sheet (Observer).
3. Write a line in your death log.
4. Bring in the new character: ownership, user, party, token, one handout.

## Before session 1: two things to set up

- **A "Next characters" journal (GM only).** Ask every player in session 0 for a backup idea: a
  name, a class and one sentence of who they are. Write each one down with a hook that brings them
  into Barovia or into the group (see [Hooks for a new character](#hooks-for-a-new-character)). A
  death then costs the player a short build, not a long evening of ideas.
- **A "Fallen" journal (GM only).** One page per dead character; see
  [The death log](#the-death-log).

Make both in Foundry's **Journal** tab and leave their ownership at None for players. GM-only
journals also show up in your GM Obsidian vault when the mirror is on.

## What the tool sees, and what it does not

The tool follows hit points, not life and death:

- **Dropping to 0 HP** is logged ("Kasimir dropped to 0 HP") and shows in the dashboard's
  **Live Feed** and on the players' page. Getting back above 0 is logged too ("is back up").
- **Death saving throws** show in the **Combat Tracker** and in the **🛡 Party** drawer while a
  character is at 0 HP ("Death saves: 1 saved, 2 failed"). They are recorded in the play log.
- **Death itself is not detected.** Three failed death saves, massive damage or a disintegrate
  look the same to the tool as any other 0 HP. Whether a character is dead is your call, and you
  mark it (next section).
- **"Deaths" in the 📋 Prep drawer means "dropped to 0 HP" last session.** It lists monsters too,
  and characters who got back up. Read it as "who went down", not "who died".
- **Nothing is deleted by the tool.** No tool deletes an actor.

## At the table: the moment of death

1. **Make the call.** Check the death saves on the sheet or in the Combat Tracker. The rules call
   is yours; Claude can look up the rule ("What happens on a third failed death save? Use only my
   books.") but does not decide.
2. **Mark the character dead.** In a fight, click the skull (**Mark Defeated**) on the character's
   row in the **Combat Tracker**: it dims the row and puts the **Dead** status on the character.
   Outside a fight, right-click the token and pick **Dead** among the status icons. With the **play**
   set on in Claude Desktop you can also say: "Mark Kasimir as dead, go ahead." (`plan-actor-change`,
   a condition change; **Undo** in **Recent Changes** takes it back if you were too quick).
3. **Keep playing the scene.** The player stays at the table; let them voice an ally or an NPC for
   the rest of the fight if they like. Foundry skips defeated rows only when **Skip Defeated** is on
   in the Combat Tracker's settings; otherwise click past the turn.
4. **Leave the token** until the scene ends. The body may matter (looting, a burial, a resurrection
   attempt).

Do not delete the actor. The play stats, the session notes in Obsidian and the death log all point
at it, and a later resurrection needs the sheet as it was.

## After the session: tidy up

- **Move the actor** into a folder called "Fallen" in the **Actors** tab, so it is out of the way
  but kept.
- **Change the player's access to Observer**, so they can still read the old sheet but not change
  it. Right-click the actor in the **Actors** tab, **Configure Ownership**, set the player to
  Observer. Or, with the **admin** set on in Claude Desktop: "Set Anna to Observer on Kasimir."
  (`plan-ownership-change`; you confirm, and **Undo** in **Recent Changes** takes it back). "Who
  owns Kasimir?" shows the current access (`list-actor-ownership`). Ownership changes need the
  switch "AI Tool: Ownership (writes)" on (Game Settings, category **Foundry AI Tool**; on by
  default).
- **Items the party takes from the body** move by hand, from sheet to sheet.

## The death log

One page per fallen character in your "Fallen" journal. Keep it short:

- **Who:** name, class and level, the player's name.
- **When and where:** session number, date, the scene.
- **How:** what killed them, in one or two lines.
- **Last words or last act**, if there was one.
- **What was left behind:** items, unfinished business, who mourns them.

Claude can draft it from the session log. With **prep** on: "Write a short death log entry for
Kasimir from last session: how he went down, who was there, what he carried. Plain text I can
paste." Read it, fix it, and paste it into the journal page yourself. The players never see this
journal unless you reveal a page.

## Bringing in the new character

Do this between sessions if you can; at the table it takes about five minutes once the character
is built.

1. **The player builds the character** the same way the table built the others, at the level you
   choose (usually the party's level). The tool has no character builder; its NPC tools make
   monsters and NPCs, not player characters.
2. **Give the player ownership.** Right-click the new actor in the **Actors** tab, **Configure
   Ownership**, set the player to Owner. Or, with **admin** on: "Make Anna the owner of Vasil." (`plan-ownership-change`).
3. **Make it the player's character.** In the **Players** list (bottom left), right-click the
   player, **User Configuration**, and pick the new character. The tool does not do this step.
4. **Add it to the party.** Open the party's group actor (the sheet called "The Party" or what you
   named it) and drag the new actor onto it. The tool cannot add or remove party members; once the
   character is in the group, the **🛡 Party** drawer and `get-party` include it.
5. **Place the token.** Drag the actor from the **Actors** tab onto the scene. To move it after that,
   "Move Vasil next to Kasimir's token, go ahead." works with **play** on (`plan-token-change`).
6. **Give the player one handout.** A short page for the new character: what they know about the
   party and Barovia, why they are here, one thing they want. Write it as a page in your handouts
   journal and reveal it to that player only: "Reveal the page 'Vasil' in 'Handouts' to Anna."
   (`plan-page-reveal`, prep set). Keep secrets out of it; the player reads every word.

## Hooks for a new character

Barovia is closed to the outside world, so a new character has to come from inside it or arrive
the way the party did. Hooks that fit (write your own version into the "Next characters" journal):

- **A local** from the nearest village who has a reason to join: a debt, a missing relative, a
  grudge against the castle.
- **Another traveller** caught by the mists, found lost on the road or hiding in a ruin.
- **A prisoner** the party frees, or a captive they find on the way.
- **Someone who knew the dead character**: a sibling, a rival, a fellow believer, who arrives
  asking what happened.
- **A hireling or follower** the party already met, stepping up.

Keep it quick. The hook only has to put the character in the scene; the story can explain more
later.

## Requests to keep at hand

| Moment                  | Say to Claude                                                  | Set   |
| ----------------------- | -------------------------------------------------------------- | ----- |
| A character is dying    | "Show the death saves of everyone at 0 HP."                    | play  |
| You make the call       | "Mark Kasimir as dead, go ahead."                              | play  |
| After the session       | "Who went down last session, and how?"                         | prep  |
| The death log           | "Write a short death log entry for Kasimir from last session." | prep  |
| Old sheet read-only     | "Set Anna to Observer on Kasimir."                             | admin |
| New character           | "Make Anna the owner of Vasil."                                | admin |
| New character's handout | "Reveal the page 'Vasil' in 'Handouts' to Anna."               | prep  |

More recipes: [Cookbook](cookbook.md). Switching tool sets on: [Asking Claude](asking-claude.md#tool-sets-which-switches-to-turn-on).
