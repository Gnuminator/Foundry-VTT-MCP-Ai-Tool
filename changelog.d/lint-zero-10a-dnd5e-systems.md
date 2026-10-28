### Process tooling

- **Lint zero, dnd5e tools and system adapters:** `tools/dnd5e/` (add-feature, npc, features) and `src/systems/` have no ESLint warnings left. The system adapter interface and the add-feature response builders use small named types (`tools/dnd5e/types.ts`, `systems/data.ts`) instead of `any`; no change to what the tools return.
