### Fixes

- **`use-npc-activity` acts on the token, not the world actor:** on an unlinked token (a boss placed
  from the sidebar) a legendary action or a limited use was spent on the world actor, so the token's
  own pips and the dashboard never changed. The tool now looks for a token on the current scene first
  (by token name or id, or the only token made from the given actor's name or id) and falls back to
  the world actor. Damage, healing and conditions resolve their targets the same way, so an actor id
  from the dashboard's picker now reaches a lone unlinked token there too.
- **`get-character` reads that token too:** after a boss spent a legendary action, the sheet still
  showed the world actor's full pool. It now uses the same rule (a token on the current scene by
  name or id, or the only token made from that actor), so the sheet matches what was spent. Several
  tokens from one actor still read the world actor.
