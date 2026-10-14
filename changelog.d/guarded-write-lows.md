### Fixes

- **Combat strip on another scene:** Damage, Heal, Condition and Clear on a picked combatant now
  work when the fight runs on another scene than the one being viewed. The module also looks the
  token id up among the combatants of the fight the strip shows (by id only, never by name).
- **Live Feed:** the event list is a keyboard tab stop only when it scrolls.
- **Help pane:** after a link to another guide, keyboard focus stays in the pane instead of
  dropping to the page.
- **Undo leaves no empty objects in the vault files:** undoing a Tarokka link, a reveal or a first
  import no longer leaves an empty `{}` per card or page in `gm/tarokka-config.json`,
  `gm/reveals.json` and the other vault files. Readers treat a missing object like an empty one.
