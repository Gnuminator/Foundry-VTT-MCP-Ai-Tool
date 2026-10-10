### Dashboard

- **React dashboard: Tool runner review follow-ups (#267):** `apply-planned-change` and
  `undo-change` no longer show their `confirm` and `confirmDestructive` ticks (the confirm window
  answers them), so the form has no required `confirm` box and the Undo window no longer lists
  "confirm: false". The confirm window shows a picked value after its name ("Vallaki (s2)"), so two
  scenes or tokens of the same name stay apart. Number fields name text that is not a number
  instead of dropping it, and a picker's Show all and filter no longer carry over to another tool.
  An Undo from a Tool runner toast that GM Actions refuse says the Tool runner's text and opens the
  Tool runner at its GM Actions bar, even after the drawer closed.
