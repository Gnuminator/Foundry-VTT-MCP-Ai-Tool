### Development

- **Changelog fragments (D-089):** a pull request adds its CHANGELOG entry as its own file in
  `changelog.d/`; `npm run changelog:fold` moves them into "Unreleased" (CI checks them with
  `npm run changelog:check`). No separate upkeep pull requests any more.
- CI runs once per pull request (on `pull_request`, and on pushes to `main`), not twice.
