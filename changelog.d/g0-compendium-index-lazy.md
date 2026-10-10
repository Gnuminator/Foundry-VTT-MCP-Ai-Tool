### Module

- **Compendium search asks for item summary fields only where a name matched:** the first
  search no longer re-indexes every Item pack one by one before matching (on a large licensed
  world it could pass the 10 second query timeout). Names match against each pack's plain index
  first (packs without an index load six at a time); then only the Item packs with a hit get the
  summary fields, all at once, within a 4 second budget: past it the search returns plain results
  and the next search has the summaries. Searches running at once share one fields request per
  pack. A pack whose fields request fails keeps its plain results instead of dropping out, a
  pack that fails to index no longer stops the others, and Foundry's own index check replaces the
  module's cache, so a pack re-indexed by something else gets its fields back. Packs written by
  dnd5e 6 send their `rarities` list too.
- **get-compendium-item keeps an activity's save:** the sanitizer dropped every `save` key, so
  save activities lost their ability and DC. Only an ability entry's legacy `save` is skipped now.
- **get-character-entity:** the item's HTML description goes out once (as `description`, no longer
  also in `system.description.value`), and a name shared by several items on the character is an
  error that lists their ids instead of a silent pick of the first.
