# The test kit

The test kit checks that the whole tool works together: Foundry, the module, the bridge, the
dashboard and the player screen. It builds a small known world, then runs scenarios against it and
writes a report. Run it before you call a change done, and before a real session.

The kit lives in `scripts/test-kit/`. Its plan is in the Obsidian vault
(`Dev/Foundry AI Tool/Design/Test kit plan.md`).

## What it does

1. **Build.** It joins a kit world as the passwordless "Kit GM", wipes what an earlier build made,
   and builds the kit again. The same every time:
   - a scene "Kit Arena" (24 by 16 squares, with walls, a door and a light),
   - twelve level 1 heroes, one per class ("Kit Barbarian 1" and so on),
   - eleven monsters picked by rule from the system compendium (a CR 0 beast, a flyer, a legendary
     dragon, and so on),
   - a token for every one of them.
2. **Run.** It runs the scenarios. Each one talks to the bridge tools through the dashboard, and
   reads the truth straight from the Foundry page when it needs to.
3. **Report.** It writes `report.html`, `report.md` and `report.json` for the run.

The exit code is 0 when every scenario passed, 1 when one failed, and 2 when the environment is not
ready (nothing is listening, the wrong world, a refused target).

## Commands

```text
node scripts/test-kit/kit.mjs <command> [options]
```

| Command | What it does                                                                   |
| ------- | ------------------------------------------------------------------------------ |
| `init`  | Creates the kit world's files and its users (Kit GM, Kit Player). Run it once. |
| `build` | Opens the GM session and builds the kit. Writes the manifest.                  |
| `run`   | Runs the scenarios against the built kit and writes a report.                  |
| `all`   | `build`, then `run`.                                                           |
| `check` | Loads and validates every scenario against the tool catalog. Needs no Foundry. |

| Option               | Meaning                                                                    |
| -------------------- | -------------------------------------------------------------------------- |
| `--size smoke\|full` | Which scenarios to run. Default `smoke`. A scenario lists its own sizes.   |
| `--only a,b`         | Run only these scenario ids.                                               |
| `--scenarios <dir>`  | An extra scenario folder (repeatable). The repo's own folder is always on. |
| `--world <id>`       | The kit world. Only `ai-tool-kit-srd` is allowed for now.                  |
| `--report-dir <dir>` | Where the report goes. Default `<kit home>/reports/<time>-<size>`.         |
| `--fake`             | Use the in-process fake instead of Foundry (this is what CI does).         |
| `--headed`           | Show the GM browser window instead of running it hidden.                   |

`npm run kit` is a short way to start it. `npm run kit:test` runs the kit's own unit tests.

### Running it live

The local test environment must be up with the kit world:

```powershell
pwsh scripts/test-env/sync-module.ps1
pwsh scripts/test-env/start.ps1 -World ai-tool-kit-srd
node scripts/test-kit/kit.mjs all
pwsh scripts/test-env/stop.ps1
```

The kit opens its own GM page first. The bridge only has a Foundry link while that page is open.
The test server is shared: run one live job at a time. See the `foundry-test-env` skill.

## Where things live

| What                                      | Where                                                     |
| ----------------------------------------- | --------------------------------------------------------- |
| The engine, the GM actions, the fake      | `scripts/test-kit/lib/`                                   |
| The contract everything builds against    | `scripts/test-kit/lib/contract.mjs`                       |
| The SRD scenarios (no licensed content)   | `scripts/test-kit/scenarios/*.scenario.mjs` (in the repo) |
| What the builder makes                    | `scripts/test-kit/data/smoke-matrix.json`                 |
| The manifest of the last build            | `<kit home>\worlds\<world>\manifest.json`                 |
| Reports                                   | `<kit home>\reports\` (this PC only)                      |
| Licensed scenarios (they name book items) | `<kit home>\licensed\` (this PC only)                     |

The kit home is `C:\FoundryTest\test-kit`, or the folder in the environment variable
`TEST_KIT_HOME`. **Licensed scenarios and reports never go into a repo or the vault.** A scenario
names documents by name or id and never carries book text. Load licensed ones with
`--scenarios C:\FoundryTest\test-kit\licensed`.

## The scenarios

Five SRD scenarios ship in the repo. All of them are in the `smoke` and `full` sizes.

| Id                    | What it proves                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------ |
| `bridge-health`       | The bridge, dashboard and module agree: health, world, module version, all tools, the kit. |
| `compendium-monsters` | Every kit monster matches its compendium entry and has a token on the scene.               |
| `guarded-damage-undo` | A guarded damage change applies, is listed, undoes exactly, and healing stops at the max.  |
| `scripted-fight`      | A short fight shows up the same way in combat state, play-by-play, session log and stats.  |
| `player-no-spoilers`  | A hidden token, monster HP numbers and true names never reach the player screen.           |

## How to write a scenario

A scenario is a file `<id>.scenario.mjs` whose default export describes it. The full contract is in
`lib/contract.mjs`. In short:

- `id` (kebab-case), `title`, `sizes`, `tags`, `needs` (which parts of the manifest it uses).
- `tools`: every bridge tool it calls. `kit check` fails if a tool is not in `tool-sets.ts`.
- `gmActions`: every GM action it calls (the only way to run code inside Foundry).
- `run(t)`: the scenario. `t` has `step`, `check`, `equal`, `tool`, `guarded.planApply`,
  `guarded.undo`, `gm`, `player.state`, `player.html`, `http`, `kit` (the manifest), `log`,
  `attach` and `cleanup`.

A tiny example:

```js
export default {
  id: 'world-name',
  title: 'The world has a title',
  sizes: ['smoke', 'full'],
  tags: ['bridge'],
  needs: [],
  tools: ['get-world-info'],
  async run(t) {
    await t.step('get-world-info names the kit world', async () => {
      const info = await t.tool('get-world-info', {});
      t.equal(info.id, t.kit.world, 'world id');
    });
  },
};
```

Rules of thumb:

- **Leave the world as you found it.** Register a `t.cleanup(...)` for everything you change. They
  run after the scenario, last in first out, even when it failed. End combats, undo changes, remove
  tokens.
- **Read the truth from Foundry, not from the tool under test.** Use the GM action `readActor` to
  check HP. Monster tokens are unlinked, so pass `sceneId` and `tokenId` to read the token's own HP.
- **Wait for the bridge when it needs a moment.** `waitFor` in `lib/helpers.mjs` polls until a
  condition holds. The play log and the player screen are not instant.
- **Do not compare against random rolls.** Set fixed values (initiative, damage amounts) and
  compare the numbers you set or read.
- **A new GM action** goes into `GM_ACTIONS` in the contract, `lib/gm-actions.mjs` and the fake,
  all three together.
- A `continueOnFail` step lets the scenario go on after a failure. Use it for lists of
  independent checks, such as one step per monster.

## CI and live

CI has no Foundry, so it runs the kit against the fake (`lib/fake/`). The fake is a small HTTP
server that answers the dashboard API (`/api/health`, `/api/tools`, `/api/tool`, `/api/control`,
`/api/player/state`, `/player`) from a tiny in-memory game, and a `gm` object with every GM action.
It is not dnd5e. Its job is to catch mistakes in the scenarios and in the engine: a wrong tool
name, a broken step, a changed contract.

CI runs three things after the build:

1. `npm run kit:test`: the engine's unit tests, including a full `all --fake` run and a test that a
   deliberately broken scenario fails.
2. `node scripts/test-kit/kit.mjs check`: every scenario loads and names only real tools.
3. `node scripts/test-kit/kit.mjs all --fake`: the whole kit against the fake.

The fake can only be as right as its author. The live run is the real check. **A green CI run does
not replace a live run** when you changed the module, the bridge link or a guarded write.

When you change a tool's result shape, change the fake with it.

## Safety guards

- **Kit worlds only.** The kit builds and writes only in the worlds listed in `KIT_WORLDS`
  (`ai-tool-kit-srd`). It never touches a real campaign, `ai-tool-test` or `ai-tool-kit`.
- **The wipe is by flag.** Every document the builder makes carries the flag `world.testKit`. A
  rebuild deletes only documents with that flag.
- **Live ports are refused.** The bridge ports 31414 to 31416 are never used, also with `--fake`.
  The only real target is the test dashboard on `127.0.0.1:3100` and the test Foundry on
  `127.0.0.1:30001`. Anything not on this machine is refused.
- **Wrong world, no run.** If the connected world is not the kit world, the run stops with exit code
  2 before it changes anything.
- **GM Actions are turned on for the run and put back** as they were found.
- **No secrets.** The kit never types a password. The GM and player users are passwordless.

## What comes next

- Leveling the heroes to levels 5, 11 and 17 (the `full` and `long` sizes).
- The full matrix of classes, monsters and spells.
- Dashboard checks in a real browser (Playwright), not only the JSON the dashboard serves.
- A Pi target: the same kit against the Orange Pi, once the Pi has a kit world.
- The licensed layer: the Curse of Strahd scenarios, kept on this PC only.
