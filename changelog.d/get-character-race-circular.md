### Fixes

- **Species no longer shows as "[Circular Reference]":** `get-character` and the other reads that
  sanitize a document now treat only an object's ancestors as a cycle, so the species item that
  appears both in `details.race` and in the item list keeps its data in both places.
