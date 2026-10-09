### Development

- **Typed actor lookups and character reads (lint zero step 3, sweep 5):** the shared helpers that
  find an actor by id or name (`findActorByIdentifier`, `resolveTargetActor`, the scene token
  lookup) return `Actor` instead of `any`, so their callers drop their casts. `characters.ts`
  (character sheets, item and effect search, spell slots) and `shared.ts` read Foundry and dnd5e
  data through `unknown` and the sheet field helpers. ESLint warnings drop from 3351 to 3143; both
  files have none left. Lookups, search results and sheets keep the same shape.
