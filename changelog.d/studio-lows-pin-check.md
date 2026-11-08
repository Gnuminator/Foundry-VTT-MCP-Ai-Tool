### Tests and tooling

- **Actor Studio pin check:** `npm run studio:pin-check` downloads the release that Pi stage 13 pins and compares its sha256 with `PINNED_SHA256`, so a typo in a pin shows before the Pi run. CI runs it as the `studio-pin` job on a pull request that changes stage 13 (and on every push to main). Backlog `studio-pin-check`.
- **Actor Studio hit point comparison:** the Rogue's level 10 counts as an ability score increase level, a Constitution shortfall on top of a per-level hit point effect (Draconic Resilience, Tough) keeps its own finding instead of hiding behind the effect's SYSTEM finding, `conRiseExplains` has its own unit test, and a stale test comment is fixed. The fork-side items of `studio-hp-lows` (catchUpHitPoints) stay open.
