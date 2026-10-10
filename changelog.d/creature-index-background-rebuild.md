### Module

- **The creature index rebuilds in the background after a pack change** (#283 lows 1, 3, 4): a
  change to an Actor compendium deletes the saved index as before, and five seconds after the
  last change the bridge GM's browser rebuilds it, so the next creature query does not wait on
  the build. With Bridge User "Any GM" only the active GM builds (at `ready` too), so several GMs
  online build once. Tests cover the warm-up gates and the background rebuild.
