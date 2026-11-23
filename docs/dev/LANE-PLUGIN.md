# The lane kit plugin

The lane kit (the skills `lane`, `planner`, `pi-work` and the `foundry-*` ones, the review agents, `/ready` and the
guard hooks) is also built as one Claude Code plugin, `foundry-lane-kit`, so a PC without a checkout of this
repo's `.claude/` folder can use it. `.claude/` stays the one place to edit; `plugin/foundry-lane-kit/` is
generated and never edited by hand.

## Install on a PC

```powershell
claude plugin marketplace add Gnuminator/Foundry-VTT-MCP-Ai-Tool
claude plugin install foundry-lane-kit@foundry-ai-tool
```

Inside this repo's own checkout and worktrees `.claude/` already loads the same skills and hooks, so do not
install the plugin there as well: the hooks would run twice.

## Update

```powershell
claude plugin marketplace update foundry-ai-tool
claude plugin update foundry-lane-kit@foundry-ai-tool
```

The plugin version is the tool version plus a short hash of the kit (`0.31.0+1a2b3c4d`), so any change to a skill,
agent or hook is a new version even between releases. The committed copy is refreshed at release (step 0 of
[RELEASING.md](RELEASING.md)), or any time with `npm run plugin:build` in a small PR.

## Checks

- `npm run plugin:check` exits 1 when the committed copy differs from `.claude/`.
- `npm run plugin:install-check` installs the plugin into a throwaway profile (`CLAUDE_CONFIG_DIR` in a temp
  folder), checks the skills, agents, `/ready` and hooks that landed, runs two installed hooks and proves a
  version bump reaches the profile. It never touches the real profile.
