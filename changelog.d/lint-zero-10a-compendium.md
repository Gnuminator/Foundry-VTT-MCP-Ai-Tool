### Process tooling

- **Lint zero, compendium tools:** `packages/mcp-server/src/tools/compendium.ts` has no ESLint warnings left. Bridge replies and Foundry item data are read through small narrowing helpers (`tools/bridge-data.ts`) instead of `any`; no change to what the tools return.
