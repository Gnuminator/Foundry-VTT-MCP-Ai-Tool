### Test kit

- **Level-1 character check (G0):** the `player-character-creation` scenario now also checks a
  new character's ability scores (the background's +3 on what the player entered, nothing above
  20), its saving throws (exactly the class's), the skills, tools, weapons, armor and languages the
  class, species and background grant, that no free choice was skipped, and the proficiency bonus.
  The expected values come from the picked items' own Trait advancements, so no book text is
  stored. A wizard without a Spellbook item is reported as a note.
