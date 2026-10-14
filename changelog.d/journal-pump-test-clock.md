### Fixes

- **Change journal test no longer ages out:** the pump tests used the real clock against records dated 2026-10-06, so once that day was 7 days old retention removed the files and 18 tests (and CI on every PR) failed. The tests now give the pump a fixed clock.
