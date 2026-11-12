### Tooling (tool-sets-from-modules)

- **Tool sets and hints live in the tool modules (R10):** each tool's set, title and read/write
  kind is now written once, in the `tools` map of its module in
  `packages/mcp-server/src/tools/modules/`. `tool-sets.ts` and `tool-hints.ts` derive their lists
  from the modules, the size budgets moved to a user-owned `tool-budgets.ts`, and the tests no
  longer hard-code the number of tools. A new tool is now one place, not four. What each
  connector serves is byte-identical; the lists in `docs/reference/TOOL-SETS.md` follow the tool
  list order, and the build id changed once because of that.
