### Module

- **Creature queries during an index build (#283 review low 2):** while the Enhanced Creature
  Index builds (the first load after a module update, or after a compendium change; longer than
  the bridge's 10 s on the Pi), list-creatures-by-criteria answers after 8 s that the index is
  building and to try again in a minute, instead of timing out. The build carries on.
  search-compendium with creature filters falls back to its name search meanwhile.
