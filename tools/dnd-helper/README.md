# D&D helper skill (I-152 step 1)

A Claude skill plus Claude Desktop project instructions for building characters, advising
level-ups and answering rules questions at our Foundry table. It works through the Foundry AI Tool
core connector and only reads: the player makes every change by clicking in Foundry. The skill holds
no Foundry rules markup and its pages are capped in size; it sends Claude to the compendiums in Foundry.

Design and decisions: vault `Design/D&D helper design 2026-10-24.md`, I-152.

## Build

```bash
npm run dnd-helper
```

By default this builds two thin stubs into `tools/dnd-helper/dist/`: `foundry-dnd-helper.zip` (GM
edition, core connector) and `foundry-dnd-helper-player.zip` (player edition, see below), each with
its unpacked folder. A stub is a `SKILL.md` only. It tells Claude to read the real guide from the
table with `get-skill-guide` (GM edition) or `get-player-skill-guide` (player edition), so the
guide stays current without a new upload.

`npm run dnd-helper -- --full` builds the full zips instead, with every page inside. Pages come from
`tools/dnd-helper/pages/`, plus the public player guides `docs/player/make-a-character.md` and
`join.md`. Built like the GM coach (`tools/gm-coach`).

The helper also reaches people through two other routes: the plugin marketplace
`Gnuminator/foundry-ai-tool-plugins` (Foundry dnd helper and Foundry player helper cards) and the
player extension `foundry-player.mcpb`, which carries the instructions itself. The steps for both
are in `docs/player/dnd-helper.md` and `docs/gm/setup-gm-coach.md`.

## Set up in Claude Desktop

1. **Skill:** Settings, Plugins, Skills, add a skill, upload `foundry-dnd-helper.zip` (do not unpack it).
2. **Project:** create a project named "D&D helper", paste `project-instructions.md` into the
   project instructions.
3. **Connector:** in a chat in that project, switch on the Foundry connector (core). Core is always
   on; Play, Prep, Build and Admin are not needed.
4. Try: "I want to make a new character", "What do I get at level 5 as my Fighter?", "How does
   grappling work?".

## Player edition (D-136)

`foundry-dnd-helper-player.zip` has the same flows (create, level up, rules, sheet check) on top
of the read-only `player` tool set only, eight tools: `get-my-character`, `get-my-level-up-options`,
`search-books`, `find-book-entries`, `get-book-entry`, `get-my-handouts`, `get-my-play-stats` and
`get-player-skill-guide`. Its own files are in `tools/dnd-helper/player/`
(SKILL.md, project instructions, level-up and rules pages); creation and sheet check are the GM
pages with tool names swapped by `swap()` in `build.mjs`, which throws if a GM page changes under
it. For "which is best" it links the Dungeon Mister 2024 guides as labelled opinion. A build test
checks that it names no GM tool, that every page `SKILL.md` names is in the zip, and that it has no em dash. It has no project instructions: the skill carries everything. Players follow
`docs/player/dnd-helper.md`.

## Known limits

- Rules search reads the text of the rulebook chapters and of item, spell and feature descriptions
  (`search-rules`); `search-compendium` still matches entry names only.
- Level-up advice starts from `get-level-up-options`, which says what the next level grants and
  which choices are open. It only reads: the level-up window in Foundry is the authority, and the
  player makes every choice there.
