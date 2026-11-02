---
title: Documentation
description: Where to find guides, developer docs, reference pages, current plans and project history.
---

# Documentation

| Folder                      | For                              | What is in it                                                                                                                                             |
| --------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [gm/](gm/README.md)         | the GM                           | Guides for running a game with the tool: getting started, the dashboard, asking Claude, before and after each session, never and only if, troubleshooting |
| [player/](player/README.md) | players                          | What players see, what is recorded, which parts reach an AI, how to have data removed                                                                     |
| [dev/](dev/)                | whoever builds or hosts the tool | Architecture, dev setup, testing, the test kit, deployment, remote access, the Orange Pi, Plan B, releasing                                               |
| [reference/](reference/)    | the builder                      | Every tool with its parameters (generated), the tool sets, dashboard reference (older; GMs: use [gm/dashboard.md](gm/dashboard.md))                       |
| [design/](design/)          | the builder                      | Current plans: Obsidian, roadmap, brand, link reliability, usage log                                                                                      |
| [history/](history/)        | the builder                      | Finished plans, session logs, reviews, and the progress log. Kept as written                                                                              |

## The wiki: player side and GM side

The wiki (`docs/wiki`, staged by `scripts/wiki/stage.mjs`) has two sides. Its home page asks
"player or GM?".

- **Player side:** `docs/player/` plus a copy of the Foundry basics a player needs (`PLAYER_FOUNDRY`
  in the stage script) at `/player/foundry/`. The sidebar shows nothing else. A player page must
  not link to a GM page or to another Foundry page: staging fails if it does.
- **GM side:** `docs/gm/` and all of `docs/foundry/`. Every GM page starts with a "For the GM" label.
- A new player guide goes in `docs/player/` and shows up by itself. A new GM guide goes in
  `docs/gm/`, and in the `SIDEBAR` list of the stage script if it should not land under "More guides".

## Danish twins (GM and player guides only)

Every page in `docs/gm/` and `docs/player/` has a Danish twin at the same name under `docs/da/`:
`docs/gm/first-hour.md` becomes `docs/da/gm/first-hour.md`, `docs/player/join.md` becomes
`docs/da/player/join.md`. Not translated: `docs/foundry/`, reference, dev, design and history.

- **Front matter:** the translated `title` and `description`, plus `source: gm/first-hour.md` (the
  English page, relative to `docs/`) and `sourceHash:` (the first 12 hex characters of the SHA-256 of
  the English file with line endings turned into `\n`). When the English page changes, translate the
  change and update the hash; the check fails while the hash is old.
- **Links:** correct relative paths from the twin's own place. A link to a page that has a Danish twin
  points at the twin (from `docs/da/gm/`: `x.md` for a GM page, `../player/x.md` for a player page);
  a link to a page with no twin (`docs/foundry/`, repo files) points at the English file
  (`../../foundry/x.md`); images are `../../images/...`.
- **Language:** game terms and Foundry labels stay English as they appear on screen (attack, saving
  throw, token, Actors tab). Public docs voice: plain and human, no em dashes.

Supported: Foundry VTT 14 with the dnd5e 6 system. Foundry AI Tool is not affiliated with or endorsed by
Foundry Gaming LLC.
