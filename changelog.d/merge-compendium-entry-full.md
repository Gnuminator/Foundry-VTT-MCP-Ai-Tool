### Tools

- **One tool for reading a compendium entry:** `get-compendium-entry-full` (Build) is folded into `get-compendium-item` (Core), which already returns the full stat block with items and effects, or a lighter one with `compact`. The old name still works for one release: the tool router answers it through `get-compendium-item` and renames `entryId` to `itemId`, but it no longer shows in the tool list.
