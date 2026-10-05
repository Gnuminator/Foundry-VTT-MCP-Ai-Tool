### Live play (I-112)

- **Scene dressing now shows in Recent Changes with Undo.** Placing an area template, clearing
  templates, changing the darkness or global light, adding or removing a map pin and giving loot
  to a character used to write at once and leave no trace. They are now planned changes like
  damage and conditions: Claude shows the plan, the change is listed in the dashboard's Recent
  Changes, and Undo puts it back (the old balance, the removed item, the old darkness). Removing a
  template or a pin still asks for the second, destructive confirm. They follow the "AI Tool: Live
  play (writes)" switch, and "apply without confirming" covers them too, except when something is
  removed.
- **Six tools replaced by two.** `plan-scene-change` (actions template, clear-templates, mood,
  note, remove-note, loot) replaces `place-measured-template`, `delete-measured-template`,
  `set-scene-mood`, `add-map-note`, `delete-map-note` and `drop-loot`. `play-playlist` plays or
  stops a playlist by name (music was part of `set-scene-mood`; it stays direct, there is nothing
  to undo). The bridge now serves 84 tools; the play set has 29.
- **Loot reports bad item UUIDs** in the plan (`skippedItems`) instead of skipping them quietly,
  and a loot plan lists only the five dnd5e coins.
- **Readable lines in Recent Changes** for darkness, global light, coins and map notes (a map note
  is named by its label).
