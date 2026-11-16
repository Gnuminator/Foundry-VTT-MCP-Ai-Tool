### Fixes

- **The merge runner no longer closes an item too early:** when an item's done-when names a tag, a publish, a ruleset change or the user's OK, a merge now leaves it open with a progress line instead of moving it to done, as it already did for Pi runs (runner-no-early-close).
