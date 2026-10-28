### Fixes

- **Module rehearsal zip check:** the zip reader now also checks that the entries it read add up to the directory size the zip states, so a zip with a too-low entry count can no longer hide names. The version mismatch message got its missing space.
