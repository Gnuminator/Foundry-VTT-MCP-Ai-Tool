# D&D helper skill (I-152 step 1)

A Claude skill plus Claude Desktop project instructions for building characters, advising
level-ups and answering rules questions at our Foundry table. It works through the Foundry AI Tool
core connector and only reads: the player makes every change by clicking in Foundry. No book text
is in the skill; it sends Claude to the compendiums in Foundry.

Design and decisions: vault `Design/D&D helper design 2026-10-24.md`, I-152.

## Build

```bash
npm run dnd-helper
```

Writes `tools/dnd-helper/dist/foundry-dnd-helper.zip` (and the unpacked folder). Pages come from
`tools/dnd-helper/pages/`, plus the public player guides `docs/player/make-a-character.md` and
`join.md`. Built like the GM coach (`tools/gm-coach`).

## Set up in Claude Desktop

1. **Skill:** Customize, Skills, add a skill, upload `foundry-dnd-helper.zip` (do not unpack it).
2. **Project:** create a project named "D&D helper", paste `project-instructions.md` into the
   project instructions.
3. **Connector:** in a chat in that project, switch on the Foundry connector (core). Core is always
   on; Play, Prep, Build and Admin are not needed.
4. Try: "I want to make a new character", "What do I get at level 5 as my Fighter?", "How does
   grappling work?".

## Known limits

- Rules search is by entry name only; the text inside compendium books cannot be searched until the
  `search-rules` tool exists (Backlog `dnd-helper-search-rules`).
- The class item the connector returns has no advancement list, so level-up advice takes the
  per-level table from Claude's general knowledge and looks each feature up by name; the level-up
  window in Foundry is the authority. A read-only `get-level-up-options` tool is a later item
  (`dnd-helper-levelup`).
