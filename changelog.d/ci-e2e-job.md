### Tests

- **Dashboard browser tests in their own CI job:** the Playwright tests now run in three parallel shards, only on a pull request that touches the dashboard, shared, the lockfile or the workflow (always on main), under one summary check `dashboard-e2e (browser tests)`. A test pins the path filter and that the specs import only from the dashboard and shared (pick R2).
