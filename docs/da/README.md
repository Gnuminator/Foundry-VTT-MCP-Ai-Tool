---
title: Danish guides
description: How the Danish versions of the GM and player guides are made and kept current, with the word list they follow.
---

# Danish guides

Every page in [docs/gm](../gm/README.md) and [docs/player](../player/README.md) has a Danish twin
here, at the same name: `docs/gm/first-hour.md` becomes `docs/da/gm/first-hour.md`. The wiki shows
them under a Danish language switch. Not translated: docs/foundry, reference, dev, design and history.

## The format of a twin

- **Front matter:** the translated `title` and `description`, then `source: gm/first-hour.md` (the
  English page, relative to `docs/`) and `sourceHash:` (the hash of that English page when the
  translation was made).
- **Check:** `npm run docs:links` also runs `node scripts/wiki/da.mjs check`. It fails when an English
  guide has no twin, when a twin's `sourceHash` is not the hash of its English page now (the English
  page changed: translate the change), or when a twin holds an em dash.
- **After you translate a change:** `node scripts/wiki/da.mjs stamp gm/first-hour.md` writes the new
  hash. `node scripts/wiki/da.mjs hash gm/first-hour.md` prints it. Stamp only after the translation is
  done: stamping to quiet the check makes the Danish page lie.
- **A new English guide** needs its twin in the same pull request.
- **Links:** correct relative paths from the twin's own place. A link to a page that has a twin points
  at the twin (from `docs/da/gm/`: `x.md` for a GM page, `../player/x.md` for a player page). A link to
  a page with no twin (docs/foundry, repo files) points at the English file (`../../foundry/x.md`).
  Images are `../../images/...`. A link with `#anchor` uses the anchor of the Danish heading.
- **Chips and quests:** a time in the last parentheses of a heading, `(15 minutter)`, becomes a chip on
  the wiki; `ca.` and `minutter`, `time` or `timer` are understood. Quest checkboxes work as in English.

## How the Danish reads

Plain, short sentences, `du` to the reader, no em dashes (use a comma, a colon or a full stop), no
stiff office Danish and no filler. Game terms and Foundry labels stay English, as the players say them
and as they appear on screen (translated terms read as nonsense at a Danish table).

**Keep in English:** D&D, Foundry, Foundry VTT, Claude, Discord, Obsidian, vault, dashboard, token,
actor, scene, journal, compendium, world, module, every sidebar tab and button as Foundry shows it
(Actors tab, Scenes tab, Game Settings), every dashboard label and panel name as the dashboard shows it
(Pre-flight, Recent Changes), attack, attack roll, saving throw, ability check, hit points, HP, AC,
initiative, combat tracker, spell slot, short rest, long rest, advantage, disadvantage, condition names,
NPC, monster, roll, damage, healing, combat, turn, round, spell, feature, item, handout, recap, quest, play log, session notes, prompt, plan,
confirm, undo, API key, Pro, Max.

**Use Danish for:** GM (`GM'en`, `GM'ens`), player (`spiller`, `spillerne`), campaign (`kampagne`),
game night (`spilaften`), the table (`bordet`), prep (`forberedelse`, `forberede`), session
(`session`, `sessionen`), character (`karakter`), setup and settings in running text (`opsætning`,
`indstillinger`) unless it names a screen, and the ordinary words around them.

**Endings:** Danish endings go straight on an English word: `tokenet`, `dashboardet`, `worlden`, `scenen`,
`tokens`. An apostrophe only after an abbreviation: `GM'en`, `GM'ens`, `NPC'er`, `PC'er`, `AC'en`.

**Links to pages with no Danish version** (the Foundry basics): the link text is the English page
title, as the reader lands on the English page ("A tour of the Foundry screen", "Foundry glossary").

**Names of things:** the tool is `Foundry AI Tool`; Danni is the GM; keep file names, commands, code,
keyboard keys and URLs exactly as they are, in backticks as in the English page.
