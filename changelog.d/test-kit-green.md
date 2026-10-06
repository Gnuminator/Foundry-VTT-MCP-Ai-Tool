### Test kit (D-090 lane 2)

- **Heroes get the ability scores of their class:** the standard array is placed for the class (15 in
  its primary ability, Constitution 13), so a Bard or a Sorcerer no longer has Charisma 8 and no
  uses of its Charisma features. Actor Studio heroes get the same scores.
- **Known findings per profile:** `heroes-advancement` and `heroes-features-use` count the CONTENT
  and SYSTEM problems on the profile's known list instead of failing on them, and a new problem still
  fails. The licensed list stays on this PC. The report has a "Known findings" section.
- **Fewer false failures in the feature checks:** a use that only recovers each turn (Sneak Attack)
  is not expected to spend outside combat, as in dnd5e; a grant named by a short `Item.<id>` uuid is
  looked up in its own pack (the College of Dance Unarmed Strike); and a CONTENT note names the pack
  the item came from, so a known-list entry can cover one pack's import gaps.
- **Pick coverage (slice 2a):** every pick records what the system offered, and the report's "Picks"
  section lists per class and choice the options no hero picked.
