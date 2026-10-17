### Fixes

- **Hook timing tests:** the cd-chain check in `guard-shell-edits.test.mjs` and the two speed checks in
  `warn-control-bytes.test.mjs` now take the best of three runs against their caps, through one shared
  `bestMs` helper (`.claude/hooks/best-ms.mjs`), so a busy machine no longer fails them.
