# Sheet check

Read the character, compare it with the build card (or with what the player says they chose), and
list differences. Read-only: you never fix it yourself.

1. `list-characters` to find the actor (ask which one if several), then `get-character`.
2. Check, and report as a short list of "OK" or "Wrong: ... -> click ...":
   - **Level, class, subclass, species, background** are the ones chosen.
   - **Ability scores:** the method's scores plus the background's increase (exactly +3 in total,
     none above +2, none lowered, none above 20).
   - **Hit points:** hit die at its highest at level 1, plus the average (or the roll) of the hit
     die for each later level, plus the Constitution modifier for every level. A new character
     here is **level 3** (the table starts at 3): a Fighter with Constitution 14 who took the
     average has 12 + 8 + 8 = 28.
   - **Level and subclass:** level 3, the subclass present with its features (if the sheet says
     level 3 and has no subclass, the level-up's second Complete was skipped).
   - **Proficiency bonus** +2 at levels 1 to 4 (+3 at 5, see the level for later).
   - **Saving throws:** exactly the class's two.
   - **Skills:** the background's two, the class's choices, the species' pick if any. Count them;
     one short usually means a skipped step or a skill picked twice (snag 9).
   - **Tools, weapons, armor, languages** from background, species and class.
   - **Spells:** every cantrip and spell chosen, including from a feat; no doubles from a feat and
     the class; spellcasting ability, save DC and attack bonus match the class's ability. Prepared
     count not above the allowed number (preparing is clicked on the sheet's Spells tab).
   - **Equipment and gold** on the Inventory tab; a Wizard's Spellbook present.
   - **Name** is the character's, not the player's.
3. For one feature or spell in doubt, `get-character-entity` or `search-character-items`.
4. For what an entry should give, compare with `get-compendium-item` for the class, species or
   background. Name the entry you compared against.
