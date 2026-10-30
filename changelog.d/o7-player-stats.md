### Obsidian (I-052 O7)

- **Player vault: My stats:** each player vault gets a `My stats.md` note with the campaign so far
  (sessions, time played, fights, rounds) and the numbers of the player's own characters (damage
  taken, healing, times down, spells, slots, coins, experience). Built from `get-play-stats`
  through an allowlist, so GM-only data never reaches it: no unfiltered roll numbers (only public
  rolls count, see the roll stats entry), no damage dealt, loot names,
  scene names, user names or other players' characters. The spoiler canary now plants a value in
  every excluded field and fails on any file kind it does not know in a vault.
