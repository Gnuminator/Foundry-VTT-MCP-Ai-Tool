---
description: The five tool sets Claude Desktop loads (core, play, prep, build, admin), which tools and prompts each holds, their size, and how to add a tool.
---

# Tool sets

The bridge has 117 tools. Their definitions are about 129,250 characters of JSON, about 30,800 to
40,400 tokens that Claude reads at the start of every conversation, before anyone types. Many
tools also look alike, which makes Claude pick the wrong one more often. Eight of the 117 are the
player set (see below), which no Claude Desktop entry carries: the GM's Claude Desktop can load at
most the other 109, about 128,150 characters.

So the tools are split into five sets. Each set is its own entry in Claude Desktop's
configuration, so Claude Desktop shows one switch per set in the **+** menu, then **Plugins**. Turn on
what the conversation needs. The switches are remembered for new chats.

| Set        | Claude Desktop entry      | Tools | Size (characters) | For                                                                                                                                                                                                                                                        |
| ---------- | ------------------------- | ----- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **core**   | `foundry-mcp`             | 25    | about 19,000      | Look things up (world, characters, scenes, journals, compendiums, combat) and review, apply or undo planned changes. Always on.                                                                                                                            |
| **play**   | `foundry-mcp-play`        | 41    | about 44,200      | Run the table live: tokens, combat turns, rolls, damage, conditions, resources, chat, scene mood, map notes and loot.                                                                                                                                      |
| **prep**   | `foundry-mcp-prep`        | 22    | about 25,200      | Prepare sessions and write recaps: quests and journals, encounter budgets, the Tarokka reading, handouts, the session log, play stats and the pre-flight check.                                                                                            |
| **build**  | `foundry-mcp-build`       | 10    | about 24,700      | Make and change NPCs, monsters and items: from a compendium or from scratch, with features, attacks and spells. Set up rooms: teleports and tokens in a room.                                                                                              |
| **admin**  | `foundry-mcp-admin`       | 11    | about 10,750      | Set up and troubleshoot: installed modules and their errors, Foundry settings, modules on or off, user roles, who can open a pack, journal or scene, who owns which actor, round token rings, and the Obsidian mirror settings.                            |
| **player** | none (`/mcp/player` only) | 8     | about 3,050       | A player's own read-only view: their character sheet, what their next level grants, short passages from the books their Foundry user can see, their revealed handouts, recap and quests, and their play stats. Served only on /mcp/player, never on stdio. |

A prep chat with core and prep on carries about 44,350 characters instead of 129,250. Core alone is
about 15% of everything.

The dashboard is not affected: it reads the bridge directly and always has every tool.

The **player** set is the sixth set and is not one of the five Claude Desktop entries. No stdio
wrapper serves it, whatever `FOUNDRY_AI_TOOL_SETS` says (`player` is ignored with a warning and
`all` leaves it out). It has no `call_tool` route either: the only way to run one of its tools is
the control message `player_tool`, which carries a Foundry user id that the dashboard's `/mcp/player`
route has verified from the player's login. The tool arguments never carry a user id. The scope is
enforced in the module's `playerRead` bridge query: only characters the user owns, only compendium
packs the user can observe, minus Adventure packs, world journals and actors, `dnd5e` and
`aitool-content.journals`. A last-line filter drops any book result that names Strahd, Barovia,
Ravenloft, Tarokka, Ireena, Vallaki, a live Tarokka card or a term from the optional `denyTerms` list
in the file named by `FOUNDRY_AI_PLAYER_CONNECTOR_CONFIG`.

Two of the tools, `get-my-handouts` and `get-my-play-stats`, are answered by the dashboard's
`/mcp/player` route itself, not by the bridge: it holds the player page's filters. Handouts are
the ones `PlayerViewSource.handoutsFor` returns for that player (revealed pages, sanitized, none
meant for another player); stats go through `projectPlayStats` (own characters, public rolls only).

## What each set holds

Each tool's set is the `set` field of its entry in the `tools` map of its module (`packages/mcp-server/src/tools/modules/`), and `tool-sets.ts` derives these lists from the modules, in the order of the tool list Claude receives. A test fails when this page and the code disagree. Each tool's description and parameters are in the [tool reference](tools.md).

- **core:** `get-character`, `get-character-entity`, `list-characters`, `search-character-items`,
  `search-compendium`, `search-rules`, `get-compendium-item`, `list-compendium-packs`,
  `get-current-scene`, `get-world-info`, `list-scenes`, `list-journals`, `search-journals`,
  `get-level-up-options`, `get-combat-state`, `get-token-positions`, `get-planned-change`,
  `apply-planned-change`, `list-recent-changes`, `undo-change`, `open-in-foundry`, `list-changes`,
  `plan-undo-changes`, `check-secret-terms`, `get-skill-guide`
- **play:** `use-item`, `switch-scene`, `request-player-rolls`, `request-ability-check`,
  `request-attack-roll`, `roll-npc-check`, `plan-scene-restore`, `plan-npc-turn`, `plan-paper-sync`,
  `plan-handout-press`, `plan-scene-mood`, `list-scene-moods`, `check-action`, `get-token-details`,
  `get-available-conditions`, `get-chat-log`, `get-combat-play-by-play`, `send-chat-message`,
  `get-character-resources`, `get-active-effects`, `advance-combat-turn`, `set-initiative`,
  `roll-initiative-for-npcs`, `measure-distance`, `get-targets`, `get-recent-events`,
  `wait-for-game-event`, `roll-saving-throws`, `use-npc-activity`, `manage-rest`,
  `mark-play-session`, `get-read-aloud`, `get-party`, `plan-party-change`, `plan-actor-change`, `plan-token-change`,
  `plan-scene-change`, `play-playlist`, `plan-combat-change`, `get-renown`, `plan-renown-change`
- **prep:** `create-quest-journal`, `link-quest-to-npc`, `update-quest-journal`,
  `create-campaign-dashboard`, `get-session-log`, `suggest-balanced-encounter`,
  `get-tarokka-reading`, `plan-tarokka-import`, `suggest-tarokka-links`, `plan-tarokka-links`,
  `plan-tarokka-reveal`, `get-play-session`, `draft-omens`, `get-play-stats`, `plan-campaign-merge`, `get-player-visibility`,
  `list-revealed-pages`, `get-player-handouts`, `plan-page-reveal`, `get-preflight`,
  `get-prep-digest`, `list-ref-choices`
- **build:** `manage-world-items`, `list-creatures-by-criteria`, `create-actor-from-compendium`,
  `dnd5e-add-feature`, `dnd5e-create-npc`,
  `dnd5e-add-features-from-compendium`, `plan-room-setup`, `plan-pc-creation`, `plan-actor-image`, `plan-macro`
- **admin:** `plan-ownership-change`, `list-actor-ownership`, `plan-token-rings`,
  `plan-table-viewer`, `plan-foundry-setup`, `get-modules`, `get-module-errors`,
  `clear-module-errors`, `get-module-manifest`, `get-obsidian-mirror`, `plan-obsidian-mirror`
- **player:** `get-my-character`, `get-my-level-up-options`, `search-books`, `find-book-entries`,
  `get-book-entry`, `get-my-handouts`, `get-my-play-stats`, `get-player-skill-guide`

## Prompts

Each ready-made prompt appears next to the set whose tools it uses (a prompt may also use core):

| Prompt              | Set  |
| ------------------- | ---- |
| `rules-question`    | core |
| `npc-improv`        | core |
| `prep-next-session` | prep |
| `session-recap`     | prep |
| `encounter-check`   | prep |
| `reveal-handout`    | prep |
| `paper-sync-photos` | play |

## Configuration

The Windows client installer writes all five entries (pointing at a remote bridge). By hand, each entry is the same command with its own
`FOUNDRY_AI_TOOL_SETS`; see `claude_desktop_config.example.json`. The value is one or more set
names separated by commas (`prep,build`), or `all`. Without the variable an entry serves every
tool, so an older configuration keeps working unchanged.

Every entry runs a small wrapper process; they all share one bridge. Settings such as
`MCP_CONTROL_HOST` or `FOUNDRY_AI_OBSIDIAN_DIR` belong in every entry (the installer keeps what the old
`foundry-mcp` entry had and copies it to the others).

Each wrapper also tells Claude which sets it serves and which other sets exist, so when a request
needs a set that is off, Claude says which switch to turn on instead of reaching for the wrong
tool.

## Adding a tool

- Put it in exactly one set: the `set` field of its entry in the `tools` map of its module
  (`tools/modules/`). The tool catalog test fails otherwise, and also when a set grows past its
  size budget (`tool-budgets.ts`, which the user owns).
- Give it a title and a kind (read, write or destructive) in the same `tools` entry (`title`, `kind`). Claude Desktop
  lets the GM allow the read-only tools once and keeps asking before the others; a test fails
  when a tool has no entry or a write is marked read-only.
- A new feature gets **one tool with an `action` parameter** (like `manage-world-items`), not a
  handful of small tools.
- A prompt names only tools from its own set and core (checked by the prompt tests).
- Run `npm run docs:tools` to regenerate the [tool reference](tools.md); CI fails while it is
  stale.
