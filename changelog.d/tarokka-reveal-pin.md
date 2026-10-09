### Fixes

- **A Tarokka reveal can no longer publish a card from a reading that was replaced.** If the
  reading changed between planning a reveal and applying it (Claude dealt a new one, or a second
  dashboard tab or the Foundry window imported one), the apply wrote the old card's text to the
  players' journal and marked the position revealed in the new reading. A re-reveal (updating a
  page already shown) had no check at all. The reveal plan now pins the reading it was made for,
  and the apply refuses with "Conflict, nothing was written: tarokka.json current.readingId
  changed since"; plan the reveal again. This covers the dashboard, Claude and the Tarokka window
  in Foundry.
- **Guarded writes can pin vault values (`vaultChecks`).** A plan can name GM vault values it was
  built on. They are checked when the plan is made and again at apply (nothing is written in
  Foundry or the vault when one changed), but they are never written: no line in the confirm
  window or Recent Changes, nothing in the audit entry, nothing for Undo, and a file that is only
  checked is not rewritten (no Obsidian mirror churn).
