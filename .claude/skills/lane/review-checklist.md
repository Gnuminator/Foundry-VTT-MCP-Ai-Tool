# Review checklist (from past incidents)

Use before calling work done and in reviews. Incident notes: vault `Dev/Foundry AI Tool/Lessons/`.

1. New access or exposure controls default to the safe state; verify the actual bind or gate in
   code, not a comment.
2. Check Foundry and dnd5e API shapes against the installed version's source or docs; `??`
   fallbacks and old mocks hid real breakage.
3. Re-verify claims from workers, tools and reports (line counts, "unused" lists, "build passes")
   from a clean checkout.
4. A default that lives in several layers (env var, module setting, UI, backend) changes in all of
   them together and gets a live check.
5. A refactor claimed to be a pure move is diffed byte for byte.
6. Removing a feature or dependency: grep every text file type (docs, `.env.example`, configs), not
   only `.ts`.
7. Every accepted socket gets its own error handler.
8. Worker specs for Foundry module code say up front: no `any`, zero new lint warnings (the ratchet
   is per rule and only goes down).
9. Test every GM-only or whispered path live on the current Foundry major and check the created
   message's `whisper`/`blind`: Foundry 14 renamed roll modes to message modes and falls back to
   public for an unknown name.
10. Foundry 14 keeps deprecated shims (`BaseMeasuredTemplate`, an empty `scene.templates`): detect
    features by schema (`BaseScene.metadata.embedded`), never by class or property presence.
11. Live-test recorder output against a real world before trusting it (stale
    `_stats.modifiedTime` on unlinked tokens passed unit tests).
12. Foundry 14 `game.time.serverTime` is server uptime, not wall-clock time; use `Date.now()` for
    stamps shared between browsers. Foundry's data route ignores `fetch(path, {method: 'DELETE'})`.
13. Finding which files raised lint counts: `eslint -f json` compared against a temporary
    `git worktree` at HEAD (junction its `node_modules`, delete the junctions before
    `git worktree remove`), ESLint run from the repo root.
14. Before `git worktree remove`: check for processes running from that folder
    (`Get-CimInstance Win32_Process` filtered on the path); the test bridge and dashboard run from
    whichever checkout started them. `git -C <folder>` on a folder that is no longer a registered
    worktree silently reports the main checkout: use `git worktree list` first.
15. Stage scripts: a bare `rm -rf "$var"` fails the guard test; use `${var:?}`. Run
    `node --test .claude/hooks/guard-remote-commands.test.mjs` before pushing one.
