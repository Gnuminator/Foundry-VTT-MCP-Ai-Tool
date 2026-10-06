### Obsidian

- **Compendium actor links go to the world NPC:** in mirrored page text, a link to a compendium
  actor (any form: `@UUID[Compendium...]`, typeless, legacy `@Compendium[...]`, or one of its
  items) goes to the world NPC's note when a world NPC stands for it: the NPC made from it (its
  compendium, duplicate or core source), else the only world NPC with the compendium actor's
  name (case-insensitive). Ambiguous names keep the Library link. The module resolves this per
  opted-in journal (`actorLinks` in the export index, part of the journal's `sig`), so a world
  copy that appears or goes re-renders the page notes within one reconcile (10 minutes). An NPC
  imported with only `flags.core.sourceId` now shows what it was made from too. Every mirror
  note renders once more (renderer version 9).
