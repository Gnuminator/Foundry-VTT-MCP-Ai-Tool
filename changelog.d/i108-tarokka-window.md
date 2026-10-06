### Module (I-108 part 3)

- **"Tarokka" window inside Foundry:** the **AI Tool** group in the scene controls gets a
  **Tarokka** button (GMs only). The window shows the current reading (source, when it was dealt or
  imported, how many are archived) and its five positions. Card names and ids and the GM's notes are
  hidden ("Card hidden") until the **Show cards** tick is on; the tick is unticked whenever the window
  opens or closes and survives a refresh. Each position has **Open Journal / Scene / Actor** buttons
  or "not linked", a "revealed" badge with **Open page**, or "hidden from players". **Reveal...** on an
  unrevealed position opens an inline form (the text the players read, 1 to 5000 characters; an
  optional title; a **Show it now** tick that is unticked every time the form opens). Reveal plans it,
  asks you to confirm in a Foundry dialog that shows the plan's summary and diff, then applies it;
  cancel does nothing. Linking cards and dealing or importing a reading stay in the dashboard or with
  Claude. The window refreshes when the backend records a change and has a Refresh button; typed
  text and ticks stay across those refreshes.
- **Module requests can now plan a Tarokka reveal and read the reading:** `MODULE_REQUEST_TOOLS`
  adds `get-tarokka-reading` and `plan-tarokka-reveal`, and `MODULE_PLANNERS` gets the one line
  `plan-tarokka-reveal` (feature `tarokka`). The apply rule is unchanged: only a plan a module
  planner made through a module request can be applied from a window, and only with `planId`,
  `confirm` and `confirmDestructive`. Linking and importing are still not reachable.
- **Handouts window: "Show it now" no longer unticks itself on a redraw.** A refresh or a change-log
  signal used to clear the tick while you were deciding. It is now kept while the window is open,
  and cleared after each reveal (confirmed, cancelled or failed) and when the window closes.
