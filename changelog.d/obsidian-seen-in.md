### Obsidian (R4)

- **Seen in:** NPC and scene notes list the play sessions where they appeared, newest first, each
  linking its session note, and carry a `last_seen` date property. It is built from Foundry ids in
  the play log, never from names: an NPC counts when it acted or changed in a session, or had a
  visible token on the scene the GM showed. PCs get no list (their stats note covers it). The
  export writes the index to the bridge vault (`gm/obsidian-seen.json`) and the mirror re-renders
  only the notes whose list changed.

### Module

- **Scene snapshots in the play log:** `scene` records, and `user-join` records of players, carry
  `data.tokens`: the tokens on the scene the GM is viewing, folded by world actor (uuid, name,
  PC or NPC, hidden only when all its tokens are). At most 200 actors. Older records lack it and
  still read fine.
