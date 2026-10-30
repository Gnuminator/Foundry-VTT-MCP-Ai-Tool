### Fixes

- **Live Feed damage line:** a Damage apply from the dashboard now reads "Wolf 1 took 5 fire damage (HP 11 to 6)" in the Live Feed, with the type and the hit points before and after. The separate "Applied: ..." row of the same change is folded into it. Recent Changes is unchanged.
- **Undo of a drop to 0 HP:** dnd5e's follow-ups of an AI change (Unconscious and Prone when a character goes down, Bloodied and Unconscious removed by the undo) stay in the AI change's group when they start up to 3 seconds after the write (the limit was 0.3 seconds), so a slow link no longer shows them as someone's own change next to the undo.
- **End combat and the other combat tools:** End combat, Next turn, set initiative and roll initiative act on the fight the combat strip shows, also when the GM browser that answers views another scene than the fight is on (it used to say "No active combat" there, though the dashboard and Foundry's tracker showed the fight).
