### Orange Pi (D-068)

- **Stage 11 follow-ups before the first real push:** `world-refs.mjs` matches secret words only in a
  setting's own name (after the module id), so module names like vtta-tokenizer no longer count; a
  name that is or ends in token or key, or holds credential or private key, always counts, with a
  short safe list (`core.defaultToken`) instead of a pattern. An active ddb-importer gets its own hint
  (switch it off in the world after the import). A failed stage 11 run puts back only what was
  running before it (Foundry, the Assistant GM browser), instead of starting both.
