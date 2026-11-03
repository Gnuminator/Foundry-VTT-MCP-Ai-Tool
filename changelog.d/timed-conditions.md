### Fixes

- **Timed conditions after a reload:** the rounds left and "ended" on a condition chip are worked out
  from the effect's stored start round against the running combat, so a GM reload no longer turns
  "ended" into a plain chip, and an overdue effect reads "ended", never "1 round". The During combat
  strip now shows the same chip text as the Live strip. The player view still shows only the
  condition names Foundry reports, with no timers.
- **Undo of a timed condition after a turn:** the undo conflict check for a condition added by the AI
  (and a planned removal of any condition) ignores what Foundry rewrites by itself as turns pass; a real edit to the effect still refuses
  the undo. A refused undo shows one plain line and the strip stops offering it. A condition that ends on the combatant it was put on (not its holder) and one put on in a fight that has since ended are counted the way Foundry counts them.
