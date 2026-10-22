### Dashboard (Paper nights B; paper-form)

- **After a paper night:** a new drawer in the dashboard (Advanced menu, and a card in After) for
  syncing the paper sheets back into Foundry. One card per player character, filled in from the
  sheet in Foundry; type what the player reads from the paper sheet (HP and temp HP, spell slots,
  hit dice, class resources and item uses, coins, exhaustion, conditions, inspiration, death
  saves, inventory quantities, and new items from the compendium picker). **Plan** builds one
  guarded `plan-paper-sync` plan for that character from the fields that changed; the confirm
  window lists what changes (removing an item asks for the second confirm), Apply writes it, and
  Recent Changes holds one Undo per character. A "Which night was this?" date can log the night as
  a paper session. Needs GM Actions and the "AI Tool: Paper sync (writes)" switch.
