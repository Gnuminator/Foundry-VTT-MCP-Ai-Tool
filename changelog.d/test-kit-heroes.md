### Test kit (D-090 lane 2)

- **Every class and subclass, leveled and checked (slice 2a):** the kit builds heroes through
  dnd5e's own advancement with no dialogs, from a content profile (`--profile srd` in the repo; a
  licensed profile only on this PC). Smoke: every class at 5. Full: every class at 1, 5, 11 and 17
  plus every subclass at 20, 2024 and remaining legacy versions. Choices rotate through the options
  so the matrix picks each one. The new `heroes-advancement` scenario compares every hero with its
  class and subclass data (granted features, scale values, HP, spell slots, skills, saves) and
  classes each failure as KIT, CONTENT or SYSTEM. One hero belongs to Kit Player, so the player
  page check now covers the player character HP rules. Reports show coverage and build console
  errors.
