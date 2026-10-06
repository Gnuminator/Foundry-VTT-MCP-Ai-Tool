### Test kit (D-090 lane 2)

- **Every monster, checked (slice 3a):** three new scenarios cover the monster compendium of the
  content profile. `monsters-every` copies each monster into the kit world, uses one action, checks
  the copy against its compendium entry and against what the bridge tool `get-character` says, and
  deletes the copy again. `monsters-matrix` counts the monsters by challenge rating band, creature
  type, size and trait (resistances, immunities, senses, languages, spells, legendary actions,
  lair, movement) and lists the gaps. `monsters-odd` checks the odd mechanics: legendary actions
  (does using one spend the pool the dashboard's Boss pips read?), legendary resistance, lair,
  regeneration, shapechangers, movement modes, recharge rolls, multiattack and spellcasting. Every
  failure is classed KIT, CONTENT or SYSTEM. The `smoke` size samples a few dozen monsters, `full`
  does all of them. Details: `docs/dev/TEST-KIT.md`.
- **Test kit internals:** the GM actions `listMonsters`, `createMonster` and `deleteMonsters`, a
  `recharge` operation and a `changed` list for `exerciseActor`, the scenario context now has
  `t.size`, and the fake compendium has the odd creatures the new scenarios need. The `srd` profile
  lists the legacy `dnd5e.monsters` pack too.
