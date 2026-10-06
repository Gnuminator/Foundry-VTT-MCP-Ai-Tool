### Test kit (D-090 lane 2)

- **Heroes built in Actor Studio (slice 2c):** a new scenario, `heroes-studio`, builds one hero per
  class through the Actor Studio module's own windows (Playwright clicks: the ability scores, species,
  background and class pickers, "Create Character", the level-up window for each level, the Spells tab)
  and compares it with the raw kit hero of the same class, level and choices: class levels, subclass,
  hit points, armor class, ability scores, proficiencies, items and features granted, spell slots,
  scale values, where each item came from and what each advancement holds. A difference is a finding
  of kind KIT, CONTENT, SYSTEM or the new STUDIO (Actor Studio itself). The feature use pass of slice
  2b runs on both heroes, and Actor Studio's own console errors are reported as findings. Four new GM
  actions (`inspectBuild`, `studioPump`, `adoptActor`, `deleteKitActor`) have fake twins; against the
  fake the scenario builds the "Studio" hero with the builder, so `kit all --fake` tests the comparison
  in CI. The `srd` profile now lists `foundryvtt-actor-studio` under `modules` (run `kit init` once).
  A scenario can name console errors it reports itself (`knownConsoleErrors`) and a scenario gets the
  GM page as `t.page` (null against the fake).
