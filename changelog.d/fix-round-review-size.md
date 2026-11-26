### Fixes

- **Merge gate:** a later fix round on an Opus-list PR takes a Sonnet review when the PR's patch on Opus-list paths is unchanged since an Opus review that said Merge or fixes (compared by content, so merges of main and rebases do not matter; no earlier Opus note keeps the Opus rule). `review-note.mjs` follows the same rule (D-152).
