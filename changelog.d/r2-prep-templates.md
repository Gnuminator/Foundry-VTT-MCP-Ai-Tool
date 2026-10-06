### Obsidian

- **Prep that connects (R2, D-094):** the export writes four prep templates into
  `Prep/Templates/` (NPC, Location, Quest, Session plan, with the properties the prep digest
  reads and a hint in an Obsidian `%%` comment) while that folder is missing, so the GM's edits
  and deletions stay. They work with core Templates, Templater or by hand. The prep digest skips
  `Prep/Templates/` and leaves out `%%` comments. The Obsidian plugin's new **New prep note for
  this** (command and file menu, on a world note) makes `Prep/<kind>/<name>.md` from the
  template with `fvtt_uuid` filled in and a link back, or opens the one already there (found by
  `fvtt_uuid` anywhere under `Prep/`, also after a move or rename). A session plan is always new,
  named `Session <YYYY-MM-DD>` with `date` filled. Names are checked in any letter case and made
  safe on Windows (device names, control characters). The prep digest no longer picks an undated
  session plan that is only headings as the newest, and the export sees a templates folder renamed
  in another letter case. New
  `docs/gm/obsidian.md` section "Make a prep note".
