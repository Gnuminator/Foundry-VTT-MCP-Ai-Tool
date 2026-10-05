### Test kit (D-090 lane 2)

- **The test kit engine, first slice:** `npm run kit -- all` builds the SRD test world
  `ai-tool-kit-srd` from the dnd5e compendiums (12 level 1 heroes, 11 monsters chosen by rule from
  a CR and type matrix, a walled combat map) and runs five scenarios against the bridge, the module
  and the dashboard: bridge health and catalog, compendium monsters, guarded damage with undo, a
  scripted fight checked against the play log and stats, and the player page spoiler check. Each
  run writes a report as Markdown, JSON and HTML. The kit only writes to its own world and refuses
  the live bridge ports. Licensed scenarios and run reports stay on the PC, never in a repo.
  Details: `docs/dev/TEST-KIT.md`.
- **CI:** the kit's engine tests, a check that every scenario names only real tools, and a full
  build and run against a built-in fake dashboard (no Foundry needed).
