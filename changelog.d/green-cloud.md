### Tooling

- **`npm run green -- --cloud`:** runs the checks on GitHub instead of the PC, for when the local
  heavy-check queue is long. It refuses a dirty tree or a HEAD that is not pushed to `aitool`,
  reuses the CI run already started for that commit or else starts `ci.yml` by workflow_dispatch,
  waits, and prints one line: OK with the run URL and time, or the failed job, step and URL. It takes
  no heavy-check lock and runs nothing locally. The lane skill says when to use it.
