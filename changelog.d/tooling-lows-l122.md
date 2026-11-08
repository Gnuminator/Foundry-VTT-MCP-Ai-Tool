### Tooling

- **Script entry guard:** `changelog-fold.mjs`, `checks.mjs` and `drift-check.mjs` decide whether to run with real paths (case-insensitive on Windows) and exit 1 when started under their own file name from a different file, the way `lane-merge.mjs` does, so a junction or drive-letter case no longer turns into a silent exit 0. `changelog.d/README.md` says item and PR references go in the bullet, not the heading tag.
- **Visual baselines helper:** the branch head is read from the exact `heads/` ref (a tag of the same name cannot answer), the run picker no longer hides the wrong-branch refusal, log names carry a short hash (`a/b` and `a_b` differ) and a failed log write no longer stops the run. Tests cover the log name, a run without a branch and the script start.
- **Docs:** the Pi stage 16 paragraph in `PI-SETUP.md` names the `deployed` report object; the changelog fold comments mention the Pi rule.
