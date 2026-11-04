### Tooling

- **Dashboard browser tests use 4 workers in CI:** the runner has 4 vCPUs and Playwright used 2.
  The x64 job should finish closer to the ARM job.
