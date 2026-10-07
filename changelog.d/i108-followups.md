### Module (I-108 follow-ups)

- **Any-GM, two tabs of one GM:** the bridge now answers a window request from any open tab whose
  hello says it is a bridge user, not only the active one, so an older tab can no longer win the
  race with an instant "not connected". Tabs with no hello (an old module) or that are not bridge
  users are still refused.
- **"Update the bridge" for the new windows:** the bridge lists `module-request:<tool>` for every
  tool it answers, and the module checks the tool against it. A bridge from the first I-108 build
  (the plain `module-request` only) serves just the AI changes window; the Handouts and Tarokka
  windows say "Update the AI Tool bridge" instead of "Tool not allowed".
- **Who made a change:** a change made from a window in Foundry shows `by NAME` in the AI changes
  window and in the dashboard's Recent Changes, and `gm/audit-log.jsonl` keeps it as an optional
  `requestedBy` (still `v: 1`).
- **Handouts queue changes reach other windows:** queueing or removing a handout (from Claude, the
  dashboard or a window) now refreshes the Handouts windows other GMs have open.
- **Tarokka:** a window request can no longer plan a reveal for a position that is already revealed;
  change it from the dashboard or with Claude.
- **Old modules:** the module now says in its hello that it understands the change signal, and the
  bridge only sends it to a module that does, so an older module no longer logs one failed query
  per recorded change.
