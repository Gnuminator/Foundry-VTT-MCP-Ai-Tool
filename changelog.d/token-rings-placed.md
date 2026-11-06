### Token rings for placed tokens (I-093)

- **Rings on tokens already on the scenes:** `plan-token-rings` takes `tokens: "placed"` (and an
  optional `scenes` list). The plan turns the dynamic ring on, or off, on each token already placed
  on the scenes, linked or unlinked, as one guarded change you confirm and can undo.
- **Names that match nothing are reported:** both plans now list requested names that matched
  nothing (`unmatched`) and say so in the summary.
