### Docs

- **Our own Foundry basics pages:** `docs/foundry/` explains Foundry itself for a new GM (screen
  tour, glossary, worlds and joining, users and permissions, scenes, actors, tokens, journals, chat
  and dice, combat, layers/walls/lighting, measuring and templates, compendiums, modules,
  playlists), written from the verified Foundry 14 UI and checked live. They replace the links to
  Foundry's own knowledge base, whose pictures predate Foundry 14.
- **Re-runnable pictures:** `npm run docs:foundry-images` (`scripts/demo/foundry-basics.mjs`) makes
  every screenshot and short MP4 loop in `docs/images/foundry/` from the demo world on a test
  server (`FOUNDRY_TEST_SERVER=B` picks server B; the demo scripts' `testEnv()` now honours it).
