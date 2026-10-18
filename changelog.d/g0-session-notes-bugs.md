### Fixes

- **Session notes no longer publish raw scenes as finished:** a scene Claude could not write (PC
  asleep, network drop, not logged in) used to be saved as raw text and never retried, and the
  hollow notes were staged into Foundry. Now it is retried on the next passes (up to 3 runs, then
  accepted raw), the session summary waits until every scene is written, and `session_notes run`
  exits 76 meanwhile. Notes cached raw by an older run are tried again.
- **A killed notes pass no longer blocks the next ones for 6 hours:** `auto.ps1` checks that the
  PID in its lock file is still running.
- **Each run's outcome is written to `notes/status.json`** (done, paused, incomplete, failed or
  waiting for the bridge) by `session_notes run` and by `auto.ps1` for transcription, run and
  publish failures. Showing it on the dashboard is a later item.
- **`speakers.json`, `names.txt`, `timeline.jsonl` and the approval file** are read with a byte
  order mark tolerated, so a file saved by Windows PowerShell 5 or old Notepad no longer crashes the
  run.
