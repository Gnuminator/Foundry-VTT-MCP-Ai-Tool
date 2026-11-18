### Fixes

- **Merge refusals say why:** a failing CI check in a refusal now names the failing step (and the
  job's first annotation), a job that hit its limit reads "timed out after 25 min", and a green
  PR makes no extra gh call. drift-check runs a guard once more when Vitest could not start a
  worker, and a refusal that still fails that way is marked as infrastructure, not the PR, so the
  merge runner tries it again by itself (I-157).
