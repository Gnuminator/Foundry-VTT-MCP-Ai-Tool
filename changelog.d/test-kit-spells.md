### Test kit (D-090 lane 2)

- **Every spell cast once, plus 31 deep spell checks (slice 3b):** two new scenarios. `spells-cast-all`
  gives every spell of the profile's spell packs to a suitable caster hero and casts it once at its
  base level with no dialog, no measured template and no summons; each cast is judged (no error, a chat
  card, the slot taken, none for a cantrip, concentration begun) and the hero is put back after it.
  `smoke` casts a repeatable sample of about thirty spells, `full` casts them all. `spells-deep` runs
  31 rule checks on SRD spells: spell attack bonus, save DC, save for half damage, a save that negates
  with a condition, area templates (sphere, cone, line, cube, wall), concentration (begin, replace,
  none), upcasting (dice, targets, healing), healing and temporary hit points, teleport, a reaction
  (Shield), armor and bonus effects, rituals, cantrip damage by character level, Pact Magic, which
  slot is taken, a refused cast, a summon (placed and cleaned up) and a spell scroll. Failures carry the
  KIT, CONTENT or SYSTEM class. Two new GM actions, `listSpells` and `exerciseSpell`, have fake twins,
  so `kit all --fake` runs both scenarios in CI. Scenarios can read `t.size`.
