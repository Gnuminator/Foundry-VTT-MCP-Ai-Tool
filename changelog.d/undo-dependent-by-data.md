### Fixes

- **Undo: a dependent effect deleted in another browser:** when dnd5e deletes a dependent (the
  effect concentration put on another actor, a template, a region, a summoned token) in another
  browser logged in as the same GM user as the bridge, the change history now files it under the AI change that ended
  the concentration by the deleted effect's own data, so the undo plan puts it back ("Also
  restored"). It no longer shows as a separate action of that person.
