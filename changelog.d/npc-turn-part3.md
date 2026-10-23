### NPC turn assistant (I-125, part 3)

- **Save-based actions and activities:** `plan-npc-turn` lists every activity of an NPC's items (attack, save, utility, legendary) and takes `activity` on an attack. A save-based action names the save to roll with `roll-saving-throws`, its DC, and what a success does to the damage.
- **Legendary actions:** planned on another creature's turn only, within the legendary actions left (refused on the NPC's own turn, or when the cost is more than what is left); a move taken as a legendary action covers at most half the speed. `use-npc-activity` takes `activity`, uses the activity (spending its legendary actions) and rolls its damage.
- **Roll first, then one plan:** after rolling, call `plan-npc-turn` again with the move and `results` (the damage each target takes, with `multiplier` 0.5 for half on a save). One guarded plan holds the move and every hit point change, so one confirm covers the turn and one undo puts it back. Damage goes through dnd5e's own rules, so resistance counts.
- Test for the creature-square note when the NPC ignores difficult terrain (PR #461 review).
