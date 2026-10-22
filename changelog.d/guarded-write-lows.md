### Fixes

- **Undo of a plan whose token the GM already deleted:** undoing a plan that created several
  documents no longer refuses the whole undo when one of them is gone (a spawned token killed in
  play). The rest is removed, the change history says which one was already gone, and a redo puts
  back only the ones the undo removed.
- **Session notes after a redo:** undoing the undo of a session-notes put brings the notes back to
  "in Foundry" (the Recap is queued for reveal again), not only the journal.
- **Foundry link:** a query whose send fails is dropped at once instead of lingering for up to two
  minutes.
