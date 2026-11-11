### Tooling (tool-modules-index)

- **Tool modules (R9):** each tool family now has a small module in
  `packages/mcp-server/src/tools/modules/` that says how to build it, which tool definitions it
  lists and which calls it answers, and `tools/index.ts` lists every module once. The backend, the
  call router, the tool list and the test stub are built from that list, so a new tool family is
  one module file and one line in the index instead of edits in five places. Nothing Claude or the
  dashboard sees changes: tool names, schemas, descriptions, order and sets are byte-identical.
