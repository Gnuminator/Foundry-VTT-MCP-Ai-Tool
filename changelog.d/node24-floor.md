### Tooling

- **Node 24 is the floor:** the installer ships Node 24, the release workflow, the `engines`
  fields, `@types/node` and the bundle target move to 24, and the Node 22 CI job is gone. The one
  full x64 job is now `build-test (Node 24)` and also runs the bundle budget, the browser tests and
  the zip upload. The ARM job skips the typecheck, lint, em-dash and docs checks that the x64 job
  already runs, which saves about a minute and a half.
