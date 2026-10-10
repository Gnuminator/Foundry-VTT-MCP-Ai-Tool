### Orange Pi (D-068)

- **Stage 5 drops the dev packages after the build:** `npm prune --omit=dev` removes the compilers,
  test runners, Storybook and linters (#303 alone added about 42 MB) from the Pi's tool build.
  `playwright-core` moves to the root `dependencies`, because the Assistant GM driver and stages 11
  and 13 load it from the build. Older tags that still list it as a dev package keep everything
  (with a warning), and the stage stops before the swap when the build has no `playwright-core`.
