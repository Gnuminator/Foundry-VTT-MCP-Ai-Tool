### Fixes

- **Reference text and player guide lows:** `&Reference[...]` in book text reads the same whatever order its options come in (`apply=false condition=prone` reads "prone", `rule="Difficult Terrain"` loses its quotes). A player timeout message only matches a real "Query timeout:" error. The player guide's troubleshooting lines are re-wrapped and the double-click tip says Windows (English and Danish). Tests added for the capped player connector re-initialize and for the book warm-up (player-search-882-lows, player-wrapper-reinit-cap-test, player-guide-lows).
