### Module (I-106)

- **Advantage or disadvantage on rolls:** `request-player-rolls`, `request-ability-check`,
  `request-attack-roll` and `roll-npc-check` take an optional `advantage` (`advantage` or
  `disadvantage`). It goes into dnd5e's own roll, so it combines with the roller's conditions
  (advantage against a poisoned roller comes out normal). Left out, dnd5e decides as before. The
  request card names a chosen mode.
- **NPC rolls use dnd5e:** `roll-npc-check` now rolls through dnd5e, so an NPC's conditions (poisoned,
  prone) apply, and the reply carries `mode` (advantage, disadvantage or normal).
