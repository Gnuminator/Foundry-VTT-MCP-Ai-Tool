### Process

- **Merge runner:** `scripts/merge-runner.mjs` merges PRs whose Backlog progress line says ready
  (`backlog.mjs progress <id> --ready <PR> --head <sha> --review <note>`) through main's copy of the
  merge gate with `--wait-ci`, one at a time, in its own built checkout. A merge marks the item
  done; a refusal becomes the item's progress line and one #pr-log line. It stops with one line at
  the merge train limit and when main is red, never runs `live:roundtrip`, and a lock file keeps a
  second copy from running. `scripts/register-merge-runner.ps1` starts it at logon (D-140, D-141;
  item merge-runner).
- **No standing planner:** the planner skill loses its Waking, Merges and successor steps (a short
  Train part stays) and its word budget drops from 1,422 to 1,185; `planner-wake.mjs` loses its
  "start a fresh planner" exit 3. A test keeps both out (D-141).
