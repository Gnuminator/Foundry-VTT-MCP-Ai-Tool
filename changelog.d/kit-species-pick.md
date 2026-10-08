### Developer tools (D-102)

- **Test kit picks the species it plans:** the Actor Studio drop-downs carry no uuid, so the kit
  picked "Elf, High" by its shortened label "Elf" and every elf became a Drow (every gnome the first
  gnome) without a failure. Species, background, class and subclass are now picked from the uuid:
  by the full label when the list shows it (Actor Studio 2.10.5-aitool.4 does), else by the entry's
  position among the pack's entries that shorten the same way, and a count mismatch fails the pick.
  The log line says which group heading matched, or that none did and the whole list was searched.
  `player-character-creation` also fails a character whose species, class or background item does
  not come from the picked uuid (a 2014 and a 2024 Fighter share an identifier), and notes any
  feature or spell name that sits on the sheet twice, with each copy's type and what granted it
  (gear and the copies dnd5e keeps for a Cast activity, such as Favored Enemy's free Hunter's Mark,
  are left out).
