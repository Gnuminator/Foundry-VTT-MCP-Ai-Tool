### Paper nights (Paper nights A)

- **Sync a paper sheet back into Foundry:** the new Play tool `plan-paper-sync` takes the numbers on
  one paper character sheet and plans them as one change for that character, with the usual confirm
  and Undo. It covers hit points and temp HP, spell and pact slots, hit dice per class, class
  resources and item uses, the five coins, exhaustion, the exact set of conditions, inspiration,
  death saves (reset) and item quantities (a quantity of 0 removes the item and asks for the second
  confirm; a compendium uuid adds one). Every value is what the sheet says now, only changed fields
  become part of the plan, and a value above its maximum refuses the whole request. XP, level, class
  and max HP are never changed. It ships off: turn on "AI Tool: Paper sync (writes)" in Foundry's
  module settings. It never applies without confirming.
