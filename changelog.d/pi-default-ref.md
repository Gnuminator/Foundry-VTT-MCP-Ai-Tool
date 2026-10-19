### Orange Pi (#310 L1)

- **Stage 5 builds a tag whose build is pruned of its dev packages** (from `pi-build-2026-10-12`, the merge of PR #319,
  on). Older refs such as `v0.21.0` still work with `TOOL_REF` and keep their dev packages. `rebuild-drill.ps1` uses
  the same default (see the release-tags entry for how the default is chosen).
