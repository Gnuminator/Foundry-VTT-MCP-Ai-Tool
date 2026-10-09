### Development

- **Typed session events (lint zero step 3, session-events sweep):** the module's play recorder
  hooks (`session-events.ts`: chat, rolls, damage, combat turns, HP and resource changes, effects,
  scene and journal events) read Foundry documents through `unknown` and the `doc-read` helpers
  instead of `any`, and the play-by-play has named types. ESLint warnings drop from 4105 to 3853;
  the file has none left. Recorded events keep the same shape and the same recording conditions.
