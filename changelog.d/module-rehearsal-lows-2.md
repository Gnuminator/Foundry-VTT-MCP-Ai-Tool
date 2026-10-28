### Fixes

- **Module rehearsal zip check:** the zip reader now also checks that the entries it read add up to the directory size the zip states, so a zip with a too-low entry count can no longer hide names. The version mismatch message got its missing space.
- **Module rehearsal write sweep:** the `live:sweep` step ran the read sweep (`live-read-sweep.mjs`); it now runs `live-write-sweep.mjs`, the sweep the step is named for.
