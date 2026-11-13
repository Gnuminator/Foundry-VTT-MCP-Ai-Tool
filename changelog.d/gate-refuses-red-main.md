### Fixes

- **The merge gate refuses while main is red:** `lane-merge` now refuses any merge when main's last
  completed push run of `ci.yml` failed, and names the run. The fix PR passes by carrying an
  `Unblocks main: <what it fixes>` line in its description.
