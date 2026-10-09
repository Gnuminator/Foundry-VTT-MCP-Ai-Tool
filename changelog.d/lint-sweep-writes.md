### Development

- **Typed data-access writes (lint zero step 3, second sweep):** the module's combat, rest and
  roll, resources and effects, actor creation, player roll buttons, creature index, world items
  and scene sound files use the typed Foundry declarations instead of `any`, with local types for
  the dnd5e roll and rest methods and result types for their replies. ESLint warnings drop from
  4966 to 4137; these seven files have none left. No behaviour changes: a few `||` became `??`
  only where the value is an object or an array.
