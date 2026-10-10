### Dashboard

- **Screenshot tests and a bundle budget for the React dashboard (UI-01, UI-05):** Playwright
  screenshots of the Before, During and After views, every ported drawer, the Advanced menu and the
  version banner, in both themes at 1440, 1080 and 390 pixels wide (78 baselines, made in the
  Playwright Linux image so they match CI), plus an axe accessibility check on each screen.
  `npm run test:visual` runs them in Docker and `npm run test:visual:update` refreshes the
  baselines. A new CI job, `dashboard-visual`, runs them and keeps the diff report as an artifact.
  `npm run bundle:budget` fails the build when the dashboard's first-load JavaScript or a lazy chunk
  grows past its recorded gzip limit. Playwright moves from 1.63 to 1.64.
