### Dashboard

- **Initiative ribbon: portraits and pan to token (UI-07):** each creature in the ribbon shows its
  token portrait (its initials when it has none), and clicking it pans Foundry to that token on the
  GM's screen, switching scene first when needed. It only moves the view; nothing in the game
  changes.

### Module

- **Combat snapshot carries the token image and uuid:** `get-combat-state` combatants now include
  `img` (an address the dashboard can load) and `tokenUuid`. `open-in-foundry` takes an optional
  `pan: true` with a token uuid to pan the GM's view to it instead of opening its sheet.
