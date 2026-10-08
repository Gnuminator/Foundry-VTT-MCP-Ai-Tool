### Fixes

- **During on narrow screens:** below 1080 px an old grid rule from the first Before/During/After
  screen named areas the During cards no longer use, so Recent Changes, Handouts and Party stacked
  on top of each other (at 390 px the Party drawer covered the Recent Changes header). The rule is
  gone; every layout keeps its own order at 390 px, 768 px, 1000 px and desktop widths, and a test
  checks that every During grid rule names each card.
