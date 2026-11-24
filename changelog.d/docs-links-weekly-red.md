### Fixes

- **Weekly docs link check green again:** lychee skips the two wiki landing pages, whose links are
  site paths it cannot resolve, and the wiki workflow installs Storybook on Node 24 so the lockfile
  matches. The install failed on Node 22, which left `/storybook/` returning 404 (Backlog
  `docs-links-weekly-red`).
