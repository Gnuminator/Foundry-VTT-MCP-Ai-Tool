### Fixes

- **Merge gate:** a later fix round on an Opus-list PR takes a Sonnet review when the change since the Opus-reviewed commit touches no Opus-list path (clean merges of main do not count; a rebase or no earlier Opus note keeps the Opus rule). `review-note.mjs` follows the same rule (D-152).
