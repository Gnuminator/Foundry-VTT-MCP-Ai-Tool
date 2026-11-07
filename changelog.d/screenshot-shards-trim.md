### CI

- **Fewer dashboard screenshots:** the dashboard-visual shards photograph each screen in the neutral
  theme only and skip the screenshots of Veil stories, except `ui-` primitives, phone stories and
  the heal form. Axe still checks both themes and every story. Since sharded CI began on
  2026-10-30 no screenshot comparison caught a real bug; 41 of 56 failing runs were baseline
  updates. 42 screen baselines and 35 story baselines are gone. No longer covered by any shot: the
  Veil theme at 1080 and 390 wide, and page-level Veil rules (moment tab glow, mist background).
