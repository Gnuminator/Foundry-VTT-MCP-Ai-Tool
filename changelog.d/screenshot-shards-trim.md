### CI

- **Fewer dashboard screenshots:** the dashboard-visual shards photograph each screen in the neutral
  theme only and skip the screenshots of Veil stories (the `ui-` primitive stories keep theirs). Axe
  still checks both themes and every story. In 30 days of CI no screenshot comparison caught a real
  bug; 41 of 56 failing runs were baseline updates. 42 screen baselines and 45 story baselines are
  gone.
