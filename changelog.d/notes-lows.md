### Session notes (notes-review-lows, notes-status-line-polish)

- **Summary not reused after a rewrite:** the session summary is cached together with a digest of
  the scene notes it was written for, so a manual re-run after a raw scene was fixed writes a new
  summary instead of keeping the old one.
- **Unfinished notes say so:** `transcript.*.md` and `scenes.*.md` start with a notice, and
  `notes.json` has `complete: false`, while scenes are raw or missing or the summary is not written.
- **The card's pill names the state:** with no staged notes the After card says Done, Paused or
  Incomplete (as well as Failed, Published and Waiting) instead of "Waiting" for those states.
- **One default sessions folder:** the dashboard's pipeline route and the recorder bot take
  `Documents/FoundrySessions` from `shared/src/sessions-dir.ts` (the bot keeps an identical copy,
  checked by a test) and `voice-stack.ps1` from one function.
- **Tests:** `cli.main` exit codes 75 and 76 with `status.json`, the fallback counter restarting
  when a scene changes, a pause plus a fallback in one run, `auto.ps1`'s lock and `-KeepFresh`
  (a smoke test that runs the script on Windows), the pipeline route (GM only, before `/:id`,
  the `sessionsDir` option) and one e2e case per pill.
