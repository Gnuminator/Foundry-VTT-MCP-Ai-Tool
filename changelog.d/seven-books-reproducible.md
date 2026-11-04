### Pi

- **The seven-book trim notices when it is undone (stage 22):** `MODE=check` is a read-only run of the trim that fails when the world no longer matches what the trim leaves (a dropped book back in `aitool-content`, `dnd5e.items` or `dnd5e.monsters` visible again, a kept entry linking into a pack players cannot open), so a stage 11 push or a content module update cannot undo it unseen. A rerun after such a push now replaces the stale legacy copy of an entry that came back, re-pointed effects keep their description links, and the stage ignores a closed pipe.
- **The seven-book tests run everywhere:** `scripts/pi/seven-books.test.mjs` is part of `npm run green` and has its own x64 CI step, not only the ARM64 job.
