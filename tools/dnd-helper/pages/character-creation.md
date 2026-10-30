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

## Level 3 level-up snags (found live on server C, 2026-10-29)

Tell the player before they hit them:

- **No Level Up button.** It shows only when Milestone Levelling is on (a GM setting) or the sheet
  has enough XP. Without it, the player asks the GM.
- **Click the "+" at the right end of the class row**, not the row. At level 3 the **Choose
  Subclass** list appears under it; it may need a second click to open.
- **Take Average** must be ticked (or HP rolled) before Next moves on from the Hit Points step.
- **Two Completes at level 3.** After the last step's **Complete**, a second window lists the
  subclass's features (e.g. "Champion, Level 2 -> 3, Step 1 of 1"); its **Complete** is what adds
  the subclass to the sheet. Skipped, the sheet says level 3 with no subclass.
- **Counters:** a skipped choice (the wizard's Scholar Expertise) is silently lost, because Next lets the player through.
- **Spells learned** at levels 2 and 3 are not asked for (see the build card, point 8).

## The ten level-1 snags (checklist for you and the player)

Found in a real run on Foundry 14 / dnd5e 6 / Actor Studio 2.10.5. Mention the ones that apply
before they hit them, and re-check after:

1. **Character Name starts as the player's own name**, and the bar says 100% before any name is
   typed. Replace it before **Create Character**.
2. **Two windows at first join** (the Actor Studio welcome and Foundry's User Configuration). Close
   both; User Configuration returns each join until a Player Character is chosen (right-click your
   name in the Players list, **User Configuration**, **Player Character**).
3. **A blank panel for about 5 seconds** after **Complete** in the species, background feat and
   class steps. Wait, don't click again.
4. **Magic Initiate spell picker** is Foundry's compendium browser: every spell appears up to four
   times (SRD 5.1, SRD 5.2, PHB, **PHB 2024**; pick PHB 2024), and Cleric, Druid and Wizard lists
   are mixed (pick only the class named after Magic Initiate). The class Spells tab still offers
   cantrips already given by the feat: avoid doubles.
5. **Equipment tab:** the items turn green by themselves; the gold amounts stay black until
   clicked. Click each until the bar says 100%, then **Confirm**.
6. **Wizards have no Spellbook** in the starting kit. The GM adds one from the item compendium.
7. **Cosmetic only:** the raw key `GAS.Spells.Cantrip` under chosen cantrips, class steps headed
   "Level 1 -> 2", a spell card lingering at the bottom right.
8. **Ability method:** with only one method on, there is no list to open; only the chevrons move
   scores (standard array).
9. **A skill picked twice loses a proficiency.** Species steps come before the background's, and
   the background's fixed skills are not offered again. Tell an Elf (Keen Senses) to pick a skill
   the background does not give.
10. **Permission wording:** the GM's setting is **Create Actors**; the refusal says "Create New
    Actors". If a player cannot open Actor Studio, the GM must tick it for the Player role.

Also: a player cannot delete their own actor; the GM removes a wrong one. After the GM changes
Actor Studio settings, the player reloads the page (F5).
