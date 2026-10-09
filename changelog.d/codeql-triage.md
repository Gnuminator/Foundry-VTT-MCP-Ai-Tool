### Security

- **CodeQL findings (first scan, 2026-10-09):** CI runs with a read-only `GITHUB_TOKEN`. Table
  cells in Obsidian notes, the test kit report and the usage log escape a backslash with the pipe,
  so text ending in `\` can no longer split a cell. A character sheet's plain text decodes
  `&amp;` last, so an escaped `&lt;` in a description stays text instead of turning into `<`. The
  tool reference escapes backslashes in descriptions, and now shows their `\"` as written.
