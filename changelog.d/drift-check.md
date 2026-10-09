### Developer tools

- **Drift check before "PR ready":** `npm run drift:check` fetches main, merges it into a copy of
  the branch in a throwaway git worktree, and runs there the guards that only fail once another
  lane's PR is on main (lint and em-dash baselines, changelog fragments, usage catalog, version
  sync, docs lint and links, the mcp-server tests with the tool counts, reference and set budgets,
  the module write gate). The lane's own tree is never touched; nothing is committed or pushed. It
  needs a clean tree and names the files when main conflicts.
