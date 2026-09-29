# Dev setup — VS Code

The quickest path to a working dev environment for this repo (Node + TypeScript + npm workspaces).
A `.vscode/` config ships with the repo, so most of this is automatic.

## 1. Open the project

- **File → Open Folder** → select the repo root **`foundry-vtt-mcp`** (the folder that contains
  `package.json`). _Not_ the parent "Foundry VTT MCP" folder.
- When prompted **"Do you trust the authors?"** → **Yes / Trust** (it's your repo; required for the
  extensions, tasks, and the TypeScript server to run).

## 2. Extensions

VS Code reads `.vscode/extensions.json` and offers the recommended set in a notification — you've already
installed them. The repo's `.vscode/settings.json` then configures them automatically:

- **Prettier** is the default formatter with **format-on-save** (matches `.prettierrc` + CI's `format:check`).
- **ESLint** auto-fixes on save and resolves the right config per workspace (`.eslintrc.json`).
- **TypeScript** uses the workspace version (`node_modules/typescript`). If VS Code prompts
  **"Use Workspace Version"**, accept it. (Or: open any `.ts` file → `Ctrl+Shift+P` →
  "TypeScript: Select TypeScript Version" → Use Workspace Version.)

No per-extension tweaking needed beyond that.

## 3. Verify the toolchain (integrated terminal)

Open the terminal with **`` Ctrl+` ``** (it opens at the repo root) and confirm green:

```bash
npm install            # only needed on a fresh clone; skip if node_modules already exists
npm run build          # composite build of all workspaces
npm run typecheck      # strict TS, all workspaces
npm test -w @gnuminator/shared           # 49
npm test -w @gnuminator/foundry-module   # 12
npm test -w @gnuminator/mcp-server       # 1030
npm test -w @gnuminator/cogm-dashboard   # 29   (1120 total)
node scripts/mcp-schema-smoke-test.mjs
node scripts/standalone-smoke-test.mjs
node scripts/cogm-split-smoke-test.mjs
node validate-manifest.js
```

If a workspace build emits nothing, delete stale `*.tsbuildinfo` and rebuild. The **Vitest** extension
also gives you a Testing sidebar — run/debug any of the 1120 tests inline once it indexes.

> Windows note: the integrated terminal defaults to **PowerShell**. `git`, `node`, and `npm` work there.
> For the bash-style one-liners above, you can switch the terminal profile to **Git Bash** (terminal
> dropdown → Select Default Profile), or just run them one per line in PowerShell.

## 4. Start Claude Code

- **Recommended:** open the **Claude Code** extension from the Activity Bar (sidebar), sign in with your
  Anthropic account, and follow any one-time setup prompt. It runs **independently of Claude Desktop** —
  closing/restarting Claude Desktop won't touch it.
- **Or** run `claude` in the integrated terminal (needs the Claude Code CLI; the extension can install it).

Then paste the **handoff prompt** to continue (Phase 8 → Phase 9). Keep **Claude Desktop only for
_playing_** (its `foundry-mcp` AI-GM tools); do development here.

## 5. (Later) running the bridge + dashboard from VS Code

For live work, in a terminal here:

```bash
npm run build                 # ensure dist is current
npm run bridge:standalone     # the MCP backend (werift) on 31414/31415/31416
npm run dev:cogm              # the co-GM dashboard → http://localhost:3000
```

Because this session is decoupled from Claude Desktop, you can own the bridge cleanly (close Claude
Desktop's `foundry-mcp` first to free the ports). See `docs/PHASE6-DESIGN.md` and the
`claude-code-bridge-ownership` note.
