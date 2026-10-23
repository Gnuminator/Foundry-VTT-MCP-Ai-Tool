### Rules check

- **Advice before you act:** with "AI Tool: Rules check" on, `use-item`, `request-attack-roll` (when the player name is a character and the weapon is one of its items) and a token move in `plan-token-change` now add the rules check to their reply (turn, cost, range, slots, uses). It only advises: nothing is refused or delayed, and with the switch off or on any error the reply is unchanged.
- **Movement check:** a planned move in a fight is compared with the creature's walking speed (or best other speed): within speed passes, up to twice the speed needs the Dash action, beyond that is flagged. Distance is a straight line, so route, difficult terrain and movement already used this turn are not counted.
- **Concentration:** `check-action` warns when a concentration spell would end the concentration the caster already holds, and says which spell.
