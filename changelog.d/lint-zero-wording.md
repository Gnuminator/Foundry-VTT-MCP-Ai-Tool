### Tooling

- **Lint wording after the zero baseline:** the lint ratchet header, the CI step names and
  `DEV-SETUP.md` now say errors, not warnings.
- **Caught errors are linted:** `caughtErrors: 'all'` is on. The three unused `catch (error)`
  bindings became `catch {`.
