### Tooling

- **`green --quick` covers more of the dashboard:** a change under `packages/cogm-dashboard/web/` now also runs the usage catalogue check, the dashboard build and the bundle budget, the steps CI failed on after a quick pass. The catalogue check also runs when a file it scans changes (dashboard `public/`, module `src/`). A quick run that touched dashboard web files ends with a reminder that screenshots are left to CI.
