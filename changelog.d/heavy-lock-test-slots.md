### Fixes

- **Heavy-lock test with more slots:** the test that two runs started together queue one after the
  other now pins one slot, so it no longer fails on a PC where `HEAVY_LOCK_SLOTS` is set to more
  than one.
