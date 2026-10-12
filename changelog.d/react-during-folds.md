### Dashboard

- **The During folds in the new dashboard:** the four During cards (Live Feed, Recent Changes,
  Handouts and Party) have a fold button first in their head, as in the full dashboard. A folded
  card shows only its head, and a click on its title opens it. Each layout starts with the same
  cards folded as before (Cards folds Handouts and Party, Simple/Full folds nothing, Auto in a
  fight folds the feed and opens Party, and a phone folds the feed). On a screen 900 px wide or
  more, opening a side card folds the other side cards. The Live Feed and Recent Changes are still
  placeholders there, with the same head and button.
- **Your fold choices are kept:** in the full dashboard the folds started over every time a fight
  began or ended and every time the window crossed 600 or 900 px. In the new dashboard a card you
  folded or opened stays that way for the same layout, fight and width, until you reload the page.
  Auto still shows its combat look the first time a fight starts, and going back to calm gives you
  the calm cards as you left them. Leaving During and coming back keeps the folds too, and a
  folded card keeps what it loaded.
- **The fold button has a name:** screen readers hear "Fold Party" or "Open Party", with the state
  and the card body it controls. The title click stays a pointer shortcut; the button is the
  keyboard way. The four fold clicks (`dash.during.fold-feed`, `-changes`, `-handouts`, `-party`)
  are now in the usage catalogue, so the usage report can say when they were never used.
- **Fix:** a stale comment in the stylesheet said a folded card keeps its count; no card shows one.
