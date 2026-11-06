### Docs

- **Quest pages link to the checklists:** the three GM quest pages (first hour, before a session,
  prepare session 0) and their Danish twins now link to the steps on the checklist pages instead of
  copying them. `scripts/docs-quest-check.mjs`, part of `npm run docs:links`, fails when a quest
  page copies a run of nine words from its checklist or leaves a checklist section neither linked
  nor listed as skipped.
