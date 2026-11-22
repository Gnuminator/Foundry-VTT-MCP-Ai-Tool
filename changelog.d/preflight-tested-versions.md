### Pre-flight

- **Tested versions check:** the pre-flight shows one "to fix" line when the world's Foundry build or
  dnd5e version differs from the pair the release was tested on (Foundry 14.370 with dnd5e 6.0.6 now).
  The pair is one constant that `scripts/sync-version.mjs --tested` bumps at release time. Any
  difference counts, so a Foundry patch update or the move to dnd5e 6.1.1 shows the line until the
  constant is bumped.
