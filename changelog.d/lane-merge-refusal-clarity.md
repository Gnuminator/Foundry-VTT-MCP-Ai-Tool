### Tooling

- **Merge gate refusals say why on the last line:** a refusal by `scripts/lane-merge.mjs` now ends
  with one `lane:merge: refused because ...` line that holds every reason (the last line, or the one
  before the `wait-ci ended:` verdict under `--wait-ci`), so a `tail` of the output never shows only
  the notices. The checks themselves and the exit codes are unchanged.
- **Risky notice says found or missing:** `risky (...): an Opus review is required` now ends with
  `Opus note for head <sha>: found (<note>)` or `missing`, so it no longer reads as a refusal on a
  PR that merges.
- **Review-note refusals name the rule:** when no note counts, the refusal says how the gate finds
  notes (`<N>-*review*.md` in a `Handoff/Reviews <date>/` folder, Opus by name or heading, a full
  40-character `Head reviewed:` sha above `## Verdict`) and lists files of the PR it skipped because
  "review" is not in the name.
- **Release PRs pass the changelog check:** a PR that only folds the changelog and bumps versions
  (as in `docs/dev/RELEASING.md`) no longer needs `--no-changelog`. The check is strict: every file
  must be `CHANGELOG.md`, a deleted fragment, or a version-only change in a place `version:sync`
  stamps.
