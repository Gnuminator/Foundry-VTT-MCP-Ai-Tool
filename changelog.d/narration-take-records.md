### Videos

- **Takes record the build they filmed:** `take.json` carries the repo commit, whether the tree had
  uncommitted changes and the dashboard version; `demo:compose` copies them into
  `<cut>.builds.json`, and `scripts/demo/older-builds.mjs <compose-out> --since <commit>` lists the
  chapters filmed before a commit (Backlog `take-records-build`).
- **The narration README names the GM video narrator:** the deeper reference clips at speed 0.76,
  with Mic only the fallback. A `voices.local` file outside the repo names the clips, so scripts
  say `voice: deep` (Backlog `narration-settled-voices`).
