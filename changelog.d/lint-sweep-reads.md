### Development

- **Typed data-access reads (lint zero step 3, first sweep):** the module's scene and token,
  world, journal, chat, ownership and module reads use the typed Foundry declarations from step 1
  instead of `any`, with local result types for their replies. ESLint warnings drop from 5543 to
  4966; these six files have none left. No behaviour changes beyond leaving out an empty `img` key
  on the active scene and `??` in place of `||` on a few object fallbacks.
