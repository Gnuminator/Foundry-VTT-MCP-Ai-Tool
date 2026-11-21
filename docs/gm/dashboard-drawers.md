---
title: 'The dashboard: confirm window, Tool Runner and drawers'
description: 'The confirm window, the Tool Runner, and the Tarokka, Handouts, Prep and Party drawers.'
---

# The dashboard: confirm window, Tool Runner and drawers

Part of [The dashboard](dashboard.md).

## The confirm window

The dashboard's own buttons that make a planned change (the party's pace and rest request,
Tarokka links and imports) apply at once when you click: your click is the confirmation. A message says what changed, with **Undo** for a few seconds; Recent
Changes keeps the full history.

The confirm window opens first for:

- **Destructive changes**: deletes, Tarokka reveals and hides, and handout hides (players see a
  reveal at once, so Undo cannot take it back from their eyes). A handout reveal has a working
  Undo and asks in one line, with no tick. **End combat** is a delete too, but it asks in one
  line with no tick, on both strips: Undo brings the fight back.
- **Plans you did not make on the dashboard**: a plan Claude made.
  Plan, confirm and undo stay for every AI change.
- **Any plan made in the Tool Runner**, so you see which targets it hits before it applies. (The
  strip's Damage / Heal form applies at once, with Undo; its Condition chips and End combat ask in
  one line.)
- **Older tools without a plan** (from the Tool Runner), which have no Undo.

In the confirm window:

- For a planned change it shows the plan's summary and the list of what will change. Read it.
- For other tools it shows the tool's name and the values it will run with.
- **Cancel** (or Escape, or a click outside) runs nothing.
- **Destructive action**: deletes, Tarokka reveals, hides and every Undo need a second step. Tick
  "I understand this changes the live game and may be hard to undo.", then click **Run destructive
  action**. The exception is **End combat** on the strips: it asks in one line with no tick, and
  Undo brings the fight back.

> **Not sure? Ask Claude.** Ask the GM coach: "When does the dashboard ask me to confirm a change, and when does it just apply it?" ([how to add the GM coach](gm-coach.md))

## The Tool Runner (🛠 Tool Runner)

A drawer on the side with every tool the bridge has, the same tools Claude uses. Use it when you
want to do one exact thing yourself, or to apply a plan Claude made.

1. Type in **Search tools…** or scroll. Tools are grouped by category (Combat, Tokens & Scene,
   Actors, Journals & Quests, Guarded changes, and more). Each shows a tag: `read`, `write` or
   `destructive`.
2. Click a tool. You see its description and a form. Fields marked **\*** are required.
3. Fill in the form and click **Run** (a read) or **Plan and confirm** (a change, which opens the confirm
   window).
4. The answer shows under the form as **Result** or **Error**. **‹ All tools** goes back.

When GM Actions are off, a warning bar at the top says so, with an **Enable GM Actions** button.
Reads still work.

### Pick from list buttons

Every field that names something (an actor, a token, a scene, a journal page, a combatant, a
compendium entry, a plan, a change) has a **Pick from list** button. It lists what exists right now; click
one to fill the field. You can still type by hand.

- The list has a filter box. For compendium entries and documents, type at least 2 letters to
  search.
- "hidden" next to a token means players cannot see it.
- A red "same name ×N" means several things share that name and the tool picks by name. Rename one
  in Foundry first, or you may hit the wrong one.
- "More exist: type to narrow the list." means the list was cut short.
- For a field that takes several values, click several entries; each is ticked.

### Pins and recent runs

When you have filled in a tool form you use often, click **📌 Pin** and give it a name. It then shows
as a button in a **Pinned** row on the During bar. A read runs at once and the answer shows under the
row. A plan or a write still goes through GM Actions and the confirm window, so a pin never changes
anything on its own. In the Tool Runner you can rename and remove pins. It also lists your last eight
runs (click one to fill the form again) and the three calls you use most, each with a **Pin** button.
Pins are kept in this browser, so on a new computer you pin again.

### Applying a plan Claude made

When Claude plans a change in Claude Desktop, you can apply it from the dashboard:

1. Turn on **GM Actions**.
2. Open **🛠 Tool Runner**, search for `apply-planned-change`.
3. Click **Pick from list** next to `planId` and choose the plan.
4. Click **Plan and confirm**. The confirm window shows the plan's summary and what will change.
5. Confirm. The change appears in **Recent Changes** with **Undo**.

`get-planned-change` without a `planId` lists every plan still waiting. Plans expire after 15
minutes, and restarting the bridge drops them. If a plan expired, ask Claude to plan it again.

> **Not sure? Ask Claude.** Ask the GM coach: "How do I use the Tool Runner to apply a plan Claude made?"

## The Tarokka drawer (🃏 Tarokka)

GM only. The reading lives in the bridge vault, outside Foundry, so players' browsers never
receive it. Changing anything needs the switch "AI Tool: Tarokka (writes)" (Game Settings,
category **Foundry AI Tool**) and GM Actions on.

Top row:

- **↻ Refresh**: reloads the reading.
- **New reading (built-in roll)**: deals a new reading with the tool's own roll. The previous
  reading is kept in an archive.
- **Choose the cards**: for a reading you drew by hand. Pick the five cards (the first three from
  the common deck, the last two from the high deck, none twice) and press **Store this reading**.
  Nothing is dealt. The previous reading is
  kept in an archive, and Undo brings it back. It shows card names, so it only opens while
  **Show cards** is ticked, and unticking that hides it again.
- **📓 Obsidian**: opens the current reading's note in Obsidian.
- **Show cards**: card names show as "Hidden card" until you tick this. Untick it before anyone looks at
  your screen.

Each of the five positions shows:

- the position and its card ("Hidden card" unless **Show cards** is ticked), and your note when
  cards are shown;
- links: **Open Journal**, **Open Scene** or **Open Actor** open the linked document on your
  Foundry screen (nothing changes); "not linked" when there is none;
- "hidden from players" or "revealed" (with **Open page** for the reveal page);
- **Add a link**: search your world's journals, pages, scenes and actors, then click **Link** on the
  right one;
- **Reveal to players**: type an optional page title and exactly what the players may read, then **Plan
  reveal**. The players get only your text, never the card name. Tick **Show it now** to pop the
  page up on the players' screens as soon as you apply the reveal. It is off every time unless you
  tick it, and Undo takes back the reveal but cannot close the popup.

Import, new reading and link apply in one click, with an **Undo** message. A reveal opens the
confirm window with the list of what will change and the destructive step, because the table
cannot unsee it. Every one of them shows up in Recent Changes and can be undone there.

## The handout drawer (📜 Handouts)

Queue handouts during prep, then reveal each with one click at the table. Only queued or revealed
pages show here: a new journal (one Claude just made, say) is not listed until you press
**+ Queue a page** for it. The drawer shows:

- **Queue**: the pages you staged, with their scene and who they are for. Use **↑** and **↓** to
  change the order: the first page is what **Reveal next** reveals. **Remove** takes one off the
  queue. Queueing changes nothing in Foundry.
- **Reveal next: `<title>`**: plans the reveal of the next queued page for the scene that is active
  now (or a page queued for any scene). A one-line window asks `Show "<title>" to <players>?`
  (no tick box; the reveal has a working Undo). Applying it also takes the page off the queue.
  Undo in Recent Changes hides it again and puts it back in the queue (a player may already have
  read it). If the queue changed since the drawer loaded, the window shows the plan in full.
  Tick **Show it now** next to it to also pop the page up on the screens of the players it is for
  (everyone when it is for every player). It is off every time unless you tick it, and Undo cannot
  close the popup.
- **+ Queue a page**: opens the Tool Runner on `plan-page-reveal` with `action` queue. Pick the page,
  optionally a scene and the players it is for, and run it.
- **Revealed**: each handout, who it is for, and a tick for each player who has opened it on the
  player page (hover for the time).

A handout for chosen players is readable in Foundry only by them, and the player page shows it only
to a player who picked that name ("Playing as ...") at the top of the page.

> **Not sure? Ask Claude.** Ask the GM coach: "How do I queue a handout during prep and reveal it at the table?"

**Handout press.** If you want a handout to look like a letter on aged paper with a wax seal, a
notice or a card, ask Claude to press one: give it the text and it uses `plan-handout-press` (in
the Play connector). It draws the picture on the computer the dashboard's backend runs on, with
the Edge, Chrome or Chromium already installed there (the Pi may have none, so ask from a PC session),
without any image AI. Applying the plan adds a hidden image page to the
"Handouts" journal. Players see nothing yet: queue and reveal it as above. Undo in Recent Changes
removes the page. Text that names a secret term is refused.

- **Switch it on:** in Foundry, Game Settings, category **Foundry AI Tool**, tick "AI Tool:
  Handouts (writes)" (the same switch as for revealing handouts).
- **What players see:** only the finished picture, once you reveal it.

## The prep drawer (📋 Prep)

The facts for preparing your next session, in one place and without AI. **Refresh** reloads them.

- **Last session**: its date and length, the scenes in the order you visited them, fights and
  rounds, the player characters and the NPCs who went down to 0 HP (not who died: the tool never
  knows that), the handouts you revealed (and who has opened them), and **Beats**, a
  short list of what happened. **All beats** loads the full list when the short one is cut.
- **Open threads**: quests whose Status is not done, and campaign parts not completed or skipped.
  **Open** shows the journal in Foundry.
- **Next session notes**: the text of your journal named "Next session". Keep it GM only; the
  drawer warns you if players can see it. Without that journal the drawer tells you how to make
  one.
- **Ready**: the handout queue by scene, the bosses on your scenes (legendary actions, legendary
  resistances, lair) and the pre-flight result, with a button to the pre-flight drawer.
- **Recent changes**: how many guarded changes were made, and the latest ones.
- **Loose ends**: the open quests nobody updated for two sessions, the NPCs who acted in only one
  session, and the scenes not used for two sessions, each with "last seen session N", plus a count
  of scenes never used. It is only a reminder from the play log and session log; nothing changes.
  Claude gets the same list from `get-prep-digest`.

Claude reads the same facts with `get-prep-digest`, which the prompt `prep-next-session` uses
first. Without Foundry connected, the drawer still shows last session and says what is missing.

**Omens by post.** Between sessions you can send each player one short private text as a hint of
what is coming. Claude drafts them (ask "Draft an omen for each player"; it uses `draft-omens` in
the Prep connector) but cannot approve or send. The drawer's **Omens by post** list shows each
draft with the player's name:

- **Approve** or **Reject** each one. A text that names a secret term (a Tarokka card name, say)
  shows a warning and asks you to confirm before it counts as approved. **Back to draft** takes an
  approved or rejected one back.
- **Discord ids for omens:** a player with no Discord user id yet shows "it cannot be sent". Open
  that fold-out, type their Discord user id (digits only) and link it.
- **Switch it on:** whoever runs the Discord bot sets `DISCORD_OMENS=1` in the bot's `.env`. It is
  off by default, and with it off an approved text stays where it is. If the dashboard splits GM
  and player tokens, the bot also needs `FOUNDRY_AI_GM_TOKEN`.
- **What players see:** one private Discord message each, sent once within a few minutes of your
  approval, only to that player's own account. Nobody sees another player's text, and nothing
  shows on the player page. A failed send is retried on its own a few times; if it still fails, the list says why and you can approve it again.

You can always read a hint aloud or write it in chat instead; this is an extra.

**Downtime from players.** On My character, a player can write what their character does between
sessions (see [My character](dashboard-player-pages.md)). The prep digest lists every player's
entries, each marked "from player": they are wishes, not things that happened. While you prepare,
ask Claude "What did the players ask to do in their downtime?" and it reads them with
`get-prep-digest`. The drawer itself does not list them.

**Previously on.** `get-prep-digest` (not the drawer yet) opens with a short "Previously on": the
GM summary of the newest recorded session that has one. It reads only
`<sessions folder>/<date>-discord/notes/summary.en.md` (or `summary.da.md` when only the Danish
one is written), never the player recap draft or a transcript. The sessions folder is
`FVTT_SESSIONS_DIR`, else `FoundrySessions` in the data folder (`FVTT_DATA_DIR`) or in `Documents` in your user folder, on the computer the
bridge runs on. If no session has a summary yet, or the bridge cannot see that folder (it runs on
another computer), Claude says so in one line.

## The read-aloud drawer (📖 Read-aloud)

Under **Advanced** you find **📖 Read-aloud**. It shows the boxed read-aloud text from the journal
pages the current scene links to (the scene's own link and its map pins), in order, so you do not have
to dig through the module while the players wait. **Show** opens one block full size on a screen
players can see; **Copy** puts it on the clipboard. The text is read from your world when you open
the drawer and is never stored. A scene with no boxed text says so. Claude can read the same text with
`get-read-aloud`.

## The party drawer (🛡 Party)

The party at a glance, from the dnd5e Group actor. Foundry makes the party by itself: the AI Tool
keeps a primary party (a Group actor called "Party") and adds every character a player owns, so
there is nothing to set up. NPCs and actors no player owns stay out. Each batch of additions shows in
Recent Changes with Undo; to take out an older character, remove it on the party sheet (it stays out of that party). A party you delete is made again the next time a character is added or the world loads. To manage the party by hand, switch off "AI Tool: Add player characters to the
party" in the module settings. With more than one group, a list at the top picks which one.

- **Members**: each character's HP, AC, passive Perception, hit dice left, conditions and
  exhaustion, death saves at 0 HP, and whether the token is on the scene and in the encounter.
  **Open** shows the character sheet in Foundry.
- **Who would notice**: with the module setting **AI Tool: Who would notice** switched on, type a
  DC and each character shows chips for passive Perception, Investigation and Insight, with a
  tick for a score at or above the DC and a cross below it. The scores are dnd5e's own, so
  conditions and exhaustion are already counted. **Skill** shows all three or just one of them.
  Only you see it; nothing is rolled or sent to
  the players.
- **Travel pace**: Slow, Normal or Fast. If a member is slowed, the drawer says the party moves
  at slow pace anyway.
- **Combat**: adds the party's tokens on the current scene to the encounter, or starts an
  encounter with them when there is none.
- **Place the party here**: scroll Foundry's map to the spot first. The button puts every member
  without a token on the scene you are looking at next to each other on the nearest free
  squares, around the centre of your view (each token at its own size, never on top of another
  token, not behind a wall). Members already on the scene stay where they are. Undo removes the
  new tokens again, also after you moved them; if you already deleted one of them by hand, Undo
  refuses, so delete the others by hand too. Claude can also place them at a token, a map note or
  a square ("put the party at the inn door").
- **Rest**: posts dnd5e's short or long rest card to chat. Each player clicks it to rest their
  own character, the same card Foundry's party sheet posts.
- **Ask for a roll**: pick a check, save or skill, a DC and private or public, then **Ask the
  whole party**, or **Ask roll** on one member. It posts the roll request to the player's chat and
  the play log (with GM Actions on). It has no confirm window and no Undo, since it only posts a
  roll card.

Each of the other buttons applies in one click, with an **Undo** message. The actions need GM Actions on and
the module setting **AI Tool: Party (writes)** switched on. Every change lands in Recent Changes
with Undo; a rest card can only be undone while nobody has rested from it (after that, delete the
card in Foundry's chat). Claude uses the same actions with `get-party` and `plan-party-change`.

> **Not sure? Ask Claude.** Ask the GM coach: "What can I do from the party drawer, and what does Who would notice show me?"
