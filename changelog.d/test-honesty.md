### Tests

- **Kit negative control:** `kit run --fake --stopped-bridge` builds in the fake, then takes the
  bridge's link to Foundry away (the dashboard answers as a real one does with no module linked:
  Foundry unreachable, tool calls refused, an empty player screen) and runs every scenario. A unit
  test fails if any scenario still passes or skips. It found ten scenarios that only drove Foundry's
  own page and passed with the bridge stopped (heroes-advancement, heroes-multiclass,
  heroes-features-use and -deep, monsters-matrix, origins-backgrounds, -feats and -species,
  spells-cast-all and -deep); each now starts with a bridge probe (`get-world-info` names the kit
  world). `bridge-health` also checks that the bridge reaches Foundry, not only that the control
  channel is up.
- **No fixed sleep in the me-route test:** it waits for the world to be loaded instead of 200 ms.
