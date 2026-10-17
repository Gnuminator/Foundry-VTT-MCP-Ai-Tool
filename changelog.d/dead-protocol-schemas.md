### Fixes

- **Dead wire-protocol schemas removed:** 11 Zod schemas in `shared/src/protocol.ts` that nothing parsed
  (control request/response, call-tool params, tool result, the Foundry-link frames, bridge-hello and
  module-reply) are gone. The TypeScript types, the frozen strings and the two schemas the code really
  parses (`module-hello`, `module-request`) are unchanged, so the wire does not change.
- **Test mock ids:** the Foundry mock's `randomId` no longer repeats ids for a long type name.
