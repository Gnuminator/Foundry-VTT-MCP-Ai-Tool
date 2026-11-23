# Character creation flow

Goal: the player ends up with a **build card** (a short list they follow in Actor Studio) and then
a checked sheet. You advise; they click.

**Our table starts at level 3** (the GM's decision, 2026-10-29; characters end at 13). Actor
Studio builds a level-1 character, so the build card has a level-1 part (the tabs) and a level-up
part (levels 2 and 3, with the subclass at 3). The build card must name both.

## 1. Ask first (two or three short questions, then wait)

- What do you want to play: a fantasy, a role at the table, a character you liked? (If they have
  none, offer three one-line concepts and let them pick.)
- Which ability score method does the GM allow: standard array, point buy, or rolling? Ask the GM
  or read the session 0 message if they don't know. Actor Studio offers only what the GM switched on.
- Anything the table or campaign restricts (books, species, a suggested background)?
- New to D&D, or experienced? (Sets how much you explain.)

## 2. Look up options (connector, core set)

1. `list-compendium-packs` once to see which books are installed. The Actor Studio lists are
   usually limited by the GM to the 2024 PHB module, so offer only choices that exist there.
2. For each candidate class, species and background, `search-compendium` the exact name, then
   `get-compendium-item` for the entry. Read what it gives; do not list from memory.
3. Suggest 2 or 3 combinations that fit the concept, one line each with why. The player picks.

## 3. The build card

Write it as a short list the player can follow, in this order (it matches Actor Studio's tabs):

1. **Ability scores:** the method and the score for each ability, highest where the class needs it.
   Do the arithmetic for point buy (27 points, scores 8 to 15 before the background).
2. **Species** (with the lineage, e.g. "Elf, High").
3. **Background:** the entry; which scores it can raise (+2/+1 or +1/+1/+1) and your pick; the feat
   it gives; the two skills it grants.
4. **Class** (no subclass in the builder tabs; the subclass is picked at the level 3 level-up).
5. **Choices Actor Studio will ask for, with your pick:** species skill (one the background does
   NOT give), languages, class skills (list), cantrips, level-1 spells, feat choices (e.g. Magic
   Initiate spells: PHB 2024 copies, only the named class's list).
6. **Equipment:** which Starting Gold options (background and class), whether to take gold.
7. **Name** (never leave the player's own name in the box).
8. **Level 2 and 3 (the level-up part):** the subclass for level 3 (look it up with
   `search-compendium`; the Actor Studio list holds only what the GM allowed, often fewer than the
   book), hit points (Take Average is the safe default), and the choices each level asks for (a
   wizard's level-2 Scholar skill for Expertise, an elf's spellcasting ability at level 3, a fighting
   style swap left as "No Replacement"). For a caster, also which spells they will add at levels 2
   and 3: the level-up raises how many they may prepare but does not ask which new spells they
   learn, so agree them on the card and tell them to add them on the sheet's Spells tab (or ask
   the GM).

Then tell them to follow `references/player/make-a-character.md` for the clicking, and to come back
when the sheet opens.

## 4. After they finish

Run the sheet check (`references/sheet-check.md`): read the character with `get-character`, compare
to the build card, and tell them anything that differs or looks wrong, as a short list with the fix
to click. The card matches the sheet when every line above is true on the sheet.

## Level 3 level-up snags

Rechecked on 2026-11-21 as Player on test server B: Foundry 14.370, dnd5e 6.1.1, Actor Studio
`2.10.5-aitool.13`, PHB module 3.0.0 (a Cleric built at level 1, then levelled to 2 and 3 with
Milestone Levelling on). Status per line: **kept**, **fixed** (in this build) or **changed**.
Tell the player about the kept and changed ones before they hit them:

- **No Level Up button** (kept, not retested with Milestone off). It shows only when Milestone
  Levelling is on (a GM setting) or the sheet has enough XP. Without it, the player asks the GM.
  With it on, a small Actor Studio logo sits in the sheet header, beside dnd5e's own "Level Up" text.
- **Click the "+" at the right end of the class row**, not the row (kept). At level 3 the **Choose
  Subclass** list appears under it at once; one click opened it both times (kept: if it does not open,
  click it once more).
- **Hit Points** (fixed): **Take Average** is already applied, FINAL shows the sum, and Next moves
  on with nothing to tick.
- **More than two Completes at level 3** (changed). After the class steps' **Complete**, the same
  window shows **Subclass Features** (Complete), then the subclass's spell step (for the Life Domain:
  "Life Domain Spells", Complete), then a **Spells** screen that says "No spell updates needed" with
  a **Finalize Spells** button. Click all of them; the subclass is on the sheet at the end. Stopping
  early leaves level 3 without a subclass (the sheet then offers **Add the subclass**).
- **Counters** (fixed, with a flaw): Next on a step whose counter is not full now opens **Choices
  still open** (**Go back** or **Continue anyway**), so a skipped choice is no longer silent. The box
  wrongly said "Chosen: 0 of 2" for the Magic Initiate cantrips although both showed as chosen;
  **Continue anyway** was safe there (the spells arrived). Check the counter on screen, not the box.
- **Spells learned** at levels 2 and 3 are not asked for (not retested: a Cleric prepares, it does not
  learn). For a wizard or other learner, add them on the Spells tab.
- **A red toast "User Kit Player lacks permission to update Actor"** (new) shows at the end of the
  build and of every Finalize Spells. The sheet is complete anyway; ignore it.
- **The Level Up window can fail to appear** (new, seen once after clicking the logo twice: the
  window stayed invisible). Reload the page (F5) and click the logo once.

## The ten level-1 snags (checklist for you and the player)

Rechecked on 2026-11-21 on the same build as above (`2.10.5-aitool.13`, dnd5e 6.1.1, an Elf, Acolyte,
Cleric build as Kit Player). The words on screen may differ a little in other versions. Mention the
ones that still apply before the player hits them:

1. **Character Name starts as the player's own name** (kept: "Kit Player"). The bar does not say
   100% at the start any more (it begins at 25%); it reaches 100% after the class pick whether or
   not the name changed. Replace the name before **Create Character**.
2. **Two windows at first join** (kept in part). A fresh Player gets Foundry's User Configuration
   at join and again after each reload until a Player Character exists. Studio sets it when
   **Create Character** is clicked ("Kit Player [Snag Cleric]" in the Players list), and the window
   then stops. No Studio welcome window appeared on the kit world (its welcome is switched off).
3. **A blank panel for about 5 seconds** after **Complete** (not reproduced). Species, background,
   feat and class steps all moved on in under 2 seconds; the class step to the Equipment tab took
   about 3. The guide keeps one line "wait, don't click again" as a hedge.
4. **Magic Initiate spell picker** (fixed): a **Select Spells** window of only the feat's class,
   each spell once. The class Cantrips list no longer offers cantrips the feat already gave (7 of 9
   Cleric cantrips shown). Still check the class, since a wrong class is not blocked (not retested).
5. **Equipment tab** (kept, reworded): first click the **Equipment + gp** or **gp only** tile of
   the background and of the class (bar 50%), then the dark **8 GP** and **7 GP** tiles at the
   bottom of each pane, and for each "any holy focus" tile the **Select focus** list at the top of
   the right pane (Amulet, Emblem or Reliquary). The bar goes 50, 75, 100% and **Confirm** appears at
   100%; a hint under the bar says so. After Confirm the chain shirt and the shield were equipped
   (the mace was not). Closing before Confirm drops the picks (a confirm box now asks first).
6. **Wizards have no Spellbook** (kept): the PHB equipment pack has no Spellbook item and the
   Wizard's kit has none either. A Wizard was not built in this run.
7. **Cosmetic** (mostly fixed): class steps are now headed "Cleric • Level 1", not "Level 1 -> 2".
   The raw key `GAS.Spells.Cantrip` is still not translated in the language file (kept, not seen on
   screen this run); the lingering spell card was not seen.
8. **Ability method** (changed, depends on the GM's settings): the kit world offers only **Manual
   Entry**, as plain number boxes you type in, not chevrons. With standard array or point buy on, the
   old chevron or list behaviour applies (not retested).
9. **A skill picked twice loses a proficiency** (softened): a skill the background already gives
   is now listed as "Insight (already given by your background)" and the class skill list leaves such
   skills out. Pick another skill anyway: the label does not stop the pick.
10. **Permission wording** (kept): the GM's setting is **Create Actors**; the refusal reads "User
    requires the 'Create New Actors' permission". Seen on the kit world until the GM role ticked it.

Also: a player cannot delete their own actor; the GM removes a wrong one. After the GM changes
Actor Studio settings, the player reloads the page (F5). Closing Studio with Escape in the middle
of the Advancements steps left a bare level-0 actor; after a reload the **Resume your character**
box appeared, **Resume** restarted the steps from the first, and the build finished (verified).
