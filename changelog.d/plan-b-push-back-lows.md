### Orange Pi (D-068)

- **Plan B push-back, #274 review lows:** stage 11's change check skips the GM named in the
  world's `world-<id>.env` (the one setup provisions), not this run's `GM_USER`. The module version
  compare is a tested helper: `v1.2` and `1.2.0-rc1` read as numbers, and a version that cannot be
  read keeps the Pi's copy with a warning instead of a silent downgrade. PLAN-B.md says the GM and
  Assistant GM user documents are replaced whole.
