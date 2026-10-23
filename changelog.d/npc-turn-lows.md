### NPC turn assistant (I-125, npc-turn-lows; still off by default)

- **Walls on the NPC's level:** the wall check uses the level and elevation of the NPC's token, not
  the level the GM is looking at. Foundry's own collision test gets that level, and the scene-data
  fallback leaves out walls that belong to other levels.
- **Who blocks follows dnd5e:** a creature of another disposition (neutral too) blocks unless it is
  two sizes apart, Tiny (modern rules), dead or unconscious, a non-creature or a hidden token; none
  blocks when the dnd5e movement automation is not "full". Walking through a creature's square costs one square more (allies too under the
  legacy rules; not at all when the creature ignores difficult terrain). When the map is drawn the
  plan asks dnd5e's own `isOccupiedGridSpaceBlocking` and `isOccupiedGridSpaceDifficult`.
- **Dash:** a Dash takes the action, so `plan-npc-turn` refuses attacks after a Dash unless `reason`
  names a bonus-action Dash (then the attack steps say so).
- **Previews say the token is placed:** the `plan-npc-turn` move step and the `plan-token-change`
  move preview now say the token is placed, not walked, and that Foundry's ruler does not count it
  (in a started combat it still shows the full speed). `plan-token-change` also warns when a wall or
  closed door lies between the old and the new square.
- **Multiattack text:** `&Reference[condition=prone]` and `&Reference[prone apply=false]` show as
  "prone", and `&mdash;`, `&rsquo;`, `&hellip;` and the other common named entities are decoded.
