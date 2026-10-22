### NPC turn assistant (I-125, npc-turn-more; still off by default)

- **Multiattack:** `plan-npc-turn` takes `attacks` (an item and a target each, up to 10). Every
  attack is checked for reach, and a melee attack with a wall or closed door in between is refused.
  The context shows the text of the monster's Multiattack feature, so Claude can see how many
  attacks it gets.
- **Walls, doors and difficult terrain:** the move is found with a path search instead of a
  straight count. Walls and closed doors block (Foundry's own check when the map is drawn, the
  scene's wall data otherwise), hostile creatures cannot be walked through (allies can), and
  movement-cost regions multiply the cost of the squares they cover. The plan returns the path and
  what it costs.
- **Smarter targets:** each enemy shows whether it is concentrating, prone or at 0 hit points, the
  cheapest square to attack it from this turn, and a score with the reasons (lowest hit points,
  concentrating, prone for melee or ranged, bloodied, out of reach). The context names the
  suggested target.
- **Review lows from PR #414:** diagonals follow the world's `gridDiagonals` setting (alternating,
  exact, 1.5 and 2 included); hex and gridless scenes are refused; squares past the scene edge or in
  the padding are refused, by the whole footprint of a large token; tokens on other Foundry 14
  levels are left out as blockers and targets; a combat on another scene is not used; a speed kept
  in other units than the scene (metres, miles) is converted, or refused when it cannot be;
  `dash: true` plans twice the speed; a weapon keeps its normal range when its activity holds the
  long range; a familiar is refused as player-owned, not as a player character.
- **Tool budget:** the play tool set budget in `tool-catalog.test.ts` is raised by 1,000
  characters for the new fields.
