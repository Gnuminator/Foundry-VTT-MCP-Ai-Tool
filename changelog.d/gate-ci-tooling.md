### Fixes

- **Merge gate refusals say why:** each refusal commit in the vault's Merge train history now has the
  cause tags in its subject (`Merge train: refusal #649, 2/4 [ci-failing, review]`; `ci-pending`,
  `ci-missing`, `train`, `drift-<guard name>` and so on) and the reason lines in its body, so refusals
  can be counted by cause. The train note itself is unchanged.
- **A hand-dispatched CI run can no longer hide a merge-ref failure:** every `ci.yml` job name gets a
  `[dispatch]` suffix on `workflow_dispatch`, so `green --cloud` runs have check keys of their own. The
  `latestChecks` note records why an undated finished check ranks oldest.
- **`green --quick` runs the test kit checks:** the kit control tests (a new control without its skip
  row) when a usage-catalogue input or `scripts/test-kit/` changed, and the scenario check (`kit.mjs
check`) when the dashboard web app or `scripts/test-kit/` changed, so both fail locally and not first
  on CI.
