### Fixes

- **A world switch no longer shows the old world:** when the open world changes, the dashboard
  forgets the old world's events, module errors and fight (the `/player` page and the GM screen
  both start clean), and the Foundry module drops the previous world's errors from its browser
  storage when the new world loads.
