### Fixes

- **Merge gate after #531:** the drift check no longer runs the MCP modern-client probe test,
  which needs a built `dist/index.js` that its trial-merge worktree never has. Since #531 every gate
  refused on it. CI and `npm run green` still run the probe after a build.
