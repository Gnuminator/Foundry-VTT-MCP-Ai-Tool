### Docs

- **Tool reference split per set:** `npm run docs:tools` now writes one page per tool set in
  `docs/reference/tools/` (core, play, prep, build, admin, player) and keeps
  `docs/reference/tools.md` as a short index linking to them. A test fails when any page is stale or
  an unexpected file sits in the folder. The em-dash baseline no longer stores a total; it computes
  it from the per-file counts.
