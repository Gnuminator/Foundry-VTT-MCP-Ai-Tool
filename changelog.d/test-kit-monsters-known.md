### Test kit (D-090 lane 2)

- **Known findings in the monster scenarios:** `monsters-matrix`, `monsters-every` and
  `monsters-odd` count the CONTENT and SYSTEM problems on the profile's known list (like the
  heroes and origins scenarios) instead of failing on them, and name the entries in the step
  detail and a `known` attachment; a new problem still fails. A challenge rating 0 creature with
  no items, or whose items carry no activity at all (a mount, a familiar, a summoned servant), is
  no longer a "no items" or "no action to use" problem, and a creature with no type at all no
  longer makes the bridge "disagree" with Foundry. The srd list gains the dnd5e 6.0.5 SRD findings
  of the full run (the Werewolf's and the Unseen Servant's creature type, the Avatar of Death's
  multiattack, the Cloaker's spellcasting ability, the Cloud Giant's Misty Step uses).
