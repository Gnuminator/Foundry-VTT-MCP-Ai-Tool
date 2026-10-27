### Tooling

- **Dashboard screenshot baselines before the PR:** `npm run visual:baselines -- <branch>` starts
  the new `visual-baselines` workflow, which renders the screens and story shots in the same
  Playwright image as `dashboard-visual`, and unpacks the changed or new PNGs into the checkout.
  Commit them before opening the PR so the first PR run is green. The lane skill now says so.
