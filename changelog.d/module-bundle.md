### Module

- **The module ships as one bundled file:** `dist/main.js` now holds the whole module, built with
  esbuild, so it can use code from the shared package (the first four helpers, `asRecord`,
  `errorMessage`, `escapeHtml` and `newId`, no longer exist as copies). `sync-module.ps1 -Watch` now
  bundles on save and no longer checks types. Nothing changes for the GM or players.
