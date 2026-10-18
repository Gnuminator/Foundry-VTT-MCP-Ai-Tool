### Fixes

- **A guarded update that Foundry quietly drops now fails and is undone:** after each update the
  module checks that a token's position and size (x, y, width, height, depth) are what Foundry
  stored. If a constrained move, a hook or a region made Foundry ignore part of it, the change stops with a
  message naming the path, and what did land is put back.
- **Fit tokens to the map's scale (follow-ups to #418):** the size also sets the token's depth; a
  whole-scene fit skips party and encounter actors that have no creature size; a token that is
  already the right size but not locked shows "already 0.25 squares; locks the size"; the
  `plan-token-change` description says "every creature" and that a 2.5 ft scene makes tokens larger.
