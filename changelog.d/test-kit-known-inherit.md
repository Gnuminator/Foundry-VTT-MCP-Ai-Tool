### Test kit (D-090 lane 2)

- **Known findings on the licensed profile:** a profile names the profiles whose known lists count
  for it too (`"knownAlso": ["srd"]` in the licensed profile, because it includes the system's own
  packs), its own entries first; `spells-cast-all` reads the known list like the other scenarios;
  a monster finding ends with the monster's pack and a spell finding with the spell's pack, so an
  entry's `match` can name the pack and the same creature in two packs is told apart.
