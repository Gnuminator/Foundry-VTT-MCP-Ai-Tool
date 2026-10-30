### Tooling

- **One advisor call per PR:** the lane skill now asks for one `advisor` call a PR, after the work
  is committed and before the PR opens, named in the PR handover and the `- progress:` line (it was
  two; measured 0.7 a PR). `npm run usage:week` prints the calls per merged PR next to the
  `Advisor calls (main sessions)` line, and adds `advisorPerPr` to `--json` and `advisor-per-pr` to
  the weekly check note. The lane skill also makes the API review runner the default review path
  until its credit ends on 2026-11-14.
