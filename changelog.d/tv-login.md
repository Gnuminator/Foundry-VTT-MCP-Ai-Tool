### TV table viewer (tv-login, G1)

- **`plan-table-viewer` (admin set):** plans a Foundry user for the TV at an in-person session
  (default name "Table"): Player role, no password, owns nothing. A guarded change with the usual
  confirmation, an entry in Recent Changes and Undo (which deletes the user). Refuses when a user
  of that name exists. New feature switch "AI Tool: Table viewer (writes)", on by default.
- **`scripts/tv/start-table-viewer.ps1`:** opens Edge or Chrome full screen on Foundry with its
  own profile folder. `-Setup` once for the first sign-in (the Cloudflare email code). Foundry's
  own login lasts 24 hours, so the script also watches the browser (a debug port on 127.0.0.1
  only) and, whenever Foundry's join page of that game shows, joins as Table by itself. Later
  runs, also after a restart or a new day, go straight to the map. The script stores no secret;
  `-NoAutoJoin` turns the watching off.
- **Docs:** new GM guide "The TV at the table" (`docs/gm/tv-table-viewer.md`).
