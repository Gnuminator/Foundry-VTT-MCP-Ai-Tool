### Orange Pi (#310 L1)

- **Stage 5 builds the tag `pi-build-2026-10-12` by default** (it is the merge of PR #319, so the build is pruned
  of its dev packages). Older refs such as `v0.21.0` still work with `TOOL_REF` and keep their dev packages.
  `rebuild-drill.ps1` uses the same default.
