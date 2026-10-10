### Dashboard

- **Screen readers hear a panel change state (React dashboard):** "Loading…" is now a polite
  status message and a failure (an error, the bridge being down, a switch being off) an alert, so
  a screen reader says when a panel starts loading or fails. A panel's body is marked busy while
  it loads, and loading bars keep their "Loading…" text for screen readers. In a list the role sits
  inside the row, so the list keeps its items. Nothing changes on screen.
- **Close buttons no longer say "Close" twice:** the tooltip on the close buttons of drawers and
  panes now reads "Close (Esc)", so a screen reader hears the name and the shortcut instead of the
  same word twice. An icon button now needs a tip that adds to its name.
