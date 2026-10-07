### Undo for everything (I-109 history lows)

- **dnd5e's dependent deletes stay with the AI change:** when the AI deletes an effect or an
  item (ending concentration), the effects on other actors, the templates, regions and summoned
  tokens dnd5e removes with it no longer show as the GM's own change.
- **Lost journal records move the history start:** when the GM browser's change buffer wraps
  before the bridge read it, the bridge remembers from when the records are complete again, and
  `list-changes` and a rewind say so (with the time of day) instead of skipping people's changes
  without a word. A GM browser reload while the bridge is down still leaves no trace; the file
  comment says so.
