### Tarokka (tarokka-table; D-130 step 2)

- **A Tarokka card table in Foundry:** the AI Tool group in the scene controls has a **Tarokka
  table** button (GM only). Place the five cards face down one at a time, flip them one at a time,
  and **Show to players** opens the table on every player's screen: they see the backs of placed
  cards and the faces of flipped ones, never the position names, the notes or a card that is not
  flipped. Cards are drawn in CSS; a card can get a picture from the world's files. A flip is a
  normal Tarokka reveal, so the dashboard drawer and the player page follow it. This replaces the
  community module `tarokka-reading`.
- **No more `tarokka-reading` import:** `plan-tarokka-import` no longer takes `source:
"tarokka-reading"` or `userId`, the dashboard drawer lost its **Import from tarokka-reading**
  button, and the "Offer this reading to the AI Tool?" dialog is gone. Roll a reading or choose the
  five cards. Readings stored earlier from the module still open.
