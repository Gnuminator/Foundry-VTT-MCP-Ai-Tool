### Orange Pi (#310 and #311 follow-ups)

- **A dev-only import can no longer reach the Pi unnoticed:** `scripts/pi/runtime-imports.test.mjs`
  (a CI step, also in `npm run green`) reads the sources of the bridge, the dashboard server, the Discord
  bot and `shared` with the TypeScript parser and fails when one imports a package that is not a
  `dependencies` entry of its workspace, because stage 5 drops the dev packages. It also checks the
  Pi's browser scripts and that the lock keeps a single copy of `playwright-core`.
- **Stage 5 prunes on a rerun too:** a build of the same ref that still has its dev packages (an
  earlier stage 5, or a ref that moved past the prune) is built once more, pruned; a pruned build
  carries `.tool-pruned` and is left alone. The empty `node_modules/@storybook` folder is removed.
- **Stages 11 and 13 end with the GM password check:** they warn when Foundry has no administrator
  password or a world has a Gamemaster or Assistant GM without one, so a world or GM user added
  after stage 12 is noticed (add `lib-gm-passwords.sh` to the pipe; the stage says so when it is
  missing). The administrator password is under the Configure gear (Application Configuration) and
  reads "Change Password" once set; the docs and messages now say so.
- **Stage 13 container test:** a second run on the same fake Pi (the module install is skipped) and the
  closing GM password check are covered.
