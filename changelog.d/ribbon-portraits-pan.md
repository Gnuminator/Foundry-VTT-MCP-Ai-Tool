### Dashboard

- **Initiative ribbon: portraits and pan to token (UI-07):** each creature in the ribbon shows its
  token portrait (its initials when it has none or it does not load), and clicking it pans the GM's
  Foundry view to that token, switching scene first when needed. It only moves that GM's screen;
  nothing in the game changes. Portraits load from `FOUNDRY_AI_FOUNDRY_URL` (the address your
  browser uses for Foundry, the same setting as the Obsidian mirror); without it the ribbon shows
  initials.

### Module

- **Combat snapshot carries the token image and uuid:** `get-combat-state` combatants now include
  `img` (a Foundry path) and `tokenUuid`. `open-in-foundry` takes an optional `pan: true` with a
  token uuid to pan the GM's view to it instead of opening its sheet.
