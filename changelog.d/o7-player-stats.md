### Obsidian (I-052 O7)

- **Player vault: My stats:** each player vault gets a `My stats.md` note with the campaign so far
  (sessions, time played, fights, rounds) and the numbers of the player's own characters (damage
  taken, healing, times down, spells, slots, coins, experience). Built from `get-play-stats`
  through an allowlist, so GM-only data never reaches it: no highest roll, crits, fumbles or d20
  tallies (the play log does not record a roll's visibility yet), no damage dealt, loot names,
  scene names, user names or other players' characters. The spoiler canary now plants a value in
  every excluded field and checks the exact set of files in each vault.
