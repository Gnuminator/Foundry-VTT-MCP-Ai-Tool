### Module

- **No more "Cannot use 'in' operator to search for 'world'" error on page load:** the module kept the
  world of its saved error list under `foundry-mcp-bridge.diagnostics.world`, next to the list itself
  at `foundry-mcp-bridge.diagnostics`. A module that unfolds all browser-stored settings into an object
  (Monk's Player Settings does at `ready`) tripped over the pair and logged the error on every load.
  The world is now kept at `foundry-mcp-bridge.diagnosticsWorld` and the old key is moved there and
  removed the first time the page loads.
