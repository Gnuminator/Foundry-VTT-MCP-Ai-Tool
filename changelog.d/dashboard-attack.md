### Dashboard

- **Attack from the combat strip:** a new Attack button opens a small form: who attacks (the combatant whose turn it is to start with), which weapon, and who is hit (another combatant, or the tokens you have targeted in Foundry, read when you press the button). One click rolls the attack against the target and the roll shows in the feed. If nothing is targeted in Foundry, the form says so and sends nothing. Spell attacks (cantrips) are not listed yet.

### Module

- **`use-item` can roll the attack:** a new `rollAttack` option makes the item's card with no dialog and rolls its first attack against the targets. An item with no attack stops with "has no attack to roll" before anything is used.
- **A token id works as the attacker:** `use-item` and `search-character-items` accept the id of a token on the scene, so an unlinked NPC token is found by its own actor even when several tokens share a name.
