### Test kit (D-090 lane 2)

- **Every feature on every hero, plus deep checks (slice 2b):** two new scenarios. `heroes-features-use`
  uses every activity of every hero feature that can run without a dialog and checks that it posted a
  chat card, consumed the uses it says it consumes and raised no error; the hero is put back after
  each use. `heroes-features-deep` runs 21 rule checks against class tables of the 2024 SRD (Rage
  damage and resistances, Wild Shape, Channel Divinity, Sneak Attack dice, Bardic Inspiration die,
  Focus and Sorcery points, Pact Magic slots, Action Surge, Lay on Hands, Second Wind, Arcane
  Recovery, Divine Smite, Cunning Action, Extra Attack, superiority dice, Unarmored Defense,
  spell slots, Hit Dice, short and long rest recovery, proficiency bonus). Failures carry the KIT,
  CONTENT or SYSTEM class. Two new GM actions, `inspectFeatures` and `exerciseActor`, have fake
  twins, so `kit all --fake` runs both scenarios in CI.
