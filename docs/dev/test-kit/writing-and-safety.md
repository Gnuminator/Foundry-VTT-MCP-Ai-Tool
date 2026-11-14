---
title: Writing scenarios, CI and safety guards
description: Console errors, how to write a scenario, dashboard pages and screenshots, where things live, CI and live, safety guards and what comes next.
---

# Writing scenarios, CI and safety guards

Part of [TEST-KIT](../TEST-KIT.md).

## Console errors

The GM page's console errors and page errors are collected for the whole run. A full run can log
hundreds of the same one, so the report **groups** them: same message and place, with ids, hosts and
line numbers stripped (`Texture <id> failed`), and for a page error the function it was thrown in.
Each group shows its count, first and last time, and the scenarios it came during (`build` for the
build). New groups come first. The raw list stays in `report.json` (`consoleErrors`, each with
`at`, `message`, `source` and `scenario`); the groups are there too (`consoleGroups`).

**Known groups.** A group is known when its finding id is in `data/studio-expected.json` (ids that
start with `console:`: the hook it names, `console:gas.captureAdvancement`, or the file it failed to
load, `console:black-parchment.webp`; a page error gets `console:pageerror:<function>`). Known groups
show their kind (STUDIO, SYSTEM) and reason. Anything else is **NEW**: the report starts with a
warning line, `report.md` and `report.html` mark the group, and the command prints the totals and
every new group at the end. A new console error warns and does not fail the run; the older rules
still fail: a console error from our own module fails its scenario (the `module console errors`
step), and `heroes-studio` fails on a new Actor Studio finding. To accept a new known error, add an
entry with its id to `studio-expected.json` and say why.

**The notification error (fixed in the kit).** Full runs used to log hundreds of `TypeError: Cannot
set properties of null (setting 'hidden')` from `#postNotification`. Cause: the kit uses an item or a
spell, which makes a chat card, and puts the world back by deleting the card moments later. Foundry
14 shows each new card as a pop-up notification and animates it for about 100 ms; when the card is
deleted in that time its element is gone, and the next line (`element.hidden = false`, Foundry
`chat.mjs`, `#postNotification`) throws. It needs a card created and deleted within a tenth of a
second, which a table never does, so this is a kit artifact and not a bug to report. The kit's GM
page now answers "no" to `_shouldShowNotifications` (the same as the setting "Chat notifications:
pip"; `quietChatNotifications` and `keepChatNotificationsQuiet` in `lib/gm.mjs`), so no pop-up is
animated. The change is made again after every page reload (Actor Studio setup and a failed Studio
build reload the page, and a reload brings the pop-ups back). If the error comes back it shows as
NEW, which means the page hook no longer works.

## How to write a scenario

A scenario is a file `<id>.scenario.mjs` whose default export describes it. The full contract is in
`lib/contract.mjs`. In short:

- `id` (kebab-case), `title`, `sizes`, `tags`, `needs` (which parts of the manifest it uses).
- `order` (optional number, default 0): lowest runs first. The feature scenarios have 100, so they run near the end (`module-load` has 200 and `dashboard-login-split` 1000, so those two run after them): they
  post thousands of chat cards.
- `t.size` (read only): the kit size of the run, for a scenario that samples.
- `tools`: every bridge tool it calls. `kit check` fails if a tool is not in a tool set (`tool-sets.ts`, derived from the tool modules).
- `gmActions`: every GM action it calls (the only way to run code inside Foundry).
- `run(t)`: the scenario. `t` has `step`, `check`, `equal`, `tool`, `guarded.planApply`,
  `guarded.undo`, `gm`, `player.state`, `player.html`, `http`, `kit` (the manifest), `log`,
  `attach`, `attachFile`, `browser` (dashboard pages in Edge, see below) and `cleanup`.

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
- **Pick heroes with the helpers.** Not every hero has a token: `tokenHeroes(kit)` lists the ones
  on the scene, `playerHero(kit)` the one the player owns, `builtHeroes(kit)` the ones that were
  built. A hero with a `buildError` has no actor.
- **A new GM action** goes into `GM_ACTIONS` in the contract, `lib/gm-actions.mjs` and the fake,
  all three together. An action that changes a hero (`exerciseActor`) puts it back and says whether
  that worked. Page code you want kit:test to reach goes in a lib file of its own, listed in
  `GM_ACTION_HELPERS` (gm-actions.mjs): gm.mjs sends its source with the action as
  `args._helpers.<name>` and the action rebuilds it with `new Function` (`settleCreated`, used by
  `createHero`, is the first). It must be self-contained like the actions.
- A `continueOnFail` step lets the scenario go on after a failure. Use it for lists of
  independent checks, such as one step per monster or per hero.

### Dashboard pages and screenshots

A scenario that checks the dashboard or the player view in a real browser uses `t.browser` and
`t.attachFile`. Both are for the live run only: against the fake `t.browser` is null (check for it and
call `t.skip(...)`), and `t.attachFile` returns null when the run has no report folder.

- `await t.browser.open(path, { fresh, viewport })` opens a page of the dashboard (`path` is relative,
  for example `/` or `/player`) and waits for it to load. It returns a Playwright page. By default the
  page is a new tab in the GM's Edge. With `fresh: true` it is a separate headless Edge with no cookies,
  for the login checks; that browser starts the first time a scenario asks for it. `viewport` sets the
  size, for example `{ width: 390, height: 844 }` for a phone.
- `t.browser.consoleErrors(page)` returns the console and page errors of that page so far (of every page
  of the scenario without an argument). The runner also puts them in the report's console errors with
  `page: 'dashboard'` or `'player'` (a path starting with `/player`), grouped apart from Foundry's errors.
  Close nothing yourself: the runner closes every page after the scenario, even when it failed.
- `t.attachFile(name, data, { type })` writes a file (a screenshot from `page.screenshot()`, `type`
  `'image/png'` by default) to `<report folder>/files/<scenario id>/<name>`. The name is cut down to
  lower case letters, digits, `.`, `_` and `-`. The report links the file in `report.md` and shows images
  in `report.html`. It returns the written path.

```js
const page = await t.browser.open('/player', { viewport: { width: 390, height: 844 } });
t.attachFile('player-phone.png', await page.screenshot({ fullPage: true }));
t.check(t.browser.consoleErrors(page).length === 0, 'the player page logs no errors');
```

## Where things live

| What                                      | Where                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| The engine, the GM actions, the fake      | `scripts/test-kit/lib/`                                                                                                                     |
| The contract everything builds against    | `scripts/test-kit/lib/contract.mjs`                                                                                                         |
| The hero checks and failure classes       | `scripts/test-kit/lib/advancement.mjs`                                                                                                      |
| The feature checks and rules tables       | `scripts/test-kit/lib/features.mjs`                                                                                                         |
| The monster checks, matrix and odd checks | `scripts/test-kit/lib/monsters.mjs`                                                                                                         |
| The spell judging and the sampling        | `scripts/test-kit/lib/spells.mjs`                                                                                                           |
| The deep spell checks and their rules     | `scripts/test-kit/lib/spells-deep.mjs`                                                                                                      |
| The spell GM actions (in the page)        | `scripts/test-kit/lib/gm-spells.mjs`                                                                                                        |
| The origin checks, hosts and multiclass   | `scripts/test-kit/lib/origins.mjs`, `origins-flow.mjs`, `origins-list.mjs`, `origins-feats.mjs`, `origins-multiclass.mjs`, `gm-origins.mjs` |
| The expected origin findings              | `scripts/test-kit/data/origins-expected.json`                                                                                               |
| Driving Actor Studio, the answer pump     | `scripts/test-kit/lib/studio.mjs`, `studio-flow.mjs`, `studio-pump.mjs`                                                                     |
| Comparing a Studio hero with a raw hero   | `scripts/test-kit/lib/studio-compare.mjs`, `inspect-build.mjs`                                                                              |
| The SRD scenarios (no licensed content)   | `scripts/test-kit/scenarios/*.scenario.mjs` (in the repo)                                                                                   |
| The SRD content profile                   | `scripts/test-kit/data/profiles/srd.json`                                                                                                   |
| The known findings of a profile           | `scripts/test-kit/lib/known.mjs`, `data/profiles/srd.known.json`, `<kit home>\licensed\profiles\<id>.known.json`                            |
| The module control table (inside Foundry) | `scripts/test-kit/lib/foundry-controls.mjs`                                                                                                 |
| The module control sweep drivers          | `scripts/test-kit/lib/foundry-sweep.mjs`, `foundry-sweep-changes.mjs`, `-handouts.mjs`, `-settings.mjs`, `-play.mjs`                        |
| The pick coverage                         | `scripts/test-kit/lib/picks.mjs`                                                                                                            |
| The monsters and the scene                | `scripts/test-kit/data/smoke-matrix.json`                                                                                                   |
| The manifest of the last build            | `<kit home>\worlds\<world>\manifest.json` (`worlds-B` for B)                                                                                |
| Reports                                   | `<kit home>\reports\` (this PC only)                                                                                                        |
| Console error groups, known list          | `scripts/test-kit/lib/console-errors.mjs`, `data/studio-expected.json`                                                                      |
| Licensed profiles and scenarios           | `<kit home>\licensed\` (this PC only)                                                                                                       |

The kit home is `C:\FoundryTest\test-kit`, or the folder in the environment variable
`TEST_KIT_HOME`. **Licensed profiles, scenarios and reports never go into a repo or the vault.** A
profile or scenario names documents by pack id, name or id and never carries book text. Load
licensed scenarios with `--scenarios C:\FoundryTest\test-kit\licensed`.

## CI and live

CI has no Foundry, so it runs the kit against the fake (`lib/fake/`). The fake is a small HTTP
server that answers the dashboard API (`/api/health`, `/api/tools`, `/api/tool`, `/api/control`,
`/api/player/state`, `/player`) from a tiny in-memory game, and a `gm` object with every GM action.
It is not dnd5e. It has a few classes and subclasses with made-up advancement data, including a
legacy pair, so the builder's selection rules, the hero checks and the three failure classes run
in CI. Its job is to catch mistakes in the scenarios and in the engine: a wrong tool name, a broken
step, a changed contract.

CI runs three things after the build:

1. `npm run kit:test`: the engine's unit tests, including full `all --fake` runs and tests that a
   broken scenario or a broken hero fails with the right message.
2. `node scripts/test-kit/kit.mjs check`: every scenario loads and names only real tools.
3. `node scripts/test-kit/kit.mjs all --fake`: the whole kit against the fake.

The fake can only be as right as its author. The live run is the real check. **A green CI run does
not replace a live run** when you changed the module, the bridge link or a guarded write.

When you change a tool's result shape, change the fake with it.

## Safety guards

- **Kit worlds only.** The kit builds and writes only in the worlds listed in `KIT_WORLDS`
  (`ai-tool-kit-srd`, `ai-tool-kit-licensed` and `strahd-kit`, the throwaway copy of the campaign
  world). It never touches a real campaign,
  `ai-tool-test` or `ai-tool-kit`.
- **The wipe is by flag.** Every document the builder makes carries the flag `world.testKit`. A
  rebuild deletes only documents with that flag.
- **Live ports are refused.** The bridge ports 31414 to 31416 are never used, also with `--fake`.
  The only real targets are a test server's dashboard and Foundry: `127.0.0.1:3100` and `:30001`
  (A), `:3101` and `:30002` (B), `:3102` and `:30003` (C). Anything not on this machine is refused.
- **Wrong world, no run.** If the connected world is not the profile's kit world, the run stops
  with exit code 2 before it changes anything.
- **GM Actions are turned on for the run and put back** as they were found.
- **No secrets.** The kit never types a password. The GM and player users are passwordless.
  `init` creates a missing Kit GM, Claude or Kit Player without a password. A user of that name
  that is already there keeps its password: a lower-role `Claude` is promoted to Gamemaster, and
  a password someone gave it stays.
- **Passwordless GMs only on the PC's test Foundry.** `init` provisions only `http://127.0.0.1:30001`
  (server A), `:30002` (B) or `:30003` (C), any loopback spelling, on Windows, because its passwordless GMs would be an open GM login on a
  host others can reach. A loopback address alone is not enough: on the Pi `127.0.0.1:30000` is the
  port the tunnel serves, and an SSH forward makes the Pi look local, so both are refused. An SSH
  forward onto port 30001 or 30002 itself cannot be told apart; never forward the Pi there. The
  Pi gets its Kit GM from the kit session stage instead, with a generated password (docs/dev/PI-SETUP.md, "Kit session").
- **The Pi target is opt-in and narrow.** `--target pi` is never the default. It runs only `run`
  (no `init`, `build` or `all`: the kit never builds, wipes or provisions on the Pi), only in
  `strahd-kit`, only the scenarios tagged `tools-only` (no GM browser, no GM actions, no manifest),
  never with `--fake` or `--scenarios <dir>`, and only with `--not-game-night`. The host must not be this PC, and the same
  live-port check refuses 31414 to 31416 on either port. A guard sits in front of the dashboard
  client: a tool call is refused unless the scenario declared the tool and it is a read tool or a
  `plan-*` tool (`mark-play-session` is not allowed), nothing is confirmed or applied, raw requests
  are GET only, and before each call the guard checks that the bridge still reports `strahd-kit`
  (a `MODE=down` during a run stops it instead of sending calls to the campaign). `kit check` also
  rejects a `tools-only` scenario that declares any other tool. The Pi's Foundry must answer and be
  launching `strahd-kit`, and the connected world must be `strahd-kit`, or the run stops with
  exit code 2 before it calls a tool.

## What comes next

- The full matrix of spells is done (slice 3b: see "spells-cast-all" and "spells-deep").
- Dashboard checks in a real browser (Playwright), not only the JSON the dashboard serves.
- Actor Studio at other levels (1, 11, 17, 20), with equipment and its biography tab on, and a multiclass
  level-up (the plain route is covered by `heroes-multiclass`); the Actor Studio findings above sent to its author.
- The Pi target beyond tools only: the scenarios that click (needs the kit's own GM browser to join the Pi as `Kit GM` with its password; the plumbing is in `lib/gm.mjs`), and a build on the Pi.
- The licensed layer: the Curse of Strahd scenarios, kept on this PC only.
