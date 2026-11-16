# Level-up flow (advise only)

The player clicks the level-up in Foundry; you tell them what they will be offered and help them
choose. dnd5e's advancement is interactive (hit points, ability score improvement or feat,
subclass, spells, choices), and you have no tool that runs it.

## Steps

1. `get-my-character` for the character (give the name if the player has several). Note class
   levels, subclass, the current level and the total level, ability scores, feats, known and
   prepared spells, and resources.
2. Work out what the next level grants and what is chosen: call `get-my-level-up-options` with the
   character's name (and `className` for a multiclass character). It only reads. It says what the
   next level grants, which choices are open (hit points, ability score improvement or feat,
   subclass, spells, items) and any earlier advancement left unfinished. Then look each feature up
   by name (`find-book-entries` for the feature, then `get-book-entry`) and read what it does. If
   the tool returns nothing for a class, or a feature's name finds no entry, say so and say that
   the level-up window in Foundry shows the real list. Choices to look for: subclass (level 3),
   Ability Score Improvement or feat, expertise, fighting style, spells. For a subclass, find it by
   name the same way.
3. For each choice, `find-book-entries` / `get-book-entry` the candidates (feats, spells,
   features) and read them. Never describe an option from memory alone. Note that a name can exist
   in several books: prefer the 2024 one.
4. Answer as: **What you get automatically** (one line each, with the entry name), then **What you
   choose**, each with two or three options, what it does for _this_ build in a sentence, and the
   entry name. Give one recommendation with the reason. The player decides. For a "which is best"
   question, follow ground rule 8 of the skill (your reasoning, labelled as opinion; the Dungeon
   Mister link is optional).
5. **Hit points:** tell them the choice (average or roll) and the result of each for their hit die
   and Constitution modifier; the average is the safe default.
6. **Spells:** for a caster, say how many are known or prepared at the new level (from the class
   table), which spell levels they can now take, and which of their current spells they may swap.
7. Tell them where to click: open the character sheet, use the gold **Level Up** button on it
   (shown only when the GM switched on Milestone Levelling or the sheet has the XP), click the **+**
   at the end of the class row, **Add Character Level**, tick **Take Average** (Next waits for it),
   answer each advancement step, and pick everything a step asks before clicking Next (a skipped
   choice is silently lost). **Level 3 (subclass):** pick it in **Choose Subclass** first, and click
   **Complete** in the second window that lists the subclass's features, or the subclass is not
   added. A caster's level-up does not ask which spells they learn: tell them to add those on the
   Spells tab.
8. When they say it is done, run `references/sheet-check.md` against the new level: level and class
   levels, hit points up by the expected amount, the new features present, any open advancement
   (a choice that was skipped), spells within limits.

## Limits to say out loud

- `get-my-level-up-options` reads only; the level-up window on the sheet is the authority. If it
  offers something the tool did not list, trust the window and look the entry up by name.
- Multiclassing: check the prerequisites and the multiclass proficiencies from the entries before
  recommending; say it is worth confirming with the GM.
- Don't recommend anything outside the books the GM allows at the table.
