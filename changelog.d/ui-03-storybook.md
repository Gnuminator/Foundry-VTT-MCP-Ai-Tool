### Dashboard

- **Storybook for the React dashboard (UI-03):** every `ui/` component, every shared component
  (drawer, pane, confirm window, toasts, the moment views, the menu and the picker) and every
  ported panel now has stories in every state it can be in, with made-up data and no bridge: loaded,
  empty, loading, failed, bridge down, GM Actions off, long names, eight characters, the Veil theme
  and a phone width. `npm run storybook` runs it, with the theme and the mist in the toolbar and
  the same stylesheets as the real page; `npm run build-storybook` builds the static site, which
  the wiki workflow publishes under `/storybook/`. It is a dev dependency of the dashboard package
  only, so the app build, the Docker image and the bundle budget do not change. The screenshot
  tests photograph every story too (one extra Playwright project, `stories`, which reads
  Storybook's `index.json`) and run axe on each, in the same `dashboard-visual` CI job. The
  dashboard README has a "Stories" section for the next ports.
