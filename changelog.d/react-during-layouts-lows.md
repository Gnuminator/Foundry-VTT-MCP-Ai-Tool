### Dashboard

- **Screen choices saved at the same time no longer undo each other (new dashboard):** when two
  saves overlapped (a layout click while the quiet hint count was still being saved, for one) and
  the first failed, the page put back the old values of the whole object and lost the second
  choice from the screen. A failed save now takes back only its own fields, and an older answer
  that arrives after a newer change is ignored.
- **The layout trial is easier to follow with a screen reader (new dashboard):** the step is
  announced from a live region that is always in the page, so the first step is no longer missed.
  After "Use this one" or "Stop" the focus moves to the layout button instead of dropping to the
  page. The layout buttons, "Use this one" and Combat buttons now say why they are off (Foundry has
  not told the dashboard which world it is yet) in a way a screen reader reads, not only in a
  tooltip.
- **Escape closes a tooltip or popup first (new dashboard):** with the layout trial running, an
  open tooltip or popup takes the Escape key and the trial goes on; the next Escape ends it.
