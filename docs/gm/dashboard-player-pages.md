---
title: 'The dashboard: player pages and Obsidian'
description: 'The player page, revealing a handout, player links, My character and Open in Obsidian.'
---

# The dashboard: player pages and Obsidian

Part of [The dashboard](dashboard.md).

## The player page (/player)

The page players look at: the dashboard address with `/player` at the end. Open it yourself before a session
to check what they see. It follows the evening. While a session is open (or a fight runs) the live
cards come first: Combat order, Live Feed, then Handouts. Between sessions it leads with Last
recap, Handouts and Quests, and the live cards move down. Its parts:

- **Who are you?** On a player's first visit, a list of names. The pick only decides which
  handouts "just for you" show; the header then says "Playing as ..." with a **Not you? Change** button to pick
  again. **Skip** leaves it unpicked.
- **You**: at the top, for a player who opened their own `/me` link on that device: "Your turn" or
  "You are up next", a small card for each of their characters (HP, conditions, concentration) and
  a concentration reminder when they take damage. Their open roll requests show here as **Roll**
  buttons.
- **Open your character sheet**: a link to `/me`. At the top between sessions, at the bottom during
  a session.
- **Combat order**: initiative and names as players know them. PCs have an HP bar; enemies and NPCs
  have no HP numbers and no band: players ask you who is hurt. (The rough band, healthy, bloodied, critical, down, is a switch for the host: `PLAYER_SHOW_ENEMY_HP_BANDS=true`.) Only standard conditions show. Hidden creatures are left out, and a creature
  whose name players cannot see is "Unknown creature".
- **Live Feed**: public rolls and what players could see happen, with creatures named the way
  players know them. Private, blind and GM rolls never show. Damage and healing amounts show for
  PCs only (others just "was hit").
- **Last recap**: the newest revealed page whose title says "recap" (or "opsummering", "resume").
- **Handouts**: pages you revealed, with secret sections, inline rolls and links to unrevealed
  pages removed. A page revealed since the session started (or, between sessions, since the last
  one ended) carries a **New** mark. A page for chosen players says "just for you".
- **Quests**: revealed pages whose title says "quest" (or "opgave").

The header shows the world, the scene's **Navigation Name** (else "Current scene", never the real
name) with its time of day (only on scenes with global illumination) and weather, for example
"Village Square (Dusk, Rain)", and a status: "Live", "Foundry is offline. Wait a moment.", "Not connected. Wait a moment." or
"Connecting…". With The Veil theme the footer also has a **Mist** choice, which only changes that
device.

Players open it from their own devices, behind the same email-code login as Foundry.

### Revealing a handout

In Foundry, pages inherit their journal's ownership. If you give players Observer on a journal
first, every page in it is readable at once, before any reveal. So do it in this order:

1. **Make one journal just for handouts.** Journal tab (book icon), **Create Journal Entry**, name
   it, for example "Handouts". Put only handout pages in it.
2. **Set every page in it to None.** Open the journal. In its page list, right-click a page,
   **Configure Ownership**, set **All Players** to **None** (not Inherit), **Save Changes**. Do
   this for every page, and for each page you add later.
3. **Only then raise the journal.** In the Journal tab, right-click the journal, **Configure
   Ownership**, set **All Players** to **Observer**, **Save Changes**. Players can now open the
   journal, but no page in it.
4. **Switch the feature on.** Game Settings, category **Foundry AI Tool**, tick "AI Tool:
   Handouts (writes)", **Save Changes**.
5. **Plan and apply the reveal.** Ask Claude with the `reveal-handout` prompt, or run the tool
   `plan-page-reveal` with `action` reveal and apply the plan. The confirm window lists what will
   change. To reveal it to some players only, fill in `players`. To prepare reveals ahead of the
   session, queue them instead (see "The handout drawer").

The page shows on the player page within a few seconds, and players can open it in Foundry.
`plan-page-reveal` with `action` hide takes it back. Before a session, open the player page and
check that the Handouts list shows only what you revealed.

## Player links and My character (/me)

Each player can have their own character page: their sheet on a phone or laptop, read-only, and
up to date during play (HP, spell slots, conditions, resources). It opens from a private link
that you make once per player.

1. **Advanced**, **🔗 Player links**. The panel lists every player (non-GM) user in the world.
2. **Make link** next to a player. The link is copied; send it to that player in a direct
   message, not in the table chat. Later, **Copy link** copies it again.
3. The player opens it once. The page remembers it on that device, so it works from a bookmark
   or the home screen afterwards.

The page shows only the characters that player's Foundry user **owns** (Owner permission on the
actor). To give a player their character, set their ownership in Foundry as usual; nothing else is
needed. A player who owns no character sees "Ask your GM".

- **New link** makes a fresh link and turns the old one off (for a lost phone, or a link sent to
  the wrong person).
- **Remove** turns the link off without a new one.

The page has four views, and each player picks theirs (remembered on their device):

- **At the table**: big HP, AC and initiative, conditions, spell slots, resources, attacks and
  prepared spells. It follows the dashboard theme.
- **Paper 2024** (the default paper view) and **Paper 2014**: black on white, in the same order
  as the printed character sheet of that edition, so a player can copy it onto paper or print it
  (**Print** at the bottom).
- **Paper night**: a sheet for a table that plays on paper. Each block shows the value as it was
  when the sheet was printed and a box to write the new one in. **Print all party sheets** in the
  Player links panel prints every character's paper-night sheet, two pages each (GM only).

What the page leaves out: the GM's secret sections in descriptions, the true names of
unidentified items (it shows what the player sees in Foundry), and any actor the player does not
own. Like the player page, it is live on the Pi behind the email-code login, so players reach it from
their own devices.

## Open in Obsidian (📓)

The 📓 links open notes in Obsidian: the campaign Home note (header), a month's change history
(each Recent Changes row) and the current Tarokka reading (Tarokka drawer). They only appear on
the GM page, and only when the dashboard knows your Obsidian vault's name (the setting
`OBSIDIAN_VAULT_NAME` or `FOUNDRY_AI_OBSIDIAN_DIR` in the dashboard's own `.env` file; whoever set
up the tool adds it).

The other way round, notes of the Foundry mirror in Obsidian have **Open in Foundry** links. They
open a small dashboard page that asks you to click **Open**; the document then opens on your
Foundry screen, and nothing in the world changes.

### The Obsidian plugin (optional)

A small plugin for Obsidian on your PC makes this one step and shows handout status on the note
itself. Whoever set up the tool installs it with `scripts/install-obsidian-plugin.ps1` (or unzips
`foundry-ai-tool-obsidian.zip` from a release into the vault's `.obsidian/plugins` folder); then
turn on **Foundry AI Tool** under Settings, Community plugins. In its settings, the dashboard
address is the one you open in your browser, for example `http://localhost:3000`.

On a note from the Foundry mirror:

- **Open in Foundry**: from the command palette (Ctrl+P), the note's **...** menu, or a click on
  the Foundry line in the status bar at the bottom. It opens right away, no extra page.
- **Handout status**: on a journal page note, the status bar says whether players can see the page
  (not revealed, queued, revealed, revealed as a copy) and how many have opened it.
- **Reveal to players** and **Hide from players** (command palette): the plugin makes the plan and
  opens the dashboard, which shows the usual confirm window. Nothing changes until you confirm
  there, and the change gets **Undo** in Recent Changes like any other.
- **Add to the handout reveal queue**: puts the page in the handout drawer's queue, so you can
  reveal it with **Reveal next** during the session. Players see nothing yet. **Remove from the
  handout reveal queue** takes it out again.

On your own prep notes (see [Your Obsidian vault](obsidian.md)) the command palette also has **New
prep note for this**, **Import this quest prep note into Foundry (confirm in the dashboard)**
(needs the module switch "AI Tool: Obsidian import (writes)"; the dashboard shows the usual confirm
window and Undo removes the journal) and **Toggle: Claude may read this prep note**.

The plugin also gives the whole vault the dashboard's look, your own notes included. Its
**Theme** setting has **Neutral**, **The Veil** and **Off**. There is one theme per world: pick
Neutral or The Veil there and the dashboard switches too, and when you pick a theme in the
dashboard, Obsidian follows within half a minute. **Off** only turns the look off in Obsidian. The
theme gives stat blocks a card, shows GM secrets with a lock so you never read one out by mistake,
and turns a session's stats into small cards.

The plugin only talks to the dashboard. When the dashboard is not running, the status bar says
"dashboard offline" and nothing else changes.
