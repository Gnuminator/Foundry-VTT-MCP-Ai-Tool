### Tooling

- **Green runs the light steps first:** `npm run green` runs the steps that need neither the build nor a heavy slot (hook, docs, Pi, Plan B and TV tests, the changelog check) before the first heavy step, so the heavy-check lock is held only for typecheck through the browser run. CI keeps its own order. `--from` and `--list` follow the reordered run order, so a rerun from a light step still runs typecheck.
- **Stale comments:** `heavy-lock.mjs`, `green.mjs` and `lane-merge.mjs` no longer say the pre-push hook takes the heavy lock.
