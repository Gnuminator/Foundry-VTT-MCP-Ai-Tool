### Dashboard

- **Design tokens and a shared Panel for the React dashboard (UI-02):** spacing, type, motion,
  layer and focus-ring tokens in `themes/brand.css` (The Veil sets only its own slower
  `--ease-mist`), and a small component set in `web/src/ui`: `Panel` with six states (ready,
  loading, empty, error, bridge down, gated), `Card`, `Section`, `Stat`, `Pill`, `Button`,
  `IconButton`, `EmptyState`, `ErrorState`, `Skeleton` and `QueryState`, which turns a TanStack
  Query result into the right state so no panel writes its own "Loading…" and "Couldn't load".
  Drawers, panes over the page and every ported panel now use them. Nothing changes on screen (the
  screenshot tests stay at zero diffs) and the old page is untouched. The dashboard README has a
  "Building a panel" section for the next ports.
