### Development

- **Typed Foundry edges (lint zero step 1):** the module's Foundry declarations now type the
  documents it reads instead of `any`: tokens, notes, walls, lights, regions (with their v14
  shapes), playlists, roll tables, rolls and dice terms, the Token placeable, user targets and the
  tokens layer, checked against the Foundry 14.368 source. `actor.system` and `item.system` are
  typed for dnd5e 6 from the installed 6.0.5 data models (`src/systems/dnd5e/system-data.d.ts`),
  so the core declarations stay system-agnostic. Embedded document writes return documents,
  `game.settings.get` returns `unknown`, and `canvas.pan` is declared synchronous as it is in v14.
  No behaviour changes; the warning count drops a little now and much more as the sweeps type
  their locals with these declarations.
