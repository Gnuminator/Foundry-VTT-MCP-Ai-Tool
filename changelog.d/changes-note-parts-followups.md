### Obsidian

- **Long Changes months open the right part:** the dashboard's 📓 link on a change now opens the
  `-p2`, `-p3` note that holds it (`list-recent-changes` adds a `notePart` per change). Each Changes
  note has a `part` property and the Changes base sorts a split month by it. Tests cover a session
  note linking to a `-p2` note and an export of more than 400 changes pruning a part that is gone
  (PR 911 review lows).
