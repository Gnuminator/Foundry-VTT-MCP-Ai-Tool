### Dashboard

- **The React dashboard gets the Tarokka drawer (D-109):** a 🃏 Tarokka button on `/next/` shows
  the five positions of the current reading, their links and whether each is revealed, as the old
  page does. **Import from tarokka-reading**, **New reading** and a **Link** pick apply in one
  click with an Undo toast; **Reveal** opens the confirm window and waits for the "I understand"
  tick. With **Show cards** off the card names and notes are no longer on the page at all, only a
  blurred placeholder, and the box unticks when the drawer closes. An open link search or reveal
  draft now survives a reload, a failed reload keeps the reading under the error, and a link
  search shorter than two characters says so without asking the bridge. With GM Actions off
  nothing is planned. The 📓 Obsidian link shows once the vault and the world are known.
