### Orange Pi (D-126)

- **The Pi builds the newest release tag, not a fixed one:** stage 5 and `rebuild-drill.ps1` pick the newest plain
  `vX.Y.Z` tag on GitHub unless `TOOL_REF` (`-ToolRef`) names another ref, and stop if there is no such tag.
  The release steps are written down in `docs/dev/RELEASING.md`.
