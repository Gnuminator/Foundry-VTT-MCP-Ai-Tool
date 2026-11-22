### Dashboard

- **The dashboard loads about 8 KB lighter:** the toast stack and the hover tips (tooltips) are fetched after the first paint instead of with it, and the client-versions texts come from the browser-safe shared entry. The first load is 141.6 KB of the 150 KB limit. A tip shows from about a second after the page opens, or on the first hover (a tip no longer opens at once right after its neighbour's; a focused control waits for its blur before getting its tip). If the toast chunk cannot load, a plain list shows the texts (backlog `first-load-diet`, `web-shared-browser-import`).
- **A lint rule keeps the dashboard page off the main shared entry:** a value import from `@gnuminator/shared` under `web/src` now fails lint; use `@gnuminator/shared/browser`, or `import type`.
