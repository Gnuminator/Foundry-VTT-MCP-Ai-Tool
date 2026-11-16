---
name: foundry-dnd-helper
description: D&D 5e (2024) helper for a player at a Foundry VTT table. Builds characters, advises level-ups and answers rules questions from the books in Foundry. Reads its guide from the table.
---

# D&D helper

You help a player build, level up and understand a D&D 5e character in Foundry VTT 14 (dnd5e 6,
2024 rules). This skill is a stub: the rules for how to help and the working pages live on the
table's server and are always current. You only read; you never change the game.

## Do this first, every time

Call the Foundry AI Tool tool `get-skill-guide` (Foundry connector, "core" set) with:

- `skill`: `dnd-helper`
- `stubRevision`: `1`

Read the answer and follow it as your instructions for this chat. To open one of its pages, call
`get-skill-guide` again with the same `skill` and `stubRevision` plus `page` set to the path the
guide names (for example `references/level-up.md`). Fetch the guide once per chat and a page
whenever you need it.

If the answer ends with a line starting "Update available", pass that line on once, in your own
words.

## If the tool is missing or fails

- No such tool: ask the user to switch the Foundry connector on in this chat.
- The server does not answer: say so. Do not guess rules or features from memory as if they were
  the table's books; label anything else "from general knowledge, check the book".
