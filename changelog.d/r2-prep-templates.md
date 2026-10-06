### Obsidian

- **Prep that connects (R2, D-094):** the export writes four prep templates into
  `Prep/Templates/` (NPC, Location, Quest, Session plan, with the properties the prep digest
  reads and a hint in an Obsidian `%%` comment) while that folder is missing, so the GM's edits
  and deletions stay. They work with core Templates, Templater or by hand. The prep digest skips
  `Prep/Templates/` and leaves out `%%` comments. The Obsidian plugin's new **New prep note for
  this** (command and file menu, on a world note) makes `Prep/<kind>/<name>.md` from the
  template with `fvtt_uuid` filled in and a link back, or opens the one already there. New
  `docs/gm/obsidian.md` section "Make a prep note".
