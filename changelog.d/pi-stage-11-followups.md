### Orange Pi (D-068)

- **Stage 11 follow-ups before the first real push:** `world-refs.mjs` matches secret words only in a
  setting's own name (after the module id) and no longer counts plain token settings
  (`core.defaultToken`, vtta-tokenizer, Token Action HUD), only named auth tokens; an active
  ddb-importer gets its own hint (switch it off in the world after the import). A failed stage 11 run
  puts back only what was running before it (Foundry, the Assistant GM browser), instead of starting
  both.
