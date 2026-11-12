### Tooling

- **Releases wait for an approval, and workflow actions are pinned:** the publish job of `release.yml` runs in the
  GitHub environment `release`, so pushing a tag builds but only publishes after the user presses Approve in the
  Actions run. Every `uses:` in `.github/workflows` is pinned to a full commit with the version as a comment, and
  `scripts/workflow-pins.test.mjs` fails on an unpinned action or a publish job without the environment
  (github-hardening).
