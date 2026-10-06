### Obsidian (R4)

- **Seen in:** NPC and scene notes list the play sessions where they appeared, newest first, each
  linking its session note, and carry a `last_seen` date property. It is built from Foundry ids in
  the play log, never from names, and only while a player is connected: an NPC counts when it
  acted at the table (a roll, item use or chat that was not whispered or blind, damage or healing,
  a condition, a combat turn) or had a visible token on the active scene. GM prep, creating,
  placing or moving tokens, and scenes the GM only previews never count. PCs get no list (their
  stats note covers it). The
  export writes the index to the bridge vault (`gm/obsidian-seen.json`) and the mirror re-renders
  only the notes whose list changed.

### Module

- **Scene snapshots in the play log:** `scene` records carry `data.active` (the active scene, or
  a GM preview), `data.players` (the players online) and `data.tokens`: the tokens on that scene,
  folded by world actor (uuid, name, PC or NPC, hidden only when all its tokens are), at most 200
  with visible actors kept first. `user-join` and `user-leave` records carry `data.isGM`; a
  player's `user-join` adds `data.activeSceneId` and the active scene's `data.tokens`. Rolls and
  item use carry `data.whisper` and `data.blind` when set. Older records lack these and still read
  fine (their sessions list nothing).
