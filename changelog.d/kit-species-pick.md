### Developer tools (D-102)

- **Test kit picks the species it plans:** the Actor Studio drop-downs carry no uuid, so the kit
  picked "Elf, High" by its shortened label "Elf" and every elf became a Drow (every gnome the first
  gnome) without a failure. Species, background, class and subclass are now picked from the uuid:
  by the full label when the list shows it, else by the entry's position among the pack's entries
  that shorten the same way, and a count mismatch fails the pick. `player-character-creation` also
  fails a character whose species item does not come from the picked uuid, and notes any item that
  sits on the sheet twice, with what granted each copy.
