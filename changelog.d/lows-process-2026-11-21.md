### Fixes

- **Done lines without a board:** `backlog.mjs done` writes `Unsorted` when an item has no `board:` line instead of copying its free-text `area:` into the done list.
- **Lane plugin copy:** the v0.31.0 entry says the built lane kit plugin copy is committed at release. It is not: no release step builds or commits it, so build it on demand with `node scripts/build-lane-plugin.mjs`.
