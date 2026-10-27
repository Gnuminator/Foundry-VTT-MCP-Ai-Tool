### Tooling

- **Lint wording after the zero baseline:** the lint ratchet header, the CI step names and
  `DEV-SETUP.md` now say errors, not warnings. ESLint checks caught errors too (`caughtErrors:
'all'`); the three unused `catch (error)` bindings became `catch {`.
