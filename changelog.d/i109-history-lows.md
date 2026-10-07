### Undo for everything (I-109 history lows)

- **dnd5e's dependent deletes stay with the AI change:** when the AI deletes an effect or an
  item (ending concentration), the effects on other actors, the templates, regions and summoned
  tokens dnd5e removes with it no longer show as the GM's own change. Undoing that change puts
  them back too (the plan says how many), and a redo takes them away again: the module deletes
  a dependent before the effect that names it, and in an undo a document dnd5e already removed
  counts as done instead of failing the whole plan (and a later undo of that undo leaves it
  alone, with a "Left alone" line, instead of re-creating it from nothing). What dnd5e changes on the AI's own target
  (Bloodied) is left to dnd5e. Fast consecutive AI changes that land in one burst are now one
  history action each, so a follow-up stays with the change that caused it. The live write
  sweep has the case (an AI-ended concentration, undone and redone).
- **Lost journal records move the history start:** when the GM browser's change buffer wraps
  before the bridge read it, the bridge remembers from when the records are complete again, and
  `list-changes` and a rewind say so (with the time of day) instead of skipping people's changes
  without a word. A GM browser reload while the bridge is down still leaves no trace; the file
  comment says so.
