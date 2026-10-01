---
description: The five tool sets Claude Desktop loads (core, play, prep, build, admin), which tools and prompts each holds, their size, and how to add a tool.
---

# Tool sets

The bridge has 89 tools. Their definitions are about 90,600 characters of JSON, roughly 22,000 to
29,000 tokens that Claude reads at the start of every conversation, before anyone types. Many
tools also look alike, which makes Claude pick the wrong one more often.

So the tools are split into five sets. Each set is its own entry in Claude Desktop's
configuration, so Claude Desktop shows one switch per set in the **Search and tools** menu. Turn on
what the conversation needs. The switches are remembered for new chats.

| Set       | Claude Desktop entry | Tools | Size (characters) | For                                                                                          |
| --------- | -------------------- | ----- | ----------------- | -------------------------------------------------------------------------------------------- |
| **core**  | `foundry-mcp`        | 20    | about 12,800      | Looking things up, and reviewing, applying or undoing planned changes. Always on.            |
| **play**  | `foundry-mcp-play`   | 33    | about 26,100      | Running the table live: tokens, combat, rolls, damage, conditions, chat, mood, loot.         |
| **prep**  | `foundry-mcp-prep`   | 20    | about 19,600      | Prep and recaps: quests, journals, encounter budgets, Tarokka, handouts, session log, stats. |
| **build** | `foundry-mcp-build`  | 7     | about 25,200      | Making NPCs, monsters and items, from a compendium or from scratch.                          |
| **admin** | `foundry-mcp-admin`  | 9     | about 6,800       | Modules and their errors, actor ownership, the Obsidian mirror.                              |

A prep chat with core and prep on carries about 32,400 characters instead of 90,600. Core alone is
about 14% of everything.

The dashboard is not affected: it reads the bridge directly and always has every tool.

## What each set holds

The source of truth is `packages/mcp-server/src/tool-sets.ts`; a test fails when this page and the
code disagree.

- **core:** `get-world-info`, `list-characters`, `get-character`, `get-character-entity`,
  `search-character-items`, `list-scenes`, `get-current-scene`, `get-token-positions`,
  `get-combat-state`, `list-journals`, `search-journals`, `search-compendium`,
  `get-compendium-item`, `list-compendium-packs`, `get-planned-change`, `apply-planned-change`,
  `list-recent-changes`, `undo-change`, `open-in-foundry`, `check-secret-terms`
- **play:** `switch-scene`, `use-item`, `request-player-rolls`, `request-ability-check`,
  `request-attack-roll`, `roll-npc-check`, `get-token-details`, `get-available-conditions`,
  `get-chat-log`, `get-combat-play-by-play`, `send-chat-message`, `get-character-resources`,
  `get-active-effects`, `advance-combat-turn`, `set-initiative`, `roll-initiative-for-npcs`,
  `measure-distance`, `get-targets`, `get-recent-events`, `plan-actor-change`,
  `plan-token-change`, `roll-saving-throws`, `use-npc-activity`, `manage-rest`, `get-party`,
  `plan-party-change`, `place-measured-template`, `delete-measured-template`, `set-scene-mood`,
  `add-map-note`, `delete-map-note`, `drop-loot`, `mark-play-session`
- **prep:** `create-quest-journal`, `update-quest-journal`, `link-quest-to-npc`,
  `create-campaign-dashboard`, `suggest-balanced-encounter`, `get-tarokka-reading`,
  `plan-tarokka-import`, `suggest-tarokka-links`, `plan-tarokka-links`, `plan-tarokka-reveal`,
  `get-player-visibility`, `list-revealed-pages`, `get-player-handouts`, `plan-page-reveal`,
  `list-ref-choices`, `get-session-log`, `get-play-session`, `get-play-stats`, `get-preflight`, `get-prep-digest`
- **build:** `list-creatures-by-criteria`, `get-compendium-entry-full`,
  `create-actor-from-compendium`, `dnd5e-create-npc`, `dnd5e-add-feature`,
  `dnd5e-add-features-from-compendium`, `manage-world-items`
- **admin:** `get-modules`, `get-module-errors`, `clear-module-errors`, `get-module-manifest`,
  `list-actor-ownership`, `assign-actor-ownership`, `remove-actor-ownership`,
  `get-obsidian-mirror`, `plan-obsidian-mirror`

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

## Configuration

The installer writes all five entries. By hand, each entry is the same command with its own
`FOUNDRY_AI_TOOL_SETS`; see `claude_desktop_config.example.json`. The value is one or more set
names separated by commas (`prep,build`), or `all`. Without the variable an entry serves every
tool, so an older configuration keeps working unchanged.

Every entry runs a small wrapper process; they all share one bridge. Settings such as
`MCP_CONTROL_HOST` or `FOUNDRY_AI_OBSIDIAN_DIR` belong in every entry (the installer copies them
from `foundry-mcp`).

Each wrapper also tells Claude which sets it serves and which other sets exist, so when a request
needs a set that is off, Claude says which switch to turn on instead of reaching for the wrong
tool.

## Adding a tool

- Put it in exactly one set in `tool-sets.ts`. The tool catalog test fails otherwise, and also
  when a set grows past its size budget.
- A new feature gets **one tool with an `action` parameter** (like `manage-world-items`), not a
  handful of small tools.
- A prompt names only tools from its own set and core (checked by the prompt tests).
