### Process tooling

- **Lint zero, character tools:** `packages/mcp-server/src/tools/character.ts` has no ESLint warnings left. Bridge replies and actor data are read through the narrowing helpers in `tools/bridge-data.ts` instead of `any`; no change to what the tools return.
