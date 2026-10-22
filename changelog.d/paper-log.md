### Paper nights (paper-log)

- **Paper sessions in the play log:** `mark-play-session` takes `mode: "paper"` for a night played
  on paper, and with `date` (and `time`) marks a night after the fact. It works with Foundry
  closed, using the last world this bridge saw. `synced: true` marks a paper night as done.
- **Stats keep paper syncs out of the play numbers:** changes made by `plan-paper-sync` no longer
  count as damage, healing, slots or loot. A paper night shows a "Paper night: net change" block
  (per character: HP lost and regained, slots, resources, coins, XP, items gained and lost), in
  `get-play-stats`, the session note and the campaign stats; a late sync no longer opens a
  session of its own.
- **Recap and pre-flight:** the `session-recap` prompt handles a paper session (story from the
  session notes, sheet changes from the net block, no invented dice). The pre-flight play-session
  line warns about a paper night with no paper sync yet.
