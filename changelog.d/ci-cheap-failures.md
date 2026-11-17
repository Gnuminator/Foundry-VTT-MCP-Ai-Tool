### Tests

- **Cheap CI failures caught before the push:** `npm run green -- --quick` now runs the unused-code ratchet (about 8 s) when TypeScript sources or manifests changed, and the live-sweep coverage test (about 1 s, "add a sweep step (or a recorded skip) for: ...") when a tool module, the tool sets page or the sweep changed. `unused:ratchet` lists the unused exports, types and files in the files the branch changed (ci-cheap-failures).
