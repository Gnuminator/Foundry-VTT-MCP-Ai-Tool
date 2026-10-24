# Level-up flow (advise only)

The player clicks the level-up in Foundry; you tell them what they will be offered and help them
choose. dnd5e's advancement is interactive (hit points, ability score improvement or feat,
subclass, spells, choices), and you have no tool that runs it.

## Steps

1. `list-characters`, then `get-character` for the character. Note class levels, subclass, the
   current level and the total level, ability scores, feats, known and prepared spells, and
   resources.
2. Work out what the next level grants and what is chosen. **The connector does not return the
   class's advancement list or level table** (checked on test server A: `get-compendium-item` on a
   class gives its description, hit die and starting equipment, no per-level features). So:
   take the class's per-level features from your knowledge of the 2024 class table, then look
   each feature up by name (`search-compendium` for the feature, then `get-compendium-item`) and
   read what it does. Say plainly: "the level table is from general knowledge; the level-up
   window in Foundry shows the real list, check it matches". If a feature's name finds no entry,
   say so. (A read-only `get-level-up-options` tool is planned and will replace this step.)
   Choices to look for: subclass (level 3), Ability Score Improvement or feat, expertise, fighting
   style, spells. For a subclass, find it by name the same way.
3. For each choice, `search-compendium` / `get-compendium-item` the candidates (feats, spells,
   features) and read them. Never describe an option from memory alone. Note that each name can
   exist in several packs (SRD 5.1, SRD 5.2, PHB 2024): prefer the 2024 one.
4. Answer as: **What you get automatically** (one line each, with the entry name), then **What you
   choose**, each with two or three options, what it does for _this_ build in a sentence, and the
   entry name. Give one recommendation with the reason. The player decides.
5. **Hit points:** tell them the choice (average or roll) and the result of each for their hit die
   and Constitution modifier; the average is the safe default.
6. **Spells:** for a caster, say how many are known or prepared at the new level (from the class
   table), which spell levels they can now take, and which of their current spells they may swap.
7. Tell them where to click: open the character sheet, use the level-up control on it, answer each
   advancement step, and pick everything a step asks before clicking Next (a skipped choice is
   silently lost).
8. When they say it is done, run `references/sheet-check.md` against the new level: level and class
   levels, hit points up by the expected amount, the new features present, any open advancement
   (a choice that was skipped), spells within limits.

## Limits to say out loud

- You cannot see the advancement list; the level-up window on the sheet is the authority. If it
  offers something your list did not, trust the window and look the entry up by name.
- Multiclassing: check the prerequisites and the multiclass proficiencies from the entries before
  recommending; say it is worth confirming with the GM.
- Don't recommend anything outside the books the GM allows at the table.
