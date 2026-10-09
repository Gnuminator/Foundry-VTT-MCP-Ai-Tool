### Dashboard

- **The React dashboard gets the Tarokka drawer (D-109):** a 🃏 Tarokka button on `/next/` shows
  the five positions of the current reading, their links and whether each is revealed, as the old
  page does. **Import from tarokka-reading**, **New reading** and a **Link** pick apply in one
  click with an Undo toast; **Reveal** opens the confirm window and waits for the "I understand"
  tick. With **Show cards** off the card names and notes are no longer on the page at all, only a
  blurred placeholder, and the box unticks when the drawer closes. An open link search or reveal
  draft now survives a reload, a failed reload keeps the reading under the error, and a link
  search shorter than two characters says so without asking the bridge. With GM Actions off
  nothing is planned. The 📓 Obsidian link shows once the vault and the world are known. One
  change runs at a time in the drawer: while a reveal waits on its plan or its confirm window,
  Import, New reading and the other Link and Reveal buttons wait too, so a reveal can no longer
  land on a card a new reading just dealt. A reveal that went in closes its form and clears the
  text, so a second click cannot plan it again as an update of the players' page.
