### Undo for everything (I-109 follow-ups)

- **Journal files are kept 7 days and capped:** the backend removes `changes-<date>.jsonl` files
  older than the history span once a day, and the oldest ones while the files hold more than
  64 MB in all (`FOUNDRY_AI_CHANGE_JOURNAL_MAX_MB`; the Pi's vault is an SD card). It remembers
  from which day the history is complete: `list-changes` says when the cap removed days inside
  the span, and "Everything since" or a rewind to a change before that day is refused instead
  of silently skipping people's changes. A file that cannot be removed is retried later.
- **Foundry's own follow-ups stay with the AI change:** when the AI deletes a token in combat,
  the combatant Foundry removes (and the turn it moves) no longer show as the GM's own change.
- **The GM browser's journal buffer is capped at 32 MB** besides its 5000 records, and record
  sizes are measured in UTF-8 bytes.
- **Two updates to one document in the same server millisecond** are two records: an update's
  key carries a hash of its values after, so neither is dropped and both can be undone.
- **A GM edit within 300 ms of an AI write** (the bridge in their own browser) is listed and
  undoable as their own change when it touches other things; only the system's own follow-ups
  on the AI's things (Bloodied after an HP change) still belong to the AI change.
- **An undo made in the dashboard** is listed as the GM's ("GM (dashboard)"), not the AI's, and
  no longer falls under the AI filter.
- **Ownership lines name the user** ("ownership for Anna") when the history has seen that user,
  instead of the user id.
- **Redo wording:** "undone together with other changes" appears only when the undo really took
  back several changes (the backend now says how many), not for a one-change undo with two lines.
- **Changes window, filter:** when a full page holds only hidden rows, it says so and points to
  Show more instead of "No changes match this filter".
