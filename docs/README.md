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
  in the stage script) at `/player/foundry/`. The sidebar shows nothing else. A player page may
  link only to player pages and to those Foundry copies: staging fails if it links anywhere else on the wiki.
- **GM side:** `docs/gm/` and all of `docs/foundry/`. Every page under `docs/gm/` starts with a "For the GM" label.
- A new player guide goes in `docs/player/` and shows up by itself. A new GM guide goes in
  `docs/gm/`, and in the `SIDEBAR` list of the stage script if it should not land under "More guides".

## Danish twins (GM and player guides only)

Every page in `docs/gm/` and `docs/player/` has a Danish twin at the same name under `docs/da/`, and
the wiki shows them under a Danish language switch. **The format, the check and the word list are in
[da/README.md](da/README.md).** In short: the twin's front matter holds `source` and `sourceHash`,
`npm run docs:links` fails when a guide has no twin or its twin is older than its source, and
`node scripts/wiki/da.mjs stamp gm/x.md` records the new hash once the change is translated.
Not translated: `docs/foundry/`, reference, dev, design and history.

Supported: Foundry VTT 14 with the dnd5e 6 system. Foundry AI Tool is not affiliated with or endorsed by
Foundry Gaming LLC.
