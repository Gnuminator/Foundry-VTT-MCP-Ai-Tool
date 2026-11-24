### Fixed

- **Tests lows sweep:** the tool-eval fixture uses the current Claude menu name, `scripts/site/build.test.mjs` is a named test-folder exception (it runs in wiki.yml), `auto.ps1 -Session` refuses a path or wildcard, and a leftover `if True:` block in a session-notes test is gone.
